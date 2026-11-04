import { expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import {
  AGORA,
  CARTAZ_DE_TESTE,
  ID_DA_SECCAO,
  SELETOR_DA_CAIXA_DO_CARTAZ,
  TEXTOS_DOS_EVENTOS,
  TRES_EVENTOS,
} from "../../src/testes/eventos";
import type { Eventos } from "../../src/lib/api/publico";

/**
 * O contrato entre os testes ponta a ponta e a secção dos eventos (F3-04).
 *
 * A mesma forma do `apoio/ementa.ts`, e pela mesma razão: a fixtura é a de
 * `src/testes/eventos.ts` — uma só, partilhada com os testes Vitest — e o
 * que vive aqui é só o que precisa de um browser.
 *
 * **O relógio prende-se sempre.** Sem isso, o `d` de cada evento da fixtura
 * muda todos os dias e um teste que passa hoje falha na quinta-feira, com
 * uma mensagem sobre a palavra errada. O `page.clock.install` tem de ser
 * chamado **antes** do `goto`, senão a aplicação já leu a hora verdadeira.
 */

export { AGORA, CARTAZ_DE_TESTE, ID_DA_SECCAO, SELETOR_DA_CAIXA_DO_CARTAZ, TEXTOS_DOS_EVENTOS };

/** O padrão que o `page.route` intercepta para a lista de eventos. */
export const ROTA_DOS_EVENTOS = "**/api/eventos";

/**
 * O padrão dos cartazes.
 *
 * Interceptado **sempre**, mesmo no caminho feliz: em desenvolvimento quem
 * serve `/media/` é o middleware do `vite.config.ts`, a ler a pasta do
 * backend, e um teste que dependesse do conteúdo dessa pasta passava a
 * depender de ficheiros que não estão no repositório. O que interessa aqui
 * é a **forma** da resposta — chegou, demorou, ou não existe.
 */
export const ROTA_DO_CARTAZ = "**/media/**";

/**
 * Quantas vezes a página pediu os eventos. Nunca se compara com um número
 * escrito à mão: em desenvolvimento o `React.StrictMode` monta duas vezes e
 * um arranque normal faz **dois** pedidos, o primeiro cancelado. O que se
 * compara é a variação — o mesmo que a ementa já faz.
 */
export type ContadorDePedidos = { total: number };

export type RespostaDosEventos =
  | { tipo: "eventos"; corpo: Eventos; atrasoMs?: number }
  | { tipo: "estado"; estado: number }
  | { tipo: "falha" };

async function cumprir(rota: Route, resposta: RespostaDosEventos): Promise<void> {
  if (resposta.tipo === "falha") {
    // `abort` é o que o cliente vê como "não houve resposta nenhuma":
    // `ErroDaApi` com `estado: null`, a primeira linha da tabela de 8.2.
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

/** Finge `GET /api/eventos`. Tem de ser chamado **antes** do `goto`. */
export async function fingirOsEventos(
  pagina: Page,
  responder: (numeroDoPedido: number) => RespostaDosEventos,
): Promise<ContadorDePedidos> {
  const contador: ContadorDePedidos = { total: 0 };

  await pagina.route(ROTA_DOS_EVENTOS, async (rota) => {
    contador.total += 1;
    await cumprir(rota, responder(contador.total));
  });

  return contador;
}

/** Atalho: responde sempre com a mesma lista. */
export function fingirEventosFixos(pagina: Page, corpo: Eventos = TRES_EVENTOS) {
  return fingirOsEventos(pagina, () => ({ tipo: "eventos", corpo }));
}

/**
 * Um PNG de 2 × 2 válido, em bytes.
 *
 * Tem de ser uma imagem a sério: o que se mede em 12.3 é a **posição do que
 * está por baixo** quando ela chega, e um corpo que o browser não consiga
 * descodificar dispara o `error` — ou seja, dava o caminho do 404 a passar
 * por caminho feliz, com o teste a medir uma caixa que já não existe.
 */
const PNG_MINIMO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mOY1dMCRAwQCgAu/gap" +
    "/aNLcwAAAABJRU5ErkJggg==",
  "base64",
);

export type EstadoDoCartaz =
  { tipo: "chega"; atrasoMs?: number } | { tipo: "nao-existe" } | { tipo: "nunca-chega" };

/**
 * Finge `/media/<ficheiro>`. Os três estados de 6.3, e só esses.
 *
 * O 404 encaminha-se por aqui e não por um ficheiro em falta a sério: um
 * teste que dependesse da ausência de um ficheiro passava no dia em que
 * alguém o criasse, sem nada a avisar.
 */
export async function fingirOCartaz(pagina: Page, estado: EstadoDoCartaz): Promise<void> {
  await pagina.route(ROTA_DO_CARTAZ, async (rota) => {
    if (estado.tipo === "nao-existe") {
      await rota.fulfill({ status: 404, contentType: "text/plain", body: "não existe" });
      return;
    }

    if (estado.tipo === "nunca-chega") {
      // Pendurada para sempre: é o estado "a caixa está lá e a imagem não".
      // A rota nunca se cumpre, e o teste que a usa mede antes de ela
      // chegar — o contexto fecha-se no fim e leva o pedido à frente.
      return;
    }

    if (estado.atrasoMs !== undefined) {
      await new Promise((continuar) => setTimeout(continuar, estado.atrasoMs));
    }
    await rota.fulfill({ status: 200, contentType: "image/png", body: PNG_MINIMO });
  });
}

/** A secção inteira, pelo `id` do contrato. Pode não existir (8). */
export function seccaoDosEventos(pagina: Page) {
  return pagina.locator(`#${ID_DA_SECCAO}`);
}

/** O `<h2>` da secção. */
export function tituloDosEventos(pagina: Page) {
  return pagina.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo, level: 2 });
}

