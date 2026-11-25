// @vitest-environment node
/**
 * F4-05b — `GET /gestao/resumo`, por cima do cliente.
 *
 * Contrato (`src/lib/api/gestao-resumo.ts`):
 *
 * ```ts
 * export type Resumo = components["schemas"]["RespostaResumo"];
 * export function obterResumo(opcoes?: OpcoesDePedido): Promise<Resumo>;   // GET /api/gestao/resumo
 * ```
 *
 * Regra 10 em cada linha: **só** um `200` com o corpo válido resolve. Um corpo que não se sabe ler
 * (`fotos_pendentes`/`novos_registos` que não sejam inteiros não negativos, eventos que não são
 * lista ou sem data legível) lança `ErroDaApi` de **estado 200** — nunca resolve com zeros nem com
 * «não há nada». Rede e prazo: `estado === null`; 401 e 5xx passam com o seu estado; o
 * cancelamento sai cru (não é `ErroDaApi`). Nunca repete o pedido.
 *
 * **Deixa passar:** o `fetch` a sério (corre com um `fetch` falso).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventosDoResumo, resumoDeTeste, resumoVazio } from "../../testes/clientes-dados";
import { eventoDeTeste } from "../../testes/gestao";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoResumo from "./gestao-resumo";

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

function rede(): never {
  throw new TypeError("Failed to fetch");
}

describe("obterResumo", () => {
  it("existe", () => {
    expect(typeof gestaoResumo.obterResumo).toBe("function");
  });

  it("GET /api/gestao/resumo com X-Tomazia, credenciais e o sinal; devolve o resumo tal como vem", async () => {
    const corpo = resumoDeTeste();
    const pedidos = instalar(() => respostaJson(corpo));
    const controlador = new AbortController();

    const resultado = await gestaoResumo.obterResumo({ sinal: controlador.signal });

    expect(resultado).toEqual(corpo);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/resumo`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("os zeros e a lista vazia, vindos de um 200 válido, são um resumo normal (a instalação nova)", async () => {
    instalar(() => respostaJson(resumoVazio()));
    expect(await gestaoResumo.obterResumo()).toEqual(resumoVazio());
  });

  it("aceita contagens grandes (10 000 ou mais não se esperam, mas escrevem-se tal qual)", async () => {
    instalar(() =>
      respostaJson(resumoDeTeste({ fotos_pendentes: 12_345, novos_registos: 10_000 })),
    );
    const r = await gestaoResumo.obterResumo();
    expect(r.fotos_pendentes).toBe(12_345);
    expect(r.novos_registos).toBe(10_000);
  });

  const BOM_RESUMO = resumoDeTeste();
  const SEM_DATA = eventoDeTeste({ id: 9, inicio: null });
  it.each([
    ["não é um objeto (lista)", []],
    ["não é um objeto (texto)", "x"],
    ["não é um objeto (null)", null],
    ["falta `fotos_pendentes`", { proximos_eventos: [], novos_registos: 0 }],
    ["falta `novos_registos`", { fotos_pendentes: 0, proximos_eventos: [] }],
    ["falta `proximos_eventos`", { fotos_pendentes: 0, novos_registos: 0 }],
    ["`fotos_pendentes` negativo", { ...BOM_RESUMO, fotos_pendentes: -1 }],
    ["`fotos_pendentes` fracionário", { ...BOM_RESUMO, fotos_pendentes: 1.5 }],
    ["`fotos_pendentes` em texto", { ...BOM_RESUMO, fotos_pendentes: "3" }],
    ["`fotos_pendentes` null", { ...BOM_RESUMO, fotos_pendentes: null }],
    ["`fotos_pendentes` NaN serializado (null)", { ...BOM_RESUMO, fotos_pendentes: Number.NaN }],
    ["`novos_registos` negativo", { ...BOM_RESUMO, novos_registos: -2 }],
    ["`novos_registos` fracionário", { ...BOM_RESUMO, novos_registos: 0.5 }],
    ["`novos_registos` em texto", { ...BOM_RESUMO, novos_registos: "2" }],
    ["`novos_registos` booleano", { ...BOM_RESUMO, novos_registos: true }],
    ["`proximos_eventos` não é lista (objeto)", { ...BOM_RESUMO, proximos_eventos: {} }],
    ["`proximos_eventos` não é lista (texto)", { ...BOM_RESUMO, proximos_eventos: "x" }],
    ["um evento é `null`", { ...BOM_RESUMO, proximos_eventos: [null] }],
    ["um evento é um texto", { ...BOM_RESUMO, proximos_eventos: ["x"] }],
    [
      "um evento sem `titulo`",
      { ...BOM_RESUMO, proximos_eventos: [{ id: 1, inicio: "2026-11-05T22:00:00Z" }] },
    ],
    [
      "um evento com `inicio` null (um publicado do resumo tem sempre data)",
      { ...BOM_RESUMO, proximos_eventos: [SEM_DATA] },
    ],
    [
      "um evento com `inicio` ilegível",
      { ...BOM_RESUMO, proximos_eventos: [{ ...eventosDoResumo(1)[0], inicio: "amanhã" }] },
    ],
    [
      "um evento com `inicio` em número",
      { ...BOM_RESUMO, proximos_eventos: [{ ...eventosDoResumo(1)[0], inicio: 1762380000 }] },
    ],
  ])(
    "200 com um corpo ilegível (%s): ErroDaApi de estado 200, nunca zeros nem «nada»",
    async (_nome, corpo) => {
      const pedidos = instalar(() => respostaJson(corpo));

      const erro = await falhaDe(gestaoResumo.obterResumo());

      expect(erro.estado).toBe(200);
      expect(erro.codigo).toBeNull();
      expect(pedidos, "não repete o pedido").toHaveLength(1);
    },
  );

  it("um 200 que não é JSON (a página do Apache) é ErroDaApi, não SyntaxError, nem um resumo", async () => {
    instalar(() => respostaDe(200, "<html>Service Unavailable</html>"));
    const erro = await falhaDe(gestaoResumo.obterResumo());
    expect(erro.estado).toBe(200);
  });

  it("rede em baixo: estado null", async () => {
    instalar(rede);
    const erro = await falhaDe(gestaoResumo.obterResumo());
    expect(erro.estado).toBeNull();
  });

  it("prazo esgotado (TimeoutError): estado null, não um cancelamento", async () => {
    instalar(() => {
      throw new DOMException("O pedido demorou demasiado.", "TimeoutError");
    });
    const erro = await falhaDe(gestaoResumo.obterResumo());
    expect(erro.estado).toBeNull();
  });

  it.each([401, 403, 500, 502, 503])(
    "%i: ErroDaApi com esse estado, nunca um resumo",
    async (estado) => {
      const pedidos = instalar(() =>
        respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "MENSAGEM-DO-BACKEND" })),
      );
      const erro = await falhaDe(gestaoResumo.obterResumo());
      expect(erro.estado).toBe(estado);
      expect(pedidos, "não repete (nem o 401)").toHaveLength(1);
    },
  );

  it("5xx com a página HTML do Apache: ErroDaApi com o estado, sem o corpo na mensagem", async () => {
    instalar(() => respostaDe(503, "<html>SEGREDO-DO-APACHE</html>"));
    const erro = await falhaDe(gestaoResumo.obterResumo());
    expect(erro.estado).toBe(503);
    expect(erro.message).not.toContain("SEGREDO-DO-APACHE");
  });

  it("cancelado ao desmontar: sai o erro original, que NÃO é um ErroDaApi (não é erro de ecrã)", async () => {
    const controlador = new AbortController();
    instalar(() => {
      controlador.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    let apanhado: unknown;
    try {
      await gestaoResumo.obterResumo({ sinal: controlador.signal });
    } catch (erro) {
      apanhado = erro;
    }
    expect(apanhado).toBeInstanceOf(Error);
    expect(apanhado).not.toBeInstanceOf(ErroDaApi);
  });
});
