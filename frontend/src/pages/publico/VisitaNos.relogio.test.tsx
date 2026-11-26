/**
 * F3-06a, 5.3 e critério 6 — a secção atualiza-se sozinha, com temporizadores falsos.
 *
 * Mesmo contrato de `VisitaNos.test.tsx`. O que a secção 5.3 manda, e o que
 * este ficheiro mede:
 *
 *  1. **um só `setTimeout`**, nunca `setInterval`, agendado para a próxima
 *     mudança (abertura, fecho ou a meia-noite de Lisboa, o que vier primeiro);
 *  2. **nunca mais de 1 hora** (3 600 000 ms), mesmo que a próxima mudança esteja
 *     a dias e nas noites de mudança de hora;
 *  3. recalcula em `visibilitychange` (com `visible`) e em `pageshow`;
 *  4. ao desmontar limpa o temporizador e os dois ouvintes.
 *
 * Pressupostos do teste, para o implementador: `visibilitychange` ouve-se no
 * `document` e `pageshow` na `window` (é aí que o browser os dispara); o
 * temporizador pede-se por `setTimeout` global (não por `window.setTimeout`
 * guardado antes — o `vi.useFakeTimers` troca o global).
 *
 * **O que deixa passar:** o que o browser faz com um separador em segundo plano
 * (aqui o «bloqueou o telemóvel» é um relógio que salta sem os temporizadores
 * correrem); isso fica a ser do `e2e/visita-nos.spec.ts`, com `page.clock`.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FUSOS_DO_APARELHO, comOFusoDoAparelhoEm } from "../../testes/fuso";
import {
  LINHAS_DO_MOMENTO,
  MOMENTOS,
  MUDANCA_DE_HORA,
  TEXTOS_DO_VISITA_NOS as T,
  horarioPadrao,
  infoCom,
  pronto,
} from "../../testes/visita-nos";
import { VisitaNos } from "./VisitaNos";

const UMA_HORA = 3_600_000;
const MINUTO = 60_000;

function montar(momento: string) {
  vi.setSystemTime(new Date(momento));
  return render(
    <VisitaNos
      info={pronto(infoCom({ horario: horarioPadrao() }))}
      aoTentarOutraVez={() => Promise.resolve()}
    />,
  );
}

function linha(): string {
  const titulo = screen.getByRole("heading", { name: T.tituloDoHorario, level: 3 });
  return titulo.nextElementSibling?.textContent ?? "(sem linha do momento)";
}

function linhaDeHoje(): string {
  const atual = document.querySelector('tr[aria-current="date"]');
  return atual?.querySelector("th")?.textContent ?? "(sem destaque)";
}

/** Os atrasos pedidos a `setTimeout` desde que o espião foi posto. */
function atrasosPedidos(espiao: { mock: { calls: unknown[][] } }): number[] {
  return espiao.mock.calls
    .map((chamada) => chamada[1])
    .filter((atraso): atraso is number => typeof atraso === "number");
}

function dizQueEstaVisivel(estado: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
}

beforeEach(() => {
  vi.useFakeTimers();
  dizQueEstaVisivel("visible");
});

afterEach(() => {
  // O ouvinte tem de ter desaparecido com o componente: um que sobrevivesse
  // ao teste acordava no seguinte.
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("passa a hora de fecho sem interação (critério 6)", () => {
  it("às 01:59 está aberto; ao chegar às 02:00 passa a fechado, sem ninguém mexer", () => {
    montar(MOMENTOS.qui01h59);
    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);
    expect(linhaDeHoje()).toBe("Quarta-feira");

    act(() => {
      vi.advanceTimersByTime(MINUTO + 1000);
    });

    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreHoje);
    expect(linhaDeHoje(), "o destaque acompanha: o período de quarta acabou").toBe("Quinta-feira");
  });

  it("antes da hora não muda (o temporizador não dispara cedo de mais)", () => {
    montar(MOMENTOS.qui01h59);

    act(() => {
      vi.advanceTimersByTime(MINUTO - 5000);
    });

    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);
  });

  it("a abertura também: às 16:50 fechado, às 17:00 aberto", () => {
    montar("2026-07-09T15:50:00Z");
    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreHoje);

    act(() => {
      vi.advanceTimersByTime(10 * MINUTO + 1000);
    });

    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);
    expect(linhaDeHoje()).toBe("Quinta-feira");
  });

  it("reagenda sozinho: de hora a hora, da abertura até ao fecho seguinte, sem interação", () => {
    montar("2026-07-09T15:50:00Z"); // quinta 16:50
    act(() => {
      vi.advanceTimersByTime(11 * MINUTO);
    });
    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);

    // Dez horas, uma hora de cada vez (cada `act` deixa o React reagendar).
    for (let hora = 0; hora < 10; hora += 1) {
      act(() => {
        vi.advanceTimersByTime(UMA_HORA);
      });
    }

    // Sexta 03:01: o período de quinta acabou às 02:00 e a sexta só abre às 17:00.
    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreHoje);
    expect(linhaDeHoje()).toBe("Sexta-feira");
  });

  it("à meia-noite de Lisboa «amanhã» passa a «hoje» (o dia civil também é uma mudança)", () => {
    montar("2026-07-06T22:59:00Z"); // segunda 23:59
    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreAmanha);

    act(() => {
      vi.advanceTimersByTime(2 * MINUTO);
    });

    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreHoje);
    expect(linhaDeHoje()).toBe("Terça-feira");
  });
});

