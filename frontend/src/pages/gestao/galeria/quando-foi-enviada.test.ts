/**
 * F4-04, plano 7.1 e spec 4.3 e 15 — quando a foto foi enviada, em Lisboa (`quando-foi-enviada.ts`).
 *
 * Contrato (puro; **nenhuma função lê o relógio**: o `agora` entra por argumento):
 *
 * ```ts
 * export function quandoFoiEnviada(criadaEm: string, agora: Date): string;
 * ```
 *
 * Devolve só a parte que a linha e o `alt` partilham (spec 15): `"hoje, às 23:40"`,
 * `"ontem, à 01:10"`, `"no sábado, 14 de novembro, às 23:40"`,
 * `"na sexta-feira, 1 de janeiro de 2027, às 22:00"`. A linha junta «Enviada » à frente e o `alt`
 * «Foto enviada »: **uma só fonte para a data**.
 *
 *  - «hoje» e «ontem» pelo **dia de calendário de Lisboa** (resposta do dominio-bar: o horário
 *    do bar não entra, a hora vem sempre escrita);
 *  - fora disso, `no/na <dia da semana>, <dia> de <mês>` e, **noutro ano que não o de `agora`**,
 *    com o ano (`… de 2027`); os nomes vêm de `lib/formato/data-do-evento.ts`;
 *  - a regra da hora é a da F4-03 4.4: «à 01:10» à uma da manhã, «às» nas outras;
 *  - **o fuso do aparelho nunca entra** (`comOFusoDoAparelhoEm`, cinco fusos). Nunca
 *    `toLocaleString`/`Intl` do aparelho: `partesEmLisboa` (já exportada na F4-03).
 *
 * **Deixa passar:** o que acontece com um `criadaEm` que não se sabe ler (o módulo da API recusa
 * esse corpo antes de chegar aqui; o ecrã trata o resto como erro de carregar, em
 * `GaleriaGestao.test.tsx`).
 */
import { describe, expect, it } from "vitest";

import { FUSOS_DO_APARELHO, comOFusoDoAparelhoEm } from "../../../testes/fuso";
import { quandoFoiEnviada } from "./quando-foi-enviada";

const AGORA = new Date("2026-11-02T10:00:00Z"); // segunda-feira, 10:00 em Lisboa

/** [nome, criada_em, agora, esperado] */
const CASOS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["hoje de manhã", "2026-11-02T09:15:00Z", "2026-11-02T10:00:00Z", "hoje, às 09:15"],
  [
    "hoje, à meia-noite e meia (00:30 é «às»)",
    "2026-11-02T00:30:00Z",
    "2026-11-02T10:00:00Z",
    "hoje, às 00:30",
  ],
  [
    "hoje, à uma da manhã (01:10 é «à»)",
    "2026-11-02T01:10:00Z",
    "2026-11-02T10:00:00Z",
    "hoje, à 01:10",
  ],
  ["ontem à noite", "2026-11-01T23:40:00Z", "2026-11-02T10:00:00Z", "ontem, às 23:40"],
  ["ontem, à uma da manhã", "2026-11-01T01:10:00Z", "2026-11-02T10:00:00Z", "ontem, à 01:10"],
  [
    "há três dias: o dia da semana e a data",
    "2026-10-30T22:00:00Z",
    "2026-11-02T10:00:00Z",
    "na sexta-feira, 30 de outubro, às 22:00",
  ],
  [
    "sábado, 14 de novembro (o exemplo da spec)",
    "2026-11-14T23:40:00Z",
    "2026-11-20T10:00:00Z",
    "no sábado, 14 de novembro, às 23:40",
  ],
  [
    "verão: 22:00 de Lisboa são 21:00Z",
    "2026-07-14T21:00:00Z",
    "2026-07-20T10:00:00Z",
    "na terça-feira, 14 de julho, às 22:00",
  ],
  [
    "verão: hoje às 23:30 (22:30Z)",
    "2026-07-20T22:30:00Z",
    "2026-07-20T22:50:00Z",
    "hoje, às 23:30",
  ],
  [
    "noutro ano: leva o ano (o exemplo da spec)",
    "2027-01-01T22:00:00Z",
    "2028-02-01T10:00:00Z",
    "na sexta-feira, 1 de janeiro de 2027, às 22:00",
  ],
  [
    "dezembro visto em janeiro: noutro ano, leva o ano",
    "2026-12-31T22:00:00Z",
    "2027-01-05T10:00:00Z",
    "na quinta-feira, 31 de dezembro de 2026, às 22:00",
  ],
  [
    "no mesmo ano o ano não se escreve",
    "2026-03-10T12:00:00Z",
    "2026-11-02T10:00:00Z",
    "na terça-feira, 10 de março, às 12:00",
  ],
];

