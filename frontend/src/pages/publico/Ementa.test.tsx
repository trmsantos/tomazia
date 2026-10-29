/**
 * F3-02, 12.4 — o ecrã da ementa, com um cliente falso.
 *
 * Contrato:
 *
 * ```tsx
 * export function Ementa(): ReactElement
 * ```
 *
 * Desenha a `<section id="ementa">` inteira: o `<h2>`, a barra fixa com os
 * chips e a lupa, a linha de contagem e os cartões creme. Vai buscar os
 * dados sozinha a `obterEmenta()` — a ementa aparece sem um toque (secção
 * 1) — com um prazo de 10 s (5.4).
 *
 * **O que este ficheiro prova:** os quatro ramos da máquina de 5.5; que um
 * `AbortError` **não** põe o ecrã em erro e um `ErroDaApi` põe; que o prazo
 * existe e aborta com `TimeoutError`; que desmontar aborta; que "Tentar
 * outra vez" refaz o pedido e o botão fica montado durante a tentativa; a
 * pesquisa inteira (nome acessível, foco, `Esc`, posição, contagem); e que
 * há um chip por cartão em todos os estados.
 *
 * **O que deixa passar:** tudo o que precisa de layout. Em jsdom não há
 * posição, não há `sticky`, não há deslize e não há `scroll-padding`. O
 * ecrã pode estar inteiro por baixo da barra e este ficheiro passa — é
 * `e2e/ementa.spec.ts` e `e2e/ementa-acessibilidade.spec.ts` que fecham
 * isso.
 *
 * O cliente falso **imita o contrato do `cliente.ts`** e não só a
 * assinatura: um sinal abortado com `TimeoutError` sai como `ErroDaApi` com
 * `estado: null`, e um `AbortError` sai cru. Sem isto, o teste do prazo
 * provava que o temporizador dispara e não provava que o ecrã muda.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../../lib/api/cliente";
import type { OpcoesDePedido } from "../../lib/api/cliente";
import { indexarEmenta } from "../../lib/ementa/pesquisa";
import { obterEmenta } from "../../lib/api/publico";
import type { Ementa as RespostaDaEmenta } from "../../lib/api/publico";
import {
  CARTOES_ESPERADOS,
  EMENTA_DE_TESTE,
  EMENTA_SO_COM_CATEGORIAS_VAZIAS,
  EMENTA_VAZIA,
  ID_DA_BARRA,
  SELETOR_DOS_CARTOES,
  TEXTOS_DA_EMENTA,
  contagemDeResultados,
} from "../../testes/ementa";
import { instalarDeslocamento, instalarMatchMedia } from "../../testes/jsdom-da-ementa";
import type { DeslocamentoFalso, MediaFalsa } from "../../testes/jsdom-da-ementa";
import { Ementa } from "./Ementa";

vi.mock("../../lib/api/publico", () => ({ obterEmenta: vi.fn() }));

/**
 * O módulo da pesquisa passa inteiro, com o `indexarEmenta` embrulhado num
 * espião. Nada do comportamento muda — o que se ganha é poder **contar** as
 * chamadas, que é a única forma de ver a diferença entre indexar uma vez e
 * indexar a cada tecla: as duas dão exactamente os mesmos cartões no ecrã.
 */
vi.mock("../../lib/ementa/pesquisa", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../lib/ementa/pesquisa")>();
  return { ...original, indexarEmenta: vi.fn(original.indexarEmenta) };
});

const pedir = vi.mocked(obterEmenta);
const indexar = vi.mocked(indexarEmenta);

/**
 * O nome do motivo de uma abortagem, sem passar por `instanceof Error`.
 *
 * **Em jsdom, `new DOMException(…) instanceof Error` é `false`** (medido). O
 * `cliente.ts` lê o nome com `razao instanceof Error ? razao.name : …`, o
 * que no browser está certo — ali `DOMException` herda de `Error` — e em
 * jsdom lê um `TimeoutError` como se fosse um `AbortError`. Um teste que
 * usasse a mesma forma dizia "o prazo não disparou" quando o prazo tinha
 * disparado: o pior tipo de falha, porque acusa o código certo.
 */
function nomeDaRazao(razao: unknown): string {
  if (typeof razao === "object" && razao !== null && "name" in razao) {
    return String((razao as { name: unknown }).name);
  }
  return String(razao);
}

type PedidoEmCurso = {
  sinal: AbortSignal | undefined;
  resolver: (resposta: RespostaDaEmenta) => void;
  rejeitar: (erro: unknown) => void;
};

/**
 * Um `obterEmenta` que fica pendurado até o teste mandar, e que reage ao
 * `abort` como o `cliente.ts` reage: `TimeoutError` vira `ErroDaApi` com
 * `estado: null`; tudo o resto sai cru.
 */
