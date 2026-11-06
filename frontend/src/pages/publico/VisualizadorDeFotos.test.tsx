/**
 * F3-05, secção 16.3 — o Visualizador em ecrã inteiro (docs/ecras/F3-05.md,
 * secção 5), com Vitest + Testing Library.
 *
 * Contrato que este ficheiro define e que `VisualizadorDeFotos.tsx` tem de
 * cumprir — **controlado pelo pai** (a `Galeria`), como a `FolhaWifi` é
 * controlada pelo `App`:
 *
 * ```tsx
 * export type PropriedadesDoVisualizador = {
 *   fotos: FotoPublica[];
 *   indiceAberto: number | null; // null = fechado
 *   aoFechar: () => void;
 *   aoNavegar: (novoIndice: number) => void;
 * };
 * export function VisualizadorDeFotos(propriedades): ReactElement
 * ```
 *
 * Um `<dialog>` nativo com `showModal()` (ADR 0008), **não** a `Folha`
 * partilhada: ao contrário dela, este diálogo nunca muda de forma a
 * 1024 px e ocupa o ecrã inteiro em qualquer largura (secção 5.1) — são
 * desenhos diferentes, e forçar o mesmo componente aqui obrigava a Folha a
 * ganhar uma variante só para isto.
 *
 * **O que este ficheiro pode provar, e o que não pode** (a mesma fronteira
 * de `Folha.test.tsx`): o jsdom não tem `showModal`/`close` a sério (ver
 * `src/testes/dialogo-jsdom.ts`), não prende o foco e não o devolve ao
 * fechar. Por isso aqui prende-se a **ligação** — que é mesmo um
 * `<dialog>`, que abre com `showModal()`, que o `cancel` chega a
 * `aoFechar`, que os botões e o teclado chamam `aoNavegar` com o índice
 * certo e não o chamam nos extremos — e o comportamento a sério do
 * browser (o foco a voltar ao botão da grelha, o gesto de deslizar) fica
 * para `e2e/galeria.spec.ts` (16.5, ponto 4).
 *
 * **Prova:** abre na foto tocada; "Foto anterior" fica `aria-disabled` na
 * primeira e "Foto seguinte" na última, e nenhum dos dois **desaparece**
 * nos extremos (a mesma regra do Botão desativado, F3-01, 7.1); `Esc`
 * (evento `cancel`) chama `aoFechar`; a linha de posição muda a cada
 * navegação; o `alt` é a `descricao` quando existe e a frase genérica
 * quando não; a legenda aparece tal como veio, sem aspas nem itálico.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FOTO_COM_LEGENDA,
  FOTO_SEM_LEGENDA,
  TEXTOS_DA_GALERIA,
  foto,
  posicao,
} from "../../testes/galeria";
import { VisualizadorDeFotos } from "./VisualizadorDeFotos";

const TRES_FOTOS = [
  foto({ id: 1, descricao: "Primeira foto da noite." }),
  FOTO_SEM_LEGENDA,
  foto({ id: 3, descricao: "Última foto da noite." }),
];

function dialogoNoDocumento(): HTMLDialogElement {
  const dialogo = document.querySelector("dialog");
  if (dialogo === null) {
    throw new Error(
      "Não encontrei nenhum <dialog>. O Visualizador é um <dialog> nativo (ADR 0008), " +
        'não uma <div> com role="dialog".',
    );
  }
  return dialogo;
}

describe("fechado e aberto", () => {
  it("indiceAberto null: o <dialog> existe mas não está aberto", () => {
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={null}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    expect(dialogoNoDocumento().hasAttribute("open")).toBe(false);
  });

  it("abre, como modal, na foto cujo índice foi passado", () => {
    const abrirModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");

    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={1}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    expect(dialogoNoDocumento().hasAttribute("open")).toBe(true);
    expect(abrirModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      `/media/${TRES_FOTOS[1]?.ficheiro ?? ""}`,
    );
  });

  it("muda de foto quando indiceAberto muda, sem fechar e reabrir", () => {
    const { rerender } = render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      `/media/${TRES_FOTOS[0]?.ficheiro ?? ""}`,
    );

    rerender(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={2}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      `/media/${TRES_FOTOS[2]?.ficheiro ?? ""}`,
    );
  });
});

describe("o alt (5.4)", () => {
  it("com descrição: alt é a descrição", () => {
    render(
      <VisualizadorDeFotos
        fotos={[FOTO_COM_LEGENDA]}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute("alt", FOTO_COM_LEGENDA.descricao as string);
  });

  it("sem descrição: a frase genérica, nunca alt vazio", () => {
    render(
      <VisualizadorDeFotos
        fotos={[FOTO_SEM_LEGENDA]}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    const imagem = screen.getByRole("img");
    expect(imagem).toHaveAttribute("alt", TEXTOS_DA_GALERIA.altSemLegenda);
    expect(imagem.getAttribute("alt")).not.toBe("");
  });
});

describe("a legenda por baixo da foto (5.3)", () => {
  it("aparece tal como veio, sem aspas nem 'Legenda:' à frente", () => {
    render(
      <VisualizadorDeFotos
        fotos={[FOTO_COM_LEGENDA]}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    const legenda = screen.getByText(FOTO_COM_LEGENDA.descricao as string);
    expect(legenda.textContent).toBe(FOTO_COM_LEGENDA.descricao);
    expect(legenda.textContent).not.toMatch(/^["“]/);
    expect(legenda.textContent).not.toMatch(/legenda:/i);
  });

  it("sem descrição, não há parágrafo de legenda nenhum — só a linha de posição", () => {
    // A linha de posição (role="status") também é um <p>; a asserção certa
    // não é "zero <p>", é "o único <p> que existe é o da posição".
    render(
      <VisualizadorDeFotos
        fotos={[FOTO_SEM_LEGENDA]}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    const paragrafos = document.querySelectorAll("p");
    expect(paragrafos).toHaveLength(1);
    expect(paragrafos[0]).toBe(screen.getByRole("status"));
  });
});

describe("a linha de posição (5.3)", () => {
  it("'Foto {n} de {m}.' muda a cada navegação", () => {
    const { rerender } = render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(posicao(1, 3));

    rerender(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={1}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(posicao(2, 3));
  });
});

describe("navegação: nos extremos, aria-disabled — nunca escondido, nunca cíclico", () => {
  it("na primeira foto, 'Foto anterior' é aria-disabled e continua visível", () => {
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    const anterior = screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fotoAnterior });
    expect(anterior).toHaveAttribute("aria-disabled", "true");
    expect(anterior).toBeVisible();

    const seguinte = screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fotoSeguinte });
    expect(seguinte).not.toHaveAttribute("aria-disabled", "true");
  });

  it("na última foto, 'Foto seguinte' é aria-disabled e continua visível", () => {
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={2}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    const seguinte = screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fotoSeguinte });
    expect(seguinte).toHaveAttribute("aria-disabled", "true");
    expect(seguinte).toBeVisible();
  });

  it("carregar em 'Foto seguinte' chama aoNavegar(indice+1)", () => {
    const aoNavegar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={aoNavegar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fotoSeguinte }));

    expect(aoNavegar).toHaveBeenCalledTimes(1);
    expect(aoNavegar).toHaveBeenCalledWith(1);
  });

  it("na última foto, carregar em 'Foto seguinte' NÃO chama aoNavegar: não há ciclo", () => {
    const aoNavegar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={2}
        aoFechar={vi.fn()}
        aoNavegar={aoNavegar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fotoSeguinte }));

    expect(
      aoNavegar,
      "um ciclo silencioso faz quem desliza repetidamente pensar que há mais fotos do que há",
    ).not.toHaveBeenCalled();
  });

  it("na primeira foto, carregar em 'Foto anterior' NÃO chama aoNavegar", () => {
    const aoNavegar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={aoNavegar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fotoAnterior }));

    expect(aoNavegar).not.toHaveBeenCalled();
  });

  it("ArrowRight na última foto não chama aoNavegar — prende a lógica, não só o Botão desativado", () => {
    // Diferente do teste de clique acima: um clique na última foto nunca
    // chega a `avancar()`, porque o `Botao` com `desativado` trava o
    // `onClick` sozinho (é o que `Botao.test.tsx` já prova). O `ArrowRight`
    // não passa pelo `Botao` nenhum — vai direito ao `onKeyDown` do
    // `<dialog>` — e é por isso que só este teste prende mesmo um ciclo
    // escrito dentro de `avancar()`.
    const aoNavegar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={2}
        aoFechar={vi.fn()}
        aoNavegar={aoNavegar}
      />,
    );

    fireEvent.keyDown(dialogoNoDocumento(), { key: "ArrowRight" });

    expect(aoNavegar).not.toHaveBeenCalled();
  });

  it("ArrowLeft na primeira foto não chama aoNavegar — a mesma prova, do outro lado", () => {
    const aoNavegar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={aoNavegar}
      />,
    );

    fireEvent.keyDown(dialogoNoDocumento(), { key: "ArrowLeft" });

    expect(aoNavegar).not.toHaveBeenCalled();
  });

  it("ArrowRight e ArrowLeft no teclado chamam aoNavegar como os botões", () => {
    const aoNavegar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={1}
        aoFechar={vi.fn()}
        aoNavegar={aoNavegar}
      />,
    );

    fireEvent.keyDown(dialogoNoDocumento(), { key: "ArrowRight" });
    expect(aoNavegar).toHaveBeenCalledTimes(1);
    expect(aoNavegar).toHaveBeenCalledWith(2);

    aoNavegar.mockClear();
    fireEvent.keyDown(dialogoNoDocumento(), { key: "ArrowLeft" });
    expect(aoNavegar).toHaveBeenCalledTimes(1);
    expect(aoNavegar).toHaveBeenCalledWith(0);
  });
});

describe("fechar: Esc, fundo e o botão «×»", () => {
  it("o cancel do browser (Esc) chama aoFechar", () => {
    const aoFechar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={aoFechar}
        aoNavegar={vi.fn()}
      />,
    );

    fireEvent(dialogoNoDocumento(), new Event("cancel", { cancelable: true }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o botão 'Fechar' chama aoFechar", () => {
    const aoFechar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={aoFechar}
        aoNavegar={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.fecharVisualizador }));

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("tocar no fundo escuro (o próprio <dialog>, fora da foto) chama aoFechar", () => {
    const aoFechar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={aoFechar}
        aoNavegar={vi.fn()}
      />,
    );

    fireEvent.click(dialogoNoDocumento());

    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("tocar na própria foto NÃO fecha — é aí que o deslize vive (5.2)", () => {
    const aoFechar = vi.fn();
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={aoFechar}
        aoNavegar={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("img"));

    expect(aoFechar).not.toHaveBeenCalled();
  });
});

describe("o nome acessível do diálogo", () => {
  it("é um <dialog>, com aria-modal", () => {
    render(
      <VisualizadorDeFotos
        fotos={TRES_FOTOS}
        indiceAberto={0}
        aoFechar={vi.fn()}
        aoNavegar={vi.fn()}
      />,
    );

    const dialogo = screen.getByRole("dialog");
    expect(dialogo.tagName).toBe("DIALOG");
    expect(dialogo).toHaveAttribute("aria-modal", "true");
  });
});
