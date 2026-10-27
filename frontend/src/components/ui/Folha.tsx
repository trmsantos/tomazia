import type { MouseEvent, ReactElement, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

import { Botao } from "./Botao";

/**
 * Folha (secção 7.4 de `docs/ecras/F3-01.md`), em `<dialog>` nativo com
 * `showModal()`, por ADR 0008.
 *
 * O elemento do browser traz de origem o que o Radix traria em JavaScript e em
 * KB: a camada de topo, o `::backdrop`, o foco preso dentro enquanto está
 * aberta, o fecho com `Esc` e o regresso do foco ao controlo que a abriu. O
 * que fica por nossa conta é o nome acessível, a cortina pintada com o nosso
 * token e o travão do deslizar do fundo — e esse último por classe, nunca por
 * `document.body.style`, que a CSP `style-src 'self'` bloqueia em produção.
 *
 * `showModal()` e nunca `show()`: a segunda abre um diálogo sem camada de
 * topo, sem cortina e sem foco preso, e a diferença não aparece numa captura
 * de ecrã.
 */
export type PropriedadesDaFolha = {
  aberta: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
};

/** Classe no `<body>` enquanto há uma Folha aberta. Definida em `global.css`. */
const TRAVAO_DO_FUNDO = "sem-deslizar";

export function Folha({ aberta, titulo, aoFechar, children }: PropriedadesDaFolha): ReactElement {
  const referencia = useRef<HTMLDialogElement>(null);
  const idDoTitulo = useId();

  useEffect(() => {
    const dialogo = referencia.current;
    if (dialogo === null) return;

    if (!aberta) {
      if (dialogo.open) dialogo.close();
      document.body.classList.remove(TRAVAO_DO_FUNDO);
      return;
    }

    if (!dialogo.open) dialogo.showModal();
    document.body.classList.add(TRAVAO_DO_FUNDO);

    return () => {
      document.body.classList.remove(TRAVAO_DO_FUNDO);
    };
  }, [aberta]);

  // Tocar na cortina fecha. Com o `<dialog>`, a cortina é o próprio elemento
  // por fora do painel, por isso basta comparar o alvo com ele.
  const aoTocarNaCortina = (evento: MouseEvent<HTMLDialogElement>): void => {
    if (evento.target === referencia.current) aoFechar();
  };

  return (
    /*
     * As duas regras desligadas aqui pedem um atalho de teclado para quem
     * carrega na cortina. Ele existe e é o do browser: num `<dialog>` aberto
     * com `showModal()`, o `Esc` fecha de origem e chega ao `aoFechar` pelo
     * `onCancel` que está aqui em baixo. A cortina é o próprio elemento por fora do
     * painel, não uma `<div>` a fingir de botão, e por isso não é por ela que
     * o teclado passa.
     */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
    <dialog
      ref={referencia}
      aria-modal="true"
      aria-labelledby={idDoTitulo}
      onCancel={aoFechar}
      onClick={aoTocarNaCortina}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 open:flex open:items-end open:justify-center lg:open:items-center"
    >
      <div
        className={
          "superficie-painel folha-sobe lg:folha-aparece flex max-h-folha w-full flex-col gap-4 " +
          "overflow-y-auto rounded-t-cartao border-t border-contorno-superficie p-6 " +
          "lg:max-w-folha lg:rounded-cartao lg:border"
        }
      >
        {/* A pega é decorativa: diz com a forma que isto se arrasta de baixo, e
            não se anuncia. A partir de 1024 px a Folha deixa de subir e passa a
            painel centrado, por isso a pega também deixa de fazer sentido. */}
        <div
          aria-hidden="true"
          className="mx-auto h-1 w-12 rounded-cheio bg-texto-suave lg:hidden"
        />

        <div className="flex items-start justify-between gap-4">
          {/* 27 px em Playfair: a Playfair não desce abaixo de 22, e na escala
              não há nada entre 21 e 27. */}
          <h2 id={idDoTitulo} className="font-titulo text-titulo text-texto">
            {titulo}
          </h2>
          <Botao variante="discreto" rotulo="Fechar" onClick={aoFechar}>
            <span aria-hidden="true">×</span>
          </Botao>
        </div>

        <div className="flex flex-col gap-4 text-corpo">{children}</div>
      </div>
    </dialog>
  );
}
