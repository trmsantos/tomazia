/**
 * F4-05a — o módulo da API das definições da gestão, por cima do cliente.
 *
 * Contrato (`src/lib/api/gestao-definicoes.ts`):
 *
 * ```ts
 * export type DefinicoesGestao = components["schemas"]["DefinicoesGestao"];
 * export type PedidoDefinicoes = components["schemas"]["PedidoDefinicoes"];
 * export function obterDefinicoes(opcoes?: OpcoesDePedido): Promise<DefinicoesGestao>;                        // GET /gestao/definicoes
 * export function guardarDefinicoes(pedido: PedidoDefinicoes, opcoes?: OpcoesDePedido): Promise<DefinicoesGestao>; // PUT /gestao/definicoes
 * ```
 *
 * **A superfície é exatamente estas duas funções.** O corpo do `PUT` é construído
 * **chave a chave** com as sete (`wifi_rede`, `wifi_password`, `morada`,
 * `telefone`, `instagram`, `maps_url`, `horario`) — nunca `{ ...definicoes }`: o
 * `horario_estado` que viesse no objeto dava 422 (`extra="forbid"`; backend:
 * `test_horario_estado_nao_se_escreve`). Nada é aparado nem transformado aqui.
 *
 * `obterDefinicoes` **recusa** um corpo que não sabe ler (spec 2): `configurado`
 * com `horario: null`, um `horario_estado` desconhecido, ou um `horario` que não
 * é lista nem `null`. Rejeita (com qualquer erro): quem chama mostra o erro de
 * carregar e **nunca** o formulário (regra 10).
 *
 * **Deixa passar:** o `fetch` a sério — corre com um fetch falso.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  definicoesComHorarioInvalido,
  definicoesConfiguradas,
  definicoesVazias,
  type DefinicoesGestao,
} from "../../testes/gestao";
import { criarFetchFalso, respostaDe, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoDefinicoes from "./gestao-definicoes";

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

function corpoDe(pedido: { opcoes: RequestInit | undefined } | undefined): Record<string, unknown> {
  const corpo = pedido?.opcoes?.body;
  if (typeof corpo !== "string") throw new Error("o pedido não levou corpo JSON");
  return JSON.parse(corpo) as Record<string, unknown>;
}

const SETE_CHAVES = [
  "horario",
  "instagram",
  "maps_url",
  "morada",
  "telefone",
  "wifi_password",
  "wifi_rede",
];

describe("a superfície de gestao-definicoes.ts", () => {
  it("exporta exatamente as duas funções", () => {
    expect(Object.keys(gestaoDefinicoes).sort()).toEqual(["guardarDefinicoes", "obterDefinicoes"]);
  });
});

describe("obterDefinicoes", () => {
  it("GET /api/gestao/definicoes, com X-Tomazia, credenciais e o sinal; a resposta tal como vem", async () => {
    const definicoes = definicoesConfiguradas();
    const pedidos = instalar(() => respostaJson(definicoes));
    const controlador = new AbortController();

    const resultado = await gestaoDefinicoes.obterDefinicoes({ sinal: controlador.signal });

    expect(resultado).toEqual(definicoes);
    expect(resultado.wifi_password, "nada é aparado").toBe("cerveja-fresca-2026 ");
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/definicoes`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it.each([
    ["nao_configurado com horario null (instalação nova)", definicoesVazias()],
    ["invalido com horario null", definicoesComHorarioInvalido()],
  ])("%s é lido sem erro", async (_nome, definicoes) => {
    instalar(() => respostaJson(definicoes));
    await expect(gestaoDefinicoes.obterDefinicoes()).resolves.toEqual(definicoes);
  });

  it.each<[string, unknown]>([
    ["configurado com horario null", { ...definicoesConfiguradas(), horario: null }],
    ["estado desconhecido", { ...definicoesConfiguradas(), horario_estado: "talvez" }],
    ["sem horario_estado", { ...definicoesConfiguradas(), horario_estado: undefined }],
    ["horario que é texto", { ...definicoesConfiguradas(), horario: "17:00-02:00" }],
    [
      "nao_configurado com horario lista",
      { ...definicoesConfiguradas(), horario_estado: "nao_configurado" },
    ],
  ])("um corpo que não se sabe ler (%s) rejeita — nunca devolve o objeto", async (_nome, corpo) => {
    instalar(() => respostaJson(corpo));
    await expect(gestaoDefinicoes.obterDefinicoes()).rejects.toThrow();
  });

  it("um corpo que não se sabe ler rejeita com ErroDaApi de estado 200 (o PUT lê-o como «não sei»)", async () => {
    instalar(() => respostaJson({ ...definicoesConfiguradas(), horario_estado: "talvez" }));
    const erro = await falhaDe(gestaoDefinicoes.guardarDefinicoes({ ...definicoesVazias() }));
    expect(erro.estado).toBe(200);
  });

  it("sem resposta: ErroDaApi com estado null (nunca definições vazias — regra 10)", async () => {
    instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    const erro = await falhaDe(gestaoDefinicoes.obterDefinicoes());
    expect(erro.estado).toBeNull();
  });

  it.each([401, 403, 500])("%i chega com o seu estado", async (estado) => {
    instalar(() => respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })));
    const erro = await falhaDe(gestaoDefinicoes.obterDefinicoes());
    expect(erro.estado).toBe(estado);
  });
});

describe("guardarDefinicoes", () => {
  it("PUT /api/gestao/definicoes com X-Tomazia, credenciais e JSON; devolve o corpo do servidor", async () => {
    const guardadas = definicoesConfiguradas();
    const pedidos = instalar(() => respostaJson(guardadas));
    const controlador = new AbortController();

    const resultado = await gestaoDefinicoes.guardarDefinicoes(guardadas, {
      sinal: controlador.signal,
    });

    expect(resultado).toEqual(guardadas);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/definicoes`);
    expect(pedidos[0]?.opcoes?.method).toBe("PUT");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.cabecalhos["content-type"]).toBe("application/json");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
  });

  it("o corpo tem EXATAMENTE as sete chaves, mesmo que o objeto de entrada traga horario_estado e chaves a mais", async () => {
    const pedidos = instalar(() => respostaJson(definicoesConfiguradas()));
    // O objeto de uma resposta do GET (com `horario_estado`) mais um intruso: o tipo
    // deixa passar o primeiro (é um supertipo estrutural do pedido).
    const entrada = { ...definicoesConfiguradas(), intruso: "x" } as DefinicoesGestao;

    await gestaoDefinicoes.guardarDefinicoes(entrada);

    const corpo = corpoDe(pedidos[0]);
    expect(Object.keys(corpo).sort()).toEqual(SETE_CHAVES);
    expect(corpo).not.toHaveProperty("horario_estado");
    expect(corpo).not.toHaveProperty("intruso");
  });

  it("horario null vai como null (apaga o horário)", async () => {
    const pedidos = instalar(() => respostaJson(definicoesVazias()));
    await gestaoDefinicoes.guardarDefinicoes({ ...definicoesVazias() });
    const corpo = corpoDe(pedidos[0]);
    expect(corpo["horario"]).toBeNull();
    expect(Object.keys(corpo).sort()).toEqual(SETE_CHAVES);
  });

  it("nada é aparado nem transformado: rede e password com espaços vão tal e qual", async () => {
    const pedidos = instalar(() => respostaJson(definicoesConfiguradas()));
    await gestaoDefinicoes.guardarDefinicoes({
      ...definicoesConfiguradas(),
      wifi_rede: "  rede  ",
      wifi_password: "abc ",
      morada: " Rua ",
      telefone: "",
    });
    expect(corpoDe(pedidos[0])).toMatchObject({
      wifi_rede: "  rede  ",
      wifi_password: "abc ",
      morada: " Rua ",
      telefone: "",
    });
  });

  it("o horário vai como está, dia a dia", async () => {
    const pedidos = instalar(() => respostaJson(definicoesConfiguradas()));
    const entrada = definicoesConfiguradas();
    await gestaoDefinicoes.guardarDefinicoes(entrada);
    expect(corpoDe(pedidos[0])["horario"]).toEqual(entrada.horario);
  });

  it("422: ErroDaApi com estado 422 e o campo em extra.campo", async () => {
    instalar(() =>
      respostaDe(
        422,
        JSON.stringify({
          erro: "dados_invalidos",
          mensagem: "Os dados enviados não são válidos.",
          campo: "maps_url",
        }),
      ),
    );
    const erro = await falhaDe(gestaoDefinicoes.guardarDefinicoes(definicoesConfiguradas()));
    expect(erro.estado).toBe(422);
    expect(erro.extra["campo"]).toBe("maps_url");
  });

  it("sem resposta: estado null (não sei se gravou); e o pedido não se repete sozinho", async () => {
    const pedidos = instalar(() => {
      throw new TypeError("Failed to fetch");
    });
    const erro = await falhaDe(gestaoDefinicoes.guardarDefinicoes(definicoesConfiguradas()));
    expect(erro.estado).toBeNull();
    expect(pedidos).toHaveLength(1);
  });

  it.each([401, 403, 500])("%i chega com o seu estado, sem repetições", async (estado) => {
    const pedidos = instalar(() =>
      respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "y" })),
    );
    const erro = await falhaDe(gestaoDefinicoes.guardarDefinicoes(definicoesConfiguradas()));
    expect(erro.estado).toBe(estado);
    expect(pedidos).toHaveLength(1);
  });
});
