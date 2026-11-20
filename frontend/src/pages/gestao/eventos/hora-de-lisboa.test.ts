/**
 * F4-03, plano 4 e spec 7.2 — a hora de parede do campo ↔ o instante, **sempre em Lisboa**,
 * com o fuso do aparelho a variar.
 *
 * Contrato (`hora-de-lisboa.ts`, plano 4.1):
 *
 * ```ts
 * export function paraCampo(inicio: string): string;   // "2026-11-20T22:00"; segundos descartados
 * export type LeituraDoCampo =
 *   | { ok: true; inicio: string }                      // "2026-11-20T22:00:00Z"
 *   | { ok: false; motivo: "vazio" | "incompleto" | "invalido" | "inexistente" | "fora_do_intervalo" };
 * export function deCampo(valor: string, incompleto: boolean): LeituraDoCampo;
 * ```
 *
 * O ecrã tem dois campos (`date` e `time`, spec 7.1) e junta-os em `"AAAA-MM-DDTHH:MM"` antes de
 * chamar `deCampo`; a tradução dos motivos em erros por campo está em `formulario.test.ts`.
 *
 * **Regra 10:** o guarda do `TZ` (`src/testes/fuso.ts`) rebenta se a troca de fuso não pegar. A
 * hora inexistente (29/03, 01:00–01:59) é **erro**, nunca uma hora inventada; a repetida
 * (25/10, 01:00–01:59) é a **primeira**, como o `duplicar` do backend (`fold=0`;
 * `backend/tests/gestao/test_duplicar.py`; o outro lado da mesma tabela, em UTC, está em
 * `src/lib/formato/data-do-evento.test.ts`).
 *
 * **Deixa passar:** o `<input>` a sério (e2e, `timezoneId`).
 */
import { describe, expect, it } from "vitest";

import { FUSOS_DO_APARELHO, comOFusoDoAparelhoEm } from "../../../testes/fuso";
import { deCampo, paraCampo } from "./hora-de-lisboa";

function ok(inicio: string) {
  return { ok: true, inicio };
}
function erro(motivo: string) {
  return { ok: false, motivo };
}

/** parede de Lisboa → instante UTC esperado (ou o motivo do erro). */
const CASOS_DE_CAMPO: ReadonlyArray<readonly [string, string, unknown]> = [
  ["inverno", "2026-11-20T22:00", ok("2026-11-20T22:00:00Z")],
  ["verão: 22:00 de Lisboa são 21:00Z", "2026-07-02T22:00", ok("2026-07-02T21:00:00Z")],
  ["meia-noite no inverno", "2026-11-20T00:00", ok("2026-11-20T00:00:00Z")],
  ["00:30 no inverno", "2026-11-20T00:30", ok("2026-11-20T00:30:00Z")],
  [
    "00:30 no verão (o instante é do dia anterior em UTC)",
    "2026-07-15T00:30",
    ok("2026-07-14T23:30:00Z"),
  ],
  ["segundos do campo descartam-se", "2026-11-20T22:00:30", ok("2026-11-20T22:00:00Z")],
  ["salto de março: 00:59 ainda é hora de inverno", "2026-03-29T00:59", ok("2026-03-29T00:59:00Z")],
  ["salto de março: 01:00 não existe", "2026-03-29T01:00", erro("inexistente")],
  ["salto de março: 01:30 não existe", "2026-03-29T01:30", erro("inexistente")],
  ["salto de março: 01:59 não existe", "2026-03-29T01:59", erro("inexistente")],
  ["salto de março: 02:00 é 01:00Z", "2026-03-29T02:00", ok("2026-03-29T01:00:00Z")],
  ["salto de março: 02:30 é 01:30Z", "2026-03-29T02:30", ok("2026-03-29T01:30:00Z")],
  ["recuo de outubro: 00:59 ainda é verão", "2026-10-25T00:59", ok("2026-10-24T23:59:00Z")],
  [
    "recuo de outubro: 01:00 repete-se, fica a primeira",
    "2026-10-25T01:00",
    ok("2026-10-25T00:00:00Z"),
  ],
  [
    "recuo de outubro: 01:30 repete-se, fica a primeira",
    "2026-10-25T01:30",
    ok("2026-10-25T00:30:00Z"),
  ],
  ["recuo de outubro: 02:00 é a hora de inverno", "2026-10-25T02:00", ok("2026-10-25T02:00:00Z")],
  ["31 de fevereiro", "2026-02-31T22:00", erro("invalido")],
  ["29 de fevereiro num ano que não é bissexto", "2026-02-29T22:00", erro("invalido")],
  ["mês 13", "2026-13-01T10:00", erro("invalido")],
  ["hora 24", "2026-11-20T24:00", erro("invalido")],
  ["minuto 60", "2026-11-20T22:60", erro("invalido")],
  ["hora sem zero (um browser sem datetime-local)", "2026-11-20T7:30", erro("invalido")],
  ["só a hora", "7:30", erro("invalido")],
  ["texto", "amanhã à noite", erro("invalido")],
  ["ano 1969", "1969-12-31T22:00", erro("fora_do_intervalo")],
  ["ano 9001", "9001-01-01T12:00", erro("fora_do_intervalo")],
];

