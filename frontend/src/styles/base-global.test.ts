// @vitest-environment node
/**
 * F3-01 — as promessas do `src/styles/global.css` (secção 5 de
 * `docs/ecras/F3-01.md`).
 *
 * Duas delas são a rede por baixo de toda a tarefa:
 *
 *  - **`:focus-visible` global.** Nenhum componente tem de se lembrar do
 *    anel de foco, porque a camada base já o desenha. É o que faz o Q-04
 *    («foco visível em todos os controlos») ser verdade por omissão em vez
 *    de ser verdade sete vezes seguidas por acaso. Usa `outline` e não o
 *    `ring-*` do Tailwind: acompanha o `border-radius`, não precisa das
 *    variáveis `--tw-ring-*` e não traz um `#fff` por omissão.
 *  - **`color-scheme: dark`.** Sem isto o Chrome pinta o preenchimento
 *    automático com a caixa azul-clara por cima do bordô, e no
 *    `/gestao/entrar` o texto da password deixa de se ler. É um defeito que
 *    só aparece a quem tem a password guardada — provavelmente só o dono.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "../testes/percorrer-arvore";
import { blocosDosTokens } from "../testes/tokens";

function global(): string {
  return lerTexto(
    join(RAIZ_FRONTEND, "src", "styles", "global.css"),
    "src/styles/global.css",
  ).replace(/\s+/g, " ");
}

describe("src/styles/global.css", () => {
  it("importa os tokens e as fontes antes do Tailwind", () => {
    const texto = lerTexto(join(RAIZ_FRONTEND, "src", "styles", "global.css"), "global.css");

    expect(texto).toMatch(/tokens\.css/);
    expect(texto).toMatch(/fontes\.css/);
    expect(texto).toMatch(/@tailwind base/);
  });

  it("desenha o anel de foco uma vez, para todos os controlos", () => {
    const texto = global();

    expect(texto).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--espessura-foco\)/);
    expect(texto).toMatch(/:focus-visible\s*\{[^}]*var\(--cor-foco\)/);
    expect(texto).toMatch(/outline-offset:\s*var\(--afastamento-foco\)/);
  });

  it("não há nenhum outline: none em lado nenhum", () => {
    // `outline: none` sem substituição é a forma clássica de apagar o foco
    // sem dar por isso.
    expect(global()).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("põe o esquema escuro e a cor de realce, para o autofill não ficar ilegível", () => {
    const texto = global();

    expect(texto).toMatch(/color-scheme:\s*dark/);
    expect(texto).toMatch(/accent-color:\s*var\(--cor-creme-papel\)/);
  });

  it("respeita prefers-reduced-motion", () => {
    expect(global()).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("define as cinco classes de superfície, e só elas pintam o fundo", () => {
    // R-01 / ADR 0023: o papel e o destaque juntam-se às três da F3-01, na
    // mesma regra que pinta o fundo — uma classe de âmbito fora dela trocava
    // os papéis sem pintar o fundo que eles pressupõem.
    const texto = global();
    const regra =
      /((?:\.superficie-[a-z]+\s*,\s*)*\.superficie-[a-z]+)\s*\{\s*background-color:\s*var\(--cor-fundo-local\)/.exec(
        texto,
      );
    expect(regra, "não encontrei a regra das superfícies que pinta o fundo").not.toBeNull();
    const seletores = (regra?.[1] ?? "").split(",").map((seletor) => seletor.trim());

    expect(seletores).toEqual([
      ".superficie-escura",
      ".superficie-painel",
      ".superficie-creme",
      ".superficie-papel",
      ".superficie-destaque",
    ]);
  });

  it("o corpo usa os tokens de tipografia, não valores escritos à mão", () => {
    const texto = global();

    expect(texto).toMatch(/var\(--fonte-corpo\)/);
    expect(texto).toMatch(/var\(--cor-texto\)/);
  });

  it("o font-titulo e o font-seccao trazem o peso e o espaçamento da Bricolage", () => {
    // R-01, secção 3: as duas classes trazem o peso consigo e nunca se
    // juntam a `font-normal|medio|forte`. A Bricolage só existe entre 700 e
    // 800; um peso pedido de fora saía noutro sem dar erro.
    const texto = global();

    expect(texto).toMatch(/\.font-titulo\s*\{[^}]*font-weight:\s*var\(--peso-titulo\)[^}]*\}/);
    expect(texto).toMatch(
      /\.font-titulo\s*\{[^}]*letter-spacing:\s*var\(--espacejamento-titulo\)[^}]*\}/,
    );
    expect(texto).toMatch(/\.font-seccao\s*\{[^}]*font-weight:\s*var\(--peso-seccao\)[^}]*\}/);
    expect(texto).toMatch(
      /\.font-seccao\s*\{[^}]*letter-spacing:\s*var\(--espacejamento-titulo\)[^}]*\}/,
    );
  });
});

/**
 * F3-02, secção 11 — a linha de `global.css` que faz os saltos pararem no
 * sítio, e a que faz o deslize existir.
 *
 * **Prova:** que o `html` tem `scroll-padding-top: var(--ancora-ementa)` e
 * que o `scroll-behavior: smooth` está escrito na **forma positiva**,
 * dentro de `prefers-reduced-motion: no-preference`.
 *
 * Porque é que a forma importa: o bloco de `prefers-reduced-motion: reduce`
 * que já existe neste ficheiro **não cobre este caso** — ele zera durações
 * de animação e de transição, e `scroll-behavior` não é nem uma coisa nem
 * outra. Um `html { scroll-behavior: smooth }` solto continua a deslizar
 * para quem pediu que não deslizasse.
 *
 * **Deixa passar:** que o valor de `--ancora-ementa` esteja errado (isso é o
 * teste dos tokens, aqui em baixo, e a asserção do "título tapado" em
 * `e2e/ementa.spec.ts`); e um `overflow-x: hidden` num antepassado, que mata
 * o `position: sticky` dos descendentes sem erro nenhum e não se vê em
 * texto de CSS.
 */
