import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS_INICIO as T } from "../src/testes/clientes-gestao-textos";
import { guardar } from "./apoio/capturas";
import { abrirInicio, alvosDe44, axeSemViolacoesGraves, type Falha } from "./apoio/gestao-clientes";

// Só nas capturas: 24 h e dd/mm, como o dono as vê (a hora é sempre a de Lisboa).
test.use({ locale: "pt-PT", timezoneId: "Europe/Lisbon" });

/**
 * F4-05b — as capturas do Início que a revisão ui-ux e o PR abrem (spec 10, «Capturas a pedir»):
 * 390 × 844 e 1024 × 768. Não comparam com imagem de referência. Vão para `test-results/capturas/`
 * com o nome `gestao-<nome>` (o do quadro da spec). Cada uma **afirma** o que mostra antes de
 * fotografar — uma captura do ecrã errado não pode passar por boa (regra 10) — e passa o axe e a
 * medida dos 44 px.
 */

async function tirar(page: Page, nome: string): Promise<void> {
  await guardar(`gestao-${nome}`, (caminho) => page.screenshot({ path: caminho }));
}

test.describe("telemóvel, 390 × 844", () => {
  test("inicio-390: 3 fotos à espera, 3 eventos, 2 registos: o botão dourado e as três secções", async ({
    page,
  }) => {
    await abrirInicio(page, { fotosPendentes: 3, novosRegistos: 2 });
    await expect(page.getByText(T.fotosN(3))).toBeVisible();
    await expect(page.getByRole("link", { name: T.irParaAFila })).toBeVisible();
    await expect(page.getByText(T.registosN(2))).toBeVisible();
    await expect(page.locator("main li")).toHaveCount(3);
    await axeSemViolacoesGraves(page, "inicio-390");
    await alvosDe44(page, "inicio-390");
    await tirar(page, "inicio-390");
  });

  test("inicio-sem-fotos-390: 0 fotos, 0 eventos, 0 registos: sem botão, as três frases de zero", async ({
    page,
  }) => {
    await abrirInicio(page, { fotosPendentes: 0, eventos: [], novosRegistos: 0 });
    await expect(page.getByText(T.fotos0)).toBeVisible();
    await expect(page.getByText(T.eventosVazio)).toBeVisible();
    await expect(page.getByText(T.registos0)).toBeVisible();
    await expect(page.getByRole("link", { name: T.irParaAFila })).toHaveCount(0);
    await axeSemViolacoesGraves(page, "inicio-sem-fotos-390");
    await alvosDe44(page, "inicio-sem-fotos-390");
    await tirar(page, "inicio-sem-fotos-390");
  });

  test("inicio-carregar-390: esqueleto", async ({ page }) => {
    await abrirInicio(page, { atrasoMs: 20_000, esperar: false });
    await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    await tirar(page, "inicio-carregar-390");
  });

  test("inicio-erro-390: erro a carregar, a barra de navegação a funcionar", async ({ page }) => {
    const falhas: Falha[] = [{ metodo: "GET", caminho: /^\/gestao\/resumo$/, resposta: "abortar" }];
    await abrirInicio(page, { falhas, esperar: false });
    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await expect(page.getByText(T.erroSemResposta)).toBeVisible();
    await expect(page.getByRole("link", { name: "Ementa" })).toBeVisible();
    await axeSemViolacoesGraves(page, "inicio-erro-390");
    await alvosDe44(page, "inicio-erro-390");
    await tirar(page, "inicio-erro-390");
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("inicio-1024: coluna lateral + os três blocos", async ({ page }) => {
    await abrirInicio(page);
    await expect(page.getByRole("region")).toHaveCount(3);
    await axeSemViolacoesGraves(page, "inicio-1024");
    await alvosDe44(page, "inicio-1024");
    await tirar(page, "inicio-1024");
  });
});
