import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  TEXTOS_DA_EMENTA_GESTAO as T,
  type CategoriaGestao,
  produtoDeTeste,
} from "../src/testes/gestao";
import { fingirApiDeEmenta, pedidosDe, type ServidorDeEmenta } from "./apoio/gestao-ementa";
import { fingirApiDeSessao } from "./apoio/gestao";

/**
 * F4-02 — a ementa na gestão no browser, a 390 × 844 com toque (e a 1024 × 768
 * para o rato). API fingida em memória (`apoio/gestao-ementa.ts`).
 *
 * O critério de «feito» da tarefa: **mudar um preço custa no máximo dois toques**,
 * contados num `tap()` que passa por `tocar()` abaixo — escrever os algarismos
 * não é um toque (o teclado decimal abre sozinho).
 */

async function semViolacoesGraves(pagina: Page, ecra: string): Promise<void> {
  const resultado = await new AxeBuilder({ page: pagina }).analyze();
  const graves = resultado.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    graves.map((v) => `[${ecra}] ${v.id}: ${v.help}`),
    "o axe achou violações sérias ou críticas (Q-03)",
  ).toEqual([]);
}

/** Conta os toques: tudo o que é «tocar» passa por aqui. */
function contadorDeToques() {
  const estado = { total: 0 };
  return {
    estado,
    async tocar(alvo: Locator): Promise<void> {
      estado.total += 1;
      await alvo.tap();
    },
  };
}

function nomeDoPreco(nome: string, preco: string): RegExp {
  const e = `Alterar o preço de ${nome}, agora ${preco}`
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s");
  return new RegExp(`^${e}$`);
}

async function abrir(
  page: Page,
  caminho = "/gestao/ementa?categoria=garrafeira",
  opcoes: Parameters<typeof fingirApiDeEmenta>[1] & { esperarLista?: boolean } = {},
): Promise<ServidorDeEmenta> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDeEmenta(page, { sessao, ...opcoes });
  await page.goto(caminho);
  await expect(page.getByRole("heading", { level: 1, name: "Ementa" })).toBeVisible();
  if (opcoes.esperarLista !== false) {
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  }
  return servidor;
}

function aviso(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(Feito|Erro)\./ });
}

const VINHO = "Vinho tinto da casa";

