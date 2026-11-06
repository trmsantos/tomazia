/**
 * F3-05, secção 16.2 — a secção `<section id="galeria">`, com um cliente
 * falso.
 *
 * Contrato que este ficheiro define e que `Galeria.tsx` tem de cumprir:
 *
 * ```tsx
 * export function Galeria(): ReactElement
 * ```
 *
 * Desenha a `<section id="galeria" aria-labelledby="titulo-galeria">`
 * inteira (docs/ecras/F3-05.md, secção 3): o `<h2>` **sempre presente**
 * (ao contrário dos eventos, a galeria nunca desaparece, secção 2.1), o
 * botão "Enviar uma foto" quando há pelo menos uma foto, a grelha, "Ver
 * mais fotos" quando há mais do que as seis visíveis, e o `EstadoVazio`
 * (vazio ou em erro). Vai buscar os dados sozinha a `obterGaleria()` ao
 * montar.
 *
 * **Isolamento deliberado:** este ficheiro **mocka** `FolhaEnviarFoto` e
 * `VisualizadorDeFotos` — os dois têm os seus próprios ficheiros de teste
 * (16.3, 16.4) e testá-los aqui outra vez duplicava a bateria sem provar
 * nada de novo sobre a `Galeria`. O que se prova aqui é só a **ligação**:
 * que a `Galeria` lhes passa as propriedades certas (que fotos, que
 * índice, se está aberta) quando a pessoa toca num botão.
 *
 * **Prova:** os seis estados de 12.1; zero fotos mostra o `EstadoVazio` com
 * o botão **secundário** (não principal — é a emenda de 4.3, e é o ponto
 * mais fácil de escrever ao contrário); mais de seis fotos mostra
 * exactamente seis mais "Ver mais fotos"; carregar nele revela o resto sem
 * um segundo pedido de rede; um `AbortError` não muda o estado e um
 * `ErroDaApi` muda; se uma `<img>` da grelha falhar a chegar (`onError`),
 * uma caixa neutra decorativa substitui-a e o botão, que até aí herdava o
 * nome do `alt` da imagem, ganha o seu próprio `aria-label`.
 *
 * **Deixa passar:** tudo o que é layout — número de colunas, tamanho dos
 * quadrados. jsdom não mede nada disto; isso é `e2e/galeria.spec.ts`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ErroDaApi } from "../../lib/api/cliente";
import type { OpcoesDePedido } from "../../lib/api/cliente";
import { obterGaleria } from "../../lib/api/publico";
import type { Galeria as RespostaDaGaleria } from "../../lib/api/publico";
import {
  FOTO_COM_LEGENDA,
  ID_DA_SECCAO,
  ID_DO_TITULO,
  SEIS_FOTOS,
  SEM_FOTOS,
  SETE_FOTOS,
  TEXTOS_DA_GALERIA,
  UMA_FOTO,
} from "../../testes/galeria";
import { Galeria, altDaFoto } from "./Galeria";

vi.mock("../../lib/api/publico", () => ({ obterGaleria: vi.fn() }));

vi.mock("./FolhaEnviarFoto", () => ({
  FolhaEnviarFoto: (propriedades: { aberta: boolean; aoFechar: () => void }) => (
    <div data-testid="folha-enviar-foto-mock" data-aberta={propriedades.aberta ? "sim" : "nao"}>
      <button type="button" onClick={propriedades.aoFechar}>
        fechar a folha (mock)
      </button>
    </div>
  ),
}));

vi.mock("./VisualizadorDeFotos", () => ({
  VisualizadorDeFotos: (propriedades: {
    fotos: { id: number }[];
    indiceAberto: number | null;
    aoFechar: () => void;
  }) => (
    <div
      data-testid="visualizador-mock"
      data-indice={String(propriedades.indiceAberto)}
      data-total={String(propriedades.fotos.length)}
    >
      <button type="button" onClick={propriedades.aoFechar}>
        fechar o visualizador (mock)
      </button>
    </div>
  ),
}));

const pedir = vi.mocked(obterGaleria);

type PedidoEmCurso = {
  sinal: AbortSignal | undefined;
  resolver: (corpo: RespostaDaGaleria) => void;
  rejeitar: (erro: unknown) => void;
};

/** O mesmo padrão de `Eventos.test.tsx`: um pedido que fica pendurado até o teste mandar. */
function clienteFalso(): PedidoEmCurso[] {
  const pedidos: PedidoEmCurso[] = [];

  pedir.mockImplementation((opcoes?: OpcoesDePedido) => {
    let resolver: (corpo: RespostaDaGaleria) => void = () => undefined;
    let rejeitar: (erro: unknown) => void = () => undefined;
    const promessa = new Promise<RespostaDaGaleria>((cumprir, falhar) => {
      resolver = cumprir;
      rejeitar = falhar;
    });
    pedidos.push({ sinal: opcoes?.sinal, resolver, rejeitar });
    return promessa;
  });

  return pedidos;
}

