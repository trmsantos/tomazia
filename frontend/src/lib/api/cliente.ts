/**
 * O cliente HTTP do site. Todo o `fetch` do frontend passa por aqui.
 *
 * Três coisas são incondicionais, e nenhuma delas é por causa dos quatro
 * GETs públicos que existem hoje:
 *
 *  - **`X-Tomazia: 1` em todos os pedidos.** O que esta tarefa fixa é o
 *    *sítio* do cabeçalho, não a mutação. No dia em que a F2-05
 *    acrescentar o primeiro `POST`, o cabeçalho já lá está por construção,
 *    em vez de depender de alguém se lembrar dele. E um cabeçalho
 *    condicional («só nas mutações») seria hoje um ramo que nenhum teste
 *    consegue cobrir, porque não há mutação nenhuma para o percorrer.
 *  - **`credentials: "include"`.** Mesma razão: a sessão de admin (F2-04)
 *    chega num cookie, e a decisão de o enviar não pode ficar pendurada de
 *    cada chamada.
 *  - **URL sempre relativa** (`/api/…`). A CSP de produção
 *    (`deploy/htaccess.exemplo`) serve `connect-src 'self'`: uma origem
 *    absoluta, mesmo que fosse a nossa, era bloqueada **só no servidor** —
 *    funcionava na máquina de quem a escreveu e partia onde ninguém está a
 *    olhar. É exatamente o modo de falha que o ADR 0008 já castigou.
 *
 * E três estados que têm de ser distinguíveis por quem chama — é a regra
 * 10 do `CLAUDE.md` dentro do cliente, porque «não houve resposta» e «o
 * servidor disse que não» não podem chegar iguais:
 *
 *  | o que aconteceu            | o que `pedir` lança                          |
 *  | -------------------------- | -------------------------------------------- |
 *  | rede, DNS, servidor fora   | `ErroDaApi` com `estado === null`            |
 *  | prazo esgotado (`timeout`) | `ErroDaApi` com `estado === null`            |
 *  | resposta não-2xx           | `ErroDaApi` com `estado` igual ao código HTTP |
 *  | `abort()` de quem chamou   | o erro original (**não** é `ErroDaApi`)      |
 *
 * O prazo esgotado está na primeira linha e não na última de propósito,
 * apesar de também chegar por um `AbortSignal`: ninguém o pediu, é o
 * servidor que não respondeu a tempo, e o ecrã tem de o mostrar como
 * erro. Ver `nomeDaAbortagem`, mais abaixo, para como se separam os dois.
 *
 * O cancelamento sai tal como veio, e de propósito: um `useEffect` a
 * desmontar cancela o pedido, e se isso chegasse como `ErroDaApi` o ecrã
 * mostrava uma mensagem de erro por ter mudado de página. Quem apanha
 * `erro instanceof ErroDaApi` trata erros; o resto é cancelamento.
 *
 * Um corpo que não seja JSON — a página de erro em HTML que o Apache serve
 * quando o Passenger está em baixo — chega como `ErroDaApi` legível, nunca
 * como `SyntaxError` do `JSON.parse`. E o corpo em bruto nunca entra na
 * mensagem: não se põe HTML de origem desconhecida num ecrã.
 */

/**
 * O prefixo de todas as rotas. Em produção é o `SCRIPT_NAME` que o
 * Passenger passa ao backend (que declara as rotas sem ele); em
 * desenvolvimento é o `proxy` do `vite.config.ts`, que o tira outra vez
 * antes de bater no uvicorn.
 */
export const CAMINHO_BASE = "/api";

/**
 * O que quem chama pode mandar.
 *
 * `metodo` e `corpo` chegaram com a F3-05 — o primeiro `POST` do cliente
 * (`POST /fotos`, herança da F2-06), exactamente como o ADR 0012 previu:
 * "quem acrescentar o primeiro `POST` acrescenta o método e o corpo com o
 * teste que os prova". Por omissão o método continua a ser `GET`.
 */
