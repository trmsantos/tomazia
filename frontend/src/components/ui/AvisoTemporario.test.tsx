/**
 * F3-01 — Aviso temporário (secção 7.5 de `docs/ecras/F3-01.md`).
 *
 * Contrato:
 *
 * ```tsx
 * export function AvisoTemporario(propriedades: {
 *   tipo: "sucesso" | "erro";
 *   mensagem?: string;          // sem mensagem, a região fica no DOM, vazia
 *   aoDesfazer?: () => void;    // só quando a ação é reversível
 *   aoFechar: () => void;
 *   duracaoMs?: number;         // por omissão 5000
 * }): JSX.Element
 * ```
 *
 * **O ponto de extensão que o implementador tem de respeitar:** a contagem
 * usa `setTimeout`/`clearTimeout`. Nada de `Date.now()` em laço nem
 * `requestAnimationFrame` — os testes param o relógio com
 * `vi.useFakeTimers()` e uma contagem feita de outra maneira passa a ser
 * impossível de testar sem esperar cinco segundos a sério.
 *
 * A parte delicada é o WCAG 2.2.1: **o contador pára com o rato por cima
 * ou com o foco dentro**. Sem isso, quem navega por teclado chega ao
 * "Desfazer" depois de ele já ter desaparecido — e "Desfazer" é o que a
 * especificação pôs no lugar das confirmações.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvisoTemporario } from "./AvisoTemporario";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function avancar(milissegundos: number): void {
  act(() => {
    vi.advanceTimersByTime(milissegundos);
  });
}

describe("Aviso temporário", () => {
  it('sucesso anuncia-se com role="status" e erro com role="alert"', () => {
    const { rerender } = render(
      <AvisoTemporario tipo="sucesso" mensagem="Preço atualizado." aoFechar={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Preço atualizado.");

    rerender(
      <AvisoTemporario
        tipo="erro"
        mensagem="Não consegui guardar. Tenta outra vez."
        aoFechar={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Não consegui guardar. Tenta outra vez.");
  });

  it("a região vive no DOM desde o início, vazia, e é o texto que muda", () => {
    // Uma região inserida já com texto muitas vezes não é anunciada: o
    // leitor de ecrã só repara no que muda dentro de uma região que já
    // estava lá.
    const { rerender } = render(<AvisoTemporario tipo="sucesso" aoFechar={vi.fn()} />);

    const regiao = screen.getByRole("status");
    expect(regiao.textContent?.trim()).toBe("");

    rerender(<AvisoTemporario tipo="sucesso" mensagem="Foto aprovada." aoFechar={vi.fn()} />);

    expect(screen.getByRole("status"), "tem de ser o mesmo nó, não um nó novo").toBe(regiao);
    expect(regiao).toHaveTextContent("Foto aprovada.");
  });

  it("some sozinho ao fim de cinco segundos", () => {
    const aoFechar = vi.fn();
    render(<AvisoTemporario tipo="sucesso" mensagem="Produto escondido." aoFechar={aoFechar} />);

    avancar(4999);
    expect(aoFechar).not.toHaveBeenCalled();

    avancar(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o contador pára com o rato por cima, e recomeça ao sair (WCAG 2.2.1)", () => {
    const aoFechar = vi.fn();
    render(<AvisoTemporario tipo="sucesso" mensagem="Evento publicado." aoFechar={aoFechar} />);

    const aviso = screen.getByRole("status");

    avancar(1000);
    fireEvent.mouseEnter(aviso);
    avancar(60_000);
    expect(aoFechar, "com o rato por cima o aviso não pode fugir").not.toHaveBeenCalled();

    fireEvent.mouseLeave(aviso);
    avancar(5000);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o contador pára com o foco dentro — é o que deixa chegar ao «Desfazer» por teclado", () => {
    const aoFechar = vi.fn();
    const aoDesfazer = vi.fn();
    render(
      <AvisoTemporario
        tipo="sucesso"
        mensagem="Preço atualizado."
        aoDesfazer={aoDesfazer}
        aoFechar={aoFechar}
      />,
    );

    const desfazer = screen.getByRole("button", { name: "Desfazer" });

    fireEvent.focusIn(desfazer);
    avancar(60_000);
    expect(aoFechar, "com o foco dentro, o tempo pára").not.toHaveBeenCalled();

    fireEvent.click(desfazer);
    expect(aoDesfazer).toHaveBeenCalledTimes(1);
  });

  it("o «Desfazer» é um botão secundário, não mais um sítio com dourado", () => {
    render(
      <AvisoTemporario
        tipo="sucesso"
        mensagem="Produto escondido."
        aoDesfazer={vi.fn()}
        aoFechar={vi.fn()}
      />,
    );

    const desfazer = screen.getByRole("button", { name: "Desfazer" });
    expect(desfazer.className).toContain("border-contorno");
    expect(desfazer.className, "o dourado tem três usos e este não é um deles").not.toContain(
      "bg-acao",
    );
  });

  it("sem aoDesfazer não aparece «Desfazer»", () => {
    render(<AvisoTemporario tipo="sucesso" mensagem="Foto aprovada." aoFechar={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();
  });

  it("o fecho tem nome próprio e fecha já", () => {
    const aoFechar = vi.fn();
    render(<AvisoTemporario tipo="sucesso" mensagem="Foto aprovada." aoFechar={aoFechar} />);

    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("a barra de contagem é CSS, não um style com percentagem", () => {
    const { container } = render(
      <AvisoTemporario tipo="sucesso" mensagem="Preço atualizado." aoFechar={vi.fn()} />,
    );

    // Um `style="width: 37%"` a cada quadro é bloqueado pela CSP
    // `style-src 'self'` — em produção, e só lá.
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
