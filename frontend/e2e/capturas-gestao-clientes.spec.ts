import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { EMAIL_DE_80, clientesDeTeste, muitosClientes } from "../src/testes/clientes-dados";
import { TEXTOS_CLIENTES as T } from "../src/testes/clientes-gestao-textos";
import { guardar } from "./apoio/capturas";
import {
  abrirClientes,
  alvosDe44,
  aviso,
  axeSemViolacoesGraves,
  botoesEliminar,
  eliminarDe,
  folhaDeEliminar,
  itens,
  linhaDeEstado,
  seccao,
  tituloDaLista,
  type Falha,
} from "./apoio/gestao-clientes";

// Só nas capturas: 24 h e dd/mm, como o dono as vê (a hora é sempre a de Lisboa).
test.use({ locale: "pt-PT", timezoneId: "Europe/Lisbon" });

/**
 * F4-05b — as capturas dos Clientes (e do «Mais») que a revisão ui-ux e o PR abrem (spec 10,
 * «Capturas a pedir»): 390 × 844 e 1024 × 768. Não comparam com imagem de referência. Vão para
 * `test-results/capturas/` com o nome `gestao-<nome>` (o do quadro da spec). Cada uma **afirma** o
 * que mostra antes de fotografar (regra 10) e passa o axe e a medida dos 44 px.
 */

async function tirar(page: Page, nome: string, inteira = false): Promise<void> {
  if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
  await guardar(`gestao-${nome}`, (caminho) =>
    page.screenshot({ path: caminho, fullPage: inteira }),
  );
}

