import { expect } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

import {
  clientesDeTeste,
  csvDeTeste,
  eventosDoResumo,
  type ClienteGestao,
} from "../../src/testes/clientes-dados";
import { TEXTOS_CLIENTES as T } from "../../src/testes/clientes-gestao-textos";
import { AGORA } from "../../src/testes/eventos";
import type { EventoGestao } from "../../src/testes/gestao";
import { fingirApiDeSessao, type ServidorFingido } from "./gestao";

/**
 * A API do Início e dos Clientes fingida **com um único estado em memória** (F4-05b):
 * `GET /api/gestao/resumo`, `GET /api/gestao/clientes`, `GET /api/gestao/clientes.csv` e
 * `DELETE /api/gestao/clientes/{id}`. Um `DELETE` bem sucedido muda o que o `GET /clientes` devolve
 * a seguir (é o que prova «eliminar tira o cliente do servidor» do lado do frontend; o do servidor
 * é `backend/tests/gestao/test_clientes.py`).
 *
 * As regras são as do backend:
 *  - a lista vem do mais recente para o mais antigo, **sem** o `token_cancelar`;
 *  - `DELETE` de um `id` que não existe: **404 `cliente_inexistente`**; sem `X-Tomazia`: 403; 204 sem corpo;
 *  - o CSV: `200`, `text/csv; charset=utf-8`, `Content-Disposition: attachment;
 *    filename="clientes-AAAA-MM-DD.csv"`, UTF-8 **com BOM**, `;` e CRLF;
 *  - o resumo: `fotos_pendentes`, `proximos_eventos` (até 3) e `novos_registos` são o que o teste
 *    pôs; não se derivam da lista.
 *
 *  - **`pedidos`** regista tudo (método, caminho, cabeçalhos);
 *  - **`falhas`** injeta uma falha por rota **e por ordem do pedido** (a ordem conta os pedidos
 *    que condizem com `metodo` + `caminho`, a partir de 1); `"abortar"` não responde;
 *    **`"aplicar-e-abortar"`** aplica o efeito no estado e depois não responde (o pedido chegou,
 *    a resposta perdeu-se: o caso «não sei» da regra 10).
 */
export type PedidoObservado = {
  metodo: string;
  caminho: string;
  cabecalhos: Record<string, string>;
};

export type Falha = {
  metodo: "GET" | "DELETE";
  /** Condiz com o caminho depois de `/api` (`/gestao/clientes`, `/gestao/clientes/101`, `/gestao/resumo`). */
  caminho: RegExp;
  /** O n-ésimo pedido que condiz (1 = o primeiro). Sem `ordem`, todos. */
  ordem?: number;
  /** Só falha **quando** isto for verdade no momento do pedido. */
  quando?: (servidor: ServidorDeClientes) => boolean;
  /** Falha só as primeiras `vezes` vezes que condiz. */
  vezes?: number;
  resposta:
    | { estado: number; corpo?: Record<string, unknown>; texto?: string; tipo?: string }
    | "abortar"
    | "aplicar-e-abortar";
  /** Fecha também a sessão do servidor fingido (o `/auth/eu` passa a 401). */
  fechaSessao?: boolean;
};

export type ServidorDeClientes = {
  clientes: ClienteGestao[];
  fotosPendentes: number;
  eventos: EventoGestao[];
  novosRegistos: number;
  pedidos: PedidoObservado[];
  falhas: Falha[];
  atrasoMs: number;
  /** O corpo de `GET /clientes.csv` (os bytes, BOM incluída). */
  csv: Buffer;
  /** O `Content-Disposition` da resposta do CSV. */
  csvDisposicao: string | null;
  /** O `Content-Type` da resposta do CSV. */
  csvTipo: string;
};

export const ROTA_DE_CLIENTES = /\/api\/gestao\/(?:resumo|clientes(?:\.csv|\/\d+)?)(?:\?.*)?$/;

export function pedidosDe(
  servidor: ServidorDeClientes,
  metodo: string,
  caminho: RegExp = /./,
): PedidoObservado[] {
  return servidor.pedidos.filter((p) => p.metodo === metodo && caminho.test(p.caminho));
}
export function eliminados(servidor: ServidorDeClientes, id?: number): number {
  return pedidosDe(
    servidor,
    "DELETE",
    id === undefined ? /^\/gestao\/clientes\/\d+$/ : new RegExp(`^/gestao/clientes/${String(id)}$`),
  ).length;
}
export function leiturasDaLista(servidor: ServidorDeClientes): number {
  return pedidosDe(servidor, "GET", /^\/gestao\/clientes$/).length;
}
export function leiturasDoResumo(servidor: ServidorDeClientes): number {
  return pedidosDe(servidor, "GET", /^\/gestao\/resumo$/).length;
}

async function json(rota: Route, estado: number, corpo?: unknown): Promise<void> {
  await rota.fulfill({
    status: estado,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(corpo ?? {}),
  });
}

