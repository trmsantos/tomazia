import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import { Botao } from "../../components/ui/Botao";
import { Chip } from "../../components/ui/Chip";
import { EstadoVazio } from "../../components/ui/EstadoVazio";
import { LinhaDeProduto } from "../../components/ui/LinhaDeProduto";
import { ErroDaApi } from "../../lib/api/cliente";
import { obterEmenta } from "../../lib/api/publico";
import { ancoraDaCategoria } from "../../lib/ementa/ancoras";
import { categoriaAtiva } from "../../lib/ementa/categoria-ativa";
import { filtrarEmenta, indexarEmenta } from "../../lib/ementa/pesquisa";
import type { CategoriaIndexada, CategoriaPublica } from "../../lib/ementa/pesquisa";

/**
 * O ecrã público da ementa (`docs/ecras/F3-02.md`).
 *
 * A pessoa está sentada, com pouca luz, com dados móveis, e abriu o código da
 * mesa. Quer saber o que há e quanto custa. Daí as três linhas de força desta
 * página: **a ementa aparece sem um toque**, os chips e a lupa são atalhos e
 * não o caminho, e **nada na ementa é clicável** — 140 produtos clicáveis
 * seriam 140 paragens de tabulação antes da secção seguinte.
 *
 * A barra de categorias vive **dentro** da secção da ementa, e isso não é
 * arrumação: um elemento colado pára no fim do seu bloco, por isso a barra
 * acompanha a ementa inteira e desaparece sozinha quando ela acaba, sem uma
 * linha de JavaScript a decidi-lo. Com posição fixa seguiria o utilizador para
 * dentro da galeria e alguém teria de a mandar embora à mão.
 *
 * **Armadilha conhecida:** um `overflow-x: hidden` posto em qualquer
 * antepassado — e é o reflexo de quem vê uma barra horizontal a aparecer —
 * mata a colagem dos descendentes, sem erro nenhum. Se a barra deixar de
 * colar, é aí que se procura primeiro.
 */

/** Mais do que isto e a pessoa já saiu; menos e uma rede fraca falha (5.4). */
const PRAZO_MS = 10_000;

/**
 * O filtro corre a cada tecla; a contagem só fala meio segundo depois da
 * última. São duas temporizações diferentes de propósito: a lista tem de
 * responder já, e uma região viva que fala a cada tecla transforma uma palavra
 * de cinco letras em cinco anúncios atropelados (4.5).
 */
const ATRASO_DA_CONTAGEM_MS = 500;

/**
 * A barra só se recoloca quando a posição vertical estiver parada há este
 * tempo. Durante um salto longo os chips passam todos — isso é honesto, é o
 * que está a passar —, mas a barra a saltar na horizontal ao mesmo tempo
 * lê-se como avaria (3.4).
 */
const ATRASO_DA_BARRA_MS = 150;

/**
 * Os cartões, por um seletor fixo e nunca por um identificador interpolado.
 * Um nome de categoria com um espaço ou um acento não é um seletor válido e
 * faria a procura **lançar**, levando a página com ela (secção 2).
 */
const SELETOR_DOS_CARTOES = 'section[id^="ementa-"]';

/** O chip marcado, que é também o que a barra tem de manter à vista. */
const SELETOR_DO_CHIP_ATIVO = '[aria-current="true"]';

/** O identificador da barra: é por ele que se lhe mede a altura (12.11). */
const ID_DA_BARRA = "barra-da-ementa";

/** O título da secção, que recebe o foco depois de uma tentativa feliz. */
const ID_DO_TITULO = "titulo-ementa";

/** Todo o texto visível desta página (secção 9), num sítio só. */
const TEXTOS = {
  titulo: "Ementa",
  nomeDaBarra: "Categorias",
  abrirPesquisa: "Pesquisar na ementa",
  campoDePesquisa: "Pesquisar na ementa",
  exemploDePesquisa: "Nome do produto",
  fecharPesquisa: "Fechar a pesquisa",
  semResultadosTitulo: "Não encontrei nada com esse nome.",
  semResultadosLinha: "Tenta outra palavra ou limpa a pesquisa para veres a ementa toda.",
  limparPesquisa: "Limpar pesquisa",
  vaziaTitulo: "Ainda não há ementa para mostrar.",
  vaziaLinha: "Pergunta no balcão.",
  erroTitulo: "Não consegui carregar a ementa.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
} as const;

