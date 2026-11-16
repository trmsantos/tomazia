import type { Page, Route } from "@playwright/test";

import { ementaDeGestaoDeTeste, type CategoriaGestao } from "../../src/testes/gestao";
import type { ServidorFingido } from "./gestao";

/**
 * A API da ementa de gestão fingida, em memória (F4-02): `GET /gestao/categorias`,
 * `POST /gestao/produtos`, `PATCH /gestao/produtos/{id}` e
 * `PUT /gestao/categorias/{id}/produtos/ordem`. Sem backend: o que se testa é o
 * ecrã.
 *
 *  - **`pedidos`** regista tudo o que chegou (método, caminho, corpo JSON,
 *    cabeçalhos), para os testes contarem pedidos e verem o corpo exato;
 *  - **`falhas`** injeta uma falha numa rota **e por ordem do pedido**: com
 *    `ordem: 2` só o segundo `PATCH` falha (o do «Desfazer»). A ordem conta os
 *    pedidos que condizem com `metodo` + `caminho`, começando em 1;
 *  - uma falha com `fechaSessao: true` fecha também a sessão do servidor
 *    fingido de `apoio/gestao.ts` (o `/auth/eu` passa a dar 401), como faria o
 *    servidor a sério.
 */
export type PedidoObservado = {
  metodo: string;
  caminho: string;
  corpo: unknown;
  cabecalhos: Record<string, string>;
};

export type Falha = {
  metodo: "GET" | "POST" | "PATCH" | "PUT";
  /** Condiz com o caminho depois de `/api` (ex.: `/gestao/produtos/201`). */
  caminho: RegExp;
  /** O n-ésimo pedido que condiz (1 = o primeiro). Sem `ordem`, todos. */
  ordem?: number;
  resposta: { estado: number; corpo?: Record<string, unknown> } | "abortar";
  fechaSessao?: boolean;
};

export type ServidorDeEmenta = {
  categorias: CategoriaGestao[];
  pedidos: PedidoObservado[];
  falhas: Falha[];
  /** Atraso (ms) a aplicar a cada resposta — para ver «A guardar…». */
  atrasoMs: number;
};

export const ROTA_DA_API_DE_GESTAO = "**/api/gestao/**";

export function pedidosDe(
  servidor: ServidorDeEmenta,
  metodo: string,
  caminho?: RegExp,
): PedidoObservado[] {
  return servidor.pedidos.filter(
    (p) => p.metodo === metodo && (caminho === undefined || caminho.test(p.caminho)),
  );
}

async function json(rota: Route, estado: number, corpo?: unknown): Promise<void> {
  if (estado === 204) {
    await rota.fulfill({ status: 204 });
    return;
  }
  await rota.fulfill({
    status: estado,
    contentType: "application/json",
    body: JSON.stringify(corpo ?? {}),
  });
}

export async function fingirApiDeEmenta(
  pagina: Page,
  opcoes: {
    categorias?: CategoriaGestao[];
    falhas?: Falha[];
    sessao?: ServidorFingido;
    atrasoMs?: number;
  } = {},
): Promise<ServidorDeEmenta> {
  const servidor: ServidorDeEmenta = {
    categorias: opcoes.categorias ?? ementaDeGestaoDeTeste().categorias,
    pedidos: [],
    falhas: opcoes.falhas ?? [],
    atrasoMs: opcoes.atrasoMs ?? 0,
  };

  await pagina.route(ROTA_DA_API_DE_GESTAO, async (rota) => {
    const pedido = rota.request();
    const caminho = new URL(pedido.url()).pathname.replace(/^\/api/, "");
    const metodo = pedido.method();
    const texto = pedido.postData();
    const corpo: unknown = texto === null ? undefined : JSON.parse(texto);
    servidor.pedidos.push({ metodo, caminho, corpo, cabecalhos: pedido.headers() });

    if (servidor.atrasoMs > 0) await new Promise((r) => setTimeout(r, servidor.atrasoMs));

    const iguais = servidor.pedidos.filter((p) => p.metodo === metodo).length;
    for (const falha of servidor.falhas) {
      if (falha.metodo !== metodo || !falha.caminho.test(caminho)) continue;
      const n = servidor.pedidos.filter(
        (p) => p.metodo === metodo && falha.caminho.test(p.caminho),
      ).length;
      if (falha.ordem !== undefined && falha.ordem !== n) continue;
      if (falha.fechaSessao === true && opcoes.sessao !== undefined) {
        opcoes.sessao.sessaoAberta = false;
      }
      if (falha.resposta === "abortar") {
        await rota.abort("failed");
      } else {
        await json(rota, falha.resposta.estado, falha.resposta.corpo);
      }
      return;
    }
    void iguais;

    const produtos = servidor.categorias.flatMap((c) => c.produtos);

    if (metodo === "GET" && caminho === "/gestao/categorias") {
      await json(rota, 200, { categorias: servidor.categorias });
      return;
    }

    if (metodo === "PATCH") {
      const id = Number(/\/gestao\/produtos\/(\d+)$/.exec(caminho)?.[1]);
      const atual = produtos.find((p) => p.id === id);
      if (atual === undefined) {
        await json(rota, 404, { erro: "produto_inexistente", mensagem: "x" });
        return;
      }
      const alteracao = corpo as Record<string, unknown>;
      Object.assign(atual, alteracao);
      if (
        typeof alteracao.categoria_id === "number" &&
        alteracao.categoria_id !== atual.categoria_id
      ) {
        // não acontece: o Object.assign já trocou; recolocar abaixo
      }
      // Recoloca por categoria_id (no fim da nova).
      for (const c of servidor.categorias) c.produtos = c.produtos.filter((p) => p.id !== id);
      servidor.categorias.find((c) => c.id === atual.categoria_id)?.produtos.push(atual);
      await json(rota, 200, atual);
      return;
    }

    if (metodo === "POST" && caminho === "/gestao/produtos") {
      const novo = corpo as {
        categoria_id: number;
        nome: string;
        descricao?: string;
        preco_cent: number;
        disponivel: boolean;
      };
      const criado = {
        id: Math.max(0, ...produtos.map((p) => p.id)) + 1,
        categoria_id: novo.categoria_id,
        nome: novo.nome,
        descricao: novo.descricao ?? null,
        preco_cent: novo.preco_cent,
        disponivel: novo.disponivel,
      };
      servidor.categorias.find((c) => c.id === novo.categoria_id)?.produtos.push(criado);
      await json(rota, 201, criado);
      return;
    }

    const ordem = /^\/gestao\/categorias\/(\d+)\/produtos\/ordem$/.exec(caminho);
    if (metodo === "PUT" && ordem !== null) {
      const categoria = servidor.categorias.find((c) => c.id === Number(ordem[1]));
      const ids = (corpo as { ids: number[] }).ids;
      if (categoria === undefined) {
        await json(rota, 404, { erro: "categoria_inexistente", mensagem: "x" });
        return;
      }
      const atuais = categoria.produtos.map((p) => p.id).sort((a, b) => a - b);
      if (JSON.stringify([...ids].sort((a, b) => a - b)) !== JSON.stringify(atuais)) {
        await json(rota, 409, { erro: "lista_desatualizada", mensagem: "x" });
        return;
      }
      categoria.produtos = ids.map((id) => categoria.produtos.find((p) => p.id === id)!);
      await json(rota, 204);
      return;
    }

    await json(rota, 404, { erro: "nao_encontrado", mensagem: "x" });
  });

  return servidor;
}
