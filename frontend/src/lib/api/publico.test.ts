/**
 * F2-09 — nenhuma função pública escapa ao cliente.
 *
 * Este teste não nomeia `obterEmenta` numa lista de casos: **enumera os
 * exports de `publico.ts` em tempo de execução**, chama cada um com um
 * `fetch` falso e exige que o pedido que saiu leve `X-Tomazia`, `Accept`,
 * `credentials: "include"` e uma URL relativa debaixo de `/api`.
 *
 * É essa a razão de ser escrito assim. Um teste com quatro casos escritos
 * à mão continuaria verde no dia em que a F2-05 acrescentasse uma quinta
 * função que faz `fetch` à mão — e a quinta é precisamente a primeira
 * mutação, a que o backend recusa com 403 sem o `X-Tomazia` (S-06).
 *
 * E **rebenta** perante um export que não saiba exercitar, nunca o salta:
 * é a regra 10 do `CLAUDE.md`. Um `continue` silencioso sobre um export
 * desconhecido transformava este ficheiro num teste que passa sempre —
 * «não encontrei nada de errado» e «não consegui verificar» não podem dar
 * o mesmo resultado. Quem acrescentar uma função tem de vir à tabela
 * `ARGUMENTOS_POR_EXPORT` dizer como se chama; é trabalho, e é esse o
 * objetivo.
 *
 * (A tabela existe porque a aridade não serve de guia: em JavaScript, um
 * parâmetro opcional de TypeScript conta para o `Function.length` na
 * mesma, por isso `obterEmenta(opcoes?)` tem `length === 1` tal como uma
 * função com um argumento mesmo obrigatório. Medido, não suposto.)
 *
 * **O que deixa passar:** não verifica o *corpo* nem o método do pedido
 * (hoje só há GETs), nem que o caminho de cada função é o certo — isso é
 * do `satisfies keyof paths` em `publico.ts`, verificado pelo `tsc`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { criarFetchFalso, respostaJson } from "../../testes/pedidos";
import { CAMINHO_BASE } from "./cliente";
import * as publico from "./publico";

/**
 * Como se chama cada export. A chave é o nome exportado; o valor são os
 * argumentos com que o teste o exercita. As quatro funções da F2-03 não
 * precisam de nenhum.
 *
 * Um export que não esteja aqui faz o teste rebentar, e uma chave aqui que
 * já não seja exportada também: as duas direções são verificadas.
 *
 * `enviarFoto` chegou com a F3-05 (correção do Tomás, 6 de novembro de
 * 2026) — é o primeiro `POST` do cliente (ADR 0012, herança da F2-06) e o
 * primeiro export que não tem `opcoes?` como único argumento: o `corpo`
 * (`FormData`) é obrigatório, por isso leva um na tabela.
 */
const ARGUMENTOS_POR_EXPORT: Record<string, unknown[]> = {
  obterEmenta: [],
  obterEventos: [],
  obterGaleria: [],
  obterInfo: [],
  enviarFoto: [new FormData()],
};

type Export = [nome: string, valor: unknown];

/** Os argumentos da tabela, ou um erro que diz que não sei classificar. */
function argumentosPara(nome: string): unknown[] {
  const argumentos = ARGUMENTOS_POR_EXPORT[nome];
  if (argumentos === undefined) {
    throw new Error(
      `Não sei classificar o export «${nome}» de src/lib/api/publico.ts: não está na tabela ` +
        "ARGUMENTOS_POR_EXPORT deste teste. Este teste existe para garantir que toda a " +
        "superfície pública passa pelo cliente, e um export que ele não saiba exercitar não " +
        "pode ser ignorado em silêncio. Diz-lhe como se chama.",
    );
  }
  return argumentos;
}

/**
 * Chama um export e devolve o único pedido que ele fez. Lança — com uma
 * mensagem que diz «não sei exercitar», distinta de «o pedido está mal» —
 * perante qualquer coisa que não consiga chamar.
 */
