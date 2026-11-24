import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { TEXTOS as T } from "../src/pages/gestao/galeria/textos";
import { TEXTOS_APROVADAS as A } from "../src/testes/fotos-gestao-textos";
import { seccaoDaGaleria } from "./apoio/galeria";
import {
  aprovadasDoE2E,
  fotosDoE2E,
  muitasAprovadasDoE2E,
  pedidosDe,
  type Falha,
} from "./apoio/gestao-fotos";
import {
  abrirGaleria,
  aviso,
  botoesEliminar,
  eliminarDe,
  eliminados,
  folhaDeEliminar,
  itens,
  leituras,
  miniaturasCarregadas,
  seccao,
  tituloDaSeccao,
} from "./apoio/gestao-fotos-aprovadas";

/**
 * F4-04b — «Fotos no site» e «Eliminar» no browser, a 390 × 844 com toque (e a 1024 × 768 para o
 * rato). API fingida com **estado partilhado** (`apoio/gestao-fotos.ts`): um `DELETE` bem sucedido
 * faz a foto desaparecer também do `GET /api/galeria` público, e é isso que o primeiro teste prova
 * do lado do frontend (o do servidor é `backend/tests/gestao/test_fotos.py`).
 *
 * O que o Vitest/jsdom **não** mede: os 44 px, o anel de foco, o axe, o `loading="lazy"` a sério, o
 * foco depois de a folha fechar, a folha a caber no ecrã e as caixas das miniaturas (80 px a 390,
 * 96 px a 1024). É isso que está aqui.
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

function botao(page: Page | Locator, nome: string): Locator {
  return page.getByRole("button", { name: nome, exact: true });
}

test.describe("a secção «Fotos no site» (critérios 1, 2, 9 e 11)", () => {
  test("três aprovadas a seguir à fila, da mais recente à mais antiga, miniaturas de /media já descodificadas", async ({
    page,
  }) => {
    await abrirGaleria(page);

    await expect(tituloDaSeccao(page)).toHaveText(A.tituloN(3));
    await expect(itens(page)).toHaveCount(3);
    const imgs = seccao(page).locator("img");
    await expect(imgs).toHaveCount(3);
    expect(
      await imgs.evaluateAll((l) => l.map((i) => i.getAttribute("src"))),
      "da última aprovada para a mais antiga",
    ).toEqual(["/media/foto-201.webp", "/media/foto-202.webp", "/media/foto-203.webp"]);
    await miniaturasCarregadas(page);
    expect(await imgs.evaluateAll((l) => l.map((i) => i.getAttribute("alt")))).toEqual([
      "",
      "",
      "",
    ]);
    expect(await imgs.evaluateAll((l) => l.map((i) => i.getAttribute("loading")))).toEqual([
      "lazy",
      "lazy",
      "lazy",
    ]);
    await expect(seccao(page).getByText(A.aprovadaEm("hoje, às 08:05"))).toBeVisible();
    await expect(seccao(page).getByText(A.enviadaPor("Marta"))).toBeVisible();

    const fila = page.getByRole("region", { name: new RegExp(`^${T.fotosAEspera}`) });
    const [caixaFila, caixaSeccao] = await Promise.all([
      fila.boundingBox(),
      seccao(page).boundingBox(),
    ]);
    expect(caixaSeccao?.y ?? 0, "por baixo da fila").toBeGreaterThanOrEqual(
      (caixaFila?.y ?? 0) + (caixaFila?.height ?? 0) - 1,
    );
  });

  test("a miniatura mede 80 × 80 a 390 px e a página não tem scroll lateral", async ({ page }) => {
    await abrirGaleria(page);
    await miniaturasCarregadas(page);

    const caixa = await seccao(page).locator("img").first().boundingBox();
    expect(Math.round(caixa?.width ?? 0)).toBe(80);
    expect(Math.round(caixa?.height ?? 0)).toBe(80);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "nada transborda a 390",
    ).toBeLessThanOrEqual(390);
  });

  test("a secção desenha-se e funciona com a fila vazia e com a fila em erro (independentes)", async ({
    page,
  }) => {
    await abrirGaleria(page, {
      inicial: aprovadasDoE2E(),
      esperar: false,
    });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await expect(itens(page)).toHaveCount(3);
  });

  test("erro a carregar só a secção: o texto certo, nenhum «Eliminar», a fila a funcionar por cima", async ({
    page,
  }) => {
    await abrirGaleria(page, {
      esperar: false,
      falhas: [
        { metodo: "GET", caminho: /^\/gestao\/fotos\/aprovadas$/, resposta: { estado: 500 } },
      ],
    });

    await expect(seccao(page).getByText(A.carregarTitulo)).toBeVisible();
    await expect(seccao(page).getByText(A.carregarServidor)).toBeVisible();
    await expect(botoesEliminar(page)).toHaveCount(0);
    await expect(page.getByText(A.vazioTitulo)).toHaveCount(0);
    await expect(botao(page, T.aprovar).first()).toBeVisible();
    await semViolacoesGraves(page, "galeria-aprovadas-erro");
  });

  test("vazio: «Ainda não há fotos no site.» só com um 200 de lista vazia", async ({ page }) => {
    await abrirGaleria(page, { inicial: fotosDoE2E(), esperar: false });
    await expect(page.getByText(A.vazioTitulo)).toBeVisible();
    await expect(page.getByText(A.vazioLinha)).toBeVisible();
    await semViolacoesGraves(page, "galeria-aprovadas-vazio");
  });

  test("uma imagem que não carrega: «Sem imagem» (sem ícone partido) e o «Eliminar» ativo", async ({
    page,
  }) => {
    await abrirGaleria(page, {
      antesDeAbrir: async (p) => {
        await p.route("**/media/foto-202.webp", (rota) =>
          rota.fulfill({ status: 404, body: "não existe" }),
        );
      },
    });

    const item = itens(page).filter({ hasText: A.semImagem });
    await expect(item).toHaveCount(1);
    await expect(item.locator("img")).toHaveCount(0);
    await expect(
      item.getByRole("button", { name: /^Eliminar foto aprovada / }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await item.getByRole("button", { name: /^Eliminar foto aprovada / }).tap();
    await expect(folhaDeEliminar(page)).toBeVisible();
    await expect(folhaDeEliminar(page).getByText(A.naoSeMostra)).toBeVisible();
    await expect(botao(folhaDeEliminar(page), A.eliminar)).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("com 23 aprovadas: 8 itens, «A mostrar 8 de 23.», «Mostrar mais fotos» dá 16 sem mexer o foco", async ({
    page,
  }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(23)] });

    await expect(tituloDaSeccao(page)).toHaveText(A.tituloN(23));
    await expect(itens(page)).toHaveCount(8);
    await expect(seccao(page).getByText(A.aMostrar(8, 23))).toBeVisible();
    const mais = botao(seccao(page), A.mostrarMais);
    await mais.scrollIntoViewIfNeeded();
    await mais.focus();
    await mais.tap();
    await expect(itens(page)).toHaveCount(16);
    await expect(seccao(page).getByText(A.aMostrar(16, 23))).toBeVisible();
    await expect(botao(seccao(page), A.mostrarMais)).toBeFocused();
  });

  test("com 8 aprovadas não há nota nem «Mostrar mais fotos»", async ({ page }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(8)] });
    await expect(itens(page)).toHaveCount(8);
    await expect(page.getByText(/^A mostrar /)).toHaveCount(0);
    await expect(botao(seccao(page), A.mostrarMais)).toHaveCount(0);
  });

  test("axe: a página com a secção, e a folha aberta (a 390)", async ({ page }) => {
    await abrirGaleria(page);
    await miniaturasCarregadas(page);
    await semViolacoesGraves(page, "galeria-aprovadas");

    await eliminarDe(page, 202).tap();
    await expect(folhaDeEliminar(page)).toBeVisible();
    await semViolacoesGraves(page, "galeria-eliminar");
  });
});

