import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { eventosDoResumo } from "../src/testes/clientes-dados";
import { TEXTOS_CLIENTES as TC, TEXTOS_INICIO as T } from "../src/testes/clientes-gestao-textos";
import { TEXTOS as TF } from "../src/pages/gestao/galeria/textos";
import { TEXTOS_DA_GESTAO as TG } from "../src/testes/gestao";
import { fingirApiDasFotos, fingirSitePublico } from "./apoio/gestao-fotos";
import { fingirApiDeEventos } from "./apoio/gestao-eventos";
import { abrirInicio, leiturasDoResumo, linhaDeEstado, type Falha } from "./apoio/gestao-clientes";

/**
 * F4-05b — o Início no browser, a 390 × 844 com toque (e a 1024 × 768 para o rato). API fingida
 * (`apoio/gestao-clientes.ts`). O que o Vitest/jsdom **não** mede: o primeiro bloco **acima da
 * dobra** (o botão dourado a 44 px mesmo com três eventos), o dourado ser **um só**, os 44 px, o
 * anel de foco, o axe, e a data **de Lisboa** num aparelho que não está em Lisboa.
 */

async function semViolacoesGraves(pagina: Page, ecra: string): Promise<void> {
  await pagina.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const resultado = await new AxeBuilder({ page: pagina }).analyze();
  const graves = resultado.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    graves.map((v) => `[${ecra}] ${v.id}: ${v.help}`),
    "o axe achou violações sérias ou críticas (Q-03)",
  ).toEqual([]);
}

async function medida(alvo: Locator, nome: string, minimo = 44): Promise<void> {
  await alvo.first().scrollIntoViewIfNeeded();
  const caixa = await alvo.first().boundingBox();
  expect(caixa, `${nome}: tem caixa`).not.toBeNull();
  expect(caixa?.height ?? 0, `${nome}: altura`).toBeGreaterThanOrEqual(minimo);
  expect(caixa?.width ?? 0, `${nome}: largura`).toBeGreaterThanOrEqual(minimo);
}

function seccao(page: Page, titulo: string): Locator {
  return page.getByRole("region", { name: titulo });
}
function botao(onde: Page | Locator, nome: string): Locator {
  return onde.getByRole("button", { name: nome, exact: true });
}

test.describe("as três secções (critérios 1 a 3)", () => {
  test("<h1> Início e, por esta ordem, Fotos à espera, Próximos eventos, Novos registos; as frases de n, as datas de Lisboa", async ({
    page,
  }) => {
    await abrirInicio(page);

    await expect(page.getByRole("region")).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      T.fotosTitulo,
      T.eventosTitulo,
      T.registosTitulo,
    ]);
    await expect(seccao(page, T.fotosTitulo)).toContainText(T.fotosN(3));
    const eventos = seccao(page, T.eventosTitulo);
    await expect(eventos.getByRole("listitem")).toHaveCount(3);
    await expect(eventos).toContainText("Fado ao vivo");
    await expect(eventos).toContainText("Quinta-feira, 5 de novembro, às 22:00");
    await expect(eventos).toContainText("Sexta-feira, 6 de novembro, às 00:30");
    await expect(seccao(page, T.registosTitulo)).toContainText(T.registosN(2));
    await expect(page).toHaveTitle("Início — Gestão — Bar da Tomazia");
  });

  test("o primeiro bloco cabe no primeiro ecrã de 844 px, com a barra de navegação, e o botão (44 px) fica acima da dobra mesmo com três eventos", async ({
    page,
  }) => {
    await abrirInicio(page);
    const botaoDasFotos = page.getByRole("link", { name: T.irParaAFila });
    const caixa = await botaoDasFotos.boundingBox();
    const barra = await page.getByRole("navigation", { name: TG.navegacao }).boundingBox();
    expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((caixa?.y ?? 9999) + (caixa?.height ?? 0)).toBeLessThanOrEqual(barra?.y ?? 844);
    expect((caixa?.y ?? 9999) + (caixa?.height ?? 0)).toBeLessThanOrEqual(844);
  });

  test("com fotos há UM dourado na página; sem fotos, nenhum", async ({ page }) => {
    await abrirInicio(page);
    await expect(page.locator('main [class*="bg-acao"]')).toHaveCount(1);
  });

  test("0 fotos, 0 eventos, 0 registos: as três frases de zero, sem botão dourado", async ({
    page,
  }) => {
    await abrirInicio(page, { fotosPendentes: 0, eventos: [], novosRegistos: 0 });
    await expect(page.getByText(T.fotos0)).toBeVisible();
    await expect(page.getByText(T.eventosVazio)).toBeVisible();
    await expect(page.getByText(T.registos0)).toBeVisible();
    await expect(page.getByRole("link", { name: T.irParaAFila })).toHaveCount(0);
    await expect(page.locator('main [class*="bg-acao"]')).toHaveCount(0);
    // A ligação dos eventos é o caminho para criar um; a dos clientes está sempre.
    await expect(page.getByRole("link", { name: T.verOsEventos })).toBeVisible();
    await expect(page.getByRole("link", { name: T.verOsClientes })).toBeVisible();
  });

  test("1 foto e 1 registo: o singular", async ({ page }) => {
    await abrirInicio(page, { fotosPendentes: 1, novosRegistos: 1, eventos: eventosDoResumo(1) });
    await expect(page.getByText(T.fotos1)).toBeVisible();
    await expect(page.getByText(T.registos1)).toBeVisible();
  });

  test.describe("a data é a de Lisboa num aparelho noutro fuso", () => {
    test.use({ timezoneId: "Pacific/Auckland" });
    test("Quinta-feira, 5 de novembro, às 22:00 (e não a hora de Auckland)", async ({ page }) => {
      await abrirInicio(page);
      await expect(page.getByText("Quinta-feira, 5 de novembro, às 22:00")).toBeVisible();
    });
  });
});

