/**
 * F4-04, plano 4.3 e 7.2, spec 5 e 8.3 — aprovar e passar à foto seguinte (o «Feito quando»:
 * **aprovar mostra «Foto aprovada» e passa à seguinte**), o intervalo contra o duplo toque, a
 * pré-carregada que passa a atual (o mesmo nó), o foco e o anúncio, e aprovar a última.
 *
 * **O risco número um deste ecrã** é aprovar sem querer a foto que ainda não se viu (a seguinte
 * aparece debaixo do dedo): os botões ficam inertes (`aria-disabled`) até a imagem **carregar** e
 * até passarem `INTERVALO_CONTRA_DUPLO_TOQUE_MS` (700) desde o mais tardio de «ficou visível» e
 * «carregou». O relógio é simulado (`avancar`): nenhum teste espera 700 ms a sério.
 *
 * Nada é otimista: a foto só avança depois da resposta. Sem «Desfazer» (o backend não tem como).
 *
 * **Deixa passar:** o `<img>` a pedir à rede uma só vez (e2e, caso 3).
 */
import { cleanup, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { erro401, erroDoServidor, filaDeTeste, fotoPendenteDeTeste } from "../../../testes/gestao";
import {
  INTERVALO_CONTRA_DUPLO_TOQUE_MS as INTERVALO,
  TEXTOS,
  abrirGaleria,
  aprovarFalso,
  assentar,
  aviso,
  avancar,
  botaoAprovar,
  botaoRejeitar,
  carregarImagem,
  comSinal,
  h2,
  haBotao,
  haFolha,
  idDaImagem,
  idsDasImagens,
  imagensDaPagina,
  imgAtual,
  imgsOcultas,
  inerte,
  linhaDeEstado,
  obterFalso,
  pendente,
  prepararApi,
  prontaParaModerar,
  rejeitarFalso,
  tocar,
  tocarDuasVezes,
} from "../../../testes/fotos-gestao";

vi.mock("../../../lib/api/gestao-fotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/gestao-fotos")>()),
  obterFilaDeModeracao: vi.fn(),
  aprovarFoto: vi.fn(),
  rejeitarFoto: vi.fn(),
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

