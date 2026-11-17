/**
 * F4-01, secção 2 e 5.1 — o encaminhamento da gestão, sem `react-router`
 * (está na lista recusada de `src/orcamento-q02.test.ts`): `location.pathname`,
 * `history.pushState`/`replaceState` e `popstate`.
 *
 * Contrato (`src/pages/gestao/navegacao.tsx`):
 *
 * ```ts
 * export const DESTINOS: readonly { rotulo: string; caminho: string; icone: ReactElement }[];
 * export function navegar(caminho: string, opcoes?: { substituir?: boolean; estado?: unknown }): void;
 * export const ROTAS_DOS_DESTINOS: ReadonlySet<string> | readonly string[];  // F4-02: saiu do AppGestao
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

import { limparGuardaDeSaida } from "../../testes/guarda";
import { DESTINOS_ESPERADOS, abrirEm } from "../../testes/gestao";
import {
  DESTINOS,
  ROTAS_DA_GESTAO,
  ROTAS_DOS_DESTINOS,
  TITULOS_DAS_SUBROTAS,
  definirGuardaDeSaida,
  navegar,
  navegarComGuarda,
  useCaminho,
} from "./navegacao";

beforeEach(() => {
  abrirEm("/gestao");
});

afterEach(() => {
  limparGuardaDeSaida();
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

describe("ROTAS_DOS_DESTINOS (F4-02: saiu do AppGestao para aqui)", () => {
  it("são os caminhos dos cinco destinos, e só esses (o login não é um destino)", () => {
    expect(Array.from(ROTAS_DOS_DESTINOS).sort()).toEqual(
      DESTINOS_ESPERADOS.map((destino) => destino.caminho).sort(),
    );
    expect(Array.from(ROTAS_DOS_DESTINOS)).not.toContain("/gestao/entrar");
  });
});

describe("navegar com estado (F4-02, D4: o destino e o aviso viajam no history.state)", () => {
  it("com substituir, o estado fica no histórico e o endereço não o leva", () => {
    const estado = { voltar: "/gestao/ementa?categoria=garrafeira", sessaoTerminou: true };

    act(() => {
      navegar("/gestao/entrar", { substituir: true, estado });
    });

    expect(window.history.state).toMatchObject(estado);
    expect(window.location.pathname).toBe("/gestao/entrar");
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("voltar");
  });

  it("sem substituir, o estado também vai", () => {
    act(() => {
      navegar("/gestao/eventos", { estado: { x: 1 } });
    });
    expect(window.history.state).toMatchObject({ x: 1 });
  });

  it("sem estado não herda nada da entrada anterior (só leva o índice da guarda)", () => {
    abrirEm("/gestao/entrar", { voltar: "/gestao/ementa", sessaoTerminou: true });

    act(() => {
      navegar("/gestao", { substituir: true });
    });

    const estado = window.history.state as Record<string, unknown> | null;
    expect(estado).not.toHaveProperty("voltar");
    expect(estado).not.toHaveProperty("sessaoTerminou");
  });

  it("o histórico não cresce com substituir + estado", () => {
    const antes = window.history.length;
    act(() => {
      navegar("/gestao/entrar", { substituir: true, estado: { voltar: "/gestao/mais" } });
    });
    expect(window.history.length).toBe(antes);
  });
});

/**
 * F4-05a, plano 2.2 e 2.6 + decisão D3 do Tomás — as subrotas e a guarda de saída.
 *
 * Contrato novo de `navegacao.tsx`:
 *
 * ```ts
 * export const ROTAS_DA_GESTAO: ReadonlySet<string>;               // ROTAS_DOS_DESTINOS ∪ {"/gestao/mais/definicoes"}
 * export const TITULOS_DAS_SUBROTAS: Readonly<Record<string, string>>;  // "/gestao/mais/definicoes" → "Definições"
 * export type GuardaDeSaida = (seguir: () => void) => boolean;     // true = a guarda trata (pergunta; chama `seguir` se o dono quiser); false = pode seguir
 * export function definirGuardaDeSaida(guarda: GuardaDeSaida | null): void;
 * export function navegarComGuarda(caminho: string, opcoes?: { substituir?: boolean }): void;
 * ```
 *
 * `navegar` **nunca** passa pela guarda (o 401, o login e o «Sair» nunca são
 * bloqueados). `navegarComGuarda` e o **Voltar do browser** (`popstate`) passam:
 * no Voltar, o endereço atual é reposto (`pushState` do mesmo caminho) e `seguir`
 * faz a navegação que estava pendente. `ROTAS_DOS_DESTINOS` mantém o significado
 * «os cinco da barra».
 */