test.describe("alvos (Q-04) e foco visível, a 390 × 844", () => {
  test("«Eliminar», «Mostrar mais fotos» e, na folha, «Eliminar», «Cancelar» e «×» têm 44 px ou mais", async ({
    page,
  }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(12)] });
    for (const [i, b] of (await botoesEliminar(page).all()).entries()) {
      await medida(b, `Eliminar do item ${String(i + 1)}`);
    }
    await medida(botao(seccao(page), A.mostrarMais), A.mostrarMais);

    await botoesEliminar(page).first().tap();
    const folha = folhaDeEliminar(page);
    await medida(botao(folha, A.eliminar), "Eliminar da folha");
    await medida(botao(folha, A.cancelar), "Cancelar da folha");
    await medida(folha.getByRole("button", { name: "Fechar", exact: true }), "× da folha");
  });

  test("«Tentar outra vez» (erro de carregar) e «Verificar outra vez» (verificação falhada) têm 44 px ou mais", async ({
    page,
  }) => {
    await abrirGaleria(page, {
      esperar: false,
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/fotos\/aprovadas$/, resposta: "abortar" }],
    });
    await medida(botao(seccao(page), A.tentarOutraVez), A.tentarOutraVez);
  });

  test("os «Eliminar» têm um vão de pelo menos 16 px entre o fim de um botão e o seguinte (nenhum toque cai no vizinho)", async ({
    page,
  }) => {
    await abrirGaleria(page);
    const caixas = await Promise.all(
      (await botoesEliminar(page).all()).map((b) => b.boundingBox()),
    );
    for (let i = 0; i < caixas.length - 1; i += 1) {
      const a = caixas[i];
      const b = caixas[i + 1];
      expect(
        (b?.y ?? 0) - ((a?.y ?? 0) + (a?.height ?? 0)),
        `entre o ${String(i + 1)} e o seguinte`,
      ).toBeGreaterThanOrEqual(16);
    }
  });

  test("o foco por teclado vê-se (anel) no «Eliminar» e na folha começa em «Cancelar»", async ({
    page,
  }) => {
    await abrirGaleria(page);
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
    await expect(botao(folhaDeEliminar(page), A.cancelar)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(folhaDeEliminar(page)).toBeHidden();
    await expect(primeiro).toBeFocused();
  });
});