describe("o intervalo contra o duplo toque (spec 5.2)", () => {
  it("a imagem ainda não carregou: os dois botões inertes, passe o tempo que passar", async () => {
    await abrirGaleria();
    await avancar(60_000);
    expect(inerte(botaoAprovar())).toBe(true);
    expect(inerte(botaoRejeitar())).toBe(true);
  });

  it("carregou mas ainda não passaram 700 ms: inertes; ao 700.º milissegundo ficam ativos", async () => {
    await abrirGaleria();
    await carregarImagem(imgAtual());

    await avancar(INTERVALO - 1);
    expect(inerte(botaoAprovar()), "aos 699 ms").toBe(true);
    expect(inerte(botaoRejeitar()), "aos 699 ms").toBe(true);

    await avancar(1);
    expect(inerte(botaoAprovar()), "aos 700 ms").toBe(false);
    expect(inerte(botaoRejeitar()), "aos 700 ms").toBe(false);
  });

  it("a imagem carrega tarde: os 700 ms contam desde que carregou, não desde que apareceu", async () => {
    await abrirGaleria();
    await avancar(1_000);
    await carregarImagem(imgAtual());

    await avancar(INTERVALO - 1);
    expect(inerte(botaoAprovar())).toBe(true);
    await avancar(1);
    expect(inerte(botaoAprovar())).toBe(false);
  });

  it("um toque num botão inerte não faz nada: nenhum pedido, nenhuma folha", async () => {
    await abrirGaleria();
    await carregarImagem(imgAtual());
    await avancar(INTERVALO - 1);

    await tocar(botaoAprovar());
    await tocar(botaoRejeitar());

    expect(aprovarFalso).not.toHaveBeenCalled();
    expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
    expect(aviso()).toBeNull();
  });

  it("o botão inerte continua focável (aria-disabled, nunca `disabled`)", async () => {
    await abrirGaleria();
    expect(botaoAprovar()).not.toBeDisabled();
    botaoAprovar().focus();
    expect(document.activeElement).toBe(botaoAprovar());
  });

  it("DUPLO TOQUE depois de aprovar: a foto nova aparece debaixo do dedo e o segundo toque não a aprova", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoAprovar());
    expect(aprovarFalso).toHaveBeenCalledTimes(1);

    // A seguinte já está visível; o dedo ainda lá está. Dois toques seguidos dentro do intervalo.
    await tocarDuasVezes(botaoAprovar());

    expect(aprovarFalso, "só a primeira foi aprovada").toHaveBeenCalledTimes(1);
    expect(aprovarFalso).toHaveBeenCalledWith(101, comSinal);
    expect(idDaImagem(imgAtual())).toBe(102);
  });

  it("a seguinte PRÉ-CARREGADA conta os 700 ms desde que ficou visível (não precisa de novo `load`)", async () => {
    await abrirGaleria();
    await carregarImagem(imgsOcultas()[0] as HTMLImageElement); // a seguinte já descarregou, escondida
    await prontaParaModerar();
    await tocar(botaoAprovar());

    expect(inerte(botaoAprovar()), "acabou de aparecer").toBe(true);
    await avancar(INTERVALO - 1);
    expect(inerte(botaoAprovar()), "aos 699 ms").toBe(true);
    await avancar(1);
    expect(inerte(botaoAprovar()), "aos 700 ms, sem novo load").toBe(false);
    expect(inerte(botaoRejeitar())).toBe(false);
  });

  it("a seguinte que NÃO tinha carregado: inerte até ao `load`, e só 700 ms depois fica ativa", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoAprovar());

    await avancar(60_000);
    expect(inerte(botaoAprovar()), "sem imagem não se aprova").toBe(true);

    await carregarImagem(imgAtual());
    expect(inerte(botaoAprovar())).toBe(true);
    await avancar(INTERVALO);
    expect(inerte(botaoAprovar())).toBe(false);
  });

  it("dois toques no mesmo instante em Aprovar (já ativo) → um só pedido", async () => {
    await abrirGaleria();
    await prontaParaModerar();

    await tocarDuasVezes(botaoAprovar());

    expect(aprovarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("aprovar (o «Feito quando»)", () => {
  it("um POST com o id e o sinal; «A aprovar…» (aria-busy) e os dois inertes; a foto NÃO avança antes da resposta", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    const resposta = pendente<{ id: number; estado: "aprovada" }>();
    aprovarFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(botaoAprovar());

    expect(aprovarFalso).toHaveBeenCalledTimes(1);
    expect(aprovarFalso).toHaveBeenCalledWith(101, comSinal);
    const ocupado = screen.getByRole("button", { name: TEXTOS.aAprovar });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    expect(inerte(botaoRejeitar())).toBe(true);
    expect(idDaImagem(imgAtual()), "nada otimista").toBe(101);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(aviso()).toBeNull();

    await tocar(ocupado);
    expect(aprovarFalso, "um segundo toque não faz um segundo pedido").toHaveBeenCalledTimes(1);

    resposta.resolver({ id: 101, estado: "aprovada" });
    await assentar();
    expect(idDaImagem(imgAtual())).toBe(102);
  });

  it("200: aviso «Foto aprovada. Já aparece no site.» (sucesso), sem «Desfazer», e a seguinte é a atual", async () => {
    await abrirGaleria();
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(aviso()).toHaveTextContent(TEXTOS.avisoAprovada);
    expect(aviso()?.textContent ?? "").toMatch(/Foto aprovada/);
    expect(haBotao(/desfazer/i), "o backend não tem como desfazer").toBe(false);
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(screen.queryByText("Noite de samba 🎶 & amigos d'a casa")).toBeNull();
  });

  it("a seguinte é O MESMO NÓ <img> que estava escondido (a imagem já descarregada); a nova seguinte monta-se escondida", async () => {
    await abrirGaleria();
    const era = imgsOcultas()[0] as HTMLImageElement;
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(imgAtual(), "mesma `key`, mesmo nó: só lhe sai o `hidden`").toBe(era);
    expect(imgAtual().hidden).toBe(false);
    expect(imgAtual().getAttribute("alt")).toBe("Foto enviada hoje, às 00:30");
    expect(imgsOcultas().map(idDaImagem)).toEqual([103]);
    expect(imgsOcultas()[0]?.getAttribute("alt")).toBe("");
    expect(idsDasImagens(), "a aprovada já não está no DOM").toEqual([102, 103]);
  });

  it("só uma seguinte, nunca a fila inteira: com 5 fotos, depois de aprovar há duas imagens", async () => {
    prepararApi(filaDeTeste(5));
    await abrirGaleria();
    expect(idsDasImagens()).toEqual([101, 102]);
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(idsDasImagens()).toEqual([102, 103]);
    expect(imagensDaPagina()).toHaveLength(2);
  });

  it("a contagem desce e NÃO há novo GET (a fila local passa à seguinte sem ir ao servidor)", async () => {
    await abrirGaleria();
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(2));
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("o foco vai ao <h2> da fila e NUNCA a Aprovar nem a Rejeitar da foto seguinte", async () => {
    await abrirGaleria();
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(document.activeElement).toBe(h2());
    expect(document.activeElement).not.toBe(botaoAprovar());
    expect(document.activeElement).not.toBe(botaoRejeitar());
  });

  it("os botões da foto nova voltam ao verbo «Aprovar» (inertes por causa do intervalo) e a linha é a da foto nova", async () => {
    await abrirGaleria();
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(botaoAprovar()).toHaveTextContent(TEXTOS.aprovar);
    expect(inerte(botaoAprovar())).toBe(true);
    expect(screen.getByText("Enviada hoje, às 00:30")).toBeInTheDocument();
    expect(screen.queryByText(/por Rita/)).toBeNull();
  });

  it("o aviso dura 3 s (não os 5 do componente): aos 2999 ms ainda está, aos 3000 sai", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoAprovar());

    await avancar(2_999);
    expect(aviso()).not.toBeNull();
    await avancar(1);
    expect(aviso()).toBeNull();
  });

  it("três aprovadas seguidas: cada uma um pedido, na ordem do servidor; a contagem 3 → 2 → 1; só no fim um GET", async () => {
    await abrirGaleria();
    for (const [id, falta] of [
      [101, 2],
      [102, 1],
    ] as const) {
      await prontaParaModerar();
      await tocar(botaoAprovar());
      expect(aprovarFalso).toHaveBeenLastCalledWith(id, comSinal);
      expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(falta));
    }
    expect(obterFalso, "enquanto há fotos locais não se vai ao servidor").toHaveBeenCalledTimes(1);
    await prontaParaModerar();

    await tocar(botaoAprovar());

    expect(aprovarFalso).toHaveBeenCalledTimes(3);
    expect(aprovarFalso).toHaveBeenLastCalledWith(103, comSinal);
    expect(obterFalso, "aprovar a última faz um GET antes do vazio").toHaveBeenCalledTimes(2);
  });
});

