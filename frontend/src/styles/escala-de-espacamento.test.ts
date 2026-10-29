// @vitest-environment node
/**
 * Utilitários de espaçamento com passos que **não existem** nesta
 * configuração.
 *
 * O `tailwind.config.ts` **substitui** `theme.spacing` em vez de o estender,
 * e deixa lá os sete passos da especificação mais o zero: `0 1 2 3 4 6 8 12`.
 * O `cores-so-nos-tokens.test.ts` já prova que a substituição está feita —
 * mas prova-o sobre a **configuração**, e ninguém olhava para o **uso**.
 *
 * É essa a lacuna que este ficheiro fecha, e o modo de falha é o pior que o
 * Tailwind tem: **uma classe que não existe não dá erro, desaparece.**
 * Escrever `h-5` num componente compila, passa o lint, passa a verificação
 * de tipos, passa a bateria inteira — e no ecrã o elemento fica com a
 * altura que o conteúdo calhar ter. Não há nada em todo o projeto que fale
 * mais baixo do que isto.
 *
 * Esteve a um passo de acontecer: a secção 4.1 da `docs/ecras/F3-02.md`
 * escreveu «um SVG inline de 20 px», e 20 px seria `h-5 w-5` — duas classes
 * que esta configuração não gera. O código ficou em `h-6 w-6` e foi a
 * especificação que mudou (4.1, «24 px e não 20»); se tivesse sido ao
 * contrário, o ícone saía do tamanho que o SVG calhasse ter e nada nesta
 * bateria dizia nada.
 *
 * **Prova:** que nenhuma lista de classes em `src/**`, em `e2e/**` ou nos
 * dois HTML da raiz usa um passo fora da escala, em nenhum dos prefixos que
 * a consomem. São duas âncoras: `className`/`class` e `juntar(…)`, o único
 * ajudante de classes do projeto.
 *
 * **Deixa passar** cinco coisas, e ficam escritas:
 *
 *  - uma lista de classes montada fora das duas âncoras e só lá chegada por
 *    variável — `const DESATIVADO = "opacity-desativado cursor-not-allowed"`
 *    no `Botao.tsx` é uma, e `className={tamanho.classe}` na demonstração é
 *    outra. A varredura prende-se a âncoras de propósito: é isso que a
 *    impede de se queixar de prosa portuguesa que por acaso contenha `p-5`,
 *    e há uma dessas no nome de um teste do ficheiro ao lado;
 *  - um valor arbitrário (`h-[20px]`), que é legítimo e fura a escala de
 *    outra maneira. Quem o escrever responde na revisão;
 *  - um `@apply p-5` dentro de um `.css`. Hoje não há um único `@apply` no
 *    projeto; no dia em que houver, o domínio desta varredura passa a ter
 *    de incluir `src/styles/*.css` e uma terceira âncora;
 *  - uma chaveta ou um parêntesis **dentro de um literal** da expressão
 *    (`className={juntar("a", x ? "}" : "b")}`): a contagem que delimita a
 *    região não entra em modo de literal, e pára cedo. O efeito é cortar a
 *    região a meio — deixa passar, nunca inventa;
 *  - todas as outras escalas substituídas (`borderWidth`, `opacity`,
 *    `boxShadow`): o mesmo defeito, noutra família de classes.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "../testes/percorrer-arvore";

/** Os passos que o `tailwind.config.ts` deixa existir, mais o zero. */
const PASSOS = new Set(["0", "1", "2", "3", "4", "6", "8", "12"]);

