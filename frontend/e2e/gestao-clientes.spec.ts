import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  EMAIL_DE_120,
  clienteDeTeste,
  clientesDeTeste,
  muitosClientes,
} from "../src/testes/clientes-dados";
import { TEXTOS_CLIENTES as T } from "../src/testes/clientes-gestao-textos";
import { TEXTOS_DA_GESTAO as TG } from "../src/testes/gestao";
import {
  abrirClientes,
  aviso,
  botoesEliminar,
  eliminados,
  eliminarDe,
  folhaDeEliminar,
  itens,
  leiturasDaLista,
  linhaDeEstado,
  pedidosDe,
  seccao,
  tituloDaLista,
  type Falha,
} from "./apoio/gestao-clientes";

/**
 * F4-05b — os Clientes no browser, a 390 × 844 com toque (e a 1024 × 768 para o rato). API fingida
 * com **estado partilhado** (`apoio/gestao-clientes.ts`): um `DELETE` bem sucedido faz o cliente
 * desaparecer também do `GET /api/gestao/clientes`, e é isso que o teste de eliminar prova do lado
 * do frontend (o do servidor é `backend/tests/gestao/test_clientes.py`).
 *
 * O que o Vitest/jsdom **não** mede: os 44 px, o anel de foco, o axe, o scroll horizontal com um
 * email de 120 letras, o foco depois de a folha fechar e a folha a caber no ecrã. É isso que está
 * aqui, mais o fluxo inteiro contra um servidor fingido.
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

function botao(onde: Page | Locator, nome: string): Locator {
  return onde.getByRole("button", { name: nome, exact: true });
}

async function semScrollHorizontal(page: Page): Promise<void> {
  const [largura, visivel] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(largura, "sem scroll horizontal").toBe(visivel);
}

test.describe("a lista (critérios 5, 6 e 7)", () => {
  test("quatro clientes, do mais recente ao mais antigo; cada um com o que a spec manda e nada do que ela proíbe", async ({
    page,
  }) => {
    await abrirClientes(page);

    await expect(tituloDaLista(page)).toHaveText(T.h2N(4));
    await expect(itens(page)).toHaveCount(4);
    const primeiro = itens(page).nth(0);
    await expect(primeiro).toContainText("Ana Exemplo");
    await expect(primeiro).toContainText("ana@exemplo.test");
    await expect(primeiro).toContainText("912345678");
    await expect(primeiro).toContainText(T.consentimento("14 de novembro de 2026"));
    // Sem telemóvel a linha não existe; de outro ano, o ano vê-se; Lisboa, não UTC.
    await expect(itens(page).nth(1)).not.toContainText(/telem[óo]vel|—/i);
    await expect(itens(page).nth(1)).toContainText(T.consentimento("2 de março de 2025"));
    await expect(itens(page).nth(2)).toContainText(T.consentimento("15 de julho de 2026"));
    const corpo = (await page.locator("main").innerText()).replace(T.ajudaDoCsv, "");
    expect(corpo).not.toMatch(/2026-01|criado|vers[ãa]o|token|\b10[1-4]\b/i);
    expect(await page.locator('a[href^="mailto:"], a[href^="tel:"]').count()).toBe(0);
  });

  test("com um email de 120 letras sem espaços e um nome longo não há scroll horizontal", async ({
    page,
  }) => {
    await abrirClientes(page, {
      clientes: [
        ...clientesDeTeste(),
        clienteDeTeste({ id: 120, nome: "Nome", email: EMAIL_DE_120 }),
      ],
    });
    await semScrollHorizontal(page);
  });

  test("137 clientes: 20, «A mostrar 20 de 137.»; um toque dá 40 e o foco não se mexe", async ({
    page,
  }) => {
    await abrirClientes(page, { clientes: muitosClientes(137) });

    await expect(tituloDaLista(page)).toHaveText(T.h2N(137));
    await expect(itens(page)).toHaveCount(20);
    await expect(seccao(page).getByText(T.aMostrar(20, 137))).toBeVisible();
    const mais = botao(seccao(page), T.mostrarMais);
    await mais.focus();
    await mais.tap();

    await expect(itens(page)).toHaveCount(40);
    await expect(seccao(page).getByText(T.aMostrar(40, 137))).toBeVisible();
    await expect(mais).toBeFocused();
  });

  test("com 20 ou menos não há nota nem botão", async ({ page }) => {
    await abrirClientes(page, { clientes: muitosClientes(20) });
    await expect(itens(page)).toHaveCount(20);
    await expect(botao(seccao(page), T.mostrarMais)).toHaveCount(0);
    await expect(page.getByText(/^A mostrar /)).toHaveCount(0);
  });

  test("vazio (200 com lista vazia): sem botões, sem «Exportar CSV», sem «Tentar outra vez»", async ({
    page,
  }) => {
    await abrirClientes(page, { clientes: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await expect(page.getByText(T.vazioLinha)).toBeVisible();
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  });

  test("erro a carregar (nunca o vazio): as duas frases e «Tentar outra vez», que recupera", async ({
    page,
  }) => {
    // O servidor de desenvolvimento corre no `StrictMode` (efeitos montados duas vezes): uma falha
    // «só a primeira vez» apanhava o pedido errado. A falha vale **enquanto** `falhar` for verdade.
    let falhar = true;
    const falhas: Falha[] = [
      { metodo: "GET", caminho: /^\/gestao\/clientes$/, quando: () => falhar, resposta: "abortar" },
    ];
    const { servidor } = await abrirClientes(page, { esperar: false, falhas });
    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await expect(page.getByText(T.erroSemResposta)).toBeVisible();
    await expect(page.getByText(T.vazioTitulo)).toHaveCount(0);
    await expect(botoesEliminar(page)).toHaveCount(0);
    const antes = leiturasDaLista(servidor);
    falhar = false;

    await botao(page, T.tentarOutraVez).tap();

    await expect(itens(page)).toHaveCount(4);
    expect(leiturasDaLista(servidor), "«Tentar outra vez» refaz o GET").toBeGreaterThan(antes);
  });

  test("5xx a carregar diz que o problema é nosso (≠ sem resposta)", async ({ page }) => {
    await abrirClientes(page, {
      esperar: false,
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/clientes$/, resposta: { estado: 500 } }],
    });
    await expect(page.getByText(T.erroServidor)).toBeVisible();
    await expect(page.getByText(T.erroSemResposta)).toHaveCount(0);
  });

  test("a aba que volta (visibilitychange) relê em silêncio, sem esqueleto", async ({ page }) => {
    const { servidor } = await abrirClientes(page);
    const antes = leiturasDaLista(servidor);
    servidor.clientes.unshift(clienteDeTeste({ id: 900, nome: "Recém Chegada" }));

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(itens(page).first()).toContainText("Recém Chegada");
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
    expect(leiturasDaLista(servidor)).toBe(antes + 1);
  });
});

test.describe("eliminar (critérios 8 a 11)", () => {
  test("Eliminar → folha («Tem a certeza?», foco em Cancelar, sem pedido) → confirmar → 204: o cliente sai, aviso, número desce, foco no <h2>, e o GET já não o devolve", async ({
    page,
  }) => {
    const { servidor } = await abrirClientes(page);

    await eliminarDe(page, "Rui Teste").tap();

    const folha = folhaDeEliminar(page);
    await expect(folha).toBeVisible();
    await expect(botao(folha, T.cancelar)).toBeFocused();
    await expect(folha.getByText("rui@exemplo.test")).toBeVisible();
    await expect(folha.getByText(T.consequencia)).toBeVisible();
    await expect(folha.getByText(T.linhaDoCsv)).toBeVisible();
    expect(eliminados(servidor), "abrir a folha não faz pedido").toBe(0);

    await botao(folha, T.eliminar).tap();

    await expect(folha).toBeHidden();
    await expect(itens(page)).toHaveCount(3);
    await expect(page.getByText("Rui Teste")).toHaveCount(0);
    await expect(tituloDaLista(page)).toHaveText(T.h2N(3));
    await expect(aviso(page)).toContainText(T.avisoEliminado);
    await expect(tituloDaLista(page)).toBeFocused();
    expect(eliminados(servidor, 102)).toBe(1);
    expect(
      servidor.clientes.map((c) => c.nome),
      "o servidor já não o tem",
    ).not.toContain("Rui Teste");
    await expect(aviso(page)).toBeHidden(); // 3 s

    await page.reload();
    await expect(itens(page)).toHaveCount(3);
    await expect(page.getByText("Rui Teste")).toHaveCount(0);
  });

  test("Cancelar, Esc, «×» e a cortina fecham sem pedido e o foco volta ao «Eliminar» do item", async ({
    page,
  }) => {
    const { servidor } = await abrirClientes(page);
    const alvo = eliminarDe(page, "Ana Exemplo");
    const folha = folhaDeEliminar(page);

    await alvo.tap();
    await botao(folha, T.cancelar).tap();
    await expect(folha).toBeHidden();
    await expect(alvo).toBeFocused();

    await alvo.tap();
    await page.keyboard.press("Escape");
    await expect(folha).toBeHidden();
    await expect(alvo).toBeFocused();

    await alvo.tap();
    await folha.getByRole("button", { name: "Fechar", exact: true }).tap();
    await expect(folha).toBeHidden();
    await expect(alvo).toBeFocused();

    expect(eliminados(servidor)).toBe(0);
    await expect(itens(page)).toHaveCount(4);
  });

  test("duplo toque em «Eliminar» da folha faz UM DELETE", async ({ page }) => {
    const { servidor } = await abrirClientes(page, { atrasoMs: 300 });
    await eliminarDe(page, "Ana Exemplo").tap();
    const confirmar = botao(folhaDeEliminar(page), T.eliminar);

    // Dois cliques no mesmo instante (depois do primeiro o botão passa a «A eliminar…»).
    await confirmar.evaluate((b: HTMLElement) => {
      b.click();
      b.click();
    });

    await expect(itens(page)).toHaveCount(3);
    expect(eliminados(servidor)).toBe(1);
  });

  test("eliminar o último: um GET antes de dizer «Não há clientes registados.»", async ({
    page,
  }) => {
    const { servidor } = await abrirClientes(page, {
      clientes: [clienteDeTeste({ id: 5, nome: "Só Eu" })],
    });
    const antes = leiturasDaLista(servidor);

    await eliminarDe(page, "Só Eu").tap();
    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    expect(leiturasDaLista(servidor)).toBe(antes + 1);
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  });

  test("5xx: a folha mantém-se com a frase e o cliente fica; repetir resolve", async ({ page }) => {
    const falhas: Falha[] = [
      {
        metodo: "DELETE",
        caminho: /^\/gestao\/clientes\/101$/,
        vezes: 1,
        resposta: { estado: 500 },
      },
    ];
    const { servidor } = await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();
    const folha = folhaDeEliminar(page);

    await botao(folha, T.eliminar).tap();

    await expect(folha.getByText(T.erroNaFolha)).toBeVisible();
    await expect(page.getByText("MENSAGEM-DO-BACKEND")).toHaveCount(0);
    await expect(itens(page)).toHaveCount(4);

    await botao(folha, T.eliminar).tap();
    await expect(folha).toBeHidden();
    await expect(itens(page)).toHaveCount(3);
    expect(eliminados(servidor, 101)).toBe(2);
  });

  test("404 cliente_inexistente (outro aparelho já o eliminou): sai da lista com «Esse cliente já não existia.», sem «Feito.»", async ({
    page,
  }) => {
    const { servidor } = await abrirClientes(page);
    servidor.clientes = servidor.clientes.filter((c) => c.id !== 101); // o servidor já não o tem
    await eliminarDe(page, "Ana Exemplo").tap();

    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(folhaDeEliminar(page)).toBeHidden();
    await expect(linhaDeEstado(page, T.jaNaoExistia)).toBeVisible();
    await expect(page.getByText("Ana Exemplo")).toHaveCount(0);
    await expect(aviso(page)).toHaveCount(0);
    await expect(tituloDaLista(page)).toBeFocused();
  });

  test("404 SEM o código (um proxy): é um erro; a folha fica e o cliente fica", async ({
    page,
  }) => {
    await abrirClientes(page, {
      falhas: [
        {
          metodo: "DELETE",
          caminho: /^\/gestao\/clientes\/101$/,
          resposta: { estado: 404, texto: "<html>Not Found</html>" },
        },
      ],
    });
    await eliminarDe(page, "Ana Exemplo").tap();
    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(folhaDeEliminar(page).getByText(T.erroNaFolha)).toBeVisible();
    await expect(page.getByText(T.jaNaoExistia)).toHaveCount(0);
    await expect(itens(page)).toHaveCount(4);
  });

  test("sem resposta, o pedido CHEGOU: um DELETE, o cliente fica durante a verificação, depois «Cliente eliminado.»", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/clientes\/101$/, resposta: "aplicar-e-abortar" },
    ];
    const { servidor } = await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();

    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(aviso(page)).toContainText(T.avisoEliminado);
    await expect(page.getByText("Ana Exemplo")).toHaveCount(0);
    await expect(itens(page)).toHaveCount(3);
    expect(eliminados(servidor, 101), "o DELETE nunca se repete sozinho").toBe(1);
    expect(servidor.clientes.map((c) => c.nome)).not.toContain("Ana Exemplo");
  });

  test("sem resposta, o pedido NÃO chegou: o cliente continua, a linha diz-o e o «Eliminar» volta", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/clientes\/101$/, vezes: 1, resposta: "abortar" },
    ];
    const { servidor } = await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();

    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(linhaDeEstado(page, T.continuaSemResposta)).toBeVisible();
    await expect(itens(page)).toHaveCount(4);
    await expect(eliminarDe(page, "Ana Exemplo")).not.toHaveAttribute("aria-disabled", "true");
    expect(eliminados(servidor, 101)).toBe(1);
  });

  test("sem resposta e a verificação também falha: «Verificar outra vez» repete o GET e NUNCA o DELETE", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/clientes\/101$/, resposta: "aplicar-e-abortar" },
      {
        metodo: "GET",
        caminho: /^\/gestao\/clientes$/,
        quando: (s) => eliminados(s) > 0,
        vezes: 1,
        resposta: "abortar",
      },
    ];
    const { servidor } = await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();
    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(linhaDeEstado(page, T.semConfirmar)).toBeVisible();
    await expect(eliminarDe(page, "Ana Exemplo")).toHaveAttribute("aria-disabled", "true");
    const antes = eliminados(servidor);

    await botao(page, T.verificarOutraVez).tap();

    await expect(aviso(page)).toContainText(T.avisoEliminado);
    await expect(page.getByText("Ana Exemplo")).toHaveCount(0);
    expect(eliminados(servidor)).toBe(antes);
  });

  test("401 no DELETE: login com «A sessão terminou»; entrar volta a /gestao/mais/clientes e o DELETE não se repete", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      {
        metodo: "DELETE",
        caminho: /^\/gestao\/clientes\/101$/,
        vezes: 1,
        resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
        fechaSessao: true,
      },
    ];
    const { servidor } = await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();
    await botao(folhaDeEliminar(page), T.eliminar).tap();

    await expect(page.getByRole("heading", { level: 1, name: TG.tituloDoLogin })).toBeVisible();
    await expect(page.getByText(T.sessaoTerminou)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/entrar");
    expect(eliminados(servidor)).toBe(1);

    await page.getByLabel(TG.etiquetaUtilizador).fill("dono");
    await page.getByLabel(TG.etiquetaPassword).fill("segredo-de-teste");
    await page.getByRole("button", { name: TG.botaoEntrar, exact: true }).tap();

    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/clientes");
    await expect(itens(page)).toHaveCount(4);
    expect(eliminados(servidor), "nenhum DELETE depois do login").toBe(1);
  });

  test("o pedido leva X-Tomazia e o `id` certo", async ({ page }) => {
    const { servidor } = await abrirClientes(page);
    await eliminarDe(page, "Ana Exemplo").tap();
    await botao(folhaDeEliminar(page), T.eliminar).tap();
    await expect(itens(page)).toHaveCount(3);

    const pedido = pedidosDe(servidor, "DELETE")[0];
    expect(pedido?.caminho).toBe("/gestao/clientes/101");
    expect(pedido?.cabecalhos["x-tomazia"]).toBe("1");
  });
});

test.describe("acessibilidade (Q-03)", () => {
  test("axe: a lista, a folha aberta, o vazio e o erro", async ({ page }) => {
    await abrirClientes(page);
    await semViolacoesGraves(page, "clientes");
    await eliminarDe(page, "Ana Exemplo").tap();
    await expect(folhaDeEliminar(page)).toBeVisible();
    await semViolacoesGraves(page, "clientes-folha");
  });

  test("axe: vazio", async ({ page }) => {
    await abrirClientes(page, { clientes: [] });
    await semViolacoesGraves(page, "clientes-vazio");
  });

  test("axe: erro", async ({ page }) => {
    await abrirClientes(page, {
      esperar: false,
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/clientes$/, resposta: { estado: 500 } }],
    });
    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await semViolacoesGraves(page, "clientes-erro");
  });
});

test.describe("alvos (Q-04) e foco visível, a 390 × 844", () => {
  test("«Eliminar» (de cada item), «Exportar CSV», «Mostrar mais clientes», «Voltar a Mais» e, na folha, «Eliminar», «Cancelar» e «×» têm 44 px ou mais", async ({
    page,
  }) => {
    await abrirClientes(page, { clientes: muitosClientes(25) });
    await medida(page.getByRole("link", { name: T.voltar }), T.voltar);
    await medida(botao(page, T.exportar), T.exportar);
    for (const [i, b] of (await botoesEliminar(page).all()).entries()) {
      await medida(b, `Eliminar do item ${String(i + 1)}`);
    }
    await medida(botao(seccao(page), T.mostrarMais), T.mostrarMais);

    await botoesEliminar(page).first().tap();
    const folha = folhaDeEliminar(page);
    await medida(botao(folha, T.eliminar), "Eliminar da folha");
    await medida(botao(folha, T.cancelar), "Cancelar da folha");
    await medida(folha.getByRole("button", { name: "Fechar", exact: true }), "× da folha");
  });

  test("«Tentar outra vez» e «Verificar outra vez» têm 44 px ou mais", async ({ page }) => {
    await abrirClientes(page, {
      esperar: false,
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/clientes$/, resposta: "abortar" }],
    });
    await medida(botao(page, T.tentarOutraVez), T.tentarOutraVez);
  });

  test("o «Eliminar» de um item e o do seguinte distam mais de 76 px (nenhum toque cai no vizinho)", async ({
    page,
  }) => {
    await abrirClientes(page);
    const caixas = await Promise.all(
      (await botoesEliminar(page).all()).map((b) => b.boundingBox()),
    );
    for (let i = 0; i < caixas.length - 1; i += 1) {
      expect(
        (caixas[i + 1]?.y ?? 0) - (caixas[i]?.y ?? 0),
        `entre o ${String(i + 1)} e o seguinte`,
      ).toBeGreaterThan(76);
    }
  });

  test("o foco por teclado vê-se (anel) no «Eliminar» e na folha começa em «Cancelar»", async ({
    page,
  }) => {
    await abrirClientes(page);
    const primeiro = botoesEliminar(page).first();
    await primeiro.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(primeiro).toBeFocused();
    const anel = await primeiro.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
    });
    expect(anel, "um anel de foco visível").not.toMatch(/^none 0px none$/);

    await page.keyboard.press("Enter");
    await expect(folhaDeEliminar(page)).toBeVisible();
    await expect(botao(folhaDeEliminar(page), T.cancelar)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(folhaDeEliminar(page)).toBeHidden();
    await expect(primeiro).toBeFocused();
  });

  test("a ordem de tabulação: Voltar a Mais, Exportar CSV, Eliminar do 1.º item…", async ({
    page,
  }) => {
    await abrirClientes(page);
    await page.getByRole("link", { name: T.voltar }).focus();
    await page.keyboard.press("Tab");
    await expect(botao(page, T.exportar)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(botoesEliminar(page).first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(botoesEliminar(page).nth(1)).toBeFocused();
  });

  test("sem hover que mude alguma coisa: o `:hover` do «Eliminar» não altera o fundo nem a cor", async ({
    page,
  }) => {
    await abrirClientes(page);
    const b = botoesEliminar(page).first();
    const antes = await b.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.backgroundColor}|${s.color}|${s.borderColor}`;
    });
    await b.hover();
    const depois = await b.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.backgroundColor}|${s.color}|${s.borderColor}`;
    });
    expect(depois).toBe(antes);
  });
});

test.describe("«Mais» e a navegação (critério 16)", () => {
  test("«Mais» → «Clientes» (a seguir a «Definições») → lista; «Voltar a Mais» volta; o foco vai ao <h1> em cada passo", async ({
    page,
  }) => {
    await abrirClientes(page, { esperar: false });
    await page.goto("/gestao/mais");
    const linha = page.getByRole("link", { name: new RegExp(`^${T.linhaNoMais}`) });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText(T.descricaoNoMais);
    await medida(linha, "a linha «Clientes» do Mais");
    await semViolacoesGraves(page, "mais");
    const ligacoes = await page.locator("main ul a").allInnerTexts();
    expect(ligacoes.map((t) => t.split("\n")[0])).toEqual(["Definições", T.linhaNoMais]);

    await linha.tap();
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/clientes");
    await expect(page).toHaveTitle(T.tituloDoDocumento);

    await page.getByRole("link", { name: T.voltar }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Mais" })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais");
  });

  test("o título do separador e o endereço nunca levam dados dos clientes", async ({ page }) => {
    await abrirClientes(page);
    await expect(page).toHaveTitle(T.tituloDoDocumento);
    expect(page.url()).not.toMatch(/ana|rui|exemplo|91234/i);
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("[aria-label], [title], [alt]")).map(
          (e) =>
            `${e.getAttribute("aria-label") ?? ""}${e.getAttribute("title") ?? ""}${e.getAttribute("alt") ?? ""}`,
        ),
      ),
    ).not.toContainEqual(expect.stringMatching(/Ana|Rui|Maria|Rita|exemplo|91234/));
  });
});

test.describe("1024 × 768, rato", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("coluna lateral e, ao lado, uma só coluna de lista; sem scroll lateral; axe; a folha centra-se", async ({
    page,
  }) => {
    await abrirClientes(page);
    const lista = await seccao(page).boundingBox();
    expect((lista?.x ?? 0) >= 240, "a lista fica ao lado da coluna lateral de 240 px").toBe(true);
    expect(lista?.width ?? 0).toBeLessThanOrEqual(640);
    await semScrollHorizontal(page);
    await semViolacoesGraves(page, "clientes 1024");

    await eliminarDe(page, "Ana Exemplo").click();
    const folha = await folhaDeEliminar(page).locator("> div").boundingBox();
    expect(folha?.width ?? 0).toBeLessThanOrEqual(480 + 1);
    const meio = (folha?.x ?? 0) + (folha?.width ?? 0) / 2;
    expect(Math.abs(meio - 512)).toBeLessThan(8);
    await semViolacoesGraves(page, "clientes folha 1024");
  });
});

test.describe("o ecrã nunca guarda a lista fora da memória (secção 2)", () => {
  test("nada em localStorage nem em sessionStorage depois de carregar, eliminar e voltar atrás", async ({
    page,
  }) => {
    await abrirClientes(page);
    await eliminarDe(page, "Ana Exemplo").tap();
    await botao(folhaDeEliminar(page), T.eliminar).tap();
    await expect(itens(page)).toHaveCount(3);

    const guardado = await page.evaluate(() => ({
      local: Object.entries(localStorage),
      sessao: Object.entries(sessionStorage),
    }));
    expect(JSON.stringify(guardado)).not.toMatch(/ana|rui|exemplo|91234/i);
    await page.getByRole("link", { name: T.voltar }).tap();
    await page.goBack();
    await expect(itens(page)).toHaveCount(3);
  });
});
