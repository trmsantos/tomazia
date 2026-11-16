/**
 * F4-02, secções 3, 8 e 9 de `docs/ecras/F4-02.md` — o destino «Ementa» da gestão:
 * carregar, estados, chips, pesquisa e linhas de aviso das categorias. Os
 * comportamentos de preço/interruptor, ordenar e folha têm os seus ficheiros
 * (`EmentaGestao.linha.test.tsx`, `.ordenar.test.tsx`, `.folha.test.tsx`).
 *
 * Contrato: ver `src/testes/ementa-gestao.tsx` (`EmentaGestao`, sem propriedades;
 * a API fingida; a sessão por contexto).
 *
 * **Regra 10, o que mais importa aqui:** falha de rede, timeout e 5xx **nunca**
 * se desenham como «Ainda não há ementa.». O vazio só vem de um `200` com
 * `categorias: []`. E um `TypeError` do nosso código dá o ecrã de erro, não o
 * esqueleto para sempre.
 *
 * **Deixa passar:** layout, 44 px, axe (e2e); o arrasto (e2e).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abrirEm,
  ementaDeGestaoDeTeste,
  erro401,
  erroDoServidor,
  erroSemResposta,
  TEXTOS_DA_EMENTA_GESTAO as T,
} from "../../../testes/gestao";
import {
  PROIBIDOS_DA_F4_02,
  abrirEmenta,
  alterarFalso,
  assentar,
  comSinal,
  criarFalso,
  obterFalso,
  pendente,
  prepararApi,
  reordenarFalso,
  secao,
  tocar,
} from "../../../testes/ementa-gestao";
import { ContextoDaSessao } from "../SessaoDaGestao";
import { EmentaGestao } from "./EmentaGestao";

vi.mock("../../../lib/api/gestao-ementa", () => ({
  obterEmentaGestao: vi.fn(),
  criarProduto: vi.fn(),
  alterarProduto: vi.fn(),
  reordenarProdutos: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});

function h1(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}
function pesquisa(): HTMLInputElement {
  return screen.getByLabelText(T.pesquisa);
}
function chips(): HTMLElement[] {
  return within(screen.getByRole("navigation", { name: T.navegacaoDeCategorias })).getAllByRole(
    "link",
  );
}
function escreverNaPesquisa(texto: string): void {
  fireEvent.change(pesquisa(), { target: { value: texto } });
}

describe("carregar a ementa", () => {
  it("um GET, com o sinal, e o <h1> «Ementa» com tabindex -1", async () => {
    await abrirEmenta();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(h1()).toHaveTextContent("Ementa");
    expect(h1()).toHaveAttribute("tabindex", "-1");
  });

  it("mostra TODAS as categorias nos chips (escondida, vazia e toda indisponível incluídas)", async () => {
    await abrirEmenta();

    expect(chips().map((chip) => chip.textContent)).toEqual([
      "Cafetaria",
      "Garrafeira",
      "Sobremesas",
      "Petiscos",
      "Sumos",
    ]);
  });

  it("os chips são ligações (<a href>) com aria-current no ativo", async () => {
    await abrirEmenta("/gestao/ementa?categoria=garrafeira");

    const [cafetaria, garrafeira] = chips();
    expect(cafetaria).toHaveAttribute("href");
    expect(garrafeira).toHaveAttribute("aria-current", "true");
    expect(cafetaria).not.toHaveAttribute("aria-current");
  });

  it("uma categoria de cada vez: sem ?categoria, a primeira; os produtos dela e só deles", async () => {
    await abrirEmenta();

    expect(screen.getByRole("heading", { level: 2, name: "Cafetaria" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Café" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cappuccino" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vinho tinto da casa" })).toBeNull();
  });

  it("?categoria=garrafeira mostra essa; um slug desconhecido volta à primeira", async () => {
    await abrirEmenta("/gestao/ementa?categoria=garrafeira");
    expect(screen.getByRole("heading", { level: 2, name: "Garrafeira" })).toBeInTheDocument();
  });

  it("slug que já não existe: a primeira categoria", async () => {
    await abrirEmenta("/gestao/ementa?categoria=nao-existe");
    expect(screen.getByRole("heading", { level: 2, name: "Cafetaria" })).toBeInTheDocument();
  });

  it("tocar num chip muda a categoria SEM empurrar o histórico (replaceState) e põe-na no endereço", async () => {
    await abrirEmenta();
    const empurrar = vi.spyOn(window.history, "pushState");
    const antes = window.history.length;

    const evento = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      chips()[4]?.dispatchEvent(evento);
      await Promise.resolve();
    });

    expect(evento.defaultPrevented, "a ligação não navega a sério").toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "Sumos" })).toBeInTheDocument();
    expect(window.location.search).toBe("?categoria=sumos");
    expect(window.location.pathname).toBe("/gestao/ementa");
    expect(empurrar).not.toHaveBeenCalled();
    expect(window.history.length).toBe(antes);
  });

  it("cada categoria é uma <section> com nome", async () => {
    await abrirEmenta();
    expect(secao("Cafetaria")).toBeInTheDocument();
  });

  it("o produto indisponível aparece na lista e diz «Não aparece na ementa.»", async () => {
    await abrirEmenta();
    const linha = screen.getByRole("button", { name: "Cappuccino" }).closest("li");
    expect(linha).not.toBeNull();
    expect(within(linha as HTMLElement).getByText(T.produtoIndisponivel)).toBeInTheDocument();
    const cafe = screen.getByRole("button", { name: "Café" }).closest("li");
    expect(within(cafe as HTMLElement).queryByText(T.produtoIndisponivel)).toBeNull();
  });

  it("a descrição aparece por baixo do nome", async () => {
    await abrirEmenta("/gestao/ementa?categoria=garrafeira");
    expect(screen.getByText("Tinto, copo")).toBeInTheDocument();
  });
});

describe("a carregar (8.1)", () => {
  it("esqueleto sem texto, aria-busy, <h1> e pesquisa já desenhados; nem vazio nem erro", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirEmenta();

    expect(h1()).toHaveTextContent("Ementa");
    expect(pesquisa()).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    expect(screen.queryByText(T.erroDeCarregarTitulo)).toBeNull();
    expect(screen.queryByRole("button", { name: T.tentarOutraVez })).toBeNull();
    // Os blocos de chip do esqueleto não são ligações nem se focam.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("o campo de pesquisa não tem placeholder", async () => {
    await abrirEmenta();
    expect(pesquisa()).not.toHaveAttribute("placeholder");
  });
});

describe("ementa vazia (8.2): só um 200 com a lista vazia", () => {
  it("«Ainda não há ementa.» e a linha, sem nenhum botão, sem chips e sem «Adicionar produto»", async () => {
    obterFalso.mockResolvedValue({ categorias: [] });
    await abrirEmenta();

    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
    expect(screen.getByText(T.vazioLinha)).toBeInTheDocument();
    expect(within(document.body).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: T.navegacaoDeCategorias })).toBeNull();
    expect(screen.queryByRole("button", { name: T.adicionarProduto })).toBeNull();
    expect(screen.queryByText(T.erroDeCarregarTitulo)).toBeNull();
  });
});

describe("erro ao carregar (8.3, regra 10): nunca igual a «ementa vazia»", () => {
  it.each([
    ["sem resposta", erroSemResposta(), T.erroDeCarregarSemResposta],
    ["403", erroDoServidor(403), T.erroDeCarregarServidor],
    ["500", erroDoServidor(500), T.erroDeCarregarServidor],
    ["502", erroDoServidor(502), T.erroDeCarregarServidor],
  ])("%s: o título, a linha certa e «Tentar outra vez»", async (_nome, erro, linha) => {
    obterFalso.mockRejectedValue(erro);
    const sessao = await abrirEmenta();

    expect(screen.getByText(T.erroDeCarregarTitulo)).toBeInTheDocument();
    expect(screen.getByText(linha)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.tentarOutraVez })).toBeInTheDocument();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    expect(screen.queryByText(T.vazioLinha)).toBeNull();
    expect(screen.queryByText(/mensagem do cliente/)).toBeNull();
    expect(h1()).toBeInTheDocument();
    expect(pesquisa()).toBeInTheDocument();
    expect(sessao.aoPerderSessao, "só o 401 leva ao login").not.toHaveBeenCalled();
  });

  it("as duas linhas de erro são diferentes uma da outra", () => {
    expect(T.erroDeCarregarSemResposta).not.toBe(T.erroDeCarregarServidor);
  });

  it("um TypeError do nosso código é o ecrã de erro do servidor, não «a carregar» para sempre", async () => {
    obterFalso.mockRejectedValue(new TypeError("erro de programação"));
    await abrirEmenta();

    expect(screen.getByText(T.erroDeCarregarTitulo)).toBeInTheDocument();
    expect(screen.getByText(T.erroDeCarregarServidor)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("«Tentar outra vez»: «A tentar…» com aria-busy, e depois a lista", async () => {
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirEmenta();
    const segundo = pendente<ReturnType<typeof ementaDeGestaoDeTeste>>();
    obterFalso.mockReturnValueOnce(segundo.promessa);

    await tocar(screen.getByRole("button", { name: T.tentarOutraVez }));

    const botao = screen.getByRole("button", { name: T.aTentar });
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(obterFalso).toHaveBeenCalledTimes(2);

    await act(async () => {
      segundo.resolver(ementaDeGestaoDeTeste());
      await Promise.resolve();
    });
    await assentar();
    expect(screen.getByRole("heading", { level: 2, name: "Cafetaria" })).toBeInTheDocument();
    expect(screen.queryByText(T.erroDeCarregarTitulo)).toBeNull();
  });

  it("desmontar cancela a leitura e um cancelamento não é erro nem muda de estado", async () => {
    const lento = pendente<ReturnType<typeof ementaDeGestaoDeTeste>>();
    obterFalso.mockReturnValue(lento.promessa);
    abrirEmentaSemEsperar();

    const sinal = (obterFalso.mock.calls[0]?.[0] as { sinal: AbortSignal } | undefined)?.sinal;
    cleanupAgora();
    expect(sinal?.aborted).toBe(true);

    const cancelamento = new DOMException("abortado", "AbortError");
    await act(async () => {
      lento.rejeitar(cancelamento);
      await Promise.resolve();
    });
    expect(screen.queryByText(T.erroDeCarregarTitulo)).toBeNull();
  });

  it("mutação pendente, desmontar, rejeitar sem resposta: não arma nenhuma leitura nova nem chama aoPerderSessao", async () => {
    const lento = pendente<never>();
    alterarFalso.mockReturnValue(lento.promessa);
    const sessao = await abrirEmenta();
    const interruptor = within(
      screen.getByRole("button", { name: "Café" }).closest("li") as HTMLElement,
    ).getByRole("switch");
    await tocar(interruptor);
    expect(obterFalso).toHaveBeenCalledTimes(1);

    cleanupAgora();
    obterFalso.mockRejectedValue(erro401());
    await act(async () => {
      lento.rejeitar(erroSemResposta());
      await Promise.resolve();
    });
    await assentar();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
  });

  it("401 no carregamento: aoPerderSessao uma vez e nenhum ecrã de erro", async () => {
    obterFalso.mockRejectedValue(erro401());
    const sessao = await abrirEmenta();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(T.erroDeCarregarTitulo)).toBeNull();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
  });
});

// Montar sem esperar, e desmontar à mão: só para o teste do cancelamento.
function abrirEmentaSemEsperar(): void {
  abrirEm("/gestao/ementa");
  render(
    <ContextoDaSessao.Provider value={{ aoPerderSessao: vi.fn(), aoConfirmarSessao: vi.fn() }}>
      <EmentaGestao />
    </ContextoDaSessao.Provider>,
  );
}
function cleanupAgora(): void {
  cleanup();
}

describe("as linhas da categoria (3.2) — a regra de publico.py, uma a uma, sem pesquisa", () => {
  it("categoria normal com produtos disponíveis: nenhuma linha", async () => {
    await abrirEmenta();
    expect(screen.queryByText(T.categoriaEscondida)).toBeNull();
    expect(screen.queryByText(T.categoriaSemProdutos)).toBeNull();
    expect(screen.queryByText(T.categoriaTodaIndisponivel)).toBeNull();
  });

  it("escondida: SÓ «Esta categoria não aparece na ementa.»", async () => {
    await abrirEmenta("/gestao/ementa?categoria=sobremesas");

    expect(screen.getByText(T.categoriaEscondida)).toBeInTheDocument();
    expect(screen.queryByText(T.categoriaSemProdutos)).toBeNull();
    expect(screen.queryByText(T.categoriaTodaIndisponivel)).toBeNull();
    expect(screen.getByRole("button", { name: "Pudim" })).toBeInTheDocument();
  });

  it("visível e sem produtos: a linha própria, no lugar das linhas", async () => {
    await abrirEmenta("/gestao/ementa?categoria=petiscos");

    expect(screen.getByText(T.categoriaSemProdutos)).toBeInTheDocument();
    expect(screen.queryByText(T.categoriaEscondida)).toBeNull();
    expect(screen.queryByText(T.categoriaTodaIndisponivel)).toBeNull();
    expect(within(secao("Petiscos")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("visível, com produtos, todos indisponíveis: a linha própria", async () => {
    await abrirEmenta("/gestao/ementa?categoria=sumos");

    expect(screen.getByText(T.categoriaTodaIndisponivel)).toBeInTheDocument();
    expect(screen.queryByText(T.categoriaEscondida)).toBeNull();
    expect(screen.queryByText(T.categoriaSemProdutos)).toBeNull();
  });

  it("lê-se do estado local: ligar o último indisponível tira a linha, e desligá-lo repõe-na", async () => {
    await abrirEmenta("/gestao/ementa?categoria=sumos");
    alterarFalso.mockResolvedValueOnce({
      id: 501,
      categoria_id: 5,
      nome: "Sumo de laranja",
      descricao: null,
      preco_cent: 300,
      disponivel: true,
    });

    await tocar(within(secao("Sumos")).getByRole("switch", { name: T.etiquetaDisponivel }));
    expect(screen.queryByText(T.categoriaTodaIndisponivel)).toBeNull();

    alterarFalso.mockResolvedValueOnce({
      id: 501,
      categoria_id: 5,
      nome: "Sumo de laranja",
      descricao: null,
      preco_cent: 300,
      disponivel: false,
    });
    await tocar(within(secao("Sumos")).getByRole("switch", { name: T.etiquetaDisponivel }));
    expect(screen.getByText(T.categoriaTodaIndisponivel)).toBeInTheDocument();
  });
});

describe("pesquisa (3.1 e 3.6)", () => {
  it("o campo «Pesquisar produto» está sempre à vista, por cima dos chips", async () => {
    await abrirEmenta();
    const nav = screen.getByRole("navigation", { name: T.navegacaoDeCategorias });
    expect(pesquisa().compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("com termo: os chips escondem-se e mostram-se as categorias com resultados", async () => {
    await abrirEmenta();
    escreverNaPesquisa("cafe");

    expect(screen.queryByRole("navigation", { name: T.navegacaoDeCategorias })).toBeNull();
    expect(screen.getByRole("button", { name: "Café" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Café duplo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Galão" })).toBeNull();
  });

  it("a contagem fala no singular e no plural, num role=status que já existia", async () => {
    await abrirEmenta();
    const estados = screen.getAllByRole("status");
    escreverNaPesquisa("cafe");
    expect(screen.getByText("2 produtos encontrados.")).toBeInTheDocument();
    escreverNaPesquisa("galao");
    expect(screen.getByText("1 produto encontrado.")).toBeInTheDocument();
    expect(estados.length).toBeGreaterThan(0);
    escreverNaPesquisa("");
    expect(screen.queryByText(/produtos? encontrados?\./)).toBeNull();
  });

  it("sem acentos nem maiúsculas, e com espaços a mais", async () => {
    await abrirEmenta();
    escreverNaPesquisa("  CAFÉ   duplo ");
    expect(screen.getByRole("button", { name: "Café duplo" })).toBeInTheDocument();
    expect(screen.getByText("1 produto encontrado.")).toBeInTheDocument();
  });

  it("encontra o indisponível e o de uma categoria escondida, em todas as categorias", async () => {
    await abrirEmenta();
    escreverNaPesquisa("pudim");
    expect(screen.getByRole("button", { name: "Pudim" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sobremesas" })).toBeInTheDocument();

    escreverNaPesquisa("cappuccino");
    expect(screen.getByRole("button", { name: "Cappuccino" })).toBeInTheDocument();
  });

  it("com pesquisa, as linhas de aviso da categoria não se mostram (é só uma parte dela)", async () => {
    await abrirEmenta();
    escreverNaPesquisa("pudim");
    expect(screen.queryByText(T.categoriaEscondida)).toBeNull();
  });

  it("sem resultados: o estado vazio próprio e «Limpar pesquisa», que devolve o foco ao campo", async () => {
    await abrirEmenta();
    escreverNaPesquisa("zzzz");

    expect(screen.getByText(T.semResultados)).toBeInTheDocument();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();

    await tocar(screen.getByRole("button", { name: T.limparPesquisa }));

    expect(pesquisa()).toHaveValue("");
    expect(document.activeElement).toBe(pesquisa());
    expect(screen.getByRole("navigation", { name: T.navegacaoDeCategorias })).toBeInTheDocument();
  });

  it("«Ordenar» não existe com pesquisa ativa; «Adicionar produto» continua", async () => {
    await abrirEmenta();
    expect(screen.getByRole("button", { name: T.ordenar })).toBeInTheDocument();
    escreverNaPesquisa("cafe");
    expect(screen.queryByRole("button", { name: T.ordenar })).toBeNull();
    expect(screen.getByRole("button", { name: T.adicionarProduto })).toBeInTheDocument();
  });

  it("a pesquisa não faz nenhum pedido", async () => {
    await abrirEmenta();
    escreverNaPesquisa("cafe");
    escreverNaPesquisa("pudim");
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).not.toHaveBeenCalled();
  });

  it("o produto que acaba de ficar indisponível não desaparece da pesquisa", async () => {
    await abrirEmenta();
    escreverNaPesquisa("galao");
    alterarFalso.mockResolvedValue({
      id: 102,
      categoria_id: 1,
      nome: "Galão",
      descricao: null,
      preco_cent: 180,
      disponivel: false,
    });

    await tocar(screen.getByRole("switch", { name: T.etiquetaDisponivel }));

    expect(screen.getByRole("button", { name: "Galão" })).toBeInTheDocument();
  });
});

describe("o que a F4-02 NÃO tem: categorias e eliminar (são da F4-02b)", () => {
  function semProibidos(): void {
    const botoes = screen.queryAllByRole("button").map((b) => b.textContent ?? "");
    const ligacoes = screen.queryAllByRole("link").map((b) => b.textContent ?? "");
    for (const texto of [...botoes, ...ligacoes]) {
      expect(texto, `controlo proibido: «${texto}»`).not.toMatch(PROIBIDOS_DA_F4_02);
    }
    expect(document.body.textContent ?? "").not.toMatch(PROIBIDOS_DA_F4_02);
  }

  it("na lista", async () => {
    await abrirEmenta();
    semProibidos();
  });

  it("numa categoria escondida e numa vazia", async () => {
    await abrirEmenta("/gestao/ementa?categoria=sobremesas");
    semProibidos();
    cleanup();
    await abrirEmenta("/gestao/ementa?categoria=petiscos");
    semProibidos();
  });

  it("com pesquisa", async () => {
    await abrirEmenta();
    escreverNaPesquisa("cafe");
    semProibidos();
  });

  it("no modo «Ordenar»", async () => {
    await abrirEmenta();
    await tocar(screen.getByRole("button", { name: T.ordenar }));
    semProibidos();
  });

  it("na ementa vazia, no erro e com a folha de editar aberta", async () => {
    await abrirEmenta();
    await tocar(screen.getByRole("button", { name: "Café" }));
    semProibidos();
    cleanup();

    obterFalso.mockResolvedValue({ categorias: [] });
    await abrirEmenta();
    semProibidos();
    cleanup();

    obterFalso.mockRejectedValue(erroDoServidor(500));
    await abrirEmenta();
    semProibidos();
  });

  it("nenhum pedido de categorias ou de eliminar parte (a API só tem quatro funções)", async () => {
    await abrirEmenta();
    await tocar(screen.getByRole("button", { name: T.ordenar }));
    expect(criarFalso).not.toHaveBeenCalled();
    expect(reordenarFalso).not.toHaveBeenCalled();
    expect(alterarFalso).not.toHaveBeenCalled();
  });
});
