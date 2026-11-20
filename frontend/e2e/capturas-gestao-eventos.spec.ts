import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS as T } from "../src/pages/gestao/eventos/textos";
import { AGORA } from "../src/testes/eventos";
import {
  eventosDeGestaoVazios,
  type EventoGestao,
  type RespostaEventosGestao,
} from "../src/testes/gestao";
import { guardar } from "./apoio/capturas";
import { fingirApiDeSessao } from "./apoio/gestao";
import { fingirApiDeEventos, type Falha } from "./apoio/gestao-eventos";

// Só nas capturas: 24 h e dd/mm, como o dono as vê (os testes do fuso estão noutro ficheiro).
test.use({ locale: "pt-PT", timezoneId: "Europe/Lisbon" });

/**
 * F4-03 — as capturas que a revisão ui-ux e o PR abrem (390 × 844 e 1024 × 768). Não comparam com
 * imagem de referência. Vão para `test-results/capturas/`.
 */
async function abrir(
  page: Page,
  opcoes: {
    inicial?: RespostaEventosGestao | EventoGestao[];
    falhas?: Falha[];
    lista?: boolean;
  } = {},
): Promise<void> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  await fingirApiDeEventos(page, { ...opcoes, sessao, agora: AGORA });
  await page.clock.install({ time: AGORA });
  await page.goto("/gestao/eventos");
  await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
  if (opcoes.lista !== false)
    await expect(page.getByRole("region", { name: T.proximos })).toBeVisible();
}

async function tirar(
  page: Page,
  nome: string,
  tamanho: "390" | "1024",
  inteira = false,
): Promise<void> {
  if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
  await guardar(`gestao-eventos-${tamanho}-${nome}`, (caminho) =>
    page.screenshot({ path: caminho, fullPage: inteira }),
  );
}

async function sequencia(page: Page, tamanho: "390" | "1024"): Promise<void> {
  const tocar = (l: ReturnType<Page["locator"]>) => (tamanho === "390" ? l.tap() : l.click());
  await abrir(page);
  await tirar(page, "lista-com-divisoria", tamanho, true);

  await tocar(page.getByRole("button", { name: T.verOArquivo(2) }));
  await tirar(page, "arquivo-aberto", tamanho, true);
  await tocar(page.getByRole("button", { name: T.esconderOArquivo }));

  await tocar(page.getByRole("button", { name: T.novoEvento }));
  await expect(page.getByRole("dialog", { name: T.tituloCriar })).toBeVisible();
  await tirar(page, "folha-criar-vazia", tamanho);
  await tocar(page.getByRole("button", { name: T.publicar }));
  await expect(page.getByText(T.erroTituloVazio)).toBeVisible();
  await tirar(page, "folha-criar-com-erros", tamanho);
  await page.getByLabel(T.etiquetaTitulo, { exact: true }).fill("Fado de sexta");
  await page
    .getByLabel(T.etiquetaDescricao, { exact: true })
    .fill("Primeira linha.\nSegunda linha.");
  await page.getByLabel(T.etiquetaData, { exact: true }).fill("2026-11-27");
  await page.getByLabel(T.etiquetaHora, { exact: true }).fill("00:30");
  await tirar(page, "folha-criar-com-pre-visualizacao", tamanho);
  await tocar(page.getByRole("button", { name: T.cancelar }));
  await tocar(page.getByRole("button", { name: T.saidaSair }));

  await tocar(page.getByRole("button", { name: "Fado ao vivo", exact: true }));
  await tirar(page, "folha-editar", tamanho);
  await tocar(page.getByRole("button", { name: T.eliminarEvento }));
  await tirar(page, "folha-eliminar", tamanho);
  await tocar(
    page.getByRole("dialog", { name: T.tituloEliminar }).getByRole("button", { name: T.cancelar }),
  );
  await tocar(page.getByRole("button", { name: T.cancelar }));

  await tocar(page.getByRole("button", { name: T.duplicarDe("Fado ao vivo") }));
  await expect(page.getByRole("dialog", { name: T.tituloDuplicar })).toBeVisible();
  await tirar(page, "folha-duplicar", tamanho);
  await tocar(page.getByRole("button", { name: new RegExp(T.daquiASemanas(2)) }));
  await expect(page.getByRole("button", { name: T.desfazer })).toBeVisible();
  await tirar(page, "aviso-de-duplicar", tamanho, true);
}

test.describe("telemóvel, 390 × 844", () => {
  test("lista, arquivo, folhas e aviso", async ({ page }) => {
    await sequencia(page, "390");
  });

  test("vazio e erro", async ({ page }) => {
    await abrir(page, { inicial: eventosDeGestaoVazios() });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await tirar(page, "vazio", "390");
  });

  test("erro de carregar", async ({ page }) => {
    await abrir(page, {
      lista: false,
      falhas: [{ metodo: "GET", caminho: /\/gestao\/eventos$/, resposta: "abortar" }],
    });
    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await tirar(page, "erro", "390");
  });
});

test.describe("computador, 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });
  test("lista, arquivo, folhas e aviso", async ({ page }) => {
    await sequencia(page, "1024");
  });
});