export async function fingirApiDeClientes(
  pagina: Page,
  opcoes: {
    clientes?: ReadonlyArray<ClienteGestao>;
    fotosPendentes?: number;
    eventos?: ReadonlyArray<EventoGestao>;
    novosRegistos?: number;
    falhas?: Falha[];
    sessao?: ServidorFingido;
    atrasoMs?: number;
    csv?: Uint8Array;
    csvDisposicao?: string | null;
    csvTipo?: string;
  } = {},
): Promise<ServidorDeClientes> {
  const servidor: ServidorDeClientes = {
    clientes: structuredClone([...(opcoes.clientes ?? clientesDeTeste())]),
    fotosPendentes: opcoes.fotosPendentes ?? 3,
    eventos: structuredClone([...(opcoes.eventos ?? eventosDoResumo(3))]),
    novosRegistos: opcoes.novosRegistos ?? 2,
    pedidos: [],
    falhas: opcoes.falhas ?? [],
    atrasoMs: opcoes.atrasoMs ?? 0,
    csv: Buffer.from(opcoes.csv ?? csvDeTeste()),
    csvDisposicao:
      opcoes.csvDisposicao === undefined
        ? 'attachment; filename="clientes-2026-11-02.csv"'
        : opcoes.csvDisposicao,
    csvTipo: opcoes.csvTipo ?? "text/csv; charset=utf-8",
  };
  const vezesUsadas = new WeakMap<Falha, number>();

  async function falhaInjetada(
    rota: Route,
    metodo: string,
    caminho: string,
    aplicar: () => void,
  ): Promise<boolean> {
    for (const falha of servidor.falhas) {
      if (falha.metodo !== metodo || !falha.caminho.test(caminho)) continue;
      // `pedidos` já inclui o pedido corrente: a ordem conta os que condizem com esta falha.
      const n = servidor.pedidos.filter(
        (p) => p.metodo === falha.metodo && falha.caminho.test(p.caminho),
      ).length;
      if (falha.ordem !== undefined && falha.ordem !== n) continue;
      if (falha.quando !== undefined && !falha.quando(servidor)) continue;
      const usadas = vezesUsadas.get(falha) ?? 0;
      if (falha.vezes !== undefined && usadas >= falha.vezes) continue;
      vezesUsadas.set(falha, usadas + 1);
      if (falha.fechaSessao === true && opcoes.sessao !== undefined)
        opcoes.sessao.sessaoAberta = false;
      if (falha.resposta === "aplicar-e-abortar") {
        aplicar();
        await rota.abort("failed");
      } else if (falha.resposta === "abortar") await rota.abort("failed");
      else if (falha.resposta.texto !== undefined)
        await rota.fulfill({
          status: falha.resposta.estado,
          contentType: falha.resposta.tipo ?? "text/html",
          body: falha.resposta.texto,
        });
      else await json(rota, falha.resposta.estado, falha.resposta.corpo);
      return true;
    }
    return false;
  }

  await pagina.route(ROTA_DE_CLIENTES, async (rota) => {
    const pedido = rota.request();
    const metodo = pedido.method();
    const caminho = new URL(pedido.url()).pathname.replace(/^\/api/, "");
    const m = /^\/gestao\/(resumo|clientes(?:\.csv)?)(?:\/(\d+))?$/.exec(caminho);
    const recurso = m?.[1];
    const id = m?.[2] === undefined ? null : Number(m[2]);
    servidor.pedidos.push({ metodo, caminho, cabecalhos: pedido.headers() });
    if (servidor.atrasoMs > 0) await new Promise((r) => setTimeout(r, servidor.atrasoMs));

    const eliminar = (): void => {
      const i = servidor.clientes.findIndex((c) => c.id === id);
      if (i >= 0) servidor.clientes.splice(i, 1);
    };
    if (
      await falhaInjetada(rota, metodo, caminho, metodo === "DELETE" ? eliminar : () => undefined)
    )
      return;

    if (opcoes.sessao !== undefined && !opcoes.sessao.sessaoAberta) {
      await json(rota, 401, { erro: "sessao_em_falta", mensagem: "Precisas de entrar." });
      return;
    }

    if (recurso === "resumo" && metodo === "GET") {
      await json(rota, 200, {
        fotos_pendentes: servidor.fotosPendentes,
        proximos_eventos: servidor.eventos.slice(0, 3),
        novos_registos: servidor.novosRegistos,
      });
      return;
    }
    if (recurso === "clientes" && id === null && metodo === "GET") {
      await json(rota, 200, { clientes: servidor.clientes });
      return;
    }
    if (recurso === "clientes.csv" && metodo === "GET") {
      const cabecalhos: Record<string, string> = { "Cache-Control": "no-store" };
      if (servidor.csvDisposicao !== null)
        cabecalhos["Content-Disposition"] = servidor.csvDisposicao;
      await rota.fulfill({
        status: 200,
        contentType: servidor.csvTipo,
        headers: cabecalhos,
        body: servidor.csv,
      });
      return;
    }
    if (recurso === "clientes" && id !== null && metodo === "DELETE") {
      if (pedido.headers()["x-tomazia"] !== "1") {
        await json(rota, 403, { erro: "pedido_recusado", mensagem: "x" });
        return;
      }
      if (!servidor.clientes.some((c) => c.id === id)) {
        await json(rota, 404, {
          erro: "cliente_inexistente",
          mensagem: "MENSAGEM-DO-BACKEND (nunca aparece no ecrã)",
        });
        return;
      }
      eliminar();
      await rota.fulfill({ status: 204, headers: { "Cache-Control": "no-store" } });
      return;
    }
    await json(rota, 405, { erro: "metodo_nao_permitido", mensagem: "x" });
  });

  return servidor;
}

