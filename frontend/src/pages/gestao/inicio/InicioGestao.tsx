import type { MouseEvent, ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../../lib/api/cliente";
import { obterResumo, type Resumo } from "../../../lib/api/gestao-resumo";
import { formatarDataNaGestao } from "../eventos/data-na-gestao";
import { eCliqueSimples, navegar } from "../navegacao";
import { armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { TEXTOS as T, fraseDasFotos, fraseDosRegistos } from "./textos";

/**
 * O destino «Início» da gestão (F4-05b, `docs/ecras/F4-05b.md`, secção 4): o resumo em três
 * blocos — fotos à espera (a única tarefa que pode ficar à espera de alguém, e o único dourado),
 * próximos eventos e novos registos.
 *
 * Regras que atravessam o ecrã:
 *  - **`pronto` só vem de um `200` válido.** Rede, 5xx, corpo ilegível ou uma data que o ecrã não
 *    sabe escrever são o erro de carregar (regra 10), nunca «zero» nem «não há nada». Uma releitura
 *    silenciosa que falha **mantém** o resumo que já se tem, com uma linha a avisar.
 *  - **Cada visita é uma leitura nova**: nada se guarda entre visitas (o resumo vive só no estado
 *    do componente). Há um `GET` ao montar e outro a cada volta à aba; nunca polling.
 *  - O `401` leva ao login pela via da guarda; a leitura aborta ao desmontar.
 */

/** O aspeto do `Botao` principal numa ligação (o `Botao` é um `<button>`; isto leva a outra página). */
const CLASSE_DO_BOTAO_PRINCIPAL =
  "inline-flex items-center justify-center gap-2 min-h-toque min-w-toque px-6 rounded-pequeno " +
  "font-corpo font-forte text-corpo text-center bg-acao text-sobre-acao " +
  "transition-transform duration-curta ease-curva active:translate-y-premido";

const CLASSE_DA_LIGACAO_DE_TEXTO =
  "inline-flex min-h-toque items-center text-corpo text-texto underline";

type Pronto = { resumo: Resumo; datas: string[] };

type Estado =
  | { estado: "a-carregar" }
  | ({ estado: "pronto" } & Pronto)
  | { estado: "erro"; semResposta: boolean };

type Leitura =
  | ({ tipo: "ok" } & Pronto)
  | { tipo: "cancelada" }
  | { tipo: "sessao" }
  | { tipo: "erro"; semResposta: boolean };

function Titulo(): ReactElement {
  return (
    <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
      {T.titulo}
    </h1>
  );
}

function Ligacao({
  caminho,
  className,
  children,
}: {
  caminho: string;
  className: string;
  children: string;
}): ReactElement {
  return (
    <a
      href={caminho}
      className={className}
      onClick={(evento: MouseEvent<HTMLAnchorElement>) => {
        if (!eCliqueSimples(evento)) return;
        evento.preventDefault();
        navegar(caminho);
      }}
    >
      {children}
    </a>
  );
}

/** O esqueleto: sem texto, uma barra por título e uma por corpo (spec 4.4). */
function Esqueleto(): ReactElement {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-busy="true"
          className={
            i === 0
              ? "flex flex-col gap-3"
              : "mt-6 flex flex-col gap-3 border-t border-fio-interno pt-6"
          }
        >
          <div className="h-4 w-1/2 rounded-pequeno bg-fio-interno" />
          <div className="h-4 w-3/4 rounded-pequeno bg-fio-interno" />
        </div>
      ))}
    </>
  );
}

