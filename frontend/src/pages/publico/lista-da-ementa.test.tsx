/**
 * F3-03, 5.2 — o destino da ligação de salto, nos quatro estados da ementa.
 *
 * **Porque é que isto tem ficheiro próprio:** a única adição ao DOM da F3-02
 * é um `id`, e o que ele promete não é uma coisa que se veja num ecrã — é uma
 * invariante que tem de valer nos quatro estados ao mesmo tempo. Uma ligação
 * de salto para um fragmento que não existe **não faz absolutamente nada, em
 * silêncio**, e faria nada exactamente nos estados em que a página já não
 * está bem: a carregar, vazia e em erro. É a família da regra 10 — "não há
 * conteúdo" e "não encontrei o destino" não podem dar o mesmo resultado, e
 * aqui dariam o mesmo nada.
 *
 * **O que este ficheiro prova:** que `id="lista-da-ementa"` está em
 * **exactamente um** elemento em cada estado da F3-02; que esse elemento vive
 * dentro da `<section id="ementa">` e **depois** da barra de chips — senão o
 * salto deixava as doze paragens onde estavam e era decoração; e que o nome
 * escolhido não pode colidir com as âncoras das categorias.
 *
 * **O que deixa passar:** que o salto leve mesmo a leitura para lá. Isso é
 * `e2e/cabecalho.spec.ts`, com `Tab`, fragmento e posição a sério.
 *
 * Não reescreve nada de `Ementa.test.tsx`: aquele ficheiro prova os quatro
 * ramos da máquina de estados, este prova uma invariante que os atravessa.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../../lib/api/cliente";
import { obterEmenta } from "../../lib/api/publico";
import type { Ementa as RespostaDaEmenta } from "../../lib/api/publico";
import { ID_DO_DESTINO_DO_SALTO, SELETOR_DO_DESTINO } from "../../testes/cabecalho";
import {
  EMENTA_DE_TESTE,
  EMENTA_VAZIA,
  ID_DA_BARRA,
  ID_DA_SECCAO,
  PREFIXO_DAS_ANCORAS,
  TEXTOS_DA_EMENTA,
} from "../../testes/ementa";
import { instalarDeslocamento, instalarMatchMedia } from "../../testes/jsdom-da-ementa";
import type { DeslocamentoFalso, MediaFalsa } from "../../testes/jsdom-da-ementa";
import { Ementa } from "./Ementa";

vi.mock("../../lib/api/publico", () => ({ obterEmenta: vi.fn() }));

const pedir = vi.mocked(obterEmenta);

let deslocamento: DeslocamentoFalso;
let media: MediaFalsa;

beforeEach(() => {
  deslocamento = instalarDeslocamento();
  media = instalarMatchMedia();
  pedir.mockReset();
});

afterEach(() => {
  deslocamento.restaurar();
  media.restaurar();
});

/**
 * O destino, com os dois guardas que a regra 10 pede: ou há exactamente um
 * elemento com o `id`, ou a mensagem diz quantos havia — "zero" e "três" são
 * defeitos diferentes e um `getBy` colapsava-os num "não encontrei".
 */
function destino(raiz: HTMLElement, estado: string): Element {
  const encontrados = raiz.querySelectorAll(SELETOR_DO_DESTINO);

  expect(
    encontrados.length,
    `${estado}: tem de haver exactamente um \`#${ID_DO_DESTINO_DO_SALTO}\` e havia ` +
      `${String(encontrados.length)}. Com zero, a ligação de salto não faz nada e não ` +
      "diz nada; com dois, o browser salta para o primeiro e ninguém sabe qual é (5.2)",
  ).toBe(1);

  return encontrados[0] as Element;
}