describe("um só setTimeout, nunca setInterval, e nunca mais de uma hora (5.3, 1 e 2)", () => {
  it("há um temporizador à espera; nunca um setInterval", () => {
    const intervalo = vi.spyOn(globalThis, "setInterval");
    const antes = vi.getTimerCount();

    montar(MOMENTOS.qui01h59);

    expect(intervalo).not.toHaveBeenCalled();
    expect(vi.getTimerCount() - antes).toBe(1);
  });

  it("depois de disparar continua a haver um só (não acumula)", () => {
    const antes = vi.getTimerCount();
    montar(MOMENTOS.qui01h59);

    act(() => {
      vi.advanceTimersByTime(MINUTO + 1000);
    });
    expect(vi.getTimerCount() - antes).toBe(1);

    act(() => {
      vi.advanceTimersByTime(UMA_HORA);
    });
    expect(vi.getTimerCount() - antes).toBe(1);
  });

  it("agenda para a próxima mudança: abre daqui a 20 minutos → cerca de 20 minutos", () => {
    const espiao = vi.spyOn(globalThis, "setTimeout");

    montar("2026-07-09T15:40:00Z"); // quinta 16:40

    const atrasos = atrasosPedidos(espiao).filter((a) => a >= 1000);
    expect(atrasos, "guarda: ninguém pediu um temporizador").not.toEqual([]);
    expect(Math.min(...atrasos)).toBeGreaterThanOrEqual(20 * MINUTO);
    expect(Math.min(...atrasos)).toBeLessThanOrEqual(21 * MINUTO);
  });

  it("agenda para a meia-noite se ela vier antes do fecho: terça 23:30 → cerca de 30 minutos", () => {
    const espiao = vi.spyOn(globalThis, "setTimeout");

    montar(MOMENTOS.ter23h30); // o fecho é às 02:00; a meia-noite é primeiro

    const atrasos = atrasosPedidos(espiao).filter((a) => a >= 1000);
    expect(atrasos).not.toEqual([]);
    expect(Math.min(...atrasos)).toBeGreaterThanOrEqual(30 * MINUTO);
    expect(Math.min(...atrasos)).toBeLessThanOrEqual(31 * MINUTO);
  });

  it("com a próxima mudança a dias (domingo 12:00), o prazo é o teto de 1 hora", () => {
    const espiao = vi.spyOn(globalThis, "setTimeout");

    montar(MOMENTOS.dom12h00);

    const atrasos = atrasosPedidos(espiao).filter((a) => a >= 1000);
    expect(atrasos, "guarda: ninguém pediu um temporizador").not.toEqual([]);
    expect(Math.max(...atrasos)).toBeLessThanOrEqual(UMA_HORA);
    // E é mesmo o teto, não «um minuto qualquer»: reagendar de minuto a minuto era CPU a mais.
    expect(Math.max(...atrasos)).toBeGreaterThanOrEqual(30 * MINUTO);
  });

  it.each(Object.entries({ ...MUDANCA_DE_HORA, ...MOMENTOS }))(
    "nunca agenda mais de 1 hora, em %s (%s)",
    (_nome, instante) => {
      const espiao = vi.spyOn(globalThis, "setTimeout");

      montar(instante);

      const atrasos = atrasosPedidos(espiao);
      expect(atrasos.filter((a) => a > UMA_HORA)).toEqual([]);
    },
  );

  it("nas duas noites de mudança de hora, uma hora a seguir à outra, o temporizador nunca passa de 1 h", () => {
    for (const inicio of [MUDANCA_DE_HORA.marSab23h30, MUDANCA_DE_HORA.outSab23h30]) {
      const espiao = vi.spyOn(globalThis, "setTimeout");
      const { unmount } = montar(inicio);

      // Seis horas à frente, uma de cada vez, a atravessar o salto.
      for (let hora = 0; hora < 6; hora += 1) {
        act(() => {
          vi.advanceTimersByTime(UMA_HORA);
        });
      }

      expect(
        atrasosPedidos(espiao).filter((a) => a > UMA_HORA),
        inicio,
      ).toEqual([]);
      unmount();
      espiao.mockRestore();
    }
  });

  it("a passar o salto de março, a linha continua a ser a da hora de relógio", () => {
    // Sábado 23:30 (WET) → aberto. 01:30 UTC depois = 02:30 de relógio (WEST): fechado.
    montar(MUDANCA_DE_HORA.marSab23h30);
    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);

    for (let hora = 0; hora < 2; hora += 1) {
      act(() => {
        vi.advanceTimersByTime(UMA_HORA);
      });
    }

    // 23:30Z + 2 h = 01:30Z: 02:30 em Lisboa, depois do fecho.
    expect(linha()).toBe("Fechado · Abre na terça às 17:00");
  });
});

