/**
 * F2-09 — o cliente: o sítio dos cabeçalhos e a distinção dos três
 * estados de falha.
 *
 * Os dois grupos de testes respondem a duas perguntas diferentes:
 *
 *  - **o que vai no pedido** (`X-Tomazia`, `Accept`, `credentials`, uma
 *    URL relativa). Isto está preso aqui e, outra vez, em
 *    `publico.test.ts` — lá a partir dos exports a sério, para continuar a
 *    valer quando a F2-05 acrescentar funções novas. Não é repetição: aqui
 *    prova-se a construção do pedido, lá prova-se que nenhuma função
 *    escapa a ela.
 *  - **o que sai da falha.** É a regra 10 do `CLAUDE.md` dentro do
 *    cliente: «não houve resposta» (rede), «o servidor disse que não»
 *    (não-2xx) e «fui eu que cancelei» (abort) são três coisas, e um
 *    `useEffect` a desmontar não pode aparecer como erro ao utilizador.
 *
 * **O que estes testes deixam passar:** correm com um `fetch` falso, por
 * isso não dizem nada sobre o `fetch` real do browser — nomeadamente, não
 * provam que a CSP `connect-src 'self'` deixa passar a URL. Essa é a razão
 * de a base ser relativa por construção (`CAMINHO_BASE`) e de haver um
 * teste a prendê-la: o modo de falha do ADR 0008 só aparece no servidor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi, pedir } from "./cliente";

/** A página que o Apache serve quando o Passenger está em baixo. */
const PAGINA_DE_ERRO_DO_APACHE =
  "<!DOCTYPE html><html><head><title>503 Service Unavailable</title></head>" +
  "<body><h1>Service Unavailable</h1></body></html>";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Instala o `fetch` falso e devolve os pedidos observados. */
function comFetch(responder: Parameters<typeof criarFetchFalso>[0]) {
  const { falso, pedidos } = criarFetchFalso(responder);
  vi.stubGlobal("fetch", falso);
  return pedidos;
}

