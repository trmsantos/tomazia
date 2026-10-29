/**
 * F3-02, 12.3 — o scroll-spy, na função pura onde ele decide.
 *
 * A regra, numa frase: **o chip ativo é o da última categoria cujo título já
 * passou a linha de leitura** (3.3). A função recebe os topos já medidos e a
 * linha já calculada, e devolve o índice.
 *
 * **O que este ficheiro prova:** os três guardas. Página no topo, acima do
 * primeiro cartão → a primeira. Entre dois títulos → o anterior.
 * Exactamente **sobre** a linha → esse, porque a comparação é inclusiva —
 * e é essa inclusividade que faz o chip em que se carregou ficar ativo.
 * Página no fim → a última, por mais curto que o último cartão seja. Lista
 * vazia → nenhum. E a invariante que atravessa tudo: com cartões, há
 * **sempre exactamente um** índice, nunca `null`.
 *
 * **O que deixa passar:** que a linha de leitura seja calculada a partir dos
 * tokens errados (a função recebe-a feita); que o ouvinte de `scroll` nunca
 * seja ligado; que a barra não reflicta o resultado. Nenhuma das três se vê
 * sem browser — são o `e2e/ementa.spec.ts` (12.5).
 */
import { describe, expect, it } from "vitest";

import { categoriaAtiva } from "./categoria-ativa";

/**
 * A linha de leitura de uma página real: `--ancora-ementa` mais um píxel.
 * Hoje são 0 (cabeçalho) + 61 (barra) + 16 (espaço-4) = 77, logo 78.
 * O número exacto não interessa a esta função; o que interessa é que seja
 * sempre o mesmo em todos os casos abaixo.
 */
const LINHA = 78;

describe("lista vazia", () => {
  it("sem cartões não há chip ativo — e «nenhum» é null, não zero", () => {
    expect(categoriaAtiva([], LINHA, false)).toBeNull();
  });

  it("sem cartões, nem o guarda do fundo inventa um índice", () => {
    // Sem esta linha, um `noFundo` tratado antes do caso vazio devolvia
    // `-1` (o `length - 1` de uma lista vazia) e o chip ativo passava a ser
    // um índice que não existe. É o modo de falha mais fácil de escrever.
    expect(categoriaAtiva([], LINHA, true)).toBeNull();
  });
});

describe("guarda 1: a página no topo", () => {
  it("nenhuma categoria passou a linha, e mesmo assim a primeira fica ativa", () => {
    // Três cartões, todos por baixo da linha: é o que se vê ao abrir a
    // página. Sem o guarda, nenhum chip ficava ativo e a barra parecia
    // avariada logo no primeiro ecrã.
    expect(categoriaAtiva([200, 900, 1600], LINHA, false)).toBe(0);
  });

  it("o primeiro título um píxel abaixo da linha ainda não conta", () => {
    expect(categoriaAtiva([LINHA + 1, 900], LINHA, false)).toBe(0);
  });
});

describe("a última que passou", () => {
  it("entre dois títulos, o ativo é o anterior", () => {
    expect(categoriaAtiva([-400, -10, 900], LINHA, false)).toBe(1);
  });

  it("o título exactamente sobre a linha já conta — a comparação é inclusiva", () => {
    // Este é o «mais um píxel» de 3.3 a ser cobrado. O `html` leva
    // `scroll-padding-top: var(--ancora-ementa)`, por isso depois de um
    // salto o título assenta **exactamente** sobre a âncora. Com a linha um
    // píxel abaixo e a comparação `topo <= linha`, o chip em que se
    // carregou fica ativo. Com `topo < linha` e a linha na âncora, ficava
    // ativo o **anterior**, logo a seguir a alguém carregar no chip.
    expect(categoriaAtiva([-400, LINHA, 900], LINHA, false)).toBe(1);
  });

  it("um píxel acima da linha também conta", () => {
    expect(categoriaAtiva([-400, LINHA - 1, 900], LINHA, false)).toBe(1);
  });

  it("um píxel abaixo da linha não conta", () => {
    expect(categoriaAtiva([-400, LINHA + 1, 900], LINHA, false)).toBe(0);
  });

  it("com todos os títulos já passados, o ativo é o último", () => {
    expect(categoriaAtiva([-1200, -800, -400], LINHA, false)).toBe(2);
  });
});

describe("guarda 2: a página no fim", () => {
  it("o último cartão é curto de mais para chegar à linha, e mesmo assim fica ativo", () => {
    // O último título está a 300 px, muito abaixo da linha, e não há mais
    // página para descer. Sem o guarda, a última categoria nunca ficava
    // ativa, por mais que se descesse.
    expect(categoriaAtiva([-900, -500, 300], LINHA, true)).toBe(2);
  });

  it("o guarda do fundo ganha ao cálculo normal", () => {
    expect(categoriaAtiva([-900, -500, 300], LINHA, false)).toBe(1);
    expect(categoriaAtiva([-900, -500, 300], LINHA, true)).toBe(2);
  });

  it("com um só cartão, o fundo e o topo dão o mesmo — e dão zero", () => {
    expect(categoriaAtiva([500], LINHA, false)).toBe(0);
    expect(categoriaAtiva([-500], LINHA, true)).toBe(0);
  });
});

describe("há sempre exactamente um chip ativo", () => {
  /**
   * **Prova:** a invariante de 3.3 em todas as posições possíveis de uma
   * página de onze cartões — o topo, o fim, e cada píxel de 50 em 50 pelo
   * meio. Nunca `null`, nunca fora do intervalo.
   *
   * **Deixa passar:** que o `null` nunca apareça mas o índice esteja
   * errado. Os casos nominais acima é que fixam qual é o índice certo;
   * este fixa que **existe** um.
   */
  it("com onze cartões, nenhuma posição da página fica sem chip", () => {
    const alturaDoCartao = 420;
    const topos = Array.from({ length: 11 }, (_, indice) => indice * alturaDoCartao);
    const alturaDaPagina = 11 * alturaDoCartao;

    const semAtivo: string[] = [];
    const foraDoIntervalo: string[] = [];

    for (let deslocamento = 0; deslocamento <= alturaDaPagina; deslocamento += 50) {
      const noFundo = deslocamento >= alturaDaPagina - 2;
      const visiveis = topos.map((topo) => topo - deslocamento);
      const ativo = categoriaAtiva(visiveis, LINHA, noFundo);

      if (ativo === null) {
        semAtivo.push(`deslocamento ${deslocamento}`);
        continue;
      }
      if (ativo < 0 || ativo >= topos.length) {
        foraDoIntervalo.push(`deslocamento ${deslocamento} deu ${ativo}`);
      }
    }

    expect(semAtivo, "a barra ficaria sem nenhum chip marcado nestas posições").toEqual([]);
    expect(foraDoIntervalo, "o índice aponta para um chip que não existe").toEqual([]);
  });

  it("no topo da página é o primeiro e no fim é o último, com os mesmos topos", () => {
    const topos = [0, 400, 800, 1200];

    expect(categoriaAtiva(topos, LINHA, false), "topo da página").toBe(0);
    expect(
      categoriaAtiva(
        topos.map((topo) => topo - 1200),
        LINHA,
        true,
      ),
      "fim da página",
    ).toBe(3);
  });
});
