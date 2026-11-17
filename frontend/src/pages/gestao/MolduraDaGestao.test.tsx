/**
 * F4-01, secções 5 e 6 — a moldura da gestão: a navegação, o salto, o `<main>`.
 *
 * Contrato (`src/pages/gestao/MolduraDaGestao.tsx`):
 *
 * ```tsx
 * export function MolduraDaGestao(props: { caminho: string; children: ReactNode }): ReactElement
 * ```
 *
 * `caminho` é o `pathname` atual (quem decide a ligação ativa); `children` vai
 * para dentro do `<main id="conteudo" tabindex="-1">`. A moldura **não** escolhe
 * o destino nem escreve o `<h1>`: é o `AppGestao` que o faz (testado lá).
 *
 * **O que prova:** `<nav aria-label="Gestão">` com cinco ligações (`<a href>`),
 * rótulo visível e ícone `aria-hidden`; `aria-current="page"` só na ativa
 * («Início» só em `/gestao` exato; «Mais» também por baixo de `/gestao/mais`);
 * a ordem de tabulação (salto, cinco destinos, conteúdo) e `<nav>` antes de
 * `<main>`; tocar na ativa não faz nada; tocar noutra navega sem recarregar.
 * **Deixa passar:** tudo o que é CSS (barra vs coluna, 44 px, cores) — é o e2e.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESTINOS_ESPERADOS, TEXTOS_DA_GESTAO, abrirEm } from "../../testes/gestao";
import { limparGuardaDeSaida } from "../../testes/guarda";
import { MolduraDaGestao } from "./MolduraDaGestao";
import { definirGuardaDeSaida } from "./navegacao";

function moldura(caminho: string) {
  abrirEm(caminho);
  return render(
    <MolduraDaGestao caminho={caminho}>
      <h1>Título de teste</h1>
      <button type="button">Botão do conteúdo</button>
    </MolduraDaGestao>,
  );
}

function ligacoes(): HTMLElement[] {
  return within(screen.getByRole("navigation", { name: TEXTOS_DA_GESTAO.navegacao })).getAllByRole(
    "link",
  );
}

beforeEach(() => {
  abrirEm("/gestao");
});

afterEach(() => {
  limparGuardaDeSaida();
  vi.restoreAllMocks();
});

describe("a navegação", () => {
  it("há uma só <nav>, chamada «Gestão», com cinco ligações por ordem", () => {
    moldura("/gestao");

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(ligacoes().map((ligacao) => ligacao.textContent)).toEqual(
      DESTINOS_ESPERADOS.map((destino) => destino.rotulo),
    );
  });

  it("cada ligação é um <a href> para a sua rota", () => {
    moldura("/gestao");

    ligacoes().forEach((ligacao, indice) => {
      expect(ligacao.tagName).toBe("A");
      expect(ligacao).toHaveAttribute("href", DESTINOS_ESPERADOS[indice]?.caminho);
    });
  });

  it("ícone e texto, os dois: um <svg aria-hidden> por ligação, e o nome acessível é só o rótulo", () => {
    moldura("/gestao");

    ligacoes().forEach((ligacao, indice) => {
      const icone = ligacao.querySelector("svg");
      expect(icone, `«${ligacao.textContent ?? ""}» sem ícone`).not.toBeNull();
      expect(icone).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByRole("link", { name: DESTINOS_ESPERADOS[indice]?.rotulo })).toBe(ligacao);
    });
  });

  it.each(DESTINOS_ESPERADOS)(
    "em $caminho só «$rotulo» leva aria-current=page",
    ({ caminho, rotulo }) => {
      moldura(caminho);

      for (const ligacao of ligacoes()) {
        if (ligacao.textContent === rotulo) {
          expect(ligacao).toHaveAttribute("aria-current", "page");
        } else {
          expect(
            ligacao,
            `«${ligacao.textContent ?? ""}» não devia ser a atual`,
          ).not.toHaveAttribute("aria-current");
        }
      }
    },
  );

  it("«Início» não é ativo em /gestao/ementa", () => {
    moldura("/gestao/ementa");
    expect(screen.getByRole("link", { name: "Início" })).not.toHaveAttribute("aria-current");
  });

  it("«Mais» é ativo também por baixo de /gestao/mais", () => {
    moldura("/gestao/mais/conta");
    expect(screen.getByRole("link", { name: "Mais" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Início" })).not.toHaveAttribute("aria-current");
  });

  it("«Sair» não está na moldura: vive em «Mais»", () => {
    moldura("/gestao");
    expect(screen.queryByRole("button", { name: TEXTOS_DA_GESTAO.sair })).toBeNull();
    expect(screen.queryByRole("link", { name: TEXTOS_DA_GESTAO.sair })).toBeNull();
  });
});

describe("o salto, a ordem e o <main>", () => {
  it("o <main> é o nó de #conteudo, com tabindex -1, e leva o conteúdo", () => {
    moldura("/gestao");

    const principal = screen.getByRole("main");
    expect(principal).toHaveAttribute("id", "conteudo");
    expect(principal).toHaveAttribute("tabindex", "-1");
    expect(within(principal).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Título de teste",
    );
  });

  it("«Saltar para o conteúdo» aponta para #conteudo", () => {
    moldura("/gestao");
    expect(screen.getByRole("link", { name: TEXTOS_DA_GESTAO.saltar })).toHaveAttribute(
      "href",
      "#conteudo",
    );
  });

  it("a ordem de tabulação: salto, os cinco destinos, o conteúdo", () => {
    const { container } = moldura("/gestao");

    const focaveis = [...container.querySelectorAll<HTMLElement>("a[href], button")].map(
      (elemento) => elemento.textContent,
    );

    expect(focaveis).toEqual([
      TEXTOS_DA_GESTAO.saltar,
      ...DESTINOS_ESPERADOS.map((destino) => destino.rotulo),
      "Botão do conteúdo",
    ]);
  });

  it("a <nav> vem antes do <main> no HTML", () => {
    moldura("/gestao");

    const posicao = screen
      .getByRole("navigation", { name: TEXTOS_DA_GESTAO.navegacao })
      .compareDocumentPosition(screen.getByRole("main"));
    expect(posicao & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("tocar numa ligação", () => {
  it("noutro destino: empurra o endereço e não deixa o browser recarregar", () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    moldura("/gestao");

    const seguiuOPadrao = fireEvent.click(screen.getByRole("link", { name: "Eventos" }));

    expect(seguiuOPadrao, "o clique tem de levar preventDefault").toBe(false);
    expect(empurrar).toHaveBeenCalledTimes(1);
    expect(empurrar.mock.calls[0]?.[2]).toBe("/gestao/eventos");
    expect(window.location.pathname).toBe("/gestao/eventos");
  });

  it("na ativa: não faz nada — nem entrada nova no histórico, nem recarregar", () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    const substituir = vi.spyOn(window.history, "replaceState");
    moldura("/gestao/ementa");
    substituir.mockClear();

    const seguiuOPadrao = fireEvent.click(screen.getByRole("link", { name: "Ementa" }));

    expect(seguiuOPadrao).toBe(false);
    expect(empurrar).not.toHaveBeenCalled();
    expect(substituir).not.toHaveBeenCalled();
  });
});

/**
 * F4-05a, plano 2.2 — a subrota `/gestao/mais/definicoes`: «Mais» continua ativo,
 * tocar nele leva a `/gestao/mais` (antes não fazia nada e o dono ficava preso),
 * e os toques da barra passam pela guarda de saída (D3).
 */
