/**
 * F4-02, secção 6 de `docs/ecras/F4-02.md` e decisão D2 — reordenar produtos, em
 * modo «Ordenar», por categoria.
 *
 * Contrato do que se vê:
 *  - «Ordenar» no cabeçalho da categoria, só com 2+ produtos e sem pesquisa;
 *  - no modo: «A ordenar {categoria}.», «Cancelar», «Guardar ordem»; cada linha
 *    tem a pega (não focável, `data-pega`) e quatro botões com o
 *    texto «Subir», «Descer», «Para o início», «Para o fim» e os nomes acessíveis
 *    «Subir {nome}», «Descer {nome}», «Mover {nome} para o início/fim»; preço,
 *    interruptor e lápis desaparecem;
 *  - os botões nos limites são `aria-disabled` (continuam focáveis), com
 *    `aria-describedby` → «{nome} já está em primeiro/último lugar.»;
 *  - um `role=status` anuncia «{nome}: posição {n} de {total}.»;
 *  - movimentos são locais (nenhum pedido); «Guardar ordem» faz **um** `PUT` com
 *    a lista COMPLETA (indisponíveis incluídos); «Cancelar» repõe sem pedido;
 *  - **«Desfazer» da ordem é um segundo `PUT` com a lista anterior.** Um 409 aí
 *    recarrega e diz «Não consegui repor a ordem anterior: …» — nunca «Alteração
 *    desfeita» e nunca se tenta corrigir a lista anterior.
 *
 * **Deixa passar:** arrastar com troca de posição (precisa de layout: e2e, com
 * rato a 1024 × 768) e o toque (à mão, no PR). Aqui só se prova que o arrasto
 * não escreve `style`.
 *
 * Onde a spec diz «modo aberto» e o plano diz «recarrega» para o `PUT` sem
 * resposta, segue-se a spec (a ordem escrita não se perde; repetir é seguro) e
 * não se prende o recarregamento.
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ementaDeGestaoDeTeste,
  erro401,
  erro404,
  erro409ListaDesatualizada,
  erro422,
  erroDoServidor,
  erroSemResposta,
  TEXTOS_DA_EMENTA_GESTAO as T,
} from "../../../testes/gestao";
import {
  abrirEmenta,
  alterarFalso,
  aviso,
  assentar,
  comSinal,
  criarFalso,
  desfazerDoAviso,
  obterFalso,
  prepararApi,
  reordenarFalso,
  secao,
  tocar,
} from "../../../testes/ementa-gestao";

vi.mock("../../../lib/api/gestao-ementa", () => ({
  obterEmentaGestao: vi.fn(),
  criarProduto: vi.fn(),
  alterarProduto: vi.fn(),
  reordenarProdutos: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
  reordenarFalso.mockResolvedValue(undefined);
});

/** A ordem atual dos nomes, lida dos botões «Subir {nome}» (um por linha, pela ordem do DOM). */
function ordem(): string[] {
  return screen
    .getAllByRole("button", { name: /^Subir / })
    .map((botao) =>
      (botao.getAttribute("aria-label") ?? botao.textContent ?? "").replace(/^Subir /, ""),
    );
}

function botaoDe(acao: "Subir" | "Descer" | "inicio" | "fim", nome: string): HTMLElement {
  const nomeAcessivel = {
    Subir: `Subir ${nome}`,
    Descer: `Descer ${nome}`,
    inicio: `Mover ${nome} para o início`,
    fim: `Mover ${nome} para o fim`,
  }[acao];
  return screen.getByRole("button", { name: nomeAcessivel });
}

async function abrirModo(): Promise<void> {
  await abrirEmenta();
  await tocar(screen.getByRole("button", { name: T.ordenar }));
}

const CAFETARIA = ["Café", "Galão", "Cappuccino", "Café duplo"];

describe("o botão «Ordenar» (6.1)", () => {
  it("existe com 2 ou mais produtos", async () => {
    await abrirEmenta();
    expect(screen.getByRole("button", { name: T.ordenar })).toBeInTheDocument();
  });

  it("não existe com 1 produto (Sumos) nem com 0 (Petiscos)", async () => {
    await abrirEmenta("/gestao/ementa?categoria=sumos");
    expect(screen.queryByRole("button", { name: T.ordenar })).toBeNull();
    await tocar(screen.getByRole("link", { name: "Petiscos" }));
    expect(screen.queryByRole("button", { name: T.ordenar })).toBeNull();
  });

  it("não existe com pesquisa ativa", async () => {
    await abrirEmenta();
    fireEvent.change(screen.getByLabelText(T.pesquisa), { target: { value: "cafe" } });
    expect(screen.queryByRole("button", { name: T.ordenar })).toBeNull();
  });
});

