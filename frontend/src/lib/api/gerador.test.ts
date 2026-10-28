// @vitest-environment node
/**
 * F2-09 — o `ferramentas/gerar-api.mjs`, visto de fora, como o CI o vê.
 *
 * Corre sempre a ferramenta como um processo (`node ferramentas/…`), nunca
 * importando funções dela: o que o `npm run gerar-api` entrega é um estado
 * de saída e uma frase no stderr, e é isso que tem de estar preso. Uma
 * função importada passaria a testar o interior e deixava de dizer nada
 * sobre o comando.
 *
 * Tudo corre dentro de `mkdtempSync`, com a entrada e a saída passadas em
 * argumentos — é para isto que as omissões da ferramenta saem de
 * `import.meta.url` e nunca do `cwd`: um teste que esquecesse um argumento
 * escrevia por cima do `src/lib/api/gerado/esquema.ts` versionado em vez
 * de falhar.
 *
 * **O que estes testes deixam passar:** não dizem nada sobre o *conteúdo*
 * dos tipos gerados (isso é o `esquema-gerado.test.ts`, que lê o artefacto
 * versionado), nem sobre o OpenAPI real do backend estar atualizado (isso
 * é o job de contrato do CI, que o regenera e compara). Aqui só se prova
 * que a ferramenta recusa o que tem de recusar e escreve quando deve.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RAIZ_FRONTEND } from "../../testes/percorrer-arvore";

const GERADOR = join(RAIZ_FRONTEND, "ferramentas", "gerar-api.mjs");

/**
 * O comando que todas as mensagens de falha de contrato têm de nomear.
 * Está escrito aqui letra a letra de propósito: se alguém mudar o comando
 * no backend e não mudar a mensagem, isto fica vermelho.
 */
const COMANDO_DO_BACKEND = "AMBIENTE=desenvolvimento uv run python -m app.openapi";

const ROTAS_PUBLICAS = ["/ementa", "/eventos", "/galeria", "/info"];

