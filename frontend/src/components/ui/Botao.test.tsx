/**
 * F3-01 — Botão (secção 7.1 de `docs/ecras/F3-01.md`).
 *
 * Contrato que estes testes fixam (é o que o implementador tem de
 * escrever em `Botao.tsx`):
 *
 * ```tsx
 * export type VarianteDeBotao = "principal" | "secundario" | "discreto" | "perigo";
 *
 * export function Botao(propriedades: {
 *   children: ReactNode;
 *   variante?: VarianteDeBotao;   // por omissão: "secundario"
 *   tipo?: "button" | "submit";   // por omissão: "button"
 *   desativado?: boolean;         // vira aria-disabled, nunca disabled
 *   aTrabalhar?: boolean;         // vira aria-busy
 *   textoATrabalhar?: string;     // "A guardar…", "A enviar…"
 *   rotulo?: string;              // aria-label, para o botão só com ícone
 *   onClick?: () => void;
 *   larguraTotal?: boolean;
 * }): JSX.Element
 * ```
 *
 * Dois comportamentos da especificação que é fácil deixar passar e que têm
 * aqui um teste com nome próprio:
 *
 *  - **desativado usa `aria-disabled`, não `disabled`.** Com o atributo
 *    `disabled` o botão sai da ordem de tabulação e o foco salta para fora
 *    sem explicação nenhuma; com `aria-disabled` continua focável e o
 *    leitor de ecrã anuncia porque é que ele ali está. Em troca, somos nós
 *    que temos de travar o `onClick` — e é isso que o teste verifica.
 *  - **o tipo por omissão é `button`.** Um botão sem `type` dentro de um
 *    `<form>` é um `submit` para o HTML; na gestão isso dá uma submissão
 *    acidental a cada "Cancelar".
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Botao } from "./Botao";

describe("Botão", () => {
  it('é um <button type="button"> e o nome acessível é o texto visível', () => {
    render(<Botao>Guardar alterações</Botao>);

    const botao = screen.getByRole("button", { name: "Guardar alterações" });
    expect(botao.tagName).toBe("BUTTON");
    expect(botao).toHaveAttribute("type", "button");
  });

  it('aceita tipo="submit" quando é mesmo para submeter', () => {
    render(<Botao tipo="submit">Entrar</Botao>);

    expect(screen.getByRole("button", { name: "Entrar" })).toHaveAttribute("type", "submit");
  });

  it("desativado dentro de um <form> não submete, apesar do type=submit", () => {
    // O `aria-disabled` não tira o botão do formulário: ao contrário do
    // atributo `disabled`, ele não impede a submissão. Travar só o `onClick`
    // deixava passar exactamente o caso que interessa — e o teste do atributo
    // `type` acima nunca põe um `<form>` à volta, que é onde o comportamento
    // vive.
    const aoSubmeter = vi.fn((evento: { preventDefault: () => void }) => {
      evento.preventDefault();
    });
    render(
      <form onSubmit={aoSubmeter}>
        <Botao tipo="submit" desativado>
          Entrar
        </Botao>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(aoSubmeter).not.toHaveBeenCalled();
  });

  it("a trabalhar dentro de um <form> não volta a submeter", () => {
    // O duplo-submit clássico: o pedido já vai a caminho e cada clique manda
    // outro.
    const aoSubmeter = vi.fn((evento: { preventDefault: () => void }) => {
      evento.preventDefault();
    });
    render(
      <form onSubmit={aoSubmeter}>
        <Botao tipo="submit" aTrabalhar textoATrabalhar="A entrar…">
          Entrar
        </Botao>
      </form>,
    );

    const botao = screen.getByRole("button", { name: "A entrar…" });
    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(aoSubmeter).not.toHaveBeenCalled();
  });

  it("não travado, o submit continua a chegar ao formulário", () => {
    // A guarda da regra 10 destes dois testes: sem isto, um botão que nunca
    // submetesse nada passaria os dois de cima sem ninguém dar por ela.
    const aoSubmeter = vi.fn((evento: { preventDefault: () => void }) => {
      evento.preventDefault();
    });
    render(
      <form onSubmit={aoSubmeter}>
        <Botao tipo="submit">Entrar</Botao>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(aoSubmeter).toHaveBeenCalledTimes(1);
  });

  it("chama o onClick quando é premido", () => {
    const aoCarregar = vi.fn();
    render(<Botao onClick={aoCarregar}>Copiar password</Botao>);

    fireEvent.click(screen.getByRole("button", { name: "Copiar password" }));

    expect(aoCarregar).toHaveBeenCalledTimes(1);
  });

  it("desativado usa aria-disabled, continua focável e não dispara o onClick", () => {
    const aoCarregar = vi.fn();
    render(
      <Botao desativado onClick={aoCarregar}>
        Guardar alterações
      </Botao>,
    );

    const botao = screen.getByRole("button", { name: "Guardar alterações" });

    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(botao, "com `disabled` o foco salta para fora sem explicação").not.toHaveAttribute(
      "disabled",
    );
    expect(botao).not.toHaveAttribute("tabindex", "-1");

    botao.focus();
    expect(document.activeElement).toBe(botao);

    fireEvent.click(botao);
    expect(
      aoCarregar,
      "aria-disabled não trava o clique sozinho: o código tem de o travar",
    ).not.toHaveBeenCalled();
  });

  it("a trabalhar: aria-busy e o texto em gerúndio português", () => {
    render(
      <Botao aTrabalhar textoATrabalhar="A guardar…">
        Guardar alterações
      </Botao>,
    );

    const botao = screen.getByRole("button", { name: "A guardar…" });
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(botao.textContent).toBe("A guardar…");
    expect(botao.textContent, "nada de «Guardando»: o gerúndio é «A guardar…»").not.toMatch(
      /ndo\b/,
    );
  });

  it("um botão só com ícone leva rótulo, e o ícone fica escondido do leitor de ecrã", () => {
    render(
      <Botao rotulo="Fechar">
        <span aria-hidden="true">×</span>
      </Botao>,
    );

    const botao = screen.getByRole("button", { name: "Fechar" });
    expect(botao).toHaveAttribute("aria-label", "Fechar");
  });

  it("as quatro variantes pegam pelos papéis da tabela da especificação", () => {
    // Secção 7.1: principal = bg-acao/text-sobre-acao; secundário = só
    // contorno; discreto = só texto suave; perigo = bg-perigo. Nenhuma
    // escreve uma cor da paleta — é a classe `.superficie-creme` que troca
    // o que estas palavras significam, e é isso que impede o dourado de
    // aparecer em cima do creme por distração.
    const { rerender } = render(<Botao variante="principal">Adicionar produto</Botao>);
    const principal = screen.getByRole("button").className;
    expect(principal).toContain("bg-acao");
    expect(principal).toContain("text-sobre-acao");

    rerender(<Botao variante="secundario">Desfazer</Botao>);
    expect(screen.getByRole("button").className).toContain("border-contorno");

    rerender(<Botao variante="discreto">Cancelar</Botao>);
    expect(screen.getByRole("button").className).toContain("text-texto-suave");

    rerender(<Botao variante="perigo">Eliminar produto</Botao>);
    const perigo = screen.getByRole("button").className;
    expect(perigo).toContain("bg-perigo");
    expect(perigo).toContain("text-sobre-perigo");
  });

  it("tem alvo de toque de 44 px por construção e nunca um style inline", () => {
    render(<Botao variante="principal">Enviar foto</Botao>);

    const botao = screen.getByRole("button", { name: "Enviar foto" });
    expect(botao.className).toContain("min-h-toque");
    expect(
      botao,
      "a CSP `style-src 'self'` bloqueia style inline em produção e funciona em desenvolvimento",
    ).not.toHaveAttribute("style");
  });

  it("não apaga o anel de foco da camada base", () => {
    render(<Botao variante="principal">Publicar evento</Botao>);

    expect(screen.getByRole("button").className).not.toMatch(/outline-none|focus:outline-none/);
  });
});
