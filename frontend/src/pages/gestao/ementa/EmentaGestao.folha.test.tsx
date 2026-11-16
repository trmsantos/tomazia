/**
 * F4-02, secção 7 de `docs/ecras/F4-02.md` e decisão D1 — a folha de adicionar e
 * de editar produto (`FolhaDoProduto`: `modo: adicionar | editar`).
 *
 * Contrato do que se vê (nomes exatos da spec):
 *  - «Adicionar produto» (botão por cima dos chips) abre uma `<dialog>` com esse
 *    título; tocar no NOME de uma linha abre a mesma folha com o título «Editar
 *    produto». Campos: «Nome (obrigatório)», «Descrição (opcional)», «Preço, em
 *    euros (obrigatório)», «Categoria (obrigatória)» (`<select>` nativo) e, **só
 *    ao adicionar**, o interruptor «Disponível» (ligado). Botões: «Guardar
 *    produto» / «Guardar alterações» e «Cancelar»;
 *  - o `POST` omite a descrição vazia; o `PATCH` leva **só** o que mudou em
 *    relação ao produto aberto; descrição apagada → `descricao: null`;
 *  - preço a 0 (ou 10×) na folha de editar → o aviso de D3 com «Desfazer» que
 *    repõe **só o preço**.
 *
 * Regra 10: **sem resposta numa criação nunca se reenvia** (duplicava o produto)
 * — recarrega por baixo e a folha diz que não conseguiu; 404 fecha e recarrega.
 *
 * **Deixa passar:** o foco preso e a devolução do foco ao abridor (comportamento
 * nativo do `<dialog>`: e2e); o `Esc` e a cortina.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  erro401,
  erro404,
  erro422,
  erroDoServidor,
  erroSemResposta,
  produtoDeTeste,
  TEXTOS_DA_EMENTA_GESTAO as T,
} from "../../../testes/gestao";
import {
  PROIBIDOS_DA_F4_02,
  abrirEmenta,
  alterarFalso,
  aviso,
  comSinal,
  criarFalso,
  desfazerDoAviso,
  assentar,
  obterFalso,
  pendente,
  prepararApi,
  tocar,
} from "../../../testes/ementa-gestao";

vi.mock("../../../lib/api/gestao-ementa", () => ({
  obterEmentaGestao: vi.fn(),
  criarProduto: vi.fn(),
  alterarProduto: vi.fn(),
  reordenarProdutos: vi.fn(),
}));

const VINHO = "Vinho tinto da casa";
const GARRAFEIRA = "/gestao/ementa?categoria=garrafeira";

function vinhoCom(parcial: Partial<ReturnType<typeof produtoDeTeste>> = {}) {
  return produtoDeTeste({
    id: 201,
    categoria_id: 2,
    nome: VINHO,
    descricao: "Tinto, copo",
    preco_cent: 650,
    ...parcial,
  });
}

beforeEach(() => {
  prepararApi();
});

function folha(): HTMLElement {
  return screen.getByRole("dialog");
}
function campo(etiqueta: string): HTMLElement {
  return within(folha()).getByLabelText(etiqueta);
}
function escrever(etiqueta: string, valor: string): void {
  fireEvent.change(campo(etiqueta), { target: { value: valor } });
}
function escolherCategoria(nome: string): void {
  const select = campo(T.etiquetaCategoria) as HTMLSelectElement;
  const opcao = Array.from(select.options).find((o) => o.textContent === nome);
  if (opcao === undefined) throw new Error(`o <select> não tem a categoria «${nome}»`);
  fireEvent.change(select, { target: { value: opcao.value } });
}
async function submeter(botao: string): Promise<void> {
  await tocar(within(folha()).getByRole("button", { name: botao }));
}
function nomesDaLista(): string[] {
  return screen
    .getAllByRole("button", {
      name: /^(?!Alterar o preço|Ordenar|Adicionar|Guardar|Cancelar|Desfazer|Fechar|Tentar)/,
    })
    .map((b) => b.textContent ?? "")
    .filter((t) => t !== "");
}

describe("«Adicionar produto»: a folha (7.1)", () => {
  it("abre uma <dialog> com o título e os campos, pela ordem, com as etiquetas exatas", async () => {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));

    expect(screen.getByRole("dialog", { name: T.tituloAdicionar })).toBeInTheDocument();
    const etiquetas = [
      T.etiquetaNome,
      T.etiquetaDescricao,
      T.etiquetaPrecoDaFolha,
      T.etiquetaCategoria,
    ].map((e) => campo(e));
    const ordem = Array.from(folha().querySelectorAll("input, textarea, select, button")).filter(
      (el) => etiquetas.includes(el as HTMLElement),
    );
    expect(ordem).toEqual(etiquetas);
    expect(within(folha()).getByRole("switch", { name: T.etiquetaDisponivel })).toBeChecked();
    expect(within(folha()).getByRole("button", { name: T.guardarProduto })).toBeInTheDocument();
    expect(within(folha()).getByRole("button", { name: T.cancelar })).toBeInTheDocument();
  });

  it("o preço da folha: inputmode decimal e sem type=number; sem autofocus no nome", async () => {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));

    expect(campo(T.etiquetaPrecoDaFolha)).toHaveAttribute("inputmode", "decimal");
    expect(campo(T.etiquetaPrecoDaFolha).getAttribute("type")).not.toBe("number");
    expect(document.activeElement).not.toBe(campo(T.etiquetaNome));
  });

  it("a categoria vem escolhida: a do chip ativo", async () => {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    expect(campo(T.etiquetaCategoria)).toHaveDisplayValue("Garrafeira");
  });

  it("com pesquisa ativa não há categoria escolhida («Escolhe a categoria»)", async () => {
    await abrirEmenta();
    fireEvent.change(screen.getByLabelText(T.pesquisa), { target: { value: "cafe" } });
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    expect(campo(T.etiquetaCategoria)).toHaveDisplayValue(T.escolheACategoria);
  });

  it("o <select> lista todas as categorias, as escondidas e as vazias incluídas", async () => {
    await abrirEmenta();
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    const nomes = Array.from((campo(T.etiquetaCategoria) as HTMLSelectElement).options).map(
      (o) => o.textContent,
    );
    for (const categoria of ["Cafetaria", "Garrafeira", "Sobremesas", "Petiscos", "Sumos"]) {
      expect(nomes).toContain(categoria);
    }
  });

  it("Cancelar fecha sem pedido e sem perguntar", async () => {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Qualquer");
    await submeter(T.cancelar);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(criarFalso).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
  });
});

describe("«Adicionar produto»: validação antes de qualquer pedido (7.1)", () => {
  async function abrir(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
  }

  it("nome vazio (ou só espaços): «Escreve o nome do produto.», foco no Nome, aria-invalid, sem pedido", async () => {
    await abrir();
    escrever(T.etiquetaNome, "   ");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    await submeter(T.guardarProduto);

    expect(within(folha()).getByText(T.erroNomeVazio)).toBeInTheDocument();
    expect(campo(T.etiquetaNome)).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(campo(T.etiquetaNome));
    expect(criarFalso).not.toHaveBeenCalled();
  });

  it("nome com 121 caracteres: erro; com 120, passa", async () => {
    await abrir();
    escrever(T.etiquetaNome, "a".repeat(121));
    escrever(T.etiquetaPrecoDaFolha, "1");
    await submeter(T.guardarProduto);
    expect(within(folha()).getByText(T.erroNomeLongo)).toBeInTheDocument();
    expect(criarFalso).not.toHaveBeenCalled();

    criarFalso.mockResolvedValue(
      produtoDeTeste({ id: 900, categoria_id: 2, nome: "a".repeat(120) }),
    );
    escrever(T.etiquetaNome, "a".repeat(120));
    await submeter(T.guardarProduto);
    expect(criarFalso).toHaveBeenCalledTimes(1);
  });

  it("descrição com 281 caracteres: erro, sem pedido", async () => {
    await abrir();
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaDescricao, "d".repeat(281));
    escrever(T.etiquetaPrecoDaFolha, "1");
    await submeter(T.guardarProduto);

    expect(within(folha()).getByText(T.erroDescricaoLonga)).toBeInTheDocument();
    expect(criarFalso).not.toHaveBeenCalled();
  });

  it.each([
    ["", T.erroPrecoVazio],
    ["abc", T.erroPrecoInvalido],
    ["6,505", T.erroPrecoDecimais],
    ["21474836,48", T.erroPrecoAlto],
  ])("preço %j: «%s», sem pedido", async (texto, frase) => {
    await abrir();
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, texto);
    await submeter(T.guardarProduto);

    expect(within(folha()).getByText(frase)).toBeInTheDocument();
    expect(campo(T.etiquetaPrecoDaFolha)).toHaveAttribute("aria-invalid", "true");
    expect(criarFalso).not.toHaveBeenCalled();
  });

  it("categoria por escolher: «Escolhe a categoria.»", async () => {
    await abrirEmenta();
    fireEvent.change(screen.getByLabelText(T.pesquisa), { target: { value: "cafe" } });
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, "1");
    await submeter(T.guardarProduto);

    expect(within(folha()).getByText(T.erroCategoriaEmFalta)).toBeInTheDocument();
    expect(criarFalso).not.toHaveBeenCalled();
  });

  it("vários erros: o primeiro campo inválido (pela ordem do ecrã) fica com o foco", async () => {
    await abrir();
    escrever(T.etiquetaPrecoDaFolha, "abc");
    await submeter(T.guardarProduto);
    expect(document.activeElement).toBe(campo(T.etiquetaNome));
  });
});

describe("«Adicionar produto»: sucesso (201)", () => {
  async function adicionarAguaTonica(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    await submeter(T.guardarProduto);
  }

  it("um POST com o corpo exato, SEM descrição quando está vazia; disponível true", async () => {
    criarFalso.mockResolvedValue(
      produtoDeTeste({ id: 900, categoria_id: 2, nome: "Água tónica", preco_cent: 150 }),
    );
    await adicionarAguaTonica();

    expect(criarFalso).toHaveBeenCalledTimes(1);
    expect(criarFalso).toHaveBeenCalledWith(
      { categoria_id: 2, nome: "Água tónica", preco_cent: 150, disponivel: true },
      comSinal,
    );
    expect("descricao" in (criarFalso.mock.calls[0]?.[0] ?? {})).toBe(false);
  });

  it("com descrição, ela vai; o interruptor desligado manda disponivel false", async () => {
    criarFalso.mockResolvedValue(produtoDeTeste({ id: 900, categoria_id: 2, nome: "Água tónica" }));
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaDescricao, "Garrafa pequena");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    fireEvent.click(within(folha()).getByRole("switch", { name: T.etiquetaDisponivel }));
    await submeter(T.guardarProduto);

    expect(criarFalso).toHaveBeenCalledWith(
      {
        categoria_id: 2,
        nome: "Água tónica",
        descricao: "Garrafa pequena",
        preco_cent: 150,
        disponivel: false,
      },
      comSinal,
    );
  });

  it("a folha fecha; o produto entra no FIM da categoria; «Produto adicionado.» sem «Desfazer»; foco no nome da linha nova", async () => {
    criarFalso.mockResolvedValue(
      produtoDeTeste({ id: 900, categoria_id: 2, nome: "Água tónica", preco_cent: 150 }),
    );
    await adicionarAguaTonica();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(nomesDaLista().slice(-1)).toEqual(["Água tónica"]);
    expect(aviso()).toHaveTextContent(T.produtoAdicionado);
    expect(aviso()).toHaveAttribute("role", "status");
    expect(desfazerDoAviso(), "desfazer seria eliminar: F4-02b").toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Água tónica" }));
  });

  it("noutra categoria: a lista passa a essa categoria (chip e endereço)", async () => {
    criarFalso.mockResolvedValue(
      produtoDeTeste({ id: 900, categoria_id: 1, nome: "Água tónica", preco_cent: 150 }),
    );
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    escolherCategoria("Cafetaria");
    await submeter(T.guardarProduto);

    expect(criarFalso.mock.calls[0]?.[0].categoria_id).toBe(1);
    expect(screen.getByRole("heading", { level: 2, name: "Cafetaria" })).toBeInTheDocument();
    expect(window.location.search).toBe("?categoria=cafetaria");
    expect(nomesDaLista().slice(-1)).toEqual(["Água tónica"]);
  });

  it("preço 0: o aviso é o do zero (uma só mensagem), não «Produto adicionado.»", async () => {
    criarFalso.mockResolvedValue(
      produtoDeTeste({ id: 900, categoria_id: 2, nome: "Brinde", preco_cent: 0 }),
    );
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Brinde");
    escrever(T.etiquetaPrecoDaFolha, "0");
    await submeter(T.guardarProduto);

    expect(aviso()).toHaveTextContent(T.avisoOferta);
    expect(aviso()?.textContent).not.toContain(T.produtoAdicionado);
  });
});

describe("«Adicionar produto»: erros — a folha não fecha e nada se perde", () => {
  async function tentar(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaDescricao, "Garrafa pequena");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    await submeter(T.guardarProduto);
  }

  it("5xx: a frase do servidor na folha, valores mantidos, sem recarregar", async () => {
    criarFalso.mockRejectedValue(erroDoServidor(500));
    await tentar();

    expect(within(folha()).getByText(T.erroGuardarServidor)).toBeInTheDocument();
    expect(campo(T.etiquetaNome)).toHaveValue("Água tónica");
    expect(campo(T.etiquetaDescricao)).toHaveValue("Garrafa pequena");
    expect(campo(T.etiquetaPrecoDaFolha)).toHaveValue("1,5");
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/mensagem do backend|mensagem do cliente/)).toBeNull();
  });

  it("sem resposta: NÃO reenvia (um POST), recarrega por baixo, a frase está na folha, valores mantidos", async () => {
    criarFalso.mockRejectedValue(erroSemResposta());
    await tentar();

    expect(criarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(within(folha()).getByText(T.erroCriarSemResposta)).toBeInTheDocument();
    expect(folha().textContent ?? "").not.toMatch(/Não consegui guardar|tenta outra vez/i);
    expect(campo(T.etiquetaNome)).toHaveValue("Água tónica");
  });

  it("422 com campo=categoria_id: «Essa categoria já não existe. Escolhe outra.» junto de «Categoria»", async () => {
    criarFalso.mockRejectedValue(erro422("categoria_id", "categoria_inexistente"));
    await tentar();

    expect(within(folha()).getByText(T.erroCategoriaInexistente)).toBeInTheDocument();
    expect(campo(T.etiquetaCategoria)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/o corpo não é válido/)).toBeNull();
  });

  it("422 com campo=preco_cent: «O preço não é válido.» junto do preço", async () => {
    criarFalso.mockRejectedValue(erro422("preco_cent"));
    await tentar();
    expect(within(folha()).getByText(T.erroPreco422)).toBeInTheDocument();
    expect(campo(T.etiquetaPrecoDaFolha)).toHaveAttribute("aria-invalid", "true");
  });

  it("422 com campo=nome: o erro fica no Nome (nunca a mensagem do backend)", async () => {
    criarFalso.mockRejectedValue(erro422("nome"));
    await tentar();
    expect(campo(T.etiquetaNome)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/o corpo não é válido/)).toBeNull();
  });

  it("422 sem campo: «Não consegui guardar. Confirma os campos e tenta outra vez.»", async () => {
    criarFalso.mockRejectedValue(erro422(null));
    await tentar();
    expect(within(folha()).getByText(T.erro422SemCampo)).toBeInTheDocument();
  });

  it("duplo toque em «Guardar produto» = um pedido; durante o pedido, «A guardar…» com aria-busy", async () => {
    criarFalso.mockReturnValue(new Promise(() => undefined));
    await tentar();

    const botao = within(folha()).getByRole("button", { name: T.aGuardar });
    expect(botao).toHaveAttribute("aria-busy", "true");
    await tocar(botao);
    await tocar(botao);
    expect(criarFalso).toHaveBeenCalledTimes(1);
  });

  it("401: aoPerderSessao uma vez; 403 e 500 nunca", async () => {
    criarFalso.mockRejectedValue(erro401());
    const sessao = await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    await submeter(T.guardarProduto);
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it("403 nunca leva ao login", async () => {
    criarFalso.mockRejectedValue(erroDoServidor(403));
    const sessao = await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    await submeter(T.guardarProduto);
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
  });
});

describe("«Editar produto»: a folha (7.2)", () => {
  async function abrir(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: VINHO }));
  }

  it("tocar no NOME abre «Editar produto», pré-preenchida, com «Guardar alterações» e SEM «Disponível»", async () => {
    await abrir();

    expect(screen.getByRole("dialog", { name: T.tituloEditar })).toBeInTheDocument();
    expect(campo(T.etiquetaNome)).toHaveValue(VINHO);
    expect(campo(T.etiquetaDescricao)).toHaveValue("Tinto, copo");
    expect(campo(T.etiquetaPrecoDaFolha)).toHaveValue("6,50");
    expect(campo(T.etiquetaCategoria)).toHaveDisplayValue("Garrafeira");
    expect(within(folha()).queryByRole("switch")).toBeNull();
    expect(within(folha()).getByRole("button", { name: T.guardarAlteracoes })).toBeInTheDocument();
    expect(within(folha()).queryByRole("button", { name: T.guardarProduto })).toBeNull();
  });

  it("sem botão de eliminar nem de categorias (F4-02b)", async () => {
    await abrir();
    expect(folha().textContent ?? "").not.toMatch(PROIBIDOS_DA_F4_02);
  });

  it("o produto sem descrição abre com a descrição vazia", async () => {
    await abrirEmenta();
    await tocar(screen.getByRole("button", { name: "Café" }));
    expect(campo(T.etiquetaDescricao)).toHaveValue("");
  });

  it("nada mudou: fecha sem pedido e sem aviso", async () => {
    await abrir();
    await submeter(T.guardarAlteracoes);

    expect(alterarFalso).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(aviso()).toBeNull();
  });

  it("mudar o nome e voltar ao original conta como «nada mudou»", async () => {
    await abrir();
    escrever(T.etiquetaNome, "Outro");
    escrever(T.etiquetaNome, VINHO);
    await submeter(T.guardarAlteracoes);
    expect(alterarFalso).not.toHaveBeenCalled();
  });

  it("«6,5» escrito sobre 6,50 também é «nada mudou»", async () => {
    await abrir();
    escrever(T.etiquetaPrecoDaFolha, "6,5");
    await submeter(T.guardarAlteracoes);
    expect(alterarFalso).not.toHaveBeenCalled();
  });
});

describe("«Editar produto»: só as chaves que mudaram", () => {
  async function abrir(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: VINHO }));
  }

  it("só o nome → {nome}; a linha passa a ter o nome novo; «Produto atualizado.» sem «Desfazer»", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ nome: "Tinto da casa" }));
    await abrir();
    escrever(T.etiquetaNome, "Tinto da casa");
    await submeter(T.guardarAlteracoes);

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).toHaveBeenCalledWith(201, { nome: "Tinto da casa" }, comSinal);
    expect(Object.keys(alterarFalso.mock.calls[0]?.[1] ?? {})).toEqual(["nome"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Tinto da casa" })).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(T.produtoAtualizado);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("descrição apagada → {descricao: null}", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ descricao: null }));
    await abrir();
    escrever(T.etiquetaDescricao, "");
    await submeter(T.guardarAlteracoes);

    expect(alterarFalso).toHaveBeenCalledWith(201, { descricao: null }, comSinal);
  });

  it("descrição mudada → {descricao: texto}", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ descricao: "Tinto, garrafa" }));
    await abrir();
    escrever(T.etiquetaDescricao, "Tinto, garrafa");
    await submeter(T.guardarAlteracoes);
    expect(alterarFalso).toHaveBeenCalledWith(201, { descricao: "Tinto, garrafa" }, comSinal);
  });

  it("nome e preço → exatamente essas duas chaves", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ nome: "Tinto", preco_cent: 700 }));
    await abrir();
    escrever(T.etiquetaNome, "Tinto");
    escrever(T.etiquetaPrecoDaFolha, "7");
    await submeter(T.guardarAlteracoes);

    expect(alterarFalso).toHaveBeenCalledWith(201, { nome: "Tinto", preco_cent: 700 }, comSinal);
    expect(aviso()).toHaveTextContent(T.produtoAtualizado);
  });

  it("mudar a categoria → {categoria_id}; sai da lista atual; «Produto movido para Cafetaria.»; na Cafetaria é o último", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ categoria_id: 1 }));
    await abrir();
    escolherCategoria("Cafetaria");
    await submeter(T.guardarAlteracoes);

    expect(alterarFalso).toHaveBeenCalledWith(201, { categoria_id: 1 }, comSinal);
    expect(screen.queryByRole("button", { name: VINHO })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Garrafeira" })).toBeInTheDocument();
    expect(aviso()).toHaveTextContent("Produto movido para Cafetaria.");

    await tocar(screen.getByRole("link", { name: "Cafetaria" }));
    expect(nomesDaLista().slice(-1)).toEqual([VINHO]);
  });
});

describe("«Editar produto»: o preço perigoso na folha (D3)", () => {
  async function abrir(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: VINHO }));
  }

  it("preço → 0: o aviso de oferta COM «Desfazer», que repõe SÓ o preço", async () => {
    alterarFalso.mockResolvedValueOnce(vinhoCom({ nome: "Tinto novo", preco_cent: 0 }));
    await abrir();
    escrever(T.etiquetaNome, "Tinto novo");
    escrever(T.etiquetaPrecoDaFolha, "0");
    await submeter(T.guardarAlteracoes);

    expect(alterarFalso).toHaveBeenCalledWith(201, { nome: "Tinto novo", preco_cent: 0 }, comSinal);
    expect(aviso()).toHaveTextContent(T.avisoOferta);
    expect(desfazerDoAviso()).not.toBeNull();

    alterarFalso.mockResolvedValueOnce(vinhoCom({ nome: "Tinto novo", preco_cent: 650 }));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(alterarFalso).toHaveBeenLastCalledWith(201, { preco_cent: 650 }, comSinal);
    expect(Object.keys(alterarFalso.mock.calls[1]?.[1] ?? {})).toEqual(["preco_cent"]);
    expect(
      screen.getByRole("button", { name: "Tinto novo" }),
      "o nome novo fica",
    ).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(T.alteracaoDesfeita);
  });

  it("preço ×10 (6,50 → 65): aviso «Preço atualizado para 65,00 €.» COM «Desfazer»", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ preco_cent: 6500 }));
    await abrir();
    escrever(T.etiquetaPrecoDaFolha, "65");
    await submeter(T.guardarAlteracoes);

    expect(aviso()).toHaveTextContent(/Preço atualizado para 65,00 €\./);
    expect(desfazerDoAviso()).not.toBeNull();
  });

  it("preço normal na folha: «Produto atualizado.» sem «Desfazer»", async () => {
    alterarFalso.mockResolvedValue(vinhoCom({ preco_cent: 700 }));
    await abrir();
    escrever(T.etiquetaPrecoDaFolha, "7");
    await submeter(T.guardarAlteracoes);

    expect(aviso()).toHaveTextContent(T.produtoAtualizado);
    expect(desfazerDoAviso()).toBeNull();
  });
});

describe("«Editar produto»: erros", () => {
  async function tentar(): Promise<void> {
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: VINHO }));
    escrever(T.etiquetaNome, "Tinto novo");
    await submeter(T.guardarAlteracoes);
  }

  it("422 com campo=nome: junto do Nome, a folha fica aberta, valores mantidos", async () => {
    alterarFalso.mockRejectedValue(erro422("nome"));
    await tentar();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(campo(T.etiquetaNome)).toHaveAttribute("aria-invalid", "true");
    expect(campo(T.etiquetaNome)).toHaveValue("Tinto novo");
    expect(screen.queryByText(/o corpo não é válido/)).toBeNull();
  });

  it("422 categoria_inexistente: junto de «Categoria» e recarrega", async () => {
    alterarFalso.mockRejectedValue(erro422("categoria_id", "categoria_inexistente"));
    await tentar();

    expect(within(folha()).getByText(T.erroCategoriaInexistente)).toBeInTheDocument();
    expect(obterFalso).toHaveBeenCalledTimes(2);
  });

  it("404: a folha fecha, aviso de erro «Este produto já não existe. Atualizei a ementa.» e recarrega", async () => {
    alterarFalso.mockRejectedValue(erro404("produto_inexistente"));
    await tentar();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()).toHaveTextContent(T.erro404Produto);
    expect(obterFalso).toHaveBeenCalledTimes(2);
  });

  it("5xx: erro na folha, valores mantidos, sem recarregar", async () => {
    alterarFalso.mockRejectedValue(erroDoServidor(500));
    await tentar();

    expect(within(folha()).getByText(T.erroGuardarServidor)).toBeInTheDocument();
    expect(campo(T.etiquetaNome)).toHaveValue("Tinto novo");
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("sem resposta: NÃO reenvia, recarrega por baixo, a frase está na folha", async () => {
    alterarFalso.mockRejectedValue(erroSemResposta());
    await tentar();

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(within(folha()).getByText(/^Não consegui (guardar|confirmar)\./)).toBeInTheDocument();
    expect(campo(T.etiquetaNome)).toHaveValue("Tinto novo");
  });

  it("duplo toque em «Guardar alterações» = um pedido", async () => {
    alterarFalso.mockReturnValue(new Promise(() => undefined));
    await tentar();
    const botao = within(folha()).getByRole("button", { name: T.aGuardar });
    await tocar(botao);
    await tocar(botao);
    expect(alterarFalso).toHaveBeenCalledTimes(1);
  });

  it("401: aoPerderSessao uma vez", async () => {
    alterarFalso.mockRejectedValue(erro401());
    const sessao = await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: VINHO }));
    escrever(T.etiquetaNome, "Tinto novo");
    await submeter(T.guardarAlteracoes);
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });
});

describe("uma resposta tardia não fecha outra folha (6)", () => {
  it("editar lento, cancelar e abrir «Adicionar produto»: a resposta de editar não fecha a nova folha", async () => {
    const lento = pendente<ReturnType<typeof vinhoCom>>();
    alterarFalso.mockReturnValue(lento.promessa);
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: VINHO }));
    escrever(T.etiquetaNome, "Tinto novo");
    await submeter(T.guardarAlteracoes);

    await tocar(within(folha()).getByRole("button", { name: T.cancelar }));
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    expect(screen.getByRole("dialog", { name: T.tituloAdicionar })).toBeInTheDocument();

    await act(async () => {
      lento.resolver(vinhoCom({ nome: "Tinto novo" }));
      await Promise.resolve();
    });
    await assentar();

    expect(screen.getByRole("dialog", { name: T.tituloAdicionar })).toBeInTheDocument();
  });

  it("adicionar lento, cancelar e abrir a edição: a resposta de adicionar não fecha a edição", async () => {
    const lento = pendente<ReturnType<typeof produtoDeTeste>>();
    criarFalso.mockReturnValue(lento.promessa);
    await abrirEmenta(GARRAFEIRA);
    await tocar(screen.getByRole("button", { name: T.adicionarProduto }));
    escrever(T.etiquetaNome, "Água tónica");
    escrever(T.etiquetaPrecoDaFolha, "1,5");
    await submeter(T.guardarProduto);

    await tocar(within(folha()).getByRole("button", { name: T.cancelar }));
    await tocar(screen.getByRole("button", { name: VINHO }));
    expect(screen.getByRole("dialog", { name: T.tituloEditar })).toBeInTheDocument();

    await act(async () => {
      lento.resolver(produtoDeTeste({ id: 900, categoria_id: 2, nome: "Água tónica" }));
      await Promise.resolve();
    });
    await assentar();

    expect(screen.getByRole("dialog", { name: T.tituloEditar })).toBeInTheDocument();
  });
});
