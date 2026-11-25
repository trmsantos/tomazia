/**
 * F4-05b, `docs/ecras/F4-05b.md` secção 7 e critérios 8, 9, 10 e 11 — eliminar um cliente: a folha
 * «Tem a certeza?» (abre sem pedido, foco em «Cancelar»), o `DELETE` (um por confirmação, a folha
 * não fecha a meio), o `204` (aviso, número, foco no <h2>) e tudo o que não corre bem: 5xx
 * (erro **dentro** da folha), 404, 401 e o **sem resposta**.
 *
 * **Regra 10, o coração desta tarefa:** um `DELETE` sem resposta é «não sei». O ecrã **nunca**
 * repete o `DELETE` por conta própria (nem a «Verificar outra vez»), relê a lista e diz o que
 * encontrou; o cliente **fica na lista** durante a verificação; um erro nunca é «eliminado», e uma
 * falha ao reler nunca é «não há clientes». Só um `404` **com** `cliente_inexistente` é «já não
 * existia»: um `404` sem código é um erro como outro. Cada ramo conta os pedidos.
 *
 * **Deixa passar:** os 44 px, o anel de foco e a folha a caber no ecrã (e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clienteDeTeste,
  clientesDeTeste,
  duasAnas,
  muitosClientes,
} from "../../../testes/clientes-dados";
import {
  MENSAGEM_DO_BACKEND,
  T,
  abrirClientes,
  abrirFolhaDeEliminar,
  assentar,
  aviso,
  avancar,
  botaoDaPagina,
  botoesEliminar,
  cancelarEliminar,
  comSinal,
  confirmarEliminar,
  csvFalso,
  eliminar,
  eliminarDe,
  eliminarFalso,
  erroDe,
  erroSemResposta,
  esqueletos,
  fecharDaFolha,
  ficarPendenteAteAbortar,
  folhaDeEliminar,
  h2,
  haBotaoDaPagina,
  haEsqueleto,
  haFolhaDeEliminar,
  haItemDe,
  inerte,
  linhaDeEstado,
  nomesNaLista,
  obterFalso,
  pendente,
  prepararApi,
  principal,
  desmontarOEcra,
  tocar,
  tocarDuasVezes,
  voltarAAba,
  type ClienteGestao,
} from "../../../testes/clientes-gestao";

vi.mock("../../../lib/api/gestao-clientes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/gestao-clientes")>()),
  obterClientes: vi.fn(),
  eliminarCliente: vi.fn(),
  descarregarClientesCsv: vi.fn(),
}));

beforeEach(() => {
  prepararApi(clientesDeTeste());
});

const ANA = "Ana Exemplo";
const RUI = "Rui Teste";

function semOCliente(...ids: number[]): { clientes: ClienteGestao[] } {
  return { clientes: clientesDeTeste().filter((c) => !ids.includes(c.id)) };
}
function esc(): void {
  fireEvent(folhaDeEliminar(), new Event("cancel", { cancelable: true }));
}
function nenhumEliminarTemFoco(): void {
  for (const b of botoesEliminar()) expect(document.activeElement).not.toBe(b);
}
/** A lista tem só a Ana (para o ramo «o último»). */
function soAAna(): void {
  prepararApi([clientesDeTeste()[0] as ClienteGestao]);
}

