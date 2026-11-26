import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import type { ClienteGestao } from "../../../lib/api/gestao-clientes";
import { TEXTOS as T } from "./textos";

/**
 * A folha «Tem a certeza?» de eliminar um cliente (F4-05b, spec 7). Dados pessoais: não há
 * desfazer, por isso custa dois toques: o «Eliminar» do item abre esta folha **sem pedido nenhum**.
 *
 *  - mostra o **nome e o email** (duas Anas existem; o email distingue-as) como texto visível; o
 *    telemóvel não. O nome acessível da folha é «Tem a certeza?», sem dados pessoais;
 *  - diz numa linha discreta que um CSV já descarregado continua a ter o cliente;
 *  - o foco **começa em «Cancelar»**, a ação segura; o «Eliminar» é `perigo` e a folha não tem
 *    dourado;
 *  - a meio do pedido, nem «Cancelar», `Esc`, «×» nem a cortina fecham.
 */
export function FolhaEliminarCliente({
  cliente,
  aEliminar,
  falhou,
  aoConfirmar,
  aoFechar,
}: {
  /** `null` = fechada. */
  cliente: ClienteGestao | null;
  aEliminar: boolean;
  /** O servidor respondeu com um erro: fica dentro da folha, que se mantém aberta. */
  falhou: boolean;
  aoConfirmar: () => void;
  aoFechar: () => void;
}): ReactElement {
  const cancelar = useRef<HTMLButtonElement>(null);
  const nome = useRef<HTMLParagraphElement>(null);
  const aberta = cliente !== null;

  // Corre depois do efeito da `Folha` (filha daqui): o `showModal` dela já pôs o foco no primeiro
  // controlo, e é aqui que se dá à ação segura.
  useEffect(() => {
    if (aberta) cancelar.current?.focus();
  }, [aberta]);

  // O «×» é da `Folha` partilhada, que não tem como o pôr inerte (spec 7.2: «Cancelar» e o «×»
  // ficam `aria-disabled` a meio do pedido). O fecho já está travado por `aoFechar`; isto diz o
  // mesmo a quem lê o ecrã (como na folha de eliminar fotos).
  useEffect(() => {
    const fechar = nome.current?.closest("dialog")?.querySelector('button[aria-label="Fechar"]');
    if (fechar === null || fechar === undefined) return;
    if (aEliminar) fechar.setAttribute("aria-disabled", "true");
    return () => {
      fechar.removeAttribute("aria-disabled");
    };
  }, [aEliminar, aberta]);

  return (
    <Folha
      aberta={aberta}
      // Fechada, a Folha não leva texto no DOM.
      titulo={aberta ? T.tituloDaFolha : ""}
      aoFechar={() => {
        if (aEliminar) return;
        aoFechar();
      }}
    >
      {cliente !== null && (
        <>
          <p ref={nome} className="break-words text-corpo font-forte text-texto">
            {cliente.nome}
          </p>
          <p className="text-nota text-texto [overflow-wrap:anywhere]">{cliente.email}</p>
          <p className="text-corpo text-texto">{T.consequencia}</p>
          <p className="text-nota text-texto-suave">{T.linhaDoCsv}</p>

          {falhou && (
            <p role="status" className="text-nota text-erro">
              {T.erroNaFolha}
            </p>
          )}

          <Botao
            larguraTotal
            variante="perigo"
            desativado={aEliminar}
            aTrabalhar={aEliminar}
            textoATrabalhar={T.aEliminar}
            onClick={aoConfirmar}
          >
            {T.eliminar}
          </Botao>
          <Botao ref={cancelar} larguraTotal desativado={aEliminar} onClick={aoFechar}>
            {T.cancelar}
          </Botao>
        </>
      )}
    </Folha>
  );
}
