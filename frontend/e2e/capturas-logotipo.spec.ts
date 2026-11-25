import { expect, test } from "@playwright/test";

import { abrirAPaginaPublica, cabecalho } from "./apoio/cabecalho";
import { guardar } from "./apoio/capturas";
import { esperarQueAPaginaPare } from "./apoio/ementa";

/**
 * F3-08, secção 9: as capturas que o ui-ux revê e o Tomás aprova.
 *
 * **Fica num ficheiro próprio** (a especificação diz `e2e/capturas.spec.ts`,
 * mas esse é o da página de demonstração da F3-01; as tarefas seguintes
 * seguem o padrão `capturas-<ecrã>.spec.ts`).
 *
 * Cada captura espera primeiro que o logótipo tenha **carregado** (largura
 * natural > 0): uma captura com o `alt` a fazer de texto não é a do
 * logótipo, e sairia na mesma sem erro. Por isso falham hoje, por falta do
 * `<img>`. Vão para `test-results/capturas/`.
 *
 * Não incluídas (a especificação pede-as "abertas como ficheiros"):
 * `og-image.jpg` e `apple-touch-icon.png`.
 */

const LOGOTIPO = "header h1 img";

async function esperarOLogotipo(pagina: import("@playwright/test").Page): Promise<void> {
  await expect(
    pagina.locator(LOGOTIPO),
    "não há <img> no <h1>: a captura mostraria o texto, não o logótipo",
  ).toHaveCount(1, { timeout: 5_000 });
  await expect
    .poll(
      () =>
        pagina
          .locator(LOGOTIPO)
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      { message: "o logótipo não carregou" },
    )
    .toBe(true);
}

test.describe("capturas do logótipo", () => {
  test("390 × 844, topo da página", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await esperarOLogotipo(page);
    await guardar("390-cabecalho-logotipo", (caminho) => page.screenshot({ path: caminho }));
  });

  test.describe("360 × 800", () => {
    test.use({ viewport: { width: 360, height: 800 } });

    test("o círculo distingue-se do fundo e nada transborda", async ({ page }) => {
      await abrirAPaginaPublica(page);
      await esperarOLogotipo(page);
      await guardar("360-cabecalho-logotipo", (caminho) => page.screenshot({ path: caminho }));
    });
  });

  test.describe("1024 × 768", () => {
    test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

    test("a mesma linha, com o logótipo nas pontas da coluna", async ({ page }) => {
      await abrirAPaginaPublica(page);
      await esperarOLogotipo(page);
      await guardar("1024-cabecalho-logotipo", (caminho) => page.screenshot({ path: caminho }));
    });
  });

  test.describe("a 3x", () => {
    test.use({ deviceScaleFactor: 3 });

    test("recorte do cabeçalho: serve o de 132 px e o aro vê-se nítido", async ({ page }) => {
      await abrirAPaginaPublica(page);
      await esperarOLogotipo(page);
      const servido = await page
        .locator(LOGOTIPO)
        .evaluate((img: HTMLImageElement) => img.currentSrc);
      expect(servido.endsWith("/marca/logo-132.webp"), `serviu ${servido}`).toBe(true);

      const cab = await cabecalho(page).boundingBox();
      expect(cab, "não consegui medir o cabeçalho").not.toBeNull();
      if (cab === null) return;
      await guardar("390-cabecalho-logotipo-a-3x", (caminho) =>
        page.screenshot({ path: caminho, clip: cab }),
      );
    });
  });

  test("390 × 844, depois de deslizar para as categorias do meio", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await esperarOLogotipo(page);
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);
    expect(await page.evaluate(() => window.scrollY), "guarda: a página deslizou").toBeGreaterThan(
      300,
    );
    await guardar("390-cabecalho-scroll", (caminho) => page.screenshot({ path: caminho }));
  });
});