describe("a subrota /gestao/mais/definicoes", () => {
  it("«Mais» é o ativo (o `aria-current` exato é da ui-ux: «page» ou «true») e os outros não", () => {
    moldura("/gestao/mais/definicoes");
    expect(screen.getByRole("link", { name: "Mais" }).getAttribute("aria-current")).toMatch(
      /^(page|true)$/,
    );
    for (const rotulo of ["Início", "Ementa", "Eventos", "Galeria"]) {
      expect(screen.getByRole("link", { name: rotulo })).not.toHaveAttribute("aria-current");
    }
  });

  it("tocar em «Mais» na subrota navega para /gestao/mais (uma entrada nova, sem recarregar)", () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    moldura("/gestao/mais/definicoes");

    const seguiuOPadrao = fireEvent.click(screen.getByRole("link", { name: "Mais" }));

    expect(seguiuOPadrao).toBe(false);
    expect(empurrar).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/gestao/mais");
  });

  it("tocar em «Mais» em /gestao/mais continua a não fazer nada", () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    moldura("/gestao/mais");
    fireEvent.click(screen.getByRole("link", { name: "Mais" }));
    expect(empurrar).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/gestao/mais");
  });
});

describe("a guarda de saída na barra (D3)", () => {
  it("com guarda a tratar: tocar noutro destino não navega e chama a guarda", () => {
    const guarda = vi.fn<(seguir: () => void) => boolean>(() => true);
    moldura("/gestao/mais/definicoes");
    definirGuardaDeSaida(guarda);

    const seguiuOPadrao = fireEvent.click(screen.getByRole("link", { name: "Ementa" }));

    expect(seguiuOPadrao, "o clique não deixa o browser recarregar").toBe(false);
    expect(guarda).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
  });

  it("`seguir` faz a navegação que foi tocada", () => {
    let seguir: () => void = () => undefined;
    moldura("/gestao/mais/definicoes");
    definirGuardaDeSaida((s) => {
      seguir = s;
      return true;
    });
    fireEvent.click(screen.getByRole("link", { name: "Ementa" }));
    definirGuardaDeSaida(null);
    seguir();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("também tocar em «Mais» na subrota pergunta antes", () => {
    const guarda = vi.fn<(seguir: () => void) => boolean>(() => true);
    moldura("/gestao/mais/definicoes");
    definirGuardaDeSaida(guarda);
    fireEvent.click(screen.getByRole("link", { name: "Mais" }));
    expect(guarda).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
  });

  it("com a guarda a devolver false, navega", () => {
    moldura("/gestao/mais/definicoes");
    definirGuardaDeSaida(() => false);
    fireEvent.click(screen.getByRole("link", { name: "Ementa" }));
    expect(window.location.pathname).toBe("/gestao/ementa");
  });
});
