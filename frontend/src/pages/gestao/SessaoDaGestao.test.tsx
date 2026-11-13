/**
 * F4-01, secção «Contexto SessaoDaGestao» do plano — o gancho que as F4-02 a
 * F4-05 usam quando um pedido da gestão devolve 401 a meio.
 *
 * Contrato (`src/pages/gestao/SessaoDaGestao.tsx`):
 *
 * ```ts
 * export function useSessaoDaGestao(): { aoPerderSessao: () => void }
 * ```
 *
 * Disponível a tudo o que o `AppGestao` desenha dentro da guarda (via
 * `<Destino>`). `aoPerderSessao()` apaga o resultado da guarda e leva ao login
 * com `replaceState`, tal como o 401 da guarda. Para o testar sem esperar pelas
 * tarefas seguintes, este ficheiro finge o `Destino` por uma sonda que usa o
 * gancho — o que também fixa que `AppGestao` renderiza
 * `<Destino caminho={…} />` (export nomeado de `./Destino`).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { quemSouEu } from "../../lib/api/auth";
import { SESSAO_DE_TESTE, TEXTOS_DA_GESTAO as T, abrirEm, erro401 } from "../../testes/gestao";
import AppGestao from "./AppGestao";

vi.mock("../../lib/api/auth", () => ({ entrar: vi.fn(), quemSouEu: vi.fn(), sair: vi.fn() }));

vi.mock("./Destino", async () => {
  const { useSessaoDaGestao } = await import("./SessaoDaGestao");
  return {
    Destino: ({ caminho }: { caminho: string }) => {
      const { aoPerderSessao } = useSessaoDaGestao();
      return (
        <div>
          <h1>Sonda {caminho}</h1>
          <button type="button" onClick={aoPerderSessao}>
            Perder a sessão
          </button>
        </div>
      );
    },
  };
});

const quemSouEuFalso = vi.mocked(quemSouEu);

beforeEach(() => {
  quemSouEuFalso.mockReset();
  quemSouEuFalso.mockResolvedValue(SESSAO_DE_TESTE);
});

describe("aoPerderSessao", () => {
  it("leva ao login, a substituir, e já não mostra a moldura", async () => {
    abrirEm("/gestao/ementa");
    render(<AppGestao />);
    await screen.findByRole("heading", { level: 1, name: "Sonda /gestao/ementa" });
    const empurrar = vi.spyOn(window.history, "pushState");
    quemSouEuFalso.mockRejectedValue(erro401());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Perder a sessão" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(empurrar).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
