// @vitest-environment node
/**
 * F3-01 — nenhuma cor solta fora de `src/styles/tokens.css`.
 *
 * Porquê um teste Vitest e não uma regra de lint (decisão do Tomás, a
 * partir da proposta da ui-ux em `docs/ecras/F3-01.md`, secção 9.1):
 *
 *  - **Cobre `.css` e `.tsx` com a mesma regra.** O stylelint só vê `.css`
 *    e deixava passar `className="text-[#fff]"`; uma regra de ESLint só vê
 *    `.ts/.tsx` e deixava passar um `color: #fff` escrito em `global.css`.
 *    É o mesmo defeito, escrito em dois sítios.
 *  - **Zero dependências novas** (regra 8 do `CLAUDE.md`).
 *  - **Já há precedente no repositório**: `src/lib/seguranca/s13.test.ts` é
 *    este mesmo padrão de meta-teste sobre a árvore de ficheiros.
 *  - Pode afirmar coisas que nenhum linter afirma: que o
 *    `tailwind.config.ts` só tem referências, que essas referências apontam
 *    para variáveis que existem, e que a paleta é a da especificação.
 *
 * Três asserções deste ficheiro valem tanto como a principal, e nenhuma
 * delas é opcional:
 *
 *  1. **O guarda da regra 10.** Uma varredura que devolva zero ficheiros
 *     encontra zero violações e passa. A mensagem de erro de "não consegui
 *     percorrer a árvore" é deliberadamente diferente da de "encontrei
 *     cores soltas" — ver `src/testes/percorrer-arvore.ts`.
 *  2. **O autoteste do detetor.** As expressões regulares são aplicadas a
 *     casos conhecidos e têm de os marcar. Uma expressão partida passa a
 *     fazer este teste falhar, em vez de o fazer passar com zero achados.
 *  3. **Toda a `var(--x)` do `tailwind.config.ts` existe no `tokens.css`.**
 *     Um nome mal escrito não dá erro nenhum: a cor não se aplica, herda-se
 *     outra, e o ecrã fica subtilmente errado. Compilar não chega.
 *
 * E uma quarta, que faz da especificação a fonte de verdade do hex: a
 * paleta do `tokens.css` é comparada com a tabela Design de
 * `docs/ESPECIFICACAO.md`.
 *
 * Falso positivo conhecido e aceite: uma âncora cujo fragmento seja só
 * letras hexadecimais (`href="#fade"`). Nenhum `slug` de categoria do bar é
 * assim; se um dia for, muda-se o `slug`, não o teste.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import configuracaoTailwind from "../../tailwind.config";
import { COMPONENTES_DA_F3_01 } from "../testes/componentes";
import { FICHEIROS_DA_F3_05 } from "../testes/ecras";
import {
  RAIZ_FRONTEND,
  RAIZ_REPOSITORIO,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "../testes/percorrer-arvore";

/** Ficheiro onde os valores podem viver. É o único. */
const FICHEIRO_DOS_TOKENS = "src/styles/tokens.css";

/**
 * Quem está isento da varredura, e porquê. Devolve a razão, ou `null` se o
 * ficheiro é para varrer.
 *
 * Há exactamente duas isenções, e a diferença entre elas é a que interessa:
 *
 *  - **`src/styles/tokens.css`** é código que vai para produção, e é o
 *    único ficheiro de produção isento — é essa a regra inteira desta
 *    tarefa.
 *  - **os ficheiros de teste e os auxiliares de `src/testes/`** escrevem
 *    cores à mão porque as cores *são* o que eles verificam: o autoteste do
 *    detetor precisa de um `#fff` para o detetor ter o que apanhar, e o
 *    autoteste da fórmula de contraste precisa dos hexes da tabela de
 *    `docs/ESPECIFICACAO.md` escritos à mão — se os lesse do `tokens.css`,
 *    deixava de ser uma verificação independente e passava a comparar o
 *    ficheiro consigo próprio. Nada disto entra em `dist/`: o `vite build`
 *    só segue o grafo a partir de `index.html`, e `src/build-de-producao.test.ts`
 *    verifica o que lá chega.
 */