describe("quandoFoiEnviada", () => {
  it.each(CASOS)("%s", (_nome, criadaEm, agora, esperado) => {
    expect(quandoFoiEnviada(criadaEm, new Date(agora))).toBe(esperado);
  });

  it("o dia é o de Lisboa, não o de UTC: 00:30 de Lisboa no verão ainda é 23:30Z do dia anterior", () => {
    // 2026-07-14T23:30Z são 00:30 de 15/7 em Lisboa; às 10:00Z de 15/7 é «hoje».
    expect(quandoFoiEnviada("2026-07-14T23:30:00Z", new Date("2026-07-15T10:00:00Z"))).toBe(
      "hoje, às 00:30",
    );
  });

  it("depois da meia-noite de Lisboa, o que era «hoje» passa a «ontem» (e em UTC ainda era hoje)", () => {
    // 23:30 de Lisboa em 15/7 (22:30Z); agora são 00:10 de 16/7 em Lisboa (23:10Z de 15/7).
    expect(quandoFoiEnviada("2026-07-15T22:30:00Z", new Date("2026-07-15T23:10:00Z"))).toBe(
      "ontem, às 23:30",
    );
  });

  it("a noite do recuo de outubro: 01:30 de Lisboa existe duas vezes e escreve-se «à 01:30» nas duas", () => {
    // 25/10/2026: às 02:00 de verão (01:00Z) o relógio volta a 01:00. 00:30Z = 01:30 de verão; 01:30Z = 01:30 de inverno.
    const agora = new Date("2026-10-26T10:00:00Z");
    expect(quandoFoiEnviada("2026-10-25T00:30:00Z", agora)).toBe("ontem, à 01:30");
    expect(quandoFoiEnviada("2026-10-25T01:30:00Z", agora)).toBe("ontem, à 01:30");
  });

  it.each(FUSOS_DO_APARELHO)("o fuso do aparelho (%s) não muda o texto", (fuso) => {
    comOFusoDoAparelhoEm(fuso, () => {
      for (const [, criadaEm, agora, esperado] of CASOS) {
        expect(quandoFoiEnviada(criadaEm, new Date(agora)), `${criadaEm} em ${fuso}`).toBe(
          esperado,
        );
      }
    });
  });

  it("não lê o relógio: o mesmo par dá o mesmo texto, passe o tempo que passar", () => {
    const a = quandoFoiEnviada("2026-11-01T23:40:00Z", AGORA);
    const b = quandoFoiEnviada("2026-11-01T23:40:00Z", AGORA);
    expect(a).toBe(b);
    expect(a).toBe("ontem, às 23:40");
  });

  it("nunca escreve «undefined», «NaN» nem um fuso (a hora de Lisboa não leva «WET» nem «UTC»)", () => {
    for (const [, criadaEm, agora] of CASOS) {
      expect(quandoFoiEnviada(criadaEm, new Date(agora))).not.toMatch(
        /undefined|NaN|null|WET|WEST|UTC|GMT/,
      );
    }
  });
});
