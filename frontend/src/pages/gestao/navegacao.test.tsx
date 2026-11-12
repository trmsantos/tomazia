/**
 * F4-01, secção 2 e 5.1 — o encaminhamento da gestão, sem `react-router`
 * (está na lista recusada de `src/orcamento-q02.test.ts`): `location.pathname`,
 * `history.pushState`/`replaceState` e `popstate`.
 *
 * Contrato (`src/pages/gestao/navegacao.tsx`):
 *
 * ```ts
 * export const DESTINOS: readonly { rotulo: string; caminho: string; icone: ReactElement }[];
 * export function navegar(caminho: string, opcoes?: { substituir?: boolean }): void;
 * export function useCaminho(): string;   // o `location.pathname` atual, reativo
 * ```
 *
 * `navegar` empurra uma entrada no histórico, ou **substitui** a atual com
 * `{ substituir: true }` (login com sucesso, 401, sair: o «Voltar» não regressa).
 * Todos os componentes que dependem do endereço atualizam-se ao `navegar` e ao
 * `popstate` (o botão Recuar).
 *
 * **O que prova:** os cinco destinos por ordem; push vs replace; reatividade; o
 * `popstate`; que o ouvinte sai ao desmontar. **Deixa passar:** os ícones.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESTINOS_ESPERADOS, abrirEm } from "../../testes/gestao";
import { DESTINOS, navegar, useCaminho } from "./navegacao";

beforeEach(() => {
  abrirEm("/gestao");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DESTINOS", () => {
  it("são cinco, por esta ordem, com estas rotas", () => {
    expect(DESTINOS.map(({ rotulo, caminho }) => ({ rotulo, caminho }))).toEqual(
      DESTINOS_ESPERADOS,
    );
  });
});

describe("navegar e useCaminho", () => {
  it("useCaminho começa no pathname atual", () => {
    abrirEm("/gestao/ementa");
    const { result } = renderHook(() => useCaminho());
    expect(result.current).toBe("/gestao/ementa");
  });

  it("navegar empurra uma entrada e atualiza quem está a ouvir", () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    const substituir = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useCaminho());
    const antes = window.history.length;

    act(() => {
      navegar("/gestao/eventos");
    });

    expect(empurrar).toHaveBeenCalledTimes(1);
    expect(empurrar.mock.calls[0]?.[2]).toBe("/gestao/eventos");
    expect(substituir).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/gestao/eventos");
    expect(window.history.length).toBe(antes + 1);
    expect(result.current).toBe("/gestao/eventos");
  });

  it("navegar com substituir troca a entrada, sem acrescentar nenhuma", () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    const substituir = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useCaminho());
    const antes = window.history.length;

    act(() => {
      navegar("/gestao/entrar", { substituir: true });
    });

    expect(substituir).toHaveBeenCalledTimes(1);
    expect(substituir.mock.calls[0]?.[2]).toBe("/gestao/entrar");
    expect(empurrar).not.toHaveBeenCalled();
    expect(window.history.length).toBe(antes);
    expect(result.current).toBe("/gestao/entrar");
  });

  it("o popstate (Recuar) atualiza o caminho", () => {
    const { result } = renderHook(() => useCaminho());

    act(() => {
      window.history.pushState(null, "", "/gestao/galeria");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current).toBe("/gestao/galeria");
  });

  it("dois ouvintes veem o mesmo caminho", () => {
    const a = renderHook(() => useCaminho());
    const b = renderHook(() => useCaminho());

    act(() => {
      navegar("/gestao/mais");
    });

    expect(a.result.current).toBe("/gestao/mais");
    expect(b.result.current).toBe("/gestao/mais");
  });

  it("ao desmontar, o ouvinte do popstate sai", () => {
    const adicionar = vi.spyOn(window, "addEventListener");
    const retirar = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useCaminho());

    const popstates = adicionar.mock.calls.filter(([tipo]) => tipo === "popstate").length;
    expect(popstates, "o hook tem de ouvir o popstate").toBeGreaterThan(0);

    unmount();

    expect(retirar.mock.calls.filter(([tipo]) => tipo === "popstate").length).toBe(popstates);
  });
});
