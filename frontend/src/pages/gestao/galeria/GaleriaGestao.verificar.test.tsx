/**
 * F4-04, plano 5.4 a 5.6, decisão D3 e spec 9 — quando um pedido não corre bem: o 409 («outro
 * aparelho moderou-a»), o 404, a mutação **sem resposta** («não sei») e a imagem que não carrega.
 *
 * **Regra 10, o coração da tarefa:**
 *
 *  - **Sem resposta nunca diz «aprovada» nem «não aprovada»**: verifica pela fila
 *    (`GET /gestao/fotos`: a foto continua lá → nada aconteceu) e pela galeria pública
 *    (`GET /galeria`: o `id` lá → aprovada; fora das duas → rejeitada); **nunca repete o `POST`**
 *    sozinho; «Verificar outra vez» repete **só a verificação**.
 *  - **O `onError` da imagem não decide** (não distingue 401, 404 e rede): dispara a verificação
 *    pela fila. Só uma foto que a fila ainda lista e cuja imagem volta a falhar é «não se consegue
 *    mostrar» (D3: **Aprovar inerte, Rejeitar ativo**; a folha de rejeitar sem miniatura).
 *  - **O 409 é informação, não erro**: sem vermelho, e diz a verdade pelo `resolverDesfecho`.
 *
 * As frases sobre a foto **anterior** (a que o dono tocou) vão na linha de estado, não no aviso: o
 * aviso obriga a «Feito.» ou «Erro.» e um 409 não é nenhuma das duas. O aviso só diz o que o dono
 * pediu **e** aconteceu.
 *
 * **Deixa passar:** o `<img>` a pedir à rede (e2e, casos 7 e 8).
 */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { enderecoDaImagem } from "../../../lib/api/gestao-fotos";
