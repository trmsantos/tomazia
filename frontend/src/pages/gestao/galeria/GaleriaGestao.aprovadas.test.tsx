/**
 * F4-04b, `docs/ecras/F4-04b.md` secções 1 a 5 e critérios 1, 2, 7, 8, 9 e 10 — a secção
 * «Fotos no site»: onde está, como se ordena, o que cada item mostra e o que nunca mostra, os quatro
 * estados distintos (regra 10), a relação com a fila (aprovar faz reler), e as muitas fotos (8 de
 * cada vez). Eliminar (a folha, o aviso, o foco, as falhas, o «sem resposta») está em
 * `GaleriaGestao.eliminar.test.tsx`.
 *
 * Contrato (a spec prevalece; os nomes de ficheiros e de chaves são do implementador, o texto é o
 * de `TEXTOS_APROVADAS`, por extenso):
 *
 *  - `obterAprovadas({ sinal })` de `lib/api/gestao-fotos`, pedida ao montar **em paralelo** com a fila;
 *  - `<section aria-labelledby>` com `<h2 tabindex="-1">` «Fotos no site (n)» (sem número a
 *    carregar e vazio), **a seguir à fila em todos os estados da fila**;
 *  - itens ordenados por `moderada_em` decrescente e, a igual, por `id` decrescente (no cliente);
 *  - miniatura `/media/<ficheiro>`, `loading="lazy"`, `alt=""`; nunca `/gestao/fotos/{id}/imagem`.
 *
 * **Regra 10, o que mais importa aqui:** rede, 5xx, um corpo ilegível ou um `TypeError` **nunca**
 * desenham uma foto, um «Eliminar» nem «Ainda não há fotos no site.»; o vazio só vem de um `200`
 * com a lista vazia; nunca fica «a carregar» para sempre.
 *
 * **Deixa passar:** layout (80/96 px, 1 200 px de página, 44 px medidos), foco visível, contraste,
 * axe e `loading="lazy"` a poupar pedidos (e2e).
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../../../lib/api/cliente";
import {
  erro409FotoJaModerada,
  erro401,
  erroDoServidor,
  erroSemResposta,
  filaDeTeste,
} from "../../../testes/gestao";
import {
  LEGENDA_DA_201,
  QUANDO_DAS_APROVADAS,
  TEXTOS,
  TEXTOS_APROVADAS as A,
  abrirFolhaDeEnviar,
  abrirGaleria,
  aprovadas,
  aprovadasDeTeste,
  aprovadasFalso,
  aprovarFalso,
  assentar,
  avancar,
  botaoAprovar,
  botaoDaSeccao,
  botaoEnviarDaFolha,
  botaoEnviarDaPagina,
  botaoRejeitar,
  botoesEliminar,
  comSinal,
  escolherFoto,
  ficarPendenteAteAbortar,
  folha,
  fotoAprovadaDeTeste,
  galeriaFalsa,
  h2,
  h2DasAprovadas,
  haBotaoDaSeccao,
  haBotoesDeModerar,
  idsDasAprovadas,
  itensDasAprovadas,
  linhaDasAprovadas,
  miniaturas,
  muitasAprovadas,
  obterFalso,
  pendente,
  prepararApi,
  prontaParaModerar,
  enviarFalso,
  seccaoDasAprovadas,
  scrollFalso,
  textoDasAprovadas,
  tocar,
  voltarAAba,
  type FotoAprovada,
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
  prepararApi(filaDeTeste(3), aprovadasDeTeste(3));
});

type Lista = { fotos: FotoAprovada[] };

function semFotoNemVazio(): void {
  expect(botoesEliminar(), "nenhum «Eliminar»").toEqual([]);
  expect(miniaturas(), "nenhuma foto").toEqual([]);
  expect(screen.queryByText(A.vazioTitulo), "nunca «Ainda não há fotos no site.»").toBeNull();
  expect(screen.queryByText(A.vazioLinha)).toBeNull();
  expect(h2DasAprovadas().textContent, "sem número").toBe(A.titulo);
}

describe("posição e ordem (critério 1)", () => {
  it("a secção «Fotos no site (3)» é uma região (`section aria-labelledby`) com o <h2> tabindex -1", async () => {
    await abrirGaleria();

    const seccao = screen.getByRole("region", { name: A.tituloN(3) });
    expect(seccao).toBe(aprovadas());
    expect(seccao.tagName).toBe("SECTION");
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(3));
    expect(h2DasAprovadas().tagName).toBe("H2");
    expect(h2DasAprovadas()).toHaveAttribute("tabindex", "-1");
  });

  it("vem depois da fila e depois de «Enviar foto» (a fila continua a ser a primeira região)", async () => {
    await abrirGaleria();

    const fila = screen.getByRole("region", { name: TEXTOS.fotosAEsperaN(3) });
    const seguinte = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(fila.compareDocumentPosition(aprovadas()) & seguinte).toBeTruthy();
    expect(botaoEnviarDaPagina().compareDocumentPosition(aprovadas()) & seguinte).toBeTruthy();
    expect(fila.contains(aprovadas()), "irmã da fila, não filha").toBe(false);
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });

  it("a ordem é da última aprovada para a mais antiga, mesmo com o servidor a mandar a lista às avessas", async () => {
    const certa = aprovadasDeTeste(3); // 201 (08:05), 202 (01:10), 203 (ontem)
    prepararApi(filaDeTeste(3), [...certa].reverse());
    await abrirGaleria();

    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
  });

  it("duas com a mesma `moderada_em` desempatam por `id` decrescente", async () => {
    const mesma = "2026-11-02T08:05:00Z";
    prepararApi(filaDeTeste(3), [
      fotoAprovadaDeTeste({ id: 5, moderada_em: mesma }),
      fotoAprovadaDeTeste({ id: 9, moderada_em: mesma }),
      fotoAprovadaDeTeste({ id: 7, moderada_em: mesma }),
      fotoAprovadaDeTeste({ id: 8, moderada_em: "2026-11-02T09:00:00Z" }),
    ]);
    await abrirGaleria();

    expect(idsDasAprovadas()).toEqual([8, 9, 7, 5]);
  });

  it("ordena pelo instante, não pelo texto (offsets diferentes na mesma hora)", async () => {
    // 10:00+02:00 é 08:00Z, anterior a 09:00Z; por texto «10:00» > «09:00».
    prepararApi(filaDeTeste(3), [
      fotoAprovadaDeTeste({ id: 1, moderada_em: "2026-11-02T10:00:00+02:00" }),
      fotoAprovadaDeTeste({ id: 2, moderada_em: "2026-11-02T09:00:00Z" }),
    ]);
    await abrirGaleria();

    expect(idsDasAprovadas()).toEqual([2, 1]);
  });

  it("pede a lista ao montar, com o sinal, em paralelo com a da fila (sem esperar por ela)", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirGaleria();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
    expect(aprovadasFalso).toHaveBeenCalledWith(comSinal);
    expect(idsDasAprovadas(), "a fila ainda não respondeu e as aprovadas já estão").toEqual([
      201, 202, 203,
    ]);
  });
});

describe("a secção desenha-se em todos os estados da fila e o estado de cada uma é independente (critério 2)", () => {
  it("fila a carregar: a secção já tem a lista", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirGaleria();

    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
    expect(
      document.querySelectorAll('[aria-busy="true"]'),
      "só a fila está a carregar",
    ).toHaveLength(1);
    expect(aprovadas().querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("fila vazia (200 com lista vazia): a secção continua lá com a lista", async () => {
    prepararApi([], aprovadasDeTeste(3));
    await abrirGaleria();

    expect(screen.getByText(TEXTOS.vazioTitulo)).toBeInTheDocument();
    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
  });

  it("erro da fila: a secção continua lá com a lista (o erro da fila não a esconde)", async () => {
    obterFalso.mockRejectedValue(erroDoServidor(500));
    await abrirGaleria();

    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
    expect(botoesEliminar()).toHaveLength(3);
  });

  it("erro da secção: a fila funciona por cima (a foto, «Aprovar» e «Rejeitar»), sem «Eliminar»", async () => {
    aprovadasFalso.mockRejectedValue(erroDoServidor(500));
    await abrirGaleria();

    expect(botaoAprovar()).toBeInTheDocument();
    expect(botaoRejeitar()).toBeInTheDocument();
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(screen.getByText(A.carregarTitulo)).toBeInTheDocument();
    semFotoNemVazio();
    expect(screen.queryByText(TEXTOS.carregarTitulo), "o erro da fila não é este").toBeNull();
  });

  it("os dois erros ao mesmo tempo: dois «Tentar outra vez», e o da secção só repete o GET das aprovadas", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    aprovadasFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirGaleria();
    expect(screen.getAllByRole("button", { name: A.tentarOutraVez })).toHaveLength(2);

    await tocar(botaoDaSeccao(A.tentarOutraVez));

    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
    expect(obterFalso, "a fila não foi tocada").toHaveBeenCalledTimes(1);
    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
  });

  it("a secção a carregar não esconde a fila (a foto e os botões já estão)", async () => {
    aprovadasFalso.mockReturnValue(new Promise(() => undefined));
    await abrirGaleria();

    expect(botaoAprovar()).toBeInTheDocument();
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(
      aprovadas().querySelector('[aria-busy="true"]'),
      "e a secção está mesmo a carregar",
    ).not.toBeNull();
  });
});

describe("a carregar (3.1)", () => {
  beforeEach(() => {
    aprovadasFalso.mockReturnValue(new Promise(() => undefined));
  });

  it("o <h2> sem número, um esqueleto sem texto (aria-busy), nenhum botão, nenhuma foto, nem «vazio» nem erro", async () => {
    await abrirGaleria();

    const seccao = aprovadas();
    expect(h2DasAprovadas().textContent).toBe(A.titulo);
    expect(seccao.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      (seccao.textContent ?? "").trim(),
      "o esqueleto não tem texto: a secção só tem o título",
    ).toBe(A.titulo);
    expect(within(seccao).queryAllByRole("button")).toEqual([]);
    semFotoNemVazio();
    expect(screen.queryByText(A.carregarTitulo)).toBeNull();
  });

  it("o esqueleto tem três linhas de miniatura (decorativas, sem `img`)", async () => {
    await abrirGaleria();
    expect(aprovadas().querySelectorAll("img")).toHaveLength(0);
    expect(aprovadas().querySelector('[aria-busy="true"]')?.children.length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("desmontar aborta o pedido (e um cancelamento não é um erro)", async () => {
    aprovadasFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirGaleria();
    const sinal = (aprovadasFalso.mock.calls[0]?.[0] as { sinal: AbortSignal }).sinal;
    expect(sinal.aborted).toBe(false);

    cleanup();

    expect(sinal.aborted).toBe(true);
  });

  it("no StrictMode o primeiro pedido é cancelado e isso não é um erro: no fim, a lista", async () => {
    let chamadas = 0;
    aprovadasFalso.mockImplementation((opcoes) => {
      chamadas += 1;
      if (chamadas === 1) {
        return new Promise((_ok, falhar) => {
          opcoes?.sinal?.addEventListener("abort", () => {
            falhar(new DOMException("cancelado", "AbortError"));
          });
        });
      }
      return Promise.resolve({ fotos: aprovadasDeTeste(3) });
    });

    await abrirGaleria(undefined, { estrito: true });

    expect(screen.queryByText(A.carregarTitulo)).toBeNull();
    expect(screen.queryByText(A.vazioTitulo)).toBeNull();
    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
  });

  it("o prazo de 10 s: sem resposta passados 10 s é «sem resposta» (nunca o vazio, nunca a carregar para sempre)", async () => {
    aprovadasFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirGaleria();
    await avancar(9_999);
    expect(screen.queryByText(A.carregarTitulo)).toBeNull();

    await avancar(1);

    expect(screen.getByText(A.carregarTitulo)).toBeInTheDocument();
    expect(screen.getByText(A.carregarSemResposta)).toBeInTheDocument();
    expect(aprovadas().querySelector('[aria-busy="true"]')).toBeNull();
    semFotoNemVazio();
  });
});

describe("200 com a lista vazia: o estado vazio (3.2)", () => {
  beforeEach(() => {
    prepararApi(filaDeTeste(3), []);
  });

  it("«Ainda não há fotos no site.» e a linha, debaixo do <h2> sem número; sem botões", async () => {
    await abrirGaleria();

    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
    expect(h2DasAprovadas().textContent).toBe(A.titulo);
    expect(within(aprovadas()).getByText(A.vazioTitulo)).toBeInTheDocument();
    expect(within(aprovadas()).getByText(A.vazioLinha)).toBeInTheDocument();
    expect(within(aprovadas()).queryAllByRole("button")).toEqual([]);
    expect(aprovadas().querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText(A.carregarTitulo)).toBeNull();
  });

  it("não é vermelho (é o vazio neutro) nem um aviso", async () => {
    await abrirGaleria();
    const titulo = within(aprovadas()).getByText(A.vazioTitulo);
    expect(`${titulo.className} ${titulo.parentElement?.className ?? ""}`).not.toMatch(/text-erro/);
  });
});

describe("erro ao carregar (3.3, regra 10): nunca foto, nunca «Eliminar», nunca «não há fotos»", () => {
  const ILEGIVEL = new ErroDaApi("O corpo não se sabe ler.", { estado: 200, codigo: null });

  it.each([
    ["sem resposta (rede)", () => Promise.reject(erroSemResposta()), true],
    ["500", () => Promise.reject(erroDoServidor(500)), false],
    ["403", () => Promise.reject(erroDoServidor(403)), false],
    ["corpo ilegível (ErroDaApi de estado 200)", () => Promise.reject(ILEGIVEL), false],
    ["um TypeError (o nosso código a rebentar)", () => Promise.reject(new TypeError("x")), false],
    [
      "um `moderada_em` que não se sabe ler (o ecrã não pode rebentar nem ficar a carregar)",
      () =>
        Promise.resolve({
          fotos: [fotoAprovadaDeTeste({ id: 1, moderada_em: "não é uma data" })],
        }),
      false,
    ],
    ["uma lista que não é lista", () => Promise.resolve({ fotos: {} } as unknown as Lista), false],
  ])("%s", async (_nome, falhar, semResposta) => {
    aprovadasFalso.mockImplementation(falhar);

    await abrirGaleria();

    expect(within(aprovadas()).getByText(A.carregarTitulo)).toBeInTheDocument();
    expect(
      within(aprovadas()).getByText(semResposta ? A.carregarSemResposta : A.carregarServidor),
    ).toBeInTheDocument();
    expect(botaoDaSeccao(A.tentarOutraVez)).toBeInTheDocument();
    semFotoNemVazio();
    expect(
      aprovadas().querySelector('[aria-busy="true"]'),
      "nunca «a carregar» para sempre",
    ).toBeNull();
    expect(botaoAprovar(), "a fila não depende disto").toBeInTheDocument();
  });

  it("sem resposta e servidor dizem coisas diferentes", async () => {
    aprovadasFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirGaleria();
    expect(screen.getByText(A.carregarSemResposta)).toBeInTheDocument();
    expect(screen.queryByText(A.carregarServidor)).toBeNull();
    cleanup();

    aprovadasFalso.mockRejectedValueOnce(erroDoServidor(500));
    await abrirGaleria();
    expect(screen.getByText(A.carregarServidor)).toBeInTheDocument();
    expect(screen.queryByText(A.carregarSemResposta)).toBeNull();
  });

  it("o «Tentar outra vez» aponta (aria-describedby) ao título do seu estado, para o leitor de ecrã o distinguir do da fila", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    aprovadasFalso.mockRejectedValue(erroSemResposta());
    await abrirGaleria();

    const id = botaoDaSeccao(A.tentarOutraVez).getAttribute("aria-describedby");
    expect(id).not.toBeNull();
    expect(document.getElementById(id ?? "")).toHaveTextContent(A.carregarTitulo);
    expect(aprovadas()).toContainElement(document.getElementById(id ?? ""));
  });

  it("«Tentar outra vez»: «A tentar…» (aria-busy) enquanto corre, um só pedido por toque; depois a lista", async () => {
    aprovadasFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirGaleria();
    const segunda = pendente<Lista>();
    aprovadasFalso.mockReturnValueOnce(segunda.promessa);

    await tocar(botaoDaSeccao(A.tentarOutraVez));

    const ocupado = botaoDaSeccao(A.aTentar);
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    await tocar(ocupado);
    expect(aprovadasFalso, "um segundo toque não faz um terceiro pedido").toHaveBeenCalledTimes(2);

    segunda.resolver({ fotos: aprovadasDeTeste(3) });
    await assentar();
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(3));
    expect(screen.queryByText(A.carregarTitulo)).toBeNull();
  });

  it("«Tentar outra vez» que volta a falhar volta ao erro, sem foto", async () => {
    aprovadasFalso.mockRejectedValue(erroSemResposta());
    await abrirGaleria();
    await tocar(botaoDaSeccao(A.tentarOutraVez));
    expect(within(aprovadas()).getByText(A.carregarTitulo)).toBeInTheDocument();
    semFotoNemVazio();
  });

  it("401 ao carregar: aoPerderSessao e nenhuma frase de erro desta secção", async () => {
    aprovadasFalso.mockRejectedValue(erro401());
    const sessao = await abrirGaleria();

    expect(sessao.aoPerderSessao).toHaveBeenCalled();
    expect(screen.queryByText(A.carregarTitulo)).toBeNull();
    expect(screen.queryByText(A.vazioTitulo)).toBeNull();
  });
});

describe("o que cada item mostra (2.1) e o que nunca mostra (critério 10)", () => {
  it("«Aprovada {quando}» com a data de aprovação (moderada_em), nunca a do envio", async () => {
    await abrirGaleria();

    for (const [id, quando] of Object.entries(QUANDO_DAS_APROVADAS)) {
      const item = itensDasAprovadas()[idsDasAprovadas().indexOf(Number(id))] as HTMLElement;
      expect(within(item).getByText(A.aprovadaEm(quando)), `item ${id}`).toBeInTheDocument();
    }
    // A 203 foi enviada a 30/10 (criada_em) e aprovada ontem: a data do envio nunca aparece.
    expect(textoDasAprovadas()).not.toMatch(/30 de outubro|sexta/);
  });

  it("«Enviada por {nome}» só com nome; sem nome a linha não existe (nunca «Anónimo»)", async () => {
    await abrirGaleria();
    const itens = itensDasAprovadas();

    expect(within(itens[0] as HTMLElement).getByText(A.enviadaPor("Marta"))).toBeInTheDocument();
    expect(within(itens[2] as HTMLElement).getByText(A.enviadaPor("Zé"))).toBeInTheDocument();
    expect(itens[1]?.textContent).not.toMatch(/Enviada por|Anónimo|anónimo/);
  });

  it("a legenda só existe se houver; sem rótulo «Legenda no site» (a folha é que a diz por inteiro)", async () => {
    await abrirGaleria();
    const itens = itensDasAprovadas();

    expect(within(itens[0] as HTMLElement).getByText(LEGENDA_DA_201)).toBeInTheDocument();
    expect(textoDasAprovadas()).not.toContain(TEXTOS.legendaNoSite);
    expect(textoDasAprovadas()).not.toMatch(/sem legenda/i);
    const semLegenda = itens[1] as HTMLElement;
    expect(semLegenda.textContent).toBe(`${A.aprovadaEm("hoje, à 01:10")}${A.eliminar}`);
  });

  it("a legenda quebra e corta às duas linhas (`break-words`, `line-clamp-2`) na lista", async () => {
    await abrirGaleria();
    const longa = within(itensDasAprovadas()[2] as HTMLElement).getByText("Z".repeat(255));
    const classes = `${longa.className} ${longa.parentElement?.className ?? ""}`;
    expect(classes).toMatch(/break-words/);
    expect(classes).toMatch(/line-clamp-2/);
  });

  it("a hora da uma da manhã escreve-se «à 01:10»", async () => {
    await abrirGaleria();
    expect(within(aprovadas()).getByText("Aprovada hoje, à 01:10")).toBeInTheDocument();
  });

  it("o botão diz «Eliminar» e o nome acessível é «Eliminar foto aprovada {quando}» (começa pelo texto visível)", async () => {
    await abrirGaleria();
    const botoes = botoesEliminar();

    expect(botoes).toHaveLength(3);
    for (const b of botoes) expect(b).toHaveTextContent(new RegExp(`^${A.eliminar}$`));
    expect(botoes[0]).toHaveAccessibleName(A.nomeDoBotao("hoje, às 08:05"));
    expect(botoes[1]).toHaveAccessibleName(A.nomeDoBotao("hoje, à 01:10"));
    expect(botoes[2]).toHaveAccessibleName(A.nomeDoBotao("ontem, às 23:40"));
    expect(botoes[0]?.getAttribute("aria-label")?.startsWith(A.eliminar)).toBe(true);
  });

  it("o «Eliminar» da lista não é vermelho nem dourado (perigo só na folha, dourado só no «Aprovar» da fila)", async () => {
    await abrirGaleria();
    for (const b of botoesEliminar()) expect(b.className).not.toMatch(/bg-perigo|bg-acao/);
    expect(aprovadas().innerHTML).not.toMatch(/bg-acao|bg-perigo/);
  });

  it("o alvo do «Eliminar» é de 44 px (`min-h-toque`)", async () => {
    await abrirGaleria();
    for (const b of botoesEliminar()) expect(b.className).toMatch(/min-h-toque/);
  });

  it("a legenda e o nome são texto: HTML na legenda não vira elemento", async () => {
    prepararApi(filaDeTeste(3), [
      fotoAprovadaDeTeste({
        id: 7,
        descricao: '<b>negrito</b> <img src=x onerror="alert(1)">',
        enviada_por: "<i>Rita</i>",
      }),
    ]);
    await abrirGaleria();

    expect(aprovadas().querySelector("b")).toBeNull();
    expect(aprovadas().querySelector("i")).toBeNull();
    expect(miniaturas(), "só a miniatura da foto, nenhuma injetada").toHaveLength(1);
    expect(screen.getByText('<b>negrito</b> <img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(screen.getByText(/<i>Rita<\/i>/)).toBeInTheDocument();
  });

  it("nenhum `alt` nem `aria-label` leva a legenda nem o nome: o `alt` é «» e o `aria-label` é só «Eliminar foto aprovada …»", async () => {
    await abrirGaleria();

    for (const img of miniaturas()) expect(img.getAttribute("alt")).toBe("");
    for (const no of Array.from(aprovadas().querySelectorAll("[aria-label], [alt], [title]"))) {
      const texto = [
        no.getAttribute("aria-label"),
        no.getAttribute("alt"),
        no.getAttribute("title"),
      ]
        .filter((t) => t !== null)
        .join(" ");
      expect(texto).not.toContain("Marta");
      expect(texto).not.toContain("Zé");
      expect(texto).not.toContain("Aniversário");
      expect(texto).not.toContain("ZZZZ");
    }
  });

  it("nunca o `ip_hash`, o `ficheiro` nem o `id` no texto visível", async () => {
    await abrirGaleria();
    expect(textoDasAprovadas()).not.toMatch(/ip_hash|foto-20\d|\b20[123]\b|webp/);
  });

  it("nada de «Desfazer» nem de «Retirar»: a palavra é Eliminar", async () => {
    await abrirGaleria();
    expect(textoDasAprovadas()).not.toMatch(/desfazer|retirar|apagar|remover|deletar/i);
  });
});

describe("uma foto sem `moderada_em` (decisão do Tomás: `null` não é corpo ilegível)", () => {
  const SEM_DATA = fotoAprovadaDeTeste({
    id: 7,
    moderada_em: null,
    criada_em: "2026-10-30T12:00:00Z",
  });
  const OUTRA_SEM_DATA = fotoAprovadaDeTeste({
    id: 8,
    moderada_em: null,
    criada_em: "2026-10-31T09:30:00Z",
    descricao: "Sem data",
  });

  it("não parte a secção: aparece no FIM da lista (por `id` decrescente entre as sem data), com «Aprovada» sem data", async () => {
    prepararApi(filaDeTeste(3), [SEM_DATA, ...aprovadasDeTeste(2), OUTRA_SEM_DATA]);
    await abrirGaleria();

    expect(idsDasAprovadas()).toEqual([201, 202, 8, 7]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(4));
    expect(screen.queryByText(A.carregarTitulo)).toBeNull();
    const item = itensDasAprovadas()[3] as HTMLElement;
    expect(item.textContent).toBe(`Aprovada${A.eliminar}`);
  });

  it("o `aria-label` do «Eliminar» continua único e sem texto de terceiros: usa a data de ENVIO (`criada_em`)", async () => {
    prepararApi(filaDeTeste(3), [SEM_DATA, OUTRA_SEM_DATA]);
    await abrirGaleria();

    const nomes = botoesEliminar().map((b) => b.getAttribute("aria-label"));
    expect(nomes).toHaveLength(2);
    expect(new Set(nomes).size, "dois nomes diferentes").toBe(2);
    for (const nome of nomes) {
      expect(nome).toMatch(/^Eliminar foto aprovada enviada /);
      expect(nome).not.toContain("Sem data");
    }
  });

  it("a folha diz «Aprovada» sem data", async () => {
    prepararApi(filaDeTeste(3), [SEM_DATA]);
    await abrirGaleria();

    await tocar(botoesEliminar()[0] as HTMLElement);

    const f = screen.getByRole("dialog", { name: A.tituloDaFolha });
    expect(within(f).getByText("Aprovada")).toBeInTheDocument();
  });
});

describe("texto só com espaços (a lista e a folha usam a mesma regra)", () => {
  it("legenda e nome só com espaços não aparecem, nem no item nem na folha", async () => {
    prepararApi(filaDeTeste(3), [
      fotoAprovadaDeTeste({ id: 7, descricao: "   ", enviada_por: "  " }),
    ]);
    await abrirGaleria();
    expect(itensDasAprovadas()[0]?.textContent).not.toMatch(/Enviada por/);
    expect(itensDasAprovadas()[0]?.querySelectorAll("p")).toHaveLength(1);

    await tocar(botoesEliminar()[0] as HTMLElement);

    const f = screen.getByRole("dialog", { name: A.tituloDaFolha });
    expect(f.textContent).not.toMatch(/Enviada por/);
    expect(f.querySelectorAll("p"), "só a data e o aviso").toHaveLength(2);
  });
});

describe("a miniatura (2.1)", () => {
  it("vem de /media/<ficheiro>, pública, nunca de /gestao/fotos/{id}/imagem; lazy, async, alt vazio", async () => {
    await abrirGaleria();
    const imgs = miniaturas();

    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "/media/foto-201.webp",
      "/media/foto-202.webp",
      "/media/foto-203.webp",
    ]);
    for (const img of imgs) {
      expect(img.getAttribute("src")).not.toMatch(/gestao|api/);
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
      expect(img.getAttribute("alt")).toBe("");
    }
  });

  it("a caixa é quadrada e fixa (`aspect-foto`, `w-miniatura`, `lg:w-miniatura-grande`, `object-cover`, `shrink-0`): a página não salta", async () => {
    await abrirGaleria();
    for (const img of miniaturas()) {
      expect(img.className).toMatch(/aspect-foto/);
      expect(img.className).toMatch(/object-cover/);
      expect(img.className).toMatch(/shrink-0/);
      expect(img.className).toMatch(/(^|\s)w-miniatura(\s|$)/);
      expect(img.className).toMatch(/lg:w-miniatura-grande/);
    }
  });

  it("imagem que não carrega: «Sem imagem» no lugar dela (sem ícone partido), o «Eliminar» CONTINUA ativo e nada é pedido", async () => {
    await abrirGaleria();
    const pedidosAntes = [
      obterFalso.mock.calls.length,
      aprovadasFalso.mock.calls.length,
      galeriaFalsa.mock.calls.length,
    ];
    const img = miniaturas()[1] as HTMLImageElement;

    fireEvent.error(img);
    await assentar();

    const item = itensDasAprovadas()[1] as HTMLElement;
    expect(within(item).getByText(A.semImagem)).toBeInTheDocument();
    expect(item.querySelector("img"), "nenhum <img> partido").toBeNull();
    const eliminar = within(item).getByRole("button", { name: /^Eliminar foto aprovada/ });
    expect(eliminar).not.toHaveAttribute("aria-disabled", "true");
    expect(eliminar).not.toBeDisabled();
    expect(
      [
        obterFalso.mock.calls.length,
        aprovadasFalso.mock.calls.length,
        galeriaFalsa.mock.calls.length,
      ],
      "o `onError` não decide nem verifica nada (não distingue 404 de rede)",
    ).toEqual(pedidosAntes);
    expect(miniaturas()).toHaveLength(2);
  });

  it("com «Sem imagem» o «Eliminar» abre a folha (é a saída para uma linha sem ficheiro)", async () => {
    await abrirGaleria();
    fireEvent.error(miniaturas()[0] as HTMLImageElement);
    await assentar();

    await tocar(botoesEliminar()[0] as HTMLElement);

    expect(screen.getByRole("dialog", { name: A.tituloDaFolha })).toBeInTheDocument();
  });
});

describe("a relação com a fila de cima (secção 4, critério 7)", () => {
  const NOVA = fotoAprovadaDeTeste({
    id: 101,
    moderada_em: "2026-11-02T09:59:00Z",
    descricao: "Acabada de aprovar",
  });

  async function aprovarNaFila(): Promise<void> {
    await prontaParaModerar();
    await tocar(botaoAprovar());
  }

  it("aprovar na fila faz UM GET das aprovadas, em silêncio (sem esqueleto, sem tirar nada), e a foto aprovada aparece no topo", async () => {
    await abrirGaleria();
    const releitura = pendente<Lista>();
    aprovadasFalso.mockReturnValueOnce(releitura.promessa);

    await aprovarNaFila();

    expect(aprovarFalso).toHaveBeenCalledWith(101, comSinal);
    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
    expect(aprovadasFalso).toHaveBeenLastCalledWith(comSinal);
    expect(aprovadas().querySelector('[aria-busy="true"]'), "sem esqueleto").toBeNull();
    expect(idsDasAprovadas(), "nada sai da lista enquanto o GET não chega").toEqual([
      201, 202, 203,
    ]);

    releitura.resolver({ fotos: [NOVA, ...aprovadasDeTeste(3)] });
    await assentar();

    expect(idsDasAprovadas()).toEqual([101, 201, 202, 203]);
    expect(
      within(itensDasAprovadas()[0] as HTMLElement).getByText("Acabada de aprovar"),
    ).toBeInTheDocument();
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(4));
    expect(aprovadasFalso, "um só GET").toHaveBeenCalledTimes(2);
  });

  it("não relê ao chegar o clique: só depois do 200 de aprovar (nada otimista)", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    const resposta = pendente<{ id: number; estado: "aprovada" }>();
    aprovarFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(botaoAprovar());
    expect(aprovadasFalso, "ainda não chegou o 200").toHaveBeenCalledTimes(1);

    resposta.resolver({ id: 101, estado: "aprovada" });
    await assentar();
    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
  });

  it("aprovar com 500 não relê (nada mudou)", async () => {
    await abrirGaleria();
    aprovarFalso.mockRejectedValueOnce(erroDoServidor(500));

    await aprovarNaFila();

    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
  });

  it("rejeitar não relê as aprovadas (não mexe nelas)", async () => {
    await abrirGaleria();
    await prontaParaModerar();
    await tocar(botaoRejeitar());

    await tocar(
      within(folha(TEXTOS.tituloRejeitar)).getByRole("button", { name: TEXTOS.rejeitar }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
  });

  it("enviar uma foto do dono não relê as aprovadas (vai para a fila, não para o site)", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    await escolherFoto();

    await tocar(botaoEnviarDaFolha());

    expect(enviarFalso).toHaveBeenCalledTimes(1);
    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
  });

  it("um 409 ao aprovar que a fila resolve a favor de «aprovada» (a foto está na galeria pública) também relê", async () => {
    await abrirGaleria();
    aprovarFalso.mockRejectedValue(erro409FotoJaModerada());
    obterFalso.mockImplementation(() =>
      Promise.resolve({ fotos: filaDeTeste(3).filter((f) => f.id !== 101) }),
    );
    galeriaFalsa.mockResolvedValue({
      fotos: [{ id: 101, ficheiro: "foto-101.webp", descricao: null }],
    });

    await aprovarNaFila();

    expect(aprovarFalso, "nunca repete").toHaveBeenCalledTimes(1);
    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
  });

  it("sem resposta ao aprovar, resolvido a favor de «aprovada»: também relê; resolvido contra («não aprovada»), não", async () => {
    await abrirGaleria();
    aprovarFalso.mockRejectedValue(erroSemResposta());
    obterFalso.mockImplementation(() =>
      Promise.resolve({ fotos: filaDeTeste(3).filter((f) => f.id !== 101) }),
    );
    galeriaFalsa.mockResolvedValue({
      fotos: [{ id: 101, ficheiro: "foto-101.webp", descricao: null }],
    });
    await aprovarNaFila();
    expect(aprovadasFalso, "a favor de aprovada").toHaveBeenCalledTimes(2);
    cleanup();

    prepararApi(filaDeTeste(3), aprovadasDeTeste(3));
    await abrirGaleria();
    aprovarFalso.mockRejectedValue(erroSemResposta());
    obterFalso.mockImplementation(() =>
      Promise.resolve({ fotos: filaDeTeste(3).filter((f) => f.id !== 101) }),
    );
    galeriaFalsa.mockResolvedValue({ fotos: [] });
    await aprovarNaFila();
    expect(
      aprovadasFalso,
      "a foto foi rejeitada noutro aparelho: nada a reler",
    ).toHaveBeenCalledTimes(1);
  });

  it("voltar à aba relê em silêncio, no mesmo momento da fila: a lista fica, sem esqueleto", async () => {
    await abrirGaleria();

    await voltarAAba();

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
    expect(aprovadas().querySelector('[aria-busy="true"]')).toBeNull();
    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
  });

  it("passado muito tempo, nenhum GET novo sozinho (sem polling)", async () => {
    await abrirGaleria();
    await avancar(10 * 60_000);
    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
  });

  it("a leitura silenciosa substitui a lista (uma foto eliminada noutro aparelho sai; o número desce)", async () => {
    await abrirGaleria();
    aprovadasFalso.mockResolvedValueOnce({ fotos: aprovadasDeTeste(3).slice(1) });

    await voltarAAba();

    expect(idsDasAprovadas()).toEqual([202, 203]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(2));
  });

  describe("se a leitura silenciosa falhar e já havia lista (não se apaga o que se sabe)", () => {
    it.each([
      ["sem resposta", () => erroSemResposta()],
      ["500", () => erroDoServidor(500)],
      ["corpo ilegível", () => new ErroDaApi("x", { estado: 200, codigo: null })],
    ])(
      "%s: a lista mantém-se, a linha de estado diz que pode estar desatualizada, com «Tentar outra vez»",
      async (_n, erro) => {
        await abrirGaleria();
        aprovadasFalso.mockRejectedValueOnce(erro());

        await voltarAAba();

        expect(idsDasAprovadas()).toEqual([201, 202, 203]);
        expect(botoesEliminar()).toHaveLength(3);
        const linha = linhaDasAprovadas(A.desatualizada);
        expect(linha, "a linha de estado da secção").not.toBeNull();
        expect(screen.queryByText(A.carregarTitulo), "não é o erro de carregar").toBeNull();
        expect(haBotaoDaSeccao(A.tentarOutraVez)).toBe(true);
        expect(aprovadas().querySelector('[aria-busy="true"]')).toBeNull();
      },
    );

    it("«Tentar outra vez» repete só o GET das aprovadas; a linha desaparece quando há resposta", async () => {
      await abrirGaleria();
      aprovadasFalso.mockRejectedValueOnce(erroSemResposta());
      await voltarAAba();
      const filaAntes = obterFalso.mock.calls.length;
      aprovadasFalso.mockResolvedValueOnce({ fotos: aprovadasDeTeste(2) });

      await tocar(botaoDaSeccao(A.tentarOutraVez));

      expect(aprovadasFalso).toHaveBeenCalledTimes(3);
      expect(obterFalso.mock.calls.length, "a fila não é lida").toBe(filaAntes);
      expect(linhaDasAprovadas(A.desatualizada)).toBeNull();
      expect(idsDasAprovadas()).toEqual([201, 202]);
    });

    it("uma leitura que volta a falhar mantém a lista e a linha (nunca o vazio)", async () => {
      await abrirGaleria();
      aprovadasFalso.mockRejectedValue(erroSemResposta());
      await voltarAAba();

      await tocar(botaoDaSeccao(A.tentarOutraVez));

      expect(idsDasAprovadas()).toEqual([201, 202, 203]);
      expect(linhaDasAprovadas(A.desatualizada)).not.toBeNull();
      expect(screen.queryByText(A.vazioTitulo)).toBeNull();
    });

    it("a falha de uma leitura silenciosa que já não é preciso mostrar (lista vazia anterior) é o erro de 3.3, não a linha", async () => {
      prepararApi(filaDeTeste(3), []);
      await abrirGaleria();
      expect(screen.getByText(A.vazioTitulo)).toBeInTheDocument();
      aprovadasFalso.mockRejectedValueOnce(erroSemResposta());

      await voltarAAba();

      expect(screen.queryByText(A.vazioTitulo), "nunca «vazio» depois de uma falha").toBeNull();
      expect(screen.getByText(A.carregarTitulo)).toBeInTheDocument();
    });
  });

  it("a leitura silenciosa com 401 leva ao login", async () => {
    const sessao = await abrirGaleria();
    aprovadasFalso.mockRejectedValueOnce(erro401());

    await voltarAAba();

    expect(sessao.aoPerderSessao).toHaveBeenCalled();
  });
});

describe("muitas fotos, 8 de cada vez (secção 5, critério 8)", () => {
  beforeEach(() => {
    prepararApi(filaDeTeste(3), muitasAprovadas(23));
  });

  it("23 aprovadas: 8 itens, «A mostrar 8 de 23.», «Mostrar mais fotos»; o <h2> tem sempre o total", async () => {
    await abrirGaleria();

    expect(itensDasAprovadas()).toHaveLength(8);
    expect(idsDasAprovadas()).toEqual([23, 22, 21, 20, 19, 18, 17, 16]);
    expect(within(aprovadas()).getByText(A.aMostrar(8, 23))).toBeInTheDocument();
    expect(botaoDaSeccao(A.mostrarMais)).toBeInTheDocument();
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(23));
    expect(botoesEliminar()).toHaveLength(8);
  });

  it("um toque dá 16 e a nota passa a «A mostrar 16 de 23.»; outro dá as 23 e os dois desaparecem", async () => {
    await abrirGaleria();

    await tocar(botaoDaSeccao(A.mostrarMais));
    expect(itensDasAprovadas()).toHaveLength(16);
    expect(within(aprovadas()).getByText(A.aMostrar(16, 23))).toBeInTheDocument();
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(23));

    await tocar(botaoDaSeccao(A.mostrarMais));
    expect(itensDasAprovadas()).toHaveLength(23);
    expect(idsDasAprovadas()[22]).toBe(1);
    expect(screen.queryByText(/^A mostrar /)).toBeNull();
    expect(haBotaoDaSeccao(A.mostrarMais)).toBe(false);
  });

  it("«Mostrar mais fotos» não move o foco nem faz scroll", async () => {
    await abrirGaleria();
    const mais = botaoDaSeccao(A.mostrarMais);
    mais.focus();

    await tocar(mais);

    expect(document.activeElement).toBe(botaoDaSeccao(A.mostrarMais));
    expect(document.activeElement).not.toBe(document.body);
    expect(scrollFalso, "nenhum scrollIntoView").not.toHaveBeenCalled();
  });

  it("a nota «A mostrar x de n.» é uma região viva educada (`aria-live=polite`), a única da lista", async () => {
    await abrirGaleria();
    const nota = within(aprovadas()).getByText(A.aMostrar(8, 23));
    expect(nota.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("«Mostrar mais fotos» e a nota são pequenos de ler e de tocar: botão `min-h-toque`", async () => {
    await abrirGaleria();
    expect(botaoDaSeccao(A.mostrarMais).className).toMatch(/min-h-toque/);
  });

  it("todas as miniaturas, as dos itens novos também, são lazy", async () => {
    await abrirGaleria();
    await tocar(botaoDaSeccao(A.mostrarMais));
    expect(miniaturas()).toHaveLength(16);
    for (const img of miniaturas()) expect(img.getAttribute("loading")).toBe("lazy");
  });

  it.each([1, 5, 8])("com %i aprovadas não há nota nem botão", async (n) => {
    prepararApi(filaDeTeste(3), muitasAprovadas(n));
    await abrirGaleria();

    expect(itensDasAprovadas()).toHaveLength(n);
    expect(screen.queryByText(/^A mostrar /)).toBeNull();
    expect(haBotaoDaSeccao(A.mostrarMais)).toBe(false);
  });

  it("com 9 aprovadas: 8 itens, «A mostrar 8 de 9.» e o botão", async () => {
    prepararApi(filaDeTeste(3), muitasAprovadas(9));
    await abrirGaleria();

    expect(itensDasAprovadas()).toHaveLength(8);
    expect(within(aprovadas()).getByText(A.aMostrar(8, 9))).toBeInTheDocument();
    expect(haBotaoDaSeccao(A.mostrarMais)).toBe(true);
  });

  it("uma leitura silenciosa não faz a lista encolher para 8 depois de o dono ter pedido mais", async () => {
    await abrirGaleria();
    await tocar(botaoDaSeccao(A.mostrarMais));
    expect(itensDasAprovadas()).toHaveLength(16);

    await voltarAAba();

    expect(itensDasAprovadas()).toHaveLength(16);
    expect(within(aprovadas()).getByText(A.aMostrar(16, 23))).toBeInTheDocument();
  });
});

describe("a página à volta (sanidade)", () => {
  it("as duas secções coexistem: o <h2> da fila continua a ser o da fila (um só), a secção tem o seu", async () => {
    await abrirGaleria();
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(3));
    expect(seccaoDasAprovadas()).not.toBeNull();
  });

  it("a ordem de tabulação: Enviar foto, Rejeitar, Aprovar, e só depois os «Eliminar» (pela ordem da lista)", async () => {
    await abrirGaleria();
    const ordem = [botaoEnviarDaPagina(), botaoRejeitar(), botaoAprovar(), ...botoesEliminar()];
    for (let i = 0; i < ordem.length - 1; i += 1) {
      const a = ordem[i] as HTMLElement;
      const b = ordem[i + 1] as HTMLElement;
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("os botões de moderar só existem na fila (a secção nunca tem Aprovar nem Rejeitar)", async () => {
    await abrirGaleria();
    expect(haBotoesDeModerar()).toBe(true);
    expect(within(aprovadas()).queryByRole("button", { name: TEXTOS.aprovar })).toBeNull();
    expect(within(aprovadas()).queryByRole("button", { name: TEXTOS.rejeitar })).toBeNull();
  });

  it("o <h2> e os itens não recebem foco por tabulação (só por código)", async () => {
    await abrirGaleria();
    expect(h2DasAprovadas().getAttribute("tabindex")).toBe("-1");
    for (const li of itensDasAprovadas()) expect(li.hasAttribute("tabindex")).toBe(false);
    for (const img of miniaturas()) expect(img.hasAttribute("tabindex")).toBe(false);
  });
});
