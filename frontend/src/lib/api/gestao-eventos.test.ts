/**
 * F4-03 — o módulo da API dos eventos de gestão, por cima do cliente.
 *
 * Contrato (`src/lib/api/gestao-eventos.ts`, plano 2.3, com o aviso do coordenador sobre
 * as semanas):
 *
 * ```ts
 * export type EventoGestao, EventosGestao, NovoEvento, AlteracaoDeEvento;
 * export function obterEventosGestao(opcoes?): Promise<EventosGestao>;                 // GET    /gestao/eventos
 * export function criarEvento(novo: NovoEvento, opcoes?): Promise<EventoGestao>;       // POST   /gestao/eventos
 * export function alterarEvento(id, alteracao: AlteracaoDeEvento, opcoes?): Promise<EventoGestao>; // PATCH /gestao/eventos/{id}
 * export function eliminarEvento(id, opcoes?): Promise<void>;                          // DELETE /gestao/eventos/{id}
 * export function duplicarEvento(id, semanas: 1 | 2 | 3 | 4 | null, opcoes?): Promise<EventoGestao>; // POST …/duplicar
 * ```
 *
 * `duplicarEvento` leva `{ semanas }` no corpo quando há número; com `null`, **nenhum
 * corpo** (o original sem data duplica-se sem escolher). **A superfície é exatamente
 * estas cinco funções.** Os erros chegam como `ErroDaApi`; `estado === null` é «não houve
 * resposta» e este módulo **nunca repete** um pedido (um `POST` repetido duplicava).
 *
 * **Deixa passar:** o `fetch` a sério — corre com um fetch falso.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventoDeTeste, eventosDeGestaoDeTeste } from "../../testes/gestao";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoEventos from "./gestao-eventos";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function corpoDe(pedido: { opcoes: RequestInit | undefined } | undefined): unknown {
  const corpo = pedido?.opcoes?.body;
  if (typeof corpo !== "string") throw new Error("o pedido não levou corpo JSON");
  return JSON.parse(corpo);
}

describe("a superfície de gestao-eventos.ts", () => {
  it("exporta exatamente as cinco funções", () => {
    expect(Object.keys(gestaoEventos).sort()).toEqual([
      "alterarEvento",
      "criarEvento",
      "duplicarEvento",
      "eliminarEvento",
      "obterEventosGestao",
    ]);
  });
});

describe("obterEventosGestao", () => {
  it("GET /api/gestao/eventos, com X-Tomazia, credenciais e a resposta tal como vem", async () => {
    const lista = eventosDeGestaoDeTeste();
    const pedidos = instalar(() => respostaJson(lista));
    const controlador = new AbortController();

    const resultado = await gestaoEventos.obterEventosGestao({ sinal: controlador.signal });

    expect(resultado).toEqual(lista);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/eventos`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("aceita as três listas vazias e um rascunho com `inicio: null`", async () => {
    instalar(() =>
      respostaJson({
        proximos: [],
        arquivo: [],
        rascunhos: [eventoDeTeste({ id: 1, inicio: null, publicado: false })],
      }),
    );
    const r = await gestaoEventos.obterEventosGestao();
    expect(r.rascunhos[0]?.inicio).toBeNull();
  });

  const BOM = eventoDeTeste({ id: 1 });
  it.each([
    ["não é um objeto (lista)", []],
    ["não é um objeto (texto)", "x"],
    ["falta a lista `arquivo`", { proximos: [], rascunhos: [] }],
    ["uma lista não é lista", { proximos: {}, rascunhos: [], arquivo: [] }],
    [
      "`inicio` é número",
      { proximos: [{ ...BOM, inicio: 1762380000 }], rascunhos: [], arquivo: [] },
    ],
    [
      "`inicio` não se lê",
      { proximos: [{ ...BOM, inicio: "ontem à noite" }], rascunhos: [], arquivo: [] },
    ],
    [
      "`publicado` é texto",
      { proximos: [{ ...BOM, publicado: "sim" }], rascunhos: [], arquivo: [] },
    ],
    ["`id` é texto", { proximos: [{ ...BOM, id: "1" }], rascunhos: [], arquivo: [] }],
    ["`titulo` é número", { proximos: [], rascunhos: [], arquivo: [{ ...BOM, titulo: 7 }] }],
    ["um elemento é `null`", { proximos: [null], rascunhos: [], arquivo: [] }],
  ])(
    "recusa um 200 ilegível (%s) com ErroDaApi de estado 200 — nunca «não há eventos»",
    async (_n, corpo) => {
      instalar(() => respostaJson(corpo));
      const erro = await falhaDe(gestaoEventos.obterEventosGestao());
      expect(erro.estado).toBe(200);
    },
  );

  it("sem resposta: ErroDaApi com estado null; 401 e 500 chegam com o seu estado", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await falhaDe(gestaoEventos.obterEventosGestao())).estado).toBeNull();

    for (const estado of [401, 500]) {
      instalar(() => respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })));
      expect((await falhaDe(gestaoEventos.obterEventosGestao())).estado).toBe(estado);
    }
  });
});

describe("criarEvento", () => {
  it("POST /api/gestao/eventos, JSON, X-Tomazia, credenciais; devolve o evento", async () => {
    const criado = eventoDeTeste({ id: 5, titulo: "Fado" });
    const pedidos = instalar(() => respostaJson(criado, 201));

    const r = await gestaoEventos.criarEvento({
      titulo: "Fado",
      inicio: "2026-11-20T22:00:00Z",
      descricao: "Uma noite.",
      publicado: true,
    });

    expect(r).toEqual(criado);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/eventos`);
    expect(pedidos[0]?.opcoes?.method).toBe("POST");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.cabecalhos["content-type"]).toBe("application/json");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(corpoDe(pedidos[0])).toEqual({
      titulo: "Fado",
      inicio: "2026-11-20T22:00:00Z",
      descricao: "Uma noite.",
      publicado: true,
    });
  });

  it.each([undefined, null, ""])("a descrição %j omite-se do corpo", async (descricao) => {
    const pedidos = instalar(() => respostaJson(eventoDeTeste({ id: 5 }), 201));
    await gestaoEventos.criarEvento({
      titulo: "Fado",
      inicio: "2026-11-20T22:00:00Z",
      descricao,
      publicado: false,
    });
    expect("descricao" in (corpoDe(pedidos[0]) as object)).toBe(false);
    expect(corpoDe(pedidos[0])).toEqual({
      titulo: "Fado",
      inicio: "2026-11-20T22:00:00Z",
      publicado: false,
    });
  });

  it("422 traz o `campo` em extra; sem resposta é estado null e nunca se repete", async () => {
    instalar(() =>
      respostaDe(422, JSON.stringify({ erro: "dados_invalidos", mensagem: "x", campo: "titulo" })),
    );
    const erro = await falhaDe(
      gestaoEventos.criarEvento({ titulo: "", inicio: "2026-11-20T22:00:00Z", publicado: false }),
    );
    expect(erro.estado).toBe(422);
    expect(erro.extra.campo).toBe("titulo");

    const pedidos = instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    const semResposta = await falhaDe(
      gestaoEventos.criarEvento({ titulo: "a", inicio: "2026-11-20T22:00:00Z", publicado: false }),
    );
    expect(semResposta.estado).toBeNull();
    expect(pedidos, "um POST repetido criava o evento duas vezes").toHaveLength(1);
  });
});

describe("alterarEvento", () => {
  it("PATCH /api/gestao/eventos/{id} só com as chaves dadas", async () => {
    const pedidos = instalar(() => respostaJson(eventoDeTeste({ id: 31, titulo: "Novo" })));

    await gestaoEventos.alterarEvento(31, { titulo: "Novo" });
    await gestaoEventos.alterarEvento(31, { publicado: false });
    await gestaoEventos.alterarEvento(31, { inicio: "2026-11-20T22:00:00Z", publicado: true });

    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/eventos/31`);
    expect(pedidos[0]?.opcoes?.method).toBe("PATCH");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(corpoDe(pedidos[0])).toEqual({ titulo: "Novo" });
    expect(corpoDe(pedidos[1])).toEqual({ publicado: false });
    expect(corpoDe(pedidos[2])).toEqual({ inicio: "2026-11-20T22:00:00Z", publicado: true });
  });

  it("`null` só passa na `descricao`; nunca `inicio: null`, nunca `imagem`, nunca `undefined`", async () => {
    const pedidos = instalar(() => respostaJson(eventoDeTeste({ id: 1 })));

    await gestaoEventos.alterarEvento(1, { descricao: null });
    await gestaoEventos.alterarEvento(1, {
      titulo: "a",
      inicio: null,
      imagem: "x.png",
      descricao: undefined,
    } as never);

    expect(corpoDe(pedidos[0])).toEqual({ descricao: null });
    expect(corpoDe(pedidos[1])).toEqual({ titulo: "a" });
    expect("imagem" in (corpoDe(pedidos[1]) as object)).toBe(false);
    expect("inicio" in (corpoDe(pedidos[1]) as object)).toBe(false);
  });

  it("404 evento_inexistente e 422 evento_sem_data chegam com o código e o campo", async () => {
    instalar(() => respostaDe(404, JSON.stringify({ erro: "evento_inexistente", mensagem: "x" })));
    expect((await falhaDe(gestaoEventos.alterarEvento(9, { titulo: "a" }))).codigo).toBe(
      "evento_inexistente",
    );

    instalar(() =>
      respostaDe(422, JSON.stringify({ erro: "evento_sem_data", mensagem: "x", campo: "inicio" })),
    );
    const erro = await falhaDe(gestaoEventos.alterarEvento(9, { publicado: true }));
    expect(erro.estado).toBe(422);
    expect(erro.codigo).toBe("evento_sem_data");
    expect(erro.extra.campo).toBe("inicio");
  });

  it("sem resposta: estado null, um só pedido", async () => {
    const pedidos = instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await falhaDe(gestaoEventos.alterarEvento(1, { titulo: "a" }))).estado).toBeNull();
    expect(pedidos).toHaveLength(1);
  });
});

describe("eliminarEvento", () => {
  it("DELETE /api/gestao/eventos/{id}, 204 sem corpo", async () => {
    const pedidos = instalar(() => respostaDe(204, ""));
    const r = await gestaoEventos.eliminarEvento(31);
    expect(r).toBeUndefined();
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/eventos/31`);
    expect(pedidos[0]?.opcoes?.method).toBe("DELETE");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
  });

  it("404, 401, 500 e rede chegam como ErroDaApi", async () => {
    instalar(() => respostaDe(404, JSON.stringify({ erro: "evento_inexistente", mensagem: "x" })));
    const e404 = await falhaDe(gestaoEventos.eliminarEvento(1));
    expect([e404.estado, e404.codigo]).toEqual([404, "evento_inexistente"]);

    for (const estado of [401, 500]) {
      instalar(() => respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })));
      expect((await falhaDe(gestaoEventos.eliminarEvento(1))).estado).toBe(estado);
    }

    instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await falhaDe(gestaoEventos.eliminarEvento(1))).estado).toBeNull();
  });
});

describe("duplicarEvento", () => {
  it("POST /api/gestao/eventos/{id}/duplicar com {semanas} no corpo", async () => {
    const copia = eventoDeTeste({ id: 40, publicado: false });
    const pedidos = instalar(() => respostaJson(copia, 201));

    const r = await gestaoEventos.duplicarEvento(31, 2);

    expect(r).toEqual(copia);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/eventos/31/duplicar`);
    expect(pedidos[0]?.opcoes?.method).toBe("POST");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(corpoDe(pedidos[0])).toEqual({ semanas: 2 });
  });

  it("com `semanas` a `null` (original sem data) não leva corpo nenhum", async () => {
    const pedidos = instalar(() => respostaJson(eventoDeTeste({ id: 40, publicado: false }), 201));
    await gestaoEventos.duplicarEvento(22, null);
    expect(pedidos[0]?.opcoes?.body ?? null).toBeNull();
  });

  it("404, 422 (data fora do intervalo), 401, 500; rede com estado null e um só pedido", async () => {
    instalar(() => respostaDe(404, JSON.stringify({ erro: "evento_inexistente", mensagem: "x" })));
    expect((await falhaDe(gestaoEventos.duplicarEvento(1, 1))).codigo).toBe("evento_inexistente");

    instalar(() => respostaDe(422, JSON.stringify({ erro: "dados_invalidos", mensagem: "x" })));
    expect((await falhaDe(gestaoEventos.duplicarEvento(1, 1))).estado).toBe(422);

    for (const estado of [401, 500]) {
      instalar(() => respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })));
      expect((await falhaDe(gestaoEventos.duplicarEvento(1, 1))).estado).toBe(estado);
    }

    const pedidos = instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await falhaDe(gestaoEventos.duplicarEvento(1, 1))).estado).toBeNull();
    expect(pedidos, "um POST repetido criava duas cópias").toHaveLength(1);
  });
});
