/**
 * F4-05a, secção 10 de `docs/ecras/F4-05a.md`, plano 3.7 e decisão D3 do Tomás —
 * sair com alterações por guardar.
 *
 * O ecrã regista uma guarda (`definirGuardaDeSaida`, ver `navegacao.test.tsx`)
 * enquanto há alterações, e limpa-a quando deixa de as haver e ao desmontar. Aqui
 * monta-se dentro da `MolduraDaGestao` (a barra e a ligação «Voltar a Mais» passam
 * pela guarda) e prova-se o que o dono vê: a `Folha` «Há alterações por guardar.»
 * com «Sair sem guardar» e «Continuar a editar»; `Esc` e a cortina = continuar; o
 * Voltar do browser repõe o endereço e abre a mesma folha; `beforeunload` só com
 * alterações; o 401, o login e o «Sair» nunca são bloqueados.
 *
 * **Deixa passar** (e2e): o foco por omissão em «Continuar a editar» e o regresso do
 * foco (são do `<dialog>` nativo, que o jsdom não simula).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { abrirEm, erroSemResposta } from "../../../testes/gestao";
import {
  assentar,
  botaoDeGuardar,
  escrever,
  guardar,
  guardarFalso,
  prepararApi,
  sessaoFalsa,
  tocar,
} from "../../../testes/definicoes";
import { ContextoDaSessao } from "../SessaoDaGestao";
import { MolduraDaGestao } from "../MolduraDaGestao";
import { definirGuardaDeSaida, navegar, navegarComGuarda } from "../navegacao";
import { DefinicoesGestao } from "./DefinicoesGestao";
import { TEXTOS, nomeDoDia } from "./textos";

vi.mock("../../../lib/api/gestao-definicoes", () => ({
  obterDefinicoes: vi.fn(),
  guardarDefinicoes: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});

afterEach(() => {
  definirGuardaDeSaida(null);
});

async function abrirNaMoldura(caminho = "/gestao/mais/definicoes"): Promise<void> {
  abrirEm(caminho);
  render(
    <ContextoDaSessao.Provider value={sessaoFalsa()}>
      <MolduraDaGestao caminho={caminho}>
        <DefinicoesGestao />
      </MolduraDaGestao>
    </ContextoDaSessao.Provider>,
  );
  await assentar();
}

function folha(): HTMLElement | null {
  return screen.queryByRole("dialog");
}

function ligacaoEmenta(): HTMLElement {
  return screen.getByRole("link", { name: "Ementa" });
}

async function tocarNaEmenta(): Promise<void> {
  await tocar(ligacaoEmenta());
}

describe("com alterações por guardar", () => {
  it("tocar noutro destino da barra não navega e abre a Folha «Há alterações por guardar.» com as duas saídas", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");

    await tocarNaEmenta();

    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
    const dialogo = folha();
    expect(dialogo).not.toBeNull();
    expect(dialogo).toHaveTextContent(TEXTOS.saidaTitulo);
    expect(dialogo).toHaveTextContent(TEXTOS.saidaLinha);
    expect(screen.getByRole("button", { name: TEXTOS.saidaSair })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.saidaContinuar })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: TEXTOS.saidaTitulo })).toBeInTheDocument();
  });

  it("«Continuar a editar»: fecha a folha, não navega e o rascunho fica intacto", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await tocarNaEmenta();

    await tocar(screen.getByRole("button", { name: TEXTOS.saidaContinuar }));

    expect(folha()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
    expect(screen.getByLabelText(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
  });

  it("«Sair sem guardar»: navega ao destino tocado e não envia nada", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await tocarNaEmenta();

    await tocar(screen.getByRole("button", { name: TEXTOS.saidaSair }));

    expect(window.location.pathname).toBe("/gestao/ementa");
    expect(guardarFalso).not.toHaveBeenCalled();
  });

  it("`Esc` (o evento cancel do <dialog>) é «Continuar a editar»", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await tocarNaEmenta();

    await act(async () => {
      fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });

    expect(folha()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
  });

  it("tocar na cortina (o próprio <dialog>) é «Continuar a editar»", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await tocarNaEmenta();

    await tocar(screen.getByRole("dialog"));

    expect(folha()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
  });

  it("«Voltar a Mais» também pergunta; «Sair sem guardar» leva a /gestao/mais", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");

    await tocar(screen.getByRole("link", { name: TEXTOS.voltarAMais }));
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
    expect(folha()).not.toBeNull();

    await tocar(screen.getByRole("button", { name: TEXTOS.saidaSair }));
    expect(window.location.pathname).toBe("/gestao/mais");
  });

  it("tocar em «Mais» na barra (o pai) também pergunta", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await tocar(screen.getByRole("link", { name: "Mais" }));
    expect(folha()).not.toBeNull();
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
  });

  it("uma alteração só no horário (fechar um dia) também conta", async () => {
    await abrirNaMoldura();
    await tocar(screen.getByRole("switch", { name: nomeDoDia("terca") }));
    await tocarNaEmenta();
    expect(folha()).not.toBeNull();
  });

  it("um «não sei se gravou» continua a contar como alteração por guardar", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    await guardar();

    await tocarNaEmenta();
    expect(folha()).not.toBeNull();
  });
});

describe("sem alterações: nenhuma pergunta", () => {
  it("logo a seguir ao carregar, a barra navega sem folha", async () => {
    await abrirNaMoldura();
    await tocarNaEmenta();
    expect(folha()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("alterar e repor o valor de antes desliga a guarda", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "x");
    escrever(TEXTOS.etiquetaRede, "tomazia-exemplo");
    await tocarNaEmenta();
    expect(folha()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("depois de guardar com sucesso, sai-se sem perguntar", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await guardar();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");

    await tocarNaEmenta();
    expect(folha()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("ao desmontar, a guarda sai (nada fica registado para o ecrã seguinte)", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    cleanup();

    navegarComGuarda("/gestao/ementa");
    expect(window.location.pathname).toBe("/gestao/ementa");
  });
});

describe("o que a guarda nunca bloqueia", () => {
  it("o `navegar` (401, login, «Sair») segue com alterações por guardar, sem folha", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");

    act(() => {
      navegar("/gestao/entrar", { substituir: true });
    });

    expect(window.location.pathname).toBe("/gestao/entrar");
    expect(folha()).toBeNull();
  });
});

describe("o Voltar do browser (popstate)", () => {
  async function recuar(): Promise<void> {
    window.history.back();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeNull();
    });
  }

  it("com alterações: repõe o endereço e abre a mesma Folha", async () => {
    abrirEm("/gestao/mais");
    navegar("/gestao/mais/definicoes");
    await abrirNaMoldura("/gestao/mais/definicoes");
    escrever(TEXTOS.etiquetaRede, "outra-rede");

    await recuar();

    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
    expect(screen.getByRole("dialog", { name: TEXTOS.saidaTitulo })).toBeInTheDocument();
    expect(screen.getByLabelText(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
  });

  it("«Sair sem guardar» faz o Voltar que estava pendente; «Continuar a editar» fica", async () => {
    abrirEm("/gestao/mais");
    navegar("/gestao/mais/definicoes");
    await abrirNaMoldura("/gestao/mais/definicoes");
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await recuar();

    await tocar(screen.getByRole("button", { name: TEXTOS.saidaContinuar }));
    expect(window.location.pathname).toBe("/gestao/mais/definicoes");
    expect(folha()).toBeNull();

    await recuar();
    await tocar(screen.getByRole("button", { name: TEXTOS.saidaSair }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao/mais");
    });
  });
});

describe("beforeunload (recarregar ou fechar o separador)", () => {
  function disparar(): boolean {
    const evento = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evento);
    return evento.defaultPrevented;
  }

  it("só com alterações: sem elas não se previne nada", async () => {
    await abrirNaMoldura();
    expect(disparar()).toBe(false);

    escrever(TEXTOS.etiquetaRede, "outra-rede");
    expect(disparar()).toBe(true);

    escrever(TEXTOS.etiquetaRede, "tomazia-exemplo");
    expect(disparar()).toBe(false);
  });

  it("depois de guardar volta a não prevenir; ao desmontar também não", async () => {
    await abrirNaMoldura();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await guardar();
    expect(disparar()).toBe(false);

    escrever(TEXTOS.etiquetaRede, "mais-uma");
    expect(disparar()).toBe(true);
    cleanup();
    expect(disparar()).toBe(false);
  });
});