describe("o deslize e a âncora da ementa", () => {
  it("o `html` desconta a barra fixa em `scroll-padding-top`", () => {
    // Substitui um `scroll-margin-top` em cada secção, e é melhor do que
    // ele por duas razões: é um número em vez de N, e aplica-se tanto ao
    // salto por âncora como ao deslocamento que o browser faz quando o
    // `Tab` leva o foco para um controlo escondido por baixo da barra.
    expect(global()).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*var\(--ancora-ementa\)/);
  });

  it("o `scroll-behavior: smooth` está dentro de `no-preference`", () => {
    const texto = global();

    expect(
      texto,
      "tem de ser a forma positiva: o bloco de `reduce` que já existe zera " +
        "durações, e `scroll-behavior` não é uma duração",
    ).toMatch(/prefers-reduced-motion:\s*no-preference[^@]*scroll-behavior:\s*smooth/);
  });

  it("não há `scroll-behavior: smooth` fora de uma consulta de media", () => {
    const texto = global();
    const foraDeMedia = texto
      .split("@media")
      .slice(0, 1)
      .join("")
      .match(/scroll-behavior:\s*smooth/);

    expect(
      foraDeMedia,
      "um `scroll-behavior: smooth` solto continua a deslizar para quem pediu " +
        "que não deslizasse (F3-02, 3.5)",
    ).toBeNull();
  });
});

/**
 * F3-02, 4.1 — o «×» nativo da caixa de pesquisa.
 *
 * **Prova:** que a regra existe, que vive na camada base e que apaga o
 * pseudo-elemento do botão de limpar do WebKit/Blink.
 *
 * **Deixa passar** quase tudo o que interessa: que a regra chegue ao
 * browser (o Tailwind pode não emitir a camada), que o pseudo-elemento
 * desapareça mesmo, e o próprio motivo de isto existir — haver **um** «×» na
 * barra e não dois. Isso mede-se com o browser aberto, em
 * `e2e/ementa.spec.ts`. Este teste só impede que a regra seja apagada por
 * distração numa limpeza de CSS.
 */
describe("o «×» nativo da caixa de pesquisa", () => {
  it("o pseudo-elemento do botão de limpar é apagado", () => {
    const texto = global();

    expect(
      texto,
      "com texto escrito a barra mostrava dois «×» a 52 px um do outro a fazer " +
        "coisas diferentes. Quem sai é o nativo (4.1).",
    ).toMatch(/input\[type="search"\]::-webkit-search-cancel-button\s*\{[^}]*display:\s*none/);
  });

  it("não é o nosso glifo que sai: o `IconeDeFechar` continua lá", () => {
    // A saída não é apagar o nosso símbolo — `×` é o glifo de fechar deste
    // projeto, e está na Folha e no Aviso. Esta asserção vive aqui, ao lado
    // da regra que apaga o outro, para que apagar o nosso por engano
    // apareça como o que é: a correção pela ponta errada.
    //
    // O que se prende é que **há** um ícone de fechar e que ele é um SVG
    // decorativo. A **forma** do glifo não: redesenhar o mesmo «×» com
    // outro `viewBox` punha vermelho um teste de folha de estilos, com uma
    // mensagem sobre CSS, por uma mudança que nada tem a ver com ele. Quem
    // vê a forma é a captura `390-ementa-pesquisa.png`.
    const ementa = lerTexto(
      join(RAIZ_FRONTEND, "src", "pages", "publico", "Ementa.tsx"),
      "src/pages/publico/Ementa.tsx",
    );
    const icone = /function IconeDeFechar\(\)[\s\S]*?\n}/.exec(ementa)?.[0];

    expect(icone, "não encontrei o `IconeDeFechar` — isto é falha de leitura").toBeDefined();
    expect(icone, "o fechar da pesquisa continua a ter um ícone próprio").toContain("<svg");
    expect(
      icone,
      "e continua a ser decoração: quem lhe dá nome é o `aria-label` do botão",
    ).toContain('aria-hidden="true"');
  });
});

