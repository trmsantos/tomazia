import type { Page, Route } from "@playwright/test";

import type { Info } from "../../src/lib/api/publico";
import {
  DIAS_PELA_ORDEM,
  definicoesConfiguradas,
  type DefinicoesGestao,
  type DiaDoHorario,
} from "../../src/testes/gestao";
import type { ServidorFingido } from "./gestao";

/**
 * As definições da gestão e o `/info` público fingidos **com um único estado em
 * memória** (F4-05a): um `PUT /api/gestao/definicoes` muda o que um `GET /api/info`
 * devolve a seguir — é o que prova «mudar o WiFi aparece no site público sem
 * deploy» do lado do frontend (o lado do servidor é
 * `backend/tests/gestao/test_definicoes.py::test_o_wifi_novo_aparece_no_info_publico`).
 *
 * O `/info` segue as regras do backend (`_texto_ou_nulo`): `""` **e só espaços** →
 * `null`; um texto com valor sai **tal como está** (o espaço no fim da password
 * mantém-se); `horario_estado: "invalido"` dá `horario: null`; `wifi` é sempre um
 * objeto.
 *
 * O `PUT` valida o que o `PedidoDefinicoes` valida: exatamente as sete chaves
 * (uma a menos → 422 com `campo`; uma a mais, `horario_estado` incluído → 422 com
 * `campo`), os textos são texto, o `horario` é `null` ou sete dias com `dia` e
 * `periodos`. Devolve o mesmo corpo que o `GET`.
 *
 * **Precedência das rotas (Playwright: a última registada ganha).** O
 * `apoio/gestao-ementa.ts` regista `**\/api/gestao/**` (apanha tudo, `definicoes`
 * incluída) e o `apoio/gestao.ts` regista `**\/api/gestao/categorias`. Quem usar
 * também `fingirApiDeEmenta` tem de chamar **esta** função **depois** dela; os
 * specs desta tarefa não precisam da ementa de gestão.
 *
 * Quem abre o site público depois (`goto("/")`) **não** deve chamar `fingirInfoFixo`
 * (registaria outra rota para `/api/info` por cima desta): é este `/info` que se
 * quer ler.
 */
export type PedidoObservado = {
  metodo: string;
  caminho: string;
  corpo: unknown;
  cabecalhos: Record<string, string>;
};

export type Falha = {
  metodo: "GET" | "PUT";
  /** Condiz com o caminho depois de `/api` (`/gestao/definicoes`, `/info`). */
  caminho: RegExp;
  /** O n-ésimo pedido que condiz (1 = o primeiro). Sem `ordem`, todos. */
  ordem?: number;
  resposta: { estado: number; corpo?: Record<string, unknown> } | "abortar";
  /** Fecha também a sessão do servidor fingido de `apoio/gestao.ts` (o `/auth/eu` passa a 401). */
  fechaSessao?: boolean;
};

export type ServidorDeDefinicoes = {
  /** O estado «na base de dados»: o `GET` e o `/info` leem-no, o `PUT` escreve-o. */
  definicoes: DefinicoesGestao;
  pedidos: PedidoObservado[];
  falhas: Falha[];
  /** Atraso (ms) a aplicar a cada resposta da API de definições. */
  atrasoMs: number;
};

export const ROTA_DAS_DEFINICOES = "**/api/gestao/definicoes";
export const ROTA_DO_INFO_PUBLICO = "**/api/info";

const SETE_CHAVES = [
  "wifi_rede",
  "wifi_password",
  "morada",
  "telefone",
  "instagram",
  "maps_url",
  "horario",
] as const;

export function pedidosDe(
  servidor: ServidorDeDefinicoes,
  metodo: string,
  caminho: RegExp = /./,
): PedidoObservado[] {
  return servidor.pedidos.filter((p) => p.metodo === metodo && caminho.test(p.caminho));
}

function textoOuNulo(valor: string): string | null {
  return valor.trim() === "" ? null : valor;
}

/** O `/info` público que o backend daria a este estado. */
export function infoPublicoDe(d: DefinicoesGestao): Info {
  return {
    wifi: { rede: textoOuNulo(d.wifi_rede), password: textoOuNulo(d.wifi_password) },
    morada: textoOuNulo(d.morada),
    telefone: textoOuNulo(d.telefone),
    instagram: textoOuNulo(d.instagram),
    maps_url: textoOuNulo(d.maps_url),
    horario: d.horario_estado === "configurado" ? d.horario : null,
  } as Info;
}

async function json(rota: Route, estado: number, corpo?: unknown): Promise<void> {
  await rota.fulfill({
    status: estado,
    contentType: "application/json",
    body: JSON.stringify(corpo ?? {}),
  });
}

function recusa(campo: string): { erro: string; mensagem: string; campo: string } {
  return {
    erro: "dados_invalidos",
    mensagem: "MENSAGEM-GENERICA-DO-BACKEND (nunca aparece no ecrã)",
    campo,
  };
}