/**
 * A máquina de estados (5.5). Quatro membros, e o render tem quatro ramos que
 * se contam a olho numa revisão.
 *
 * O estado pronto guarda o **índice** e não a lista crua: é a mesma lista,
 * com os nomes já normalizados uma vez (4.4) e sem as categorias vazias, que
 * é o que faz valer a invariante «um chip por cartão».
 */
type EstadoDaEmenta =
  | { estado: "a-carregar" }
  | { estado: "pronta"; indice: CategoriaIndexada[] }
  | { estado: "vazia" }
  | { estado: "erro"; semResposta: boolean };

/** Lista estável, para o filtro não recalcular quando não há ementa. */
const SEM_CATEGORIAS: CategoriaIndexada[] = [];

/** «1 produto encontrado.» / «7 produtos encontrados.» */
function contagemDeResultados(quantos: number): string {
  return quantos === 1 ? "1 produto encontrado." : `${String(quantos)} produtos encontrados.`;
}

/**
 * O movimento reduzido lê-se **no momento da chamada**, nunca num valor
 * guardado ao carregar o módulo: a definição muda a meio de uma sessão e tem
 * de ser respeitada quando muda (3.5).
 */
function deslizeSuave(): boolean {
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A linha de leitura do scroll-spy: a âncora das categorias **mais um
 * píxel** (3.3).
 *
 * Lê-se do `scroll-padding-top` do `html` porque é exactamente o mesmo
 * número: é ele que decide onde um título assenta depois de um salto. Quando
 * não há como o ler — num ambiente de teste sem motor de estilos —, mede-se
 * onde a âncora de facto está, que é o fundo da barra colada.
 */
function linhaDeLeitura(barra: HTMLElement | null): number {
  const declarada = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
  if (Number.isFinite(declarada)) return declarada + 1;
  return (barra === null ? 0 : barra.getBoundingClientRect().bottom) + 1;
}

/**
 * O nome de um erro, sem passar por `instanceof Error`.
 *
 * Um `DOMException` nem sempre herda de `Error` — em jsdom não herda —, por
 * isso a forma `erro instanceof Error ? erro.name : …` lê um cancelamento
 * como se fosse outra coisa qualquer. Devolve `null` quando não há nome
 * nenhum para ler, que é "não sei" e não "não é um cancelamento".
 */
function nomeDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("name" in erro)) return null;
  return String((erro as { name: unknown }).name);
}

/** A página está no seu máximo de deslocamento? (guarda 2 de 3.3) */
function noFimDaPagina(): boolean {
  return (
    Math.ceil(window.scrollY) >= document.documentElement.scrollHeight - window.innerHeight - 2
  );
}

/**
 * Pôr um chip à vista, deslocando **só a barra**.
 *
 * Nunca o método que leva um elemento à vista: mesmo na variante mais
 * contida, ele pode deslocar antepassados, e uma página que salta sozinha
 * enquanto a pessoa está a deslizar é a pior coisa que este ecrã pode fazer.
 * A folga de cada lado é a que a própria lista declara no seu preenchimento
 * de deslocamento, para não haver dois sítios a dizer o mesmo número.
 */
function revelarChip(lista: HTMLElement, chip: Element): void {
  const declarada = Number.parseFloat(getComputedStyle(lista).scrollPaddingLeft);
  const folga = Number.isFinite(declarada) ? declarada : 0;

  const caixaDaLista = lista.getBoundingClientRect();
  const caixaDoChip = chip.getBoundingClientRect();
  const inicio = caixaDoChip.left - caixaDaLista.left + lista.scrollLeft;
  const fim = inicio + caixaDoChip.width;

  let destino = lista.scrollLeft;
  if (inicio - folga < destino) destino = inicio - folga;
  else if (fim + folga > destino + lista.clientWidth) destino = fim + folga - lista.clientWidth;

  if (Math.abs(destino - lista.scrollLeft) < 1) return;
  lista.scrollTo({ left: Math.max(0, destino), behavior: deslizeSuave() ? "smooth" : "auto" });
}

