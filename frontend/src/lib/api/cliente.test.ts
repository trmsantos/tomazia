// @vitest-environment node
/**
 * F2-09 — o cliente: o sítio dos cabeçalhos e a distinção dos três
 * estados de falha.
 *
 * Ambiente `node` e não o `jsdom` por omissão do projecto: a varredura em
 * disco deste ficheiro (F3-05, mais abaixo) importa `percorrer-arvore.ts`,
 * que calcula `RAIZ_FRONTEND` a partir de `import.meta.url` — e isso só
 * resolve a um caminho de ficheiro a sério em `node`. Medido: debaixo do
 * `jsdom`, `new URL("../..", import.meta.url)` rebenta com "The URL must
 * be of scheme file". `fetch`, `AbortController`, `FormData`, `Blob` e
 * `DOMException` existem todos em `node` sem precisar de DOM nenhum.
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
 *
 * ---
 *
 * ## F3-05 — o primeiro `POST`, exactamente como o ADR 0012 o deixou por
 * escrever: *"quem acrescentar o primeiro `POST` acrescenta o método e o
 * corpo com o teste que os prova"*. É este bloco.
 *
 * O contrato que os testes a seguir fixam, para quem for escrever
 * `cliente.ts` (não é desta tarefa escrevê-lo):
 *
 *  - `OpcoesDePedido` ganha `metodo?: "GET" | "POST"` (por omissão `"GET"`)
 *    e `corpo?: FormData | Record<string, unknown>`.
 *  - **`corpo instanceof FormData`**: vai tal e qual em `body`, **sem**
 *    `Content-Type` nenhum posto à mão — é o browser que o escreve, com a
 *    fronteira. Herança da F2-06, medida: um `Content-Type:
 *    multipart/form-data` sem fronteira dá `400`. A asserção que prende
 *    isto é a chave `content-type` **não existir** nos cabeçalhos, nunca
 *    "estar vazia".
 *  - **`corpo` é um objecto que não é `FormData`**: serializa com
 *    `JSON.stringify` e vai com `Content-Type: application/json`.
 *  - `X-Tomazia: 1` e `credentials: "include"` continuam incondicionais
 *    (ADR 0012) — a tabela abaixo prova-o nos três casos: `GET`, `POST`
 *    com JSON e `POST` com `FormData`.
 *  - As três falhas da tabela do cabeçalho (sem resposta, não-2xx,
 *    cancelado) continuam a classificar-se da mesma forma com um `POST`.
 *  - `ErroDaApi` ganha um campo **`extra`**: tudo o que o envelope do
 *    backend trouxer além de `erro`/`mensagem` (o espelho do `extra` de
 *    `app/erros.py`, do lado do backend) — `{}` quando não há nada a mais.
 *    É assim que o `segundos_em_falta` do `429` (S-07, ADR 0018) chega ao
 *    ecrã sem o cliente ter de saber o nome do campo de antemão.
 *  - `ErroDaApi` ganha também **`cabecalhos`**: os cabeçalhos da resposta,
 *    em minúsculas (o espelho do `cabecalhos` de `app/erros.py`) — `{}`
 *    quando não há nenhum a mais. É por aqui que o `Retry-After` do `429`
 *    chega ao ecrã; o cliente não sabe (nem precisa de saber) que esse
 *    cabeçalho existe, só o copia.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FICHEIROS_DA_F3_05 } from "../../testes/ecras";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  linhasQueCorrespondem,
  listarFicheiros,
} from "../../testes/percorrer-arvore";
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

/**
 * F3-05 — o `POST`, com `FormData` e com JSON.
 *
 * `pedir()` ainda só faz `GET` (`src/lib/api/cliente.ts`, ligação F2-09):
 * este bloco inteiro falha, hoje, por `opcoes?.metodo` e `opcoes?.corpo`
 * não existirem — não por erro de sintaxe deste ficheiro.
 */
describe("o POST com FormData (herança da F2-06: POST /fotos)", () => {
  it("method POST, credentials include, body é a própria FormData", async () => {
    const pedidos = comFetch(() => respostaJson({ estado: "pendente" }, 202));
    const corpo = new FormData();
    corpo.append("ficheiro", new Blob(["conteudo-falso"]), "foto.jpg");
    corpo.append("website", "");

    await pedir("/fotos", { metodo: "POST", corpo });

    expect(pedidos).toHaveLength(1);
    const [pedido] = pedidos;
    expect(pedido?.opcoes?.method).toBe("POST");
    expect(pedido?.opcoes?.credentials).toBe("include");
    expect(
      pedido?.opcoes?.body,
      "o mesmo FormData que foi passado, tal e qual — não uma cópia nem uma string",
    ).toBe(corpo);
    expect(pedido?.opcoes?.body instanceof FormData).toBe(true);
  });

  it("a chave content-type NÃO existe nos cabeçalhos — não «está vazia», não existe", async () => {
    // A armadilha medida na F2-06: um Content-Type de multipart escrito à
    // mão, sem a fronteira que só o browser sabe gerar, dá 400. Por isso a
    // asserção certa é a ausência da chave, não um valor vazio nem
    // "multipart" sozinho.
    const pedidos = comFetch(() => respostaJson({ estado: "pendente" }, 202));

    await pedir("/fotos", { metodo: "POST", corpo: new FormData() });

    const cabecalhos = pedidos[0]?.cabecalhos ?? {};
    expect(
      "content-type" in cabecalhos,
      `os cabeçalhos enviados foram ${JSON.stringify(cabecalhos)}; a chave content-type ` +
        "não pode existir — é o browser que a escreve, com a fronteira (herança da F2-06)",
    ).toBe(false);
  });

  it('o 202 com {"estado":"pendente"} resolve — não é tratado como erro', async () => {
    comFetch(() => respostaJson({ estado: "pendente" }, 202));

    const resolvido = await pedir("/fotos", { metodo: "POST", corpo: new FormData() });

    expect(resolvido).toEqual({ estado: "pendente" });
  });
});

