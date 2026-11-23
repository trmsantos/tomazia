/**
 * F3-01 — Folha (secção 7.4 de `docs/ecras/F3-01.md`), em `<dialog>`
 * nativo com `showModal()`, por ADR 0008.
 *
 * Contrato:
 *
 * ```tsx
 * export function Folha(propriedades: {
 *   aberta: boolean;
 *   titulo: string;
 *   aoFechar: () => void;
 *   children: ReactNode;
 * }): JSX.Element
 * ```
 *
 * **O que este ficheiro pode provar e o que não pode.** Quatro das
 * garantias da Folha — foco preso, foco que entra ao abrir, foco que volta
 * ao gatilho ao fechar, e `Esc` — são do browser, e o jsdom não as tem (nem
 * sequer tem `showModal`; ver `src/testes/dialogo-jsdom.ts`). Simulá-las
 * aqui seria escrever um teste que prova que o simulador funciona. Por
 * isso aqui prende-se a **ligação**: que é um `<dialog>` a sério, que foi
 * `showModal()` e não `show()` (é a diferença entre modal e não modal), e
 * que o `cancel` — o evento que o browser dispara quando se carrega em
 * `Esc` — chega ao `aoFechar`. O comportamento a sério está em
 * `e2e/componentes.spec.ts`, num Chromium.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { estaModal } from "../../testes/dialogo-jsdom";
import { Folha } from "./Folha";

afterEach(() => {
  vi.restoreAllMocks();
});

function dialogoNoDocumento(): HTMLDialogElement {
  const dialogo = document.querySelector("dialog");
  if (dialogo === null) {
    throw new Error(
      "Não encontrei nenhum <dialog> no documento. A Folha é um <dialog> nativo (ADR 0008), " +
        'não uma <div> com role="dialog".',
    );
  }
  return dialogo;
}

describe("Folha", () => {
  it("fechada, o <dialog> existe mas não está aberto", () => {
    render(
      <Folha aberta={false} titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    expect(dialogoNoDocumento().hasAttribute("open")).toBe(false);
  });

  it("aberta, abre como modal e não como diálogo normal", () => {
    // `show()` abre sem camada de topo, sem `::backdrop` e sem foco preso.
    // A diferença não se vê numa captura de ecrã; vê-se aqui.
    const abrirModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const abrir = vi.spyOn(HTMLDialogElement.prototype, "show");

    render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    expect(abrirModal).toHaveBeenCalledTimes(1);
    expect(abrir).not.toHaveBeenCalled();
    expect(estaModal(dialogoNoDocumento())).toBe(true);
  });

  it("anuncia-se como diálogo, com o título a dar-lhe o nome", () => {
    render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    const dialogo = screen.getByRole("dialog");
    expect(dialogo.tagName).toBe("DIALOG");
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(dialogo).toHaveAccessibleName("WiFi");

    const idDoTitulo = dialogo.getAttribute("aria-labelledby");
    expect(idDoTitulo, "o nome vem do título por aria-labelledby").not.toBeNull();
    expect(document.getElementById(idDoTitulo ?? "")?.textContent).toBe("WiFi");
  });

  it("o Esc do browser chega ao aoFechar (evento cancel)", () => {
    const aoFechar = vi.fn();
    render(
      <Folha aberta titulo="WiFi" aoFechar={aoFechar}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    fireEvent(dialogoNoDocumento(), new Event("cancel", { cancelable: true }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o Esc cancela o fecho nativo (preventDefault): fecha-se só por `aberta`", () => {
    render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>x</p>
      </Folha>,
    );
    const cancel = new Event("cancel", { cancelable: true });

    fireEvent(dialogoNoDocumento(), cancel);

    expect(cancel.defaultPrevented).toBe(true);
  });

  it("Esc com um aoFechar que não fecha: a folha continua aberta", () => {
    render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>x</p>
      </Folha>,
    );

    fireEvent(dialogoNoDocumento(), new Event("cancel", { cancelable: true }));

    expect(dialogoNoDocumento().hasAttribute("open")).toBe(true);
    expect(document.body.classList.contains("sem-deslizar")).toBe(true);
  });

  it("fechou nativamente (o Chrome ignorou o preventDefault) com `aberta` ainda true: volta a abrir como modal", () => {
    const abrirModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>x</p>
      </Folha>,
    );
    expect(abrirModal).toHaveBeenCalledTimes(1);

    dialogoNoDocumento().close();

    expect(abrirModal).toHaveBeenCalledTimes(2);
    expect(dialogoNoDocumento().hasAttribute("open")).toBe(true);
    expect(estaModal(dialogoNoDocumento())).toBe(true);
  });

  it("fechou nativamente sem cancel: chama o aoFechar; se a página fecha, acaba fechada sem ciclo", () => {
    function Pagina(): ReactElement {
      const [aberta, setAberta] = useState(true);
      return (
        <Folha
          aberta={aberta}
          titulo="WiFi"
          aoFechar={() => {
            setAberta(false);
          }}
        >
          <p>x</p>
        </Folha>
      );
    }
    render(<Pagina />);

    act(() => {
      dialogoNoDocumento().close();
    });

    expect(dialogoNoDocumento().hasAttribute("open")).toBe(false);
    expect(document.body.classList.contains("sem-deslizar")).toBe(false);
  });

  it("fechou nativamente sem cancel e a página ignora o aoFechar: chamado uma vez e fica aberta", () => {
    const aoFechar = vi.fn();
    render(
      <Folha aberta titulo="WiFi" aoFechar={aoFechar}>
        <p>x</p>
      </Folha>,
    );

    dialogoNoDocumento().close();

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(dialogoNoDocumento().hasAttribute("open")).toBe(true);
  });

  it("Esc com um aoFechar normal: fecha como antes, sem reabrir", () => {
    function Pagina(): ReactElement {
      const [aberta, setAberta] = useState(true);
      return (
        <Folha
          aberta={aberta}
          titulo="WiFi"
          aoFechar={() => {
            setAberta(false);
          }}
        >
          <p>x</p>
        </Folha>
      );
    }
    const abrirModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<Pagina />);

    fireEvent(dialogoNoDocumento(), new Event("cancel", { cancelable: true }));

    expect(dialogoNoDocumento().hasAttribute("open")).toBe(false);
    expect(abrirModal).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("sem-deslizar")).toBe(false);
  });

  it("o botão de fechar tem nome e fecha", () => {
    const aoFechar = vi.fn();
    render(
      <Folha aberta titulo="WiFi" aoFechar={aoFechar}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("ao fechar chama close() no <dialog>, que é quem devolve o foco ao gatilho", () => {
    const fechar = vi.spyOn(HTMLDialogElement.prototype, "close");
    const { rerender } = render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    rerender(
      <Folha aberta={false} titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    expect(fechar).toHaveBeenCalled();
    expect(dialogoNoDocumento().hasAttribute("open")).toBe(false);
  });

  it("a pega decorativa está escondida do leitor de ecrã", () => {
    const { container } = render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    const escondidos = container.querySelectorAll('[aria-hidden="true"]');
    expect(escondidos.length, "a pega é decorativa e não se anuncia").toBeGreaterThan(0);
  });

  it("trava o deslizar do fundo por classe, nunca por style", () => {
    // A CSP `style-src 'self'` bloqueia `document.body.style.overflow` em
    // produção — e só em produção.
    const classesAntes = document.body.className;

    const { rerender } = render(
      <Folha aberta titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    const marcado =
      document.body.className !== classesAntes || document.documentElement.className.length > 0;
    expect(marcado, "o fundo não desliza enquanto a Folha está aberta: põe uma classe").toBe(true);
    expect(document.body).not.toHaveAttribute("style");

    rerender(
      <Folha aberta={false} titulo="WiFi" aoFechar={vi.fn()}>
        <p>Rede: Bar da Tomazia</p>
      </Folha>,
    );

    expect(document.body.className).toBe(classesAntes);
  });

  it("nada dentro da Folha tem style inline", () => {
    const { container } = render(
      <Folha aberta titulo="Eliminar produto" aoFechar={vi.fn()}>
        <p>Tem a certeza?</p>
      </Folha>,
    );

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