/**
 * Os prefixos de classe que consomem `theme.spacing`.
 *
 * A lista não é de memória: saiu das **dezoito** entradas de
 * `node_modules/tailwindcss/stubs/config.full.js` que espalham
 * `theme('spacing')` na versão instalada (3.4.19) —
 * `borderSpacing`, `flexBasis`, `gap`, `height`, `inset`, `margin`,
 * `maxHeight`, `maxWidth`, `minHeight`, `minWidth`, `padding`,
 * `scrollMargin`, `scrollPadding`, `space`, `textIndent`, `translate`,
 * `size` e `width` — e dos nomes de utilitário que o `corePlugins.js` lhes
 * dá (`flexBasis` → `basis-`, `textIndent` → `indent-`, `borderSpacing` →
 * `border-spacing-`, `-x-` e `-y-`).
 *
 * Três delas faltavam à primeira versão deste ficheiro, e eram os três
 * buracos exactos: `basis-5`, `indent-5` e `border-spacing-5` passavam ao
 * lado como o `h-5` passaria.
 *
 * Por ordem **decrescente de comprimento** quando se procura, e isso não é
 * arrumação: `inset-x-5` começa por `inset-`, e se o prefixo curto ganhasse,
 * o valor lido era `x-5`, que não se parece com um número e passava por um
 * nome legítimo. A ordenação é feita abaixo, para esta lista poder ser lida
 * por famílias.
 */
const PREFIXOS = [
  "p",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "ps",
  "pe",
  "m",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "ms",
  "me",
  "gap",
  "gap-x",
  "gap-y",
  "space-x",
  "space-y",
  "w",
  "h",
  "size",
  "min-w",
  "min-h",
  "max-w",
  "max-h",
  "inset",
  "inset-x",
  "inset-y",
  "top",
  "right",
  "bottom",
  "left",
  "start",
  "end",
  "translate-x",
  "translate-y",
  "scroll-m",
  "scroll-mx",
  "scroll-my",
  "scroll-mt",
  "scroll-mb",
  "scroll-ml",
  "scroll-mr",
  "scroll-ms",
  "scroll-me",
  "scroll-p",
  "scroll-px",
  "scroll-py",
  "scroll-pt",
  "scroll-pb",
  "scroll-pl",
  "scroll-pr",
  "scroll-ps",
  "scroll-pe",
  "basis",
  "indent",
  "border-spacing",
  "border-spacing-x",
  "border-spacing-y",
].sort((a, b) => b.length - a.length);

/** Literais dentro de uma região: `"…"`, `'…'` e `` `…` ``. */
const LITERAL = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;

/** `className=` ou `class=`, que é onde uma lista de classes vive mesmo. */
const ATRIBUTO = /\bclass(?:Name)?\s*=\s*/g;

/**
 * A chamada do `juntar(…)`, a segunda âncora.
 *
 * É o único ajudante de classes do projeto, e é a forma em que os
 * componentes da F3-01 escrevem as suas: um `const BASE = juntar(…)` no topo
 * do ficheiro, longe de qualquer `className`. Sem esta âncora, nove literais
 * de classe ficavam de fora da varredura — e um deles vivia no `Botao`, que
 * é dos ficheiros mais mexidos do projeto.
 *
 * O `juntar` também junta identificadores (`Campo.tsx`, os descritores de
 * `aria-describedby`). Não faz mal: um identificador não começa por um
 * prefixo de espaçamento seguido de um número, que é a única coisa que esta
 * varredura acusa.
 */