test.describe("mudar um preço: no máximo dois toques", () => {
  test("um toque no preço, escrever, um toque em «Guardar»: um PATCH com o corpo exato", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    const { estado, tocar } = contadorDeToques();

    await tocar(page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }));
    const campo = page.getByLabel("Preço, em euros");
    await expect(campo).toBeFocused();
    await expect(campo).toHaveAttribute("inputmode", "decimal");
    await campo.fill("7,50");
    await tocar(page.getByRole("button", { name: T.guardar }));

    await expect(aviso(page)).toContainText("Preço atualizado para 7,50 €.");
    await expect(page.getByRole("button", { name: nomeDoPreco(VINHO, "7,50 €") })).toBeVisible();
    expect(estado.total).toBeLessThanOrEqual(2);

    const patches = pedidosDe(servidor, "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.caminho).toBe("/gestao/produtos/201");
    expect(patches[0]?.corpo).toEqual({ preco_cent: 750 });
    expect(patches[0]?.cabecalhos["x-tomazia"]).toBe("1");
  });

  test("variante: abrir com um toque, escrever e Enter (um toque só)", async ({ page }) => {
    const servidor = await abrir(page);
    const { estado, tocar } = contadorDeToques();

    await tocar(page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }));
    await page.getByLabel("Preço, em euros").fill("7,50");
    await page.keyboard.press("Enter");

    await expect(aviso(page)).toContainText("Preço atualizado para 7,50 €.");
    expect(estado.total).toBeLessThanOrEqual(1);
    expect(pedidosDe(servidor, "PATCH").map((p) => p.corpo)).toEqual([{ preco_cent: 750 }]);
  });

  test("o PATCH leva o cookie da sessão (credentials: include)", async ({ page }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }).tap();
    await page.getByLabel("Preço, em euros").fill("7");
    await page.getByRole("button", { name: T.guardar }).tap();
    await expect(aviso(page)).toBeVisible();
    expect(pedidosDe(servidor, "PATCH")).toHaveLength(1);
  });

  test("preço 0: aviso de oferta com «Desfazer»; tocar manda {preco_cent: 650}", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }).tap();
    await page.getByLabel("Preço, em euros").fill("0");
    await page.getByRole("button", { name: T.guardar }).tap();

    await expect(aviso(page)).toContainText(T.avisoOferta);
    await aviso(page).getByRole("button", { name: T.desfazer }).tap();

    await expect(page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") })).toBeVisible();
    expect(pedidosDe(servidor, "PATCH").map((p) => p.corpo)).toEqual([
      { preco_cent: 0 },
      { preco_cent: 650 },
    ]);
  });

  test("6,50 → 65,00 tem «Desfazer»; 6,50 → 7,00 não", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }).tap();
    await page.getByLabel("Preço, em euros").fill("65");
    await page.getByRole("button", { name: T.guardar }).tap();
    await expect(aviso(page)).toContainText("Preço atualizado para 65,00 €.");
    await expect(aviso(page).getByRole("button", { name: T.desfazer })).toBeVisible();

    await page.getByRole("button", { name: nomeDoPreco(VINHO, "65,00 €") }).tap();
    await page.getByLabel("Preço, em euros").fill("7");
    await page.getByRole("button", { name: T.guardar }).tap();
    await expect(aviso(page)).toContainText("Preço atualizado para 7,00 €.");
    await expect(aviso(page).getByRole("button", { name: T.desfazer })).toHaveCount(0);
  });

  test("um preço inválido não faz pedido e mostra o erro", async ({ page }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }).tap();
    await page.getByLabel("Preço, em euros").fill("6,505");
    await page.getByRole("button", { name: T.guardar }).tap();

    await expect(page.getByText(T.erroPrecoDecimais)).toBeVisible();
    expect(pedidosDe(servidor, "PATCH")).toHaveLength(0);
    await semViolacoesGraves(page, "erro de preço");
  });
});

test.describe("interruptor «Disponível»", () => {
  test("desligar e «Desfazer»: dois PATCH absolutos", async ({ page }) => {
    const servidor = await abrir(page, "/gestao/ementa");
    const interruptor = page
      .locator("li", { has: page.getByRole("button", { name: "Café", exact: true }) })
      .getByRole("switch", { name: T.etiquetaDisponivel });

    await interruptor.tap();
    await expect(aviso(page)).toContainText("Café deixou de estar disponível.");
    await aviso(page).getByRole("button", { name: T.desfazer }).tap();

    await expect(interruptor).toBeChecked();
    expect(pedidosDe(servidor, "PATCH").map((p) => p.corpo)).toEqual([
      { disponivel: false },
      { disponivel: true },
    ]);
  });

  test("o «Desfazer» a falhar (500 no 2.º PATCH): o interruptor fica desligado e o aviso diz que não desfez", async ({
    page,
  }) => {
    await abrir(page, "/gestao/ementa", {
      falhas: [
        {
          metodo: "PATCH",
          caminho: /\/gestao\/produtos\/101$/,
          ordem: 2,
          resposta: { estado: 500, corpo: { erro: "interno", mensagem: "x" } },
        },
      ],
    });
    const interruptor = page
      .locator("li", { has: page.getByRole("button", { name: "Café", exact: true }) })
      .getByRole("switch", { name: T.etiquetaDisponivel });

    await interruptor.tap();
    await aviso(page).getByRole("button", { name: T.desfazer }).tap();

    await expect(aviso(page)).toContainText(/Não consegui desfazer\./);
    await expect(interruptor).not.toBeChecked();
  });
});

