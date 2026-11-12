/**
 * F4-01 — as três funções de `src/lib/api/auth.ts`, por cima do cliente.
 *
 * Contrato que este ficheiro define:
 *
 * ```ts
 * export type Sessao = { id: number; utilizador: string };   // do OpenAPI gerado
 * export function entrar(
 *   dados: { utilizador: string; password: string },
 *   opcoes?: OpcoesDePedido,
 * ): Promise<Sessao>;                                        // POST /auth/login
 * export function quemSouEu(opcoes?: OpcoesDePedido): Promise<Sessao>;  // GET /auth/eu
 * export function sair(opcoes?: OpcoesDePedido): Promise<void>;         // POST /auth/logout
 * ```
 *
 * **`sair` resolve com um 204 sem corpo.** O `pedir` de hoje trata um 2xx cujo
 * corpo não é JSON como erro («o conteúdo não era JSON»), e um 204 tem o corpo
 * vazio por definição — por isso ou o `pedir` aprende o 204, ou `sair` não passa
 * por ele. O teste não escolhe: só exige que o 204 resolva e que o pedido leve o
 * que todos levam (`X-Tomazia`, credenciais, URL relativa). Sem isto, o primeiro
 * «Sair» do dono seria um erro a seguir a uma sessão fechada com sucesso.
 *
 * **O `Retry-After` chega ao chamador.** O `ErroDaApi` já expõe `cabecalhos`
 * (F3-05); o teste do 429 fixa que `entrar` não os perde pelo caminho.
 *
 * **O que prova:** método, caminho, corpo e cabeçalhos de cada função; o que
 * sai de cada falha (`estado`, `codigo`, `extra`, `cabecalhos`); o cancelamento.
 * **O que deixa passar:** o `fetch` real — corre com um fetch falso.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as auth from "./auth";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";

afterEach(() => {
  vi.unstubAllGlobals();
});

const FRASE_400 = "Utilizador ou password inválidos. Confirma os dois e tenta novamente.";
const FRASE_429 = "A conta está bloqueada por causa de várias tentativas falhadas.";

function instalar(responder: Parameters<typeof criarFetchFalso>[0]) {
  const { falso, pedidos } = criarFetchFalso(responder);
  vi.stubGlobal("fetch", falso);
  return pedidos;
}

async function falhaDe(promessa: Promise<unknown>): Promise<ErroDaApi> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDaApi) return erro;
    throw erro;
  }
  throw new Error("esperava uma falha e o pedido resolveu");
}

describe("a superfície de auth.ts", () => {
  it("exporta exatamente entrar, quemSouEu e sair", () => {
    expect(Object.keys(auth).sort()).toEqual(["entrar", "quemSouEu", "sair"]);
  });

  it("as três passam pelo cliente: X-Tomazia, credenciais e URL relativa", async () => {
    const pedidos = instalar((pedido) =>
      pedido.url.endsWith("/auth/logout")
        ? respostaDe(204, "")
        : respostaJson({ id: 1, utilizador: "dono" }),
    );

    await auth.entrar({ utilizador: "dono", password: "segredo-de-teste" });
    await auth.quemSouEu();
    await auth.sair();

    expect(pedidos).toHaveLength(3);
    for (const pedido of pedidos) {
      expect(pedido.cabecalhos["x-tomazia"]).toBe("1");
      expect(pedido.opcoes?.credentials).toBe("include");
      expect(pedido.url.startsWith(`${CAMINHO_BASE}/auth/`)).toBe(true);
    }
  });
});

describe("entrar", () => {
  it("faz POST /auth/login com o utilizador e a password em JSON, tal como escritos", async () => {
    const pedidos = instalar(() => respostaJson({ id: 1, utilizador: "dono" }));

    const sessao = await auth.entrar({ utilizador: " dono ", password: " segredo de teste " });

    expect(sessao).toEqual({ id: 1, utilizador: "dono" });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/auth/login`);
    expect(pedidos[0]?.opcoes?.method).toBe("POST");
    expect(pedidos[0]?.cabecalhos["content-type"]).toBe("application/json");
    expect(JSON.parse(String(pedidos[0]?.opcoes?.body))).toEqual({
      utilizador: " dono ",
      password: " segredo de teste ",
    });
  });

  it("a password nunca vai no endereço", async () => {
    const pedidos = instalar(() => respostaJson({ id: 1, utilizador: "dono" }));
    await auth.entrar({ utilizador: "dono", password: "segredo-de-teste" });
    expect(pedidos[0]?.url).not.toContain("segredo-de-teste");
  });

  it("400: ErroDaApi com estado 400, o codigo e a mensagem do backend, verbatim", async () => {
    instalar(() =>
      respostaDe(400, JSON.stringify({ erro: "credenciais_invalidas", mensagem: FRASE_400 })),
    );

    const erro = await falhaDe(auth.entrar({ utilizador: "dono", password: "errada" }));

    expect(erro.estado).toBe(400);
    expect(erro.codigo).toBe("credenciais_invalidas");
    expect(erro.message).toBe(FRASE_400);
  });

  it("429: segundos_em_falta em extra e o Retry-After em cabecalhos", async () => {
    instalar(() =>
      respostaDe(
        429,
        JSON.stringify({ erro: "conta_bloqueada", mensagem: FRASE_429, segundos_em_falta: 125 }),
        { "Retry-After": "127" },
      ),
    );

    const erro = await falhaDe(auth.entrar({ utilizador: "dono", password: "errada" }));

    expect(erro.estado).toBe(429);
    expect(erro.codigo).toBe("conta_bloqueada");
    expect(erro.message).toBe(FRASE_429);
    expect(erro.extra.segundos_em_falta).toBe(125);
    expect(erro.cabecalhos["retry-after"]).toBe("127");
  });

  it("sem resposta (rede): estado null, não um 4xx", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });

    const erro = await falhaDe(auth.entrar({ utilizador: "dono", password: "x" }));
    expect(erro.estado).toBeNull();
  });

  it("o sinal de cancelamento chega ao pedido", async () => {
    const pedidos = instalar(() => respostaJson({ id: 1, utilizador: "dono" }));
    const controlador = new AbortController();

    await auth.entrar({ utilizador: "dono", password: "x" }, { sinal: controlador.signal });

    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });
});

describe("quemSouEu", () => {
  it("faz GET /auth/eu e devolve a sessão", async () => {
    const pedidos = instalar(() => respostaJson({ id: 7, utilizador: "dono" }));

    await expect(auth.quemSouEu()).resolves.toEqual({ id: 7, utilizador: "dono" });

    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/auth/eu`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.opcoes?.body ?? undefined).toBeUndefined();
  });

  it("401: ErroDaApi com estado 401 e codigo sessao_em_falta", async () => {
    instalar(() =>
      respostaDe(401, JSON.stringify({ erro: "sessao_em_falta", mensagem: "Precisas de entrar." })),
    );

    const erro = await falhaDe(auth.quemSouEu());

    expect(erro.estado).toBe(401);
    expect(erro.codigo).toBe("sessao_em_falta");
  });

  it("204 vazio (um proxy a meio): rejeita, nunca resolve como sessão confirmada", async () => {
    instalar(() => respostaDe(204, ""));

    const erro = await falhaDe(auth.quemSouEu());

    expect(erro.estado).toBe(204);
  });

  it("sem resposta: estado null — nunca confundível com o 401 (regra 10)", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });

    const erro = await falhaDe(auth.quemSouEu());
    expect(erro.estado).toBeNull();
  });

  it("o sinal de cancelamento chega ao pedido", async () => {
    const pedidos = instalar(() => respostaJson({ id: 1, utilizador: "dono" }));
    const controlador = new AbortController();

    await auth.quemSouEu({ sinal: controlador.signal });

    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });
});

describe("sair", () => {
  it("faz POST /auth/logout, sem corpo, e resolve com o 204 vazio", async () => {
    const pedidos = instalar(() => respostaDe(204, ""));

    await expect(auth.sair()).resolves.toBeUndefined();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/auth/logout`);
    expect(pedidos[0]?.opcoes?.method).toBe("POST");
    expect(pedidos[0]?.opcoes?.body ?? undefined).toBeUndefined();
  });

  it("500: ErroDaApi com estado 500 — nunca finge que a sessão fechou", async () => {
    instalar(() => respostaDe(500, "<html>Erro</html>"));

    const erro = await falhaDe(auth.sair());

    expect(erro.estado).toBe(500);
  });

  it("sem resposta: ErroDaApi com estado null", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });

    const erro = await falhaDe(auth.sair());
    expect(erro.estado).toBeNull();
  });
});
