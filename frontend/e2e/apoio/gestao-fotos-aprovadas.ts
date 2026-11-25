import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { TEXTOS as T } from "../../src/pages/gestao/galeria/textos";
import { AGORA } from "../../src/testes/eventos";
import { TEXTOS_APROVADAS as A } from "../../src/testes/fotos-gestao-textos";
import { fingirApiDeSessao } from "./gestao";
import {
  aprovadasDoE2E,
  fingirApiDasFotos,
  fingirSitePublico,
  fotosDoE2E,
  type Falha,
  type FotoDoServidor,
  type ServidorDeFotos,
} from "./gestao-fotos";
import type { FotoPendente } from "../../src/testes/gestao";

/**
 * O que os e2e da F4-04b (`gestao-fotos-aprovadas.spec.ts` e as capturas) partilham: abrir a
 * Galeria da gestão com a API das fotos fingida (fila **e** aprovadas), e os localizadores da
 * secção «Fotos no site». O texto vem de `src/testes/fotos-gestao-textos.ts` (a tabela 12 da spec).
 */
export type OpcoesDeAbertura = {
  inicial?: ReadonlyArray<FotoPendente | FotoDoServidor>;
  falhas?: Falha[];
  atrasoMs?: number;
  /** Corre depois dos fingimentos e **antes** do `goto` (uma rota registada depois ganha). */
  antesDeAbrir?: (pagina: Page) => Promise<void>;
  /** Esperar pela região da fila e pela secção (por omissão sim). */
  esperar?: boolean;
};

/** A fila de três pendentes e as três aprovadas dos e2e. */
export function fotosDaGaleria(): Array<FotoPendente | FotoDoServidor> {
  return [...fotosDoE2E(), ...aprovadasDoE2E()];
}

export async function abrirGaleria(
  page: Page,
  opcoes: OpcoesDeAbertura = {},
): Promise<{ servidor: ServidorDeFotos; sessao: Awaited<ReturnType<typeof fingirApiDeSessao>> }> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDasFotos(page, {
    inicial: opcoes.inicial ?? fotosDaGaleria(),
    falhas: opcoes.falhas,
    atrasoMs: opcoes.atrasoMs,
    sessao,
  });
  await fingirSitePublico(page);
  await opcoes.antesDeAbrir?.(page);
  await page.clock.install({ time: AGORA });
  await page.goto("/gestao/galeria");
  await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
  if (opcoes.esperar !== false) {
    await expect(
      page.getByRole("region", { name: new RegExp(`^${T.fotosAEspera}`) }),
    ).toBeVisible();
    await expect(seccao(page)).toBeVisible();
  }
  return { servidor, sessao };
}

export function seccao(page: Page): Locator {
  return page.getByRole("region", { name: new RegExp(`^${A.titulo}`) });
}
export function tituloDaSeccao(page: Page): Locator {
  return seccao(page).getByRole("heading", { level: 2 });
}
export function itens(page: Page): Locator {
  return seccao(page).getByRole("listitem");
}
export function botoesEliminar(page: Page): Locator {
  return seccao(page).getByRole("button", { name: /^Eliminar foto aprovada / });
}
/** O «Eliminar» do item cuja miniatura é `/media/foto-{id}.webp`. */
export function eliminarDe(page: Page, id: number): Locator {
  return itens(page)
    .filter({ has: page.locator(`img[src="/media/foto-${String(id)}.webp"]`) })
    .getByRole("button", { name: /^Eliminar foto aprovada / });
}
export function folhaDeEliminar(page: Page): Locator {
  return page.getByRole("dialog", { name: A.tituloDaFolha, exact: true });
}
export function aviso(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(Feito|Erro)\./ });
}
/** As miniaturas da secção a **terem carregado** (rola até lá: são `loading="lazy"`). */
export async function miniaturasCarregadas(page: Page): Promise<void> {
  const imgs = seccao(page).locator("img");
  const n = await imgs.count();
  for (let i = 0; i < n; i += 1) {
    await imgs.nth(i).scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        imgs.nth(i).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
  }
}
/** Foi pedido `DELETE`s a esta rota? */
export function eliminados(servidor: ServidorDeFotos, id?: number): number {
  return servidor.pedidos.filter(
    (p) =>
      p.metodo === "DELETE" &&
      (id === undefined
        ? /^\/gestao\/fotos\/\d+$/.test(p.caminho)
        : p.caminho === `/gestao/fotos/${String(id)}`),
  ).length;
}
export function leituras(servidor: ServidorDeFotos): number {
  return servidor.pedidos.filter(
    (p) => p.metodo === "GET" && p.caminho === "/gestao/fotos/aprovadas",
  ).length;
}
