import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Interruptor } from "../../../components/ui/Interruptor";
import type { EventoGestao } from "../../../lib/api/gestao-eventos";
import { formatarDataNaGestao } from "./data-na-gestao";
import { TEXTOS } from "./textos";

/**
 * Uma linha de evento na gestão (F4-03, spec 4.2):
 *
 * ```
 * [ título (botão, abre a folha de editar) + lápis ]
 * Quinta-feira, 5 de novembro, às 22:00
 * (a nota da linha, só se for o caso)
 * [ Publicado ]  [ Duplicar ]        (Arquivo: só «Duplicar»)
 * ```
 *
 * O título é um botão cujo nome acessível é só o título (o lápis é decorativo); nada se corta.
 * **Eliminar não está aqui**: fica na folha de editar. O arquivo não tem interruptor.
 *
 * Os nomes acessíveis distinguem uma lista de dez «Duplicar» e dez «Publicado»: «Duplicar
 * {título}» e «Publicado, {título}». O `Interruptor` não aceita um nome diferente da etiqueta
 * visível («Publicado»), por isso o nome põe-se no `<input>` depois de desenhado (`aria-label`),
 * sem mexer em `components/ui/`: ambos começam pela etiqueta visível (WCAG 2.5.3).
 */
function Lapis(): ReactElement {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-texto-suave"
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

/** O interruptor «Publicado», com o nome acessível «Publicado, {título}». */
function InterruptorDoEvento({
  chave,
  nome,
  ligado,
  desativado,
  registar,
  aoMudar,
}: {
  chave: string;
  nome: string;
  ligado: boolean;
  desativado: boolean;
  registar: (chave: string) => (no: HTMLElement | null) => void;
  aoMudar: (ligado: boolean) => void;
}): ReactElement {
  const caixa = useRef<HTMLDivElement>(null);

  // O `Interruptor` não deixa dar-lhe outro nome: põe-se aqui, depois de desenhado, e regista-se
  // o nó para o foco o reencontrar.
  useEffect(() => {
    const campo = caixa.current?.querySelector<HTMLElement>('input[role="switch"]');
    if (campo === null || campo === undefined) return;
    campo.setAttribute("aria-label", nome);
    const registo = registar(chave);
    registo(campo);
    return () => {
      registo(null);
    };
  }, [nome, chave, registar]);

  return (
    <div ref={caixa} className="w-1/2 min-w-0">
      <Interruptor
        etiqueta={TEXTOS.etiquetaPublicado}
        ligado={ligado}
        desativado={desativado}
        aoMudar={aoMudar}
      />
    </div>
  );
}

export function LinhaDoEvento({
  evento,
  agora,
  noArquivo,
  ligado,
  interruptorParado,
  aDuplicar,
  nota,
  registar,
  aoAbrir,
  aoMudarPublicado,
  aoDuplicar,
}: {
  evento: EventoGestao;
  agora: Date;
  noArquivo: boolean;
  /** O valor que o interruptor mostra (otimista enquanto o pedido corre). */
  ligado: boolean;
  /** `aria-disabled`: um pedido no ar, ou um rascunho sem data (não se publica). */
  interruptorParado: boolean;
  aDuplicar: boolean;
  nota: string | null;
  registar: (chave: string) => (no: HTMLElement | null) => void;
  aoAbrir: () => void;
  aoMudarPublicado: (ligado: boolean) => void;
  aoDuplicar: () => void;
}): ReactElement {
  return (
    <li className="flex flex-col gap-2 border-t border-fio-interno py-3 first:border-t-0 first:pt-0">
      <button
        ref={registar(`titulo-${String(evento.id)}`)}
        type="button"
        onClick={aoAbrir}
        className="flex min-h-toque min-w-0 items-center gap-2 py-2 text-left text-corpo font-forte text-texto"
      >
        <span className="min-w-0 break-words">{evento.titulo}</span>
        <Lapis />
      </button>

      <p className="text-nota text-texto-suave">{formatarDataNaGestao(evento.inicio, agora)}</p>
      {nota !== null && <p className="text-nota text-texto-suave">{nota}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!noArquivo && (
          <InterruptorDoEvento
            chave={`interruptor-${String(evento.id)}`}
            nome={TEXTOS.publicadoDe(evento.titulo)}
            ligado={ligado}
            desativado={interruptorParado}
            registar={registar}
            aoMudar={aoMudarPublicado}
          />
        )}
        <Botao
          rotulo={TEXTOS.duplicarDe(evento.titulo)}
          desativado={aDuplicar}
          aTrabalhar={aDuplicar}
          textoATrabalhar={TEXTOS.aDuplicar}
          onClick={aoDuplicar}
        >
          {TEXTOS.duplicar}
        </Botao>
      </div>
    </li>
  );
}
