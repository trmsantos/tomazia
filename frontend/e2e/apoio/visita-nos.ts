import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { lerCor } from "../../src/testes/contraste";
import type { Rgb } from "../../src/testes/contraste";
import { SEM_EVENTOS } from "../../src/testes/eventos";
import { SEM_FOTOS } from "../../src/testes/galeria";
import {
  ID_DA_SECCAO,
  MOMENTOS,
  TEXTOS_DO_VISITA_NOS,
  infoCompleta,
} from "../../src/testes/visita-nos";
import type { Info } from "../../src/lib/api/publico";
import { fingirOInfo } from "./cabecalho";
import { fingirEmentaFixa } from "./ementa";
import { fingirEventosFixos } from "./eventos";
import { fingirAGaleria } from "./galeria";

/**
 * Conduzir a secção «Visita-nos» a partir de um Playwright (F3-06a).
 *
 * Mesma função que `apoio/eventos.ts` e `apoio/galeria.ts`: a fixtura é a de
 * `src/testes/visita-nos.ts` — uma só, partilhada com os testes Vitest — e o
 * que vive aqui é só o que precisa de um browser.
 *
 * **O relógio prende-se sempre, antes do `goto`**: sem isso a linha do momento
 * muda com a hora a que o teste corre, e um teste que passa de tarde falha às
 * 02:30 com uma mensagem sobre outra coisa. Os instantes são os de `MOMENTOS`
 * (UTC, com a hora de Lisboa ao lado).
 */

export { ID_DA_SECCAO, MOMENTOS, TEXTOS_DO_VISITA_NOS };

export type LeituraDoInfo =
  | { tipo: "info"; corpo: Info; atrasoMs?: number }
  | { tipo: "falha" }
  | { tipo: "estado"; estado: number };

/** Prende o relógio do browser. Chamar **antes** do `goto`. */
export async function prenderORelogioEm(
  pagina: Page,
  instante: string = MOMENTOS.qui17h00,
): Promise<void> {
  await pagina.clock.install({ time: new Date(instante) });
}

/**
 * Finge tudo o que a página pede (ementa, eventos, galeria e o `/info` que lhe
 * dermos) e abre-a. Devolve o contador de pedidos ao `/info`.
 *
 * O guarda do estado da resposta é o do resto da F3: sem ele, uma página que
 * não abre dava um teste a falhar com uma mensagem sobre o que vem a seguir.
 */
export async function abrirComVisitaNos(
  pagina: Page,
  leitura: LeituraDoInfo | ((numero: number) => LeituraDoInfo) = {
    tipo: "info",
    corpo: infoCompleta(),
  },
  instante: string = MOMENTOS.qui17h00,
): Promise<{ total: number }> {
  await prenderORelogioEm(pagina, instante);
  await fingirEmentaFixa(pagina);
  await fingirEventosFixos(pagina, SEM_EVENTOS);
  await fingirAGaleria(pagina, SEM_FOTOS);
  const contador = await fingirOInfo(
    pagina,
    typeof leitura === "function" ? leitura : () => leitura,
  );

  const resposta = await pagina.goto("/");
  expect(
    resposta?.status(),
    "Não consegui abrir «/». Sem a página, estes testes não verificam nada.",
  ).toBe(200);

  return contador;
}

export function seccaoDaVisita(pagina: Page): Locator {
  return pagina.locator(`section#${ID_DA_SECCAO}`);
}

export function tituloDaVisita(pagina: Page): Locator {
  return pagina.getByRole("heading", { name: TEXTOS_DO_VISITA_NOS.titulo, level: 2 });
}

/** O `<p>` que vem logo a seguir ao `<h3>` «Horário». */
export function linhaDoMomento(pagina: Page): Locator {
  return seccaoDaVisita(pagina)
    .getByRole("heading", { name: TEXTOS_DO_VISITA_NOS.tituloDoHorario, level: 3 })
    .locator("xpath=following-sibling::p[1]");
}

export function linhaDeHoje(pagina: Page): Locator {
  return seccaoDaVisita(pagina).locator('tr[aria-current="date"] > th');
}

export function botaoDoMaps(pagina: Page): Locator {
  return seccaoDaVisita(pagina).getByRole("link", { name: TEXTOS_DO_VISITA_NOS.abrirNoMaps });
}

export function ligacaoDoTelefone(pagina: Page): Locator {
  return seccaoDaVisita(pagina).locator('a[href^="tel:"]');
}

export function ligacaoDoInstagram(pagina: Page): Locator {
  return seccaoDaVisita(pagina).locator('a[href*="instagram.com"]');
}

export function botaoDeTentarOutraVez(pagina: Page): Locator {
  return seccaoDaVisita(pagina).getByRole("button", { name: TEXTOS_DO_VISITA_NOS.tentarOutraVez });
}

/** Medir, ou falhar a dizer que não mediu (regra 10). */
export async function caixaDe(
  alvo: Locator,
  nome: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const medida = await alvo.boundingBox();
  expect(medida, `não consegui medir ${nome}. Sem a medida não verifiquei nada.`).not.toBeNull();
  if (medida === null) throw new Error(`não consegui medir ${nome}`);
  return medida;
}

/** Um token de cor da raiz, já lido e com o guarda de «não existe». */
export async function corDoToken(pagina: Page, nome: string): Promise<Rgb> {
  const bruto = await pagina.evaluate(
    (chave) => getComputedStyle(document.documentElement).getPropertyValue(chave).trim(),
    nome,
  );
  expect(bruto, `guarda: o token «${nome}» não existe`).not.toBe("");
  const lida = lerCor(bruto);
  expect(lida, `guarda: não soube ler «${bruto}» como cor do token «${nome}»`).not.toBeNull();
  if (lida === null) throw new Error(`não soube ler o token «${nome}»`);
  return lida;
}

export function aMesmaCor(bruta: string, alvo: Rgb): boolean {
  const lida = lerCor(bruta);
  if (lida === null) return false;
  return lida.vermelho === alvo.vermelho && lida.verde === alvo.verde && lida.azul === alvo.azul;
}