describe("aprovar a última: o vazio só depois de um GET (regra 10)", () => {
  async function ateAUltima(): Promise<void> {
    prepararApi(filaDeTeste(1));
    await abrirGaleria();
    await prontaParaModerar();
  }

  it("com o GET ainda a correr: nenhum vazio, só o esqueleto sem texto; só depois do 200 vazio aparece «Não há fotos à espera.»", async () => {
    await ateAUltima();
    const segundo = pendente<{ fotos: [] }>();
    obterFalso.mockReturnValueOnce(segundo.promessa);

    await tocar(botaoAprovar());

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(TEXTOS.vazioTitulo), "ainda não se sabe").toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(imagensDaPagina()).toEqual([]);

    segundo.resolver({ fotos: [] });
    await assentar();

    expect(screen.getByText(TEXTOS.vazioTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.vazioLinha)).toBeInTheDocument();
    expect(h2()).toHaveTextContent(new RegExp(`^${TEXTOS.fotosAEspera}$`));
    expect(aviso()).toHaveTextContent(TEXTOS.avisoAprovada);
  });

  it("o foco vai ao título do estado vazio (tabindex -1), não ao <body>", async () => {
    await ateAUltima();
    obterFalso.mockResolvedValueOnce({ fotos: [] });

    await tocar(botaoAprovar());

    const titulo = screen.getByText(TEXTOS.vazioTitulo);
    expect(document.activeElement).toBe(titulo.closest("[tabindex]") ?? titulo);
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("se o GET trouxer uma foto nova (chegou entretanto), mostra-a — não o vazio", async () => {
    await ateAUltima();
    obterFalso.mockResolvedValueOnce({ fotos: [fotoPendenteDeTeste({ id: 110 })] });

    await tocar(botaoAprovar());

    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
    expect(idDaImagem(imgAtual())).toBe(110);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(1));
  });

  it("se o GET falhar é o erro de carregar (e a foto aprovada NÃO volta); o aviso de aprovada fica", async () => {
    await ateAUltima();
    obterFalso.mockRejectedValue(erroDoServidor(500));

    await tocar(botaoAprovar());

    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
    expect(imagensDaPagina()).toEqual([]);
    expect(aviso()).toHaveTextContent(TEXTOS.avisoAprovada);
  });
});

