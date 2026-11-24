/**
 * A API da moderação de fotos na gestão (F4-04): carregar a fila, aprovar, rejeitar e o
 * endereço da imagem de uma foto à espera.
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa). Os erros chegam como
 * `ErroDaApi`: `estado === null` é «não houve resposta», e numa mutação isso quer dizer **não sei
 * se resultou** — por isso este módulo **nunca repete** um pedido por conta própria (repetir um
 * `POST` de moderação é decisão do dono, não do código).
 *
 * `obterFilaDeModeracao` **recusa** um corpo que não sabe ler com um `ErroDaApi` de estado 200:
 * o ecrã mostra o erro de carregar e nunca «não há fotos» (regra 10).
 *
 * A superfície não é fechada: a F4-04b junta aqui `obterAprovadas` e `eliminarFoto`.
 */
import { CAMINHO_BASE, ErroDaApi, type OpcoesDePedido, pedir } from "./cliente";
import type { components, paths } from "./gerado/esquema";

const CAMINHO_FILA = "/gestao/fotos" satisfies keyof paths;
const CAMINHO_APROVAR = "/gestao/fotos/{id}/aprovar" satisfies keyof paths;
const CAMINHO_REJEITAR = "/gestao/fotos/{id}/rejeitar" satisfies keyof paths;
const CAMINHO_IMAGEM = "/gestao/fotos/{id}/imagem" satisfies keyof paths;

export type FotoPendente = components["schemas"]["FotoPendente"];
export type FilaDeModeracao = components["schemas"]["RespostaFilaDeModeracao"];
export type RespostaModeracao = components["schemas"]["RespostaModeracao"];

const ILEGIVEL = "As fotos chegaram num formato que não se sabe ler.";

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function eTextoOuNulo(valor: unknown): boolean {
  return valor === null || typeof valor === "string";
}

/** Um `criada_em` é um texto que o `Date` sabe ler. */
function eInstanteLegivel(valor: unknown): boolean {
  return typeof valor === "string" && !Number.isNaN(new Date(valor).getTime());
}

function eFotoLegivel(valor: unknown): boolean {
  return (
    eObjeto(valor) &&
    typeof valor["id"] === "number" &&
    typeof valor["ficheiro"] === "string" &&
    eInstanteLegivel(valor["criada_em"]) &&
    eTextoOuNulo(valor["descricao"]) &&
    eTextoOuNulo(valor["enviada_por"])
  );
}

/** Lança se o corpo não for a lista de fotos que o contrato descreve. */
function lerFila(corpo: unknown): FilaDeModeracao {
  if (!eObjeto(corpo)) throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
  const fotos = corpo["fotos"];
  if (!Array.isArray(fotos) || !fotos.every(eFotoLegivel)) {
    throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
  }
  return corpo as FilaDeModeracao;
}

/** Só um inteiro positivo entra num caminho: nada de `../` nem de `NaN` num endereço. */
function exigirId(id: number): string {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new RangeError("O id de uma foto é um inteiro positivo.");
  }
  return String(id);
}

/** `GET /api/gestao/fotos` — todas as pendentes, a mais antiga primeiro. */
export async function obterFilaDeModeracao(opcoes?: OpcoesDePedido): Promise<FilaDeModeracao> {
  return lerFila(await pedir<unknown>(CAMINHO_FILA, opcoes));
}

/** `POST /api/gestao/fotos/{id}/aprovar` — 200; 409 se já foi moderada. Sem corpo. */
export function aprovarFoto(id: number, opcoes?: OpcoesDePedido): Promise<RespostaModeracao> {
  return pedir<RespostaModeracao>(CAMINHO_APROVAR.replace("{id}", exigirId(id)), {
    ...opcoes,
    metodo: "POST",
  });
}

/** `POST /api/gestao/fotos/{id}/rejeitar` — 200; apaga os bytes; 409 se já foi moderada. Sem corpo. */
export function rejeitarFoto(id: number, opcoes?: OpcoesDePedido): Promise<RespostaModeracao> {
  return pedir<RespostaModeracao>(CAMINHO_REJEITAR.replace("{id}", exigirId(id)), {
    ...opcoes,
    metodo: "POST",
  });
}

/**
 * O endereço da imagem, para um `<img src>`: leva a sessão (cookie, mesma origem). Não se vai
 * buscar como `blob:` (a CSP de produção é `img-src 'self' data:`) nem passa pelo `pedir`, que
 * só lê JSON.
 */
export function enderecoDaImagem(id: number): string {
  return `${CAMINHO_BASE}${CAMINHO_IMAGEM.replace("{id}", exigirId(id))}`;
}