function razaoDaIsencao(relativo: string): string | null {
  if (relativo === FICHEIRO_DOS_TOKENS) return "é a única lista de hexes do projeto";
  if (/\.(test|spec)\.tsx?$/.test(relativo)) {
    return "ficheiro de teste: as cores escritas à mão são os casos de prova";
  }
  if (relativo.startsWith("src/testes/")) return "auxiliar de teste, pela mesma razão";
  // F3-05, correção do Tomás, 6 de novembro de 2026: `e2e/apoio/galeria.ts`
  // gera uma imagem a sério num `<canvas>` (`contexto.fillStyle = "#..."`,
  // para o gesto de deslizar ter uma foto com forma real) — é apoio de
  // teste, nunca entra em `dist/`, pela mesma razão que `src/testes/` já
  // está isento. Isto só apareceu agora porque a varredura exigia os
  // ficheiros-sentinela da F3-05, que passaram a existir.
  if (relativo.startsWith("e2e/apoio/")) return "apoio de teste (e2e), pela mesma razão";
  return null;
}

/**
 * As cores com nome do CSS. Sem isto, quem não pode escrever `#fff`
 * escreve `white` e o teste nunca dá por nada. `transparent`,
 * `currentColor` e `inherit` **não** estão aqui: são palavras-chave que o
 * `tailwind.config.ts` é obrigado a repor (ver `docs/ecras/F3-01.md`, 3).
 */
const CORES_COM_NOME = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

const PREFIXOS_DE_UTILIDADE_DE_COR =
  "bg|text|border|outline|ring|fill|stroke|decoration|from|via|to|accent|caret|divide|placeholder|shadow";

/** Uma cor escrita à mão, com o sítio onde está e a razão. */
export type CorSolta = { linha: number; regra: string; excerto: string };

/**
 * O detetor. Devolve todas as cores escritas à mão em `texto`.
 *
 * `extensao` muda o que conta como "posição de valor": num `.css` uma cor
 * com nome aparece depois de `:`; num `.tsx` aparece dentro de um valor
 * arbitrário do Tailwind (`text-[white]`), a seguir a um prefixo de
 * utilidade (`bg-white`), ou como uma cadeia inteira (`const c = "white"`).
 */