/** Um OpenAPI 3.1 verdadeiro, com as rotas pedidas e um envelope cada. */
function documentoOpenapi(rotas: string[]): string {
  const nomeDoEsquema = (rota: string) =>
    `Resposta${rota.slice(1, 2).toUpperCase()}${rota.slice(2)}`;

  const caminhos: Record<string, unknown> = {};
  const esquemas: Record<string, unknown> = {};

  for (const rota of rotas) {
    const esquema = nomeDoEsquema(rota);
    caminhos[rota] = {
      get: {
        operationId: `obter${esquema}`,
        responses: {
          200: {
            description: "Successful Response",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${esquema}` } },
            },
          },
        },
      },
    };
    esquemas[esquema] = {
      type: "object",
      title: esquema,
      required: ["itens"],
      properties: { itens: { type: "array", items: { type: "string" } } },
    };
  }

  return `${JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: "Bar da Tomazia", version: "0.1.0" },
      paths: caminhos,
      components: { schemas: esquemas },
    },
    null,
    2,
  )}\n`;
}

type Execucao = { estado: number; stdout: string; stderr: string };

/**
 * Corre o gerador e devolve o resultado — com o guarda da regra 10: um
 * processo que não arranca e um processo que sai com erro são coisas
 * diferentes, e `status` a `null` (morto por um sinal) não pode cair num
 * `expect(estado).not.toBe(0)` como se fosse uma recusa de contrato.
 */
function correrGerador(...argumentos: string[]): Execucao {
  const resultado = spawnSync(process.execPath, [GERADOR, ...argumentos], {
    encoding: "utf-8",
    cwd: tmpdir(),
  });

  if (resultado.error) {
    throw new Error(
      `Não consegui lançar o gerador (${GERADOR}): ${resultado.error.message}. ` +
        "Isto é uma falha a arrancar o processo, não uma falha do gerador.",
    );
  }
  if (resultado.status === null) {
    throw new Error(
      `O gerador foi morto pelo sinal ${resultado.signal ?? "desconhecido"} em vez de sair ` +
        "com um estado. Não é o mesmo que ter recusado o contrato.",
    );
  }

  return { estado: resultado.status, stdout: resultado.stdout, stderr: resultado.stderr };
}

const pastasTemporarias: string[] = [];

function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), "gerar-api-"));
  pastasTemporarias.push(pasta);
  return pasta;
}

afterEach(() => {
  while (pastasTemporarias.length > 0) {
    const pasta = pastasTemporarias.pop();
    if (pasta !== undefined) rmSync(pasta, { recursive: true, force: true });
  }
});

/** O gerador lança o openapi-typescript num subprocesso: dá-lhe tempo. */
const ESPERA_PELO_GERADOR = { timeout: 60_000 };

describe("gerar-api: o caminho feliz", ESPERA_PELO_GERADOR, () => {
  it("gera tipos a partir de um OpenAPI com as quatro rotas públicas", () => {
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    // De propósito numa subpasta que ainda não existe: o gerador tem de a
    // criar, tal como cria `src/lib/api/gerado/` numa árvore acabada de
    // clonar.
    const saida = join(pasta, "gerado", "esquema.ts");
    writeFileSync(entrada, documentoOpenapi(ROTAS_PUBLICAS), "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado, `stderr: ${execucao.stderr}`).toBe(0);

    const gerado = readFileSync(saida, "utf-8");
    for (const rota of ROTAS_PUBLICAS) {
      expect(gerado, `o tipo gerado tem de conter a rota ${rota}`).toContain(`"${rota}"`);
    }
    expect(gerado).toContain("export interface paths");

    // Nada de lixo deixado para trás: o temporário desapareceu.
    expect(readdirSync(join(pasta, "gerado"))).toEqual(["esquema.ts"]);
  });
});

describe("gerar-api: recusas, cada uma com o comando de correção", ESPERA_PELO_GERADOR, () => {
  it("entrada ausente: falha a nomear o comando que gera o OpenAPI", () => {
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "nao-existe.json");
    const saida = join(pasta, "esquema.ts");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain(entrada);
    // A parte que interessa: a frase diz o que fazer a seguir. Sem o
    // comando lá dentro, quem apanha isto no CI não sabe que o OpenAPI é
    // um artefacto que se gera do lado do backend.
    expect(
      execucao.stderr,
      "a mensagem tem de nomear o comando que gera o OpenAPI, não só dizer que falta",
    ).toContain(COMANDO_DO_BACKEND);
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("entrada que não é JSON: falha a dizer que se regenera, e não escreve nada", () => {
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    writeFileSync(entrada, "isto não é JSON nenhum", "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain(COMANDO_DO_BACKEND);
    expect(readdirSync(pasta)).toEqual(["openapi.json"]);
  });

  it("OpenAPI válido e vazio: falha, porque é o buraco que o typecheck não vê", () => {
    // Este é o caso medido pelo arquiteto, e a razão de o guarda existir:
    // `{"paths": {}}` é um documento perfeitamente válido, o
    // openapi-typescript sai 0 e escreve `paths = Record<string, never>`,
    // e o `tsc --strict` aceita `"/ementa" satisfies keyof paths` em cima
    // disso (porque `keyof Record<string, never>` é `string`). Sem este
    // guarda, um backend sem routers montados dava um `npm run gerar-api`
    // verde, um `npm run typecheck` verde, e um site sem dados.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    writeFileSync(
      entrada,
      `${JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Bar da Tomazia", version: "0.1.0" },
        paths: {},
      })}\n`,
      "utf-8",
    );

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain(COMANDO_DO_BACKEND);
    expect(readdirSync(pasta)).toEqual(["openapi.json"]);
  });

  it("OpenAPI a que falta uma rota pública: falha a nomear a que falta", () => {
    // Um documento não vazio, mas incompleto — um router por montar. A
    // mensagem tem de dizer **qual** rota falta: "o contrato está errado"
    // sem dizer onde manda procurar em cinco ficheiros.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    writeFileSync(entrada, documentoOpenapi(["/ementa", "/eventos", "/galeria"]), "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain("/info");
    expect(execucao.stderr).toContain(COMANDO_DO_BACKEND);
    expect(readdirSync(pasta)).toEqual(["openapi.json"]);
  });

  it("`paths` que não é um objeto: falha em vez de rebentar com um TypeError", () => {
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    writeFileSync(
      entrada,
      `${JSON.stringify({ openapi: "3.1.0", info: { title: "x", version: "1" } })}\n`,
      "utf-8",
    );

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain("paths");
    expect(execucao.stderr).not.toContain("TypeError");
  });
});

describe("gerar-api: lê o ficheiro, e só o ficheiro", ESPERA_PELO_GERADOR, () => {
  it("um $ref remoto é recusado antes de o openapi-typescript o ir buscar", () => {
    // Achado da revisão de segurança, medido com um servidor local: um
    // `$ref` para um URL faz o openapi-typescript fazer o pedido. Não há
    // escalada (o job do CI corre sem segredos), mas uma ferramenta que
    // promete ler um ficheiro tem de ler só esse ficheiro — e a promessa
    // está escrita no cabeçalho dela. O endereço abaixo nunca chega a ser
    // contactado: é esse o ponto do teste.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");

    const documento = JSON.parse(documentoOpenapi(ROTAS_PUBLICAS)) as {
      components: { schemas: Record<string, unknown> };
    };
    documento.components.schemas["RespostaEmenta"] = {
      $ref: "http://127.0.0.1:9/remoto.json#/components/schemas/Intruso",
    };
    writeFileSync(entrada, `${JSON.stringify(documento, null, 2)}\n`, "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain("$ref");
    expect(execucao.stderr).toContain("http://127.0.0.1:9/remoto.json");
    expect(execucao.stderr).toContain(COMANDO_DO_BACKEND);
    expect(readdirSync(pasta)).toEqual(["openapi.json"]);
  });

  it("um $ref para outro ficheiro do disco também é recusado", () => {
    // O mesmo buraco sem rede pelo meio: `./segredo.json` sairia deste
    // ficheiro na mesma, e um caminho absoluto ainda mais.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");

    const documento = JSON.parse(documentoOpenapi(ROTAS_PUBLICAS)) as {
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    const rota = documento.paths["/info"];
    if (rota === undefined) throw new Error("o documento de teste perdeu a rota /info");
    rota.get.responses["404"] = { $ref: "./outro-ficheiro.json#/respostas/NaoEncontrado" };
    writeFileSync(entrada, `${JSON.stringify(documento, null, 2)}\n`, "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.stderr).toContain("./outro-ficheiro.json");
  });

  it("um documento com dezenas de milhares de níveis não rebenta o guarda", () => {
    // JSON válido, aninhado 50 000 vezes. Uma travessia recursiva esgotava
    // a pilha e saía com `RangeError` antes de examinar `$ref` nenhum — e
    // um guarda que rebenta perante a entrada que devia examinar não
    // examinou nada. A rede de último recurso da ferramenta apanhava-o,
    // mas «não consegui procurar» não vale por «não encontrei».
    //
    // O que este caso exige não é um estado em particular (quem recusa
    // este documento é o openapi-typescript, e isso é assunto dele): é que
    // a recusa venha com uma frase nossa e sem o nosso percorredor num
    // rasto de pilha.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");

    // O documento é montado como **texto**, não com `JSON.stringify`: o
    // `stringify` é ele próprio recursivo e rebentaria aqui, no teste,
    // antes de chegar a escrever o ficheiro.
    const niveis = 50_000;
    const profundo = `${'{"a":'.repeat(niveis)}{}${"}".repeat(niveis)}`;
    const marca = '"schemas":{';
    const base = JSON.stringify(JSON.parse(documentoOpenapi(ROTAS_PUBLICAS)));
    expect(
      base.split(marca).length - 1,
      "a marca onde o fundo é injetado tem de aparecer exatamente uma vez",
    ).toBe(1);
    writeFileSync(entrada, `${base.replace(marca, `${marca}"Fundo":${profundo},`)}\n`, "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.stderr).toContain("gerar-api:");
    expect(
      execucao.stderr,
      "o percorredor de $ref não pode aparecer num rasto de pilha: é ele que tem de aguentar",
    ).not.toContain("refsQueSaemDoFicheiro");
    expect(
      execucao.stderr,
      "e isto não pode ser classificado como avaria da nossa ferramenta",
    ).not.toContain("avaria inesperada");
  });

  it("os $ref locais do FastAPI passam: o controlo do guarda", () => {
    // Sem este caso, um guarda que recusasse todos os `$ref` — incluindo
    // os `#/components/schemas/…` que o FastAPI escreve em cada resposta —
    // passava por bom, e o `npm run gerar-api` nunca mais gerava nada.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    const documento = documentoOpenapi(ROTAS_PUBLICAS);

    expect(documento, "o documento de teste tem de ter $ref locais").toContain(
      "#/components/schemas/",
    );
    writeFileSync(entrada, documento, "utf-8");

    expect(correrGerador(entrada, saida).estado).toBe(0);
  });
});

