import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../../lib/api/cliente";
import {
  eliminarFoto,
  enderecoDaMiniatura,
  obterAprovadas,
  type FotoAprovada,
} from "../../../lib/api/gestao-fotos";
import { armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { FolhaEliminarFoto } from "./FolhaEliminarFoto";
import { quandoFoiEnviada } from "./quando-foi-enviada";
import { TEXTOS_APROVADAS as T, nomeDoBotaoEliminar, quandoFoiAprovada } from "./textos";

/**
 * A secção «Fotos no site» do destino «Galeria» (F4-04b, `docs/ecras/F4-04b.md`): as fotos
 * aprovadas, a última aprovada primeiro, e «Eliminar» com a folha «Tem a certeza?». É **irmã** da
 * fila de moderação: o estado dela (a carregar, vazia, erro) é independente.
 *
 * Regras que atravessam a secção:
 *  - **Uma lista vazia só vem de um `200` com a lista vazia.** Rede, 5xx, corpo ilegível ou uma
 *    data que não se sabe ler são o erro de carregar (regra 10), nunca «não há fotos». Uma leitura
 *    silenciosa que falha **mantém** a lista que já se sabe, com uma linha a avisar.
 *  - **Nada é otimista**: a foto só sai depois do `204`. **Um `DELETE` sem resposta é «não sei»:**
 *    nunca se repete por conta própria (nem pelo «Verificar outra vez», que repete só o `GET`); a
 *    lista diz o que aconteceu.
 *  - Mostram-se 8 de cada vez (`LIMITE`); o limite é um número, não uma lista cortada.
 *  - A miniatura que não carrega **não decide nem verifica nada** e **não bloqueia o «Eliminar»**:
 *    eliminar é precisamente o que se faz a uma linha cujo ficheiro desapareceu.
 *  - A leitura aborta ao desmontar; o `DELETE` não (um pedido a meio chega ao fim).
 */

/** Quantas fotos se mostram de cada vez (o número é do ecrã, não do contrato). */
const LIMITE = 8;
const DURACAO_DO_AVISO_MS = 3_000;

export type AvisoDaPagina = { tipo: "sucesso" | "erro"; mensagem: string; duracaoMs?: number };

type Estado =
  | { estado: "a-carregar" }
  | { estado: "pronta"; fotos: FotoAprovada[] }
  | { estado: "vazia" }
  | { estado: "erro"; semResposta: boolean };

/** A linha de estado da secção: informação (nunca a `mensagem` do backend), com ação opcional. */
type Linha = { texto: string; acao: "tentar" | null };

type Leitura =
  | { tipo: "ok"; fotos: FotoAprovada[] }
  | { tipo: "cancelada" }
  | { tipo: "sessao" }
  | { tipo: "erro"; semResposta: boolean };

/** `inicial` mostra o erro; `silencioso` nunca tira a lista que já se sabe. */
type Modo = "inicial" | "silencioso";

/** Depois de um `DELETE` sem resposta: a verificar, ou sem conseguir confirmar. */
type Verificacao = { foto: FotoAprovada; fase: "a-verificar" | "sem-confirmar" };

/**
 * `moderada_em` decrescente, desempate por `id` decrescente (feito aqui: não se depende da ordem
 * do servidor). Uma foto sem data de aprovação (`null`) vai para o fim, também por `id`.
 */
function ordenar(fotos: readonly FotoAprovada[]): FotoAprovada[] {
  const instante = (f: FotoAprovada): number =>
    f.moderada_em === null ? Number.NEGATIVE_INFINITY : new Date(f.moderada_em).getTime();
  return [...fotos].sort((a, b) => {
    const ta = instante(a);
    const tb = instante(b);
    if (ta !== tb) return ta < tb ? 1 : -1;
    return b.id - a.id;
  });
}

function temTexto(texto: string | null): texto is string {
  return texto !== null && texto.trim() !== "";
}

export function FotosAprovadas({
  sinalDeReleitura,
  aoAviso,
}: {
  /** Muda (sobe) quando se aprova uma foto na fila: a secção relê em silêncio. */
  sinalDeReleitura: number;
  /** O aviso único da página é da página. `null` tira o que lá estiver. */
  aoAviso: (aviso: AvisoDaPagina | null) => void;
}): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const idDoTitulo = useId();
  const idDoErro = useId();

  const [estado, setEstado] = useState<Estado>({ estado: "a-carregar" });
  const [limite, setLimite] = useState(LIMITE);
  const [linha, setLinha] = useState<Linha | null>(null);
  const [aTentar, setATentar] = useState(false);
  const [agora, setAgora] = useState(() => new Date());
  const [semImagem, setSemImagem] = useState<ReadonlySet<number>>(new Set());
  // A foto da folha fica **guardada** (não se procura na lista): uma leitura que chega com a folha
  // aberta não a fecha nem a muda.
  const [daFolha, setDaFolha] = useState<FotoAprovada | null>(null);
  const [aEliminar, setAEliminar] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [verificacao, setVerificacao] = useState<Verificacao | null>(null);
  // Um objeto novo a cada pedido de foco: o mesmo alvo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<
    { alvo: "titulo" | "vazio" } | { alvo: "eliminar"; id: number } | null
  >(null);

  const titulo = useRef<HTMLHeadingElement>(null);
  const vazio = useRef<HTMLDivElement>(null);
  /** O contentor do «Eliminar» de cada item, para lhe devolver o foco ao fechar a folha sem eliminar. */
  const contentoresDoEliminar = useRef(new Map<number, HTMLElement>());

  /** A lista **de agora** (`null` = nunca carregou ou a recarregar), para quem corre depois de um `await`. */
  const fotosAgora = useRef<FotoAprovada[] | null>(null);
  const aoPerderSessaoAgora = useRef(aoPerderSessao);
  const aoAvisoAgora = useRef(aoAviso);
  const leituras = useRef(new Set<AbortController>());
  const vivo = useRef(true);
  const pedindo = useRef(false);
  const verificando = useRef(false);
  const aTentarAgora = useRef(false);
  const sinalAnterior = useRef(sinalDeReleitura);

  useEffect(() => {
    aoPerderSessaoAgora.current = aoPerderSessao;
    aoAvisoAgora.current = aoAviso;
  });

  // --- Ler a lista ------------------------------------------------------------

  /** `GET /gestao/fotos/aprovadas`, com prazo e cancelável. Nunca lança: devolve o que aconteceu. */
  async function ler(): Promise<Leitura> {
    const controlador = new AbortController();
    leituras.current.add(controlador);
    const desarmar = armarPrazo(controlador);
    try {
      const resposta = await obterAprovadas({ sinal: controlador.signal });
      const fotos: unknown = resposta.fotos;
      if (!Array.isArray(fotos)) return { tipo: "erro", semResposta: false };
      // Uma data que o ecrã não saiba escrever (ilegível, ou um aparelho sem Lisboa) é erro de
      // carregar: nunca uma lista vazia nem um ecrã a rebentar.
      const hoje = new Date();
      for (const foto of fotos as FotoAprovada[]) {
        if (foto.moderada_em !== null) quandoFoiEnviada(foto.moderada_em, hoje);
        quandoFoiEnviada(foto.criada_em, hoje);
      }
      return { tipo: "ok", fotos: ordenar(fotos as FotoAprovada[]) };
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

  /** Põe a lista à vista. Vazia **só** aqui, e só porque veio de um `200`. */
  function definirLista(fotos: FotoAprovada[]): void {
    fotosAgora.current = fotos;
    setEstado(fotos.length > 0 ? { estado: "pronta", fotos } : { estado: "vazia" });
  }

  /**
   * Aplica uma leitura. Devolve `true` se a lista ficou à vista (um `200`). `linhaOk` é a linha de
   * estado que vale depois de uma leitura bem sucedida (por omissão nenhuma).
   */
  function aplicar(leitura: Leitura, modo: Modo, linhaOk: Linha | null = null): boolean {
    if (!vivo.current || leitura.tipo === "cancelada") return false;
    if (leitura.tipo === "sessao") {
      aoPerderSessaoAgora.current();
      return false;
    }
    if (leitura.tipo === "erro") {
      const haLista = fotosAgora.current !== null && fotosAgora.current.length > 0;
      if (modo === "silencioso" && haLista) {
        // Não se apaga o que se sabe: a lista fica, e diz que pode estar desatualizada.
        setLinha({ texto: T.desatualizada, acao: "tentar" });
      } else {
        fotosAgora.current = null;
        setEstado({ estado: "erro", semResposta: leitura.semResposta });
      }
      return false;
    }
    definirLista(leitura.fotos);
    setLinha(linhaOk);
    return true;
  }

  function reler(): void {
    void ler().then((leitura) => {
      aplicar(leitura, "silencioso");
    });
  }

  useEffect(() => {
    vivo.current = true;
    void ler().then((leitura) => {
      aplicar(leitura, "inicial");
    });

    const aoVoltar = (): void => {
      if (document.visibilityState !== "visible") return;
      setAgora(new Date());
      if (pedindo.current || verificando.current) return;
      reler();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    const aMeter = leituras.current;
    return () => {
      vivo.current = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      aMeter.forEach((controlador) => {
        controlador.abort();
      });
    };
    // Corre uma vez: `ler`, `aplicar` e `reler` só leem referências e setters estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aprovar uma foto na fila: a aprovada aparece no topo (releitura em silêncio).
  useEffect(() => {
    if (sinalAnterior.current === sinalDeReleitura) return;
    sinalAnterior.current = sinalDeReleitura;
    reler();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinalDeReleitura]);

  function tentarOutraVez(): void {
    if (aTentarAgora.current) return;
    aTentarAgora.current = true;
    setATentar(true);
    const modo: Modo = (fotosAgora.current?.length ?? 0) > 0 ? "silencioso" : "inicial";
    void ler().then((leitura) => {
      aTentarAgora.current = false;
      setATentar(false);
      aplicar(leitura, modo);
    });
  }

  // --- O foco -----------------------------------------------------------------

  function pedirFoco(alvo: "titulo" | "vazio"): void {
    setFoco({ alvo });
  }
  function focoDoQueHouver(): void {
    pedirFoco((fotosAgora.current?.length ?? 0) > 0 ? "titulo" : "vazio");
  }

  // Só depois de o React ter assentado; nunca dentro de uma promessa. Depois de eliminar o foco
  // vai ao título da secção (ou ao do estado vazio), **nunca** ao «Eliminar» do item seguinte: um
  // botão destrutivo vizinho, ao alcance de um toque seguido. Ao fechar a folha **sem** eliminar
  // volta ao «Eliminar» desse item (o `<dialog>` já o faz; aqui fica explícito, para não depender
  // do browser — o Safari não foca um botão ao tocar nele).
  useEffect(() => {
    if (foco === null) return;
    if (foco.alvo === "eliminar") {
      contentoresDoEliminar.current.get(foco.id)?.querySelector("button")?.focus();
      return;
    }
    (foco.alvo === "vazio" ? vazio.current : titulo.current)?.focus();
  }, [foco]);

  // --- Eliminar ---------------------------------------------------------------

  /**
   * A foto saiu da lista (204 ou 404): mostra-se o que resta. Se não resta nenhuma, faz-se **um
   * `GET`** antes de dizer «vazio» (entretanto o esqueleto); se esse `GET` falhar é o erro de
   * carregar e a foto eliminada não volta.
   */
  function depoisDeSair(id: number, linhaFinal: Linha | null): void {
    const resto = (fotosAgora.current ?? []).filter((f) => f.id !== id);
    if (resto.length > 0) {
      fotosAgora.current = resto;
      setEstado({ estado: "pronta", fotos: resto });
      setLinha(linhaFinal);
      pedirFoco("titulo");
      return;
    }
    fotosAgora.current = null;
    setLinha(linhaFinal);
    setEstado({ estado: "a-carregar" });
    void ler().then((leitura) => {
      if (aplicar(leitura, "inicial", linhaFinal)) focoDoQueHouver();
    });
  }

  async function eliminar(alvo: FotoAprovada): Promise<void> {
    if (pedindo.current) return;
    pedindo.current = true;
    setAEliminar(true);
    setFalhou(false);
    setLinha(null);
    aoAvisoAgora.current(null);

    // O prazo, mas sem ligar ao desmontar: o pedido de eliminar não aborta ao sair do ecrã.
    const controlador = new AbortController();
    const desarmar = armarPrazo(controlador);
    try {
      await eliminarFoto(alvo.id, { sinal: controlador.signal });
    } catch (erro) {
      desarmar();
      pedindo.current = false;
      if (!vivo.current) return;
      setAEliminar(false);
      await aoFalhar(alvo, erro);
      return;
    }
    desarmar();
    pedindo.current = false;
    if (!vivo.current) return;

    setAEliminar(false);
    setDaFolha(null);
    aoAvisoAgora.current({
      tipo: "sucesso",
      mensagem: T.avisoEliminada,
      duracaoMs: DURACAO_DO_AVISO_MS,
    });
    depoisDeSair(alvo.id, null);
  }

  async function aoFalhar(alvo: FotoAprovada, erro: unknown): Promise<void> {
    if (erro instanceof ErroDaApi && erro.estado === 401) {
      // Nunca se repete: o dono vê a lista como o servidor a tem, depois de entrar outra vez.
      setDaFolha(null);
      aoPerderSessaoAgora.current();
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === 404) {
      // Já não existe: sai da lista. É informação, não erro.
      setDaFolha(null);
      depoisDeSair(alvo.id, { texto: T.jaNaoExistia, acao: null });
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === 409) {
      // Já não está aprovada (outro aparelho): relê em silêncio e a foto sai porque o `GET` já não
      // a devolve. Se o `GET` falhar, vale a leitura silenciosa que falha.
      setDaFolha(null);
      setLinha({ texto: T.jaNaoEstaNoSite, acao: null });
      pedirFoco("titulo");
      const leitura = await ler();
      if (aplicar(leitura, "silencioso", { texto: T.jaNaoEstaNoSite, acao: null }))
        focoDoQueHouver();
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === null) {
      // Sem resposta: não se sabe. A folha fecha e o ecrã vai ver (nunca repete o `DELETE`).
      setDaFolha(null);
      await verificar(alvo);
      return;
    }
    // 500, 403, outro: a foto fica, a folha mantém-se com o erro dentro. Tocar outra vez é seguro.
    setFalhou(true);
  }

  /**
   * «Não sei se foi eliminada»: o `GET` da lista diz. A foto já não está: foi eliminada. Continua:
   * nada aconteceu (ou o pedido ainda não chegou; tocar de novo é seguro, o segundo dá 404). O
   * `GET` falha: continua sem saber, e o «Verificar outra vez» repete **isto**, nunca o `DELETE`.
   */
  async function verificar(alvo: FotoAprovada): Promise<void> {
    if (verificando.current) return;
    verificando.current = true;
    setLinha(null);
    setVerificacao({ foto: alvo, fase: "a-verificar" });
    const leitura = await ler();
    verificando.current = false;
    if (!vivo.current || leitura.tipo === "cancelada") return;
    if (leitura.tipo === "sessao") {
      setVerificacao(null);
      aoPerderSessaoAgora.current();
      return;
    }
    if (leitura.tipo === "erro") {
      setVerificacao({ foto: alvo, fase: "sem-confirmar" });
      return;
    }

    setVerificacao(null);
    definirLista(leitura.fotos);
    if (leitura.fotos.some((f) => f.id === alvo.id)) {
      setLinha({ texto: T.continuaSemResposta, acao: null });
      return;
    }
    aoAvisoAgora.current({
      tipo: "sucesso",
      mensagem: T.avisoEliminada,
      duracaoMs: DURACAO_DO_AVISO_MS,
    });
    focoDoQueHouver();
  }

  // --- Desenho ----------------------------------------------------------------

  const fotos = estado.estado === "pronta" ? estado.fotos : [];
  const tituloDaSecao = estado.estado === "pronta" ? T.tituloN(fotos.length) : T.titulo;

  let linhaVisivel: Linha | null = linha;
  if (verificacao?.fase === "a-verificar") linhaVisivel = { texto: T.aVerificar, acao: null };
  else if (verificacao?.fase === "sem-confirmar") {
    linhaVisivel = { texto: T.semConfirmar, acao: null };
  }

  let corpo: ReactElement;
  if (estado.estado === "a-carregar") {
    // O esqueleto não tem texto: três linhas de miniatura e duas barras ao lado (spec 3.1).
    corpo = (
      <div aria-busy="true" className="flex flex-col">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 py-4">
            <div className="self-start aspect-foto w-miniatura shrink-0 rounded-pequeno bg-fio-interno lg:w-miniatura-grande" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <div className="h-4 w-3/4 rounded-pequeno bg-fio-interno" />
              <div className="h-4 w-1/2 rounded-pequeno bg-fio-interno" />
            </div>
          </div>
        ))}
      </div>
    );
  } else if (estado.estado === "erro") {
    corpo = (
      <div id={idDoErro}>
        <EstadoVazio
          tom="erro"
          titulo={T.carregarTitulo}
          linha={estado.semResposta ? T.carregarSemResposta : T.carregarServidor}
        >
          <Botao
            descritoPor={idDoErro}
            aTrabalhar={aTentar}
            textoATrabalhar={T.aTentar}
            onClick={tentarOutraVez}
          >
            {T.tentarOutraVez}
          </Botao>
        </EstadoVazio>
      </div>
    );
  } else if (estado.estado === "vazia") {
    corpo = (
      <div ref={vazio} tabIndex={-1}>
        <EstadoVazio titulo={T.vazioTitulo} linha={T.vazioLinha} />
      </div>
    );
  } else {
    const visiveis = fotos.slice(0, limite);
    corpo = (
      <>
        <ul>
          {visiveis.map((foto) => {
            const quando = quandoFoiAprovada(foto, agora);
            const inerte = verificacao?.foto.id === foto.id;
            return (
              <li
                key={foto.id}
                className="flex gap-3 border-b border-fio-interno py-4 last:border-b-0"
              >
                {semImagem.has(foto.id) ? (
                  <div className="flex self-start aspect-foto w-miniatura shrink-0 items-center justify-center rounded-pequeno border border-fio-interno bg-fundo text-center text-nota text-texto-suave lg:w-miniatura-grande">
                    {T.semImagem}
                  </div>
                ) : (
                  <img
                    src={enderecoDaMiniatura(foto.ficheiro)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="self-start aspect-foto w-miniatura shrink-0 rounded-pequeno border border-fio-interno bg-fundo object-cover lg:w-miniatura-grande"
                    onError={() => {
                      // Não decide nem verifica nada: só troca a imagem partida por um texto.
                      setSemImagem((antes) => new Set(antes).add(foto.id));
                    }}
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-corpo text-texto">{T.aprovadaEm(quando)}</p>
                  {temTexto(foto.enviada_por) && (
                    <p className="break-words text-nota text-texto-suave">
                      {T.enviadaPor(foto.enviada_por)}
                    </p>
                  )}
                  {temTexto(foto.descricao) && (
                    <p className="line-clamp-2 break-words text-nota text-texto">
                      {foto.descricao}
                    </p>
                  )}
                  <div
                    className="mt-2 self-start"
                    ref={(no) => {
                      if (no === null) contentoresDoEliminar.current.delete(foto.id);
                      else contentoresDoEliminar.current.set(foto.id, no);
                    }}
                  >
                    <Botao
                      rotulo={nomeDoBotaoEliminar(foto, agora)}
                      desativado={inerte}
                      onClick={() => {
                        setFalhou(false);
                        setDaFolha(foto);
                      }}
                    >
                      {T.eliminar}
                    </Botao>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {fotos.length > visiveis.length && (
          <>
            <p aria-live="polite" className="text-nota text-texto-suave">
              {T.aMostrar(visiveis.length, fotos.length)}
            </p>
            <div className="self-start">
              <Botao
                onClick={() => {
                  setLimite((antes) => antes + LIMITE);
                }}
              >
                {T.mostrarMais}
              </Botao>
            </div>
          </>
        )}
      </>
    );
  }

  const linhaADesenhar =
    estado.estado === "pronta" || estado.estado === "vazia" ? linhaVisivel : null;

  return (
    <>
      <section
        aria-labelledby={idDoTitulo}
        className="mt-4 flex flex-col gap-3 border-t border-fio-interno pt-6"
      >
        <h2
          id={idDoTitulo}
          ref={titulo}
          tabIndex={-1}
          className="text-seccao font-forte text-texto"
        >
          {tituloDaSecao}
        </h2>
        {linhaADesenhar !== null && (
          <>
            <p role="status" className="text-nota text-texto">
              {linhaADesenhar.texto}
            </p>
            {linhaADesenhar.acao === "tentar" && (
              <div className="self-start">
                <Botao aTrabalhar={aTentar} textoATrabalhar={T.aTentar} onClick={tentarOutraVez}>
                  {T.tentarOutraVez}
                </Botao>
              </div>
            )}
            {verificacao?.fase === "sem-confirmar" && (
              <div className="self-start">
                <Botao
                  onClick={() => {
                    void verificar(verificacao.foto);
                  }}
                >
                  {T.verificarOutraVez}
                </Botao>
              </div>
            )}
          </>
        )}
        {corpo}
      </section>

      <FolhaEliminarFoto
        foto={daFolha}
        agora={agora}
        aEliminar={aEliminar}
        falhou={falhou}
        aoConfirmar={() => {
          if (daFolha !== null) void eliminar(daFolha);
        }}
        aoFechar={() => {
          setFalhou(false);
          if (daFolha !== null) setFoco({ alvo: "eliminar", id: daFolha.id });
          setDaFolha(null);
        }}
      />
    </>
  );
}