describe("o pedido que o cliente constrói", () => {
  it("leva X-Tomazia, Accept e credentials: include, sempre", async () => {
    const pedidos = comFetch(() => respostaJson({ categorias: [] }));

    await pedir("/ementa");

    expect(pedidos).toHaveLength(1);
    const [pedido] = pedidos;
    expect(pedido).toBeDefined();
    expect(pedido?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedido?.cabecalhos["accept"]).toBe("application/json");
    expect(pedido?.opcoes?.credentials).toBe("include");
  });

  it("a URL é relativa, nunca absoluta (CSP `connect-src 'self'`)", async () => {
    const pedidos = comFetch(() => respostaJson({ categorias: [] }));

    await pedir("/ementa");

    const url = pedidos[0]?.url ?? "";
    expect(url).toBe(`${CAMINHO_BASE}/ementa`);
    expect(url.startsWith("/"), "uma URL que comece por «/» é sempre da mesma origem").toBe(true);
    expect(
      /^[a-z]+:\/\//i.test(url),
      "uma origem absoluta é bloqueada pela CSP, e só no servidor (ADR 0008)",
    ).toBe(false);
  });

  it("o sinal de cancelamento chega ao fetch", async () => {
    const controlador = new AbortController();
    const pedidos = comFetch(() => respostaJson({ fotos: [] }));

    await pedir("/galeria", { sinal: controlador.signal });

    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("devolve o JSON já interpretado", async () => {
    comFetch(() => respostaJson({ categorias: [{ id: 1, nome: "Cervejas" }] }));

    const corpo = await pedir<{ categorias: { id: number; nome: string }[] }>("/ementa");

    expect(corpo.categorias[0]?.nome).toBe("Cervejas");
  });
});

describe("os três estados de falha, distinguíveis uns dos outros", () => {
  it("rede em baixo: ErroDaApi com estado null", async () => {
    comFetch(() => {
      // É assim que o `fetch` do browser falha sem resposta: um `TypeError`
      // com «Failed to fetch», sem `status` nenhum.
      throw new TypeError("Failed to fetch");
    });

    const erro = await pedir("/info").catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).estado, "não houve resposta: não há código HTTP").toBeNull();
    expect((erro as ErroDaApi).codigo).toBeNull();
    expect((erro as ErroDaApi).message).toMatch(/servidor/i);
  });

  it("o servidor disse que não: ErroDaApi com o estado e o código do envelope", async () => {
    comFetch(() =>
      respostaDe(
        403,
        JSON.stringify({ erro: "cabecalho_em_falta", mensagem: "Falta o X-Tomazia." }),
      ),
    );

    const erro = await pedir("/ementa").catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).estado).toBe(403);
    expect((erro as ErroDaApi).codigo).toBe("cabecalho_em_falta");
    expect((erro as ErroDaApi).message).toBe("Falta o X-Tomazia.");
  });

  it("cancelado: sai o erro original, e não é um ErroDaApi", async () => {
    // O caso que motiva tudo isto: um `useEffect` a desmontar cancela o
    // pedido. Se isso chegasse como `ErroDaApi`, o ecrã mostrava uma
    // mensagem de erro por o utilizador ter mudado de página.
    const controlador = new AbortController();
    const cancelamento = new DOMException("The operation was aborted.", "AbortError");
    comFetch(() => {
      controlador.abort();
      throw cancelamento;
    });

    const erro = await pedir("/eventos", { sinal: controlador.signal }).catch(
      (capturado: unknown) => capturado,
    );

    expect(erro).toBe(cancelamento);
    expect(
      erro instanceof ErroDaApi,
      "um cancelamento não é um erro da API: quem apanha `ErroDaApi` trata erros, o resto é cancelamento",
    ).toBe(false);
  });

  it("prazo esgotado: ErroDaApi com estado null, não um cancelamento", async () => {
    // O caso que o revisor mediu: `AbortSignal.timeout()` é a forma padrão
    // de pôr um prazo num `fetch`, e também põe `aborted === true`. Um
    // cliente que olhasse só para o `aborted` classificava isto como «fui
    // eu que cancelei», deixava o erro sair cru, e um ecrã que apanhasse
    // `instanceof ErroDaApi` ficava em «a carregar» para sempre.
    const sinal = AbortSignal.timeout(1);
    await new Promise((resolver) => setTimeout(resolver, 20));
    expect(sinal.aborted, "o pré-requisito do caso: o sinal está abortado").toBe(true);
    expect((sinal.reason as Error).name).toBe("TimeoutError");

    comFetch(() => {
      throw sinal.reason;
    });

    const erro = await pedir("/ementa", { sinal }).catch((capturado: unknown) => capturado);

    expect(erro, "um prazo esgotado é um erro da API, não um cancelamento").toBeInstanceOf(
      ErroDaApi,
    );
    expect((erro as ErroDaApi).estado, "ninguém respondeu: não há código HTTP").toBeNull();
    expect((erro as ErroDaApi).message).toMatch(/demorou demasiado/i);
  });

  it("abort() com um motivo em texto continua a ser cancelamento", async () => {
    // `abort("mudei de página")` põe `reason` a uma string, que não é um
    // `Error` e não tem `.name` — o caminho que decide pelo `reason` tem de
    // continuar a tratar isto como cancelamento, não como prazo.
    const controlador = new AbortController();
    comFetch(() => {
      controlador.abort("mudei de página");
      throw controlador.signal.reason;
    });

    const erro = await pedir("/eventos", { sinal: controlador.signal }).catch(
      (capturado: unknown) => capturado,
    );

    expect(erro).toBe("mudei de página");
    expect(erro instanceof ErroDaApi).toBe(false);
  });

  it("o mesmo código de quem chama separa todos os casos", async () => {
    // A prova da regra 10 feita de uma vez: o mesmo `catch` tem de separar
    // o que é erro do que é cancelamento. Se um dia a recusa do servidor
    // passar a dar `estado: null`, ou o cancelamento passar a ser
    // `ErroDaApi`, ou o prazo esgotado voltar a sair cru, este caso cai.
    //
    // O prazo esgotado dá a mesma classificação que a rede em baixo, e é
    // isso que se quer: para o ecrã, as duas são «não houve resposta». O
    // que ele **não** pode partilhar é a classe do cancelamento.
    function classificar(erro: unknown): string {
      if (!(erro instanceof ErroDaApi)) return "cancelado";
      return erro.estado === null ? "sem resposta" : `o servidor disse ${erro.estado}`;
    }

    comFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const semResposta = await pedir("/info").catch((erro: unknown) => classificar(erro));

    vi.unstubAllGlobals();
    comFetch(() => respostaDe(500, "{}"));
    const recusa = await pedir("/info").catch((erro: unknown) => classificar(erro));

    vi.unstubAllGlobals();
    const controlador = new AbortController();
    comFetch(() => {
      controlador.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const cancelado = await pedir("/info", { sinal: controlador.signal }).catch((erro: unknown) =>
      classificar(erro),
    );

    vi.unstubAllGlobals();
    const prazo = AbortSignal.timeout(1);
    await new Promise((resolver) => setTimeout(resolver, 20));
    comFetch(() => {
      throw prazo.reason;
    });
    const esgotado = await pedir("/info", { sinal: prazo }).catch((erro: unknown) =>
      classificar(erro),
    );

    expect([semResposta, recusa, cancelado, esgotado]).toEqual([
      "sem resposta",
      "o servidor disse 500",
      "cancelado",
      "sem resposta",
    ]);
    expect(
      esgotado,
      "um prazo esgotado nunca pode cair na mesma classe que um cancelamento",
    ).not.toBe(cancelado);
  });
});

