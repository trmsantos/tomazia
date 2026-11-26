/**
 * F3-06a, 5.1 e 11 (critério 1) — «está aberto?», com o relógio fixo em Lisboa.
 *
 * Contrato que este ficheiro define (plano do arquiteto) e que
 * `src/lib/horario/estado-do-horario.ts` tem de cumprir:
 *
 * ```ts
 * export type DiaDaSemana = "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo";
 * export type Periodo = { abre: string; fecha: string };          // "HH:MM"
 * export type DataCivil = string;                                  // "AAAA-MM-DD", dia civil de Lisboa
 * export type PeriodosDaData = (data: DataCivil) => readonly Periodo[];
 *
 * export type EstadoDoHorario =
 *   | { tipo: "aberto";  fechaAs: string; hoje: DiaDaSemana; destaque: DiaDaSemana }
 *   | { tipo: "fechado"; abre: { quando: "hoje" | "amanhã" | DiaDaSemana; hora: string } | null;
 *       hoje: DiaDaSemana; destaque: DiaDaSemana };
 *
 * export class ErroSemLisboa extends Error {}
 * export function periodosDaSemana(horario: DiaDoHorario[]): PeriodosDaData;
 * export function estadoDoHorario(periodosDaData: PeriodosDaData, agora: Date): EstadoDoHorario;
 * ```
 *
 * - `periodosDaData` é a função «que períodos tem esta data civil de Lisboa»: a
 *   F4-06 põe lá as exceções. `periodosDaSemana` é a de hoje (o dia da semana
 *   da data, contra o horário do contrato).
 * - `hoje` é o dia da semana do dia civil de Lisboa; `destaque` é o dia cujo
 *   período está a decorrer (à 01:00 de quinta com o de quarta aberto: `quarta`)
 *   e, sem período a decorrer, é igual a `hoje` (5.2).
 * - `quando` é o dia da abertura seguinte: `"hoje"`, `"amanhã"` ou o nome do dia
 *   da semana. A forma «próxima» decide-se no texto, quando `quando === hoje`.
 * - `abre: null` = nenhum período nos próximos sete dias (a semana fechada).
 * - Períodos que se tocam ou sobrepõem, mesmo entre dias, fundem-se; `fechaAs`
 *   é o fim da cadeia. Abertura inclusiva, fecho exclusivo.
 * - Sem `Intl` com `Europe/Lisbon`: levanta `ErroSemLisboa` (ver
 *   `VisitaNos.sem-lisboa.test.tsx`).
 *
 * **O que prova:** as fronteiras 17:00/02:00/16:59; a madrugada do dia seguinte;
 * a fusão; o dia civil de Lisboa quando o dia UTC é outro; as duas noites de
 * mudança de hora; os cinco fusos do aparelho (com o guarda de `fuso.ts`).
 *
 * **O que deixa passar:** a escrita das frases (`nomes-e-textos.test.ts`) e o
 * temporizador (`VisitaNos.relogio.test.tsx`).
 */
import { describe, expect, it } from "vitest";

import { FUSOS_DO_APARELHO, comOFusoDoAparelhoEm } from "../../testes/fuso";
import { type DiaDoHorario, semanaDeTeste } from "../../testes/gestao";
import {
  MOMENTOS,
  MUDANCA_DE_HORA,
  horarioComDoisPeriodosNaSexta,
  horarioFechadoASemanaToda,
  horarioPadrao,
  horarioSoNasTercas,
} from "../../testes/visita-nos";
import { ErroSemLisboa, estadoDoHorario, periodosDaSemana } from "./estado-do-horario";

function estadoDe(horario: DiaDoHorario[], instante: string) {
  return estadoDoHorario(periodosDaSemana(horario), new Date(instante));
}

function semana(periodos: Parameters<typeof semanaDeTeste>[0]): DiaDoHorario[] {
  return semanaDeTeste(periodos);
}

