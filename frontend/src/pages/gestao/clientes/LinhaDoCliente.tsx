import type { ReactElement, Ref } from "react";

import { Botao } from "../../../components/ui/Botao";
import type { ClienteGestao } from "../../../lib/api/gestao-clientes";
import { TEXTOS as T, dataDoConsentimento } from "./textos";

/**
 * Um cliente na lista (F4-05b, spec 5.2): nome, email, telemóvel (só se existir) e a data do
 * consentimento, com o «Eliminar» à direita.
 *
 * **Dados de terceiros só como texto visível.** O «Eliminar» tem o nome acessível «Eliminar» e
 * `aria-describedby` apontado ao `<p>` do nome **deste** item (o leitor diz «Eliminar, botão,
 * {nome}»); nenhum `aria-label`, `title` ou `data-` leva dados, e os `id` são por índice, nunca
 * pelo `id` nem pelo texto do cliente. Email e telemóvel são texto simples: nunca `mailto:` nem
 * `tel:` (um toque ao lado de um «Eliminar» é um engano à espera).
 */
export function LinhaDoCliente({
  cliente,
  indice,
  inerte,
  refDoEliminar,
  aoEliminar,
}: {
  cliente: ClienteGestao;
  /** A posição na lista mostrada: só serve para o `id` do nome. */
  indice: number;
  /** Um `DELETE` sem resposta deste cliente ainda não se resolveu: o «Eliminar» fica inerte. */
  inerte: boolean;
  /** O `<button>` do «Eliminar», para devolver o foco ao fechar a folha sem eliminar. */
  refDoEliminar: Ref<HTMLButtonElement>;
  aoEliminar: () => void;
}): ReactElement {
  const idDoNome = `cliente-nome-${String(indice)}`;
  return (
    <li className="flex gap-3 border-b border-fio-interno py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p id={idDoNome} className="break-words text-corpo font-forte text-texto">
          {cliente.nome}
        </p>
        <p className="text-nota text-texto [overflow-wrap:anywhere]">{cliente.email}</p>
        {cliente.telemovel !== null && (
          <p className="text-nota text-texto [overflow-wrap:anywhere]">{cliente.telemovel}</p>
        )}
        <p className="text-nota text-texto-suave">
          {T.consentimento(dataDoConsentimento(cliente.consentimento_em))}
        </p>
      </div>
      <div className="self-start">
        <Botao ref={refDoEliminar} descritoPor={idDoNome} desativado={inerte} onClick={aoEliminar}>
          {T.eliminar}
        </Botao>
      </div>
    </li>
  );
}
