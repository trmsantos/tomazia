/**
 * F4-01, secções 2, 4, 5.5, 6 e 7 — a gestão inteira: rotas, guarda, destinos e
 * «Sair», com `src/lib/api/auth.ts` fingido e o histórico do jsdom a sério.
 *
 * Contrato (`src/pages/gestao/AppGestao.tsx`):
 *
 * ```tsx
 * export default function AppGestao(): ReactElement     // export por omissão (o `import()` do main.tsx)
 * ```
 *
 * Lê o endereço (`useCaminho`) e escolhe: `/gestao/entrar` -> `<Entrar />` (sem
 * guarda, sem moldura); qualquer outra rota -> guarda -> `<MolduraDaGestao>` com
 * `<Destino caminho={…} />` lá dentro. `/gestao/` e rotas desconhecidas fazem
 * `replaceState` para `/gestao`. O `<h1>` é de cada destino (`tabindex="-1"`).
 *
 * **A guarda** pede `quemSouEu()` **uma vez** ao entrar e guarda o resultado
 * enquanto se navega. Só o 401 leva ao login; sem resposta, 403, 5xx e outros
 * mostram o erro (4.2) e **nunca** o login (regra 10). «Sair» apaga o resultado.
 * **`Destino`** (`src/pages/gestao/Destino.tsx`) é um export nomeado:
 * `export function Destino(props: { caminho: string }): ReactElement`.
 *
 * **Deixa passar:** o CSS (barra/coluna) e o axe: e2e.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entrar, quemSouEu, sair } from "../../lib/api/auth";
import { obterDefinicoes } from "../../lib/api/gestao-definicoes";
import { obterEmentaGestao } from "../../lib/api/gestao-ementa";
import { obterEventosGestao } from "../../lib/api/gestao-eventos";
import { obterFilaDeModeracao } from "../../lib/api/gestao-fotos";
import {
  DESTINOS_ESPERADOS,
  SESSAO_DE_TESTE,
  TEXTOS_DA_EMENTA_GESTAO,
  TEXTOS_DA_GESTAO as T,
  abrirEm,
  erro401,
  erroDoServidor,
  erroSemResposta,
  definicoesConfiguradas,
  ementaDeGestaoDeTeste,
  eventosDeGestaoDeTeste,
  filaDeTeste,
} from "../../testes/gestao";
import { TEXTOS as TD } from "./definicoes/textos";
import { TEXTOS as TE } from "./eventos/textos";
import { TEXTOS as TF } from "./galeria/textos";
import AppGestao from "./AppGestao";

vi.mock("../../lib/api/auth", () => ({ entrar: vi.fn(), quemSouEu: vi.fn(), sair: vi.fn() }));
// F4-02: o destino Ementa pede `GET /gestao/categorias`; aqui responde sempre a fixture.
vi.mock("../../lib/api/gestao-ementa", () => ({
  obterEmentaGestao: vi.fn(),
  criarProduto: vi.fn(),
  alterarProduto: vi.fn(),
  reordenarProdutos: vi.fn(),
}));

// F4-05a: a subrota Definições pede `GET /gestao/definicoes`.
vi.mock("../../lib/api/gestao-definicoes", () => ({
  obterDefinicoes: vi.fn(),
  guardarDefinicoes: vi.fn(),
}));

// F4-03: o destino Eventos pede `GET /gestao/eventos`.
vi.mock("../../lib/api/gestao-eventos", () => ({
  obterEventosGestao: vi.fn(),
  criarEvento: vi.fn(),
  alterarEvento: vi.fn(),
  eliminarEvento: vi.fn(),
  duplicarEvento: vi.fn(),
}));

// F4-04: o destino Galeria pede `GET /gestao/fotos` (a fila de moderação).
vi.mock("../../lib/api/gestao-fotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/gestao-fotos")>()),
  obterFilaDeModeracao: vi.fn(),
  aprovarFoto: vi.fn(),
  rejeitarFoto: vi.fn(),
}));

const obterEventosFalso = vi.mocked(obterEventosGestao);
const obterFilaFalsa = vi.mocked(obterFilaDeModeracao);
const obterDefinicoesFalso = vi.mocked(obterDefinicoes);
const entrarFalso = vi.mocked(entrar);
const quemSouEuFalso = vi.mocked(quemSouEu);
const sairFalso = vi.mocked(sair);
const obterEmentaFalso = vi.mocked(obterEmentaGestao);

beforeEach(() => {
  obterEmentaFalso.mockReset();
  obterEmentaFalso.mockResolvedValue(ementaDeGestaoDeTeste());
  obterDefinicoesFalso.mockReset();
  obterDefinicoesFalso.mockResolvedValue(definicoesConfiguradas());
  obterEventosFalso.mockReset();
  obterEventosFalso.mockImplementation(() => Promise.resolve(eventosDeGestaoDeTeste()));
  obterFilaFalsa.mockReset();
  obterFilaFalsa.mockImplementation(() => Promise.resolve({ fotos: filaDeTeste(3) }));
  entrarFalso.mockReset();
  quemSouEuFalso.mockReset();
  sairFalso.mockReset();
  quemSouEuFalso.mockResolvedValue(SESSAO_DE_TESTE);
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
  return screen.getByRole("navigation", { name: T.navegacao });
}
/**
 * O `POST /auth/logout` que corre bem: 204, e **a partir daí o servidor já não
 * conhece a sessão** — o `/auth/eu` passa a 401. Sem isto o fingimento mentia: o
 * login que aparece depois de sair pergunta `/auth/eu` em segundo plano (3.8) e,
 * com o 200 do `beforeEach` ainda de pé, seguia logo para `/gestao`.
 */
