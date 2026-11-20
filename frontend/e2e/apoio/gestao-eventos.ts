import type { Page, Route } from "@playwright/test";

import { AGORA } from "../../src/testes/eventos";
import {
  eventosDeGestaoDeTeste,
  type EventoGestao,
  type RespostaEventosGestao,
} from "../../src/testes/gestao";
import type { ServidorFingido } from "./gestao";

/**
 * Os eventos da gestão e o `/api/eventos` público fingidos **com um único estado em memória**
 * (F4-03): um `POST/PATCH/DELETE/duplicar` em `/api/gestao/eventos…` muda o que um
 * `GET /api/eventos` devolve a seguir — é o que prova «editar um evento publicado muda o site
 * sem deploy» e «eliminar tira o evento do site» do lado do frontend (o lado do servidor é
 * `backend/tests/gestao/test_eventos.py` e `test_duplicar.py`).
 *
 *  - As três listas **calculam-se com o corte da meia-noite de Lisboa do `agora` dado** (o mesmo
 *    `AGORA` do `page.clock`, nunca o `Date.now()` do Node): `proximos` = publicados desde o
 *    corte, do mais próximo ao mais longe; `rascunhos` = não publicados (os sem data no fim);
 *    `arquivo` = publicados antes do corte, do mais recente ao mais antigo. O público dá só os
 *    publicados desde o corte, **sem** o `publicado`.
 *  - **Valida o corpo como o backend** (`extra="forbid"`): `POST` com `titulo`, `inicio`,
 *    `descricao?` e `publicado` e mais nada; `PATCH` só com chaves conhecidas, `inicio: null` e
 *    `imagem` recusados, **publicar sem data → 422 `evento_sem_data` com `campo="inicio"`**;
 *    `titulo` 1 a 120 e `descricao` até 1000 (depois de aparar, em pontos de código); `inicio` com
 *    fuso explícito. Um 422 nunca grava.
 *  - **`POST …/duplicar`** com corpo opcional `{ semanas: 1..4 }` (inteiro; `extra="forbid"`;
 *    sem corpo = 1): `k0` = o menor `k ≥ 1` com `original + 7k dias` (hora de parede de Lisboa,
 *    `fold=0`) estritamente depois de `agora`; a cópia fica em `original + 7·(k0 + semanas − 1)`
 *    dias. Original sem data → cópia sem data. A aritmética de Lisboa está aqui, escrita à parte
 *    do código de produção (um oráculo que importasse o código que testa nunca discordava dele);
 *    a regra exata, com a mudança da hora, é provada no backend.
 *  - **`pedidos`** regista tudo (método, caminho, corpo JSON, cabeçalhos); **`falhas`** injeta uma
 *    falha por rota **e por ordem do pedido** (a ordem conta os pedidos que condizem com
 *    `metodo` + `caminho`, a partir de 1).
 *
 * **Precedência das rotas (Playwright: a última registada ganha).** O `apoio/gestao-ementa.ts`
 * regista `**\/api/gestao/**`; quem usar também `fingirApiDeEmenta` tem de chamar **esta** função
 * **depois** dela. O `page.route` desliga a cache HTTP do browser: o e2e não vê o `max-age=60` do
 * `/api/eventos` público (os avisos dizem «pode levar um minuto»; fica dito no PR).
 */
export type PedidoObservado = {
  metodo: string;
  caminho: string;
  corpo: unknown;
  cabecalhos: Record<string, string>;
};

export type Falha = {
  metodo: "GET" | "POST" | "PATCH" | "DELETE";
  /** Condiz com o caminho depois de `/api` (`/gestao/eventos`, `/gestao/eventos/11`, `/eventos`). */
  caminho: RegExp;
  /** O n-ésimo pedido que condiz (1 = o primeiro). Sem `ordem`, todos. */
  ordem?: number;
  resposta: { estado: number; corpo?: Record<string, unknown> } | "abortar";
  /** Fecha também a sessão do servidor fingido de `apoio/gestao.ts` (o `/auth/eu` passa a 401). */
  fechaSessao?: boolean;
};

