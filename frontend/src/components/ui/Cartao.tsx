import type { ReactElement, ReactNode } from "react";

/**
 * Cartão (secção 6.9 de `docs/ecras/R-01.md`).
 *
 * `papel` é o cartão de conteúdo, com a aresta de baixo no lugar da sombra
 * (sombras são proibidas). `destaque` é o cartão de marca com o círculo de
 * dourado, que vive em `global.css` (`.cartao-destaque::after`) e nunca em
 * `style`. O destaque leva `px-4 py-6` e não `p-6`: a 360 px, `p-6` parte
 * "Bar da Tomazia" em duas linhas.
 */
export type PropriedadesDoCartao = {
  tom?: "papel" | "destaque";
  como?: "div" | "section" | "article" | "li";
  children: ReactNode;
};

const CLASSES = {
  papel: "superficie-papel rounded-cartao border-b border-contorno-superficie p-4",
  destaque: "superficie-destaque cartao-destaque relative overflow-hidden rounded-grande px-4 py-6",
} as const;

export function Cartao({
  tom = "papel",
  como: Elemento = "div",
  children,
}: PropriedadesDoCartao): ReactElement {
  return <Elemento className={CLASSES[tom]}>{children}</Elemento>;
}