export function detetarCoresSoltas(texto: string, extensao: ".css" | ".ts" | ".tsx"): CorSolta[] {
  const achados: CorSolta[] = [];
  const linhas = texto.split("\n");

  const marcar = (indiceDaLinha: number, regra: string, excerto: string): void => {
    achados.push({ linha: indiceDaLinha + 1, regra, excerto });
  };

  linhas.forEach((linha, indice) => {
    // 1. Hex de 3, 4, 6 ou 8 dígitos.
    for (const achado of linha.matchAll(
      /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g,
    )) {
      marcar(indice, "hex", achado[0]);
    }

    // 2. Funções de cor. `color-mix` incluído: é a forma de derivar uma
    //    cor sem repetir o hex, e por isso só pode viver no tokens.css.
    for (const achado of linha.matchAll(
      /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix|device-cmyk)\s*\(/g,
    )) {
      marcar(indice, "função de cor", achado[0].trim());
    }

    // 3. Cores com nome.
    if (extensao === ".css") {
      // Em posição de valor: tudo o que está entre `:` e `;`/`}`.
      for (const declaracao of linha.matchAll(/:\s*([^;{}]+)/g)) {
        const valor = declaracao[1];
        if (valor === undefined) continue;
        for (const palavra of valor.split(/[^a-zA-Z-]+/)) {
          if (CORES_COM_NOME.has(palavra.toLowerCase())) {
            marcar(indice, "cor com nome", palavra);
          }
        }
      }
    }

    // Valor arbitrário do Tailwind: `text-[white]`, `bg-[#fff]`.
    for (const arbitrario of linha.matchAll(/\[([^\]\s]+)\]/g)) {
      const conteudo = arbitrario[1];
      if (conteudo === undefined) continue;
      for (const palavra of conteudo.split(/[^a-zA-Z-]+/)) {
        if (CORES_COM_NOME.has(palavra.toLowerCase())) {
          marcar(indice, "cor com nome (valor arbitrário)", arbitrario[0]);
        }
      }
    }

    // Utilidade do Tailwind com cor com nome: `bg-white`, `text-black`.
    for (const utilidade of linha.matchAll(
      new RegExp(`\\b(?:${PREFIXOS_DE_UTILIDADE_DE_COR})-([a-z]+)\\b`, "g"),
    )) {
      const nome = utilidade[1];
      if (nome !== undefined && CORES_COM_NOME.has(nome)) {
        marcar(indice, "cor com nome (utilidade)", utilidade[0]);
      }
    }

    if (extensao !== ".css") {
      // Uma cadeia que é só uma cor com nome: `const cor = "white";`.
      for (const cadeia of linha.matchAll(/["'`]([a-zA-Z]+)["'`]/g)) {
        const nome = cadeia[1];
        if (nome !== undefined && CORES_COM_NOME.has(nome.toLowerCase())) {
          marcar(indice, "cor com nome (cadeia)", cadeia[0]);
        }
      }
    }
  });

  return achados;
}

function extensaoDe(caminho: string): ".css" | ".ts" | ".tsx" {
  if (caminho.endsWith(".css")) return ".css";
  if (caminho.endsWith(".tsx")) return ".tsx";
  return ".ts";
}

function varrerFrontend(): string[] {
  return listarFicheiros(RAIZ_FRONTEND, {
    extensoes: [".css", ".ts", ".tsx"],
  }).filter((ficheiro) => !caminhoRelativo(ficheiro).startsWith("src/lib/api/"));
}

const SENTINELAS = [
  FICHEIRO_DOS_TOKENS,
  "src/App.tsx",
  "tailwind.config.ts",
  // F3-05: sem isto, a chegada da galeria (grelha, Visualizador, Folha de
  // envio) passava ao lado desta varredura em silêncio — "não encontrei
  // cores soltas" a dar o mesmo resultado que "não procurei lá" (regra 10).
  ...FICHEIROS_DA_F3_05,
];

describe("autoteste do detetor de cores", () => {
  it("marca os casos conhecidos — uma expressão partida faz este teste falhar", () => {
    // Os três casos que a especificação nomeia (docs/ecras/F3-01.md, 9.1),
    // mais os dois que o Tomás acrescentou: a cor com nome em CSS e a cor
    // com nome como cadeia.
    expect(detetarCoresSoltas('const c = "#fff";', ".ts")).toHaveLength(1);
    expect(detetarCoresSoltas("color: rgb(0 0 0);", ".css")).toHaveLength(1);
    expect(detetarCoresSoltas('className="text-[white]"', ".tsx")).toHaveLength(1);
    expect(detetarCoresSoltas("border: 1px solid white;", ".css")).toHaveLength(1);
    expect(detetarCoresSoltas('const cor = "white";', ".ts")).toHaveLength(1);
    expect(detetarCoresSoltas('className="bg-white"', ".tsx")).toHaveLength(1);
    expect(detetarCoresSoltas("background: #F5E6D3;", ".css")).toHaveLength(1);
    expect(detetarCoresSoltas("--x: color-mix(in srgb, #fff 50%, transparent);", ".css")).toEqual([
      expect.objectContaining({ regra: "hex", excerto: "#fff" }),
      expect.objectContaining({ regra: "função de cor", excerto: "color-mix(" }),
    ]);
    expect(detetarCoresSoltas("color: hsl(0 0% 100%);", ".css")).toHaveLength(1);
    expect(detetarCoresSoltas("color: oklch(0.7 0.1 60);", ".css")).toHaveLength(1);
  });

  it("não marca o que é legítimo", () => {
    expect(detetarCoresSoltas("color: var(--cor-texto);", ".css")).toEqual([]);
    expect(detetarCoresSoltas('className="bg-acao text-sobre-acao"', ".tsx")).toEqual([]);
    expect(detetarCoresSoltas('<a href="#cafes">Cafés</a>', ".tsx")).toEqual([]);
    expect(detetarCoresSoltas("border-color: transparent;", ".css")).toEqual([]);
    expect(detetarCoresSoltas("const angulo = Math.tan(x);", ".ts")).toEqual([]);
    expect(detetarCoresSoltas("// o fundo é bordô, o texto é creme", ".ts")).toEqual([]);
  });
});

describe("autoteste do varrimento (guarda da regra 10)", () => {
  it("encontra ficheiros em subpastas e atrás de uma ligação simbólica, e ignora node_modules", () => {
    const raiz = mkdtempSync(join(tmpdir(), "cores-varrimento-"));
    const alvoDaLigacao = mkdtempSync(join(tmpdir(), "cores-varrimento-alvo-"));
    try {
      mkdirSync(join(raiz, "src", "styles"), { recursive: true });
      mkdirSync(join(raiz, "node_modules", "qualquer"), { recursive: true });
      writeFileSync(join(raiz, "src", "styles", "a.css"), "color: var(--x);\n");
      writeFileSync(join(raiz, "src", "B.TSX"), "export const b = 1;\n");
      writeFileSync(join(raiz, "node_modules", "qualquer", "c.css"), "color: #fff;\n");
      writeFileSync(join(alvoDaLigacao, "d.ts"), "export const d = 1;\n");
      symlinkSync(alvoDaLigacao, join(raiz, "atalho"), "dir");

      const encontrados = listarFicheiros(raiz, { extensoes: [".css", ".ts", ".tsx"] }).map(
        (ficheiro) => caminhoRelativo(ficheiro, raiz),
      );

      expect(encontrados.sort()).toEqual(["atalho/d.ts", "src/B.TSX", "src/styles/a.css"]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
      rmSync(alvoDaLigacao, { recursive: true, force: true });
    }
  });

  it("falha com «não consegui percorrer a árvore» quando a lista vem vazia", () => {
    expect(() => exigirSentinelas([], SENTINELAS, "autoteste")).toThrow(
      /não consegui percorrer a árvore/i,
    );
    // E a mensagem não pode ser confundida com a do achado.
    expect(() => exigirSentinelas([], SENTINELAS, "autoteste")).not.toThrow(/cores soltas/i);
  });

  it("falha quando falta um ficheiro-sentinela, e diz qual", () => {
    const quaseTudo = [
      join(RAIZ_FRONTEND, "src/App.tsx"),
      join(RAIZ_FRONTEND, "tailwind.config.ts"),
    ];

    expect(() => exigirSentinelas(quaseTudo, SENTINELAS, "autoteste")).toThrow(
      /faltam ficheiros-sentinela[\s\S]*src\/styles\/tokens\.css/i,
    );
  });

  it("deixa passar quando as sentinelas lá estão", () => {
    const todos = SENTINELAS.map((sentinela) => join(RAIZ_FRONTEND, sentinela));

    expect(() => exigirSentinelas(todos, SENTINELAS, "autoteste")).not.toThrow();
  });
});

describe("nenhuma cor solta fora dos tokens", () => {
  it("varre o frontend inteiro e não encontra hexes, funções de cor nem cores com nome", () => {
    const ficheiros = varrerFrontend();

    exigirSentinelas(ficheiros, SENTINELAS, "cores soltas");

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      if (razaoDaIsencao(relativo) !== null) continue;

      const texto = lerTexto(ficheiro, relativo);
      for (const achado of detetarCoresSoltas(texto, extensaoDe(relativo))) {
        violacoes.push(`${relativo}:${achado.linha}  ${achado.regra}: ${achado.excerto}`);
      }
    }

    expect(
      violacoes,
      "As cores vivem em src/styles/tokens.css e em mais lado nenhum. " +
        "Usa um papel (bg-acao, text-texto, border-contorno) ou acrescenta um token.",
    ).toEqual([]);
  });

  it("o tokens.css é o único ficheiro de produção isento", () => {
    // A isenção que interessa vigiar é esta: a dos testes não tem efeito
    // nenhum em produção, mas um segundo ficheiro de produção isento
    // desfazia a regra toda em silêncio.
    const ficheiros = varrerFrontend().map((ficheiro) => caminhoRelativo(ficheiro));

    expect(
      ficheiros,
      `${FICHEIRO_DOS_TOKENS} não existe (ainda): é lá que vivem as dez cores`,
    ).toContain(FICHEIRO_DOS_TOKENS);

    const isentosDeProducao = ficheiros
      .filter((relativo) => razaoDaIsencao(relativo) !== null)
      .filter((relativo) => !/\.(test|spec)\.tsx?$/.test(relativo))
      .filter((relativo) => !relativo.startsWith("src/testes/"))
      // `e2e/apoio/**` é apoio de teste como `src/testes/`, nunca produção
      // (F3-05, correção do Tomás, 6 de novembro de 2026): sem este filtro,
      // a isenção nova de `razaoDaIsencao` fazia este teste falhar por um
      // ficheiro que nunca chega a `dist/`.
      .filter((relativo) => !relativo.startsWith("e2e/apoio/"));

    expect(isentosDeProducao).toEqual([FICHEIRO_DOS_TOKENS]);
  });
});

/** Caminha o `theme` e devolve cada folha de texto com o caminho até ela. */
function folhasDeTexto(
  valor: unknown,
  caminho: string[] = [],
): { caminho: string; valor: string }[] {
  if (typeof valor === "string") return [{ caminho: caminho.join("."), valor }];
  if (Array.isArray(valor)) {
    return valor.flatMap((item, indice) => folhasDeTexto(item, [...caminho, String(indice)]));
  }
  if (typeof valor === "object" && valor !== null) {
    return Object.entries(valor).flatMap(([chave, item]) =>
      folhasDeTexto(item, [...caminho, chave]),
    );
  }
  return [];
}

/**
 * Literais que podem aparecer no `theme` sem serem `var(--…)`.
 *
 * `transparent`, `currentColor` e `inherit` são obrigatórios: ao
 * substituir `theme.colors` (em vez de o estender), quem não os repõe
 * perde `border-transparent`. `0px` e `none` são o degrau zero de uma
 * escala, não um valor de design.
 */
const LITERAIS_PERMITIDOS = new Set(["transparent", "currentColor", "inherit", "0px", "none"]);

describe("tailwind.config.ts só tem nomes que apontam para os tokens", () => {
  it("toda a folha do theme é var(--…), um literal permitido, ou está em screens", () => {
    const tema = (configuracaoTailwind as { theme?: unknown }).theme;
    expect(tema, "o tailwind.config.ts tem de ter um theme").toBeTypeOf("object");

    const literaisProibidos = folhasDeTexto(tema)
      // `screens` é a única categoria com literais, e a razão está escrita:
      // `@media (min-width: var(--x))` não é CSS válido.
      .filter((folha) => !folha.caminho.startsWith("screens."))
      .filter((folha) => !folha.caminho.startsWith("content."))
      .filter((folha) => !folha.valor.startsWith("var(--"))
      .filter((folha) => !LITERAIS_PERMITIDOS.has(folha.valor))
      .map((folha) => `theme.${folha.caminho} = ${JSON.stringify(folha.valor)}`);

    expect(
      literaisProibidos,
      "Os valores vivem no tokens.css; o tailwind.config.ts só tem o índice. " +
        "Um valor literal aqui (480px, 12px, um hex) passa a token com um nome " +
        "(--largura-folha, --raio-cartao) e o config aponta para ele.",
    ).toEqual([]);
  });

  it("substitui as escalas em vez de as estender, para bg-red-500 e p-5 deixarem de existir", () => {
    const tema = (configuracaoTailwind as { theme?: Record<string, unknown> }).theme ?? {};

    for (const categoria of [
      "colors",
      "fontSize",
      "spacing",
      "borderRadius",
      "fontFamily",
      "fontWeight",
      "boxShadow",
    ]) {
      expect(
        tema[categoria],
        `theme.${categoria} tem de ser substituído (theme.${categoria}), não estendido ` +
          "(theme.extend." +
          categoria +
          "): é isso que faz a classe fora da paleta não ser gerada e o erro aparecer no ecrã.",
      ).toBeTypeOf("object");
    }

    const extensao = (tema["extend"] ?? {}) as Record<string, unknown>;
    for (const categoria of ["colors", "fontSize", "spacing", "borderRadius"]) {
      expect(
        extensao[categoria],
        `theme.extend.${categoria} faria a paleta do Tailwind voltar`,
      ).toBeUndefined();
    }
  });

  it("repõe os dois fallbacks literais do Tailwind (ringColor e ringOffsetColor)", () => {
    // `corePlugins.js` escreve "#3b82f6" e "#fff" como fallback quando
    // `ringColor.DEFAULT` e `ringOffsetColor.DEFAULT` não existem. Nós
    // usamos `outline`, não `ring-*`, mas os dois ficam substituídos na
    // mesma, para a hipótese não existir.
    const tema = (configuracaoTailwind as { theme?: Record<string, unknown> }).theme ?? {};
    const corDoAnel = (tema["ringColor"] ?? {}) as Record<string, unknown>;
    const corDoAfastamento = (tema["ringOffsetColor"] ?? {}) as Record<string, unknown>;

    expect(corDoAnel["DEFAULT"]).toMatch(/^var\(--/);
    expect(corDoAfastamento["DEFAULT"]).toMatch(/^var\(--/);
  });
});

/** Nomes de variáveis declaradas num ficheiro CSS (`--x: valor;`). */
function variaveisDeclaradas(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((achado) => achado[1] ?? ""));
}

/** Nomes de variáveis usadas num texto (`var(--x)`). */
function variaveisUsadas(texto: string): { nome: string; linha: number }[] {
  const usos: { nome: string; linha: number }[] = [];
  texto.split("\n").forEach((linha, indice) => {
    for (const achado of linha.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const nome = achado[1];
      if (nome !== undefined) usos.push({ nome, linha: indice + 1 });
    }
  });
  return usos;
}

describe("toda a var(--x) aponta para um token que existe", () => {
  it("as variáveis do tailwind.config.ts estão declaradas no tokens.css", () => {
    // É a asserção que mais vale de todo o ficheiro: um nome mal escrito
    // não dá erro nenhum — a cor não se aplica, herda-se outra, e o ecrã
    // fica subtilmente errado. O build passa na mesma.
    const tokens = lerTexto(join(RAIZ_FRONTEND, FICHEIRO_DOS_TOKENS), FICHEIRO_DOS_TOKENS);
    const declaradas = variaveisDeclaradas(tokens);

    const usadas = folhasDeTexto((configuracaoTailwind as { theme?: unknown }).theme).flatMap(
      (folha) =>
        variaveisUsadas(folha.valor).map((uso) => ({
          nome: uso.nome,
          onde: `theme.${folha.caminho}`,
        })),
    );

    expect(usadas.length, "o tailwind.config.ts tem de apontar para tokens").toBeGreaterThan(20);

    const emFalta = usadas
      .filter((uso) => !declaradas.has(uso.nome))
      .map((uso) => `${uso.onde} usa ${uso.nome}, que não existe em ${FICHEIRO_DOS_TOKENS}`);

    expect(emFalta).toEqual([]);
  });

  it("as variáveis usadas no CSS e nos componentes estão declaradas algures", () => {
    const ficheiros = varrerFrontend();
    exigirSentinelas(ficheiros, SENTINELAS, "variáveis por declarar");

    const declaradasEmTodoOLado = new Set<string>();
    for (const ficheiro of ficheiros) {
      for (const nome of variaveisDeclaradas(lerTexto(ficheiro, caminhoRelativo(ficheiro)))) {
        declaradasEmTodoOLado.add(nome);
      }
    }

    const emFalta: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      if (relativo === "src/styles/cores-so-nos-tokens.test.ts") continue;
      for (const uso of variaveisUsadas(lerTexto(ficheiro, relativo))) {
        // `--tw-*` é do próprio Tailwind, declarado no CSS que ele gera.
        if (uso.nome.startsWith("--tw-")) continue;
        if (!declaradasEmTodoOLado.has(uso.nome)) {
          emFalta.push(`${relativo}:${uso.linha} usa ${uso.nome}, que não está declarado`);
        }
      }
    }

    expect(emFalta).toEqual([]);
  });
});

/**
 * Lê a tabela Design de `docs/ESPECIFICACAO.md` e devolve, por nome de
 * token, o hex em minúsculas.
 *
 * As duas últimas linhas da tabela têm dois tokens cada
 * (`sucesso / erro (escuro)`), por isso o nome é partido no `/` e o
 * sufixo entre parênteses é colado a cada metade.
 */
function paletaDaEspecificacao(): Map<string, string> {
  const caminho = join(RAIZ_REPOSITORIO, "docs", "ESPECIFICACAO.md");
  const texto = lerTexto(caminho, "a especificação (docs/ESPECIFICACAO.md)");

  const seccao = /\n## Design\n([\s\S]*?)(?:\n## |$)/.exec(texto);
  if (seccao?.[1] === undefined) {
    throw new Error(
      "Não consegui ler a especificação: não encontrei a secção «## Design» em " +
        "docs/ESPECIFICACAO.md. Isto é uma falha de leitura, não uma paleta que não corresponde.",
    );
  }

  const paleta = new Map<string, string>();
  for (const linha of seccao[1].split("\n")) {
    const celulas = linha.split("|").map((celula) => celula.trim());
    if (celulas.length < 4) continue;
    const etiqueta = celulas[1];
    const valores = celulas[2];
    if (etiqueta === undefined || valores === undefined) continue;
    if (etiqueta === "Token" || etiqueta.startsWith("---")) continue;

    const hexes = [...valores.matchAll(/#([0-9a-fA-F]{6})/g)].map((achado) =>
      achado[0].toLowerCase(),
    );
    if (hexes.length === 0) continue;

    const sufixo = /\(([a-zç]+)\)/i.exec(etiqueta)?.[1] ?? "";
    const nomes = etiqueta
      .replace(/\([^)]*\)/g, "")
      .split("/")
      .map((nome) => nome.trim())
      .filter((nome) => nome.length > 0)
      .map((nome) => (sufixo ? `${nome}-${sufixo}` : nome));

    if (nomes.length !== hexes.length) {
      throw new Error(
        `Não consegui ler a especificação: a linha «${etiqueta}» da tabela Design tem ` +
          `${nomes.length} nomes para ${hexes.length} hexes.`,
      );
    }
    nomes.forEach((nome, indice) => paleta.set(nome, hexes[indice] ?? ""));
  }

  if (paleta.size !== 10) {
    throw new Error(
      `Não consegui ler a especificação: esperava 10 cores na tabela Design e li ${paleta.size}. ` +
        "Isto é uma falha de leitura, não uma paleta que não corresponde.",
    );
  }
  return paleta;
}

describe("a paleta do tokens.css é a da especificação", () => {
  it("cada --cor-<nome> tem o hex que docs/ESPECIFICACAO.md manda", () => {
    const paleta = paletaDaEspecificacao();
    const tokens = lerTexto(join(RAIZ_FRONTEND, FICHEIRO_DOS_TOKENS), FICHEIRO_DOS_TOKENS);

    const divergencias: string[] = [];
    for (const [nome, hexEsperado] of paleta) {
      const declaracao = new RegExp(`--cor-${nome}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(tokens);
      if (declaracao?.[1] === undefined) {
        divergencias.push(`--cor-${nome} não está declarado em ${FICHEIRO_DOS_TOKENS}`);
        continue;
      }
      if (declaracao[1].toLowerCase() !== hexEsperado) {
        divergencias.push(
          `--cor-${nome} é ${declaracao[1].toLowerCase()} e a especificação diz ${hexEsperado}`,
        );
      }
    }

    expect(divergencias).toEqual([]);
  });

  it("o tokens.css não tem mais nenhum hex além dos dez da especificação", () => {
    const paleta = paletaDaEspecificacao();
    const tokens = lerTexto(join(RAIZ_FRONTEND, FICHEIRO_DOS_TOKENS), FICHEIRO_DOS_TOKENS);

    const hexesNoFicheiro = new Set(
      [
        ...tokens.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g),
      ].map((achado) => achado[0].toLowerCase()),
    );

    expect(
      [...hexesNoFicheiro].sort(),
      "Uma cor nova no tokens.css é uma cor nova na paleta: entra primeiro na " +
        "tabela Design de docs/ESPECIFICACAO.md. Cores derivadas fazem-se com " +
        "color-mix a partir de um token, sem repetir o hex.",
    ).toEqual([...new Set(paleta.values())].sort());
  });
});

describe("as cores com nome do tokens.css", () => {
  it("a única cor com nome no tokens.css é white, dentro de --cor-papel", () => {
    // R-01 / ADR 0023: o papel é o creme a 25 % com branco, e o branco não é
    // uma cor da paleta — é o fim da escala. Fica escrito com o nome do CSS
    // nessa linha e em mais nenhuma, para não abrir a porta a uma décima
    // primeira cor sem passar pela tabela Design.
    const tokens = lerTexto(join(RAIZ_FRONTEND, FICHEIRO_DOS_TOKENS), FICHEIRO_DOS_TOKENS);
    const linhas = tokens.split("\n");

    const comNome = detetarCoresSoltas(tokens, ".css")
      .filter((achado) => achado.regra.startsWith("cor com nome"))
      .map((achado) => ({
        cor: achado.excerto,
        noPapel: /^\s*--cor-papel\s*:/.test(linhas[achado.linha - 1] ?? ""),
      }));

    expect(comNome).toEqual([{ cor: "white", noPapel: true }]);
  });
});

/** Os dez nomes da paleta, como aparecem no Tailwind (`bg-dourado-latao`). */
const NOMES_CRUS_DA_PALETA = [
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

/**
 * Onde é que a interface vive. `src/pages` ainda não existe — chega na F3-02,
 * com a ementa dentro de cartões creme, que é precisamente onde um
 * `className="bg-dourado-latao"` faria o estrago que esta regra evita.
 *
 * Está aqui desde já porque `listarFicheiros` devolve `[]` para uma pasta que
 * não existe, **em silêncio**: sem a entrada na lista, a varredura passaria a
 * cobrir metade da interface no dia em que a outra metade nascesse, e ninguém
 * dava por isso. A guarda em `ficheirosDaInterface` fecha o outro lado — se a
 * pasta existe e não traz ficheiros, isso é "não consegui procurar".
 */
const PASTAS_DA_INTERFACE = ["src/components", "src/pages"];

function ficheirosDaInterface(): string[] {
  const ficheiros = PASTAS_DA_INTERFACE.flatMap((pasta) =>
    listarFicheiros(join(RAIZ_FRONTEND, ...pasta.split("/")), {
      extensoes: [".tsx", ".ts", ".css"],
    }),
  );

  for (const pasta of PASTAS_DA_INTERFACE) {
    if (!existsSync(join(RAIZ_FRONTEND, ...pasta.split("/")))) continue;
    const dessaPasta = ficheiros.filter((ficheiro) =>
      caminhoRelativo(ficheiro).startsWith(`${pasta}/`),
    );
    if (dessaPasta.length === 0) {
      throw new Error(
        `Não consegui percorrer a árvore (nomes da paleta): ${pasta} existe em disco mas a ` +
          "varredura não trouxe nenhum ficheiro de lá. Isto não quer dizer que está limpo — " +
          "quer dizer que não procurei onde devia.",
      );
    }
  }

  return ficheiros;
}

describe("os componentes pegam pelos papéis, nunca pela paleta", () => {
  it("nenhum componente nem página escreve um nome da paleta", () => {
    // É este mecanismo que torna o dourado sobre creme impossível por
    // distração: o componente escreve `bg-acao`, `text-foco`,
    // `border-contorno`, e a classe `.superficie-creme` troca o que essas
    // palavras significam. Escrever `dourado-latao` à mão é a única forma
    // de furar — e é uma linha que salta num diff, ou aqui.
    //
    // `src/demonstracao/**` fica de fora: a secção "Cores" da página de
    // demonstração mostra os dez tokens pelo nome, e é suposto.
    const ficheiros = ficheirosDaInterface();

    exigirSentinelas(ficheiros, COMPONENTES_DA_F3_01, "nomes da paleta nos componentes");

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      if (relativo.endsWith(".test.tsx") || relativo.endsWith(".test.ts")) continue;
      const texto = lerTexto(ficheiro, relativo);
      texto.split("\n").forEach((linha, indice) => {
        for (const nome of NOMES_CRUS_DA_PALETA) {
          if (linha.includes(nome)) {
            violacoes.push(`${relativo}:${indice + 1} escreve «${nome}» em vez de um papel`);
          }
        }
      });
    }

    expect(violacoes).toEqual([]);
  });
});