describe("um corpo que não é JSON chega legível", () => {
  it("página de erro do Apache num 503: ErroDaApi, não SyntaxError", async () => {
    comFetch(() => respostaDe(503, PAGINA_DE_ERRO_DO_APACHE));

    const erro = await pedir("/ementa").catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect(
      (erro as Error).name,
      "um `JSON.parse` a rebentar dava SyntaxError, que não diz nada a ninguém",
    ).not.toBe("SyntaxError");
    expect((erro as ErroDaApi).estado).toBe(503);
    expect((erro as ErroDaApi).codigo, "não veio envelope nenhum").toBeNull();
    expect(
      (erro as ErroDaApi).message,
      "não se põe HTML de origem desconhecida numa mensagem de ecrã",
    ).not.toContain("<");
    expect((erro as ErroDaApi).message.length).toBeGreaterThan(0);
  });

  it("200 com um corpo que não é JSON: ErroDaApi em vez de rebentar", async () => {
    comFetch(() => respostaDe(200, PAGINA_DE_ERRO_DO_APACHE));

    const erro = await pedir("/ementa").catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).estado).toBe(200);
    expect((erro as Error).name).toBe("ErroDaApi");
  });

  it("não-2xx com corpo vazio: usa a frase por estado, em PT-PT", async () => {
    comFetch(() => respostaDe(404, ""));

    const erro = await pedir("/ementa").catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).estado).toBe(404);
    expect((erro as ErroDaApi).message).toBe("Não encontrei isto no servidor.");
  });

  it("não-2xx com JSON que não é o envelope: código a null e frase nossa", async () => {
    comFetch(() => respostaDe(500, JSON.stringify({ detail: "Internal Server Error" })));

    const erro = await pedir("/ementa").catch((capturado: unknown) => capturado);

    expect((erro as ErroDaApi).codigo).toBeNull();
    expect((erro as ErroDaApi).message).toMatch(/servidor/i);
  });
});
