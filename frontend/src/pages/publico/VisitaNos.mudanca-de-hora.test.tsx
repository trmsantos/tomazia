/**
 * F3-06a, 5.3 — o temporizador nas duas noites de mudança de hora.
 *
 * Duas coisas que só se vêm nessas noites, ambas com um sábado `17:00–01:30`:
 *
 *  - **29 de março**: a 01:30 de relógio não existe (01:59 salta para 02:00). A
 *    fronteira recua para «agora» e a espera não pode cair no mínimo de 1 s
 *    durante uma hora (cerca de 1800 recálculos): vai para a hora UTC cheia
 *    seguinte.
 *  - **25 de outubro**: a 01:xx passa duas vezes. Na primeira 01:30 (verão) o
 *    sábado já fechou; à 01:00 de inverno (uma hora real depois) o
 *    `estadoDoHorario` diz «aberto», e o ecrã tem de o dizer também, em vez de
 *    esperar uma hora inteira com «Fechado».
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { esperaAteAProximaMudanca, periodosDaSemana } from "../../lib/horario/estado-do-horario";
import { semanaDeTeste } from "../../testes/gestao";
import {
  MUDANCA_DE_HORA,
  TEXTOS_DO_VISITA_NOS as T,
  infoCom,
  pronto,
} from "../../testes/visita-nos";
import { VisitaNos } from "./VisitaNos";

const MINUTO = 60_000;
const SABADO_ATE_UMA_E_MEIA = () => semanaDeTeste({ sabado: [["17:00", "01:30"]] });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function linha(): string {
  const titulo = screen.getByRole("heading", { name: T.tituloDoHorario, level: 3 });
  return titulo.nextElementSibling?.textContent ?? "(sem linha do momento)";
}

describe("29 de março: a fronteira que não existe", () => {
  it("a 00:30 UTC com fecho às 01:30 espera cerca de 30 minutos, não 1 segundo", () => {
    const espera = esperaAteAProximaMudanca(
      periodosDaSemana(SABADO_ATE_UMA_E_MEIA()),
      new Date(MUDANCA_DE_HORA.marDom00h30),
    );

    expect(espera).toBeGreaterThanOrEqual(30 * MINUTO);
    expect(espera).toBeLessThanOrEqual(31 * MINUTO);
  });
});

describe("25 de outubro: a segunda passagem da 01:xx", () => {
  it("a espera pára na hora UTC cheia, quando o relógio recua", () => {
    const espera = esperaAteAProximaMudanca(
      periodosDaSemana(SABADO_ATE_UMA_E_MEIA()),
      new Date(MUDANCA_DE_HORA.outDom01h30Primeira),
    );

    expect(espera).toBeGreaterThanOrEqual(30 * MINUTO);
    expect(espera).toBeLessThanOrEqual(31 * MINUTO);
  });

  it("à 01:30 de verão está fechado; meia hora depois (01:00 de inverno) o ecrã diz aberto", () => {
    vi.setSystemTime(new Date(MUDANCA_DE_HORA.outDom01h30Primeira));
    render(
      <VisitaNos
        info={pronto(infoCom({ horario: SABADO_ATE_UMA_E_MEIA() }))}
        aoTentarOutraVez={() => Promise.resolve()}
      />,
    );
    expect(linha()).toMatch(/^Fechado/);

    act(() => {
      vi.advanceTimersByTime(31 * MINUTO);
    });

    expect(linha()).toBe("Aberto até à 01:30");
  });
});
