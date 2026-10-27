import type { ReactElement, ReactNode } from "react";

import { juntar } from "./juntar";

/**
 * Botão (secção 7.1 de `docs/ecras/F3-01.md`).
 *
 * Quatro variantes e nada mais. Nenhuma escreve uma cor da paleta: escrevem
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
export type VarianteDeBotao = "principal" | "secundario" | "discreto" | "perigo";

const PELA_VARIANTE: Record<VarianteDeBotao, string> = {
  principal: "bg-acao text-sobre-acao",
  secundario: "border border-contorno text-texto",
  discreto: "text-texto-suave",
  perigo: "bg-perigo text-sobre-perigo",
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
  "min-h-toque min-w-toque px-6 rounded-pequeno",
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
}: PropriedadesDoBotao): ReactElement {
  const travado = desativado || aTrabalhar;

  return (
    <button
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
