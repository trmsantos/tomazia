/**
 * F4-03, spec 4.4 e plano 2.1 — a data como a linha do evento a mostra.
 *
 * Contrato (`data-na-gestao.ts`): função pura, o `agora` entra por argumento.
 *
 * ```ts
 * export function formatarDataNaGestao(inicio: string | null, agora: Date): string;
 * ```
 *
 * `Quinta-feira, 5 de novembro, às 22:00` (maiúscula no início da linha); o ano só quando não
 * é o corrente **de Lisboa**; `à 01:00` à uma da manhã (`TEXTOS.comHora`); `null` →
 * `TEXTOS.semData`. Nomes dos dias e meses das tabelas de `data-do-evento.ts`, nunca o `Intl`
 * do aparelho; a data é a de **Lisboa**, qualquer que seja o fuso do aparelho. Sem Lisboa
 * no aparelho **lança** (o ecrã mostra o erro próprio, nunca uma data no fuso do aparelho).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AGORA, DIAS_ESPERADOS, MESES_ESPERADOS, comMaiuscula } from "../../../testes/eventos";
import { FUSOS_DO_APARELHO, comOFusoDoAparelhoEm } from "../../../testes/fuso";
import { formatarDataNaGestao } from "./data-na-gestao";
import { TEXTOS } from "./textos";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

/** `Quinta-feira, 5 de novembro, às 22:00` montado com as tabelas **do teste**. */
function esperado(
  dia: string,
  mes: string,
  hhmm: string,
  ano?: number,
  diaDaSemana?: number,
): string {
  const nome = DIAS_ESPERADOS[diaDaSemana ?? 0];
  const sufixo = ano === undefined ? "" : ` de ${String(ano)}`;
  return `${comMaiuscula(nome ?? "")}, ${dia} de ${mes}${sufixo}, ${TEXTOS.comHora(hhmm)}`;
}

const CASOS: ReadonlyArray<readonly [string, string, string]> = [
  [
    "no ano corrente",
    "2026-11-05T22:00:00Z",
    esperado("5", MESES_ESPERADOS[10] ?? "", "22:00", undefined, 4),
  ],
  [
    "noutro ano leva o ano",
    "2027-01-01T22:00:00Z",
    esperado("1", MESES_ESPERADOS[0] ?? "", "22:00", 2027, 5),
  ],
  [
    "00:30: o dia certo em Lisboa",
    "2026-11-07T00:30:00Z",
    esperado("7", MESES_ESPERADOS[10] ?? "", "00:30", undefined, 6),
  ],
  [
    "verão, 00:30 de Lisboa é 23:30Z do dia anterior",
    "2026-07-14T23:30:00Z",
    esperado("15", MESES_ESPERADOS[6] ?? "", "00:30", undefined, 3),
  ],
  [
    "verão, 22:00 de Lisboa são 21:00Z",
    "2026-07-16T21:00:00Z",
    esperado("16", MESES_ESPERADOS[6] ?? "", "22:00", undefined, 4),
  ],
  [
    "à uma da manhã não é «às 01:00»",
    "2026-11-20T01:00:00Z",
    esperado("20", MESES_ESPERADOS[10] ?? "", "01:00", undefined, 5),
  ],
];

describe("formatarDataNaGestao", () => {
  it.each(CASOS)("%s", (_nome, inicio, texto) => {
    expect(formatarDataNaGestao(inicio, AGORA)).toBe(texto);
  });

  it("a uma hora usa a forma da uma: «à 01:00»; às outras «às»", () => {
    expect(TEXTOS.comHora("01:00")).not.toBe(TEXTOS.comHora("02:00").replace("02", "01"));
    expect(formatarDataNaGestao("2026-11-20T01:00:00Z", AGORA)).toContain(TEXTOS.comHora("01:00"));
    expect(formatarDataNaGestao("2026-11-20T02:00:00Z", AGORA)).toContain(TEXTOS.comHora("02:00"));
  });

  it("`null` diz «Sem data.» (a frase da tabela, não um «Invalid Date»)", () => {
    expect(formatarDataNaGestao(null, AGORA)).toBe(TEXTOS.semData);
  });

  it("o ano corrente é o de Lisboa, lido do `agora` dado: passada a meia-noite de ano novo, 2027 deixa de levar ano", () => {
    const antes = new Date("2026-12-31T23:30:00Z");
    const depois = new Date("2027-01-01T00:30:00Z");
    expect(formatarDataNaGestao("2027-01-05T22:00:00Z", antes)).toContain("2027");
    expect(formatarDataNaGestao("2027-01-05T22:00:00Z", depois)).not.toContain("2027");
  });

  it.each(FUSOS_DO_APARELHO)("o texto é o mesmo com o aparelho em %s", (fuso) => {
    comOFusoDoAparelhoEm(fuso, () => {
      for (const [, inicio, texto] of CASOS) {
        expect(formatarDataNaGestao(inicio, AGORA), inicio).toBe(texto);
      }
    });
  });

  it("não lê o relógio: com o relógio noutro ano o resultado é o mesmo", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2031-06-01T10:00:00Z") });
    expect(formatarDataNaGestao("2026-11-05T22:00:00Z", AGORA)).toBe(CASOS[0]?.[2]);
  });

  it("sem Lisboa neste aparelho lança, em vez de escrever uma data no fuso do aparelho", async () => {
    const real = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function Rebenta(): never {
      throw new RangeError("Invalid time zone specified: Europe/Lisbon");
    } as unknown as typeof Intl.DateTimeFormat;
    vi.resetModules();
    try {
      const modulo = await import("./data-na-gestao");
      expect(() => modulo.formatarDataNaGestao("2026-11-05T22:00:00Z", AGORA)).toThrow();
    } finally {
      Intl.DateTimeFormat = real;
    }
  });
});
