/**
 * F4-05b, `docs/ecras/F4-05b.md` secção 6 e critério 12 — «Exportar CSV»: o botão (só com a lista
 * pronta), a linha de ajuda e o aviso de dados pessoais (sempre, por baixo do botão), «A preparar…»
 * sem segundo pedido, o link `data:` com `download` clicado por código e retirado do DOM, o aviso
 * «Ficheiro CSV preparado…» (que **não** diz «descarregado»), o foco que fica no botão, o prazo de
 * 20 s e as duas frases de erro (diferentes) com o botão sempre ativo.
 *
 * Os bytes e a BOM são do `descarregarClientesCsv` (testado em `gestao-clientes-csv.test.ts`, que
 * compara byte a byte); aqui a API está fingida e o ecrã tem de pôr no link **exatamente** o
 * `href` e o `nome` que ela devolve, sem os tocar. O link é registado a partir do `click()` do
 * `<a>` (o jsdom não navega): ver `descargas` em `testes/clientes-gestao.tsx`.
 *
 * **Deixa passar:** o que o browser faz com o link e a CSP (o e2e `gestao-clientes-csv-csp`).
 */
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientesDeTeste } from "../../../testes/clientes-dados";
import {
  T,
  abrirClientes,
  assentar,
  aviso,
  avancar,
  botaoExportar,
  botoesEliminar,
  comSinal,
  csvFalso,
  descargas,
  desmontarOEcra,
  erroDe,
  erroSemResposta,
  erroIlegivel,
  ficarPendenteAteAbortar,
  haBotaoExportar,
  inerte,
  linhaDeEstado,
  nomesNaLista,
  obterFalso,
  pendente,
  prepararApi,
  principal,
  textoDaPagina,
  tocar,
  tocarDuasVezes,
} from "../../../testes/clientes-gestao";

vi.mock("../../../lib/api/gestao-clientes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/gestao-clientes")>()),
  obterClientes: vi.fn(),
  eliminarCliente: vi.fn(),
  descarregarClientesCsv: vi.fn(),
}));

const HREF = "data:text/csv;charset=utf-8;base64,77u/aWQ7bm9tZQ0K";
const NOME = "clientes-2026-11-02.csv";

let criarUrl: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  prepararApi(clientesDeTeste());
  csvFalso.mockResolvedValue({ nome: NOME, href: HREF });
  criarUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:nao-devia");
});
afterEach(() => {
  criarUrl.mockRestore();
});

function ligacoesDeDescarga(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[download]"));
}

