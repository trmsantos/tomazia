/**
 * F4-02, secção 4.3 de `docs/ecras/F4-02.md` — a função inversa de `formatarPreco`.
 *
 * Contrato (`src/lib/formato/ler-preco.ts`, **ficheiro à parte de `preco.ts`**: o
 * pacote público não o importa, Q-02):
 *
 * ```ts
 * export type LeituraDePreco =
 *   | { ok: true; precoCent: number }
 *   | { ok: false; motivo: "vazio" | "invalido" | "decimais" | "demasiado_grande" };
 * export function lerPreco(texto: string): LeituraDePreco;
 * ```
 *
 * Os quatro motivos (e não os três do plano) porque a especificação dá três
 * frases de erro **diferentes** para `abc`, `6,505` e `21474836,48` — sem um
 * motivo próprio para as casas decimais o ecrã não as distinguia.
 *
 * Aritmética de inteiros (`0,29` → 29, `1,1` → 110; nada de `Math.round(x * 100)`).
 * O ponto é decimal: `1.250` é erro (três casas), nunca 1 250 € nem 1,25 €.
 * Teto: `2**31 - 1` cêntimos.
 */
import { describe, expect, it } from "vitest";

import { lerPreco } from "./ler-preco";

describe("lerPreco: o que se aceita (tabela de 4.3)", () => {
  it.each([
    ["6", 600],
    ["6,", 600],
    ["6,5", 650],
    ["6,50", 650],
    ["6.5", 650],
    ["06,50", 650],
    ["0", 0],
    ["0,00", 0],
    ["6,50 €", 650],
    ["6,50 €", 650],
    [" 6,50", 650],
    ["  6,50  ", 650],
    ["0,29", 29],
    ["1,1", 110],
    ["0,07", 7],
    ["21474836,47", 2_147_483_647],
  ])("%j → %i cêntimos", (texto, esperado) => {
    expect(lerPreco(texto)).toEqual({ ok: true, precoCent: esperado });
  });

  it("devolve sempre um inteiro (nunca 28,999…)", () => {
    for (const texto of ["0,29", "1,1", "4,35", "8,2", "19,99", "0,58"]) {
      const leitura = lerPreco(texto);
      expect(leitura.ok).toBe(true);
      if (leitura.ok) expect(Number.isInteger(leitura.precoCent)).toBe(true);
    }
    expect(lerPreco("4,35")).toEqual({ ok: true, precoCent: 435 });
    expect(lerPreco("19,99")).toEqual({ ok: true, precoCent: 1999 });
  });
});

describe("lerPreco: o que se recusa, e porquê", () => {
  it.each([[""], ["   "], ["\t"], ["€"], [" € "]])("%j → vazio", (texto) => {
    expect(lerPreco(texto)).toEqual({ ok: false, motivo: "vazio" });
  });

  it.each([["abc"], ["6,5a"], ["-3"], ["1 250"], ["6,5,0"], ["+6"], ["1e3"], ["--"]])(
    "%j → invalido",
    (texto) => {
      expect(lerPreco(texto)).toEqual({ ok: false, motivo: "invalido" });
    },
  );

  it.each([["6,505"], ["1.250"], ["0,001"], ["6.505"]])("%j → decimais", (texto) => {
    expect(lerPreco(texto)).toEqual({ ok: false, motivo: "decimais" });
  });

  it.each([["21474836,48"], ["21474837"], ["99999999999"], ["99999999999999999999,99"]])(
    "%j → demasiado_grande",
    (texto) => {
      expect(lerPreco(texto)).toEqual({ ok: false, motivo: "demasiado_grande" });
    },
  );

  it("os quatro motivos são distintos entre si (regra 10: frases diferentes para erros diferentes)", () => {
    const motivos = ["", "abc", "6,505", "21474836,48"].map((texto) => {
      const leitura = lerPreco(texto);
      return leitura.ok ? "ok" : leitura.motivo;
    });
    expect(new Set(motivos).size).toBe(4);
  });
});
