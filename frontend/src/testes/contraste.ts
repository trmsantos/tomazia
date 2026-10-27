/**
 * Contraste WCAG 2.x, para os testes.
 *
 * Existe porque a armadilha central desta tarefa é numérica e não visual:
 * o dourado dá 1,72 contra o creme, e um anel de foco a 1,72 é um anel de
 * foco invisível — só para quem navega por teclado, que é precisamente
 * quem mais precisa dele. Um teste que olhe para nomes de classes não
 * apanha isto; só a conta apanha.
 *
 * É usado nos dois lados: nos testes Vitest sobre `tokens.css` (onde as
 * cores são hexes) e nos testes Playwright (onde `getComputedStyle`
 * devolve `rgb(...)`/`rgba(...)`). Por isso o leitor de cor aceita as duas
 * formas. A correção da fórmula é provada em `contraste.test.ts` contra a
 * tabela de valores de `docs/ecras/F3-01.md`.
 */

export type Rgb = { vermelho: number; verde: number; azul: number };

/**
 * Lê `#rgb`, `#rrggbb`, `rgb(r, g, b)`, `rgb(r g b / a)`, `rgba(...)` e
 * `color(srgb r g b)`. Devolve `null` se não perceber — quem chama tem de
 * tratar o `null` como "não consegui ler esta cor", nunca como "é preta".
 *
 * ## Duas recusas deliberadas
 *
 * **Canais em percentagem.** `rgb(100% 0% 0%)` e `color(srgb 60% 43% 46%)`
 * são CSS legal. Um `parseFloat` lê `100` e `60`, e um `60` num canal que
 * vai de 0 a 1 vira 15 300 — um número, não um erro. O Chromium não
 * serializa assim hoje, mas é a única notação que inverte a regra em que
 * este ficheiro inteiro assenta: **mais vale não medir do que medir mal.**
 * Por isso é `null`, e quem chamar tem de o dizer alto.
 *
 * **Alfa menor que 1.** Uma cor translúcida não tem contraste próprio: o
 * que se vê depende do que está por trás. Devolver os canais e deitar o
 * alfa fora dava uma conta feita como se a cor fosse opaca. É o caso do
 * `--cor-cortina` (`color-mix(… 88%, transparent)`, que sai a `/ 0.88`) e
 * do `#rrggbbaa`. Quem tiver o fundo à mão e quiser o número verdadeiro
 * usa o `sobrepor`, em baixo, que é a conta certa feita de propósito.
 */
export function lerCor(texto: string): Rgb | null {
  const limpo = texto.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(limpo);
  if (hex?.[1]) {
    const digitos = hex[1];
    if (digitos.length === 3 || digitos.length === 4) {
      const [v, g, a, alfa] = [digitos[0], digitos[1], digitos[2], digitos[3]];
      if (v === undefined || g === undefined || a === undefined) return null;
      if (alfa !== undefined && parseInt(alfa + alfa, 16) < 255) return null;
      return {
        vermelho: parseInt(v + v, 16),
        verde: parseInt(g + g, 16),
        azul: parseInt(a + a, 16),
      };
    }
    if (digitos.length === 6 || digitos.length === 8) {
      if (digitos.length === 8 && parseInt(digitos.slice(6, 8), 16) < 255) return null;
      return {
        vermelho: parseInt(digitos.slice(0, 2), 16),
        verde: parseInt(digitos.slice(2, 4), 16),
        azul: parseInt(digitos.slice(4, 6), 16),
      };
    }
    return null;
  }

  const funcao = /^rgba?\(([^)]+)\)$/.exec(limpo);
  if (funcao?.[1]) return lerCanais(funcao[1], 255);

  // `color(srgb 0.6 0.43 0.46)`, que é como o Chromium devolve o resultado
  // de um `color-mix()` — ou seja, todas as divisórias de 1 px do projeto,
  // que saem do `--cor-fio-interno`. Os canais vêm de 0 a 1.
  const espacoDeCor = /^color\(\s*srgb\s+([^)]+)\)$/.exec(limpo);
  if (espacoDeCor?.[1]) return lerCanais(espacoDeCor[1], 1);

  return null;
}