test.describe("as ligações", () => {
  test("«Ir para a fila de fotos» leva à Galeria e o foco vai ao <h1> dela", async ({ page }) => {
    await abrirInicio(page, {
      antesDeAbrir: async (p) => {
        await fingirApiDasFotos(p, { inicial: [] });
        await fingirSitePublico(p);
      },
    });

    await page.getByRole("link", { name: T.irParaAFila }).tap();

    await expect(page.getByRole("heading", { level: 1, name: TF.titulo })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/galeria");
  });

  test("«Ver os eventos» leva a Eventos; as linhas de evento NÃO são ligações", async ({
    page,
  }) => {
    await abrirInicio(page, {
      antesDeAbrir: async (p) => {
        await fingirApiDeEventos(p);
      },
    });
    await expect(seccao(page, T.eventosTitulo).locator("a")).toHaveCount(1);
    await expect(seccao(page, T.eventosTitulo).getByRole("listitem").locator("a")).toHaveCount(0);

    await page.getByRole("link", { name: T.verOsEventos }).tap();

    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/eventos");
  });

  test("«Ver os clientes» leva à lista de Clientes com o foco no <h1> (e a lista carrega)", async ({
    page,
  }) => {
    await abrirInicio(page);

    await page.getByRole("link", { name: T.verOsClientes }).tap();

    await expect(page.getByRole("heading", { level: 1, name: TC.titulo })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/clientes");
    await expect(page.getByRole("heading", { level: 2, name: TC.h2N(4) })).toBeVisible();
  });

  test("a ordem de tabulação do Início: Ir para a fila de fotos, Ver os eventos, Ver os clientes", async ({
    page,
  }) => {
    await abrirInicio(page);
    await page.getByRole("link", { name: T.irParaAFila }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: T.verOsEventos })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: T.verOsClientes })).toBeFocused();
  });
});

test.describe("estados (critério 4)", () => {
  test("erro a carregar (sem resposta): as duas coisas e «Tentar outra vez», que recupera; a barra de navegação continua a funcionar", async ({
    page,
  }) => {
    // O servidor de desenvolvimento corre no `StrictMode` (efeitos montados duas vezes): a falha
    // vale **enquanto** `falhar` for verdade, não «só a primeira vez».
    let falhar = true;
    const falhas: Falha[] = [
      { metodo: "GET", caminho: /^\/gestao\/resumo$/, quando: () => falhar, resposta: "abortar" },
    ];
    const { servidor } = await abrirInicio(page, { falhas });

    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await expect(page.getByText(T.erroSemResposta)).toBeVisible();
    await expect(page.getByText(T.fotos0)).toHaveCount(0);
    await expect(page.getByText(T.registos0)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ementa" })).toBeVisible();
    const antes = leiturasDoResumo(servidor);
    falhar = false;

    await botao(page, T.tentarOutraVez).tap();

    await expect(seccao(page, T.fotosTitulo)).toContainText(T.fotosN(3));
    expect(leiturasDoResumo(servidor), "«Tentar outra vez» refaz o GET").toBeGreaterThan(antes);
  });

  test("500: o problema é nosso; um corpo ilegível também — e nunca zeros", async ({ page }) => {
    await abrirInicio(page, {
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/resumo$/, resposta: { estado: 500 } }],
    });
    await expect(page.getByText(T.erroServidor)).toBeVisible();
    await expect(page.getByText(T.fotos0)).toHaveCount(0);
  });

  test("corpo ilegível (fotos_pendentes negativo): erro, nunca «Não há fotos à espera.»", async ({
    page,
  }) => {
    await abrirInicio(page, { fotosPendentes: -1 });
    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await expect(page.getByText(T.fotos0)).toHaveCount(0);
  });

  test("a carregar: esqueleto sem texto (e nada de números)", async ({ page }) => {
    await abrirInicio(page, { atrasoMs: 1500, esperar: false });
    const esqueleto = page.locator('main [aria-busy="true"]');
    await expect(esqueleto.first()).toBeVisible();
    expect((await esqueleto.first().innerText()).trim()).toBe("");
    await expect(page.getByRole("link", { name: T.verOsEventos })).toHaveCount(0);
  });

  test("um 401 leva ao login; entrar volta a /gestao e o resumo carrega", async ({ page }) => {
    const falhas: Falha[] = [
      {
        metodo: "GET",
        caminho: /^\/gestao\/resumo$/,
        vezes: 1,
        resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
        fechaSessao: true,
      },
    ];
    await abrirInicio(page, { falhas, esperar: false });

    await expect(page.getByRole("heading", { level: 1, name: TG.tituloDoLogin })).toBeVisible();
    await page.getByLabel(TG.etiquetaUtilizador).fill("dono");
    await page.getByLabel(TG.etiquetaPassword).fill("segredo-de-teste");
    await page.getByRole("button", { name: TG.botaoEntrar, exact: true }).tap();

    await expect(seccao(page, T.fotosTitulo)).toContainText(T.fotosN(3));
    expect(new URL(page.url()).pathname).toBe("/gestao");
  });

  test("cada visita lê outra vez; a aba que volta relê em silêncio e, se falha, mantém os números", async ({
    page,
  }) => {
    const { servidor } = await abrirInicio(page);
    const antes = leiturasDoResumo(servidor);
    expect(
      antes,
      "uma visita lê (no `StrictMode` de desenvolvimento, duas)",
    ).toBeGreaterThanOrEqual(1);
    servidor.fotosPendentes = 7;

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByText(T.fotosN(7))).toBeVisible();
    expect(leiturasDoResumo(servidor), "a volta à aba lê UMA vez").toBe(antes + 1);

    servidor.falhas.push({ metodo: "GET", caminho: /^\/gestao\/resumo$/, resposta: "abortar" });
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(linhaDeEstado(page, T.desatualizado)).toBeVisible();
    await expect(page.getByText(T.fotosN(7))).toBeVisible();
  });
});