describe("a folha «Tem a certeza?» (7.1, critério 8)", () => {
  it("«Eliminar» abre a folha SEM pedido nenhum e sem aviso", async () => {
    await abrirClientes();
    const antes = obterFalso.mock.calls.length;

    await abrirFolhaDeEliminar(ANA);

    expect(haFolhaDeEliminar()).toBe(true);
    expect(eliminarFalso).not.toHaveBeenCalled();
    expect(csvFalso).not.toHaveBeenCalled();
    expect(obterFalso.mock.calls.length).toBe(antes);
    expect(aviso()).toBeNull();
  });

  it("o nome acessível da folha é exatamente «Tem a certeza?» (sem dados pessoais)", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    expect(screen.getByRole("dialog", { name: T.tituloDaFolha })).toBe(folhaDeEliminar());
  });

  it("mostra o nome e o email do cliente CERTO, a consequência e a linha do CSV, por esta ordem", async () => {
    await abrirClientes();
    const f = await abrirFolhaDeEliminar(RUI);

    const texto = f.textContent ?? "";
    expect(texto).toContain("Rui Teste");
    expect(texto).toContain("rui@exemplo.test");
    expect(texto).toContain(T.consequencia);
    expect(texto).toContain(T.linhaDoCsv);
    const posicoes = ["Rui Teste", "rui@exemplo.test", T.consequencia, T.linhaDoCsv].map((t) =>
      texto.indexOf(t),
    );
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(texto).not.toMatch(/apagad|remov|deletar/i);
  });

  it("NÃO mostra o telemóvel (nem o consentimento): é mais um dado de terceiros num ecrã de balcão", async () => {
    await abrirClientes();
    const f = await abrirFolhaDeEliminar(ANA);
    expect(f.textContent).not.toContain("912345678");
    expect(f.textContent).not.toMatch(/Consentimento/);
  });

  it("duas «Anas»: o email na folha é o que distingue (a segunda abre com o email dela)", async () => {
    prepararApi(duasAnas());
    await abrirClientes();
    const botoes = botoesEliminar();
    expect(botoes).toHaveLength(2);

    await tocar(botoes[1] as HTMLElement);
    expect(folhaDeEliminar()).toHaveTextContent("ana.dois@exemplo.test");
    expect(folhaDeEliminar()).not.toHaveTextContent("ana.um@exemplo.test");
  });

  it("a linha do CSV é discreta (`text-nota text-texto-suave`) e a frase da consequência vem antes", async () => {
    await abrirClientes();
    const f = await abrirFolhaDeEliminar(ANA);
    const linha = within(f).getByText(T.linhaDoCsv);
    expect(linha.className).toMatch(/text-nota/);
    expect(linha.className).toMatch(/text-texto-suave/);
    expect(
      within(f).getByText(T.consequencia).compareDocumentPosition(linha) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("o nome e o email são texto (HTML não vira elemento) e a folha não tem ligações `mailto:`", async () => {
    prepararApi([clienteDeTeste({ id: 7, nome: "<b>x</b>", email: "<i>y</i>@exemplo.test" })]);
    await abrirClientes();
    const f = await abrirFolhaDeEliminar("<b>x</b>");
    expect(f.querySelector("b, i, a")).toBeNull();
  });

  it("«Eliminar» é o único vermelho (`bg-perigo`); «Cancelar» não; a folha não tem dourado", async () => {
    await abrirClientes();
    const f = await abrirFolhaDeEliminar(ANA);

    expect(confirmarEliminar().className).toMatch(/bg-perigo/);
    expect(cancelarEliminar().className).not.toMatch(/bg-perigo/);
    for (const b of within(f).getAllByRole("button")) {
      expect(b.className, "o dourado confirmava uma destruição").not.toMatch(/bg-acao/);
    }
  });

  it("o foco COMEÇA em «Cancelar», a ação segura", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    expect(document.activeElement).toBe(cancelarEliminar());
  });

  it("os botões da folha: o «×» (da Folha partilhada), «Eliminar» e «Cancelar», este com largura total", async () => {
    await abrirClientes();
    const f = await abrirFolhaDeEliminar(ANA);
    const nomes = within(f)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
    expect(nomes.slice(1)).toEqual([T.eliminar, T.cancelar]);
    expect(within(f).getAllByRole("button")[0]).toBe(fecharDaFolha());
    expect(confirmarEliminar().className).toMatch(/w-full/);
    expect(cancelarEliminar().className).toMatch(/w-full/);
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
    ["o «×»", async () => tocar(fecharDaFolha())],
    ["a cortina (o próprio <dialog>)", async () => tocar(folhaDeEliminar())],
  ])(
    "%s fecha SEM pedido, o cliente fica e o foco volta ao «Eliminar» desse item",
    async (_nome, fecharFolha) => {
      await abrirClientes();
      await abrirFolhaDeEliminar(RUI);

      await fecharFolha();

      expect(haFolhaDeEliminar()).toBe(false);
      expect(eliminarFalso).not.toHaveBeenCalled();
      expect(nomesNaLista()).toEqual(clientesDeTeste().map((c) => c.nome));
      expect(aviso()).toBeNull();
      expect(document.activeElement).toBe(eliminarDe(RUI));
    },
  );

  it("depois de cancelar pode abrir-se outra vez, e confirmar faz UM pedido", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    await tocar(cancelarEliminar());

    await abrirFolhaDeEliminar(ANA);
    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("uma releitura que chega com a folha aberta NÃO a fecha nem a muda; se o cliente já não vem, o DELETE responde 404 (7.5)", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    obterFalso.mockResolvedValueOnce(semOCliente(101));

    await voltarAAba();

    expect(haFolhaDeEliminar(), "a folha mantém-se").toBe(true);
    expect(folhaDeEliminar()).toHaveTextContent("ana@exemplo.test");
    expect(haItemDe(ANA), "a lista já não o tem").toBe(false);

    eliminarFalso.mockRejectedValueOnce(erroDe(404, "cliente_inexistente"));
    await tocar(confirmarEliminar());

    expect(haFolhaDeEliminar()).toBe(false);
    expect(linhaDeEstado(T.jaNaoExistia)).not.toBeNull();
  });
});

describe("a eliminar (7.2, critérios 9)", () => {
  it("UM DELETE com o id e o sinal; «A eliminar…» (aria-busy, aria-disabled); «Cancelar» e «×» inertes; nada otimista", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    const resposta = pendente<undefined>();
    eliminarFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledWith(101, comSinal);
    const ocupado = within(folhaDeEliminar()).getByRole("button", { name: T.aEliminar });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    expect(cancelarEliminar()).toHaveAttribute("aria-disabled", "true");
    expect(fecharDaFolha()).toHaveAttribute("aria-disabled", "true");
    expect(haItemDe(ANA), "o cliente só sai depois da resposta").toBe(true);
  });

  it("a folha NÃO fecha a meio: nem «Cancelar», nem «×», nem `Esc`, nem a cortina; depois da resposta fecha", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    const resposta = pendente<undefined>();
    eliminarFalso.mockReturnValueOnce(resposta.promessa);
    await tocar(confirmarEliminar());

    await tocar(cancelarEliminar());
    await tocar(fecharDaFolha());
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
    await abrirClientes();
    await abrirFolhaDeEliminar(ANA);
    eliminarFalso.mockReturnValueOnce(pendente<undefined>().promessa);

    await tocarDuasVezes(confirmarEliminar());
    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("o prazo é de 10 s: passados 10 s sem resposta o DELETE foi abortado (ramo «sem resposta»)", async () => {
    await abrirClientes();
    eliminarFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirFolhaDeEliminar(ANA);
    await tocar(confirmarEliminar());
    await avancar(9_999);
    expect(haFolhaDeEliminar(), "ainda à espera").toBe(true);

    const verificacao = pendente<{ clientes: ClienteGestao[] }>();
    obterFalso.mockReturnValueOnce(verificacao.promessa);

    await avancar(1);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(haItemDe(ANA), "sem palpites: o cliente fica").toBe(true);
    expect(linhaDeEstado(T.aVerificar)).not.toBeNull();

    verificacao.resolver(semOCliente(101));
    await assentar();
    expect(haItemDe(ANA)).toBe(false);
  });

  it("desmontar a meio aborta o DELETE e NÃO dispara uma verificação", async () => {
    await abrirClientes();
    let sinal: AbortSignal | undefined;
    eliminarFalso.mockImplementationOnce((_id, opcoes) => {
      sinal = opcoes?.sinal;
      return new Promise((_c, falhar) => {
        sinal?.addEventListener("abort", () => {
          falhar(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    await abrirFolhaDeEliminar(ANA);
    await tocar(confirmarEliminar());
    const gets = obterFalso.mock.calls.length;

    await desmontarOEcra();
    await assentar();

    expect(sinal?.aborted).toBe(true);
    expect(obterFalso.mock.calls.length).toBe(gets);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("204: sucesso (7.3, critério 10)", () => {
  it("a folha fecha, o cliente sai, o número do <h2> desce e o aviso diz «Cliente eliminado.»", async () => {
    await abrirClientes();
    expect(h2()).toHaveTextContent(T.h2N(4));

    await eliminar(ANA);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(haItemDe(ANA)).toBe(false);
    expect(nomesNaLista()).toHaveLength(3);
    expect(h2()).toHaveTextContent(T.h2N(3));
    expect(aviso()?.textContent).toMatch(/^\s*Feito\.\s*Cliente eliminado\.\s*×?\s*$/);
    expect(aviso()?.getAttribute("role")).toBe("status");
  });

  it("o aviso dura 3 s (nem 2,9 nem 4)", async () => {
    await abrirClientes();
    await eliminar(ANA);
    await avancar(2_999);
    expect(aviso()).not.toBeNull();
    await avancar(1);
    expect(aviso()).toBeNull();
  });

  it("SEM «Desfazer» (não há como: dados apagados)", async () => {
    await abrirClientes();
    await eliminar(ANA);
    expect(screen.queryByRole("button", { name: /desfazer/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/desfazer/i);
  });

  it("o foco vai ao <h2> (tabindex -1) e NUNCA a um «Eliminar» do item seguinte", async () => {
    await abrirClientes();
    await eliminar(ANA);

    expect(document.activeElement).toBe(h2());
    nenhumEliminarTemFoco();
  });

  it("com a lista ainda não vazia, NÃO há outro GET (a lista local é a verdade; o resto é a releitura da aba)", async () => {
    await abrirClientes();
    obterFalso.mockClear();
    await eliminar(ANA);
    expect(obterFalso).not.toHaveBeenCalled();
  });

  it("os outros clientes ficam, pela mesma ordem", async () => {
    await abrirClientes();
    await eliminar(RUI);
    expect(nomesNaLista()).toEqual(
      clientesDeTeste()
        .filter((c) => c.id !== 102)
        .map((c) => c.nome),
    );
  });

  it("depois de eliminar pode eliminar-se outro (um DELETE por confirmação)", async () => {
    await abrirClientes();
    await eliminar(ANA);
    await eliminar(RUI);
    expect(eliminarFalso.mock.calls.map((c) => c[0])).toEqual([101, 102]);
    expect(nomesNaLista()).toHaveLength(2);
  });

  it("o último eliminado faz UM `GET` antes de dizer «Não há clientes registados.»", async () => {
    soAAna();
    await abrirClientes();
    const resposta = pendente<{ clientes: ClienteGestao[] }>();
    obterFalso.mockReturnValueOnce(resposta.promessa);
    obterFalso.mockClear();

    await eliminar(ANA);

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(screen.queryByText(T.vazioTitulo), "ainda não se sabe: o GET não chegou").toBeNull();
    expect(haEsqueleto()).toBe(true);
    expect(botoesEliminar()).toHaveLength(0);

    resposta.resolver({ clientes: [] });
    await assentar();

    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
    expect(screen.getByText(T.vazioLinha)).toBeInTheDocument();
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(haBotaoDaPagina(T.exportar)).toBe(false);
    expect(h2()).toHaveTextContent(new RegExp(`^${T.h2}$`));
  });

  it("…e o foco vai ao título do estado vazio (não a um botão, não ao <body>)", async () => {
    soAAna();
    await abrirClientes();
    obterFalso.mockResolvedValueOnce({ clientes: [] });

    await eliminar(ANA);

    const focado = document.activeElement as HTMLElement;
    expect(focado).not.toBe(document.body);
    expect(principal()).toContainElement(focado);
    expect(focado.tagName).not.toBe("BUTTON");
    // «O título do estado»: o <h2> da secção (que o `EstadoVazio` não deixa focar) ou o do vazio.
    expect(focado === h2() || (focado.textContent ?? "").includes(T.vazioTitulo)).toBe(true);
  });

  it("o último eliminado e o GET FALHA: é o erro de carregar, o cliente eliminado NÃO volta e nunca se diz «vazio»", async () => {
    soAAna();
    await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    await eliminar(ANA);

    expect(screen.getByText(T.erroTitulo)).toBeInTheDocument();
    expect(screen.getByText(T.erroSemResposta)).toBeInTheDocument();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    expect(haItemDe(ANA)).toBe(false);
    expect(botoesEliminar()).toHaveLength(0);
    expect(document.activeElement).not.toBe(document.body);
    expect(principal()).toContainElement(document.activeElement as HTMLElement);
  });

  it("o último eliminado e o GET dá 5xx: o erro do servidor, nunca o vazio", async () => {
    soAAna();
    await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroDe(500));

    await eliminar(ANA);

    expect(screen.getByText(T.erroServidor)).toBeInTheDocument();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
  });

  it("o último eliminado e o GET já traz OUTROS clientes (de outro aparelho): mostra-os", async () => {
    soAAna();
    await abrirClientes();
    obterFalso.mockResolvedValueOnce({
      clientes: [clienteDeTeste({ id: 55, nome: "Outra Pessoa" })],
    });

    await eliminar(ANA);

    expect(nomesNaLista()).toEqual(["Outra Pessoa"]);
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
  });
});

describe("404: já não existia (7.5)", () => {
  it("SÓ com `cliente_inexistente`: a folha fecha, o cliente sai, foco no <h2>, «Esse cliente já não existia.» — sem «Feito.» e sem vermelho", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(404, "cliente_inexistente"));

    await eliminar(ANA);

    expect(haFolhaDeEliminar()).toBe(false);
    expect(haItemDe(ANA)).toBe(false);
    expect(h2()).toHaveTextContent(T.h2N(3));
    const linha = linhaDeEstado(T.jaNaoExistia);
    expect(linha).not.toBeNull();
    expect(linha?.className, "é informação, não um erro").not.toMatch(/text-erro/);
    expect(aviso(), "sem «Feito.»: não foi este pedido").toBeNull();
    expect(document.body.textContent).not.toMatch(/Cliente eliminado\./);
    expect(document.activeElement).toBe(h2());
    nenhumEliminarTemFoco();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("e se a lista ficou vazia, um GET antes de dizer «Não há clientes registados.» (como em 7.3)", async () => {
    soAAna();
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(404, "cliente_inexistente"));
    const resposta = pendente<{ clientes: ClienteGestao[] }>();
    obterFalso.mockReturnValueOnce(resposta.promessa);
    obterFalso.mockClear();

    await eliminar(ANA);

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    resposta.resolver({ clientes: [] });
    await assentar();
    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
  });

  it("um 404 SEM o código (um proxy, um Apache) é um erro como outro: a folha fica, o cliente fica, nada de «já não existia»", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(404, null));

    await eliminar(ANA);

    expect(haFolhaDeEliminar()).toBe(true);
    expect(within(folhaDeEliminar()).getByText(T.erroNaFolha)).toBeInTheDocument();
    expect(haItemDe(ANA)).toBe(true);
    expect(linhaDeEstado(T.jaNaoExistia)).toBeNull();
    expect(document.body.textContent).not.toContain(T.jaNaoExistia);
  });

  it("um 404 com OUTRO código também não é «já não existia»", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(404, "foto_nao_encontrada"));
    await eliminar(ANA);
    expect(haFolhaDeEliminar()).toBe(true);
    expect(haItemDe(ANA)).toBe(true);
    expect(linhaDeEstado(T.jaNaoExistia)).toBeNull();
  });

  it("um cliente que outro aparelho já eliminou: outro código diferente de 404 (ex.: 409) não o tira da lista", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(409, "cliente_inexistente"));
    await eliminar(ANA);
    expect(haItemDe(ANA), "só o ESTADO 404 com o código é «já não existia»").toBe(true);
  });
});

describe("5xx, 403, 422: o erro dentro da folha (7.4)", () => {
  it.each([500, 502, 503, 403, 422])(
    "%i: a folha mantém-se, os botões voltam, a frase certa em role=status, o cliente FICA",
    async (estado) => {
      await abrirClientes();
      eliminarFalso.mockRejectedValueOnce(
        erroDe(estado, estado === 422 ? "dados_invalidos" : null),
      );

      await eliminar(ANA);

      const f = folhaDeEliminar();
      const linha = within(f).getByText(T.erroNaFolha);
      expect(linha.closest('[role="status"]') ?? linha).toHaveAttribute("role", "status");
      expect(linha.className).toMatch(/text-erro/);
      expect(haItemDe(ANA)).toBe(true);
      expect(nomesNaLista()).toHaveLength(4);
      expect(confirmarEliminar()).toHaveTextContent(new RegExp(`^${T.eliminar}$`));
      expect(inerte(confirmarEliminar())).toBe(false);
      expect(inerte(cancelarEliminar())).toBe(false);
      expect(inerte(fecharDaFolha())).toBe(false);
      expect(aviso()).toBeNull();
      expect(eliminarFalso).toHaveBeenCalledTimes(1);
    },
  );

  it("nunca mostra a `mensagem` do backend nem o id", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(500));
    await eliminar(ANA);
    expect(document.body.textContent).not.toContain(MENSAGEM_DO_BACKEND);
    expect(folhaDeEliminar().textContent).not.toMatch(/\b101\b/);
  });

  it("repetir é seguro e é decisão do dono: outro toque em «Eliminar» faz o segundo DELETE e, agora com 204, resolve", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(500));
    await eliminar(ANA);

    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(2);
    expect(haFolhaDeEliminar()).toBe(false);
    expect(haItemDe(ANA)).toBe(false);
  });

  it("depois do erro, «Cancelar» fecha sem novo pedido e o cliente fica", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(500));
    await eliminar(ANA);

    await tocar(cancelarEliminar());

    expect(haFolhaDeEliminar()).toBe(false);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(haItemDe(ANA)).toBe(true);
  });
});

