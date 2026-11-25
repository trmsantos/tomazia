import type { MouseEvent, ReactElement } from "react";
import { useSyncExternalStore } from "react";

/**
 * O encaminhamento da gestão (F4-01, secções 2 e 5.1), sem `react-router`:
 * `location.pathname`, `history.pushState`/`replaceState` e o `popstate`.
 *
 * Fica dentro do chunk da gestão — o público nunca o importa (Q-02).
 */

/**
 * Um ícone da barra: SVG inline de 24 px, traço de 2, `aria-hidden`, cor da
 * herança do texto (a mesma receita da lupa da ementa). Sem biblioteca de
 * ícones: cinco desenhos não justificam uma dependência (regra 8).
 */
function Icone({ children }: { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export type Destino = { rotulo: string; caminho: string; icone: ReactElement };

/** Os cinco destinos, pela ordem em que aparecem (secção 5.1). */
export const DESTINOS: readonly Destino[] = [
  {
    rotulo: "Início",
    caminho: "/gestao",
    icone: (
      <Icone>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v10h14V10" />
      </Icone>
    ),
  },
  {
    rotulo: "Ementa",
    caminho: "/gestao/ementa",
    icone: (
      <Icone>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M9 9h3M9 13h7M9 17h7" />
      </Icone>
    ),
  },
  {
    rotulo: "Eventos",
    caminho: "/gestao/eventos",
    icone: (
      <Icone>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </Icone>
    ),
  },
  {
    rotulo: "Galeria",
    caminho: "/gestao/galeria",
    icone: (
      <Icone>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="m21 16-5-5-9 9" />
      </Icone>
    ),
  },
  {
    rotulo: "Mais",
    caminho: "/gestao/mais",
    icone: (
      <Icone>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </Icone>
    ),
  },
];

/** Os caminhos dos destinos da barra (o login não é um destino). */
export const ROTAS_DOS_DESTINOS: ReadonlySet<string> = new Set(
  DESTINOS.map((destino) => destino.caminho),
);

/**
 * As subrotas que não são destinos da barra (F4-05a): o título do separador. «Mais»
 * continua ativo por baixo do seu caminho.
 */
export const TITULOS_DAS_SUBROTAS: Readonly<Record<string, string>> = {
  "/gestao/mais/definicoes": "Definições",
  "/gestao/mais/clientes": "Clientes",
};

/**
 * Tudo o que a gestão conhece e o login aceita como destino: os cinco da barra e
 * as subrotas. O resto volta a `/gestao`.
 */
export const ROTAS_DA_GESTAO: ReadonlySet<string> = new Set([
  ...ROTAS_DOS_DESTINOS,
  ...Object.keys(TITULOS_DAS_SUBROTAS),
]);

/** Um clique «normal» (sem Ctrl, Cmd, Shift nem Alt, botão principal) deixa de ser do browser. */
export function eCliqueSimples(evento: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    evento.button === 0 && !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey
  );
}

/**
 * A guarda de saída (F4-05a, D3): quem tem alterações por guardar regista uma
 * função. `true` = a guarda tratou disto (vai perguntar e chamará `seguir` se o
 * dono quiser sair); `false` = pode seguir. Só uma de cada vez.
 *
 * Passam por ela o `navegarComGuarda` (a barra, «Voltar a Mais») e o Voltar do
 * browser. **O `navegar` nunca**: o 401, o login e o «Sair» não são bloqueados.
 */
export type GuardaDeSaida = (seguir: () => void) => boolean;

let guardaDeSaida: GuardaDeSaida | null = null;
/** O endereço em que se estava antes de um Voltar, para o repor. */
let enderecoAnterior = "";
/** O `history.state` dessa entrada, para a repor como estava. */
let estadoAnterior: unknown = null;
/** Verdadeiro enquanto o `navegar` dispara o seu próprio `popstate`: esse não é um Voltar. */
let aNavegar = false;

/** A chave do índice da entrada, dentro do `history.state` (ao lado do `estado` de quem navegou). */
const CHAVE_DO_INDICE = "indiceDaGestao";

function enderecoDeAgora(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * O índice da entrada atual do histórico. Uma entrada que não foi criada por
 * `navegar` (a primeira, uma recarga antiga) não o tem: conta como 0.
 */
function indiceDeAgora(): number {
  const estado = window.history.state as unknown;
  if (typeof estado !== "object" || estado === null) return 0;
  const indice = (estado as Record<string, unknown>)[CHAVE_DO_INDICE];
  return typeof indice === "number" ? indice : 0;
}

export function definirGuardaDeSaida(guarda: GuardaDeSaida | null): void {
  guardaDeSaida = guarda;
  if (guarda !== null) {
    enderecoAnterior = enderecoDeAgora();
    estadoAnterior = window.history.state as unknown;
  }
}

/**
 * Vai para `caminho`: empurra uma entrada no histórico, ou **substitui** a atual
 * com `{ substituir: true }` (login com sucesso, 401, sair: o «Voltar» não
 * regressa). Quem depende do endereço atualiza-se, porque o `pushState` não
 * dispara `popstate` e aqui o disparamos nós, para um único mecanismo servir o
 * `navegar` e o botão Recuar.
 *
 * `estado` vai para o `history.state` da entrada (F4-02, D4: o destino depois do
 * login e o aviso «A sessão terminou» viajam aí, nunca no endereço), ao lado do
 * índice da entrada, que a guarda de saída usa para desfazer um Voltar sem
 * deixar entradas a mais. Nada se herda da entrada anterior.
 */
export function navegar(
  caminho: string,
  opcoes?: { substituir?: boolean; estado?: unknown },
): void {
  const extra = opcoes?.estado;
  const base = typeof extra === "object" && extra !== null ? extra : {};
  if (opcoes?.substituir === true) {
    window.history.replaceState({ ...base, [CHAVE_DO_INDICE]: indiceDeAgora() }, "", caminho);
  } else {
    window.history.pushState({ ...base, [CHAVE_DO_INDICE]: indiceDeAgora() + 1 }, "", caminho);
  }
  enderecoAnterior = enderecoDeAgora();
  estadoAnterior = window.history.state as unknown;
  aNavegar = true;
  try {
    window.dispatchEvent(new PopStateEvent("popstate"));
  } finally {
    aNavegar = false;
  }
}

/** Como o `navegar`, mas pergunta primeiro à guarda de saída, se houver uma. */
export function navegarComGuarda(caminho: string, opcoes?: { substituir?: boolean }): void {
  const seguir = (): void => {
    navegar(caminho, opcoes?.substituir === true ? { substituir: true } : undefined);
  };
  if (guardaDeSaida?.(seguir) === true) return;
  seguir();
}

/**
 * O Voltar (ou o Avançar) do browser com uma guarda ativa: já estamos na entrada
 * de destino, mas a página tem de continuar onde estava, **de imediato** (um
 * `history.go` é assíncrono e deixava os ouvintes ver o destino). Por isso repõe-se
 * a entrada onde se estava com um `pushState` logo a seguir à de destino, com o
 * mesmo `history.state` e o índice seguinte. `seguir` salta de volta ao destino
 * pela diferença dos índices (`history.go`), o que cobre Voltar e Avançar e **não
 * deixa a entrada reposta no histórico**. Só conta mudar de caminho ou de pesquisa:
 * um salto para um `#` (o «Saltar para o conteúdo») não é sair. Quem chama `seguir`
 * limpa antes a guarda (a Folha fá-lo), senão o salto voltava a ser perguntado.
 *
 * Registado ao carregar o módulo, para correr **antes** dos ouvintes de quem se
 * subscreve ao endereço: quando eles leem, o endereço já foi reposto.
 */
function aoRecuar(): void {
  if (aNavegar) return;
  const destino = window.location.pathname + window.location.search;
  const anterior = enderecoAnterior;
  const mudouDeSitio = destino !== anterior.replace(/#.*$/, "");
  if (guardaDeSaida !== null && mudouDeSitio) {
    const indiceDoDestino = indiceDeAgora();
    const seguir = (): void => {
      window.history.go(indiceDoDestino - indiceDeAgora());
    };
    if (guardaDeSaida(seguir)) {
      const base =
        typeof estadoAnterior === "object" && estadoAnterior !== null ? estadoAnterior : {};
      window.history.pushState({ ...base, [CHAVE_DO_INDICE]: indiceDoDestino + 1 }, "", anterior);
      return;
    }
  }
  enderecoAnterior = enderecoDeAgora();
  estadoAnterior = window.history.state as unknown;
}

if (typeof window !== "undefined") window.addEventListener("popstate", aoRecuar);

function ouvir(avisar: () => void): () => void {
  window.addEventListener("popstate", avisar);
  return () => {
    window.removeEventListener("popstate", avisar);
  };
}

function caminhoAtual(): string {
  return window.location.pathname;
}

/** O `location.pathname` atual, reativo ao `navegar` e ao Recuar. */
export function useCaminho(): string {
  return useSyncExternalStore(ouvir, caminhoAtual);
}

function pesquisaAtual(): string {
  return window.location.search;
}

/**
 * O `location.search` atual (`?categoria=garrafeira`), reativo ao `navegar` e ao
 * Recuar. Para o que vive na pesquisa do endereço — hoje, a categoria da ementa.
 */
export function usePesquisa(): string {
  return useSyncExternalStore(ouvir, pesquisaAtual);
}

/**
 * O destino está ativo neste caminho? «Início» só em `/gestao` exato (com ou
 * sem a barra final); os outros também por baixo do seu caminho — «Mais» vai
 * ter coisas lá dentro na F4-05.
 */
export function estaAtivo(destino: Destino, caminho: string): boolean {
  const limpo = caminho.length > 1 && caminho.endsWith("/") ? caminho.slice(0, -1) : caminho;
  if (destino.caminho === "/gestao") return limpo === "/gestao";
  return limpo === destino.caminho || limpo.startsWith(`${destino.caminho}/`);
}

/** O caminho é exatamente o do destino (e não uma subrota dele): `/gestao/mais`, não `/gestao/mais/definicoes`. */
export function estaExatamente(destino: Destino, caminho: string): boolean {
  const limpo = caminho.length > 1 && caminho.endsWith("/") ? caminho.slice(0, -1) : caminho;
  return limpo === destino.caminho;
}
