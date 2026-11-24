import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { EMENTA_VAZIA } from "../src/testes/ementa";
import {
  EMENTA_DE_TESTE,
  TEXTOS_DA_EMENTA,
  abrirAEmenta,
  barra,
  cartoes,
  chips,
  fingirAEmenta,
  type Resposta,
} from "./apoio/ementa";

/**
 * F3-02, 12.7 — os três estados são três ecrãs.
 *
 * A lição da F3-01 em forma de requisito: **os três têm de se distinguir
 * sem ler as palavras.** O `EstadoVazio` tem `tom` por causa disto — e foi
 * precisamente assim que a F3-01 apanhou o defeito: a classe que distinguia
 * o erro estava num contentor de fora, sobreposta e morta, e os dois ecrãs
 * saíam iguais ao píxel. Todas as asserções de presença continuavam verdes.
 *
 * **O que este ficheiro prova:** o estado a carregar leva
 * `aria-busy="true"` e os outros dois não; a cor **computada** do título do
 * erro é diferente da cor computada do título do vazio (a cor, não a
 * classe); só o erro tem um botão "Tentar outra vez"; e a barra de
 * categorias não existe em nenhum dos três.
 *
 * **O que deixa passar, se ficasse por aqui:** que o "Tentar outra vez"
 * funcione. Por isso o último teste carrega-lhe, com o `route` a passar a
 * responder bem, e espera pelos cartões.
 */

/** O corpo demora o suficiente para o esqueleto se deixar fotografar. */
const ATRASO_DO_ESQUELETO = 3000;

async function corDoTitulo(pagina: Page, texto: string): Promise<string> {
  const titulo = pagina.getByText(texto, { exact: true }).first();
  await expect(titulo).toBeVisible();
  return titulo.evaluate((elemento) => getComputedStyle(elemento).color);
}

test.describe("a carregar", () => {
  test("tem `aria-busy`, não tem chips e não diz «a carregar»", async ({ page }) => {
    await fingirAEmenta(page, () => ({
      tipo: "ementa",
      corpo: EMENTA_DE_TESTE,
      atrasoMs: ATRASO_DO_ESQUELETO,
    }));
    await page.goto("/");

    await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(chips(page)).toHaveCount(0);
    await expect(
      page.locator("body"),
      "o esqueleto tem a forma do que vem a seguir; não leva texto de espera (5.1)",
    ).not.toContainText(/a carregar/i);

    // E o esqueleto é creme sobre bordô, que é a cara do site.
    await expect(page.locator(".superficie-creme")).not.toHaveCount(0);
  });

  test("o esqueleto não tem nada em que se possa carregar", async ({ page }) => {
    await fingirAEmenta(page, () => ({
      tipo: "ementa",
      corpo: EMENTA_DE_TESTE,
      atrasoMs: ATRASO_DO_ESQUELETO,
    }));
    await page.goto("/");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);

    const dentroDaBarra = barra(page).locator("a, [tabindex]");
    await expect(
      dentroDaBarra,
      "um chip falso em que se pode carregar é pior do que uma barra vazia (5.1)",
    ).toHaveCount(0);
  });
});

test.describe("vazia", () => {
  test("diz o que diz, sem botão e sem barra", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "ementa", corpo: EMENTA_VAZIA }));
    await abrirAEmenta(page);

    await expect(page.getByText(TEXTOS_DA_EMENTA.vaziaTitulo)).toBeVisible();
    await expect(page.getByText(TEXTOS_DA_EMENTA.vaziaLinha)).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(chips(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez }),
      "não há nada que quem está sentado possa carregar para resolver isto (5.2)",
    ).toHaveCount(0);
  });
});

