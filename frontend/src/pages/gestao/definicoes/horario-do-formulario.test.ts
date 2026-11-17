/**
 * F4-05a, plano 2.5 e 5.1 — o horário no formulário: `daApi`, `comecarHorario`,
 * `paraApi` e `validarHorario` (contrato em `src/testes/horario.ts`).
 *
 * **A validação local espelha o backend.** As tabelas abaixo são
 * `HORARIOS_RECUSADOS` e os casos aceites de
 * `backend/tests/gestao/test_definicoes.py` (e `_validar_horario_na_escrita` de
 * `backend/app/schemas/gestao.py`), traduzidos para o editor: os casos que só
 * existem em JSON (seis dias, dia repetido, chave a mais, lista que é texto…) não
 * são representáveis no editor e ficam de fora. Cada recusa do backend que o editor
 * consegue escrever está aqui, com o mesmo nome. Os intervalos medem-se na linha do
 * dia (`fecha < abre` soma 24 h); começar quando o outro acaba é válido.
 *
 * O que o backend não vê e o editor sim (plano 2.5): dia por preencher, dia aberto
 * sem períodos, hora vazia, hora incompleta (`validity.badInput`, diferente de vazia).
 */
import { describe, expect, it } from "vitest";

import {
  DIAS_PELA_ORDEM,
  horarioDeTeste,
  semanaDeTeste,
  type DiaDaSemana,
} from "../../../testes/gestao";
import {
  comDia,
  contarErros,
  diaDe,
  formularioDe,
  periodoNoFormulario,
  semErros,
  type Editar,
} from "../../../testes/horario";
import {
  DIAS_DA_SEMANA,
  comecarHorario,
  daApi,
  paraApi,
  validarHorario,
} from "./horario-do-formulario";
import { TEXTOS, faltaOHorarioDe } from "./textos";

type Periodos = Parameters<typeof semanaDeTeste>[0];

function periodosDemais(): Periodos {
  // `_periodos_demais` do backend: 24 períodos; aqui 7 chegam (o limite é 6).
  return {
    segunda: Array.from({ length: 7 }, (_, i) => [
      `${String(8 + i).padStart(2, "0")}:00`,
      `${String(8 + i).padStart(2, "0")}:30`,
    ]) as Array<[string, string]>,
  };
}

describe("DIAS_DA_SEMANA", () => {
  it("são os sete, de segunda a domingo, com os nomes do backend (sem acentos)", () => {
    expect([...DIAS_DA_SEMANA]).toEqual([...DIAS_PELA_ORDEM]);
  });
});

describe("daApi", () => {
  it("null → sem_horario", () => {
    expect(daApi(null)).toEqual({ modo: "sem_horario" });
  });

  it("uma lista → editar, sete dias de segunda a domingo; [] é fechado, com períodos é aberto", () => {
    const h = daApi(horarioDeTeste());
    expect(h.modo).toBe("editar");
    if (h.modo !== "editar") return;
    expect(h.dias.map((d) => d.dia)).toEqual([...DIAS_PELA_ORDEM]);
    expect(diaDe(h, "segunda").estado).toBe("fechado");
    expect(diaDe(h, "segunda").periodos).toEqual([]);
    expect(diaDe(h, "sexta").estado).toBe("aberto");
    expect(diaDe(h, "sexta").periodos.map((p) => [p.abre, p.fecha])).toEqual([
      ["12:00", "15:00"],
      ["19:00", "02:00"],
    ]);
  });

  it("nunca produz por_preencher (nem com todos os dias fechados)", () => {
    for (const horario of [horarioDeTeste(), semanaDeTeste()]) {
      const h = daApi(horario);
      if (h.modo !== "editar") throw new Error("devia ser editar");
      expect(h.dias.filter((d) => d.estado === "por_preencher")).toEqual([]);
    }
  });

  it("cada período tem uma chave própria, e nenhum vem marcado como incompleto", () => {
    const h = daApi(horarioDeTeste());
    if (h.modo !== "editar") throw new Error("devia ser editar");
    const periodos = h.dias.flatMap((d) => d.periodos);
    expect(new Set(periodos.map((p) => p.chave)).size).toBe(periodos.length);
    for (const p of periodos) {
      expect(p.abreIncompleto).toBe(false);
      expect(p.fechaIncompleto).toBe(false);
    }
  });

  it("os dias de uma lista baralhada saem de segunda a domingo", () => {
    const baralhado = [...horarioDeTeste()].reverse();
    const h = daApi(baralhado);
    if (h.modo !== "editar") throw new Error("devia ser editar");
    expect(h.dias.map((d) => d.dia)).toEqual([...DIAS_PELA_ORDEM]);
  });
});