describe("erros ao aprovar", () => {
  it.each([
    ["5xx", () => erroDoServidor(500)],
    ["403", () => erroDoServidor(403)],
  ])(
    "%s: «Não consegui aprovar. O problema é nosso…» junto dos botões, a foto fica e os botões voltam logo; nunca «não foi aprovada»",
    async (_nome, erro) => {
      await abrirGaleria();
      await prontaParaModerar();
      aprovarFalso.mockRejectedValueOnce(erro());

      await tocar(botaoAprovar());

      const linha = linhaDeEstado(TEXTOS.aprovarServidor);
      expect(linha, "uma linha de estado junto dos botões").not.toBeNull();
      expect(linha?.className).toMatch(/text-erro/);
      expect(aviso()).toBeNull();
      expect(idDaImagem(imgAtual())).toBe(101);
      expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
      expect(inerte(botaoAprovar())).toBe(false);
      expect(inerte(botaoRejeitar())).toBe(false);
      expect(botaoAprovar()).toHaveTextContent(TEXTOS.aprovar);
      expect(obterFalso, "não recarrega sozinho").toHaveBeenCalledTimes(1);
      expect(aprovarFalso, "nunca repete sozinho").toHaveBeenCalledTimes(1);
    },
  );

  it("tocar outra vez depois do erro é seguro e funciona: segundo pedido, avança", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    aprovarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(botaoAprovar());

    await tocar(botaoAprovar());

    expect(aprovarFalso).toHaveBeenCalledTimes(2);
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(screen.queryByText(TEXTOS.aprovarServidor), "o erro da foto anterior sai").toBeNull();
  });

  it("401: aoPerderSessao uma vez; nada se repete; nenhuma frase de erro", async () => {
    const sessao = await abrirGaleria();
    await prontaParaModerar();
    aprovarFalso.mockRejectedValueOnce(erro401());

    await tocar(botaoAprovar());

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(aprovarFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.aprovarServidor)).toBeNull();
    expect(aviso()).toBeNull();
  });

  it("o pedido de moderar NÃO aborta ao desmontar (a leitura sim): uma aprovação a meio chega ao fim", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    aprovarFalso.mockReturnValueOnce(pendente<{ id: number; estado: "aprovada" }>().promessa);
    await tocar(botaoAprovar());
    const sinal = (aprovarFalso.mock.calls[0]?.[1] as { sinal: AbortSignal }).sinal;

    cleanup();

    expect(sinal.aborted).toBe(false);
  });

  it("nada se faz à foto seguinte quando a atual falha: a seguinte continua escondida e inalterada", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    aprovarFalso.mockRejectedValueOnce(erroDoServidor(500));

    await tocar(botaoAprovar());

    expect(imgsOcultas().map(idDaImagem)).toEqual([102]);
  });

  it("aprovar não toca em rejeitar: nenhuma chamada a rejeitarFoto", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoAprovar());
    expect(rejeitarFalso).not.toHaveBeenCalled();
  });
});