function clienteFalso(): PedidoEmCurso[] {
  const pedidos: PedidoEmCurso[] = [];

  pedir.mockImplementation((opcoes?: OpcoesDePedido) => {
    let resolver: (resposta: RespostaDaEmenta) => void = () => undefined;
    let rejeitar: (erro: unknown) => void = () => undefined;
    const promessa = new Promise<RespostaDaEmenta>((cumprir, falhar) => {
      resolver = cumprir;
      rejeitar = falhar;
    });

    const sinal = opcoes?.sinal;
    sinal?.addEventListener("abort", () => {
      if (nomeDaRazao(sinal.reason) === "TimeoutError") {
        rejeitar(
          new ErroDaApi("O servidor demorou demasiado a responder. Tenta outra vez.", {
            estado: null,
            codigo: null,
          }),
        );
        return;
      }
      rejeitar(sinal.reason);
    });

    pedidos.push({ sinal, resolver, rejeitar });
    return promessa;
  });

  return pedidos;
}

/** Desenha e espera que a ementa esteja pronta. */
async function desenharComEmenta(resposta: RespostaDaEmenta = EMENTA_DE_TESTE) {
  pedir.mockResolvedValue(resposta);
  const resultado = render(<Ementa />);
  await screen.findByRole("navigation", { name: TEXTOS_DA_EMENTA.nomeDaBarra });
  return resultado;
}

/** Desenha e espera pelo ecrã de erro. */
async function desenharComErro(estado: number | null, mensagem = "mensagem crua do servidor") {
  pedir.mockRejectedValue(new ErroDaApi(mensagem, { estado, codigo: null }));
  const resultado = render(<Ementa />);
  await screen.findByText(TEXTOS_DA_EMENTA.erroTitulo);
  return resultado;
}

/**
 * Procurar sem colapsar o espaço inquebrável, como em
 * `LinhaDeProduto.test.tsx`: o normalizador por omissão troca o U+00A0 por
 * um espaço normal antes de comparar, e aí `getByText("1,20\u00a0€")` nunca
 * encontra nada enquanto `getByText("1,20 €")` encontraria também um preço
 * com o espaço errado (6.1).
 */
const SEM_COLAPSAR = { normalizer: (texto: string) => texto.trim() };

function cartoes(raiz: HTMLElement): NodeListOf<Element> {
  return raiz.querySelectorAll(SELETOR_DOS_CARTOES);
}

function chips(): HTMLElement[] {
  const barra = screen.queryByRole("navigation", { name: TEXTOS_DA_EMENTA.nomeDaBarra });
  if (barra === null) return [];
  return within(barra).queryAllByRole("link");
}

function abrirPesquisa(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_EMENTA.abrirPesquisa }));
  return screen.getByRole("searchbox", { name: TEXTOS_DA_EMENTA.campoDePesquisa });
}

function escrever(campo: HTMLElement, texto: string): void {
  fireEvent.change(campo, { target: { value: texto } });
}

let deslocamento: DeslocamentoFalso;
let media: MediaFalsa;

beforeEach(() => {
  deslocamento = instalarDeslocamento();
  media = instalarMatchMedia();
  pedir.mockReset();
  indexar.mockClear();
});

afterEach(() => {
  deslocamento.restaurar();
  media.restaurar();
});

describe("a carregar", () => {
  it("mostra o esqueleto com `aria-busy`, e nunca a palavra «a carregar»", () => {
    clienteFalso();
    const { container } = render(<Ementa />);

    const ocupada = container.querySelector('[aria-busy="true"]');
    expect(ocupada, "a região que está a carregar leva aria-busy=true (5.1)").not.toBeNull();
    expect(
      container.textContent,
      "o esqueleto tem a forma do que vem a seguir; não leva texto de espera",
    ).not.toMatch(/a carregar/i);
  });

  it("o esqueleto tem a forma de dois cartões creme", () => {
    clienteFalso();
    const { container } = render(<Ementa />);

    expect(
      container.querySelectorAll(".superficie-creme").length,
      "dois cartões creme, para o creme sobre bordô aparecer de imediato e o " +
        "layout quase não saltar quando os dados chegam (5.1)",
    ).toBeGreaterThanOrEqual(2);
  });

  it("não há barra de categorias, e os blocos em forma de chip não são clicáveis", () => {
    clienteFalso();
    const { container } = render(<Ementa />);

    expect(chips(), "a carregar não há chips a sério").toHaveLength(0);

    const barra = container.querySelector(`#${ID_DA_BARRA}`);
    const falsos = barra?.querySelectorAll("a, button, [tabindex]") ?? [];
    expect(
      [...falsos].filter(
        (elemento) => elemento.getAttribute("aria-label") !== TEXTOS_DA_EMENTA.abrirPesquisa,
      ),
      "um chip falso em que se pode carregar é pior do que uma barra vazia (5.1)",
    ).toHaveLength(0);
  });

  it("a linha de contagem existe desde o primeiro render, vazia", () => {
    // Lição da F3-01, 7.5: uma região viva inserida já com texto muitas
    // vezes não é anunciada. Tem de estar no DOM antes de ter o que dizer.
    clienteFalso();
    render(<Ementa />);

    const contagem = screen.getByRole("status");
    expect(contagem).toBeInTheDocument();
    expect(contagem.textContent?.trim()).toBe("");
  });
});