describe("gerar-api: falhas de disco têm estado próprio", ESPERA_PELO_GERADOR, () => {
  it("entrada que existe mas não se lê: estado diferente de «entrada ausente»", () => {
    // Uma diretoria chamada `openapi.json` passa o `existsSync` e rebenta
    // no `readFileSync` (EISDIR). A mensagem já distinguia os dois casos;
    // o estado de saída é que não — e o contrato com o CI é o estado.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    mkdirSync(entrada);

    const ilegivel = correrGerador(entrada, saida);
    const ausente = correrGerador(join(pasta, "nao-existe.json"), saida);

    expect(ilegivel.estado).not.toBe(0);
    expect(ausente.estado).not.toBe(0);
    expect(
      ilegivel.estado,
      "«existe e não consigo lê-lo» não é «não existe»: são avarias diferentes",
    ).not.toBe(ausente.estado);
    expect(ilegivel.stderr).toContain(COMANDO_DO_BACKEND);
  });

  it("pasta de saída que não se cria: frase de correção, não um rasto cru", () => {
    // Um ficheiro chamado `gerado` onde devia estar a pasta. Sem o `try`
    // à volta do `mkdirSync`, isto saía 1 com um rasto do Node e sem
    // nenhuma frase a dizer o que fazer.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    writeFileSync(entrada, documentoOpenapi(ROTAS_PUBLICAS), "utf-8");
    writeFileSync(join(pasta, "gerado"), "não sou uma pasta\n", "utf-8");
    const saida = join(pasta, "gerado", "esquema.ts");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(execucao.estado, "nenhum caminho pode sair pelo 1 genérico do Node").not.toBe(1);
    expect(execucao.stderr, "a frase tem de dizer o que fazer, não despejar um rasto").toContain(
      "npm run gerar-api",
    );
    expect(execucao.stderr).not.toContain("at Object.");
  });
});

