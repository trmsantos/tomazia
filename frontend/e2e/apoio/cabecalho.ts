import { expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import type { Info } from "../../src/lib/api/publico";
import {
  ID_DA_PASSWORD,
  ID_DO_DESTINO_DO_SALTO,
  INFO_COM_WIFI,
  INFO_SEM_REDE,
  PASSWORD_DE_TESTE,
  REDE_DE_TESTE,
  TEXTOS_DO_WIFI,
} from "../../src/testes/cabecalho";
import { TEXTOS_DA_EMENTA, abrirAEmenta, fingirEmentaFixa } from "./ementa";

/**
 * Conduzir o cabeçalho e a Folha do WiFi a partir de um Playwright.
 *
 * Mesma função que o `apoio/ementa.ts` da F3-02: os testes não dependem do
 * texto exacto de cada rótulo nem da forma do DOM, dependem do que está
 * escrito em `src/testes/cabecalho.ts` — partilhado com os testes Vitest e
 * tipado contra o OpenAPI do backend.
 */

export {
  ID_DA_PASSWORD,
  ID_DO_DESTINO_DO_SALTO,
  INFO_COM_WIFI,
  INFO_SEM_REDE,
  PASSWORD_DE_TESTE,
  REDE_DE_TESTE,
  TEXTOS_DO_WIFI,
};

/** O padrão que o `page.route` intercepta. */
export const ROTA_DO_INFO = "**/api/info";

type RespostaDoInfo =
  | { tipo: "info"; corpo: Info; atrasoMs?: number }
  | { tipo: "falha" }
  | { tipo: "estado"; estado: number };

async function cumprir(rota: Route, resposta: RespostaDoInfo): Promise<void> {
  if (resposta.tipo === "falha") {
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

/** Finge `GET /api/info`. Tem de ser chamado **antes** do `goto`. */
export async function fingirOInfo(
  pagina: Page,
  responder: (numeroDoPedido: number) => RespostaDoInfo,
): Promise<{ total: number }> {
  const contador = { total: 0 };

  await pagina.route(ROTA_DO_INFO, async (rota) => {
    contador.total += 1;
    await cumprir(rota, responder(contador.total));
  });

  return contador;
}

/** Atalho: responde sempre com o mesmo payload. */
export function fingirInfoFixo(pagina: Page, corpo: Info = INFO_COM_WIFI) {
  return fingirOInfo(pagina, () => ({ tipo: "info", corpo }));
}

/**
 * Abre a página pública com a ementa e o `/info` fingidos, e espera que a
 * ementa esteja pronta.
 *
 * O guarda do `abrirAEmenta` continua a valer: sem a página, tudo o que os
 * testes disserem a seguir é sobre nada.
 */
export async function abrirAPaginaPublica(pagina: Page, info: Info = INFO_COM_WIFI): Promise<void> {
  await fingirEmentaFixa(pagina);
  await fingirInfoFixo(pagina, info);
  await abrirAEmenta(pagina);
  await expect(
    cabecalho(pagina),
    "um `<header>` só na página: com dois, as medições de altura e de aresta deixam " +
      "de querer dizer o que dizem",
  ).toHaveCount(1);
  await expect(cabecalho(pagina)).toBeVisible();
}

/** O cabeçalho fixo. Um só — mais do que um e as medições não querem dizer nada. */
export function cabecalho(pagina: Page) {
  return pagina.locator("header");
}

export function botaoDoWifi(pagina: Page) {
  return pagina.getByRole("button", { name: TEXTOS_DO_WIFI.wifi, exact: true });
}

export function folhaDoWifi(pagina: Page) {
  return pagina.getByRole("dialog");
}

export function ligacaoDeSalto(pagina: Page) {
  return pagina.getByRole("link", { name: TEXTOS_DO_WIFI.saltar });
}

export function botaoDeCopiar(pagina: Page) {
  return pagina.getByRole("button", { name: TEXTOS_DO_WIFI.copiar });
}

/** O `<h2> Ementa`, que é o que o `pt-cabecalho` do `<main>` protege. */
export function tituloDaEmenta(pagina: Page) {
  return pagina.getByRole("heading", { name: TEXTOS_DA_EMENTA.titulo, level: 2 });
}

/**
 * Abre a Folha e espera que ela esteja mesmo aberta.
 *
 * Sem a espera, a medição seguinte pode acontecer a meio da animação de
 * subida e medir uma Folha a caminho — que é uma falha de temporização a
 * passar por uma falha de desenho.
 */
export async function abrirAFolha(pagina: Page): Promise<void> {
  // O guarda antes do toque: sem ele, um cabeçalho sem botão dá um teste
  // pendurado 30 s que acaba em «locator.click: Test timeout exceeded» — uma
  // mensagem sobre o Playwright, e não sobre o ecrã.
  await expect(
    botaoDoWifi(pagina),
    "não encontrei o botão «WiFi» no cabeçalho: isto é a ausência do botão, não uma " +
      "Folha que não abriu",
  ).toBeVisible({ timeout: 5_000 });

  await botaoDoWifi(pagina).click();
  await expect(folhaDoWifi(pagina)).toBeVisible();
  await expect(
    folhaDoWifi(pagina).getByRole("heading", { name: TEXTOS_DO_WIFI.wifi }),
  ).toBeVisible();
}

/**
 * Uma `navigator.clipboard` que recusa sempre, instalada antes do `goto`.
 *
 * É o caminho de 8.1 que se pode exercitar num browser sem pedir permissões:
 * a API existe, a promessa é recusada, e o que se mede é o que o ecrã faz a
 * seguir — a frase de falha, e o botão que não se mexeu.
 */
export async function recusarACopia(pagina: Page): Promise<void> {
  await pagina.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")),
      },
    });
  });
}

