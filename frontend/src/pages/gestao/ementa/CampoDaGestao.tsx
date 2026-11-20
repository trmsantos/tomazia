import type { HTMLAttributes, KeyboardEvent, ReactElement, Ref } from "react";
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
 *    (mas focável) enquanto o modo «Ordenar» está aberto;
 *  - **o teclado de quem escreve uma password, um telefone ou um endereço**
 *    (F4-05a): `inputMode`, `autoCapitalize`, `spellCheck`, `enterKeyHint`, e uma
 *    `ajuda` ligada por `aria-describedby` (junto com o erro). Todas opcionais:
 *    sem elas o campo da F4-02 fica exatamente como estava.
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
  /** `tel`, `url`… — o teclado que o telemóvel abre. Por omissão, o do `decimal` ou nenhum. */
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  /** `none` para uma password ou um endereço: sem maiúscula à primeira letra. */
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  /** `false` tira o sublinhado e a correção automática (também no iOS). */
  spellCheck?: boolean;
  enterKeyHint?: HTMLAttributes<HTMLInputElement>["enterKeyHint"];
  /** Uma linha de ajuda por baixo do campo, ligada por `aria-describedby`. */
  ajuda?: string;
  /** O `Esc` da edição do preço cancela-a. */
  aoTeclar?: (tecla: KeyboardEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
  /**
   * Um `<textarea>` de três linhas no lugar do `<input>` (F4-03: a descrição de um evento, que
   * aceita quebras de linha). Com `aria-disabled` em vez de `disabled`, como o resto do campo:
   * a descrição que se está a guardar fica parada mas focável.
   */
  multilinha?: boolean;
};

export function CampoDaGestao({
  etiqueta,
  valor,
  aoMudar,
  id,
  erro,
  decimal = false,
  inputMode,
  autoCapitalize,
  spellCheck,
  enterKeyHint,
  ajuda,
  parado = false,
  aoTeclar,
  ref,
  multilinha = false,
}: PropriedadesDoCampoDaGestao): ReactElement {
  const gerado = useId();
  const identificador = id ?? gerado;
  const idDoErro = `${identificador}-erro`;
  const idDaAjuda = `${identificador}-ajuda`;
  const descritoPor =
    [ajuda !== undefined ? idDaAjuda : null, erro !== undefined ? idDoErro : null]
      .filter((id) => id !== null)
      .join(" ") || undefined;

  const classes = juntar(
    "min-h-toque w-full rounded-pequeno border bg-transparent px-3 py-2 text-corpo text-texto",
    erro !== undefined ? "border-erro" : "border-contorno",
    parado && "opacity-desativado cursor-not-allowed",
  );

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={identificador} className="text-nota font-forte text-texto">
        {etiqueta}
      </label>
      {multilinha ? (
        <textarea
          id={identificador}
          rows={3}
          value={valor}
          autoComplete="off"
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          aria-invalid={erro !== undefined ? "true" : undefined}
          aria-describedby={descritoPor}
          aria-disabled={parado ? "true" : undefined}
          onChange={(evento) => {
            if (parado) return;
            aoMudar(evento.target.value);
          }}
          className={classes}
        />
      ) : (
        <input
          id={identificador}
          ref={ref}
          type="text"
          value={valor}
          inputMode={inputMode ?? (decimal ? "decimal" : undefined)}
          enterKeyHint={enterKeyHint ?? (decimal ? "done" : undefined)}
          autoComplete="off"
          autoCapitalize={autoCapitalize ?? (decimal ? "none" : undefined)}
          autoCorrect={spellCheck === false ? "off" : undefined}
          spellCheck={spellCheck ?? (decimal ? false : undefined)}
          aria-invalid={erro !== undefined ? "true" : undefined}
          aria-describedby={descritoPor}
          aria-disabled={parado ? "true" : undefined}
          onKeyDown={aoTeclar}
          onChange={(evento) => {
            if (parado) return;
            aoMudar(evento.target.value);
          }}
          className={classes}
        />
      )}
      {ajuda !== undefined && (
        <p id={idDaAjuda} className="text-nota text-texto-suave">
          {ajuda}
        </p>
      )}
      {erro !== undefined && (
        <p id={idDoErro} className="text-nota text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