/** A lupa. Um ícone nesta página inteira, por isso vai inline e sem pacote. */
function IconeDeLupa(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 L20 20" />
    </svg>
  );
}

/** O fechar da pesquisa. */
function IconeDeFechar(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6 L18 18" />
      <path d="M18 6 L6 18" />
    </svg>
  );
}

/** O cartão de uma categoria: creme sobre bordô, com nome e sem fios dentro. */
function CartaoDeCategoria({ categoria }: { categoria: CategoriaPublica }): ReactElement {
  const ancora = ancoraDaCategoria(categoria);

  return (
    <li>
      <section
        id={ancora}
        aria-labelledby={`titulo-${ancora}`}
        className="superficie-creme rounded-cartao border border-contorno-superficie p-4"
      >
        <h3 id={`titulo-${ancora}`} className="font-titulo text-titulo text-texto">
          {categoria.nome}
        </h3>
        <ul className="mt-3 flex flex-col gap-3">
          {categoria.produtos.map((produto) => (
            <LinhaDeProduto
              key={produto.id}
              nome={produto.nome}
              precoCent={produto.preco_cent}
              descricao={produto.descricao}
            />
          ))}
        </ul>
      </section>
    </li>
  );
}

/**
 * O esqueleto: a forma do que vem a seguir, para o creme sobre bordô aparecer
 * de imediato e o layout quase não saltar quando os dados chegam (5.1).
 *
 * As barras são o fio interno e nunca a cor de ação nem a do texto: dentro do
 * creme as duas são cores de marca e o esqueleto sairia em barras quase
 * pretas — lê-se como avaria, não como espera. As larguras são frações e não
 * passos da escala de espaçamento, que a 32 e 48 px não leriam como esqueleto.
 */
