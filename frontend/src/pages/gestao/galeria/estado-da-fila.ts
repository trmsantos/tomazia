import type { FotoPendente } from "../../../lib/api/gestao-fotos";

/**
 * O estado puro da fila de moderação (F4-04, spec 5 e 9.4). Nenhuma função lê o relógio nem o
 * DOM, nenhuma muda o que recebe, e a ordem é sempre a do servidor (a mais antiga primeiro):
 * o frontend nunca reordena.
 */

/**
 * Os botões da foto nova ficam inertes até a imagem carregar e este tempo passar desde o mais
 * tardio de «ficou visível» e «carregou» (spec 5.2): a foto seguinte aparece debaixo do dedo
 * que acabou de aprovar, e o segundo toque de um duplo toque não pode aprová-la.
 */
export const INTERVALO_CONTRA_DUPLO_TOQUE_MS = 700;

/** A foto à frente do dono: a primeira da fila. */
export function atual(fila: readonly FotoPendente[]): FotoPendente | null {
  return fila[0] ?? null;
}

/** A que se pré-carrega: só a segunda, nunca a fila inteira (dados móveis). */
export function seguinte(fila: readonly FotoPendente[]): FotoPendente | null {
  return fila[1] ?? null;
}

/** A fila sem a foto `id` (e igual se ela não está lá). */
export function retirar(fila: readonly FotoPendente[], id: number): FotoPendente[] {
  return fila.filter((foto) => foto.id !== id);
}

/**
 * A recarga silenciosa: o que ainda está pendente mantém o lugar que tinha na fila local (a
 * foto que o dono tem à frente não muda debaixo do dedo), o que é novo entra no fim pela ordem
 * do servidor, e o que já não está pendente sai.
 */
export function substituir(
  local: readonly FotoPendente[],
  recebida: readonly FotoPendente[],
): FotoPendente[] {
  const recebidas = new Set(recebida.map((foto) => foto.id));
  const conhecidas = new Set(local.map((foto) => foto.id));
  return [
    ...local.filter((foto) => recebidas.has(foto.id)),
    ...recebida.filter((foto) => !conhecidas.has(foto.id)),
  ];
}

export function contagem(fila: readonly FotoPendente[]): number {
  return fila.length;
}

export type Pedido = "aprovar" | "rejeitar";
export type Desfecho = "nada" | "aprovada" | "rejeitada";

/**
 * O que aconteceu à foto, perguntado à fila (`naFila`) e à galeria pública (`naGaleria`): o
 * resolvedor da regra 10 para o 409, o 404 e o «sem resposta». Na fila manda sempre (nunca se
 * conclui «aprovada» por uma galeria velha); fora da fila e na galeria, ficou aprovada; fora das
 * duas, rejeitada. O `pedido` não muda o resultado: diz-se o que **aconteceu**, e quem chama
 * compara com o que o dono quis.
 */
export function resolverDesfecho(_pedido: Pedido, naFila: boolean, naGaleria: boolean): Desfecho {
  if (naFila) return "nada";
  return naGaleria ? "aprovada" : "rejeitada";
}