/**
 * O valor computado de um token de comprimento, em píxeis.
 *
 * Mede-o como o browser o mediria — com um elemento a sério — em vez de
 * repetir a conta em JavaScript. Devolve `0` quando não se conseguiu
 * resolver, e quem chama **tem de** distinguir isso de "o token é zero":
 * ver o guarda em `e2e/cabecalho.spec.ts`.
 */
export function medirToken(pagina: Page, nome: string): Promise<{ bruto: string; altura: number }> {
  return pagina.evaluate((token) => {
    const bruto = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    const regua = document.createElement("div");
    regua.style.height = bruto;
    regua.style.position = "absolute";
    document.body.append(regua);
    const altura = regua.getBoundingClientRect().height;
    regua.remove();
    return { bruto, altura };
  }, nome);
}

/** Onde é que há um retângulo dourado cheio, e qual deles se pode usar. */
export type RetanguloDourado = {
  descricao: string;
  /** O ponto central do retângulo pertence-lhe, ou está tapado por outra camada. */
  alcancavel: boolean;
};

/**
 * Os retângulos dourados do ecrã, contados **pelo que está pintado**.
 *
 * Lê a cor computada de cada elemento e compara-a com o token do dourado,
 * em vez de procurar nomes de classes: uma regra que pinte dourado por outra
 * via aparece aqui na mesma, e um `bg-acao` que deixe de pintar deixa de
 * aparecer.
 *
 * **Alcançável** decide-se por `elementFromPoint`, que é a pergunta que
 * interessa em 7.5: com a Folha aberta, o botão "WiFi" continua no DOM e
 * pintado, mas está por baixo da cortina, fora do foco e fora do
 * `aria-modal` — não é um dourado concorrente, é um botão que naquele
 * momento não existe para ninguém.
 *
 * **O chip ativo não conta, e não é uma exceção de conveniência.** O dourado
 * tem três usos neste projeto e só três — ação principal, **chip ativo** e
 * foco (`frontend/CLAUDE.md`) —, e a regra de 7.5 é sobre o primeiro: *uma*
 * ação principal utilizável de cada vez. O chip ativo não é uma ação a
 * competir com o "WiFi", é a marca de onde a pessoa está, e diz-o com
 * `aria-current` e não só com a cor (F3-02; ver `Chip.tsx`). Contá-lo punha
 * este teste a exigir que a barra de categorias deixasse de marcar a
 * categoria em que se está — que é o contrário do que a F3-02 decidiu e do
 * que a F3-03 diz expressamente que não muda (secção 12, "O que **não**
 * muda").
 *
 * O filtro é `aria-current` e não um nome de classe, pela mesma razão que a
 * cor se lê computada: o que se exclui é o que **se anuncia** como posição,
 * não o que por acaso se chama chip.
 */
export function retangulosDourados(pagina: Page): Promise<RetanguloDourado[]> {
  return pagina.evaluate(() => {
    const dourado = getComputedStyle(document.documentElement)
      .getPropertyValue("--cor-dourado-latao")
      .trim();

    const paraRgb = (cor: string): string | null => {
      const prova = document.createElement("span");
      prova.style.color = cor;
      document.body.append(prova);
      const lido = getComputedStyle(prova).color;
      prova.remove();
      return lido === "" ? null : lido;
    };

    const alvo = paraRgb(dourado);
    if (alvo === null) return [];

    const encontrados: { descricao: string; alcancavel: boolean }[] = [];

    for (const elemento of document.querySelectorAll("*")) {
      const estilo = getComputedStyle(elemento);
      // As duas cores vêm do mesmo `getComputedStyle`, por isso a forma em
      // que o browser as escreve é a mesma e a comparação é segura.
      if (estilo.backgroundColor !== alvo) continue;

      const caixa = elemento.getBoundingClientRect();
      if (caixa.width < 8 || caixa.height < 8) continue;
      if (estilo.visibility === "hidden" || estilo.display === "none") continue;
      // A marca de posição da barra de categorias, não uma ação concorrente.
      //
      // `=== "true"` e não `hasAttribute`: um `aria-current="false"` não
      // anuncia posição nenhuma, e com o `hasAttribute` saía da conta na
      // mesma. Hoje o `Chip.tsx` escreve `undefined` no inativo — e há teste
      // a prendê-lo —, mas este auxiliar não deve depender de um guarda que
      // vive noutro ficheiro para dizer a verdade.
      if (elemento.getAttribute("aria-current") === "true") continue;

      const centroX = caixa.x + caixa.width / 2;
      const centroY = caixa.y + caixa.height / 2;
      const noPonto = document.elementFromPoint(centroX, centroY);
      const alcancavel = noPonto !== null && (noPonto === elemento || elemento.contains(noPonto));

      const nome = (elemento.getAttribute("aria-label") ?? elemento.textContent ?? "")
        .trim()
        .slice(0, 40);
      encontrados.push({
        descricao: `${elemento.tagName.toLowerCase()} «${nome}» ${Math.round(caixa.width)}×${Math.round(caixa.height)}`,
        alcancavel,
      });
    }

    return encontrados;
  });
}
