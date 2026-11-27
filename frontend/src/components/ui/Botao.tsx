import type { ReactElement, ReactNode, Ref } from "react";

import { juntar } from "./juntar";

/**
 * Botão (secção 7.1 de `docs/ecras/F3-01.md`; aspeto B em `docs/ecras/R-01.md`, 6.1).
 *
 * Cinco variantes e nada mais. Um só `dourado` por ecrã; sobre creme leva
 * sempre a borda. Nenhuma escreve uma cor da paleta: escrevem
 * papéis (`bg-acao`, `text-sobre-acao`, `border-contorno`), e é a classe
 * `.superficie-creme` que troca o que essas palavras significam. É isso que
 * impede o botão dourado de aparecer dentro de um cartão creme, onde o limite
 * do preenchimento contra o fundo ficaria a 1,72.
 *
 * Duas decisões que não são detalhe:
 *
 *  - **desativado é `aria-disabled`, nunca o atributo `disabled`.** Com
 *    `disabled` o botão sai da ordem de tabulação e o foco salta para fora
 *    sem explicação; com `aria-disabled` continua focável e o leitor de ecrã
 *    anuncia porque é que ele ali está. Em troca, o clique tem de ser travado
 *    por nós — `aria-disabled` não trava nada sozinho.
 *  - **o tipo por omissão é `button`.** Um botão sem `type` dentro de um
 *    `<form>` é um `submit` para o HTML, e na gestão isso dá uma submissão
 *    acidental a cada "Cancelar".
 */
export type VarianteDeBotao = "principal" | "dourado" | "secundario" | "discreto" | "perigo";

/*
 * O `border-medio` está na base e cada variante só escolhe a cor da borda:
 * as cinco têm a mesma caixa (R-01 / ADR 0023). O dourado sobre creme só
 * passa 1.4.11 pela borda, não pelo preenchimento (1,72).
 */
const PELA_VARIANTE: Record<VarianteDeBotao, string> = {
  principal: "border-transparent bg-acao text-sobre-acao",
  dourado: "border-contorno-dourada bg-dourada text-sobre-dourada",
  secundario: "border-contorno text-texto",
  discreto: "border-transparent text-texto-suave",
  perigo: "border-transparent bg-perigo text-sobre-perigo",
};

/*
 * Desativado **mantém a variante inteira** e só perde opacidade. Entre o texto
 * normal e o `texto-suave` há 1,39 no escuro e 1,33 no creme: não é uma
 * mudança de estado, é a mesma coisa outra vez (secção 6 da especificação).
 *
 * E a regra anterior — tirar o preenchimento, pôr contorno `contorno` e texto
 * `texto-suave` — dava três defeitos de uma vez: no secundário não mudava nada
 * (as duas cores já eram as dele), no discreto **acrescentava** um contorno e
 * fazia o botão desligado pesar mais do que o ligado, e no principal e no
 * perigo apagava a variante toda. Assim, um principal desativado continua
 * dourado, só apagado, e os quatro continuam a distinguir-se uns dos outros.
 */
const DESATIVADO = "opacity-desativado cursor-not-allowed";

const BASE = juntar(
  "inline-flex items-center justify-center gap-2",
  "min-h-toque min-w-toque px-6 rounded-botao border-medio",
  "font-corpo font-forte text-corpo text-center",
  // Premido desce 1 px. Não há hover que levante nada (a especificação
  // proíbe-o) e no telemóvel o hover nem existe.
  "transition-transform duration-curta ease-curva active:translate-y-premido",
);

export type PropriedadesDoBotao = {
  children: ReactNode;
  variante?: VarianteDeBotao;
  tipo?: "button" | "submit";
  desativado?: boolean;
  aTrabalhar?: boolean;
  /** "A guardar…", "A enviar…" — gerúndio português, com reticências de um caractere. */
  textoATrabalhar?: string;
  /** `aria-label`, para o botão que só tem ícone. O ícone vai `aria-hidden`. */
  rotulo?: string;
  onClick?: () => void;
  larguraTotal?: boolean;
  /**
   * O `id` de um elemento que descreve o botão (a linha de erro do «Sair»,
   * F4-01 7.4). Vai para `aria-describedby`.
   */
  descritoPor?: string;
  /** O nó do `<button>`, para o ecrã lhe devolver o foco (React 19: `ref` é uma propriedade). */
  ref?: Ref<HTMLButtonElement>;
};

export function Botao({
  children,
  variante = "secundario",
  tipo = "button",
  desativado = false,
  aTrabalhar = false,
  textoATrabalhar,
  rotulo,
  onClick,
  larguraTotal = false,
  descritoPor,
  ref,
}: PropriedadesDoBotao): ReactElement {
  const travado = desativado || aTrabalhar;

  return (
    <button
      ref={ref}
      data-variante={variante}
      aria-describedby={descritoPor}
      type={tipo === "submit" ? "submit" : "button"}
      className={juntar(
        BASE,
        PELA_VARIANTE[variante],
        desativado && DESATIVADO,
        larguraTotal && "w-full",
      )}
      aria-label={rotulo}
      aria-disabled={desativado ? "true" : undefined}
      aria-busy={aTrabalhar ? "true" : undefined}
      onClick={(evento) => {
        if (travado) {
          // Travar o `onClick` não chega: o `aria-disabled` não tira o botão
          // do formulário, por isso um `tipo="submit"` desativado submetia à
          // mesma, e um botão a trabalhar voltava a submeter a cada clique —
          // o duplo-submit, precisamente no estado em que dói. Quem trava a
          // submissão é o `preventDefault`, não o `return`.
          evento.preventDefault();
          return;
        }
        onClick?.();
      }}
    >
      {aTrabalhar && textoATrabalhar !== undefined ? textoATrabalhar : children}
    </button>
  );
}
