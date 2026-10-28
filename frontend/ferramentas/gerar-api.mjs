#!/usr/bin/env node
/**
 * Gera `src/lib/api/gerado/esquema.ts` a partir do OpenAPI do backend.
 *
 * Espelho do `python -m app.openapi` do outro lado da fronteira:
 *
 *     node ferramentas/gerar-api.mjs [entrada] [saida]
 *
 * As omissões saem de `import.meta.url`, **nunca do `cwd`**. É a mesma
 * decisão do `app/openapi.py` e pela mesma razão: o destino de um ficheiro
 * versionado não pode depender da pasta de onde alguém carregou no
 * comando. Tem ainda uma consequência boa para os testes — com os dois
 * caminhos passados como argumentos, esta ferramenta corre inteira dentro
 * de uma pasta temporária sem tocar no repositório.
 *
 * A sequência é deliberada, e cada passo falha com uma frase que diz o
 * comando de correção:
 *
 *  1. a entrada existe;
 *  2. a entrada é JSON;
 *  3. o JSON tem `paths` e lá dentro estão as quatro rotas públicas;
 *  4. o `openapi-typescript` corre e o `status` é verificado à mão;
 *  5. escreve-se para um temporário e só depois se move;
 *  6. confirma-se que a saída existe e não está vazia.
 *
 * **O passo 3 não é zelo.** Um OpenAPI *válido e vazio*
 * (`{"openapi":"3.1.0","info":{…},"paths":{}}`) faz o `openapi-typescript`
 * sair **0** e emitir `export type paths = Record<string, never>`. E o
 * `tsc --strict` aceita, em cima desse ficheiro, tanto
 * `"/ementa" satisfies keyof paths` (porque `keyof Record<string, never>`
 * é `string`) como `components["schemas"]["RespostaEmenta"]` (indexar
 * `never` dá `never`, não erro). O verificador de tipos apanha a **deriva**
 * do contrato e não apanha a **degenerescência** — logo a rede tem de
 * estar aqui, antes de o gerador sequer arrancar. Está medido em
 * `src/lib/api/gerador.test.ts`, no caso que corre o `openapi-typescript`
 * diretamente sobre um documento vazio.
 *
 * O passo 4 segue a regra 10 do `CLAUDE.md`: um processo que não arranca
 * (`result.error`), um que é morto por um sinal (`status === null`) e um
 * que sai com estado ≠ 0 são três avarias diferentes e não podem dar a
 * mesma mensagem — a do meio não é um erro de contrato nenhum, é a máquina
 * a ficar sem memória, e mandar alguém procurar o defeito no OpenAPI seria
 * mandá-lo procurar o que lá não está.
 *
 * Estados de saída (contrato com o CI e com os testes):
 *   0  gerou
 *   2  entrada ausente
 *   3  entrada não é JSON
 *   4  contrato degenerado (sem `paths`, vazio, ou sem as rotas públicas)
 *   5  não consegui lançar o openapi-typescript
 *   6  o openapi-typescript saiu com estado ≠ 0
 *   7  o openapi-typescript foi morto por um sinal
 *   8  correu bem mas não escreveu saída (ou escreveu-a vazia)
 *
 * ## O `overrides` do `package.json`
 *
 * O `openapi-typescript` 7.13.0 declara `peerDependencies.typescript:
 * "^5.x"` e este projeto está no TypeScript 6 — o `npm install` recusa a
 * instalação com `ERESOLVE`. O `package.json` tem, por isso,
 * `overrides["openapi-typescript"].typescript: "$typescript"`, que lhe dá
 * a versão que nós já usamos. É um intervalo por atualizar do lado deles,
 * não uma incompatibilidade: o gerador corre sobre a API de compilação do
 * TypeScript 6 e os testes desta pasta provam-no em cada `npm test`. O
 * `overrides` é dirigido a este pacote e a este `peer`; não é um
 * `legacy-peer-deps` global, que desligaria a verificação para toda a
 * árvore de dependências. Quando o intervalo deles abrir ao 6, o
 * `overrides` sai.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRADA_OMISSAO = fileURLToPath(new URL("../openapi.json", import.meta.url));
const SAIDA_OMISSAO = fileURLToPath(new URL("../src/lib/api/gerado/esquema.ts", import.meta.url));

/**
 * As quatro rotas públicas que a F2-03 fixou. Não é a tabela inteira da
 * especificação de propósito: o que aqui está é o que o backend serve
 * hoje, e um contrato que exigisse rotas por implementar nunca passaria.
 * Quando a F2-05 acrescentar as mutações, acrescentam-se aqui.
 */