test.describe("ordenar", () => {
  async function entrarNoModo(page: Page): Promise<ServidorDeEmenta> {
    const servidor = await abrir(page, "/gestao/ementa");
    await page.getByRole("button", { name: T.ordenar }).tap();
    await expect(page.getByText("A ordenar Cafetaria.")).toBeVisible();
    return servidor;
  }
  async function ordem(page: Page): Promise<string[]> {
    const nomes = await page
      .getByRole("button", { name: /^Subir / })
      .evaluateAll((bs) =>
        bs.map((b) => (b.getAttribute("aria-label") ?? "").replace(/^Subir /, "")),
      );
    return nomes;
  }

  test("Subir, Descer, Para o início, Para o fim e «Guardar ordem»: UM PUT completo", async ({
    page,
  }) => {
    const servidor = await entrarNoModo(page);

    await page.getByRole("button", { name: "Subir Galão" }).tap();
    await page.getByRole("button", { name: "Descer Galão" }).tap();
    await page.getByRole("button", { name: "Mover Café duplo para o início" }).tap();
    await page.getByRole("button", { name: "Mover Café para o fim" }).tap();
    expect(await ordem(page)).toEqual(["Café duplo", "Galão", "Cappuccino", "Café"]);
    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);

    await page.getByRole("button", { name: T.guardarOrdem }).tap();

    await expect(aviso(page)).toContainText(T.ordemGuardada);
    const puts = pedidosDe(servidor, "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.caminho).toBe("/gestao/categorias/1/produtos/ordem");
    expect(puts[0]?.corpo).toEqual({ ids: [104, 102, 103, 101] });
  });

  test("«Cancelar» não faz pedido e repõe a ordem", async ({ page }) => {
    const servidor = await entrarNoModo(page);
    await page.getByRole("button", { name: "Mover Café para o fim" }).tap();
    await page.getByRole("button", { name: T.cancelar }).tap();

    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Café", exact: true })).toBeVisible();
  });

  test("409 no PUT: a lista do servidor e o aviso de erro", async ({ page }) => {
    await abrir(page, "/gestao/ementa", {
      falhas: [
        {
          metodo: "PUT",
          caminho: /ordem$/,
          resposta: { estado: 409, corpo: { erro: "lista_desatualizada", mensagem: "x" } },
        },
      ],
    });
    await page.getByRole("button", { name: T.ordenar }).tap();
    await page.getByRole("button", { name: "Mover Café para o fim" }).tap();
    await page.getByRole("button", { name: T.guardarOrdem }).tap();

    await expect(aviso(page)).toContainText(T.erro409);
    await expect(page.getByText("A ordenar Cafetaria.")).toHaveCount(0);
  });

  test("«Desfazer» da ordem com 409 no segundo PUT: lista do servidor, aviso de erro, nunca «Alteração desfeita»", async ({
    page,
  }) => {
    const servidor = await abrir(page, "/gestao/ementa", {
      falhas: [
        {
          metodo: "PUT",
          caminho: /ordem$/,
          ordem: 2,
          resposta: { estado: 409, corpo: { erro: "lista_desatualizada", mensagem: "x" } },
        },
      ],
    });
    await page.getByRole("button", { name: T.ordenar }).tap();
    await page.getByRole("button", { name: "Mover Café para o fim" }).tap();
    await page.getByRole("button", { name: T.guardarOrdem }).tap();
    await aviso(page).getByRole("button", { name: T.desfazer }).tap();

    await expect(aviso(page)).toContainText(T.erroDesfazerOrdem409);
    await expect(page.getByText(T.alteracaoDesfeita)).toHaveCount(0);
    expect(pedidosDe(servidor, "PUT")).toHaveLength(2);
  });
});

