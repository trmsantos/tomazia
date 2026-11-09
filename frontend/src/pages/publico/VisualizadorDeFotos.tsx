import type { KeyboardEvent, MouseEvent, PointerEvent, ReactElement } from "react";
import { useEffect, useId, useRef } from "react";

import { Botao } from "../../components/ui/Botao";
import type { FotoPublica } from "./Galeria";

/**
 * O Visualizador em ecrã inteiro (`docs/ecras/F3-05.md`, secção 5).
 *
 * Um `<dialog>` nativo com `showModal()` (ADR 0008) — mas, ao contrário da
 * `Folha`, este nunca muda de forma a 1024 px: ocupa o ecrã inteiro, a
 * todas as larguras, com fundo opaco. Não há cortina translúcida a deixar
 * entrever a página por trás porque não há nada para entrever — o diálogo
 * cobre tudo.
 *
 * **Controlado pelo pai** (a `Galeria`), como a `FolhaWifi` é controlada
 * pelo `App`: `indiceAberto` é `null` quando fechado, e o índice da foto
 * quando aberto. Não tem pedido de rede próprio — usa os dados já
 * carregados da grelha.
 *
 * `draggable={false}` na `<img>` **não é cosmético**: sem isso, o arrastar
 * nativo do browser sequestra a sequência de `pointerdown`/`pointerup` com
 * um `pointercancel`, e o gesto de deslizar entre fotos (5.3) nunca
 * dispara.
 */

const TEXTOS = {
  fechar: "Fechar",
  fotoAnterior: "Foto anterior",
  fotoSeguinte: "Foto seguinte",
  altSemLegenda: "Fotografia do bar enviada por um cliente.",
} as const;

/** Classe no `<body>` enquanto o Visualizador está aberto. A mesma da `Folha`, definida em `global.css`. */
const TRAVAO_DO_FUNDO = "sem-deslizar";

export type PropriedadesDoVisualizador = {
  fotos: FotoPublica[];
  /** `null` = fechado. */
  indiceAberto: number | null;
  aoFechar: () => void;
  aoNavegar: (novoIndice: number) => void;
};

/** "Foto {n} de {m}." — a linha de posição (5.3). */
function posicao(n: number, m: number): string {
  return `Foto ${String(n)} de ${String(m)}.`;
}

export function VisualizadorDeFotos({
  fotos,
  indiceAberto,
  aoFechar,
  aoNavegar,
}: PropriedadesDoVisualizador): ReactElement {
  const referencia = useRef<HTMLDialogElement>(null);
  const idDaPosicao = useId();
  const inicioDoGestoRef = useRef<number | null>(null);

  useEffect(() => {
    const dialogo = referencia.current;
    if (dialogo === null) return;

    if (indiceAberto === null) {
      if (dialogo.open) dialogo.close();
      document.body.classList.remove(TRAVAO_DO_FUNDO);
      return;
    }

    if (!dialogo.open) dialogo.showModal();
    document.body.classList.add(TRAVAO_DO_FUNDO);

    return () => {
      document.body.classList.remove(TRAVAO_DO_FUNDO);
    };
  }, [indiceAberto]);

  const ultimoIndiceValido = Math.max(fotos.length - 1, 0);
  const indice =
    indiceAberto === null ? 0 : Math.min(Math.max(indiceAberto, 0), ultimoIndiceValido);
  const foto: FotoPublica | undefined = fotos[indice];

  const naPrimeira = indice <= 0;
  const naUltima = indice >= fotos.length - 1;

  function recuar(): void {
    if (naPrimeira) return;
    aoNavegar(indice - 1);
  }

  function avancar(): void {
    if (naUltima) return;
    aoNavegar(indice + 1);
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDialogElement>): void {
    if (evento.key === "ArrowLeft") recuar();
    if (evento.key === "ArrowRight") avancar();
  }

  // Tocar no fundo (o próprio <dialog>, fora da foto e dos controlos) fecha;
  // tocar num filho (a foto, os botões) não — a mesma técnica da cortina da
  // `Folha`: comparar o alvo do clique com o próprio elemento.
  function aoTocarNoFundo(evento: MouseEvent<HTMLDialogElement>): void {
    if (evento.target === referencia.current) aoFechar();
  }

  /** Mínimo de deslocamento horizontal para contar como um deslize, não um toque parado. */
  const LIMIAR_DO_GESTO_PX = 40;

  function aoComecarOGesto(evento: PointerEvent<HTMLImageElement>): void {
    inicioDoGestoRef.current = evento.clientX;
  }

  function aoAcabarOGesto(evento: PointerEvent<HTMLImageElement>): void {
    const inicio = inicioDoGestoRef.current;
    inicioDoGestoRef.current = null;
    if (inicio === null) return;

    const deslocamento = evento.clientX - inicio;
    if (Math.abs(deslocamento) < LIMIAR_DO_GESTO_PX) return;
    // Arrastar para a esquerda (deslocamento negativo) avança, como num
    // carrossel de fotos — a mesma direção do `ArrowRight` (5.3).
    if (deslocamento < 0) avancar();
    else recuar();
  }

  function aoCancelarOGesto(): void {
    inicioDoGestoRef.current = null;
  }

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <dialog
      ref={referencia}
      aria-modal="true"
      aria-labelledby={idDaPosicao}
      onCancel={aoFechar}
      onClick={aoTocarNoFundo}
      onKeyDown={aoTeclar}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-fundo p-0 open:flex open:flex-col"
    >
      <div className="flex justify-end p-4">
        <Botao variante="discreto" rotulo={TEXTOS.fechar} onClick={aoFechar}>
          <span aria-hidden="true">×</span>
        </Botao>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-4 lg:px-12">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {foto !== undefined && (
            <img
              src={`/media/${foto.ficheiro}`}
              alt={foto.descricao ?? TEXTOS.altSemLegenda}
              draggable={false}
              onPointerDown={aoComecarOGesto}
              onPointerUp={aoAcabarOGesto}
              onPointerCancel={aoCancelarOGesto}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        {/*
         * Um par só de botões, nunca dois — a 390 px é uma faixa por baixo
         * da foto (lado a lado, ao alcance do polegar); a 1024 px passa a
         * cobrir a área da foto inteira, com os dois empurrados para os
         * lados opostos (`lg:absolute` sobre este `relative`). É a mesma
         * posição lógica a mudar de forma com o ecrã, não dois conjuntos de
         * botões a existir ao mesmo tempo (secção 5.3, 14).
         */}
        <div className="flex items-center justify-center gap-6 lg:absolute lg:inset-x-0 lg:inset-y-0 lg:justify-between lg:gap-0">
          <Botao rotulo={TEXTOS.fotoAnterior} desativado={naPrimeira} onClick={recuar}>
            <span aria-hidden="true">‹</span>
          </Botao>
          <Botao rotulo={TEXTOS.fotoSeguinte} desativado={naUltima} onClick={avancar}>
            <span aria-hidden="true">›</span>
          </Botao>
        </div>
      </div>

      <p
        id={idDaPosicao}
        role="status"
        className="px-4 pb-2 text-center text-nota text-texto-suave"
      >
        {posicao(indice + 1, fotos.length)}
      </p>

      {foto?.descricao !== undefined && foto.descricao !== null && (
        <p className="px-4 pb-6 text-center text-corpo text-texto-suave">{foto.descricao}</p>
      )}
    </dialog>
  );
}
