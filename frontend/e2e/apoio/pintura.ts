import type { Page } from "@playwright/test";

/**
 * O que é preciso saber, dentro do browser, para medir o contraste de uma
 * coisa pintada: **contra que fundo ela assenta** e **com que opacidade
 * chega ao ecrã**.
 *
 * Vive num sítio só, e isso não é arrumação. As duas perguntas estavam
 * respondidas em três `page.evaluate` diferentes, cada um com a sua cópia
 * do `opaca`, e as cópias divergiram: todas aceitavam qualquer alfa maior
 * que zero como "opaco", por isso a subida parava no primeiro antepassado
 * translúcido e devolvia-o como fundo — que o contraste depois lia como se
 * fosse opaco. Duas meias-correções que se anulam. Com uma definição só, a
 * correção faz-se uma vez.
 *
 * ## Porque é que a opacidade entra aqui
 *
 * O estado desativado deste projeto viaja na `opacity` (secção 6 de
 * `docs/ecras/F3-01.md`), e a `opacity` apaga **tudo** o que o elemento
 * pinta — o anel de foco incluído. Mas o `getComputedStyle().outlineColor`
 * devolve a cor sem a opacidade aplicada. Os testes afirmavam 7,73 no
 * escuro e 9,95 no creme; quem navega por teclado vê 3,22 e 3,08. Os dois
 * passavam, e um deles passava por 0,08.
 */

export type MedidaDePintura = {
  /** Cor do primeiro antepassado **mesmo** opaco, ou `null` se não houver. */
  fundo: string | null;
  /**
   * Produto das opacidades desde o elemento até esse antepassado
   * (exclusive). É o factor por que a cor do elemento é apagada antes de
   * chegar ao fundo.
   */
  opacidade: number;
};

declare global {
  interface Window {
    __pintura: {
      opaca: (cor: string) => boolean;
      medir: (elemento: Element) => MedidaDePintura;
    };
  }
}

/**
 * Instala os ajudantes na página. Tem de ser chamado **antes** do `goto`:
 * o `addInitScript` corre a cada navegação, e é isso que o faz sobreviver
 * ao `reload` dos testes de `prefers-reduced-motion` e à re-navegação dos
 * testes de CSP.
 */
export async function instalarPintura(pagina: Page): Promise<void> {
  await pagina.addInitScript(() => {
    const opaca = (cor: string): boolean => {
      // A cor computada vem como três ou quatro números; o quarto, quando
      // existe, é o alfa. Lê-se assim, e não por comparação com a cadeia de
      // uma cor transparente, para não ficar dependente da forma exacta
      // como o browser a escreve.
      //
      // **`=== 1`, não `> 0`.** Um fundo translúcido não é um fundo: o que
      // se vê através dele é o que está mais atrás. Aceitá-lo parava a
      // subida cedo de mais e entregava ao cálculo do contraste uma cor
      // que ele ia tratar como opaca.
      const numeros = cor.match(/[\d.]+/g);
      if (numeros === null || numeros.length < 3) return false;
      return numeros.length < 4 || Number(numeros[3]) === 1;
    };

    const medir = (elemento: Element): { fundo: string | null; opacidade: number } => {
      const propria = Number.parseFloat(getComputedStyle(elemento).opacity);
      let opacidade = Number.isFinite(propria) ? propria : 1;

      let subida: Element | null = elemento.parentElement;
      while (subida !== null) {
        const estilo = getComputedStyle(subida);
        // O fundo encontrado fecha a conta: a opacidade **dele** já não
        // entra, porque é sobre o que ele pinta que o elemento é composto.
        if (opaca(estilo.backgroundColor)) {
          return { fundo: estilo.backgroundColor, opacidade };
        }
        const herdada = Number.parseFloat(estilo.opacity);
        if (Number.isFinite(herdada)) opacidade *= herdada;
        subida = subida.parentElement;
      }

      return { fundo: null, opacidade };
    };

    window.__pintura = { opaca, medir };
  });
}
