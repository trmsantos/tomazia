import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import type { EventoGestao } from "../../../lib/api/gestao-eventos";
import { formatarDataNaGestao } from "./data-na-gestao";
import { TEXTOS } from "./textos";

/**
 * «Tem a certeza?» (F4-03, spec 8): a segunda folha, empilhada sobre a de editar (que mantém o
 * que está escrito). Diz o título e a data do evento — uma linha de «Noite de samba» repete-se —
 * e que **não se desfaz**. O foco **começa em «Cancelar»**, a ação segura; «Cancelar», `Esc` e a
 * cortina fecham sem pedido.
 */
export function FolhaEliminarEvento({
  evento,
  agora,
  aEliminar,
  aoCancelar,
  aoConfirmar,
}: {
  /** `null` = fechada. */
  evento: EventoGestao | null;
  agora: Date;
  aEliminar: boolean;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}): ReactElement {
  const botaoDeCancelar = useRef<HTMLButtonElement>(null);
  const aberta = evento !== null;

  // Depois de a `Folha` abrir (o `showModal` dela corre antes): a ação segura.
  useEffect(() => {
    if (aberta) botaoDeCancelar.current?.focus();
  }, [aberta]);

  return (
    <Folha
      aberta={aberta}
      // Fechada, a Folha não leva texto: um título no DOM de uma folha escondida confunde.
      titulo={evento !== null ? TEXTOS.tituloEliminar : ""}
      aoFechar={() => {
        if (!aEliminar) aoCancelar();
      }}
    >
      {evento !== null && (
        <>
          <p>
            {TEXTOS.vaisEliminar(
              evento.titulo,
              evento.inicio === null ? null : formatarDataNaGestao(evento.inicio, agora),
            )}
          </p>
          <p>{TEXTOS.eliminarAviso}</p>
          <Botao
            variante="perigo"
            larguraTotal
            desativado={aEliminar}
            aTrabalhar={aEliminar}
            textoATrabalhar={TEXTOS.aEliminar}
            onClick={aoConfirmar}
          >
            {TEXTOS.eliminar}
          </Botao>
          <Botao ref={botaoDeCancelar} larguraTotal desativado={aEliminar} onClick={aoCancelar}>
            {TEXTOS.cancelar}
          </Botao>
        </>
      )}
    </Folha>
  );
}
