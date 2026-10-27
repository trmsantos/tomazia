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
 * Lê `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgb(r g b / a)` e
 * `rgba(...)`. Devolve `null` se não perceber — quem chama tem de tratar o
 * `null` como "não consegui ler esta cor", nunca como "é preta".
 */
export function lerCor(texto: string): Rgb | null {
  const limpo = texto.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(limpo);
  if (hex?.[1]) {
    const digitos = hex[1];
    if (digitos.length === 3 || digitos.length === 4) {
      const [v, g, a] = [digitos[0], digitos[1], digitos[2]];
      if (v === undefined || g === undefined || a === undefined) return null;
      return {
        vermelho: parseInt(v + v, 16),
        verde: parseInt(g + g, 16),
        azul: parseInt(a + a, 16),
      };
    }
    if (digitos.length === 6 || digitos.length === 8) {
      return {
        vermelho: parseInt(digitos.slice(0, 2), 16),
        verde: parseInt(digitos.slice(2, 4), 16),
        azul: parseInt(digitos.slice(4, 6), 16),
      };
    }
    return null;
  }

  const funcao = /^rgba?\(([^)]+)\)$/.exec(limpo);
  if (funcao?.[1]) {
    const numeros = funcao[1]
      .replace("/", " ")
      .split(/[\s,]+/)
      .filter((pedaco) => pedaco.length > 0)
      .map((pedaco) => Number.parseFloat(pedaco));
    const [vermelho, verde, azul] = numeros;
    if (vermelho === undefined || verde === undefined || azul === undefined) return null;
    if ([vermelho, verde, azul].some((canal) => Number.isNaN(canal))) return null;
    return { vermelho, verde, azul };
  }

  // `color(srgb 0.6 0.43 0.46)` e `color(srgb 0.6 0.43 0.46 / 0.5)`.
  //
  // É assim que o Chromium devolve o resultado de um `color-mix()`, e o
  // `color-mix()` é como o `tokens.css` deriva a cortina e o
  // `--cor-fio-interno` — ou seja, **todas as divisórias de 1 px do
  // projeto**. Sem este ramo, o teste das linhas dentro do creme não
  // media a única cor que ele existe para medir: dizia "não consegui ler"
  // em vez de dar um número. Os canais vêm de 0 a 1, não de 0 a 255.
  const espacoDeCor = /^color\(\s*srgb\s+([^)]+)\)$/.exec(limpo);
  if (espacoDeCor?.[1]) {
    const numeros = espacoDeCor[1]
      .replace("/", " ")
      .split(/[\s,]+/)
      .filter((pedaco) => pedaco.length > 0)
      .map((pedaco) => Number.parseFloat(pedaco));
    const [vermelho, verde, azul] = numeros;
    if (vermelho === undefined || verde === undefined || azul === undefined) return null;
    if ([vermelho, verde, azul].some((canal) => Number.isNaN(canal))) return null;
    return { vermelho: vermelho * 255, verde: verde * 255, azul: azul * 255 };
  }

  return null;
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
  const luminanciaA = luminanciaRelativa(a);
  const luminanciaB = luminanciaRelativa(b);
  const clara = Math.max(luminanciaA, luminanciaB);
  const escura = Math.min(luminanciaA, luminanciaB);
  return (clara + 0.05) / (escura + 0.05);
}

/** Arredonda a duas casas, como a tabela de `docs/ecras/F3-01.md`. */
export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