/**
 * Os termos de uma soma de `calc()`, ao nível de cima.
 *
 * Separar por `+` e `-` **à profundidade zero** é o que impede que os
 * hífenes de `--alvo-toque` sejam lidos como subtrações: eles vivem dentro
 * do `var(`, logo a um parêntesis de distância.
 */
function termosDaSoma(corpo: string): string[] {
  const termos: string[] = [];
  let profundidade = 0;
  let atual = "";

  for (const caractere of corpo) {
    if (caractere === "(") profundidade += 1;
    if (caractere === ")") profundidade -= 1;
    if (profundidade === 0 && (caractere === "+" || caractere === "-")) {
      termos.push(atual);
      atual = "";
      continue;
    }
    atual += caractere;
  }
  termos.push(atual);

  return termos.map((termo) => termo.trim()).filter((termo) => termo.length > 0);
}

/** O corpo de cada `calc(` de um valor, com os parêntesis equilibrados. */
function corposDeCalc(valor: string): string[] {
  const corpos: string[] = [];
  let indice = valor.indexOf("calc(");

  while (indice !== -1) {
    let profundidade = 0;
    let fim = indice + "calc".length;
    for (; fim < valor.length; fim += 1) {
      if (valor[fim] === "(") profundidade += 1;
      if (valor[fim] === ")") {
        profundidade -= 1;
        if (profundidade === 0) break;
      }
    }
    corpos.push(valor.slice(indice + "calc(".length, fim));
    indice = valor.indexOf("calc(", fim);
  }

  return corpos;
}

/** `12px`, `0.5rem`, `100%` — um número **com** unidade. */
const COM_UNIDADE = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|s|ms|deg)$/i;
/** `0`, `2`, `1.5` — um número **sem** unidade. */
const SEM_UNIDADE = /^-?\d*\.?\d+$/;

