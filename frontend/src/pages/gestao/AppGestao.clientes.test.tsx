/**
 * F4-05b, `docs/ecras/F4-05b.md` secções 3, 4 e 11 e critérios 2, 3 e 16 — o Início e os Clientes
 * **dentro do `AppGestao`**: a rota nova `/gestao/mais/clientes`, o título do separador, «Mais»
 * como lista (Definições, **Clientes**, Sair), o foco no <h1> ao chegar por qualquer via (a barra,
 * a lista de «Mais», as ligações do Início), o 401 que lembra o destino, e a moldura que mantém
 * «Mais» ativo por baixo de `/gestao/mais/clientes`.
 *
 * Com `src/lib/api/auth.ts`, os módulos de API dos destinos e o histórico do jsdom a sério.
 *
 * **Deixa passar:** o CSS da barra/coluna e o axe (e2e).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quemSouEu } from "../../lib/api/auth";
import { obterClientes } from "../../lib/api/gestao-clientes";
import { obterDefinicoes } from "../../lib/api/gestao-definicoes";
import { obterEmentaGestao } from "../../lib/api/gestao-ementa";
import { obterEventosGestao } from "../../lib/api/gestao-eventos";
import { obterFilaDeModeracao } from "../../lib/api/gestao-fotos";
import { obterResumo } from "../../lib/api/gestao-resumo";
import { clienteDeTeste, clientesDeTeste, resumoDeTeste } from "../../testes/clientes-dados";
import { TEXTOS_CLIENTES as T, TEXTOS_INICIO as TI } from "../../testes/clientes-gestao-textos";
import {
  SESSAO_DE_TESTE,
  TEXTOS_DA_GESTAO as TG,
  abrirEm,
  definicoesConfiguradas,
  ementaDeGestaoDeTeste,
  erro401,
  eventosDeGestaoDeTeste,
  filaDeTeste,
} from "../../testes/gestao";
import { TEXTOS as TD } from "./definicoes/textos";
import { TEXTOS as TF } from "./galeria/textos";
import AppGestao from "./AppGestao";

vi.mock("../../lib/api/auth", () => ({ entrar: vi.fn(), quemSouEu: vi.fn(), sair: vi.fn() }));
vi.mock("../../lib/api/gestao-ementa", () => ({
  obterEmentaGestao: vi.fn(),
  criarProduto: vi.fn(),
  alterarProduto: vi.fn(),
  reordenarProdutos: vi.fn(),
}));
vi.mock("../../lib/api/gestao-definicoes", () => ({
  obterDefinicoes: vi.fn(),
  guardarDefinicoes: vi.fn(),
}));
vi.mock("../../lib/api/gestao-eventos", () => ({
  obterEventosGestao: vi.fn(),
  criarEvento: vi.fn(),
  alterarEvento: vi.fn(),
  eliminarEvento: vi.fn(),
  duplicarEvento: vi.fn(),
}));
vi.mock("../../lib/api/gestao-fotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/gestao-fotos")>()),
  obterFilaDeModeracao: vi.fn(),
  aprovarFoto: vi.fn(),
  rejeitarFoto: vi.fn(),
  obterAprovadas: vi.fn(() => Promise.resolve({ fotos: [] })),
  eliminarFoto: vi.fn(),
}));
vi.mock("../../lib/api/gestao-resumo", () => ({ obterResumo: vi.fn() }));
vi.mock("../../lib/api/gestao-clientes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/gestao-clientes")>()),
  obterClientes: vi.fn(),
  eliminarCliente: vi.fn(),
  descarregarClientesCsv: vi.fn(),
}));

const quemSouEuFalso = vi.mocked(quemSouEu);
const resumoFalso = vi.mocked(obterResumo);
const clientesFalso = vi.mocked(obterClientes);

beforeEach(() => {
  quemSouEuFalso.mockReset();
  quemSouEuFalso.mockResolvedValue(SESSAO_DE_TESTE);
  vi.mocked(obterEmentaGestao).mockReset();
  vi.mocked(obterEmentaGestao).mockResolvedValue(ementaDeGestaoDeTeste());
  vi.mocked(obterDefinicoes).mockReset();
  vi.mocked(obterDefinicoes).mockResolvedValue(definicoesConfiguradas());
  vi.mocked(obterEventosGestao).mockReset();
  vi.mocked(obterEventosGestao).mockImplementation(() => Promise.resolve(eventosDeGestaoDeTeste()));
  vi.mocked(obterFilaDeModeracao).mockReset();
  vi.mocked(obterFilaDeModeracao).mockImplementation(() =>
    Promise.resolve({ fotos: filaDeTeste(3) }),
  );
  resumoFalso.mockReset();
  resumoFalso.mockImplementation(() => Promise.resolve(resumoDeTeste()));
  clientesFalso.mockReset();
  clientesFalso.mockImplementation(() => Promise.resolve({ clientes: clientesDeTeste() }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function abrir(caminho: string): Promise<void> {
  abrirEm(caminho);
  render(<AppGestao />);
  await act(async () => {
    await Promise.resolve();
  });
}
function h1(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}
function navegacao(): HTMLElement {
  return screen.getByRole("navigation", { name: TG.navegacao });
}
function ligacaoClientesNoMais(): HTMLElement {
  return screen.getByRole("link", { name: new RegExp(`^${T.linhaNoMais}`) });
}

describe("o Início (F4-05b: já não é o vazio da F4-01)", () => {
  it("/gestao mostra o resumo: o <h1> Início e as três secções, pela ordem", async () => {
    await abrir("/gestao");

    expect(await screen.findByRole("region", { name: TI.fotosTitulo })).toBeInTheDocument();
    expect(h1()).toHaveTextContent(TI.titulo);
    expect(screen.getAllByRole("region").map((r) => r.querySelector("h2")?.textContent)).toEqual([
      TI.fotosTitulo,
      TI.eventosTitulo,
      TI.registosTitulo,
    ]);
    expect(screen.queryByText(TG.vazioTitulo)).toBeNull();
    expect(screen.queryByText(TG.vazioInicio)).toBeNull();
    expect(document.title).toBe("Início — Gestão — Bar da Tomazia");
  });

  it("o Início pede o resumo UMA vez por visita: ir a Ementa e voltar pede outra", async () => {
    await abrir("/gestao");
    await screen.findByRole("region", { name: TI.fotosTitulo });
    expect(resumoFalso).toHaveBeenCalledTimes(1);

    fireEvent.click(within(navegacao()).getByRole("link", { name: "Ementa" }));
    await waitFor(() => {
      expect(h1()).toHaveTextContent("Ementa");
    });
    fireEvent.click(within(navegacao()).getByRole("link", { name: "Início" }));
    await screen.findByRole("region", { name: TI.fotosTitulo });

    expect(resumoFalso).toHaveBeenCalledTimes(2);
  });

  it("«Ir para a fila de fotos» leva a /gestao/galeria e o foco vai ao <h1> da Galeria (critério 2)", async () => {
    await abrir("/gestao");
    fireEvent.click(await screen.findByRole("link", { name: TI.irParaAFila }));

    const titulo = await screen.findByRole("heading", { level: 1, name: TF.titulo });
    await waitFor(() => {
      expect(titulo).toHaveFocus();
    });
    expect(window.location.pathname).toBe("/gestao/galeria");
  });

  it("«Ver os eventos» leva a /gestao/eventos com o foco no <h1>", async () => {
    await abrir("/gestao");
    fireEvent.click(await screen.findByRole("link", { name: TI.verOsEventos }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/eventos");
    });
    await waitFor(() => {
      expect(h1()).toHaveFocus();
    });
  });

  it("«Ver os clientes» leva a /gestao/mais/clientes com o foco no <h1> Clientes", async () => {
    await abrir("/gestao");
    fireEvent.click(await screen.findByRole("link", { name: TI.verOsClientes }));

    const titulo = await screen.findByRole("heading", { level: 1, name: T.titulo });
    await waitFor(() => {
      expect(titulo).toHaveFocus();
    });
    expect(window.location.pathname).toBe("/gestao/mais/clientes");
  });

  it("um 401 no resumo leva ao login SEM lembrar o Início (nunca se lembra /gestao)", async () => {
    resumoFalso.mockRejectedValue(erro401());
    await abrir("/gestao");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(window.history.state).not.toMatchObject({ voltar: expect.anything() as unknown });
  });
});

describe("a rota /gestao/mais/clientes (3)", () => {
  it("é conhecida: não volta a /gestao e mostra o ecrã de Clientes", async () => {
    const substituir = vi.spyOn(window.history, "replaceState");
    await abrir("/gestao/mais/clientes");
    substituir.mockClear();

    expect(await screen.findByRole("heading", { level: 1, name: T.titulo })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/gestao/mais/clientes");
    expect(substituir).not.toHaveBeenCalledWith(expect.anything(), "", "/gestao");
    expect(await screen.findByRole("region", { name: new RegExp(`^${T.h2}`) })).toBeInTheDocument();
  });

  it("/gestao/mais/x continua a cair em /gestao", async () => {
    await abrir("/gestao/mais/x");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
  });

  it("o título do separador é «Clientes — Gestão — Bar da Tomazia», fixo, sem nome, email nem telemóvel", async () => {
    clientesFalso.mockResolvedValue({
      clientes: [
        clienteDeTeste({
          id: 1,
          nome: "Zélia Quimera",
          email: "zelia@exemplo.test",
          telemovel: "912340099",
        }),
      ],
    });
    await abrir("/gestao/mais/clientes");
    await screen.findByText("Zélia Quimera");

    expect(document.title).toBe(T.tituloDoDocumento);
    expect(document.title).not.toMatch(/Z[ée]lia|Quimera|zelia|91234/);
    expect(window.location.href).not.toMatch(/Z[ée]lia|Quimera|zelia|91234/i);
  });

  it("«Mais» fica ativo na barra", async () => {
    await abrir("/gestao/mais/clientes");
    await screen.findByRole("heading", { level: 1, name: T.titulo });
    expect(
      within(navegacao()).getByRole("link", { name: "Mais" }).getAttribute("aria-current"),
    ).toMatch(/^(page|true)$/);
    for (const outro of ["Início", "Ementa", "Eventos", "Galeria"]) {
      expect(within(navegacao()).getByRole("link", { name: outro })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("«Voltar a Mais» leva a /gestao/mais com o foco no <h1> «Mais»", async () => {
    await abrir("/gestao/mais/clientes");
    fireEvent.click(await screen.findByRole("link", { name: T.voltar }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/mais");
    });
    await waitFor(() => {
      expect(h1()).toHaveTextContent("Mais");
    });
    await waitFor(() => {
      expect(h1()).toHaveFocus();
    });
  });

  it("um 401 na lista leva ao login com o destino lembrado; entrar volta lá", async () => {
    clientesFalso.mockRejectedValue(erro401());
    await abrir("/gestao/mais/clientes");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(window.history.state).toMatchObject({ voltar: "/gestao/mais/clientes" });
  });
});

describe("«Mais» como lista (16)", () => {
  it("Definições, a seguir Clientes («Quem se registou no site») e por baixo «Sair»", async () => {
    await abrir("/gestao/mais");

    const definicoes = screen.getByRole("link", { name: new RegExp(`^${TD.ligacaoNoMais}`) });
    const clientes = ligacaoClientesNoMais();
    const sair = screen.getByRole("button", { name: TG.sair });
    expect(clientes).toHaveAttribute("href", "/gestao/mais/clientes");
    expect(clientes).toHaveTextContent(T.linhaNoMais);
    expect(clientes).toHaveTextContent(T.descricaoNoMais);
    const lista = within(screen.getByRole("main")).getByRole("list");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    expect(lista).toContainElement(definicoes);
    expect(lista).toContainElement(clientes);
    expect(
      definicoes.compareDocumentPosition(clientes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(clientes.compareDocumentPosition(sair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lista).not.toContainElement(sair);
  });

  it("a linha «Clientes» é igual à das Definições: ligação inteira, `min-h-toque`, `px-4 py-3`, sem seta", async () => {
    await abrir("/gestao/mais");
    const clientes = ligacaoClientesNoMais();
    const definicoes = screen.getByRole("link", { name: new RegExp(`^${TD.ligacaoNoMais}`) });

    expect(clientes.className).toBe(definicoes.className);
    expect(clientes.className).toMatch(/min-h-toque/);
    expect(clientes.className).toMatch(/px-4/);
    expect(clientes.className).toMatch(/py-3/);
    expect(clientes.querySelector("svg, img")).toBeNull();
    expect(clientes.textContent).not.toMatch(/[→›>]/);
    expect(clientes.querySelectorAll("span")).toHaveLength(2);
    expect(clientes.querySelectorAll("span")[0]?.className).toMatch(/text-corpo/);
    expect(clientes.querySelectorAll("span")[0]?.className).toMatch(/font-forte/);
    expect(clientes.querySelectorAll("span")[1]?.className).toMatch(/text-nota/);
    expect(clientes.querySelectorAll("span")[1]?.className).toMatch(/text-texto-suave/);
  });

  it("ao chegar da lista de «Mais», o foco vai para o <h1> «Clientes»", async () => {
    await abrir("/gestao/mais");
    fireEvent.click(ligacaoClientesNoMais());

    const titulo = await screen.findByRole("heading", { level: 1, name: T.titulo });
    await waitFor(() => {
      expect(titulo).toHaveFocus();
    });
    expect(window.location.pathname).toBe("/gestao/mais/clientes");
  });

  it("Ctrl+clique na linha NÃO é interceptado (abre noutro separador)", async () => {
    await abrir("/gestao/mais");
    const evento = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    ligacaoClientesNoMais().dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe("/gestao/mais");
  });

  it("«Sair» continua onde estava (até à F4-05c): um botão secundário por baixo da lista", async () => {
    await abrir("/gestao/mais");
    expect(screen.getByRole("button", { name: TG.sair })).toBeInTheDocument();
  });
});