describe.each(FUSOS_DO_APARELHO)("deCampo, com o aparelho em %s", (fuso) => {
  it.each(CASOS_DE_CAMPO)("%s (%s)", (_nome, parede, esperado) => {
    comOFusoDoAparelhoEm(fuso, () => {
      expect(deCampo(parede, false)).toEqual(esperado);
    });
  });

  it("vazio e incompleto são coisas diferentes (regra 10: «não escreveu» ≠ «escreveu metade»)", () => {
    comOFusoDoAparelhoEm(fuso, () => {
      expect(deCampo("", false)).toEqual(erro("vazio"));
      expect(deCampo("", true)).toEqual(erro("incompleto"));
    });
  });

  it("`incompleto` ganha a um valor que parece bom (o browser pode devolver a data sem a hora)", () => {
    comOFusoDoAparelhoEm(fuso, () => {
      expect(deCampo("2026-11-20T22:00", true)).toEqual(erro("incompleto"));
    });
  });
});

describe.each(FUSOS_DO_APARELHO)("paraCampo, com o aparelho em %s", (fuso) => {
  it.each([
    ["inverno", "2026-11-20T22:00:00Z", "2026-11-20T22:00"],
    ["verão (21:00Z é 22:00)", "2026-07-02T21:00:00Z", "2026-07-02T22:00"],
    [
      "muda o dia em Lisboa (23:30Z de verão é 00:30 do dia seguinte)",
      "2026-07-14T23:30:00Z",
      "2026-07-15T00:30",
    ],
    ["segundos descartam-se", "2026-11-20T22:00:30Z", "2026-11-20T22:00"],
    [
      "deslocamento +00:00, como o backend o escreve",
      "2026-11-05T22:00:00+00:00",
      "2026-11-05T22:00",
    ],
    [
      "deslocamento +01:00 (outra escrita do mesmo instante)",
      "2026-07-02T22:00:00+01:00",
      "2026-07-02T22:00",
    ],
    ["zeros à esquerda: 01:05 de 3 de janeiro", "2027-01-03T01:05:00Z", "2027-01-03T01:05"],
    ["a segunda 01:30 de outubro (01:30Z) lê-se 01:30", "2026-10-25T01:30:00Z", "2026-10-25T01:30"],
  ])("%s", (_nome, inicio, campo) => {
    comOFusoDoAparelhoEm(fuso, () => {
      expect(paraCampo(inicio)).toBe(campo);
    });
  });
});

describe("ida e volta nos dias de mudança de hora", () => {
  function paredes(dia: string): string[] {
    const saida: string[] = [];
    for (let h = 0; h < 24; h += 1) {
      for (let m = 0; m < 60; m += 15) {
        saida.push(`${dia}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return saida;
  }

  it.each(FUSOS_DO_APARELHO)(
    "29 de março (o relógio avança): válidas voltam iguais; 01:00–01:59 são erro (%s)",
    (fuso) => {
      comOFusoDoAparelhoEm(fuso, () => {
        for (const parede of paredes("2026-03-29")) {
          const leitura = deCampo(parede, false);
          const hora = Number(parede.slice(11, 13));
          if (hora === 1) {
            expect(leitura, parede).toEqual(erro("inexistente"));
          } else {
            expect(leitura.ok, parede).toBe(true);
            if (leitura.ok) expect(paraCampo(leitura.inicio), parede).toBe(parede);
          }
        }
      });
    },
  );

  it.each(FUSOS_DO_APARELHO)(
    "25 de outubro (o relógio recua): todas válidas e voltam iguais; a repetida fica a primeira (%s)",
    (fuso) => {
      comOFusoDoAparelhoEm(fuso, () => {
        for (const parede of paredes("2026-10-25")) {
          const leitura = deCampo(parede, false);
          expect(leitura.ok, parede).toBe(true);
          if (!leitura.ok) continue;
          expect(paraCampo(leitura.inicio), parede).toBe(parede);
          if (parede.slice(11, 13) === "01") {
            expect(leitura.inicio, `${parede} é a primeira ocorrência`).toMatch(/^2026-10-25T00:/);
          }
        }
      });
    },
  );
});

describe("o resultado nunca depende do fuso do aparelho", () => {
  it("os casos todos dão o mesmo nos cinco fusos", () => {
    const porFuso = FUSOS_DO_APARELHO.map((fuso) => {
      let r: unknown[] = [];
      comOFusoDoAparelhoEm(fuso, () => {
        r = CASOS_DE_CAMPO.map(([, parede]) => deCampo(parede, false));
      });
      return JSON.stringify(r);
    });
    expect(new Set(porFuso).size).toBe(1);
  });
});