describe("o POST com JSON (o segundo caminho que o ADR 0012 deixou por escrever)", () => {
  it("content-type é application/json, e o corpo vai serializado", async () => {
    const pedidos = comFetch(() => respostaJson({ ok: true }));

    await pedir("/qualquer", { metodo: "POST", corpo: { a: 1, b: "texto" } });

    const [pedido] = pedidos;
    expect(pedido?.opcoes?.method).toBe("POST");
    expect(pedido?.cabecalhos["content-type"]).toBe("application/json");
    expect(pedido?.opcoes?.body).toBe(JSON.stringify({ a: 1, b: "texto" }));
  });
});

describe("X-Tomazia vai nos três casos: GET, POST-json e POST-form", () => {
  // Tabela, não três testes soltos: é o que impede um ramo futuro (por
  // exemplo, um `pedir()` que só ponha o cabeçalho quando `metodo` for
  // omitido) de o perder sem que ninguém dê conta.
  const CASOS: [string, () => Promise<unknown>][] = [
    ["GET", () => pedir("/ementa")],
    ["POST com JSON", () => pedir("/qualquer", { metodo: "POST", corpo: { a: 1 } })],
    ["POST com FormData", () => pedir("/fotos", { metodo: "POST", corpo: new FormData() })],
  ];

  it.each(CASOS)('%s: x-tomazia é "1"', async (_nome, chamar) => {
    const pedidos = comFetch(() => respostaJson({ estado: "pendente" }, 202));

    await chamar();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
  });

  it.each(CASOS)("%s: credentials é include", async (_nome, chamar) => {
    const pedidos = comFetch(() => respostaJson({ estado: "pendente" }, 202));

    await chamar();

    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
  });
});

describe("as três falhas continuam distinguíveis no POST (regra 10, outra vez)", () => {
  it("rede em baixo: ErroDaApi com estado null", async () => {
    comFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const erro = await pedir("/fotos", { metodo: "POST", corpo: new FormData() }).catch(
      (capturado: unknown) => capturado,
    );

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).estado, "não houve resposta: não há código HTTP").toBeNull();
  });

  it("prazo esgotado: ErroDaApi com estado null, não um cancelamento", async () => {
    const sinal = AbortSignal.timeout(1);
    await new Promise((resolver) => setTimeout(resolver, 20));

    comFetch(() => {
      throw sinal.reason;
    });

    const erro = await pedir("/fotos", {
      metodo: "POST",
      corpo: new FormData(),
      sinal,
    }).catch((capturado: unknown) => capturado);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).estado).toBeNull();
  });

  it("abort(): o erro sai cru, e não é um ErroDaApi", async () => {
    // O caso real: fechar a Folha a meio do envio cancela o pedido (F3-05,
    // secção 6.6) — ninguém pode ver isso como um erro de envio.
    const controlador = new AbortController();
    const cancelamento = new DOMException("The operation was aborted.", "AbortError");
    comFetch(() => {
      controlador.abort();
      throw cancelamento;
    });

    const erro = await pedir("/fotos", {
      metodo: "POST",
      corpo: new FormData(),
      sinal: controlador.signal,
    }).catch((capturado: unknown) => capturado);

    expect(erro).toBe(cancelamento);
    expect(erro instanceof ErroDaApi).toBe(false);
  });
});

