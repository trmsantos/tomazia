/**
 * F3-02, secção 6 — a Linha de produto.
 *
 * É o oitavo componente da lista da especificação e nasce nesta tarefa.
 * Nome à esquerda, pontilhado, preço à direita, descrição por baixo quando
 * existe. **Nada nela é clicável** (secção 1): 140 produtos clicáveis seriam
 * 140 paragens de `Tab` antes da secção seguinte.
 *
 * Contrato:
 *
 * ```tsx
 * export function LinhaDeProduto(propriedades: {
 *   nome: string;
 *   precoCent: number;
 *   descricao?: string | null;
 * }): ReactElement   // um <li>
 * ```
 *
 * **O que este ficheiro prova:** a forma (o `<li>`, o fio decorativo, a
 * descrição opcional), os papéis de cor que a armadilha do dourado exige
 * (secção 7), e o que acontece a um preço que não é um inteiro ≥ 0 — a
 * linha fica só com o nome, nunca com "NaN €".
 *
 * **O que deixa passar:** tudo o que precisa de layout. Em jsdom o
 * `items-baseline` não alinha nada, o `min-width: 0` não encolhe nada e a
 * coluna de preços não existe. O preço alinhado pela primeira linha de um
 * nome longo e a coluna tabular são 12.6, no Playwright. E as classes
 * afirmam-se porque é a única forma de prender a **escolha** do papel em
 * jsdom; que o papel resolva para a cor certa dentro do creme é
 * `papeis-por-ambito.test.ts` e o varrimento de píxeis de 12.9.
 */
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { LinhaDeProduto } from "./LinhaDeProduto";

/** O `<li>` precisa de uma `<ul>` à volta, senão o React avisa e com razão. */
function desenhar(elemento: ReactElement) {
  return render(<ul>{elemento}</ul>);
}

/**
 * Procurar texto **sem colapsar o espaço branco**.
 *
 * O normalizador por omissão da Testing Library troca o U+00A0 por um
 * espaço normal antes de comparar — e com ele `getByText("1,40\u00a0€")`
 * nunca encontra nada, e `getByText("1,40 €")` encontraria tanto o preço
 * certo como um preço com espaço normal. Os dois modos de falha são
 * exactamente o que 6.1 proíbe, por isso a procura é feita com um
 * normalizador que só apara as pontas: assim encontrar o elemento **é** a
 * prova de que o espaço inquebrável chegou ao DOM.
 */
const SEM_COLAPSAR = { normalizer: (texto: string) => texto.trim() };

/** O fio pontilhado: o único filho decorativo da linha. */
function fioDe(raiz: HTMLElement): Element | null {
  return raiz.querySelector('[aria-hidden="true"]');
}

