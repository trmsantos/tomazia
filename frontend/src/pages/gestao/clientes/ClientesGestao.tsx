import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { AvisoTemporario } from "../../../components/ui/AvisoTemporario";
import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../../lib/api/cliente";
import {
  descarregarClientesCsv,
  eliminarCliente,
  obterClientes,
  type ClienteGestao,
} from "../../../lib/api/gestao-clientes";
import { eCliqueSimples, navegar } from "../navegacao";
import { PRAZO_DO_FICHEIRO_MS, armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { FolhaEliminarCliente } from "./FolhaEliminarCliente";
import { LinhaDoCliente } from "./LinhaDoCliente";
import { TEXTOS as T, dataDoConsentimento } from "./textos";

/**
 * «Mais › Clientes» (F4-05b, `docs/ecras/F4-05b.md`, secções 5 a 7): a lista de clientes, o
 * «Exportar CSV» e «Eliminar» com a folha «Tem a certeza?».
 *
 * Regras que atravessam o ecrã:
 *  - **Uma lista vazia só vem de um `200` com a lista vazia.** Rede, 5xx, corpo ilegível ou uma
 *    data que o ecrã não sabe escrever são o erro de carregar (regra 10), nunca «não há clientes».
 *    Uma leitura silenciosa que falha **mantém** a lista que já se tem, com uma linha a avisar.
 *  - **Nada é otimista**: o cliente só sai depois do `204` (ou de um `404` com o código
 *    `cliente_inexistente`). Um `DELETE` sem resposta é «não sei»: nunca se repete por conta
 *    própria (nem pelo «Verificar outra vez», que repete só o `GET`); a lista diz o que aconteceu.
 *  - **A lista nunca sai da memória do componente** (nem `localStorage`, nem cache): sai ao sair
 *    do ecrã. Nada de dados pessoais em atributos, títulos ou endereços.
 *  - Mostram-se 20 de cada vez (`LIMITE`); o limite é um número, não uma lista cortada.
 *  - O foco depois de eliminar vai ao `<h2>` (nunca ao «Eliminar» do item seguinte); ao fechar a
 *    folha sem eliminar volta ao «Eliminar» desse item, guardado por `id` (não por `activeElement`).
 */

/** Quantos clientes se mostram de cada vez (o número é do ecrã, não do contrato). */
const LIMITE = 20;
const DURACAO_DO_AVISO_ELIMINADO_MS = 3_000;
const DURACAO_DO_AVISO_CSV_MS = 5_000;

type Estado =
  | { estado: "a-carregar" }
  | { estado: "pronta"; clientes: ClienteGestao[] }
  | { estado: "vazia" }
  | { estado: "erro"; semResposta: boolean };

/** A linha de estado: informação ou erro (nunca a `mensagem` do backend), com ação opcional. */
type Linha = { texto: string; tom: "info" | "erro"; acao: "tentar" | null };

type Aviso = { mensagem: string; duracaoMs: number };

type Leitura =
  | { tipo: "ok"; clientes: ClienteGestao[] }
  | { tipo: "cancelada" }
  | { tipo: "sessao" }
  | { tipo: "erro"; semResposta: boolean };

/** `inicial` mostra o erro; `silencioso` nunca tira a lista que já se tem. */
type Modo = "inicial" | "silencioso";

/** Depois de um `DELETE` sem resposta: a verificar, ou sem conseguir confirmar. */
type Verificacao = { cliente: ClienteGestao; fase: "a-verificar" | "sem-confirmar" };

type PedidoDeFoco = { alvo: "titulo" | "estado" } | { alvo: "eliminar"; id: number };

function Titulo(): ReactElement {
  return (
    <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
      {T.titulo}
    </h1>
  );
}

/** Descarrega o ficheiro com um `<a download>` no DOM só o tempo do clique (o Safari exige-o). */
function descarregar(href: string, nome: string): void {
  const ligacao = document.createElement("a");
  ligacao.href = href;
  ligacao.download = nome;
  ligacao.hidden = true;
  document.body.appendChild(ligacao);
  try {
    ligacao.click();
  } finally {
    ligacao.remove();
  }
}

export function ClientesGestao(): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const idDoTitulo = useId();
  const idDaAjuda = useId();
  const idDoAvisoDoCsv = useId();

  const [estado, setEstado] = useState<Estado>({ estado: "a-carregar" });
  const [limite, setLimite] = useState(LIMITE);
  const [linha, setLinha] = useState<Linha | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [aTentar, setATentar] = useState(false);
  const [aExportar, setAExportar] = useState(false);
  // O cliente da folha fica **guardado** (não se procura na lista): uma leitura que chega com a
  // folha aberta não a fecha nem a muda.
  const [daFolha, setDaFolha] = useState<ClienteGestao | null>(null);
  const [aEliminar, setAEliminar] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [verificacao, setVerificacao] = useState<Verificacao | null>(null);
  // Um objeto novo a cada pedido de foco: o mesmo alvo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<PedidoDeFoco | null>(null);

  const titulo = useRef<HTMLHeadingElement>(null);
  const estadoDoEcra = useRef<HTMLDivElement>(null);
  /** O «Eliminar» de cada item, por `id` do cliente, para lhe devolver o foco ao fechar a folha. */
  const botoesDoEliminar = useRef(new Map<number, HTMLButtonElement>());

  /** A lista **de agora** (`null` = nunca carregou ou a recarregar), para quem corre depois de um `await`. */
  const clientesAgora = useRef<ClienteGestao[] | null>(null);
  const aoPerderSessaoAgora = useRef(aoPerderSessao);
  const pedidos = useRef(new Set<AbortController>());
  const vivo = useRef(true);
  const pedindo = useRef(false);
  const verificando = useRef(false);
  const aTentarAgora = useRef(false);
  const aExportarAgora = useRef(false);

  useEffect(() => {
    aoPerderSessaoAgora.current = aoPerderSessao;
  });

  // --- Ler a lista ------------------------------------------------------------

  /** `GET /gestao/clientes`, com prazo e cancelável. Nunca lança: devolve o que aconteceu. */
  async function ler(): Promise<Leitura> {
    const controlador = new AbortController();
    pedidos.current.add(controlador);
    const desarmar = armarPrazo(controlador);
    try {
      const resposta = await obterClientes({ sinal: controlador.signal });
      const clientes: unknown = resposta.clientes;
      if (!Array.isArray(clientes)) return { tipo: "erro", semResposta: false };
      // Uma data que o ecrã não saiba escrever (um aparelho sem Lisboa) é erro de carregar:
      // nunca uma lista vazia nem um ecrã a rebentar.
      for (const cliente of clientes as ClienteGestao[])
        dataDoConsentimento(cliente.consentimento_em);
      return { tipo: "ok", clientes: clientes as ClienteGestao[] };
    } catch (erro) {
      // Desmontou a meio (ou o `StrictMode`): não é uma falha.
      if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return { tipo: "cancelada" };
      if (erro instanceof ErroDaApi && erro.estado === 401) return { tipo: "sessao" };
      return { tipo: "erro", semResposta: erro instanceof ErroDaApi && erro.estado === null };
    } finally {
      desarmar();
      pedidos.current.delete(controlador);
    }
  }

  /** Põe a lista à vista. Vazia **só** aqui, e só porque veio de um `200`. */
  function definirLista(clientes: ClienteGestao[]): void {
    clientesAgora.current = clientes;
    setEstado(clientes.length > 0 ? { estado: "pronta", clientes } : { estado: "vazia" });
  }

  /**
   * Aplica uma leitura. Devolve `ok` se a lista ficou à vista (um `200`), `erro` se o ecrã passou
   * a mostrar o erro, `fora` se não era para mostrar nada (cancelada, ou o 401, que é do login).
   * `linhaOk` é a linha de estado que vale depois de uma leitura bem sucedida.
   */
  function aplicar(
    leitura: Leitura,
    modo: Modo,
    linhaOk: Linha | null = null,
  ): "ok" | "erro" | "fora" {
    if (!vivo.current || leitura.tipo === "cancelada") return "fora";
    if (leitura.tipo === "sessao") {
      // A lista sai da memória: o login volta aqui e relê.
      clientesAgora.current = null;
      setEstado({ estado: "a-carregar" });
      setDaFolha(null);
      aoPerderSessaoAgora.current();
      return "fora";
    }
    if (leitura.tipo === "erro") {
      const haLista = clientesAgora.current !== null && clientesAgora.current.length > 0;
      if (modo === "silencioso" && haLista) {
        // Não se apaga o que se sabe: a lista fica, e diz que pode estar desatualizada.
        setLinha({ texto: T.desatualizada, tom: "info", acao: "tentar" });
        return "fora";
      }
      clientesAgora.current = null;
      setEstado({ estado: "erro", semResposta: leitura.semResposta });
      return "erro";
    }
    definirLista(leitura.clientes);
    setLinha(linhaOk);
    return "ok";
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
      if (pedindo.current || verificando.current) return;
      // Ainda a carregar pela primeira vez (ou no erro de carregar, que tem o seu botão): nada a reler.
      if (clientesAgora.current === null) return;
      reler();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    const aMeter = pedidos.current;
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

  function tentarOutraVez(): void {
    if (aTentarAgora.current) return;
    aTentarAgora.current = true;
    setATentar(true);
    const modo: Modo = (clientesAgora.current?.length ?? 0) > 0 ? "silencioso" : "inicial";
    void ler().then((leitura) => {
      aTentarAgora.current = false;
      setATentar(false);
      aplicar(leitura, modo);
    });
  }

  // --- O foco -----------------------------------------------------------------

  function focoDoQueHouver(): void {
    setFoco({ alvo: (clientesAgora.current?.length ?? 0) > 0 ? "titulo" : "estado" });
  }

  // Só depois de o React ter assentado; nunca dentro de uma promessa. Depois de eliminar o foco
  // vai ao título da secção (ou ao do estado vazio ou de erro), **nunca** ao «Eliminar» do item
  // seguinte: um botão destrutivo vizinho, ao alcance de um toque seguido. Ao fechar a folha
  // **sem** eliminar volta ao «Eliminar» desse item (o `<dialog>` já o faz; aqui fica explícito).
  useEffect(() => {
    if (foco === null) return;
    if (foco.alvo === "eliminar") {
      botoesDoEliminar.current.get(foco.id)?.focus();
      return;
    }
    (foco.alvo === "estado" ? estadoDoEcra.current : titulo.current)?.focus();
  }, [foco]);

  // --- Eliminar ---------------------------------------------------------------

  /**
   * O cliente saiu da lista (204 ou 404): mostra-se o que resta. Se não resta nenhum, faz-se **um
   * `GET`** antes de dizer «vazio» (entretanto o esqueleto); se esse `GET` falhar é o erro de
   * carregar e o cliente eliminado não volta.
   */
  function depoisDeSair(id: number, linhaFinal: Linha | null): void {
    const resto = (clientesAgora.current ?? []).filter((c) => c.id !== id);
    if (resto.length > 0) {
      clientesAgora.current = resto;
      setEstado({ estado: "pronta", clientes: resto });
      setLinha(linhaFinal);
      setFoco({ alvo: "titulo" });
      return;
    }
    clientesAgora.current = null;
    setLinha(linhaFinal);
    setEstado({ estado: "a-carregar" });
    void ler().then((leitura) => {
      const resultado = aplicar(leitura, "inicial", linhaFinal);
      if (resultado === "ok") focoDoQueHouver();
      else if (resultado === "erro") setFoco({ alvo: "estado" });
    });
  }

  async function eliminar(alvo: ClienteGestao): Promise<void> {
    // Uma referência e não o estado: dois toques no mesmo instante chegam antes de o React assentar.
    if (pedindo.current) return;
    pedindo.current = true;
    setAEliminar(true);
    setFalhou(false);
    setLinha(null);
    setAviso(null);

    const controlador = new AbortController();
    pedidos.current.add(controlador);
    const desarmar = armarPrazo(controlador);
    try {
      await eliminarCliente(alvo.id, { sinal: controlador.signal });
    } catch (erro) {
      desarmar();
      pedidos.current.delete(controlador);
      pedindo.current = false;
      if (!vivo.current) return;
      setAEliminar(false);
      await aoFalhar(alvo, erro);
      return;
    }
    desarmar();
    pedidos.current.delete(controlador);
    pedindo.current = false;
    if (!vivo.current) return;

    setAEliminar(false);
    setDaFolha(null);
    setAviso({ mensagem: T.avisoEliminado, duracaoMs: DURACAO_DO_AVISO_ELIMINADO_MS });
    depoisDeSair(alvo.id, null);
  }

  async function aoFalhar(alvo: ClienteGestao, erro: unknown): Promise<void> {
    if (erro instanceof ErroDaApi && erro.estado === 401) {
      // Nunca se repete: o dono vê a lista como o servidor a tem, depois de entrar outra vez.
      setDaFolha(null);
      clientesAgora.current = null;
      setEstado({ estado: "a-carregar" });
      aoPerderSessaoAgora.current();
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === 404 && erro.codigo === "cliente_inexistente") {
      // Já não existe: sai da lista. É informação, não erro. Um 404 sem o código (um proxy, um
      // Apache) não diz isto: cai no erro de baixo.
      setDaFolha(null);
      depoisDeSair(alvo.id, { texto: T.jaNaoExistia, tom: "info", acao: null });
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === null) {
      // Sem resposta: não se sabe. A folha fecha e o ecrã vai ver (nunca repete o `DELETE`).
      setDaFolha(null);
      await verificar(alvo);
      return;
    }
    // 500, 403, 422, outro: o cliente fica, a folha mantém-se com o erro dentro. Tocar outra vez é seguro.
    setFalhou(true);
  }

  /**
   * «Não sei se foi eliminado»: o `GET` da lista diz. O cliente já não está: foi eliminado.
   * Continua: nada aconteceu (ou o pedido ainda não chegou; tocar de novo é seguro, o segundo dá
   * 404). O `GET` falha: continua sem saber, e o «Verificar outra vez» repete **isto**, nunca o
   * `DELETE`.
   */
  async function verificar(alvo: ClienteGestao): Promise<void> {
    if (verificando.current) return;
    verificando.current = true;
    setLinha(null);
    setVerificacao({ cliente: alvo, fase: "a-verificar" });
    const leitura = await ler();
    verificando.current = false;
    if (!vivo.current || leitura.tipo === "cancelada") return;
    if (leitura.tipo === "sessao") {
      setVerificacao(null);
      aplicar(leitura, "inicial");
      return;
    }
    if (leitura.tipo === "erro") {
      setVerificacao({ cliente: alvo, fase: "sem-confirmar" });
      return;
    }

    setVerificacao(null);
    definirLista(leitura.clientes);
    if (leitura.clientes.some((c) => c.id === alvo.id)) {
      setLinha({ texto: T.continuaSemResposta, tom: "erro", acao: null });
      return;
    }
    setAviso({ mensagem: T.avisoEliminado, duracaoMs: DURACAO_DO_AVISO_ELIMINADO_MS });
    focoDoQueHouver();
  }

  // --- Exportar ---------------------------------------------------------------

  async function exportar(): Promise<void> {
    // Uma referência e não o estado: dois toques no mesmo instante chegam antes de o React assentar.
    if (aExportarAgora.current) return;
    aExportarAgora.current = true;
    setAExportar(true);
    setLinha(null);
    setAviso(null);

    const controlador = new AbortController();
    pedidos.current.add(controlador);
    const desarmar = armarPrazo(controlador, PRAZO_DO_FICHEIRO_MS);
    try {
      const { nome, href } = await descarregarClientesCsv({ sinal: controlador.signal });
      if (!vivo.current || controlador.signal.aborted) return;
      descarregar(href, nome);
      // O ecrã não sabe se o browser descarregou (o iPhone pergunta antes): não afirma «descarregado».
      setAviso({ mensagem: T.csvPreparado, duracaoMs: DURACAO_DO_AVISO_CSV_MS });
    } catch (erro) {
      if (!vivo.current) return;
      if (erro instanceof ErroDaApi && erro.estado === 401) {
        aoPerderSessaoAgora.current();
        return;
      }
      if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return;
      const semResposta = erro instanceof ErroDaApi && erro.estado === null;
      setLinha({
        texto: semResposta ? T.csvSemResposta : T.csvServidor,
        tom: "erro",
        acao: null,
      });
    } finally {
      desarmar();
      pedidos.current.delete(controlador);
      aExportarAgora.current = false;
      if (vivo.current) setAExportar(false);
    }
  }

  // --- Desenho ----------------------------------------------------------------

  const clientes = estado.estado === "pronta" ? estado.clientes : [];
  const tituloDaSeccao = estado.estado === "pronta" ? T.h2N(clientes.length) : T.h2;

  let linhaVisivel: Linha | null = linha;
  if (verificacao?.fase === "a-verificar") {
    linhaVisivel = { texto: T.aVerificar, tom: "info", acao: null };
  } else if (verificacao?.fase === "sem-confirmar") {
    linhaVisivel = { texto: T.semConfirmar, tom: "info", acao: null };
  }
  const linhaADesenhar =
    estado.estado === "pronta" || estado.estado === "vazia" ? linhaVisivel : null;

  let corpo: ReactElement | null;
  if (estado.estado === "a-carregar") {
    // O esqueleto não tem texto: quatro blocos com duas barras e o lugar do «Eliminar» (spec 5.5).
    corpo = (
      <div aria-busy="true" className="flex flex-col">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 border-b border-fio-interno py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-4 w-1/2 rounded-pequeno bg-fio-interno" />
              <div className="h-4 w-3/4 rounded-pequeno bg-fio-interno" />
            </div>
            <div className="min-h-toque w-miniatura shrink-0 rounded-pequeno bg-fio-interno" />
          </div>
        ))}
      </div>
    );
  } else if (estado.estado === "erro") {
    corpo = (
      <div ref={estadoDoEcra} tabIndex={-1}>
        <EstadoVazio
          tom="erro"
          titulo={T.erroTitulo}
          linha={estado.semResposta ? T.erroSemResposta : T.erroServidor}
        >
          <Botao aTrabalhar={aTentar} textoATrabalhar={T.aTentar} onClick={tentarOutraVez}>
            {T.tentarOutraVez}
          </Botao>
        </EstadoVazio>
      </div>
    );
  } else if (estado.estado === "vazia") {
    // Neutro, sem botão: não há nada a tentar, e o texto continua verdade depois da F2-07.
    corpo = (
      <div ref={estadoDoEcra} tabIndex={-1}>
        <EstadoVazio titulo={T.vazioTitulo} linha={T.vazioLinha} />
      </div>
    );
  } else {
    const visiveis = clientes.slice(0, limite);
    corpo = (
      <>
        <ul>
          {visiveis.map((cliente, indice) => (
            <LinhaDoCliente
              key={cliente.id}
              cliente={cliente}
              indice={indice}
              inerte={verificacao?.cliente.id === cliente.id}
              refDoEliminar={(no) => {
                if (no === null) botoesDoEliminar.current.delete(cliente.id);
                else botoesDoEliminar.current.set(cliente.id, no);
              }}
              aoEliminar={() => {
                setFalhou(false);
                setDaFolha(cliente);
              }}
            />
          ))}
        </ul>
        {clientes.length > visiveis.length && (
          <>
            <p aria-live="polite" className="text-nota text-texto-suave">
              {T.aMostrar(visiveis.length, clientes.length)}
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

  return (
    <>
      <Titulo />
      <a
        href="/gestao/mais"
        onClick={(evento) => {
          if (!eCliqueSimples(evento)) return;
          evento.preventDefault();
          navegar("/gestao/mais");
        }}
        className="inline-flex min-h-toque items-center text-nota text-texto underline"
      >
        {T.voltar}
      </a>

      <section aria-labelledby={idDoTitulo} className="mt-4 flex flex-col gap-3">
        <h2
          id={idDoTitulo}
          ref={titulo}
          tabIndex={-1}
          className="text-seccao font-forte text-texto"
        >
          {tituloDaSeccao}
        </h2>

        {estado.estado === "pronta" && (
          <>
            <div className="self-start">
              <Botao
                descritoPor={`${idDaAjuda} ${idDoAvisoDoCsv}`}
                desativado={aExportar}
                aTrabalhar={aExportar}
                textoATrabalhar={T.aPreparar}
                onClick={() => {
                  void exportar();
                }}
              >
                {T.exportar}
              </Botao>
            </div>
            <p id={idDaAjuda} className="text-nota text-texto-suave">
              {T.ajudaDoCsv}
            </p>
            <p id={idDoAvisoDoCsv} className="text-nota text-texto">
              {T.avisoDoCsv}
            </p>
          </>
        )}

        {linhaADesenhar !== null && (
          <>
            <p
              role="status"
              className={
                linhaADesenhar.tom === "erro" ? "text-nota text-erro" : "text-nota text-texto"
              }
            >
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
                    void verificar(verificacao.cliente);
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

      <FolhaEliminarCliente
        cliente={daFolha}
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

      <div className="aviso-sobre-a-barra-da-gestao">
        <AvisoTemporario
          tipo="sucesso"
          {...(aviso !== null ? { mensagem: aviso.mensagem, duracaoMs: aviso.duracaoMs } : {})}
          aoFechar={() => {
            setAviso(null);
          }}
        />
      </div>
    </>
  );
}