function sairComSucesso(): void {
  sairFalso.mockImplementation(() => {
    quemSouEuFalso.mockRejectedValue(erro401());
    return Promise.resolve();
  });
}
function pendente<T2>() {
  let resolver: (valor: T2) => void = () => undefined;
  let rejeitar: (erro: unknown) => void = () => undefined;
  const promessa = new Promise<T2>((cumprir, falhar) => {
    resolver = cumprir;
    rejeitar = falhar;
  });
  return { promessa, resolver, rejeitar };
}

describe("a guarda: a abrir", () => {
  it("enquanto o /auth/eu não responde: «A abrir a gestão…» em role=status, sem moldura", async () => {
    quemSouEuFalso.mockReturnValue(new Promise(() => undefined));
    await abrir("/gestao/ementa");

    const estado = screen.getByRole("status");
    expect(estado).toHaveTextContent(T.nomeDoBar);
    expect(estado).toHaveTextContent(T.aAbrir);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(quemSouEuFalso).toHaveBeenCalledTimes(1);
  });

  it("200: mostra a moldura e o destino", async () => {
    await abrir("/gestao");

    expect(navegacao()).toBeInTheDocument();
    expect(h1()).toHaveTextContent("Início");
    expect(screen.queryByText(T.aAbrir)).toBeNull();
  });

  it("o resultado vale enquanto se navega: tocar na barra não repete o pedido", async () => {
    await abrir("/gestao");

    fireEvent.click(screen.getByRole("link", { name: "Ementa" }));
    fireEvent.click(screen.getByRole("link", { name: "Eventos" }));
    fireEvent.click(screen.getByRole("link", { name: "Mais" }));

    expect(quemSouEuFalso).toHaveBeenCalledTimes(1);
  });
});

