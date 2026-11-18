/**
 * A API dos eventos na gestão (F4-03): carregar as três listas, criar, alterar,
 * eliminar e duplicar um evento.
 *
 * **A superfície é exatamente estas cinco funções.** O cartaz (upload, trocar,
 * retirar) é da F4-07: nenhuma delas o leva, e o `PATCH` filtra a `imagem` mesmo
 * que o objeto a traga (o `extra="forbid"` do backend dava 422).
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa). Os erros
 * chegam como `ErroDaApi`: `estado === null` é «não houve resposta», e numa
 * mutação isso quer dizer **não sei se gravou** — por isso este módulo **nunca
 * repete** um pedido por conta própria (um `POST` repetido duplicava o evento).
 *
 * `obterEventosGestao` **recusa** um corpo que não sabe ler com um `ErroDaApi` de
 * estado 200: o ecrã mostra o erro de carregar e nunca «não há eventos» (regra 10).
 */
import { ErroDaApi, type OpcoesDePedido, pedir } from "./cliente";
import type { components, paths } from "./gerado/esquema";

const CAMINHO_EVENTOS = "/gestao/eventos" satisfies keyof paths;
const CAMINHO_EVENTO = "/gestao/eventos/{id}" satisfies keyof paths;
const CAMINHO_DUPLICAR = "/gestao/eventos/{id}/duplicar" satisfies keyof paths;

export type EventoGestao = components["schemas"]["EventoGestao"];
export type EventosGestao = components["schemas"]["RespostaEventosGestao"];
export type NovoEvento = components["schemas"]["PedidoCriarEvento"];
export type AlteracaoDeEvento = components["schemas"]["PedidoAlterarEvento"];

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function eTextoOuNulo(valor: unknown): boolean {
  return valor === null || typeof valor === "string";
}

/** Um `inicio` é `null` (só num rascunho) ou um texto que o `Date` sabe ler. */
function eInicioLegivel(valor: unknown): boolean {
  if (valor === null) return true;
  return typeof valor === "string" && !Number.isNaN(new Date(valor).getTime());
}

function eEventoLegivel(valor: unknown): boolean {
  return (
    eObjeto(valor) &&
    typeof valor["id"] === "number" &&
    typeof valor["titulo"] === "string" &&
    eInicioLegivel(valor["inicio"]) &&
    typeof valor["publicado"] === "boolean" &&
    eTextoOuNulo(valor["descricao"]) &&
    eTextoOuNulo(valor["imagem"])
  );
}

const ILEGIVEL = "Os eventos chegaram num formato que não se sabe ler.";

/** Lança se o corpo não for as três listas de eventos que o contrato descreve. */
function lerEventos(corpo: unknown): EventosGestao {
  if (!eObjeto(corpo)) throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
  for (const lista of ["proximos", "rascunhos", "arquivo"] as const) {
    const elementos = corpo[lista];
    if (!Array.isArray(elementos) || !elementos.every(eEventoLegivel)) {
      throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
    }
  }
  return corpo as EventosGestao;
}

/** `GET /api/gestao/eventos` — próximos, rascunhos e arquivo, divididos pelo servidor. */
export async function obterEventosGestao(opcoes?: OpcoesDePedido): Promise<EventosGestao> {
  return lerEventos(await pedir<unknown>(CAMINHO_EVENTOS, opcoes));
}

/** `POST /api/gestao/eventos` — 201. O corpo é construído chave a chave; a descrição vazia omite-se. */
export function criarEvento(novo: NovoEvento, opcoes?: OpcoesDePedido): Promise<EventoGestao> {
  const corpo: Record<string, unknown> = {
    titulo: novo.titulo,
    inicio: novo.inicio,
    publicado: novo.publicado,
  };
  if (novo.descricao !== undefined && novo.descricao !== null && novo.descricao !== "") {
    corpo["descricao"] = novo.descricao;
  }
  return pedir<EventoGestao>(CAMINHO_EVENTOS, { ...opcoes, metodo: "POST", corpo });
}

/**
 * `PATCH /api/gestao/eventos/{id}` — só as chaves que o chamador deu, e só as
 * quatro que o contrato conhece. `null` só passa na `descricao` (é a forma de a
 * limpar): `inicio: null` dava 422 e a `imagem` nunca se manda.
 */
export function alterarEvento(
  id: number,
  alteracao: AlteracaoDeEvento,
  opcoes?: OpcoesDePedido,
): Promise<EventoGestao> {
  const corpo: Record<string, unknown> = {};
  for (const chave of ["titulo", "inicio", "descricao", "publicado"] as const) {
    const valor: unknown = alteracao[chave];
    if (valor === undefined) continue;
    if (valor === null && chave !== "descricao") continue;
    corpo[chave] = valor;
  }
  return pedir<EventoGestao>(CAMINHO_EVENTO.replace("{id}", String(id)), {
    ...opcoes,
    metodo: "PATCH",
    corpo,
  });
}

/** `DELETE /api/gestao/eventos/{id}` — 204. */
export async function eliminarEvento(id: number, opcoes?: OpcoesDePedido): Promise<void> {
  await pedir<undefined>(CAMINHO_EVENTO.replace("{id}", String(id)), {
    ...opcoes,
    metodo: "DELETE",
    semCorpo: true,
  });
}

/**
 * `POST /api/gestao/eventos/{id}/duplicar` — 201, um rascunho novo. Com `semanas`
 * leva `{ semanas }` (a n-ésima data livre da série semanal do original); com `null`
 * (um original sem data) **não leva corpo nenhum**.
 */
export function duplicarEvento(
  id: number,
  semanas: 1 | 2 | 3 | 4 | null,
  opcoes?: OpcoesDePedido,
): Promise<EventoGestao> {
  const caminho = CAMINHO_DUPLICAR.replace("{id}", String(id));
  if (semanas === null) return pedir<EventoGestao>(caminho, { ...opcoes, metodo: "POST" });
  return pedir<EventoGestao>(caminho, { ...opcoes, metodo: "POST", corpo: { semanas } });
}