/**
 * Os canais de uma notação funcional, já com as duas recusas aplicadas.
 *
 * `escala` é o valor que corresponde a 255: 255 no `rgb()`, 1 no
 * `color(srgb …)`. Os pedaços são lidos como texto e não como números para
 * o `%` poder ser visto — é essa a diferença entre recusar e inventar.
 */
function lerCanais(corpo: string, escala: number): Rgb | null {
  const pedacos = corpo.split(/[\s,/]+/).filter((pedaco) => pedaco.length > 0);
  const [vermelho, verde, azul, alfa] = pedacos;
  if (vermelho === undefined || verde === undefined || azul === undefined) return null;

  if ([vermelho, verde, azul].some((pedaco) => pedaco.includes("%"))) return null;

  if (alfa !== undefined) {
    const valor = Number.parseFloat(alfa);
    if (Number.isNaN(valor)) return null;
    if ((alfa.includes("%") ? valor / 100 : valor) < 1) return null;
  }

  const canais = [vermelho, verde, azul].map((pedaco) => Number.parseFloat(pedaco));
  if (canais.some((canal) => Number.isNaN(canal))) return null;
  const [r, g, b] = canais;
  if (r === undefined || g === undefined || b === undefined) return null;

  return { vermelho: (r * 255) / escala, verde: (g * 255) / escala, azul: (b * 255) / escala };
}

/**
 * A cor que se vê quando algo é composto sobre o que está por trás com uma
 * dada opacidade.
 *
 * Existe por causa de um defeito encontrado em revisão: o estado desativado
 * viaja na `opacity`, a `opacity` apaga tudo o que o elemento pinta — o
 * anel de foco incluído — e o `getComputedStyle().outlineColor` devolve a
 * cor **sem** a opacidade aplicada. O teste afirmava 7,73 no escuro e 9,95
 * no creme; a pessoa vê 3,22 e 3,09. E o âmbito mais apertado não é nenhum
 * dos dois: é o painel, a 3,04. Passavam todos, sem nada a medir o que
 * estava mesmo no ecrã. O chão está calculado em
 * `src/styles/foco-no-desativado.test.ts`.
 */
export function sobrepor(frente: Rgb, fundo: Rgb, alfa: number): Rgb {
  const misturar = (daFrente: number, doFundo: number): number =>
    daFrente * alfa + doFundo * (1 - alfa);
  return {
    vermelho: misturar(frente.vermelho, fundo.vermelho),
    verde: misturar(frente.verde, fundo.verde),
    azul: misturar(frente.azul, fundo.azul),
  };
}

/** Luminância relativa, fórmula WCAG 2.x. */
export function luminanciaRelativa(cor: Rgb): number {
  const canal = (valor: number): number => {
    const normalizado = valor / 255;
    return normalizado <= 0.03928
      ? normalizado / 12.92
      : Math.pow((normalizado + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(cor.vermelho) + 0.7152 * canal(cor.verde) + 0.0722 * canal(cor.azul);
}

/**
 * Rácio de contraste entre duas cores opacas, de 1 a 21.
 *
 * Lança se alguma das cores não for legível — "não consegui ler a cor"
 * nunca pode passar por "o contraste chega" (regra 10).
 */
export function contraste(primeira: string, segunda: string): number {
  const a = lerCor(primeira);
  const b = lerCor(segunda);
  if (a === null || b === null) {
    throw new Error(
      `Não consegui ler uma das cores para calcular o contraste: ${JSON.stringify([primeira, segunda])}. ` +
        "Isto é uma falha de leitura, não um contraste insuficiente.",
    );
  }
  return contrasteDeCores(a, b);
}

/**
 * O mesmo rácio, a partir de cores já lidas. É por aqui que entra o
 * resultado do `sobrepor`, que não tem forma de texto nenhuma.
 */
export function contrasteDeCores(primeira: Rgb, segunda: Rgb): number {
  const luminanciaA = luminanciaRelativa(primeira);
  const luminanciaB = luminanciaRelativa(segunda);
  const clara = Math.max(luminanciaA, luminanciaB);
  const escura = Math.min(luminanciaA, luminanciaB);
  return (clara + 0.05) / (escura + 0.05);
}

/** Arredonda a duas casas, como a tabela de `docs/ecras/F3-01.md`. */
export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
