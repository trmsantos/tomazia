import type { ReactElement, Ref } from "react";
import { useId } from "react";

import { juntar } from "../../../components/ui/juntar";

/**
 * O `<select>` nativo da gestão (F4-02, 11), com a etiqueta, o erro e o contorno
 * do `Campo`. Nativo de propósito: no telemóvel abre o seletor do sistema, e não
 * há nada a escrever em JavaScript nem um `style` a bloquear pela CSP.
 *
 * Leva `bg-fundo` e não `bg-transparent`: com um fundo transparente, a lista que
 * o browser abre pinta o texto claro sobre branco.
 */
export type OpcaoDaSelecao = { valor: string; texto: string };

export type PropriedadesDaSelecao = {
  etiqueta: string;
  valor: string;
  opcoes: readonly OpcaoDaSelecao[];
  aoMudar: (valor: string) => void;
  id?: string;
  erro?: string;
  ref?: Ref<HTMLSelectElement>;
};

export function Selecao({
  etiqueta,
  valor,
  opcoes,
  aoMudar,
  id,
  erro,
  ref,
}: PropriedadesDaSelecao): ReactElement {
  const gerado = useId();
  const identificador = id ?? gerado;
  const idDoErro = `${identificador}-erro`;

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={identificador} className="text-nota font-forte text-texto">
        {etiqueta}
      </label>
      <select
        id={identificador}
        ref={ref}
        value={valor}
        aria-invalid={erro !== undefined ? "true" : undefined}
        aria-describedby={erro !== undefined ? idDoErro : undefined}
        onChange={(evento) => {
          aoMudar(evento.target.value);
        }}
        className={juntar(
          "min-h-toque w-full rounded-pequeno border bg-fundo px-3 py-2 text-corpo text-texto",
          erro !== undefined ? "border-erro" : "border-contorno",
        )}
      >
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.texto}
          </option>
        ))}
      </select>
      {erro !== undefined && (
        <p id={idDoErro} className="text-nota text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