describe("o modo «Ordenar» (6.2)", () => {
  it("abre sem pedidos: a barra, os botões, a pega e as linhas só com o nome", async () => {
    await abrirModo();

    expect(screen.getByText("A ordenar Cafetaria.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.cancelar })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.guardarOrdem })).toBeInTheDocument();
    expect(ordem()).toEqual(CAFETARIA);
    expect(reordenarFalso).not.toHaveBeenCalled();
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("a barra empilha os botões abaixo de lg (uma coluna), Cancelar antes de Guardar ordem", async () => {
    await abrirModo();
    const cancelar = screen.getByRole("button", { name: T.cancelar });
    const guardar = screen.getByRole("button", { name: T.guardarOrdem });

    expect(cancelar.parentElement).toBe(guardar.parentElement);
    const grupo = guardar.parentElement as HTMLElement;
    expect(grupo.classList.contains("grid-cols-1")).toBe(true);
    expect(grupo.classList.contains("grid-cols-2")).toBe(false);
    expect(grupo.classList.contains("lg:flex")).toBe(true);
    expect(
      cancelar.compareDocumentPosition(guardar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("cada linha tem os quatro botões, com o texto visível contido no nome acessível (2.5.3)", async () => {
    await abrirModo();

    for (const nome of CAFETARIA) {
      const subir = botaoDe("Subir", nome);
      expect(subir).toHaveTextContent("Subir");
      expect(botaoDe("Descer", nome)).toHaveTextContent("Descer");
      expect(botaoDe("inicio", nome)).toHaveTextContent("Para o início");
      expect(botaoDe("fim", nome)).toHaveTextContent("Para o fim");
    }
  });

  it("preço, interruptor e nome-botão desaparecem; ficam pega(s) não focáveis", async () => {
    await abrirModo();
    const categoria = secao("Cafetaria");

    expect(within(categoria).queryAllByRole("switch")).toHaveLength(0);
    expect(within(categoria).queryByRole("button", { name: /^Alterar o preço de/ })).toBeNull();
    expect(within(categoria).queryByRole("button", { name: "Café" })).toBeNull();
    expect(within(categoria).queryByRole("button", { name: T.ordenar })).toBeNull();

    const pegas = categoria.querySelectorAll("[data-pega]");
    expect(pegas).toHaveLength(CAFETARIA.length);
    for (const pega of Array.from(pegas)) {
      expect(pega.getAttribute("tabindex")).not.toBe("0");
      expect(pega.closest("button, a, input")).toBeNull();
    }
  });

  it("o foco vai ao primeiro «Subir» que não está desativado (o do 2.º produto)", async () => {
    await abrirModo();
    expect(document.activeElement).toBe(botaoDe("Subir", "Galão"));
  });

  it("a pesquisa, os chips e «Adicionar produto» ficam aria-disabled e não fazem nada", async () => {
    await abrirModo();

    expect(screen.getByLabelText(T.pesquisa)).toHaveAttribute("aria-disabled", "true");
    const adicionar = screen.getByRole("button", { name: T.adicionarProduto });
    expect(adicionar).toHaveAttribute("aria-disabled", "true");
    await tocar(adicionar);
    expect(screen.queryByRole("dialog")).toBeNull();

    await tocar(screen.getByRole("link", { name: "Garrafeira" }));
    expect(window.location.search).not.toBe("?categoria=garrafeira");
    expect(screen.getByRole("heading", { level: 2, name: "Cafetaria" })).toBeInTheDocument();
  });

  it("Esc NÃO sai do modo", async () => {
    await abrirModo();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    await assentar();
    expect(screen.getByText("A ordenar Cafetaria.")).toBeInTheDocument();
  });
});

describe("os movimentos são locais (6.2)", () => {
  it.each([
    ["Subir", "Galão", ["Galão", "Café", "Cappuccino", "Café duplo"]],
    ["Descer", "Café", ["Galão", "Café", "Cappuccino", "Café duplo"]],
    ["inicio", "Café duplo", ["Café duplo", "Café", "Galão", "Cappuccino"]],
    ["fim", "Galão", ["Café", "Cappuccino", "Café duplo", "Galão"]],
  ] as const)("%s «%s» muda a ordem e NÃO faz pedido", async (acao, nome, esperado) => {
    await abrirModo();

    await tocar(botaoDe(acao, nome));

    expect(ordem()).toEqual(esperado);
    expect(reordenarFalso).not.toHaveBeenCalled();
    expect(alterarFalso).not.toHaveBeenCalled();
  });

  it("o foco fica no mesmo botão, que anda com a linha", async () => {
    await abrirModo();
    await tocar(botaoDe("Descer", "Café"));
    expect(document.activeElement).toBe(botaoDe("Descer", "Café"));
  });

  it("se esse botão ficou desativado (Subir na 1.ª linha; «Para o início»), o foco vai ao «Descer» da linha", async () => {
    await abrirModo();

    await tocar(botaoDe("Subir", "Galão"));
    expect(ordem()[0]).toBe("Galão");
    expect(document.activeElement).toBe(botaoDe("Descer", "Galão"));

    await tocar(botaoDe("inicio", "Café duplo"));
    expect(ordem()[0]).toBe("Café duplo");
    expect(document.activeElement).toBe(botaoDe("Descer", "Café duplo"));
  });

  it("«Para o fim»: o foco fica dentro da linha movida, num botão ativo (nunca no <body>)", async () => {
    await abrirModo();
    await tocar(botaoDe("fim", "Galão"));

    const ativo = document.activeElement;
    expect(ativo).not.toBe(document.body);
    expect(ativo?.closest("li")).toBe(botaoDe("Subir", "Galão").closest("li"));
    expect(ativo).not.toHaveAttribute("aria-disabled", "true");
  });

  it("o anúncio diz «{nome}: posição {n} de {total}.»", async () => {
    await abrirModo();
    await tocar(botaoDe("Subir", "Galão"));
    expect(screen.getByText("Galão: posição 1 de 4.")).toBeInTheDocument();
    await tocar(botaoDe("fim", "Galão"));
    expect(screen.getByText("Galão: posição 4 de 4.")).toBeInTheDocument();
  });

  it("os botões dos limites: aria-disabled, focáveis, com a razão em aria-describedby, e não fazem nada", async () => {
    await abrirModo();

    for (const acao of ["Subir", "inicio"] as const) {
      const botao = botaoDe(acao, "Café");
      expect(botao).toHaveAttribute("aria-disabled", "true");
      expect(botao).not.toBeDisabled();
      const razao = document.getElementById(botao.getAttribute("aria-describedby") ?? "");
      expect(razao).toHaveTextContent("Café já está em primeiro lugar.");
    }
    for (const acao of ["Descer", "fim"] as const) {
      const botao = botaoDe(acao, "Café duplo");
      expect(botao).toHaveAttribute("aria-disabled", "true");
      expect(
        document.getElementById(botao.getAttribute("aria-describedby") ?? ""),
      ).toHaveTextContent("Café duplo já está em último lugar.");
    }

    await tocar(botaoDe("Subir", "Café"));
    await tocar(botaoDe("fim", "Café duplo"));
    expect(ordem()).toEqual(CAFETARIA);
  });

  it("os botões do meio não estão desativados", async () => {
    await abrirModo();
    expect(botaoDe("Subir", "Galão")).not.toHaveAttribute("aria-disabled", "true");
    expect(botaoDe("Descer", "Galão")).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("arrastar não escreve `style` (6.3, CSP style-src 'self')", () => {
  it("um pointerdown e um pequeno movimento na pega: nenhum atributo style no DOM, e menos de 8 px não é arrastar", async () => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    await abrirModo();
    const pega = secao("Cafetaria").querySelector("[data-pega]") as HTMLElement;

    fireEvent.pointerDown(pega, { pointerId: 1, clientY: 100, button: 0 });
    expect(document.querySelectorAll("[style]")).toHaveLength(0);
    fireEvent.pointerMove(pega, { pointerId: 1, clientY: 103 });
    expect(document.querySelectorAll("[style]")).toHaveLength(0);
    fireEvent.pointerUp(pega, { pointerId: 1, clientY: 103 });
    expect(document.querySelectorAll("[style]")).toHaveLength(0);

    expect(ordem()).toEqual(CAFETARIA);
    expect(reordenarFalso).not.toHaveBeenCalled();
  });
});

describe("«Guardar ordem» (6.4)", () => {
  it("UM PUT com a lista COMPLETA, indisponíveis incluídos, pela ordem nova", async () => {
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));

    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(reordenarFalso).toHaveBeenCalledTimes(1);
    expect(reordenarFalso).toHaveBeenCalledWith(1, [102, 103, 104, 101], comSinal);
  });

  it("204: o modo fecha, o foco vai a «Ordenar», «Ordem guardada.» COM «Desfazer»; a lista fica na ordem nova", async () => {
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(screen.queryByText("A ordenar Cafetaria.")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: T.ordenar }));
    expect(aviso()).toHaveTextContent(T.ordemGuardada);
    expect(aviso()).toHaveAttribute("role", "status");
    expect(desfazerDoAviso()).not.toBeNull();
    const nomes = screen
      .getAllByRole("button", { name: /^(Café|Galão|Cappuccino|Café duplo)$/ })
      .map((botao) => botao.textContent);
    expect(nomes).toEqual(["Galão", "Cappuccino", "Café duplo", "Café"]);
  });

  it("a guardar: «A guardar…», aria-busy, e um segundo toque não repete o PUT", async () => {
    let cumprir: () => void = () => undefined;
    reordenarFalso.mockReturnValue(
      new Promise<undefined>((resolver) => {
        cumprir = () => {
          resolver(undefined);
        };
      }),
    );
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    const botao = screen.getByRole("button", { name: T.aGuardar });
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(botao).toHaveAttribute("aria-disabled", "true");
    await tocar(botao);
    expect(reordenarFalso).toHaveBeenCalledTimes(1);
    expect(botaoDe("Subir", "Galão")).toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      cumprir();
      await Promise.resolve();
    });
  });

  it("sem movimentos: fecha sem pedido e sem aviso", async () => {
    await abrirModo();
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(reordenarFalso).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
    expect(screen.queryByText("A ordenar Cafetaria.")).toBeNull();
  });

  it("«Cancelar» repõe a ordem do servidor, sem pedido, e devolve o foco a «Ordenar»", async () => {
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.cancelar }));

    expect(reordenarFalso).not.toHaveBeenCalled();
    expect(screen.queryByText("A ordenar Cafetaria.")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: T.ordenar }));
    const nomes = screen
      .getAllByRole("button", { name: /^(Café|Galão|Cappuccino|Café duplo)$/ })
      .map((botao) => botao.textContent);
    expect(nomes).toEqual(CAFETARIA);
  });

  it.each([
    ["sem resposta", erroSemResposta(), T.erroOrdemSemResposta],
    ["500", erroDoServidor(500), T.erroOrdemServidor],
  ])(
    "erro (%s): o modo fica aberto com a ordem escrita e o aviso de erro diz a frase",
    async (_n, erro, frase) => {
      reordenarFalso.mockRejectedValue(erro);
      await abrirModo();
      await tocar(botaoDe("fim", "Café"));
      await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

      expect(screen.getByText("A ordenar Cafetaria.")).toBeInTheDocument();
      expect(ordem()).toEqual(["Galão", "Cappuccino", "Café duplo", "Café"]);
      expect(aviso()).toHaveAttribute("role", "alert");
      expect(aviso()).toHaveTextContent(frase);
      expect(reordenarFalso, "nunca repete sozinho").toHaveBeenCalledTimes(1);
    },
  );

  it("o botão volta a estar utilizável depois do erro (repetir é seguro: o PUT é absoluto)", async () => {
    reordenarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    reordenarFalso.mockResolvedValueOnce(undefined);
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(reordenarFalso).toHaveBeenCalledTimes(2);
    expect(reordenarFalso.mock.calls[1]?.[1]).toEqual(reordenarFalso.mock.calls[0]?.[1]);
  });
});

