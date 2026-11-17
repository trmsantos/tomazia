import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { useId } from "react";

import { juntar } from "../../../components/ui/juntar";

/**
 * Uma hora, em `<input type="time">` nativo (F4-05a, 6.3): no telemóvel abre o
 * seletor do sistema e o valor é sempre `HH:MM` em 24 horas, qualquer que seja
 * o modo como o aparelho o mostra. Sem `step` (minutos inteiros).
 *
 * A etiqueta visível («Abre», «Fecha») é a do `<label>`; o nome acessível completo
 * («Abre, período 2 de terça-feira») vai em `aria-label` e começa por ela (WCAG 2.5.3).
 *
 * **Vazia ≠ incompleta** (regra 10): um `<input type="time">` com a hora escrita
 * só a meio tem `value === ""` e `validity.badInput === true`. Quem escreve avisa
 * se `incompleto`. O React só chama o `onChange` quando o valor muda, e de vazio
 * para vazio não muda: por isso o `onInput` também ouve.
 */
export type PropriedadesDoCampoDeHora = {
  id: string;
  etiqueta: string;
  nome: string;
  valor: string;
  aoMudar: (valor: string, incompleto: boolean) => void;
  erro?: string;
  /** O `id` de uma frase que descreve a hora («Fecha às 02:00 de sábado.»), desenhada por quem usa. */
  idDaNota?: string;
  /** `aria-disabled`: o valor não muda, o foco não sai. */
  parado?: boolean;
};

export function CampoDeHora({
  id,
  etiqueta,
  nome,
  valor,
  aoMudar,
  erro,
  idDaNota,
  parado = false,
}: PropriedadesDoCampoDeHora): ReactElement {
  const gerado = useId();
  const idDoErro = `${gerado}-erro`;
  const descritoPor =
    [idDaNota ?? null, erro !== undefined ? idDoErro : null].filter((x) => x !== null).join(" ") ||
    undefined;

  function aAlterar(evento: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>): void {
    if (parado) return;
    const campo = evento.currentTarget;
    aoMudar(campo.value, campo.value === "" && campo.validity.badInput);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-nota font-forte text-texto">
        {etiqueta}
      </label>
      <input
        id={id}
        type="time"
        value={valor}
        aria-label={nome}
        aria-invalid={erro !== undefined ? "true" : undefined}
        aria-describedby={descritoPor}
        aria-disabled={parado ? "true" : undefined}
        onChange={aAlterar}
        onInput={aAlterar}
        className={juntar(
          "min-h-toque w-full min-w-0 rounded-pequeno border bg-fundo px-3 py-2 text-corpo text-texto",
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
