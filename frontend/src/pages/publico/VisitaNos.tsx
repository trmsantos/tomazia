import { useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { Botao } from "../../components/ui/Botao";
import { EstadoVazio } from "../../components/ui/EstadoVazio";
import type { Info } from "../../lib/api/publico";
import {
  esperaAteAProximaMudanca,
  estadoDoHorario,
  periodosDaSemana,
} from "../../lib/horario/estado-do-horario";
import type { EstadoDoHorario } from "../../lib/horario/estado-do-horario";
import {
  NOMES_DOS_DIAS,
  textoDaLinhaDoMomento,
  textoDoPeriodo,
} from "../../lib/horario/nomes-e-textos";
import { ligacaoDoInstagram, ligacaoDoMaps, ligacaoDoTelefone } from "../../lib/ligacoes/contactos";
import { TEXTOS } from "./textos-do-visita-nos";

/**
 * «Visita-nos» — a sexta secção da página pública (`docs/ecras/F3-06a.md`).
 *
 * Horário dos sete dias com a linha do momento, morada com o botão do Google
 * Maps, telefone e Instagram. Não pede nada à rede: o `App.tsx` pede o `/info`
 * uma vez e passa o mesmo estado ao cabeçalho e a esta secção (2.3).
 *
 * **É a secção onde «não sei» e «não há» mais se parecem**, e a regra é uma:
 * «Fechado» só se escreve quando o dono disse que está fechado. Nunca por
 * omissão, nunca enquanto carrega, nunca porque o pedido falhou (regra 10 do
 * `CLAUDE.md`). Por isso os quatro estados têm quatro desenhos:
 *
 * - **a carregar**: o título e dois esqueletos, sem uma palavra;
 * - **falhou**: o título fica, e o erro diz que **não consegui perguntar**;
 * - **por configurar**: a secção não está no DOM (4.4);
 * - **pronto**: o que cada bloco consegue desenhar, e só isso.
 */

/** As três leituras do `/info`; o `falhou` não traz informação nenhuma, só o estado HTTP. */
export type EstadoDaSeccao =
  | { estado: "a-carregar" }
  | { estado: "pronto"; info: Info }
  /** `estadoHttp`: o estado do `ErroDaApi`; `null` = sem resposta (rede, DNS, prazo). */
  | { estado: "falhou"; estadoHttp: number | null };

export type PropriedadesDoVisitaNos = {
  info: EstadoDaSeccao;
  /** Repete o pedido do `/info`. Cumpre-se quando a tentativa acaba, bem ou mal; nunca rejeita. */
  aoTentarOutraVez: () => Promise<void>;
};

const ID_DA_SECCAO = "visita-nos";
const ID_DO_TITULO = "titulo-visita-nos";

/**
 * Um bloco só existe se tiver o que mostrar: texto depois de `trim()`.
 * Uma morada só de espaços é vazia, e uma etiqueta sem valor seria órfã.
 */
function comTexto(valor: string | null | undefined): string | null {
  return valor !== undefined && valor !== null && valor.trim() !== "" ? valor : null;
}

/*
 * As mesmas classes do `<h2>` da ementa, à letra: os títulos das secções
 * assentam todos na mesma coluna de 640 px.
 */
function Seccao({ ocupada, children }: { ocupada?: boolean; children: ReactNode }): ReactElement {
  return (
    <section
      id={ID_DA_SECCAO}
      aria-labelledby={ID_DO_TITULO}
      aria-busy={ocupada === true ? "true" : undefined}
      className="pb-8"
    >
      <h2
        id={ID_DO_TITULO}
        className="mx-auto max-w-coluna px-4 pb-3 pt-8 font-titulo text-titulo text-texto"
      >
        {TEXTOS.titulo}
      </h2>
      {children}
    </section>
  );
}

const CARTAO = "superficie-painel rounded-cartao border border-fio-interno p-4";

/** O corpo da secção: uma só coluna a todas as larguras (3). */
function Coluna({ children }: { children: ReactNode }): ReactElement {
  return <div className="mx-auto flex max-w-coluna flex-col gap-4 px-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// A carregar
// ---------------------------------------------------------------------------

/*
 * As barras medem o que vai ocupar o lugar delas: a linha do momento tem a
 * letra de `text-seccao` (21 px), os dias e os valores a de `text-corpo` (17
 * px) e as etiquetas a de `text-nota`. Vêm dos tokens e não de pixeis, para
 * acompanharem o tamanho de letra do sistema. Sem animação (o movimento, neste
 * projeto, é só resposta a ações) e sem uma palavra: «A carregar…» é ruído, e
 * qualquer palavra nesta altura ainda podia ser «Fechado».
 */
const BARRA = "rounded-pequeno bg-fio-interno";

function Esqueleto(): ReactElement {
  return (
    <Seccao ocupada>
      <Coluna>
        <div aria-hidden="true" className={`${CARTAO} flex flex-col gap-3`}>
          <div className={`${BARRA} h-[var(--texto-seccao)] w-3/4`} />
          {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
            <div key={dia} className={`${BARRA} h-[var(--texto-corpo)] w-full`} />
          ))}
        </div>
        <div aria-hidden="true" className={`${CARTAO} flex flex-col gap-3`}>
          {[1, 2, 3].map((par) => (
            <div key={par} className="flex flex-col gap-1">
              <div className={`${BARRA} h-[var(--texto-nota)] w-1/4`} />
              <div className={`${BARRA} h-[var(--texto-corpo)] w-3/4`} />
            </div>
          ))}
        </div>
      </Coluna>
    </Seccao>
  );
}