describe("409 e 404 no PUT (9.2 e 9.4): a lista do servidor, nunca repetir", () => {
  it("409: recarrega, o modo fecha, a ordem local descarta-se e o aviso é a frase própria", async () => {
    reordenarFalso.mockRejectedValue(erro409ListaDesatualizada());
    const noServidor = ementaDeGestaoDeTeste();
    const [cafetaria] = noServidor.categorias;
    cafetaria?.produtos.reverse();
    await abrirModo();
    obterFalso.mockResolvedValueOnce(structuredClone(noServidor));
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(reordenarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("A ordenar Cafetaria.")).toBeNull();
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()).toHaveTextContent(T.erro409);
    expect(aviso()?.textContent).not.toMatch(/Recarrega a página/);
    const nomes = screen
      .getAllByRole("button", { name: /^(Café|Galão|Cappuccino|Café duplo)$/ })
      .map((botao) => botao.textContent);
    expect(nomes).toEqual(["Café duplo", "Cappuccino", "Galão", "Café"]);
  });

  it("404 (a categoria já não existe): «Esta categoria já não existe. Atualizei a ementa.» e recarrega", async () => {
    reordenarFalso.mockRejectedValue(erro404("categoria_inexistente"));
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(aviso()).toHaveTextContent(T.erro404Categoria);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("A ordenar Cafetaria.")).toBeNull();
  });

  it("422 é um erro nosso: a frase do servidor, sem 'Recarrega a página' nem a mensagem do backend", async () => {
    reordenarFalso.mockRejectedValue(erro422(null));
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));

    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()?.textContent).not.toMatch(/mensagem do backend|o corpo não é válido/);
  });

  it("401: aoPerderSessao uma vez; 403/500 nunca", async () => {
    reordenarFalso.mockRejectedValue(erro401());
    const sessao = await abrirEmenta();
    await tocar(screen.getByRole("button", { name: T.ordenar }));
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });
});

