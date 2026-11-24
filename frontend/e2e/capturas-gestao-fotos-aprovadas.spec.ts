import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS_APROVADAS as A } from "../src/testes/fotos-gestao-textos";
import { guardar } from "./apoio/capturas";
import { aprovadasDoE2E, fotosDoE2E, muitasAprovadasDoE2E, type Falha } from "./apoio/gestao-fotos";
import {
  abrirGaleria,
  aviso,
  botoesEliminar,
  eliminarDe,
  folhaDeEliminar,
  itens,
  miniaturasCarregadas,
  seccao,
  tituloDaSeccao,
} from "./apoio/gestao-fotos-aprovadas";

// Só nas capturas: 24 h e dd/mm, como o dono as vê (a hora é sempre a de Lisboa).
test.use({ locale: "pt-PT", timezoneId: "Europe/Lisbon" });

/**
 * F4-04b — as capturas que a revisão ui-ux e o PR abrem (spec 11, «Capturas a pedir»): 390 × 844
 * e 1024 × 768. Não comparam com imagem de referência. Vão para `test-results/capturas/` com o
 * nome `gestao-fotos-<nome>` (o do quadro da spec). Cada uma **afirma** o que mostra antes de
 * fotografar: uma captura do ecrã errado não pode passar por boa (regra 10).
 */

async function tirar(page: Page, nome: string, inteira = false): Promise<void> {
  if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
  await guardar(`gestao-fotos-${nome}`, (caminho) =>
    page.screenshot({ path: caminho, fullPage: inteira }),
  );
}
async function aoFundoDaFila(page: Page): Promise<void> {
  await seccao(page).scrollIntoViewIfNeeded();
}

test.describe("telemóvel, 390 × 844", () => {
  test("galeria-aprovadas-390: três fotos, uma legenda longa, ao fundo da fila", async ({
    page,
  }) => {
    await abrirGaleria(page);
    await miniaturasCarregadas(page);
    await expect(itens(page)).toHaveCount(3);
    await aoFundoDaFila(page);
    await tirar(page, "galeria-aprovadas-390");
    await tirar(page, "galeria-aprovadas-390-pagina-inteira", true);
  });

  test("galeria-aprovadas-muitas-390: 23 aprovadas, 8 itens, a nota e o botão", async ({
    page,
  }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(23)] });
    await expect(itens(page)).toHaveCount(8);
    await expect(seccao(page).getByText(A.aMostrar(8, 23))).toBeVisible();
    await miniaturasCarregadas(page);
    await seccao(page).getByRole("button", { name: A.mostrarMais }).scrollIntoViewIfNeeded();
    await tirar(page, "galeria-aprovadas-muitas-390");
  });

  test("galeria-aprovadas-carregar-390: esqueleto", async ({ page }) => {
    await abrirGaleria(page, { esperar: false, atrasoMs: 20_000 });
    await expect(seccao(page).locator('[aria-busy="true"]')).toBeVisible();
    await aoFundoDaFila(page);
    await tirar(page, "galeria-aprovadas-carregar-390");
  });

  test("galeria-aprovadas-vazio-390", async ({ page }) => {
    await abrirGaleria(page, { inicial: fotosDoE2E() });
    await expect(page.getByText(A.vazioTitulo)).toBeVisible();
    await aoFundoDaFila(page);
    await tirar(page, "galeria-aprovadas-vazio-390");
  });

  test("galeria-aprovadas-erro-390: erro a carregar, a fila a funcionar por cima", async ({
    page,
  }) => {
    await abrirGaleria(page, {
      esperar: false,
      falhas: [{ metodo: "GET", caminho: /^\/gestao\/fotos\/aprovadas$/, resposta: "abortar" }],
    });
    await expect(seccao(page).getByText(A.carregarTitulo)).toBeVisible();
    await expect(botoesEliminar(page)).toHaveCount(0);
    await aoFundoDaFila(page);
    await tirar(page, "galeria-aprovadas-erro-390");
  });

  test("galeria-eliminar-390: a folha aberta, foco em Cancelar", async ({ page }) => {
    await abrirGaleria(page);
    await miniaturasCarregadas(page);
    await eliminarDe(page, 201).tap();
    await expect(folhaDeEliminar(page)).toBeVisible();
    await expect(folhaDeEliminar(page).getByRole("button", { name: A.cancelar })).toBeFocused();
    await expect(folhaDeEliminar(page).getByText(A.enviadaPor("Marta"))).toBeVisible();
    await tirar(page, "galeria-eliminar-390");
  });

  test("galeria-eliminar-erro-390: a folha com a mensagem do 500", async ({ page }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/fotos\/201$/, resposta: { estado: 500 } },
    ];
    await abrirGaleria(page, { falhas });
    await eliminarDe(page, 201).tap();
    await folhaDeEliminar(page).getByRole("button", { name: A.eliminar, exact: true }).tap();
    await expect(folhaDeEliminar(page).getByText(A.erroNaFolha)).toBeVisible();
    await tirar(page, "galeria-eliminar-erro-390");
  });

  test("galeria-eliminar-aviso-390: «Foto eliminada.» por cima da lista, foco no <h2>", async ({
    page,
  }) => {
    await abrirGaleria(page);
    await eliminarDe(page, 202).tap();
    await folhaDeEliminar(page).getByRole("button", { name: A.eliminar, exact: true }).tap();
    await expect(aviso(page)).toContainText(A.avisoEliminada);
    await expect(tituloDaSeccao(page)).toBeFocused();
    await tirar(page, "galeria-eliminar-aviso-390");
  });

  test("galeria-aprovadas-sem-imagem-390: «Sem imagem» com o «Eliminar» ativo", async ({
    page,
  }) => {
    await abrirGaleria(page, {
      antesDeAbrir: async (p) => {
        await p.route("**/media/foto-202.webp", (rota) => rota.fulfill({ status: 404, body: "x" }));
      },
    });
    await expect(seccao(page).getByText(A.semImagem)).toBeVisible();
    await aoFundoDaFila(page);
    await tirar(page, "galeria-aprovadas-sem-imagem-390");
  });
});

test.describe("secretária, 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: false });

  test("galeria-aprovadas-1024: coluna lateral e a lista de 8", async ({ page }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...muitasAprovadasDoE2E(10)] });
    await expect(itens(page)).toHaveCount(8);
    await miniaturasCarregadas(page);
    await aoFundoDaFila(page);
    await tirar(page, "galeria-aprovadas-1024");
  });

  test("galeria-eliminar-1024: a folha centrada", async ({ page }) => {
    await abrirGaleria(page, { inicial: [...fotosDoE2E(), ...aprovadasDoE2E()] });
    await miniaturasCarregadas(page);
    await eliminarDe(page, 201).click();
    await expect(folhaDeEliminar(page)).toBeVisible();
    await tirar(page, "galeria-eliminar-1024");
  });
});
