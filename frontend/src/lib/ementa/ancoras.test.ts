/**
 * F3-02, secção 2 — a âncora de uma categoria.
 *
 * O chip é `<a href="#ementa-cafes">` e o cartão é
 * `<section id="ementa-cafes">`. O prefixo não é decoração: a página vai
 * ganhar eventos e fotos com nomes próprios, e um `id="sexta"` de uma
 * categoria a colidir com um `id="sexta"` de um evento daria um salto para
 * o sítio errado, em silêncio.
 *
 * O `slug` vem da API e **não tem formato garantido**: na base de dados é
 * `String(60)` com `unique` e sem `CHECK` nenhum, e a F4-02 vai deixar o
 * dono escrevê-lo.
 *
 * **O que este ficheiro prova:** um `slug` limpo vira `ementa-${slug}`; tudo
 * o resto cai no `ementa-categoria-${id}`; e o resultado é sempre um
 * identificador que serve de seletor CSS — que é o que impede um
 * `querySelector` algures de lançar e levar a página com ele.
 *
 * **O que deixa passar:** que a página não use esta função. O chip pode
 * escrever um `href` à mão e o cartão outro `id`, e isto continua verde. É
 * `Ementa.test.tsx` (cada chip aponta para um cartão que existe) e o e2e
 * (o salto acontece mesmo) que fecham essa porta.
 */
import { describe, expect, it } from "vitest";

import { EMENTA_DE_TESTE } from "../../testes/ementa";
import { ancoraDaCategoria } from "./ancoras";

describe("um slug limpo usa-se tal e qual", () => {
  it.each<[string, number, string]>([
    ["cafes", 1, "ementa-cafes"],
    ["bebidas-quentes", 2, "ementa-bebidas-quentes"],
    ["gin-tonico-2", 7, "ementa-gin-tonico-2"],
    ["123", 8, "ementa-123"],
  ])("«%s» (id %i) dá «%s»", (slug, id, esperado) => {
    expect(ancoraDaCategoria({ id, slug })).toBe(esperado);
  });
});

describe("um slug que não é um identificador cai no id", () => {
  it.each<[string, string]>([
    ["com espaço", "espaços"],
    ["Gins & Tónicas", "maiúsculas, «&» e acento"],
    ["cafés", "acento"],
    ["café.com", "ponto"],
    ["", "vazio"],
    ["  ", "só espaços"],
    ["MAIUSCULAS", "maiúsculas"],
    ["com_underscore", "sublinhado"],
    ["#fragmento", "cardinal"],
    ["cafes/quentes", "barra"],
  ])("«%s» (%s) dá ementa-categoria-42", (slug) => {
    expect(ancoraDaCategoria({ id: 42, slug })).toBe("ementa-categoria-42");
  });
});

describe("a âncora serve sempre de seletor CSS", () => {
  /**
   * A regra que não se quebra (secção 2): **nunca
   * `querySelector("#" + id)`**. Um `id` com um espaço, um acento ou um
   * ponto não é um seletor válido e o `querySelector` **lança**, o que
   * rebenta a página inteira por causa de um nome de categoria.
   *
   * A função é a primeira rede: o que ela devolve nunca tem esse feitio.
   * A segunda rede é a implementação usar `getElementById` ou uma `ref`, e
   * essa não se prova aqui.
   */
  it("nenhuma âncora da fixtura rebenta um querySelector", () => {
    const rebentaram: string[] = [];

    for (const categoria of EMENTA_DE_TESTE.categorias) {
      const ancora = ancoraDaCategoria(categoria);
      try {
        document.querySelector(`#${ancora}`);
      } catch {
        rebentaram.push(`${categoria.nome}: #${ancora}`);
      }
    }

    expect(rebentaram).toEqual([]);
  });

  it("as âncoras da fixtura são todas diferentes", () => {
    const ancoras = EMENTA_DE_TESTE.categorias.map((categoria) => ancoraDaCategoria(categoria));

    expect(
      new Set(ancoras).size,
      "duas categorias com a mesma âncora saltam para o mesmo sítio",
    ).toBe(ancoras.length);
  });

  it("um slug «categoria-42» não rouba a âncora da categoria de id 42", () => {
    // Os dois espaços de nomes sobrepunham-se: `categoria-42` passa o
    // formato limpo e produzia `ementa-categoria-42`, que é o que o ramo
    // alternativo reserva para a categoria de `id` 42. Duas `<section>` com
    // o mesmo identificador, um chip a saltar para o cartão errado e um
    // `aria-labelledby` a anunciar o título errado.
    //
    // O par é construído à mão de propósito: a asserção de unicidade aqui
    // em cima só cobre a fixtura, e a fixtura não tem colisões — nem as
    // pode ter, porque é a F4-02 que vai deixar escrever `slugs`.
    const comSlugReservado = { id: 7, slug: "categoria-42" };
    const comIdQueColide = { id: 42, slug: "Gins & Tónicas" };

    expect(ancoraDaCategoria(comIdQueColide)).toBe("ementa-categoria-42");
    expect(
      ancoraDaCategoria(comSlugReservado),
      "um slug com a forma do ramo alternativo tem de cair no próprio id",
    ).toBe("ementa-categoria-7");
    expect(ancoraDaCategoria(comSlugReservado)).not.toBe(ancoraDaCategoria(comIdQueColide));
  });

  it("um slug que só se parece com a forma reservada continua a valer", () => {
    // O guarda é de forma inteira e não de prefixo: `categorias-7`,
    // `categoria-sete` e `gin-tonico-2` não colidem com nada e seria uma
    // pena mandá-los para o id só por começarem pela mesma letra.
    expect(ancoraDaCategoria({ id: 1, slug: "categorias-7" })).toBe("ementa-categorias-7");
    expect(ancoraDaCategoria({ id: 2, slug: "categoria-sete" })).toBe("ementa-categoria-sete");
    expect(ancoraDaCategoria({ id: 3, slug: "gin-tonico-2" })).toBe("ementa-gin-tonico-2");
  });

  it("a categoria de slug feio da fixtura cai mesmo no id", () => {
    const feia = EMENTA_DE_TESTE.categorias.find((categoria) => categoria.slug.includes(" "));

    expect(
      feia,
      "a fixtura perdeu o slug feio: sem ele, o ramo do id deixa de ser exercitado " +
        "contra dados a sério. Isto não é uma falha da função.",
    ).toBeDefined();
    expect(ancoraDaCategoria(feia ?? { id: -1, slug: "x" })).toBe(
      `ementa-categoria-${String(feia?.id ?? -1)}`,
    );
  });
});