async function comResposta(corpo: RespostaDaGaleria): Promise<RenderResult> {
  const pedidos = clienteFalso();
  const desenho = render(<Galeria />);
  await act(async () => {
    pedidos[0]?.resolver(corpo);
    await Promise.resolve();
  });
  return desenho;
}

async function comFalha(estado: number | null): Promise<RenderResult> {
  const pedidos = clienteFalso();
  const desenho = render(<Galeria />);
  await act(async () => {
    pedidos[0]?.rejeitar(new ErroDaApi("falhou", { estado, codigo: null }));
    await Promise.resolve();
  });
  return desenho;
}

function seccao(): HTMLElement {
  const regiao = document.querySelector<HTMLElement>(`#${ID_DA_SECCAO}`);
  if (regiao === null) {
    throw new Error(
      `não encontrei a <section id="${ID_DA_SECCAO}">. A galeria nunca desaparece (2.1) — ` +
        "se isto falhar, o resto do teste não está a ver nada.",
    );
  }
  return regiao;
}

beforeEach(() => {
  pedir.mockReset();
});

describe("o <h2> está sempre presente (a galeria nunca desaparece, 2.1)", () => {
  it("a carregar: <h2> mais seis quadrados aria-hidden, numa região aria-busy", async () => {
    clienteFalso();
    render(<Galeria />);

    expect(screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.titulo })).toBeInTheDocument();

    const regiao = seccao();
    const grelha = within(regiao).getByRole("list", { hidden: true });
    expect(grelha).toHaveAttribute("aria-busy", "true");

    const quadrados = within(regiao).getAllByRole("listitem", { hidden: true });
    expect(quadrados).toHaveLength(6);
    for (const quadrado of quadrados) {
      expect(quadrado).toHaveAttribute("aria-hidden", "true");
    }

    expect(
      screen.queryByRole("button", { name: TEXTOS_DA_GALERIA.enviarUmaFoto }),
      "a carregar não há nada para enviar ainda — o botão só chega com a resposta",
    ).toBeNull();
  });

  it("zero fotos: <h2> mais o EstadoVazio, com o botão SECUNDÁRIO (emenda de 4.3)", async () => {
    await comResposta(SEM_FOTOS);

    expect(screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.titulo })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.vazioTitulo }),
    ).toBeInTheDocument();
    expect(screen.getByText(TEXTOS_DA_GALERIA.vazioLinha)).toBeInTheDocument();

    const botao = screen.getByRole("button", { name: TEXTOS_DA_GALERIA.enviarUmaFoto });
    expect(
      botao.className,
      "o botão do EstadoVazio da galeria é secundário — um 'Enviar uma foto' dourado ao " +
        "lado do 'WiFi' do cabeçalho seria uma segunda ação dourada ao mesmo tempo (4.3)",
    ).not.toMatch(/\bbg-acao\b/);
  });

  it("o pedido falhou: <h2> mais o EstadoVazio em erro, com 'Tentar outra vez'", async () => {
    await comFalha(null);

    expect(screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.titulo })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.erroTitulo })).toBeInTheDocument();
    expect(screen.getByText(TEXTOS_DA_GALERIA.erroSemResposta)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TEXTOS_DA_GALERIA.tentarOutraVez }),
    ).toBeInTheDocument();
  });

  it("«não há fotos» e «não consegui perguntar» não dão o mesmo ecrã (regra 10)", async () => {
    const vazio = await comResposta(SEM_FOTOS);
    const htmlDoVazio = vazio.container.innerHTML;
    vazio.unmount();

    const falhado = await comFalha(null);

    expect(
      htmlDoVazio.length,
      "guarda: o vazio tem mesmo de ter desenhado alguma coisa",
    ).toBeGreaterThan(0);
    expect(falhado.container.innerHTML).not.toBe(htmlDoVazio);
  });

  it("sem resposta e com resposta do servidor dão linhas diferentes", async () => {
    const semResposta = await comFalha(null);
    expect(screen.getByText(TEXTOS_DA_GALERIA.erroSemResposta)).toBeInTheDocument();
    semResposta.unmount();

    await comFalha(500);
    expect(screen.getByText(TEXTOS_DA_GALERIA.erroComResposta)).toBeInTheDocument();
  });
});