describe("a guarda: o 401 leva ao login", () => {
  it("em /gestao/ementa, 401: /gestao/entrar, a substituir, e o formulário", async () => {
    quemSouEuFalso.mockRejectedValue(erro401());
    const substituir = vi.spyOn(window.history, "replaceState");
    const empurrar = vi.spyOn(window.history, "pushState");

    await abrir("/gestao/ementa");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(substituir.mock.calls.at(-1)?.[2]).toBe("/gestao/entrar");
    expect(empurrar).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("o 401 lembra o destino de origem, no history.state (F4-02, D4)", () => {
  function estadoDoHistorico(): { voltar?: unknown; sessaoTerminou?: unknown } {
    const estado: unknown = window.history.state;
    return typeof estado === "object" && estado !== null ? estado : {};
  }

  it("a guarda à chegada, em /gestao/eventos: voltar sim, sessaoTerminou não", async () => {
    quemSouEuFalso.mockRejectedValue(erro401());

    await abrir("/gestao/eventos");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(estadoDoHistorico().voltar).toBe("/gestao/eventos");
    expect(estadoDoHistorico().sessaoTerminou).not.toBe(true);
    expect(window.location.search).toBe("");
  });

  it("a guarda à chegada, em /gestao: sem destino e sem aviso", async () => {
    quemSouEuFalso.mockRejectedValue(erro401());

    await abrir("/gestao");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(estadoDoHistorico().voltar).toBeUndefined();
    expect(estadoDoHistorico().sessaoTerminou).not.toBe(true);
  });

  it("a guarda leva também a query da ementa", async () => {
    quemSouEuFalso.mockRejectedValue(erro401());

    await abrir("/gestao/ementa?categoria=garrafeira");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(estadoDoHistorico().voltar).toBe("/gestao/ementa?categoria=garrafeira");
  });

  it("um 401 de um destino com a sessão confirmada: voltar E sessaoTerminou, a substituir", async () => {
    // A guarda recebe 200; depois o servidor «esquece» a sessão (o /auth/eu do login dá 401).
    quemSouEuFalso.mockReset();
    quemSouEuFalso.mockResolvedValueOnce(SESSAO_DE_TESTE);
    quemSouEuFalso.mockRejectedValue(erro401());
    obterEmentaFalso.mockRejectedValue(erro401());
    const empurrar = vi.spyOn(window.history, "pushState");
    const antes = window.history.length;

    await abrir("/gestao/ementa?categoria=garrafeira");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(estadoDoHistorico().voltar).toBe("/gestao/ementa?categoria=garrafeira");
    expect(estadoDoHistorico().sessaoTerminou).toBe(true);
    expect(window.location.search, "o destino nunca vai no endereço").toBe("");
    expect(empurrar).not.toHaveBeenCalled();
    expect(window.history.length).toBe(antes);
    expect(quemSouEuFalso).toHaveBeenCalledTimes(1);
  });

  it("o fluxo inteiro: 401 -> login com «A sessão terminou» -> entrar -> de volta ao destino, com o <h1> focado", async () => {
    quemSouEuFalso.mockReset();
    quemSouEuFalso.mockResolvedValueOnce(SESSAO_DE_TESTE);
    quemSouEuFalso.mockRejectedValue(erro401());
    obterEmentaFalso.mockRejectedValueOnce(erro401());
    await abrir("/gestao/ementa?categoria=garrafeira");

    expect(await screen.findByText(TEXTOS_DA_EMENTA_GESTAO.sessaoTerminou)).toBeVisible();

    entrarFalso.mockResolvedValue(SESSAO_DE_TESTE);
    fireEvent.change(screen.getByLabelText(T.etiquetaUtilizador), { target: { value: "dono" } });
    fireEvent.change(screen.getByLabelText(T.etiquetaPassword), { target: { value: "segredo" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.botaoEntrar }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/ementa");
    });
    expect(window.location.search).toBe("?categoria=garrafeira");
    await waitFor(() => {
      expect(h1()).toHaveTextContent("Ementa");
    });
    expect(document.activeElement).toBe(h1());
    expect(screen.queryByText(TEXTOS_DA_EMENTA_GESTAO.sessaoTerminou)).toBeNull();
  });
});

describe("a guarda: «não consegui perguntar» nunca é o login (regra 10)", () => {
  it.each([
    ["sem resposta", erroSemResposta(), T.erroDaGuardaSemResposta],
    ["403", erroDoServidor(403), T.erroDaGuardaServidor],
    ["500", erroDoServidor(500), T.erroDaGuardaServidor],
    ["502", erroDoServidor(502), T.erroDaGuardaServidor],
    ["418, um código qualquer", erroDoServidor(418), T.erroDaGuardaServidor],
  ])("%s: o erro certo, «Tentar outra vez», e o endereço não muda", async (_nome, erro, linha) => {
    quemSouEuFalso.mockRejectedValue(erro);
    const substituir = vi.spyOn(window.history, "replaceState");
    const empurrar = vi.spyOn(window.history, "pushState");

    await abrir("/gestao/ementa");
    substituir.mockClear();

    expect(screen.getByText(T.erroDaGuardaTitulo)).toBeInTheDocument();
    expect(screen.getByText(linha)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.tentarOutraVez })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(/mensagem do cliente/)).toBeNull();
    expect(screen.queryByRole("button", { name: T.botaoEntrar })).toBeNull();
    expect(screen.queryByRole("link", { name: /entrar/i })).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
    expect(substituir).not.toHaveBeenCalled();
    expect(empurrar).not.toHaveBeenCalled();
  });

  it("uma exceção que não é da API é «o problema é nosso», não «verifica a ligação»", async () => {
    quemSouEuFalso.mockRejectedValue(new TypeError("erro de programação"));
    await abrir("/gestao");

    expect(screen.getByText(T.erroDaGuardaServidor)).toBeInTheDocument();
    expect(screen.queryByText(T.erroDaGuardaSemResposta)).toBeNull();
    expect(window.location.pathname).toBe("/gestao");
  });

  it("a primeira chegada não move o foco para o botão", async () => {
    quemSouEuFalso.mockRejectedValue(erroSemResposta());
    await abrir("/gestao");

    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: T.tentarOutraVez }));
  });

  it("«Tentar outra vez» repete o pedido, mostra «A tentar…» e, com sucesso, abre a moldura", async () => {
    quemSouEuFalso.mockRejectedValueOnce(erroSemResposta());
    await abrir("/gestao");
    const segunda = pendente<typeof SESSAO_DE_TESTE>();
    quemSouEuFalso.mockReturnValueOnce(segunda.promessa);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.tentarOutraVez }));
      await Promise.resolve();
    });

    expect(quemSouEuFalso).toHaveBeenCalledTimes(2);
    const botao = screen.getByRole("button", { name: T.aTentar });
    expect(botao).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      segunda.resolver(SESSAO_DE_TESTE);
      await Promise.resolve();
    });

    expect(navegacao()).toBeInTheDocument();
    expect(h1()).toHaveTextContent("Início");
  });

  it("se a nova tentativa falha outra vez, o foco vai para o botão", async () => {
    quemSouEuFalso.mockRejectedValue(erroSemResposta());
    await abrir("/gestao");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.tentarOutraVez }));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: T.tentarOutraVez }));
  });

  it("depois de falhar, um 401 na nova tentativa leva ao login", async () => {
    quemSouEuFalso.mockRejectedValueOnce(erroSemResposta());
    await abrir("/gestao");
    quemSouEuFalso.mockRejectedValue(erro401());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.tentarOutraVez }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
  });
});