const ROTAS_OBRIGATORIAS = ["/ementa", "/eventos", "/galeria", "/info"];

const COMANDO_DO_OPENAPI = "cd backend && AMBIENTE=desenvolvimento uv run python -m app.openapi";

const ESTADOS = {
  ENTRADA_AUSENTE: 2,
  ENTRADA_NAO_E_JSON: 3,
  CONTRATO_DEGENERADO: 4,
  GERADOR_NAO_ARRANCOU: 5,
  GERADOR_FALHOU: 6,
  GERADOR_MORTO_POR_SINAL: 7,
  SAIDA_VAZIA: 8,
};

/** Escreve a frase no stderr e devolve o estado de saída. */
function falhar(estado, frase) {
  process.stderr.write(`gerar-api: ${frase}\n`);
  return estado;
}

/** Caminho do `bin` do openapi-typescript, resolvido a partir deste ficheiro. */
function localizarOpenapiTypescript() {
  const exigir = createRequire(import.meta.url);
  const manifesto = exigir.resolve("openapi-typescript/package.json");
  const conteudo = JSON.parse(readFileSync(manifesto, "utf-8"));
  const binario =
    typeof conteudo.bin === "string" ? conteudo.bin : conteudo.bin?.["openapi-typescript"];
  if (typeof binario !== "string") {
    throw new Error(
      `o package.json do openapi-typescript (${manifesto}) não declara um bin «openapi-typescript»`,
    );
  }
  return resolve(dirname(manifesto), binario);
}

/** Tamanho em bytes, ou `null` se o caminho não existir. */
function tamanhoDe(caminho) {
  try {
    return statSync(caminho).size;
  } catch {
    return null;
  }
}