export type ServidorDeEventos = {
  /** O estado «na base de dados». */
  eventos: EventoGestao[];
  pedidos: PedidoObservado[];
  falhas: Falha[];
  atrasoMs: number;
};

export const ROTA_DOS_EVENTOS_DE_GESTAO =
  /\/api\/gestao\/eventos(?:\/(\d+))?(\/duplicar)?(?:\?.*)?$/;
export const ROTA_DOS_EVENTOS_PUBLICOS = "**/api/eventos";

export function pedidosDe(
  servidor: ServidorDeEventos,
  metodo: string,
  caminho: RegExp = /./,
): PedidoObservado[] {
  return servidor.pedidos.filter((p) => p.metodo === metodo && caminho.test(p.caminho));
}

// ---------------------------------------------------------------------------
// Hora de Lisboa, só com `Intl` (nunca o fuso do processo)
// ---------------------------------------------------------------------------

const FORMATADOR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Parede = { a: number; m: number; d: number; h: number; mi: number; s: number };

function parede(ms: number): Parede {
  const p: Record<string, number> = {};
  for (const parte of FORMATADOR.formatToParts(new Date(ms))) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  return {
    a: p["year"] as number,
    m: p["month"] as number,
    d: p["day"] as number,
    h: p["hour"] as number,
    mi: p["minute"] as number,
    s: p["second"] as number,
  };
}
const comoUtc = (p: Parede): number => Date.UTC(p.a, p.m - 1, p.d, p.h, p.mi, p.s);
const deslocamento = (ms: number): number => comoUtc(parede(ms)) - ms;

/** Hora de parede de Lisboa → instante, com o `fold=0` do PEP 495 (a repetida: a primeira; a que não existe: a de antes do salto). */
function deParede(p: Parede): number {
  const t0 = comoUtc(p);
  const TRES_H = 3 * 3_600_000;
  const candidatos = [...new Set([deslocamento(t0 - TRES_H), deslocamento(t0 + TRES_H)])]
    .map((o) => t0 - o)
    .filter((t) => comoUtc(parede(t)) === t0)
    .sort((x, y) => x - y);
  return candidatos[0] ?? t0 - deslocamento(t0 - TRES_H);
}

/** A meia-noite de Lisboa do dia de `agora`: o corte do dia do bar (ADR 0010). */
export function corteDoDia(agora: Date): number {
  const p = parede(agora.getTime());
  return deParede({ ...p, h: 0, mi: 0, s: 0 });
}

function maisDias(p: Parede, dias: number): Parede {
  const t = new Date(Date.UTC(p.a, p.m - 1, p.d + dias, p.h, p.mi, p.s));
  return {
    a: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: p.h,
    mi: p.mi,
    s: p.s,
  };
}

/** A n-ésima data livre da série semanal de `inicio` (plano 11.2). Exportada para os testes lerem a regra. */
export function dataDaCopia(inicio: string, agora: Date, semanas: number): string {
  const original = parede(new Date(inicio).getTime());
  let k = 1;
  while (deParede(maisDias(original, 7 * k)) <= agora.getTime()) k += 1;
  const alvo = deParede(maisDias(original, 7 * (k + semanas - 1)));
  return new Date(alvo).toISOString().replace(".000Z", "Z");
}

// ---------------------------------------------------------------------------

const POST_CHAVES = ["titulo", "inicio", "descricao", "publicado"] as const;
const PATCH_CHAVES = ["titulo", "inicio", "descricao", "publicado"] as const;

function pontos(texto: string): number {
  return [...texto].length;
}
function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}
function leInicio(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(valor))
    return null;
  const ms = new Date(valor).getTime();
  if (Number.isNaN(ms)) return null;
  const ano = new Date(ms).getUTCFullYear();
  if (ano < 1970 || ano > 9000) return null;
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

