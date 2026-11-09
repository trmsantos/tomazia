import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEM_FOTOS, SETE_FOTOS, TEXTOS_DA_GALERIA } from "../src/testes/galeria";
import type { Galeria } from "../src/lib/api/publico";
import { fingirInfoFixo } from "./apoio/cabecalho";
import { guardar } from "./apoio/capturas";
import { fingirEmentaFixa } from "./apoio/ementa";
import { fingirEventosFixos } from "./apoio/eventos";
import {
  abrirComGaleria,
  botaoDeTentarOutraVez,
  fingirFalhaDaGaleria,
  seccaoDaGaleria,
} from "./apoio/galeria";
import { SEM_EVENTOS } from "../src/testes/eventos";

/**
 * F3-05, 14 — as capturas que a revisão ui-ux abre.
 *
 * No padrão do `capturas-eventos.spec.ts`: não comparam com imagem de
 * referência, servem a revisão e o PR (o `CLAUDE.md` obriga a capturas a
 * 390 × 844 para qualquer alteração visual).
 *
 * **Duas decisões desta tarefa ficam por confirmar em cima de píxeis, não
 * em palavras** (18, "Perguntas e entregas"):
 *
 *  - o número de colunas a 1024 px (4.1) — três colunas dão fotos de
 *    ~205 px de lado, "é a `1024-galeria.png` que decide se a parede fica
 *    densa de mais ou se lê bem";
 *  - a ausência de um contador visível no 429 (9.2) — essa tem captura
 *    própria em `e2e/galeria.spec.ts` (16.5, ponto 5), não aqui.
 *
 * **O que estas capturas deixam passar:** tudo o que é movimento, estado
 * dinâmico e gesto — o Visualizador, o 429 composto, a redução no browser.
 * Isso é `e2e/galeria.spec.ts`.
 */

async function abrir(pagina: Page, corpo: Galeria): Promise<void> {
  await fingirInfoFixo(pagina);
  await fingirEmentaFixa(pagina);
  await fingirEventosFixos(pagina, SEM_EVENTOS);
  await abrirComGaleria(pagina, corpo);
  await seccaoDaGaleria(pagina).scrollIntoViewIfNeeded();
  await pagina.waitForLoadState("networkidle");
}

test.describe("390 × 844", () => {
  test("a galeria vazia, o estado de lançamento (4.3)", async ({ page }) => {
    await abrir(page, SEM_FOTOS);
    await expect(page.getByText(TEXTOS_DA_GALERIA.vazioTitulo)).toBeVisible();

    await guardar("390-galeria-vazia", (caminho) =>
      seccaoDaGaleria(page).screenshot({ path: caminho }),
    );
  });

  test("a grelha com fotos, e 'Ver mais fotos' (4.6)", async ({ page }) => {
    await abrir(page, SETE_FOTOS);
    await expect(page.getByRole("button", { name: TEXTOS_DA_GALERIA.verMaisFotos })).toBeVisible();

    await guardar("390-galeria", (caminho) => seccaoDaGaleria(page).screenshot({ path: caminho }));
  });

  test("o erro, com o título presente por cima (4.5)", async ({ page }) => {
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirEventosFixos(page, SEM_EVENTOS);
    await fingirFalhaDaGaleria(page);
    await page.goto("/");
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();
    await seccaoDaGaleria(page).scrollIntoViewIfNeeded();

    await guardar("390-galeria-erro", (caminho) =>
      seccaoDaGaleria(page).screenshot({ path: caminho }),
    );
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("a grelha a três colunas — por confirmar em cima de píxeis (4.1)", async ({ page }) => {
    await abrir(page, SETE_FOTOS);

    await guardar("1024-galeria", (caminho) => seccaoDaGaleria(page).screenshot({ path: caminho }));
  });
});