describe("o 429 com envelope: código, mensagem do backend, e segundos_em_falta", () => {
  it("ErroDaApi.extra traz segundos_em_falta, sem o cliente ter de o conhecer de antemão", async () => {
    comFetch(() =>
      respostaDe(
        429,
        JSON.stringify({
          erro: "limite_de_envios_excedido",
          mensagem: "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco.",
          segundos_em_falta: 125,
        }),
        { "Retry-After": "125" },
      ),
    );

    const erro = await pedir("/fotos", { metodo: "POST", corpo: new FormData() }).catch(
      (capturado: unknown) => capturado,
    );

    expect(erro).toBeInstanceOf(ErroDaApi);
    const api = erro as ErroDaApi;
    expect(api.estado).toBe(429);
    expect(api.codigo).toBe("limite_de_envios_excedido");
    expect(api.message).toBe(
      "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco.",
    );
    expect(
      (api as unknown as { extra: unknown }).extra,
      "o 429 do S-07/ADR 0018 só é útil ao ecrã se segundos_em_falta chegar: é a única " +
        "forma de compor «Podes tentar outra vez daqui a N minutos.» (F3-05, secção 9)",
    ).toEqual({ segundos_em_falta: 125 });
  });

  it("ErroDaApi.cabecalhos traz o Retry-After, em minúsculas", async () => {
    // O corpo e o cabeçalho podem divergir (um proxy a arredondar, por
    // exemplo) — o ecrã compõe com **o maior dos dois** (decisão da F3-05),
    // e para isso os dois têm de estar acessíveis, não só o do corpo.
    comFetch(() =>
      respostaDe(
        429,
        JSON.stringify({
          erro: "limite_de_envios_excedido",
          mensagem: "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco.",
          segundos_em_falta: 125,
        }),
        { "Retry-After": "180" },
      ),
    );

    const erro = await pedir("/fotos", { metodo: "POST", corpo: new FormData() }).catch(
      (capturado: unknown) => capturado,
    );

    expect(
      (erro as unknown as { cabecalhos: Record<string, string> }).cabecalhos["retry-after"],
      "a chave tem de estar em minúsculas, como o cabecalhosDe() do lado do pedido já faz",
    ).toBe("180");
  });

  it("um erro sem campos extra e sem cabeçalhos extra tem os dois vazios, não `undefined`", async () => {
    comFetch(() =>
      respostaDe(
        403,
        JSON.stringify({ erro: "cabecalho_em_falta", mensagem: "Falta o X-Tomazia." }),
      ),
    );

    const erro = await pedir("/ementa").catch((capturado: unknown) => capturado);

    expect((erro as unknown as { extra: unknown }).extra).toEqual({});
    expect((erro as unknown as { cabecalhos: Record<string, string> }).cabecalhos).toEqual({});
  });
});

describe("varredura em disco: o multipart não se escreve à mão em lado nenhum", () => {
  /**
   * Mesmo padrão do `fetch-so-no-cliente.test.ts`: um `eslint-disable` não
   * desliga uma varredura de texto, e uma lista vazia não pode passar por
   * "está limpo" — por isso as sentinelas incluem ficheiros que já existem
   * hoje (para a varredura provar que anda) e os da F3-05 (para falhar
   * «não consegui percorrer a árvore» enquanto eles não existirem, em vez
   * de passar por "não encontrei nada" antes de a tarefa estar feita).
   */
  function ficheirosAlvo(): string[] {
    return (
      [
        ...listarFicheiros(join(RAIZ_FRONTEND, "src", "lib"), { extensoes: [".ts", ".tsx"] }),
        ...listarFicheiros(join(RAIZ_FRONTEND, "src", "pages"), { extensoes: [".ts", ".tsx"] }),
      ]
        .filter((ficheiro) => !/\.test\.tsx?$/.test(ficheiro))
        // `src/lib/api/gerado/` é gerado a partir do OpenAPI do backend (regra
        // 9 do CLAUDE.md) e nunca se edita à mão — e desde a F2-06 descreve o
        // `requestBody` de `POST /fotos`, por isso contém literalmente
        // "multipart/form-data" no `openapi-typescript` a documentar o
        // `Content-Type` do contrato. Isto não é um multipart escrito à mão: é
        // um tipo gerado a descrevê-lo. Só apareceu agora (F3-05, correção do
        // Tomás, 6 de novembro de 2026) porque esta varredura exigia os
        // ficheiros-sentinela da F3-05, que passaram a existir.
        .filter((ficheiro) => !caminhoRelativo(ficheiro).startsWith("src/lib/api/gerado/"))
    );
  }

  const SENTINELAS_DA_VARREDURA = [
    "src/lib/api/cliente.ts",
    "src/pages/publico/Ementa.tsx",
    ...FICHEIROS_DA_F3_05.filter(
      (ficheiro) => ficheiro.startsWith("src/lib/") || ficheiro.startsWith("src/pages/"),
    ),
  ];

  it("a string «multipart/form-data» não aparece em src/lib/** nem em src/pages/**", () => {
    const ficheiros = ficheirosAlvo();
    exigirSentinelas(ficheiros, SENTINELAS_DA_VARREDURA, "multipart escrito à mão");

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      const texto = lerTexto(ficheiro, relativo);
      for (const linha of linhasQueCorrespondem(texto, (conteudo) =>
        conteudo.includes("multipart/form-data"),
      )) {
        violacoes.push(`${relativo}:${linha}`);
      }
    }

    expect(
      violacoes,
      "O Content-Type do multipart tem de nascer do browser, com a fronteira — um " +
        "`Content-Type: multipart/form-data` escrito à mão dá 400 (medido na F2-06). " +
        "Passa o FormData em `corpo` e deixa o `pedir()` (e o fetch por baixo) decidir.",
    ).toEqual([]);
  });

  it("a varredura falha «não consegui procurar» sobre uma pasta vazia, não «está limpo»", () => {
    expect(() => exigirSentinelas([], SENTINELAS_DA_VARREDURA, "multipart escrito à mão")).toThrow(
      /não consegui percorrer a árvore/i,
    );
  });
});