const JUNTAR = /\bjuntar\s*\(/g;

/** Comentário de HTML, que o cortador de comentários de JavaScript não conhece. */
const COMENTARIO_DE_HTML = /<!--[\s\S]*?-->/g;

/**
 * O mesmo código, com os comentários trocados por espaços.
 *
 * Um comentário não chega ao ecrã, e a documentação deste projeto fala de
 * classes o tempo todo — este ficheiro explica-se citando `className="h-5"`.
 * Sem este passo, a varredura acusava a prosa que a descreve, que é a versão
 * fina do mesmo erro de isentar ficheiros por nome.
 *
 * Troca por espaços e mantém as mudanças de linha para o texto não encolher:
 * assim as posições continuam a ser as do ficheiro em disco.
 *
 * **Não é um analisador de JavaScript.** Conhece literais de aspa simples,
 * dupla e invertida, e escapes; não conhece expressões regulares, por isso
 * uma com aspas desemparelhadas lá dentro pode baralhá-lo. O erro que isso
 * produz é **deixar passar**, nunca inventar — e é por isso que nenhuma das
 * três varreduras afirma «está limpo» sozinha: a de `src/**` exige
 * encontrar classes conhecidas, e as outras duas afirmam, em voz alta, que
 * o que leram foi **zero** listas.
 *
 * Só serve JavaScript e TypeScript. Um HTML tem outra espécie de comentário
 * e passa pelo `COMENTARIO_DE_HTML`.
 */
function semComentarios(codigo: string): string {
  let limpo = "";
  let modo: "codigo" | "linha" | "bloco" | '"' | "'" | "`" = "codigo";

  for (let i = 0; i < codigo.length; i += 1) {
    const atual = codigo[i] ?? "";
    const seguinte = codigo[i + 1] ?? "";

    if (modo === "linha") {
      if (atual === "\n") modo = "codigo";
      limpo += atual === "\n" ? atual : " ";
      continue;
    }
    if (modo === "bloco") {
      if (atual === "*" && seguinte === "/") {
        modo = "codigo";
        limpo += "  ";
        i += 1;
        continue;
      }
      limpo += atual === "\n" ? atual : " ";
      continue;
    }
    if (modo !== "codigo") {
      if (atual === "\\") {
        limpo += atual + seguinte;
        i += 1;
        continue;
      }
      if (atual === modo) modo = "codigo";
      limpo += atual;
      continue;
    }

    if (atual === "/" && (seguinte === "/" || seguinte === "*")) {
      modo = seguinte === "/" ? "linha" : "bloco";
      limpo += "  ";
      i += 1;
      continue;
    }
    if (atual === '"' || atual === "'" || atual === "`") modo = atual;
    limpo += atual;
  }

  return limpo;
}

/**
 * Os literais de uma região equilibrada, a contar aberturas e fechos.
 *
 * Conta-se em vez de se apanhar com uma expressão regular porque as duas
 * regiões que interessam têm o seu próprio delimitador lá dentro: um
 * `className={juntar(…)}` tem chavetas, e um `juntar(a, b(c))` tem
 * parênteses.
 */
function literaisDaRegiao(codigo: string, inicio: number, abre: string, fecha: string): string[] {
  let profundidade = 0;
  let fim = inicio;
  for (; fim < codigo.length; fim += 1) {
    if (codigo[fim] === abre) profundidade += 1;
    if (codigo[fim] === fecha) {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
  }

  const regiao = codigo.slice(inicio, fim + 1);
  const literais: string[] = [];
  LITERAL.lastIndex = 0;
  for (let texto = LITERAL.exec(regiao); texto !== null; texto = LITERAL.exec(regiao)) {
    literais.push(texto[1] ?? texto[2] ?? texto[3] ?? "");
  }
  return literais;
}

/**
 * As listas de classes de um ficheiro, como texto.
 *
 * Duas âncoras e três formas: `className="…"` (um literal directo),
 * `className={…}` (uma expressão, de onde saem todos os literais lá dentro —
 * é a forma do ternário) e `juntar(…)` (a dos componentes, que escrevem as
 * suas classes numa constante longe do JSX).
 *
 * Um `className={juntar(…)}` cai nas duas âncoras e dá os mesmos literais
 * duas vezes. Não faz mal: quem chama trabalha com conjuntos.
 *
 * Com `html`, o que se corta são os comentários de HTML e o que fica são os
 * `class="…"` — a mesma âncora, outro comentário.
 */
function listasDeClasses(fonte: string, html = false): string[] {
  const codigo = html ? fonte.replace(COMENTARIO_DE_HTML, " ") : semComentarios(fonte);
  const listas: string[] = [];

  ATRIBUTO.lastIndex = 0;
  for (let achado = ATRIBUTO.exec(codigo); achado !== null; achado = ATRIBUTO.exec(codigo)) {
    const inicio = achado.index + achado[0].length;
    const abre = codigo[inicio];

    if (abre === '"' || abre === "'" || abre === "`") {
      const fim = codigo.indexOf(abre, inicio + 1);
      if (fim === -1) continue;
      listas.push(codigo.slice(inicio + 1, fim));
      continue;
    }

    if (abre === "{") listas.push(...literaisDaRegiao(codigo, inicio, "{", "}"));
  }

  JUNTAR.lastIndex = 0;
  for (let achado = JUNTAR.exec(codigo); achado !== null; achado = JUNTAR.exec(codigo)) {
    // O `(` faz parte do que a expressão apanhou: a região começa nele.
    listas.push(...literaisDaRegiao(codigo, achado.index + achado[0].length - 1, "(", ")"));
  }

  return listas;
}

/**
 * O passo fora da escala de uma classe, ou `null` se a classe está bem.
 *
 * Tira primeiro as variantes (`md:`, `hover:`, `placeholder:`) e o `!` de
 * importante, e aceita o sinal de negativo (`-mt-2`). Depois, três coisas
 * que **não** são passos da escala e passam todas: um valor arbitrário
 * (`h-[20px]`), uma fração (`w-1/2`) e um nome (`h-contagem`,
 * `min-h-toque`, `max-w-coluna`, `w-full`).
 */
function passoForaDaEscala(classe: string): string | null {
  let nome = classe.slice(classe.lastIndexOf(":") + 1).replace(/^!/, "");
  if (nome.startsWith("-")) nome = nome.slice(1);

  for (const prefixo of PREFIXOS) {
    if (!nome.startsWith(`${prefixo}-`)) continue;

    const valor = nome.slice(prefixo.length + 1);
    if (valor.startsWith("[") || valor.includes("/")) return null;
    if (!/^(?:\d+(?:\.\d+)?|px)$/.test(valor)) return null;
    return PASSOS.has(valor) ? null : classe;
  }

  return null;
}

type Varrimento = {
  /** `ficheiro: classe`, sem repetições. */
  achados: string[];
  /** Todas as classes vistas, para o guarda de «li mesmo alguma coisa». */
  classes: Set<string>;
  /** Quantas listas de classes foram encontradas, em todos os ficheiros. */
  listas: number;
  ficheiros: string[];
};

function varrer(raiz: string, extensoes: string[]): Varrimento {
  const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, raiz), { extensoes });
  const achados = new Set<string>();
  const classes = new Set<string>();
  let listas = 0;

  for (const ficheiro of ficheiros) {
    const relativo = caminhoRelativo(ficheiro);
    const texto = lerTexto(ficheiro, relativo);
    for (const lista of listasDeClasses(texto, relativo.endsWith(".html"))) {
      listas += 1;
      for (const classe of lista.split(/\s+/).filter((parte) => parte !== "")) {
        classes.add(classe);
        const fora = passoForaDaEscala(classe);
        if (fora !== null) achados.add(`${relativo}: ${fora}`);
      }
    }
  }

  return { achados: [...achados], classes, listas, ficheiros };
}