describe("pronta", () => {
  it("a ementa aparece sem nenhum toque", async () => {
    await desenharComEmenta();

    expect(screen.getByText("Galão")).toBeInTheDocument();
    expect(screen.getByText("Imperial")).toBeInTheDocument();
  });

  it("sai do `aria-busy` quando os dados chegam", async () => {
    const { container } = await desenharComEmenta();

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("há um chip por cartão — e a categoria sem produtos não dá nem uma coisa nem outra", async () => {
    const { container } = await desenharComEmenta();

    expect(cartoes(container)).toHaveLength(CARTOES_ESPERADOS);
    expect(chips()).toHaveLength(CARTOES_ESPERADOS);
    expect(container.textContent).not.toContain("Categoria sem produtos");
  });

  it("cada chip aponta para um cartão que existe mesmo", async () => {
    const { container } = await desenharComEmenta();

    const semDestino = chips()
      .map((chip) => chip.getAttribute("href") ?? "")
      .filter(
        (href) => container.querySelector(`${SELETOR_DOS_CARTOES}[id="${href.slice(1)}"]`) === null,
      );

    expect(semDestino, "um chip que aponta para um id que não existe salta para o nada").toEqual(
      [],
    );
  });

  it("os cartões têm nome, para o leitor de ecrã anunciar «Cafés, região»", async () => {
    const { container } = await desenharComEmenta();

    const semNome = [...cartoes(container)].filter(
      (cartao) => cartao.getAttribute("aria-labelledby") === null,
    );

    expect(semNome).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Cafés", level: 3 })).toBeInTheDocument();
  });

  it("o preço 0 sai como «Oferta», num cartão onde há preço a pagar ao lado", async () => {
    await desenharComEmenta();

    expect(screen.getByText(TEXTOS_DA_EMENTA.oferta)).toBeInTheDocument();
    expect(screen.queryByText("0,00\u00a0€")).toBeNull();

    // O "Oferta" tem de ter um preço a pagar no mesmo cartão: é a única
    // forma de a comparação se ver, e é o que faz a captura provar o que
    // parece provar. Sozinho num cartão, ou num cartão cujo nome já prepare
    // a leitura — "Água e cortesia", que era o que estava aqui —, não prova.
    const cartao = screen.getByText(TEXTOS_DA_EMENTA.oferta).closest("section");
    expect(cartao, "o «Oferta» não está dentro de nenhum cartão").not.toBeNull();
    expect(
      within(cartao as HTMLElement).getByText("1,20\u00a0€", SEM_COLAPSAR),
      "o cartão do «Oferta» perdeu o preço a pagar que estava ao lado dele",
    ).toBeInTheDocument();
  });

  it("um nome com «&» e um com apóstrofo saem como o dono os escreveu", async () => {
    // Cinco das categorias de uma carta de bar são garrafas, e os nomes
    // delas vêm com a marca. O "&" é o caractere que uma escapatória a mais
    // transforma em "J&amp;B" no ecrã, e o apóstrofo é o que parte um nome
    // em dois quando alguém o mete dentro de um seletor.
    const { container } = await desenharComEmenta();

    expect(screen.getByText("J&B")).toBeInTheDocument();
    expect(screen.getByText("Ballantine's")).toBeInTheDocument();
    expect(screen.getByText("Gin Gordon's")).toBeInTheDocument();
    expect(
      container.innerHTML,
      "o «&» chegou ao ecrã escapado duas vezes: o nome do produto está a " +
        "passar por HTML em vez de ser um nó de texto",
    ).not.toContain("J&amp;amp;B");
  });

  it("o título da secção é um `h2` e pode receber foco por código", async () => {
    await desenharComEmenta();

    const titulo = screen.getByRole("heading", { name: TEXTOS_DA_EMENTA.titulo, level: 2 });
    expect(
      titulo.getAttribute("tabindex"),
      "é para aqui que o foco vai depois de uma tentativa bem sucedida (5.3)",
    ).toBe("-1");
  });
});

describe("vazia", () => {
  it("`{categorias: []}` com 200 é uma resposta legítima e tem ecrã próprio", async () => {
    pedir.mockResolvedValue(EMENTA_VAZIA);
    render(<Ementa />);

    expect(await screen.findByText(TEXTOS_DA_EMENTA.vaziaTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS_DA_EMENTA.vaziaLinha)).toBeInTheDocument();
  });

  it("sem botão: não há nada que quem está sentado possa carregar para resolver isto", async () => {
    pedir.mockResolvedValue(EMENTA_VAZIA);
    render(<Ementa />);
    await screen.findByText(TEXTOS_DA_EMENTA.vaziaTitulo);

    expect(
      screen.queryAllByRole("button"),
      "um botão que não resolve nada é pior do que nenhum (5.2)",
    ).toHaveLength(0);
  });

  it("não há barra de categorias", async () => {
    pedir.mockResolvedValue(EMENTA_VAZIA);
    render(<Ementa />);
    await screen.findByText(TEXTOS_DA_EMENTA.vaziaTitulo);

    expect(chips()).toHaveLength(0);
  });

  it("categorias todas sem produtos contam como vazia", async () => {
    // O backend nunca devolve isto, mas o frontend não confia nisso (5.2).
    pedir.mockResolvedValue(EMENTA_SO_COM_CATEGORIAS_VAZIAS);
    render(<Ementa />);

    expect(await screen.findByText(TEXTOS_DA_EMENTA.vaziaTitulo)).toBeInTheDocument();
    expect(screen.queryByText("Nada hoje")).toBeNull();
  });
});

describe("erro: duas frases diferentes, porque são duas coisas diferentes", () => {
  it("sem resposta (estado null) diz para verificar a ligação", async () => {
    await desenharComErro(null);

    expect(screen.getByText(TEXTOS_DA_EMENTA.erroSemResposta)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS_DA_EMENTA.erroComResposta)).toBeNull();
  });

  it("o servidor respondeu (estado 500) diz que o problema é do servidor", async () => {
    await desenharComErro(500);

    expect(screen.getByText(TEXTOS_DA_EMENTA.erroComResposta)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS_DA_EMENTA.erroSemResposta)).toBeNull();
  });

  it("«não houve resposta» e «o servidor disse que não» não podem dar a mesma frase", () => {
    // A regra 10 do `CLAUDE.md` a chegar ao ecrã. Fica como asserção e não
    // como comentário porque uma correção futura que unifique as duas
    // frases tem de ficar vermelha aqui, e não passar na revisão.
    expect(TEXTOS_DA_EMENTA.erroSemResposta).not.toBe(TEXTOS_DA_EMENTA.erroComResposta);

    // E nenhuma pode ser parte da outra. Não é preciosismo: os testes e2e
    // provam a distinção com `getByText(…)`, que no Playwright condiz por
    // **subcadeia**. Com uma frase contida na outra, o
    // `toHaveCount(0)` do lado que não devia aparecer passava a encontrá-la
    // sempre e a prova da distinção morria em silêncio, aqui e no e2e.
    expect(
      TEXTOS_DA_EMENTA.erroComResposta.includes(TEXTOS_DA_EMENTA.erroSemResposta) ||
        TEXTOS_DA_EMENTA.erroSemResposta.includes(TEXTOS_DA_EMENTA.erroComResposta),
      "uma das duas frases de erro contém a outra",
    ).toBe(false);
  });

  it("o título é o mesmo nos dois: a pessoa não quer saber de quem é a culpa", async () => {
    const { unmount } = await desenharComErro(null);
    expect(screen.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeInTheDocument();
    unmount();

    await desenharComErro(503);
    expect(screen.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeInTheDocument();
  });

  it("a mensagem crua do servidor nunca aparece", async () => {
    const { container } = await desenharComErro(500, "FastAPI: ValidationError em /ementa");

    expect(
      container.textContent,
      "o `ErroDaApi.mensagem` é escrito para quem chama a API, não para quem " +
        "está sentado à mesa (5.3)",
    ).not.toContain("ValidationError");
  });

  it("tem um botão «Tentar outra vez» e não tem barra de categorias", async () => {
    await desenharComErro(null);

    expect(
      screen.getByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez }),
    ).toBeInTheDocument();
    expect(chips()).toHaveLength(0);
  });
});

