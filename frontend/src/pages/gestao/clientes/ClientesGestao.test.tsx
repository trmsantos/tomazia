/**
 * F4-05b, `docs/ecras/F4-05b.md` secções 5 e 11 e critérios 5, 6 e 7 — a lista de clientes: os
 * estados (a carregar, vazio, erro, lista) **sempre distintos**, o que cada cliente mostra, os 20
 * de cada vez, a releitura silenciosa, o 401 e o cancelamento.
 *
 * **Regra 10, o coração desta tarefa:** «não há clientes» (um `200` com `[]`) e «não consegui
 * carregar» (rede, 5xx, corpo ilegível, `consentimento_em` ilegível) nunca se desenham iguais, e
 * um erro nunca é a lista vazia. Cada ramo de erro afirma que o texto do vazio **não** existe.
 *
 * **Deixa passar:** os 44 px, o anel de foco, o axe, o scroll horizontal a 360 px (e2e).
 */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMAIL_DE_120,
  clienteDeTeste,
  clientesDeTeste,
  muitosClientes,
} from "../../../testes/clientes-dados";
import {
  MENSAGEM_DO_BACKEND,
  T,
  abrirClientes,
  assentar,
  aviso,
  botaoMostrarMais,
  botaoTentarOutraVez,
  eliminar,
  botoesEliminar,
  desmontarOEcra,
  eliminarFalso,
  erroDe,
  erroIlegivel,
  erroSemResposta,
  esconderAAba,
  haBotaoExportar,
  haBotaoTentarOutraVez,
  haEsqueleto,
  haItemDe,
  haMostrarMais,
  esqueletos,
  h1,
  h2,
  itemDe,
  itens,
  ligacaoVoltar,
  linhaDeEstado,
  nomesNaLista,
  notaDeMostrar,
  obterFalso,
  pendente,
  prepararApi,
  principal,
  textoDaPagina,
  tocar,
  voltarAAba,
  comSinal,
  csvFalso,
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

describe("a estrutura (5.1)", () => {
  it("<h1 tabindex=-1> «Clientes», a ligação «Voltar a Mais» (/gestao/mais) e, depois, a secção com o <h2>", async () => {
    await abrirClientes();

    expect(h1()).toHaveTextContent(T.titulo);
    expect(h1()).toHaveAttribute("tabindex", "-1");
    expect(ligacaoVoltar()).toHaveAttribute("href", "/gestao/mais");
    const seccao = screen.getByRole("region", { name: new RegExp(`^${T.h2}`) });
    expect(seccao).toContainElement(h2());
    expect(h2()).toHaveAttribute("tabindex", "-1");
    expect(
      h1().compareDocumentPosition(ligacaoVoltar()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      ligacaoVoltar().compareDocumentPosition(seccao) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("«Voltar a Mais» tem 44 px de altura mínima por classe (`min-h-toque`) e sublinhado", async () => {
    await abrirClientes();
    expect(ligacaoVoltar().className).toMatch(/min-h-toque/);
    expect(ligacaoVoltar().className).toMatch(/underline/);
  });

  it("o <h2> tem o TOTAL, não o número de itens mostrados", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();
    expect(h2()).toHaveTextContent(T.h2N(137));
    expect(itens()).toHaveLength(20);
  });

  it("a lista é um <ul> com um <li> por cliente", async () => {
    await abrirClientes();
    const lista = within(principal()).getByRole("list");
    expect(within(lista).getAllByRole("listitem")).toHaveLength(4);
  });

  it("pede a lista UMA vez, com `{ sinal }`, e nada mais (sem exportar, sem eliminar)", async () => {
    await abrirClientes();
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(eliminarFalso).not.toHaveBeenCalled();
    expect(csvFalso).not.toHaveBeenCalled();
  });

  it("o ecrã é bordô: sem dourado (`bg-acao`), sem creme e sem painel", async () => {
    await abrirClientes();
    // A folha (um <dialog>, fechada) é o único painel, e tem o seu próprio teste.
    const foraDaFolha = (seletor: string): Element[] =>
      Array.from(principal().querySelectorAll(seletor)).filter(
        (no) => no.closest("dialog") === null,
      );
    expect(foraDaFolha('[class*="bg-acao"]')).toHaveLength(0);
    expect(foraDaFolha('[class*="bg-creme"], [class*="superficie-painel"]')).toHaveLength(0);
  });
});

describe("a carregar (5.5)", () => {
  it("esqueleto SEM texto, aria-busy, sem botões e sem número no <h2>; nada de vazio nem de erro", async () => {
    obterFalso.mockReturnValueOnce(pendente<never>().promessa);
    await abrirClientes();

    expect(haEsqueleto()).toBe(true);
    for (const no of esqueletos()) {
      expect(no.textContent?.trim(), "o esqueleto não tem texto").toBe("");
      expect(no.querySelector("button, a")).toBeNull();
    }
    expect(h2()).toHaveTextContent(new RegExp(`^${T.h2}$`));
    expect(textoDaPagina()).not.toMatch(/\(\d+\)/);
    expect(
      within(principal())
        .queryAllByRole("button")
        .filter((b) => b.closest('[aria-busy="true"]') === null),
    ).toHaveLength(0);
    expect(haBotaoExportar()).toBe(false);
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
  });

  it("quatro blocos de esqueleto (barra w-1/2, barra w-3/4 e o retângulo do «Eliminar»)", async () => {
    obterFalso.mockReturnValueOnce(pendente<never>().promessa);
    await abrirClientes();
    const html = esqueletos()
      .map((no) => no.outerHTML)
      .join("");
    expect(html).toMatch(/w-1\/2/);
    expect(html).toMatch(/w-3\/4/);
    expect(html).toMatch(/bg-fio-interno/);
  });

  it("quando a lista chega, o esqueleto sai", async () => {
    const resposta = pendente<{ clientes: ReturnType<typeof clientesDeTeste> }>();
    obterFalso.mockReturnValueOnce(resposta.promessa);
    await abrirClientes();
    expect(haEsqueleto()).toBe(true);

    resposta.resolver({ clientes: clientesDeTeste() });
    await assentar();

    expect(haEsqueleto()).toBe(false);
    expect(nomesNaLista()).toHaveLength(4);
  });
});

describe("vazio: SÓ de um 200 com a lista vazia (5.5, critério 5)", () => {
  beforeEach(() => {
    obterFalso.mockResolvedValue({ clientes: [] });
  });

  it("«Não há clientes registados.» / «Quem se registar no site aparece aqui.»", async () => {
    await abrirClientes();
    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
    expect(screen.getByText(T.vazioLinha)).toBeInTheDocument();
  });

  it("SEM botão nenhum (nem «Tentar outra vez», nem «Exportar CSV»), sem «Eliminar», sem nota de «A mostrar»", async () => {
    await abrirClientes();
    expect(within(principal()).queryAllByRole("button")).toHaveLength(0);
    expect(haBotaoExportar()).toBe(false);
    expect(haBotaoTentarOutraVez()).toBe(false);
    expect(notaDeMostrar()).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("SEM `text-erro` em lado nenhum e SEM a ideia de avaria ou de «ainda não existe»", async () => {
    await abrirClientes();
    expect(principal().querySelector(".text-erro")).toBeNull();
    expect(screen.getByText(T.vazioTitulo).className).toMatch(/text-texto/);
    expect(textoDaPagina()).not.toMatch(/n[ãa]o consegui|tentar|ainda n[ãa]o existe|erro/i);
  });

  it("o <h2> não leva número (nem «(0)»), e o ecrã não está a carregar", async () => {
    await abrirClientes();
    expect(h2()).toHaveTextContent(new RegExp(`^${T.h2}$`));
    expect(haEsqueleto()).toBe(false);
  });

  it("a ligação «Voltar a Mais» continua lá", async () => {
    await abrirClientes();
    expect(ligacaoVoltar()).toHaveAttribute("href", "/gestao/mais");
  });
});

describe("erro a carregar (5.5, critério 5): NUNCA o vazio", () => {
  it.each([
    ["sem resposta (rede, DNS, prazo)", erroSemResposta, T.erroSemResposta],
    ["500", () => erroDe(500), T.erroServidor],
    ["503", () => erroDe(503), T.erroServidor],
    ["403", () => erroDe(403), T.erroServidor],
    [
      "um 200 com um corpo ilegível ou uma `consentimento_em` ilegível",
      erroIlegivel,
      T.erroServidor,
    ],
  ])(
    "%s: o título, a linha certa, «Tentar outra vez», e nenhum cliente nem «Eliminar»",
    async (_nome, fazer, linha) => {
      obterFalso.mockRejectedValue(fazer());
      await abrirClientes();

      expect(screen.getByText(T.erroTitulo)).toBeInTheDocument();
      expect(screen.getByText(linha)).toBeInTheDocument();
      expect(botaoTentarOutraVez()).toBeInTheDocument();
      expect(botoesEliminar()).toHaveLength(0);
      expect(haBotaoExportar()).toBe(false);
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      // A regra 10: o texto do vazio não pode existir num erro.
      expect(screen.queryByText(T.vazioTitulo)).toBeNull();
      expect(screen.queryByText(T.vazioLinha)).toBeNull();
      expect(haEsqueleto()).toBe(false);
      // O erro vê-se: o título do estado é `text-erro`.
      expect(screen.getByText(T.erroTitulo).className).toMatch(/text-erro/);
    },
  );

  it("as duas linhas são diferentes (sem resposta ≠ o servidor respondeu)", async () => {
    expect(T.erroSemResposta).not.toBe(T.erroServidor);
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirClientes();
    expect(screen.queryByText(T.erroServidor)).toBeNull();
  });

  it("nunca mostra a `mensagem` do backend", async () => {
    obterFalso.mockRejectedValue(erroDe(500));
    await abrirClientes();
    expect(document.body.textContent).not.toContain(MENSAGEM_DO_BACKEND);
  });

  it("«Tentar outra vez» repete SÓ o GET: «A tentar…» (aria-busy) enquanto espera, e depois a lista", async () => {
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirClientes();
    const resposta = pendente<{ clientes: ReturnType<typeof clientesDeTeste> }>();
    obterFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(botaoTentarOutraVez());

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: T.aTentar })).toHaveAttribute("aria-busy", "true");
    resposta.resolver({ clientes: clientesDeTeste() });
    await assentar();
    expect(nomesNaLista()).toHaveLength(4);
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
    expect(eliminarFalso).not.toHaveBeenCalled();
    expect(csvFalso).not.toHaveBeenCalled();
  });

  it("se «Tentar outra vez» falha outra vez, continua a ser o erro (e nunca o vazio)", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirClientes();
    await tocar(botaoTentarOutraVez());
    expect(screen.getByText(T.erroTitulo)).toBeInTheDocument();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
  });

  it("depois de «Tentar outra vez» com um 200 vazio, é o vazio (e só então)", async () => {
    obterFalso.mockRejectedValueOnce(erroDe(500));
    await abrirClientes();
    obterFalso.mockResolvedValueOnce({ clientes: [] });
    await tocar(botaoTentarOutraVez());
    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
  });
});

describe("o que cada cliente mostra (5.2, critério 6)", () => {
  it("nome, email, telemóvel e «Consentimento dado a {data com ano}.», por esta ordem, e depois «Eliminar»", async () => {
    await abrirClientes();
    expect(itemDe("Ana Exemplo").textContent).toBe(
      `Ana Exemplo` +
        `ana@exemplo.test` +
        `912345678` +
        T.consentimento("14 de novembro de 2026") +
        T.eliminar,
    );
  });

  it("sem telemóvel a linha NÃO existe: nem «Sem telemóvel», nem um traço, nem um espaço vazio", async () => {
    await abrirClientes();
    expect(itemDe("Rui Teste").textContent).toBe(
      `Rui Teste` + `rui@exemplo.test` + T.consentimento("2 de março de 2025") + T.eliminar,
    );
    expect(textoDaPagina()).not.toMatch(/sem telem[óo]vel|—|–/i);
  });

  it("a data é SEMPRE com o ano, de outro ano também (2025), e é a de LISBOA (23:30 UTC de verão já é o dia seguinte)", async () => {
    await abrirClientes();
    expect(itemDe("Rui Teste")).toHaveTextContent("2 de março de 2025");
    expect(itemDe(clientesDeTeste()[2]?.nome ?? "")).toHaveTextContent(
      T.consentimento("15 de julho de 2026"),
    );
  });

  it("sem hora na data do consentimento", async () => {
    await abrirClientes();
    expect(textoDaPagina()).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("NÃO aparecem a `versao_termos`, a `criado_em`, o `id` nem nada de `token_`", async () => {
    await abrirClientes();
    // A linha de ajuda do CSV diz «a versão dos termos» (spec 6): é uma frase, não o dado.
    const texto = textoDaPagina().replace(T.ajudaDoCsv, "");
    expect(texto).not.toContain("2026-01");
    expect(texto).not.toContain("2025-01");
    expect(texto).not.toMatch(/T10:30:05|criado|versão|vers[ãa]o dos termos/i);
    expect(texto).not.toMatch(/\b10[1-4]\b/);
    expect(texto).not.toMatch(/token/i);
    expect(document.body.innerHTML).not.toMatch(/token_/i);
  });

  it("email e telemóvel são texto simples: nem `mailto:` nem `tel:`, nem o email dentro de uma ligação", async () => {
    await abrirClientes();
    expect(document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]')).toHaveLength(0);
    for (const ligacao of Array.from(document.querySelectorAll("a"))) {
      expect(ligacao.textContent).not.toMatch(/@exemplo\.test|9123456/);
    }
    expect(within(itemDe("Ana Exemplo")).getByText("ana@exemplo.test").tagName).not.toBe("A");
  });

  it("o nome quebra (`break-words`) e o email nunca alarga a página (`[overflow-wrap:anywhere]`)", async () => {
    obterFalso.mockResolvedValue({
      clientes: [clienteDeTeste({ id: 5, nome: "Nome", email: EMAIL_DE_120 })],
    });
    await abrirClientes();
    expect(within(itemDe("Nome")).getByText("Nome").className).toMatch(/break-words/);
    expect(within(itemDe("Nome")).getByText(EMAIL_DE_120).className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });

  it("o texto é só texto: um nome com HTML não vira elemento", async () => {
    obterFalso.mockResolvedValue({
      clientes: [clienteDeTeste({ id: 6, nome: "<b>Negrito</b>", email: "<i>x</i>@exemplo.test" })],
    });
    await abrirClientes();
    expect(principal().querySelector("b, i")).toBeNull();
    expect(screen.getByText("<b>Negrito</b>")).toBeInTheDocument();
  });

  it("«Eliminar»: secundário (nunca vermelho na lista), `min-h-toque`, nome acessível exatamente «Eliminar», sem aria-label", async () => {
    await abrirClientes();
    for (const botao of botoesEliminar()) {
      expect(botao.className).toMatch(/min-h-toque/);
      expect(botao.className).not.toMatch(/bg-perigo|text-erro|bg-acao/);
      expect(botao).not.toHaveAttribute("aria-label");
      expect(botao).not.toHaveAttribute("title");
    }
    expect(screen.getAllByRole("button", { name: /^Eliminar$/ })).toHaveLength(4);
  });

  it("o «Eliminar» aponta (`aria-describedby`) ao <p> do nome do PRÓPRIO item, com um id por índice (`cliente-nome-<n>`)", async () => {
    await abrirClientes();
    const ids = botoesEliminar().map((b) => b.getAttribute("aria-describedby"));
    expect(new Set(ids).size, "um id por item, todos diferentes").toBe(4);
    for (const [i, id] of ids.entries()) {
      expect(id).toMatch(/^cliente-nome-\d+$/);
      const alvo = document.getElementById(id ?? "");
      expect(alvo, "o id existe").not.toBeNull();
      expect(alvo?.closest("li")).toBe(itens()[i]);
      expect(alvo?.textContent).toBe(clientesDeTeste()[i]?.nome);
    }
  });

  it("a lista vem pela ordem do servidor (o mais recente primeiro)", async () => {
    await abrirClientes();
    expect(nomesNaLista()).toEqual(clientesDeTeste().map((c) => c.nome));
  });
});

describe("20 de cada vez (5.3, critério 7)", () => {
  it("com 137: 20 itens, «A mostrar 20 de 137.» (aria-live polite) e «Mostrar mais clientes», a seguir ao último item", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();

    expect(itens()).toHaveLength(20);
    const nota = notaDeMostrar();
    expect(nota).toHaveTextContent(T.aMostrar(20, 137));
    expect(nota).toHaveAttribute("aria-live", "polite");
    expect(
      (itens()[19] as HTMLElement).compareDocumentPosition(nota as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (nota as HTMLElement).compareDocumentPosition(botaoMostrarMais()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("um toque dá 40, a nota passa a «40 de 137.», os itens novos entram por baixo, e o foco NÃO se mexe nem há scroll", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();
    const botao = botaoMostrarMais();
    botao.focus();
    const primeiros = nomesNaLista().slice();

    await tocar(botao);

    expect(itens()).toHaveLength(40);
    expect(nomesNaLista().slice(0, 20)).toEqual(primeiros);
    expect(notaDeMostrar()).toHaveTextContent(T.aMostrar(40, 137));
    expect(document.activeElement, "o foco fica no botão").toBe(botaoMostrarMais());
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(h2()).toHaveTextContent(T.h2N(137));
  });

  it("«Mostrar mais» não faz pedido nenhum (os dados já cá estão)", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();
    await tocar(botaoMostrarMais());
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("seis toques mostram os 137 (20 + 5 x 20 = 120 e o sexto acaba); a nota e o botão desaparecem quando já se mostram todos", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();
    for (let i = 0; i < 5; i += 1) await tocar(botaoMostrarMais());
    expect(itens()).toHaveLength(120);
    expect(notaDeMostrar()).toHaveTextContent(T.aMostrar(120, 137));

    await tocar(botaoMostrarMais());

    expect(itens()).toHaveLength(137);
    expect(haMostrarMais()).toBe(false);
    expect(notaDeMostrar()).toBeNull();
  });

  it.each([1, 4, 19, 20])("com %i clientes não há nota nem botão", async (n) => {
    prepararApi(muitosClientes(n));
    await abrirClientes();
    expect(itens()).toHaveLength(n);
    expect(haMostrarMais()).toBe(false);
    expect(notaDeMostrar()).toBeNull();
  });

  it("com 21 há nota «20 de 21.» e o botão; mais um toque e acabou", async () => {
    prepararApi(muitosClientes(21));
    await abrirClientes();
    expect(notaDeMostrar()).toHaveTextContent(T.aMostrar(20, 21));
    await tocar(botaoMostrarMais());
    expect(itens()).toHaveLength(21);
    expect(haMostrarMais()).toBe(false);
  });

  it("«Mostrar mais clientes» é secundário e `min-h-toque`", async () => {
    prepararApi(muitosClientes(30));
    await abrirClientes();
    expect(botaoMostrarMais().className).toMatch(/min-h-toque/);
    expect(botaoMostrarMais().className).not.toMatch(/bg-acao|bg-perigo/);
  });

  it("o limite é um número, não uma lista cortada: eliminar um com 20 visíveis faz entrar o seguinte", async () => {
    prepararApi(muitosClientes(137));
    await abrirClientes();
    expect(haItemDe("Cliente 117")).toBe(false); // o 21.º
    obterFalso.mockClear();

    await eliminar("Cliente 137");

    expect(itens()).toHaveLength(20);
    expect(haItemDe("Cliente 137")).toBe(false);
    expect(haItemDe("Cliente 117")).toBe(true);
    expect(h2()).toHaveTextContent(T.h2N(136));
    expect(notaDeMostrar()).toHaveTextContent(T.aMostrar(20, 136));
  });
});

describe("releitura silenciosa ao voltar à aba (5.5)", () => {
  it("volta a pedir a lista SEM esqueleto e sem tirar nada, e a lista nova substitui a velha", async () => {
    await abrirClientes();
    const resposta = pendente<{ clientes: ReturnType<typeof clientesDeTeste> }>();
    obterFalso.mockReturnValueOnce(resposta.promessa);

    await voltarAAba();

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(haEsqueleto(), "sem esqueleto").toBe(false);
    expect(nomesNaLista()).toHaveLength(4);
    resposta.resolver({
      clientes: [clienteDeTeste({ id: 900, nome: "Recém Chegada" }), ...clientesDeTeste()],
    });
    await assentar();
    expect(nomesNaLista()[0]).toBe("Recém Chegada");
    expect(h2()).toHaveTextContent(T.h2N(5));
  });

  it("uma aba que fica OCULTA não pede nada; nem polling com o tempo", async () => {
    await abrirClientes();
    await esconderAAba();
    expect(obterFalso).toHaveBeenCalledTimes(1);
    const { avancar } = await import("../../../testes/comum-gestao");
    await avancar(10 * 60_000);
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sem resposta", erroSemResposta],
    ["500", () => erroDe(500)],
    ["um corpo ilegível", erroIlegivel],
  ])(
    "se falha (%s) e já havia lista, a lista MANTÉM-SE e a linha diz «Pode estar desatualizada.» com «Tentar outra vez»",
    async (_nome, fazer) => {
      await abrirClientes();
      obterFalso.mockRejectedValueOnce(fazer());

      await voltarAAba();

      expect(nomesNaLista()).toHaveLength(4);
      expect(linhaDeEstado(T.desatualizada)).not.toBeNull();
      expect(screen.queryByText(T.erroTitulo), "não é o ecrã de erro").toBeNull();
      expect(screen.queryByText(T.vazioTitulo)).toBeNull();
      expect(botaoTentarOutraVez()).toBeInTheDocument();
    },
  );

  it("«Tentar outra vez» da releitura repete SÓ o GET e, com sucesso, tira a linha", async () => {
    await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await voltarAAba();
    obterFalso.mockClear();

    await tocar(botaoTentarOutraVez());

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).not.toHaveBeenCalled();
    expect(linhaDeEstado(T.desatualizada)).toBeNull();
    expect(nomesNaLista()).toHaveLength(4);
  });

  it("a releitura que devolve `[]` (outro aparelho eliminou todos) passa ao vazio — é um 200 verdadeiro", async () => {
    await abrirClientes();
    obterFalso.mockResolvedValueOnce({ clientes: [] });
    await voltarAAba();
    expect(screen.getByText(T.vazioTitulo)).toBeInTheDocument();
  });

  it("um 401 na releitura leva ao login (aoPerderSessao) e a lista sai da memória", async () => {
    const sessao = await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroDe(401));

    await voltarAAba();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(textoDaPagina()).not.toContain("Ana Exemplo");
    expect(screen.queryByText(T.desatualizada)).toBeNull();
  });
});

describe("401 (5.6)", () => {
  it("ao carregar: aoPerderSessao UMA vez, sem erro, sem vazio e sem lista", async () => {
    obterFalso.mockRejectedValue(erroDe(401));
    const sessao = await abrirClientes();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
    expect(screen.queryByText(T.vazioTitulo)).toBeNull();
    expect(botoesEliminar()).toHaveLength(0);
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("o 401 não é o ecrã de erro e «Tentar outra vez» não aparece", async () => {
    obterFalso.mockRejectedValue(erroDe(401));
    await abrirClientes();
    expect(haBotaoTentarOutraVez()).toBe(false);
  });
});

describe("cancelamento (desmontar) não é erro", () => {
  it("desmontar a meio aborta o pedido e nada se desenha por isso", async () => {
    let sinal: AbortSignal | undefined;
    obterFalso.mockImplementationOnce((opcoes) => {
      sinal = opcoes?.sinal;
      return new Promise((_c, falhar) => {
        sinal?.addEventListener("abort", () => {
          falhar(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const sessao = await abrirClientes();

    await desmontarOEcra();

    expect(sinal?.aborted).toBe(true);
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(T.erroTitulo);
  });

  it("no StrictMode (dupla montagem) o pedido cancelado do primeiro efeito não vira erro: no fim, a lista", async () => {
    obterFalso.mockReset();
    obterFalso
      .mockImplementationOnce(
        (opcoes) =>
          new Promise((_c, falhar) => {
            opcoes?.sinal?.addEventListener("abort", () => {
              falhar(new DOMException("Aborted", "AbortError"));
            });
          }),
      )
      .mockImplementation(() => Promise.resolve({ clientes: clientesDeTeste() }));

    await abrirClientes(undefined, { estrito: true });

    expect(screen.queryByText(T.erroTitulo)).toBeNull();
    expect(nomesNaLista()).toHaveLength(4);
  });

  it("uma resposta que chega depois de desmontar é ignorada (sem estado a mexer e sem erros)", async () => {
    const resposta = pendente<{ clientes: ReturnType<typeof clientesDeTeste> }>();
    obterFalso.mockReturnValueOnce(resposta.promessa);
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await abrirClientes();
    await desmontarOEcra();

    resposta.resolver({ clientes: clientesDeTeste() });
    await assentar();

    expect(erros).not.toHaveBeenCalled();
    erros.mockRestore();
  });
});

describe("o aviso e a linha de estado", () => {
  it("ao abrir, não há aviso nem linha de estado com texto", async () => {
    await abrirClientes();
    expect(aviso()).toBeNull();
    expect(
      screen.queryAllByRole("status").filter((s) => (s.textContent ?? "").trim() !== ""),
    ).toHaveLength(0);
  });
});