/**
 * A mensagem de uma varredura que não encontrou lista nenhuma de classes.
 *
 * É a regra 10 aplicada a esta varredura: sem ela, «não há passos fora da
 * escala em X» e «não li nada em X» davam o mesmo verde — que é exactamente
 * o defeito que o cabeçalho deste ficheiro denuncia, a acontecer dentro
 * dele.
 */
function porqueEstaVazia(onde: string): string {
  return (
    `hoje não há uma única lista de classes em ${onde}, e é isso que esta asserção ` +
    "diz — em vez de fingir que leu alguma. Se a vires vermelha, alguém escreveu a " +
    "primeira: é boa notícia, e o que se faz é trocar esta linha pelo guarda de " +
    "classes conhecidas que a varredura de `src/**` tem. Sem essa troca, a " +
    "varredura volta a dizer «limpo» sem ter lido nada."
  );
}

const MENSAGEM_DO_ACHADO =
  "uma classe fora da escala não dá erro nenhum: desaparece, e o elemento fica " +
  "com o tamanho que calhar. Usa um passo da escala (0 1 2 3 4 6 8 12), ou dá um " +
  "nome ao valor em tokens.css e no tailwind.config.ts.";

describe("os passos de espaçamento usados são os que existem", () => {
  it("src/** não usa nenhum passo fora da escala", () => {
    const { achados, classes, ficheiros } = varrer("src", [".ts", ".tsx"]);

    exigirSentinelas(
      ficheiros,
      ["src/pages/publico/Ementa.tsx", "src/components/ui/Chip.tsx"],
      "escala de espaçamento em src/**",
    );

    // Guarda da regra 10, em duas metades: a de cima diz que vi os
    // ficheiros, esta diz que vi as **classes** lá dentro. Sem ela, um
    // extractor partido devolve zero listas, zero violações e verde — "não
    // consegui procurar" com a cara de "não encontrei nada".
    //
    // As quatro classes são escolhidas uma por caminho de extracção:
    // `px-4` vem de um `className="…"`, `h-contagem` de um
    // `className={ternário}`, `max-w-coluna` de um `className={`template`}`
    // e `gap-2` do `juntar(…)` do Botão, que vive longe de qualquer JSX.
    for (const conhecida of ["px-4", "gap-2", "h-contagem", "max-w-coluna"]) {
      expect(
        classes.has(conhecida),
        `não encontrei a classe «${conhecida}», que está no código. Isto é uma ` +
          "falha de leitura dos literais de classe, não um código limpo.",
      ).toBe(true);
    }

    expect(achados, MENSAGEM_DO_ACHADO).toEqual([]);
  });

  it("e2e/** não tem listas de classes, e a asserção diz isso", () => {
    const { achados, listas, ficheiros } = varrer("e2e", [".ts"]);

    exigirSentinelas(
      ficheiros,
      ["e2e/ementa.spec.ts", "e2e/apoio/ementa.ts"],
      "escala de espaçamento em e2e/**",
    );

    expect(achados, MENSAGEM_DO_ACHADO).toEqual([]);
    expect(listas, porqueEstaVazia("e2e/**")).toBe(0);
  });

  it("os HTML da raiz também não — e também não têm listas nenhumas", () => {
    // O `content` do `tailwind.config.ts` inclui os dois HTML, por isso um
    // `class="p-5"` escrito lá tem exactamente o mesmo modo de falha: a
    // classe não é gerada e não há erro nenhum.
    const { achados, listas, ficheiros } = varrer(".", [".html"]);

    exigirSentinelas(ficheiros, ["index.html", "demonstracao.html"], "escala em HTML");

    expect(achados, MENSAGEM_DO_ACHADO).toEqual([]);
    expect(listas, porqueEstaVazia("index.html e demonstracao.html")).toBe(0);
  });
});

