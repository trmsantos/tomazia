// @vitest-environment node
/**
 * F4-05b — `GET /gestao/clientes` e `DELETE /gestao/clientes/{id}`, por cima do cliente.
 *
 * Contrato (`src/lib/api/gestao-clientes.ts`; o CSV tem o seu ficheiro de testes,
 * `gestao-clientes-csv.test.ts`):
 *
 * ```ts
 * export type ClienteGestao, RespostaClientes;                           // do esquema gerado
 * export function obterClientes(opcoes?): Promise<RespostaClientes>;      // GET    /api/gestao/clientes
 * export function eliminarCliente(id: number, opcoes?): Promise<void>;    // DELETE /api/gestao/clientes/{id}
 * ```
 *
 * `obterClientes` **recusa** um 200 que não sabe ler com `ErroDaApi` de estado 200 (uma lista que
 * não é lista, um cliente sem nome/email, uma `consentimento_em` que o `Date` não lê): o ecrã
 * mostra o erro de carregar e **nunca** «não há clientes» (regra 10). `[]` de um 200 válido é a
 * lista vazia normal.
 *
 * `eliminarCliente` resolve **só** num `204`; **nunca repete** (um `DELETE` sem resposta é «não
 * sei»: repetir é decisão do dono). O `404` chega como `ErroDaApi` com `estado: 404` **e o
 * `codigo` tal como veio** (`cliente_inexistente` ou `null`): quem decide se um `404` é «já não
 * existia» é o ecrã, e só com o código certo. Um `id` que não seja inteiro positivo lança
 * `RangeError` **antes** de qualquer pedido (nada de `../` nem `NaN` num endereço).
 *
 * **Deixa passar:** o `fetch` a sério (corre com um `fetch` falso).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { clienteDeTeste, clientesDeTeste } from "../../testes/clientes-dados";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoClientes from "./gestao-clientes";

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

describe("a superfície de gestao-clientes.ts", () => {
  it("exporta obterClientes, eliminarCliente e descarregarClientesCsv", () => {
    for (const nome of ["obterClientes", "eliminarCliente", "descarregarClientesCsv"] as const) {
      expect(typeof gestaoClientes[nome], nome).toBe("function");
    }
  });
});

describe("obterClientes", () => {
  it("GET /api/gestao/clientes, com X-Tomazia, credenciais e o sinal; devolve a lista tal como vem", async () => {
    const corpo = { clientes: clientesDeTeste() };
    const pedidos = instalar(() => respostaJson(corpo));
    const controlador = new AbortController();

    const resultado = await gestaoClientes.obterClientes({ sinal: controlador.signal });

    expect(resultado).toEqual(corpo);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/clientes`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("não acrescenta nada ao endereço (sem pesquisa, sem query) nem manda corpo", async () => {
    const pedidos = instalar(() => respostaJson({ clientes: [] }));
    await gestaoClientes.obterClientes();
    expect(pedidos[0]?.url).not.toMatch(/[?#]/);
    expect(pedidos[0]?.opcoes?.body).toBeUndefined();
  });

  it("aceita a lista vazia (um 200 normal) e o telemóvel a `null`", async () => {
    instalar(() => respostaJson({ clientes: [] }));
    expect((await gestaoClientes.obterClientes()).clientes).toEqual([]);

    const sem = clienteDeTeste({ id: 1, telemovel: null });
    instalar(() => respostaJson({ clientes: [sem] }));
    expect((await gestaoClientes.obterClientes()).clientes[0]?.telemovel).toBeNull();
  });

  const BOM = clienteDeTeste({ id: 1 });
  it.each([
    ["não é um objeto (lista)", []],
    ["não é um objeto (texto)", "x"],
    ["não é um objeto (null)", null],
    ["falta `clientes`", {}],
    ["`clientes` não é lista (objeto)", { clientes: {} }],
    ["`clientes` não é lista (texto)", { clientes: "x" }],
    ["`clientes` null", { clientes: null }],
    ["um elemento é `null`", { clientes: [null] }],
    ["um elemento é um texto", { clientes: ["x"] }],
    ["`id` é texto", { clientes: [{ ...BOM, id: "1" }] }],
    ["falta `nome`", { clientes: [{ ...BOM, nome: undefined }] }],
    ["`nome` é número", { clientes: [{ ...BOM, nome: 7 }] }],
    ["falta `email`", { clientes: [{ ...BOM, email: undefined }] }],
    ["`email` é número", { clientes: [{ ...BOM, email: 7 }] }],
    ["`telemovel` é número", { clientes: [{ ...BOM, telemovel: 912345678 }] }],
    ["falta `consentimento_em`", { clientes: [{ ...BOM, consentimento_em: undefined }] }],
    ["`consentimento_em` ilegível (texto)", { clientes: [{ ...BOM, consentimento_em: "ontem" }] }],
    ["`consentimento_em` vazio", { clientes: [{ ...BOM, consentimento_em: "" }] }],
    ["`consentimento_em` é número", { clientes: [{ ...BOM, consentimento_em: 1762380000 }] }],
    ["`consentimento_em` null", { clientes: [{ ...BOM, consentimento_em: null }] }],
    [
      "um só mau no meio de bons",
      { clientes: [BOM, { ...BOM, id: 2, consentimento_em: "x" }, BOM] },
    ],
  ])(
    "200 com um corpo ilegível (%s): ErroDaApi de estado 200, nunca a lista vazia",
    async (_nome, corpo) => {
      const pedidos = instalar(() => respostaJson(corpo));

      const erro = await falhaDe(gestaoClientes.obterClientes());

      expect(erro.estado).toBe(200);
      expect(erro.codigo).toBeNull();
      expect(pedidos, "não repete o pedido").toHaveLength(1);
    },
  );

  it("um 200 que não é JSON é ErroDaApi, não SyntaxError", async () => {
    instalar(() => respostaDe(200, "<html>x</html>"));
    expect((await falhaDe(gestaoClientes.obterClientes())).estado).toBe(200);
  });

  it("rede em baixo e prazo esgotado: estado null", async () => {
    instalar(rede);
    expect((await falhaDe(gestaoClientes.obterClientes())).estado).toBeNull();
    instalar(() => {
      throw new DOMException("O pedido demorou demasiado.", "TimeoutError");
    });
    expect((await falhaDe(gestaoClientes.obterClientes())).estado).toBeNull();
  });

  it.each([401, 403, 500, 503])(
    "%i: ErroDaApi com esse estado, nunca uma lista (vazia ou não)",
    async (estado) => {
      const pedidos = instalar(() =>
        respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "m" })),
      );
      const erro = await falhaDe(gestaoClientes.obterClientes());
      expect(erro.estado).toBe(estado);
      expect(pedidos).toHaveLength(1);
    },
  );

  it("cancelado: sai o erro original, que NÃO é um ErroDaApi", async () => {
    const controlador = new AbortController();
    instalar(() => {
      controlador.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    let apanhado: unknown;
    try {
      await gestaoClientes.obterClientes({ sinal: controlador.signal });
    } catch (erro) {
      apanhado = erro;
    }
    expect(apanhado).toBeInstanceOf(Error);
    expect(apanhado).not.toBeInstanceOf(ErroDaApi);
  });
});

describe("eliminarCliente", () => {
  it("DELETE /api/gestao/clientes/{id}, sem corpo, com X-Tomazia, credenciais e o sinal; um 204 resolve (sem valor)", async () => {
    const pedidos = instalar(() => respostaDe(204, ""));
    const controlador = new AbortController();

    const resultado = await gestaoClientes.eliminarCliente(101, { sinal: controlador.signal });

    expect(resultado).toBeUndefined();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/clientes/101`);
    expect(pedidos[0]?.opcoes?.method).toBe("DELETE");
    expect(pedidos[0]?.opcoes?.body).toBeUndefined();
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("404 cliente_inexistente: ErroDaApi com estado 404 E o código, tal como veio (o ecrã é que decide)", async () => {
    instalar(() =>
      respostaDe(404, JSON.stringify({ erro: "cliente_inexistente", mensagem: "Não existe." })),
    );
    const erro = await falhaDe(gestaoClientes.eliminarCliente(101));
    expect(erro.estado).toBe(404);
    expect(erro.codigo).toBe("cliente_inexistente");
  });

  it("404 SEM o código (um proxy, um Apache): ErroDaApi com estado 404 e código null (não é «já não existia»)", async () => {
    instalar(() => respostaDe(404, "<html>Not Found</html>"));
    const erro = await falhaDe(gestaoClientes.eliminarCliente(101));
    expect(erro.estado).toBe(404);
    expect(erro.codigo).toBeNull();
  });

  it.each([401, 403, 422, 500, 503])(
    "%i: ErroDaApi com esse estado e o pedido NÃO se repete",
    async (estado) => {
      const pedidos = instalar(() =>
        respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "m" })),
      );
      const erro = await falhaDe(gestaoClientes.eliminarCliente(101));
      expect(erro.estado).toBe(estado);
      expect(pedidos).toHaveLength(1);
    },
  );

  it("rede em baixo ou prazo: estado null («não sei se foi eliminado»), e UM só pedido", async () => {
    const pedidos = instalar(rede);
    expect((await falhaDe(gestaoClientes.eliminarCliente(101))).estado).toBeNull();
    expect(pedidos).toHaveLength(1);

    const outros = instalar(() => {
      throw new DOMException("O pedido demorou demasiado.", "TimeoutError");
    });
    expect((await falhaDe(gestaoClientes.eliminarCliente(101))).estado).toBeNull();
    expect(outros).toHaveLength(1);
  });

  it("cancelado: sai o erro original, que NÃO é um ErroDaApi", async () => {
    const controlador = new AbortController();
    instalar(() => {
      controlador.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    let apanhado: unknown;
    try {
      await gestaoClientes.eliminarCliente(101, { sinal: controlador.signal });
    } catch (erro) {
      apanhado = erro;
    }
    expect(apanhado).toBeInstanceOf(Error);
    expect(apanhado).not.toBeInstanceOf(ErroDaApi);
  });

  it.each([
    ["zero", 0],
    ["negativo", -1],
    ["fracionário", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["texto", "1/../2"],
    ["texto numérico", "101"],
    ["undefined", undefined],
    ["null", null],
  ])("o id %s lança RangeError ANTES de qualquer pedido", async (_nome, id) => {
    const pedidos = instalar(() => respostaDe(204, ""));
    let apanhado: unknown;
    try {
      await gestaoClientes.eliminarCliente(id as unknown as number);
    } catch (erro) {
      apanhado = erro;
    }
    expect(apanhado).toBeInstanceOf(RangeError);
    expect(pedidos).toHaveLength(0);
  });
});