describe("as rotas", () => {
  it("/gestao/entrar mostra o login logo, sem esperar pela guarda e sem moldura", async () => {
    quemSouEuFalso.mockRejectedValue(erro401());
    await abrir("/gestao/entrar");

    expect(screen.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(T.aAbrir)).toBeNull();
  });

  it("/gestao/entrar com sessão válida segue para /gestao", async () => {
    await abrir("/gestao/entrar");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Início" })).toBeInTheDocument();
  });

  it.each(DESTINOS_ESPERADOS)(
    "$caminho: <h1> «$rotulo», título do separador e aria-current",
    async ({ caminho, rotulo }) => {
      await abrir(caminho);

      expect(h1()).toHaveTextContent(rotulo);
      expect(h1()).toHaveAttribute("tabindex", "-1");
      expect(document.title).toBe(`${rotulo} — Gestão — Bar da Tomazia`);
      const ativos = within(navegacao())
        .getAllByRole("link")
        .filter((ligacao) => ligacao.getAttribute("aria-current") === "page");
      expect(ativos.map((ligacao) => ligacao.textContent)).toEqual([rotulo]);
    },
  );

  it("um único <main>, o mesmo nó em todos os destinos", async () => {
    await abrir("/gestao");
    const antes = screen.getByRole("main");

    fireEvent.click(screen.getByRole("link", { name: "Galeria" }));

    expect(screen.getByRole("main")).toBe(antes);
  });

  it("uma rota desconhecida em /gestao/* vai para /gestao, a substituir", async () => {
    const empurrar = vi.spyOn(window.history, "pushState");
    await abrir("/gestao/nao-existe");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
    expect(empurrar).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { level: 1, name: "Início" })).toBeInTheDocument();
  });

  it("/gestao/ mostra o Início", async () => {
    await abrir("/gestao/");

    expect(await screen.findByRole("heading", { level: 1, name: "Início" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  });
});

describe("mudar de destino (5.5)", () => {
  it("tocar em «Eventos»: o endereço, o aria-current, o título e o foco no <h1>", async () => {
    await abrir("/gestao");

    fireEvent.click(screen.getByRole("link", { name: "Eventos" }));

    await waitFor(() => {
      expect(h1()).toHaveTextContent("Eventos");
    });
    expect(window.location.pathname).toBe("/gestao/eventos");
    expect(document.title).toBe("Eventos — Gestão — Bar da Tomazia");
    expect(screen.getByRole("link", { name: "Eventos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Início" })).not.toHaveAttribute("aria-current");
    expect(document.activeElement).toBe(h1());
  });

  it("o Recuar volta ao destino anterior, também com o foco no <h1>", async () => {
    await abrir("/gestao");
    fireEvent.click(screen.getByRole("link", { name: "Ementa" }));
    await waitFor(() => {
      expect(h1()).toHaveTextContent("Ementa");
    });

    act(() => {
      window.history.back();
    });

    await waitFor(() => {
      expect(h1()).toHaveTextContent("Início");
    });
    expect(window.location.pathname).toBe("/gestao");
    expect(document.activeElement).toBe(h1());
  });
});

describe("os destinos que continuam vazios (7.1; a Ementa deixou de o ser na F4-02, os Eventos na F4-03 e a Galeria na F4-04)", () => {
  it.each([["/gestao", T.vazioInicio]])(
    "%s: o título comum, a linha própria e nenhum botão",
    async (caminho, linha) => {
      await abrir(caminho);
      const principal = screen.getByRole("main");

      expect(within(principal).getByText(T.vazioTitulo)).toBeInTheDocument();
      expect(within(principal).getByText(linha)).toBeInTheDocument();
      expect(within(principal).queryAllByRole("button")).toHaveLength(0);
    },
  );

  it("nenhum promete datas nem funcionalidades: não dizem «em breve»", async () => {
    await abrir("/gestao");
    expect(screen.getByRole("main").textContent).not.toMatch(/em breve|brevemente|vai/i);
  });
});

describe("Galeria deixou de ser um destino vazio (F4-04)", () => {
  it("/gestao/galeria mostra o ecrã de moderação, não o «Ainda não há nada aqui.»", async () => {
    await abrir("/gestao/galeria");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: TF.enviarFoto })).toBeInTheDocument();
    });

    expect(h1()).toHaveTextContent(TF.titulo);
    expect(h1()).toHaveAttribute("tabindex", "-1");
    expect(obterFilaFalsa).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("main")).queryByText(T.vazioTitulo)).toBeNull();
    expect(screen.getByRole("region", { name: TF.fotosAEsperaN(3) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TF.aprovar })).toBeInTheDocument();
    expect(document.title).toBe("Galeria — Gestão — Bar da Tomazia");
  });

  it("a fila vazia (200) mostra «Não há fotos à espera.», e não «Ainda não há nada aqui.»", async () => {
    obterFilaFalsa.mockResolvedValue({ fotos: [] });
    await abrir("/gestao/galeria");
    await waitFor(() => {
      expect(screen.getByText(TF.vazioTitulo)).toBeInTheDocument();
    });
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
  });

  it("um 401 ao carregar a fila leva ao login e, depois de entrar, volta a /gestao/galeria", async () => {
    quemSouEuFalso.mockReset();
    quemSouEuFalso.mockResolvedValueOnce(SESSAO_DE_TESTE);
    quemSouEuFalso.mockRejectedValue(erro401());
    obterFilaFalsa.mockRejectedValue(erro401());

    await abrir("/gestao/galeria");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect((window.history.state as { voltar?: unknown } | null)?.voltar).toBe("/gestao/galeria");
    expect((window.history.state as { sessaoTerminou?: unknown } | null)?.sessaoTerminou).toBe(
      true,
    );
  });

  it("um erro do servidor ao carregar a fila fica no ecrã (nunca o login nem o vazio)", async () => {
    obterFilaFalsa.mockRejectedValue(erroDoServidor(500));
    await abrir("/gestao/galeria");
    await waitFor(() => {
      expect(screen.getByText(TF.carregarTitulo)).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe("/gestao/galeria");
    expect(screen.queryByText(TF.vazioTitulo)).toBeNull();
  });
});