export function InicioGestao(): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const idFotos = useId();
  const idEventos = useId();
  const idRegistos = useId();

  const [estado, setEstado] = useState<Estado>({ estado: "a-carregar" });
  const [desatualizado, setDesatualizado] = useState(false);
  const [aTentar, setATentar] = useState(false);

  /** O que se tem **de agora**, para quem corre depois de um `await`. */
  const haResumo = useRef(false);
  const aoPerderSessaoAgora = useRef(aoPerderSessao);
  const leituras = useRef(new Set<AbortController>());
  const vivo = useRef(true);
  const aLer = useRef(false);
  const aTentarAgora = useRef(false);

  useEffect(() => {
    aoPerderSessaoAgora.current = aoPerderSessao;
  });

  /** `GET /gestao/resumo`, com prazo e cancelável. Nunca lança: devolve o que aconteceu. */
  async function ler(): Promise<Leitura> {
    const controlador = new AbortController();
    leituras.current.add(controlador);
    const desarmar = armarPrazo(controlador);
    try {
      const resumo = await obterResumo({ sinal: controlador.signal });
      // Uma data que o ecrã não saiba escrever (um aparelho sem Lisboa) é erro de carregar.
      const agora = new Date();
      const datas = resumo.proximos_eventos.map((evento) =>
        formatarDataNaGestao(evento.inicio, agora),
      );
      return { tipo: "ok", resumo, datas };
    } catch (erro) {
      // Desmontou a meio (ou o `StrictMode`): não é uma falha.
      if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return { tipo: "cancelada" };
      if (erro instanceof ErroDaApi && erro.estado === 401) return { tipo: "sessao" };
      return { tipo: "erro", semResposta: erro instanceof ErroDaApi && erro.estado === null };
    } finally {
      desarmar();
      leituras.current.delete(controlador);
    }
  }

  /** `silencioso` nunca tira o resumo que já se tem. */
  function aplicar(leitura: Leitura, silencioso: boolean): void {
    if (!vivo.current || leitura.tipo === "cancelada") return;
    if (leitura.tipo === "sessao") {
      aoPerderSessaoAgora.current();
      return;
    }
    if (leitura.tipo === "erro") {
      if (silencioso && haResumo.current) {
        setDesatualizado(true);
      } else {
        haResumo.current = false;
        setDesatualizado(false);
        setEstado({ estado: "erro", semResposta: leitura.semResposta });
      }
      return;
    }
    haResumo.current = true;
    setDesatualizado(false);
    setEstado({ estado: "pronto", resumo: leitura.resumo, datas: leitura.datas });
  }

  function reler(): void {
    if (aLer.current) return;
    aLer.current = true;
    void ler().then((leitura) => {
      aLer.current = false;
      aplicar(leitura, true);
    });
  }

  useEffect(() => {
    vivo.current = true;
    aLer.current = true;
    void ler().then((leitura) => {
      aLer.current = false;
      aplicar(leitura, false);
    });

    const aoVoltar = (): void => {
      if (document.visibilityState !== "visible") return;
      reler();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    const aMeter = leituras.current;
    return () => {
      vivo.current = false;
      aLer.current = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      aMeter.forEach((controlador) => {
        controlador.abort();
      });
    };
    // Corre uma vez: `ler`, `aplicar` e `reler` só leem referências e setters estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tentarOutraVez(): void {
    if (aTentarAgora.current) return;
    aTentarAgora.current = true;
    setATentar(true);
    const silencioso = haResumo.current;
    void ler().then((leitura) => {
      aTentarAgora.current = false;
      setATentar(false);
      aplicar(leitura, silencioso);
    });
  }

  if (estado.estado === "a-carregar") {
    return (
      <>
        <Titulo />
        <Esqueleto />
      </>
    );
  }

  if (estado.estado === "erro") {
    return (
      <>
        <Titulo />
        <EstadoVazio
          tom="erro"
          titulo={T.erroTitulo}
          linha={estado.semResposta ? T.erroSemResposta : T.erroServidor}
        >
          <Botao aTrabalhar={aTentar} textoATrabalhar={T.aTentar} onClick={tentarOutraVez}>
            {T.tentarOutraVez}
          </Botao>
        </EstadoVazio>
      </>
    );
  }

  const { resumo, datas } = estado;
  return (
    <>
      <Titulo />
      {desatualizado && (
        <div className="mb-4 flex flex-col items-start gap-3">
          <p role="status" className="text-nota text-texto">
            {T.desatualizado}
          </p>
          <Botao aTrabalhar={aTentar} textoATrabalhar={T.aTentar} onClick={tentarOutraVez}>
            {T.tentarOutraVez}
          </Botao>
        </div>
      )}

      <section aria-labelledby={idFotos} className="flex flex-col items-start gap-3">
        <h2 id={idFotos} className="font-titulo text-seccao text-texto">
          {T.fotosTitulo}
        </h2>
        <p className="text-corpo text-texto">{fraseDasFotos(resumo.fotos_pendentes)}</p>
        {resumo.fotos_pendentes > 0 && (
          <Ligacao caminho="/gestao/galeria" className={CLASSE_DO_BOTAO_PRINCIPAL}>
            {T.irParaAFila}
          </Ligacao>
        )}
      </section>

      <section
        aria-labelledby={idEventos}
        className="mt-6 flex flex-col items-start gap-3 border-t border-fio-interno pt-6"
      >
        <h2 id={idEventos} className="font-titulo text-seccao text-texto">
          {T.eventosTitulo}
        </h2>
        {resumo.proximos_eventos.length === 0 ? (
          <p className="text-corpo text-texto">{T.eventosVazio}</p>
        ) : (
          <ul className="w-full">
            {resumo.proximos_eventos.map((evento, i) => (
              <li key={evento.id} className="py-2">
                <p className="line-clamp-2 break-words text-corpo font-forte text-texto">
                  {evento.titulo}
                </p>
                <p className="text-nota text-texto-suave">{datas[i]}</p>
              </li>
            ))}
          </ul>
        )}
        <Ligacao caminho="/gestao/eventos" className={CLASSE_DA_LIGACAO_DE_TEXTO}>
          {T.verOsEventos}
        </Ligacao>
      </section>

      <section
        aria-labelledby={idRegistos}
        className="mt-6 flex flex-col items-start gap-3 border-t border-fio-interno pt-6"
      >
        <h2 id={idRegistos} className="font-titulo text-seccao text-texto">
          {T.registosTitulo}
        </h2>
        <p className="text-corpo text-texto">{fraseDosRegistos(resumo.novos_registos)}</p>
        <Ligacao caminho="/gestao/mais/clientes" className={CLASSE_DA_LIGACAO_DE_TEXTO}>
          {T.verOsClientes}
        </Ligacao>
      </section>
    </>
  );
}
