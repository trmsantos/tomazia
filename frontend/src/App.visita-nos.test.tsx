/**
 * F3-06a, 2.3 e 11 — a secção «Visita-nos» dentro da página.
 *
 * O que o `App.tsx` tem de fazer (entrega ao frontend, 2.3):
 *
 *  - desenhar `<VisitaNos info={info} aoTentarOutraVez={…} />` a seguir a
 *    `<Galeria />`, com o **mesmo** estado do `/info` que o cabeçalho recebe: um
 *    só pedido (o `/info` é `no-store` e vai por dados móveis);
 *  - o estado `falhou` traz `estadoHttp: number | null` (o `estado` do
 *    `ErroDaApi`; `null` = sem resposta). Não é payload: o falhado continua a
 *    não carregar informação nenhuma;
 *  - `aoTentarOutraVez` repete o pedido e **não** volta a `a-carregar`: a secção
 *    não pisca para o esqueleto, o botão diz «A tentar…».
 *
 * Ficheiro à parte de `App.test.tsx` (que mede a árvore de títulos e continua
 * a valer tal como está: a secção só lhe acrescenta um `h2` e dois `h3`).
 *
 * **O que deixa passar:** a forma de cada estado (`VisitaNos.test.tsx`), o
 * cabeçalho (`Cabecalho.test.tsx`) e o layout (e2e).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { ErroDaApi } from "./lib/api/cliente";
import { obterEmenta, obterEventos, obterGaleria, obterInfo } from "./lib/api/publico";
import type { Info } from "./lib/api/publico";
import { EMENTA_DE_TESTE, TEXTOS_DA_EMENTA } from "./testes/ementa";
import { AGORA, TEXTOS_DOS_EVENTOS, TRES_EVENTOS } from "./testes/eventos";
import { SEM_FOTOS, TEXTOS_DA_GALERIA } from "./testes/galeria";
import { instalarDeslocamento, instalarMatchMedia } from "./testes/jsdom-da-ementa";
import { MOMENTOS, TEXTOS_DO_VISITA_NOS as T, infoCompleta, infoVazia } from "./testes/visita-nos";

vi.mock("./lib/api/publico", () => ({
  obterEmenta: vi.fn(),
  obterEventos: vi.fn(),
  obterGaleria: vi.fn(),
  obterInfo: vi.fn(),
}));

const pedirInfo = vi.mocked(obterInfo);

let restaurar: Array<() => void> = [];

beforeEach(() => {
  restaurar = [instalarDeslocamento().restaurar, instalarMatchMedia().restaurar];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(MOMENTOS.qui17h00));
  vi.mocked(obterEmenta).mockResolvedValue(EMENTA_DE_TESTE);
  vi.mocked(obterEventos).mockResolvedValue({ eventos: [] });
  vi.mocked(obterGaleria).mockResolvedValue(SEM_FOTOS);
  pedirInfo.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  for (const desfazer of restaurar) desfazer();
});

function seccaoDoVisitaNos(): HTMLElement {
  const titulo = screen.getByRole("heading", { level: 2, name: T.titulo });
  const seccao = titulo.closest("section");
  if (seccao === null) throw new Error("o <h2> «Visita-nos» devia estar dentro de uma <section>");
  return seccao;
}

async function esperarPelaPaginaAssente(): Promise<void> {
  await screen.findByRole("navigation", { name: TEXTOS_DA_EMENTA.nomeDaBarra });
  await screen.findByRole("heading", { name: TEXTOS_DA_GALERIA.vazioTitulo });
}

function erroDoServidor(estado: number | null): ErroDaApi {
  return new ErroDaApi("(mensagem do cliente)", { estado, codigo: null });
}

describe("um só pedido ao /info (2.3)", () => {
  it("o cabeçalho e a secção partilham o mesmo pedido", async () => {
    pedirInfo.mockResolvedValue(infoCompleta());

    render(<App />);
    await esperarPelaPaginaAssente();
    await screen.findByRole("heading", { level: 3, name: T.tituloDoHorario });

    expect(pedirInfo).toHaveBeenCalledTimes(1);
  });

  it("o falhado também é um só pedido, e a secção e o cabeçalho existem na mesma", async () => {
    pedirInfo.mockRejectedValue(erroDoServidor(500));

    render(<App />);
    await esperarPelaPaginaAssente();
    await screen.findByText(T.erroTitulo);

    expect(pedirInfo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("em StrictMode o primeiro pedido é o cancelado: no máximo dois, o primeiro abortado", async () => {
    pedirInfo.mockResolvedValue(infoCompleta());

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole("heading", { level: 3, name: T.tituloDoHorario });

    const sinais = pedirInfo.mock.calls.map((chamada) => chamada[0]?.sinal);
    expect(sinais.length).toBeLessThanOrEqual(2);
    // Nenhum pedido ficou no ar sem dono: todos menos o último foram abortados.
    for (const sinal of sinais.slice(0, -1)) expect(sinal?.aborted).toBe(true);
  });
});

describe("onde a secção vive na página (2.1)", () => {
  it("os <h2> vão Ementa, Eventos, Galeria, Visita-nos; e o <h1> continua a ser um só", async () => {
    vi.setSystemTime(AGORA);
    vi.mocked(obterEventos).mockResolvedValue(TRES_EVENTOS);
    pedirInfo.mockResolvedValue(infoCompleta());

    const { container } = render(<App />);
    await esperarPelaPaginaAssente();
    await screen.findByRole("heading", { level: 2, name: TEXTOS_DOS_EVENTOS.titulo });
    await screen.findByRole("heading", { level: 3, name: T.tituloDoHorario });

    const h2 = screen.getAllByRole("heading", { level: 2 }).map((titulo) => titulo.textContent);
    expect(h2).toEqual([
      TEXTOS_DA_EMENTA.titulo,
      TEXTOS_DOS_EVENTOS.titulo,
      TEXTOS_DA_GALERIA.titulo,
      T.titulo,
    ]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector("main #visita-nos")).not.toBeNull();
  });

  it("a secção vem depois da galeria, dentro do <main>, e não desconta o cabeçalho outra vez", async () => {
    pedirInfo.mockResolvedValue(infoCompleta());

    const { container } = render(<App />);
    await esperarPelaPaginaAssente();
    await screen.findByRole("heading", { level: 3, name: T.tituloDoHorario });

    const galeria = container.querySelector("main #galeria") as HTMLElement;
    const visita = container.querySelector("main #visita-nos") as HTMLElement;

    expect(galeria).not.toBeNull();
    expect(galeria.compareDocumentPosition(visita) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visita.className).not.toMatch(/pt-cabecalho/);
  });

  it("sem nada para mostrar a secção não existe, e a página fica com dois <h2>", async () => {
    pedirInfo.mockResolvedValue(infoVazia());

    const { container } = render(<App />);
    await esperarPelaPaginaAssente();
    await waitFor(() => {
      expect(pedirInfo).toHaveBeenCalled();
    });
    // Dá tempo ao estado «pronto» de chegar à secção.
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("#visita-nos")).toBeNull();
    expect(screen.queryByRole("heading", { name: T.titulo })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2 /* ementa e galeria */);
  });
});