describe("comecarHorario", () => {
  it("dá o modo editar com os sete dias POR PREENCHER e zero períodos — nunca fechados (ADR 0011)", () => {
    const h = comecarHorario();
    expect(h.modo).toBe("editar");
    if (h.modo !== "editar") return;
    expect(h.dias.map((d) => d.dia)).toEqual([...DIAS_PELA_ORDEM]);
    for (const dia of h.dias) {
      expect(dia.estado).toBe("por_preencher");
      expect(dia.periodos).toEqual([]);
    }
  });
});

describe("paraApi", () => {
  it("sem_horario → null", () => {
    expect(paraApi({ modo: "sem_horario" })).toBeNull();
  });

  it("«Fechado» com períodos guardados em memória vai com periodos: []", () => {
    const h = comDia(formularioDe({ terca: [["17:00", "02:00"]] }), "terca", { estado: "fechado" });
    expect(diaDe(h, "terca").periodos).toHaveLength(1);
    const resultado = paraApi(h);
    expect(resultado?.find((d) => d.dia === "terca")).toEqual({ dia: "terca", periodos: [] });
  });

  it("os períodos de cada dia vão por ordem de abertura", () => {
    const h = formularioDe({
      sexta: [
        ["19:00", "02:00"],
        ["12:00", "15:00"],
        ["16:00", "18:00"],
      ],
    });
    const sexta = paraApi(h)?.find((d) => d.dia === "sexta");
    expect(sexta?.periodos).toEqual([
      { abre: "12:00", fecha: "15:00" },
      { abre: "16:00", fecha: "18:00" },
      { abre: "19:00", fecha: "02:00" },
    ]);
  });

  it("os sete dias, de segunda a domingo, nada a mais nas chaves", () => {
    const resultado = paraApi(formularioDe({ terca: [["17:00", "02:00"]] }));
    expect(resultado?.map((d) => d.dia)).toEqual([...DIAS_PELA_ORDEM]);
    for (const dia of resultado ?? []) {
      expect(Object.keys(dia).sort()).toEqual(["dia", "periodos"]);
      for (const p of dia.periodos) expect(Object.keys(p).sort()).toEqual(["abre", "fecha"]);
    }
  });

  it("ida e volta: paraApi(daApi(h)) ≡ h para horários válidos", () => {
    for (const horario of [
      horarioDeTeste(),
      semanaDeTeste(),
      semanaDeTeste({
        sabado: [
          ["08:00", "10:00"],
          ["12:00", "15:00"],
          ["19:00", "02:00"],
        ],
      }),
    ]) {
      expect(paraApi(daApi(horario))).toEqual(horario);
    }
  });
});

