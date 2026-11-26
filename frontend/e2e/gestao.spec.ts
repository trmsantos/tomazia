import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS as TEXTOS_DAS_DEFINICOES } from "../src/pages/gestao/definicoes/textos";
import { TEXTOS_DA_GESTAO as T } from "../src/testes/gestao";
import { fingirInfoFixo } from "./apoio/cabecalho";
import { guardar } from "./apoio/capturas";
import { fingirEmentaFixa } from "./apoio/ementa";
import { fingirEventosFixos } from "./apoio/eventos";
import { RESPOSTA_400, fingirApiDeSessao, resposta429 } from "./apoio/gestao";
import { fingirApiDeEventos } from "./apoio/gestao-eventos";
import { fingirApiDasFotos } from "./apoio/gestao-fotos";
import { SEM_EVENTOS } from "../src/testes/eventos";

/**
 * F4-01 — a gestão a sério no browser: o que o jsdom não vê (layout, 44 px, a
 * barra contra o token, o axe) e os fluxos inteiros (guarda, login, navegação,
 * «Sair»). A API é fingida por `page.route`.
 */

const ROTULOS = ["Início", "Ementa", "Eventos", "Galeria", "Mais"];

function navegacao(pagina: Page) {
  return pagina.getByRole("navigation", { name: T.navegacao });
}

async function semViolacoesGraves(pagina: Page, ecra: string): Promise<void> {
  const resultado = await new AxeBuilder({ page: pagina }).analyze();
  const graves = resultado.violations.filter(
    (violacao) => violacao.impact === "serious" || violacao.impact === "critical",
  );
  expect(
    graves.map((violacao) => `[${ecra}] ${violacao.id}: ${violacao.help}`),
    "o axe achou violações sérias ou críticas (Q-03)",
  ).toEqual([]);
}

