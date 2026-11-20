import type { ReactElement } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { AvisoTemporario } from "../../../components/ui/AvisoTemporario";
import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { juntar } from "../../../components/ui/juntar";
import { ErroDaApi } from "../../../lib/api/cliente";
import {
  type AlteracaoDeEvento,
  alterarEvento,
  criarEvento,
  duplicarEvento,
  eliminarEvento,
  type EventoGestao,
  type EventosGestao as ListaDeEventos,
  type NovoEvento,
  obterEventosGestao,
} from "../../../lib/api/gestao-eventos";
import { ErroSemLisboa, partesEmLisboa } from "../../../lib/formato/data-do-evento";
import { executar, type Falha } from "../ementa/pedidos";
import type { Registar } from "../ementa/tipos";
import { armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { formatarDataNaGestao } from "./data-na-gestao";
import {
  FolhaDoEvento,
  type FalhaDeFora,
  type ModoDaFolha,
  type ResultadoDaFolha,
} from "./FolhaDoEvento";
import { FolhaDuplicar } from "./FolhaDuplicar";
import { FolhaEliminarEvento } from "./FolhaEliminarEvento";
import type { CampoDoFormulario } from "./formulario";
import { LinhaDoEvento } from "./LinhaDoEvento";
import { ERRO_422_POR_CAMPO, TEXTOS } from "./textos";

/**
 * O destino «Eventos» da gestão (F4-03, `docs/ecras/F4-03.md`).
 *
 * É o dono do estado: as três listas, o único `AvisoTemporario` da página, as folhas (criar e
 * editar, duplicar, eliminar), o arquivo que se abre e o «agora». Os componentes por baixo são
 * quase só desenho.
 *
 * **Regra 10, a que manda em tudo isto:**
 *  - «não consegui carregar» e «ainda não há eventos» nunca se desenham iguais: o vazio só vem
 *    de um `200` com as três listas vazias, e um erro nunca desenha lista nenhuma;
 *  - uma gravação **sem resposta** quer dizer «não sei se gravou»: o ecrã não finge, **nunca
 *    reenvia sozinho** (um `POST` repetido duplicava o evento) e recarrega a lista por baixo
 *    para ver o que o servidor tem;
 *  - as três listas são do servidor (o corte do dia do bar, ADR 0010): depois de cada gravação
 *    com sucesso a lista **recarrega**, e é a lista recarregada que diz em que parte o evento
 *    ficou — e, por isso, que aviso se dá. O ecrã nunca classifica um evento sozinho.
 *
 * **O «agora» lê-se num só sítio**: ao montar e no `visibilitychange`. Nenhuma função de
 * `eventos/` lê o relógio; o `agora` entra por argumento.
 *
 * Um 401 em qualquer pedido chama `aoPerderSessao()`: leva ao login e, depois de entrar, volta
 * aqui. O que estava por guardar perde-se (nunca se guarda a descrição no browser).
 */
type Fase =
  | { estado: "a-carregar" }
  | { estado: "pronta" }
  | { estado: "erro"; semResposta: boolean; aTentar: boolean };

type Aviso = { tipo: "sucesso" | "erro"; mensagem: string; aoDesfazer?: () => void };

/** A lista que se mostrou e já não se sabe se está certa (10.5). */
type Desatualizada = { semResposta: boolean; aTentar: boolean };

type Leitura =
  | { ok: true; lista: ListaDeEventos }
  | { ok: false; motivo: "obsoleta" }
  | { ok: false; motivo: "falhou"; semResposta: boolean };

/** Onde a lista recarregada pôs um evento. */
type Onde =
  { parte: "proximos"; indice: number } | { parte: "rascunhos" } | { parte: "arquivo" } | null;

/** O site mostra só os três primeiros dos próximos. */
const QUANTOS_O_SITE_MOSTRA = 3;
/** O arquivo desenha-se 20 linhas de cada vez; a lista já vem inteira do servidor. */
const LINHAS_DO_ARQUIVO = 20;

const LISTA_VAZIA: ListaDeEventos = { proximos: [], rascunhos: [], arquivo: [] };
const CAMADA =
  "superficie-painel flex flex-col gap-4 rounded-cartao border border-contorno-superficie p-4";

function ondeEsta(lista: ListaDeEventos, id: number): Onde {
  const indice = lista.proximos.findIndex((e) => e.id === id);
  if (indice >= 0) return { parte: "proximos", indice };
  if (lista.rascunhos.some((e) => e.id === id)) return { parte: "rascunhos" };
  if (lista.arquivo.some((e) => e.id === id)) return { parte: "arquivo" };
  return null;
}

function todosOsIds(lista: ListaDeEventos): Set<number> {
  return new Set([...lista.proximos, ...lista.rascunhos, ...lista.arquivo].map((e) => e.id));
}

function aMesmaHora(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Os dias de Lisboa como um número comparável. */
function diaDeLisboa(instante: Date): number {
  const p = partesEmLisboa(instante);
  return Date.UTC(p.ano, p.mes - 1, p.dia);
}

/** O aviso de um evento que ficou publicado, pela parte onde a lista recarregada o pôs. */
function avisoDePublicado(titulo: string, onde: Onde): string {
  if (onde?.parte === "arquivo") return TEXTOS.publicadoNoArquivo(titulo);
  if (onde?.parte === "proximos" && onde.indice >= QUANTOS_O_SITE_MOSTRA) {
    return TEXTOS.publicadoSoTres(titulo);
  }
  return TEXTOS.publicadoNoSite(titulo);
}

function Esqueleto(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {[3, 2].map((barras) => (
        <div key={barras} aria-busy="true" className={CAMADA}>
          {Array.from({ length: barras }, (_, n) => (
            <div
              key={n}
              className={`h-4 rounded-pequeno bg-fio-interno ${n % 2 === 0 ? "w-3/4" : "w-1/2"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * «Ver o arquivo (n)»: um botão secundário com `aria-expanded` e `aria-controls`, que o `Botao`
 * não aceita. As mesmas classes do `Botao` secundário (a gestão não mexe em `components/ui/`).
 */
function BotaoDoArquivo({
  aberto,
  total,
  idDaLista,
  ref,
  aoTocar,
}: {
  aberto: boolean;
  total: number;
  idDaLista: string;
  ref: (no: HTMLButtonElement | null) => void;
  aoTocar: () => void;
}): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={aberto}
      aria-controls={idDaLista}
      onClick={aoTocar}
      className={juntar(
        "inline-flex items-center justify-center gap-2 self-start",
        "min-h-toque min-w-toque rounded-pequeno px-6",
        "font-corpo text-corpo font-forte text-center",
        "border border-contorno text-texto",
        "transition-transform duration-curta ease-curva active:translate-y-premido",
      )}
    >
      {aberto ? TEXTOS.esconderOArquivo : TEXTOS.verOArquivo(total)}
    </button>
  );
}

export function EventosGestao(): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();

  const [fase, setFase] = useState<Fase>({ estado: "a-carregar" });
  const [lista, setLista] = useState<ListaDeEventos>(LISTA_VAZIA);
  const [desatualizada, setDesatualizada] = useState<Desatualizada | null>(null);
  // O relógio que as notas e as datas leem. Lê-se aqui, ao montar e no regresso à página.
  const [agora, setAgora] = useState(() => new Date());
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [folha, setFolha] = useState<ModoDaFolha | null>(null);
  const [falhaDeFora, setFalhaDeFora] = useState<FalhaDeFora | null>(null);
  const [duplicarAberto, setDuplicarAberto] = useState<EventoGestao | null>(null);
  const [eliminarAberto, setEliminarAberto] = useState<EventoGestao | null>(null);
  const [duplicarEscolhida, setDuplicarEscolhida] = useState<1 | 2 | 3 | null>(null);
  const [aEliminar, setAEliminar] = useState(false);
  const [passadosAbertos, setPassadosAbertos] = useState(false);
  const [passadosVisiveis, setPassadosVisiveis] = useState(LINHAS_DO_ARQUIVO);
  const [pendentes, setPendentes] = useState<ReadonlySet<number>>(new Set());
  const [otimistas, setOtimistas] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [aDuplicar, setADuplicar] = useState<ReadonlySet<number>>(new Set());
  // Um objeto novo a cada pedido: o mesmo alvo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<{ chaves: string[] } | null>(null);

  const idDoArquivo = useId();
  const idDosProximos = useId();
  const idDosRascunhos = useId();
  const idDoTituloDoArquivo = useId();
  const leitura = useRef<AbortController | null>(null);
  const montada = useRef(false);
  const listaAgora = useRef<ListaDeEventos>(LISTA_VAZIA);
  const alvos = useRef(new Map<string, HTMLElement>());
  // Os pedidos de um evento já a caminho: um segundo toque não envia um segundo pedido.
  const publicarEmVoo = useRef(new Set<number>());
  const duplicarEmVoo = useRef(new Set<number>());
  const eliminarEmVoo = useRef(false);

  // --- O relógio ------------------------------------------------------------

  useEffect(() => {
    function aoVoltar(): void {
      setAgora(new Date());
    }
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  // --- O foco ---------------------------------------------------------------

  /** Cada nó que o foco possa ter de reencontrar regista-se por uma chave. */
  const registar: Registar = useCallback(
    (chave) => (no) => {
      if (no !== null) alvos.current.set(chave, no);
      else alvos.current.delete(chave);
    },
    [],
  );

  // Depois de um pedido, o foco volta a um alvo que já existe no DOM, e a linha entra à vista.
  // É um efeito (passivo): o nó pode ainda nem existir, e o `<dialog>` devolve o foco ao que o
  // abriu quando fecha — e os efeitos dos filhos (a `Folha`) correm antes dos do pai.
  useEffect(() => {
    if (foco === null) return;
    for (const chave of foco.chaves) {
      const no = alvos.current.get(chave);
      if (no?.isConnected === true) {
        no.focus();
        no.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }, [foco]);

  const pedirFoco = useCallback((...chaves: string[]) => {
    setFoco({ chaves });
  }, []);

  // --- Carregar -------------------------------------------------------------

  /** Uma leitura; a mais nova ocupa o lugar da anterior (que fica «obsoleta»). */
  const ler = useCallback((): Promise<Leitura> => {
    leitura.current?.abort();
    const controlador = new AbortController();
    leitura.current = controlador;
    const desarmar = armarPrazo(controlador);

    return obterEventosGestao({ sinal: controlador.signal })
      .then((resposta): Leitura => {
        if (controlador.signal.aborted) return { ok: false, motivo: "obsoleta" };
        return { ok: true, lista: resposta };
      })
      .catch((erro: unknown): Leitura => {
        // Desmontou, ou uma leitura mais nova ocupou o lugar: não é uma resposta.
        if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) {
          return { ok: false, motivo: "obsoleta" };
        }
        if (erro instanceof ErroDaApi && erro.estado === 401) {
          aoPerderSessao();
          return { ok: false, motivo: "obsoleta" };
        }
        // Tudo o que não for «sem resposta» é do servidor — o nosso código a rebentar e um
        // corpo que não se sabe ler incluídos: nunca «a carregar» para sempre, nunca «não há».
        return {
          ok: false,
          motivo: "falhou",
          semResposta: erro instanceof ErroDaApi && erro.estado === null,
        };
      })
      .finally(desarmar);
  }, [aoPerderSessao]);

  /** Aplica o que a leitura trouxe. `silenciosa`: sem esqueleto, e a lista de antes mantém-se se falhar. */
  const aplicar = useCallback((r: Leitura, silenciosa: boolean): void => {
    if (!montada.current) return;
    if (r.ok) {
      listaAgora.current = r.lista;
      setLista(r.lista);
      setFase({ estado: "pronta" });
      setDesatualizada(null);
      return;
    }
    if (r.motivo === "obsoleta") return;
    if (silenciosa) {
      setDesatualizada({ semResposta: r.semResposta, aTentar: false });
      // Uma gravação que partiu antes de a primeira leitura chegar: se também a recarga falha,
      // nunca fica o esqueleto para sempre — é o ecrã de erro de carregar (regra 10).
      setFase((f) =>
        f.estado === "a-carregar"
          ? { estado: "erro", semResposta: r.semResposta, aTentar: false }
          : f,
      );
    } else {
      setFase({ estado: "erro", semResposta: r.semResposta, aTentar: false });
    }
  }, []);

  /** A lista recarrega em silêncio depois de cada gravação (spec 4.5). */
  const recarregar = useCallback(async (): Promise<Leitura> => {
    const r = await ler();
    aplicar(r, true);
    return r;
  }, [ler, aplicar]);

  const carregar = useCallback(async (): Promise<void> => {
    aplicar(await ler(), false);
  }, [ler, aplicar]);

  useEffect(() => {
    montada.current = true;
    // Um `queueMicrotask` e não a chamada direta: no desenvolvimento o `StrictMode` monta,
    // desmonta e volta a montar de seguida, e o primeiro pedido seria deitado fora.
    let ativo = true;
    queueMicrotask(() => {
      if (ativo) void carregar();
    });
    return () => {
      ativo = false;
      montada.current = false;
      leitura.current?.abort();
    };
  }, [carregar]);

  // --- Avisos e falhas ------------------------------------------------------

  function mostrar(tipo: "sucesso" | "erro", mensagem: string, aoDesfazer?: () => void): void {
    setAviso({ tipo, mensagem, ...(aoDesfazer !== undefined ? { aoDesfazer } : {}) });
  }

  /** `true` se era um 401 (já tratado: vai-se para o login). */
  function eSessao(falha: Falha): boolean {
    if (falha.tipo !== "sessao") return false;
    aoPerderSessao();
    return true;
  }

  /** A data de um evento como as frases a dizem; um aparelho sem Lisboa não chega aqui (o ecrã já seria o erro). */
  function dataDe(inicio: string | null): string {
    return formatarDataNaGestao(inicio, agora);
  }

  // --- «Publicado» ----------------------------------------------------------

  function marcarPendente(id: number, a: boolean): void {
    if (a) publicarEmVoo.current.add(id);
    else publicarEmVoo.current.delete(id);
    setPendentes(new Set(publicarEmVoo.current));
  }

  function pousarOptimista(id: number): void {
    setOtimistas((m) => {
      const novo = new Map(m);
      novo.delete(id);
      return novo;
    });
  }

  /** O que o servidor já confirmou, aplicado à lista que se vê sem mudar o evento de parte. */
  function confirmarPublicado(id: number, publicado: boolean): void {
    const mexer = (e: EventoGestao): EventoGestao => (e.id === id ? { ...e, publicado } : e);
    const nova: ListaDeEventos = {
      proximos: listaAgora.current.proximos.map(mexer),
      rascunhos: listaAgora.current.rascunhos.map(mexer),
      arquivo: listaAgora.current.arquivo.map(mexer),
    };
    listaAgora.current = nova;
    setLista(nova);
  }

  async function desfazerPublicado(evento: EventoGestao, valor: boolean): Promise<void> {
    setAviso(null);
    // Um pedido de cada vez por evento, como no caminho normal: dois PATCH cruzados podiam
    // chegar por ordem trocada.
    if (publicarEmVoo.current.has(evento.id)) return;
    marcarPendente(evento.id, true);
    const r = await executar((o) => alterarEvento(evento.id, { publicado: valor }, o));
    marcarPendente(evento.id, false);
    if (r.ok) {
      confirmarPublicado(evento.id, valor);
      // O interruptor a voltar é a confirmação: sem outro aviso.
      await recarregar();
      return;
    }
    if (eSessao(r.falha)) return;
    if (r.falha.tipo === "nao-existe") {
      mostrar("erro", TEXTOS.jaNaoExiste);
      await recarregar();
    } else if (r.falha.tipo === "sem-resposta") {
      // Não sei se desfez: mostra-se o que o servidor tem.
      mostrar("erro", TEXTOS.desfazerSemResposta);
      await recarregar();
    } else {
      // O interruptor fica como o servidor o tem (o valor tocado) e diz-se.
      mostrar("erro", TEXTOS.desfazerServidor);
    }
  }

  async function mudarPublicado(evento: EventoGestao, ligado: boolean): Promise<void> {
    // Sem data não se publica, e não é um erro à espera de acontecer: o interruptor está parado.
    if (evento.inicio === null) return;
    if (publicarEmVoo.current.has(evento.id)) return;
    marcarPendente(evento.id, true);
    // Otimista: o interruptor muda já. Se falhar, volta ao que tinha.
    setOtimistas((m) => new Map(m).set(evento.id, ligado));

    const r = await executar((o) => alterarEvento(evento.id, { publicado: ligado }, o));
    marcarPendente(evento.id, false);

    if (r.ok) {
      confirmarPublicado(evento.id, ligado);
      pousarOptimista(evento.id);
      const lido = await recarregar();
      const onde = lido.ok ? ondeEsta(lido.lista, evento.id) : null;
      mostrar(
        "sucesso",
        ligado ? avisoDePublicado(evento.titulo, onde) : TEXTOS.despublicadoDoSite(evento.titulo),
        () => {
          void desfazerPublicado(evento, !ligado);
        },
      );
      pedirFoco(`interruptor-${String(evento.id)}`, "arquivo", "novo");
      return;
    }

    pousarOptimista(evento.id);
    if (eSessao(r.falha)) return;
    const f = r.falha;
    if (f.tipo === "nao-existe") {
      mostrar("erro", TEXTOS.jaNaoExiste);
      await recarregar();
    } else if (f.tipo === "invalido" && (f.codigo === "evento_sem_data" || f.campo === "inicio")) {
      mostrar("erro", TEXTOS.semDataCorrida);
      await recarregar();
    } else if (f.tipo === "invalido") {
      mostrar("erro", TEXTOS.erro422SemCampo);
    } else if (f.tipo === "sem-resposta") {
      mostrar("erro", TEXTOS.semRespostaInterruptor);
      await recarregar();
    } else {
      mostrar("erro", TEXTOS.servidorGuardar);
    }
  }

  // --- Duplicar -------------------------------------------------------------

  async function desfazerCopia(copia: EventoGestao): Promise<void> {
    setAviso(null);
    const r = await executar((o) => eliminarEvento(copia.id, o));
    if (r.ok) {
      await recarregar();
      return;
    }
    if (eSessao(r.falha)) return;
    if (r.falha.tipo === "nao-existe") {
      mostrar("erro", TEXTOS.jaNaoExiste);
      await recarregar();
    } else if (r.falha.tipo === "sem-resposta") {
      mostrar("erro", TEXTOS.desfazerSemResposta);
      await recarregar();
    } else {
      mostrar("erro", TEXTOS.desfazerRascunhoFicou);
    }
  }

  async function duplicar(evento: EventoGestao, semanas: 1 | 2 | 3 | null): Promise<void> {
    // Um segundo toque não envia um segundo pedido (duplicava a cópia).
    if (duplicarEmVoo.current.has(evento.id)) return;
    duplicarEmVoo.current.add(evento.id);
    setADuplicar(new Set(duplicarEmVoo.current));

    if (semanas !== null) setDuplicarEscolhida(semanas);

    const r = await executar((o) => duplicarEvento(evento.id, semanas, o));
    duplicarEmVoo.current.delete(evento.id);
    setADuplicar(new Set(duplicarEmVoo.current));
    // A folha de escolher a semana fecha com a resposta, venha ela como vier.
    setDuplicarAberto(null);
    setDuplicarEscolhida(null);

    if (r.ok) {
      const copia = r.valor;
      await recarregar();
      // A data do aviso é a da **resposta**, nunca a da pré-visualização.
      mostrar(
        "sucesso",
        copia.inicio === null
          ? TEXTOS.rascunhoCriadoSemData
          : TEXTOS.rascunhoCriadoPara(dataDe(copia.inicio)),
        () => {
          void desfazerCopia(copia);
        },
      );
      pedirFoco(`titulo-${String(copia.id)}`, "novo");
      return;
    }

    if (eSessao(r.falha)) return;
    const f = r.falha;
    if (f.tipo === "nao-existe") {
      mostrar("erro", TEXTOS.jaNaoExiste);
      await recarregar();
    } else if (f.tipo === "invalido") {
      mostrar("erro", TEXTOS.duplicar422);
      await recarregar();
    } else if (f.tipo === "sem-resposta") {
      // Não reenvia (criava duas cópias): recarrega, e a lista diz se a cópia já lá está.
      mostrar("erro", TEXTOS.duplicarSemSaber);
      await recarregar();
    } else {
      mostrar("erro", TEXTOS.duplicarServidor);
    }
  }

  function aoTocarEmDuplicar(evento: EventoGestao): void {
    // Só o original **sem data** duplica com um toque, sem folha e sem corpo (a cópia fica
    // sem data); os outros escolhem a semana.
    if (evento.inicio === null) void duplicar(evento, null);
    else setDuplicarAberto(evento);
  }

  // --- A folha de criar e de editar -----------------------------------------

  function fecharFolha(): void {
    setFolha(null);
    setFalhaDeFora(null);
  }

  /** O que a folha mostra de uma falha — e o que se recarrega por baixo. */
  function erroDaFolha(falha: Falha, semResposta: string): ResultadoDaFolha {
    if (falha.tipo === "invalido") {
      if (falha.codigo === "evento_sem_data") {
        // Corrida: alguém mexeu entretanto. Mostra-se o erro e recarrega-se por baixo.
        void recarregar();
        return {
          tipo: "erro",
          campos: { data: TEXTOS.erroPublicarSemData },
          primeiro: "data",
        };
      }
      const porCampo: Record<string, [CampoDoFormulario, string]> = {
        titulo: ["titulo", ERRO_422_POR_CAMPO.titulo],
        descricao: ["descricao", ERRO_422_POR_CAMPO.descricao],
        inicio: ["data", ERRO_422_POR_CAMPO.inicio],
      };
      const par = porCampo[falha.campo ?? ""];
      if (par !== undefined)
        return { tipo: "erro", campos: { [par[0]]: par[1] }, primeiro: par[0] };
      return { tipo: "erro", texto: TEXTOS.erro422SemCampo };
    }
    if (falha.tipo === "sem-resposta") return { tipo: "erro", texto: semResposta };
    return { tipo: "erro", texto: TEXTOS.servidorGuardar };
  }

  async function criar(novo: NovoEvento): Promise<ResultadoDaFolha> {
    // Os que já lá estavam: um evento «novo» é um id que não estava na lista de antes.
    const antes = todosOsIds(listaAgora.current);
    const r = await executar((o) => criarEvento(novo, o));
    const titulo = novo.titulo.trim();

    if (r.ok) {
      const criado = r.valor;
      fecharFolha();
      const lido = await recarregar();
      const onde = lido.ok ? ondeEsta(lido.lista, criado.id) : null;
      mostrar("sucesso", novo.publicado ? avisoDePublicado(titulo, onde) : TEXTOS.rascunhoGuardado);
      pedirFoco(`titulo-${String(criado.id)}`, "arquivo", "novo");
      return { tipo: "fechou" };
    }
    if (eSessao(r.falha)) return { tipo: "fechou" };

    if (r.falha.tipo === "sem-resposta") {
      // Não reenvia (criava o evento duas vezes): recarrega e procura-o na lista.
      const lido = await recarregar();
      if (!lido.ok) return { tipo: "erro", texto: TEXTOS.criarSemSaber };
      const todos = [...lido.lista.proximos, ...lido.lista.rascunhos, ...lido.lista.arquivo];
      const novoNaLista = todos.find(
        (e) =>
          !antes.has(e.id) &&
          e.titulo.trim() === titulo &&
          e.inicio !== null &&
          aMesmaHora(e.inicio, novo.inicio),
      );
      if (novoNaLista === undefined) return { tipo: "erro", texto: TEXTOS.criarNaoEncontrado };
      fecharFolha();
      mostrar("sucesso", TEXTOS.eventoGuardadoSemResposta);
      pedirFoco(`titulo-${String(novoNaLista.id)}`, "arquivo", "novo");
      return { tipo: "fechou" };
    }
    return erroDaFolha(r.falha, TEXTOS.semRespostaGuardar);
  }

  async function editar(evento: EventoGestao, corpo: AlteracaoDeEvento): Promise<ResultadoDaFolha> {
    const r = await executar((o) => alterarEvento(evento.id, corpo, o));

    if (r.ok) {
      fecharFolha();
      const lido = await recarregar();
      const onde = lido.ok ? ondeEsta(lido.lista, evento.id) : null;
      // O título que o dono acabou de escrever, não o de antes.
      const titulo = (corpo.titulo ?? evento.titulo).trim();
      let mensagem: string;
      if (corpo.publicado === true) {
        mensagem = avisoDePublicado(titulo, onde);
      } else if (evento.publicado) {
        if (onde?.parte === "arquivo") mensagem = TEXTOS.publicadoNoArquivo(titulo);
        else if (onde?.parte === "proximos" && onde.indice >= QUANTOS_O_SITE_MOSTRA) {
          mensagem = TEXTOS.eventoAtualizadoSoTres;
        } else mensagem = TEXTOS.eventoAtualizado;
      } else {
        mensagem = TEXTOS.rascunhoAtualizado;
      }
      mostrar("sucesso", mensagem);
      pedirFoco(`titulo-${String(evento.id)}`, "arquivo", "novo");
      return { tipo: "fechou" };
    }
    if (eSessao(r.falha)) return { tipo: "fechou" };

    if (r.falha.tipo === "nao-existe") {
      fecharFolha();
      mostrar("erro", TEXTOS.jaNaoExiste);
      await recarregar();
      return { tipo: "fechou" };
    }
    // Sem resposta, num `PATCH` absoluto, repetir é seguro — mas só quando o dono o pedir.
    if (r.falha.tipo === "sem-resposta") void recarregar();
    return erroDaFolha(r.falha, TEXTOS.semRespostaGuardar);
  }

  // --- Eliminar -------------------------------------------------------------

  async function confirmarEliminar(): Promise<void> {
    const evento = eliminarAberto;
    if (evento === null || eliminarEmVoo.current) return;
    eliminarEmVoo.current = true;
    setAEliminar(true);
    const r = await executar((o) => eliminarEvento(evento.id, o));
    eliminarEmVoo.current = false;
    setAEliminar(false);

    // Um 404 é o resultado que o dono queria (outra sessão tinha-o eliminado): não é um erro.
    if (r.ok || r.falha.tipo === "nao-existe") {
      setEliminarAberto(null);
      fecharFolha();
      await recarregar();
      mostrar(
        "sucesso",
        r.ok && evento.publicado ? TEXTOS.eventoEliminadoNoSite : TEXTOS.eventoEliminado,
      );
      pedirFoco("novo");
      return;
    }
    if (eSessao(r.falha)) return;

    if (r.falha.tipo === "sem-resposta") {
      // O ecrã não sabe: a lista é que diz (regra 10).
      setEliminarAberto(null);
      fecharFolha();
      const lido = await recarregar();
      if (!lido.ok) mostrar("erro", TEXTOS.eliminarSemSaber);
      else if (ondeEsta(lido.lista, evento.id) === null) mostrar("sucesso", TEXTOS.eventoEliminado);
      else mostrar("erro", TEXTOS.eliminarContinuaLa);
      pedirFoco("novo");
      return;
    }

    // 5xx, 403, outro: a de confirmar fecha, a de editar mantém-se e a sua linha diz porquê.
    setEliminarAberto(null);
    setFalhaDeFora({ texto: TEXTOS.servidorEliminar });
  }

  // --- Desenho --------------------------------------------------------------

  /** Uma frase de erro, ou `null`, se o aparelho não sabe que dia é em Lisboa (regra 10). */
  let semLisboa = false;
  let hoje = 0;
  try {
    hoje = diaDeLisboa(agora);
  } catch (erro) {
    // Só «este aparelho não conhece Lisboa»; qualquer outra falha é um defeito e sobe.
    if (!(erro instanceof ErroSemLisboa)) throw erro;
    semLisboa = true;
  }

  function notaDaLinha(evento: EventoGestao): string | null {
    if (evento.inicio === null) return null;
    const dia = diaDeLisboa(new Date(evento.inicio));
    if (!evento.publicado && dia < hoje) return TEXTOS.notaPassada;
    if (evento.publicado && dia === hoje) return TEXTOS.notaHoje;
    return null;
  }

  function linha(evento: EventoGestao, noArquivo: boolean): ReactElement {
    return (
      <LinhaDoEvento
        key={evento.id}
        evento={evento}
        agora={agora}
        noArquivo={noArquivo}
        ligado={otimistas.get(evento.id) ?? evento.publicado}
        interruptorParado={pendentes.has(evento.id) || evento.inicio === null}
        aDuplicar={aDuplicar.has(evento.id)}
        nota={notaDaLinha(evento)}
        registar={registar}
        aoAbrir={() => {
          setFolha({ tipo: "editar", evento });
        }}
        aoMudarPublicado={(ligado) => {
          void mudarPublicado(evento, ligado);
        }}
        aoDuplicar={() => {
          aoTocarEmDuplicar(evento);
        }}
      />
    );
  }

  const passadosAMostrar = lista.arquivo.slice(0, passadosVisiveis);
  const emFalta = lista.arquivo.length - passadosVisiveis;

  function mostrarMais(): void {
    const primeiraNova = lista.arquivo[passadosVisiveis];
    setPassadosVisiveis((n) => n + LINHAS_DO_ARQUIVO);
    if (primeiraNova !== undefined) pedirFoco(`titulo-${String(primeiraNova.id)}`);
  }

  const vazia =
    lista.proximos.length === 0 && lista.rascunhos.length === 0 && lista.arquivo.length === 0;

  let corpo: ReactElement;
  if (fase.estado === "a-carregar") {
    corpo = <Esqueleto />;
  } else if (fase.estado === "erro") {
    corpo = (
      <EstadoVazio
        tom="erro"
        titulo={TEXTOS.carregarTitulo}
        linha={fase.semResposta ? TEXTOS.carregarSemResposta : TEXTOS.carregarServidor}
      >
        <Botao
          aTrabalhar={fase.aTentar}
          textoATrabalhar={TEXTOS.aTentar}
          onClick={() => {
            setFase({ ...fase, aTentar: true });
            void carregar();
          }}
        >
          {TEXTOS.tentarOutraVez}
        </Botao>
      </EstadoVazio>
    );
  } else if (semLisboa) {
    corpo = <EstadoVazio tom="erro" titulo={TEXTOS.semLisboaTitulo} linha={TEXTOS.semLisboa} />;
  } else {
    corpo = (
      <>
        <section aria-labelledby={idDosProximos} className={CAMADA}>
          <h2 id={idDosProximos} className="text-seccao font-forte text-texto">
            {TEXTOS.proximos}
          </h2>
          {lista.proximos.length === 0 ? (
            vazia ? (
              // Só um 200 com as três listas vazias chega aqui (nunca um erro). Sem botão:
              // «Novo evento» já está por cima. «Próximos» desenha-se sempre, e é nela que
              // o vazio se diz.
              <EstadoVazio titulo={TEXTOS.vazioTitulo} linha={TEXTOS.vazioLinha} />
            ) : (
              <p className="text-corpo text-texto">{TEXTOS.proximosVazios}</p>
            )
          ) : (
            <>
              <p className="text-nota text-texto-suave">{TEXTOS.linhaDosProximos}</p>
              <ul>
                {lista.proximos.flatMap((evento, indice) => {
                  const itens = [linha(evento, false)];
                  // Entre a terceira e a quarta: onde o site corta.
                  if (indice === QUANTOS_O_SITE_MOSTRA - 1 && lista.proximos.length > indice + 1) {
                    itens.push(
                      <li
                        key="divisoria"
                        aria-label={TEXTOS.divisoria}
                        className="border-t border-fio-interno py-3 text-nota text-texto"
                      >
                        {TEXTOS.divisoria}
                      </li>,
                    );
                  }
                  return itens;
                })}
              </ul>
            </>
          )}
        </section>

        {lista.rascunhos.length > 0 && (
          <section aria-labelledby={idDosRascunhos} className={CAMADA}>
            <h2 id={idDosRascunhos} className="text-seccao font-forte text-texto">
              {TEXTOS.rascunhos}
            </h2>
            <p className="text-nota text-texto-suave">{TEXTOS.linhaDosRascunhos}</p>
            <ul>{lista.rascunhos.map((evento) => linha(evento, false))}</ul>
          </section>
        )}

        {lista.arquivo.length > 0 && (
          <section aria-labelledby={idDoTituloDoArquivo} className={CAMADA}>
            <h2 id={idDoTituloDoArquivo} className="text-seccao font-forte text-texto">
              {TEXTOS.arquivo}
            </h2>
            <BotaoDoArquivo
              ref={(no) => {
                registar("arquivo")(no);
              }}
              aberto={passadosAbertos}
              total={lista.arquivo.length}
              idDaLista={idDoArquivo}
              aoTocar={() => {
                setPassadosAbertos((a) => !a);
              }}
            />
            {passadosAbertos && (
              <>
                <ul id={idDoArquivo}>{passadosAMostrar.map((evento) => linha(evento, true))}</ul>
                {emFalta > 0 && (
                  <Botao larguraTotal onClick={mostrarMais}>
                    {TEXTOS.mostrarMais(Math.min(LINHAS_DO_ARQUIVO, emFalta))}
                  </Botao>
                )}
              </>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
        {TEXTOS.titulo}
      </h1>

      <div className="flex flex-col gap-4">
        <div>
          <Botao
            ref={(no) => {
              registar("novo")(no);
            }}
            // Sem a hora de Lisboa a folha não escreve datas: o ecrã diz-o e não abre.
            desativado={semLisboa}
            onClick={() => {
              if (semLisboa) return;
              setFalhaDeFora(null);
              setFolha({ tipo: "criar" });
            }}
          >
            {TEXTOS.novoEvento}
          </Botao>
        </div>

        {desatualizada !== null && fase.estado === "pronta" && (
          <div role="status" className="flex flex-col items-start gap-3 text-nota text-erro">
            <p>{TEXTOS.recarregarFalhou}</p>
            <p>
              {desatualizada.semResposta ? TEXTOS.recarregarSemResposta : TEXTOS.recarregarServidor}
            </p>
            <Botao
              aTrabalhar={desatualizada.aTentar}
              textoATrabalhar={TEXTOS.aTentar}
              onClick={() => {
                setDesatualizada({ ...desatualizada, aTentar: true });
                void recarregar();
              }}
            >
              {TEXTOS.atualizar}
            </Botao>
          </div>
        )}

        {corpo}
      </div>

      <FolhaDoEvento
        modo={folha}
        agora={agora}
        falhaDeFora={falhaDeFora}
        aoFechar={fecharFolha}
        aoCriar={criar}
        aoEditar={editar}
        aoPedirEliminar={(evento) => {
          setEliminarAberto(evento);
        }}
      />

      <FolhaDuplicar
        evento={duplicarAberto}
        agora={agora}
        escolhida={duplicarEscolhida}
        aoEscolher={(semanas) => {
          if (duplicarAberto !== null) void duplicar(duplicarAberto, semanas);
        }}
        aoFechar={() => {
          setDuplicarAberto(null);
        }}
      />

      <FolhaEliminarEvento
        evento={eliminarAberto}
        agora={agora}
        aEliminar={aEliminar}
        aoCancelar={() => {
          setEliminarAberto(null);
        }}
        aoConfirmar={() => {
          void confirmarEliminar();
        }}
      />

      <div className="aviso-sobre-a-barra-da-gestao">
        <AvisoTemporario
          tipo={aviso?.tipo ?? "sucesso"}
          {...(aviso !== null ? { mensagem: aviso.mensagem } : {})}
          {...(aviso?.aoDesfazer !== undefined
            ? {
                aoDesfazer: () => {
                  aviso.aoDesfazer?.();
                },
              }
            : {})}
          aoFechar={() => {
            setAviso(null);
          }}
        />
      </div>
    </>
  );
}