describe("o quarto estado: «a carregar» para sempre", () => {
  it("um `AbortError` não põe o ecrã em erro", async () => {
    // Em `React.StrictMode` os efeitos correm duas vezes em
    // desenvolvimento e o primeiro pedido é **sempre** cancelado. Sem este
    // guarda, a ementa mostrava "Não consegui carregar" em todos os
    // arranques (5.4).
    const abortado = new DOMException("cancelado", "AbortError");
    pedir.mockRejectedValue(abortado);
    const { container } = render(<Ementa />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeNull();
    expect(
      container.querySelector('[aria-busy="true"]'),
      "um cancelamento não muda o estado: fica como estava",
    ).not.toBeNull();
  });

  it("um erro que não é `ErroDaApi` **muda** o ecrã, e dá botão para tentar", async () => {
    // Este teste dizia o contrário, e era ele que cimentava o defeito: o
    // `.catch` tinha dois ramos para três casos e «fui cancelado» chegava
    // igual a «o meu próprio código rebentou». Um `TypeError` engolido
    // deixa o ecrã em `aria-busy` para sempre e **sem** «Tentar outra
    // vez», porque esse botão só existe no ramo de erro — que é o quarto
    // estado que 5.4 diz que nunca pode acontecer.
    pedir.mockRejectedValue(new TypeError("boom"));
    const { container } = render(<Ementa />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[aria-busy="true"]'),
      "ficar em «a carregar» é o pior dos quatro estados: nem sequer deixa tentar " +
        "outra vez (5.4)",
    ).toBeNull();
  });

  it("uma resposta 200 sem `categorias` dá o ecrã de erro, não «a carregar» para sempre", async () => {
    // Um portal cativo de WiFi, um proxy, um deploy parcial do backend:
    // 200 com JSON válido e sem `categorias`. O índice lança um
    // `TypeError` **dentro do `.then`**, e é por isso que esta causa não se
    // parece com um erro de rede — vem do nosso próprio código, pela porta
    // do caminho feliz.
    pedir.mockResolvedValue({ ok: true } as unknown as RespostaDaEmenta);
    const { container } = render(<Ementa />);

    expect(await screen.findByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeInTheDocument();
    expect(
      screen.getByText(TEXTOS_DA_EMENTA.erroComResposta),
      "houve resposta; o que não houve foi uma ementa (5.3)",
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez }),
    ).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("em `StrictMode`, o pedido cancelado do primeiro efeito não estraga o segundo", async () => {
    const pedidos = clienteFalso();

    render(
      <StrictMode>
        <Ementa />
      </StrictMode>,
    );

    expect(
      pedidos.length,
      "guarda: o StrictMode devia ter corrido o efeito duas vezes. Se só correu " +
        "uma, este teste deixou de provar o que diz provar.",
    ).toBeGreaterThanOrEqual(2);
    expect(pedidos[0]?.sinal?.aborted, "o primeiro pedido é cancelado ao remontar").toBe(true);

    await act(async () => {
      pedidos[pedidos.length - 1]?.resolver(EMENTA_DE_TESTE);
      await Promise.resolve();
    });

    expect(screen.queryByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeNull();
    expect(await screen.findByText("Galão")).toBeInTheDocument();
  });

  it("desmontar aborta o pedido, e aborta como cancelamento", async () => {
    const pedidos = clienteFalso();
    const { unmount } = render(<Ementa />);

    const sinal = pedidos[0]?.sinal;
    expect(sinal, "o pedido tem de levar um sinal, senão não há como o cancelar").toBeDefined();
    expect(sinal?.aborted).toBe(false);

    unmount();

    expect(sinal?.aborted).toBe(true);
    expect(
      nomeDaRazao(sinal?.reason),
      "desmontar é um cancelamento, não um prazo esgotado: os dois têm de se distinguir",
    ).not.toBe("TimeoutError");
  });
});

describe("o prazo de 10 s", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aos 9,999 s ainda não abortou", async () => {
    const pedidos = clienteFalso();
    render(<Ementa />);

    await act(async () => {
      vi.advanceTimersByTime(9_999);
    });

    expect(
      pedidos[0]?.sinal?.aborted,
      "menos de 10 s e uma rede fraca falha quando ia conseguir (5.4)",
    ).toBe(false);
  });

  it("aos 10 s aborta com `TimeoutError` e o ecrã passa a erro de rede", async () => {
    const pedidos = clienteFalso();
    render(<Ementa />);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    const sinal = pedidos[0]?.sinal;
    expect(sinal?.aborted).toBe(true);
    expect(
      nomeDaRazao(sinal?.reason),
      "tem de ser `TimeoutError` e não `AbortError`: o cliente olha para o **nome** " +
        "do motivo, e um `AbortError` sairia cru — o ecrã ficava a carregar para sempre",
    ).toBe("TimeoutError");

    // E é também este teste que prende a **ordem** dos ramos do `.catch`:
    // aqui o sinal está abortado **e** o erro é um `ErroDaApi`. Quem puser
    // o guarda do cancelamento à frente do erro da API engole este caso, e
    // o ecrã fica a carregar para sempre — o defeito a voltar pela outra
    // porta. A asserção que se segue é a que fica vermelha.

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_EMENTA.erroSemResposta)).toBeInTheDocument();
  });

  it("não há repetição automática", async () => {
    pedir.mockRejectedValue(new ErroDaApi("sem rede", { estado: null, codigo: null }));
    render(<Ementa />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(
      pedir,
      "uma repetição em ciclo esconde o problema e gasta dados de quem está numa " +
        "rede fraca. Uma pessoa, um toque, uma tentativa (5.3)",
    ).toHaveBeenCalledTimes(1);
  });
});