describe("validarHorario: o que o backend recusa (HORARIOS_RECUSADOS) tem de ser recusado aqui", () => {
  const RECUSADOS: Array<[string, Periodos, DiaDaSemana, "abre" | "fecha" | "dia"]> = [
    ["abre-igual-a-fecha", { terca: [["17:00", "17:00"]] }, "terca", "fecha"],
    ["hora-invalida (25:00)", { terca: [["25:00", "02:00"]] }, "terca", "abre"],
    ["hora-sem-zero (7:30)", { terca: [["7:30", "02:00"]] }, "terca", "abre"],
    ["hora-com-segundos", { terca: [["17:00:00", "02:00"]] }, "terca", "abre"],
    [
      "sobrepostos",
      {
        quarta: [
          ["12:00", "15:00"],
          ["14:00", "18:00"],
        ],
      },
      "quarta",
      "dia",
    ],
    [
      "sobrepostos-iguais",
      {
        quarta: [
          ["12:00", "15:00"],
          ["12:00", "15:00"],
        ],
      },
      "quarta",
      "dia",
    ],
    [
      "contido-noutro",
      {
        quarta: [
          ["12:00", "18:00"],
          ["13:00", "14:00"],
        ],
      },
      "quarta",
      "dia",
    ],
    [
      "sobrepoe-a-noite",
      {
        sexta: [
          ["17:00", "02:00"],
          ["20:00", "23:00"],
        ],
      },
      "sexta",
      "dia",
    ],
    ["periodos-demais", periodosDemais(), "segunda", "dia"],
  ];

  it.each(RECUSADOS)("%s", (_nome, periodos, dia, onde) => {
    const erros = validarHorario(formularioDe(periodos));
    expect(semErros(erros), "tem de haver erro").toBe(false);
    if (onde === "dia") {
      expect(erros.porDia[dia]).toBeDefined();
    } else {
      const doCampo = Object.values(erros.porPeriodo).map((e) => e[onde]);
      expect(doCampo.filter((t) => t !== undefined && t !== "")).toHaveLength(1);
    }
  });

  it("abre == fecha: o erro vai no campo Fecha, com a frase própria", () => {
    const h = formularioDe({ terca: [["17:00", "17:00"]] });
    const chave = diaDe(h, "terca").periodos[0]?.chave ?? "";
    expect(validarHorario(h).porPeriodo[chave]?.fecha).toBe(TEXTOS.erroHoraIgual);
  });

  it("hora fora do padrão HH:MM (25:00, 7:30, 17:00:00): erro no campo Abre, com a frase própria", () => {
    for (const abre of ["25:00", "7:30", "17:00:00"]) {
      const h = formularioDe({ terca: [[abre, "02:00"]] });
      const chave = diaDe(h, "terca").periodos[0]?.chave ?? "";
      expect(validarHorario(h).porPeriodo[chave]?.abre, abre).toBe(TEXTOS.erroHoraInvalida);
    }
  });

  it("sobreposição: a linha do dia diz «Há períodos que se sobrepõem» e mais nada no resto da semana", () => {
    const erros = validarHorario(
      formularioDe({
        quarta: [
          ["12:00", "15:00"],
          ["14:00", "18:00"],
        ],
        quinta: [["12:00", "15:00"]],
      }),
    );
    expect(erros.porDia).toEqual({ quarta: TEXTOS.erroSobreposicao });
    expect(contarErros(erros)).toBe(1);
  });

  it("mais de 6 períodos: a linha do dia, com a frase própria", () => {
    const erros = validarHorario(formularioDe(periodosDemais()));
    expect(erros.porDia.segunda).toBe(TEXTOS.erroPeriodosDemais);
  });
});

describe("validarHorario: o que o backend aceita tem de ser aceite aqui", () => {
  const ACEITES: Array<[string, Periodos]> = [
    ["17:00–02:00 (passa da meia-noite)", { terca: [["17:00", "02:00"]] }],
    [
      "12:00–15:00 + 15:00–18:00 (adjacentes)",
      {
        quarta: [
          ["12:00", "15:00"],
          ["15:00", "18:00"],
        ],
      },
    ],
    [
      "sábado 08–10 + 12–15 + 19–02 (um dia com três períodos)",
      {
        sabado: [
          ["08:00", "10:00"],
          ["12:00", "15:00"],
          ["19:00", "02:00"],
        ],
      },
    ],
    [
      "seis períodos num dia",
      {
        segunda: [
          ["08:00", "09:00"],
          ["10:00", "11:00"],
          ["12:00", "13:00"],
          ["14:00", "15:00"],
          ["16:00", "17:00"],
          ["18:00", "19:00"],
        ],
      },
    ],
    ["os sete dias fechados (é uma afirmação do dono: fica configurado)", {}],
    [
      "17:00–02:00 e 01:00–03:00 no mesmo dia (ordenados, não se sobrepõem na linha do dia)",
      {
        terca: [
          ["17:00", "02:00"],
          ["01:00", "03:00"],
        ],
      },
    ],
    [
      "sexta 22:00–10:00 e sábado 08:00–12:00 (sobreposição ENTRE dias: o backend também aceita)",
      { sexta: [["22:00", "10:00"]], sabado: [["08:00", "12:00"]] },
    ],
    [
      "períodos fora de ordem mas sem colisão",
      {
        sexta: [
          ["19:00", "02:00"],
          ["12:00", "15:00"],
        ],
      },
    ],
  ];

  it.each(ACEITES)("%s", (_nome, periodos) => {
    expect(semErros(validarHorario(formularioDe(periodos)))).toBe(true);
  });

  it("o horário de teste inteiro é aceite", () => {
    expect(semErros(validarHorario(daApi(horarioDeTeste())))).toBe(true);
  });

  it("sem_horario (horario: null) não tem nada a validar", () => {
    expect(semErros(validarHorario({ modo: "sem_horario" }))).toBe(true);
  });

  it("um dia FECHADO com períodos escondidos vazios ou estragados nunca dá erro", () => {
    const base = formularioDe({ terca: [["17:00", "02:00"]] });
    const h = comDia(base, "terca", {
      estado: "fechado",
      periodos: [periodoNoFormulario("", "", { abreIncompleto: true })],
    });
    expect(semErros(validarHorario(h))).toBe(true);
  });
});

