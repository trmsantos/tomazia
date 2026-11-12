/**
 * F3-01 — Campo (secção 7.2 de `docs/ecras/F3-01.md`).
 *
 * Contrato:
 *
 * ```tsx
 * export function Campo(propriedades: {
 *   etiqueta: string;          // sempre visível; nunca um placeholder a fazer de etiqueta
 *   id?: string;               // se faltar, o componente gera um (useId)
 *   ajuda?: string;
 *   erro?: string;
 *   exemplo?: string;          // vira placeholder: é um exemplo, não uma etiqueta
 *   obrigatorio?: boolean;
 *   desativado?: boolean;      // aqui é mesmo `disabled` (ao contrário do Botão)
 *   soLeitura?: boolean;
 *   multilinha?: boolean;      // <textarea>
 *   valor?: string;
 *   aoMudar?: (valor: string) => void;
 * }): JSX.Element
 * ```
 *
 * A ordem do `aria-describedby` é ajuda e depois erro, porque é a ordem
 * por que o leitor de ecrã as lê e é a ordem em que fazem sentido: o que
 * se espera primeiro, o que correu mal depois.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Campo } from "./Campo";

describe("Campo", () => {
  it("a etiqueta está visível e ligada ao campo", () => {
    render(<Campo etiqueta="Nome do produto" />);

    const campo = screen.getByLabelText("Nome do produto");
    expect(campo.tagName).toBe("INPUT");
    expect(screen.getByText("Nome do produto")).toBeVisible();
  });

  it("o placeholder é um exemplo, nunca a etiqueta", () => {
    render(<Campo etiqueta="Preço" exemplo="6,50" />);

    const campo = screen.getByLabelText("Preço");
    expect(campo).toHaveAttribute("placeholder", "6,50");
    expect(screen.getByText("Preço"), "a etiqueta continua visível por cima").toBeVisible();
  });

  it("junta ajuda e erro no aria-describedby, por essa ordem", () => {
    render(
      <Campo
        etiqueta="Preço"
        ajuda="Em euros, com vírgula."
        erro="O preço tem de ser um número, por exemplo 6,50."
      />,
    );

    const campo = screen.getByLabelText("Preço");
    const descritores = (campo.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);

    expect(descritores).toHaveLength(2);
    const textos = descritores.map((id) => document.getElementById(id)?.textContent ?? "");
    expect(textos[0]).toContain("Em euros, com vírgula.");
    expect(textos[1]).toContain("O preço tem de ser um número, por exemplo 6,50.");
  });

  it("com erro: aria-invalid, mensagem em texto e contorno de erro", () => {
    render(<Campo etiqueta="Nome do produto" erro="Escreve o nome do produto." />);

    const campo = screen.getByLabelText("Nome do produto");
    expect(campo).toHaveAttribute("aria-invalid", "true");

    // 1.4.1: a informação não pode vir só pela cor — a mensagem é texto.
    const mensagem = screen.getByText("Escreve o nome do produto.");
    expect(mensagem).toBeVisible();
    expect(campo.className).toContain("border-erro");
  });

  it("sem erro não há aria-invalid pendurado", () => {
    render(<Campo etiqueta="Nome do produto" />);

    expect(screen.getByLabelText("Nome do produto")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("não usa aria-live: o erro já é lido ao focar o campo", () => {
    const { container } = render(
      <Campo etiqueta="Nome do produto" erro="Escreve o nome do produto." />,
    );

    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("obrigatório marca-se no texto da etiqueta e com required", () => {
    render(<Campo etiqueta="Nome (obrigatório)" obrigatorio />);

    const campo = screen.getByLabelText("Nome (obrigatório)");
    expect(campo).toBeRequired();
  });

  it("desativado usa mesmo disabled, e só de leitura usa readonly", () => {
    const { rerender } = render(<Campo etiqueta="Preço" desativado />);
    expect(screen.getByLabelText("Preço")).toBeDisabled();

    rerender(<Campo etiqueta="Preço" soLeitura valor="6,50" />);
    const campo = screen.getByLabelText("Preço");
    expect(campo).toHaveAttribute("readonly");
    expect(campo).not.toBeDisabled();
  });

  it("multilinha dá uma área de texto, com a mesma etiqueta", () => {
    render(<Campo etiqueta="Descrição" multilinha />);

    expect(screen.getByLabelText("Descrição").tagName).toBe("TEXTAREA");
  });

  it("avisa quem o usa quando o valor muda", () => {
    const aoMudar = vi.fn();
    render(<Campo etiqueta="Nome do produto" valor="" aoMudar={aoMudar} />);

    fireEvent.change(screen.getByLabelText("Nome do produto"), {
      target: { value: "Bitoque" },
    });

    expect(aoMudar).toHaveBeenCalledWith("Bitoque");
  });

  it("tem 44 px de altura, contorno de 1 px e nenhum style inline", () => {
    render(<Campo etiqueta="Nome do produto" />);

    const campo = screen.getByLabelText("Nome do produto");
    expect(campo.className).toContain("min-h-toque");
    expect(campo.className).toContain("rounded-pequeno");
    expect(campo).not.toHaveAttribute("style");
  });

  describe("as propriedades que o login acrescentou (F4-01, 3.2 e 3.5)", () => {
    /*
     * Nomes novos, todos opcionais, e nenhum muda o que o Campo faz hoje:
     *
     *   tipo?: "text" | "password"        -> `type` do <input> (por omissão "text")
     *   nome?: string                     -> `name`
     *   autocompletar?: string            -> `autocomplete`
     *   autocapitalize?: "none" | "sentences" | "words" | "characters"
     *   autocorrect?: "on" | "off"
     *   spellcheck?: boolean              -> spellcheck="true" | "false"
     *   descritoPor?: string              -> um id *de fora* acrescentado ao
     *                                        `aria-describedby`, depois da ajuda
     *                                        e do erro (o `#login-mensagem`)
     */
    it("por omissão continua a ser type=text, sem name nem atributos de teclado", () => {
      render(<Campo etiqueta="Nome" />);
      const campo = screen.getByLabelText("Nome");

      expect(campo).toHaveAttribute("type", "text");
      for (const atributo of [
        "name",
        "autocomplete",
        "autocapitalize",
        "autocorrect",
        "spellcheck",
      ]) {
        expect(campo, `«${atributo}» não devia existir por omissão`).not.toHaveAttribute(atributo);
      }
    });

    it("tipo=password dá um campo de password", () => {
      render(<Campo etiqueta="Password" tipo="password" />);
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    });

    it("nome, autocompletar, autocapitalize, autocorrect e spellcheck chegam ao <input>", () => {
      render(
        <Campo
          etiqueta="Utilizador"
          nome="utilizador"
          autocompletar="username"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
        />,
      );
      const campo = screen.getByLabelText("Utilizador");

      expect(campo).toHaveAttribute("name", "utilizador");
      expect(campo).toHaveAttribute("autocomplete", "username");
      expect(campo).toHaveAttribute("autocapitalize", "none");
      expect(campo).toHaveAttribute("autocorrect", "off");
      expect(campo).toHaveAttribute("spellcheck", "false");
    });

    it("descritoPor sozinho é o aria-describedby inteiro", () => {
      render(<Campo etiqueta="Password" descritoPor="login-mensagem" />);
      expect(screen.getByLabelText("Password")).toHaveAttribute(
        "aria-describedby",
        "login-mensagem",
      );
    });

    it("descritoPor junta-se à ajuda e ao erro, no fim", () => {
      render(
        <Campo
          etiqueta="Preço"
          id="preco"
          ajuda="Em euros."
          erro="Escreve o preço."
          descritoPor="login-mensagem"
        />,
      );
      const ids = (screen.getByLabelText("Preço").getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean);

      expect(ids).toEqual(["preco-ajuda", "preco-erro", "login-mensagem"]);
    });

    it("descritoPor não marca o campo como inválido", () => {
      render(<Campo etiqueta="Password" descritoPor="login-mensagem" />);
      expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    });
  });
});