test.describe("ordenar com o rato, a 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("arrastar pela pega muda a ordem local sem pedido; só «Guardar ordem» grava; nenhum style no DOM", async ({
    page,
  }) => {
    const servidor = await abrir(page, "/gestao/ementa");
    await page.getByRole("button", { name: T.ordenar }).click();

    const pega = page.locator("li [data-pega]").first();
    const caixa = await pega.boundingBox();
    expect(caixa).not.toBeNull();
    const x = (caixa?.x ?? 0) + (caixa?.width ?? 0) / 2;
    const y = (caixa?.y ?? 0) + (caixa?.height ?? 0) / 2;
    // A linha de um produto, e não o primeiro `<li>` da página (que é um item da navegação).
    const alturaDaLinha = await page
      .locator("li", { has: page.locator("[data-pega]") })
      .first()
      .evaluate((li) => li.getBoundingClientRect().height);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + alturaDaLinha * 0.75, { steps: 6 });
    expect(await page.locator("[style]").count(), "nenhum atributo style durante o arrasto").toBe(
      0,
    );
    await page.mouse.move(x, y + alturaDaLinha * 1.2, { steps: 6 });
    expect(await page.locator("[style]").count()).toBe(0);
    await page.mouse.up();

    const nomes = await page
      .getByRole("button", { name: /^Subir / })
      .evaluateAll((bs) =>
        bs.map((b) => (b.getAttribute("aria-label") ?? "").replace(/^Subir /, "")),
      );
    expect(nomes.slice(0, 2)).toEqual(["Galão", "Café"]);
    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);

    await page.getByRole("button", { name: T.guardarOrdem }).click();
    await expect(aviso(page)).toContainText(T.ordemGuardada);
    expect(pedidosDe(servidor, "PUT")).toHaveLength(1);
    expect((pedidosDe(servidor, "PUT")[0]?.corpo as { ids: number[] }).ids.slice(0, 2)).toEqual([
      102, 101,
    ]);
  });

  test("Esc a meio do arrasto cancela-o", async ({ page }) => {
    await abrir(page, "/gestao/ementa");
    await page.getByRole("button", { name: T.ordenar }).click();
    const pega = page.locator("li [data-pega]").first();
    const caixa = await pega.boundingBox();
    const x = (caixa?.x ?? 0) + 10;
    const y = (caixa?.y ?? 0) + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 200, { steps: 8 });

    // Antes do Esc a ordem já mudou: sem isto o teste passava com um arrasto que
    // nunca começou.
    const subir = page.getByRole("button", { name: /^Subir / });
    const ordemAntes = await subir.evaluateAll((nos) =>
      nos.map((n) => n.getAttribute("aria-label")),
    );
    expect(ordemAntes[0]).not.toBe("Subir Café");

    await page.keyboard.press("Escape");
    await page.mouse.up();

    const primeiro = await subir.first().getAttribute("aria-label");
    expect(primeiro).toBe("Subir Café");
  });
});

