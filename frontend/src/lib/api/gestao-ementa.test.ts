/**
 * F4-02 — o módulo da API da ementa de gestão, por cima do cliente.
 *
 * Contrato (`src/lib/api/gestao-ementa.ts`):
 *
 * ```ts
 * export function obterEmentaGestao(opcoes?: OpcoesDePedido): Promise<EmentaGestao>;          // GET    /gestao/categorias
 * export function criarProduto(novo: NovoProduto, opcoes?): Promise<ProdutoGestao>;           // POST   /gestao/produtos
 * export function alterarProduto(id: number, alteracao: AlteracaoDeProduto, opcoes?): Promise<ProdutoGestao>; // PATCH /gestao/produtos/{id}
 * export function reordenarProdutos(categoriaId: number, ids: readonly number[], opcoes?): Promise<void>;     // PUT   /gestao/categorias/{id}/produtos/ordem
 * ```
 *
 * **A superfície é exatamente estas quatro.** Categorias (criar, renomear,
 * reordenar, esconder) e eliminar produto são da F4-02b: nem `reordenarCategorias`
 * nem nenhum `DELETE`.
 *
 * O `PATCH` leva **só** as chaves que o chamador deu; `null` só passa na
 * `descricao`. A `descricao` vazia **omite-se** no `POST`. O `PUT` é 204 sem corpo
 * (resolve com `undefined`). Os erros chegam como `ErroDaApi`: 409 com
 * `codigo === "lista_desatualizada"`, 422 com `extra.campo`, rede com `estado === null`.
 *
 * **Deixa passar:** o `fetch` a sério — corre com um fetch falso.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { produtoDeTeste } from "../../testes/gestao";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoEmenta from "./gestao-ementa";

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

describe("a superfície de gestao-ementa.ts", () => {
  it("exporta exatamente as quatro funções (nada de categorias nem de eliminar)", () => {
    expect(Object.keys(gestaoEmenta).sort()).toEqual([
      "alterarProduto",
      "criarProduto",
      "obterEmentaGestao",
      "reordenarProdutos",
    ]);
  });
});

describe("obterEmentaGestao", () => {
  it("GET /api/gestao/categorias, com X-Tomazia, credenciais e a resposta tal como vem", async () => {
    const ementa = {
      categorias: [{ id: 1, nome: "Cafetaria", slug: "cafetaria", visivel: false, produtos: [] }],
    };
    const pedidos = instalar(() => respostaJson(ementa));
    const controlador = new AbortController();

    const resultado = await gestaoEmenta.obterEmentaGestao({ sinal: controlador.signal });

    expect(resultado).toEqual(ementa);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/categorias`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("sem resposta: ErroDaApi com estado null (nunca uma lista vazia — regra 10)", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    const erro = await falhaDe(gestaoEmenta.obterEmentaGestao());
    expect(erro.estado).toBeNull();
  });

  it.each([401, 500])("%i chega com o seu estado", async (estado) => {
    instalar(() => respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })));
    const erro = await falhaDe(gestaoEmenta.obterEmentaGestao());
    expect(erro.estado).toBe(estado);
  });
});

describe("alterarProduto", () => {
  it("PATCH /api/gestao/produtos/{id} só com as chaves dadas", async () => {
    const devolvido = produtoDeTeste({ id: 201, preco_cent: 750 });
    const pedidos = instalar(() => respostaJson(devolvido));

    const resultado = await gestaoEmenta.alterarProduto(201, { preco_cent: 750 });

    expect(resultado).toEqual(devolvido);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/produtos/201`);
    expect(pedidos[0]?.opcoes?.method).toBe("PATCH");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.cabecalhos["content-type"]).toBe("application/json");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(corpoDe(pedidos[0])).toEqual({ preco_cent: 750 });
  });

  it("o corpo é exatamente o que se deu: nenhuma chave a mais, nunca null em chaves que não a descricao", async () => {
    const pedidos = instalar(() => respostaJson(produtoDeTeste({ id: 1 })));

    await gestaoEmenta.alterarProduto(1, { disponivel: false });
    await gestaoEmenta.alterarProduto(2, { nome: "Galão", categoria_id: 3 });
    await gestaoEmenta.alterarProduto(3, { preco_cent: 0 });

    expect(corpoDe(pedidos[0])).toEqual({ disponivel: false });
    expect(corpoDe(pedidos[1])).toEqual({ nome: "Galão", categoria_id: 3 });
    expect(corpoDe(pedidos[2])).toEqual({ preco_cent: 0 });
    for (const pedido of pedidos) {
      expect(Object.values(corpoDe(pedido) as Record<string, unknown>)).not.toContain(null);
    }
  });

  it("`descricao: null` só vai quando foi pedido; sem ela, a chave nem existe", async () => {
    const pedidos = instalar(() => respostaJson(produtoDeTeste({ id: 1 })));

    await gestaoEmenta.alterarProduto(1, { descricao: null });
    await gestaoEmenta.alterarProduto(1, { nome: "Galão" });

    expect(corpoDe(pedidos[0])).toEqual({ descricao: null });
    expect("descricao" in (corpoDe(pedidos[1]) as object)).toBe(false);
  });

  it("os ids são inteiros no caminho, sem formatação", async () => {
    const pedidos = instalar(() => respostaJson(produtoDeTeste({ id: 1234567 })));
    await gestaoEmenta.alterarProduto(1234567, { disponivel: true });
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/produtos/1234567`);
  });

  it("422 traz o `campo` em extra; a mensagem do backend vem à parte", async () => {
    instalar(() =>
      respostaDe(
        422,
        JSON.stringify({
          erro: "dados_invalidos",
          mensagem: "o corpo não é válido",
          campo: "nome",
        }),
      ),
    );
    const erro = await falhaDe(gestaoEmenta.alterarProduto(1, { nome: "" }));
    expect(erro.estado).toBe(422);
    expect(erro.codigo).toBe("dados_invalidos");
    expect(erro.extra.campo).toBe("nome");
  });

  it("422 sem campo: extra não tem `campo`", async () => {
    instalar(() => respostaDe(422, JSON.stringify({ erro: "dados_invalidos", mensagem: "x" })));
    const erro = await falhaDe(gestaoEmenta.alterarProduto(1, { nome: "" }));
    expect(erro.extra.campo).toBeUndefined();
  });

  it("404 produto_inexistente e 422 categoria_inexistente chegam com o código", async () => {
    instalar(() => respostaDe(404, JSON.stringify({ erro: "produto_inexistente", mensagem: "x" })));
    expect((await falhaDe(gestaoEmenta.alterarProduto(9, { nome: "a" }))).codigo).toBe(
      "produto_inexistente",
    );

    instalar(() =>
      respostaDe(
        422,
        JSON.stringify({ erro: "categoria_inexistente", mensagem: "x", campo: "categoria_id" }),
      ),
    );
    const erro = await falhaDe(gestaoEmenta.alterarProduto(9, { categoria_id: 99 }));
    expect(erro.codigo).toBe("categoria_inexistente");
    expect(erro.extra.campo).toBe("categoria_id");
  });

  it("sem resposta: estado null — «não sei se gravou», nunca repetido sozinho", async () => {
    const pedidos = instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    const erro = await falhaDe(gestaoEmenta.alterarProduto(1, { preco_cent: 5 }));
    expect(erro.estado).toBeNull();
    expect(pedidos, "o módulo não pode repetir um PATCH por conta própria").toHaveLength(1);
  });

  it("um cancelamento sai cru, não como ErroDaApi", async () => {
    const controlador = new AbortController();
    instalar(() => {
      controlador.abort();
      throw new DOMException("abortado", "AbortError");
    });
    const erro: unknown = await gestaoEmenta
      .alterarProduto(1, { preco_cent: 5 }, { sinal: controlador.signal })
      .catch((e: unknown) => e);
    expect(erro).not.toBeInstanceOf(ErroDaApi);
  });
});

describe("criarProduto", () => {
  it("POST /api/gestao/produtos com o corpo dado; 201 devolve o produto", async () => {
    const criado = produtoDeTeste({
      id: 900,
      categoria_id: 2,
      nome: "Água tónica",
      preco_cent: 150,
    });
    const pedidos = instalar(() => respostaDe(201, JSON.stringify(criado)));

    const resultado = await gestaoEmenta.criarProduto({
      categoria_id: 2,
      nome: "Água tónica",
      descricao: "Garrafa pequena",
      preco_cent: 150,
      disponivel: true,
    });

    expect(resultado).toEqual(criado);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/produtos`);
    expect(pedidos[0]?.opcoes?.method).toBe("POST");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(corpoDe(pedidos[0])).toEqual({
      categoria_id: 2,
      nome: "Água tónica",
      descricao: "Garrafa pequena",
      preco_cent: 150,
      disponivel: true,
    });
  });

  it("a descrição vazia (ou ausente) omite-se", async () => {
    const pedidos = instalar(() => respostaDe(201, JSON.stringify(produtoDeTeste({ id: 1 }))));

    await gestaoEmenta.criarProduto({
      categoria_id: 2,
      nome: "A",
      descricao: "",
      preco_cent: 0,
      disponivel: false,
    });
    await gestaoEmenta.criarProduto({
      categoria_id: 2,
      nome: "B",
      preco_cent: 5,
      disponivel: true,
    });

    for (const pedido of pedidos) {
      expect("descricao" in (corpoDe(pedido) as object)).toBe(false);
    }
    expect(corpoDe(pedidos[0])).toEqual({
      categoria_id: 2,
      nome: "A",
      preco_cent: 0,
      disponivel: false,
    });
  });

  it("sem resposta: estado null e um único pedido (duplicava o produto se repetisse)", async () => {
    const pedidos = instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    const erro = await falhaDe(
      gestaoEmenta.criarProduto({ categoria_id: 1, nome: "A", preco_cent: 1, disponivel: true }),
    );
    expect(erro.estado).toBeNull();
    expect(pedidos).toHaveLength(1);
  });
});

describe("reordenarProdutos", () => {
  it("PUT /api/gestao/categorias/{id}/produtos/ordem com a lista completa; 204 resolve sem valor", async () => {
    const pedidos = instalar(() => respostaDe(204, ""));

    const resultado = await gestaoEmenta.reordenarProdutos(1, [104, 103, 102, 101]);

    expect(resultado).toBeUndefined();
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/categorias/1/produtos/ordem`);
    expect(pedidos[0]?.opcoes?.method).toBe("PUT");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(corpoDe(pedidos[0])).toEqual({ ids: [104, 103, 102, 101] });
  });

  it("409 chega como ErroDaApi com codigo lista_desatualizada", async () => {
    instalar(() => respostaDe(409, JSON.stringify({ erro: "lista_desatualizada", mensagem: "x" })));
    const erro = await falhaDe(gestaoEmenta.reordenarProdutos(1, [1, 2]));
    expect(erro.estado).toBe(409);
    expect(erro.codigo).toBe("lista_desatualizada");
  });

  it("404 categoria_inexistente, 422 e 500 chegam com o seu estado", async () => {
    instalar(() =>
      respostaDe(404, JSON.stringify({ erro: "categoria_inexistente", mensagem: "x" })),
    );
    expect((await falhaDe(gestaoEmenta.reordenarProdutos(1, [1]))).codigo).toBe(
      "categoria_inexistente",
    );
    instalar(() => respostaDe(422, JSON.stringify({ erro: "dados_invalidos", mensagem: "x" })));
    expect((await falhaDe(gestaoEmenta.reordenarProdutos(1, [1]))).estado).toBe(422);
    instalar(() => respostaDe(500, ""));
    expect((await falhaDe(gestaoEmenta.reordenarProdutos(1, [1]))).estado).toBe(500);
  });

  it("sem resposta: estado null", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await falhaDe(gestaoEmenta.reordenarProdutos(1, [1]))).estado).toBeNull();
  });
});