export type OpcoesDePedido = {
  sinal?: AbortSignal;
  metodo?: "GET" | "POST";
  /**
   * `FormData` vai tal e qual para `body`, **sem** `Content-Type` posto à
   * mão: é o browser que o escreve, com a fronteira. Um `Content-Type` de
   * multipart escrito à mão, sem a fronteira que só o browser sabe gerar,
   * dá `400` (medido na F2-06). Um objeto comum serializa com
   * `JSON.stringify` e leva `Content-Type: application/json`.
   */
  corpo?: FormData | Record<string, unknown>;
};

/** Cabeçalhos de todos os pedidos. Ver o cabeçalho do módulo. */
const CABECALHOS = {
  "X-Tomazia": "1",
  Accept: "application/json",
} as const;

type DetalhesDoErro = {
  estado: number | null;
  codigo: string | null;
  causa?: unknown;
  /** O espelho do `extra` de `app/erros.py`. `{}` quando não há nada a mais. */
  extra?: Record<string, unknown>;
  /** O espelho do `cabecalhos` de `app/erros.py`, em minúsculas. `{}` por omissão. */
  cabecalhos?: Record<string, string>;
};

/**
 * Uma falha que veio da API (ou da falta dela).
 *
 * `estado` a `null` quer dizer **não houve resposta nenhuma**: rede, DNS,
 * servidor em baixo. Não quer dizer «o servidor respondeu sem código».
 * `codigo` é o campo `erro` do envelope do backend
 * (`{"erro": "…", "mensagem": "…"}`), quando ele existir — e `null` quando
 * o que veio não foi esse envelope, como numa página de erro do Apache.
 *
 * `extra` e `cabecalhos` chegaram com a F3-05: são o espelho dos campos do
 * mesmo nome em `app/erros.py` — por exemplo, o `segundos_em_falta` e o
 * `Retry-After` do `429` do limite de envios (S-07, ADR 0018). **Nunca
 * `undefined`**: um ecrã que lesse `erro.extra.segundos_em_falta` sem saber
 * se `extra` existe escrevia uma guarda a mais para um caso que não pode
 * acontecer.
 */
export class ErroDaApi extends Error {
  readonly estado: number | null;
  readonly codigo: string | null;
  readonly extra: Record<string, unknown>;
  readonly cabecalhos: Record<string, string>;

  constructor(mensagem: string, detalhes: DetalhesDoErro) {
    super(mensagem, { cause: detalhes.causa });
    this.name = "ErroDaApi";
    this.estado = detalhes.estado;
    this.codigo = detalhes.codigo;
    this.extra = detalhes.extra ?? {};
    this.cabecalhos = detalhes.cabecalhos ?? {};
  }
}

/**
 * O nome do erro que abortou o pedido, ou `null` se não houve abortagem.
 *
 * **Um sinal abortado não é só um sinal abortado.** `AbortSignal.timeout()`
 * — a forma padrão de pôr um prazo num `fetch`, e a que os ecrãs vão
 * querer — também põe `aborted === true`, mas com `reason.name ===
 * "TimeoutError"` em vez de `"AbortError"` (medido). Olhar só para o
 * `aborted` classificava um prazo esgotado como «fui eu que cancelei», o
 * erro saía cru em vez de `ErroDaApi`, e um ecrã que apanhasse
 * `instanceof ErroDaApi` ficava em «a carregar» para sempre. Um prazo
 * esgotado é **não houve resposta**, não é um cancelamento.
 *
 * A ordem é: primeiro o `reason` do sinal (é quem sabe porque abortou),
 * depois o nome do erro que o `fetch` rejeitou, e por fim — para um
 * `abort("texto")`, cujo `reason` não é um `Error` — a abortagem conta
 * como cancelamento, que é o que ela é.
 */
function nomeDaAbortagem(erro: unknown, sinal: AbortSignal | undefined): string | null {
  if (sinal?.aborted === true) {
    const razao: unknown = sinal.reason;
    if (razao instanceof Error) return razao.name;
    return "AbortError";
  }
  if (erro instanceof Error && (erro.name === "AbortError" || erro.name === "TimeoutError")) {
    return erro.name;
  }
  return null;
}

