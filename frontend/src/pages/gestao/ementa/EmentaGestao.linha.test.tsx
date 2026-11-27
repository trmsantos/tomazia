/**
 * F4-02, secções 4 e 5 de `docs/ecras/F4-02.md` e decisão D3 — a linha de gestão:
 * o preço que vira campo, o aviso (com «Desfazer» nos casos perigosos) e o
 * interruptor «Disponível».
 *
 * Contrato do que se vê (nomes exatos da spec):
 *  - o preço é um `<button>` com nome acessível «Alterar o preço de {nome}, agora
 *    {preço}» («agora oferta» para 0); toque → campo «Preço, em euros» no lugar,
 *    `inputmode="decimal"`, `enterkeyhint="done"`, sem `type="number"`, valor
 *    selecionado, «Guardar» / «Cancelar»; Enter guarda, Esc cancela;
 *  - o aviso é o `AvisoTemporario`: sucesso = `role=status` («Feito. …»), erro =
 *    `role=alert` («Erro. …»); só um de cada vez;
 *  - **«Desfazer» é uma compensação:** um pedido novo com o valor anterior.
 *    Sucesso → o aviso «Alteração desfeita» (plano, 3) sem «Desfazer».
 *
 * Regra 10 nas mutações: **sem resposta = «não sei se gravou»** → o ecrã não
 * finge nem reenvia sozinho (um único pedido) e recarrega a lista por baixo;
 * 4xx/5xx → repõe sem recarregar; 404 → recarrega.
 *
 * Onde o plano e a spec divergem, os testes seguem o plano (o «Desfazer» com
 * sucesso mostra «Alteração desfeita») e só prendem o que as duas dizem.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ementaDeGestaoDeTeste,
  erro401,
  erro404,
  erro422,
  erroDoServidor,
  erroSemResposta,
  produtoDeTeste,
  type RespostaEmentaGestao,
  TEXTOS_DA_EMENTA_GESTAO as T,
} from "../../../testes/gestao";
import {
  PROIBIDOS_DA_F4_02,
  abrirEmenta,
  alterarFalso,
  aviso,
  botaoDoPreco,
  campoDoPreco,
  comSinal,
  desfazerDoAviso,
  escreverPreco,
  guardarPreco,
  linhaDe,
  nomeDoBotaoDoPreco,
  obterFalso,
  pendente,
  prepararApi,
  tocar,
  assentar,
} from "../../../testes/ementa-gestao";

vi.mock("../../../lib/api/gestao-ementa", () => ({
  obterEmentaGestao: vi.fn(),
  criarProduto: vi.fn(),
  alterarProduto: vi.fn(),
  reordenarProdutos: vi.fn(),
}));

const VINHO = "Vinho tinto da casa";
const GARRAFEIRA = "/gestao/ementa?categoria=garrafeira";

function vinho(precoCent: number) {
  return produtoDeTeste({
    id: 201,
    categoria_id: 2,
    nome: VINHO,
    descricao: "Tinto, copo",
    preco_cent: precoCent,
  });
}

beforeEach(() => {
  prepararApi();
});

/** Abre a edição do preço do vinho (6,50 €). */
async function abrirPrecoDoVinho(): Promise<void> {
  await tocar(botaoDoPreco(VINHO, "6,50 €"));
}

async function mudarPrecoPara(texto: string): Promise<void> {
  await abrirPrecoDoVinho();
  escreverPreco(texto);
  await guardarPreco();
}

