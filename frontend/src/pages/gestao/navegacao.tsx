import type { ReactElement } from "react";
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

/**
 * Vai para `caminho`: empurra uma entrada no histórico, ou **substitui** a atual
 * com `{ substituir: true }` (login com sucesso, 401, sair: o «Voltar» não
 * regressa). Quem depende do endereço atualiza-se, porque o `pushState` não
 * dispara `popstate` e aqui o disparamos nós, para um único mecanismo servir o
 * `navegar` e o botão Recuar.
 */
export function navegar(caminho: string, opcoes?: { substituir?: boolean }): void {
  if (opcoes?.substituir === true) {
    window.history.replaceState(null, "", caminho);
  } else {
    window.history.pushState(null, "", caminho);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

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