describe("a forma da linha", () => {
  it("é um item de lista, não um botão nem uma ligação", () => {
    const { container } = desenhar(<LinhaDeProduto nome="Galão" precoCent={140} />);

    expect(container.querySelector("li")).not.toBeNull();
    expect(
      container.querySelectorAll("a, button, input, [tabindex]"),
      "nada na ementa é clicável (F3-02, secção 1): cada controlo aqui seria " +
        "mais uma paragem de Tab, vezes 140",
    ).toHaveLength(0);
  });

  it("mostra o nome e o preço", () => {
    desenhar(<LinhaDeProduto nome="Galão" precoCent={140} />);

    expect(screen.getByText("Galão")).toBeInTheDocument();
    expect(screen.getByText("1,40\u00a0€", SEM_COLAPSAR)).toBeInTheDocument();
  });

  it("o pontilhado é decorativo e não se lê", () => {
    // A alternativa (um `::after` com `content: "·····"`) é anunciada por
    // vários leitores de ecrã, e a linha passava a ler-se "Sandes de
    // pernil, ponto ponto ponto ponto, seis euros e cinquenta". Vezes 140.
    const { container } = desenhar(<LinhaDeProduto nome="Galão" precoCent={140} />);
    const fio = fioDe(container);

    expect(fio, "falta o fio pontilhado").not.toBeNull();
    expect(fio?.textContent, "o fio é um span vazio, sem texto gerado").toBe("");
  });

  it("a descrição aparece quando existe", () => {
    desenhar(
      <LinhaDeProduto nome="Galão" precoCent={140} descricao="Com leite acabado de tirar." />,
    );

    expect(screen.getByText("Com leite acabado de tirar.")).toBeInTheDocument();
  });

  it.each<[string, string | null | undefined]>([
    ["ausente", undefined],
    ["nula", null],
    ["vazia", ""],
  ])("sem descrição (%s) não fica um parágrafo vazio", (_caso, descricao) => {
    const { container } = desenhar(
      <LinhaDeProduto nome="Galão" precoCent={140} descricao={descricao} />,
    );

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});

describe("o preço", () => {
  it("usa o formato de 6.1, com o espaço inquebrável", () => {
    desenhar(<LinhaDeProduto nome="Garrafa de reserva" precoCent={125000} />);

    expect(screen.getByText("1.250,00\u00a0€", SEM_COLAPSAR)).toBeInTheDocument();
  });

  it("um preço de 0 mostra «Oferta», na mesma célula", () => {
    const { container } = desenhar(<LinhaDeProduto nome="Água da casa" precoCent={0} />);

    const oferta = screen.getByText("Oferta");
    expect(
      oferta.className,
      "a oferta fica na célula do preço, com o mesmo peso e a mesma cor (6.2)",
    ).toContain("tabular-nums");
    expect(fioDe(container), "com oferta continua a haver fio").not.toBeNull();
  });

  it("leva `tabular-nums`, que é o que alinha a coluna", () => {
    // Esta asserção lê a classe, e a classe pode ficar lá sem efeito se o
    // subconjunto da fonte tiver perdido a função `tnum`. É por isso que
    // 12.6 **mede duas larguras** em vez de ler o estilo computado — este
    // teste prende a escolha, aquele prende o efeito.
    desenhar(<LinhaDeProduto nome="Imperial" precoCent={110} />);

    expect(screen.getByText("1,10\u00a0€", SEM_COLAPSAR).className).toContain("tabular-nums");
  });
});

describe("um preço que não é um inteiro ≥ 0", () => {
  /**
   * **Prova:** "NaN €" numa ementa é pior do que uma linha sem preço, e a
   * linha sem preço pelo menos diz ao dono que há ali alguma coisa para
   * arranjar (6.1). Sem preço **e sem fio**: um pontilhado que não liga
   * nada a nada é um defeito visível.
   *
   * **Deixa passar:** que a API alguma vez envie isto. O `CHECK
   * preco_cent >= 0` do backend diz que não — mas o tipo gerado é `number`
   * e um dia haverá gestão a escrever preços (F4-02).
   */
  it.each<[string, number]>([
    ["negativo", -1],
    ["não inteiro", 12.5],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
  ])("%s: fica só o nome, sem preço e sem fio", (_caso, precoCent) => {
    const { container } = desenhar(<LinhaDeProduto nome="Imperial" precoCent={precoCent} />);

    expect(screen.getByText("Imperial")).toBeInTheDocument();
    expect(container.textContent, "nunca «NaN»").not.toContain("NaN");
    expect(container.textContent, "nunca «Infinity»").not.toContain("Infinity");
    expect(container.textContent, "nunca um € sozinho").not.toContain("€");
    expect(fioDe(container), "sem preço, o fio não liga nada a nada").toBeNull();
  });
});

describe("os papéis de cor, e a armadilha do dourado", () => {
  /**
   * **Prova:** que o componente escreve **papéis** e não cores. É isso que
   * faz o `.superficie-creme` trocar o significado das palavras e impede o
   * preço dourado (1,72 contra o creme) e o pontilhado dourado, que é a
   * tentação clássica de carta.
   *
   * **Deixa passar:** uma classe escrita noutro sítio a sobrepor-se. Foi
   * exactamente assim que o `EstadoVazio` da F3-01 saiu igual nos dois
   * tons: a classe de fora estava sobreposta e morta. Daí 12.9.
   */
  it("o preço usa `text-texto-marca`, nunca uma cor da paleta", () => {
    desenhar(<LinhaDeProduto nome="Imperial" precoCent={110} />);
    const classes = screen.getByText("1,10\u00a0€", SEM_COLAPSAR).className;

    expect(classes).toContain("text-texto-marca");
    expect(classes).not.toContain("dourado");
    expect(classes).not.toContain("bordo");
  });

  it("o fio usa `border-pontilhado`, e tem um mínimo para nunca desaparecer", () => {
    const { container } = desenhar(<LinhaDeProduto nome="Imperial" precoCent={110} />);
    const classes = fioDe(container)?.className ?? "";

    expect(classes).toContain("border-pontilhado");
    expect(classes).toContain("border-dotted");
    expect(classes, "sem um mínimo, um nome longo come o fio todo (6.3)").toContain("min-w-fio");
  });

  it("a descrição não usa `text-texto-suave`", () => {
    // No creme esse papel resolve para bordô-tomazia, que é a cor do
    // preço: o texto menos importante do cartão ficaria com a cor da
    // marca, a um centímetro do preço. A descrição recua por tamanho e por
    // peso (secção 6).
    desenhar(<LinhaDeProduto nome="Galão" precoCent={140} descricao="Com leite." />);
    const classes = screen.getByText("Com leite.").className;

    expect(classes).not.toContain("text-texto-suave");
    expect(classes).toContain("text-texto");
    expect(classes, "recua por tamanho").toContain("text-nota");
  });

  it("o nome pode encolher: sem `min-w-0` um nome longo empurra o preço para fora", () => {
    desenhar(<LinhaDeProduto nome="Sandes de pernil com queijo da serra" precoCent={650} />);
    const classes = screen.getByText("Sandes de pernil com queijo da serra").className;

    expect(
      classes,
      "um item de flex recusa-se a encolher abaixo do seu conteúdo sem `min-width: 0` (6.3)",
    ).toContain("min-w-0");
  });

  it("o preço nunca encolhe nem parte", () => {
    desenhar(<LinhaDeProduto nome="Sandes de pernil com queijo da serra" precoCent={650} />);

    expect(screen.getByText("6,50\u00a0€", SEM_COLAPSAR).className).toContain("whitespace-nowrap");
  });

  it("não traz style inline", () => {
    const { container } = desenhar(<LinhaDeProduto nome="Galão" precoCent={140} />);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
