/**
 * Um `fetch` falso para os testes do cliente da API.
 *
 * Mínimo de propósito: devolve só o que `src/lib/api/cliente.ts` lê de uma
 * resposta (`ok`, `status`, `text()`). Construir uma `Response` a sério
 * obrigava a depender de uma implementação de `fetch` no ambiente de
 * testes, e tornava difícil a parte que mais interessa — simular um corpo
 * que **não** é JSON (a página de erro em HTML que o Apache serve quando o
 * Passenger está em baixo) e uma rejeição de rede.
 *
 * Só para testes; nada em produção o importa.
 */

/** O que o cliente mandou, já com os cabeçalhos normalizados. */
export type PedidoObservado = {
  url: string;
  opcoes: RequestInit | undefined;
  cabecalhos: Record<string, string>;
};

/**
 * Normaliza os cabeçalhos para um registo em minúsculas, venham eles como
 * objeto simples, como pares, ou como `Headers`. O teste não tem de saber
 * qual das três formas o cliente usa — e continua a valer se mudar.
 */
export function cabecalhosDe(opcoes: RequestInit | undefined): Record<string, string> {
  const normalizados: Record<string, string> = {};
  const crus = opcoes?.headers;
  if (crus === undefined) return normalizados;

  if (Array.isArray(crus)) {
    for (const par of crus) {
      const [nome, valor] = par;
      if (nome !== undefined && valor !== undefined) normalizados[nome.toLowerCase()] = valor;
    }
    return normalizados;
  }

  if (typeof (crus as Headers).forEach === "function") {
    (crus as Headers).forEach((valor, nome) => {
      normalizados[nome.toLowerCase()] = valor;
    });
    return normalizados;
  }

  for (const [nome, valor] of Object.entries(crus as Record<string, string>)) {
    normalizados[nome.toLowerCase()] = valor;
  }
  return normalizados;
}

/**
 * Uma resposta com o mínimo que o cliente lê.
 *
 * `cabecalhos` é opcional e serve o `429` da F3-05: o `Retry-After` vem no
 * cabeçalho, não no corpo (ADR 0018, S-07), e `ErroDaApi.cabecalhos` é quem
 * o expõe a quem chama — um `Headers` real, não um objeto simples, porque é
 * isso que `cliente.ts` recebe de um `fetch` a sério.
 */
export function respostaDe(estado: number, corpo: string, cabecalhos?: Record<string, string>) {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    text: () => Promise.resolve(corpo),
    headers: new Headers(cabecalhos ?? {}),
  };
}

/** Atalho para a resposta feliz: 200 com um corpo JSON. */
export function respostaJson(valor: unknown, estado = 200) {
  return respostaDe(estado, JSON.stringify(valor));
}

/**
 * Um `fetch` falso que regista cada pedido e devolve (ou lança) o que o
 * `responder` disser. Lançar de dentro do `responder` simula a rejeição do
 * `fetch`: rede em baixo, DNS, ou o `AbortError` de um cancelamento.
 */
export function criarFetchFalso(responder: (pedido: PedidoObservado) => unknown) {
  const pedidos: PedidoObservado[] = [];

  const falso = (entrada: unknown, opcoes?: RequestInit): Promise<unknown> => {
    const pedido: PedidoObservado = {
      url: String(entrada),
      opcoes,
      cabecalhos: cabecalhosDe(opcoes),
    };
    pedidos.push(pedido);
    try {
      return Promise.resolve(responder(pedido));
    } catch (erro) {
      return Promise.reject(erro);
    }
  };

  return { falso, pedidos };
}
