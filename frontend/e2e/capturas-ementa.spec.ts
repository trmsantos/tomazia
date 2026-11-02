import { expect, test } from "@playwright/test";

import { EMENTA_VAZIA } from "../src/testes/ementa";
import {
  EMENTA_DE_TESTE,
  TEXTOS_DA_EMENTA,
  abrirAEmenta,
  campoDePesquisa,
  cartoes,
  chips,
  fingirAEmenta,
  fingirEmentaFixa,
  lupa,
} from "./apoio/ementa";
import { capturarComAnel, guardar } from "./apoio/capturas";

/**
 * F3-02, 12.12 — as capturas que a revisão ui-ux abre.
 *
 * Dez, a somar às da F3-01 — as nove de 12.12 mais a segunda linha da
 * tabela de erros de 5.3, que não tinha nenhuma: «o servidor disse que
 * não» é outro ecrã, com outra frase, e o ecrã do prazo esgotado é
 * **igual** ao da falha de rede (os dois são `estado: null`), por isso não
 * ganha captura própria — ganharia uma imagem idêntica à custa de dez
 * segundos de espera. Não são comparações com imagem de referência
 * (isso é da F3-07, se entrar): servem a revisão e o PR, que o `CLAUDE.md`
 * obriga a levar capturas a 390 × 844 para qualquer alteração visual.
 *
 * A `390-ementa-nome-longo` não é um extra: é a única prova do que 6.3
 * descreve em palavras — o preço alinhado pela primeira linha de um nome
 * que vai a duas — e é a coisa desta especificação que menos se consegue
 * garantir sem olhar.
 *
 * A `390-ementa-foco-chip` também não: "foco visível" é critério Q-04 e as
 * capturas normais não mostram anel nenhum. O foco é posto **por teclado**,
 * senão o Chromium não acende o `:focus-visible` e a imagem passaria por
 * prova de que o anel não existe.
 *
 * E há um item obrigatório desta revisão, escrito em 11: **se o pontilhado
 * gritar mais alto do que o nome do produto na `390-ementa.png`, o
 * `--cor-pontilhado` passa a `var(--cor-fio-interno)` e nada mais muda.**
 */

test.describe("390 × 844", () => {
  test("a ementa inteira, e o pontilhado que fica em vigilância", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(cartoes(page)).not.toHaveCount(0);

    await guardar("390-ementa", (caminho) => page.screenshot({ path: caminho, fullPage: true }));
  });

  test("o esqueleto", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "ementa", corpo: EMENTA_DE_TESTE, atrasoMs: 6000 }));
    await page.goto("/");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);

    await guardar("390-ementa-a-carregar", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a ementa vazia", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "ementa", corpo: EMENTA_VAZIA }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.vaziaTitulo)).toBeVisible();

    await guardar("390-ementa-vazia", (caminho) => page.screenshot({ path: caminho }));
  });

  test("o erro, quando não houve resposta nenhuma", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "falha" }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroSemResposta)).toBeVisible();

    await guardar("390-ementa-erro", (caminho) => page.screenshot({ path: caminho }));
  });

  test("o erro, quando o servidor respondeu", async ({ page }) => {
    // A tabela de 5.3 tem **duas** linhas e só uma tinha captura. Esta é a
    // outra: o título é o mesmo — a pessoa não quer saber de quem é a culpa
    // — e só a linha muda, porque só a linha diz o que fazer com a
    // informação. É também o ecrã do caso novo do `.catch`: um 200 sem
    // `categorias` mostra esta mesma frase.
    await fingirAEmenta(page, () => ({ tipo: "estado", estado: 500 }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroComResposta)).toBeVisible();
    await expect(
      page.getByText("detalhe cru do servidor"),
      "a mensagem crua do servidor nunca aparece (5.3)",
    ).toHaveCount(0);

    await guardar("390-ementa-erro-servidor", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a pesquisa aberta, com resultados", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await lupa(page).click();
    await campoDePesquisa(page).fill("gin");
    await expect(cartoes(page)).not.toHaveCount(0);

    // Sem esta espera, a captura sai 500 ms **antes** de a linha de
    // contagem existir — e foi assim que uma revisão inteira correu sobre
    // um ecrã a que faltava um elemento obrigatório de 4.5. Vale a regra
    // geral de 12.12: uma captura de um ecrã com uma temporização lá dentro
    // espera pelo estado final, ou não é a captura daquele ecrã.
    await expect(
      page.getByRole("status"),
      "a contagem não apareceu em dois segundos — a captura seria de um ecrã " +
        "a meio, não do ecrã da pesquisa",
    ).toHaveText(/produtos? encontrados?\./);

    await guardar("390-ementa-pesquisa", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a pesquisa sem resultados", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await lupa(page).click();
    await campoDePesquisa(page).fill("xkcd");
    await expect(page.getByText(TEXTOS_DA_EMENTA.semResultadosLinha)).toBeVisible();

    // A mesma espera, e a mesma razão — aqui o que chega 500 ms depois é
    // invisível (a região viva passa a `sr-only`, 4.5), por isso a imagem
    // não muda. Fica na mesma: a regra é esperar pelo estado final, e um
    // ecrã que se mede pela imagem **e** pelo que o leitor de ecrã ouve não
    // está assente enquanto a segunda metade não chegou.
    await expect(page.getByRole("status")).toHaveText(TEXTOS_DA_EMENTA.semResultadosTitulo);

    await guardar("390-ementa-sem-resultados", (caminho) => page.screenshot({ path: caminho }));
  });

  test("o nome longo, que vai a duas linhas", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const cartao = page.locator("section[id='ementa-sandes']");
    await expect(
      cartao,
      "não encontrei o cartão das sandes — é o que tem o nome longo de 6.3",
    ).toBeVisible();
    await cartao.scrollIntoViewIfNeeded();

    await guardar("390-ementa-nome-longo", (caminho) => cartao.screenshot({ path: caminho }));
  });

  test("o anel de foco num chip, sobre o painel", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(chips(page)).not.toHaveCount(0);

    await capturarComAnel(page, chips(page).first(), "390-ementa-foco-chip");
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("uma coluna só, com a barra de lado a lado", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(cartoes(page)).not.toHaveCount(0);

    await guardar("1024-ementa", (caminho) => page.screenshot({ path: caminho, fullPage: true }));
  });

  test("a 1024 px continua a ser uma coluna só, contida", async ({ page }) => {
    // Duas colunas de cartões partiam a ordem de leitura e tornavam "a
    // última categoria cujo título passou a linha" uma pergunta sem
    // resposta — o scroll-spy depende de haver uma ordem vertical única
    // (secção 10).
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const esquerdas = await cartoes(page).evaluateAll((elementos) =>
      elementos.map((elemento) => Math.round(elemento.getBoundingClientRect().left)),
    );

    expect(esquerdas.length, "guarda: não há cartões para medir").toBeGreaterThan(3);
    expect(
      new Set(esquerdas).size,
      `os cartões começam em ${String(new Set(esquerdas).size)} posições horizontais ` +
        "diferentes: a 1024 px a ementa continua a ser uma coluna só",
    ).toBe(1);
  });
});
