import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS_DA_EMENTA_GESTAO as T, TEXTOS_DA_GESTAO as G } from "../src/testes/gestao";
import { guardar } from "./apoio/capturas";
import { fingirApiDeSessao } from "./apoio/gestao";
import { fingirApiDeEmenta } from "./apoio/gestao-ementa";

/**
 * F4-02 — as capturas que a revisão ui-ux e o PR abrem (390 × 844 e 1024 × 768).
 * Não comparam com imagem de referência. Vão para `test-results/capturas/`.
 */
const VINHO = /^Alterar o preço de Vinho tinto da casa/;

async function abrir(
  page: Page,
  caminho: string,
  opcoes: Parameters<typeof fingirApiDeEmenta>[1] = {},
): Promise<void> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  await fingirApiDeEmenta(page, { sessao, ...opcoes });
  await page.goto(caminho);
  await expect(page.getByRole("heading", { level: 1, name: "Ementa" })).toBeVisible();
}

async function mudarPreco(page: Page, valor: string): Promise<void> {
  await page.getByRole("button", { name: VINHO }).tap();
  await page.getByLabel(T.etiquetaDoPreco).fill(valor);
  await page.getByRole("button", { name: T.guardar }).tap();
}

test.describe("telemóvel, 390 × 844", () => {
  test("a lista, o preço, os avisos e o modo «Ordenar»", async ({ page }) => {
    await abrir(page, "/gestao/ementa?categoria=garrafeira");
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await guardar("gestao-ementa-390-lista", (path) => page.screenshot({ path }));

    await page.getByRole("button", { name: VINHO }).tap();
    await guardar("gestao-ementa-390-preco-em-edicao", (path) => page.screenshot({ path }));

    await page.getByLabel(T.etiquetaDoPreco).fill("7,5");
    await page.getByRole("button", { name: T.guardar }).tap();
    await expect(page.getByText("Preço atualizado para 7,50 €.")).toBeVisible();
    await guardar("gestao-ementa-390-aviso-preco", (path) => page.screenshot({ path }));

    await mudarPreco(page, "0");
    await expect(page.getByText(T.avisoOferta)).toBeVisible();
    await guardar("gestao-ementa-390-aviso-oferta", (path) => page.screenshot({ path }));

    await mudarPreco(page, "6,5");
    await mudarPreco(page, "65");
    await expect(page.getByText(/Antes era 6,50/)).toBeVisible();
    await guardar("gestao-ementa-390-aviso-dez-vezes", (path) => page.screenshot({ path }));
  });

  test("o modo «Ordenar» e as folhas", async ({ page }) => {
    await abrir(page, "/gestao/ementa");
    await page.getByRole("button", { name: T.ordenar }).tap();
    await expect(page.getByText("A ordenar Cafetaria.")).toBeVisible();
    await guardar("gestao-ementa-390-ordenar", (path) => page.screenshot({ path }));
    await page.getByRole("button", { name: T.cancelar }).tap();

    await page.getByRole("button", { name: T.adicionarProduto }).tap();
    await expect(page.getByRole("dialog", { name: T.tituloAdicionar })).toBeVisible();
    await guardar("gestao-ementa-390-folha-adicionar", (path) => page.screenshot({ path }));
    await page.getByRole("button", { name: T.cancelar }).tap();

    await page.getByRole("button", { name: "Café", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: T.tituloEditar })).toBeVisible();
    await guardar("gestao-ementa-390-folha-editar", (path) => page.screenshot({ path }));
  });

  test("vazio, erro de rede e erro do servidor", async ({ page }) => {
    await abrir(page, "/gestao/ementa", { categorias: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await guardar("gestao-ementa-390-vazio", (path) => page.screenshot({ path }));
  });

  test("erro de rede", async ({ page }) => {
    await abrir(page, "/gestao/ementa", {
      falhas: [{ metodo: "GET", caminho: /categorias$/, resposta: "abortar" }],
    });
    await expect(page.getByText(T.erroDeCarregarTitulo)).toBeVisible();
    await guardar("gestao-ementa-390-erro-de-rede", (path) => page.screenshot({ path }));
  });

  test("erro do servidor", async ({ page }) => {
    await abrir(page, "/gestao/ementa", {
      falhas: [
        {
          metodo: "GET",
          caminho: /categorias$/,
          resposta: { estado: 500, corpo: { erro: "interno", mensagem: "x" } },
        },
      ],
    });
    await expect(page.getByText(T.erroDeCarregarServidor)).toBeVisible();
    await guardar("gestao-ementa-390-erro-do-servidor", (path) => page.screenshot({ path }));
  });

  test("o login com «A sessão terminou»", async ({ page }) => {
    const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
    await fingirApiDeEmenta(page, {
      sessao,
      falhas: [
        {
          metodo: "PATCH",
          caminho: /\/gestao\/produtos\/201$/,
          resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
          fechaSessao: true,
        },
      ],
    });
    await page.goto("/gestao/ementa?categoria=garrafeira");
    await mudarPreco(page, "7");
    await expect(page.getByRole("heading", { level: 1, name: G.tituloDoLogin })).toBeVisible();
    await expect(page.getByText(T.sessaoTerminou)).toBeVisible();
    await guardar("gestao-ementa-390-login-sessao-terminou", (path) => page.screenshot({ path }));
  });
});

test.describe("computador, 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("a lista e o modo «Ordenar»", async ({ page }) => {
    await abrir(page, "/gestao/ementa?categoria=garrafeira");
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await guardar("gestao-ementa-1024-lista", (path) => page.screenshot({ path }));

    await page.getByRole("link", { name: "Cafetaria" }).click();
    await page.getByRole("button", { name: T.ordenar }).click();
    await expect(page.getByText("A ordenar Cafetaria.")).toBeVisible();
    await guardar("gestao-ementa-1024-ordenar", (path) => page.screenshot({ path }));
  });
});
