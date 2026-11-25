/**
 * F4-04b, `docs/ecras/F4-04b.md` secções 6, 7 e 8 e critérios 3, 4, 5, 6 e 9 — eliminar uma foto
 * aprovada: a folha «Tem a certeza?» (abre sem pedido, foco em «Cancelar»), o `DELETE` (um por
 * confirmação, a folha não fecha a meio), o `204` (aviso, número, foco no <h2> da secção) e tudo o
 * que não corre bem: 500 (erro **dentro** da folha), 404, 409, 401 e o **sem resposta**.
 *
 * **Regra 10, o coração desta tarefa:** um `DELETE` sem resposta é «não sei». O ecrã **nunca**
 * repete o `DELETE` por conta própria (nem a «Verificar outra vez»), relê a lista e diz o que
 * encontrou; um erro nunca é «eliminada», e uma falha ao reler nunca é «não há fotos». Cada ramo
 * conta os pedidos: `eliminarFalso` é chamado **uma vez** até o dono tocar outra vez.
 *
 * **Deixa passar:** os 44 px, o anel de foco, o scroll do <h2> e a folha a 85 dvh (e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { erro401, erroSemResposta, filaDeTeste } from "../../../testes/gestao";
import {
  TEXTOS,
  TEXTOS_APROVADAS as A,
  abrirFolhaDeEliminar,
  abrirGaleria,
  aprovadas,
  aprovadasDeTeste,
  aprovadasFalso,
  assentar,
  aviso,
  avancar,
  botaoDaSeccao,
  botoesEliminar,
  cancelarEliminar,
  comSinal,
  confirmarEliminar,
  eliminarDe,
  eliminarFalso,
  erroDoEliminar,
  ficarPendenteAteAbortar,
  folhaDeEliminar,
  h2,
  h2DasAprovadas,
  haBotaoDaSeccao,
  haFolhaDeEliminar,
  idsDasAprovadas,
  inerte,
  itensDasAprovadas,
  linhaDasAprovadas,
  miniaturas,
  muitasAprovadas,
  obterFalso,
  pendente,
  prepararApi,
  textoDasAprovadas,
  tocar,
  tocarDuasVezes,
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

/** O que o servidor devolve depois de a foto `id` desaparecer. */
function semAFoto(...ids: number[]): Lista {
  return { fotos: aprovadasDeTeste(3).filter((f) => !ids.includes(f.id)) };
}

function esc(): void {
  fireEvent(folhaDeEliminar(), new Event("cancel", { cancelable: true }));
}
function fechar(): HTMLElement {
  return within(folhaDeEliminar()).getByRole("button", { name: "Fechar" });
}
/** Abre a folha da 202 (sem legenda nem nome) e confirma. */
async function eliminar(id = 202): Promise<void> {
  await abrirFolhaDeEliminar(id);
  await tocar(confirmarEliminar());
}
function nenhumEliminarTemFoco(): void {
  for (const b of botoesEliminar()) expect(document.activeElement).not.toBe(b);
}