describe("o botão do preço", () => {
  it("nome acessível «Alterar o preço de {nome}, agora {preço}» e aria-expanded", async () => {
    await abrirEmenta(GARRAFEIRA);
    const botao = botaoDoPreco(VINHO, "6,50 €");

    expect(botao).toHaveAttribute("type", "button");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).toHaveTextContent("6,50 €");
  });

  it("o preço é Bricolage pelo `font-preco`: o DM Sans não tem `tnum` (R-01 6.8)", async () => {
    await abrirEmenta(GARRAFEIRA);
    const classes = botaoDoPreco(VINHO, "6,50 €").className.split(/\s+/);

    expect(classes).toContain("font-preco");
    expect(classes.filter((classe) => /^font-(normal|medio|forte)$/.test(classe))).toEqual([]);
  });

  it("zero é «Oferta» e o nome diz «agora oferta»", async () => {
    prepararApi({
      categorias: [
        {
          id: 1,
          nome: "Cafetaria",
          slug: "cafetaria",
          visivel: true,
          produtos: [produtoDeTeste({ id: 1, categoria_id: 1, nome: "Água", preco_cent: 0 })],
        },
      ],
    });
    await abrirEmenta();

    expect(
      screen.getByRole("button", { name: /^Alterar o preço de Água, agora oferta$/ }),
    ).toHaveTextContent("Oferta");
  });
});

describe("abrir a edição (4.2)", () => {
  it("um toque abre o campo NO LUGAR, com o valor «6,50» selecionado e o foco lá", async () => {
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();

    const campo = campoDoPreco();
    expect(campo).toHaveValue("6,50");
    expect(document.activeElement).toBe(campo);
    expect(campo.selectionStart).toBe(0);
    expect(campo.selectionEnd).toBe(4);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: nomeDoBotaoDoPreco(VINHO, "6,50 €") })).toBeNull();
  });

  it("o campo: inputmode decimal, enterkeyhint done, sem type=number, sem autocomplete", async () => {
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    const campo = campoDoPreco();

    expect(campo).toHaveAttribute("inputmode", "decimal");
    expect(campo).toHaveAttribute("enterkeyhint", "done");
    expect(campo).toHaveAttribute("autocomplete", "off");
    expect(campo).toHaveAttribute("autocapitalize", "none");
    expect(campo).toHaveAttribute("spellcheck", "false");
    expect(campo.getAttribute("type")).not.toBe("number");
  });

  it("o valor inicial usa vírgula, sem ponto de milhares (120000 → «1200,00»; 0 → «0»)", async () => {
    prepararApi({
      categorias: [
        {
          id: 1,
          nome: "Garrafeira",
          slug: "garrafeira",
          visivel: true,
          produtos: [
            produtoDeTeste({ id: 1, categoria_id: 1, nome: "Magnum", preco_cent: 120_000 }),
            produtoDeTeste({ id: 2, categoria_id: 1, nome: "Água", preco_cent: 0 }),
          ],
        },
      ],
    });
    await abrirEmenta();

    await tocar(screen.getByRole("button", { name: /^Alterar o preço de Magnum/ }));
    expect(campoDoPreco()).toHaveValue("1200,00");

    await tocar(screen.getByRole("button", { name: /^Alterar o preço de Água/ }));
    expect(campoDoPreco()).toHaveValue("0");
  });

  it("um preço de cada vez: abrir outro fecha o primeiro sem guardar e sem pedido", async () => {
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    escreverPreco("9,99");

    await tocar(botaoDoPreco("Espumante", "12,00 €"));

    expect(screen.getAllByLabelText("Preço, em euros")).toHaveLength(1);
    expect(campoDoPreco()).toHaveValue("12,00");
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(botaoDoPreco(VINHO, "6,50 €")).toBeInTheDocument();
  });

  it("Cancelar e Esc fecham, devolvem o foco ao botão do preço e não fazem pedido", async () => {
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    escreverPreco("7");
    await tocar(screen.getByRole("button", { name: T.cancelar }));

    expect(alterarFalso).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(botaoDoPreco(VINHO, "6,50 €"));

    await abrirPrecoDoVinho();
    fireEvent.keyDown(campoDoPreco(), { key: "Escape" });
    await assentar();
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Preço, em euros")).toBeNull();
    expect(document.activeElement).toBe(botaoDoPreco(VINHO, "6,50 €"));
  });
});