import {
  erro401,
  erro404,
  erro409FotoJaModerada,
  erroDoServidor,
  erroSemResposta,
  filaDeTeste,
} from "../../../testes/gestao";
import {
  TEXTOS,
  abrirGaleria,
  aprovarFalso,
  assentar,
  avancar,
  aviso,
  botao,
  botaoAprovar,
  botaoRejeitar,
  comSinal,
  falharImagem,
  ficarPendenteAteAbortar,
  filaSem,
  folha,
  galeriaFalsa,
  carregarImagem,
  h2,
  haBotao,
  haFolha,
  haImgAtual,
  idDaImagem,
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
  INTERVALO_CONTRA_DUPLO_TOQUE_MS,
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

type Pedido = "aprovar" | "rejeitar";
const PEDIDOS: readonly Pedido[] = ["aprovar", "rejeitar"];

/** Tudo o que depende do pedido: o que se toca, o que se diz. */
const POR_PEDIDO = {
  aprovar: {
    falso: () => aprovarFalso,
    aviso: TEXTOS.avisoAprovada,
    verificar: TEXTOS.verificarAprovada,
    continua: TEXTOS.continuaAprovar,
    semConfirmar: TEXTOS.semConfirmarAprovada,
    /** Se o resultado for o contrário do pedido: a frase da linha de estado. */
    contrariada: TEXTOS.outroAparelhoRejeitada,
    /** O resultado que coincide com o pedido: na galeria? */
    coincideNaGaleria: true,
  },
  rejeitar: {
    falso: () => rejeitarFalso,
    aviso: TEXTOS.avisoRejeitada,
    verificar: TEXTOS.verificarRejeitada,
    continua: TEXTOS.continuaRejeitar,
    semConfirmar: TEXTOS.semConfirmarRejeitada,
    contrariada: TEXTOS.outroAparelhoAprovada,
    coincideNaGaleria: false,
  },
} as const;

/** A fila a seguir ao pedido: a 101 já não está pendente (nem aprovada nem rejeitada pelo ecrã). */
const SEM_101 = (): ReturnType<typeof filaSem> => filaSem(101).slice(0, 2);

function naGaleria(...ids: number[]): {
  fotos: Array<{ id: number; ficheiro: string; descricao: null }>;
} {
  return { fotos: ids.map((id) => ({ id, ficheiro: `foto-${String(id)}.webp`, descricao: null })) };
}

async function pedir(pedido: Pedido): Promise<void> {
  await prontaParaModerar();
  if (pedido === "aprovar") {
    await tocar(botaoAprovar());
    return;
  }
  await tocar(botaoRejeitar());
  await tocar(within(folha(TEXTOS.tituloRejeitar)).getByRole("button", { name: TEXTOS.rejeitar }));
}

function semVermelho(el: HTMLElement | null): void {
  expect(el, "a frase existe").not.toBeNull();
  expect(el?.className ?? "", "é informação, não um erro: sem vermelho").not.toMatch(/text-erro/);
  expect(el?.getAttribute("role"), "nem um alerta").not.toBe("alert");
}

describe.each(PEDIDOS)("409 ao %s: outro aparelho moderou-a (9.3)", (pedido) => {
  const P = POR_PEDIDO[pedido];

  beforeEach(() => {
    P.falso().mockRejectedValue(erro409FotoJaModerada());
    // O servidor diz o que aconteceu: a 101 já não está na fila.
    obterFalso.mockImplementation(() => Promise.resolve({ fotos: structuredClone(SEM_101()) }));
  });

  it("resolve pela fila e pela galeria (um GET de cada), sem repetir o POST", async () => {
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3) });
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockResolvedValue(naGaleria(P.coincideNaGaleria ? 101 : 999));
    await abrirGaleria();

    await pedir(pedido);

    expect(P.falso()).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(galeriaFalsa).toHaveBeenCalledTimes(1);
    expect(galeriaFalsa).toHaveBeenCalledWith(comSinal);
  });

  it("o que aconteceu coincide com o que o dono pediu: o aviso de sucesso (é verdade), sem frase de «outro aparelho», e avança", async () => {
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3) });
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockResolvedValue(naGaleria(P.coincideNaGaleria ? 101 : 999));
    await abrirGaleria();

    await pedir(pedido);

    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(aviso()).toHaveTextContent(P.aviso);
    expect(screen.queryByText(/noutro aparelho/)).toBeNull();
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(2));
    expect(document.activeElement).toBe(h2());
  });

  it("o que aconteceu contraria o pedido: uma linha de estado «A foto anterior já tinha sido … noutro aparelho.» SEM vermelho; sem aviso; avança", async () => {
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3) });
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockResolvedValue(naGaleria(P.coincideNaGaleria ? 999 : 101));
    await abrirGaleria();

    await pedir(pedido);

    semVermelho(linhaDeEstado(P.contrariada));
    expect(linhaDeEstado(P.contrariada)?.getAttribute("role")).toBe("status");
    expect(aviso(), "o aviso exige «Feito.» ou «Erro.» e isto não é nenhuma das duas").toBeNull();
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(document.activeElement).toBe(h2());
    if (pedido === "rejeitar") expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
  });

  it("a linha de estado da foto anterior fica até à próxima ação (não se apaga sozinha)", async () => {
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3) });
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockResolvedValue(naGaleria(P.coincideNaGaleria ? 999 : 101));
    await abrirGaleria();
    await pedir(pedido);

    await avancar(60_000);

    expect(linhaDeEstado(P.contrariada)).not.toBeNull();
  });

  it("a verificação (fila ou galeria) com 401 leva ao login, uma vez", async () => {
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3) });
    obterFalso.mockRejectedValueOnce(erro401());
    const sessao = await abrirGaleria();

    await pedir(pedido);

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(P.falso()).toHaveBeenCalledTimes(1);
  });

  it("nunca é uma frase de erro: nenhum «Não consegui» nem «O problema é nosso»", async () => {
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3) });
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockResolvedValue(naGaleria(101));
    await abrirGaleria();

    await pedir(pedido);

    expect(document.body.textContent).not.toMatch(/Não consegui|O problema é nosso/);
  });
});