describe("a folha «Tem a certeza?» (7, critério 3)", () => {
  it("«Eliminar» abre a folha SEM pedido nenhum e sem aviso", async () => {
    await abrirGaleria();
    const pedidos = [obterFalso.mock.calls.length, aprovadasFalso.mock.calls.length];

    await abrirFolhaDeEliminar(202);

    expect(haFolhaDeEliminar()).toBe(true);
    expect(eliminarFalso).not.toHaveBeenCalled();
    expect([obterFalso.mock.calls.length, aprovadasFalso.mock.calls.length]).toEqual(pedidos);
    expect(aviso()).toBeNull();
  });

  it("o título é a frase formal «Tem a certeza?» e o corpo diz que a foto é eliminada e que não se pode desfazer", async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEliminar(202);

    expect(within(f).getByRole("heading", { name: A.tituloDaFolha })).toBeInTheDocument();
    expect(f).toHaveTextContent(A.avisoDaFolha);
    expect(f.textContent).not.toMatch(/apagad|remov|retir|deletar/i);
  });

  it("mostra a foto certa: a mesma miniatura (/media, `alt` vazio, inteira), «Aprovada {quando}» e «Enviada por {nome}»", async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEliminar(201);

    const img = f.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/media/foto-201.webp");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.className, "a folha mostra a foto inteira").toMatch(/object-contain/);
    expect(img?.className).not.toMatch(/object-cover/);
    expect(within(f).getByText(A.aprovadaEm("hoje, às 08:05"))).toBeInTheDocument();
    expect(within(f).getByText(A.enviadaPor("Marta"))).toBeInTheDocument();
  });

  it("a legenda aparece INTEIRA na folha (sem `line-clamp`), só se houver; sem nome nem legenda, as linhas não existem", async () => {
    await abrirGaleria();
    let f = await abrirFolhaDeEliminar(203);
    const longa = within(f).getByText("Z".repeat(255));
    expect(`${longa.className} ${longa.parentElement?.className ?? ""}`).not.toMatch(/line-clamp/);
    expect(`${longa.className} ${longa.parentElement?.className ?? ""}`).toMatch(/break-words/);
    await tocar(cancelarEliminar());

    f = await abrirFolhaDeEliminar(202);
    expect(f.textContent).not.toMatch(/Enviada por/);
    expect(f.querySelectorAll("p").length, "só o aviso e a data").toBeLessThanOrEqual(3);
  });

  it("a legenda e o nome da folha são texto (HTML não vira elemento) e nunca vão para `alt` nem `aria-label`", async () => {
    prepararApi(filaDeTeste(3), [
      {
        ...aprovadasDeTeste(1)[0],
        descricao: "<b>x</b>",
        enviada_por: "<i>Rita</i>",
      } as FotoAprovada,
    ]);
    await abrirGaleria();
    const f = await abrirFolhaDeEliminar(201);

    expect(f.querySelector("b")).toBeNull();
    expect(f.querySelector("i")).toBeNull();
    expect(within(f).getByText("<b>x</b>")).toBeInTheDocument();
    for (const no of Array.from(f.querySelectorAll("[alt], [aria-label]"))) {
      expect(`${no.getAttribute("alt") ?? ""}${no.getAttribute("aria-label") ?? ""}`).not.toMatch(
        /Rita|<b>/,
      );
    }
  });

  it("«Eliminar» é o único vermelho (`bg-perigo`); «Cancelar» não; a folha não tem dourado", async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEliminar(202);

    expect(confirmarEliminar().className).toMatch(/bg-perigo/);
    expect(cancelarEliminar().className).not.toMatch(/bg-perigo/);
    for (const b of within(f).getAllByRole("button")) {
      expect(b.className, "o dourado confirmava uma destruição").not.toMatch(/bg-acao/);
    }
  });

  it("o foco COMEÇA em «Cancelar», a ação segura", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);

    expect(document.activeElement).toBe(cancelarEliminar());
  });

  it("a ordem das ações: o «×» (cabeçalho da Folha partilhada, antes do conteúdo), Eliminar, Cancelar", async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEliminar(202);
    const nomes = within(f)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
    expect(nomes.slice(1)).toEqual([A.eliminar, A.cancelar]);
    expect(within(f).getAllByRole("button")[0]).toBe(fechar());
  });

  it.each([
    ["«Cancelar»", async () => tocar(cancelarEliminar())],
    [
      "`Esc` (o evento cancel)",
      async () => {
        esc();
        await assentar();
      },
    ],
    ["o «×»", async () => tocar(fechar())],
    ["a cortina (o próprio <dialog>)", async () => tocar(folhaDeEliminar())],
  ])(
    "%s fecha SEM pedido, a foto fica e o foco volta ao «Eliminar» desse item",
    async (_nome, fecharFolha) => {
      await abrirGaleria();
      await abrirFolhaDeEliminar(202);

      await fecharFolha();

      expect(haFolhaDeEliminar()).toBe(false);
      expect(eliminarFalso).not.toHaveBeenCalled();
      expect(idsDasAprovadas()).toEqual([201, 202, 203]);
      expect(aviso()).toBeNull();
      expect(document.activeElement).toBe(eliminarDe(202));
    },
  );

  it("depois de cancelar pode abrir-se outra vez, e confirmar faz UM pedido", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    await tocar(cancelarEliminar());

    await abrirFolhaDeEliminar(202);
    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("imagem que não carrega na folha: «Esta foto não se consegue mostrar.» no lugar dela e o «Eliminar» continua ativo", async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEliminar(202);

    fireEvent.error(f.querySelector("img") as HTMLImageElement);
    await assentar();

    expect(within(f).getByText(A.naoSeMostra)).toBeInTheDocument();
    expect(f.querySelector("img")).toBeNull();
    expect(inerte(confirmarEliminar())).toBe(false);
    await tocar(confirmarEliminar());
    expect(eliminarFalso).toHaveBeenCalledWith(202, comSinal);
  });

  it("uma leitura que chega com a folha aberta NÃO a fecha nem a muda; se a foto já não vem na lista, o DELETE responde 404 e trata-se como 8.2", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    aprovadasFalso.mockResolvedValueOnce(semAFoto(202));

    await voltarAAba();

    expect(haFolhaDeEliminar(), "a folha mantém-se").toBe(true);
    expect(folhaDeEliminar().querySelector("img")?.getAttribute("src")).toBe(
      "/media/foto-202.webp",
    );
    expect(idsDasAprovadas()).toEqual([201, 203]);

    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(404));
    await tocar(confirmarEliminar());

    expect(haFolhaDeEliminar()).toBe(false);
    expect(linhaDasAprovadas(A.jaNaoExistia)).not.toBeNull();
    expect(idsDasAprovadas()).toEqual([201, 203]);
  });
});