describe("401 (5.6)", () => {
  it("o DELETE dá 401: aoPerderSessao UMA vez, nenhuma mensagem de erro, e o DELETE NUNCA se repete", async () => {
    const sessao = await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(401));

    await eliminar(ANA);
    await avancar(60_000);
    await voltarAAba();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(T.erroNaFolha);
    expect(document.body.textContent).not.toContain(T.jaNaoExistia);
  });
});

describe("sem resposta: «não sei se foi eliminado» (7.6, critério 11, regra 10)", () => {
  async function semResposta(nome = ANA): Promise<void> {
    eliminarFalso.mockRejectedValueOnce(erroSemResposta());
    await eliminar(nome);
  }

  it("UM DELETE; a folha fecha; o cliente FICA na lista; a linha diz «A verificar…»; só o «Eliminar» dele fica inerte", async () => {
    await abrirClientes();
    const verificacao = pendente<{ clientes: ClienteGestao[] }>();
    obterFalso.mockReturnValueOnce(verificacao.promessa);

    await semResposta();

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(haFolhaDeEliminar()).toBe(false);
    expect(haItemDe(ANA), "nunca sai por palpite").toBe(true);
    expect(linhaDeEstado(T.aVerificar)).not.toBeNull();
    expect(inerte(eliminarDe(ANA))).toBe(true);
    for (const outro of [RUI]) expect(inerte(eliminarDe(outro))).toBe(false);
    expect(aviso(), "nada de «eliminado» sem o saber").toBeNull();
    expect(h2()).toHaveTextContent(T.h2N(4));
  });

  it("faz UM GET de verificação (com o sinal) e o DELETE não se repete sozinho", async () => {
    await abrirClientes();
    obterFalso.mockClear();

    await semResposta();
    await avancar(60_000);

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("o cliente JÁ NÃO ESTÁ: foi eliminado — aviso «Cliente eliminado.», sai da lista, foco no <h2>", async () => {
    await abrirClientes();
    obterFalso.mockResolvedValueOnce(semOCliente(101));

    await semResposta();

    expect(aviso()?.textContent).toMatch(/Cliente eliminado\./);
    expect(haItemDe(ANA)).toBe(false);
    expect(nomesNaLista()).toHaveLength(3);
    expect(h2()).toHaveTextContent(T.h2N(3));
    expect(linhaDeEstado(T.aVerificar)).toBeNull();
    expect(linhaDeEstado(T.semConfirmar)).toBeNull();
    expect(document.activeElement).toBe(h2());
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("o cliente CONTINUA: nada aconteceu — «Não consegui eliminar. Verifica a ligação e tenta outra vez.», o «Eliminar» volta, sem aviso", async () => {
    await abrirClientes();

    await semResposta(); // o GET de verificação devolve a lista inteira

    expect(linhaDeEstado(T.continuaSemResposta)).not.toBeNull();
    expect(linhaDeEstado(T.aVerificar)).toBeNull();
    expect(haItemDe(ANA)).toBe(true);
    expect(inerte(eliminarDe(ANA))).toBe(false);
    expect(aviso()).toBeNull();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(haBotaoDaPagina(T.verificarOutraVez)).toBe(false);
  });

  it("…e tocar de novo é SEGURO: abre a folha (sem pedido) e só confirmar faz o segundo DELETE", async () => {
    await abrirClientes();
    await semResposta();

    await abrirFolhaDeEliminar(ANA);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    await tocar(confirmarEliminar());

    expect(eliminarFalso).toHaveBeenCalledTimes(2);
    expect(haItemDe(ANA)).toBe(false);
  });

  it("a verificação REFAZ a lista com o que o servidor tem (um cliente novo entra, outro que saiu sai)", async () => {
    await abrirClientes();
    obterFalso.mockResolvedValueOnce({
      clientes: [
        clienteDeTeste({ id: 900, nome: "Recém Chegada" }),
        ...clientesDeTeste().filter((c) => c.id !== 102),
      ],
    });

    await semResposta();

    expect(nomesNaLista()).toContain("Recém Chegada");
    expect(haItemDe(RUI)).toBe(false);
    expect(haItemDe(ANA)).toBe(true);
    expect(linhaDeEstado(T.continuaSemResposta)).not.toBeNull();
  });

  describe("a verificação também falha", () => {
    it.each([
      ["sem resposta", erroSemResposta],
      ["500", () => erroDe(500)],
    ])(
      "(%s) «Não consegui confirmar… toca em Verificar outra vez.» + «Verificar outra vez»; o «Eliminar» fica inerte; o cliente na lista",
      async (_n, fazer) => {
        await abrirClientes();
        obterFalso.mockRejectedValueOnce(fazer());

        await semResposta();

        expect(linhaDeEstado(T.semConfirmar)).not.toBeNull();
        expect(botaoDaPagina(T.verificarOutraVez)).toBeInTheDocument();
        expect(haItemDe(ANA)).toBe(true);
        expect(inerte(eliminarDe(ANA))).toBe(true);
        expect(inerte(eliminarDe(RUI))).toBe(false);
        expect(
          screen.queryByText(T.erroTitulo),
          "não é o erro de carregar: a lista está lá",
        ).toBeNull();
        expect(screen.queryByText(T.vazioTitulo)).toBeNull();
        expect(aviso()).toBeNull();
        expect(eliminarFalso).toHaveBeenCalledTimes(1);
      },
    );

    it("«Verificar outra vez» repete o GET e NUNCA o DELETE; e, se o cliente já não está, é «eliminado»", async () => {
      await abrirClientes();
      obterFalso.mockRejectedValueOnce(erroSemResposta());
      await semResposta();
      obterFalso.mockClear();
      obterFalso.mockResolvedValueOnce(semOCliente(101));

      await tocar(botaoDaPagina(T.verificarOutraVez));

      expect(obterFalso).toHaveBeenCalledTimes(1);
      expect(eliminarFalso, "o DELETE nunca se repete").toHaveBeenCalledTimes(1);
      expect(haItemDe(ANA)).toBe(false);
      expect(aviso()?.textContent).toMatch(/Cliente eliminado\./);
      expect(haBotaoDaPagina(T.verificarOutraVez)).toBe(false);
      expect(document.activeElement).toBe(h2());
    });

    it("«Verificar outra vez» e o cliente continua: a linha passa a «Não consegui eliminar…» e o «Eliminar» volta", async () => {
      await abrirClientes();
      obterFalso.mockRejectedValueOnce(erroSemResposta());
      await semResposta();

      await tocar(botaoDaPagina(T.verificarOutraVez));

      expect(linhaDeEstado(T.continuaSemResposta)).not.toBeNull();
      expect(inerte(eliminarDe(ANA))).toBe(false);
      expect(haBotaoDaPagina(T.verificarOutraVez)).toBe(false);
      expect(eliminarFalso).toHaveBeenCalledTimes(1);
    });

    it("«Verificar outra vez» pode falhar outra vez, as vezes que for, sem nunca repetir o DELETE", async () => {
      await abrirClientes();
      obterFalso.mockRejectedValue(erroSemResposta());
      await semResposta();
      await tocar(botaoDaPagina(T.verificarOutraVez));
      await tocar(botaoDaPagina(T.verificarOutraVez));

      expect(linhaDeEstado(T.semConfirmar)).not.toBeNull();
      expect(inerte(eliminarDe(ANA))).toBe(true);
      expect(eliminarFalso).toHaveBeenCalledTimes(1);
    });

    it("«Verificar outra vez» é secundário e `min-h-toque`", async () => {
      await abrirClientes();
      obterFalso.mockRejectedValueOnce(erroSemResposta());
      await semResposta();
      expect(botaoDaPagina(T.verificarOutraVez).className).toMatch(/min-h-toque/);
      expect(botaoDaPagina(T.verificarOutraVez).className).not.toMatch(/bg-acao|bg-perigo/);
    });
  });

  it("o único cliente, sem resposta, e a verificação diz que já não está: um 200 `[]` é verdade — o vazio, e o aviso", async () => {
    soAAna();
    await abrirClientes();
    obterFalso.mockResolvedValueOnce({ clientes: [] });

    await semResposta();

    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
    expect(aviso()?.textContent).toMatch(/Cliente eliminado\./);
    expect(obterFalso, "a verificação É o GET: não há um segundo").toHaveBeenCalledTimes(2);
  });

  it("o único cliente, sem resposta, e a verificação FALHA: continua na lista, nunca o vazio", async () => {
    soAAna();
    await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    await semResposta();

    expect(haItemDe(ANA)).toBe(true);
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    expect(linhaDeEstado(T.semConfirmar)).not.toBeNull();
  });

  it("401 na verificação: aoPerderSessao e o DELETE continua a ser UM", async () => {
    const sessao = await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroDe(401));

    await semResposta();
    await avancar(60_000);

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("com 137 clientes e o DELETE sem resposta, o cliente fica visível e o limite de 20 não muda", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();

    await semResposta("Cliente 137");

    expect(nomesNaLista()).toHaveLength(20);
    expect(haItemDe("Cliente 137")).toBe(true);
    expect(principal()).toBeInTheDocument();
    expect(esqueletos()).toHaveLength(0);
  });
});