describe("recalcula ao voltar ao ecrã (5.3, 3)", () => {
  it("ouve visibilitychange no document e pageshow na window", () => {
    const noDocument = vi.spyOn(document, "addEventListener");
    const naJanela = vi.spyOn(window, "addEventListener");

    montar(MOMENTOS.qui01h59);

    expect(noDocument.mock.calls.map((c) => c[0])).toContain("visibilitychange");
    expect(naJanela.mock.calls.map((c) => c[0])).toContain("pageshow");
  });

  it("visibilitychange com «visible» refaz o cálculo, mesmo sem o temporizador ter corrido", () => {
    montar(MOMENTOS.qui01h59);
    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);

    // O telemóvel esteve bloqueado: o relógio andou 11 minutos e os temporizadores não correram.
    vi.setSystemTime(new Date("2026-07-09T01:10:00Z")); // quinta 02:10
    expect(linha(), "guarda: nada se refez só por o relógio ter andado").toBe(
      LINHAS_DO_MOMENTO.ateAsDuas,
    );

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreHoje);
  });

  it("pageshow (voltar atrás, página da cache) também refaz o cálculo", () => {
    montar(MOMENTOS.qui01h59);
    vi.setSystemTime(new Date("2026-07-09T01:10:00Z"));
    expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreHoje);
  });

  it("recalcular reagenda sem acumular temporizadores", () => {
    const antes = vi.getTimerCount();
    montar(MOMENTOS.qui01h59);

    for (let vez = 0; vez < 3; vez += 1) {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
      });
    }

    expect(vi.getTimerCount() - antes).toBe(1);
  });
});

describe("desmontar limpa tudo (5.3, 4)", () => {
  it("não fica nenhum temporizador, e os dois ouvintes saem com a mesma função com que entraram", () => {
    const entrouNoDocument = vi.spyOn(document, "addEventListener");
    const saiuDoDocument = vi.spyOn(document, "removeEventListener");
    const entrouNaJanela = vi.spyOn(window, "addEventListener");
    const saiuDaJanela = vi.spyOn(window, "removeEventListener");
    const antes = vi.getTimerCount();

    const { unmount } = montar(MOMENTOS.qui01h59);
    expect(vi.getTimerCount() - antes, "guarda: havia um temporizador para limpar").toBe(1);

    unmount();

    expect(vi.getTimerCount() - antes).toBe(0);

    const ouvinteDeVisibilidade = entrouNoDocument.mock.calls.find(
      (c) => c[0] === "visibilitychange",
    );
    const ouvinteDePageshow = entrouNaJanela.mock.calls.find((c) => c[0] === "pageshow");
    expect(ouvinteDeVisibilidade, "guarda: não ouviu visibilitychange").toBeDefined();
    expect(ouvinteDePageshow, "guarda: não ouviu pageshow").toBeDefined();
    expect(saiuDoDocument.mock.calls.map((c) => [c[0], c[1]])).toContainEqual([
      "visibilitychange",
      ouvinteDeVisibilidade?.[1],
    ]);
    expect(saiuDaJanela.mock.calls.map((c) => [c[0], c[1]])).toContainEqual([
      "pageshow",
      ouvinteDePageshow?.[1],
    ]);
  });

  it("depois de desmontada, o tempo a passar e os eventos não fazem nada", () => {
    const { unmount, container } = montar(MOMENTOS.qui01h59);
    unmount();
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);

    act(() => {
      vi.advanceTimersByTime(3 * UMA_HORA);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(container.innerHTML).toBe("");
    expect(erros).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mudar o estado para «a carregar» ou «falhou» também larga o temporizador", () => {
    const antes = vi.getTimerCount();
    const { rerender } = montar(MOMENTOS.qui01h59);
    expect(vi.getTimerCount() - antes).toBe(1);

    rerender(
      <VisitaNos
        info={{ estado: "falhou", estadoHttp: 500 }}
        aoTentarOutraVez={() => Promise.resolve()}
      />,
    );

    expect(vi.getTimerCount() - antes).toBe(0);
  });
});

describe.each(FUSOS_DO_APARELHO)("com o relógio do aparelho em %s", (fuso) => {
  it("segunda 00:30 de Lisboa: «Abre amanhã» e a linha de segunda destacada", () => {
    comOFusoDoAparelhoEm(fuso, () => {
      const { unmount } = montar(MOMENTOS.seg00h30);

      expect(linha()).toBe(LINHAS_DO_MOMENTO.fechadoAbreAmanha);
      expect(linhaDeHoje()).toBe("Segunda-feira");
      unmount();
    });
  });

  it("quarta 00:30 de Lisboa: ainda aberto até às 02:00, com a terça destacada", () => {
    comOFusoDoAparelhoEm(fuso, () => {
      const { container, unmount } = montar(MOMENTOS.qua00h30);

      expect(linha()).toBe(LINHAS_DO_MOMENTO.ateAsDuas);
      expect(linhaDeHoje()).toBe("Terça-feira");
      expect(within(container).getAllByRole("row")).toHaveLength(7);
      unmount();
    });
  });
});
