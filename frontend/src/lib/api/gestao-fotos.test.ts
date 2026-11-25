/**
 * F4-04 — o módulo da API da moderação de fotos, por cima do cliente.
 *
 * Contrato (`src/lib/api/gestao-fotos.ts`; plano 3.1, spec 2 e 12.3):
 *
 * ```ts
 * export type FotoPendente, FilaDeModeracao, RespostaModeracao;           // do esquema gerado
 * export function obterFilaDeModeracao(opcoes?): Promise<FilaDeModeracao>; // GET  /gestao/fotos
 * export function aprovarFoto(id: number, opcoes?): Promise<RespostaModeracao>;  // POST /gestao/fotos/{id}/aprovar
 * export function rejeitarFoto(id: number, opcoes?): Promise<RespostaModeracao>; // POST /gestao/fotos/{id}/rejeitar
 * export function enderecoDaImagem(id: number): string;   // "/api/gestao/fotos/{id}/imagem" (CAMINHO_BASE + …)
 * ```
 *
 * `aprovarFoto` e `rejeitarFoto` **não levam corpo**. Os erros chegam como `ErroDaApi`
 * (`estado === null` é «não houve resposta»); este módulo **nunca repete** um pedido (repetir
 * um `POST` é decisão do dono, não do código). `obterFilaDeModeracao` **recusa** um 200 que não
 * sabe ler com `ErroDaApi` de estado 200: o ecrã mostra o erro de carregar e nunca «não há
 * fotos» (regra 10).
 *
 * **A superfície não é fechada** (ao contrário de `gestao-eventos.ts`): a F4-04b junta aqui
 * `obterAprovadas` e `eliminarFoto`. Só se exige que as quatro existam.
 *
 * **Deixa passar:** o `fetch` a sério — corre com um fetch falso; e a imagem a sério no browser (e2e).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aprovadasDeTeste,
  erro409FotoJaModerada,
  filaDeTeste,
  fotoAprovadaDeTeste,
  fotoPendenteDeTeste,
} from "../../testes/gestao";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoFotos from "./gestao-fotos";

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

describe("a superfície de gestao-fotos.ts", () => {
  // F4-04b: a lista de funções exportadas era de quatro porque a F4-04 só tinha essas; a F4-04b
  // junta-lhe `obterAprovadas` e `eliminarFoto` (o comentário já o previa). As quatro de antes
  // continuam obrigatórias: o teste só cresceu.
  it("exporta as seis funções: as quatro da F4-04 e as duas da F4-04b", () => {
    for (const nome of [
      "obterFilaDeModeracao",
      "aprovarFoto",
      "rejeitarFoto",
      "enderecoDaImagem",
      "obterAprovadas",
      "eliminarFoto",
    ] as const) {
      expect(typeof gestaoFotos[nome], nome).toBe("function");
    }
  });
});

describe("obterFilaDeModeracao", () => {
  it("GET /api/gestao/fotos, com X-Tomazia, credenciais e o sinal; devolve a lista tal como vem", async () => {
    const corpo = { fotos: filaDeTeste(3) };
    const pedidos = instalar(() => respostaJson(corpo));
    const controlador = new AbortController();

    const resultado = await gestaoFotos.obterFilaDeModeracao({ sinal: controlador.signal });

    expect(resultado).toEqual(corpo);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/fotos`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("aceita a lista vazia (um 200 normal) e `descricao`/`enviada_por` a `null`", async () => {
    instalar(() => respostaJson({ fotos: [] }));
    expect((await gestaoFotos.obterFilaDeModeracao()).fotos).toEqual([]);

    const sem = fotoPendenteDeTeste({ id: 1, descricao: null, enviada_por: null });
    instalar(() => respostaJson({ fotos: [sem] }));
    const r = await gestaoFotos.obterFilaDeModeracao();
    expect(r.fotos[0]?.descricao).toBeNull();
    expect(r.fotos[0]?.enviada_por).toBeNull();
  });

  const BOA = fotoPendenteDeTeste({ id: 1 });
  it.each([
    ["não é um objeto (lista)", []],
    ["não é um objeto (texto)", "x"],
    ["não é um objeto (null)", null],
    ["falta `fotos`", {}],
    ["`fotos` não é lista (objeto)", { fotos: {} }],
    ["`fotos` não é lista (texto)", { fotos: "x" }],
    ["um elemento é `null`", { fotos: [null] }],
    ["um elemento é um texto", { fotos: ["x"] }],
    ["`id` é texto", { fotos: [{ ...BOA, id: "1" }] }],
    ["`ficheiro` é número", { fotos: [{ ...BOA, ficheiro: 7 }] }],
    ["`criada_em` é número", { fotos: [{ ...BOA, criada_em: 1762380000 }] }],
    ["`criada_em` não se lê", { fotos: [{ ...BOA, criada_em: "ontem à noite" }] }],
    ["`criada_em` em falta", { fotos: [{ ...BOA, criada_em: undefined }] }],
    ["`descricao` é número", { fotos: [{ ...BOA, descricao: 5 }] }],
    ["`enviada_por` é número", { fotos: [{ ...BOA, enviada_por: 5 }] }],
    ["só o segundo elemento é mau", { fotos: [BOA, { ...BOA, id: "2" }] }],
  ])(
    "recusa um 200 ilegível (%s) com ErroDaApi de estado 200 — nunca «não há fotos»",
    async (_nome, corpo) => {
      instalar(() => respostaJson(corpo));
      const erro = await falhaDe(gestaoFotos.obterFilaDeModeracao());
      expect(erro.estado).toBe(200);
    },
  );

  it("aceita `moderada_em: null` (o modelo e o backend aceitam; ordena-se no fim): uma foto sem data não parte a lista", async () => {
    const corpo = { fotos: [APROVADA, { ...APROVADA, id: 8, moderada_em: null }] };
    instalar(() => respostaJson(corpo));
    expect(await gestaoFotos.obterAprovadas()).toEqual(corpo);
  });

  it("um 200 que nem é JSON também é um erro (o Apache a servir uma página), nunca uma lista", async () => {
    instalar(() => respostaDe(200, "<html>manutenção</html>"));
    await falhaDe(gestaoFotos.obterFilaDeModeracao());
  });

  it("sem resposta: estado null; 401, 403 e 500 chegam com o seu estado; nunca repete", async () => {
    const semResposta = instalar(rede);
    expect((await falhaDe(gestaoFotos.obterFilaDeModeracao())).estado).toBeNull();
    expect(semResposta, "um fetch falhado é um só pedido").toHaveLength(1);

    for (const estado of [401, 403, 500]) {
      const pedidos = instalar(() =>
        respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })),
      );
      expect((await falhaDe(gestaoFotos.obterFilaDeModeracao())).estado).toBe(estado);
      expect(pedidos).toHaveLength(1);
    }
  });
});

describe.each([
  ["aprovarFoto", "aprovar", "aprovada"],
  ["rejeitarFoto", "rejeitar", "rejeitada"],
] as const)("%s", (funcao, verbo, estadoFinal) => {
  it(`POST /api/gestao/fotos/{id}/${verbo}, sem corpo, com X-Tomazia e credenciais; devolve {id, estado}`, async () => {
    const pedidos = instalar(() => respostaJson({ id: 7, estado: estadoFinal }));
    const controlador = new AbortController();

    const r = await gestaoFotos[funcao](7, { sinal: controlador.signal });

    expect(r).toEqual({ id: 7, estado: estadoFinal });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/fotos/7/${verbo}`);
    expect(pedidos[0]?.opcoes?.method).toBe("POST");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
    expect(pedidos[0]?.opcoes?.body ?? null, "aprovar e rejeitar não levam corpo").toBeNull();
  });

  it("404 foto_nao_encontrada, 409 foto_ja_moderada, 401 e 500 chegam com o estado e o código", async () => {
    instalar(() => respostaDe(404, JSON.stringify({ erro: "foto_nao_encontrada", mensagem: "x" })));
    const e404 = await falhaDe(gestaoFotos[funcao](9));
    expect([e404.estado, e404.codigo]).toEqual([404, "foto_nao_encontrada"]);

    const modelo = erro409FotoJaModerada();
    instalar(() => respostaDe(409, JSON.stringify({ erro: modelo.codigo, mensagem: "x" })));
    const e409 = await falhaDe(gestaoFotos[funcao](9));
    expect([e409.estado, e409.codigo]).toEqual([409, "foto_ja_moderada"]);

    instalar(() => respostaDe(401, JSON.stringify({ erro: "sessao_em_falta", mensagem: "x" })));
    expect((await falhaDe(gestaoFotos[funcao](9))).estado).toBe(401);

    instalar(() => respostaDe(500, JSON.stringify({ erro: "x", mensagem: "y" })));
    expect((await falhaDe(gestaoFotos[funcao](9))).estado).toBe(500);
  });

  it("sem resposta: estado null e um só pedido — nunca se repete sozinho", async () => {
    const pedidos = instalar(rede);
    expect((await falhaDe(gestaoFotos[funcao](9))).estado).toBeNull();
    expect(pedidos, "repetir um POST de moderação é decisão do dono").toHaveLength(1);
  });
});

describe("enderecoDaImagem", () => {
  it("é o caminho da API com a base: /api/gestao/fotos/{id}/imagem", () => {
    expect(gestaoFotos.enderecoDaImagem(7)).toBe("/api/gestao/fotos/7/imagem");
    expect(gestaoFotos.enderecoDaImagem(101)).toBe(`${CAMINHO_BASE}/gestao/fotos/101/imagem`);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "recusa o id %j (só um inteiro positivo entra num endereço)",
    (id) => {
      expect(() => gestaoFotos.enderecoDaImagem(id)).toThrow();
    },
  );

  it("recusa um id que não é número (um texto com `../` não vira um caminho)", () => {
    expect(() => gestaoFotos.enderecoDaImagem("7/../../x" as unknown as number)).toThrow();
    expect(() => gestaoFotos.enderecoDaImagem(undefined as unknown as number)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// F4-04b — as aprovadas e o eliminar
// ---------------------------------------------------------------------------

const APROVADA = fotoAprovadaDeTeste({ id: 7, enviada_por: "Rita", descricao: "legenda" });

describe("obterAprovadas", () => {
  it("GET /api/gestao/fotos/aprovadas, com X-Tomazia, credenciais e o sinal; devolve a lista tal como vem", async () => {
    const corpo = { fotos: aprovadasDeTeste(3) };
    const pedidos = instalar(() => respostaJson(corpo));
    const controlador = new AbortController();

    const resultado = await gestaoFotos.obterAprovadas({ sinal: controlador.signal });

    expect(resultado).toEqual(corpo);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/fotos/aprovadas`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("aceita a lista vazia (um 200 normal) e `descricao`/`enviada_por` a `null`", async () => {
    instalar(() => respostaJson({ fotos: [] }));
    expect((await gestaoFotos.obterAprovadas()).fotos).toEqual([]);

    instalar(() => respostaJson({ fotos: [fotoAprovadaDeTeste({ id: 1 })] }));
    const r = await gestaoFotos.obterAprovadas();
    expect(r.fotos[0]?.descricao).toBeNull();
    expect(r.fotos[0]?.enviada_por).toBeNull();
  });

  it.each([
    ["não é um objeto (lista)", []],
    ["não é um objeto (texto)", "x"],
    ["não é um objeto (null)", null],
    ["falta `fotos`", {}],
    ["`fotos` não é lista (objeto)", { fotos: {} }],
    ["`fotos` não é lista (texto)", { fotos: "x" }],
    ["um elemento é `null`", { fotos: [null] }],
    ["um elemento é um texto", { fotos: ["x"] }],
    ["`id` é texto", { fotos: [{ ...APROVADA, id: "1" }] }],
    ["`ficheiro` é número", { fotos: [{ ...APROVADA, ficheiro: 7 }] }],
    ["`moderada_em` é número", { fotos: [{ ...APROVADA, moderada_em: 1762380000 }] }],
    ["`moderada_em` não se lê", { fotos: [{ ...APROVADA, moderada_em: "ontem à noite" }] }],
    ["`moderada_em` em falta", { fotos: [{ ...APROVADA, moderada_em: undefined }] }],
    ["`criada_em` não se lê", { fotos: [{ ...APROVADA, criada_em: "ontem à noite" }] }],
    ["`descricao` é número", { fotos: [{ ...APROVADA, descricao: 5 }] }],
    ["`enviada_por` é número", { fotos: [{ ...APROVADA, enviada_por: 5 }] }],
    ["só o segundo elemento é mau", { fotos: [APROVADA, { ...APROVADA, id: "2" }] }],
  ])(
    "recusa um 200 ilegível (%s) com ErroDaApi de estado 200 — nunca «não há fotos»",
    async (_nome, corpo) => {
      instalar(() => respostaJson(corpo));
      const erro = await falhaDe(gestaoFotos.obterAprovadas());
      expect(erro.estado).toBe(200);
    },
  );

  it("um 200 que nem é JSON também é um erro (o Apache a servir uma página), nunca uma lista", async () => {
    instalar(() => respostaDe(200, "<html>manutenção</html>"));
    await falhaDe(gestaoFotos.obterAprovadas());
  });

  it("sem resposta: estado null; 401, 403 e 500 chegam com o seu estado; nunca repete", async () => {
    const semResposta = instalar(rede);
    expect((await falhaDe(gestaoFotos.obterAprovadas())).estado).toBeNull();
    expect(semResposta, "um fetch falhado é um só pedido").toHaveLength(1);

    for (const estado of [401, 403, 500]) {
      const pedidos = instalar(() =>
        respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })),
      );
      expect((await falhaDe(gestaoFotos.obterAprovadas())).estado).toBe(estado);
      expect(pedidos).toHaveLength(1);
    }
  });

  it("nunca leva `ip_hash` para fora: o que o servidor não manda não aparece (a lista é a do esquema)", async () => {
    instalar(() => respostaJson({ fotos: [APROVADA] }));
    const r = await gestaoFotos.obterAprovadas();
    expect(Object.keys(r.fotos[0] ?? {}).sort()).toEqual(
      ["criada_em", "descricao", "enviada_por", "ficheiro", "id", "moderada_em"].sort(),
    );
  });
});

describe("eliminarFoto", () => {
  it("DELETE /api/gestao/fotos/{id}, sem corpo, com X-Tomazia, credenciais e o sinal; um 204 resolve", async () => {
    const pedidos = instalar(() => respostaDe(204, ""));
    const controlador = new AbortController();

    await expect(gestaoFotos.eliminarFoto(7, { sinal: controlador.signal })).resolves.not.toThrow();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/fotos/7`);
    expect(pedidos[0]?.opcoes?.method).toBe("DELETE");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
    expect(pedidos[0]?.opcoes?.body ?? null, "eliminar não leva corpo").toBeNull();
  });

  it("404 foto_nao_encontrada, 409 foto_nao_aprovada, 500 foto_nao_eliminada, 422 e 401 chegam com o estado e o código", async () => {
    for (const [estado, codigo] of [
      [404, "foto_nao_encontrada"],
      [409, "foto_nao_aprovada"],
      [500, "foto_nao_eliminada"],
      [422, "dados_invalidos"],
      [401, "sessao_em_falta"],
    ] as const) {
      instalar(() => respostaDe(estado, JSON.stringify({ erro: codigo, mensagem: "x" })));
      const e = await falhaDe(gestaoFotos.eliminarFoto(9));
      expect([e.estado, e.codigo]).toEqual([estado, codigo]);
    }
  });

  it("sem resposta: estado null e UM só pedido — nunca repete sozinho (um DELETE que talvez tenha chegado)", async () => {
    const pedidos = instalar(rede);
    expect((await falhaDe(gestaoFotos.eliminarFoto(9))).estado).toBeNull();
    expect(pedidos).toHaveLength(1);
  });

  it("regra 10: um 200 com corpo, ou um 204 com lixo, não é um sucesso silencioso", async () => {
    instalar(() => respostaDe(204, "lixo"));
    await falhaDe(gestaoFotos.eliminarFoto(9));
    instalar(() => respostaDe(200, "<html>manutenção</html>"));
    await falhaDe(gestaoFotos.eliminarFoto(9));
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "recusa o id %j antes de pedir (só um inteiro positivo entra num caminho): nenhum pedido",
    (id) => {
      // Sem isto, `eliminarFoto` inexistente lançava «is not a function» e o teste passava.
      expect(typeof gestaoFotos.eliminarFoto).toBe("function");
      const pedidos = instalar(() => respostaDe(204, ""));
      expect(() => gestaoFotos.eliminarFoto(id)).toThrow(RangeError);
      expect(pedidos, "nada chegou ao fetch").toHaveLength(0);
    },
  );

  it("recusa um id que não é número (`../` num endereço)", () => {
    expect(typeof gestaoFotos.eliminarFoto).toBe("function");
    const pedidos = instalar(() => respostaDe(204, ""));
    expect(() => gestaoFotos.eliminarFoto("7/../../x" as unknown as number)).toThrow(RangeError);
    expect(() => gestaoFotos.eliminarFoto(undefined as unknown as number)).toThrow(RangeError);
    expect(pedidos).toHaveLength(0);
  });
});