async function entrarNaGestao(pagina: Page): Promise<void> {
  await pagina.goto("/gestao/entrar");
  await pagina.getByLabel(T.etiquetaUtilizador).fill("dono");
  await pagina.getByLabel(T.etiquetaPassword).fill("password-de-teste");
  await pagina.getByRole("button", { name: T.botaoEntrar }).click();
  await expect(pagina.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
}

test.describe("o login e a guarda, a 390 × 844", () => {
  test("sem sessão, /gestao/ementa leva ao login, a substituir", async ({ page }) => {
    await fingirApiDeSessao(page);
    await page.goto("/gestao/ementa");

    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/entrar");
    await semViolacoesGraves(page, "login");
  });

  test("duas falhas 400 e um 429 com o tempo, e nunca a password no endereço", async ({ page }) => {
    await fingirApiDeSessao(page, {
      respostasDoLogin: [RESPOSTA_400, RESPOSTA_400, resposta429(125)],
    });
    await page.goto("/gestao/entrar");
    const entrar = page.getByRole("button", { name: T.botaoEntrar });
    await page.getByLabel(T.etiquetaUtilizador).fill("dono");
    await page.getByLabel(T.etiquetaPassword).fill("errada");

    await entrar.click();
    await expect(page.locator("#login-mensagem")).toContainText(
      "Utilizador ou password inválidos.",
    );
    await expect(page.getByLabel(T.etiquetaPassword)).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#login-mensagem")).toBeFocused();
    await semViolacoesGraves(page, "login 400");

    await entrar.click();
    await expect(page.locator("#login-mensagem")).toContainText(
      "Utilizador ou password inválidos.",
    );

    await entrar.click();
    await expect(page.locator("#login-mensagem")).toContainText(
      "A conta está bloqueada por causa de várias tentativas falhadas.",
    );
    await expect(page.locator("#login-mensagem")).toContainText("daqui a 3 minutos");
    await expect(entrar).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByLabel(T.etiquetaPassword)).not.toHaveAttribute("aria-invalid", "true");
    await semViolacoesGraves(page, "login 429");

    expect(page.url()).not.toContain("password");
    expect(page.url()).not.toContain("errada");
  });

  test("com credenciais certas vai ao Início com a barra inferior", async ({ page }) => {
    await fingirApiDeSessao(page);
    await entrarNaGestao(page);

    expect(new URL(page.url()).pathname).toBe("/gestao");
    await expect(navegacao(page)).toBeVisible();
    await expect(navegacao(page).getByRole("link", { name: "Início" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await semViolacoesGraves(page, "início");
  });

  test("a rede a falhar no /auth/eu não leva ao login", async ({ page }) => {
    await page.route("**/api/auth/eu", (rota) => rota.abort("failed"));
    await page.goto("/gestao/ementa");

    await expect(page.getByText(T.erroDaGuardaTitulo)).toBeVisible();
    await expect(page.getByRole("button", { name: T.tentarOutraVez })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/ementa");
    await semViolacoesGraves(page, "erro da guarda");
  });
});

test.describe("a moldura, a 390 × 844", () => {
  test.beforeEach(async ({ page }) => {
    await fingirApiDeSessao(page, { sessaoAberta: true });
  });

  test("a barra: cinco alvos de 44 px, rótulos inteiros e a altura do token", async ({ page }) => {
    await page.goto("/gestao");
    await expect(navegacao(page)).toBeVisible();

    const ligacoes = navegacao(page).getByRole("link");
    await expect(ligacoes).toHaveCount(5);
    for (const rotulo of ROTULOS) {
      const ligacao = navegacao(page).getByRole("link", { name: rotulo });
      const caixa = await ligacao.boundingBox();
      expect(caixa?.height ?? 0, `${rotulo}: altura`).toBeGreaterThanOrEqual(44);
      expect(caixa?.width ?? 0, `${rotulo}: largura`).toBeGreaterThanOrEqual(44);
      const cortado = await ligacao.evaluate((no) => no.scrollWidth > no.clientWidth);
      expect(cortado, `${rotulo} cortado`).toBe(false);
    }

    const medida = await page.evaluate(() => {
      const barra = document.querySelector("nav")?.getBoundingClientRect().height ?? 0;
      const sonda = document.createElement("div");
      sonda.style.height = "var(--altura-barra-gestao)";
      document.body.appendChild(sonda);
      const token = sonda.getBoundingClientRect().height;
      sonda.remove();
      return { barra, token };
    });
    expect(medida.barra).toBeCloseTo(medida.token, 1);
  });

  test("tocar em Eventos muda o endereço e o aria-current; o Recuar volta", async ({ page }) => {
    // Eventos pede a sua API: fingida, para não depender de um backend real na 8070.
    await fingirApiDeEventos(page);
    await page.goto("/gestao");
    await navegacao(page).getByRole("link", { name: "Eventos" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/eventos");
    await expect(navegacao(page).getByRole("link", { name: "Eventos" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao");
  });

  test("os cinco destinos sem violações sérias do axe", async ({ page }) => {
    // F4-04: a Galeria pede a fila de moderação; a API das fotos fica fingida (com fotos: o
    // destino «Galeria» é o ecrã de moderação e não o vazio de lançamento).
    await fingirApiDasFotos(page);
    for (const caminho of [
      "/gestao",
      "/gestao/ementa",
      "/gestao/eventos",
      "/gestao/galeria",
      "/gestao/mais",
    ]) {
      await page.goto(caminho);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await semViolacoesGraves(page, caminho);
    }
  });

  test("«Mais» é uma lista com «Definições» (para /gestao/mais/definicoes) e, por baixo, «Sair» (F4-05a)", async ({
    page,
  }) => {
    await page.goto("/gestao/mais");
    const ligacao = page.getByRole("link", {
      name: new RegExp(`^${TEXTOS_DAS_DEFINICOES.ligacaoNoMais}`),
    });
    await expect(ligacao).toBeVisible();
    await expect(ligacao).toHaveAttribute("href", "/gestao/mais/definicoes");
    const a = await ligacao.boundingBox();
    const b = await page.getByRole("button", { name: T.sair }).boundingBox();
    expect((a?.y ?? 0) + (a?.height ?? 0)).toBeLessThanOrEqual(b?.y ?? 0);
    await semViolacoesGraves(page, "mais com definições");
  });

  test("«Sair» leva ao login e o Voltar não mostra a gestão", async ({ page }) => {
    await page.goto("/gestao");
    await navegacao(page).getByRole("link", { name: "Mais" }).click();
    await page.getByRole("button", { name: T.sair }).click();

    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/entrar");

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    await expect(navegacao(page)).toHaveCount(0);
  });

  test("abrir o público não pede nada da gestão", async ({ page }) => {
    const servidor = await fingirApiDeSessao(page, { sessaoAberta: true });
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirEventosFixos(page, SEM_EVENTOS);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(servidor.pedidosAoChunkDaGestao).toEqual([]);

    // Controlo positivo (regra 10): com o mesmo padrão, uma visita à gestão
    // TEM de registar pedidos. Sem isto, a lista vazia acima também era o que
    // se veria se o padrão deixasse de corresponder ao URL real.
    await page.goto("/gestao");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    expect(
      servidor.pedidosAoChunkDaGestao.length,
      "o padrão não apanha o ficheiro da gestão: o teste de cima não prova nada",
    ).toBeGreaterThan(0);
  });
});

test.describe("a 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("coluna lateral de 240 px, sem barra inferior", async ({ page }) => {
    await fingirApiDeSessao(page, { sessaoAberta: true });
    await page.goto("/gestao/ementa");

    const nav = navegacao(page);
    await expect(nav).toBeVisible();
    const caixa = await nav.boundingBox();
    expect(caixa?.width).toBeCloseTo(240, 0);
    expect(caixa?.x).toBe(0);
    expect(caixa?.y).toBe(0);
    await expect(navegacao(page).getByRole("link", { name: "Ementa" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await semViolacoesGraves(page, "coluna lateral");
  });
});

/**
 * Q-03 (secção 12): o axe em todos os estados, nas duas larguras — login
 * inicial, 400 e 429, «a abrir», erro da guarda e os cinco destinos.
 */
for (const [largura, altura] of [
  [390, 844],
  [1024, 768],
] as const) {
  test.describe(`o axe em todos os estados, a ${String(largura)} × ${String(altura)}`, () => {
    test.use({
      viewport: { width: largura, height: altura },
      isMobile: largura < 1024,
      hasTouch: largura < 1024,
    });

    test("login inicial, 400 e 429", async ({ page }) => {
      await fingirApiDeSessao(page, {
        respostasDoLogin: [RESPOSTA_400, resposta429(125)],
      });
      await page.goto("/gestao/entrar");
      await expect(page.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
      await semViolacoesGraves(page, `login inicial ${String(largura)}`);

      await page.getByLabel(T.etiquetaUtilizador).fill("dono");
      await page.getByLabel(T.etiquetaPassword).fill("errada");
      await page.getByRole("button", { name: T.botaoEntrar }).click();
      await expect(page.locator("#login-mensagem")).toContainText("inválidos");
      await semViolacoesGraves(page, `login 400 ${String(largura)}`);

      await page.getByRole("button", { name: T.botaoEntrar }).click();
      await expect(page.locator("#login-mensagem")).toContainText("daqui a 3 minutos");
      await semViolacoesGraves(page, `login 429 ${String(largura)}`);
    });

    test("a abrir", async ({ page }) => {
      await page.route("**/api/auth/eu", () => undefined);
      await page.goto("/gestao");
      await expect(page.getByText(T.aAbrir)).toBeVisible();
      await semViolacoesGraves(page, `a abrir ${String(largura)}`);
    });

    test("erro da guarda", async ({ page }) => {
      await page.route("**/api/auth/eu", (rota) => rota.abort("failed"));
      await page.goto("/gestao");
      await expect(page.getByText(T.erroDaGuardaTitulo)).toBeVisible();
      await semViolacoesGraves(page, `erro da guarda ${String(largura)}`);
    });

    test("os cinco destinos", async ({ page }) => {
      await fingirApiDeSessao(page, { sessaoAberta: true });
      await fingirApiDasFotos(page);
      for (const caminho of [
        "/gestao",
        "/gestao/ementa",
        "/gestao/eventos",
        "/gestao/galeria",
        "/gestao/mais",
      ]) {
        await page.goto(caminho);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await semViolacoesGraves(page, `${caminho} ${String(largura)}`);
      }
    });
  });
}

/**
 * As capturas que a revisão ui-ux abre (`frontend/test-results/capturas/`, fora
 * do git): login inicial, 400, 429, a abrir, o erro da guarda, Início, Ementa e
 * Mais, a 390 e a 1024.
 */
async function capturar(pagina: Page, nome: string): Promise<void> {
  await guardar(nome, (caminho) => pagina.screenshot({ path: caminho }));
}

async function capturarTudo(pagina: Page, largura: string): Promise<void> {
  const servidor = await fingirApiDeSessao(pagina, {
    respostasDoLogin: [RESPOSTA_400, resposta429(125)],
  });
  await pagina.goto("/gestao/entrar");
  await capturar(pagina, `${largura}-gestao-entrar`);

  await pagina.getByLabel(T.etiquetaUtilizador).fill("dono");
  await pagina.getByLabel(T.etiquetaPassword).fill("errada");
  await pagina.getByRole("button", { name: T.botaoEntrar }).click();
  await expect(pagina.locator("#login-mensagem")).toBeVisible();
  await capturar(pagina, `${largura}-gestao-entrar-400`);

  await pagina.getByRole("button", { name: T.botaoEntrar }).click();
  await expect(pagina.locator("#login-mensagem")).toContainText("daqui a 3 minutos");
  await capturar(pagina, `${largura}-gestao-entrar-429`);

  servidor.sessaoAberta = true;
  for (const [caminho, nome] of [
    ["/gestao", "inicio"],
    ["/gestao/ementa", "ementa"],
    ["/gestao/mais", "mais"],
  ] as const) {
    await pagina.goto(caminho);
    await expect(pagina.getByRole("heading", { level: 1 })).toBeVisible();
    await capturar(pagina, `${largura}-gestao-${nome}`);
  }
}

test.describe("capturas a 390 × 844", () => {
  test("login, 400, 429, Início, Ementa e Mais", async ({ page }) => {
    await capturarTudo(page, "390");
  });

  test("a abrir e o erro da guarda", async ({ page }) => {
    // O `/auth/eu` fica por responder: é o ecrã «A abrir a gestão…».
    await page.route("**/api/auth/eu", () => undefined);
    await page.goto("/gestao");
    await expect(page.getByText(T.aAbrir)).toBeVisible();
    await semViolacoesGraves(page, "a abrir");
    await capturar(page, "390-gestao-a-abrir");
  });

  test("o erro da guarda", async ({ page }) => {
    await page.route("**/api/auth/eu", (rota) => rota.abort("failed"));
    await page.goto("/gestao");
    await expect(page.getByText(T.erroDaGuardaTitulo)).toBeVisible();
    await capturar(page, "390-gestao-erro");
  });
});

test.describe("capturas a 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("login, 400, 429, Início, Ementa e Mais", async ({ page }) => {
    await capturarTudo(page, "1024");
  });
});