async function pedidoFeitoPor([nome, valor]: Export, argumentos: unknown[]) {
  if (typeof valor !== "function") {
    throw new Error(
      `Não sei exercitar o export «${nome}» de src/lib/api/publico.ts: não é uma função. ` +
        "Se um dia houver aqui uma constante, este teste tem de aprender o que fazer com ela.",
    );
  }

  const { falso, pedidos } = criarFetchFalso(() => respostaJson({}));
  vi.stubGlobal("fetch", falso);

  const devolvido: unknown = (valor as (...args: unknown[]) => unknown)(...argumentos);
  if (!(devolvido instanceof Promise)) {
    throw new Error(
      `Não sei exercitar o export «${nome}» de src/lib/api/publico.ts: não devolveu uma ` +
        "promessa, portanto não é um pedido à API como os outros.",
    );
  }
  await devolvido;

  if (pedidos.length !== 1) {
    throw new Error(
      `O export «${nome}» de src/lib/api/publico.ts fez ${pedidos.length} pedidos; ` +
        "esperava exatamente um. Com zero, este teste não verificou cabeçalho nenhum.",
    );
  }

  const pedido = pedidos[0];
  if (pedido === undefined) {
    throw new Error(`Não consegui observar o pedido de «${nome}».`);
  }
  return pedido;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toda a superfície de publico.ts passa pelo cliente", () => {
  it("a tabela de exercício e os exports a sério dizem o mesmo", () => {
    const exportados = Object.keys(publico);
    const naTabela = Object.keys(ARGUMENTOS_POR_EXPORT);

    expect(
      naTabela.filter((nome) => !exportados.includes(nome)),
      "a tabela nomeia funções que já não existem: ou foram renomeadas, ou desapareceram",
    ).toEqual([]);
    expect(
      exportados.filter((nome) => !naTabela.includes(nome)),
      "há exports que o teste não sabe exercitar — e exercitá-los é o que ele faz",
    ).toEqual([]);
    // "enviarFoto" entra aqui em ordem alfabética (F3-05, correção do
    // Tomás, 6 de novembro de 2026): é o quinto export, e o primeiro POST.
    expect(exportados.sort()).toEqual([
      "enviarFoto",
      "obterEmenta",
      "obterEventos",
      "obterGaleria",
      "obterInfo",
    ]);
  });

  it("cada export leva o cabeçalho, o credentials e uma URL relativa", async () => {
    const exports: Export[] = Object.entries(publico);

    expect(
      exports.length,
      "zero exports em src/lib/api/publico.ts: isto não é «está tudo bem», é «não verifiquei nada»",
    ).toBeGreaterThan(0);

    for (const entrada of exports) {
      const [nome] = entrada;
      const pedido = await pedidoFeitoPor(entrada, argumentosPara(nome));

      expect(pedido.cabecalhos["x-tomazia"], `«${nome}» tem de levar X-Tomazia`).toBe("1");
      expect(pedido.cabecalhos["accept"], `«${nome}» tem de pedir JSON`).toBe("application/json");
      expect(pedido.opcoes?.credentials, `«${nome}» tem de levar a sessão`).toBe("include");
      expect(pedido.url.startsWith(`${CAMINHO_BASE}/`), `«${nome}» tem de pedir a /api`).toBe(true);
      expect(
        /^[a-z]+:\/\//i.test(pedido.url),
        `«${nome}» não pode usar uma origem absoluta (CSP connect-src 'self')`,
      ).toBe(false);

      vi.unstubAllGlobals();
    }
  });

  it("o cancelamento de quem chama chega ao pedido", async () => {
    // As quatro funções recebem `OpcoesDePedido`; se alguma deixasse cair
    // o `sinal`, um ecrã desmontado continuava a esperar pela resposta.
    const { falso, pedidos } = criarFetchFalso(() => respostaJson({}));
    vi.stubGlobal("fetch", falso);
    const controlador = new AbortController();

    await Promise.all([
      publico.obterEmenta({ sinal: controlador.signal }),
      publico.obterEventos({ sinal: controlador.signal }),
      publico.obterGaleria({ sinal: controlador.signal }),
      publico.obterInfo({ sinal: controlador.signal }),
    ]);

    expect(pedidos).toHaveLength(4);
    for (const pedido of pedidos) {
      expect(pedido.opcoes?.signal).toBe(controlador.signal);
    }
  });

  it("os quatro caminhos são os quatro da F2-03, sem repetições", async () => {
    const { falso, pedidos } = criarFetchFalso(() => respostaJson({}));
    vi.stubGlobal("fetch", falso);

    await Promise.all([
      publico.obterEmenta(),
      publico.obterEventos(),
      publico.obterGaleria(),
      publico.obterInfo(),
    ]);

    expect(pedidos.map((pedido) => pedido.url).sort()).toEqual([
      `${CAMINHO_BASE}/ementa`,
      `${CAMINHO_BASE}/eventos`,
      `${CAMINHO_BASE}/galeria`,
      `${CAMINHO_BASE}/info`,
    ]);
  });
});

describe("o próprio guarda da enumeração", () => {
  // Autoteste: se estes guardas passarem a devolver em vez de lançar, o
  // teste de cima fica a passar sobre exports que nunca exercitou — e
  // ninguém dava por isso.
  it("um export fora da tabela não é saltado: rebenta", () => {
    // "enviarFoto" entrou na tabela com a F3-05 (correção do Tomás, 6 de
    // novembro de 2026); o nome de autoteste mudou para um que continua a
    // não existir em lado nenhum, para o guarda continuar a provar o que
    // sempre provou.
    expect(() => argumentosPara("apagarFoto")).toThrow(/Não sei classificar/);
  });

  it("um export que não seja função rebenta", async () => {
    await expect(pedidoFeitoPor(["UMA_CONSTANTE", "/ementa"], [])).rejects.toThrow(
      /não é uma função/,
    );
  });

  it("uma função que não devolva uma promessa rebenta", async () => {
    await expect(pedidoFeitoPor(["naoPede", () => undefined], [])).rejects.toThrow(
      /não devolveu uma promessa/,
    );
  });

  it("uma função que não use o cliente rebenta em vez de passar", async () => {
    await expect(pedidoFeitoPor(["naoUsaOCliente", () => Promise.resolve()], [])).rejects.toThrow(
      /fez 0 pedidos/,
    );
  });
});