// ---------------------------------------------------------------------------
// Falhou
// ---------------------------------------------------------------------------

function Falhou({
  estadoHttp,
  aoTentarOutraVez,
}: {
  estadoHttp: number | null;
  aoTentarOutraVez: () => Promise<void>;
}): ReactElement {
  const [aTentar, setATentar] = useState(false);

  /*
   * O botão fica montado durante a tentativa a dizer «A tentar…»: voltar ao
   * esqueleto fazia a secção piscar e o foco de quem acabou de carregar caía
   * para o `<body>`. E quando a tentativa dá certo o foco **não** se move: a
   * secção muda de forma por baixo do dedo, e quem a quer ler desliza.
   */
  return (
    <Seccao>
      <div className="px-4">
        <EstadoVazio
          tom="erro"
          titulo={TEXTOS.erroTitulo}
          // Sem resposta é a ligação da pessoa; com resposta o problema é nosso.
          linha={estadoHttp === null ? TEXTOS.erroSemResposta : TEXTOS.erroComResposta}
        >
          <Botao
            aTrabalhar={aTentar}
            textoATrabalhar={TEXTOS.aTentar}
            onClick={() => {
              setATentar(true);
              void aoTentarOutraVez()
                .catch(() => undefined)
                .finally(() => {
                  setATentar(false);
                });
            }}
          >
            {TEXTOS.tentarOutraVez}
          </Botao>
        </EstadoVazio>
      </div>
    </Seccao>
  );
}

// ---------------------------------------------------------------------------
// O horário
// ---------------------------------------------------------------------------

/**
 * O estado do momento, a recalcular-se sozinho (5.3), ou `null` se este
 * aparelho não souber que horas são em Lisboa.
 *
 * Um só `setTimeout`, nunca um `setInterval`: ao calcular o momento calcula-se
 * também **quando muda a seguir** (até uma hora, no máximo) e agenda-se aí.
 * Recalcula também ao voltar ao ecrã — um telemóvel bloqueado suspende os
 * temporizadores, e quem o desbloqueia às 02:10 não pode ver «Aberto até às
 * 02:00» — e limpa tudo ao desmontar.
 *
 * **Sem Lisboa não há momento**: nem linha, nem destaque, nem temporizador. Não
 * se adivinha o dia com o relógio do telemóvel.
 */