/** Os cartões. No máximo três (7.1). */
export function cartoesDeEvento(pagina: Page) {
  return seccaoDosEventos(pagina).getByRole("listitem");
}

/** As caixas 3:2 do cartaz. É o único sítio onde um teste pega por classe. */
export function caixasDoCartaz(pagina: Page) {
  return pagina.locator(SELETOR_DA_CAIXA_DO_CARTAZ);
}

/** O botão do estado de erro. */
export function botaoDeTentarOutraVez(pagina: Page) {
  return seccaoDosEventos(pagina).getByRole("button", {
    name: TEXTOS_DOS_EVENTOS.tentarOutraVez,
  });
}

/**
 * Prende o relógio do browser em `AGORA`, com os temporizadores sob
 * controlo do teste.
 *
 * `install` e não `setFixedTime`: o teste da meia-noite (5.6) precisa de
 * **mexer** no relógio depois de a página estar aberta, e com a hora fixa
 * não há relógio nenhum para mexer.
 */
export async function prenderORelogio(pagina: Page): Promise<void> {
  await pagina.clock.install({ time: AGORA });
}

/**
 * Abre a página com a ementa e os eventos fingidos, e espera que a secção
 * dos eventos esteja pronta.
 *
 * O guarda do estado da resposta é o mesmo da F3-01 e da F3-02: sem ele,
 * uma página que não abre dá um teste que falha mais à frente com uma
 * mensagem sobre outra coisa qualquer — e, nesta secção, a mensagem seria
 * «a secção dos eventos não existe», que é exactamente o que um dos
 * estados normais diz.
 */
export async function abrirComEventos(pagina: Page, corpo: Eventos = TRES_EVENTOS): Promise<void> {
  const resposta = await pagina.goto("/");

  expect(
    resposta?.status(),
    "Não consegui abrir «/». Sem a página, estes testes não verificam nada.",
  ).toBe(200);

  await expect(
    tituloDosEventos(pagina),
    "a secção dos eventos não apareceu. Com esta fixtura ela tem de existir — " +
      "se este guarda falhar, tudo o que o teste dissesse a seguir era sobre uma " +
      "secção que não está lá.",
  ).toBeVisible();
  await expect(cartoesDeEvento(pagina)).toHaveCount(Math.min(corpo.eventos.length, 3));
}
