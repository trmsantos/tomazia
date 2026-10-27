import type { ReactElement, ReactNode } from "react";

import { juntar } from "./juntar";

/**
 * Chip de categoria (secção 7.3 de `docs/ecras/F3-01.md`).
 *
 * Na área pública os chips **navegam** para uma secção da página, por isso são
 * ligações e não botões nem rádios: assim o leitor de ecrã anuncia-os como
 * ligações e o teclado funciona sem uma linha de código nossa.
 *
 * O estado ativo não vem só pela cor — o `aria-current` di-lo, e o
 * preenchimento cheio distingue-o de todos os outros. É o segundo dos três
 * usos do dourado, e só sobrevive porque a barra de chips vive sobre bordô;
 * dentro de um cartão creme, o `bg-acao` passa a ser a cor de marca sozinho.
 *
 * Quatro px de canto, não cápsulas: é o que a especificação diz, e o
 * `rounded-cheio` é só do Interruptor.
 */
export type PropriedadesDoChip = {
  /** "#cafes" — a secção da página para onde o chip leva. */
  href: string;
  ativo?: boolean;
  children: ReactNode;
};

export function Chip({ href, ativo = false, children }: PropriedadesDoChip): ReactElement {
  return (
    <a
      href={href}
      aria-current={ativo ? "true" : undefined}
      className={juntar(
        "inline-flex items-center justify-center whitespace-nowrap",
        "min-h-toque min-w-toque px-4 rounded-pequeno",
        "text-nota font-forte",
        ativo ? "bg-acao text-sobre-acao" : "border border-contorno text-texto",
      )}
    >
      {children}
    </a>
  );
}
