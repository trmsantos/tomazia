/**
 * F4-03, spec 7.6 e plano 5.9 — sair da folha com alterações por guardar (a guarda da F4-05a).
 *
 * Enquanto a folha de criar/editar está aberta **e** tem alterações, o ecrã regista a guarda
 * (`definirGuardaDeSaida`) e o `beforeunload`; limpa-os ao fechar a folha, ao guardar com sucesso
 * e ao desmontar. Fechar a folha (`Cancelar`, `Esc`, cortina) com alterações abre a pergunta «Há
 * alterações por guardar.» **por cima** (uma segunda folha, empilhada); a de editar não fecha.
 * «Continuar a editar» fecha a de cima; «Sair sem guardar» descarta e fecha as duas (ou faz a
 * navegação pendente de um Voltar). Sem alterações, nenhuma pergunta. O 401 e o «Sair» nunca
 * passam pela guarda.
 *
 * **Deixa passar** (e2e): o foco a começar em «Continuar a editar» e o regresso do foco.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { abrirEm, erroSemResposta, eventoDeTeste } from "../../../testes/gestao";
import {
  abrirEventos,
  alterarFalso,
  assentar,
  botao,
  criarFalso,
  escrever,
  haFolha,
  prepararApi,
  preencher,
  sessaoFalsa,
  tocar,
} from "../../../testes/eventos-gestao";
import { ContextoDaSessao } from "../SessaoDaGestao";
import { MolduraDaGestao } from "../MolduraDaGestao";
import { definirGuardaDeSaida, navegar, navegarComGuarda } from "../navegacao";
import { EventosGestao } from "./EventosGestao";
import { TEXTOS } from "./textos";

vi.mock("../../../lib/api/gestao-eventos", () => ({
  obterEventosGestao: vi.fn(),
  criarEvento: vi.fn(),
  alterarEvento: vi.fn(),
  eliminarEvento: vi.fn(),
  duplicarEvento: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});
afterEach(() => {
  definirGuardaDeSaida(null);
});

async function abrirNaMoldura(caminho = "/gestao/eventos"): Promise<void> {
  abrirEm(caminho);
  render(
    <ContextoDaSessao.Provider value={sessaoFalsa()}>
      <MolduraDaGestao caminho={caminho}>
        <EventosGestao />
      </MolduraDaGestao>
    </ContextoDaSessao.Provider>,
  );
  await assentar();
}
async function abrirEditarSujo(): Promise<void> {
  await tocar(screen.getByRole("button", { name: "Fado ao vivo" }));
  escrever(TEXTOS.etiquetaTitulo, "Fado alterado");
}
async function abrirCriarSujo(): Promise<void> {
  await tocar(screen.getByRole("button", { name: TEXTOS.novoEvento }));
  escrever(TEXTOS.etiquetaTitulo, "Qualquer coisa");
}
function pergunta(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: TEXTOS.saidaTitulo });
}
function cancelarEvento(alvo: HTMLElement): void {
  fireEvent(alvo, new Event("cancel", { cancelable: true }));
}
async function tocarNaEmenta(): Promise<void> {
  await tocar(screen.getByRole("link", { name: "Ementa" }));
}

describe("fechar a folha com alterações pergunta", () => {
  it.each([
    ["«Cancelar»", async () => tocar(botao(TEXTOS.cancelar))],
    [
      "`Esc` (o evento cancel)",
      async () => {
        cancelarEvento(screen.getByRole("dialog", { name: TEXTOS.tituloEditar }));
        await assentar();
      },
    ],
    [
      "a cortina (o próprio <dialog>)",
      async () => tocar(screen.getByRole("dialog", { name: TEXTOS.tituloEditar })),
    ],
  ])(
    "%s abre a pergunta, com o título, a linha e as duas saídas, e a folha de editar NÃO fecha",
    async (_n, fechar) => {
      await abrirEventos();
      await abrirEditarSujo();

      await fechar();

      const p = pergunta();
      expect(p).not.toBeNull();
      expect(p).toHaveTextContent(TEXTOS.saidaLinha);
      expect(screen.getByRole("button", { name: TEXTOS.saidaSair })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: TEXTOS.saidaContinuar })).toBeInTheDocument();
      expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
      expect(screen.getByLabelText(TEXTOS.etiquetaTitulo)).toHaveValue("Fado alterado");
    },
  );

  it("«Continuar a editar»: fecha só a de cima; o escrito fica", async () => {
    await abrirEventos();
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.cancelar));

    await tocar(botao(TEXTOS.saidaContinuar));

    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
    expect(screen.getByLabelText(TEXTOS.etiquetaTitulo)).toHaveValue("Fado alterado");
  });

  it("`Esc` e cortina da pergunta equivalem a «Continuar a editar»", async () => {
    await abrirEventos();
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.cancelar));
    cancelarEvento(screen.getByRole("dialog", { name: TEXTOS.saidaTitulo }));
    await assentar();
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);

    await tocar(botao(TEXTOS.cancelar));
    await tocar(screen.getByRole("dialog", { name: TEXTOS.saidaTitulo }));
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
  });

  it("«Sair sem guardar»: descarta, fecha as duas e não envia nada", async () => {
    await abrirEventos();
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.cancelar));

    await tocar(botao(TEXTOS.saidaSair));

    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(criarFalso).not.toHaveBeenCalled();

    // Reabrir mostra o evento como estava, não o descartado.
    await tocar(screen.getByRole("button", { name: "Fado ao vivo" }));
    expect(screen.getByLabelText(TEXTOS.etiquetaTitulo)).toHaveValue("Fado ao vivo");
  });

  it("a folha de criar com texto escrito também pergunta", async () => {
    await abrirEventos();
    await abrirCriarSujo();
    await tocar(botao(TEXTOS.cancelar));
    expect(pergunta()).not.toBeNull();
    expect(haFolha(TEXTOS.tituloCriar)).toBe(true);
  });

  it("sem alterações nenhuma pergunta: «Cancelar», `Esc` e a cortina fecham logo", async () => {
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: "Fado ao vivo" }));
    await tocar(botao(TEXTOS.cancelar));
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);

    await tocar(screen.getByRole("button", { name: TEXTOS.novoEvento }));
    cancelarEvento(screen.getByRole("dialog", { name: TEXTOS.tituloCriar }));
    await assentar();
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloCriar)).toBe(false);
  });

  it("alterar e repor o valor de antes não conta como alteração", async () => {
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: "Fado ao vivo" }));
    escrever(TEXTOS.etiquetaTitulo, "x");
    escrever(TEXTOS.etiquetaTitulo, "Fado ao vivo");
    await tocar(botao(TEXTOS.cancelar));
    expect(pergunta()).toBeNull();
  });
});

describe("a barra da gestão e o Voltar do browser", () => {
  it("tocar noutro destino com a folha suja não navega e abre a pergunta", async () => {
    await abrirNaMoldura();
    await abrirEditarSujo();

    await tocarNaEmenta();

    expect(window.location.pathname).toBe("/gestao/eventos");
    expect(pergunta()).not.toBeNull();
  });

  it("«Sair sem guardar» leva ao destino tocado", async () => {
    await abrirNaMoldura();
    await abrirEditarSujo();
    await tocarNaEmenta();

    await tocar(botao(TEXTOS.saidaSair));

    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("o Voltar do browser com a folha suja: repõe o endereço e abre a pergunta dentro da folha", async () => {
    abrirEm("/gestao");
    navegar("/gestao/eventos");
    await abrirNaMoldura("/gestao/eventos");
    await abrirEditarSujo();

    window.history.back();
    await waitFor(() => {
      expect(pergunta()).not.toBeNull();
    });

    expect(window.location.pathname).toBe("/gestao/eventos");
    expect(screen.getByLabelText(TEXTOS.etiquetaTitulo)).toHaveValue("Fado alterado");
  });

  it("«Continuar a editar» fica; depois «Sair sem guardar» faz o Voltar que estava pendente", async () => {
    abrirEm("/gestao");
    navegar("/gestao/eventos");
    await abrirNaMoldura("/gestao/eventos");
    await abrirEditarSujo();
    window.history.back();
    await waitFor(() => {
      expect(pergunta()).not.toBeNull();
    });

    await tocar(botao(TEXTOS.saidaContinuar));
    expect(window.location.pathname).toBe("/gestao/eventos");

    window.history.back();
    await waitFor(() => {
      expect(pergunta()).not.toBeNull();
    });
    await tocar(botao(TEXTOS.saidaSair));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
  });

  it("o Voltar com a folha limpa (ou fechada) sai direto, sem pergunta", async () => {
    abrirEm("/gestao");
    navegar("/gestao/eventos");
    await abrirNaMoldura("/gestao/eventos");

    window.history.back();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
    expect(pergunta()).toBeNull();
  });

  it("a guarda só existe com a folha aberta e suja: fechar a folha limpa-a", async () => {
    await abrirNaMoldura();
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.cancelar));
    await tocar(botao(TEXTOS.saidaSair));

    await tocarNaEmenta();
    expect(pergunta()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("depois de guardar com sucesso, sai-se sem perguntar", async () => {
    await abrirNaMoldura();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: "Fado alterado" }));
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.guardarAlteracoes));

    await tocarNaEmenta();

    expect(pergunta()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("um «não sei se gravou» continua a contar como alteração por guardar", async () => {
    await abrirNaMoldura();
    alterarFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.guardarAlteracoes));

    await tocarNaEmenta();
    expect(pergunta()).not.toBeNull();
  });

  it("ao desmontar, a guarda sai (nada fica registado para o ecrã seguinte)", async () => {
    await abrirNaMoldura();
    await abrirEditarSujo();
    cleanup();

    navegarComGuarda("/gestao/ementa");
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("o `navegar` (401, login, «Sair») nunca é bloqueado, mesmo com a folha suja", async () => {
    await abrirNaMoldura();
    await abrirEditarSujo();

    act(() => {
      navegar("/gestao/entrar", { substituir: true });
    });

    expect(window.location.pathname).toBe("/gestao/entrar");
    expect(pergunta()).toBeNull();
  });
});

describe("beforeunload (recarregar ou fechar o separador)", () => {
  function disparar(): boolean {
    const evento = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evento);
    return evento.defaultPrevented;
  }

  it("só com a folha aberta e alterações: sem elas, ou com a folha fechada, não se previne nada", async () => {
    await abrirEventos();
    expect(disparar(), "folha fechada").toBe(false);

    await tocar(screen.getByRole("button", { name: "Fado ao vivo" }));
    expect(disparar(), "folha limpa").toBe(false);

    escrever(TEXTOS.etiquetaTitulo, "Fado alterado");
    expect(disparar(), "folha suja").toBe(true);

    escrever(TEXTOS.etiquetaTitulo, "Fado ao vivo");
    expect(disparar(), "valor reposto").toBe(false);
  });

  it("a folha de criar com texto escrito também previne", async () => {
    await abrirEventos();
    await abrirCriarSujo();
    expect(disparar()).toBe(true);
    preencher({ titulo: "" });
    expect(disparar()).toBe(false);
  });

  it("depois de «Sair sem guardar» e ao desmontar volta a não prevenir", async () => {
    await abrirEventos();
    await abrirEditarSujo();
    await tocar(botao(TEXTOS.cancelar));
    await tocar(botao(TEXTOS.saidaSair));
    expect(disparar()).toBe(false);

    await abrirEditarSujo();
    expect(disparar()).toBe(true);
    cleanup();
    expect(disparar()).toBe(false);
  });
});
