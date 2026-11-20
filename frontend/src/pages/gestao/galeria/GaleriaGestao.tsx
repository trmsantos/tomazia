import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { AvisoTemporario } from "../../../components/ui/AvisoTemporario";
import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../../lib/api/cliente";
import {
  aprovarFoto,
  obterFilaDeModeracao,
  rejeitarFoto,
  type FotoPendente,
} from "../../../lib/api/gestao-fotos";
import { obterGaleria } from "../../../lib/api/publico";
import { armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { FolhaEnviarFotoDoDono, type ResultadoDoEnvio } from "./FolhaEnviarFotoDoDono";
import { FolhaRejeitarFoto } from "./FolhaRejeitarFoto";
import { FotoEmModeracao, type FaseDaImagem, type LinhaDeEstado } from "./FotoEmModeracao";
import {
  INTERVALO_CONTRA_DUPLO_TOQUE_MS,
  atual,
  contagem,
  resolverDesfecho,
  retirar,
  seguinte,
  substituir,
  type Pedido,
} from "./estado-da-fila";
import { quandoFoiEnviada } from "./quando-foi-enviada";
import { TEXTOS } from "./textos";

/**
 * O destino «Galeria» da gestão (F4-04): a fila de fotos à espera, **uma de cada vez**, da mais
 * antiga para a mais recente. Aprovar custa um toque; rejeitar dois (a folha «Tem a certeza?»);
 * a foto seguinte aparece logo, já descarregada. Mais enviar uma foto do bar.
 *
 * É o dono do estado: a fila local, o único `AvisoTemporario` da página (para a F4-04b o
 * partilhar), as folhas e os pedidos. Compõe **secções irmãs**: a da fila e, a seguir a ela, a
 * F4-04b acrescenta a sua sem mexer na fila.
 *
 * Regras que atravessam o ecrã:
 *  - **Nada é otimista**: a foto só avança depois da resposta. Sem resposta o ecrã não sabe, e
 *    vai ver (a fila e a galeria pública dizem o que aconteceu); **nunca repete um `POST`**.
 *  - **Uma fila vazia só se diz depois de um `GET` que a confirme**: rede, 5xx, um corpo ilegível
 *    ou um `criada_em` que não se sabe ler são o erro de carregar, nunca «não há fotos».
 *  - **O `onError` da imagem não decide** (não distingue 401, 404 e rede): dispara a verificação.
 *  - **O risco número um** é aprovar a foto que ainda não se viu (aparece debaixo do dedo que
 *    acabou de aprovar): os botões ficam inertes até a imagem carregar e passar
 *    `INTERVALO_CONTRA_DUPLO_TOQUE_MS`, e o foco vai ao título, nunca a um botão.
 *  - A leitura aborta ao desmontar; as mutações **não** (um pedido de moderar a meio chega ao fim).
 */

/** Os avisos de moderar duram 3 s: o aviso de 5 s cobria os botões da foto seguinte (spec 5.1). */
const DURACAO_DO_AVISO_DE_MODERAR_MS = 3_000;

type Aviso = { tipo: "sucesso" | "erro"; mensagem: string; duracaoMs?: number };
type Carga = "a-carregar" | "ok" | "erro";
type Resultado = "aprovada" | "rejeitada";

/** O que se está a fazer à foto atual (`a-enviar` é o pedido; os outros, a verificação). */
type Ocupado = {
  pedido: Pedido;
  foto: FotoPendente;
  fase: "a-enviar" | "a-verificar" | "sem-confirmar";
  /** O pedido não teve resposta: só então se diz «não consegui confirmar» (um 409 não diz). */
  semResposta: boolean;
};

type Leitura =
  | { tipo: "ok"; fotos: FotoPendente[] }
  | { tipo: "cancelada" }
  | { tipo: "sessao" }
  | { tipo: "erro"; semResposta: boolean };

/** Como se aplica uma leitura: `inicial` mostra o erro; `silencioso` nunca tira a foto à vista. */
type Modo = "inicial" | "silencioso";

export function GaleriaGestao(): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const idDoTitulo = useId();

  const [carga, setCarga] = useState<Carga>("a-carregar");
  const [cargaSemResposta, setCargaSemResposta] = useState(false);
  const [aTentar, setATentar] = useState(false);
  const [fila, setFilaDoEstado] = useState<FotoPendente[]>([]);
  const [agora, setAgora] = useState(() => new Date());
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [linha, setLinha] = useState<LinhaDeEstado | null>(null);
  const [ocupado, setOcupado] = useState<Ocupado | null>(null);
  const [rejeitarAberta, setRejeitarAberta] = useState(false);
  const [rejeitarFalhou, setRejeitarFalhou] = useState(false);
  const [enviarAberta, setEnviarAberta] = useState(false);
  // A imagem atual: a fase (9.5) e a `key` que a remonta. Só vale para a foto `id`.
  const [imagem, setImagem] = useState<{ id: number; fase: FaseDaImagem; chave: number }>({
    id: 0,
    fase: "ok",
    chave: 0,
  });
  // As imagens que já carregaram (`id-chave`) e aquela cujo intervalo contra o duplo toque passou.
  const [carregadas, setCarregadas] = useState<ReadonlySet<string>>(new Set());
  const [libertada, setLibertada] = useState<string | null>(null);
  // Um objeto novo a cada pedido de foco: o mesmo alvo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<{ alvo: "titulo" | "vazio" } | null>(null);

  const titulo = useRef<HTMLHeadingElement>(null);
  const vazio = useRef<HTMLDivElement>(null);

  /** A fila **de agora**, para quem corre depois de um `await` (o estado do render já é velho). */
  const filaAgora = useRef<FotoPendente[]>([]);
  const aoPerderSessaoAgora = useRef(aoPerderSessao);
  const leituras = useRef(new Set<AbortController>());
  const vivo = useRef(true);
  const moderando = useRef(false);
  const aTentarAgora = useRef(false);
  /** Fotos que já saíram da fila: nenhuma leitura atrasada as volta a pôr. */
  const moderadas = useRef(new Set<number>());
  /** Fotos pré-carregadas cuja imagem falhou antes de chegarem à frente. */
  const falhadas = useRef(new Set<number>());

  useEffect(() => {
    aoPerderSessaoAgora.current = aoPerderSessao;
  });

  function guardarFila(nova: FotoPendente[]): void {
    filaAgora.current = nova;
    setFilaDoEstado(nova);
  }

  // --- Ler a fila -------------------------------------------------------------

  /** `GET /gestao/fotos`, com prazo e cancelável. Nunca lança: devolve o que aconteceu. */
  async function ler(): Promise<Leitura> {
    const controlador = new AbortController();
    leituras.current.add(controlador);
    const desarmar = armarPrazo(controlador);
    try {
      const resposta = await obterFilaDeModeracao({ sinal: controlador.signal });
      const fotos: unknown = resposta.fotos;
      if (!Array.isArray(fotos)) return { tipo: "erro", semResposta: false };
      // Uma foto que o ecrã não saiba escrever (um `criada_em` ilegível, um aparelho sem Lisboa)
      // é erro de carregar: nunca uma lista vazia nem um ecrã a rebentar.
      const hoje = new Date();
      for (const foto of fotos as FotoPendente[]) quandoFoiEnviada(foto.criada_em, hoje);
      return {
        tipo: "ok",
        fotos: (fotos as FotoPendente[]).filter((f) => !moderadas.current.has(f.id)),
      };
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

  /** Aplica uma leitura à fila. Devolve `true` se a fila ficou à vista (um `200`). */
  function aplicar(leitura: Leitura, modo: Modo): boolean {
    if (!vivo.current || leitura.tipo === "cancelada") return false;
    if (leitura.tipo === "sessao") {
      aoPerderSessaoAgora.current();
      return false;
    }
    if (leitura.tipo === "erro") {
      if (modo === "inicial") {
        setCargaSemResposta(leitura.semResposta);
        setCarga("erro");
      }
      // Uma recarga silenciosa que falha não tira a foto: a que está à vista continua válida.
      return false;
    }
    guardarFila(
      modo === "silencioso" ? substituir(filaAgora.current, leitura.fotos) : leitura.fotos,
    );
    setCarga("ok");
    return true;
  }

  /** A recarga em silêncio: voltar à aba, depois de um 404 e depois de um envio. */
  async function recarregarEmSilencio(): Promise<void> {
    const vaziaAntes = filaAgora.current.length === 0;
    const leitura = await ler();
    // Com a fila vazia não há foto à vista para proteger: mostra-se o erro, não um vazio velho.
    const vista = aplicar(leitura, vaziaAntes ? "inicial" : "silencioso");
    if (vista && vaziaAntes && filaAgora.current.length > 0) pedirFoco("titulo");
  }

  useEffect(() => {
    vivo.current = true;
    void ler().then((leitura) => {
      aplicar(leitura, "inicial");
    });

    const aoVoltar = (): void => {
      if (document.visibilityState !== "visible") return;
      setAgora(new Date());
      setLinha(null);
      void ler().then((leitura) => {
        aplicar(leitura, "silencioso");
      });
    };
    document.addEventListener("visibilitychange", aoVoltar);

    const aMeter = leituras.current;
    return () => {
      vivo.current = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      // A leitura aborta ao desmontar; as mutações não.
      aMeter.forEach((controlador) => {
        controlador.abort();
      });
    };
    // Corre uma vez: `ler` e `aplicar` só leem referências e setters estáveis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function carregarDeNovo(): void {
    if (aTentarAgora.current) return;
    aTentarAgora.current = true;
    setATentar(true);
    void ler().then((leitura) => {
      aTentarAgora.current = false;
      setATentar(false);
      aplicar(leitura, "inicial");
    });
  }

  // --- A foto à vista ---------------------------------------------------------

  const foto = atual(fila);
  const proxima = seguinte(fila);
  const daImagem = foto !== null && imagem.id === foto.id ? imagem : null;
  const fase: FaseDaImagem = daImagem?.fase ?? "ok";
  const chave = daImagem?.chave ?? 0;
  const chaveAtual = foto === null ? "" : `${String(foto.id)}-${String(chave)}`;
  const carregou = carregadas.has(chaveAtual);

  // O intervalo conta desde o mais tardio de «ficou visível» e «carregou»: muda a chave ou a
  // imagem carrega e o tempo recomeça. `libertada` guarda **a chave** que já esperou, por isso
  // uma foto nova nunca herda o «já passou» da anterior (nem por um render).
  useEffect(() => {
    if (!carregou) return;
    const temporizador = setTimeout(() => {
      setLibertada(chaveAtual);
    }, INTERVALO_CONTRA_DUPLO_TOQUE_MS);
    return () => {
      clearTimeout(temporizador);
    };
  }, [chaveAtual, carregou]);

  const pronta = carregou && libertada === chaveAtual;

  function aoCarregarImagem(id: number, deChave: number): void {
    const k = `${String(id)}-${String(deChave)}`;
    setCarregadas((antes) => (antes.has(k) ? antes : new Set(antes).add(k)));
  }

  function pedirFoco(alvo: "titulo" | "vazio"): void {
    setFoco({ alvo });
  }

  // Só depois de o React ter assentado a foto nova; nunca dentro de uma promessa. O foco vai ao
  // título, e **nunca** a Aprovar nem a Rejeitar: seria um `Enter` acidental a aprovar o que
  // ainda ninguém viu.
  useEffect(() => {
    if (foco === null) return;
    (foco.alvo === "vazio" ? vazio.current : titulo.current)?.focus();
  }, [foco]);

  /**
   * Depois de moderar (ou de a foto sair por outro motivo): a fila passa à seguinte **sem novo
   * `GET`**. Se ficou vazia faz-se um `GET` antes de o dizer, a não ser que a lista já tenha
   * vindo do servidor (`confirmada`): podem ter chegado fotos, e «vazia» só se diz com o
   * servidor a dizê-lo.
   */
  function avancarCom(nova: FotoPendente[], confirmada: boolean): void {
    guardarFila(nova);
    if (nova.length > 0) {
      pedirFoco("titulo");
      return;
    }
    if (confirmada) {
      setCarga("ok");
      pedirFoco("vazio");
      return;
    }
    setCarga("a-carregar");
    void ler().then((leitura) => {
      if (aplicar(leitura, "inicial")) {
        pedirFoco(filaAgora.current.length > 0 ? "titulo" : "vazio");
      }
    });
  }

  function moderada(id: number): void {
    moderadas.current.add(id);
  }

  // --- Moderar ----------------------------------------------------------------

  /** Diz o que aconteceu à foto: o aviso se coincide com o que o dono pediu, a linha se não. */
  function dizerOResultado(pedido: Pedido, resultado: Resultado): void {
    const coincide = (pedido === "aprovar") === (resultado === "aprovada");
    if (coincide) {
      setLinha(null);
      setAviso({
        tipo: "sucesso",
        mensagem: resultado === "aprovada" ? TEXTOS.avisoAprovada : TEXTOS.avisoRejeitada,
        duracaoMs: DURACAO_DO_AVISO_DE_MODERAR_MS,
      });
    } else {
      setAviso(null);
      setLinha({
        texto:
          resultado === "rejeitada" ? TEXTOS.outroAparelhoRejeitada : TEXTOS.outroAparelhoAprovada,
        erro: false,
      });
    }
  }

  /**
   * «Não sei se resultou» e o 409: a fila e a galeria pública dizem o que aconteceu. Nunca repete o
   * `POST`. `semResposta` só é verdade quando o pedido não teve resposta: é o que decide se o
   * ecrã diz «Não consegui confirmar…» enquanto verifica (um 409 não diz).
   */
  async function verificar(
    alvo: FotoPendente,
    pedido: Pedido,
    semResposta: boolean,
  ): Promise<void> {
    setOcupado({ pedido, foto: alvo, fase: "a-verificar", semResposta });
    const naFilaDe = await ler();
    if (!vivo.current || naFilaDe.tipo === "cancelada") return;
    if (naFilaDe.tipo === "sessao") {
      moderando.current = false;
      setOcupado(null);
      aoPerderSessaoAgora.current();
      return;
    }
    if (naFilaDe.tipo === "erro") {
      setOcupado({ pedido, foto: alvo, fase: "sem-confirmar", semResposta });
      return;
    }

    if (naFilaDe.fotos.some((f) => f.id === alvo.id)) {
      // A foto continua pendente: nada aconteceu. Tocar outra vez é seguro (o servidor dá 409 a
      // uma segunda moderação, nunca a repete).
      guardarFila(substituir(filaAgora.current, naFilaDe.fotos));
      moderando.current = false;
      setOcupado(null);
      setLinha({
        texto: pedido === "aprovar" ? TEXTOS.continuaAprovar : TEXTOS.continuaRejeitar,
        erro: false,
      });
      return;
    }

    let naGaleria = false;
    const controlador = new AbortController();
    leituras.current.add(controlador);
    const desarmar = armarPrazo(controlador);
    try {
      const galeria = await obterGaleria({ sinal: controlador.signal });
      naGaleria = galeria.fotos.some((f) => f.id === alvo.id);
    } catch (erro) {
      if (!vivo.current || (controlador.signal.aborted && !(erro instanceof ErroDaApi))) return;
      if (erro instanceof ErroDaApi && erro.estado === 401) {
        moderando.current = false;
        setOcupado(null);
        aoPerderSessaoAgora.current();
        return;
      }
      setOcupado({ pedido, foto: alvo, fase: "sem-confirmar", semResposta });
      return;
    } finally {
      desarmar();
      leituras.current.delete(controlador);
    }
    if (!vivo.current) return;

    const desfecho = resolverDesfecho(pedido, false, naGaleria);
    if (desfecho === "nada") return;
    moderada(alvo.id);
    moderando.current = false;
    setOcupado(null);
    setRejeitarAberta(false);
    setRejeitarFalhou(false);
    dizerOResultado(pedido, desfecho);
    avancarCom(substituir(retirar(filaAgora.current, alvo.id), naFilaDe.fotos), true);
  }

  async function moderar(pedido: Pedido): Promise<void> {
    const alvo = atual(filaAgora.current);
    if (alvo === null || moderando.current) return;
    moderando.current = true;
    setLinha(null);
    setAviso(null);
    setRejeitarFalhou(false);
    setOcupado({ pedido, foto: alvo, fase: "a-enviar", semResposta: false });

    // Sem `armarPrazo` ligado ao desmontar: o pedido de moderar não aborta ao sair do ecrã.
    const controlador = new AbortController();
    const desarmar = armarPrazo(controlador);
    try {
      await (pedido === "aprovar" ? aprovarFoto : rejeitarFoto)(alvo.id, {
        sinal: controlador.signal,
      });
    } catch (erro) {
      desarmar();
      if (!vivo.current) {
        moderando.current = false;
        return;
      }
      await aoFalharAModerar(alvo, pedido, erro);
      return;
    }
    desarmar();
    if (!vivo.current) {
      moderando.current = false;
      return;
    }

    moderada(alvo.id);
    moderando.current = false;
    setOcupado(null);
    setRejeitarAberta(false);
    dizerOResultado(pedido, pedido === "aprovar" ? "aprovada" : "rejeitada");
    avancarCom(retirar(filaAgora.current, alvo.id), false);
  }

  async function aoFalharAModerar(
    alvo: FotoPendente,
    pedido: Pedido,
    erro: unknown,
  ): Promise<void> {
    if (erro instanceof ErroDaApi && erro.estado === 401) {
      moderando.current = false;
      setOcupado(null);
      aoPerderSessaoAgora.current();
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === 409) {
      // Outro aparelho moderou-a: é informação, não erro. A verificação diz o que ficou.
      setRejeitarAberta(false);
      await verificar(alvo, pedido, false);
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === 404) {
      moderada(alvo.id);
      moderando.current = false;
      setOcupado(null);
      setRejeitarAberta(false);
      setAviso(null);
      setLinha({ texto: TEXTOS.jaNaoExistia, erro: false });
      const nova = retirar(filaAgora.current, alvo.id);
      avancarCom(nova, false);
      if (nova.length > 0) void recarregarEmSilencio();
      return;
    }
    if (erro instanceof ErroDaApi && erro.estado === null) {
      // Sem resposta: não se sabe. A folha fecha e o ecrã vai ver (nunca reenvia).
      setRejeitarAberta(false);
      await verificar(alvo, pedido, true);
      return;
    }
    // 5xx, 403, outro: a foto fica e os botões voltam. Não se diz «não foi aprovada»: um 504 de
    // um intermediário pode vir depois de o servidor ter agido; tocar outra vez é seguro.
    moderando.current = false;
    setOcupado(null);
    if (pedido === "aprovar") setLinha({ texto: TEXTOS.aprovarServidor, erro: true });
    else setRejeitarFalhou(true);
  }

  // --- A imagem não carrega ---------------------------------------------------

  /** O `onError` não decide (não distingue 401, 404 e rede): pergunta à fila. */
  async function verificarImagem(
    alvo: FotoPendente,
    deFase: FaseDaImagem,
    deChave: number,
  ): Promise<void> {
    if (deFase === "repetir") {
      // A segunda tentativa falhou também: só se pode rejeitar (D3).
      setImagem({ id: alvo.id, fase: "nao-se-mostra", chave: deChave });
      return;
    }
    setImagem({ id: alvo.id, fase: "verificando", chave: deChave });
    const leitura = await ler();
    if (!vivo.current || leitura.tipo === "cancelada") return;
    if (leitura.tipo === "sessao") {
      aoPerderSessaoAgora.current();
      return;
    }
    if (leitura.tipo === "erro") {
      setImagem({ id: alvo.id, fase: "sem-ligacao", chave: deChave });
      return;
    }
    if (leitura.fotos.some((f) => f.id === alvo.id)) {
      // Continua pendente: tenta a imagem **uma** vez mais, num nó novo.
      setImagem({ id: alvo.id, fase: "repetir", chave: deChave + 1 });
      return;
    }
    moderada(alvo.id);
    setLinha({ texto: TEXTOS.jaModerada, erro: false });
    avancarCom(substituir(retirar(filaAgora.current, alvo.id), leitura.fotos), true);
  }

  function aoFalharImagem(id: number, visivel: boolean): void {
    if (!visivel) {
      // A pré-carregada que falha não pede nada à fila: regista-se, e se chegar à frente
      // verifica-se (nunca se aprova às cegas nem se mostra o ícone de imagem partida).
      falhadas.current.add(id);
      return;
    }
    if (foto === null || foto.id !== id) return;
    void verificarImagem(foto, fase, chave);
  }

  const idDaFotoAtual = foto?.id ?? null;
  useEffect(() => {
    if (idDaFotoAtual === null || !falhadas.current.has(idDaFotoAtual)) return;
    falhadas.current.delete(idDaFotoAtual);
    const alvo = atual(filaAgora.current);
    if (alvo !== null && alvo.id === idDaFotoAtual) void verificarImagem(alvo, "ok", 0);
    // `verificarImagem` só lê referências e setters estáveis; só a foto à frente dispara isto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idDaFotoAtual]);

  // --- Enviar uma foto do bar -------------------------------------------------

  function aoTerminarOEnvio(resultado: ResultadoDoEnvio): void {
    setEnviarAberta(false);
    setLinha(null);
    setAviso(
      resultado === "enviada"
        ? { tipo: "sucesso", mensagem: TEXTOS.fotoEnviada }
        : { tipo: "erro", mensagem: TEXTOS.envioSemSaber },
    );
    // Com o `202` ou sem resposta, vai-se ver à fila: a foto entra no fim (ou já, se estava vazia).
    void recarregarEmSilencio();
  }

  // --- O que está inerte ------------------------------------------------------

  const aVerificarOuSemLigacao = fase === "verificando" || fase === "sem-ligacao";
  const semImagem = fase === "nao-se-mostra";
  const aMeio = ocupado !== null || rejeitarAberta;
  const base = foto === null || aMeio || aVerificarOuSemLigacao;
  // D3: uma foto cuja imagem não se mostra nunca se aprova (uma aprovada sem bytes dava uma
  // imagem partida no site), mas rejeita-se.
  const aprovarInerte = base || semImagem || !pronta;
  const rejeitarInerte = base || (!semImagem && !pronta);

  // --- A linha de estado ------------------------------------------------------

  let linhaVisivel: LinhaDeEstado | null = linha;
  if (ocupado?.fase === "a-verificar" && ocupado.semResposta) {
    linhaVisivel = {
      texto: ocupado.pedido === "aprovar" ? TEXTOS.verificarAprovada : TEXTOS.verificarRejeitada,
      erro: false,
    };
  } else if (ocupado?.fase === "sem-confirmar") {
    linhaVisivel = {
      texto:
        ocupado.pedido === "aprovar" ? TEXTOS.semConfirmarAprovada : TEXTOS.semConfirmarRejeitada,
      erro: false,
    };
  } else if (fase === "verificando") {
    linhaVisivel = { texto: TEXTOS.aVerificarFoto, erro: false };
  }

  // --- Desenho ----------------------------------------------------------------

  const aAprovar = ocupado?.fase === "a-enviar" && ocupado.pedido === "aprovar";
  const aRejeitar = ocupado?.fase === "a-enviar" && ocupado.pedido === "rejeitar";

  let corpo: ReactElement;
  if (carga === "a-carregar") {
    // O esqueleto não tem texto (F3-01 7.7): a caixa da foto e duas barras.
    corpo = (
      <div aria-busy="true" className="flex flex-col gap-3 lg:w-3/5">
        <div className="aspect-foto w-full rounded-cartao bg-fio-interno" />
        <div className="h-4 w-3/4 rounded-pequeno bg-fio-interno" />
        <div className="h-4 w-1/2 rounded-pequeno bg-fio-interno" />
      </div>
    );
  } else if (carga === "erro") {
    corpo = (
      <EstadoVazio
        tom="erro"
        titulo={TEXTOS.carregarTitulo}
        linha={cargaSemResposta ? TEXTOS.carregarSemResposta : TEXTOS.carregarServidor}
      >
        <Botao aTrabalhar={aTentar} textoATrabalhar={TEXTOS.aTentar} onClick={carregarDeNovo}>
          {TEXTOS.tentarOutraVez}
        </Botao>
      </EstadoVazio>
    );
  } else if (foto === null) {
    // Só um `200` com a lista vazia chega aqui (nunca um erro, um cancelamento nem um corpo
    // ilegível). Sem botão: «Enviar foto» já está por cima.
    corpo = (
      <div ref={vazio} tabIndex={-1}>
        <EstadoVazio titulo={TEXTOS.vazioTitulo} linha={TEXTOS.vazioLinha} />
      </div>
    );
  } else {
    corpo = (
      <FotoEmModeracao
        foto={foto}
        seguinte={proxima}
        agora={agora}
        fase={fase}
        chave={chave}
        rejeitarInerte={rejeitarInerte}
        aprovarInerte={aprovarInerte || aAprovar}
        aAprovar={aAprovar}
        linha={linhaVisivel}
        aoVerificarOutraVez={
          ocupado?.fase === "sem-confirmar"
            ? () => {
                void verificar(ocupado.foto, ocupado.pedido, ocupado.semResposta);
              }
            : null
        }
        aoCarregarImagem={aoCarregarImagem}
        aoFalharImagem={aoFalharImagem}
        aoTentarImagemOutraVez={() => {
          setImagem({ id: foto.id, fase: "ok", chave: chave + 1 });
        }}
        aoRejeitar={() => {
          if (rejeitarInerte) return;
          setRejeitarFalhou(false);
          setRejeitarAberta(true);
        }}
        aoAprovar={() => {
          if (aprovarInerte) return;
          void moderar("aprovar");
        }}
      />
    );
  }

  const tituloDaFila =
    carga === "ok" && contagem(fila) > 0
      ? TEXTOS.fotosAEsperaN(contagem(fila))
      : TEXTOS.fotosAEspera;

  return (
    <>
      <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
        {TEXTOS.titulo}
      </h1>

      <div className="flex flex-col gap-4">
        <div>
          <Botao
            onClick={() => {
              setEnviarAberta(true);
            }}
          >
            {TEXTOS.enviarFoto}
          </Botao>
        </div>

        <section aria-labelledby={idDoTitulo} className="flex flex-col gap-3">
          <h2
            id={idDoTitulo}
            ref={titulo}
            tabIndex={-1}
            className="text-seccao font-forte text-texto"
          >
            {tituloDaFila}
          </h2>
          {corpo}
        </section>

        {/* A secção das aprovadas (F4-04b) entra aqui, a seguir à fila. */}
      </div>

      <FolhaRejeitarFoto
        foto={rejeitarAberta ? foto : null}
        agora={agora}
        semImagem={semImagem}
        aRejeitar={aRejeitar}
        falhou={rejeitarFalhou}
        aoConfirmar={() => {
          void moderar("rejeitar");
        }}
        aoFechar={() => {
          setRejeitarFalhou(false);
          setRejeitarAberta(false);
        }}
      />

      <FolhaEnviarFotoDoDono
        aberta={enviarAberta}
        aoFechar={() => {
          setEnviarAberta(false);
        }}
        aoTerminar={aoTerminarOEnvio}
      />

      <div className="aviso-sobre-a-barra-da-gestao">
        <AvisoTemporario
          tipo={aviso?.tipo ?? "sucesso"}
          {...(aviso !== null ? { mensagem: aviso.mensagem } : {})}
          {...(aviso?.duracaoMs !== undefined ? { duracaoMs: aviso.duracaoMs } : {})}
          aoFechar={() => {
            setAviso(null);
          }}
        />
      </div>
    </>
  );
}