describe("autoteste do varrimento", () => {
  /**
   * Sem isto, um verde aqui não vale nada: um extractor que nunca
   * encontrasse nada daria o mesmo resultado que um código impecável. Estes
   * casos provam que a varredura **sabe falhar**, e dizem com que forma de
   * classe é que ela se engana.
   */
  /**
   * Os nomes das duas âncoras são **montados** em vez de escritos, e não é
   * esperteza: a varredura acima lê este ficheiro como lê os outros, e uma
   * fixtura com `className="h-5"` ou com a chamada do ajudante escritas por
   * extenso acusava o seu próprio exemplo. A alternativa seria isentar o
   * ficheiro inteiro, que abre um buraco do tamanho de um ficheiro.
   */
  const atributo = `class${"Name"}`;
  const atributoDeHtml = `cla${"ss"}`;
  const ajudante = `junt${"ar"}`;

  /** As classes fora da escala de um pedaço de código, sem repetições. */
  function foraDaEscalaEm(codigo: string, html = false): string[] {
    const encontradas = listasDeClasses(codigo, html)
      .flatMap((lista) => lista.split(/\s+/))
      .map((classe) => passoForaDaEscala(classe))
      .filter((classe) => classe !== null);
    return [...new Set(encontradas)].sort();
  }

  it("apanha um passo que não existe, e só esse", () => {
    const codigo = [
      `<div ${atributo}="h-5 w-7 p-4">`,
      `  <span ${atributo}={${ajudante}("mt-3", ativo && "gap-9")} />`,
      `  <i ${atributo}={\`min-h-toque \${largura}\`} />`,
      "</div>",
    ].join("\n");

    expect(foraDaEscalaEm(codigo)).toEqual(["gap-9", "h-5", "w-7"]);
  });

  it("apanha uma lista de classes escrita longe do JSX, pelo `juntar`", () => {
    // É a forma dos componentes da F3-01: um `const BASE = juntar(…)` no
    // topo do ficheiro. Sem esta âncora, nove literais de classe deste
    // projeto ficavam fora da varredura, um deles no `Botao`.
    const codigo = [
      `const BASE = ${ajudante}(`,
      '  "inline-flex items-center gap-2",',
      '  "min-h-toque basis-5 px-6 rounded-pequeno",',
      ");",
    ].join("\n");

    expect(foraDaEscalaEm(codigo)).toEqual(["basis-5"]);
  });

  it("apanha um `class=` de HTML, e não o que está dentro de um comentário", () => {
    // Os dois HTML da raiz entram no `content` do Tailwind, por isso um
    // `class="p-5"` lá dentro falha da mesma maneira silenciosa. O
    // comentário de HTML não é código e não conta — e o cortador de
    // comentários de JavaScript não o conhece, por isso há um próprio.
    const codigo = [
      "<!doctype html>",
      `<!-- Exemplo que não vale: <div ${atributoDeHtml}="p-7"> -->`,
      `<div ${atributoDeHtml}="p-5 indent-9">`,
      `  <span ${atributoDeHtml}="p-4">a</span>`,
      "</div>",
    ].join("\n");

    expect(foraDaEscalaEm(codigo, true)).toEqual(["indent-9", "p-5"]);
  });

  it.each([
    ["h-[20px]", "valor arbitrário"],
    ["w-1/2", "fração"],
    ["h-contagem", "nome"],
    ["min-h-toque", "nome com prefixo composto"],
    ["max-w-coluna", "nome com prefixo composto"],
    ["w-full", "palavra do Tailwind"],
    ["h-6", "passo da escala"],
    ["-mt-2", "passo da escala, negativo"],
    ["md:px-8", "passo da escala, com variante"],
    ["text-nota", "não é um utilitário de espaçamento"],
    ["flex-1", "o `1` do flex não vem da escala de espaçamento"],
    ["z-10", "o z-index tem escala própria"],
  ])("«%s» (%s) não é um achado", (classe) => {
    expect(passoForaDaEscala(classe)).toBeNull();
  });

  it.each([
    ["h-5", "o caso que a especificação quase trouxe"],
    ["p-5", "o exemplo escrito no teste das cores"],
    ["inset-x-5", "o prefixo longo tem de ganhar ao curto"],
    ["gap-x-10", "idem, na folga"],
    ["-mt-7", "negativo fora da escala"],
    ["scroll-pl-5", "o deslize também consome a escala"],
    ["p-px", "o passo `px` do Tailwind não existe aqui"],
    ["hover:h-9", "a variante não esconde o passo"],
    ["basis-5", "`flexBasis` deriva da escala"],
    ["indent-5", "`textIndent` também"],
    ["-indent-9", "e aceita negativos"],
    ["border-spacing-5", "`borderSpacing` também"],
    ["border-spacing-x-5", "e as duas variantes dela"],
  ])("«%s» (%s) é um achado", (classe) => {
    expect(passoForaDaEscala(classe)).toBe(classe);
  });

  it("um comentário que cita uma classe não é uma lista de classes", () => {
    const atributo = `class${"Name"}`;
    const codigo = [
      `// Exemplo de documentação: ${atributo}="h-5" não existe nesta escala.`,
      `/* E em bloco: ${atributo}="p-5" também não. */`,
      `<div ${atributo}="p-4" />`,
    ].join("\n");

    expect(listasDeClasses(codigo)).toEqual(["p-4"]);
  });

  it("o corte de comentários não mexe em aspas dentro de um literal", () => {
    const atributo = `class${"Name"}`;
    const codigo = `<div ${atributo}="p-4" title="https://exemplo.pt/a" />`;

    expect(listasDeClasses(codigo)).toEqual(["p-4"]);
  });

  it("a prosa de um teste não é uma lista de classes", () => {
    // O ficheiro ao lado tem um teste chamado "…para bg-red-500 e p-5
    // deixarem de existir". Isentar o ficheiro inteiro abria um buraco do
    // tamanho de um ficheiro; olhar só para `className`/`class` resolve-o
    // sem exceções nenhumas.
    const codigo = `it("substitui as escalas, para bg-red-500 e p-5 deixarem de existir", () => {});`;

    expect(listasDeClasses(codigo)).toEqual([]);
  });
});