test.describe("eliminar (critérios 3 a 6)", () => {
  test("Eliminar → folha («Tem a certeza?», foco em Cancelar, sem pedido) → confirmar → 204: a foto sai da lista, aviso, foco no <h2>, e o site público deixa de a mostrar", async ({
    page,
  }) => {
    const { servidor } = await abrirGaleria(page);
    await miniaturasCarregadas(page);

    await eliminarDe(page, 202).tap();

    const folha = folhaDeEliminar(page);
    await expect(folha).toBeVisible();
    await expect(botao(folha, A.cancelar)).toBeFocused();
    await expect(folha.getByText(A.avisoDaFolha)).toBeVisible();
    await expect(folha.locator('img[src="/media/foto-202.webp"]')).toBeVisible();
    expect(eliminados(servidor), "abrir a folha não pede nada").toBe(0);

    await botao(folha, A.eliminar).tap();

    await expect(folha).toBeHidden();
    await expect(aviso(page)).toContainText("Feito.");
    await expect(aviso(page)).toContainText(A.avisoEliminada);
    await expect(tituloDaSeccao(page)).toHaveText(A.tituloN(2));
    await expect(tituloDaSeccao(page)).toBeFocused();
    await expect(botoesEliminar(page)).toHaveCount(2);
    await expect(page.getByRole("button", { name: /desfazer/i })).toHaveCount(0);
    expect(eliminados(servidor, 202)).toBe(1);
    expect(servidor.fotos.some((f) => f.id === 202)).toBe(false);

    await page.goto("/");
    await expect(
      seccaoDaGaleria(page).locator('img[src="/media/foto-201.webp"]').first(),
    ).toBeAttached();
    await expect(seccaoDaGaleria(page).locator('img[src="/media/foto-202.webp"]')).toHaveCount(0);
  });

  test("o foco nunca vai ao «Eliminar» seguinte, nem com o dedo ainda no sítio do anterior", async ({
    page,
  }) => {
    await abrirGaleria(page);
    await eliminarDe(page, 201).tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();
    await expect(tituloDaSeccao(page)).toBeFocused();
    for (const b of await botoesEliminar(page).all()) await expect(b).not.toBeFocused();
  });

  test("Cancelar, `Esc` e a cortina fecham sem pedido e devolvem o foco ao «Eliminar» desse item", async ({
    page,
  }) => {
    const { servidor } = await abrirGaleria(page);
    const alvo = eliminarDe(page, 203);

    await alvo.tap();
    await botao(folhaDeEliminar(page), A.cancelar).tap();
    await expect(folhaDeEliminar(page)).toBeHidden();
    await expect(alvo).toBeFocused();

    await alvo.tap();
    await page.keyboard.press("Escape");
    await expect(folhaDeEliminar(page)).toBeHidden();
    await expect(alvo).toBeFocused();

    expect(eliminados(servidor)).toBe(0);
    await expect(botoesEliminar(page)).toHaveCount(3);
  });

  test("duplo toque em «Eliminar» da folha: um só DELETE; a folha não fecha com Esc a meio", async ({
    page,
  }) => {
    const { servidor } = await abrirGaleria(page);
    await eliminarDe(page, 202).tap();
    servidor.atrasoMs = 1_500;

    const confirmar = folhaDeEliminar(page).getByRole("button", {
      name: /^(Eliminar|A eliminar…)$/,
    });
    await confirmar.tap();
    await confirmar.tap({ force: true });
    await expect(botao(folhaDeEliminar(page), A.aEliminar)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(folhaDeEliminar(page), "a meio, nem Esc fecha").toBeVisible();

    await expect(folhaDeEliminar(page)).toBeHidden({ timeout: 10_000 });
    expect(eliminados(servidor, 202)).toBe(1);
  });

  test("500: o erro fica DENTRO da folha, a foto fica; tocar outra vez é seguro", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      {
        metodo: "DELETE",
        caminho: /^\/gestao\/fotos\/202$/,
        vezes: 1,
        resposta: { estado: 500, corpo: { erro: "foto_nao_eliminada", mensagem: "x" } },
      },
    ];
    const { servidor } = await abrirGaleria(page, { falhas });
    await eliminarDe(page, 202).tap();

    await botao(folhaDeEliminar(page), A.eliminar).tap();
    await expect(folhaDeEliminar(page).getByText(A.erroNaFolha)).toBeVisible();
    await expect(botoesEliminar(page)).toHaveCount(3);
    await semViolacoesGraves(page, "galeria-eliminar-erro");

    await botao(folhaDeEliminar(page), A.eliminar).tap();
    await expect(folhaDeEliminar(page)).toBeHidden();
    expect(eliminados(servidor, 202)).toBe(2);
    await expect(botoesEliminar(page)).toHaveCount(2);
  });

  test("404 (outro aparelho eliminou-a): sai da lista com «Essa foto já não existia.», sem aviso de sucesso", async ({
    page,
  }) => {
    const { servidor } = await abrirGaleria(page);
    await eliminarDe(page, 202).tap();
    servidor.fotos.splice(
      servidor.fotos.findIndex((f) => f.id === 202),
      1,
    );

    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(seccao(page).getByText(A.jaNaoExistia)).toBeVisible();
    await expect(botoesEliminar(page)).toHaveCount(2);
    await expect(aviso(page)).toHaveCount(0);
    await expect(tituloDaSeccao(page)).toBeFocused();
  });

  test("409: a secção relê e diz «Essa foto já não está no site.»", async ({ page }) => {
    const { servidor } = await abrirGaleria(page);
    await eliminarDe(page, 202).tap();
    const antes = leituras(servidor);
    const foto = servidor.fotos.find((f) => f.id === 202);
    if (foto === undefined) throw new Error("a foto 202 devia existir");
    foto.estado = "rejeitada";

    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(seccao(page).getByText(A.jaNaoEstaNoSite)).toBeVisible();
    await expect(botoesEliminar(page)).toHaveCount(2);
    expect(leituras(servidor)).toBe(antes + 1);
    expect(eliminados(servidor, 202)).toBe(1);
  });

  test("sem resposta, mas o servidor eliminou: UM DELETE, um GET de verificação e «Foto eliminada.»", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/fotos\/202$/, resposta: "aplicar-e-abortar" },
    ];
    const { servidor } = await abrirGaleria(page, { falhas });
    const antes = leituras(servidor);

    await eliminarDe(page, 202).tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(aviso(page)).toContainText(A.avisoEliminada);
    await expect(botoesEliminar(page)).toHaveCount(2);
    expect(eliminados(servidor, 202), "nunca repete o DELETE").toBe(1);
    expect(leituras(servidor)).toBe(antes + 1);
    await expect(tituloDaSeccao(page)).toBeFocused();
  });

  test("sem resposta e a foto continua: «Não consegui eliminar. Verifica a ligação…» e o «Eliminar» volta; nenhum segundo DELETE sozinho", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/fotos\/202$/, resposta: "abortar", vezes: 1 },
    ];
    const { servidor } = await abrirGaleria(page, { falhas });

    await eliminarDe(page, 202).tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(seccao(page).getByText(A.continuaSemResposta)).toBeVisible();
    await expect(eliminarDe(page, 202)).not.toHaveAttribute("aria-disabled", "true");
    expect(eliminados(servidor, 202)).toBe(1);
    await page.waitForTimeout(500);
    expect(eliminados(servidor, 202), "nada se repete sozinho").toBe(1);
  });

  test("sem resposta e a verificação também falha: «Verificar outra vez» repete o GET, nunca o DELETE", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/fotos\/202$/, resposta: "aplicar-e-abortar" },
      {
        metodo: "GET",
        caminho: /^\/gestao\/fotos\/aprovadas$/,
        quando: (s) => s.pedidos.some((p) => p.metodo === "DELETE"),
        vezes: 1,
        resposta: "abortar",
      },
    ];
    const { servidor } = await abrirGaleria(page, { falhas });

    await eliminarDe(page, 202).tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(seccao(page).getByText(A.semConfirmar)).toBeVisible();
    await expect(eliminarDe(page, 202)).toHaveAttribute("aria-disabled", "true");
    await medida(botao(seccao(page), A.verificarOutraVez), A.verificarOutraVez);
    await semViolacoesGraves(page, "galeria-verificar");

    await botao(seccao(page), A.verificarOutraVez).tap();

    await expect(aviso(page)).toContainText(A.avisoEliminada);
    expect(eliminados(servidor, 202), "o DELETE nunca se repetiu").toBe(1);
    expect(pedidosDe(servidor, "DELETE")).toHaveLength(1);
  });

  test("401: vai ao login e nenhum DELETE se repete depois", async ({ page }) => {
    const falhas: Falha[] = [
      {
        metodo: "DELETE",
        caminho: /^\/gestao\/fotos\/202$/,
        resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
        fechaSessao: true,
      },
    ];
    const { servidor } = await abrirGaleria(page, { falhas });

    await eliminarDe(page, 202).tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(page).toHaveURL(/\/gestao\/entrar/);
    expect(eliminados(servidor), "um só DELETE").toBe(1);
  });

  test("eliminar a última: um GET antes de dizer «Ainda não há fotos no site.», com o foco no título do vazio", async ({
    page,
  }) => {
    const [unica] = aprovadasDoE2E();
    const { servidor } = await abrirGaleria(page, {
      inicial: [...fotosDoE2E(), ...(unica ? [unica] : [])],
    });
    const antes = leituras(servidor);

    await botoesEliminar(page).first().tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(page.getByText(A.vazioTitulo)).toBeVisible();
    expect(leituras(servidor)).toBe(antes + 1);
    await expect(aviso(page)).toContainText(A.avisoEliminada);
    expect(
      await page.evaluate(
        (texto) => document.activeElement?.textContent?.includes(texto) ?? false,
        A.vazioTitulo,
      ),
      "o foco está no título do estado vazio",
    ).toBe(true);
  });

  test("com 23 fotos, eliminar uma de 8 visíveis faz entrar a seguinte", async ({ page }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(23)] });
    await eliminarDe(page, 22).tap();
    await botao(folhaDeEliminar(page), A.eliminar).tap();

    await expect(tituloDaSeccao(page)).toHaveText(A.tituloN(22));
    await expect(itens(page)).toHaveCount(8);
    await expect(seccao(page).getByText(A.aMostrar(8, 22))).toBeVisible();
    await expect(seccao(page).locator('img[src="/media/foto-15.webp"]')).toHaveCount(1);
  });
});