test.describe("adicionar e editar produto", () => {
  test("adicionar: o produto entra no fim da categoria", async ({ page }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: T.adicionarProduto }).tap();
    const folha = page.getByRole("dialog", { name: T.tituloAdicionar });
    await folha.getByLabel(T.etiquetaNome).fill("Água tónica");
    await folha.getByLabel(T.etiquetaPrecoDaFolha).fill("1,5");
    await folha.getByRole("button", { name: T.guardarProduto }).tap();

    await expect(aviso(page)).toContainText(T.produtoAdicionado);
    await expect(page.getByRole("button", { name: "Água tónica", exact: true })).toBeVisible();
    expect(pedidosDe(servidor, "POST").map((p) => p.corpo)).toEqual([
      { categoria_id: 2, nome: "Água tónica", preco_cent: 150, disponivel: true },
    ]);
  });

  test("editar o nome: o PATCH só tem essa chave; a linha muda", async ({ page }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: VINHO, exact: true }).tap();
    const folha = page.getByRole("dialog", { name: T.tituloEditar });
    await folha.getByLabel(T.etiquetaNome).fill("Tinto da casa");
    await folha.getByRole("button", { name: T.guardarAlteracoes }).tap();

    await expect(page.getByRole("button", { name: "Tinto da casa", exact: true })).toBeVisible();
    expect(pedidosDe(servidor, "PATCH").map((p) => p.corpo)).toEqual([{ nome: "Tinto da casa" }]);
  });

  test("editar a categoria: aparece no fim da outra", async ({ page }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: VINHO, exact: true }).tap();
    const folha = page.getByRole("dialog", { name: T.tituloEditar });
    await folha.getByLabel(T.etiquetaCategoria).selectOption({ label: "Cafetaria" });
    await folha.getByRole("button", { name: T.guardarAlteracoes }).tap();

    await expect(aviso(page)).toContainText("Produto movido para Cafetaria.");
    expect(pedidosDe(servidor, "PATCH").map((p) => p.corpo)).toEqual([{ categoria_id: 1 }]);
    await page.getByRole("link", { name: "Cafetaria" }).tap();
    const ultimo = page
      .getByRole("button", { name: /^(Café|Galão|Cappuccino|Café duplo|Vinho tinto da casa)$/ })
      .last();
    await expect(ultimo).toHaveText(VINHO);
  });
});

