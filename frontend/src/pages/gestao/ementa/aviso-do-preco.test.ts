/**
 * F4-02, decisão D3 (`docs/TAREFAS.md`, 2026-11-16) — que aviso leva uma mudança
 * de preço.
 *
 * Contrato (`src/pages/gestao/ementa/aviso-do-preco.ts`), puro e sem texto (os
 * textos são do dominio-bar e vivem no componente):
 *
 * ```ts
 * export function avisoDoPreco(
 *   anterior: number,
 *   novo: number,
 * ): { tipo: "oferta" | "subida" | "normal"; comDesfazer: boolean };
 * ```
 *
 *  - `novo === 0` (com `anterior > 0`) → `oferta`, com «Desfazer»;
 *  - `anterior > 0` e `novo >= 10 * anterior` → `subida`, com «Desfazer»;
 *  - o resto → `normal`, sem «Desfazer» (incluindo `anterior === 0`).
 *
 * A comparação é em inteiros: `novo >= 10 * anterior`, sem divisões nem vírgula
 * flutuante. `0 → 0` nunca chega aqui (sem pedido).
 */
import { describe, expect, it } from "vitest";

import { avisoDoPreco } from "./aviso-do-preco";

describe("avisoDoPreco", () => {
  it.each([
    [650, 0, "oferta", true],
    [1, 0, "oferta", true],
    [650, 6500, "subida", true],
    [650, 65_000, "subida", true],
    [1, 10, "subida", true],
    [100, 1000, "subida", true],
    [3, 30, "subida", true],
    [650, 6499, "normal", false],
    [3, 29, "normal", false],
    [650, 750, "normal", false],
    [650, 700, "normal", false],
    [650, 651, "normal", false],
    [650, 100, "normal", false],
    [0, 650, "normal", false],
    [0, 5000, "normal", false],
    [0, 2_147_483_647, "normal", false],
  ] as const)("%i → %i: %s, com «Desfazer»: %s", (anterior, novo, tipo, comDesfazer) => {
    expect(avisoDoPreco(anterior, novo)).toEqual({ tipo, comDesfazer });
  });

  it("a fronteira exata é 10 vezes, sem erro de vírgula flutuante perto de 2**31 - 1", () => {
    // 214 748 364 × 10 = 2 147 483 640 ≤ 2**31 - 1: é «subida».
    expect(avisoDoPreco(214_748_364, 2_147_483_640)).toEqual({ tipo: "subida", comDesfazer: true });
    // 214 748 364 × 10 = 2 147 483 640; menos 1 não chega.
    expect(avisoDoPreco(214_748_364, 2_147_483_639)).toEqual({
      tipo: "normal",
      comDesfazer: false,
    });
    // 214 748 365 × 10 = 2 147 483 650 > 2**31 - 1: nenhum valor válido chega lá.
    expect(avisoDoPreco(214_748_365, 2_147_483_647)).toEqual({
      tipo: "normal",
      comDesfazer: false,
    });
    // Um valor enorme a 0 continua a ser oferta.
    expect(avisoDoPreco(2_147_483_647, 0)).toEqual({ tipo: "oferta", comDesfazer: true });
  });

  it("descer nunca avisa de subida", () => {
    expect(avisoDoPreco(6500, 650).tipo).toBe("normal");
  });
});
