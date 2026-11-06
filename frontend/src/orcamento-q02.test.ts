// @vitest-environment node
/**
 * F3-02, secção 8 — Q-02: o que o pacote público custa, impresso e com tecto.
 *
 * O `size-limit` continua nos 100 kB porque é esse o critério. Mas o número
 * a vigiar na revisão não é o limite: é a estimativa. O ponto de partida
 * está medido — o `App.tsx` a ser um `<h1>` dava 68,89 kB comprimidos, e o
 * React gastou dois terços antes de este ecrã existir. A F3-02 estima 73 a
 * 74 kB.
 *
 * **Decisão do Tomás, 6 de novembro de 2026 (F3-05):** o tecto sobe de
 * 78 000 para **82 000 bytes**. Medido nesta máquina, na `main` antes desta
 * tarefa (quatro secções públicas: cabeçalho, ementa, eventos, WiFi): **76
 * 016 bytes** comprimidos — a mesma ordem de grandeza que os 76,03 kB que o
 * Tomás tinha medido. A F3-05 estima 79 a 81 kB (grelha, Visualizador,
 * Folha de envio, redução de imagem no browser); um tecto de 78 000 contra
 * essa estimativa chumbava a tarefa por fazer exactamente o que a
 * especificação pede. O critério Q-02 a sério continua a ser 100 kB e
 * continua folgado — este tecto é só o sinal de revisão, e recalibra-se com
 * o custo real de cada tarefa, não com a estimativa dela.
 *
 * Com 100 kB como único sinal, o problema aparece na F3-06 e já não se sabe
 * qual das tarefas o trouxe.
 *
 * ## Porque é que este build é próprio, e não o do `build-de-producao.test.ts`
 *
 * Porque aquele mede o pacote errado, e mede-o sem dizer que o está a
 * fazer. O Vite **respeita um `NODE_ENV` que já venha do processo que o
 * lançou** (está escrito no `vite.config.ts`), e o Vitest corre com
 * `NODE_ENV=test`: o build lançado de dentro de um teste traz o React em
 * modo de desenvolvimento. Medido nesta máquina, com o mesmo código: 72,07
 * kB a partir da linha de comandos e **133,25 kB** a partir do Vitest. Um
 * tecto de 78 kB contra o segundo número chumbava sempre, e por uma razão
 * que nada tem a ver com o que entrou no pacote.
 *
 * Daí as duas redes: o `NODE_ENV=production` explícito, e a sentinela do
 * build de produção do React. "Medi um pacote" e "medi o pacote que
 * embarca" não podem dar o mesmo resultado — é a regra 10 do `CLAUDE.md`
 * aplicada a uma medição.
 *
 * **O que este ficheiro deixa passar:** o CSS, que não entra na medição
 * (`size-limit` olha para `dist/assets/*.js`) e cresce na mesma. Fica
 * registado; é da F3-07 decidir se passa a ser medido.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "./testes/percorrer-arvore";

/**
 * Pasta própria, **fora do repositório**, e não `dist/`.
 *
 * Duas razões, as duas aprendidas a escrever isto:
 *
 *  1. O `src/build-de-producao.test.ts` também corre um `npm run build`, e
 *     o Vitest corre os ficheiros em paralelo: os dois escreviam para
 *     `dist/` ao mesmo tempo e media-se o que o outro tinha acabado de lá
 *     pôr. Medido: este ficheiro passava sozinho e chumbava na corrida
 *     completa, com o número do build de desenvolvimento do vizinho. Dois
 *     testes a medir a mesma pasta é uma corrida, e uma corrida não é um
 *     resultado.
 *  2. Fora da árvore do projeto porque qualquer pasta dentro dela passa a
 *     ser varrida pelo `eslint .` — e um pacote minificado dá umas
 *     centenas de erros de `no-undef` que não são de ninguém. Pôr a pasta
 *     nos `ignores` do ESLint era alargar a configuração por causa de um
 *     ficheiro temporário.
 */
const PASTA_DO_BUILD = join(tmpdir(), "tomazia-q02");
const TEMPO_DO_BUILD = 240_000;

/**
 * O tecto de vigilância. O critério continua a ser o do `size-limit`.
 *
 * 82 000 bytes (decisão do Tomás, 6 de novembro de 2026, F3-05): 76 016
 * medidos antes desta tarefa mais a estimativa de 79-81 kB dela. Ver o
 * cabeçalho do ficheiro para a conta inteira.
 */
const TECTO_DO_PACOTE_PUBLICO = 82_000;

/**
 * Uma frase que só existe no ecrã da ementa.
 *
 * Sem ela, medir um `dist/` que não tem a ementa lá dentro devolvia um
 * número pequeno e um teste verde — "não consegui medir o que interessa" a
 * passar por "cabe no orçamento".
 */
const MARCA_DA_EMENTA = "Não consegui carregar a ementa.";

/**
 * Só o build de produção do React traz as mensagens de erro encurtadas; o
 * de desenvolvimento traz o texto inteiro. É a sentinela que distingue os
 * dois pacotes sem depender de tamanhos.
 */
const MARCA_DO_REACT_DE_PRODUCAO = "Minified React error";