describe("a eliminar (7.2, critério 4)", () => {
  it("UM DELETE com o id e o sinal; «A eliminar…» (aria-busy, aria-disabled); «Cancelar» e «×» inertes; nada otimista", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    const resposta = pendente<undefined>();
    eliminarFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledWith(202, comSinal);
    const ocupado = within(folhaDeEliminar()).getByRole("button", { name: A.aEliminar });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    expect(cancelarEliminar()).toHaveAttribute("aria-disabled", "true");
    expect(fechar()).toHaveAttribute("aria-disabled", "true");
    expect(idsDasAprovadas(), "a foto só sai depois da resposta").toEqual([201, 202, 203]);
  });

  it("a folha NÃO fecha a meio: nem «Cancelar», nem «×», nem `Esc`, nem a cortina; depois da resposta fecha", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    const resposta = pendente<undefined>();
    eliminarFalso.mockReturnValueOnce(resposta.promessa);
    await tocar(confirmarEliminar());

    await tocar(cancelarEliminar());
    await tocar(fechar());
    esc();
    await assentar();
    await tocar(folhaDeEliminar());

    expect(haFolhaDeEliminar()).toBe(true);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);

    resposta.resolver(undefined);
    await assentar();
    expect(haFolhaDeEliminar()).toBe(false);
  });

  it("um segundo toque, ou dois no mesmo instante, não fazem um segundo pedido", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    eliminarFalso.mockReturnValueOnce(pendente<undefined>().promessa);

    await tocarDuasVezes(confirmarEliminar());
    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("o prazo é de 10 s: sem resposta passados 10 s o DELETE foi abortado (ramo «sem resposta»)", async () => {
    await abrirGaleria();
    eliminarFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirFolhaDeEliminar(202);
    await tocar(confirmarEliminar());
    await avancar(9_999);
    expect(haFolhaDeEliminar(), "ainda à espera").toBe(true);

    await avancar(1);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(eliminarFalso, "aborta, nunca repete").toHaveBeenCalledTimes(1);
  });
});