describe("Eventos deixou de ser um destino vazio (F4-03)", () => {
  it("/gestao/eventos mostra o ecrã dos eventos, não o «Ainda não há nada aqui.»", async () => {
    await abrir("/gestao/eventos");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: TE.novoEvento })).toBeInTheDocument();
    });

    expect(h1()).toHaveTextContent(TE.titulo);
    expect(obterEventosFalso).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("main")).queryByText(T.vazioTitulo)).toBeNull();
    expect(screen.getByRole("region", { name: TE.proximos })).toBeInTheDocument();
    expect(document.title).toBe("Eventos — Gestão — Bar da Tomazia");
  });

  it("um 401 ao carregar os eventos leva ao login e, depois de entrar, volta a /gestao/eventos", async () => {
    quemSouEuFalso.mockReset();
    quemSouEuFalso.mockResolvedValueOnce(SESSAO_DE_TESTE);
    quemSouEuFalso.mockRejectedValue(erro401());
    obterEventosFalso.mockRejectedValue(erro401());

    await abrir("/gestao/eventos");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect((window.history.state as { voltar?: unknown } | null)?.voltar).toBe("/gestao/eventos");
    expect((window.history.state as { sessaoTerminou?: unknown } | null)?.sessaoTerminou).toBe(
      true,
    );
  });
});