function useMomento(horario: NonNullable<Info["horario"]>): EstadoDoHorario | null {
  const periodos = useMemo(() => periodosDaSemana(horario), [horario]);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | undefined;

    function recalcular(): void {
      clearTimeout(temporizador);
      temporizador = undefined;

      const instante = new Date();
      setAgora(instante);
      try {
        temporizador = setTimeout(recalcular, esperaAteAProximaMudanca(periodos, instante));
      } catch {
        // Sem Lisboa: nada agendado (5.3, 5).
      }
    }

    function aoVoltarAoEcra(): void {
      if (document.visibilityState === "visible") recalcular();
    }

    try {
      temporizador = setTimeout(recalcular, esperaAteAProximaMudanca(periodos, new Date()));
    } catch {
      // Sem Lisboa: nada agendado (5.3, 5).
    }
    document.addEventListener("visibilitychange", aoVoltarAoEcra);
    window.addEventListener("pageshow", recalcular);

    return () => {
      clearTimeout(temporizador);
      document.removeEventListener("visibilitychange", aoVoltarAoEcra);
      window.removeEventListener("pageshow", recalcular);
    };
  }, [periodos]);

  return useMemo(() => {
    try {
      return estadoDoHorario(periodos, agora);
    } catch {
      return null;
    }
  }, [periodos, agora]);
}