describe("o que se aceita e o erro que se diz (4.3): sem pedido nos erros", () => {
  it.each([
    ["", T.erroPrecoVazio],
    ["   ", T.erroPrecoVazio],
    ["abc", T.erroPrecoInvalido],
    ["6,5a", T.erroPrecoInvalido],
    ["-3", T.erroPrecoInvalido],
    ["1 250", T.erroPrecoInvalido],
    ["6,505", T.erroPrecoDecimais],
    ["1.250", T.erroPrecoDecimais],
    ["21474836,48", T.erroPrecoAlto],
  ])("%j → «%s», o foco no campo, aria-invalid e nenhum pedido", async (texto, frase) => {
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    escreverPreco(texto);
    await guardarPreco();

    expect(alterarFalso).not.toHaveBeenCalled();
    const campo = campoDoPreco();
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(campo);
    expect(screen.getByText(frase)).toBeInTheDocument();
    const ligadoA = campo.getAttribute("aria-describedby") ?? "";
    expect(
      ligadoA.split(" ").some((id) => document.getElementById(id)?.textContent === frase),
    ).toBe(true);
  });

  it("o erro limpa-se ao escrever", async () => {
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    escreverPreco("abc");
    await guardarPreco();
    escreverPreco("6");
    expect(screen.queryByText(T.erroPrecoInvalido)).toBeNull();
    expect(campoDoPreco()).not.toHaveAttribute("aria-invalid", "true");
  });
});