describe("Mais e «Sair» (7.2 a 7.4)", () => {
  it("«Mais» tem o <h1> e o botão «Sair»; os outros destinos não", async () => {
    await abrir("/gestao/mais");
    expect(h1()).toHaveTextContent("Mais");
    expect(screen.getByRole("button", { name: T.sair })).toBeInTheDocument();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
  });

  it("sem «Sair» fora de «Mais»", async () => {
    await abrir("/gestao");
    expect(screen.queryByRole("button", { name: T.sair })).toBeNull();
  });

  it("a trabalhar: «A sair…», aria-busy e aria-disabled; um segundo clique não repete", async () => {
    const pedido = pendente<undefined>();
    sairFalso.mockReturnValue(pedido.promessa);
    await abrir("/gestao/mais");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.sair }));
      await Promise.resolve();
    });
    const botao = screen.getByRole("button", { name: T.aSair });
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(botao).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(botao);
    expect(sairFalso).toHaveBeenCalledTimes(1);
  });

  it("204: vai para /gestao/entrar a substituir e mostra o login", async () => {
    sairComSucesso();
    const empurrar = vi.spyOn(window.history, "pushState");
    const substituir = vi.spyOn(window.history, "replaceState");
    await abrir("/gestao/mais");
    substituir.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.sair }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(substituir.mock.calls.at(-1)?.[2]).toBe("/gestao/entrar");
    expect(empurrar).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("depois de sair, o Voltar não mostra a gestão: a guarda pergunta outra vez e o 401 manda para o login", async () => {
    sairComSucesso();
    await abrir("/gestao/mais");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.sair }));
      await Promise.resolve();
    });
    await screen.findByRole("heading", { level: 1, name: T.tituloDoLogin });
    quemSouEuFalso.mockRejectedValue(erro401());

    act(() => {
      window.history.pushState(null, "", "/gestao");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: "Início" })).toBeNull();
  });

  it.each([
    ["sem resposta", erroSemResposta(), T.saiuSemResposta],
    ["500", erroDoServidor(500), T.saiuServidor],
    ["403", erroDoServidor(403), T.saiuServidor],
  ])("%s: a sessão continua aberta, e diz-se", async (_nome, erro, frase) => {
    sairFalso.mockRejectedValue(erro);
    await abrir("/gestao/mais");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.sair }));
      await Promise.resolve();
    });

    const botao = screen.getByRole("button", { name: T.sair });
    expect(botao).not.toHaveAttribute("aria-busy");
    expect(window.location.pathname, "não navega").toBe("/gestao/mais");
    expect(navegacao()).toBeInTheDocument();
    expect(h1()).toHaveTextContent("Mais");

    const linha = screen.getByText(frase);
    expect(linha).toHaveAttribute("role", "status");
    expect(botao.getAttribute("aria-describedby")?.split(/\s+/)).toContain(linha.id);
    expect(screen.queryByText(/mensagem do cliente/)).toBeNull();
    expect(document.activeElement, "o foco fica no botão").toBe(botao);
  });

  it("a linha de erro desaparece no início da tentativa seguinte", async () => {
    sairFalso.mockRejectedValueOnce(erroSemResposta());
    await abrir("/gestao/mais");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.sair }));
      await Promise.resolve();
    });
    expect(screen.getByText(T.saiuSemResposta)).toBeInTheDocument();
    sairFalso.mockReturnValue(new Promise(() => undefined));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.sair }));
      await Promise.resolve();
    });

    expect(screen.queryByText(T.saiuSemResposta)).toBeNull();
  });
});

