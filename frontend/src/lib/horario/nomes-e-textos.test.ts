// @vitest-environment node
/**
 * F3-06a, 5.1 e 5.2 — como se escrevem a hora, o período e a linha do momento.
 *
 * Contrato (`src/lib/horario/nomes-e-textos.ts`, que **não importa nada de
 * `pages/gestao`**: o texto do público não pode depender de uma pasta que o
 * público nunca carrega):
 *
 * ```ts
 * export const NOMES_DOS_DIAS: Record<DiaDaSemana, string>;      // "Segunda-feira" … "Domingo"
 * export function horaPorExtenso(hora: string): string;          // "às 02:00" | "à 01:00" | "à meia-noite"
 * export function textoDoPeriodo(p: { abre: string; fecha: string }): string;  // "17:00 às 02:00"
 * export function textoDaLinhaDoMomento(estado: EstadoDoHorario): string;
 * ```
 *
 * Uma frase construída por concatenação passa ao lado de qualquer varredura do
 * Q-05, por isso cada forma da secção 9 tem aqui o seu caso — como a F3-04 fez
 * com «{Dia da semana}, a partir das {hh:mm}».
 *
 * **O que deixa passar:** a ligação ao DOM (`VisitaNos.test.tsx`).
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIAS_PELA_ORDEM, type DiaDaSemana } from "../../testes/gestao";
import { RAIZ_FRONTEND, lerTexto } from "../../testes/percorrer-arvore";
import { LINHAS_DO_MOMENTO, NOMES_DOS_DIAS_NA_TABELA } from "../../testes/visita-nos";
import type { EstadoDoHorario } from "./estado-do-horario";
import {
  NOMES_DOS_DIAS,
  horaPorExtenso,
  textoDaLinhaDoMomento,
  textoDoPeriodo,
} from "./nomes-e-textos";

function aberto(fechaAs: string): EstadoDoHorario {
  return { tipo: "aberto", fechaAs, hoje: "quinta", destaque: "quinta" };
}

function fechado(
  quando: "hoje" | "amanhã" | DiaDaSemana,
  hora: string,
  hoje: DiaDaSemana = "quinta",
): EstadoDoHorario {
  return { tipo: "fechado", abre: { quando, hora }, hoje, destaque: hoje };
}

describe("os nomes dos dias na tabela", () => {
  it("são os sete, completos, de segunda a domingo", () => {
    expect(DIAS_PELA_ORDEM.map((dia) => NOMES_DOS_DIAS[dia])).toEqual([
      ...NOMES_DOS_DIAS_NA_TABELA,
    ]);
  });
});

describe("a hora na frase: «às», «à» e a meia-noite", () => {
  it.each([
    ["02:00", "às 02:00"],
    ["17:00", "às 17:00"],
    ["12:00", "às 12:00"],
    ["00:30", "às 00:30"],
    ["10:00", "às 10:00"],
    ["11:00", "às 11:00"],
    ["13:00", "às 13:00"],
    ["21:30", "às 21:30"],
    ["23:59", "às 23:59"],
    ["01:00", "à 01:00"],
    ["01:30", "à 01:30"],
    ["00:00", "à meia-noite"],
  ])("%s → %s", (hora, frase) => {
    expect(horaPorExtenso(hora)).toBe(frase);
  });
});

describe("o período na tabela", () => {
  it.each([
    [{ abre: "17:00", fecha: "02:00" }, "17:00 às 02:00"],
    [{ abre: "12:00", fecha: "15:00" }, "12:00 às 15:00"],
    // Na tabela mantém-se «00:00»: é uma tabela de horas (5.1).
    [{ abre: "17:00", fecha: "00:00" }, "17:00 às 00:00"],
    // «às» sempre, mesmo à 01:00: na tabela não há artigo variável.
    [{ abre: "17:00", fecha: "01:00" }, "17:00 às 01:00"],
    [{ abre: "00:30", fecha: "02:00" }, "00:30 às 02:00"],
  ])("%j → %s", (periodo, texto) => {
    expect(textoDoPeriodo(periodo)).toBe(texto);
  });

  it("nunca usa «-», «–» nem «—» entre as horas", () => {
    expect(textoDoPeriodo({ abre: "17:00", fecha: "02:00" })).not.toMatch(/[-–—]/);
  });
});

describe("a linha do momento (secção 9)", () => {
  it.each([
    [aberto("02:00"), LINHAS_DO_MOMENTO.ateAsDuas],
    [aberto("01:00"), LINHAS_DO_MOMENTO.ateAUma],
    [aberto("00:00"), LINHAS_DO_MOMENTO.ateAMeiaNoite],
    [aberto("00:30"), "Aberto até às 00:30"],
    [aberto("01:30"), "Aberto até à 01:30"],
    [aberto("23:00"), "Aberto até às 23:00"],
    [fechado("hoje", "17:00"), LINHAS_DO_MOMENTO.fechadoAbreHoje],
    [fechado("amanhã", "17:00"), LINHAS_DO_MOMENTO.fechadoAbreAmanha],
    [fechado("sexta", "17:00", "domingo"), LINHAS_DO_MOMENTO.fechadoAbreNaSexta],
    [fechado("sabado", "17:00", "domingo"), LINHAS_DO_MOMENTO.fechadoAbreNoSabado],
    [fechado("quinta", "17:00", "quinta"), LINHAS_DO_MOMENTO.fechadoAbreNaProximaQuinta],
    [{ tipo: "fechado", abre: null, hoje: "quinta", destaque: "quinta" }, "Fechado"],
  ] as [EstadoDoHorario, string][])("%j → «%s»", (estado, linha) => {
    expect(textoDaLinhaDoMomento(estado)).toBe(linha);
  });

  it.each([
    ["segunda", "Fechado · Abre na segunda às 17:00"],
    ["terca", "Fechado · Abre na terça às 17:00"],
    ["quarta", "Fechado · Abre na quarta às 17:00"],
    ["quinta", "Fechado · Abre na quinta às 17:00"],
    ["sexta", "Fechado · Abre na sexta às 17:00"],
    ["sabado", "Fechado · Abre no sábado às 17:00"],
    ["domingo", "Fechado · Abre no domingo às 17:00"],
  ] as [DiaDaSemana, string][])(
    "«%s» com abertura em dia diferente do de hoje → «%s», em minúsculas e sem «-feira»",
    (dia, linha) => {
      // Hoje é um dia que nunca coincide com `dia` (a forma «próxima» fica de fora).
      const hoje: DiaDaSemana = dia === "quarta" ? "segunda" : "quarta";

      expect(textoDaLinhaDoMomento(fechado(dia, "17:00", hoje))).toBe(linha);
    },
  );

  it.each([
    ["segunda", "Fechado · Abre na próxima segunda às 12:00"],
    ["terca", "Fechado · Abre na próxima terça às 12:00"],
    ["quarta", "Fechado · Abre na próxima quarta às 12:00"],
    ["quinta", "Fechado · Abre na próxima quinta às 12:00"],
    ["sexta", "Fechado · Abre na próxima sexta às 12:00"],
  ] as [DiaDaSemana, string][])(
    "a forma «próxima» só vale quando o dia da abertura é o de hoje: %s",
    (dia, linha) => {
      expect(textoDaLinhaDoMomento(fechado(dia, "12:00", dia))).toBe(linha);
    },
  );

  it("«próxima» com sábado e domingo concorda em género: «no próximo»", () => {
    // PRESSUPOSTO a confirmar com o dominio-bar: a secção 9 só escreve «na
    // próxima quinta»; «na próxima sábado» seria erro de concordância.
    expect(textoDaLinhaDoMomento(fechado("sabado", "17:00", "sabado"))).toBe(
      "Fechado · Abre no próximo sábado às 17:00",
    );
    expect(textoDaLinhaDoMomento(fechado("domingo", "17:00", "domingo"))).toBe(
      "Fechado · Abre no próximo domingo às 17:00",
    );
  });

  it("«Abre … à meia-noite» e «à 01:00» seguem a mesma regra do artigo", () => {
    expect(textoDaLinhaDoMomento(fechado("hoje", "00:00"))).toBe(
      "Fechado · Abre hoje à meia-noite",
    );
    expect(textoDaLinhaDoMomento(fechado("amanhã", "01:00"))).toBe("Fechado · Abre amanhã à 01:00");
    expect(textoDaLinhaDoMomento(fechado("amanhã", "01:30"))).toBe("Fechado · Abre amanhã à 01:30");
    expect(textoDaLinhaDoMomento(fechado("amanhã", "00:30"))).toBe(
      "Fechado · Abre amanhã às 00:30",
    );
  });

  it("o separador é o ponto médio, não vírgula nem traço", () => {
    const linha = textoDaLinhaDoMomento(fechado("amanhã", "17:00"));

    expect(linha).toContain(" · ");
    expect(linha).not.toMatch(/[,—–→]/);
  });

  it("«Fechado» sozinho só quando não há próxima abertura", () => {
    expect(
      textoDaLinhaDoMomento({ tipo: "fechado", abre: null, hoje: "terca", destaque: "terca" }),
    ).toBe("Fechado");
    expect(textoDaLinhaDoMomento(fechado("hoje", "17:00"))).not.toBe("Fechado");
  });
});

describe("o módulo do texto não depende da gestão", () => {
  it("`nomes-e-textos.ts` não importa nada de pages/gestao", () => {
    const caminho = join(RAIZ_FRONTEND, "src/lib/horario/nomes-e-textos.ts");
    const texto = lerTexto(caminho, "o módulo de textos do horário (nomes-e-textos.ts)");

    // Guarda: li o ficheiro certo (um caminho que lesse outra coisa daria «nada importado»).
    expect(texto).toContain("NOMES_DOS_DIAS");

    // Todas as origens, também as de importações em várias linhas.
    const origens = [...texto.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");

    expect(origens.filter((origem) => /gestao|\/pages\//.test(origem))).toEqual([]);
  });
});