test.describe("erro", () => {
  test("sem resposta e com resposta dizem coisas diferentes", async ({ page }) => {
    // Muda-se a resposta e não as rotas: um `unrouteAll` levava também os
    // mocks dos eventos e da galeria do `abrirAEmenta`, e as duas secções
    // desenhavam-se em erro com a mesma frase que aqui se procura.
    let resposta: Resposta = { tipo: "falha" };
    await fingirAEmenta(page, () => resposta);
    await abrirAEmenta(page);

    await expect(page.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeVisible();
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroSemResposta)).toBeVisible();
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroComResposta)).toHaveCount(0);

    resposta = { tipo: "estado", estado: 500 };
    await page.reload();

    await expect(page.getByText(TEXTOS_DA_EMENTA.erroComResposta)).toBeVisible();
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroSemResposta)).toHaveCount(0);
  });

  test("a mensagem crua do servidor nunca chega ao ecrã", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "estado", estado: 500 }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeVisible();

    await expect(
      page.locator("body"),
      "o envelope do backend é escrito para quem chama a API, não para quem " +
        "está sentado à mesa (5.3)",
    ).not.toContainText("detalhe cru do servidor");
  });

  test("tem o botão, não tem `aria-busy` e não tem barra", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "falha" }));
    await abrirAEmenta(page);

    await expect(page.getByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(chips(page)).toHaveCount(0);
  });

  test("«Tentar outra vez» refaz o pedido e traz os cartões", async ({ page }) => {
    // A resposta muda por uma variável e não pelo número do pedido: em
    // desenvolvimento o `StrictMode` monta duas vezes, e um «o segundo
    // pedido corre bem» escrito à mão respondia bem ao arranque e nunca
    // chegava a mostrar o erro.
    const controlo = { falhar: true };
    const contador = await fingirAEmenta(page, () =>
      controlo.falhar ? { tipo: "falha" } : { tipo: "ementa", corpo: EMENTA_DE_TESTE },
    );
    await abrirAEmenta(page);

    const botao = page.getByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez });
    await expect(botao).toBeVisible();

    const antes = contador.total;
    controlo.falhar = false;
    await botao.click();

    await expect(cartoes(page)).not.toHaveCount(0);
    expect(contador.total, "o toque refaz mesmo o pedido").toBeGreaterThan(antes);

    // O foco passa para o `<h2>`: a pessoa ouve onde aterrou em vez de
    // ficar no vazio (5.3).
    await expect(
      page.getByRole("heading", { name: TEXTOS_DA_EMENTA.titulo, level: 2 }),
    ).toBeFocused();
  });

  test("não há repetição automática", async ({ page }) => {
    const contador = await fingirAEmenta(page, () => ({ tipo: "falha" }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeVisible();

    const assenteEm = contador.total;
    expect(assenteEm, "guarda: a página não chegou a pedir nada — não medi nada").toBeGreaterThan(
      0,
    );

    await page.waitForTimeout(3000);

    expect(
      contador.total,
      "uma repetição em ciclo esconde o problema e gasta dados de quem está numa " +
        "rede fraca. Uma pessoa, um toque, uma tentativa (5.3). Compara-se a " +
        "variação e não o total, porque o StrictMode do servidor de " +
        "desenvolvimento duplica o pedido de arranque.",
    ).toBe(assenteEm);
  });
});

test.describe("os três distinguem-se sem ler as palavras", () => {
  test("a cor computada do título do erro é diferente da do vazio", async ({ page }) => {
    let resposta: Resposta = { tipo: "ementa", corpo: EMENTA_VAZIA };
    await fingirAEmenta(page, () => resposta);
    await abrirAEmenta(page);
    const doVazio = await corDoTitulo(page, TEXTOS_DA_EMENTA.vaziaTitulo);

    resposta = { tipo: "falha" };
    await page.reload();
    const doErro = await corDoTitulo(page, TEXTOS_DA_EMENTA.erroTitulo);

    expect(
      doVazio,
      "guarda: não consegui ler a cor do título do vazio — não comparei nada",
    ).toMatch(/\d/);
    expect(
      doErro,
      "o erro e o vazio têm a mesma forma de propósito; se a cor também for a " +
        "mesma, os dois ecrãs deixam de se distinguir sem ler as palavras. " +
        "A classe pode lá estar e estar morta — é a cor computada que conta (F3-01, 7.7)",
    ).not.toBe(doVazio);
  });
});