describe("204: eliminada (6, critério 5)", () => {
  it("a folha fecha, a foto sai da lista, o <h2> perde um, e UM aviso «Feito. Foto eliminada.» sem «Desfazer»", async () => {
    await abrirGaleria();

    await eliminar(202);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(idsDasAprovadas()).toEqual([201, 203]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(2));
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(aviso()).toHaveTextContent(A.avisoEliminada);
    expect(screen.queryByRole("button", { name: /desfazer/i })).toBeNull();
    expect(
      screen
        .queryAllByRole("button")
        .filter((b) => aviso()?.contains(b) && b.getAttribute("aria-label") !== "Fechar aviso"),
      "o aviso só tem o × do componente partilhado, nenhuma ação (nem Desfazer)",
    ).toEqual([]);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledWith(202, comSinal);
  });

  it("o aviso dura 3 s", async () => {
    await abrirGaleria();
    await eliminar();
    await avancar(2_999);
    expect(aviso()).not.toBeNull();
    await avancar(1);
    expect(aviso()).toBeNull();
  });

  it("o FOCO vai ao <h2> da secção, por código, e NUNCA ao «Eliminar» do item seguinte", async () => {
    await abrirGaleria();

    await eliminar(201); // a primeira: o seguinte passa a ser o primeiro da lista

    expect(document.activeElement).toBe(h2DasAprovadas());
    nenhumEliminarTemFoco();
    expect(document.activeElement, "nem a fila").not.toBe(h2());
  });

  it("a lista não é relida (há mais fotos): um GET só no carregamento", async () => {
    await abrirGaleria();
    await eliminar();
    expect(aprovadasFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("não mexe na fila nem nas outras fotos", async () => {
    await abrirGaleria();
    await eliminar(202);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(miniaturas().map((i) => i.getAttribute("src"))).toEqual([
      "/media/foto-201.webp",
      "/media/foto-203.webp",
    ]);
  });

  it("eliminar a ÚLTIMA: um GET antes de dizer «vazio» (entretanto o esqueleto, sem texto); depois o estado vazio e o foco no título dele", async () => {
    prepararApi(filaDeTeste(3), aprovadasDeTeste(1));
    await abrirGaleria();
    const releitura = pendente<Lista>();
    aprovadasFalso.mockReturnValueOnce(releitura.promessa);

    await eliminar(201);

    expect(aprovadasFalso, "um GET antes de dizer «vazio»").toHaveBeenCalledTimes(2);
    expect(screen.queryByText(A.vazioTitulo), "ainda não confirmou").toBeNull();
    expect(aprovadas().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(textoDasAprovadas().trim()).toBe(A.titulo);

    releitura.resolver({ fotos: [] });
    await assentar();

    const titulo = screen.getByText(A.vazioTitulo);
    expect(aprovadas()).toContainElement(titulo);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.contains(titulo), "o foco vai ao título do vazio").toBe(true);
    expect(aviso()).toHaveTextContent(A.avisoEliminada);
  });

  it("eliminar a última e esse GET falhar: é o erro de carregar, a foto eliminada NÃO volta, nunca «vazio»", async () => {
    prepararApi(filaDeTeste(3), aprovadasDeTeste(1));
    await abrirGaleria();
    aprovadasFalso.mockRejectedValueOnce(erroSemResposta());

    await eliminar(201);

    expect(screen.getByText(A.carregarTitulo)).toBeInTheDocument();
    expect(screen.queryByText(A.vazioTitulo)).toBeNull();
    expect(botoesEliminar()).toEqual([]);
    expect(miniaturas()).toEqual([]);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("com 23 fotos e 8 visíveis, eliminar uma faz ENTRAR a seguinte (mostram-se sempre 8) e o total desce", async () => {
    prepararApi(filaDeTeste(3), muitasAprovadas(23));
    await abrirGaleria();
    expect(idsDasAprovadas()).toEqual([23, 22, 21, 20, 19, 18, 17, 16]);

    await eliminar(22);

    expect(idsDasAprovadas()).toEqual([23, 21, 20, 19, 18, 17, 16, 15]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(22));
    expect(within(aprovadas()).getByText(A.aMostrar(8, 22))).toBeInTheDocument();
    expect(document.activeElement).toBe(h2DasAprovadas());
  });

  it("com 9 fotos, eliminar uma deixa 8: a nota e o botão desaparecem", async () => {
    prepararApi(filaDeTeste(3), muitasAprovadas(9));
    await abrirGaleria();

    await eliminar(9);

    expect(itensDasAprovadas()).toHaveLength(8);
    expect(screen.queryByText(/^A mostrar /)).toBeNull();
    expect(haBotaoDaSeccao(A.mostrarMais)).toBe(false);
  });
});

describe("500 (e outros estados em que o servidor respondeu): o erro vive DENTRO da folha (7.3)", () => {
  it.each([500, 403, 422] as const)(
    "%i: a folha fica aberta, os botões voltam ao normal, o erro está dentro dela (`status`, `text-erro`) e a foto fica",
    async (estado) => {
      await abrirGaleria();
      await abrirFolhaDeEliminar(202);
      eliminarFalso.mockRejectedValueOnce(erroDoEliminar(estado));

      await tocar(confirmarEliminar());

      expect(haFolhaDeEliminar()).toBe(true);
      const erro = within(folhaDeEliminar()).getByText(A.erroNaFolha);
      expect(erro.closest('[role="status"]')).not.toBeNull();
      expect(erro.className).toMatch(/text-erro/);
      expect(confirmarEliminar()).toHaveTextContent(new RegExp(`^${A.eliminar}$`));
      expect(confirmarEliminar()).not.toHaveAttribute("aria-disabled", "true");
      expect(cancelarEliminar()).not.toHaveAttribute("aria-disabled", "true");
      expect(idsDasAprovadas()).toEqual([201, 202, 203]);
      expect(aviso()).toBeNull();
      expect(document.body.textContent).not.toContain("MENSAGEM-DO-BACKEND");
      expect(eliminarFalso, "nunca repete sozinho").toHaveBeenCalledTimes(1);
      expect(aprovadasFalso, "um 500 não relê").toHaveBeenCalledTimes(1);
    },
  );

  it("não se diz «a foto não foi eliminada» (não descreve o que o 500 garante)", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(500));
    await tocar(confirmarEliminar());
    expect(folhaDeEliminar().textContent).not.toMatch(/não foi eliminada/i);
  });

  it("tocar outra vez em «Eliminar» é SEGURO: o segundo pedido avança e, com 204, fecha a folha e a foto sai", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(500));
    await tocar(confirmarEliminar());

    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(2);
    expect(haFolhaDeEliminar()).toBe(false);
    expect(idsDasAprovadas()).toEqual([201, 203]);
    expect(aviso()).toHaveTextContent(A.avisoEliminada);
  });

  it("cancelar depois do erro fecha a folha, e reabri-la não traz o erro de volta", async () => {
    await abrirGaleria();
    await abrirFolhaDeEliminar(202);
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(500));
    await tocar(confirmarEliminar());

    await tocar(cancelarEliminar());
    await abrirFolhaDeEliminar(202);

    expect(screen.queryByText(A.erroNaFolha)).toBeNull();
  });
});