test.describe("telemóvel, 390 × 844", () => {
  test("mais-390: Definições, Clientes e Sair", async ({ page }) => {
    await abrirClientes(page, { esperar: false });
    await page.goto("/gestao/mais");
    await expect(page.getByRole("link", { name: new RegExp(`^${T.linhaNoMais}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
    await axeSemViolacoesGraves(page, "mais-390");
    await alvosDe44(page, "mais-390");
    await tirar(page, "mais-390");
  });

  test("clientes-390: 4 clientes (um sem telemóvel, um com nome longo, um com email de 80 letras) e «Exportar CSV»", async ({
    page,
  }) => {
    await abrirClientes(page);
    await expect(itens(page)).toHaveCount(4);
    await expect(page.getByText(EMAIL_DE_80)).toBeVisible();
    await expect(page.getByRole("button", { name: T.exportar, exact: true })).toBeVisible();
    await axeSemViolacoesGraves(page, "clientes-390");
    await alvosDe44(page, "clientes-390");
    await tirar(page, "clientes-390");
    await tirar(page, "clientes-390-pagina-inteira", true);
  });

  test("clientes-muitos-390: 137 clientes: 20 itens, «A mostrar 20 de 137.», «Mostrar mais clientes»", async ({
    page,
  }) => {
    await abrirClientes(page, { clientes: muitosClientes(137) });
    await expect(itens(page)).toHaveCount(20);
    await expect(seccao(page).getByText(T.aMostrar(20, 137))).toBeVisible();
    await seccao(page).getByRole("button", { name: T.mostrarMais }).scrollIntoViewIfNeeded();
    await axeSemViolacoesGraves(page, "clientes-muitos-390");
    await alvosDe44(page, "clientes-muitos-390");
    await tirar(page, "clientes-muitos-390");
  });

  test("clientes-exportar-390: o topo da lista: «Exportar CSV», a linha de ajuda e o aviso de dados pessoais", async ({
    page,
  }) => {
    await abrirClientes(page);
    await expect(page.getByText(T.ajudaDoCsv)).toBeVisible();
    await expect(page.getByText(T.avisoDoCsv)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await alvosDe44(page, "clientes-exportar-390");
    await tirar(page, "clientes-exportar-390");
  });

  test("clientes-carregar-390: esqueleto", async ({ page }) => {
    await abrirClientes(page, { atrasoMs: 20_000, esperar: false });
    await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
    await expect(botoesEliminar(page)).toHaveCount(0);
    await tirar(page, "clientes-carregar-390");
  });

  test("clientes-vazio-390: «Não há clientes registados.» sem botões", async ({ page }) => {
    await abrirClientes(page, { clientes: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
    await axeSemViolacoesGraves(page, "clientes-vazio-390");
    await tirar(page, "clientes-vazio-390");
  });

  test("clientes-erro-390: erro a carregar", async ({ page }) => {
    const falhas: Falha[] = [
      { metodo: "GET", caminho: /^\/gestao\/clientes$/, resposta: "abortar" },
    ];
    await abrirClientes(page, { falhas, esperar: false });
    await expect(page.getByText(T.erroTitulo)).toBeVisible();
    await expect(page.getByText(T.erroSemResposta)).toBeVisible();
    await axeSemViolacoesGraves(page, "clientes-erro-390");
    await alvosDe44(page, "clientes-erro-390");
    await tirar(page, "clientes-erro-390");
  });

  test("clientes-csv-erro-390: a lista com «Não consegui preparar o ficheiro…» e o botão ativo", async ({
    page,
  }) => {
    await abrirClientes(page, { csvTipo: "text/html; charset=utf-8" });
    await page.getByRole("button", { name: T.exportar, exact: true }).tap();
    await expect(linhaDeEstado(page, T.csvServidor)).toBeVisible();
    await expect(page.getByRole("button", { name: T.exportar, exact: true })).toBeEnabled();
    await axeSemViolacoesGraves(page, "clientes-csv-erro-390");
    await alvosDe44(page, "clientes-csv-erro-390");
    await tirar(page, "clientes-csv-erro-390");
  });

  test("clientes-eliminar-390: a folha aberta (nome, email, frases, CSV), foco em Cancelar", async ({
    page,
  }) => {
    await abrirClientes(page);
    await eliminarDe(page, "Ana Exemplo").tap();
    const folha = folhaDeEliminar(page);
    await expect(folha).toBeVisible();
    await expect(folha.getByRole("button", { name: T.cancelar, exact: true })).toBeFocused();
    await expect(folha.getByText("ana@exemplo.test")).toBeVisible();
    await expect(folha.getByText(T.linhaDoCsv)).toBeVisible();
    await axeSemViolacoesGraves(page, "clientes-eliminar-390");
    await alvosDe44(page, "clientes-eliminar-390");
    await tirar(page, "clientes-eliminar-390");
  });

  test("clientes-eliminar-erro-390: a folha com a mensagem do 5xx", async ({ page }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/clientes\/101$/, resposta: { estado: 500 } },
    ];
    await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();
    await folhaDeEliminar(page).getByRole("button", { name: T.eliminar, exact: true }).tap();
    await expect(folhaDeEliminar(page).getByText(T.erroNaFolha)).toBeVisible();
    await axeSemViolacoesGraves(page, "clientes-eliminar-erro-390");
    await alvosDe44(page, "clientes-eliminar-erro-390");
    await tirar(page, "clientes-eliminar-erro-390");
  });

  test("clientes-eliminar-aviso-390: «Cliente eliminado.» por cima da lista, foco no <h2> visível", async ({
    page,
  }) => {
    await abrirClientes(page);
    await eliminarDe(page, "Rui Teste").tap();
    await folhaDeEliminar(page).getByRole("button", { name: T.eliminar, exact: true }).tap();
    await expect(aviso(page)).toContainText(T.avisoEliminado);
    await expect(tituloDaLista(page)).toBeFocused();
    await expect(tituloDaLista(page)).toHaveText(T.h2N(3));
    await axeSemViolacoesGraves(page, "clientes-eliminar-aviso-390");
    await alvosDe44(page, "clientes-eliminar-aviso-390");
    await tirar(page, "clientes-eliminar-aviso-390");
  });

  test("clientes-nao-confirmado-390: «Não consegui confirmar…», o cliente ainda na lista, o «Eliminar» dele desativado e «Verificar outra vez»", async ({
    page,
  }) => {
    const falhas: Falha[] = [
      { metodo: "DELETE", caminho: /^\/gestao\/clientes\/101$/, resposta: "abortar" },
      {
        metodo: "GET",
        caminho: /^\/gestao\/clientes$/,
        quando: (s) => s.pedidos.some((p) => p.metodo === "DELETE"),
        resposta: "abortar",
      },
    ];
    await abrirClientes(page, { falhas });
    await eliminarDe(page, "Ana Exemplo").tap();
    await folhaDeEliminar(page).getByRole("button", { name: T.eliminar, exact: true }).tap();
    await expect(linhaDeEstado(page, T.semConfirmar)).toBeVisible();
    await expect(page.getByText("Ana Exemplo")).toBeVisible();
    await expect(eliminarDe(page, "Ana Exemplo")).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("button", { name: T.verificarOutraVez, exact: true }),
    ).toBeVisible();
    await axeSemViolacoesGraves(page, "clientes-nao-confirmado-390");
    await alvosDe44(page, "clientes-nao-confirmado-390");
    await tirar(page, "clientes-nao-confirmado-390");
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("clientes-1024: coluna lateral + lista", async ({ page }) => {
    await abrirClientes(page, { clientes: [...clientesDeTeste()] });
    await expect(itens(page)).toHaveCount(4);
    await axeSemViolacoesGraves(page, "clientes-1024");
    await alvosDe44(page, "clientes-1024");
    await tirar(page, "clientes-1024");
  });

  test("clientes-eliminar-1024: a folha centrada", async ({ page }) => {
    await abrirClientes(page);
    await eliminarDe(page, "Ana Exemplo").click();
    await expect(folhaDeEliminar(page)).toBeVisible();
    await axeSemViolacoesGraves(page, "clientes-eliminar-1024");
    await alvosDe44(page, "clientes-eliminar-1024");
    await tirar(page, "clientes-eliminar-1024");
  });
});