describe("os estados do /info chegam à secção (2.3, 4.1, 4.2)", () => {
  it("enquanto o pedido não responde: o <h2> e o esqueleto, aria-busy, sem a palavra «Fechado»", async () => {
    pedirInfo.mockReturnValue(new Promise<Info>(() => undefined));

    render(<App />);
    await esperarPelaPaginaAssente();

    const seccao = seccaoDoVisitaNos();
    expect(seccao.getAttribute("aria-busy")).toBe("true");
    expect(seccao.textContent).toBe(T.titulo);
  });

  it("sem resposta (a rede caiu): a linha «Verifica a ligação»", async () => {
    pedirInfo.mockRejectedValue(erroDoServidor(null));

    render(<App />);
    await esperarPelaPaginaAssente();

    const seccao = seccaoDoVisitaNos();
    expect(await within(seccao).findByText(T.erroSemResposta)).toBeInTheDocument();
    expect(within(seccao).queryByText(T.erroComResposta)).toBeNull();
  });

  it("o servidor respondeu com erro: a linha «O problema é nosso»", async () => {
    pedirInfo.mockRejectedValue(erroDoServidor(500));

    render(<App />);
    await esperarPelaPaginaAssente();

    const seccao = seccaoDoVisitaNos();
    expect(await within(seccao).findByText(T.erroComResposta)).toBeInTheDocument();
    expect(within(seccao).queryByText(T.erroSemResposta)).toBeNull();
  });

  it("um erro que não é do cliente da API (um TypeError) também é «sem resposta», nunca «por configurar»", async () => {
    pedirInfo.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<App />);
    await esperarPelaPaginaAssente();

    const seccao = seccaoDoVisitaNos();
    expect(await within(seccao).findByText(T.erroTitulo)).toBeInTheDocument();
    expect(within(seccao).getByText(T.erroSemResposta)).toBeInTheDocument();
  });

  it("«Tentar outra vez» repete o pedido sem voltar ao esqueleto, e recupera a secção toda", async () => {
    let responder: (info: Info) => void = () => undefined;
    pedirInfo.mockRejectedValueOnce(erroDoServidor(500)).mockImplementationOnce(
      () =>
        new Promise<Info>((cumprir) => {
          responder = cumprir;
        }),
    );

    render(<App />);
    await esperarPelaPaginaAssente();
    const botao = await within(seccaoDoVisitaNos()).findByRole("button", {
      name: T.tentarOutraVez,
    });

    fireEvent.click(botao);

    // A tentar: continua a ser o ecrã de erro, com o botão a ocupado (4.2).
    await waitFor(() => {
      expect(pedirInfo).toHaveBeenCalledTimes(2);
    });
    const durante = seccaoDoVisitaNos();
    expect(within(durante).getByRole("button", { name: T.aTentar })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(durante.getAttribute("aria-busy")).not.toBe("true");
    expect(within(durante).getByText(T.erroTitulo)).toBeInTheDocument();

    await act(async () => {
      responder(infoCompleta());
      await Promise.resolve();
    });

    const depois = seccaoDoVisitaNos();
    expect(
      await within(depois).findByRole("heading", { level: 3, name: T.tituloDoHorario }),
    ).toBeInTheDocument();
    expect(within(depois).queryByText(T.erroTitulo)).toBeNull();
    expect(pedirInfo).toHaveBeenCalledTimes(2);
  });

  it("falhar outra vez deixa tudo igual, sem mensagem a dobrar", async () => {
    pedirInfo.mockRejectedValue(erroDoServidor(500));

    render(<App />);
    await esperarPelaPaginaAssente();
    const botao = await within(seccaoDoVisitaNos()).findByRole("button", {
      name: T.tentarOutraVez,
    });

    fireEvent.click(botao);
    await waitFor(() => {
      expect(pedirInfo).toHaveBeenCalledTimes(2);
    });
    await within(seccaoDoVisitaNos()).findByRole("button", { name: T.tentarOutraVez });

    const seccao = seccaoDoVisitaNos();
    expect(within(seccao).getAllByText(T.erroTitulo)).toHaveLength(1);
    expect(within(seccao).getAllByText(T.erroComResposta)).toHaveLength(1);
  });
});
