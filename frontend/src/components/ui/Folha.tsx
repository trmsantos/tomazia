import type { MouseEvent, ReactElement, ReactNode, SyntheticEvent } from "react";
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
  const abertaAgora = useRef(aberta);

  useEffect(() => {
    abertaAgora.current = aberta;
  });

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

  // O `Esc` (e o «voltar» do Android) disparam `cancel`: cancela-se o fecho nativo e quem manda é
  // `aberta`. Assim, uma página que ignora o `aoFechar` (a meio de um pedido) não fica com o
  // `<dialog>` fechado e o React a achar que está aberto.
  const aoCancelar = (evento: SyntheticEvent<HTMLDialogElement>): void => {
    evento.preventDefault();
    aoFechar();
  };

  // O Chrome ignora o `preventDefault` do `cancel` sem ativação do utilizador (um segundo `Esc`
  // seguido) e fecha à mesma, sem passar pelo nosso `onCancel`. Se o diálogo fechou com `aberta`
  // ainda verdadeira, reabre-se (o estado do React continua a ser a verdade) e pede-se à página
  // o que o `Esc` pedia: `aoFechar()`. Se a página fecha, o efeito faz `close()` com a referência
  // já a falso e não reabre; se ignora (um pedido a meio), a folha fica aberta. `showModal` e não
  // só repor `open`: tem de voltar a ser modal.
  const aoFecharNativo = (): void => {
    const dialogo = referencia.current;
    if (dialogo === null || !abertaAgora.current || dialogo.open) return;
    dialogo.showModal();
    aoFechar();
  };

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
     * `onCancel` que está aqui em baixo (que cancela o fecho nativo: fecha-se por `aberta`). A cortina é o próprio elemento por fora do
     * painel, não uma `<div>` a fingir de botão, e por isso não é por ela que
     * o teclado passa.
     */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
    <dialog
      ref={referencia}
      aria-modal="true"
      aria-labelledby={idDoTitulo}
      onCancel={aoCancelar}
      onClose={aoFecharNativo}
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