describe("404: já não existe (8.2)", () => {
  it("a folha fecha, a foto sai da lista, o <h2> perde um, o foco vai ao <h2>; «Essa foto já não existia.» é informação (sem vermelho, sem «Feito.»)", async () => {
    await abrirGaleria();
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(404));

    await eliminar(202);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(idsDasAprovadas()).toEqual([201, 203]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(2));
    expect(document.activeElement).toBe(h2DasAprovadas());
    const linha = linhaDasAprovadas(A.jaNaoExistia);
    expect(linha, "na linha de estado da secção").not.toBeNull();
    expect(linha?.className).not.toMatch(/text-erro/);
    expect(linha?.getAttribute("role")).toBe("status");
    expect(aviso(), "não foi este pedido: nada de «Feito.» nem «Foto eliminada.»").toBeNull();
    expect(textoDasAprovadas()).not.toContain(A.avisoEliminada);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("404 na última foto: um GET antes de dizer «vazio»", async () => {
    prepararApi(filaDeTeste(3), aprovadasDeTeste(1));
    await abrirGaleria();
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(404));
    aprovadasFalso.mockResolvedValueOnce({ fotos: [] });

    await eliminar(201);

    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
    expect(screen.getByText(A.vazioTitulo)).toBeInTheDocument();
  });

  it("a linha de estado desaparece ao eliminar outra foto (uma mensagem nova substitui a anterior)", async () => {
    await abrirGaleria();
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(404));
    await eliminar(202);
    expect(linhaDasAprovadas(A.jaNaoExistia)).not.toBeNull();

    await eliminar(203);

    expect(linhaDasAprovadas(A.jaNaoExistia)).toBeNull();
    expect(aviso()).toHaveTextContent(A.avisoEliminada);
  });
});