function CartaoDoHorario({ horario }: { horario: NonNullable<Info["horario"]> }): ReactElement {
  const momento = useMomento(horario);

  return (
    <div className={CARTAO}>
      <h3 className="text-seccao font-forte text-texto">{TEXTOS.tituloDoHorario}</h3>

      {/*
       * Texto simples, **não é região viva**: muda no máximo duas vezes por dia
       * e anunciar sozinha incomodava quem está a ouvir outra coisa. Não
       * depende da cor: «Aberto» e «Fechado» são palavras.
       */}
      {momento !== null && (
        <p className="mt-2 text-seccao font-forte text-texto">{textoDaLinhaDoMomento(momento)}</p>
      )}

      <table className="mt-3 w-full text-corpo text-texto">
        <caption className="sr-only">{TEXTOS.legendaDaTabela}</caption>
        <tbody>
          {horario.map((dia, indice) => {
            // O dia cujo período decorre agora; sem Lisboa, nenhum.
            const destacado = momento !== null && momento.destaque === dia.dia;
            const peso = destacado ? "font-forte" : "font-normal";

            return (
              <tr
                key={dia.dia}
                aria-current={destacado ? "date" : undefined}
                className={indice === 0 ? undefined : "border-t border-fio-interno"}
              >
                <th
                  scope="row"
                  className={`py-2 pr-4 text-left align-top [overflow-wrap:anywhere] ${peso}`}
                >
                  {NOMES_DOS_DIAS[dia.dia]}
                </th>
                {/*
                 * Um período por linha de texto na mesma célula: nunca «17:00 às
                 * 02:00 e 12:00 às 15:00» numa linha só, que a 360 px com o
                 * texto aumentado quebrava a meio de um período.
                 */}
                <td
                  className={`py-2 text-right align-top tabular-nums [overflow-wrap:anywhere] ${peso}${
                    dia.periodos.length === 0 ? " text-texto-suave" : ""
                  }`}
                >
                  {dia.periodos.length === 0
                    ? TEXTOS.fechado
                    : dia.periodos.map((periodo) => (
                        <span key={`${periodo.abre}-${periodo.fecha}`} className="block">
                          {textoDoPeriodo(periodo)}
                        </span>
                      ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Morada e contactos
// ---------------------------------------------------------------------------

/*
 * A ligação com o aspeto do Botão secundário. O `Botao` é só `<button>`, e um
 * `<button>` dentro de um `<a>` é HTML inválido: as classes são as dele e os
 * valores são os mesmos papéis (`border-contorno`, `text-texto`), sem uma cor
 * copiada. Mesmo separador e sem `rel` (decisão do Tomás).
 */
const COMO_BOTAO_SECUNDARIO =
  "inline-flex min-h-toque min-w-toque items-center justify-center gap-2 rounded-pequeno " +
  "border border-contorno px-6 text-center font-corpo text-corpo font-forte text-texto " +
  "transition-transform duration-curta ease-curva active:translate-y-premido";

/** Ligação creme sublinhada, com 44 px de altura, e do tamanho da linha inteira. */
const LIGACAO_DE_TEXTO =
  "inline-flex min-h-toque items-center text-texto underline underline-offset-2 " +
  "[overflow-wrap:anywhere]";

function Par({ etiqueta, children }: { etiqueta: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <dt className="text-nota text-texto-suave">{etiqueta}</dt>
      {/* Sem `overflow-hidden`: as ligações têm de poder receber o anel de foco inteiro. */}
      <dd className="text-corpo text-texto">{children}</dd>
    </div>
  );
}

type Contactos = {
  morada: string | null;
  maps: string | null;
  telefone: string | null;
  instagram: { href: string; rotulo: string } | null;
};

function CartaoDosContactos({ morada, maps, telefone, instagram }: Contactos): ReactElement {
  const hrefDoTelefone = ligacaoDoTelefone(telefone);

  return (
    <div className={CARTAO}>
      <h3 className="text-seccao font-forte text-texto">{TEXTOS.tituloDosContactos}</h3>
      <dl className="mt-3 flex flex-col gap-4">
        {(morada !== null || maps !== null) && (
          // Sem morada mas com Maps o par chama-se «Localização» e só tem o botão.
          <Par etiqueta={morada !== null ? TEXTOS.etiquetaMorada : TEXTOS.etiquetaLocalizacao}>
            {morada !== null && (
              <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{morada}</span>
            )}
            {maps !== null && (
              <a
                href={maps}
                className={`${COMO_BOTAO_SECUNDARIO}${morada !== null ? " mt-3" : ""}`}
              >
                {TEXTOS.abrirNoMaps}
              </a>
            )}
          </Par>
        )}

        {telefone !== null && (
          <Par etiqueta={TEXTOS.etiquetaTelefone}>
            {/* É ligação só se for um número (6.3); o texto fica como o dono o escreveu. */}
            {hrefDoTelefone !== null ? (
              <a href={hrefDoTelefone} className={`${LIGACAO_DE_TEXTO} tabular-nums`}>
                {telefone}
              </a>
            ) : (
              <span className="tabular-nums">{telefone}</span>
            )}
          </Par>
        )}

        {instagram !== null && (
          <Par etiqueta={TEXTOS.etiquetaInstagram}>
            <a href={instagram.href} className={LIGACAO_DE_TEXTO}>
              {instagram.rotulo}
            </a>
          </Par>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A secção
// ---------------------------------------------------------------------------

function Pronta({ info }: { info: Info }): ReactElement | null {
  /*
   * Calcula-se **o que cada bloco consegue desenhar**, e não o que a resposta
   * traz (4.4): um valor que não passa na validação do bloco conta como
   * vazio, e não se mostra «ligação inválida».
   */
  const horario = info.horario ?? null;
  const contactos: Contactos = {
    morada: comTexto(info.morada),
    maps: ligacaoDoMaps(info.maps_url ?? null),
    telefone: comTexto(info.telefone),
    instagram: ligacaoDoInstagram(info.instagram ?? null),
  };
  const temContactos = Object.values(contactos).some((valor) => valor !== null);

  // Nenhum bloco: a secção não está no DOM, nem o `<h2>`, nem o espaço.
  if (horario === null && !temContactos) return null;

  return (
    <Seccao>
      <Coluna>
        {horario !== null && <CartaoDoHorario horario={horario} />}
        {temContactos && <CartaoDosContactos {...contactos} />}
      </Coluna>
    </Seccao>
  );
}

export function VisitaNos({
  info,
  aoTentarOutraVez,
}: PropriedadesDoVisitaNos): ReactElement | null {
  if (info.estado === "a-carregar") return <Esqueleto />;
  if (info.estado === "falhou") {
    return <Falhou estadoHttp={info.estadoHttp} aoTentarOutraVez={aoTentarOutraVez} />;
  }
  return <Pronta info={info.info} />;
}
