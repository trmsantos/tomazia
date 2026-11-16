import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AvisoTemporario } from "../../../components/ui/AvisoTemporario";
import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../../lib/api/cliente";
import {
  type AlteracaoDeProduto,
  alterarProduto,
  criarProduto,
  type NovoProduto,
  obterEmentaGestao,
  reordenarProdutos,
} from "../../../lib/api/gestao-ementa";
import { navegar, usePesquisa } from "../navegacao";
import { armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { avisoDoPreco } from "./aviso-do-preco";
import { CampoDaGestao } from "./CampoDaGestao";
import { CartaoDaCategoria } from "./CartaoDaCategoria";
import { ChipDaGestao } from "./ChipDaGestao";
import {
  acrescentarProduto,
  ordenarProdutosDaCategoria,
  reporDisponivel,
  substituirProduto,
} from "./estado-da-ementa";
import { FolhaDoProduto } from "./FolhaDoProduto";
import { executar as executarPedido, type Falha, type Resultado } from "./pedidos";
import { filtrarEmentaGestao, indexarEmentaGestao } from "./pesquisa-gestao";
import {
  avisoDeDisponivel,
  avisoDeDisponivelQueFicou,
  avisoDePrecoAtualizado,
  avisoDePrecoQueFicou,
  avisoDeSubida,
  encontrados,
  produtoMovidoPara,
  TEXTOS,
} from "./textos";
import type {
  CampoDaFolha,
  CategoriaGestao,
  ModoDaFolha,
  OrdemEmCurso,
  ProdutoGestao,
  Registar,
  ResultadoDaFolha,
  ResultadoDoPreco,
} from "./tipos";

/**
 * O destino «Ementa» da gestão (F4-02, `docs/ecras/F4-02.md`).
 *
 * É o dono do estado: a lista, a pesquisa, o único `AvisoTemporario` da página, o
 * preço em edição (um de cada vez), o modo «Ordenar» (um de cada vez) e a folha.
 * Os componentes por baixo são quase só desenho.
 *
 * **Regra 10, a que manda em tudo isto:**
 *  - «não consegui carregar» e «a ementa está vazia» nunca se desenham iguais: o
 *    vazio só vem de um `200` com `categorias: []`;
 *  - uma alteração **sem resposta** quer dizer «não sei se gravou»: o ecrã não
 *    finge, **nunca reenvia sozinho** (um `POST` repetido duplicava o produto) e
 *    recarrega a lista por baixo para mostrar o que o servidor tem;
 *  - um 4xx ou 5xx repõe o que se tinha, sem recarregar.
 *
 * O estado local muda pela **resposta** do servidor, nunca pelo que se escreveu.
 * Cada «Desfazer» é uma **compensação**: um pedido novo com o valor anterior,
 * absoluto, nunca um envio adiado.
 *
 * Um 401 em qualquer pedido chama `aoPerderSessao()`, que leva ao login e, depois
 * de entrar, de volta aqui (D4).
 */
type Fase =
  | { estado: "a-carregar" }
  | { estado: "pronta" }
  | { estado: "erro"; semResposta: boolean; aTentar: boolean };

type Aviso = { tipo: "sucesso" | "erro"; mensagem: string; aoDesfazer?: () => void };

/** A lista que se mostrou e já não se sabe se está certa (9.5). */
type Desatualizada = { semResposta: boolean; aTentar: boolean };

function Esqueleto(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" aria-hidden="true">
        {[0, 1, 2].map((n) => (
          <div key={n} className="min-h-toque w-1/4 rounded-pequeno bg-fio-interno" />
        ))}
      </div>
      <div
        aria-busy="true"
        className="superficie-painel flex flex-col gap-4 rounded-cartao border border-contorno-superficie p-4"
      >
        {["w-3/4", "w-1/2", "w-3/4", "w-1/2", "w-3/4"].map((largura, n) => (
          <div key={n} className={`h-4 rounded-pequeno bg-fio-interno ${largura}`} />
        ))}
      </div>
    </div>
  );
}