describe("tentar outra vez", () => {
  it("refaz o pedido, e o botão fica montado durante a tentativa", async () => {
    const pedidos = clienteFalso();
    render(<Ementa />);

    await act(async () => {
      pedidos[0]?.rejeitar(new ErroDaApi("sem rede", { estado: null, codigo: null }));
      await Promise.resolve();
    });

    const botao = await screen.findByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });

    // Se o bloco de erro fosse substituído pelo esqueleto, o foco caía para
    // o `<body>` e quem navega por teclado era largado no topo da página,
    // sem explicação (5.3). A asserção é sobre **o mesmo nó do DOM** e não
    // sobre o nome acessível: durante a tentativa o botão passa a chamar-se
    // "A tentar…", e procurá-lo pelo nome antigo dizia "desmontou" quando
    // ele está lá — a falha a acusar o código certo.
    expect(document.body.contains(botao), "o botão não pode desmontar durante a tentativa").toBe(
      true,
    );
    expect(botao).toHaveTextContent(TEXTOS_DA_EMENTA.aTentar);
    expect(botao, "e fica marcado como ocupado").toHaveAttribute("aria-busy", "true");

    await act(async () => {
      pedidos[1]?.resolver(EMENTA_DE_TESTE);
      await Promise.resolve();
    });

    expect(await screen.findByText("Galão")).toBeInTheDocument();
  });

  it("uma tentativa que rebenta no `.then` não deixa o botão preso em «A tentar…»", async () => {
    // O `setATentar(false)` vivia só no ramo do `ErroDaApi`. Com uma
    // segunda resposta 200 sem `categorias`, o ecrã voltava ao erro e o
    // botão ficava a dizer "A tentar…" para sempre, ocupado, a prometer um
    // pedido que já acabou.
    const pedidos = clienteFalso();
    render(<Ementa />);

    await act(async () => {
      pedidos[0]?.rejeitar(new ErroDaApi("sem rede", { estado: null, codigo: null }));
      await Promise.resolve();
    });

    const botao = await screen.findByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez });
    fireEvent.click(botao);
    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });
    expect(botao, "guarda: a tentativa tem mesmo de estar a decorrer").toHaveTextContent(
      TEXTOS_DA_EMENTA.aTentar,
    );

    await act(async () => {
      pedidos[1]?.resolver({ ok: true } as unknown as RespostaDaEmenta);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(botao).toHaveTextContent(TEXTOS_DA_EMENTA.tentarOutraVez);
    });
    expect(botao).not.toHaveAttribute("aria-busy", "true");
  });

  it("quando a tentativa corre bem, o foco passa para o `h2`", async () => {
    const pedidos = clienteFalso();
    render(<Ementa />);

    await act(async () => {
      pedidos[0]?.rejeitar(new ErroDaApi("sem rede", { estado: null, codigo: null }));
      await Promise.resolve();
    });

    fireEvent.click(await screen.findByRole("button", { name: TEXTOS_DA_EMENTA.tentarOutraVez }));
    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });

    await act(async () => {
      pedidos[1]?.resolver(EMENTA_DE_TESTE);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        document.activeElement,
        "a pessoa ouve onde aterrou em vez de ficar no vazio (5.3)",
      ).toBe(screen.getByRole("heading", { name: TEXTOS_DA_EMENTA.titulo, level: 2 }));
    });
  });
});