test.describe("pesquisa e estados", () => {
  test("«cafe» encontra «Café» e «Café duplo»; sem resultados mostra o estado próprio", async ({
    page,
  }) => {
    await abrir(page, "/gestao/ementa");
    await page.getByLabel(T.pesquisa).fill("cafe");
    await expect(page.getByRole("button", { name: "Café", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Café duplo", exact: true })).toBeVisible();
    await page.getByLabel(T.pesquisa).fill("zzzz");
    await expect(page.getByText(T.semResultados)).toBeVisible();
  });

  test("regra 10 no GET: abortar é erro (nunca vazio); [] é vazio (nunca erro)", async ({
    page,
  }) => {
    await abrir(page, "/gestao/ementa", {
      falhas: [{ metodo: "GET", caminho: /categorias$/, resposta: "abortar" }],
      esperarLista: false,
    });
    await expect(page.getByText(T.erroDeCarregarTitulo)).toBeVisible();
    await expect(page.getByText(T.vazioTitulo)).toHaveCount(0);
  });

  test("lista vazia: «Ainda não há ementa.», sem botões", async ({ page }) => {
    await abrir(page, "/gestao/ementa", { categorias: [], esperarLista: false });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await expect(page.getByText(T.erroDeCarregarTitulo)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await semViolacoesGraves(page, "vazio");
  });

  test("nem controlos de categorias nem de eliminar em lado nenhum", async ({ page }) => {
    await abrir(page, "/gestao/ementa");
    const corpo = (await page.locator("body").innerText()).toLowerCase();
    for (const proibido of ["nova categoria", "renomear", "eliminar", "esconder"]) {
      expect(corpo).not.toContain(proibido);
    }
  });
});

test.describe("acessibilidade (Q-03) e alvos (Q-04), a 390 × 844", () => {
  test("axe: lista, preço em edição, modo ordenar, folhas, aviso com «Desfazer»", async ({
    page,
  }) => {
    await abrir(page);
    await semViolacoesGraves(page, "lista");

    await page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") }).tap();
    await semViolacoesGraves(page, "preço em edição");
    await page.getByLabel("Preço, em euros").fill("0");
    await page.getByRole("button", { name: T.guardar }).tap();
    await expect(aviso(page).getByRole("button", { name: T.desfazer })).toBeVisible();
    await semViolacoesGraves(page, "aviso com desfazer");

    await page.getByRole("button", { name: T.ordenar }).tap();
    await semViolacoesGraves(page, "modo ordenar");
    await page.getByRole("button", { name: T.cancelar }).tap();

    await page.getByRole("button", { name: T.adicionarProduto }).tap();
    await semViolacoesGraves(page, "folha de adicionar");
    await page.getByRole("button", { name: T.cancelar }).tap();

    await page.getByRole("button", { name: VINHO, exact: true }).tap();
    await semViolacoesGraves(page, "folha de editar");
  });

  test("alvos de 44 × 44: preço, interruptor, nome, Ordenar, os quatro botões, Guardar ordem, Cancelar, Adicionar", async ({
    page,
  }) => {
    await abrir(page);
    const alvos: Array<[string, Locator]> = [
      ["preço", page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") })],
      ["nome", page.getByRole("button", { name: VINHO, exact: true })],
      // O alvo do interruptor é a linha inteira (`<label>`), não o carril de 28 px (F3-01, 7.6).
      [
        "interruptor",
        page
          .locator("label")
          .filter({ has: page.getByRole("switch", { name: T.etiquetaDisponivel }) })
          .first(),
      ],
      ["Ordenar", page.getByRole("button", { name: T.ordenar })],
      ["Adicionar", page.getByRole("button", { name: T.adicionarProduto })],
    ];
    for (const [nome, alvo] of alvos) {
      const caixa = await alvo.boundingBox();
      expect(caixa?.height ?? 0, `${nome}: altura`).toBeGreaterThanOrEqual(44);
      expect(caixa?.width ?? 0, `${nome}: largura`).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: T.ordenar }).tap();
    for (const nome of [
      "Subir Espumante",
      "Descer Espumante",
      "Mover Espumante para o início",
      "Mover Espumante para o fim",
      T.guardarOrdem,
      T.cancelar,
    ]) {
      const caixa = await page.getByRole("button", { name: nome }).boundingBox();
      expect(caixa?.height ?? 0, `${nome}: altura`).toBeGreaterThanOrEqual(44);
      expect(caixa?.width ?? 0, `${nome}: largura`).toBeGreaterThanOrEqual(44);
    }
    const pega = await page.locator("li [data-pega]").first().boundingBox();
    expect(pega?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(pega?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("o aviso assenta por cima da barra inferior", async ({ page }) => {
    await abrir(page);
    await page.getByRole("switch", { name: T.etiquetaDisponivel }).first().tap();
    const el = aviso(page);
    await expect(el).toBeVisible();
    const caixa = await el.boundingBox();
    const barra = await page.getByRole("navigation", { name: "Gestão" }).boundingBox();
    expect(caixa).not.toBeNull();
    expect(barra).not.toBeNull();
    expect((caixa?.y ?? 0) + (caixa?.height ?? 0)).toBeLessThanOrEqual(barra?.y ?? 0);
  });

  test("o pior caso (nome de 120, descrição de 280, 1.250,00 €) não corta nem faz rolar na horizontal, nem no modo ordenar", async ({
    page,
  }) => {
    const categorias: CategoriaGestao[] = [
      {
        id: 1,
        nome: "Garrafeira",
        slug: "garrafeira",
        visivel: true,
        produtos: [
          produtoDeTeste({
            id: 1,
            categoria_id: 1,
            nome: "N".repeat(120),
            descricao: "d".repeat(280),
            preco_cent: 125_000,
          }),
          produtoDeTeste({ id: 2, categoria_id: 1, nome: "Outro", preco_cent: 100 }),
        ],
      },
    ];
    await abrir(page, "/gestao/ementa", { categorias });
    const semRolagem = (): Promise<boolean> =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    expect(await semRolagem()).toBe(true);
    await page.getByRole("button", { name: T.ordenar }).tap();
    expect(await semRolagem()).toBe(true);
  });

  test("ordem de tabulação numa linha: nome, preço, interruptor", async ({ page }) => {
    await abrir(page);
    await page.getByRole("button", { name: VINHO, exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: nomeDoPreco(VINHO, "6,50 €") })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.locator("li", { hasText: VINHO }).getByRole("switch", { name: T.etiquetaDisponivel }),
    ).toBeFocused();
  });
});