describe("gerar-api: uma geração falhada não deixa saída meio escrita", ESPERA_PELO_GERADOR, () => {
  it("entrada truncada com um esquema bom já lá: o anterior fica byte a byte igual", () => {
    // O cenário real: alguém corre `npm run gerar-api` com o `openapi.json`
    // escrito a meio (uma geração do backend interrompida). O ficheiro
    // versionado tem de ficar exatamente como estava — não meio escrito,
    // não vazio, não apagado. Um gerador que escrevesse direto para o
    // destino deixava aqui um ficheiro truncado que compila na mesma e
    // ninguém repara até um ecrã ficar sem tipos.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "gerado", "esquema.ts");

    mkdirSync(join(pasta, "gerado"), { recursive: true });
    const anterior = 'export interface paths {\n  "/ementa": never;\n}\n';
    writeFileSync(saida, anterior, "utf-8");

    const completo = documentoOpenapi(ROTAS_PUBLICAS);
    writeFileSync(entrada, completo.slice(0, Math.floor(completo.length / 2)), "utf-8");

    const execucao = correrGerador(entrada, saida);

    expect(execucao.estado).not.toBe(0);
    expect(readFileSync(saida, "utf-8")).toBe(anterior);
    // E sem nenhum `esquema.ts.a-gerar-…` esquecido ao lado.
    expect(readdirSync(join(pasta, "gerado"))).toEqual(["esquema.ts"]);
  });
});