function main(argumentos) {
  const entrada = argumentos[0] ? resolve(argumentos[0]) : ENTRADA_OMISSAO;
  const saida = argumentos[1] ? resolve(argumentos[1]) : SAIDA_OMISSAO;

  // 1. A entrada existe.
  if (!existsSync(entrada)) {
    return falhar(
      ESTADOS.ENTRADA_AUSENTE,
      `não encontrei o OpenAPI em ${entrada}. Ele é um artefacto, não é fonte, ` +
        `e não está versionado: gera-o primeiro com «${COMANDO_DO_OPENAPI}».`,
    );
  }

  // 2. A entrada é JSON.
  let texto;
  try {
    texto = readFileSync(entrada, "utf-8");
  } catch (erro) {
    return falhar(
      ESTADOS.ENTRADA_AUSENTE,
      `não consegui ler ${entrada}: ${erro instanceof Error ? erro.message : String(erro)}. ` +
        `Isto é uma falha de leitura, não de conteúdo — confirma as permissões e ` +
        `regenera o ficheiro com «${COMANDO_DO_OPENAPI}».`,
    );
  }

  let documento;
  try {
    documento = JSON.parse(texto);
  } catch (erro) {
    return falhar(
      ESTADOS.ENTRADA_NAO_E_JSON,
      `${entrada} não é JSON válido (${erro instanceof Error ? erro.message : String(erro)}). ` +
        `Costuma ser uma escrita interrompida a meio: volta a gerá-lo com ` +
        `«${COMANDO_DO_OPENAPI}».`,
    );
  }

  // 3. O contrato não está degenerado.
  const caminhos = documento?.paths;
  if (caminhos === null || typeof caminhos !== "object" || Array.isArray(caminhos)) {
    return falhar(
      ESTADOS.CONTRATO_DEGENERADO,
      `${entrada} não traz um objeto «paths». Um OpenAPI assim é aceite pelo ` +
        `openapi-typescript, que sai 0 e escreve tipos vazios que o «npm run typecheck» ` +
        `aceita em silêncio. Confirma que o backend monta os routers e regenera com ` +
        `«${COMANDO_DO_OPENAPI}».`,
    );
  }

  const presentes = Object.keys(caminhos);
  const emFalta = ROTAS_OBRIGATORIAS.filter((rota) => !presentes.includes(rota));
  if (presentes.length === 0 || emFalta.length > 0) {
    return falhar(
      ESTADOS.CONTRATO_DEGENERADO,
      `${entrada} é um OpenAPI válido mas sem as rotas públicas. ` +
        `Em falta: ${emFalta.length > 0 ? emFalta.join(", ") : "todas"} ` +
        `(encontrei ${presentes.length === 0 ? "nenhuma rota" : presentes.join(", ")}). ` +
        `Gerar tipos a partir daqui dava um «paths» vazio que o «npm run typecheck» ` +
        `aceita sem dizer nada. Confirma que «app/main.py» inclui o router público e ` +
        `regenera com «${COMANDO_DO_OPENAPI}».`,
    );
  }

  // 4. Correr o openapi-typescript, com o estado verificado à mão.
  let binario;
  try {
    binario = localizarOpenapiTypescript();
  } catch (erro) {
    return falhar(
      ESTADOS.GERADOR_NAO_ARRANCOU,
      `não encontrei o openapi-typescript (${erro instanceof Error ? erro.message : String(erro)}). ` +
        `É uma dependência de desenvolvimento: corre «npm ci» em frontend/ e repete.`,
    );
  }

  mkdirSync(dirname(saida), { recursive: true });
  // No mesmo diretório da saída, para o `renameSync` final ser uma troca
  // dentro do mesmo sistema de ficheiros — e não uma cópia que pode ser
  // interrompida a meio por cima de um ficheiro bom.
  const temporario = `${saida}.a-gerar-${process.pid}`;

  try {
    const resultado = spawnSync(process.execPath, [binario, entrada, "--output", temporario], {
      stdio: "inherit",
    });

    if (resultado.error) {
      return falhar(
        ESTADOS.GERADOR_NAO_ARRANCOU,
        `não consegui lançar o openapi-typescript: ${resultado.error.message}. ` +
          `Isto não é um erro do contrato — é o processo que nem chegou a arrancar. ` +
          `Corre «npm ci» em frontend/ e repete «npm run gerar-api».`,
      );
    }

    // Regra 10: morto por um sinal não é "saiu com erro". `status` é
    // `null` nesse caso, e `null !== 0` tanto como `1 !== 0` — sem este
    // ramo, uma máquina sem memória mandava alguém procurar um defeito no
    // OpenAPI, onde ele não está.
    if (resultado.status === null) {
      return falhar(
        ESTADOS.GERADOR_MORTO_POR_SINAL,
        `o openapi-typescript foi morto pelo sinal ${resultado.signal ?? "desconhecido"} ` +
          `antes de terminar. Não é um erro do contrato: costuma ser falta de memória ` +
          `ou um «Ctrl+C». Repete «npm run gerar-api».`,
      );
    }

    if (resultado.status !== 0) {
      return falhar(
        ESTADOS.GERADOR_FALHOU,
        `o openapi-typescript saiu com o estado ${resultado.status}. ` +
          `O erro dele está acima. Para o ver isolado: ` +
          `«npx openapi-typescript ${entrada} --output ${saida}».`,
      );
    }

    // 5. Só se escreveu alguma coisa é que se troca o ficheiro bom.
    const tamanhoDoTemporario = tamanhoDe(temporario);
    if (tamanhoDoTemporario === null || tamanhoDoTemporario === 0) {
      return falhar(
        ESTADOS.SAIDA_VAZIA,
        `o openapi-typescript saiu com 0 mas ${
          tamanhoDoTemporario === null ? "não escreveu nada" : "escreveu um ficheiro vazio"
        }. ${saida} fica como estava. Corre «npm ci» em frontend/ e repete ` +
          `«npm run gerar-api».`,
      );
    }

    renameSync(temporario, saida);
  } finally {
    rmSync(temporario, { force: true });
  }

  // 6. Confirmar a saída, já no sítio definitivo.
  const tamanhoDaSaida = tamanhoDe(saida);
  if (tamanhoDaSaida === null || tamanhoDaSaida === 0) {
    return falhar(
      ESTADOS.SAIDA_VAZIA,
      `${saida} ${tamanhoDaSaida === null ? "não existe" : "está vazio"} depois de mover o ` +
        `ficheiro gerado. Alguma coisa o apagou entretanto: repete «npm run gerar-api».`,
    );
  }

  process.stdout.write(`gerar-api: ${saida} (${tamanhoDaSaida} bytes)\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