test.describe("acessibilidade e alvos (Q-03, Q-04)", () => {
  test("axe: o Início com fotos à espera", async ({ page }) => {
    await abrirInicio(page);
    // Sem isto, o axe passava no Início genérico da F4-01 (que também é acessível).
    await expect(page.getByRole("region")).toHaveCount(3);
    await semViolacoesGraves(page, "inicio");
  });
  test("axe: o Início sem fotos, eventos nem registos", async ({ page }) => {
    await abrirInicio(page, { fotosPendentes: 0, eventos: [], novosRegistos: 0 });
    await expect(page.getByText(T.fotos0)).toBeVisible();
    await semViolacoesGraves(page, "inicio vazio");
  });
  test("axe: o Início em erro", async ({ page }) => {
    await abrirInicio(page, {
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/resumo$/, resposta: { estado: 500 } }],
    });
    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await semViolacoesGraves(page, "inicio erro");
  });

  test("as ligações «Ir para a fila de fotos», «Ver os eventos» e «Ver os clientes» e o «Tentar outra vez» têm 44 px ou mais; foco com anel", async ({
    page,
  }) => {
    await abrirInicio(page);
    for (const nome of [T.irParaAFila, T.verOsEventos, T.verOsClientes]) {
      await medida(page.getByRole("link", { name: nome }), nome);
    }
    const ligacao = page.getByRole("link", { name: T.verOsEventos });
    await ligacao.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(ligacao).toBeFocused();
    const anel = await ligacao.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
    });
    expect(anel, "um anel de foco visível").not.toMatch(/^none 0px none$/);
  });

  test("«Tentar outra vez» do erro tem 44 px ou mais", async ({ page }) => {
    await abrirInicio(page, {
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/resumo$/, resposta: "abortar" }],
    });
    await medida(botao(page, T.tentarOutraVez), T.tentarOutraVez);
  });

  test("sem hover: o dourado de «Ir para a fila de fotos» não muda com o rato", async ({
    page,
  }) => {
    await abrirInicio(page);
    const l = page.getByRole("link", { name: T.irParaAFila });
    const ler = () => l.evaluate((el) => getComputedStyle(el).backgroundColor);
    const antes = await ler();
    await l.hover();
    expect(await ler()).toBe(antes);
  });
});

test.describe("1024 × 768, rato", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("coluna lateral e, ao lado, os três blocos em coluna (sem grelha de três cartões); axe", async ({
    page,
  }) => {
    await abrirInicio(page);
    const caixas = await Promise.all(
      [T.fotosTitulo, T.eventosTitulo, T.registosTitulo].map((t) => seccao(page, t).boundingBox()),
    );
    for (const c of caixas) expect(c?.x ?? 0).toBeGreaterThanOrEqual(240);
    expect(new Set(caixas.map((c) => Math.round(c?.x ?? 0))).size, "todos na mesma coluna").toBe(1);
    expect(caixas[0]?.y ?? 0).toBeLessThan(caixas[1]?.y ?? 0);
    expect(caixas[1]?.y ?? 0).toBeLessThan(caixas[2]?.y ?? 0);
    expect(caixas[0]?.width ?? 0).toBeLessThanOrEqual(640);
    await semViolacoesGraves(page, "inicio 1024");
  });
});
