/**
 * F3-06a, 5.1 e critério 7 — um aparelho sem `Europe/Lisbon` no `Intl`.
 *
 * Este ficheiro **inteiro** corre com `Intl.DateTimeFormat` a levantar
 * `RangeError` para `timeZone: "Europe/Lisbon"`, instalado **antes** de qualquer
 * importação (`vi.hoisted`): assim vale mesmo que o `estado-do-horario.ts`
 * guarde um formatador à entrada do módulo. (Se ele o criar ao carregar, o
 * módulo rebenta ao importar e todos os testes caem: o formatador tem de ser
 * criado **dentro** da função, onde o erro vira `ErroSemLisboa`.)
 *
 * O que a secção 5.1 manda: sem Lisboa **não há linha do momento**, só a
 * tabela, e **não há destaque** (não se adivinha o dia com o relógio do
 * telemóvel). E nunca «Fechado» por omissão: cada célula da tabela diz o que o
 * horário diz, e mais nada.
 *
 * **O que deixa passar:** os aparelhos reais sem ICU completo.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const Original = Intl.DateTimeFormat;
  function SemLisboa(
    this: unknown,
    locales?: string | string[],
    opcoes?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat {
    if (opcoes?.timeZone === "Europe/Lisbon") {
      throw new RangeError("Invalid time zone specified: Europe/Lisbon");
    }
    return new Original(locales, opcoes);
  }
  SemLisboa.prototype = Original.prototype;
  SemLisboa.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
  Object.defineProperty(Intl, "DateTimeFormat", {
    configurable: true,
    writable: true,
    value: SemLisboa,
  });
});

import {
  MOMENTOS,
  TEXTOS_DO_VISITA_NOS as T,
  horarioPadrao,
  infoCompleta,
  pronto,
} from "../../testes/visita-nos";
import {
  ErroSemLisboa,
  estadoDoHorario,
  periodosDaSemana,
} from "../../lib/horario/estado-do-horario";
import { VisitaNos } from "./VisitaNos";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(MOMENTOS.qui17h00));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("guarda: este ficheiro corre mesmo sem Lisboa", () => {
  it("o Intl desta suite levanta RangeError para Europe/Lisbon (e só para ela)", () => {
    expect(() => new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon" })).toThrow(
      RangeError,
    );
    expect(() => new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC" })).not.toThrow();
  });
});

describe("a função pura", () => {
  it("levanta ErroSemLisboa, em vez de adivinhar com o relógio do aparelho", () => {
    const chamar = () =>
      estadoDoHorario(periodosDaSemana(horarioPadrao()), new Date(MOMENTOS.qui17h00));

    expect(chamar).toThrow(ErroSemLisboa);
    expect(chamar).toThrow(Error);
  });
});

describe("a secção sem Lisboa (critério 7)", () => {
  it("a tabela fica, a linha do momento e o destaque não", () => {
    const { container } = render(
      <VisitaNos info={pronto(infoCompleta())} aoTentarOutraVez={() => Promise.resolve()} />,
    );
    const s = container.querySelector("section#visita-nos") as HTMLElement;

    const tabela = within(s).getByRole("table", { name: T.legendaDaTabela });
    expect(tabela.querySelectorAll("tr")).toHaveLength(7);
    expect(tabela.querySelectorAll("td")[1]?.textContent).toBe("17:00 às 02:00");

    const titulo = within(s).getByRole("heading", { name: T.tituloDoHorario, level: 3 });
    expect(
      titulo.nextElementSibling?.tagName,
      "sem linha do momento: a tabela vem logo a seguir",
    ).toBe("TABLE");
    expect(s.querySelector("[aria-current]")).toBeNull();
    expect(s.textContent).not.toMatch(/aberto até|abre (hoje|amanhã|na |no )/i);
    expect(s.querySelector("p")).toBeNull();
  });

  it("os contactos aparecem como sempre", () => {
    render(<VisitaNos info={pronto(infoCompleta())} aoTentarOutraVez={() => Promise.resolve()} />);

    expect(screen.getByRole("link", { name: T.abrirNoMaps })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: T.tituloDosContactos })).toBeInTheDocument();
  });

  it("nada agendado: nenhum temporizador (5.3, ponto 5)", () => {
    const antes = vi.getTimerCount();

    render(<VisitaNos info={pronto(infoCompleta())} aoTentarOutraVez={() => Promise.resolve()} />);

    expect(vi.getTimerCount() - antes).toBe(0);
  });
});