describe("409: já não está aprovada (8.3)", () => {
  beforeEach(() => {
    eliminarFalso.mockRejectedValue(erroDoEliminar(409));
  });

  it("a folha fecha, a secção relê EM SILÊNCIO (sem esqueleto), a foto sai porque o GET já não a devolve, «Essa foto já não está no site.», foco no <h2>", async () => {
    await abrirGaleria();
    const releitura = pendente<Lista>();
    aprovadasFalso.mockReturnValueOnce(releitura.promessa);

    await eliminar(202);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
    expect(aprovadas().querySelector('[aria-busy="true"]'), "em silêncio").toBeNull();
    expect(idsDasAprovadas(), "nada sai antes de o GET chegar").toEqual([201, 202, 203]);

    releitura.resolver(semAFoto(202));
    await assentar();

    expect(idsDasAprovadas()).toEqual([201, 203]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(2));
    const linha = linhaDasAprovadas(A.jaNaoEstaNoSite);
    expect(linha).not.toBeNull();
    expect(linha?.className).not.toMatch(/text-erro/);
    expect(document.activeElement).toBe(h2DasAprovadas());
    expect(aviso()).toBeNull();
    expect(eliminarFalso, "nunca repete").toHaveBeenCalledTimes(1);
  });

  it("se esse GET falhar, vale a leitura silenciosa que falha: a lista MANTÉM-SE e diz que pode estar desatualizada", async () => {
    await abrirGaleria();
    aprovadasFalso.mockRejectedValueOnce(erroSemResposta());

    await eliminar(202);

    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
    expect(linhaDasAprovadas(A.desatualizada)).not.toBeNull();
    expect(haBotaoDaSeccao(A.tentarOutraVez)).toBe(true);
    expect(screen.queryByText(A.vazioTitulo)).toBeNull();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("401: login, e nenhum DELETE se repete (8.1)", () => {
  it("o 401 do DELETE: aoPerderSessao, um só DELETE, nenhuma frase de erro na folha nem na secção", async () => {
    const sessao = await abrirGaleria();
    eliminarFalso.mockRejectedValueOnce(erro401());

    await eliminar(202);

    expect(sessao.aoPerderSessao).toHaveBeenCalled();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(A.erroNaFolha)).toBeNull();
    expect(screen.queryByText(A.jaNaoExistia)).toBeNull();
    expect(aviso()).toBeNull();
  });

  it("o 401 da verificação (depois de um «sem resposta») também leva ao login, sem segundo DELETE", async () => {
    const sessao = await abrirGaleria();
    eliminarFalso.mockRejectedValueOnce(erroSemResposta());
    aprovadasFalso.mockRejectedValueOnce(erro401());

    await eliminar(202);

    expect(sessao.aoPerderSessao).toHaveBeenCalled();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("sem resposta: «não sei», nunca repetir o DELETE (8.4, critério 6)", () => {
  beforeEach(() => {
    eliminarFalso.mockRejectedValue(erroSemResposta());
  });

  it("a folha fecha e a linha diz «A verificar…»; o «Eliminar» DESSE item fica inerte e os outros não; um GET da lista", async () => {
    await abrirGaleria();
    const verificacao = pendente<Lista>();
    aprovadasFalso.mockReturnValueOnce(verificacao.promessa);

    await eliminar(202);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(linhaDasAprovadas(A.aVerificar)).not.toBeNull();
    expect(inerte(eliminarDe(202))).toBe(true);
    expect(inerte(eliminarDe(201))).toBe(false);
    expect(inerte(eliminarDe(203))).toBe(false);
    expect(aprovadasFalso, "um GET de verificação").toHaveBeenCalledTimes(2);
    expect(aprovadasFalso).toHaveBeenLastCalledWith(comSinal);
    expect(eliminarFalso, "UM DELETE").toHaveBeenCalledTimes(1);
    expect(aviso(), "ainda não se sabe: nada de «Foto eliminada.»").toBeNull();
  });

  it("a foto JÁ NÃO ESTÁ: foi eliminada. Aviso «Foto eliminada.», sai da lista, foco no <h2>; a lista fica em dia (traz as outras)", async () => {
    await abrirGaleria();
    const nova = { ...aprovadasDeTeste(1)[0], id: 210, ficheiro: "foto-210.webp" } as FotoAprovada;
    aprovadasFalso.mockResolvedValueOnce({ fotos: [nova, ...semAFoto(202).fotos] });

    await eliminar(202);

    expect(aviso()).toHaveTextContent(A.avisoEliminada);
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(idsDasAprovadas()).toEqual([210, 201, 203]);
    expect(h2DasAprovadas()).toHaveTextContent(A.tituloN(3));
    expect(document.activeElement).toBe(h2DasAprovadas());
    expect(linhaDasAprovadas(A.aVerificar)).toBeNull();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("a foto CONTINUA: «Não consegui eliminar. Verifica a ligação e tenta outra vez.» e o «Eliminar» volta; tocar de novo é seguro", async () => {
    await abrirGaleria();

    await eliminar(202);

    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
    expect(linhaDasAprovadas(A.continuaSemResposta)).not.toBeNull();
    expect(inerte(eliminarDe(202))).toBe(false);
    expect(aviso()).toBeNull();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);

    // A decisão de repetir é do dono: um novo toque, uma nova confirmação.
    eliminarFalso.mockResolvedValueOnce(undefined);
    await abrirFolhaDeEliminar(202);
    await tocar(confirmarEliminar());
    expect(eliminarFalso).toHaveBeenCalledTimes(2);
    expect(idsDasAprovadas()).toEqual([201, 203]);
  });

  it("se o pedido antigo ainda chegar, o segundo dá 404 e trata-se como 8.2", async () => {
    await abrirGaleria();
    await eliminar(202);
    eliminarFalso.mockRejectedValueOnce(erroDoEliminar(404));

    await abrirFolhaDeEliminar(202);
    await tocar(confirmarEliminar());

    expect(idsDasAprovadas()).toEqual([201, 203]);
    expect(linhaDasAprovadas(A.jaNaoExistia)).not.toBeNull();
  });

  describe("o GET de verificação também falha", () => {
    beforeEach(async () => {
      await abrirGaleria();
      aprovadasFalso.mockRejectedValueOnce(erroSemResposta());
      await eliminar(202);
    });

    it("linha «…toca em Verificar outra vez.» com o botão «Verificar outra vez»; o «Eliminar» desse item inerte; a lista mantém-se (nunca «vazio»)", () => {
      expect(linhaDasAprovadas(A.semConfirmar)).not.toBeNull();
      expect(botaoDaSeccao(A.verificarOutraVez)).toBeInTheDocument();
      expect(inerte(eliminarDe(202))).toBe(true);
      expect(inerte(eliminarDe(201))).toBe(false);
      expect(idsDasAprovadas()).toEqual([201, 202, 203]);
      expect(screen.queryByText(A.vazioTitulo)).toBeNull();
      expect(eliminarFalso).toHaveBeenCalledTimes(1);
    });

    it("«Verificar outra vez» repete a VERIFICAÇÃO, NUNCA o DELETE: a foto já não está, é «eliminada»", async () => {
      aprovadasFalso.mockResolvedValueOnce(semAFoto(202));

      await tocar(botaoDaSeccao(A.verificarOutraVez));

      expect(eliminarFalso, "nunca o DELETE").toHaveBeenCalledTimes(1);
      expect(aprovadasFalso).toHaveBeenCalledTimes(3);
      expect(aviso()).toHaveTextContent(A.avisoEliminada);
      expect(idsDasAprovadas()).toEqual([201, 203]);
      expect(document.activeElement).toBe(h2DasAprovadas());
      expect(haBotaoDaSeccao(A.verificarOutraVez)).toBe(false);
    });

    it("«Verificar outra vez» e a foto continua: «Não consegui eliminar. Verifica a ligação…» e o «Eliminar» volta", async () => {
      await tocar(botaoDaSeccao(A.verificarOutraVez));

      expect(eliminarFalso).toHaveBeenCalledTimes(1);
      expect(linhaDasAprovadas(A.continuaSemResposta)).not.toBeNull();
      expect(inerte(eliminarDe(202))).toBe(false);
      expect(haBotaoDaSeccao(A.verificarOutraVez)).toBe(false);
    });

    it("«Verificar outra vez» que volta a falhar fica igual (e continua sem tocar no DELETE)", async () => {
      aprovadasFalso.mockRejectedValueOnce(erroSemResposta());

      await tocar(botaoDaSeccao(A.verificarOutraVez));

      expect(linhaDasAprovadas(A.semConfirmar)).not.toBeNull();
      expect(inerte(eliminarDe(202))).toBe(true);
      expect(eliminarFalso).toHaveBeenCalledTimes(1);
      expect(idsDasAprovadas()).toEqual([201, 202, 203]);
    });

    it("«Verificar outra vez» em curso: um segundo toque não faz um segundo GET", async () => {
      const verificacao = pendente<Lista>();
      aprovadasFalso.mockReturnValueOnce(verificacao.promessa);

      await tocar(botaoDaSeccao(A.verificarOutraVez));
      const emCurso = aprovadasFalso.mock.calls.length;
      await tocar(
        within(aprovadas())
          .queryAllByRole("button")
          .find((b) => inerte(b)) ?? botaoDaSeccao(A.verificarOutraVez),
      );

      expect(aprovadasFalso.mock.calls.length).toBe(emCurso);
      expect(eliminarFalso).toHaveBeenCalledTimes(1);
    });
  });

  it("o último item, sem resposta e o GET diz que a lista está vazia: «Foto eliminada.» e o estado vazio", async () => {
    prepararApi(filaDeTeste(3), aprovadasDeTeste(1));
    await abrirGaleria();
    eliminarFalso.mockRejectedValue(erroSemResposta());
    aprovadasFalso.mockResolvedValueOnce({ fotos: [] });

    await eliminar(201);

    expect(aviso()).toHaveTextContent(A.avisoEliminada);
    expect(screen.getByText(A.vazioTitulo)).toBeInTheDocument();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("o último item, sem resposta e o GET falha: nunca «vazio» e nunca se perde a foto da lista", async () => {
    prepararApi(filaDeTeste(3), aprovadasDeTeste(1));
    await abrirGaleria();
    eliminarFalso.mockRejectedValue(erroSemResposta());
    aprovadasFalso.mockRejectedValueOnce(erroSemResposta());

    await eliminar(201);

    expect(screen.queryByText(A.vazioTitulo)).toBeNull();
    expect(idsDasAprovadas()).toEqual([201]);
    expect(inerte(eliminarDe(201))).toBe(true);
    expect(linhaDasAprovadas(A.semConfirmar)).not.toBeNull();
  });

  it("o prazo de 10 s: o DELETE abortado dispara a mesma verificação (um DELETE, um GET)", async () => {
    await abrirGaleria();
    eliminarFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirFolhaDeEliminar(202);
    await tocar(confirmarEliminar());

    await avancar(10_000);

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(aprovadasFalso).toHaveBeenCalledTimes(2);
    expect(linhaDasAprovadas(A.continuaSemResposta)).not.toBeNull();
    expect(idsDasAprovadas()).toEqual([201, 202, 203]);
  });
});