describe("o botão e as duas linhas (6, 6.4, critério 12)", () => {
  it("«Exportar CSV» é secundário, `min-h-toque`, e vem por baixo do <h2>", async () => {
    await abrirClientes();
    const b = botaoExportar();
    expect(b).toHaveTextContent(new RegExp(`^${T.exportar}$`));
    expect(b.className).toMatch(/min-h-toque/);
    expect(b.className).not.toMatch(/bg-acao|bg-perigo/);
    expect(
      screen.getByRole("heading", { level: 2 }).compareDocumentPosition(b) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("por baixo dele, sempre: a ajuda e o aviso de dados pessoais, ligados ao botão por aria-describedby", async () => {
    await abrirClientes();
    const b = botaoExportar();
    const ajuda = screen.getByText(T.ajudaDoCsv);
    const avisoDeDados = screen.getByText(T.avisoDoCsv);

    expect(b.compareDocumentPosition(ajuda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      ajuda.compareDocumentPosition(avisoDeDados) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const ids = (b.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => document.getElementById(id))).toEqual([ajuda, avisoDeDados]);
    expect(b).not.toHaveAttribute("aria-label");
  });

  it("o aviso de dados pessoais é para ler: `text-texto` (não `-suave`), sem vermelho; a ajuda é discreta", async () => {
    await abrirClientes();
    const avisoDeDados = screen.getByText(T.avisoDoCsv);
    expect(avisoDeDados.className).toMatch(/text-nota/);
    expect(avisoDeDados.className).toMatch(/text-texto(?!-)/);
    expect(avisoDeDados.className).not.toMatch(/text-texto-suave|text-erro/);
    expect(screen.getByText(T.ajudaDoCsv).className).toMatch(/text-texto-suave/);
  });

  it.each([
    ["a carregar", () => obterFalso.mockReturnValue(pendente<never>().promessa)],
    ["vazio", () => obterFalso.mockResolvedValue({ clientes: [] })],
    ["erro (sem resposta)", () => obterFalso.mockRejectedValue(erroSemResposta())],
    ["erro (500)", () => obterFalso.mockRejectedValue(erroDe(500))],
  ])("%s: não há botão, nem ajuda, nem o aviso de dados pessoais", async (_nome, preparar) => {
    preparar();
    await abrirClientes();
    expect(haBotaoExportar()).toBe(false);
    expect(screen.queryByText(T.ajudaDoCsv)).toBeNull();
    expect(screen.queryByText(T.avisoDoCsv)).toBeNull();
  });

  it("o botão aparece com a lista pronta e desaparece quando o último cliente é eliminado", async () => {
    prepararApi([clientesDeTeste()[0] as ReturnType<typeof clientesDeTeste>[number]]);
    await abrirClientes();
    expect(haBotaoExportar()).toBe(true);
    obterFalso.mockResolvedValueOnce({ clientes: [] });

    await tocar(botoesEliminar()[0] as HTMLElement);
    await tocar(within(screen.getByRole("dialog")).getByRole("button", { name: T.eliminar }));

    expect(haBotaoExportar()).toBe(false);
    expect(screen.queryByText(T.avisoDoCsv)).toBeNull();
  });

  it("abrir o ecrã não pede o ficheiro", async () => {
    await abrirClientes();
    expect(csvFalso).not.toHaveBeenCalled();
  });
});

describe("o toque (6.1)", () => {
  it("UM pedido com `{ sinal }`; «A preparar…» (aria-busy, aria-disabled) enquanto espera", async () => {
    await abrirClientes();
    const resposta = pendente<{ nome: string; href: string }>();
    csvFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(botaoExportar());

    expect(csvFalso).toHaveBeenCalledTimes(1);
    expect(csvFalso).toHaveBeenCalledWith(comSinal);
    const b = screen.getByRole("button", { name: T.aPreparar });
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b).toHaveAttribute("aria-disabled", "true");
    expect(descargas, "ainda não há ficheiro").toHaveLength(0);
  });

  it("dois toques (no mesmo instante ou em seguida) NÃO fazem dois pedidos", async () => {
    await abrirClientes();
    csvFalso.mockReturnValueOnce(pendente<{ nome: string; href: string }>().promessa);

    await tocarDuasVezes(botaoExportar());
    await tocar(botaoExportar());

    expect(csvFalso).toHaveBeenCalledTimes(1);
  });

  it("com a resposta: um link `data:` com `download` é clicado UMA vez, com o `href` e o nome da API sem os tocar", async () => {
    await abrirClientes();

    await tocar(botaoExportar());

    expect(descargas).toHaveLength(1);
    expect(descargas[0]?.href).toBe(HREF);
    expect(descargas[0]?.href.startsWith("data:text/csv")).toBe(true);
    expect(descargas[0]?.href).not.toMatch(/^blob:/);
    expect(descargas[0]?.download).toBe(NOME);
  });

  it("usa o nome que a API devolver (o do servidor validado ou o de reserva), tal e qual", async () => {
    csvFalso.mockResolvedValue({ nome: "clientes-2026-07-15.csv", href: HREF });
    await abrirClientes();
    await tocar(botaoExportar());
    expect(descargas[0]?.download).toBe("clientes-2026-07-15.csv");
  });

  it("`URL.createObjectURL` nunca é chamado (a CSP de produção proíbe `blob:`)", async () => {
    await abrirClientes();
    await tocar(botaoExportar());
    expect(criarUrl).not.toHaveBeenCalled();
  });

  it("o link é retirado do DOM de imediato e o botão volta ao normal", async () => {
    await abrirClientes();

    await tocar(botaoExportar());

    expect(ligacoesDeDescarga()).toHaveLength(0);
    expect(document.querySelector('a[href^="data:"]')).toBeNull();
    expect(botaoExportar()).toHaveTextContent(new RegExp(`^${T.exportar}$`));
    expect(inerte(botaoExportar())).toBe(false);
    expect(botaoExportar()).not.toHaveAttribute("aria-busy", "true");
  });

  it("o aviso é «Feito. Ficheiro CSV preparado. Se não aparecer nas descargas, exporta outra vez.» — nunca «descarregado» — e dura 5 s", async () => {
    await abrirClientes();
    await tocar(botaoExportar());

    expect(aviso()?.textContent).toMatch(
      /^\s*Feito\.\s*Ficheiro CSV preparado\. Se não aparecer nas descargas, exporta outra vez\.\s*×?\s*$/,
    );
    expect(aviso()?.textContent).not.toMatch(/descarregad/i);
    expect(aviso()?.getAttribute("role")).toBe("status");
    await avancar(4_999);
    expect(aviso()).not.toBeNull();
    await avancar(1);
    expect(aviso()).toBeNull();
  });

  it("o foco FICA no botão (não desaparece nem salta)", async () => {
    await abrirClientes();
    const b = botaoExportar();
    b.focus();

    await tocar(b);

    expect(document.activeElement).toBe(botaoExportar());
  });

  it("a lista fica como estava e o <h2> também", async () => {
    await abrirClientes();
    await tocar(botaoExportar());
    expect(nomesNaLista()).toHaveLength(4);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(T.h2N(4));
  });

  it("pode exportar-se outra vez (idempotente): um segundo ficheiro, um segundo pedido", async () => {
    await abrirClientes();
    await tocar(botaoExportar());
    await tocar(botaoExportar());
    expect(csvFalso).toHaveBeenCalledTimes(2);
    expect(descargas).toHaveLength(2);
  });
});

describe("o prazo é de 20 s (não 10) (2)", () => {
  it("aos 10 s e aos 19,999 s ainda a preparar; aos 20 s o pedido é abortado e é «sem resposta»", async () => {
    await abrirClientes();
    let sinal: AbortSignal | undefined;
    csvFalso.mockImplementationOnce((opcoes) => {
      sinal = opcoes?.sinal;
      return ficarPendenteAteAbortar(opcoes);
    });
    await tocar(botaoExportar());

    await avancar(10_000);
    expect(sinal?.aborted, "o prazo normal (10 s) não vale para o CSV").toBe(false);
    expect(screen.getByRole("button", { name: T.aPreparar })).toBeInTheDocument();
    await avancar(9_999);
    expect(sinal?.aborted).toBe(false);

    await avancar(1);

    expect(sinal?.aborted).toBe(true);
    expect(linhaDeEstado(T.csvSemResposta)).not.toBeNull();
    expect(inerte(botaoExportar())).toBe(false);
    expect(descargas).toHaveLength(0);
  });

  it("um ficheiro que chega antes dos 20 s desarma o prazo (nada é abortado depois)", async () => {
    await abrirClientes();
    let sinal: AbortSignal | undefined;
    csvFalso.mockImplementationOnce((opcoes) => {
      sinal = opcoes?.sinal;
      return Promise.resolve({ nome: NOME, href: HREF });
    });
    await tocar(botaoExportar());

    await avancar(30_000);

    expect(sinal?.aborted).toBe(false);
  });
});

describe("quando não corre bem (6.2): o botão fica ATIVO e a linha diz qual das duas coisas foi", () => {
  it("sem resposta (rede, prazo): «Verifica a ligação e tenta outra vez.»", async () => {
    await abrirClientes();
    csvFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(botaoExportar());

    const linha = linhaDeEstado(T.csvSemResposta);
    expect(linha).not.toBeNull();
    expect(linha?.getAttribute("role")).toBe("status");
    expect(linha?.className).toMatch(/text-erro/);
    expect(linha?.className).toMatch(/text-nota/);
    expect(textoDaPagina()).not.toContain(T.csvServidor);
  });

  it.each([
    ["500", () => erroDe(500)],
    ["503", () => erroDe(503)],
    ["403", () => erroDe(403)],
    ["200 que não é CSV, vazio ou ilegível (ErroDaApi de estado 200)", erroIlegivel],
  ])(
    "o servidor respondeu (%s): «O problema é nosso, não da tua ligação…»",
    async (_nome, fazer) => {
      await abrirClientes();
      csvFalso.mockRejectedValueOnce(fazer());

      await tocar(botaoExportar());

      expect(linhaDeEstado(T.csvServidor)).not.toBeNull();
      expect(linhaDeEstado(T.csvServidor)?.className).toMatch(/text-erro/);
      expect(textoDaPagina()).not.toContain(T.csvSemResposta);
    },
  );

  it("as duas frases são diferentes", () => {
    expect(T.csvSemResposta).not.toBe(T.csvServidor);
  });

  it.each([
    ["sem resposta", erroSemResposta],
    ["o servidor respondeu", () => erroDe(500)],
  ])(
    "(%s) o botão está ATIVO e com o nome normal, a lista fica, não há aviso nem ficheiro, e a mensagem do backend não aparece",
    async (_n, fazer) => {
      await abrirClientes();
      csvFalso.mockRejectedValueOnce(fazer());

      await tocar(botaoExportar());

      expect(botaoExportar()).toHaveTextContent(new RegExp(`^${T.exportar}$`));
      expect(inerte(botaoExportar())).toBe(false);
      expect(botaoExportar()).not.toHaveAttribute("aria-busy", "true");
      expect(nomesNaLista()).toHaveLength(4);
      expect(aviso()).toBeNull();
      expect(descargas).toHaveLength(0);
      expect(ligacoesDeDescarga()).toHaveLength(0);
      expect(document.body.textContent).not.toContain("MENSAGEM-DO-BACKEND");
    },
  );

  it("repetir é seguro: depois do erro, o segundo toque faz outro pedido e, com sucesso, limpa a linha e descarrega", async () => {
    await abrirClientes();
    csvFalso.mockRejectedValueOnce(erroSemResposta());
    await tocar(botaoExportar());

    await tocar(botaoExportar());

    expect(csvFalso).toHaveBeenCalledTimes(2);
    expect(linhaDeEstado(T.csvSemResposta)).toBeNull();
    expect(descargas).toHaveLength(1);
    expect(aviso()).not.toBeNull();
  });

  it("um erro nunca é «descarregado»: nenhum aviso de sucesso, nenhum link, nem com a API a resolver sem `href`", async () => {
    await abrirClientes();
    csvFalso.mockRejectedValueOnce(erroDe(500));
    await tocar(botaoExportar());
    expect(descargas).toHaveLength(0);
    expect(aviso()).toBeNull();
  });
});

describe("401 e cancelamento", () => {
  it("o 401 leva ao login (aoPerderSessao) e não mostra a frase de erro do CSV", async () => {
    const sessao = await abrirClientes();
    csvFalso.mockRejectedValueOnce(erroDe(401));

    await tocar(botaoExportar());

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(linhaDeEstado(T.csvServidor)).toBeNull();
    expect(linhaDeEstado(T.csvSemResposta)).toBeNull();
    expect(descargas).toHaveLength(0);
    expect(csvFalso).toHaveBeenCalledTimes(1);
  });

  it("desmontar a meio aborta o pedido e não descarrega nem mostra nada", async () => {
    await abrirClientes();
    let sinal: AbortSignal | undefined;
    csvFalso.mockImplementationOnce((opcoes) => {
      sinal = opcoes?.sinal;
      return new Promise((_c, falhar) => {
        sinal?.addEventListener("abort", () => {
          falhar(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    await tocar(botaoExportar());

    await desmontarOEcra();
    await assentar();

    expect(sinal?.aborted).toBe(true);
    expect(descargas).toHaveLength(0);
    expect(principal).toBeDefined();
  });

  it("uma resposta que chega depois de desmontar NÃO descarrega nada", async () => {
    await abrirClientes();
    const resposta = pendente<{ nome: string; href: string }>();
    csvFalso.mockReturnValueOnce(resposta.promessa);
    await tocar(botaoExportar());
    await desmontarOEcra();

    resposta.resolver({ nome: NOME, href: HREF });
    await assentar();

    expect(descargas).toHaveLength(0);
  });
});
