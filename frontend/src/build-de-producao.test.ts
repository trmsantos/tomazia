// @vitest-environment node
/**
 * F3-01 — o que entra em `dist/` e o que nunca lá pode entrar.
 *
 * Este ficheiro corre o `npm run build` uma vez e faz duas perguntas ao
 * resultado:
 *
 *  1. **As fontes sobreviveram?** Em `public/` não há o grafo de
 *     dependências do Vite a garantir nada: se alguém mexer no `publicDir`
 *     ou mover a pasta, os `.woff2` desaparecem do build e o site fica com
 *     as fontes de sistema. Em desenvolvimento continua tudo bem, porque o
 *     servidor serve `public/` diretamente.
 *  2. **A página de demonstração ficou de fora?** O Vite só inclui os HTML
 *     que estão em `build.rollupOptions.input`, e por omissão é só o
 *     `index.html`. É estrutural, não disciplina — mas uma linha no
 *     `vite.config.ts` desfá-lo, e é essa linha que este teste vigia.
 *  3. **E ficou de fora também no CSS?** Esta é a pergunta que faltava, e a
 *     resposta era não. O Vite constrói um HTML e um pacote de JavaScript,
 *     mas o Tailwind gera **uma** folha de estilos a partir do `content` —
 *     e o `content` incluía a demonstração. As classes que só ela usa iam
 *     para produção dentro do CSS público, incluindo um `.bg-dourado-latao`
 *     que nenhum componente escreve. As outras verificações não davam por
 *     nada porque procuram a palavra "demonstracao" ou a marca do `<h1>`, e
 *     um nome de classe partilhado não contém nenhuma das duas; o
 *     `size-limit` só mede `dist/assets/*.js`. Por isso esta pergunta olha
 *     para o que **entrou**, e não para o nome do ficheiro de onde veio.
 *
 * O `grep` é tratado com os três estados à mão, por causa da regra 10 do
 * `CLAUDE.md`: 0 = encontrou (a demonstração entrou, e falha), 1 = não
 * encontrou (o esperado), qualquer outra coisa = não consegui procurar, e
 * isso **não** pode passar por "está limpo".
 *
 * E há uma precondição que vale tanto como o `grep`: se a demonstração não
 * existir no código-fonte, não encontrar nada em `dist/` não prova nada
 * nenhum. O teste falha a dizer isso, com outra mensagem.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { COMPONENTES_DA_F3_01 } from "./testes/componentes";
import { FICHEIROS_DA_F3_05, FICHEIROS_DA_F4_01, FICHEIROS_DA_F4_02 } from "./testes/ecras";
import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "./testes/percorrer-arvore";

const PASTA_DIST = join(RAIZ_FRONTEND, "dist");
const PASTA_PUBLICA_DAS_FONTES = join(RAIZ_FRONTEND, "public", "fontes");

/** O `<h1>` da página de demonstração. É a marca única que se procura em `dist/`. */
const MARCA_DA_DEMONSTRACAO = "Componentes do Bar da Tomazia";

const FICHEIROS_DA_DEMONSTRACAO = [
  "demonstracao.html",
  "src/demonstracao/main.tsx",
  "src/demonstracao/PaginaDemonstracao.tsx",
];

const TEMPO_DO_BUILD = 240_000;

beforeAll(() => {
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: RAIZ_FRONTEND,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: TEMPO_DO_BUILD,
    });
  } catch (erro) {
    const detalhe = erro as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      "Não consegui construir o frontend (`npm run build` falhou), por isso não há " +
        "nada para inspeccionar em dist/. Isto é uma falha de build, não uma falha " +
        "do que entrou no build.\n" +
        (detalhe.stderr ?? detalhe.stdout ?? detalhe.message ?? ""),
    );
  }
}, TEMPO_DO_BUILD);

describe("o build produziu alguma coisa", () => {
  it("dist/ tem o index.html e pelo menos um ficheiro de JavaScript", () => {
    // Guarda da regra 10: num `dist/` vazio, o `grep` do teste da
    // demonstração não encontra nada e passaria sem ter visto nada.
    expect(existsSync(join(PASTA_DIST, "index.html"))).toBe(true);

    const assets = existsSync(join(PASTA_DIST, "assets"))
      ? readdirSync(join(PASTA_DIST, "assets"))
      : [];
    expect(assets.filter((nome) => nome.endsWith(".js")).length).toBeGreaterThan(0);
  });
});