/** Devolve o `campo` do primeiro erro do pedido, ou `null` se for válido. */
function campoRecusado(corpo: unknown): string | null {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return "wifi_rede";
  const chaves = Object.keys(corpo);
  for (const chave of SETE_CHAVES) if (!chaves.includes(chave)) return chave;
  for (const chave of chaves) if (!(SETE_CHAVES as readonly string[]).includes(chave)) return chave;
  const c = corpo as Record<string, unknown>;
  for (const chave of SETE_CHAVES.slice(0, 6)) if (typeof c[chave] !== "string") return chave;
  const horario = c["horario"];
  if (horario === null) return null;
  if (!Array.isArray(horario) || horario.length !== 7) return "horario";
  const dias = horario.map((d) => (d as { dia?: unknown }).dia);
  if (
    new Set(dias).size !== 7 ||
    dias.some((d) => !(DIAS_PELA_ORDEM as readonly unknown[]).includes(d))
  ) {
    return "horario";
  }
  for (const d of horario as Array<{ periodos?: unknown }>) {
    if (!Array.isArray(d.periodos) || d.periodos.length > 6) return "horario";
    for (const p of d.periodos as Array<{ abre?: unknown; fecha?: unknown }>) {
      const bom = (h: unknown): boolean =>
        typeof h === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(h);
      if (!bom(p.abre) || !bom(p.fecha) || p.abre === p.fecha) return "horario";
    }
  }
  return null;
}

export async function fingirApiDeDefinicoes(
  pagina: Page,
  opcoes: {
    definicoes?: DefinicoesGestao;
    falhas?: Falha[];
    sessao?: ServidorFingido;
    atrasoMs?: number;
  } = {},
): Promise<ServidorDeDefinicoes> {
  const servidor: ServidorDeDefinicoes = {
    definicoes: opcoes.definicoes ?? definicoesConfiguradas(),
    pedidos: [],
    falhas: opcoes.falhas ?? [],
    atrasoMs: opcoes.atrasoMs ?? 0,
  };

  async function falhaInjetada(rota: Route, metodo: string, caminho: string): Promise<boolean> {
    const n = servidor.pedidos.filter((p) => p.metodo === metodo && p.caminho === caminho).length;
    for (const falha of servidor.falhas) {
      if (falha.metodo !== metodo || !falha.caminho.test(caminho)) continue;
      if (falha.ordem !== undefined && falha.ordem !== n) continue;
      if (falha.fechaSessao === true && opcoes.sessao !== undefined) {
        opcoes.sessao.sessaoAberta = false;
      }
      if (falha.resposta === "abortar") await rota.abort("failed");
      else await json(rota, falha.resposta.estado, falha.resposta.corpo);
      return true;
    }
    return false;
  }

  await pagina.route(ROTA_DAS_DEFINICOES, async (rota) => {
    const pedido = rota.request();
    const metodo = pedido.method();
    const texto = pedido.postData();
    const corpo: unknown = texto === null ? undefined : JSON.parse(texto);
    servidor.pedidos.push({
      metodo,
      caminho: "/gestao/definicoes",
      corpo,
      cabecalhos: pedido.headers(),
    });
    if (servidor.atrasoMs > 0) await new Promise((r) => setTimeout(r, servidor.atrasoMs));

    if (await falhaInjetada(rota, metodo, "/gestao/definicoes")) return;

    if (opcoes.sessao !== undefined && !opcoes.sessao.sessaoAberta) {
      await json(rota, 401, { erro: "sessao_em_falta", mensagem: "Precisas de entrar." });
      return;
    }

    if (metodo === "GET") {
      await json(rota, 200, servidor.definicoes);
      return;
    }

    if (metodo === "PUT") {
      const campo = campoRecusado(corpo);
      if (campo !== null) {
        await json(rota, 422, recusa(campo));
        return;
      }
      const c = corpo as Omit<DefinicoesGestao, "horario_estado">;
      const horario: DiaDoHorario[] | null =
        c.horario === null
          ? null
          : [...c.horario].sort(
              (a, b) => DIAS_PELA_ORDEM.indexOf(a.dia) - DIAS_PELA_ORDEM.indexOf(b.dia),
            );
      servidor.definicoes = {
        ...c,
        horario,
        horario_estado: horario === null ? "nao_configurado" : "configurado",
      };
      await json(rota, 200, servidor.definicoes);
      return;
    }

    await json(rota, 405, { erro: "metodo_nao_permitido", mensagem: "x" });
  });

  await pagina.route(ROTA_DO_INFO_PUBLICO, async (rota) => {
    const pedido = rota.request();
    servidor.pedidos.push({
      metodo: pedido.method(),
      caminho: "/info",
      corpo: undefined,
      cabecalhos: pedido.headers(),
    });
    if (await falhaInjetada(rota, pedido.method(), "/info")) return;
    await rota.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(infoPublicoDe(servidor.definicoes)),
    });
  });

  return servidor;
}