// ---------------------------------------------------------------------------
// Abrir os ecrãs
// ---------------------------------------------------------------------------

export type OpcoesDeAbertura = Parameters<typeof fingirApiDeClientes>[1] & {
  /** Corre depois dos fingimentos e **antes** do `goto` (uma rota registada depois ganha). */
  antesDeAbrir?: (pagina: Page) => Promise<void>;
  /** Esperar pelo título do ecrã (por omissão sim). */
  esperar?: boolean;
};

async function preparar(
  page: Page,
  opcoes: OpcoesDeAbertura,
): Promise<{ servidor: ServidorDeClientes; sessao: ServidorFingido }> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDeClientes(page, { ...opcoes, sessao });
  await opcoes.antesDeAbrir?.(page);
  await page.clock.install({ time: AGORA });
  return { servidor, sessao };
}

export async function abrirClientes(
  page: Page,
  opcoes: OpcoesDeAbertura = {},
): Promise<{ servidor: ServidorDeClientes; sessao: ServidorFingido }> {
  const r = await preparar(page, opcoes);
  await page.goto("/gestao/mais/clientes");
  await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
  if (opcoes.esperar !== false) {
    await expect(
      page.getByRole("heading", { level: 2, name: new RegExp(`^${T.h2}`) }),
    ).toBeVisible();
    // A lista (ou o vazio) já chegou: o esqueleto saiu.
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  }
  return r;
}

export async function abrirInicio(
  page: Page,
  opcoes: OpcoesDeAbertura = {},
): Promise<{ servidor: ServidorDeClientes; sessao: ServidorFingido }> {
  const r = await preparar(page, opcoes);
  await page.goto("/gestao");
  if (opcoes.esperar !== false) {
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Localizadores dos Clientes
// ---------------------------------------------------------------------------

export function seccao(page: Page): Locator {
  return page.getByRole("region", { name: new RegExp(`^${T.h2}`) });
}
export function tituloDaLista(page: Page): Locator {
  return page.getByRole("heading", { level: 2, name: new RegExp(`^${T.h2}`) });
}
export function itens(page: Page): Locator {
  return seccao(page).getByRole("listitem");
}
export function botoesEliminar(page: Page): Locator {
  return seccao(page).getByRole("button", { name: T.eliminar, exact: true });
}
/** O «Eliminar» do item com o nome `nome`. */
export function eliminarDe(page: Page, nome: string): Locator {
  return itens(page)
    .filter({ hasText: nome })
    .first()
    .getByRole("button", { name: T.eliminar, exact: true });
}
export function folhaDeEliminar(page: Page): Locator {
  return page.getByRole("dialog", { name: T.tituloDaFolha, exact: true });
}
export function aviso(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(Feito|Erro)\./ });
}
/** A linha de estado (`role="status"`) com `texto`, fora do aviso. */
export function linhaDeEstado(page: Page, texto: string): Locator {
  return page.locator('[role="status"]').filter({ hasText: texto });
}

// ---------------------------------------------------------------------------
// Para as capturas: axe e alvos de 44 px (Q-03, Q-04)
// ---------------------------------------------------------------------------

export async function axeSemViolacoesGraves(page: Page, ecra: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const resultado = await new AxeBuilder({ page }).analyze();
  const graves = resultado.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    graves.map((v) => `[${ecra}] ${v.id}: ${v.help}`),
    "o axe achou violações sérias ou críticas (Q-03)",
  ).toEqual([]);
}

/**
 * Todos os botões e ligações **visíveis** do conteúdo e da folha aberta medem 44 px ou mais
 * (Q-04). Mede só o conteúdo: a barra de navegação é da F4-01 e tem os seus testes.
 */
export async function alvosDe44(page: Page, ecra: string): Promise<void> {
  const pequenos = await page.evaluate(() => {
    const achados: string[] = [];
    const alvos = document.querySelectorAll<HTMLElement>(
      "main a, main button, dialog[open] button, [role=status] button",
    );
    for (const el of Array.from(alvos)) {
      const caixa = el.getBoundingClientRect();
      if (caixa.width === 0 || caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(
          `${el.tagName.toLowerCase()} «${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}» ${String(Math.round(caixa.width))}x${String(Math.round(caixa.height))}`,
        );
      }
    }
    return achados;
  });
  expect(pequenos, `[${ecra}] alvos com menos de 44 px (Q-04)`).toEqual([]);
}