describe("o ambiente sabe o que Lisboa é (guarda)", () => {
  it("Intl resolve Europe/Lisbon: os testes de «sem Lisboa» são os únicos que a perdem", () => {
    expect(() => new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon" })).not.toThrow();
    expect(ErroSemLisboa.prototype).toBeInstanceOf(Error);
  });
});

describe("periodosDaSemana", () => {
  const marcado = semana({
    segunda: [["10:00", "11:00"]],
    terca: [["10:01", "11:01"]],
    quarta: [["10:02", "11:02"]],
    quinta: [["10:03", "11:03"]],
    sexta: [["10:04", "11:04"]],
    sabado: [["10:05", "11:05"]],
    domingo: [["10:06", "11:06"]],
  });

  it.each([
    ["2026-11-02", "10:00"], // segunda
    ["2026-11-03", "10:01"],
    ["2026-11-04", "10:02"],
    ["2026-11-05", "10:03"],
    ["2026-11-06", "10:04"],
    ["2026-11-07", "10:05"],
    ["2026-11-08", "10:06"], // domingo
    ["2026-03-29", "10:06"], // domingo da mudança de hora
    ["2026-10-25", "10:06"], // domingo da mudança de hora
  ])("a data %s é o dia cujo período abre às %s", (data, abre) => {
    const periodos = periodosDaSemana(marcado)(data);

    expect(periodos).toHaveLength(1);
    expect(periodos[0]?.abre).toBe(abre);
  });

  it("um dia sem períodos devolve a lista vazia", () => {
    expect(periodosDaSemana(horarioPadrao())("2026-11-02")).toEqual([]);
  });
});

describe("a pergunta «está aberto?» (critério 1)", () => {
  it.each([
    ["quarta 23:00", MOMENTOS.qua23h00, "quarta", "quarta"],
    ["quinta 01:30, com o período de quarta", MOMENTOS.qui01h30, "quinta", "quarta"],
    ["quinta 17:00 em ponto (abertura inclusiva)", MOMENTOS.qui17h00, "quinta", "quinta"],
    ["domingo 01:30, com o sábado ainda aberto", MOMENTOS.dom01h30, "domingo", "sabado"],
    ["terça 23:00", MOMENTOS.ter23h00, "terca", "terca"],
    ["quarta 23:00 de dezembro (Lisboa = UTC)", MOMENTOS.invernoQua23h00, "quarta", "quarta"],
    ["quinta 01:30 de dezembro", MOMENTOS.invernoQui01h30, "quinta", "quarta"],
  ] as const)("aberto até às 02:00: %s", (_nome, instante, hoje, destaque) => {
    expect(estadoDe(horarioPadrao(), instante)).toEqual({
      tipo: "aberto",
      fechaAs: "02:00",
      hoje,
      destaque,
    });
  });

  it.each([
    ["quinta 02:00 em ponto (fecho exclusivo)", MOMENTOS.qui02h00],
    ["quinta 16:59", MOMENTOS.qui16h59],
    ["terça 10:00", MOMENTOS.ter10h00],
    ["quinta 02:00 de dezembro", MOMENTOS.invernoQui02h00],
    ["terça 01:00, com o bar já fechado e a segunda sem período", "2026-07-07T00:00:00Z"],
  ])("fechado, abre hoje às 17:00: %s", (_nome, instante) => {
    const estado = estadoDe(horarioPadrao(), instante);

    expect(estado).toMatchObject({
      tipo: "fechado",
      abre: { quando: "hoje", hora: "17:00" },
    });
    // Sem período a decorrer, o destaque é o dia civil.
    expect(estado.destaque).toBe(estado.hoje);
  });

  it("à 01:00 de terça «hoje» é a terça, não a noite que ainda dura (5.1)", () => {
    expect(estadoDe(horarioPadrao(), "2026-07-07T00:00:00Z")).toMatchObject({
      hoje: "terca",
      destaque: "terca",
    });
  });

  it("domingo ao meio-dia: a próxima abertura é terça, a dois dias", () => {
    expect(estadoDe(horarioPadrao(), MOMENTOS.dom12h00)).toEqual({
      tipo: "fechado",
      abre: { quando: "terca", hora: "17:00" },
      hoje: "domingo",
      destaque: "domingo",
    });
  });

  it("segunda ao meio-dia: abre amanhã", () => {
    expect(estadoDe(horarioPadrao(), MOMENTOS.seg12h00)).toMatchObject({
      tipo: "fechado",
      abre: { quando: "amanhã", hora: "17:00" },
      hoje: "segunda",
    });
  });

  it("segunda 00:30 de Lisboa (ainda domingo em UTC): hoje é segunda e abre amanhã", () => {
    // Discriminador do dia UTC: em UTC era domingo 23:30 e a abertura seria
    // «na terça», a dois dias.
    expect(estadoDe(horarioPadrao(), MOMENTOS.seg00h30)).toEqual({
      tipo: "fechado",
      abre: { quando: "amanhã", hora: "17:00" },
      hoje: "segunda",
      destaque: "segunda",
    });
  });

  it("quarta 00:30 de Lisboa (ainda terça em UTC): hoje é quarta e a terça está a decorrer", () => {
    expect(estadoDe(horarioPadrao(), MOMENTOS.qua00h30)).toEqual({
      tipo: "aberto",
      fechaAs: "02:00",
      hoje: "quarta",
      destaque: "terca",
    });
  });

  it("só abre às terças das 12:00 às 15:00: terça 16:00 é a próxima terça; quarta é «na terça»", () => {
    expect(estadoDe(horarioSoNasTercas(), MOMENTOS.ter16h00)).toEqual({
      tipo: "fechado",
      abre: { quando: "terca", hora: "12:00" },
      hoje: "terca",
      destaque: "terca",
    });
    expect(estadoDe(horarioSoNasTercas(), MOMENTOS.qua12h00)).toEqual({
      tipo: "fechado",
      abre: { quando: "terca", hora: "12:00" },
      hoje: "quarta",
      destaque: "quarta",
    });
  });

  it("dois períodos no mesmo dia: às 16:00 abre às 19:00; às 13:00 está aberto até às 15:00", () => {
    expect(estadoDe(horarioComDoisPeriodosNaSexta(), MOMENTOS.sex16h00)).toMatchObject({
      tipo: "fechado",
      abre: { quando: "hoje", hora: "19:00" },
    });
    expect(estadoDe(horarioComDoisPeriodosNaSexta(), "2026-07-10T12:00:00Z")).toMatchObject({
      tipo: "aberto",
      fechaAs: "15:00",
    });
  });

  it("os sete dias vazios são «fechado» sem próxima abertura, e o destaque é o dia civil", () => {
    for (const instante of [MOMENTOS.qua23h00, MOMENTOS.seg00h30, MOMENTOS.dom12h00]) {
      const estado = estadoDe(horarioFechadoASemanaToda(), instante);

      expect(estado).toMatchObject({ tipo: "fechado", abre: null });
      expect(estado.destaque).toBe(estado.hoje);
    }
  });
});

describe("a hora de fecho que se devolve", () => {
  it("fecho às 01:00", () => {
    expect(estadoDe(semana({ terca: [["17:00", "01:00"]] }), MOMENTOS.ter23h00)).toMatchObject({
      tipo: "aberto",
      fechaAs: "01:00",
    });
  });

  it("fecho às 00:00 devolve «00:00» (a palavra «meia-noite» é do texto)", () => {
    expect(estadoDe(semana({ terca: [["17:00", "00:00"]] }), MOMENTOS.ter23h30)).toMatchObject({
      tipo: "aberto",
      fechaAs: "00:00",
    });
  });
});

describe("fusão de períodos (5.1)", () => {
  const CADEIA_ENCOSTADA = semana({
    terca: [["17:00", "00:00"]],
    quarta: [["00:00", "02:00"]],
  });

  it.each([
    ["terça 23:30", MOMENTOS.ter23h30],
    ["quarta 00:00 em ponto", "2026-07-07T23:00:00Z"],
    ["quarta 00:30", MOMENTOS.qua00h30],
  ])("17:00–00:00 e 00:00–02:00 no dia seguinte são uma só cadeia até às 02:00: %s", (_n, i) => {
    expect(estadoDe(CADEIA_ENCOSTADA, i)).toMatchObject({ tipo: "aberto", fechaAs: "02:00" });
  });

  it("à meia-noite exata de uma cadeia que NÃO continua, o fecho é «00:00»", () => {
    expect(estadoDe(semana({ terca: [["17:00", "00:00"]] }), MOMENTOS.ter23h30)).toMatchObject({
      fechaAs: "00:00",
    });
  });

  it("a sobreposição entre dias funde-se e o fecho é o do fim da cadeia", () => {
    // A gestão não a impede (F4-05a, 6.6): terça acaba às 03:00 de quarta e
    // quarta abre às 02:00 e fecha às 05:00.
    const sobreposto = semana({ terca: [["17:00", "03:00"]], quarta: [["02:00", "05:00"]] });

    for (const instante of [MOMENTOS.ter23h00, MOMENTOS.qua01h00, MOMENTOS.qua04h00]) {
      expect(estadoDe(sobreposto, instante)).toMatchObject({ tipo: "aberto", fechaAs: "05:00" });
    }
  });

  it("sobreposição dentro do mesmo dia: 17–20 e 19–23 são 17–23", () => {
    const sobreposto = semana({
      terca: [
        ["17:00", "20:00"],
        ["19:00", "23:00"],
      ],
    });

    expect(estadoDe(sobreposto, "2026-07-07T18:30:00Z")).toMatchObject({ fechaAs: "23:00" });
  });

  it("um período dentro de outro não encurta o fecho: 17–23 com 18–20 dentro fecha às 23:00", () => {
    const aninhado = semana({
      terca: [
        ["17:00", "23:00"],
        ["18:00", "20:00"],
      ],
    });

    expect(estadoDe(aninhado, "2026-07-07T20:00:00Z")).toMatchObject({ fechaAs: "23:00" });
  });
});

describe("as duas noites de mudança de hora (a hora de relógio manda)", () => {
  /** Sábado 17:00–02:00; o resto fechado. */
  const SABADO = horarioPadrao();

  it("29 de março: aberto até ao salto, e às 02:00 de relógio já fechado (fecho exclusivo)", () => {
    expect(estadoDe(SABADO, MUDANCA_DE_HORA.marSab23h30)).toMatchObject({
      tipo: "aberto",
      fechaAs: "02:00",
    });
    expect(estadoDe(SABADO, MUDANCA_DE_HORA.marDom00h30)).toMatchObject({ tipo: "aberto" });
    expect(estadoDe(SABADO, MUDANCA_DE_HORA.marDom00h59)).toMatchObject({
      tipo: "aberto",
      hoje: "domingo",
      destaque: "sabado",
    });
    expect(estadoDe(SABADO, MUDANCA_DE_HORA.marDom02h00)).toMatchObject({
      tipo: "fechado",
      hoje: "domingo",
      abre: { quando: "terca", hora: "17:00" },
    });
  });

  it("29 de março, 02:30 de relógio: fechado (uma conta por diferença de horas diria aberto)", () => {
    expect(estadoDe(SABADO, MUDANCA_DE_HORA.marDom02h30)).toMatchObject({ tipo: "fechado" });
  });

  it("25 de outubro: a 01:30 existe duas vezes e nas duas está aberto até às 02:00", () => {
    for (const instante of [
      MUDANCA_DE_HORA.outSab23h30,
      MUDANCA_DE_HORA.outDom01h30Primeira,
      MUDANCA_DE_HORA.outDom01h00Segunda,
      MUDANCA_DE_HORA.outDom01h30Segunda,
      MUDANCA_DE_HORA.outDom01h59Segunda,
    ]) {
      expect(estadoDe(SABADO, instante), instante).toMatchObject({
        tipo: "aberto",
        fechaAs: "02:00",
      });
    }
    expect(estadoDe(SABADO, MUDANCA_DE_HORA.outDom02h00)).toMatchObject({
      tipo: "fechado",
      hoje: "domingo",
    });
  });

  it("25 de outubro, fecho às 01:30: a hora de relógio decide, nas duas passagens", () => {
    const fechaAUmaETrinta = semana({ sabado: [["17:00", "01:30"]] });

    // 01:30 de relógio (primeira passagem, WEST): fecho exclusivo → fechado.
    expect(estadoDe(fechaAUmaETrinta, MUDANCA_DE_HORA.outDom01h30Primeira)).toMatchObject({
      tipo: "fechado",
    });
    // 01:00 de relógio (segunda passagem, WET): ainda antes das 01:30 → aberto.
    expect(estadoDe(fechaAUmaETrinta, MUDANCA_DE_HORA.outDom01h00Segunda)).toMatchObject({
      tipo: "aberto",
      fechaAs: "01:30",
    });
    // 01:30 de relógio (segunda passagem): fechado.
    expect(estadoDe(fechaAUmaETrinta, MUDANCA_DE_HORA.outDom01h30Segunda)).toMatchObject({
      tipo: "fechado",
    });
  });
});

describe("os períodos vêm de uma função, para a F4-06 lá pôr exceções", () => {
  it("a função recebe datas civis de Lisboa no formato AAAA-MM-DD", () => {
    const pedidas = new Set<string>();
    const base = periodosDaSemana(horarioPadrao());

    estadoDoHorario((data) => {
      pedidas.add(data);
      return base(data);
    }, new Date(MOMENTOS.qua00h30));

    expect([...pedidas].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    // Quarta 00:30 de Lisboa é 2026-07-08 (em UTC ainda era dia 7); e a
    // véspera, onde o período a decorrer começou, também é perguntada.
    expect(pedidas.has("2026-07-08")).toBe(true);
    expect(pedidas.has("2026-07-07")).toBe(true);
  });

  it("uma data sem períodos (exceção) fecha esse dia e a próxima abertura passa a ser amanhã", () => {
    const base = periodosDaSemana(horarioPadrao());
    const comExcecao = (data: string) => (data === "2026-07-09" ? [] : base(data));

    // Quinta 16:00 de Lisboa: sem a exceção abria hoje às 17:00.
    const estado = estadoDoHorario(comExcecao, new Date("2026-07-09T15:00:00Z"));

    expect(estado).toMatchObject({ tipo: "fechado", abre: { quando: "amanhã", hora: "17:00" } });
  });

  it("a exceção na véspera tira o período que ainda decorria de madrugada", () => {
    const base = periodosDaSemana(horarioPadrao());
    const comExcecao = (data: string) => (data === "2026-07-07" ? [] : base(data));

    // Quarta 01:00 de Lisboa: o período de terça (que seria 17:00–02:00) não existe.
    const estado = estadoDoHorario(comExcecao, new Date(MOMENTOS.qua01h00));

    expect(estado).toMatchObject({ tipo: "fechado", abre: { quando: "hoje", hora: "17:00" } });
  });

  it("uma exceção que acrescenta um período num dia normalmente fechado", () => {
    const base = periodosDaSemana(horarioPadrao());
    const comExtra = (data: string) =>
      data === "2026-07-06" ? [{ abre: "12:00", fecha: "15:00" }] : base(data);

    expect(estadoDoHorario(comExtra, new Date(MOMENTOS.seg12h00))).toMatchObject({
      tipo: "aberto",
      fechaAs: "15:00",
    });
  });
});

describe.each(FUSOS_DO_APARELHO)("com o relógio do aparelho em %s", (fuso) => {
  /**
   * O resultado tem de ser o de Lisboa, seja qual for o fuso do processo. Cada
   * caso foi escolhido para um `getDay()`/`getHours()` local dar outra resposta
   * em pelo menos um dos cinco fusos.
   */
  const CASOS = [
    [MOMENTOS.qua00h30, { tipo: "aberto", fechaAs: "02:00", hoje: "quarta", destaque: "terca" }],
    [
      MOMENTOS.seg00h30,
      { tipo: "fechado", abre: { quando: "amanhã", hora: "17:00" }, hoje: "segunda" },
    ],
    [MOMENTOS.dom01h30, { tipo: "aberto", fechaAs: "02:00", hoje: "domingo", destaque: "sabado" }],
    [
      MOMENTOS.qui02h00,
      { tipo: "fechado", abre: { quando: "hoje", hora: "17:00" }, hoje: "quinta" },
    ],
    [MOMENTOS.qui17h00, { tipo: "aberto", fechaAs: "02:00", hoje: "quinta", destaque: "quinta" }],
    [MOMENTOS.ter23h00, { tipo: "aberto", fechaAs: "02:00", hoje: "terca", destaque: "terca" }],
    [
      MUDANCA_DE_HORA.marDom02h30,
      { tipo: "fechado", abre: { quando: "terca", hora: "17:00" }, hoje: "domingo" },
    ],
    [
      MUDANCA_DE_HORA.outDom01h30Segunda,
      { tipo: "aberto", fechaAs: "02:00", hoje: "domingo", destaque: "sabado" },
    ],
  ] as const;

  it.each(CASOS)("%s dá a resposta de Lisboa", (instante, esperado) => {
    comOFusoDoAparelhoEm(fuso, () => {
      expect(estadoDe(horarioPadrao(), instante)).toMatchObject(esperado);
    });
  });
});
