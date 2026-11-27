/**
 * R-01 — Cartão (secção 6.9 de `docs/ecras/R-01.md`).
 *
 * Duas pastas de classes e um elemento à escolha. O círculo do destaque é um
 * `::after` em `global.css` e não se vê no jsdom: o que se prende aqui é a
 * classe que o liga (`cartao-destaque`) e a ausência de `style`, que a CSP
 * bloqueia em produção. O CSS está em `src/styles/forma.test.ts`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Cartao } from "./Cartao";

function classesDe(elemento: HTMLElement): string[] {
  return elemento.className.split(/\s+/).filter((classe) => classe.length > 0);
}

describe("Cartao", () => {
  it("por omissão é de papel, com o raio do cartão e a aresta de baixo", () => {
    render(<Cartao>x</Cartao>);

    const classes = classesDe(screen.getByText("x"));
    for (const esperada of [
      "superficie-papel",
      "rounded-cartao",
      "border-b",
      "border-contorno-superficie",
      "p-4",
    ]) {
      expect(classes).toContain(esperada);
    }
    expect(classes).not.toContain("cartao-destaque");
  });

  it("o destaque leva o círculo, o raio grande e px-4 py-6 (não p-6)", () => {
    render(<Cartao tom="destaque">x</Cartao>);

    const classes = classesDe(screen.getByText("x"));
    for (const esperada of [
      "superficie-destaque",
      "cartao-destaque",
      "relative",
      "overflow-hidden",
      "rounded-grande",
      "px-4",
      "py-6",
    ]) {
      expect(classes).toContain(esperada);
    }
    // Com `p-6` o nome do bar parte em duas linhas a 360 px.
    expect(classes).not.toContain("p-6");
    expect(classes).not.toContain("superficie-papel");
  });

  it.each(["div", "section", "article", "li"] as const)("como=%s dá um <%s>", (como) => {
    render(<Cartao como={como}>x</Cartao>);

    expect(screen.getByText("x").tagName).toBe(como.toUpperCase());
  });

  it("por omissão é uma <div>", () => {
    render(<Cartao>x</Cartao>);

    expect(screen.getByText("x").tagName).toBe("DIV");
  });

  it("nenhum dos tons tem atributo style", () => {
    const { container } = render(
      <>
        <Cartao>a</Cartao>
        <Cartao tom="destaque">b</Cartao>
      </>,
    );

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