describe("a grelha, de uma a seis fotos", () => {
  it("uma foto: o botão 'Enviar uma foto' aparece no topo, e há um item na grelha", async () => {
    await comResposta(UMA_FOTO);

    expect(
      screen.getByRole("button", { name: TEXTOS_DA_GALERIA.enviarUmaFoto }),
    ).toBeInTheDocument();
    expect(within(seccao()).getAllByRole("listitem")).toHaveLength(1);
  });

  it("exatamente seis fotos: seis itens, e nenhum 'Ver mais fotos'", async () => {
    await comResposta(SEIS_FOTOS);

    expect(within(seccao()).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: TEXTOS_DA_GALERIA.verMaisFotos })).toBeNull();
  });
});

describe("mais de seis fotos: o corte, e 'Ver mais fotos' sem pedido novo", () => {
  it("sete fotos mostram exatamente seis, mais o botão", async () => {
    await comResposta(SETE_FOTOS);

    expect(within(seccao()).getAllByRole("listitem")).toHaveLength(6);
    expect(
      screen.getByRole("button", { name: TEXTOS_DA_GALERIA.verMaisFotos }),
    ).toBeInTheDocument();
  });

  it("carregar em 'Ver mais fotos' revela a sétima sem um segundo pedido de rede", async () => {
    await comResposta(SETE_FOTOS);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.verMaisFotos }));

    await waitFor(() => {
      expect(within(seccao()).getAllByRole("listitem")).toHaveLength(7);
    });
    expect(
      pedir,
      "os dados já estavam todos em memória — não há razão nenhuma para um GET novo (4.6)",
    ).toHaveBeenCalledTimes(1);
  });

  it("depois de 'Ver mais fotos', o botão desaparece — não há 'ver menos'", async () => {
    await comResposta(SETE_FOTOS);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.verMaisFotos }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: TEXTOS_DA_GALERIA.verMaisFotos })).toBeNull();
    });
  });
});

describe("abrir a Folha 'Enviar uma foto'", () => {
  it("carregar no botão passa aberta=true ao mock da Folha", async () => {
    await comResposta(UMA_FOTO);

    expect(screen.getByTestId("folha-enviar-foto-mock")).toHaveAttribute("data-aberta", "nao");

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.enviarUmaFoto }));

    expect(screen.getByTestId("folha-enviar-foto-mock")).toHaveAttribute("data-aberta", "sim");
  });

  it("o botão do EstadoVazio também abre a mesma Folha", async () => {
    await comResposta(SEM_FOTOS);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.enviarUmaFoto }));

    expect(screen.getByTestId("folha-enviar-foto-mock")).toHaveAttribute("data-aberta", "sim");
  });

  it("o mock de aoFechar fecha a Folha outra vez", async () => {
    await comResposta(UMA_FOTO);
    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.enviarUmaFoto }));
    expect(screen.getByTestId("folha-enviar-foto-mock")).toHaveAttribute("data-aberta", "sim");

    fireEvent.click(screen.getByRole("button", { name: /fechar a folha/i }));

    expect(screen.getByTestId("folha-enviar-foto-mock")).toHaveAttribute("data-aberta", "nao");
  });
});