/** Só o cancelamento a sério sai cru por `pedir`; o prazo esgotado não. */
function foiCancelado(erro: unknown, sinal: AbortSignal | undefined): boolean {
  return nomeDaAbortagem(erro, sinal) === "AbortError";
}

/** O prazo esgotou? É um erro da API, com `estado: null`. */
function foiPrazoEsgotado(erro: unknown, sinal: AbortSignal | undefined): boolean {
  return nomeDaAbortagem(erro, sinal) === "TimeoutError";
}

type Interpretacao = { interpretou: true; valor: unknown } | { interpretou: false };

/** `JSON.parse` que devolve a falha em vez de a lançar. */
function interpretarJson(texto: string): Interpretacao {
  try {
    return { interpretou: true, valor: JSON.parse(texto) as unknown };
  } catch {
    return { interpretou: false };
  }
}

/** Os cabeçalhos de uma resposta, em minúsculas. `{}` quando não há nenhum. */
function cabecalhosDaResposta(headers: Headers): Record<string, string> {
  const registo: Record<string, string> = {};
  headers.forEach((valor, nome) => {
    registo[nome.toLowerCase()] = valor;
  });
  return registo;
}

/**
 * Os campos do envelope além de `erro`/`mensagem` — o espelho do `extra` de
 * `app/erros.py`. Só se chama quando já se confirmou que o corpo *é* o
 * envelope (regra 10: um corpo qualquer sem envelope não tem "extra", tem
 * um formato que não se reconhece).
 */
function extraDoEnvelope(corpo: unknown): Record<string, unknown> {
  if (typeof corpo !== "object" || corpo === null) return {};
  const resto: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(corpo as Record<string, unknown>)) {
    if (chave !== "erro" && chave !== "mensagem") resto[chave] = valor;
  }
  return resto;
}

type EnvelopeDeErro = { codigo: string | null; mensagem: string | null };

/** Lê `{"erro": "…", "mensagem": "…"}`, ou `null` se o corpo não for isso. */
function lerEnvelopeDeErro(corpo: unknown): EnvelopeDeErro | null {
  if (typeof corpo !== "object" || corpo === null) return null;

  const registo = corpo as Record<string, unknown>;
  const codigo =
    typeof registo.erro === "string" && registo.erro.trim() !== "" ? registo.erro : null;
  const mensagem =
    typeof registo.mensagem === "string" && registo.mensagem.trim() !== ""
      ? registo.mensagem
      : null;

  if (codigo === null && mensagem === null) return null;
  return { codigo, mensagem };
}

/**
 * A frase para quando o servidor recusa sem o envelope do backend — uma
 * página de erro do Apache, um 502 do Passenger, um corpo vazio. Nunca
 * inclui o corpo recebido.
 */
function mensagemPorEstado(estado: number): string {
  if (estado === 404) return "Não encontrei isto no servidor.";
  if (estado === 401 || estado === 403) return "Não tens acesso a isto. Entra outra vez.";
  if (estado === 429) return "Pedidos a mais em pouco tempo. Espera um bocado e tenta outra vez.";
  if (estado >= 500) return "O servidor teve um problema. Tenta outra vez dentro de momentos.";
  return "O servidor recusou o pedido.";
}

/**
 * Faz um pedido a `CAMINHO_BASE + caminho` e devolve o JSON já interpretado.
 *
 * Por omissão é um GET, sem corpo — ainda é o único método que a maioria
 * das chamadas deste cliente precisa. `opcoes.metodo` e `opcoes.corpo`
 * chegaram com a F3-05 (o primeiro `POST`, `POST /fotos`, herança da
 * F2-06): é o que o ADR 0012 previu — "quem acrescentar o primeiro `POST`
 * acrescenta o método e o corpo com o teste que os prova" — e esse teste é
 * `cliente.test.ts`. Ver `OpcoesDePedido` para o que cada um faz.
 *
 * O `T` não é verificado em tempo de execução — nem com `zod` nem com nada:
 * quem o fixa é o `src/lib/api/publico.ts`, que o tira dos tipos gerados a
 * partir do OpenAPI do próprio backend.
 */
