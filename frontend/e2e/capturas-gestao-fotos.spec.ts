import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { TEXTOS as T } from "../src/pages/gestao/galeria/textos";
import { AGORA } from "../src/testes/eventos";
import { fotoPendenteDeTeste, type FotoPendente } from "../src/testes/gestao";
import { guardar } from "./apoio/capturas";
import { gerarImagemNaPagina } from "./apoio/galeria";
import { fingirApiDeSessao } from "./apoio/gestao";
import {
  LEGENDA_DA_101,
  fingirApiDasFotos,
  fingirSitePublico,
  fotosDoE2E,
  jaChegouAModeracao,
  type Falha,
  type FotoDoServidor,
  type ServidorDeFotos,
} from "./apoio/gestao-fotos";

// Só nas capturas: 24 h e dd/mm, como o dono as vê (a hora é sempre a de Lisboa, venha o aparelho de onde vier).
test.use({ locale: "pt-PT", timezoneId: "Europe/Lisbon" });

/**
 * F4-04 — as capturas que a revisão ui-ux e o PR abrem (390 × 844 e 1024 × 768). Não comparam com
 * imagem de referência. Vão para `test-results/capturas/` com o nome `gestao-fotos-<largura>-<nome>`.
 *
 * As treze da spec 12.4: foto vertical (com legenda e nome), foto horizontal (sem legenda), a
 * aprovar, aviso, folha de rejeitar, folha de enviar (com prévia), folha de sair, vazia, erro, a
 * carregar, imagem que não se mostra, sem resposta e 409.
 */

/** A segunda foto é horizontal (id par) e **sem legenda nem nome**, como a spec pede para a captura. */
function fotosDasCapturas(): FotoPendente[] {
  const [primeira, , terceira] = fotosDoE2E() as [FotoPendente, FotoPendente, FotoPendente];
  return [primeira, fotoPendenteDeTeste({ id: 102, criada_em: "2026-11-02T00:30:00Z" }), terceira];
}

async function abrir(
  page: Page,
  opcoes: {
    inicial?: ReadonlyArray<FotoPendente | FotoDoServidor>;
    falhas?: Falha[];
    atrasoMs?: number;
    esperarFila?: boolean;
  } = {},
): Promise<ServidorDeFotos> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDasFotos(page, {
    inicial: fotosDasCapturas(),
    ...opcoes,
    sessao,
  });
  await fingirSitePublico(page);
  await page.clock.install({ time: AGORA });
  await page.goto("/gestao/galeria");
  await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
  if (opcoes.esperarFila !== false) {
    await expect(
      page.getByRole("region", { name: new RegExp(`^${T.fotosAEspera}`) }),
    ).toBeVisible();
  }
  return servidor;
}

async function tirar(
  page: Page,
  nome: string,
  tamanho: "390" | "1024",
  inteira = false,
): Promise<void> {
  if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
  await guardar(`gestao-fotos-${tamanho}-${nome}`, (caminho) =>
    page.screenshot({ path: caminho, fullPage: inteira }),
  );
}

function botao(page: Page, nome: string): Locator {
  return page.getByRole("button", { name: nome, exact: true }).first();
}
function folha(page: Page, nome: string): Locator {
  return page.getByRole("dialog", { name: nome, exact: true });
}
async function fotoPronta(page: Page, id: number): Promise<void> {
  const img = page.locator(`img:not([hidden])[src$='/gestao/fotos/${String(id)}/imagem']`);
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  await expect(botao(page, T.aprovar)).not.toHaveAttribute("aria-disabled", "true");
}