describe("a pesquisa", () => {
  it("a lupa tem nome acessível e abre o campo no lugar dos chips", async () => {
    await desenharComEmenta();

    expect(chips().length).toBeGreaterThan(0);
    const campo = abrirPesquisa();

    expect(campo).toHaveAttribute("type", "search");
    expect(campo).toHaveAttribute("placeholder", TEXTOS_DA_EMENTA.exemploDePesquisa);
    expect(
      chips(),
      "aberta, a barra é a caixa de pesquisa — os chips não existem (4.2)",
    ).toHaveLength(0);
  });

  it("abrir move o foco para o campo", async () => {
    await desenharComEmenta();
    const campo = abrirPesquisa();

    await waitFor(() => {
      expect(document.activeElement).toBe(campo);
    });
  });

  it("`Esc` fecha e devolve o foco à lupa", async () => {
    await desenharComEmenta();
    const campo = abrirPesquisa();

    fireEvent.keyDown(campo, { key: "Escape" });

    await waitFor(() => {
      expect(chips().length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: TEXTOS_DA_EMENTA.abrirPesquisa }),
      );
    });
  });

  it("`Esc` fecha também com o foco no botão «Fechar a pesquisa»", async () => {
    // A 4.1 diz «`Esc` fecha», sem qualificar. Com o manipulador no campo,
    // e só no campo, quem tivesse chegado ao botão por tabulação carregava
    // em `Esc` e não acontecia nada — a 44 px do sítio onde acontecia.
    await desenharComEmenta();
    abrirPesquisa();

    const fechar = screen.getByRole("button", { name: TEXTOS_DA_EMENTA.fecharPesquisa });
    fechar.focus();
    expect(document.activeElement, "guarda: o foco tem mesmo de estar no botão").toBe(fechar);

    fireEvent.keyDown(fechar, { key: "Escape" });

    await waitFor(() => {
      expect(chips().length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("searchbox", { name: TEXTOS_DA_EMENTA.campoDePesquisa })).toBeNull();
  });

  it("fechar limpa a pesquisa e devolve a ementa inteira", async () => {
    const { container } = await desenharComEmenta();
    const campo = abrirPesquisa();
    escrever(campo, "galao");

    await waitFor(() => {
      expect(cartoes(container)).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_EMENTA.fecharPesquisa }));

    await waitFor(() => {
      expect(cartoes(container)).toHaveLength(CARTOES_ESPERADOS);
    });
    expect(chips()).toHaveLength(CARTOES_ESPERADOS);
  });

  it("filtra a partir da primeira letra, sem mínimo de caracteres", async () => {
    const { container } = await desenharComEmenta();
    const campo = abrirPesquisa();

    escrever(campo, "g");

    await waitFor(() => {
      expect(cartoes(container).length).toBeLessThan(CARTOES_ESPERADOS);
    });
  });

  it("o fragmento do URL não muda enquanto se escreve", async () => {
    await desenharComEmenta();
    const antes = window.location.hash;
    const campo = abrirPesquisa();

    escrever(campo, "galao");

    expect(
      window.location.hash,
      "o fragmento é território das âncoras; as duas coisas lutariam (4.2)",
    ).toBe(antes);
  });

  it("ao primeiro caractere a lista salta para o topo; às teclas seguintes não", async () => {
    await desenharComEmenta();
    const campo = abrirPesquisa();
    const antes = deslocamento.daJanela().length;

    escrever(campo, "g");
    const depoisDoPrimeiro = deslocamento.daJanela().length;

    escrever(campo, "ga");
    escrever(campo, "gal");
    const depoisDosOutros = deslocamento.daJanela().length;

    expect(depoisDoPrimeiro, "ao primeiro caractere a lista salta para o topo").toBeGreaterThan(
      antes,
    );
    expect(
      depoisDosOutros,
      "as teclas seguintes não mexem na posição — senão a lista fugia a cada letra (4.2)",
    ).toBe(depoisDoPrimeiro);
  });

  it("ao fechar, a página volta à posição que tinha quando a lupa foi tocada", async () => {
    await desenharComEmenta();
    deslocamento.posicionarJanela(1240);

    const campo = abrirPesquisa();
    escrever(campo, "galao");
    deslocamento.posicionarJanela(0);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_EMENTA.fecharPesquisa }));

    const ultimo = deslocamento.daJanela().at(-1);
    expect(
      ultimo?.opcoes.top,
      "alguém estava a ler os gins, foi ver uma coisa, fechou, e aterrou no topo (4.2)",
    ).toBe(1240);
  });
});