function EsqueletoDeCartao(): ReactElement {
  return (
    <li>
      <div className="superficie-creme rounded-cartao border border-contorno-superficie p-4">
        <div className="h-6 w-1/2 rounded-pequeno bg-fio-interno" />
        <div className="mt-4 flex flex-col gap-3">
          {["a", "b", "c", "d"].map((linha) => (
            <div key={linha} className="flex items-center gap-2">
              <div className="h-3 w-3/4 rounded-pequeno bg-fio-interno" />
              <div className="h-3 w-1/4 rounded-pequeno bg-fio-interno" />
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}

export function Ementa(): ReactElement {
  const [estado, setEstado] = useState<EstadoDaEmenta>({ estado: "a-carregar" });
  const [tentativa, setTentativa] = useState(0);
  const [aTentar, setATentar] = useState(false);
  const [pesquisaAberta, setPesquisaAberta] = useState(false);
  const [termo, setTermo] = useState("");
  const [ativa, setAtiva] = useState(0);
  const [contagem, setContagem] = useState("");

  const tituloRef = useRef<HTMLHeadingElement>(null);
  const seccaoRef = useRef<HTMLElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const lupaRef = useRef<HTMLButtonElement>(null);
  const barraAbertaRef = useRef<HTMLDivElement>(null);

  /** Onde a página estava quando a lupa foi tocada, para lá voltar (4.2). */
  const posicaoGuardada = useRef(0);
  /** Fechar devolve o foco à lupa; abrir a página pela primeira vez não. */
  const devolverFoco = useRef(false);
  /** Uma tentativa bem sucedida leva o foco ao título; o arranque não (5.3). */
  const veioDeUmaTentativa = useRef(false);
  /** Enquanto o ponteiro está em baixo, a barra é de quem a arrasta (3.4). */
  const aArrastar = useRef(false);

  /**
   * O pedido, com prazo.
   *
   * Duas causas de «a carregar para sempre», as duas tratadas aqui. A
   * primeira é não haver prazo: o temporizador aborta com um motivo chamado
   * `TimeoutError`, e é pelo **nome** do motivo que o cliente distingue um
   * prazo esgotado (que é erro) de um cancelamento (que não é).
   *
   * A segunda é confundir um cancelamento com uma resposta. Em modo estrito
   * os efeitos correm duas vezes em desenvolvimento e o primeiro pedido é
   * **sempre** cancelado, e um cancelamento não muda o estado. Sem esse
   * guarda, a ementa mostrava «não consegui carregar» em todos os
   * arranques.
   *
   * O guarda tem de ser só o do cancelamento, e não «tudo o que não é um
   * erro da API»: escrito assim, o `.catch` tinha dois ramos para três
   * casos e engolia também o nosso próprio código a rebentar — ver os três
   * ramos lá em baixo e a razão da ordem deles.
   */
  useEffect(() => {
    const controlo = new AbortController();
    const prazo = window.setTimeout(() => {
      controlo.abort(new DOMException("prazo", "TimeoutError"));
    }, PRAZO_MS);

    obterEmenta({ sinal: controlo.signal })
      .then((resposta) => {
        if (controlo.signal.aborted) return;
        const indice = indexarEmenta(resposta.categorias);
        setEstado(indice.length === 0 ? { estado: "vazia" } : { estado: "pronta", indice });
        setATentar(false);
        if (veioDeUmaTentativa.current) {
          veioDeUmaTentativa.current = false;
          tituloRef.current?.focus();
        }
      })
      .catch((erro: unknown) => {
        // Três ramos para três casos, e **a ordem não é óbvia**.
        //
        // 1. Um erro da API é sempre ecrã de erro.
        if (erro instanceof ErroDaApi) {
          setEstado({ estado: "erro", semResposta: erro.estado === null });
          setATentar(false);
          return;
        }
        // 2. **Só depois** se pergunta pelo cancelamento. Trocar a ordem
        //    reintroduz o quarto estado pela outra porta: um prazo esgotado
        //    põe `signal.aborted` a `true` **e** chega aqui como
        //    `ErroDaApi`, por isso um guarda de cancelamento à frente
        //    engolia-o e o ecrã ficava «a carregar» para sempre, sem botão
        //    para tentar outra vez. A próxima pessoa vai querer reordenar
        //    isto; é por isto que não se reordena.
        if (controlo.signal.aborted || nomeDoErro(erro) === "AbortError") return;
        // 3. Tudo o resto é o nosso próprio código a rebentar — tipicamente
        //    um 200 com JSON válido e sem `categorias` (um portal cativo de
        //    WiFi, um proxy, um deploy parcial do backend), que faz o
        //    índice lançar lá em cima, dentro do `.then`. Engolido, deixava
        //    o ecrã em `aria-busy` para sempre: é o quarto estado de 5.4, e
        //    é um erro de verdade. A linha é a do servidor porque houve
        //    resposta; o que não houve foi uma ementa.
        setEstado({ estado: "erro", semResposta: false });
        setATentar(false);
      })
      .finally(() => {
        window.clearTimeout(prazo);
      });

    return () => {
      window.clearTimeout(prazo);
      // Sem motivo: um desmontar é um cancelamento, e tem de se distinguir
      // do prazo esgotado.
      controlo.abort();
    };
  }, [tentativa]);

  const indice = estado.estado === "pronta" ? estado.indice : SEM_CATEGORIAS;
  const visiveis = useMemo(() => filtrarEmenta(indice, termo), [indice, termo]);

  const aPesquisar = termo.trim() !== "";
  const semResultados = estado.estado === "pronta" && aPesquisar && visiveis.length === 0;
  const comChips = estado.estado === "pronta" && !pesquisaAberta;

  /**
   * A contagem vê-se quando há texto e há resultados — e só com a pesquisa
   * aberta. O terceiro termo não é decoração: ao fechar, o texto antigo fica
   * lá os 500 ms do temporizador, e sem a casca da pesquisa ele apareceria
   * encostado à margem da janela, sem a coluna nem o preenchimento.
   */
  const contagemVisivel = pesquisaAberta && contagem !== "" && !semResultados;

  const quantos = visiveis.reduce((soma, categoria) => soma + categoria.produtos.length, 0);
  const textoDaContagem = !aPesquisar
    ? ""
    : quantos === 0
      ? TEXTOS.semResultadosTitulo
      : contagemDeResultados(quantos);

  /**
   * A contagem só fala meio segundo depois da última tecla. O atraso é do
   * **texto**, não do filtro: a lista já mudou quando isto corre.
   */
  useEffect(() => {
    const temporizador = window.setTimeout(() => {
      setContagem(textoDaContagem);
    }, ATRASO_DA_CONTAGEM_MS);

    return () => {
      window.clearTimeout(temporizador);
    };
  }, [textoDaContagem]);

  /** Abrir leva o foco ao campo; fechar devolve-o à lupa (4.1). */
  useEffect(() => {
    if (pesquisaAberta) {
      campoRef.current?.focus();
      return;
    }
    if (!devolverFoco.current) return;
    devolverFoco.current = false;
    lupaRef.current?.focus();
  }, [pesquisaAberta]);

  const manterOChipAtivoAVista = useCallback(() => {
    const lista = listaRef.current;
    if (lista === null || aArrastar.current) return;
    const chip = lista.querySelector(SELETOR_DO_CHIP_ATIVO);
    if (chip === null) return;
    revelarChip(lista, chip);
  }, []);

  /**
   * O scroll-spy.
   *
   * O gatilho é o deslocamento da janela, estrangulado por um pedido de
   * quadro de cada vez; a decisão vive na função pura, que recebe os topos já
   * medidos. Os topos são os das **secções** e não os dos títulos: com
   * preenchimento dentro do cartão, o título fica uns píxeis abaixo e nunca
   * chega à linha de leitura — e o sintoma é igualzinho ao de faltar o «mais
   * um píxel» da linha.
   *
   * Ler onze medidas por quadro é barato: são leituras seguidas, sem escrita
   * pelo meio, por isso o browser não recalcula o layout entre elas. O que
   * seria caro é escrever estilos no meio das leituras; não se faz.
   */
  useEffect(() => {
    const raiz = seccaoRef.current;
    if (!comChips || raiz === null) return;

    let quadro = 0;
    let paragem = 0;

    const medir = (): void => {
      quadro = 0;
      const topos = [...raiz.querySelectorAll(SELETOR_DOS_CARTOES)].map(
        (cartao) => cartao.getBoundingClientRect().top,
      );
      const marcada = categoriaAtiva(topos, linhaDeLeitura(barraRef.current), noFimDaPagina());
      if (marcada !== null) setAtiva(marcada);
    };

    const aoDeslizar = (): void => {
      if (quadro === 0) quadro = window.requestAnimationFrame(medir);
      window.clearTimeout(paragem);
      paragem = window.setTimeout(manterOChipAtivoAVista, ATRASO_DA_BARRA_MS);
    };

    quadro = window.requestAnimationFrame(medir);
    window.addEventListener("scroll", aoDeslizar, { passive: true });

    return () => {
      window.removeEventListener("scroll", aoDeslizar);
      if (quadro !== 0) window.cancelAnimationFrame(quadro);
      window.clearTimeout(paragem);
    };
  }, [comChips, manterOChipAtivoAVista]);

  /**
   * O toque num chip coloca-o em posição **imediatamente**, porque é a
   * resposta directa a uma ação directa — e enquanto o ponteiro estiver em
   * baixo sobre a barra, ela não se mexe: o utilizador está a arrastá-la e
   * não se lhe tira a barra das mãos.
   *
   * Os ouvintes são postos à mão e não em atributos do JSX porque quem os
   * recebe é a lista inteira: pô-los em cada chip punha um manipulador em
   * onze elementos que são ligações e não botões.
   */
  useEffect(() => {
    const lista = listaRef.current;
    if (!comChips || lista === null) return;

    const aoCarregar = (evento: Event): void => {
      const alvo = evento.target;
      if (!(alvo instanceof Element)) return;
      const chip = alvo.closest("a");
      if (chip === null) return;
      revelarChip(lista, chip);
    };
    const aoAgarrar = (): void => {
      aArrastar.current = true;
    };
    const aoLargar = (): void => {
      aArrastar.current = false;
    };

    lista.addEventListener("click", aoCarregar);
    lista.addEventListener("pointerdown", aoAgarrar);
    window.addEventListener("pointerup", aoLargar);
    window.addEventListener("pointercancel", aoLargar);

    return () => {
      lista.removeEventListener("click", aoCarregar);
      lista.removeEventListener("pointerdown", aoAgarrar);
      window.removeEventListener("pointerup", aoLargar);
      window.removeEventListener("pointercancel", aoLargar);
      aArrastar.current = false;
    };
  }, [comChips]);

  function abrirPesquisa(): void {
    posicaoGuardada.current = window.scrollY;
    setPesquisaAberta(true);
  }

  const fecharPesquisa = useCallback((): void => {
    devolverFoco.current = true;
    setPesquisaAberta(false);
    setTermo("");
    window.scrollTo({ top: posicaoGuardada.current, behavior: "instant" });
  }, []);

  /**
   * `Esc` fecha — a partir de **qualquer** um dos dois focáveis da barra.
   *
   * A 4.1 diz «`Esc` fecha», sem qualificar. No campo, e só no campo, o
   * `Esc` com o foco no botão «Fechar a pesquisa» não fazia nada: o foco
   * está a 44 px do campo e a tecla não chega lá.
   *
   * O ouvinte é posto à mão e não em atributo do JSX porque quem o recebe é
   * a casca, que é um `<div>` — e um `<div>` com manipulador de teclado é um
   * controlo inventado aos olhos do lint de acessibilidade, com razão. Isto
   * não é um controlo: é a casca que apanha o que sobe dos controlos que lá
   * vivem, hoje dois e amanhã talvez três.
   */
  useEffect(() => {
    const casca = barraAbertaRef.current;
    if (casca === null) return;

    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === "Escape") fecharPesquisa();
    };

    casca.addEventListener("keydown", aoTeclar);
    return () => {
      casca.removeEventListener("keydown", aoTeclar);
    };
  }, [pesquisaAberta, fecharPesquisa]);

  function escrever(valor: string): void {
    // Ao **primeiro** caractere a lista salta para o topo; as teclas
    // seguintes não mexem na posição, senão a lista fugia a cada letra (4.2).
    const primeiroCaractere = termo === "" && valor !== "";
    setTermo(valor);
    if (primeiroCaractere) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function tentarOutraVez(): void {
    veioDeUmaTentativa.current = true;
    setATentar(true);
    setTentativa((anterior) => anterior + 1);
  }

  const marcada = Math.min(ativa, Math.max(visiveis.length - 1, 0));

  return (
    <section
      id="ementa"
      ref={seccaoRef}
      aria-labelledby={ID_DO_TITULO}
      aria-busy={estado.estado === "a-carregar" || undefined}
      className="pb-8"
    >
      <h2
        id={ID_DO_TITULO}
        ref={tituloRef}
        tabIndex={-1}
        className="mx-auto max-w-coluna px-4 pb-3 pt-8 font-titulo text-titulo text-texto"
      >
        {TEXTOS.titulo}
      </h2>

      {/*
       * A barra existe a carregar (como esqueleto) e com a ementa pronta. No
       * vazio e no erro **não existe**: não há categorias para onde saltar, e
       * uma barra vazia colada ao topo seria um controlo que não controla
       * nada.
       *
       * É uma casca só para os três conteúdos, de propósito: a altura, a
       * superfície e o fio são os mesmos nos três, e é dessa altura que sai a
       * âncora de todas as categorias. Escritos em três sítios, um deles
       * acabaria diferente — e o sintoma (todos os saltos a parar fora do
       * sítio) aparece longe da causa.
       */}
      {(estado.estado === "a-carregar" || estado.estado === "pronta") && (
        <div
          id={ID_DA_BARRA}
          ref={barraRef}
          aria-hidden={estado.estado === "a-carregar" || undefined}
          className="superficie-painel sticky top-cabecalho z-10 h-barra border-b border-contorno-superficie"
        >
          {estado.estado === "a-carregar" && (
            <div className="mx-auto flex h-full max-w-coluna items-center gap-2 px-4">
              {/*
               * Os três blocos em forma de chip, em frações e não em passos
               * da escala de espaçamento: a 32 e a 48 px três barras dessas
               * não lêem como esqueleto. Larguras diferentes porque uma
               * barra de categorias também as tem.
               *
               * Escritos por extenso, e não por um ciclo sobre uma lista de
               * larguras: numa constante, as três classes ficavam fora do
               * alcance da varredura da escala de espaçamento
               * (`src/styles/escala-de-espacamento.test.ts`), que olha para
               * o que está dentro de um `className` ou de um `juntar`. Uma
               * lista de classes de largura é o sítio mais provável desta
               * página para alguém escrever um `w-5`, que não existe e
               * desaparece sem dar erro.
               */}
              <div className="min-h-toque w-1/4 rounded-pequeno bg-fio-interno" />
              <div className="min-h-toque w-1/3 rounded-pequeno bg-fio-interno" />
              <div className="min-h-toque w-1/2 rounded-pequeno bg-fio-interno" />
            </div>
          )}

          {comChips && (
            <div className="mx-auto flex h-full max-w-coluna items-center">
              <nav aria-label={TEXTOS.nomeDaBarra} className="min-w-0 flex-1">
                <ul
                  ref={listaRef}
                  className="sem-barra-de-deslocamento flex snap-x snap-proximity items-center gap-2 overflow-x-auto scroll-pl-4 px-4 py-2"
                >
                  {visiveis.map((categoria, indiceDoChip) => {
                    const ancora = ancoraDaCategoria(categoria);
                    return (
                      <li key={ancora} className="snap-start">
                        <Chip href={`#${ancora}`} ativo={indiceDoChip === marcada}>
                          {categoria.nome}
                        </Chip>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {/*
               * A lupa fica **fora** da lista que desliza. Lá dentro, ela
               * deslizava para fora do ecrã exactamente quando mais se precisa
               * dela: no fim de uma lista longa.
               */}
              <button
                type="button"
                ref={lupaRef}
                aria-label={TEXTOS.abrirPesquisa}
                onClick={abrirPesquisa}
                className="ml-2 mr-4 inline-flex min-h-toque min-w-toque shrink-0 items-center justify-center rounded-pequeno border border-contorno text-texto"
              >
                <IconeDeLupa />
              </button>
            </div>
          )}

          {estado.estado === "pronta" && pesquisaAberta && (
            <div
              ref={barraAbertaRef}
              className="mx-auto flex h-full max-w-coluna items-center gap-2 px-4"
            >
              <span className="shrink-0 text-texto-suave">
                <IconeDeLupa />
              </span>
              {/*
               * Exceção escrita à regra do campo com etiqueta visível: uma
               * caixa de pesquisa de 44 px numa barra é outro objeto, e a
               * alternativa seria pior — uma propriedade «etiqueta escondida»
               * passaria a existir para toda a gente e a regra das etiquetas
               * visíveis nos formulários morria por essa porta. O que a torna
               * compreensível é a lupa ao lado, o exemplo lá dentro e o nome
               * acessível.
               */}
              <input
                ref={campoRef}
                type="search"
                aria-label={TEXTOS.campoDePesquisa}
                placeholder={TEXTOS.exemploDePesquisa}
                value={termo}
                onChange={(evento) => {
                  escrever(evento.target.value);
                }}
                className="min-h-toque w-full min-w-0 flex-1 rounded-pequeno border border-contorno bg-transparent px-3 text-corpo text-texto placeholder:text-texto-suave"
              />
              <button
                type="button"
                aria-label={TEXTOS.fecharPesquisa}
                onClick={fecharPesquisa}
                className="inline-flex min-h-toque min-w-toque shrink-0 items-center justify-center rounded-pequeno text-texto"
              >
                <IconeDeFechar />
              </button>
            </div>
          )}
        </div>
      )}

      {/*
       * A linha de contagem existe no DOM desde o primeiro render, vazia: uma
       * região viva inserida já com texto muitas vezes não é anunciada.
       *
       * **Quando os resultados caem a zero, esta linha diz exactamente o
       * mesmo que o título do `EstadoVazio` por baixo** — e 4.5 abre com
       * «nunca o mesmo texto duas vezes». A contradição é aparente e a razão
       * fica escrita aqui, porque quem ler a especificação vai ter a mesma
       * dúvida:
       *
       *  - **Ninguém o ouve duas vezes.** Só esta linha é região viva; o
       *    `EstadoVazio` não é nenhuma (está escrito no componente) e o foco
       *    não lhe vai parar. No momento em que os resultados caem a zero, o
       *    leitor de ecrã anuncia **uma** frase: a desta linha. O título por
       *    baixo é lido mais tarde, e só se a pessoa lá chegar a navegar —
       *    altura em que confirma onde aterrou, que é outra função.
       *  - **Ninguém o vê duas vezes.** A zero resultados esta linha é
       *    `sr-only`: no ecrã a frase aparece uma vez, no `EstadoVazio`.
       *
       * O que 4.5 proíbe é as **duas linhas** dizerem o mesmo — e não dizem:
       * esta diz o que aconteceu, a de baixo diz o que fazer a seguir. Se
       * alguém puser o `EstadoVazio` dentro de uma região viva, ou levar o
       * foco ao título, isto passa a ser um defeito a sério; é esse o guarda
       * em `Ementa.test.tsx`.
       *
       * O lugar dela reserva-se **à abertura da pesquisa** e não quando o
       * texto chega. Medido: a entrar no fluxo meio segundo depois da última
       * tecla, empurrava o primeiro cartão 31,6 px para baixo com a pessoa já
       * a ler os resultados (4.5). O momento em que o lugar nasce é o mesmo
       * em que os chips dão lugar ao campo: já é um redesenho da barra
       * inteira, e mais uma linha vazia lá dentro não se vê.
       *
       * Com a pesquisa fechada a casca não tem classes nem altura: na ementa
       * normal não há contagem nenhuma, e uma faixa vazia permanente entre a
       * barra e o primeiro cartão seria espaço morto na vista principal.
       */}
      <div className={pesquisaAberta ? "mx-auto h-contagem max-w-coluna px-4 pt-3" : undefined}>
        <p role="status" className={contagemVisivel ? "text-nota text-texto-suave" : "sr-only"}>
          {contagem}
        </p>
      </div>

      {estado.estado === "a-carregar" && (
        <ul className="mx-auto flex max-w-coluna flex-col gap-4 px-4 py-4">
          <EsqueletoDeCartao />
          <EsqueletoDeCartao />
        </ul>
      )}

      {estado.estado === "vazia" && (
        <div className="px-4">
          <EstadoVazio titulo={TEXTOS.vaziaTitulo} linha={TEXTOS.vaziaLinha} />
        </div>
      )}

      {estado.estado === "erro" && (
        <div className="px-4">
          <EstadoVazio
            tom="erro"
            titulo={TEXTOS.erroTitulo}
            linha={estado.semResposta ? TEXTOS.erroSemResposta : TEXTOS.erroComResposta}
          >
            {/*
             * O botão fica montado durante a nova tentativa. Se o bloco de
             * erro fosse substituído pelo esqueleto, o foco caía para o corpo
             * da página e quem navega por teclado era largado no topo, sem
             * explicação.
             */}
            <Botao aTrabalhar={aTentar} textoATrabalhar={TEXTOS.aTentar} onClick={tentarOutraVez}>
              {TEXTOS.tentarOutraVez}
            </Botao>
          </EstadoVazio>
        </div>
      )}

      {estado.estado === "pronta" &&
        (semResultados ? (
          <div className="px-4">
            <EstadoVazio titulo={TEXTOS.semResultadosTitulo} linha={TEXTOS.semResultadosLinha}>
              <Botao onClick={fecharPesquisa}>{TEXTOS.limparPesquisa}</Botao>
            </EstadoVazio>
          </div>
        ) : (
          <ul className="mx-auto flex max-w-coluna flex-col gap-4 px-4 py-4">
            {visiveis.map((categoria) => (
              <CartaoDeCategoria key={ancoraDaCategoria(categoria)} categoria={categoria} />
            ))}
          </ul>
        ))}
    </section>
  );
}