describe("os três tokens da barra fixa", () => {
  /**
   * F3-03, 13.1 — **o token que move onze âncoras ao mesmo tempo.**
   *
   * **Prova:** que `--altura-cabecalho` existe, que é uma conta e não um
   * número solto, e que a conta sai do alvo de toque e do fio. Era `0px`
   * até à F3-03; o que o teste caçava não era o valor, era a falta de
   * unidade, e isso tem de sobreviver à mudança — está generalizado no
   * teste a seguir, para toda a folha de tokens.
   *
   * **Deixa passar:** o valor computado. Que dê mesmo 61 px e que o
   * cabeçalho desenhado meça isso é `e2e/cabecalho.spec.ts` — e é a
   * asserção com melhor relação entre uma linha e um defeito, porque 8 px a
   * mais aqui desalinham **todas** as âncoras e o sintoma aparece longe da
   * causa.
   */
  it("`--altura-cabecalho` é uma conta com unidade, e não um número solto", () => {
    const tokens = blocosDosTokens();
    const altura = tokens.get(":root")?.get("--altura-cabecalho");

    expect(altura, "falta --altura-cabecalho em tokens.css").toBeDefined();
    expect(
      altura,
      "escrito como a conta e não como `61px`: no dia em que o alvo de toque " +
        "mudar, o cabeçalho acompanha sozinho (F3-03, secção 3)",
    ).toContain("--alvo-toque");
    expect(altura, "o fio de 1 px faz parte da altura do cabeçalho").toContain("--contorno-fino");
    expect(
      altura,
      "um `calc()` com um zero sem unidade é inválido e a declaração inteira cai " +
        "em silêncio — e com ela a âncora de todas as categorias",
    ).not.toMatch(/^0(px)?$/);
  });

  /**
   * O defeito do `0` sem unidade, generalizado.
   *
   * **Prova:** que nenhum token que entre numa soma de `calc()` — nem
   * directamente, nem através de uma cadeia de `var()` — é um número sem
   * unidade. É o mesmo defeito que a asserção do `0px` caçava, escrito uma
   * vez para a folha inteira em vez de uma vez por token: no dia em que
   * alguém escrever `--altura-cabecalho: 0` outra vez, ou `--espaco-2: 8`,
   * ou qualquer outro, o `calc()` que os usa cai em silêncio e leva a
   * âncora das onze categorias com ele.
   *
   * **Deixa passar:** o `calc()` inválido por outras razões (unidades
   * misturadas, parêntesis a mais) e tudo o que seja valor computado. Quem
   * vê isso é o browser, em `e2e/cabecalho.spec.ts`.
   */
  it("nenhum token usado numa soma de `calc()` é um número sem unidade", () => {
    const tokens = blocosDosTokens();
    const raiz = tokens.get(":root");
    expect(raiz, "falta o bloco `:root` em tokens.css").toBeDefined();
    if (raiz === undefined) return;

    const ofensas: string[] = [];

    /** Segue a cadeia de `var()` até a um valor que não seja referência. */
    const resolverCadeia = (nome: string, vistos: string[] = []): string | null => {
      if (vistos.includes(nome)) return null;
      const valor = raiz.get(nome);
      if (valor === undefined) return null;
      const referencia = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(valor);
      if (referencia?.[1] !== undefined) return resolverCadeia(referencia[1], [...vistos, nome]);
      return valor;
    };

    /**
     * O que um factor é: um comprimento, um número puro, ou coisa que não
     * se conseguiu ler. As três são respostas diferentes de propósito —
     * "não consegui resolver" não pode passar por "está bem".
     */
    const classificar = (fator: string): "comprimento" | "numero" | "ilegivel" => {
      const limpo = fator
        .trim()
        .replace(/^\((.*)\)$/s, "$1")
        .trim();
      if (SEM_UNIDADE.test(limpo)) return "numero";
      if (COM_UNIDADE.test(limpo)) return "comprimento";
      if (limpo.includes("calc(")) return "comprimento";

      const referencia = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(limpo);
      if (referencia?.[1] === undefined) return "ilegivel";
      const resolvido = resolverCadeia(referencia[1]);
      if (resolvido === null) return "ilegivel";
      return classificar(resolvido);
    };

    /** Cada addendo de uma soma tem de valer um comprimento, sozinho. */
    const analisarSoma = (nome: string, corpo: string): void => {
      for (const termo of termosDaSoma(corpo)) {
        if (termo.includes("calc(")) {
          for (const interior of corposDeCalc(termo)) analisarSoma(nome, interior);
          continue;
        }

        // Um produto (`2 * var(--espaco-2)`, `var(--texto-nota) *
        // var(--entrelinha-nota)`) tem factores sem unidade de propósito:
        // é assim que se multiplica um comprimento. O que ele não pode é
        // **não ter nenhum** — aí o addendo inteiro é um número puro.
        const fatores = termo.split(/[*/]/).map((fator) => fator.trim());
        const tipos = fatores.map(classificar);

        fatores.forEach((fator, indice) => {
          if (tipos[indice] !== "ilegivel") return;
          ofensas.push(
            `${nome}: não consegui resolver «${fator}» — isto é uma falha de leitura ` +
              "do tokens.css, não um valor errado",
          );
        });

        if (tipos.includes("ilegivel")) return;
        if (tipos.includes("comprimento")) return;

        ofensas.push(
          `${nome}: o termo «${termo}» vale um número sem unidade. Num \`calc()\` isso ` +
            "é inválido e a declaração inteira cai em silêncio — e com ela tudo o que " +
            "dela deriva (F3-03, secção 3)",
        );
      }
    };

    for (const [nome, valor] of raiz) {
      for (const corpo of corposDeCalc(valor)) analisarSoma(nome, corpo);
    }

    expect(ofensas).toEqual([]);
  });

  it("a âncora deriva da altura do cabeçalho e da altura da barra", () => {
    const tokens = blocosDosTokens();
    const ancora = tokens.get(":root")?.get("--ancora-ementa") ?? "";

    expect(ancora).toContain("--altura-cabecalho");
    expect(ancora).toContain("--altura-barra-chips");
  });

  it("a altura da barra é a conta do alvo de toque, da folga e do fio", () => {
    const tokens = blocosDosTokens();
    const barra = tokens.get(":root")?.get("--altura-barra-chips") ?? "";

    expect(barra, "escrita como a conta que é, para acompanhar o alvo de toque").toContain(
      "--alvo-toque",
    );
    expect(barra).toContain("--contorno-fino");
  });
});