describe("o override do peer do openapi-typescript tem data de validade", () => {
  /**
   * O `package.json` força `openapi-typescript` a aceitar o TypeScript
   * deste projeto, porque ele ainda declara `peer typescript: "^5.x"` e nós
   * estamos no 6 (sem isso, o `npm ci` recusa com ERESOLVE). A escolha está
   * no ADR 0012 e é dirigida a este pacote e a este peer — não é um
   * `legacy-peer-deps` global.
   *
   * O problema de um override é que ele silencia o peer **para sempre**:
   * no dia em que eles abrirem o intervalo, nada fica vermelho e ninguém se
   * lembra de o tirar. Estes casos são o despertador.
   *
   * **O que deixam passar:** não sabem avaliar um intervalo de versões —
   * não há semver aqui, e escrever um a meio era pior do que não ter
   * nenhum. São uma comparação literal com o que foi medido: qualquer
   * mudança a montante acende a luz, mesmo que não seja ainda a abertura ao
   * 6. É falso positivo barato (uma pessoa vai ler o intervalo novo) contra
   * um falso negativo que dura anos.
   */
  const PEER_MEDIDO = "^5.x";

  function manifesto(caminho: string): Record<string, unknown> {
    const texto = readFileSync(caminho, "utf-8");
    return JSON.parse(texto) as Record<string, unknown>;
  }

  it("ainda é preciso: o peer deles continua a recusar o TypeScript 6", () => {
    const deles = manifesto(
      join(RAIZ_FRONTEND, "node_modules", "openapi-typescript", "package.json"),
    );
    const peers = deles.peerDependencies as Record<string, string> | undefined;

    if (peers === undefined) {
      throw new Error(
        "o openapi-typescript deixou de declarar peerDependencies. Isso resolve o problema " +
          "por outro caminho: tira o `overrides` do package.json, a nota `//` e este teste.",
      );
    }

    expect(
      peers.typescript,
      "o intervalo de peer do openapi-typescript mudou. Vai ver se já aceita o TypeScript 6: " +
        "se aceitar, tira o `overrides` do package.json, a nota `//` e estes casos, e " +
        "atualiza o ADR 0012. Se não aceitar, atualiza só o valor medido aqui.",
    ).toBe(PEER_MEDIDO);
  });

  it("o override continua a existir, dirigido ao pacote e ao peer", () => {
    const nosso = manifesto(join(RAIZ_FRONTEND, "package.json"));
    const overrides = nosso.overrides as Record<string, Record<string, string>> | undefined;

    expect(
      overrides?.["openapi-typescript"]?.typescript,
      "o override tem de seguir a versão que o projeto usa (`$typescript`), nunca uma fixa",
    ).toBe("$typescript");

    expect(
      String(nosso["//"] ?? ""),
      "a nota do package.json tem de apontar para o ADR que explica a decisão",
    ).toContain("0012-cliente-da-api-sem-biblioteca.md");
  });

  it("e estamos mesmo no TypeScript 6, que é o que torna o override preciso", () => {
    const typescript = manifesto(join(RAIZ_FRONTEND, "node_modules", "typescript", "package.json"));

    expect(
      String(typescript.version).split(".")[0],
      "se o projeto voltar ao TypeScript 5, o override deixa de fazer falta e sai",
    ).toBe("6");
  });
});

describe("gerar-api: o buraco que justifica o guarda, medido", ESPERA_PELO_GERADOR, () => {
  it("o openapi-typescript sozinho aceita um OpenAPI vazio e sai 0", () => {
    // Não testa código nosso: testa a afirmação em que o guarda assenta.
    // Se uma versão futura do openapi-typescript passar a recusar
    // documentos vazios, este teste fica vermelho e diz-nos que o guarda
    // deixou de ser a única rede — o que é uma informação, não um defeito.
    const pasta = pastaTemporaria();
    const entrada = join(pasta, "openapi.json");
    const saida = join(pasta, "esquema.ts");
    writeFileSync(
      entrada,
      `${JSON.stringify({ openapi: "3.1.0", info: { title: "x", version: "1" }, paths: {} })}\n`,
      "utf-8",
    );

    const resultado = spawnSync(
      process.execPath,
      [join(RAIZ_FRONTEND, "node_modules", ".bin", "openapi-typescript"), entrada, "-o", saida],
      { encoding: "utf-8", cwd: RAIZ_FRONTEND },
    );

    if (resultado.error) {
      throw new Error(
        `Não consegui lançar o openapi-typescript: ${resultado.error.message}. ` +
          "Corre `npm ci` em frontend/.",
      );
    }
    if (resultado.status === null) {
      throw new Error(
        `O openapi-typescript foi morto pelo sinal ${resultado.signal ?? "desconhecido"}.`,
      );
    }

    expect(resultado.status, "o openapi-typescript aceita um OpenAPI vazio").toBe(0);
    expect(readFileSync(saida, "utf-8")).toContain("export type paths = Record<string, never>");
  });
});
