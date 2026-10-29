// @vitest-environment node
/**
 * F3-02, 12.1 — o preço, exactamente.
 *
 * `preco_cent` é um inteiro em cêntimos (`CHECK preco_cent >= 0` na base de
 * dados). Sai daqui como texto pronto para a Linha de produto.
 *
 * **O que este ficheiro prova:** a tabela inteira de 6.1 — duas casas
 * sempre, vírgula decimal, ponto nos milhares, espaço **inquebrável** antes
 * do €, `0` a dar "Oferta", e um valor inválido a dar cadeia vazia.
 *
 * **O que deixa passar:** tudo o que acontece ao texto depois de sair da
 * função. O elemento pode não ter `tabular-nums`, o JSX pode colapsar o
 * espaço, alguém pode formatar por cima. E não diz nada sobre a **coluna**
 * de preços, que é o que a tabularidade existe para fazer — isso só se mede
 * num browser, e mede-se em `e2e/ementa-pixeis.spec.ts` (12.6).
 *
 * O ambiente é `node` e não `jsdom` porque o último `describe` lê o
 * ficheiro-fonte do disco, e `new URL("…", import.meta.url)` rebenta sob
 * jsdom com "The URL must be of scheme file".
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "../../testes/percorrer-arvore";
import { formatarPreco } from "./preco";

/** U+00A0. Escrito como escape para o teste não depender de ninguém o ver. */
const INQUEBRAVEL = "\u00a0";

/** U+202F, o estreito inquebrável. É o que o `Intl` dá em alguns ICU. */
const ESTREITO_INQUEBRAVEL = " ";

describe("formatarPreco: a tabela de 6.1", () => {
  it.each<[number, string]>([
    [650, `6,50${INQUEBRAVEL}€`],
    [600, `6,00${INQUEBRAVEL}€`],
    [5, `0,05${INQUEBRAVEL}€`],
    [125000, `1.250,00${INQUEBRAVEL}€`],
    [100, `1,00${INQUEBRAVEL}€`],
    [99, `0,99${INQUEBRAVEL}€`],
    [1, `0,01${INQUEBRAVEL}€`],
    [100000000, `1.000.000,00${INQUEBRAVEL}€`],
  ])("%i cêntimos dá «%s»", (centimos, esperado) => {
    expect(formatarPreco(centimos)).toBe(esperado);
  });

  it("600 nunca sai como «6 €» nem como «6,0 €»: são sempre duas casas", () => {
    const seiscentos = formatarPreco(600);

    expect(seiscentos).not.toBe(`6${INQUEBRAVEL}€`);
    expect(seiscentos).not.toBe(`6,0${INQUEBRAVEL}€`);
    expect(seiscentos).toMatch(/,\d{2}/);
  });

  it("o ponto dos milhares só aparece a partir dos mil euros", () => {
    expect(formatarPreco(99999)).toBe(`999,99${INQUEBRAVEL}€`);
    expect(formatarPreco(100000)).toBe(`1.000,00${INQUEBRAVEL}€`);
  });
});

describe("o espaço antes do € é inquebrável", () => {
  it("é U+00A0, e não um espaço normal", () => {
    const preco = formatarPreco(650);

    expect(preco, "sem o U+00A0 o € parte para a linha seguinte sozinho").toContain(
      `${INQUEBRAVEL}€`,
    );
    expect(preco, "um espaço normal antes do € é precisamente o que se proíbe").not.toContain(" €");
  });

  it("não é o espaço estreito inquebrável do Intl", () => {
    // Esta asserção é o guarda que impede alguém de "simplificar" a função
    // para um `Intl.NumberFormat`: conforme a versão do ICU, pt-PT sai ora
    // com U+00A0 ora com U+202F, e o ecrã passava a depender da versão do
    // browser. Ver 6.1.
    expect(formatarPreco(650)).not.toContain(ESTREITO_INQUEBRAVEL);
  });
});

describe("o preço 0 é uma oferta, não zero euros", () => {
  it("0 dá «Oferta»", () => {
    expect(formatarPreco(0)).toBe("Oferta");
  });

  it("0 nunca dá «0,00 €» — é a decisão de 6.2, não um acidente", () => {
    expect(formatarPreco(0)).not.toBe(`0,00${INQUEBRAVEL}€`);
    expect(formatarPreco(0)).not.toContain("€");
  });

  it("menos zero também é zero, e também é uma oferta", () => {
    // `Number.isInteger(-0)` é `true` e `-0 < 0` é `false`. Fica escrito
    // para que uma implementação futura com `Math.sign` não o transforme
    // num preço inválido sem ninguém reparar.
    expect(formatarPreco(-0)).toBe("Oferta");
  });
});

describe("um valor inválido não produz texto nenhum", () => {
  it.each<[string, number]>([
    ["negativo", -1],
    ["negativo redondo", -100],
    ["não inteiro", 12.5],
    ["não inteiro por um décimo", 650.1],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["infinito negativo", Number.NEGATIVE_INFINITY],
  ])("%s dá cadeia vazia, para a linha ficar só com o nome", (_descricao, valor) => {
    expect(formatarPreco(valor)).toBe("");
  });

  it("nunca sai «NaN €» — numa ementa isso é pior do que uma linha sem preço", () => {
    for (const valor of [Number.NaN, Number.POSITIVE_INFINITY, -1, 12.5]) {
      const saida = formatarPreco(valor);

      expect(saida, `formatarPreco(${String(valor)}) não pode conter «NaN»`).not.toContain("NaN");
      expect(saida, `formatarPreco(${String(valor)}) não pode conter «Infinity»`).not.toContain(
        "Infinity",
      );
      expect(saida, `formatarPreco(${String(valor)}) não pode conter «€»`).not.toContain("€");
    }
  });
});

describe("a função não usa Intl", () => {
  /**
   * **Prova:** que a razão escrita em 6.1 continua a valer no código, e não
   * só no documento.
   *
   * **Deixa passar:** um `Intl` chamado a partir de outro ficheiro e
   * passado para aqui; e um `toLocaleString` escrito com outro nome. É uma
   * rede, não uma prova — a prova são as oito linhas da tabela acima, que
   * fixam o formato literal e falham na hora em que o separador mudar.
   */
  it("`src/lib/formato/preco.ts` não menciona Intl nem toLocaleString", () => {
    const caminho = join(RAIZ_FRONTEND, "src", "lib", "formato", "preco.ts");
    const fonte = lerTexto(caminho, "src/lib/formato/preco.ts");

    // O comentário do ficheiro **explica** porque não usa `Intl`, por isso
    // procura-se a chamada e não a palavra: `Intl.` e `.toLocaleString(`.
    const linhasComIntl = fonte
      .split("\n")
      .map((linha, indice) => ({ numero: indice + 1, linha }))
      .filter(({ linha }) => /\bIntl\s*\.|\.toLocaleString\s*\(/.test(linha))
      .map(({ numero, linha }) => `preco.ts:${numero}: ${linha.trim()}`);

    expect(
      linhasComIntl,
      "o formato de moeda de pt-PT muda com a versão do ICU; três linhas de " +
        "aritmética sobre um inteiro saem sempre iguais (F3-02, 6.1)",
    ).toEqual([]);
  });
});
