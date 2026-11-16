import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS_DA_EMENTA_GESTAO as E, TEXTOS_DA_GESTAO as T } from "../src/testes/gestao";
import { fingirApiDeSessao } from "./apoio/gestao";
import { fingirApiDeEmenta } from "./apoio/gestao-ementa";

/**
 * F4-02, decisão D4 — o 401 leva ao login («A sessão terminou. Entra outra vez.»),
 * depois de entrar volta ao destino de origem, e **não há redirecionamento
 * aberto**. O destino e o aviso viajam no `history.state`: o endereço do login é
 * sempre `/gestao/entrar`, e um `?voltar=` num link é ignorado.
 */

async function entrar(pagina: Page): Promise<void> {
  await pagina.getByLabel(T.etiquetaUtilizador).fill("dono");
  await pagina.getByLabel(T.etiquetaPassword).fill("password-de-teste");
  await pagina.getByRole("button", { name: T.botaoEntrar }).click();
}

test.describe("401 a meio da gestão", () => {
  test("o PATCH do preço dá 401: login com o aviso; entrar volta à ementa, com o <h1> focado; Voltar não regressa ao login", async ({
    page,
  }) => {
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
    await page.getByRole("button", { name: /^Alterar o preço de Vinho tinto da casa/ }).tap();
    await page.getByLabel("Preço, em euros").fill("7");
    await page.getByRole("button", { name: E.guardar }).tap();

    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/gestao/entrar");
    expect(url.search, "o destino nunca vai no endereço").toBe("");
    await expect(page.getByText(E.sessaoTerminou)).toBeVisible();
    const resultado = await new AxeBuilder({ page }).analyze();
    expect(
      resultado.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
    ).toEqual([]);

    await entrar(page);

    await expect(page.getByRole("heading", { level: 1, name: "Ementa" })).toBeFocused();
    const depois = new URL(page.url());
    expect(depois.pathname).toBe("/gestao/ementa");
    expect(depois.search).toBe("?categoria=garrafeira");

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toHaveCount(0);
  });
});

test.describe("sem redirecionamento aberto", () => {
  const MALICIOSOS = [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/gestao/../",
  ];

  for (const valor of MALICIOSOS) {
    test(`?voltar=${valor} é ignorado: entrar vai ao Início, na mesma origem, sem pedidos nem alertas`, async ({
      page,
    }) => {
      await fingirApiDeSessao(page);
      const pedidos: string[] = [];
      const dialogos: string[] = [];
      page.on("request", (p) => pedidos.push(p.url()));
      page.on("dialog", (d) => {
        dialogos.push(d.message());
        void d.dismiss();
      });

      await page.goto(`/gestao/entrar?voltar=${encodeURIComponent(valor)}`);
      const origem = new URL(page.url()).origin;
      await entrar(page);

      await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
      const url = new URL(page.url());
      expect(url.pathname).toBe("/gestao");
      expect(url.origin).toBe(origem);
      // O endereço do próprio `goto` leva `evil.example` na pesquisa: o que não pode
      // haver é um pedido **para** esse servidor.
      expect(pedidos.filter((u) => new URL(u).hostname.includes("evil"))).toEqual([]);
      expect(dialogos).toEqual([]);
    });
  }

  test("?voltar= válido no endereço, sem estado, também vai ao Início (o endereço não conta)", async ({
    page,
  }) => {
    await fingirApiDeSessao(page);
    await page.goto("/gestao/entrar?voltar=%2Fgestao%2Fementa");
    await entrar(page);
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao");
  });

  test("o aviso «A sessão terminou» não se fabrica com um link", async ({ page }) => {
    await fingirApiDeSessao(page);
    await page.goto("/gestao/entrar?voltar=%2Fgestao%2Fementa&sessaoTerminou=true");
    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    await expect(page.getByText(E.sessaoTerminou)).toHaveCount(0);
  });

  test("a guarda à chegada: /gestao/eventos sem sessão → login SEM o aviso → entrar volta a /gestao/eventos", async ({
    page,
  }) => {
    await fingirApiDeSessao(page);
    await page.goto("/gestao/eventos");
    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    await expect(page.getByText(E.sessaoTerminou)).toHaveCount(0);
    await entrar(page);
    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/eventos");
  });
});