describe("abrir o Visualizador numa foto da grelha", () => {
  it("tocar na primeira foto passa indiceAberto=0 ao mock do Visualizador", async () => {
    await comResposta(SETE_FOTOS);

    expect(screen.getByTestId("visualizador-mock")).toHaveAttribute("data-indice", "null");

    const botoesDaGrelha = within(seccao())
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("button"));
    fireEvent.click(botoesDaGrelha[0] as HTMLElement);

    expect(screen.getByTestId("visualizador-mock")).toHaveAttribute("data-indice", "0");
    expect(screen.getByTestId("visualizador-mock")).toHaveAttribute("data-total", "7");
  });

  it("tocar na terceira foto passa indiceAberto=2", async () => {
    await comResposta(SETE_FOTOS);

    const botoesDaGrelha = within(seccao())
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("button"));
    fireEvent.click(botoesDaGrelha[2] as HTMLElement);

    expect(screen.getByTestId("visualizador-mock")).toHaveAttribute("data-indice", "2");
  });

  it("cada item da grelha é um <button> à volta de uma <img>, nunca uma <a> (3)", async () => {
    await comResposta(UMA_FOTO);

    const item = within(seccao()).getAllByRole("listitem")[0];
    expect(item).toBeDefined();
    expect(
      within(item as HTMLElement)
        .getByRole("img")
        .closest("a"),
    ).toBeNull();
    const botao = within(item as HTMLElement).getByRole("button");
    expect(botao).toBeInTheDocument();
    // Enquanto a imagem está a aparecer normalmente, o botão não tem
    // `aria-label` nenhum — herda o `alt` da `<img>` como nome acessível
    // (3, 5.4). Um `aria-label` posto aqui incondicionalmente passaria
    // despercebido: para a árvore de acessibilidade, "aria-label igual ao
    // alt" e "nome herdado do alt" dão o mesmo nome computado.
    expect(
      botao,
      "o aria-label do botão só existe quando a imagem falha (onError) — nunca aqui",
    ).not.toHaveAttribute("aria-label");
  });

  it("se a imagem falhar (onError), a caixa neutra substitui-a e o botão ganha o alt como aria-label", async () => {
    // Três mutações que o resto da bateria deixava passar (revisão de
    // código): apagar o `onError` inteiro (o ícone nativo de imagem
    // partida volta), tirar o `aria-label` condicional (o botão fica sem
    // nome acessível quando a imagem falha, já que o `alt` que ele herdava
    // desapareceu com a `<img>`), ou pô-lo incondicional (duplica o nome
    // com o `alt`, quando a imagem está a aparecer normalmente).
    await comResposta(UMA_FOTO);

    const item = within(seccao()).getAllByRole("listitem")[0];
    expect(item).toBeDefined();
    const imagem = within(item as HTMLElement).getByRole("img");

    fireEvent.error(imagem);

    expect(
      within(item as HTMLElement).queryByRole("img"),
      "a <img> partida tem de sair — não fica atrás da caixa neutra",
    ).toBeNull();
    expect(
      within(item as HTMLElement).getByRole("button", { name: altDaFoto(FOTO_COM_LEGENDA) }),
      "sem a <img> (e sem o seu alt para herdar), o botão só tem nome acessível porque " +
        "ganhou o seu próprio aria-label — sem ele, ficava sem nome nenhum",
    ).toBeInTheDocument();
  });
});

describe("o cancelamento não é um erro (regra 10, outra vez)", () => {
  it("desmontar aborta o pedido em curso, sem levar a estado de erro nenhum", async () => {
    const pedidos = clienteFalso();
    const { unmount } = render(<Galeria />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(pedidos[0]?.sinal?.aborted).toBe(false);
    unmount();
    expect(pedidos[0]?.sinal?.aborted).toBe(true);
  });

  it("um AbortError não muda o estado; um ErroDaApi muda", async () => {
    const pedidosCancelados = clienteFalso();
    const { unmount } = render(<Galeria />);
    await act(async () => {
      pedidosCancelados[0]?.rejeitar(new DOMException("abortado", "AbortError"));
      await Promise.resolve();
    });
    // Nem o título de erro nem a lista aparecem: o cancelamento não decide nada.
    expect(screen.queryByRole("heading", { name: TEXTOS_DA_GALERIA.erroTitulo })).toBeNull();
    unmount();

    await comFalha(500);
    expect(
      screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.erroTitulo }),
      "um ErroDaApi a sério tem de levar ao ecrã de erro",
    ).toBeInTheDocument();
  });
});

describe("o nome acessível da secção vem do <h2>, pelo id do contrato (3)", () => {
  it("aria-labelledby aponta para o id do título", async () => {
    await comResposta(UMA_FOTO);

    const regiao = seccao();
    expect(regiao).toHaveAttribute("aria-labelledby", ID_DO_TITULO);
    expect(screen.getByRole("heading", { name: TEXTOS_DA_GALERIA.titulo })).toHaveAttribute(
      "id",
      ID_DO_TITULO,
    );
  });
});
