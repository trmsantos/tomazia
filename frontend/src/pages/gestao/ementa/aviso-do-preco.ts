/**
 * Que aviso leva uma mudança de preço (F4-02, decisão D3 do Tomás, 2026-11-16).
 *
 * Puro e sem texto: as frases são do dominio-bar e vivem no componente.
 *
 *  - `novo === 0` (com `anterior > 0`) → `oferta`, com «Desfazer»: um `0`
 *    publica «Oferta» na ementa pública, e é o engano de digitação mais caro;
 *  - `anterior > 0` e `novo >= 10 * anterior` → `subida`, com «Desfazer»: escrever
 *    `650` por `6,50` publica 650,00 €;
 *  - o resto → `normal`, sem «Desfazer» — incluindo `anterior === 0`: de oferta
 *    para um preço não há múltiplo que faça sentido, e é o caminho normal de
 *    corrigir uma oferta.
 *
 * A comparação é em inteiros (`novo >= 10 * anterior`, sem divisões): perto de
 * `2**31 - 1` a multiplicação ainda é exata (os inteiros seguros vão a 2**53).
 * `0 → 0` nunca chega aqui: não faz pedido.
 */
export type AvisoDePreco = { tipo: "oferta" | "subida" | "normal"; comDesfazer: boolean };

export function avisoDoPreco(anterior: number, novo: number): AvisoDePreco {
  if (novo === 0 && anterior > 0) return { tipo: "oferta", comDesfazer: true };
  if (anterior > 0 && novo >= 10 * anterior) return { tipo: "subida", comDesfazer: true };
  return { tipo: "normal", comDesfazer: false };
}
