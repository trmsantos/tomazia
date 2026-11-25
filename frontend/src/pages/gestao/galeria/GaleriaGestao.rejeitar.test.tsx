/**
 * F4-04, decisão D2, plano 5.3 e spec 6 — rejeitar: a folha «Tem a certeza?» com a miniatura.
 *
 * Rejeitar **apaga os bytes** e não tem volta, por isso custa dois toques: «Rejeitar» da página
 * abre a folha **sem pedido nenhum**; «Cancelar», `Esc` e a cortina fecham **sem pedido**; só o
 * «Rejeitar» (perigo) da folha envia o `POST`. Aprovar continua a um toque.
 *
 * A folha é um `<dialog>` com o nome `TEXTOS.tituloRejeitar` e **não tem dourado**: o único
 * vermelho do ecrã é o «Rejeitar» de dentro dela; o «Rejeitar» da página é contorno.
 *
 * 409, 404 e «sem resposta» ao rejeitar (a folha fecha e o resultado vai para a verificação) estão
 * em `GaleriaGestao.verificar.test.tsx`, com os do aprovar, nas duas direções.
 *
 * **Deixa passar:** o foco a começar em «Cancelar» e o seu regresso ao botão da página (o
 * `<dialog>` a sério: e2e); a miniatura a `w-1/3` (e2e).
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { enderecoDaImagem } from "../../../lib/api/gestao-fotos";
import { erro401, erroDoServidor, filaDeTeste } from "../../../testes/gestao";
import {
  TEXTOS,
  abrirGaleria,
  assentar,
  aviso,
  avancar,
  botaoAprovar,
  botaoRejeitar,
  comSinal,
  folha,
  h2,
  haFolha,
  idDaImagem,
  idsDasImagens,
  imgAtual,
  imgsOcultas,
  inerte,
  linhaDeEstado,
  obterFalso,
  pendente,
  prepararApi,
  prontaParaModerar,
  aprovarFalso,
  rejeitarFalso,
  tocar,
  tocarDuasVezes,
} from "../../../testes/fotos-gestao";

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

async function abrirAFolha(): Promise<HTMLElement> {
  await abrirGaleria();
  await prontaParaModerar();
  await tocar(botaoRejeitar());
  return folha(TEXTOS.tituloRejeitar);
}

function confirmar(): HTMLElement {
  return within(folha(TEXTOS.tituloRejeitar)).getByRole("button", { name: TEXTOS.rejeitar });
}
function cancelar(): HTMLElement {
  return within(folha(TEXTOS.tituloRejeitar)).getByRole("button", { name: TEXTOS.cancelar });
}
function esc(): void {
  fireEvent(folha(TEXTOS.tituloRejeitar), new Event("cancel", { cancelable: true }));
}

describe("a folha «Tem a certeza?»", () => {
  it("«Rejeitar» da página abre a folha SEM pedido nenhum", async () => {
    await abrirAFolha();

    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(true);
    expect(rejeitarFalso).not.toHaveBeenCalled();
    expect(aprovarFalso).not.toHaveBeenCalled();
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
  });

  it("o título é a frase formal «Tem a certeza?»; o corpo diz que a foto é apagada e não se pode desfazer", async () => {
    const f = await abrirAFolha();
    expect(f).toHaveTextContent(TEXTOS.rejeitarAviso);
    expect(within(f).getByRole("heading", { name: "Tem a certeza?" })).toBeInTheDocument();
  });

  it("leva a miniatura da foto (a mesma imagem, `alt` vazio) e a linha «Enviada {quando}, por {nome}»", async () => {
    const f = await abrirAFolha();

    const miniatura = f.querySelector("img");
    expect(miniatura, "a miniatura serve para confirmar que é a foto certa").not.toBeNull();
    expect(miniatura?.getAttribute("src")).toBe(enderecoDaImagem(101));
    expect(miniatura?.getAttribute("alt")).toBe("");
    expect(f).toHaveTextContent("Enviada ontem, às 23:40, por Rita");
  });

  it("a legenda NÃO se repete na folha", async () => {
    const f = await abrirAFolha();
    expect(within(f).queryByText("Noite de samba 🎶 & amigos d'a casa")).toBeNull();
    expect(f).not.toHaveTextContent(TEXTOS.legendaNoSite);
  });

  it("dois botões: «Rejeitar» (perigo, o único vermelho) e «Cancelar» (secundário); a folha não tem dourado", async () => {
    const f = await abrirAFolha();

    expect(confirmar().className).toMatch(/bg-perigo/);
    expect(cancelar().className).not.toMatch(/bg-perigo/);
    for (const b of within(f).getAllByRole("button")) {
      expect(b.className, "o dourado confirmava uma destruição").not.toMatch(/bg-acao/);
    }
  });

  it("na página, o «Rejeitar» não é vermelho nem dourado (contorno) e o «Aprovar» é o dourado", async () => {
    await abrirGaleria();
    expect(botaoRejeitar().className).not.toMatch(/bg-perigo|bg-acao/);
    expect(botaoAprovar().className).toMatch(/bg-acao/);
  });

  it("«Cancelar»: ZERO pedidos, a folha fecha, a foto fica, sem aviso", async () => {
    await abrirAFolha();

    await tocar(cancelar());

    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(rejeitarFalso).not.toHaveBeenCalled();
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(idDaImagem(imgAtual())).toBe(101);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(aviso()).toBeNull();
  });

  it("`Esc` (o evento cancel) e a cortina (o próprio <dialog>) também fecham sem pedido", async () => {
    await abrirAFolha();
    esc();
    await assentar();
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);

    await tocar(botaoRejeitar());
    await tocar(folha(TEXTOS.tituloRejeitar));
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);

    expect(rejeitarFalso).not.toHaveBeenCalled();
    expect(idDaImagem(imgAtual())).toBe(101);
  });

  it("o botão «Fechar» da folha (do componente) também fecha sem pedido", async () => {
    const f = await abrirAFolha();
    await tocar(within(f).getByRole("button", { name: "Fechar" }));
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(rejeitarFalso).not.toHaveBeenCalled();
  });

  it("depois de cancelar pode abrir-se outra vez, e confirmar faz UM pedido", async () => {
    await abrirAFolha();
    await tocar(cancelar());
    await tocar(botaoRejeitar());

    await tocar(confirmar());

    expect(rejeitarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("a folha vale só para a foto que a abriu", () => {
  it("a fila muda com a folha aberta (outro aparelho moderou a da frente): a folha fecha e não há nenhum POST de rejeitar", async () => {
    await abrirAFolha();
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3).slice(1) });

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();

    expect(idDaImagem(imgAtual())).toBe(102);
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(rejeitarFalso).not.toHaveBeenCalled();
  });
});

describe("confirmar", () => {
  it("um POST com o id e o sinal; «A rejeitar…» (aria-busy, aria-disabled); «Cancelar» inerte; a folha NÃO fecha até chegar a resposta", async () => {
    await abrirAFolha();
    const resposta = pendente<{ id: number; estado: "rejeitada" }>();
    rejeitarFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(confirmar());

    expect(rejeitarFalso).toHaveBeenCalledTimes(1);
    expect(rejeitarFalso).toHaveBeenCalledWith(101, comSinal);
    const ocupado = within(folha(TEXTOS.tituloRejeitar)).getByRole("button", {
      name: TEXTOS.aRejeitar,
    });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    expect(cancelar()).toHaveAttribute("aria-disabled", "true");

    await tocar(cancelar());
    esc();
    await assentar();
    expect(haFolha(TEXTOS.tituloRejeitar), "nem Cancelar nem Esc fecham a meio").toBe(true);
    expect(idDaImagem(imgAtual()), "nada otimista").toBe(101);

    resposta.resolver({ id: 101, estado: "rejeitada" });
    await assentar();
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
  });

  it("um segundo toque (ou dois no mesmo instante) não faz um segundo pedido", async () => {
    await abrirAFolha();
    rejeitarFalso.mockReturnValueOnce(pendente<{ id: number; estado: "rejeitada" }>().promessa);

    await tocarDuasVezes(confirmar());

    expect(rejeitarFalso).toHaveBeenCalledTimes(1);
  });

  it("200: a folha fecha, aviso «Foto rejeitada.» (sucesso, sem «Desfazer»), avança, o foco vai ao <h2>", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    const era = imgsOcultas()[0] as HTMLImageElement;
    await tocar(botaoRejeitar());

    await tocar(confirmar());

    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(aviso()).toHaveTextContent(TEXTOS.avisoRejeitada);
    expect(screen.queryByRole("button", { name: /desfazer/i })).toBeNull();
    expect(imgAtual(), "a seguinte, o mesmo nó que estava escondido").toBe(era);
    expect(idsDasImagens()).toEqual([102, 103]);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(2));
    expect(document.activeElement).toBe(h2());
    expect(obterFalso, "sem novo GET enquanto há fotos").toHaveBeenCalledTimes(1);
  });

  it("o aviso dura 3 s", async () => {
    await abrirAFolha();
    await tocar(confirmar());
    await avancar(2_999);
    expect(aviso()).not.toBeNull();
    await avancar(1);
    expect(aviso()).toBeNull();
  });

  it("a foto nova começa inerte (o mesmo intervalo contra o duplo toque do aprovar)", async () => {
    await abrirAFolha();
    await tocar(confirmar());
    expect(inerte(botaoAprovar())).toBe(true);
    expect(inerte(botaoRejeitar())).toBe(true);
  });

  it("rejeitar a última: um GET antes do vazio; o vazio só depois dele", async () => {
    prepararApi(filaDeTeste(1));
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoRejeitar());
    const segundo = pendente<{ fotos: [] }>();
    obterFalso.mockReturnValueOnce(segundo.promessa);

    await tocar(confirmar());

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
    segundo.resolver({ fotos: [] });
    await assentar();
    expect(screen.getByText(TEXTOS.vazioTitulo)).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(TEXTOS.avisoRejeitada);
  });
});

describe("erros ao rejeitar", () => {
  it.each([
    ["5xx", () => erroDoServidor(500)],
    ["403", () => erroDoServidor(403)],
  ])(
    "%s: a folha MANTÉM-SE aberta e o erro aparece dentro dela (role=status, vermelho); a foto fica; um só pedido",
    async (_nome, erro) => {
      await abrirAFolha();
      rejeitarFalso.mockRejectedValueOnce(erro());

      await tocar(confirmar());

      expect(haFolha(TEXTOS.tituloRejeitar)).toBe(true);
      const linha = linhaDeEstado(TEXTOS.rejeitarServidor);
      expect(linha).not.toBeNull();
      expect(folha(TEXTOS.tituloRejeitar)).toContainElement(linha);
      expect(linha?.className).toMatch(/text-erro/);
      expect(confirmar()).toHaveTextContent(TEXTOS.rejeitar);
      expect(confirmar()).not.toHaveAttribute("aria-disabled", "true");
      expect(cancelar()).not.toHaveAttribute("aria-disabled", "true");
      expect(idDaImagem(imgAtual())).toBe(101);
      expect(aviso()).toBeNull();
      expect(rejeitarFalso, "nunca repete sozinho").toHaveBeenCalledTimes(1);
    },
  );

  it("a fila muda a meio do pedido (a folha fecha) e o pedido falha com 500: o erro vai para a linha de estado da página; sem outro POST", async () => {
    await abrirAFolha();
    const pedido = pendente<{ id: number; estado: "rejeitada" }>();
    rejeitarFalso.mockReturnValueOnce(pedido.promessa);
    await tocar(confirmar());
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3).slice(1) });

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);

    pedido.rejeitar(erroDoServidor(500));
    await assentar();

    const linha = linhaDeEstado(TEXTOS.rejeitarServidor);
    expect(linha).not.toBeNull();
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(rejeitarFalso).toHaveBeenCalledTimes(1);
  });

  it("depois do erro, tocar outra vez é seguro: o segundo pedido avança e fecha a folha", async () => {
    await abrirAFolha();
    rejeitarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(confirmar());

    await tocar(confirmar());

    expect(rejeitarFalso).toHaveBeenCalledTimes(2);
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(idDaImagem(imgAtual())).toBe(102);
  });

  it("cancelar depois do erro fecha a folha, e reabri-la não traz o erro de volta", async () => {
    await abrirAFolha();
    rejeitarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(confirmar());
    await tocar(cancelar());
    await tocar(botaoRejeitar());
    expect(screen.queryByText(TEXTOS.rejeitarServidor)).toBeNull();
  });

  it("401: aoPerderSessao uma vez; nada se repete", async () => {
    const sessao = await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoRejeitar());
    rejeitarFalso.mockRejectedValueOnce(erro401());

    await tocar(confirmar());

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(rejeitarFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.rejeitarServidor)).toBeNull();
  });

  it("o pedido de rejeitar NÃO aborta ao desmontar", async () => {
    await abrirAFolha();
    rejeitarFalso.mockReturnValueOnce(pendente<{ id: number; estado: "rejeitada" }>().promessa);
    await tocar(confirmar());
    const sinal = (rejeitarFalso.mock.calls[0]?.[1] as { sinal: AbortSignal }).sinal;

    cleanup();

    expect(sinal.aborted).toBe(false);
  });
});