describe("as fontes sobrevivem ao build", () => {
  it("dist/fontes/ tem os mesmos .woff2 que public/fontes/", () => {
    expect(
      existsSync(PASTA_PUBLICA_DAS_FONTES),
      "não consegui ler public/fontes/ — falha de leitura, não de build",
    ).toBe(true);

    const naOrigem = readdirSync(PASTA_PUBLICA_DAS_FONTES)
      .filter((nome) => nome.endsWith(".woff2"))
      .sort();
    expect(naOrigem.length, "public/fontes/ tem de ter as três faces").toBe(3);

    const pastaNoBuild = join(PASTA_DIST, "fontes");
    expect(existsSync(pastaNoBuild), "o build não levou a pasta das fontes para dist/").toBe(true);

    const noBuild = readdirSync(pastaNoBuild)
      .filter((nome) => nome.endsWith(".woff2"))
      .sort();

    expect(noBuild).toEqual(naOrigem);
  });

  it("o CSS construído aponta para /fontes/ e não para data: nem para fora", () => {
    const folhas = readdirSync(join(PASTA_DIST, "assets")).filter((nome) => nome.endsWith(".css"));
    expect(
      folhas.length,
      "o build tem de produzir pelo menos uma folha de estilos",
    ).toBeGreaterThan(0);

    let faces = 0;
    for (const folha of folhas) {
      const css = lerTexto(join(PASTA_DIST, "assets", folha), `dist/assets/${folha}`);
      if (!css.includes("@font-face")) continue;
      faces += [...css.matchAll(/@font-face/g)].length;
      expect(css, `${folha}: uma fonte em data: é bloqueada pela CSP font-src 'self'`).not.toMatch(
        /url\(\s*["']?data:/,
      );
      expect(css, `${folha}: nada de fontes de outro domínio`).not.toMatch(/url\(\s*["']?https?:/);
      expect(css).toMatch(/\/fontes\//);
    }

    // Guarda da regra 10: sem nenhum `@font-face` no CSS construído, o
    // ciclo acima não faz uma única asserção e o teste passa sem ter visto
    // nada. Três faces, as da secção 4 de docs/ecras/F3-01.md.
    expect(faces, "o CSS construído tem de trazer as três faces").toBe(3);
  });
});

describe("a página de demonstração não chega a produção", () => {
  it("existe no código-fonte (sem isto, não encontrar nada em dist/ não prova nada)", () => {
    const emFalta = FICHEIROS_DA_DEMONSTRACAO.filter(
      (relativo) => !existsSync(join(RAIZ_FRONTEND, relativo)),
    );

    expect(
      emFalta,
      "Não consigo verificar que a demonstração ficou fora do build: ela não existe no " +
        "código-fonte. Um `grep` que não encontra nada num sítio onde nunca houve nada " +
        "é a falha silenciosa da regra 10.",
    ).toEqual([]);

    const pagina = lerTexto(
      join(RAIZ_FRONTEND, "src/demonstracao/PaginaDemonstracao.tsx"),
      "a página de demonstração",
    );
    expect(pagina, `a página tem de ter a marca «${MARCA_DA_DEMONSTRACAO}»`).toContain(
      MARCA_DA_DEMONSTRACAO,
    );
  });

  it("o vite.config.ts não declara rollupOptions.input", () => {
    // A rede mais forte das três, e a única que não precisa de correr nada:
    // enquanto o Vite só souber do `index.html`, o segundo HTML é servido em
    // desenvolvimento e ignorado no build.
    const configuracao = lerTexto(join(RAIZ_FRONTEND, "vite.config.ts"), "vite.config.ts");

    expect(
      configuracao,
      "declarar entradas de build passa a incluir a demonstração em dist/",
    ).not.toContain("rollupOptions");
  });

  it("nada em src/ importa da demonstração, estática ou dinamicamente", () => {
    // Fecha o caminho oposto: a demonstração entrar no build por ser
    // importada por código real.
    //
    // A varredura é `src/` inteiro e não só `components` e `pages`, porque o
    // caminho que de facto leva ao pacote público é o `src/main.tsx` e o
    // `src/App.tsx` — e eram precisamente esses dois que ficavam de fora.
    // Isentos: a própria demonstração (que se importa a si mesma) e os
    // testes, que a podem nomear para falar dela, como este.
    const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, "src"), {
      extensoes: [".ts", ".tsx"],
    }).filter((ficheiro) => {
      const relativo = caminhoRelativo(ficheiro);
      return (
        !relativo.startsWith("src/demonstracao/") &&
        !relativo.startsWith("src/testes/") &&
        !/\.(test|spec)\.tsx?$/.test(relativo)
      );
    });

    exigirSentinelas(
      ficheiros,
      [...COMPONENTES_DA_F3_01, "src/App.tsx", "src/main.tsx", ...FICHEIROS_DA_F3_05],
      "importações da demonstração",
    );

    // `from "…"` apanha a importação estática; `import("…")` e `require("…")`
    // apanham a dinâmica, que é como alguém lá chegaria sem pensar — e que um
    // `from` sozinho deixava passar inteira.
    const CAMINHO_PARA_A_DEMONSTRACAO =
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'][^"']*demonstracao/;

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      lerTexto(ficheiro, relativo)
        .split("\n")
        .forEach((linha, indice) => {
          if (CAMINHO_PARA_A_DEMONSTRACAO.test(linha)) {
            violacoes.push(`${relativo}:${indice + 1}`);
          }
        });
    }

    expect(violacoes).toEqual([]);

    // Autoteste do padrão: sem isto, uma expressão partida fazia o ciclo
    // acima não marcar nada e o teste passava a dizer que está tudo bem.
    for (const exemplo of [
      'import { PaginaDemonstracao } from "./demonstracao/PaginaDemonstracao";',
      'const pagina = await import("../demonstracao/PaginaDemonstracao");',
      'const pagina = require("./demonstracao/main");',
    ]) {
      expect(CAMINHO_PARA_A_DEMONSTRACAO.test(exemplo), `não apanhou: ${exemplo}`).toBe(true);
    }
    expect(CAMINHO_PARA_A_DEMONSTRACAO.test('const nome = "demonstracao";')).toBe(false);
  });

  it("dist/ não menciona a demonstração — com os três estados do grep tratados à mão", () => {
    for (const agulha of ["demonstracao", MARCA_DA_DEMONSTRACAO]) {
      const procura = spawnSync("grep", ["-r", "-l", "--", agulha, PASTA_DIST], {
        encoding: "utf-8",
      });

      if (procura.error !== undefined) {
        throw new Error(
          `Não consegui procurar em dist/ (o grep nem arrancou: ${procura.error.message}). ` +
            "Isto não é «está limpo», é «não sei».",
        );
      }

      switch (procura.status) {
        case 0:
          throw new Error(
            `A página de demonstração entrou no build: «${agulha}» aparece em\n` +
              (procura.stdout ?? "")
                .trim()
                .split("\n")
                .map((linha) => `  - ${caminhoRelativo(linha)}`)
                .join("\n"),
          );
        case 1:
          // Não encontrado. É o esperado, e é o único estado que passa.
          break;
        default:
          throw new Error(
            `Não consegui procurar em dist/ (o grep saiu com ${String(procura.status)}): ` +
              `${procura.stderr ?? ""}. Isto não é «está limpo», é «não sei».`,
          );
      }
    }
  });

  it("o autoteste do grep: o mesmo código encontra a marca onde ela está mesmo", () => {
    // Sem isto, um caminho errado faria o teste de cima passar sempre: o
    // grep sairia com 1 («não encontrei») por estar a olhar para uma pasta
    // vazia, e 1 é exactamente o estado que aceitamos.
    const procura = spawnSync(
      "grep",
      ["-r", "-l", "--", MARCA_DA_DEMONSTRACAO, join(RAIZ_FRONTEND, "src", "demonstracao")],
      { encoding: "utf-8" },
    );

    expect(procura.error, "o grep tem de arrancar").toBeUndefined();
    expect(
      procura.status,
      "o grep tem de encontrar a marca no código-fonte da demonstração; " +
        "se não encontra aqui, também não encontraria em dist/ e o teste de cima é vazio",
    ).toBe(0);
  });
});

/**
 * F4-01, Q-02 — o público nunca importa nada de `src/pages/gestao`.
 *
 * Molde do «nada em src/ importa da demonstração»: a gestão é carregada à parte
 * (`import("./pages/gestao/AppGestao")` no `main.tsx`), e o que a mantém fora do
 * pacote público é **estrutural** — um único ficheiro de fora a importá-la, mesmo
 * por engano e mesmo só um tipo ou uma constante, faz o Vite metê-la no pacote de
 * entrada. `orcamento-q02.test.ts` prova-o no build; este prova-o no código, onde
 * a mensagem diz quem foi.
 *
 * A única exceção é o `src/main.tsx`, e só por `import()` dinâmico: um `from` da
 * gestão no `main.tsx` volta a ser estático.
 */
describe("o público não importa src/pages/gestao", () => {
  const CAMINHO_PARA_A_GESTAO =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'](?:[^"']*\/)?gestao(?:\/[^"']*)?["']/;
  const ESTATICA_PARA_A_GESTAO =
    /(?:\bfrom\s*|\bimport\s*)["'](?:[^"']*\/)?gestao(?:\/[^"']*)?["']/;

  it("a gestão existe no código-fonte (sem isto, não encontrar nada não prova nada)", () => {
    const emFalta = [...FICHEIROS_DA_F4_01, ...FICHEIROS_DA_F4_02].filter(
      (relativo) => !existsSync(join(RAIZ_FRONTEND, relativo)),
    );

    expect(
      emFalta,
      "Não consigo verificar que o público não importa a gestão: a gestão não existe no " +
        "código-fonte. Uma varredura que não encontra nada onde nunca houve nada é a " +
        "falha silenciosa da regra 10.",
    ).toEqual([]);
  });

  it("nenhum ficheiro fora de src/pages/gestao a importa; o main.tsx só por import()", () => {
    const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, "src"), {
      extensoes: [".ts", ".tsx"],
    }).filter((ficheiro) => {
      const relativo = caminhoRelativo(ficheiro);
      return (
        !relativo.startsWith("src/pages/gestao/") &&
        !relativo.startsWith("src/testes/") &&
        !relativo.startsWith("src/demonstracao/") &&
        !/\.(test|spec)\.tsx?$/.test(relativo)
      );
    });

    exigirSentinelas(
      ficheiros,
      [
        "src/App.tsx",
        "src/main.tsx",
        "src/pages/publico/Ementa.tsx",
        "src/pages/publico/FolhaEnviarFoto.tsx",
        "src/lib/api/cliente.ts",
        "src/lib/api/publico.ts",
        "src/lib/formato/tempo-em-falta.ts",
        "src/components/ui/Campo.tsx",
      ],
      "importações da gestão",
    );

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      const regra = relativo === "src/main.tsx" ? ESTATICA_PARA_A_GESTAO : CAMINHO_PARA_A_GESTAO;
      lerTexto(ficheiro, relativo)
        .split("\n")
        .forEach((linha, indice) => {
          if (regra.test(linha)) violacoes.push(`${relativo}:${indice + 1}`);
        });
    }

    expect(violacoes).toEqual([]);
  });

  it("o main.tsx carrega mesmo a gestão por import() dinâmico (a exceção existe)", () => {
    const principal = lerTexto(join(RAIZ_FRONTEND, "src/main.tsx"), "src/main.tsx");
    expect(principal).toMatch(/import\s*\(\s*["']\.\/pages\/gestao\/AppGestao["']\s*\)/);
  });

  it("autoteste dos padrões: apanham o que têm de apanhar e deixam passar o resto", () => {
    for (const exemplo of [
      'import { Entrar } from "./pages/gestao/Entrar";',
      'import { navegar } from "../gestao/navegacao";',
      'const pagina = await import("./pages/gestao/AppGestao");',
      'export * from "../pages/gestao";',
      'const x = require("./gestao/Destino");',
    ]) {
      expect(CAMINHO_PARA_A_GESTAO.test(exemplo), `não apanhou: ${exemplo}`).toBe(true);
    }
    for (const exemplo of [
      'const caminho = "/gestao/entrar";',
      'import { gestaoDeTudo } from "./gestaoDeTudo";',
      'navegar("/gestao/entrar", { substituir: true });',
    ]) {
      expect(CAMINHO_PARA_A_GESTAO.test(exemplo), `apanhou a mais: ${exemplo}`).toBe(false);
    }
    expect(ESTATICA_PARA_A_GESTAO.test('import { A } from "./pages/gestao/AppGestao";')).toBe(true);
    expect(ESTATICA_PARA_A_GESTAO.test('import("./pages/gestao/AppGestao")')).toBe(false);
  });
});

/**
 * Os dez nomes da paleta, como aparecem numa utilidade do Tailwind
 * (`bg-dourado-latao`, `text-creme-sombra`). Espelham a tabela Design de
 * `docs/ESPECIFICACAO.md`.
 *
 * Nenhum componente os escreve — escrevem papéis (`bg-acao`, `text-texto`), e
 * `src/styles/cores-so-nos-tokens.test.ts` recusa o contrário. Logo, uma
 * utilidade com um destes nomes dentro do CSS construído só pode ter vindo da
 * página de demonstração (ou de um comentário de um teste), e nenhuma das
 * duas é código público.
 */
const NOMES_DA_PALETA = [
  "bordo-noite",
  "bordo-vinho",
  "bordo-tomazia",
  "dourado-latao",
  "creme-papel",
  "creme-sombra",
  "sucesso-escuro",
  "erro-escuro",
  "sucesso-creme",
  "erro-creme",
];

const PREFIXOS_DE_UTILIDADE = ["bg", "text", "border", "outline", "fill", "stroke", "divide"];

function folhasConstruidas(): { nome: string; css: string }[] {
  const pasta = join(PASTA_DIST, "assets");
  const folhas = existsSync(pasta)
    ? readdirSync(pasta)
        .filter((nome) => nome.endsWith(".css"))
        .map((nome) => ({ nome, css: lerTexto(join(pasta, nome), `dist/assets/${nome}`) }))
    : [];

  if (folhas.length === 0) {
    throw new Error(
      "Não consegui ler nenhuma folha de estilos em dist/assets/. Isto é uma falha de " +
        "leitura, não um CSS limpo: sem CSS para ler, qualquer procura sai vazia.",
    );
  }
  return folhas;
}

describe("o CSS de produção só traz o que é público", () => {
  it("nenhuma folha construída tem uma utilidade com um nome da paleta", () => {
    const folhas = folhasConstruidas();

    // Guarda da regra 10, dos dois lados. Primeiro: a demonstração tem mesmo
    // de usar nomes da paleta, senão não haveria nada para fugir e este teste
    // estaria a provar o vazio.
    const demonstracao = lerTexto(
      join(RAIZ_FRONTEND, "src/demonstracao/PaginaDemonstracao.tsx"),
      "a página de demonstração",
    );
    const usadosNaDemonstracao = NOMES_DA_PALETA.filter((nome) =>
      PREFIXOS_DE_UTILIDADE.some((prefixo) => demonstracao.includes(`${prefixo}-${nome}`)),
    );
    expect(
      usadosNaDemonstracao.length,
      "a demonstração tem de escrever nomes da paleta (é a secção «Cores»); " +
        "sem isso, não encontrar nenhum em dist/ não prova nada",
    ).toBeGreaterThan(0);

    // Segundo: o CSS construído tem de trazer as utilidades dos componentes.
    // Uma folha gerada a partir de um `content` vazio não tem nomes da paleta
    // nenhuns — e também não tem site nenhum.
    const comUtilidadesPublicas = folhas.filter((folha) => folha.css.includes(".bg-acao"));
    expect(
      comUtilidadesPublicas.length,
      "nenhuma folha construída tem `.bg-acao`, que é a classe do Botão principal: " +
        "o `content` do tailwind.config.ts não está a ver o código público",
    ).toBeGreaterThan(0);

    const fugas: string[] = [];
    for (const folha of folhas) {
      for (const nome of NOMES_DA_PALETA) {
        for (const prefixo of PREFIXOS_DE_UTILIDADE) {
          if (folha.css.includes(`.${prefixo}-${nome}`)) {
            fugas.push(`dist/assets/${folha.nome} tem .${prefixo}-${nome}`);
          }
        }
      }
    }

    expect(
      fugas,
      "Classes que só a demonstração usa entraram no CSS público. O Tailwind gera uma " +
        "folha só, a partir do `content` do tailwind.config.ts — e é lá que a " +
        "demonstração tem de ficar de fora quando se constrói.",
    ).toEqual([]);
  });
});
