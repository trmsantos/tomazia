import type { KeyboardEvent, ReactElement, Ref } from "react";
import { useId } from "react";

import { juntar } from "../../../components/ui/juntar";

/**
 * O campo de uma linha da gestão (F4-02, 11): a mesma receita visual do `Campo`
 * (etiqueta sempre visível, contorno, erro por baixo, `aria-describedby`), com o
 * que o `Campo` não tem e que não é desta tarefa acrescentar-lhe — o `Campo` é do
 * pacote público (Q-02):
 *
 *  - **teclado decimal** (`inputmode="decimal"`, `enterkeyhint="done"`, sem
 *    `type="number"`: o `number` rejeita a vírgula em vários browsers e deixa a
 *    roda do rato trocar o preço a quem desloca a página);
 *  - **`aria-disabled`** em vez de `disabled`, para a pesquisa que fica parada
 *    (mas focável) enquanto o modo «Ordenar» está aberto.
 */
export type PropriedadesDoCampoDaGestao = {
  etiqueta: string;
  valor: string;
  aoMudar: (valor: string) => void;
  id?: string;
  erro?: string;
  /** Teclado decimal, sem sugestões, para um preço. */
  decimal?: boolean;
  /** `aria-disabled`: o valor não muda, o foco não sai. */
  parado?: boolean;
  /** O `Esc` da edição do preço cancela-a. */
  aoTeclar?: (tecla: KeyboardEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
};

export function CampoDaGestao({
  etiqueta,
  valor,
  aoMudar,
  id,
  erro,
  decimal = false,
  parado = false,
  aoTeclar,
  ref,
}: PropriedadesDoCampoDaGestao): ReactElement {
  const gerado = useId();
  const identificador = id ?? gerado;
  const idDoErro = `${identificador}-erro`;

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={identificador} className="text-nota font-forte text-texto">
        {etiqueta}
      </label>
      <input
        id={identificador}
        ref={ref}
        type="text"
        value={valor}
        inputMode={decimal ? "decimal" : undefined}
        enterKeyHint={decimal ? "done" : undefined}
        autoComplete="off"
        autoCapitalize={decimal ? "none" : undefined}
        spellCheck={decimal ? false : undefined}
        aria-invalid={erro !== undefined ? "true" : undefined}
        aria-describedby={erro !== undefined ? idDoErro : undefined}
        aria-disabled={parado ? "true" : undefined}
        onKeyDown={aoTeclar}
        onChange={(evento) => {
          if (parado) return;
          aoMudar(evento.target.value);
        }}
        className={juntar(
          "min-h-toque w-full rounded-pequeno border bg-transparent px-3 py-2 text-corpo text-texto",
          erro !== undefined ? "border-erro" : "border-contorno",
          parado && "opacity-desativado cursor-not-allowed",
        )}
      />
      {erro !== undefined && (
        <p id={idDoErro} className="text-nota text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