describe.each(PEDIDOS)("404 ao %s: a foto já não existe (9.2)", (pedido) => {
  const P = POR_PEDIDO[pedido];

  it("«A foto anterior já não existia.», sai da fila, passa à seguinte e recarrega em silêncio", async () => {
    await abrirGaleria();
    P.falso().mockRejectedValueOnce(erro404("foto_nao_encontrada"));
    obterFalso.mockResolvedValueOnce({ fotos: filaSem(101).slice(0, 2) });

    await pedir(pedido);

    expect(linhaDeEstado(TEXTOS.jaNaoExistia)?.getAttribute("role")).toBe("status");
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(2));
    expect(obterFalso, "uma recarga silenciosa").toHaveBeenCalledTimes(2);
    expect(document.querySelector('[aria-busy="true"]'), "sem esqueleto").toBeNull();
    expect(P.falso()).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
    if (pedido === "rejeitar") expect(haFolha(TEXTOS.tituloRejeitar)).toBe(false);
  });

  it("a recarga traz fotos novas: ficam no fim; a que a seguinte já era continua a atual", async () => {
    await abrirGaleria();
    P.falso().mockRejectedValueOnce(erro404("foto_nao_encontrada"));
    obterFalso.mockResolvedValueOnce({ fotos: filaSem(101) }); // 102, 103, 104, 105

    await pedir(pedido);

    expect(idDaImagem(imgAtual())).toBe(102);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(4));
  });
});