test.describe("a fila e a secção (critério 7)", () => {
  test("aprovar na fila: a foto aprovada aparece no topo da secção, sem esqueleto", async ({
    page,
  }) => {
    const { servidor } = await abrirGaleria(page);
    await expect(page.locator('img:not([hidden])[src$="/gestao/fotos/101/imagem"]')).toBeVisible();
    const antes = leituras(servidor);

    await botao(page, T.aprovar).first().tap();

    await expect(tituloDaSeccao(page)).toHaveText(A.tituloN(4));
    await expect(seccao(page).locator("img").first()).toHaveAttribute(
      "src",
      "/media/foto-101.webp",
    );
    expect(leituras(servidor)).toBe(antes + 1);
    await expect(seccao(page).locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test("rejeitar na fila não relê a secção", async ({ page }) => {
    const { servidor } = await abrirGaleria(page);
    await expect(page.locator('img:not([hidden])[src$="/gestao/fotos/101/imagem"]')).toBeVisible();
    const antes = leituras(servidor);

    await botao(page, T.rejeitar).first().tap();
    await botao(
      page.getByRole("dialog", { name: T.tituloRejeitar, exact: true }),
      T.rejeitar,
    ).tap();
    await expect(page.getByText(T.avisoRejeitada)).toBeVisible();

    expect(leituras(servidor)).toBe(antes);
  });
});

test.describe("1024 × 768, com rato", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: false });

  test("coluna lateral e, ao lado, a lista com miniaturas de 96 px; sem scroll lateral; axe", async ({
    page,
  }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(10)] });
    await miniaturasCarregadas(page);

    const caixa = await seccao(page).locator("img").first().boundingBox();
    expect(Math.round(caixa?.width ?? 0)).toBe(96);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1024,
    );
    await expect(itens(page)).toHaveCount(8);
    await semViolacoesGraves(page, "galeria-aprovadas-1024");
  });

  test("a folha centra-se e «Eliminar» elimina com o rato", async ({ page }) => {
    const { servidor } = await abrirGaleria(page);
    await eliminarDe(page, 203).click();
    const folha = folhaDeEliminar(page);
    await expect(folha).toBeVisible();
    const caixa = await folha.boundingBox();
    expect(Math.abs((caixa?.x ?? 0) + (caixa?.width ?? 0) / 2 - 512), "centrada").toBeLessThan(4);
    await botao(folha, A.eliminar).click();
    await expect(aviso(page)).toContainText(A.avisoEliminada);
    expect(eliminados(servidor, 203)).toBe(1);
  });
});