export async function pedir<T>(caminho: string, opcoes?: OpcoesDePedido): Promise<T> {
  const sinal = opcoes?.sinal;
  const corpoPedido = opcoes?.corpo;

  /*
   * `X-Tomazia` e `Accept` vão sempre, **postos antes do ramo** — o ramo do
   * corpo só faz `set` do que falta. É o que torna a armadilha do multipart
   * impossível em vez de improvável: o ramo do `FormData` não escreve
   * `Content-Type` nenhum — a chave não existe, nunca `undefined` — porque
   * nunca lhe toca. Um `headers: { ...CABECALHOS, "Content-Type": tipo }`
   * com `tipo` por vezes `undefined` poria a *string* `"undefined"` no
   * cabeçalho em runtime; aqui isso não tem como acontecer.
   */
  const cabecalhosDoPedido: Record<string, string> = { ...CABECALHOS };
  let corpoHttp: FormData | string | undefined;

  if (corpoPedido instanceof FormData) {
    corpoHttp = corpoPedido;
  } else if (corpoPedido !== undefined) {
    cabecalhosDoPedido["Content-Type"] = "application/json";
    corpoHttp = JSON.stringify(corpoPedido);
  }

  let resposta: Response;
  try {
    resposta = await fetch(`${CAMINHO_BASE}${caminho}`, {
      method: opcoes?.metodo ?? "GET",
      headers: cabecalhosDoPedido,
      credentials: "include",
      signal: sinal,
      body: corpoHttp,
    });
  } catch (erro) {
    if (foiCancelado(erro, sinal)) throw erro;
    throw new ErroDaApi(
      foiPrazoEsgotado(erro, sinal)
        ? "O servidor demorou demasiado a responder. Tenta outra vez."
        : "Não consegui falar com o servidor. Verifica a ligação e tenta outra vez.",
      { estado: null, codigo: null, causa: erro },
    );
  }

  let texto: string;
  try {
    texto = await resposta.text();
  } catch (erro) {
    if (foiCancelado(erro, sinal)) throw erro;
    // Houve resposta (temos `status`), mas o corpo cortou-se a meio. Não é
    // o mesmo que não ter havido resposta nenhuma, e por isso leva estado.
    // Um prazo esgotado a meio do corpo cai aqui e **também** é `ErroDaApi`:
    // o que não pode acontecer, em caminho nenhum, é um prazo sair cru.
    throw new ErroDaApi("A resposta do servidor cortou-se a meio. Tenta outra vez.", {
      estado: resposta.status,
      codigo: null,
      causa: erro,
      cabecalhos: cabecalhosDaResposta(resposta.headers),
    });
  }

  const corpoDaResposta = interpretarJson(texto);

  if (!resposta.ok) {
    const envelope = corpoDaResposta.interpretou ? lerEnvelopeDeErro(corpoDaResposta.valor) : null;
    const extra =
      corpoDaResposta.interpretou && envelope !== null
        ? extraDoEnvelope(corpoDaResposta.valor)
        : {};
    throw new ErroDaApi(envelope?.mensagem ?? mensagemPorEstado(resposta.status), {
      estado: resposta.status,
      codigo: envelope?.codigo ?? null,
      extra,
      cabecalhos: cabecalhosDaResposta(resposta.headers),
    });
  }

  if (!corpoDaResposta.interpretou) {
    throw new ErroDaApi(
      "O servidor respondeu com sucesso mas o conteúdo não era JSON. Tenta outra vez.",
      { estado: resposta.status, codigo: null, cabecalhos: cabecalhosDaResposta(resposta.headers) },
    );
  }

  return corpoDaResposta.valor as T;
}