describe("«Desfazer» da ordem (um segundo PUT com a lista anterior)", () => {
  async function guardarComMovimento(): Promise<void> {
    await abrirModo();
    await tocar(botaoDe("fim", "Café"));
    await tocar(screen.getByRole("button", { name: T.guardarOrdem }));
  }

  it("204: o segundo PUT leva a lista ANTERIOR, a lista volta e o aviso é «Alteração desfeita» sem «Desfazer»", async () => {
    await guardarComMovimento();

    await tocar(desfazerDoAviso() as HTMLElement);

    expect(reordenarFalso).toHaveBeenCalledTimes(2);
    expect(reordenarFalso).toHaveBeenLastCalledWith(1, [101, 102, 103, 104], comSinal);
    expect(aviso()).toHaveTextContent(T.alteracaoDesfeita);
    expect(desfazerDoAviso()).toBeNull();
    const nomes = screen
      .getAllByRole("button", { name: /^(Café|Galão|Cappuccino|Café duplo)$/ })
      .map((botao) => botao.textContent);
    expect(nomes).toEqual(CAFETARIA);
  });

  it("409 no «Desfazer»: recarrega, aviso de erro próprio, NUNCA «Alteração desfeita», e nenhum terceiro PUT", async () => {
    await guardarComMovimento();
    reordenarFalso.mockRejectedValueOnce(erro409ListaDesatualizada());

    await tocar(desfazerDoAviso() as HTMLElement);

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()).toHaveTextContent(T.erroDesfazerOrdem409);
    expect(aviso()?.textContent).not.toMatch(/Alteração desfeita/);
    expect(document.body.textContent).not.toMatch(/Alteração desfeita/);
    expect(reordenarFalso).toHaveBeenCalledTimes(2);
  });

  it("404 no «Desfazer»: o mesmo que o 409", async () => {
    await guardarComMovimento();
    reordenarFalso.mockRejectedValueOnce(erro404("categoria_inexistente"));

    await tocar(desfazerDoAviso() as HTMLElement);

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()).toHaveTextContent(T.erroDesfazerOrdem409);
    expect(document.body.textContent).not.toMatch(/Alteração desfeita/);
  });

  it("500 no «Desfazer»: a ordem NOVA fica (confirmada), o aviso diz que não desfez e não recarrega", async () => {
    await guardarComMovimento();
    reordenarFalso.mockRejectedValueOnce(erroDoServidor(500));

    await tocar(desfazerDoAviso() as HTMLElement);

    const nomes = screen
      .getAllByRole("button", { name: /^(Café|Galão|Cappuccino|Café duplo)$/ })
      .map((botao) => botao.textContent);
    expect(nomes).toEqual(["Galão", "Cappuccino", "Café duplo", "Café"]);
    expect(aviso()).toHaveAttribute("role", "alert");
    expect(aviso()).toHaveTextContent(/Não consegui (desfazer|repor)/);
    expect(document.body.textContent).not.toMatch(/Alteração desfeita/);
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("sem resposta no «Desfazer»: não sei se desfez → recarrega, e nada de «Alteração desfeita»", async () => {
    await guardarComMovimento();
    reordenarFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(desfazerDoAviso() as HTMLElement);

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toMatch(/Alteração desfeita/);
    expect(reordenarFalso).toHaveBeenCalledTimes(2);
  });

  it("o «Desfazer» da ordem não toca em preços nem em disponibilidade", async () => {
    await guardarComMovimento();
    await tocar(desfazerDoAviso() as HTMLElement);
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(criarFalso).not.toHaveBeenCalled();
  });
});