beforeAll(() => {
  try {
    execFileSync("npm", ["run", "build", "--", "--outDir", PASTA_DO_BUILD, "--emptyOutDir"], {
      cwd: RAIZ_FRONTEND,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: TEMPO_DO_BUILD,
      // Ver o cabeçalho: sem isto, o Vitest empresta o seu `NODE_ENV=test`
      // ao Vite e o que se mede é o React de desenvolvimento.
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (erro) {
    const detalhe = erro as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      "Não consegui construir o frontend, por isso não há nada para medir. " +
        "Isto é uma falha de build, não uma falha de orçamento.\n" +
        (detalhe.stderr ?? detalhe.stdout ?? detalhe.message ?? ""),
    );
  }
}, TEMPO_DO_BUILD);

function javascriptConstruido(): { nome: string; texto: string; comprimido: number }[] {
  const pasta = join(PASTA_DO_BUILD, "assets");
  if (!existsSync(pasta)) return [];

  return readdirSync(pasta)
    .filter((nome) => nome.endsWith(".js"))
    .map((nome) => {
      const conteudo = readFileSync(join(pasta, nome));
      return {
        nome,
        texto: conteudo.toString("utf-8"),
        comprimido: gzipSync(conteudo).byteLength,
      };
    });
}

describe("guardas da medição", () => {
  it("há JavaScript construído", () => {
    expect(
      javascriptConstruido().length,
      "não há JavaScript na pasta construída — não medi nada",
    ).toBeGreaterThan(0);
  });

  it("o que se mediu é o build de produção do React", () => {
    const ficheiros = javascriptConstruido();
    const deProducao = ficheiros.filter((ficheiro) =>
      ficheiro.texto.includes(MARCA_DO_REACT_DE_PRODUCAO),
    );

    expect(
      deProducao.map((ficheiro) => ficheiro.nome).length,
      "o pacote medido não tem a marca do React de produção. O Vite respeita o " +
        "`NODE_ENV` de quem o lançou, e o do Vitest é «test» — medido assim, o " +
        "React vem em modo de desenvolvimento e o número é quase o dobro. " +
        "Isto é uma falha de medição, não de orçamento.",
    ).toBeGreaterThan(0);
  });

  it("o pacote medido contém mesmo a ementa", () => {
    const ficheiros = javascriptConstruido();
    const comAEmenta = ficheiros.filter((ficheiro) => ficheiro.texto.includes(MARCA_DA_EMENTA));

    expect(
      comAEmenta.map((ficheiro) => ficheiro.nome).length,
      `nenhum ficheiro construído contém «${MARCA_DA_EMENTA}». O ecrã da ementa ` +
        "não está no pacote, por isso o número medido não é o número da F3-02.",
    ).toBeGreaterThan(0);
  });
});

describe("Q-02: o orçamento", () => {
  it(`o JavaScript comprimido fica abaixo de ${String(TECTO_DO_PACOTE_PUBLICO)} bytes`, () => {
    const ficheiros = javascriptConstruido();
    const total = ficheiros.reduce((soma, ficheiro) => soma + ficheiro.comprimido, 0);

    // Impresso de propósito: é este número que o PR cita (critério 13).
    console.log(
      `Q-02: ${(total / 1000).toFixed(2)} kB comprimidos — ` +
        ficheiros
          .map((ficheiro) => `${ficheiro.nome} ${(ficheiro.comprimido / 1000).toFixed(2)} kB`)
          .join(", "),
    );

    expect(
      total,
      `o pacote público está em ${(total / 1000).toFixed(2)} kB comprimidos. O limite do ` +
        "Q-02 são 100 kB; este tecto de vigilância é 82 kB (76 kB medidos antes da F3-05 " +
        "mais a estimativa de 79-81 kB dela, decisão do Tomás de 6 de novembro de 2026) " +
        "— acima disso entrou alguma coisa que não devia.",
    ).toBeLessThan(TECTO_DO_PACOTE_PUBLICO);
  });

  it("não há ficheiro-barril em src/components/ui/", () => {
    // A armadilha concreta de 8: com um `index.ts`, importar o `Chip` traz
    // a Folha, o Aviso e o Interruptor para o pacote público, e nenhum
    // deles aparece nesta página. Cada componente importa-se do seu
    // próprio ficheiro.
    const barris = ["index.ts", "index.tsx"].filter((nome) =>
      existsSync(join(RAIZ_FRONTEND, "src", "components", "ui", nome)),
    );

    expect(
      barris,
      "um ficheiro-barril em src/components/ui/ arrasta para o pacote público " +
        "componentes que esta página não usa (F3-02, secção 8)",
    ).toEqual([]);
  });

  it("nenhuma das bibliotecas recusadas pela secção 8 entrou no package.json", () => {
    const manifesto = JSON.parse(lerTexto(join(RAIZ_FRONTEND, "package.json"), "package.json")) as {
      dependencies?: Record<string, string>;
    };
    const instaladas = Object.keys(manifesto.dependencies ?? {});

    const recusadas = [
      "fuse.js",
      "match-sorter",
      "react-intersection-observer",
      "react-scrollspy",
      "dinero.js",
      "currency.js",
      "numeral",
      "@tanstack/react-query",
      "react-query",
      "swr",
      "zustand",
      "react-window",
      "react-router",
      "react-router-dom",
      "clsx",
      "cva",
      "class-variance-authority",
      "tailwind-merge",
    ];

    expect(
      instaladas.filter((nome) => recusadas.includes(nome)),
      "a secção 8 da F3-02 recusa cada uma destas por escrito. Uma dependência " +
        "nova precisa de uma linha de justificação no PR (regra 8 do CLAUDE.md) — " +
        "e, se for uma destas, de um ADR que reabra a decisão.",
    ).toEqual([]);
  });
});
