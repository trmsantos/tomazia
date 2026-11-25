/**
 * F4-04, plano 5.7 e spec 7.6 — sair da folha «Enviar foto» com a foto escolhida ou a legenda
 * escrita (a guarda de saída da F4-05a, padrão da F4-03 7.6).
 *
 * Enquanto a folha está aberta **e** tem foto escolhida ou legenda escrita, o ecrã regista a
 * guarda (`definirGuardaDeSaida`) e o `beforeunload`; limpa-os ao fechar a folha, ao enviar e ao
 * desmontar. Fechar a folha (`Cancelar`, `Esc`, cortina) com alterações abre a pergunta «Ainda não
 * enviaste a foto.» **por cima** (uma segunda folha); a de enviar não fecha. «Continuar» fecha a
 * de cima e deixa tudo como estava; «Sair sem enviar» descarta e fecha as duas (ou faz a
 * navegação pendente de um Voltar). **Sem foto nem legenda, nenhuma pergunta.** O 401 e o «Sair»
 * da sessão nunca passam pela guarda. A moderação (aprovar, rejeitar) nunca regista guarda.
 *
 * **Deixa passar:** o foco a começar em «Continuar» e o seu regresso ao campo (e2e).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { abrirEm, erroSemResposta } from "../../../testes/gestao";
import {
  TEXTOS,
  abrirFolhaDeEnviar,
  abrirGaleria,
  assentar,
  botao,
  botaoAprovar,
  botaoCancelarDaFolha,
  botaoEnviarDaFolha,
  campoDaLegenda,
  enviarFalso,
  escolherFoto,
  esperarPor,
  escreverLegenda,
  folha,
  haFolha,
  obterFalso,
  pendente,
  prepararApi,
  prontaParaModerar,
  rejeitarFalso,
  sessaoFalsa,
  tocar,
} from "../../../testes/fotos-gestao";
import { ContextoDaSessao } from "../SessaoDaGestao";
import { MolduraDaGestao } from "../MolduraDaGestao";
import { definirGuardaDeSaida, navegar, navegarComGuarda } from "../navegacao";
import { GaleriaGestao } from "./GaleriaGestao";

vi.mock("../../../lib/api/gestao-fotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/gestao-fotos")>()),
  obterFilaDeModeracao: vi.fn(),
  aprovarFoto: vi.fn(),
  rejeitarFoto: vi.fn(),
  obterAprovadas: vi.fn(),
  eliminarFoto: vi.fn(),
}));
vi.mock("../../../lib/api/publico", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/publico")>()),
  obterGaleria: vi.fn(),
  enviarFoto: vi.fn(),
}));
vi.mock("../../../lib/imagens/reduzir", () => ({ reduzir: vi.fn() }));

beforeEach(() => {
  prepararApi();
});
afterEach(() => {
  definirGuardaDeSaida(null);
});

async function abrirNaMoldura(caminho = "/gestao/galeria"): Promise<void> {
  abrirEm(caminho);
  render(
    <ContextoDaSessao.Provider value={sessaoFalsa()}>
      <MolduraDaGestao caminho={caminho}>
        <GaleriaGestao />
      </MolduraDaGestao>
    </ContextoDaSessao.Provider>,
  );
  await assentar();
}

async function abrirSujaComFoto(): Promise<void> {
  await abrirFolhaDeEnviar();
  await escolherFoto();
}
async function abrirSujaComLegenda(): Promise<void> {
  await abrirFolhaDeEnviar();
  escreverLegenda("Noite de samba");
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
    ["«Cancelar»", async () => tocar(botaoCancelarDaFolha())],
    [
      "`Esc` (o evento cancel)",
      async () => {
        cancelarEvento(folha(TEXTOS.tituloEnviar));
        await assentar();
      },
    ],
    ["a cortina (o próprio <dialog>)", async () => tocar(folha(TEXTOS.tituloEnviar))],
  ])(
    "%s abre a pergunta, com o título, a linha e as duas saídas, e a folha de enviar NÃO fecha",
    async (_n, fechar) => {
      await abrirGaleria();
      await abrirSujaComFoto();

      await fechar();

      const p = pergunta();
      expect(p).not.toBeNull();
      expect(p).toHaveTextContent(TEXTOS.saidaLinha);
      expect(screen.getByRole("button", { name: TEXTOS.saidaSair })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: TEXTOS.saidaContinuar })).toBeInTheDocument();
      expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
      expect(enviarFalso).not.toHaveBeenCalled();
    },
  );

  it("só com a legenda escrita também pergunta", async () => {
    await abrirGaleria();
    await abrirSujaComLegenda();
    await tocar(botaoCancelarDaFolha());
    expect(pergunta()).not.toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
  });

  it("«Continuar»: fecha só a de cima; a foto escolhida e a legenda ficam", async () => {
    await abrirGaleria();
    await abrirSujaComFoto();
    escreverLegenda("Noite de samba");
    await tocar(botaoCancelarDaFolha());

    await tocar(botao(TEXTOS.saidaContinuar));

    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
    expect(campoDaLegenda()).toHaveValue("Noite de samba");
    expect(folha(TEXTOS.tituloEnviar).querySelector("img")).not.toBeNull();
    expect(botaoEnviarDaFolha()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("`Esc` e a cortina da pergunta equivalem a «Continuar»", async () => {
    await abrirGaleria();
    await abrirSujaComLegenda();
    await tocar(botaoCancelarDaFolha());
    cancelarEvento(screen.getByRole("dialog", { name: TEXTOS.saidaTitulo }));
    await assentar();
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);

    await tocar(botaoCancelarDaFolha());
    await tocar(screen.getByRole("dialog", { name: TEXTOS.saidaTitulo }));
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
  });

  it("«Sair sem enviar»: descarta, fecha as duas e não envia nada; reabrir mostra a folha limpa", async () => {
    await abrirGaleria();
    await abrirSujaComFoto();
    escreverLegenda("Noite de samba");
    await tocar(botaoCancelarDaFolha());

    await tocar(botao(TEXTOS.saidaSair));

    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);
    expect(enviarFalso).not.toHaveBeenCalled();

    await abrirFolhaDeEnviar();
    expect(campoDaLegenda()).toHaveValue("");
    expect(folha(TEXTOS.tituloEnviar).querySelector("img")).toBeNull();
  });

  it("SEM foto nem legenda nenhuma pergunta: «Cancelar», `Esc` e a cortina fecham logo", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    await tocar(botaoCancelarDaFolha());
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);

    await abrirFolhaDeEnviar();
    cancelarEvento(folha(TEXTOS.tituloEnviar));
    await assentar();
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);

    await abrirFolhaDeEnviar();
    await tocar(folha(TEXTOS.tituloEnviar));
    expect(pergunta()).toBeNull();
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);
  });

  it("escrever e apagar a legenda não conta como alteração", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    escreverLegenda("x");
    escreverLegenda("");
    await tocar(botaoCancelarDaFolha());
    expect(pergunta()).toBeNull();
  });

  it("a pergunta não se mistura com a moderação: rejeitar nunca a abre", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(screen.getByRole("button", { name: TEXTOS.rejeitar }));
    await tocar(botao(TEXTOS.cancelar));
    expect(pergunta()).toBeNull();
    expect(rejeitarFalso).not.toHaveBeenCalled();
  });
});

describe("a barra da gestão e o Voltar do browser", () => {
  it("tocar noutro destino com a folha suja não navega e abre a pergunta", async () => {
    await abrirNaMoldura();
    await abrirSujaComFoto();

    await tocarNaEmenta();

    expect(window.location.pathname).toBe("/gestao/galeria");
    expect(pergunta()).not.toBeNull();
  });

  it("«Sair sem enviar» leva ao destino tocado", async () => {
    await abrirNaMoldura();
    await abrirSujaComLegenda();
    await tocarNaEmenta();

    await tocar(botao(TEXTOS.saidaSair));

    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("o Voltar do browser com a folha suja: repõe o endereço e abre a pergunta dentro da folha", async () => {
    abrirEm("/gestao");
    navegar("/gestao/galeria");
    await abrirNaMoldura("/gestao/galeria");
    await abrirSujaComLegenda();

    window.history.back();
    await esperarPor(() => pergunta() !== null, "a pergunta de sair");

    expect(window.location.pathname).toBe("/gestao/galeria");
    expect(campoDaLegenda()).toHaveValue("Noite de samba");
  });

  it("«Continuar» fica; depois «Sair sem enviar» faz o Voltar que estava pendente", async () => {
    abrirEm("/gestao");
    navegar("/gestao/galeria");
    await abrirNaMoldura("/gestao/galeria");
    await abrirSujaComLegenda();
    window.history.back();
    await esperarPor(() => pergunta() !== null, "a pergunta de sair");

    await tocar(botao(TEXTOS.saidaContinuar));
    expect(window.location.pathname).toBe("/gestao/galeria");

    window.history.back();
    await esperarPor(() => pergunta() !== null, "a pergunta de sair");
    await tocar(botao(TEXTOS.saidaSair));
    await esperarPor(() => window.location.pathname === "/gestao", "o Voltar");
  });

  it("o Voltar com a folha limpa (ou fechada) sai direto, sem pergunta", async () => {
    abrirEm("/gestao");
    navegar("/gestao/galeria");
    await abrirNaMoldura("/gestao/galeria");

    window.history.back();
    await esperarPor(() => window.location.pathname === "/gestao", "o Voltar");
    expect(pergunta()).toBeNull();
  });

  it("moderar a fila nunca regista guarda: navegar para outro destino é livre com a foto à frente", async () => {
    await abrirNaMoldura();
    await prontaParaModerar();
    expect(botaoAprovar()).toBeInTheDocument();

    await tocarNaEmenta();

    expect(pergunta()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("a guarda só existe com a folha aberta e suja: fechar a folha limpa-a", async () => {
    await abrirNaMoldura();
    await abrirSujaComLegenda();
    await tocar(botaoCancelarDaFolha());
    await tocar(botao(TEXTOS.saidaSair));

    await tocarNaEmenta();

    expect(pergunta()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("depois de enviar com sucesso, sai-se sem perguntar", async () => {
    await abrirNaMoldura();
    await abrirSujaComFoto();
    await tocar(botaoEnviarDaFolha());

    await tocarNaEmenta();

    expect(pergunta()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("um envio sem resposta fecha a folha, e a folha fechada não guarda nada: sai-se sem perguntar", async () => {
    await abrirNaMoldura();
    await abrirSujaComFoto();
    enviarFalso.mockRejectedValueOnce(erroSemResposta());
    await tocar(botaoEnviarDaFolha());
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);

    await tocarNaEmenta();

    expect(pergunta()).toBeNull();
    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("durante o envio a guarda mantém-se (a folha está aberta e a foto ainda não saiu)", async () => {
    await abrirNaMoldura();
    await abrirSujaComFoto();
    enviarFalso.mockReturnValueOnce(pendente<{ estado: "pendente" }>().promessa);
    await tocar(botaoEnviarDaFolha());

    await tocarNaEmenta();

    expect(window.location.pathname).toBe("/gestao/galeria");
  });

  it("ao desmontar, a guarda sai (nada fica registado para o ecrã seguinte)", async () => {
    await abrirNaMoldura();
    await abrirSujaComFoto();
    cleanup();

    navegarComGuarda("/gestao/ementa");

    expect(window.location.pathname).toBe("/gestao/ementa");
  });

  it("o `navegar` (401, login, «Sair») nunca é bloqueado, mesmo com a folha suja", async () => {
    await abrirNaMoldura();
    await abrirSujaComFoto();

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
    await abrirGaleria();
    expect(disparar(), "folha fechada").toBe(false);

    await abrirFolhaDeEnviar();
    expect(disparar(), "folha limpa").toBe(false);

    escreverLegenda("Noite de samba");
    expect(disparar(), "legenda escrita").toBe(true);

    escreverLegenda("");
    expect(disparar(), "legenda apagada").toBe(false);
  });

  it("a foto escolhida também previne", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    await escolherFoto();
    expect(disparar()).toBe(true);
  });

  it("a moderação não previne nada (o `POST` de moderar é um pedido, não um rascunho)", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    expect(disparar()).toBe(false);
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("depois de «Sair sem enviar», de enviar e ao desmontar volta a não prevenir", async () => {
    await abrirGaleria();
    await abrirSujaComLegenda();
    await tocar(botaoCancelarDaFolha());
    await tocar(botao(TEXTOS.saidaSair));
    expect(disparar()).toBe(false);

    await abrirSujaComFoto();
    expect(disparar()).toBe(true);
    await tocar(botaoEnviarDaFolha());
    expect(disparar(), "depois de enviar").toBe(false);

    await abrirSujaComLegenda();
    expect(disparar()).toBe(true);
    cleanup();
    expect(disparar(), "desmontado").toBe(false);
  });
});