export function EmentaGestao(): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const pesquisaDoEndereco = usePesquisa();

  const [fase, setFase] = useState<Fase>({ estado: "a-carregar" });
  const [categorias, setCategorias] = useState<CategoriaGestao[]>([]);
  const [desatualizada, setDesatualizada] = useState<Desatualizada | null>(null);
  const [termo, setTermo] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [precoAberto, setPrecoAberto] = useState<number | null>(null);
  const [pendentes, setPendentes] = useState<ReadonlySet<number>>(new Set());
  const [ordem, setOrdem] = useState<OrdemEmCurso | null>(null);
  const [folha, setFolha] = useState<ModoDaFolha | null>(null);
  // Um objeto novo a cada pedido: o mesmo alvo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<{ chaves: string[] } | null>(null);

  const leitura = useRef<AbortController | null>(null);
  // Sobe a cada mutação confirmada: uma leitura que partiu antes de uma mutação
  // que entretanto teve sucesso traz dados velhos e não se aplica (5).
  const geracao = useRef(0);
  // Falso depois de desmontar: as mutações não se abortam e os ramos sem
  // resposta/404/409 pedem uma leitura que ninguém abortaria.
  const montada = useRef(false);
  const emVoo = useRef(new Set<number>());
  const alvos = useRef(new Map<string, HTMLElement>());

  // --- O foco ---------------------------------------------------------------

  /** Cada nó que o foco possa ter de reencontrar regista-se por uma chave. */
  const registar: Registar = (chave) => (no) => {
    if (no !== null) alvos.current.set(chave, no);
    else alvos.current.delete(chave);
  };

  // Depois de um pedido, o foco volta a um alvo que já existe no DOM. É um
  // efeito (passivo) e não uma chamada no fim do pedido por duas razões: o nó
  // pode ainda nem existir, e o `<dialog>` devolve o foco ao que o abriu quando
  // fecha — e os efeitos dos filhos (a `Folha`) correm antes dos do pai.
  useEffect(() => {
    if (foco === null) return;
    for (const chave of foco.chaves) {
      const no = alvos.current.get(chave);
      if (no?.isConnected === true) {
        no.focus();
        return;
      }
    }
  }, [foco]);

  const pedirFoco = useCallback((...chaves: string[]) => {
    setFoco({ chaves });
  }, []);

  /** Uma mutação; com sucesso, as leituras que já iam a caminho deixam de valer. */
  async function executar<T>(
    chamada: (opcoes: { sinal: AbortSignal }) => Promise<T>,
  ): Promise<Resultado<T>> {
    const r = await executarPedido(chamada);
    if (r.ok) geracao.current += 1;
    return r;
  }

  // --- Carregar -------------------------------------------------------------

  /**
   * `silencioso`: recarrega sem esqueleto (depois de um 404, de um 409, de uma
   * resposta que não veio). Se falhar, a lista que estava **mantém-se**, com a
   * linha que diz que pode estar desatualizada; nunca fica «a carregar».
   */
  const carregar = useCallback(
    (silencioso: boolean): void => {
      const ler = (): void => {
        if (!montada.current) return;
        leitura.current?.abort();
        const controlador = new AbortController();
        leitura.current = controlador;
        const desarmar = armarPrazo(controlador);
        const geracaoDaLeitura = geracao.current;

        obterEmentaGestao({ sinal: controlador.signal })
          .then((resposta) => {
            if (controlador.signal.aborted) return;
            if (geracaoDaLeitura !== geracao.current) {
              // Partiu antes de uma mutação confirmada: está velha. Lê-se outra vez.
              ler();
              return;
            }
            setCategorias(resposta.categorias);
            setFase({ estado: "pronta" });
            setDesatualizada(null);
          })
          .catch((erro: unknown) => {
            if (geracaoDaLeitura !== geracao.current && !controlador.signal.aborted) {
              ler();
              return;
            }
            // Desmontou, ou uma leitura mais nova ocupou o lugar: não é uma resposta.
            if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return;
            if (erro instanceof ErroDaApi && erro.estado === 401) {
              aoPerderSessao();
              return;
            }
            // Tudo o que não for «sem resposta» é do servidor — o nosso código a
            // rebentar incluído: nunca «a carregar» para sempre.
            const semResposta = erro instanceof ErroDaApi && erro.estado === null;
            if (silencioso) setDesatualizada({ semResposta, aTentar: false });
            else setFase({ estado: "erro", semResposta, aTentar: false });
          })
          .finally(desarmar);
      };
      ler();
    },
    [aoPerderSessao],
  );

  useEffect(() => {
    montada.current = true;
    carregar(false);
    return () => {
      montada.current = false;
      leitura.current?.abort();
    };
  }, [carregar]);

  // --- O que se vê ----------------------------------------------------------

  const indice = useMemo(() => indexarEmentaGestao(categorias), [categorias]);
  const comTermo = termo.trim() !== "";
  const resultado = useMemo(() => filtrarEmentaGestao(indice, termo), [indice, termo]);

  const slugDoEndereco = new URLSearchParams(pesquisaDoEndereco).get("categoria");
  const ativa = categorias.find((c) => c.slug === slugDoEndereco) ?? categorias[0];
  const visiveis: CategoriaGestao[] = comTermo ? resultado : ativa !== undefined ? [ativa] : [];
  const totalEncontrado = resultado.reduce((soma, c) => soma + c.produtos.length, 0);

  function irParaCategoria(categoria: CategoriaGestao): void {
    navegar(`/gestao/ementa?categoria=${encodeURIComponent(categoria.slug)}`, { substituir: true });
  }

  // --- Avisos e falhas ------------------------------------------------------

  /** `true` se era um 401 (já tratado: vai-se para o login). */
  function eSessao(falha: Falha): boolean {
    if (falha.tipo !== "sessao") return false;
    aoPerderSessao();
    return true;
  }

  function avisoDeErro(mensagem: string): void {
    setAviso({ tipo: "erro", mensagem });
  }

  /** A frase de «não consegui guardar», pelo que correu mal (nunca a `mensagem` do backend). */
  function fraseDeGuardar(falha: Falha): string {
    if (falha.tipo === "sem-resposta") return TEXTOS.erroGuardarSemResposta;
    if (falha.tipo === "invalido") return TEXTOS.erro422SemCampo;
    return TEXTOS.erroGuardarServidor;
  }

  // --- Preço ----------------------------------------------------------------

  /** O aviso de um preço guardado (D3): normal, oferta ou subida de 10 vezes ou mais. */
  function avisoDePreco(produto: ProdutoGestao, anterior: number): Aviso {
    const { tipo, comDesfazer } = avisoDoPreco(anterior, produto.preco_cent);
    const mensagem =
      tipo === "oferta"
        ? TEXTOS.avisoOferta
        : tipo === "subida"
          ? avisoDeSubida(produto.preco_cent, anterior)
          : avisoDePrecoAtualizado(produto.preco_cent);
    return {
      tipo: "sucesso",
      mensagem,
      ...(comDesfazer ? { aoDesfazer: () => void desfazerPreco(produto, anterior) } : {}),
    };
  }

  async function desfazerPreco(guardado: ProdutoGestao, anterior: number): Promise<void> {
    setAviso(null);
    const r = await executar((o) => alterarProduto(guardado.id, { preco_cent: anterior }, o));
    if (r.ok) {
      setCategorias((cs) => substituirProduto(cs, r.valor));
      setAviso({ tipo: "sucesso", mensagem: TEXTOS.alteracaoDesfeita });
      return;
    }
    if (eSessao(r.falha)) return;
    if (r.falha.tipo === "nao-existe") {
      avisoDeErro(TEXTOS.erro404Produto);
      carregar(true);
    } else if (r.falha.tipo === "sem-resposta") {
      // Não sei se desfez: mostra-se o que o servidor tem.
      avisoDeErro(TEXTOS.erroDesfazerSemResposta);
      carregar(true);
    } else {
      // O ecrã mostra o estado **confirmado** (o preço novo) e diz isso.
      avisoDeErro(avisoDePrecoQueFicou(guardado.preco_cent));
    }
  }

  async function guardarPreco(
    produto: ProdutoGestao,
    precoCent: number,
  ): Promise<ResultadoDoPreco> {
    const anterior = produto.preco_cent;
    const r = await executar((o) => alterarProduto(produto.id, { preco_cent: precoCent }, o));
    if (r.ok) {
      setCategorias((cs) => substituirProduto(cs, r.valor));
      setPrecoAberto(null);
      pedirFoco(`preco-${String(produto.id)}`);
      setAviso(avisoDePreco(r.valor, anterior));
      return { tipo: "ok" };
    }
    if (eSessao(r.falha)) return { tipo: "ok" };

    if (r.falha.tipo === "nao-existe") {
      setPrecoAberto(null);
      avisoDeErro(TEXTOS.erro404Produto);
      carregar(true);
      return { tipo: "ok" };
    }
    if (r.falha.tipo === "sem-resposta") carregar(true);
    if (r.falha.tipo === "invalido") {
      return {
        tipo: "erro",
        texto: r.falha.campo === "preco_cent" ? TEXTOS.erroPreco422 : TEXTOS.erro422SemCampo,
      };
    }
    return { tipo: "erro", texto: fraseDeGuardar(r.falha) };
  }

  // --- «Disponível» ---------------------------------------------------------

  function marcarPendente(id: number, a: boolean): void {
    if (a) emVoo.current.add(id);
    else emVoo.current.delete(id);
    setPendentes(new Set(emVoo.current));
  }

  async function desfazerDisponivel(guardado: ProdutoGestao): Promise<void> {
    setAviso(null);
    // Um pedido de cada vez por produto, como no caminho normal: dois PATCH
    // cruzados podiam chegar por ordem trocada.
    if (emVoo.current.has(guardado.id)) return;
    marcarPendente(guardado.id, true);
    const anterior = !guardado.disponivel;
    const r = await executar((o) => alterarProduto(guardado.id, { disponivel: anterior }, o));
    marcarPendente(guardado.id, false);
    if (r.ok) {
      setCategorias((cs) => substituirProduto(cs, r.valor));
      setAviso({ tipo: "sucesso", mensagem: TEXTOS.alteracaoDesfeita });
      return;
    }
    if (eSessao(r.falha)) return;
    if (r.falha.tipo === "nao-existe") {
      avisoDeErro(TEXTOS.erro404Produto);
      carregar(true);
    } else if (r.falha.tipo === "sem-resposta") {
      avisoDeErro(TEXTOS.erroDesfazerSemResposta);
      carregar(true);
    } else {
      avisoDeErro(avisoDeDisponivelQueFicou(guardado.nome, guardado.disponivel));
    }
  }

  async function mudarDisponivel(produto: ProdutoGestao, ligado: boolean): Promise<void> {
    if (emVoo.current.has(produto.id)) return;
    marcarPendente(produto.id, true);
    // Otimista: o interruptor muda já. Se falhar, volta ao que tinha.
    setCategorias((cs) => reporDisponivel(cs, produto.id, ligado));

    const r = await executar((o) => alterarProduto(produto.id, { disponivel: ligado }, o));
    marcarPendente(produto.id, false);

    if (r.ok) {
      setCategorias((cs) => substituirProduto(cs, r.valor));
      setAviso({
        tipo: "sucesso",
        mensagem: avisoDeDisponivel(r.valor.nome, r.valor.disponivel),
        aoDesfazer: () => void desfazerDisponivel(r.valor),
      });
      return;
    }

    // Repõe só o campo `disponivel`, no item que o estado tem agora: um preço ou
    // um nome guardados entretanto não se apagam.
    setCategorias((cs) => reporDisponivel(cs, produto.id, produto.disponivel));
    if (eSessao(r.falha)) return;
    if (r.falha.tipo === "nao-existe") {
      avisoDeErro(TEXTOS.erro404Produto);
      carregar(true);
      return;
    }
    avisoDeErro(fraseDeGuardar(r.falha));
    if (r.falha.tipo === "sem-resposta") carregar(true);
  }

  // --- Ordenar --------------------------------------------------------------

  function abrirOrdenar(categoria: CategoriaGestao): void {
    setPrecoAberto(null);
    setOrdem({
      categoriaId: categoria.id,
      ids: categoria.produtos.map((p) => p.id),
      aGuardar: false,
    });
  }

  function fecharOrdenar(): void {
    setOrdem(null);
    pedirFoco("ordenar", "titulo");
  }

  async function desfazerOrdem(categoriaId: number, anteriores: number[]): Promise<void> {
    setAviso(null);
    const r = await executar((o) => reordenarProdutos(categoriaId, anteriores, o));
    if (r.ok) {
      setCategorias((cs) => ordenarProdutosDaCategoria(cs, categoriaId, anteriores));
      setAviso({ tipo: "sucesso", mensagem: TEXTOS.alteracaoDesfeita });
      return;
    }
    if (eSessao(r.falha)) return;
    if (r.falha.tipo === "conflito" || r.falha.tipo === "nao-existe") {
      // A lista de antes já não é a lista completa: não se tenta corrigi-la. Mostra-se a de agora.
      avisoDeErro(TEXTOS.erroDesfazerOrdem409);
      carregar(true);
    } else if (r.falha.tipo === "sem-resposta") {
      avisoDeErro(TEXTOS.erroDesfazerSemResposta);
      carregar(true);
    } else {
      // A ordem nova continua guardada (o ecrã nunca a largou).
      avisoDeErro(TEXTOS.erroDesfazerOrdemServidor);
    }
  }

  async function guardarOrdem(categoria: CategoriaGestao): Promise<void> {
    if (ordem === null || ordem.aGuardar) return;
    const anteriores = categoria.produtos.map((p) => p.id);
    const novos = ordem.ids;

    // Sem movimentos: fecha sem pedido e sem aviso.
    if (novos.length === anteriores.length && novos.every((id, i) => id === anteriores[i])) {
      fecharOrdenar();
      return;
    }

    setOrdem({ ...ordem, aGuardar: true });
    const r = await executar((o) => reordenarProdutos(categoria.id, novos, o));

    if (r.ok) {
      setCategorias((cs) => ordenarProdutosDaCategoria(cs, categoria.id, novos));
      fecharOrdenar();
      setAviso({
        tipo: "sucesso",
        mensagem: TEXTOS.ordemGuardada,
        aoDesfazer: () => void desfazerOrdem(categoria.id, anteriores),
      });
      return;
    }
    if (eSessao(r.falha)) return;

    if (r.falha.tipo === "conflito" || r.falha.tipo === "nao-existe") {
      // A lista mudou (ou a categoria desapareceu): o modo fecha, a ordem escrita
      // descarta-se e vem a do servidor. Nunca se repete o pedido sozinho.
      fecharOrdenar();
      avisoDeErro(r.falha.tipo === "conflito" ? TEXTOS.erro409 : TEXTOS.erro404Categoria);
      carregar(true);
      return;
    }

    // Sem resposta, 5xx ou 422: o modo fica aberto com a ordem escrita. O `PUT` é
    // absoluto, por isso repetir é seguro — mas só quando o dono o pedir.
    setOrdem((atual) => (atual === null ? null : { ...atual, aGuardar: false }));
    avisoDeErro(
      r.falha.tipo === "sem-resposta" ? TEXTOS.erroOrdemSemResposta : TEXTOS.erroOrdemServidor,
    );
  }

  // --- Folha ----------------------------------------------------------------

  function abrirFolha(modo: ModoDaFolha): void {
    setPrecoAberto(null);
    setFolha(modo);
  }

  async function adicionar(novo: NovoProduto): Promise<ResultadoDaFolha> {
    const modo = folha;
    const r = await executar((o) => criarProduto(novo, o));
    if (r.ok) {
      const criado = r.valor;
      const categoria = categorias.find((c) => c.id === criado.categoria_id);
      setCategorias((cs) => acrescentarProduto(cs, criado));
      setTermo("");
      setFolha((atual) => (atual === modo ? null : atual));
      if (categoria !== undefined) irParaCategoria(categoria);
      pedirFoco(`nome-${String(criado.id)}`, "titulo");
      // Sem «Desfazer»: seria eliminar, que é da F4-02b.
      setAviso({
        tipo: "sucesso",
        mensagem: criado.preco_cent === 0 ? TEXTOS.avisoOferta : TEXTOS.produtoAdicionado,
      });
      return { tipo: "fechou" };
    }
    if (eSessao(r.falha)) return { tipo: "fechou" };
    return erroDaFolha(r.falha, TEXTOS.erroCriarSemResposta);
  }

  async function editar(
    produto: ProdutoGestao,
    alteracao: AlteracaoDeProduto,
  ): Promise<ResultadoDaFolha> {
    const modo = folha;
    const r = await executar((o) => alterarProduto(produto.id, alteracao, o));
    if (r.ok) {
      const guardado = r.valor;
      setCategorias((cs) => substituirProduto(cs, guardado));
      setFolha((atual) => (atual === modo ? null : atual));
      pedirFoco(`nome-${String(guardado.id)}`, "titulo");

      const precoPerigoso =
        alteracao.preco_cent !== undefined &&
        avisoDoPreco(produto.preco_cent, guardado.preco_cent).comDesfazer;
      if (precoPerigoso) {
        // O «Desfazer» repõe **só** o preço: é o campo perigoso, o resto fica.
        setAviso(avisoDePreco(guardado, produto.preco_cent));
      } else if (guardado.categoria_id !== produto.categoria_id) {
        const destino = categorias.find((c) => c.id === guardado.categoria_id);
        setAviso({
          tipo: "sucesso",
          mensagem:
            destino !== undefined ? produtoMovidoPara(destino.nome) : TEXTOS.produtoAtualizado,
        });
      } else {
        setAviso({ tipo: "sucesso", mensagem: TEXTOS.produtoAtualizado });
      }
      return { tipo: "fechou" };
    }
    if (eSessao(r.falha)) return { tipo: "fechou" };

    if (r.falha.tipo === "nao-existe") {
      setFolha((atual) => (atual === modo ? null : atual));
      avisoDeErro(TEXTOS.erro404Produto);
      carregar(true);
      return { tipo: "fechou" };
    }
    return erroDaFolha(r.falha);
  }

  /** O que a folha diz de uma falha — e o que se recarrega por baixo. */
  function erroDaFolha(falha: Falha, semResposta?: string): ResultadoDaFolha {
    if (falha.tipo === "invalido") {
      const porCampo: Record<string, [CampoDaFolha, string]> = {
        nome: ["nome", TEXTOS.erroNomeVazio],
        descricao: ["descricao", TEXTOS.erroDescricaoLonga],
        preco_cent: ["preco", TEXTOS.erroPreco422],
        categoria_id: ["categoria", TEXTOS.erroCategoriaInexistente],
      };
      const inexistente = falha.codigo === "categoria_inexistente";
      const par = inexistente ? porCampo["categoria_id"] : porCampo[falha.campo ?? ""];
      if (inexistente) carregar(true);
      if (par !== undefined) return { tipo: "erro", campo: par[0], texto: par[1] };
      return { tipo: "erro", texto: TEXTOS.erro422SemCampo };
    }
    // Sem resposta numa alteração é «não sei se gravou»: não se reenvia, recarrega.
    if (falha.tipo === "sem-resposta") {
      carregar(true);
      if (semResposta !== undefined) return { tipo: "erro", texto: semResposta };
    }
    return { tipo: "erro", texto: fraseDeGuardar(falha) };
  }

  // --- Desenho --------------------------------------------------------------

  const ocupadoComOrdem = ordem !== null;

  let corpo: ReactElement;
  if (fase.estado === "a-carregar") {
    corpo = <Esqueleto />;
  } else if (fase.estado === "erro") {
    corpo = (
      <EstadoVazio
        tom="erro"
        titulo={TEXTOS.erroDeCarregarTitulo}
        linha={fase.semResposta ? TEXTOS.erroDeCarregarSemResposta : TEXTOS.erroDeCarregarServidor}
      >
        <Botao
          aTrabalhar={fase.aTentar}
          textoATrabalhar={TEXTOS.aTentar}
          onClick={() => {
            setFase({ ...fase, aTentar: true });
            carregar(false);
          }}
        >
          {TEXTOS.tentarOutraVez}
        </Botao>
      </EstadoVazio>
    );
  } else if (categorias.length === 0) {
    // Só um 200 com a lista vazia chega aqui. Sem botão: criar categorias é da F4-02b.
    corpo = <EstadoVazio titulo={TEXTOS.vazioTitulo} linha={TEXTOS.vazioLinha} />;
  } else {
    corpo = (
      <>
        {desatualizada !== null && (
          <div role="status" className="flex flex-col items-start gap-3 text-nota text-erro">
            <p>
              {desatualizada.semResposta
                ? TEXTOS.listaDesatualizadaSemResposta
                : TEXTOS.listaDesatualizadaServidor}
            </p>
            <Botao
              aTrabalhar={desatualizada.aTentar}
              textoATrabalhar={TEXTOS.aTentar}
              onClick={() => {
                setDesatualizada({ ...desatualizada, aTentar: true });
                carregar(true);
              }}
            >
              {TEXTOS.tentarOutraVez}
            </Botao>
          </div>
        )}

        <div>
          <Botao
            desativado={ocupadoComOrdem}
            onClick={() => {
              abrirFolha({ tipo: "adicionar", categoriaId: comTermo ? null : (ativa?.id ?? null) });
            }}
          >
            {TEXTOS.adicionarProduto}
          </Botao>
        </div>

        {!comTermo && (
          <nav
            aria-label={TEXTOS.navegacaoDeCategorias}
            className="sem-barra-de-deslocamento -mx-4 overflow-x-auto px-4"
          >
            <ul className="flex gap-2">
              {categorias.map((categoria) => (
                <li key={categoria.id}>
                  <ChipDaGestao
                    href={`/gestao/ementa?categoria=${encodeURIComponent(categoria.slug)}`}
                    ativo={categoria.id === ativa?.id}
                    parado={ocupadoComOrdem}
                    aoTocar={() => {
                      irParaCategoria(categoria);
                    }}
                  >
                    {categoria.nome}
                  </ChipDaGestao>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {comTermo && visiveis.length === 0 ? (
          <EstadoVazio titulo={TEXTOS.semResultadosTitulo} linha={TEXTOS.semResultadosLinha}>
            <Botao
              onClick={() => {
                setTermo("");
                pedirFoco("pesquisa");
              }}
            >
              {TEXTOS.limparPesquisa}
            </Botao>
          </EstadoVazio>
        ) : (
          visiveis.map((categoria) => (
            <CartaoDaCategoria
              key={categoria.id}
              categoria={categoria}
              comPesquisa={comTermo}
              ordem={ordem?.categoriaId === categoria.id ? ordem : null}
              ordenarDesativado={desatualizada !== null || ocupadoComOrdem}
              precoAberto={precoAberto}
              produtosPendentes={pendentes}
              aoOrdenar={() => {
                abrirOrdenar(categoria);
              }}
              aoMudarOrdem={(ids) => {
                setOrdem((atual) => (atual === null ? null : { ...atual, ids }));
              }}
              aoGuardarOrdem={() => {
                void guardarOrdem(categoria);
              }}
              aoCancelarOrdem={fecharOrdenar}
              aoAbrirPreco={(produto) => {
                setPrecoAberto(produto.id);
              }}
              aoCancelarPreco={() => {
                const id = precoAberto;
                setPrecoAberto(null);
                if (id !== null) pedirFoco(`preco-${String(id)}`);
              }}
              aoGuardarPreco={guardarPreco}
              aoAbrirFolha={(produto) => {
                abrirFolha({ tipo: "editar", produto });
              }}
              aoMudarDisponivel={(produto, ligado) => {
                void mudarDisponivel(produto, ligado);
              }}
              registar={registar}
            />
          ))
        )}
      </>
    );
  }

  const comPesquisa = categorias.length > 0 || fase.estado !== "pronta";

  return (
    <>
      <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
        {TEXTOS.titulo}
      </h1>

      <div className="flex flex-col gap-4">
        {comPesquisa && (
          <div className="flex flex-col gap-1">
            <CampoDaGestao
              ref={(no) => {
                registar("pesquisa")(no);
              }}
              etiqueta={TEXTOS.pesquisa}
              valor={termo}
              parado={ocupadoComOrdem}
              aoMudar={setTermo}
            />
            <p role="status" className="min-h-contagem text-nota text-texto-suave">
              {comTermo && totalEncontrado > 0 && fase.estado === "pronta"
                ? encontrados(totalEncontrado)
                : ""}
            </p>
          </div>
        )}

        {corpo}
      </div>

      <FolhaDoProduto
        modo={folha}
        categorias={categorias}
        aoFechar={() => {
          setFolha(null);
        }}
        aoAdicionar={adicionar}
        aoEditar={editar}
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