async function sequencia(page: Page, tamanho: "390" | "1024"): Promise<void> {
  const tocar = (l: Locator) => (tamanho === "390" ? l.tap() : l.click());
  const servidor = await abrir(page);
  await fotoPronta(page, 101);
  await expect(page.getByText(LEGENDA_DA_101)).toBeVisible();
  await tirar(page, "foto-vertical", tamanho);
  await tirar(page, "foto-vertical-pagina-inteira", tamanho, true);

  await tocar(botao(page, T.rejeitar));
  await expect(folha(page, T.tituloRejeitar)).toBeVisible();
  await tirar(page, "folha-rejeitar", tamanho);
  await tocar(folha(page, T.tituloRejeitar).getByRole("button", { name: T.cancelar, exact: true }));
  await expect(folha(page, T.tituloRejeitar)).toBeHidden();

  const jpeg = await gerarImagemNaPagina(page, { largura: 800, altura: 600 });
  await tocar(botao(page, T.enviarFoto));
  const enviar = folha(page, T.tituloEnviar);
  await expect(enviar).toBeVisible();
  await tirar(page, "folha-enviar-vazia", tamanho);
  await enviar
    .getByLabel(/^Foto/)
    .setInputFiles({ name: "jantar.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(enviar.locator("img")).toBeVisible();
  await enviar.getByLabel(T.etiquetaLegenda, { exact: true }).fill("Jantar de aniversário");
  await tirar(page, "folha-enviar", tamanho);
  await tocar(enviar.getByRole("button", { name: T.cancelar, exact: true }));
  await expect(folha(page, T.saidaTitulo)).toBeVisible();
  await tirar(page, "folha-sair", tamanho);
  await tocar(folha(page, T.saidaTitulo).getByRole("button", { name: T.saidaSair, exact: true }));
  await expect(enviar).toBeHidden();

  servidor.atrasoMs = 4_000;
  await tocar(botao(page, T.aprovar));
  await expect(page.getByRole("button", { name: T.aAprovar, exact: true })).toBeVisible();
  await tirar(page, "a-aprovar", tamanho);
  servidor.atrasoMs = 0;
  await expect(page.locator('[role="status"]').filter({ hasText: T.avisoAprovada })).toBeVisible({
    timeout: 10_000,
  });
  await tirar(page, "aviso", tamanho, true);

  await fotoPronta(page, 102);
  await tirar(page, "foto-horizontal", tamanho);
}

test.describe("telemóvel, 390 × 844", () => {
  test("foto vertical e horizontal, folhas, a aprovar e o aviso", async ({ page }) => {
    await sequencia(page, "390");
  });

  test("vazia", async ({ page }) => {
    await abrir(page, { inicial: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await tirar(page, "vazia", "390");
  });

  test("erro de carregar", async ({ page }) => {
    await abrir(page, {
      esperarFila: false,
      falhas: [{ metodo: "GET", caminho: /\/gestao\/fotos$/, resposta: "abortar" }],
    });
    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await tirar(page, "erro", "390");
  });

  test("a carregar", async ({ page }) => {
    await abrir(page, { esperarFila: false, atrasoMs: 20_000 });
    // Só a fila: a secção «Fotos no site» (F4-04b) também tem o seu <h2> e o seu esqueleto.
    const fila = page.getByRole("region", { name: T.fotosAEspera, exact: true });
    await expect(fila.getByRole("heading", { level: 2 })).toHaveText(T.fotosAEspera);
    await expect(fila.locator('[aria-busy="true"]')).toBeVisible();
    await tirar(page, "a-carregar", "390");
  });

  test("imagem que não se mostra", async ({ page }) => {
    await abrir(page, {
      falhas: [
        {
          metodo: "GET",
          caminho: /\/gestao\/fotos\/101\/imagem$/,
          resposta: { estado: 404, corpo: { erro: "foto_nao_encontrada", mensagem: "x" } },
        },
      ],
    });
    await expect(page.getByText(T.fotoNaoSeMostra)).toBeVisible();
    await tirar(page, "imagem-nao-mostra", "390");
  });

  test("sem resposta e a verificação falhada", async ({ page }) => {
    await abrir(page, {
      falhas: [
        { metodo: "POST", caminho: /101\/aprovar$/, resposta: "aplicar-e-abortar" },
        {
          metodo: "GET",
          caminho: /^\/gestao\/fotos$/,
          quando: jaChegouAModeracao,
          vezes: 1,
          resposta: "abortar",
        },
      ],
    });
    await fotoPronta(page, 101);
    await botao(page, T.aprovar).tap();
    await expect(page.getByText(T.semConfirmarAprovada)).toBeVisible();
    await tirar(page, "sem-resposta", "390");
  });

  test("409: outro aparelho moderou-a", async ({ page }) => {
    const servidor = await abrir(page);
    await fotoPronta(page, 101);
    (servidor.fotos.find((f) => f.id === 101) as FotoDoServidor).estado = "rejeitada";
    await botao(page, T.aprovar).tap();
    await expect(page.getByText(T.outroAparelhoRejeitada)).toBeVisible();
    await tirar(page, "409", "390");
  });
});

test.describe("computador, 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("foto vertical e horizontal, folhas, a aprovar e o aviso", async ({ page }) => {
    await sequencia(page, "1024");
  });

  test("vazia", async ({ page }) => {
    await abrir(page, { inicial: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await tirar(page, "vazia", "1024");
  });

  test("erro de carregar", async ({ page }) => {
    await abrir(page, {
      esperarFila: false,
      falhas: [{ metodo: "GET", caminho: /\/gestao\/fotos$/, resposta: "abortar" }],
    });
    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await tirar(page, "erro", "1024");
  });

  test("imagem que não se mostra", async ({ page }) => {
    await abrir(page, {
      falhas: [
        {
          metodo: "GET",
          caminho: /\/gestao\/fotos\/101\/imagem$/,
          resposta: { estado: 404, corpo: { erro: "foto_nao_encontrada", mensagem: "x" } },
        },
      ],
    });
    await expect(page.getByText(T.fotoNaoSeMostra)).toBeVisible();
    await tirar(page, "imagem-nao-mostra", "1024");
  });
});
