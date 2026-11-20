/**
 * F4-03, plano 11.4 — as três datas que a folha «Duplicar evento» oferece, puras.
 *
 * Contrato (`datas-da-copia.ts`):
 *
 * ```ts
 * export function datasDaCopia(inicio: string, agora: Date): { semanas: 1 | 2 | 3; inicio: string }[];
 * ```
 *
 * A mesma regra do servidor (`backend/tests/gestao/test_duplicar.py`, secção `semanas`; a
 * tabela de casos é **a mesma**): `k0` = o menor `k ≥ 1` com `original + 7k dias` (parede de
 * Lisboa, `fold=0`) **estritamente depois** de agora; a opção `n` fica em
 * `original + 7·(k0 + n − 1)` dias. É uma pré-visualização: a hora inexistente (15/03 +14 dias
 * → 29/03 01:30) imita o `fold=0` do servidor (dá 02:30 de Lisboa, `01:30Z`) — a D2 (erro)
 * vale só para o campo da folha, onde o dono **escreve** a hora. O `inicio` devolvido é um
 * instante ISO; compara-se como instante, não como texto.
 *
 * Sempre três opções, `semanas` 1, 2 e 3, distintas e estritamente futuras; o resultado não
 * depende do fuso do aparelho nem do relógio (o `agora` entra por argumento).
 */
import { describe, expect, it, vi } from "vitest";

import { AGORA } from "../../../testes/eventos";
import { FUSOS_DO_APARELHO, comOFusoDoAparelhoEm } from "../../../testes/fuso";
import { datasDaCopia } from "./datas-da-copia";

function instantes(inicio: string, agora: Date): number[] {
  return datasDaCopia(inicio, agora).map((o: { inicio: string }) => new Date(o.inicio).getTime());
}
function iso(...datas: string[]): number[] {
  return datas.map((d) => new Date(d).getTime());
}

const CASOS: ReadonlyArray<readonly [string, string, string, string[]]> = [
  [
    "original futuro: +1, +2 e +3 semanas",
    "2026-11-05T22:00:00Z",
    "2026-11-02T10:00:00Z",
    ["2026-11-12T22:00:00Z", "2026-11-19T22:00:00Z", "2026-11-26T22:00:00Z"],
  ],
  [
    "Quintas de Samba: 3.ª quinta 19/11, hoje 20/11 — a 1.ª data livre é 26/11",
    "2026-11-19T22:00:00Z",
    "2026-11-20T10:00:00Z",
    ["2026-11-26T22:00:00Z", "2026-12-03T22:00:00Z", "2026-12-10T22:00:00Z"],
  ],
  [
    "arquivo (15/10, hora de verão): três datas distintas e futuras, às 22:00 de Lisboa (22:00Z)",
    "2026-10-15T21:00:00Z",
    "2026-11-02T10:00:00Z",
    ["2026-11-05T22:00:00Z", "2026-11-12T22:00:00Z", "2026-11-19T22:00:00Z"],
  ],
  [
    "mudança de hora do outono: 22/10 ainda em verão, 29/10 já em inverno (22:00 de Lisboa = 22:00Z)",
    "2026-10-15T21:00:00Z",
    "2026-10-16T10:00:00Z",
    ["2026-10-22T21:00:00Z", "2026-10-29T22:00:00Z", "2026-11-05T22:00:00Z"],
  ],
  [
    "hora inexistente: dom 15/03 01:30 → 29/03 imita o fold=0 (02:30 de Lisboa = 01:30Z)",
    "2026-03-15T01:30:00Z",
    "2026-03-01T12:00:00Z",
    ["2026-03-22T01:30:00Z", "2026-03-29T01:30:00Z", "2026-04-05T00:30:00Z"],
  ],
  [
    "hora ambígua: dom 11/10 01:30 → 25/10 fica a primeira ocorrência (00:30Z)",
    "2026-10-11T00:30:00Z",
    "2026-10-01T12:00:00Z",
    ["2026-10-18T00:30:00Z", "2026-10-25T00:30:00Z", "2026-11-01T01:30:00Z"],
  ],
  [
    "original de julho, hoje em dezembro: k0 = 22 (3/12), às 22:00 de inverno",
    "2026-07-02T21:00:00Z",
    "2026-12-01T12:00:00Z",
    ["2026-12-03T22:00:00Z", "2026-12-10T22:00:00Z", "2026-12-17T22:00:00Z"],
  ],
  [
    "estritamente depois: um candidato igual a agora não conta (12/11 22:00 = agora → começa em 19/11)",
    "2026-11-05T22:00:00Z",
    "2026-11-12T22:00:00Z",
    ["2026-11-19T22:00:00Z", "2026-11-26T22:00:00Z", "2026-12-03T22:00:00Z"],
  ],
  [
    "um segundo antes do candidato, o candidato conta",
    "2026-11-05T22:00:00Z",
    "2026-11-12T21:59:59Z",
    ["2026-11-12T22:00:00Z", "2026-11-19T22:00:00Z", "2026-11-26T22:00:00Z"],
  ],
];

describe("datasDaCopia: a tabela do backend", () => {
  it.each(CASOS)("%s", (_nome, inicio, agora, esperado) => {
    expect(instantes(inicio, new Date(agora))).toEqual(iso(...esperado));
  });

  it.each(CASOS)(
    "%s — sempre 3 opções, semanas 1, 2 e 3, distintas e estritamente futuras",
    (_n, inicio, agora) => {
      const opcoes = datasDaCopia(inicio, new Date(agora));
      expect(opcoes.map((o: { semanas: number }) => o.semanas)).toEqual([1, 2, 3]);
      const tempos = opcoes.map((o: { inicio: string }) => new Date(o.inicio).getTime());
      expect(new Set(tempos).size).toBe(3);
      for (const t of tempos) expect(t).toBeGreaterThan(new Date(agora).getTime());
    },
  );
});

describe.each(FUSOS_DO_APARELHO)("com o aparelho em %s", (fuso) => {
  it("a tabela inteira dá o mesmo", () => {
    comOFusoDoAparelhoEm(fuso, () => {
      for (const [nome, inicio, agora, esperado] of CASOS) {
        expect(instantes(inicio, new Date(agora)), nome).toEqual(iso(...esperado));
      }
    });
  });
});

describe("datasDaCopia: pureza", () => {
  it("não lê o relógio: com o relógio noutro ano o resultado é o mesmo", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2031-06-01T10:00:00Z") });
    try {
      expect(instantes("2026-11-05T22:00:00Z", AGORA)).toEqual(iso(...(CASOS[0]?.[3] ?? [])));
    } finally {
      vi.useRealTimers();
    }
  });
});