describe("a contagem de resultados", () => {
  it("o lugar da contagem reserva-se à abertura, e não existe com a pesquisa fechada", async () => {
    // Medido na revisão: a linha entrava no fluxo meio segundo depois da
    // última tecla e empurrava o primeiro cartão 31,6 px para baixo, com a
    // pessoa já a ler os resultados. O lugar nasce com a pesquisa, que é
    // um redesenho da barra inteira — mais uma linha vazia lá dentro não
    // se vê (4.5). O salto em píxeis mede-se no browser
    // (`e2e/ementa.spec.ts`); aqui prende-se a casca.
    await desenharComEmenta();

    expect(
      screen.getByRole("status").parentElement?.className,
      "com a pesquisa fechada não pode haver faixa morta entre a barra e o primeiro cartão",
    ).toBe("");

    abrirPesquisa();

    expect(
      screen.getByRole("status").parentElement?.className,
      "o lugar ocupa-se à abertura, 500 ms antes de haver texto para lá pôr",
    ).toContain("h-contagem");
  });

  it("o filtro corre já; o texto da contagem só 500 ms depois", async () => {
    const { container } = await desenharComEmenta();
    const campo = abrirPesquisa();
    const contagem = screen.getByRole("status");

    escrever(campo, "galao");

    await waitFor(() => {
      expect(cartoes(container)).toHaveLength(1);
    });
    expect(
      contagem.textContent,
      "uma região viva que fala a cada tecla transforma «galão» em cinco " +
        "anúncios atropelados (4.5)",
    ).not.toBe(contagemDeResultados(1));

    await waitFor(
      () => {
        expect(contagem.textContent).toBe(contagemDeResultados(1));
      },
      { timeout: 2000 },
    );
  });

  it("o singular é «1 produto encontrado.»", async () => {
    await desenharComEmenta();
    escrever(abrirPesquisa(), "galao");

    expect(
      await screen.findByText("1 produto encontrado.", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("o plural é «{n} produtos encontrados.»", async () => {
    await desenharComEmenta();
    escrever(abrirPesquisa(), "agua");

    expect(
      await screen.findByText("2 produtos encontrados.", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("escrever «12» condiz com o nome do produto e nunca com o preço", async () => {
    // 4.3: o que se pesquisa é o que se vê em letra grande. Nesta fixtura
    // há dois produtos a "1,20 €" — o chá de limão e a água com gás — e
    // nenhum deles pode vir. O único resultado é o nome que tem mesmo
    // algarismos lá dentro, que numa carta de bar é a regra e não a
    // excepção: "Chivas 12 anos", "Porto 10 anos", "1920".
    const { container } = await desenharComEmenta();
    escrever(abrirPesquisa(), "12");

    await waitFor(() => {
      expect(cartoes(container)).toHaveLength(1);
    });
    expect(screen.getByText("Chivas 12 anos")).toBeInTheDocument();
    expect(
      screen.queryByText("Chá de limão"),
      "um produto veio pelo preço: a pesquisa está a olhar para os cêntimos",
    ).toBeNull();
    expect(
      await screen.findByText("1 produto encontrado.", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});

describe("o índice constrói-se uma vez", () => {
  it("escrever cinco letras não volta a indexar a ementa", async () => {
    // 4.4, ponto 3: normaliza-se uma vez por produto, quando a ementa
    // chega, e não a cada tecla. Nada no ecrã distingue as duas coisas —
    // mover o `indexarEmenta` para dentro do `useMemo` do filtro, que é a
    // refactorização óbvia, deixa a bateria inteira verde. Só contando as
    // chamadas é que se vê.
    await desenharComEmenta();

    const depoisDeChegar = indexar.mock.calls.length;
    expect(
      depoisDeChegar,
      "guarda: se ninguém indexou, esta contagem não prova nada — é «não " +
        "consegui procurar» a passar por «não encontrei»",
    ).toBeGreaterThan(0);

    const campo = abrirPesquisa();
    for (const texto of ["g", "ga", "gal", "gala", "galao"]) escrever(campo, texto);

    await waitFor(() => {
      expect(screen.getByText("Galão")).toBeInTheDocument();
    });
    expect(
      indexar.mock.calls.length,
      "indexar a cada tecla percorre os 140 produtos cinco vezes para dar o " +
        "mesmo resultado (4.4)",
    ).toBe(depoisDeChegar);
  });
});

describe("a pesquisa sem resultados", () => {
  it("diz duas coisas: a região viva e o estado vazio", async () => {
    await desenharComEmenta();
    escrever(abrirPesquisa(), "xkcd");

    const vazio = await screen.findByText(TEXTOS_DA_EMENTA.semResultadosLinha);
    expect(vazio).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByRole("status").textContent).toBe(TEXTOS_DA_EMENTA.semResultadosTitulo);
      },
      { timeout: 2000 },
    );
  });

  it("o título repetido não é anunciado duas vezes: só uma das cópias é região viva", async () => {
    /**
     * 4.5 abre com «nunca o mesmo texto duas vezes» e logo a seguir manda
     * repetir o título — e quem lê a especificação fica com a dúvida de se
     * um leitor de ecrã ouve a frase duas vezes. Não ouve, e a razão é
     * mecânica: das duas cópias, **uma só** vive numa região viva. A outra é
     * um título em conteúdo normal, que só se lê quando a pessoa lá navega.
     *
     * O que isto apanha: alguém a embrulhar o `EstadoVazio` num
     * `aria-live`, ou a dar `role="status"` ao bloco inteiro, que é a
     * "correção" óbvia de quem acha que o vazio não está a ser anunciado.
     * É a partir daí que a frase passa a ser dita duas vezes de seguida.
     */
    await desenharComEmenta();
    const campo = abrirPesquisa();
    escrever(campo, "xkcd");

    await waitFor(
      () => {
        expect(screen.getByRole("status").textContent).toBe(TEXTOS_DA_EMENTA.semResultadosTitulo);
      },
      { timeout: 2000 },
    );

    const copias = screen.getAllByText(TEXTOS_DA_EMENTA.semResultadosTitulo);
    expect(
      copias,
      "guarda: 4.5 pede as duas cópias — a da região viva e o título do estado " +
        "vazio. Com uma só, o resto deste teste não prova nada.",
    ).toHaveLength(2);

    const vivas = copias.filter(
      (copia) =>
        copia.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') !== null,
    );

    expect(
      vivas.length,
      "as duas cópias da mesma frase estão dentro de regiões vivas: o leitor de " +
        "ecrã diz «Não encontrei nada com esse nome.» duas vezes seguidas",
    ).toBe(1);
    expect(vivas[0], "a cópia anunciada é a invisível (4.5)").toHaveClass("sr-only");

    const calada = copias.find((copia) => copia !== vivas[0]);
    expect(calada?.tagName, "a cópia que fica é o título do estado vazio").toBe("H3");
    expect(
      document.activeElement,
      "levar o foco ao título fá-lo-ia anunciar logo a seguir à região viva, " +
        "e aí seriam mesmo duas vezes",
    ).toBe(campo);
  });

  it("tem um botão «Limpar pesquisa» que devolve a ementa toda", async () => {
    const { container } = await desenharComEmenta();
    escrever(abrirPesquisa(), "xkcd");

    const limpar = await screen.findByRole("button", { name: TEXTOS_DA_EMENTA.limparPesquisa });
    fireEvent.click(limpar);

    await waitFor(() => {
      expect(cartoes(container)).toHaveLength(CARTOES_ESPERADOS);
    });
  });
});