describe("validarHorario: o que só o editor vê", () => {
  it("dia por preencher: erro no dia, com a frase de «falta o horário de …» do dia certo", () => {
    const erros = validarHorario(comecarHorario());
    for (const dia of DIAS_PELA_ORDEM) {
      expect(erros.porDia[dia]).toBe(faltaOHorarioDe(dia));
    }
  });

  it("só os dias por preencher dão erro: os decididos não", () => {
    const h = comDia(
      comDia(comecarHorario() as Editar, "segunda", { estado: "fechado" }),
      "terca",
      {
        estado: "aberto",
        periodos: [periodoNoFormulario("17:00", "02:00")],
      },
    );
    const erros = validarHorario(h);
    expect(erros.porDia.segunda).toBeUndefined();
    expect(erros.porDia.terca).toBeUndefined();
    expect(erros.porDia.quarta).toBe(faltaOHorarioDe("quarta"));
  });

  it("dia aberto sem períodos: erro no dia (acrescenta um período ou marca Fechado)", () => {
    const h = comDia(formularioDe(), "quarta", { estado: "aberto", periodos: [] });
    expect(validarHorario(h).porDia.quarta).toBe(TEXTOS.erroDiaSemPeriodos);
  });

  it("hora vazia: erro no campo certo (abre ou fecha), com a frase certa", () => {
    const abre = periodoNoFormulario("", "02:00");
    const fecha = periodoNoFormulario("17:00", "");
    const h = comDia(
      comDia(formularioDe(), "terca", { estado: "aberto", periodos: [abre] }),
      "quarta",
      {
        estado: "aberto",
        periodos: [fecha],
      },
    );
    const erros = validarHorario(h);
    expect(erros.porPeriodo[abre.chave]).toEqual({ abre: TEXTOS.erroHoraAbre });
    expect(erros.porPeriodo[fecha.chave]).toEqual({ fecha: TEXTOS.erroHoraFecha });
  });

  it("hora INCOMPLETA (badInput) dá um erro DIFERENTE do de vazia (regra 10: «não escreveu» ≠ «escreveu metade»)", () => {
    const vazia = periodoNoFormulario("", "02:00");
    const incompleta = periodoNoFormulario("", "02:00", { abreIncompleto: true });
    const hVazia = comDia(formularioDe(), "terca", { estado: "aberto", periodos: [vazia] });
    const hIncompleta = comDia(formularioDe(), "terca", {
      estado: "aberto",
      periodos: [incompleta],
    });

    const deVazia = validarHorario(hVazia).porPeriodo[vazia.chave]?.abre;
    const deIncompleta = validarHorario(hIncompleta).porPeriodo[incompleta.chave]?.abre;

    expect(deVazia).toBe(TEXTOS.erroHoraAbre);
    expect(deIncompleta).toBe(TEXTOS.erroHoraIncompleta);
    expect(deIncompleta).not.toBe(deVazia);
  });

  it("fecha incompleta: erro no campo Fecha", () => {
    const p = periodoNoFormulario("17:00", "", { fechaIncompleto: true });
    const h = comDia(formularioDe(), "terca", { estado: "aberto", periodos: [p] });
    expect(validarHorario(h).porPeriodo[p.chave]?.fecha).toBe(TEXTOS.erroHoraIncompleta);
  });

  it("todos os erros de uma vez (para o ecrã os mostrar juntos e focar o primeiro)", () => {
    const a = periodoNoFormulario("", "02:00");
    const h = comDia(
      comDia(comecarHorario() as Editar, "segunda", { estado: "aberto", periodos: [a] }),
      "terca",
      {
        estado: "fechado",
      },
    );
    const erros = validarHorario(h);
    expect(erros.porPeriodo[a.chave]?.abre).toBe(TEXTOS.erroHoraAbre);
    expect(erros.porDia.quarta).toBe(faltaOHorarioDe("quarta"));
    expect(erros.porDia.domingo).toBe(faltaOHorarioDe("domingo"));
    expect(contarErros(erros)).toBe(1 + 5);
  });
});
