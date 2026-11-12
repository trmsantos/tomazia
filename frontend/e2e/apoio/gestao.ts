import type { Page, Route } from "@playwright/test";

import { FRASE_400, FRASE_429, SESSAO_DE_TESTE } from "../../src/testes/gestao";

/**
 * A API de sessão fingida (F4-01): `page.route`, sem backend. O que se testa
 * aqui é o ecrã, não o servidor.
 *
 * `sessaoAberta` é o estado do «servidor»: o `GET /auth/eu` responde 200 ou 401
 * conforme ele, o login certo abre-a e o logout fecha-a — para o teste de
 * «Voltar depois de sair» ver a mesma coisa que veria com o backend a sério.
 */
export type ServidorFingido = {
  sessaoAberta: boolean;
  /** As respostas do próximo `POST /auth/login`, por ordem. Acabadas, entra-se. */
  respostasDoLogin: Array<{ estado: number; corpo: unknown; cabecalhos?: Record<string, string> }>;
  pedidosAoChunkDaGestao: string[];
};

export const RESPOSTA_400 = {
  estado: 400,
  corpo: { erro: "credenciais_invalidas", mensagem: FRASE_400 },
};

export function resposta429(segundos: number) {
  return {
    estado: 429,
    corpo: { erro: "conta_bloqueada", mensagem: FRASE_429, segundos_em_falta: segundos },
    cabecalhos: { "Retry-After": String(segundos) },
  };
}

async function responder(
  rota: Route,
  estado: number,
  corpo: unknown,
  cabecalhos: Record<string, string> = {},
): Promise<void> {
  await rota.fulfill({
    status: estado,
    contentType: "application/json",
    headers: cabecalhos,
    body: JSON.stringify(corpo),
  });
}

export async function fingirApiDeSessao(
  pagina: Page,
  inicial: Partial<ServidorFingido> = {},
): Promise<ServidorFingido> {
  const servidor: ServidorFingido = {
    sessaoAberta: false,
    respostasDoLogin: [],
    pedidosAoChunkDaGestao: [],
    ...inicial,
  };

  await pagina.route("**/api/auth/eu", async (rota) => {
    if (servidor.sessaoAberta) await responder(rota, 200, SESSAO_DE_TESTE);
    else await responder(rota, 401, { erro: "sessao_em_falta", mensagem: "Precisas de entrar." });
  });

  await pagina.route("**/api/auth/login", async (rota) => {
    const seguinte = servidor.respostasDoLogin.shift();
    if (seguinte === undefined) {
      servidor.sessaoAberta = true;
      await responder(rota, 200, SESSAO_DE_TESTE);
      return;
    }
    await responder(rota, seguinte.estado, seguinte.corpo, seguinte.cabecalhos);
  });

  await pagina.route("**/api/auth/logout", async (rota) => {
    servidor.sessaoAberta = false;
    await rota.fulfill({ status: 204 });
  });

  // Os ficheiros da gestão, para provar que o público nunca os pede. No servidor
  // de desenvolvimento o módulo chama-se `…/pages/gestao/AppGestao.tsx`.
  pagina.on("request", (pedido) => {
    if (/\/pages\/gestao\//.test(pedido.url()) || /AppGestao/.test(pedido.url())) {
      servidor.pedidosAoChunkDaGestao.push(pedido.url());
    }
  });

  return servidor;
}