describe("ROTAS_DA_GESTAO e TITULOS_DAS_SUBROTAS (F4-05a)", () => {
  it("são os cinco destinos mais /gestao/mais/definicoes, e só isso", () => {
    expect(Array.from(ROTAS_DA_GESTAO).sort()).toEqual(
      [...DESTINOS_ESPERADOS.map((d) => d.caminho), "/gestao/mais/definicoes"].sort(),
    );
    expect(Array.from(ROTAS_DA_GESTAO)).not.toContain("/gestao/entrar");
    expect(Array.from(ROTAS_DA_GESTAO)).not.toContain("/gestao/mais/outra");
  });

  it("ROTAS_DOS_DESTINOS continua a ser só os cinco da barra", () => {
    expect(ROTAS_DOS_DESTINOS.has("/gestao/mais/definicoes")).toBe(false);
    expect(ROTAS_DOS_DESTINOS.size).toBe(5);
  });

  it("a subrota tem o título «Definições»", () => {
    expect(TITULOS_DAS_SUBROTAS["/gestao/mais/definicoes"]).toBe("Definições");
  });
});

describe("a guarda de saída (D3)", () => {
  it("sem guarda, navegarComGuarda navega como o navegar", () => {
    const { result } = renderHook(() => useCaminho());
    act(() => {
      navegarComGuarda("/gestao/eventos");
    });
    expect(result.current).toBe("/gestao/eventos");
  });

  it("com guarda que devolve true: não navega, e a guarda recebe `seguir`", () => {
    const guarda = vi.fn<(seguir: () => void) => boolean>(() => true);
    definirGuardaDeSaida(guarda);
    const { result } = renderHook(() => useCaminho());

    act(() => {
      navegarComGuarda("/gestao/eventos");
    });

    expect(guarda).toHaveBeenCalledTimes(1);
    expect(typeof guarda.mock.calls[0]?.[0]).toBe("function");
    expect(result.current).toBe("/gestao");
    expect(window.location.pathname).toBe("/gestao");
  });

  it("chamar `seguir` faz a navegação pendente (e só uma vez no histórico)", () => {
    let seguir: () => void = () => undefined;
    definirGuardaDeSaida((s) => {
      seguir = s;
      return true;
    });
    const { result } = renderHook(() => useCaminho());
    const antes = window.history.length;

    act(() => {
      navegarComGuarda("/gestao/eventos");
    });
    expect(result.current).toBe("/gestao");

    definirGuardaDeSaida(null);
    act(() => {
      seguir();
    });
    expect(result.current).toBe("/gestao/eventos");
    expect(window.history.length).toBe(antes + 1);
  });

  it("com guarda que devolve false: navega", () => {
    definirGuardaDeSaida(() => false);
    const { result } = renderHook(() => useCaminho());
    act(() => {
      navegarComGuarda("/gestao/galeria");
    });
    expect(result.current).toBe("/gestao/galeria");
  });

  it("navegarComGuarda respeita `substituir`", () => {
    const substituir = vi.spyOn(window.history, "replaceState");
    const empurrar = vi.spyOn(window.history, "pushState");
    act(() => {
      navegarComGuarda("/gestao/mais", { substituir: true });
    });
    expect(substituir).toHaveBeenCalled();
    expect(empurrar).not.toHaveBeenCalled();
  });

  it("o `navegar` IGNORA a guarda (o 401, o login e o «Sair» nunca são bloqueados)", () => {
    const guarda = vi.fn<(seguir: () => void) => boolean>(() => true);
    definirGuardaDeSaida(guarda);
    const { result } = renderHook(() => useCaminho());

    act(() => {
      navegar("/gestao/entrar", { substituir: true });
    });

    expect(guarda).not.toHaveBeenCalled();
    expect(result.current).toBe("/gestao/entrar");
  });

  it("definirGuardaDeSaida(null) limpa a guarda", () => {
    const guarda = vi.fn<(seguir: () => void) => boolean>(() => true);
    definirGuardaDeSaida(guarda);
    definirGuardaDeSaida(null);
    const { result } = renderHook(() => useCaminho());
    act(() => {
      navegarComGuarda("/gestao/eventos");
    });
    expect(guarda).not.toHaveBeenCalled();
    expect(result.current).toBe("/gestao/eventos");
  });

  it("só há uma guarda de cada vez: a última definida é a que conta", () => {
    const primeira = vi.fn<(seguir: () => void) => boolean>(() => true);
    const segunda = vi.fn<(seguir: () => void) => boolean>(() => true);
    definirGuardaDeSaida(primeira);
    definirGuardaDeSaida(segunda);
    act(() => {
      navegarComGuarda("/gestao/eventos");
    });
    expect(primeira).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledTimes(1);
  });

  describe("o Voltar do browser (popstate)", () => {
    async function recuar(): Promise<void> {
      const ouvinte = vi.fn();
      window.addEventListener("popstate", ouvinte);
      window.history.back();
      await vi.waitFor(() => {
        expect(ouvinte, "o jsdom tem de disparar o popstate do Voltar").toHaveBeenCalled();
      });
      window.removeEventListener("popstate", ouvinte);
    }

    it("com guarda que devolve true: o endereço atual é reposto e a guarda é chamada", async () => {
      abrirEm("/gestao/mais");
      navegar("/gestao/mais/definicoes");
      const guarda = vi.fn<(seguir: () => void) => boolean>(() => true);
      definirGuardaDeSaida(guarda);
      const { result } = renderHook(() => useCaminho());

      await recuar();

      expect(guarda).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(window.location.pathname).toBe("/gestao/mais/definicoes");
      });
      expect(result.current).toBe("/gestao/mais/definicoes");
    });

    it("`seguir` leva ao destino do Voltar", async () => {
      abrirEm("/gestao/mais");
      navegar("/gestao/mais/definicoes");
      let seguir: () => void = () => undefined;
      definirGuardaDeSaida((s) => {
        seguir = s;
        return true;
      });
      const { result } = renderHook(() => useCaminho());

      await recuar();
      await vi.waitFor(() => {
        expect(window.location.pathname).toBe("/gestao/mais/definicoes");
      });

      definirGuardaDeSaida(null);
      act(() => {
        seguir();
      });
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao/mais");
      });
    });

    it("Voltar + «Sair sem guardar»: a entrada que se deixa não fica duplicada no histórico", async () => {
      abrirEm("/gestao");
      navegar("/gestao/mais");
      navegar("/gestao/mais/definicoes");
      let seguir: () => void = () => undefined;
      definirGuardaDeSaida((s) => {
        seguir = s;
        return true;
      });
      const { result } = renderHook(() => useCaminho());
      const comprimento = window.history.length;

      await recuar();
      await vi.waitFor(() => {
        expect(window.location.pathname).toBe("/gestao/mais/definicoes");
      });
      expect(window.history.length, "a guarda não acrescenta entradas").toBe(comprimento);

      definirGuardaDeSaida(null);
      act(() => {
        seguir();
      });
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao/mais");
      });

      // Um segundo Voltar vai para trás de «Mais», e não para uma cópia dela.
      await recuar();
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao");
      });
    });

    it("Avançar com guarda: pergunta, repõe o sítio e `seguir` avança uma só vez", async () => {
      abrirEm("/gestao");
      navegar("/gestao/mais");
      navegar("/gestao/mais/definicoes");
      const { result } = renderHook(() => useCaminho());
      await recuar();
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao/mais");
      });

      let seguir: () => void = () => undefined;
      const guarda = vi.fn<(seguir: () => void) => boolean>((s) => {
        seguir = s;
        return true;
      });
      definirGuardaDeSaida(guarda);
      window.history.forward();
      await vi.waitFor(() => {
        expect(guarda).toHaveBeenCalledTimes(1);
      });
      await vi.waitFor(() => {
        expect(window.location.pathname).toBe("/gestao/mais");
      });

      definirGuardaDeSaida(null);
      act(() => {
        seguir();
      });
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao/mais/definicoes");
      });

      await recuar();
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao/mais");
      });
    });

    it("o estado da entrada (`voltar`, `sessaoTerminou`) sobrevive ao índice", () => {
      navegar("/gestao/entrar", { estado: { voltar: "/gestao/ementa", sessaoTerminou: true } });
      expect(window.history.state).toMatchObject({
        voltar: "/gestao/ementa",
        sessaoTerminou: true,
      });
    });

    it("sem guarda, o Voltar funciona como sempre", async () => {
      abrirEm("/gestao/mais");
      navegar("/gestao/mais/definicoes");
      const { result } = renderHook(() => useCaminho());
      await recuar();
      await vi.waitFor(() => {
        expect(result.current).toBe("/gestao/mais");
      });
    });
  });
});