/** O destino está dentro da ementa e **depois** da barra de chips. */
function exigirQueEstejaDepoisDaBarra(
  raiz: HTMLElement,
  estado: string,
  barraEsperada: boolean,
): void {
  const alvo = destino(raiz, estado);
  const seccao = raiz.querySelector(`#${ID_DA_SECCAO}`);
  const barra = raiz.querySelector(`#${ID_DA_BARRA}`);

  expect(seccao, `${estado}: não encontrei a secção da ementa — falha de leitura`).not.toBeNull();
  if (seccao === null) return;

  expect(seccao.contains(alvo), `${estado}: o destino vive dentro da ementa`).toBe(true);

  /*
   * **Dois dos quatro estados não têm barra nenhuma**, e é por desenho: a
   * F3-02 (secção 5, e a tabela da 174) tira-a no vazio e no erro, porque não
   * há categorias para marcar. Exigi-la nos quatro era exigir um retângulo
   * pintado de 61 px por cima de um Estado vazio.
   *
   * Mas "não há barra porque não há chips" e "a barra desapareceu" não podem
   * dar o mesmo resultado (regra 10): a ausência **verifica-se**, em vez de se
   * assumir — e verifica-se contra o que a F3-02 diz, não contra o que o DOM
   * calhar ter. Daí o `barraEsperada` vir de quem chama: perguntar ao DOM se
   * devia haver barra é aceitar como legítimo exactamente o defeito que se
   * procura. Sem esse parâmetro, tirar a casca da barra ao estado "a
   * carregar" — uma regressão da F3-02 — passava aqui em verde, porque sem
   * barra também não há chips. Foi o revisor de código que o apanhou.
   */
  if (barraEsperada) {
    expect(
      barra,
      `${estado}: a F3-02 desenha a barra de chips neste estado e ela não está cá. ` +
        "Uma barra que desaparece não é um estado novo, é uma regressão (F3-02, 5)",
    ).not.toBeNull();
  } else {
    expect(
      barra,
      `${estado}: a F3-02 **não** desenha a barra neste estado (5, tabela), e ela ` +
        "apareceu. 61 px de barra vazia por cima de um Estado vazio é pior do que " +
        "não ter barra nenhuma",
    ).toBeNull();
  }

  if (barra === null) {
    const chips = seccao.querySelectorAll('nav a[href^="#"]');
    expect(
      chips.length,
      `${estado}: não encontrei a barra de chips, mas encontrei ${String(chips.length)} ` +
        "chips. Ou a barra existe e o destino vem depois dela, ou não há chips nenhuns " +
        "— uma barra em falta com chips à solta é um defeito, não um estado",
    ).toBe(0);
    return;
  }
  expect(
    alvo === barra || barra.contains(alvo),
    `${estado}: o destino não pode ser a barra nem viver dentro dela`,
  ).toBe(false);

  const depois = Boolean(barra.compareDocumentPosition(alvo) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(
    depois,
    `${estado}: o destino tem de estar **depois** da barra. Um salto para antes dela ` +
      "deixa as doze paragens exactamente onde estavam, e uma ligação de salto que " +
      "salta por cima de uma paragem é decoração (5.2)",
  ).toBe(true);
}

/** Um `obterEmenta` que nunca responde: é o estado "a carregar". */
function pendurar(): void {
  pedir.mockImplementation(() => new Promise<RespostaDaEmenta>(() => undefined));
}

describe("o `id` do destino do salto", () => {
  it("não pode colidir com as âncoras das categorias", () => {
    // As âncoras são `ementa-${slug}`, com o `slug` a vir da API e a passar
    // a ser editável pelo dono na F4-02. Uma categoria com o slug
    // `conteudo` mandava o salto para o sítio errado, em silêncio.
    expect(
      ID_DO_DESTINO_DO_SALTO.startsWith(PREFIXO_DAS_ANCORAS),
      `«${ID_DO_DESTINO_DO_SALTO}» começa pelo prefixo das âncoras de categoria`,
    ).toBe(false);
    expect(ID_DO_DESTINO_DO_SALTO).not.toBe(ID_DA_SECCAO);
  });

  it("a carregar: está no bloco que está a carregar", async () => {
    pendurar();
    const { container } = render(<Ementa />);

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
    exigirQueEstejaDepoisDaBarra(container, "a carregar", true);
  });

  it("com produtos: está na lista dos cartões", async () => {
    pedir.mockResolvedValue(EMENTA_DE_TESTE);
    const { container } = render(<Ementa />);
    await screen.findByText("Galão");

    exigirQueEstejaDepoisDaBarra(container, "com produtos", true);
    expect(
      destino(container, "com produtos").querySelectorAll("section[id^='ementa-']").length,
      "com produtos, o destino é a lista dos cartões: saltar para a ementa é saltar " +
        "para a leitura (5.4)",
    ).toBeGreaterThan(0);
  });

  it("vazia: está no estado vazio", async () => {
    pedir.mockResolvedValue(EMENTA_VAZIA);
    const { container } = render(<Ementa />);
    await screen.findByText(TEXTOS_DA_EMENTA.vaziaTitulo);

    exigirQueEstejaDepoisDaBarra(container, "vazia", false);
  });

  it("erro: está no bloco de erro", async () => {
    pedir.mockRejectedValue(new ErroDaApi("sem resposta", { estado: null, codigo: null }));
    const { container } = render(<Ementa />);
    await screen.findByText(TEXTOS_DA_EMENTA.erroTitulo);

    exigirQueEstejaDepoisDaBarra(container, "erro", false);
  });

  it("pesquisa sem resultados: continua a haver um, e só um", async () => {
    pedir.mockResolvedValue(EMENTA_DE_TESTE);
    const { container } = render(<Ementa />);
    await screen.findByText("Galão");

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_EMENTA.abrirPesquisa }));
    fireEvent.change(screen.getByRole("searchbox", { name: TEXTOS_DA_EMENTA.campoDePesquisa }), {
      target: { value: "xkcd" },
    });
    await screen.findByText(TEXTOS_DA_EMENTA.semResultadosLinha);

    exigirQueEstejaDepoisDaBarra(container, "pesquisa sem resultados", true);
  });

  /**
   * **Prova:** que ninguém pôs um `tabindex="-1"` no destino.
   *
   * Um anel dourado de 2 px à volta da lista inteira de cartões lê-se como
   * erro, não como posição — e seguir o fragmento já move o ponto de
   * partida da navegação sequencial sem isso (5.4).
   */
  it("o destino não leva `tabindex`", async () => {
    pedir.mockResolvedValue(EMENTA_DE_TESTE);
    const { container } = render(<Ementa />);
    await screen.findByText("Galão");

    expect(destino(container, "com produtos").hasAttribute("tabindex")).toBe(false);
  });
});