describe.each(PEDIDOS)("sem resposta ao %s: «não sei», nunca reenviar sozinho (9.4)", (pedido) => {
  const P = POR_PEDIDO[pedido];

  beforeEach(() => {
    P.falso().mockRejectedValue(erroSemResposta());
  });

  it("um só POST; logo a seguir: «Não consegui confirmar se a foto ficou …. A verificar…» (role=status) e os dois botões inertes", async () => {
    await abrirGaleria();
    const verificacao = pendente<{ fotos: ReturnType<typeof filaDeTeste> }>();
    obterFalso.mockReturnValueOnce(verificacao.promessa);

    await pedir(pedido);

    expect(P.falso()).toHaveBeenCalledTimes(1);
    expect(linhaDeEstado(P.verificar)?.getAttribute("role")).toBe("status");
    expect(inerte(botaoAprovar())).toBe(true);
    expect(inerte(botaoRejeitar())).toBe(true);
    // Enquanto não se sabe, não se diz nada como facto.
    expect(aviso()).toBeNull();
    expect(screen.queryByText(P.continua)).toBeNull();
    expect(screen.queryByText(TEXTOS.avisoAprovada)).toBeNull();
    expect(screen.queryByText(TEXTOS.avisoRejeitada)).toBeNull();
    expect(idDaImagem(imgAtual()), "a foto não avança sem saber").toBe(101);
    if (pedido === "rejeitar") {
      expect(haFolha(TEXTOS.tituloRejeitar), "a folha fecha e entra a verificação").toBe(false);
    }
  });

  it("o prazo: sem resposta passados 10 s é «sem resposta» (e não antes)", async () => {
    await abrirGaleria();
    P.falso().mockReset();
    P.falso().mockImplementation(ficarPendenteAteAbortar);
    const verificacao = pendente<{ fotos: ReturnType<typeof filaDeTeste> }>();
    obterFalso.mockReturnValueOnce(verificacao.promessa);
    await pedir(pedido);
    await avancar(9_999);
    expect(screen.queryByText(P.verificar)).toBeNull();

    await avancar(1);

    expect(screen.getByText(P.verificar)).toBeInTheDocument();
    expect(P.falso()).toHaveBeenCalledTimes(1);
  });

  it("a fila ainda lista a foto: nada aconteceu — «Não consegui …. Verifica a ligação e tenta outra vez.» e os botões voltam", async () => {
    await abrirGaleria();

    await pedir(pedido);

    expect(screen.getByText(P.continua)).toBeInTheDocument();
    expect(screen.queryByText(P.verificar)).toBeNull();
    expect(idDaImagem(imgAtual())).toBe(101);
    expect(inerte(botaoAprovar())).toBe(false);
    expect(inerte(botaoRejeitar())).toBe(false);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(galeriaFalsa, "a foto está na fila: não há que ir à galeria").not.toHaveBeenCalled();
    expect(P.falso(), "nunca repete sozinho").toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
  });

  it("depois de «a foto continua», tocar de novo é SEGURO: segundo pedido, que desta vez corre bem", async () => {
    await abrirGaleria();
    await pedir(pedido);
    P.falso().mockReset();
    P.falso().mockImplementation((id) =>
      Promise.resolve({ id, estado: pedido === "aprovar" ? "aprovada" : "rejeitada" }),
    );

    if (pedido === "aprovar") await tocar(botaoAprovar());
    else {
      await tocar(botaoRejeitar());
      await tocar(
        within(folha(TEXTOS.tituloRejeitar)).getByRole("button", { name: TEXTOS.rejeitar }),
      );
    }

    expect(P.falso()).toHaveBeenCalledTimes(1);
    expect(aviso()).toHaveTextContent(P.aviso);
    expect(idDaImagem(imgAtual())).toBe(102);
  });

  it.each([
    ["coincide com o pedido", true],
    ["contraria o pedido", false],
  ])(
    "a foto já não está e o resultado %s: diz o que aconteceu de verdade e avança",
    async (_nome, coincide) => {
      await abrirGaleria();
      obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
      // `coincide`: o que ficou é o que o dono pediu. Aprovada ⇔ está na galeria.
      const ficouAprovada = pedido === "aprovar" ? coincide : !coincide;
      galeriaFalsa.mockResolvedValue(naGaleria(ficouAprovada ? 101 : 999));

      await pedir(pedido);

      expect(galeriaFalsa).toHaveBeenCalledTimes(1);
      expect(P.falso(), "nunca repete").toHaveBeenCalledTimes(1);
      if (coincide) {
        expect(aviso()).toHaveTextContent(P.aviso);
        expect(screen.queryByText(/noutro aparelho/)).toBeNull();
      } else {
        semVermelho(linhaDeEstado(P.contrariada));
        expect(aviso()).toBeNull();
      }
      expect(idDaImagem(imgAtual())).toBe(102);
    },
  );

  it("a verificação também falha (a fila): «Não consegui confirmar … toca em Verificar outra vez.» + «Verificar outra vez»; Aprovar e Rejeitar inertes", async () => {
    await abrirGaleria();
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    await pedir(pedido);

    expect(screen.getByText(P.semConfirmar)).toBeInTheDocument();
    expect(botao(TEXTOS.verificarOutraVez)).toBeInTheDocument();
    expect(inerte(botaoAprovar())).toBe(true);
    expect(inerte(botaoRejeitar())).toBe(true);
    expect(screen.queryByText(P.verificar)).toBeNull();
    expect(aviso()).toBeNull();
    expect(P.falso()).toHaveBeenCalledTimes(1);
  });

  it("«Verificar outra vez» repete a VERIFICAÇÃO e nunca o POST (contar pedidos); depois diz o resultado", async () => {
    await abrirGaleria();
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await pedir(pedido);
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockResolvedValue(naGaleria(P.coincideNaGaleria ? 101 : 999));

    await tocar(botao(TEXTOS.verificarOutraVez));

    expect(obterFalso).toHaveBeenCalledTimes(3);
    expect(P.falso(), "repetir só a verificação").toHaveBeenCalledTimes(1);
    expect(aviso()).toHaveTextContent(P.aviso);
    expect(haBotao(TEXTOS.verificarOutraVez)).toBe(false);
    expect(idDaImagem(imgAtual())).toBe(102);
  });

  it("«Verificar outra vez» que volta a falhar continua inerte e sem POST", async () => {
    await abrirGaleria();
    obterFalso.mockRejectedValue(erroSemResposta()); // a leitura inicial já passou
    await pedir(pedido);

    await tocar(botao(TEXTOS.verificarOutraVez));
    await tocar(botao(TEXTOS.verificarOutraVez));

    expect(P.falso()).toHaveBeenCalledTimes(1);
    expect(screen.getByText(P.semConfirmar)).toBeInTheDocument();
    expect(inerte(botaoAprovar())).toBe(true);
  });

  it("a fila diz que a foto saiu mas a galeria falha: também «Verificar outra vez», sem POST; repetir resolve", async () => {
    await abrirGaleria();
    obterFalso.mockResolvedValue({ fotos: SEM_101() });
    galeriaFalsa.mockRejectedValueOnce(erroSemResposta());
    await pedir(pedido);
    expect(screen.getByText(P.semConfirmar)).toBeInTheDocument();
    expect(botao(TEXTOS.verificarOutraVez)).toBeInTheDocument();
    expect(aviso()).toBeNull();
    galeriaFalsa.mockResolvedValue(naGaleria(P.coincideNaGaleria ? 101 : 999));

    await tocar(botao(TEXTOS.verificarOutraVez));

    expect(P.falso()).toHaveBeenCalledTimes(1);
    expect(aviso()).toHaveTextContent(P.aviso);
    expect(idDaImagem(imgAtual())).toBe(102);
  });

  it("401 na verificação (a fila) leva ao login, uma vez", async () => {
    const sessao = await abrirGaleria();
    obterFalso.mockRejectedValueOnce(erro401());

    await pedir(pedido);

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(P.falso()).toHaveBeenCalledTimes(1);
  });

  it("401 na verificação (a galeria) leva ao login, uma vez", async () => {
    const sessao = await abrirGaleria();
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });
    galeriaFalsa.mockRejectedValueOnce(erro401());

    await pedir(pedido);

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(P.falso()).toHaveBeenCalledTimes(1);
  });
});

