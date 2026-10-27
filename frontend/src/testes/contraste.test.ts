// @vitest-environment node
/**
 * Autoteste da calculadora de contraste.
 *
 * O resto da tarefa confia nestes números para decidir se um anel de foco
 * é visível. Uma fórmula partida aqui faria os testes de contraste passar
 * com valores inventados — por isso a fórmula é verificada contra a tabela
 * medida em `docs/ecras/F3-01.md` (secção 6) e contra os dois extremos
 * conhecidos (preto/branco = 21, cor contra si própria = 1).
 */
import { describe, expect, it } from "vitest";

import { arredondar, contraste, contrasteDeCores, lerCor, sobrepor } from "./contraste";

const BORDO_NOITE = "#3d0f24";
const BORDO_VINHO = "#4a1830";
const BORDO_TOMAZIA = "#5d1f3a";
const DOURADO_LATAO = "#d4af37";
const CREME_PAPEL = "#f5e6d3";
const CREME_SOMBRA = "#d9c3ae";
const ERRO_ESCURO = "#e07a5f";

describe("calculadora de contraste", () => {
  it("dá 21 entre preto e branco e 1 entre uma cor e ela própria", () => {
    expect(arredondar(contraste("#000000", "#ffffff"))).toBe(21);
    expect(arredondar(contraste(DOURADO_LATAO, DOURADO_LATAO))).toBe(1);
  });

  it("reproduz a tabela medida em docs/ecras/F3-01.md", () => {
    // Se algum destes números mudar, ou a fórmula partiu-se ou a paleta
    // mudou — e nos dois casos a tabela da especificação ficou errada.
    expect(arredondar(contraste(CREME_PAPEL, BORDO_NOITE))).toBe(13.27);
    expect(arredondar(contraste(CREME_SOMBRA, BORDO_VINHO))).toBe(8.44);
    expect(arredondar(contraste(DOURADO_LATAO, BORDO_NOITE))).toBe(7.73);
    expect(arredondar(contraste(BORDO_TOMAZIA, CREME_PAPEL))).toBe(9.95);
    expect(arredondar(contraste(ERRO_ESCURO, BORDO_TOMAZIA))).toBe(4.13);
  });

  it("confirma a armadilha: o dourado sobre o creme dá 1,72 e chumba os 3:1 de um anel de foco", () => {
    const racio = arredondar(contraste(DOURADO_LATAO, CREME_PAPEL));

    expect(racio).toBe(1.72);
    expect(racio).toBeLessThan(3);
  });

  it("lê hex curto, hex longo e rgb() do getComputedStyle", () => {
    expect(lerCor("#fff")).toEqual({ vermelho: 255, verde: 255, azul: 255 });
    expect(lerCor("#F5E6D3")).toEqual({ vermelho: 245, verde: 230, azul: 211 });
    expect(lerCor("rgb(61, 15, 36)")).toEqual({ vermelho: 61, verde: 15, azul: 36 });
    expect(lerCor("rgb(61 15 36 / 1)")).toEqual({ vermelho: 61, verde: 15, azul: 36 });
    expect(lerCor("rgb(61 15 36 / 100%)")).toEqual({ vermelho: 61, verde: 15, azul: 36 });
  });

  it("lê o color(srgb …) com que o Chromium devolve um color-mix()", () => {
    // Todas as divisórias de 1 px do projeto saem de um `color-mix()`
    // (`--cor-fio-interno`), e o browser devolve-as nesta forma. Sem este
    // ramo, o teste que mede as linhas dentro do creme dizia "não consegui
    // ler" em vez de dar um número — e "não consegui medir" tinha o mesmo
    // efeito prático que "está bom".
    expect(lerCor("color(srgb 1 1 1)")).toEqual({ vermelho: 255, verde: 255, azul: 255 });
    expect(lerCor("color(srgb 0 0 0 / 1)")).toEqual({ vermelho: 0, verde: 0, azul: 0 });

    // O `--cor-fio-interno` do âmbito creme, como o Chromium o escreve:
    // 60% de bordô-tomazia em creme-papel. A secção 2 da especificação diz
    // que dá 3,49 contra o creme — acima dos 3 da 1.4.11 e abaixo dos 9,95
    // do contorno dos controlos.
    const fioInternoNoCreme = "color(srgb 0.603137 0.433726 0.467451)";
    expect(arredondar(contraste(fioInternoNoCreme, CREME_PAPEL))).toBeCloseTo(3.49, 1);

    // O 3,49 exacto da tabela sai dos canais já arredondados a 8 bits
    // (154, 111, 119), que é como a especificação os escreve; o browser
    // dá-os em vírgula flutuante e chega a 3,50. A diferença é de
    // centésimas e fica aqui registada para ninguém a ir procurar outra vez.
    expect(arredondar(contraste("rgb(154, 111, 119)", CREME_PAPEL))).toBe(3.49);
  });

  it("devolve null em vez de uma cor inventada quando não percebe o valor", () => {
    expect(lerCor("var(--cor-foco)")).toBeNull();
    expect(lerCor("color-mix(in srgb, red 50%, blue)")).toBeNull();
    expect(() => contraste("var(--cor-foco)", CREME_PAPEL)).toThrow(/não consegui ler/i);
  });

  it("recusa canais em percentagem em vez de os multiplicar por engano", () => {
    // `rgb(100% 0% 0%)` e `color(srgb 60% 43% 46%)` são CSS legal. Um
    // `parseFloat` lê 100 e 60: num canal de 0 a 1 isso vira 15 300, e sai
    // um número em vez de um erro. É a única notação que inverte a regra em
    // que este ficheiro assenta — mais vale não medir do que medir mal.
    expect(lerCor("rgb(100% 0% 0%)")).toBeNull();
    expect(lerCor("rgb(100%, 0%, 0%)")).toBeNull();
    expect(lerCor("color(srgb 60% 43% 46%)")).toBeNull();
  });

  it("recusa cores translúcidas: sem o fundo não há contraste nenhum para medir", () => {
    // Uma cor com alfa não tem contraste próprio — depende do que está por
    // trás. Devolver os canais e deitar o alfa fora dava uma conta feita
    // como se a cor fosse opaca. É o caso do `--cor-cortina`, que é
    // `color-mix(… 88%, transparent)` e sai do browser a `/ 0.88`.
    expect(lerCor("rgba(61, 15, 36, 0.78)")).toBeNull();
    expect(lerCor("rgb(61 15 36 / 78%)")).toBeNull();
    expect(lerCor("color(srgb 0 0 0 / 0.5)")).toBeNull();
    expect(lerCor("#3d0f24cc")).toBeNull();
    expect(lerCor("#3d0f24ff"), "alfa de 1 continua a ser opaco").toEqual({
      vermelho: 61,
      verde: 15,
      azul: 36,
    });
    expect(() => contraste("rgba(61, 15, 36, 0.78)", CREME_PAPEL)).toThrow(/não consegui ler/i);
  });

  it("o sobrepor dá a cor que se vê quando a opacidade entra", () => {
    // O defeito que o `sobrepor` existe para medir: o anel de foco de um
    // controlo desativado. O `getComputedStyle().outlineColor` devolve o
    // dourado inteiro; a `opacity` de 0,55 apaga-o contra o bordô, e o que
    // se vê é outra cor.
    const dourado = lerCor(DOURADO_LATAO);
    const bordoNoite = lerCor(BORDO_NOITE);
    expect(dourado, "não consegui ler os tokens da fixture").not.toBeNull();
    expect(bordoNoite).not.toBeNull();
    if (dourado === null || bordoNoite === null) return;

    expect(sobrepor(dourado, bordoNoite, 1), "alfa 1 devolve a cor da frente").toEqual(dourado);
    expect(sobrepor(dourado, bordoNoite, 0), "alfa 0 devolve o fundo").toEqual(bordoNoite);

    const anelApagado = sobrepor(dourado, bordoNoite, 0.55);
    expect(arredondar(contrasteDeCores(anelApagado, bordoNoite))).toBe(3.22);
    expect(
      arredondar(contraste(DOURADO_LATAO, BORDO_NOITE)),
      "e é por isto que a conta sem opacidade enganava: 7,73 contra 3,22",
    ).toBe(7.73);
  });
});