describe("guardar: sucesso (4.4) — dois toques e o valor da RESPOSTA", () => {
  it("«7,5» sobre 6,50: um PATCH com {preco_cent: 750} e nada mais; sinal no fim", async () => {
    alterarFalso.mockResolvedValue(vinho(750));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).toHaveBeenCalledWith(201, { preco_cent: 750 }, comSinal);
    expect(Object.keys(alterarFalso.mock.calls[0]?.[1] ?? {})).toEqual(["preco_cent"]);
  });

  it("a linha e o aviso usam o preço que o servidor devolveu (7,60 €), não o que se escreveu", async () => {
    alterarFalso.mockResolvedValue(vinho(760));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(botaoDoPreco(VINHO, "7,60 €")).toHaveTextContent("7,60 €");
    expect(aviso()).toHaveTextContent("Preço atualizado para 7,60 €.");
    expect(aviso()).toHaveAttribute("role", "status");
  });

  it("a edição fecha, o foco volta ao botão do preço e o preço normal não leva «Desfazer»", async () => {
    alterarFalso.mockResolvedValue(vinho(750));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(screen.queryByLabelText("Preço, em euros")).toBeNull();
    expect(document.activeElement).toBe(botaoDoPreco(VINHO, "7,50 €"));
    expect(desfazerDoAviso()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter no campo guarda, tal como «Guardar»", async () => {
    alterarFalso.mockResolvedValue(vinho(750));
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    escreverPreco("7,5");
    fireEvent.submit(campoDoPreco().closest("form") as HTMLFormElement);
    await assentar();

    expect(alterarFalso).toHaveBeenCalledWith(201, { preco_cent: 750 }, comSinal);
  });

  it("o mesmo preço («6,5» sobre 650) fecha sem pedido e sem aviso", async () => {
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("6,5");

    expect(alterarFalso).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
    expect(screen.queryByLabelText("Preço, em euros")).toBeNull();
  });

  it("a guardar: «A guardar…», aria-busy, aria-disabled; o campo NÃO fica disabled; duplo toque = um pedido", async () => {
    const lento = pendente<ReturnType<typeof vinho>>();
    alterarFalso.mockReturnValue(lento.promessa);
    await abrirEmenta(GARRAFEIRA);
    await abrirPrecoDoVinho();
    escreverPreco("7");

    await guardarPreco();
    const botao = screen.getByRole("button", { name: T.aGuardar });
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(campoDoPreco()).not.toBeDisabled();

    await tocar(botao);
    fireEvent.submit(campoDoPreco().closest("form") as HTMLFormElement);
    await assentar();
    expect(alterarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("os avisos do preço que pode ser engano (D3, 4.5)", () => {
  it("→ 0: «Este produto fica como oferta na ementa.» COM «Desfazer», linha «Oferta», sem diálogo", async () => {
    alterarFalso.mockResolvedValue(vinho(0));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("0");

    expect(alterarFalso).toHaveBeenCalledWith(201, { preco_cent: 0 }, comSinal);
    expect(aviso()).toHaveTextContent(T.avisoOferta);
    expect(desfazerDoAviso()).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: /^Alterar o preço de Vinho tinto da casa, agora oferta$/,
      }),
    ).toHaveTextContent("Oferta");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("→ 10 vezes (6,50 → 65,00): o aviso diz 65,00 € e leva «Desfazer», sem diálogo", async () => {
    alterarFalso.mockResolvedValue(vinho(6500));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("65");

    expect(aviso()).toHaveTextContent(/Preço atualizado para 65,00 €\./);
    expect(desfazerDoAviso()).not.toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it.each([
    ["650 → 700 (normal)", "7", 700],
    ["650 → 6499 (a um cêntimo da fronteira)", "64,99", 6499],
  ])("%s: sem «Desfazer»", async (_nome, texto, cent) => {
    alterarFalso.mockResolvedValue(vinho(cent));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara(texto);

    expect(aviso()).toHaveTextContent(/Preço atualizado para/);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("de oferta para um preço: aviso normal, sem «Desfazer» (anterior 0 não compara)", async () => {
    prepararApi({
      categorias: [
        {
          id: 1,
          nome: "Cafetaria",
          slug: "cafetaria",
          visivel: true,
          produtos: [produtoDeTeste({ id: 1, categoria_id: 1, nome: "Água", preco_cent: 0 })],
        },
      ],
    });
    alterarFalso.mockResolvedValue(
      produtoDeTeste({ id: 1, categoria_id: 1, nome: "Água", preco_cent: 5000 }),
    );
    await abrirEmenta();
    await tocar(screen.getByRole("button", { name: /^Alterar o preço de Água/ }));
    escreverPreco("50");
    await guardarPreco();

    expect(aviso()).toHaveTextContent("Preço atualizado para 50,00 €.");
    expect(desfazerDoAviso()).toBeNull();
  });

  it("«Desfazer» manda o preço anterior, ABSOLUTO ({preco_cent: 650}); a linha volta a «6,50 €»; «Alteração desfeita» sem «Desfazer»", async () => {
    alterarFalso.mockResolvedValueOnce(vinho(0));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("0");

    alterarFalso.mockResolvedValueOnce(vinho(650));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(alterarFalso).toHaveBeenCalledTimes(2);
    expect(alterarFalso).toHaveBeenLastCalledWith(201, { preco_cent: 650 }, comSinal);
    expect(botaoDoPreco(VINHO, "6,50 €")).toHaveTextContent("6,50 €");
    expect(aviso()).toHaveTextContent(T.alteracaoDesfeita);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("«Desfazer» que falha com 500: a linha fica no preço NOVO e o aviso (erro) diz o preço que ficou", async () => {
    alterarFalso.mockResolvedValueOnce(vinho(6500));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("65");

    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(botaoDoPreco(VINHO, "65,00 €")).toBeInTheDocument();
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()).toHaveTextContent(/Não consegui desfazer\./);
    expect(aviso()).toHaveTextContent(/65,00 €/);
    expect(aviso()).not.toHaveTextContent(T.alteracaoDesfeita);
    expect(obterFalso, "um 500 não recarrega").toHaveBeenCalledTimes(1);
  });

  it("«Desfazer» sem resposta: não sei se desfez → recarrega, e não diz «Alteração desfeita»", async () => {
    alterarFalso.mockResolvedValueOnce(vinho(0));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("0");

    alterarFalso.mockRejectedValueOnce(erroSemResposta());
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()).not.toHaveTextContent(T.alteracaoDesfeita);
    expect(alterarFalso, "nunca reenvia sozinho").toHaveBeenCalledTimes(2);
  });

  it("«Desfazer» com 404: recarrega", async () => {
    alterarFalso.mockResolvedValueOnce(vinho(0));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("0");

    alterarFalso.mockRejectedValueOnce(erro404("produto_inexistente"));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(obterFalso).toHaveBeenCalledTimes(2);
  });
});

describe("guardar: erros (4.4) — a edição não fecha e o valor não se perde", () => {
  it("5xx: a frase do servidor no campo, foco no campo, valor mantido, SEM recarregar", async () => {
    alterarFalso.mockRejectedValue(erroDoServidor(500));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(screen.getByText(T.erroGuardarServidor)).toBeInTheDocument();
    expect(campoDoPreco()).toHaveValue("7,5");
    expect(document.activeElement).toBe(campoDoPreco());
    expect(screen.queryByText(/mensagem do cliente|mensagem do backend/)).toBeNull();
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("sem resposta: não finge e não reenvia (um só PATCH); o ecrã recarrega por baixo (regra 10)", async () => {
    alterarFalso.mockRejectedValue(erroSemResposta());
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Preço, em euros")).toHaveValue("7,5");
    expect(screen.getByText(/^Não consegui (guardar|confirmar)\./)).toBeInTheDocument();
    expect(document.activeElement).toBe(campoDoPreco());
  });

  it("422 com campo=preco_cent: «O preço não é válido.» junto do campo, nunca a mensagem do backend", async () => {
    alterarFalso.mockRejectedValue(erro422("preco_cent"));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(screen.getByText(T.erroPreco422)).toBeInTheDocument();
    expect(screen.queryByText(/o corpo não é válido/)).toBeNull();
    expect(campoDoPreco()).toHaveAttribute("aria-invalid", "true");
  });

  it("404: «Este produto já não existe. Atualizei a ementa.» e recarrega", async () => {
    alterarFalso.mockRejectedValue(erro404("produto_inexistente"));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");

    expect(aviso()).toHaveTextContent(T.erro404Produto);
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(obterFalso).toHaveBeenCalledTimes(2);
  });

  it("401: aoPerderSessao uma vez", async () => {
    alterarFalso.mockRejectedValue(erro401());
    const sessao = await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it.each([[403], [500], [502]])("%i nunca leva ao login", async (estado) => {
    alterarFalso.mockRejectedValue(erroDoServidor(estado));
    const sessao = await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("7,5");
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
  });
});

describe("um aviso de cada vez", () => {
  it("uma segunda ação substitui o aviso, e o «Desfazer» do primeiro já não existe", async () => {
    alterarFalso.mockResolvedValueOnce(vinho(0));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("0");
    expect(desfazerDoAviso()).not.toBeNull();

    alterarFalso.mockResolvedValueOnce(
      produtoDeTeste({ id: 202, categoria_id: 2, nome: "Espumante", preco_cent: 1300 }),
    );
    await tocar(botaoDoPreco("Espumante", "12,00 €"));
    escreverPreco("13");
    await guardarPreco();

    expect(aviso()).toHaveTextContent("Preço atualizado para 13,00 €.");
    expect(desfazerDoAviso()).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Desfazer" })).toHaveLength(0);
  });
});

describe("o interruptor «Disponível» (5)", () => {
  function cafe(disponivel: boolean) {
    return produtoDeTeste({ id: 101, categoria_id: 1, nome: "Café", preco_cent: 120, disponivel });
  }
  function interruptorDoCafe(): HTMLElement {
    return within(linhaDe("Café")).getByRole("switch", { name: T.etiquetaDisponivel });
  }

  it("tocar: muda de imediato (otimista), fica aria-disabled enquanto corre e manda {disponivel: false}", async () => {
    const lento = pendente<ReturnType<typeof cafe>>();
    alterarFalso.mockReturnValue(lento.promessa);
    await abrirEmenta();

    expect(interruptorDoCafe()).toBeChecked();
    await tocar(interruptorDoCafe());

    expect(alterarFalso).toHaveBeenCalledWith(101, { disponivel: false }, comSinal);
    expect(interruptorDoCafe()).not.toBeChecked();
    expect(interruptorDoCafe()).toHaveAttribute("aria-disabled", "true");
    await tocar(interruptorDoCafe());
    expect(alterarFalso, "dois toques não se cruzam").toHaveBeenCalledTimes(1);
  });

  it("sucesso: «Café deixou de estar disponível.» com «Desfazer»; a linha diz «Não aparece na ementa.»", async () => {
    alterarFalso.mockResolvedValue(cafe(false));
    await abrirEmenta();
    await tocar(interruptorDoCafe());

    expect(aviso()).toHaveTextContent("Café deixou de estar disponível.");
    expect(desfazerDoAviso()).not.toBeNull();
    expect(within(linhaDe("Café")).getByText(T.produtoIndisponivel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Café" }), "continua na lista").toBeInTheDocument();
  });

  it("«Desfazer» manda o valor ABSOLUTO anterior ({disponivel: true}), nunca «alternar», e diz «Alteração desfeita»", async () => {
    alterarFalso.mockResolvedValueOnce(cafe(false));
    await abrirEmenta();
    await tocar(interruptorDoCafe());

    alterarFalso.mockResolvedValueOnce(cafe(true));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(alterarFalso).toHaveBeenLastCalledWith(101, { disponivel: true }, comSinal);
    expect(interruptorDoCafe()).toBeChecked();
    expect(aviso()).toHaveTextContent(T.alteracaoDesfeita);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("voltar a ligar: «Café voltou a estar disponível.»", async () => {
    alterarFalso.mockResolvedValue(
      produtoDeTeste({ id: 103, categoria_id: 1, nome: "Cappuccino", disponivel: true }),
    );
    await abrirEmenta();
    await tocar(within(linhaDe("Cappuccino")).getByRole("switch", { name: T.etiquetaDisponivel }));
    expect(aviso()).toHaveTextContent("Cappuccino voltou a estar disponível.");
  });

  it.each([
    ["sem resposta", erroSemResposta(), T.erroGuardarSemResposta],
    ["500", erroDoServidor(500), T.erroGuardarServidor],
  ])(
    "erro (%s): o interruptor volta ao que tinha e o aviso de erro diz a frase",
    async (_n, erro, frase) => {
      alterarFalso.mockRejectedValue(erro);
      await abrirEmenta();
      await tocar(interruptorDoCafe());

      expect(interruptorDoCafe()).toBeChecked();
      expect(aviso()).toHaveAttribute("role", "alert");
      expect(aviso()).toHaveTextContent(frase);
      expect(desfazerDoAviso()).toBeNull();
      expect(alterarFalso, "nunca reenvia sozinho").toHaveBeenCalledTimes(1);
    },
  );

  it("erro sem resposta: recarrega por baixo (regra 10); 500 não", async () => {
    alterarFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirEmenta();
    await tocar(interruptorDoCafe());
    expect(obterFalso).toHaveBeenCalledTimes(2);

    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(interruptorDoCafe());
    expect(obterFalso).toHaveBeenCalledTimes(2);
  });

  it("404: o interruptor volta, recarrega, «Este produto já não existe. Atualizei a ementa.»", async () => {
    alterarFalso.mockRejectedValue(erro404("produto_inexistente"));
    await abrirEmenta();
    await tocar(interruptorDoCafe());

    expect(interruptorDoCafe()).toBeChecked();
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()).toHaveTextContent(T.erro404Produto);
  });

  it("«Desfazer» que falha: o interruptor fica como o servidor o tem (desligado) e o aviso diz «Não consegui desfazer.»", async () => {
    alterarFalso.mockResolvedValueOnce(cafe(false));
    await abrirEmenta();
    await tocar(interruptorDoCafe());

    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(interruptorDoCafe()).not.toBeChecked();
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()).toHaveTextContent(/Não consegui desfazer\./);
    expect(aviso()).not.toHaveTextContent(T.alteracaoDesfeita);
  });

  it("falha do «Disponível» repõe só o campo disponível: o preço guardado entretanto não se apaga", async () => {
    const lento = pendente<ReturnType<typeof cafe>>();
    alterarFalso.mockReturnValueOnce(lento.promessa);
    await abrirEmenta();
    await tocar(interruptorDoCafe());

    alterarFalso.mockResolvedValueOnce({ ...cafe(true), preco_cent: 130 });
    await tocar(botaoDoPreco("Café", "1,20 €"));
    escreverPreco("1,3");
    await guardarPreco();
    expect(botaoDoPreco("Café", "1,30 €")).toBeInTheDocument();

    await act(async () => {
      lento.rejeitar(erroDoServidor(500));
      await Promise.resolve();
    });
    await assentar();

    expect(interruptorDoCafe()).toBeChecked();
    expect(botaoDoPreco("Café", "1,30 €")).toBeInTheDocument();
  });

  it("leitura antiga resolve depois de uma mutação confirmada: o ecrã mantém o valor confirmado", async () => {
    await abrirEmenta();
    const antiga = pendente<RespostaEmentaGestao>();
    obterFalso.mockImplementationOnce(() => antiga.promessa);
    alterarFalso.mockRejectedValueOnce(erroSemResposta());
    await tocar(interruptorDoCafe()); // sem resposta: recarrega por baixo (a leitura fica pendente)
    expect(obterFalso).toHaveBeenCalledTimes(2);

    // O servidor, daqui em diante, já tem o preço novo.
    const nova = ementaDeGestaoDeTeste();
    const produtoCafe = nova.categorias[0]?.produtos[0];
    if (produtoCafe === undefined) throw new Error("falta o Café");
    produtoCafe.preco_cent = 130;
    obterFalso.mockImplementation(() => Promise.resolve(structuredClone(nova)));

    alterarFalso.mockResolvedValueOnce({ ...cafe(true), preco_cent: 130 });
    await tocar(botaoDoPreco("Café", "1,20 €"));
    escreverPreco("1,3");
    await guardarPreco();
    expect(botaoDoPreco("Café", "1,30 €")).toBeInTheDocument();

    await act(async () => {
      antiga.resolver(ementaDeGestaoDeTeste()); // a leitura velha, com 1,20 €
      await Promise.resolve();
    });
    await assentar();

    expect(botaoDoPreco("Café", "1,30 €")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: nomeDoBotaoDoPreco("Café", "1,20 €") })).toBeNull();
  });

  it("«Desfazer» do interruptor marca a linha como pendente: um segundo toque não cruza outro PATCH", async () => {
    alterarFalso.mockResolvedValueOnce(cafe(false));
    await abrirEmenta();
    await tocar(interruptorDoCafe());

    const lento = pendente<ReturnType<typeof cafe>>();
    alterarFalso.mockReturnValueOnce(lento.promessa);
    await tocar(desfazerDoAviso() as HTMLElement);
    expect(alterarFalso).toHaveBeenCalledTimes(2);
    expect(interruptorDoCafe()).toHaveAttribute("aria-disabled", "true");

    await tocar(interruptorDoCafe());
    expect(alterarFalso, "nenhum pedido cruzado").toHaveBeenCalledTimes(2);

    await act(async () => {
      lento.resolver(cafe(true));
      await Promise.resolve();
    });
    await assentar();
    expect(interruptorDoCafe()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("«Desfazer» do preço que falha com o preço a 0: diz que continua como oferta", async () => {
    alterarFalso.mockResolvedValueOnce(vinho(0));
    await abrirEmenta(GARRAFEIRA);
    await mudarPrecoPara("0");

    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(desfazerDoAviso() as HTMLElement);
    expect(aviso()).toHaveTextContent("Não consegui desfazer. Este produto continua como oferta.");
  });

  it("401: aoPerderSessao uma vez", async () => {
    alterarFalso.mockRejectedValue(erro401());
    const sessao = await abrirEmenta();
    await tocar(interruptorDoCafe());
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it("a linha nunca tem controlos de categorias nem de eliminar", async () => {
    await abrirEmenta();
    expect(linhaDe("Café").textContent ?? "").not.toMatch(PROIBIDOS_DA_F4_02);
  });
});