describe("a imagem não carrega: o `onError` NÃO decide, dispara a verificação (9.5)", () => {
  it("o erro da imagem: «A verificar a foto…» (role=status), os dois botões inertes, UM GET à fila; nada se conclui enquanto não responde", async () => {
    await abrirGaleria();
    const verificacao = pendente<{ fotos: ReturnType<typeof filaDeTeste> }>();
    obterFalso.mockReturnValueOnce(verificacao.promessa);

    await falharImagem(imgAtual());

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(obterFalso).toHaveBeenLastCalledWith(comSinal);
    expect(linhaDeEstado(TEXTOS.aVerificarFoto)?.getAttribute("role")).toBe("status");
    expect(inerte(botaoAprovar())).toBe(true);
    expect(inerte(botaoRejeitar())).toBe(true);
    expect(screen.queryByText(TEXTOS.fotoNaoSeMostra), "o onError sozinho não decide").toBeNull();
    expect(screen.queryByText(TEXTOS.fotoSemLigacao)).toBeNull();
    expect(screen.queryByText(TEXTOS.jaModerada)).toBeNull();
  });

  it("401 na verificação: aoPerderSessao uma vez", async () => {
    const sessao = await abrirGaleria();
    obterFalso.mockRejectedValueOnce(erro401());

    await falharImagem(imgAtual());

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  describe("sem rede na verificação", () => {
    async function ateAoErroDeRede(): Promise<HTMLImageElement> {
      await abrirGaleria();
      const era = imgAtual();
      obterFalso.mockRejectedValueOnce(erroSemResposta());
      await falharImagem(era);
      return era;
    }

    it("«Não consegui mostrar esta foto. Verifica a ligação.» no sítio da imagem + «Tentar outra vez»; NUNCA o ícone de imagem partida; botões inertes", async () => {
      await ateAoErroDeRede();

      expect(screen.getByText(TEXTOS.fotoSemLigacao)).toBeInTheDocument();
      expect(botao(TEXTOS.tentarOutraVez)).toBeInTheDocument();
      expect(haImgAtual(), "o <img> sai e entra o texto").toBe(false);
      expect(inerte(botaoAprovar())).toBe(true);
      expect(inerte(botaoRejeitar())).toBe(true);
      expect(screen.queryByText(TEXTOS.fotoNaoSeMostra)).toBeNull();
    });

    it("a seguinte não é afetada: continua escondida e no DOM", async () => {
      await ateAoErroDeRede();
      expect(imgsOcultas().map(idDaImagem)).toEqual([102]);
    });

    it("«Tentar outra vez» remonta o <img> (um nó novo, com a mesma imagem) e não faz nenhum POST", async () => {
      const era = await ateAoErroDeRede();

      await tocar(botao(TEXTOS.tentarOutraVez));

      expect(haImgAtual()).toBe(true);
      expect(imgAtual(), "uma `key` nova: o `no-store` faz o pedido de novo").not.toBe(era);
      expect(imgAtual().getAttribute("src")).toBe(enderecoDaImagem(101));
      expect(screen.queryByText(TEXTOS.fotoSemLigacao)).toBeNull();
      expect(aprovarFalso).not.toHaveBeenCalled();
      expect(rejeitarFalso).not.toHaveBeenCalled();
    });

    it("se a imagem remontada carregar, tudo volta ao normal (700 ms depois do `load`)", async () => {
      await ateAoErroDeRede();
      await tocar(botao(TEXTOS.tentarOutraVez));
      expect(inerte(botaoAprovar())).toBe(true);

      await carregarImagem(imgAtual());
      await avancar(INTERVALO_CONTRA_DUPLO_TOQUE_MS);

      expect(inerte(botaoAprovar())).toBe(false);
      expect(inerte(botaoRejeitar())).toBe(false);
    });
  });

  it("a foto já não está na fila: «A foto anterior já tinha sido aprovada ou rejeitada.» e avança", async () => {
    await abrirGaleria();
    obterFalso.mockResolvedValueOnce({ fotos: SEM_101() });

    await falharImagem(imgAtual());

    expect(linhaDeEstado(TEXTOS.jaModerada)?.getAttribute("role")).toBe("status");
    expect(idDaImagem(imgAtual())).toBe(102);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(2));
    expect(aviso()).toBeNull();
    expect(screen.queryByText(TEXTOS.fotoNaoSeMostra)).toBeNull();
  });

  describe("a foto continua pendente: tenta a imagem uma vez mais e, se voltar a falhar, só se pode rejeitar (D3)", () => {
    async function ateD3(): Promise<void> {
      await abrirGaleria();
      await falharImagem(imgAtual()); // a fila ainda a lista (o GET por omissão devolve as três)
      expect(haImgAtual(), "a segunda tentativa: o <img> volta").toBe(true);
      await falharImagem(imgAtual());
    }

    it("uma vez mais: depois da verificação o <img> volta (nó novo), ainda sem «não se consegue mostrar»", async () => {
      await abrirGaleria();
      const era = imgAtual();

      await falharImagem(era);

      expect(haImgAtual()).toBe(true);
      expect(imgAtual()).not.toBe(era);
      expect(imgAtual().getAttribute("src")).toBe(enderecoDaImagem(101));
      expect(screen.queryByText(TEXTOS.fotoNaoSeMostra)).toBeNull();
      expect(aprovarFalso).not.toHaveBeenCalled();
    });

    it("volta a falhar: «Esta foto não se consegue mostrar. Só a podes rejeitar.» na caixa, sem <img>", async () => {
      await ateD3();

      expect(screen.getByText(TEXTOS.fotoNaoSeMostra)).toBeInTheDocument();
      expect(haImgAtual(), "nunca o ícone de imagem partida").toBe(false);
      expect(screen.queryByText(TEXTOS.aVerificarFoto)).toBeNull();
    });

    it("Aprovar inerte (não se publica o que não se viu), Rejeitar ATIVO; e continua assim passe o tempo que passar", async () => {
      await ateD3();

      await avancar(60_000);

      expect(inerte(botaoAprovar())).toBe(true);
      expect(inerte(botaoRejeitar())).toBe(false);
    });

    it("tocar em Aprovar não faz nada: nenhum pedido", async () => {
      await ateD3();
      await tocar(botaoAprovar());
      expect(aprovarFalso).not.toHaveBeenCalled();
      expect(aviso()).toBeNull();
    });

    it("a folha de rejeitar abre SEM miniatura e diz «Esta foto não se consegue mostrar.»; confirmar rejeita-a", async () => {
      await ateD3();

      await tocar(botaoRejeitar());

      const f = folha(TEXTOS.tituloRejeitar);
      expect(f.querySelector("img"), "sem miniatura").toBeNull();
      expect(f).toHaveTextContent(TEXTOS.fotoNaoSeMostraNaFolha);
      expect(rejeitarFalso).not.toHaveBeenCalled();

      await tocar(within(f).getByRole("button", { name: TEXTOS.rejeitar }));

      expect(rejeitarFalso).toHaveBeenCalledTimes(1);
      expect(rejeitarFalso).toHaveBeenCalledWith(101, comSinal);
      expect(aviso()).toHaveTextContent(TEXTOS.avisoRejeitada);
      expect(idDaImagem(imgAtual())).toBe(102);
    });

    it("a foto seguinte não herda o estado: carrega à parte e tem os botões normais (depois do `load` e do intervalo)", async () => {
      await ateD3();
      await tocar(botaoRejeitar());
      await tocar(
        within(folha(TEXTOS.tituloRejeitar)).getByRole("button", { name: TEXTOS.rejeitar }),
      );

      expect(screen.queryByText(TEXTOS.fotoNaoSeMostra)).toBeNull();
      await prontaParaModerar();
      expect(inerte(botaoAprovar())).toBe(false);
      expect(inerte(botaoRejeitar())).toBe(false);
    });

    it("se a imagem da segunda tentativa carregar, não há D3: tudo volta ao normal", async () => {
      await abrirGaleria();
      await falharImagem(imgAtual());

      await carregarImagem(imgAtual());
      await avancar(INTERVALO_CONTRA_DUPLO_TOQUE_MS);

      expect(screen.queryByText(TEXTOS.fotoNaoSeMostra)).toBeNull();
      expect(inerte(botaoAprovar())).toBe(false);
    });
  });

  it("uma imagem pré-carregada (escondida) que falha não mostra nada nem pede nada à fila", async () => {
    await abrirGaleria();

    await falharImagem(imgsOcultas()[0] as HTMLImageElement);

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.aVerificarFoto)).toBeNull();
    expect(screen.queryByText(TEXTOS.fotoNaoSeMostra)).toBeNull();
    expect(imagensDaPagina()).toHaveLength(2);
  });

  it("e quando essa foto passa a atual com a imagem já falhada, nunca se aprova às cegas: Aprovar fica inerte", async () => {
    await abrirGaleria();
    await falharImagem(imgsOcultas()[0] as HTMLImageElement);
    await prontaParaModerar();
    await tocar(botaoAprovar());

    await avancar(60_000);

    expect(aprovarFalso).toHaveBeenCalledTimes(1);
    expect(inerte(botaoAprovar())).toBe(true);
  });
});

describe("erro do servidor na verificação não conclui nada", () => {
  it("a fila a dar 500 depois de um «sem resposta»: é «não consegui confirmar» (Verificar outra vez), nunca «aprovada»", async () => {
    await abrirGaleria();
    aprovarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockRejectedValueOnce(erroDoServidor(500));

    await prontaParaModerar();
    await tocar(botaoAprovar());

    expect(screen.getByText(TEXTOS.semConfirmarAprovada)).toBeInTheDocument();
    expect(aviso()).toBeNull();
    expect(screen.queryByText(TEXTOS.avisoAprovada)).toBeNull();
  });

  it("nenhum caminho deste ficheiro repete o POST sozinho: depois de tudo, assentar não muda a contagem", async () => {
    await abrirGaleria();
    aprovarFalso.mockRejectedValueOnce(erroSemResposta());
    await prontaParaModerar();
    await tocar(botaoAprovar());

    await assentar();
    await avancar(60_000);

    expect(aprovarFalso).toHaveBeenCalledTimes(1);
  });
});
