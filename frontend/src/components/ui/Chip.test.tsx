/**
 * F3-01 — Chip de categoria (secção 7.3 de `docs/ecras/F3-01.md`).
 *
 * Contrato:
 *
 * ```tsx
 * export function Chip(propriedades: {
 *   href: string;        // "#cafes" — navega para uma secção da página
 *   ativo?: boolean;
 *   children: ReactNode;
 * }): JSX.Element
 * ```
 *
 * Na área pública os chips **navegam**: são ligações dentro de um
 * `<nav aria-label="Categorias">`, numa `<ul>`. Não são botões nem rádios.
 * Ao serem ligações, o leitor de ecrã anuncia-os como ligações e o teclado
 * funciona sem uma linha de código nossa — e o `aria-current` diz qual é a
 * atual sem depender da cor.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip } from "./Chip";

describe("Chip de categoria", () => {
  it("é uma ligação com href, não um botão", () => {
    render(<Chip href="#cafes">Cafés</Chip>);

    const chip = screen.getByRole("link", { name: "Cafés" });
    expect(chip.tagName).toBe("A");
    expect(chip).toHaveAttribute("href", "#cafes");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("o ativo diz-se com aria-current, não só com a cor", () => {
    render(
      <ul>
        <li>
          <Chip href="#cafes" ativo>
            Cafés
          </Chip>
        </li>
        <li>
          <Chip href="#cervejas">Cervejas</Chip>
        </li>
        <li>
          <Chip href="#petiscos">Petiscos</Chip>
        </li>
      </ul>,
    );

    const ligacoes = screen.getAllByRole("link");
    const atuais = ligacoes.filter((ligacao) => ligacao.getAttribute("aria-current") === "true");

    expect(atuais).toHaveLength(1);
    expect(atuais[0]).toHaveAccessibleName("Cafés");
  });

  it("o inativo não tem aria-current nenhum (nem a «false»)", () => {
    render(<Chip href="#cervejas">Cervejas</Chip>);

    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
  });

  it("os chips são cápsulas: rounded-cheio, 44 px de alvo", () => {
    // R-01 / ADR 0023: eram 4 px (`rounded-pequeno`); agora o Chip e o
    // Interruptor são as duas cápsulas.
    render(<Chip href="#cafes">Cafés</Chip>);

    const chip = screen.getByRole("link");
    expect(chip.className).toContain("rounded-cheio");
    expect(chip.className).not.toContain("rounded-pequeno");
    expect(chip.className).toContain("min-h-toque");
  });

  it("ativo e inativo têm o mesmo peso e a mesma caixa: a barra não salta", () => {
    // R-01 / ADR 0023: `font-medio` nos dois e `border` nos dois.
    const { rerender } = render(
      <Chip href="#cafes" ativo>
        Cafés
      </Chip>,
    );
    const ativo = screen.getByRole("link").className.split(/\s+/);

    rerender(<Chip href="#cafes">Cafés</Chip>);
    const inativo = screen.getByRole("link").className.split(/\s+/);

    const pesos = (classes: string[]): string[] => classes.filter((c) => c.startsWith("font-"));
    expect(pesos(ativo)).toEqual(["font-medio"]);
    expect(pesos(inativo)).toEqual(pesos(ativo));
    expect(ativo).toContain("border");
    expect(inativo).toContain("border");
    expect(ativo).toContain("border-acao");
  });

  it("ativo e inativo pegam pelos papéis, e nenhum escreve uma cor", () => {
    const { rerender } = render(
      <Chip href="#cafes" ativo>
        Cafés
      </Chip>,
    );
    const ativo = screen.getByRole("link").className;
    expect(ativo).toContain("bg-acao");
    expect(ativo).toContain("text-sobre-acao");

    rerender(<Chip href="#cafes">Cafés</Chip>);
    const inativo = screen.getByRole("link").className;
    expect(inativo).toContain("border-contorno");
    expect(inativo).toContain("bg-controlo"); // R-01 / ADR 0023
    expect(inativo).not.toContain("bg-acao");
  });

  it("não traz style inline", () => {
    render(<Chip href="#cafes">Cafés</Chip>);

    expect(screen.getByRole("link")).not.toHaveAttribute("style");
  });
});
