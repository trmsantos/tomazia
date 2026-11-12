/**
 * O prazo de um pedido da gestão: 10 s, o mesmo das leituras da ementa
 * (F4-01, 3.7). O pedido é minúsculo; passado o prazo, «não houve resposta».
 *
 * Um `setTimeout` que aborta o controlador com um `TimeoutError`, e não
 * `AbortSignal.any`/`timeout`: o `any` só existe desde o Safari 17.4, e um
 * telemóvel de bar não tem de estar atualizado. O cliente da API já distingue
 * este aborto do cancelamento de quem desmonta (`ErroDaApi` com `estado: null`).
 *
 * Devolve a função que desarma o prazo: chama-se quando o pedido acaba.
 */
export const PRAZO_DO_PEDIDO_MS = 10_000;

export function armarPrazo(controlador: AbortController): () => void {
  const temporizador = setTimeout(() => {
    controlador.abort(new DOMException("O pedido demorou demasiado.", "TimeoutError"));
  }, PRAZO_DO_PEDIDO_MS);
  return () => {
    clearTimeout(temporizador);
  };
}