type Recusa = { erro: string; campo?: string };

function validarTitulo(v: unknown): Recusa | null {
  if (typeof v !== "string") return { erro: "dados_invalidos", campo: "titulo" };
  const n = pontos(v.trim());
  return n < 1 || n > 120 ? { erro: "dados_invalidos", campo: "titulo" } : null;
}
function validarDescricao(v: unknown): Recusa | null {
  if (v === null) return null;
  if (typeof v !== "string") return { erro: "dados_invalidos", campo: "descricao" };
  return pontos(v.trim()) > 1000 ? { erro: "dados_invalidos", campo: "descricao" } : null;
}

async function json(rota: Route, estado: number, corpo?: unknown): Promise<void> {
  if (estado === 204) {
    await rota.fulfill({ status: 204 });
    return;
  }
  await rota.fulfill({
    status: estado,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(corpo ?? {}),
  });
}

function recusa(r: Recusa, estado = 422): { estado: number; corpo: Record<string, unknown> } {
  return {
    estado,
    corpo: {
      erro: r.erro,
      mensagem: "MENSAGEM-GENERICA-DO-BACKEND (nunca aparece no ecrã)",
      ...(r.campo === undefined ? {} : { campo: r.campo }),
    },
  };
}

/** `eventos` tem de vir como as três listas do servidor ou como a lista plana. */
export function achatar(inicial: RespostaEventosGestao | EventoGestao[]): EventoGestao[] {
  return Array.isArray(inicial)
    ? structuredClone(inicial)
    : structuredClone([...inicial.proximos, ...inicial.rascunhos, ...inicial.arquivo]);
}

/** As três listas, como o servidor as divide com o corte do dia do bar de `agora`. */
export function listasDe(eventos: EventoGestao[], agora: Date): RespostaEventosGestao {
  const corte = corteDoDia(agora);
  const tempo = (e: EventoGestao): number => new Date(e.inicio ?? 0).getTime();
  const publicados = eventos.filter((e) => e.publicado && e.inicio !== null);
  return {
    proximos: publicados
      .filter((e) => tempo(e) >= corte)
      .sort((a, b) => tempo(a) - tempo(b) || a.id - b.id),
    rascunhos: eventos
      .filter((e) => !e.publicado)
      .sort((a, b) => {
        if (a.inicio === null && b.inicio === null) return a.id - b.id;
        if (a.inicio === null) return 1;
        if (b.inicio === null) return -1;
        return tempo(a) - tempo(b) || a.id - b.id;
      }),
    arquivo: publicados
      .filter((e) => tempo(e) < corte)
      .sort((a, b) => tempo(b) - tempo(a) || a.id - b.id),
  };
}

