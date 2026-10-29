/**
 * O que o jsdom não tem e o ecrã da ementa precisa.
 *
 * Mesma família do `dialogo-jsdom.ts` da F3-01, e a mesma honestidade: isto
 * **não** simula o browser, só impede que a falta de uma API leve o teste a
 * rebentar por uma razão que nada tem a ver com o que ele prova.
 *
 * Duas faltas:
 *
 *  - **`window.matchMedia`** não existe no jsdom. O ecrã lê
 *    `matchMedia("(prefers-reduced-motion: reduce)")` **no momento da
 *    chamada** (3.5), por isso um teste sem este adaptador rebenta com
 *    "matchMedia is not a function" — uma falha de ambiente a passar por
 *    falha de implementação.
 *  - **`scrollTo`** existe no `window` do jsdom mas não faz nada e não
 *    regista nada, e em `Element` nem existe. A pesquisa salta para o topo
 *    ao primeiro caractere e devolve a posição ao fechar (4.2), e a barra
 *    desloca-se na horizontal (3.4): sem registo, nenhuma das três se vê.
 *
 * O que isto **não** faz: não há layout, por isso `scrollY` é um número que
 * o teste escreve e `getBoundingClientRect` devolve zeros. Tudo o que
 * dependa de posições a sério é do Playwright.
 */

/** Um pedido de deslocamento, com o alvo e as opções como vieram. */
export type PedidoDeDeslocamento = {
  /** `null` quando foi a janela; o elemento quando foi a barra de chips. */
  alvo: Element | null;
  opcoes: ScrollToOptions;
};

export type DeslocamentoFalso = {
  /** Por ordem de chamada, janela e elementos misturados. */
  pedidos: PedidoDeDeslocamento[];
  /** Só os da janela, que são os de 4.2. */
  daJanela(): PedidoDeDeslocamento[];
  /** Escreve `window.scrollY`/`pageYOffset`, que o jsdom deixa a zero. */
  posicionarJanela(y: number): void;
  restaurar(): void;
};

function normalizarOpcoes(primeiro: unknown, segundo: unknown): ScrollToOptions {
  if (typeof primeiro === "number" || typeof segundo === "number") {
    return { left: Number(primeiro ?? 0), top: Number(segundo ?? 0) };
  }
  return (primeiro ?? {}) as ScrollToOptions;
}

/**
 * Regista todos os `scrollTo` e deixa o teste escrever a posição da janela.
 *
 * Devolve o registo e a função que desfaz. Chamar no `beforeEach` e desfazer
 * no `afterEach`: sem desfazer, um teste passa a ver os pedidos do anterior.
 */
export function instalarDeslocamento(): DeslocamentoFalso {
  const pedidos: PedidoDeDeslocamento[] = [];

  const janelaOriginal = window.scrollTo;
  const elementoOriginal = Element.prototype.scrollTo;
  const posicaoOriginal = Object.getOwnPropertyDescriptor(window, "scrollY");
  const deslocamentoOriginal = Object.getOwnPropertyDescriptor(window, "pageYOffset");

  window.scrollTo = ((primeiro?: unknown, segundo?: unknown) => {
    pedidos.push({ alvo: null, opcoes: normalizarOpcoes(primeiro, segundo) });
  }) as typeof window.scrollTo;

  Element.prototype.scrollTo = function registar(
    this: Element,
    primeiro?: unknown,
    segundo?: unknown,
  ) {
    pedidos.push({ alvo: this, opcoes: normalizarOpcoes(primeiro, segundo) });
  } as typeof Element.prototype.scrollTo;

  const posicionarJanela = (y: number): void => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
    Object.defineProperty(window, "pageYOffset", { value: y, configurable: true, writable: true });
  };

  return {
    pedidos,
    daJanela: () => pedidos.filter((pedido) => pedido.alvo === null),
    posicionarJanela,
    restaurar() {
      window.scrollTo = janelaOriginal;
      Element.prototype.scrollTo = elementoOriginal;
      if (posicaoOriginal !== undefined) Object.defineProperty(window, "scrollY", posicaoOriginal);
      if (deslocamentoOriginal !== undefined) {
        Object.defineProperty(window, "pageYOffset", deslocamentoOriginal);
      }
      pedidos.length = 0;
    },
  };
}

export type MediaFalsa = {
  restaurar(): void;
};

/**
 * Um `matchMedia` que existe e responde que não a tudo.
 *
 * Só isso, e de propósito. Responde `matches: false`, que é o ambiente de
 * omissão — movimento normal —, e não deixa o teste pedir outra coisa: o
 * movimento reduzido prova-se num browser a sério, com
 * `test.use({ reducedMotion: "reduce" })` em `e2e/ementa.spec.ts`, porque o
 * que ele muda é o deslize do documento e em jsdom não há deslize nenhum.
 * Um interruptor aqui dava um teste que trocava o valor e não via diferença
 * nenhuma.
 */
export function instalarMatchMedia(): MediaFalsa {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (consulta: string): MediaQueryList => {
      return {
        matches: false,
        media: consulta,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    },
  });

  return {
    restaurar() {
      if (original === undefined) {
        delete (window as { matchMedia?: unknown }).matchMedia;
        return;
      }
      Object.defineProperty(window, "matchMedia", original);
    },
  };
}