/**
 * F4-05a — a subrota `/gestao/mais/definicoes`, «Mais» como lista e o título.
 * Contrato: `Destino` (`Destino.tsx`) escolhe `<DefinicoesGestao />` em
 * `/gestao/mais/definicoes`; `Mais` tem a ligação «Definições» e, por baixo, «Sair».
 */
describe("a subrota das definições (F4-05a)", () => {
  it("/gestao/mais/definicoes é conhecida: não volta a /gestao, mostra as definições", async () => {
    const substituir = vi.spyOn(window.history, "replaceState");
    await abrir("/gestao/mais/definicoes");
    substituir.mockClear();

    expect(await screen.findByRole("heading", { level: 1, name: TD.titulo })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
    expect(substituir).not.toHaveBeenCalledWith(expect.anything(), "", "/gestao");
  });

  it("/gestao/mais/outra continua a voltar a /gestao", async () => {
    await abrir("/gestao/mais/outra");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
  });

  it("o título do separador é «Definições — Gestão — Bar da Tomazia»", async () => {
    await abrir("/gestao/mais/definicoes");
    await screen.findByRole("heading", { level: 1, name: TD.titulo });
    expect(document.title).toBe("Definições — Gestão — Bar da Tomazia");
  });

  it("«Mais» fica ativo na barra", async () => {
    await abrir("/gestao/mais/definicoes");
    await screen.findByRole("heading", { level: 1, name: TD.titulo });
    expect(
      within(navegacao()).getByRole("link", { name: "Mais" }).getAttribute("aria-current"),
    ).toMatch(/^(page|true)$/);
  });

  it("ao chegar da lista de «Mais», o foco vai para o <h1>", async () => {
    await abrir("/gestao/mais");
    fireEvent.click(screen.getByRole("link", { name: new RegExp(`^${TD.ligacaoNoMais}`) }));
    const titulo = await screen.findByRole("heading", { level: 1, name: TD.titulo });
    await waitFor(() => {
      expect(titulo).toHaveFocus();
    });
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
  });

  it("«Mais» é uma lista: a ligação «Definições» (para /gestao/mais/definicoes) e, por baixo, «Sair»", async () => {
    await abrir("/gestao/mais");

    const ligacao = screen.getByRole("link", { name: new RegExp(`^${TD.ligacaoNoMais}`) });
    expect(ligacao).toHaveAttribute("href", "/gestao/mais/definicoes");
    const sair = screen.getByRole("button", { name: T.sair });
    expect(
      ligacao.compareDocumentPosition(sair) & Node.DOCUMENT_POSITION_FOLLOWING,
      "«Sair» vem depois de «Definições»",
    ).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("list")).toContainElement(ligacao);
  });

  it("um 401 no GET das definições leva ao login com o destino lembrado; entrar volta lá", async () => {
    obterDefinicoesFalso.mockRejectedValue(erro401());
    await abrir("/gestao/mais/definicoes");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/entrar");
    });
    expect(window.history.state).toMatchObject({ voltar: "/gestao/mais/definicoes" });
  });
});
