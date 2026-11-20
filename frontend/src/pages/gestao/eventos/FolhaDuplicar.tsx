import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import type { EventoGestao } from "../../../lib/api/gestao-eventos";
import { formatarDataNaGestao } from "./data-na-gestao";
import { datasDaCopia } from "./datas-da-copia";
import { TEXTOS } from "./textos";

/**
 * «Duplicar evento» (F4-03, spec 6.1): três botões, um por semana, cada um com a **data real** e
 * a hora de Lisboa (as Quintas de Samba são na 1.ª e na 3.ª quinta do mês, por isso a semana
 * não é sempre a mesma). Um toque cria; não há opção pré-escolhida e só «Daqui a 1 semana» é
 * dourada. O foco entra nela. `Esc`, a cortina e «Cancelar» fecham sem pedido.
 *
 * **A folha só fecha quando a resposta chega** (a spec 6.1 dizia «de imediato»): enquanto o
 * pedido corre as três opções ficam paradas (`aria-disabled`) e a escolhida diz que trabalha
 * (`aria-busy`), e um segundo toque não envia um segundo pedido (criava duas cópias).
 *
 * As datas são uma pré-visualização da regra do servidor (`datas-da-copia.ts`); a que vale é a
 * da resposta.
 */
export function FolhaDuplicar({
  evento,
  agora,
  escolhida,
  aoEscolher,
  aoFechar,
}: {
  /** O original; `null` = fechada. Só abre para um evento **com data**. */
  evento: EventoGestao | null;
  agora: Date;
  /** A semana tocada, enquanto o pedido corre. */
  escolhida: 1 | 2 | 3 | null;
  aoEscolher: (semanas: 1 | 2 | 3) => void;
  aoFechar: () => void;
}): ReactElement {
  const primeira = useRef<HTMLButtonElement>(null);
  const aberta = evento !== null;

  useEffect(() => {
    if (aberta) primeira.current?.focus();
  }, [aberta]);

  const opcoes =
    evento !== null && evento.inicio !== null ? datasDaCopia(evento.inicio, agora) : [];

  return (
    <Folha aberta={aberta} titulo={aberta ? TEXTOS.tituloDuplicar : ""} aoFechar={aoFechar}>
      {evento !== null && (
        <>
          <p className="text-nota text-texto-suave">{TEXTOS.tituloDoOriginal(evento.titulo)}</p>
          {opcoes.map((opcao) => (
            <Botao
              key={opcao.semanas}
              ref={opcao.semanas === 1 ? primeira : undefined}
              variante={opcao.semanas === 1 ? "principal" : "secundario"}
              larguraTotal
              desativado={escolhida !== null}
              aTrabalhar={escolhida === opcao.semanas}
              onClick={() => {
                aoEscolher(opcao.semanas);
              }}
            >
              <span className="flex flex-col items-center gap-1 py-2">
                <span>{TEXTOS.daquiASemanas(opcao.semanas)}</span>{" "}
                <span className="text-nota font-normal">
                  {formatarDataNaGestao(opcao.inicio, agora)}
                </span>
              </span>
            </Botao>
          ))}
          <Botao larguraTotal onClick={aoFechar}>
            {TEXTOS.cancelar}
          </Botao>
        </>
      )}
    </Folha>
  );
}