export async function fingirApiDeEventos(
  pagina: Page,
  opcoes: {
    inicial?: RespostaEventosGestao | EventoGestao[];
    /** O instante em que o servidor vive; o mesmo do `page.clock.install({ time })`. */
    agora?: Date;
    falhas?: Falha[];
    sessao?: ServidorFingido;
    atrasoMs?: number;
  } = {},
): Promise<ServidorDeEventos> {
  const agora = opcoes.agora ?? AGORA;
  const servidor: ServidorDeEventos = {
    eventos: achatar(opcoes.inicial ?? eventosDeGestaoDeTeste()),
    pedidos: [],
    falhas: opcoes.falhas ?? [],
    atrasoMs: opcoes.atrasoMs ?? 0,
  };
  let proximoId = Math.max(1000, ...servidor.eventos.map((e) => e.id + 1));

  async function falhaInjetada(rota: Route, metodo: string, caminho: string): Promise<boolean> {
    // `pedidos` já inclui o pedido corrente.
    const n = servidor.pedidos.filter((p) => p.metodo === metodo && p.caminho === caminho).length;
    for (const falha of servidor.falhas) {
      if (falha.metodo !== metodo || !falha.caminho.test(caminho)) continue;
      if (falha.ordem !== undefined && falha.ordem !== n) continue;
      if (falha.fechaSessao === true && opcoes.sessao !== undefined)
        opcoes.sessao.sessaoAberta = false;
      if (falha.resposta === "abortar") await rota.abort("failed");
      else await json(rota, falha.resposta.estado, falha.resposta.corpo);
      return true;
    }
    return false;
  }

  await pagina.route(ROTA_DOS_EVENTOS_DE_GESTAO, async (rota) => {
    const pedido = rota.request();
    const metodo = pedido.method();
    const url = new URL(pedido.url());
    const caminho = url.pathname.replace(/^\/api/, "");
    const m = /^\/gestao\/eventos(?:\/(\d+))?(\/duplicar)?$/.exec(caminho);
    const id = m?.[1] === undefined ? null : Number(m[1]);
    const duplicar = m?.[2] !== undefined;
    const texto = pedido.postData();
    let corpo: unknown;
    let corpoIlegivel = false;
    if (texto !== null && texto !== "") {
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpoIlegivel = true;
      }
    }
    servidor.pedidos.push({ metodo, caminho, corpo, cabecalhos: pedido.headers() });
    if (servidor.atrasoMs > 0) await new Promise((r) => setTimeout(r, servidor.atrasoMs));

    if (await falhaInjetada(rota, metodo, caminho)) return;

    if (opcoes.sessao !== undefined && !opcoes.sessao.sessaoAberta) {
      await json(rota, 401, { erro: "sessao_em_falta", mensagem: "Precisas de entrar." });
      return;
    }
    if (pedido.headers()["x-tomazia"] !== "1" && metodo !== "GET") {
      await json(rota, 403, { erro: "pedido_recusado", mensagem: "x" });
      return;
    }

    const achado = id === null ? undefined : servidor.eventos.find((e) => e.id === id);

    if (id === null && metodo === "GET") {
      await json(rota, 200, listasDe(servidor.eventos, agora));
      return;
    }

    if (id === null && metodo === "POST") {
      if (corpoIlegivel || !eObjeto(corpo)) {
        const r = recusa({ erro: "dados_invalidos" });
        await json(rota, r.estado, r.corpo);
        return;
      }
      const extra = Object.keys(corpo).find((c) => !(POST_CHAVES as readonly string[]).includes(c));
      const falta = (["titulo", "inicio", "publicado"] as const).find((c) => !(c in corpo));
      const inicio = leInicio(corpo["inicio"]);
      const erro =
        (extra !== undefined ? ({ erro: "dados_invalidos" } as Recusa) : null) ??
        (falta !== undefined ? { erro: "dados_invalidos", campo: falta } : null) ??
        validarTitulo(corpo["titulo"]) ??
        (inicio === null ? { erro: "dados_invalidos", campo: "inicio" } : null) ??
        validarDescricao(corpo["descricao"] ?? null) ??
        (typeof corpo["publicado"] !== "boolean"
          ? { erro: "dados_invalidos", campo: "publicado" }
          : null);
      if (erro !== null) {
        const r = recusa(erro);
        await json(rota, r.estado, r.corpo);
        return;
      }
      const descricao = typeof corpo["descricao"] === "string" ? corpo["descricao"].trim() : "";
      const novo: EventoGestao = {
        id: proximoId++,
        titulo: (corpo["titulo"] as string).trim(),
        inicio,
        descricao: descricao === "" ? null : descricao,
        imagem: null,
        publicado: corpo["publicado"] as boolean,
      };
      servidor.eventos.push(novo);
      await json(rota, 201, novo);
      return;
    }

    if (id !== null && achado === undefined) {
      await json(rota, 404, { erro: "evento_inexistente", mensagem: "Não encontrei o evento." });
      return;
    }

    if (achado !== undefined && !duplicar && metodo === "PATCH") {
      if (corpoIlegivel || !eObjeto(corpo)) {
        const r = recusa({ erro: "dados_invalidos" });
        await json(rota, r.estado, r.corpo);
        return;
      }
      const extra = Object.keys(corpo).find(
        (c) => !(PATCH_CHAVES as readonly string[]).includes(c),
      );
      const inicio = "inicio" in corpo ? leInicio(corpo["inicio"]) : achado.inicio;
      const publicado = "publicado" in corpo ? corpo["publicado"] : achado.publicado;
      const erro =
        (extra !== undefined ? ({ erro: "dados_invalidos" } as Recusa) : null) ??
        ("titulo" in corpo ? validarTitulo(corpo["titulo"]) : null) ??
        ("inicio" in corpo && inicio === null
          ? { erro: "dados_invalidos", campo: "inicio" }
          : null) ??
        ("descricao" in corpo ? validarDescricao(corpo["descricao"]) : null) ??
        (typeof publicado !== "boolean" ? { erro: "dados_invalidos", campo: "publicado" } : null) ??
        (publicado && inicio === null ? { erro: "evento_sem_data", campo: "inicio" } : null);
      if (erro !== null) {
        const r = recusa(erro);
        await json(rota, r.estado, r.corpo);
        return;
      }
      if ("titulo" in corpo) achado.titulo = (corpo["titulo"] as string).trim();
      if ("inicio" in corpo) achado.inicio = inicio;
      if ("descricao" in corpo) {
        const d = typeof corpo["descricao"] === "string" ? corpo["descricao"].trim() : "";
        achado.descricao = d === "" ? null : d;
      }
      if ("publicado" in corpo) achado.publicado = publicado as boolean;
      await json(rota, 200, achado);
      return;
    }

    if (achado !== undefined && !duplicar && metodo === "DELETE") {
      servidor.eventos.splice(servidor.eventos.indexOf(achado), 1);
      await json(rota, 204);
      return;
    }

    if (achado !== undefined && duplicar && metodo === "POST") {
      let semanas = 1;
      if (corpoIlegivel) {
        const r = recusa({ erro: "dados_invalidos" });
        await json(rota, r.estado, r.corpo);
        return;
      }
      if (corpo !== undefined && corpo !== null) {
        const extra = eObjeto(corpo) ? Object.keys(corpo).find((c) => c !== "semanas") : "?";
        const valor = eObjeto(corpo) && "semanas" in corpo ? corpo["semanas"] : 1;
        const bom =
          typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= 4;
        if (extra !== undefined || !bom) {
          const r = recusa({
            erro: "dados_invalidos",
            ...(extra === undefined ? { campo: "semanas" } : {}),
          });
          await json(rota, r.estado, r.corpo);
          return;
        }
        semanas = valor;
      }
      const copia: EventoGestao = {
        ...achado,
        id: proximoId++,
        publicado: false,
        inicio: achado.inicio === null ? null : dataDaCopia(achado.inicio, agora, semanas),
      };
      servidor.eventos.push(copia);
      await json(rota, 201, copia);
      return;
    }

    await json(rota, 405, { erro: "metodo_nao_permitido", mensagem: "x" });
  });

  await pagina.route(ROTA_DOS_EVENTOS_PUBLICOS, async (rota) => {
    const pedido = rota.request();
    servidor.pedidos.push({
      metodo: pedido.method(),
      caminho: "/eventos",
      corpo: undefined,
      cabecalhos: pedido.headers(),
    });
    if (await falhaInjetada(rota, pedido.method(), "/eventos")) return;
    const { proximos } = listasDe(servidor.eventos, agora);
    await rota.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        eventos: proximos.map(({ id, titulo, inicio, descricao, imagem }) => ({
          id,
          titulo,
          inicio,
          descricao,
          imagem,
        })),
      }),
    });
  });

  return servidor;
}
