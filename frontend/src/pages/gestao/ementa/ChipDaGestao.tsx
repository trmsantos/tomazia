import type { MouseEvent, ReactElement, ReactNode, Ref } from "react";

import { juntar } from "../../../components/ui/juntar";

/**
 * O chip de categoria da gestão (F4-02, 3 e 11): **as mesmas classes do `Chip`**
 * público, com um `onClick` — aqui o chip não rola para uma âncora, troca a
 * categoria sem empurrar o histórico. O `Chip` público não ganha propriedades
 * (Q-02).
 *
 * É uma ligação (`<a href>`) com `aria-current` no ativo, como na F3-02: um
 * clique com Ctrl, Cmd, Shift ou Alt (ou o botão do meio) segue o `href` e abre
 * noutro separador. `parado` é o modo «Ordenar»: não faz nada, mas continua à vista.
 */
export type PropriedadesDoChipDaGestao = {
  href: string;
  ativo?: boolean;
  parado?: boolean;
  aoTocar: () => void;
  children: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
};

function eCliqueSimples(evento: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    evento.button === 0 && !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey
  );
}

export function ChipDaGestao({
  href,
  ativo = false,
  parado = false,
  aoTocar,
  children,
  ref,
}: PropriedadesDoChipDaGestao): ReactElement {
  return (
    <a
      ref={ref}
      href={href}
      aria-current={ativo ? "true" : undefined}
      aria-disabled={parado ? "true" : undefined}
      onClick={(evento) => {
        if (!eCliqueSimples(evento)) return;
        evento.preventDefault();
        if (parado) return;
        aoTocar();
      }}
      className={juntar(
        "inline-flex items-center justify-center whitespace-nowrap",
        "min-h-toque min-w-toque px-4 rounded-pequeno",
        "text-nota font-forte",
        ativo ? "bg-acao text-sobre-acao" : "border border-contorno text-texto",
        parado && "opacity-desativado cursor-not-allowed",
      )}
    >
      {children}
    </a>
  );
}
