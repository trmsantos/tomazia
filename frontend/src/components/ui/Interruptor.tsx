import type { ReactElement } from "react";
import { useId } from "react";

import { juntar } from "./juntar";

/**
 * Interruptor (secção 7.6 de `docs/ecras/F3-01.md`), em
 * `<input type="checkbox" role="switch">`, por ADR 0008.
 *
 * O elemento do browser trata do teclado (o `Espaço` alterna), do estado
 * anunciado e do comportamento em formulário. O que fica por nossa conta é o
 * desenho: carril 48 × 28 com um manípulo de 24 e `--espaco-1` de folga.
 *
 * **A linha inteira é uma `<label>`**, e é daí que vêm os 44 px do alvo de
 * toque: o carril tem 28 de altura e, se a linha fosse uma `<div>`, o alvo
 * real seria mesmo só o carril. O teste dos 44 px mede a união do controlo
 * com a etiqueta, por isso uma `<div>` aqui falha — e deve falhar.
 *
 * **O carril nunca é dourado.** O dourado tem três usos e este não é um
 * deles; e um carril `bg-acao` dentro de um cartão creme ficava a 1,72 contra
 * o fundo. Ligado é o carril cheio em `bg-texto` com o manípulo em `bg-fundo`,
 * que se lê nos dois âmbitos. O estado também não vem só da cor: a posição do
 * manípulo e o carril cheio ou vazio chegam sozinhos.
 */
export type PropriedadesDoInterruptor = {
  /** "Disponível". Não muda com o estado: o nome acessível tem de ser estável. */
  etiqueta: string;
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  desativado?: boolean;
};

export function Interruptor({
  etiqueta,
  ligado,
  aoMudar,
  desativado = false,
}: PropriedadesDoInterruptor): ReactElement {
  const identificador = useId();

  return (
    <label
      htmlFor={identificador}
      className={juntar(
        "flex min-h-toque w-full items-center justify-between gap-4 py-2 text-corpo",
        // Desativado é a linha inteira a perder opacidade — etiqueta, carril e
        // manípulo ao mesmo tempo. Nada muda de cor: ver o comentário do
        // carril, em baixo.
        desativado ? "opacity-desativado cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span>{etiqueta}</span>

      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={identificador}
          type="checkbox"
          role="switch"
          checked={ligado}
          aria-disabled={desativado ? "true" : undefined}
          onChange={(evento) => {
            // `aria-disabled` não trava nada sozinho, tal como no Botão: com
            // o atributo `disabled` o controlo saía da ordem de tabulação e
            // ninguém ouvia porque é que ele ali está.
            if (desativado) return;
            aoMudar(evento.target.checked);
          }}
          className={juntar(
            "h-carril w-carril appearance-none rounded-cheio border transition-colors duration-curta ease-curva",
            // **O desenho de ligado/desligado não muda quando está
            // desativado.** É o ponto mais importante deste componente: o
            // carril cheio é o que diz "ligado", e esvaziá-lo para dizer
            // "desativado" fazia um produto disponível-mas-bloqueado ler-se
            // como indisponível — no creme ficava igual ao pixel a um
            // interruptor desligado, porque lá `texto-suave` e `contorno` são
            // a mesma cor. Numa ementa que o dono gere a uma mão atrás do
            // balcão, isso é um erro de stock e não um detalhe de desenho.
            // Nunca trocar o desenho que transporta a informação para dizer
            // "desativado" (secção 6); quem o diz é a opacidade da linha.
            "border-contorno checked:border-texto checked:bg-texto",
          )}
        />

        {/* O manípulo. Fica de fora do fluxo de cliques para o alvo continuar
            a ser o carril (e a linha inteira). */}
        <span
          aria-hidden="true"
          className={juntar(
            "pointer-events-none absolute left-1 h-manipulo w-manipulo rounded-cheio",
            "transition-transform duration-curta ease-curva",
            ligado ? "translate-x-manipulo" : "translate-x-0",
            // Ligado, o manípulo é `bg-fundo` sobre o carril cheio: 13,27 nos
            // dois âmbitos, desativado ou não.
            ligado ? "bg-fundo" : "bg-texto-suave",
          )}
        />
      </span>
    </label>
  );
}
