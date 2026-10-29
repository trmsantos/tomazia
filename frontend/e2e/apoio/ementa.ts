import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import type { Ementa } from "../../src/lib/api/publico";
import {
  EMENTA_DE_TESTE,
  ID_DA_BARRA,
  SELETOR_DOS_CARTOES,
  SELETOR_DOS_CHIPS,
  TEXTOS_DA_EMENTA,
} from "../../src/testes/ementa";

/**
 * Conduzir a página da ementa a partir de um Playwright.
 *
 * Mesma função que o `apoio/pagina.ts` da F3-01: os testes não dependem do
 * texto exacto de cada rótulo nem da forma do DOM, dependem do que está
 * escrito aqui. Se um nome mudar, muda numa linha.
 *
 * A fixtura e os textos vivem em `src/testes/ementa.ts`, partilhados com os
 * testes Vitest — e **tipados como `Ementa`**, o tipo gerado a partir do
 * OpenAPI do backend. Assim uma mudança de contrato parte a compilação em
 * vez de passar a verde contra uma forma que já não existe.
 */

export { EMENTA_DE_TESTE, ID_DA_BARRA, SELETOR_DOS_CARTOES, SELETOR_DOS_CHIPS, TEXTOS_DA_EMENTA };

/** O padrão que o `page.route` intercepta. */
export const ROTA_DA_EMENTA = "**/api/ementa";

/**
 * Quantas vezes a página pediu a ementa, por corrida de teste.
 *
 * **Não se compara com um número escrito à mão.** Estes testes correm
 * contra o servidor de desenvolvimento, onde o `React.StrictMode` monta
 * cada componente duas vezes: um arranque normal faz **dois** pedidos, o
 * primeiro deles cancelado. Em produção faz um. Um teste que afirmasse
 * «pediu uma vez» chumbava em desenvolvimento e passava em produção, a
 * dizer que havia uma repetição automática onde não há.
 *
 * O que se compara é a **variação**: guarda-se o total depois de o ecrã
 * assentar e verifica-se se cresceu.
 */
export type ContadorDePedidos = { total: number };

type Resposta =
  | { tipo: "ementa"; corpo: Ementa; atrasoMs?: number }
  | { tipo: "estado"; estado: number }
  | { tipo: "falha" };

async function cumprir(rota: import("@playwright/test").Route, resposta: Resposta): Promise<void> {
  if (resposta.tipo === "falha") {
    // `abort` é o que o cliente vê como "não houve resposta nenhuma":
    // `ErroDaApi` com `estado: null`. É o caso da primeira linha de 5.3.
    await rota.abort("failed");
    return;
  }

  if (resposta.tipo === "estado") {
    await rota.fulfill({
      status: resposta.estado,
      contentType: "application/json",
      body: JSON.stringify({ erro: "erro_interno", mensagem: "detalhe cru do servidor" }),
    });
    return;
  }

  if (resposta.atrasoMs !== undefined) {
    await new Promise((continuar) => setTimeout(continuar, resposta.atrasoMs));
  }
  await rota.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(resposta.corpo),
  });
}

/**
 * Finge `GET /api/ementa`. Tem de ser chamado **antes** do `goto`.
 *
 * O `responder` é chamado a cada pedido e decide ali o que responder — por
 * isso um teste que precise de mudar de resposta a meio (falhar primeiro,
 * responder bem depois do "Tentar outra vez") muda uma variável sua em vez
 * de contar pedidos. Contar pedidos não serve: o `StrictMode` duplica-os.
 */
export async function fingirAEmenta(
  pagina: Page,
  responder: (numeroDoPedido: number) => Resposta,
): Promise<ContadorDePedidos> {
  const contador: ContadorDePedidos = { total: 0 };

  await pagina.route(ROTA_DA_EMENTA, async (rota) => {
    contador.total += 1;
    await cumprir(rota, responder(contador.total));
  });

  return contador;
}

/** Atalho: responde sempre com a mesma ementa. */
export function fingirEmentaFixa(pagina: Page, corpo: Ementa = EMENTA_DE_TESTE) {
  return fingirAEmenta(pagina, () => ({ tipo: "ementa", corpo }));
}

/**
 * Abre a página e espera que a ementa esteja pronta.
 *
 * O guarda do estado da resposta é o mesmo da F3-01: sem ele, uma página
 * que não abre dá um teste que falha mais à frente com uma mensagem sobre
 * outra coisa qualquer.
 */
export async function abrirAEmenta(pagina: Page): Promise<void> {
  const resposta = await pagina.goto("/");

  expect(
    resposta?.status(),
    "Não consegui abrir «/». Sem a página, estes testes não verificam nada.",
  ).toBe(200);

  await expect(
    pagina.getByRole("heading", { name: TEXTOS_DA_EMENTA.titulo, level: 2 }),
  ).toBeVisible();
}

/** A barra fixa, pelo `id` que o contrato lhe dá. */
export function barra(pagina: Page) {
  return pagina.locator(`#${ID_DA_BARRA}`);
}

export function cartoes(pagina: Page) {
  return pagina.locator(SELETOR_DOS_CARTOES);
}

export function chips(pagina: Page) {
  return pagina.locator(SELETOR_DOS_CHIPS);
}

export function lupa(pagina: Page) {
  return pagina.getByRole("button", { name: TEXTOS_DA_EMENTA.abrirPesquisa });
}

export function campoDePesquisa(pagina: Page) {
  return pagina.getByRole("searchbox", { name: TEXTOS_DA_EMENTA.campoDePesquisa });
}

/**
 * Esperar que a posição vertical pare.
 *
 * O deslize é do browser (`scroll-behavior: smooth`) e a barra só se
 * reposiciona 150 ms depois de a página parar (3.4). Um `waitForTimeout`
 * fixo ou era curto numa máquina lenta ou era desperdício em todas as
 * outras; isto espera pelo que interessa e **falha a dizer que a página não
 * parou**, que é diferente de "o chip errado ficou ativo".
 */
export async function esperarQueAPaginaPare(pagina: Page): Promise<void> {
  let anterior = Number.NaN;

  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    const atual = await pagina.evaluate(() => Math.round(window.scrollY));
    if (atual === anterior) {
      // Mais um pouco, para o temporizador de 150 ms da barra correr.
      await pagina.waitForTimeout(250);
      return;
    }
    anterior = atual;
    await pagina.waitForTimeout(80);
  }

  throw new Error(
    "a página continuou a deslizar durante mais de 4 s. Isto é uma falha de " +
      "estabilização, não uma falha do scroll-spy — tudo o que o teste dissesse a " +
      "seguir seria sobre uma página em movimento.",
  );
}

/** A página está no seu máximo de deslocamento? (guarda 2 de 3.3) */
export function noFimDaPagina(pagina: Page): Promise<boolean> {
  return pagina.evaluate(
    () =>
      Math.ceil(window.scrollY) >= document.documentElement.scrollHeight - window.innerHeight - 2,
  );
}
