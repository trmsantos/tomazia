/**
 * F4-03, spec 8 e plano 5.6 — eliminar um evento.
 *
 * O botão «Eliminar evento» vive **só na folha de editar**; abre uma segunda folha «Tem a
 * certeza?» com o título e a data; «Cancelar», `Esc` e a cortina fecham **sem pedido** (e a folha
 * de editar mantém o que está escrito); confirmar faz um só `DELETE`, fecha as duas folhas,
 * recarrega e diz «Evento eliminado.» **sem «Desfazer»** (a spec manda confirmar em vez de
 * desfazer). Onde o plano e a spec divergem (o 404), segue-se a spec: um 404 é o resultado que o
 * dono queria, por isso diz «Evento eliminado.» (não é um erro).
 *
 * **Regra 10:** sem resposta o ecrã **não sabe**: recarrega a lista e só diz o resultado depois de
 * ver se o evento ainda está lá.
 *
 * **Deixa passar:** o foco a começar em «Cancelar» (comportamento nativo do `<dialog>`; e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  erro401,
  erro404,
  erroDoServidor,
  erroSemResposta,
  eventosDeGestaoDeTeste,
  type RespostaEventosGestao,
} from "../../../testes/gestao";
import {
  abrirEventos,
  assentar,
  aviso,
  comSinal,
  desfazerDoAviso,
  eliminarFalso,
  escrever,
  folha,
  haFolha,
  haLinhaDe,
  obterFalso,
  pendente,
  prepararApi,
  tocar,
} from "../../../testes/eventos-gestao";
import { TEXTOS } from "./textos";

vi.mock("../../../lib/api/gestao-eventos", () => ({
  obterEventosGestao: vi.fn(),
  criarEvento: vi.fn(),
  alterarEvento: vi.fn(),
  eliminarEvento: vi.fn(),
  duplicarEvento: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});

const FADO = "Fado ao vivo"; // publicado, id 11, qui 5/11 22:00

function semOEvento(id: number): RespostaEventosGestao {
  const l = eventosDeGestaoDeTeste();
  for (const parte of [l.proximos, l.rascunhos, l.arquivo]) {
    const i = parte.findIndex((e) => e.id === id);
    if (i >= 0) parte.splice(i, 1);
  }
  return l;
}

async function abrirEliminar(titulo = FADO): Promise<void> {
  await tocar(screen.getByRole("button", { name: titulo }));
  await tocar(
    within(folha(TEXTOS.tituloEditar)).getByRole("button", { name: TEXTOS.eliminarEvento }),
  );
}
function confirmar(): HTMLElement {
  return within(folha(TEXTOS.tituloEliminar)).getByRole("button", { name: TEXTOS.eliminar });
}

describe("a folha «Tem a certeza?»", () => {
  it("não há «Eliminar» na lista nem fora da folha de editar", async () => {
    await abrirEventos();
    expect(screen.queryByRole("button", { name: TEXTOS.eliminarEvento })).toBeNull();
    expect(screen.queryByRole("button", { name: TEXTOS.eliminar })).toBeNull();
  });

  it("abre por cima da de editar (que mantém o escrito) com o título e a data do evento", async () => {
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: FADO }));
    escrever(TEXTOS.etiquetaDescricao, "Texto escrito e ainda não guardado");
    await tocar(
      within(folha(TEXTOS.tituloEditar)).getByRole("button", { name: TEXTOS.eliminarEvento }),
    );

    const confirmacao = folha(TEXTOS.tituloEliminar);
    expect(confirmacao).toHaveTextContent(
      TEXTOS.vaisEliminar(FADO, `Quinta-feira, 5 de novembro, ${TEXTOS.comHora("22:00")}`),
    );
    expect(confirmacao).toHaveTextContent(TEXTOS.eliminarAviso);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
    expect(within(folha(TEXTOS.tituloEditar)).getByLabelText(TEXTOS.etiquetaDescricao)).toHaveValue(
      "Texto escrito e ainda não guardado",
    );
    expect(eliminarFalso).not.toHaveBeenCalled();
  });

  it("um evento sem data diz «que ainda não tem data»", async () => {
    await abrirEventos();
    await abrirEliminar("Rascunho importado");
    expect(folha(TEXTOS.tituloEliminar)).toHaveTextContent(
      TEXTOS.vaisEliminar("Rascunho importado", null),
    );
  });

  it("tem dois botões: «Eliminar» e «Cancelar»", async () => {
    await abrirEventos();
    await abrirEliminar();
    const f = within(folha(TEXTOS.tituloEliminar));
    expect(f.getByRole("button", { name: TEXTOS.eliminar })).toBeInTheDocument();
    expect(f.getByRole("button", { name: TEXTOS.cancelar })).toBeInTheDocument();
  });

  it("«Cancelar»: ZERO pedidos, a de confirmar fecha e a de editar fica com o que estava", async () => {
    await abrirEventos();
    await abrirEliminar();

    await tocar(
      within(folha(TEXTOS.tituloEliminar)).getByRole("button", { name: TEXTOS.cancelar }),
    );

    expect(eliminarFalso).not.toHaveBeenCalled();
    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
  });

  it("`Esc` (o evento cancel) e a cortina (o próprio <dialog>) também fecham sem pedido", async () => {
    await abrirEventos();
    await abrirEliminar();
    fireEvent(folha(TEXTOS.tituloEliminar), new Event("cancel", { cancelable: true }));
    await assentar();
    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);

    await tocar(
      within(folha(TEXTOS.tituloEditar)).getByRole("button", { name: TEXTOS.eliminarEvento }),
    );
    await tocar(folha(TEXTOS.tituloEliminar));
    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);
    expect(eliminarFalso).not.toHaveBeenCalled();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
  });
});

describe("confirmar", () => {
  it("um DELETE com o id; as duas folhas fecham; recarrega; o evento sai da lista; o foco vai a «Novo evento»", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockResolvedValueOnce(undefined);
    obterFalso.mockResolvedValueOnce(semOEvento(11));

    await tocar(confirmar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledWith(11, comSinal);
    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(haLinhaDe(FADO)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: TEXTOS.novoEvento }));
  });

  it("o aviso de um publicado diz que no site pode levar um minuto a desaparecer, e NÃO leva «Desfazer»", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockResolvedValueOnce(undefined);
    obterFalso.mockResolvedValueOnce(semOEvento(11));
    await tocar(confirmar());

    expect(aviso()).toHaveTextContent(TEXTOS.eventoEliminadoNoSite);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("um rascunho: só «Evento eliminado.»", async () => {
    await abrirEventos();
    await abrirEliminar("Rascunho com data");
    eliminarFalso.mockResolvedValueOnce(undefined);
    obterFalso.mockResolvedValueOnce(semOEvento(21));
    await tocar(confirmar());

    expect(aviso()).toHaveTextContent(TEXTOS.eventoEliminado);
    expect(aviso()?.textContent).not.toContain(TEXTOS.eventoEliminadoNoSite);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("a eliminar: «A eliminar…» (aria-busy, aria-disabled) e um segundo toque não envia outro DELETE", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockReturnValueOnce(pendente<undefined>().promessa);

    await tocar(confirmar());

    const ocupado = within(folha(TEXTOS.tituloEliminar)).getByRole("button", {
      name: TEXTOS.aEliminar,
    });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(ocupado);
    await assentar();
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("404: o resultado que o dono queria — as duas folhas fecham, recarrega e o aviso (sucesso) diz «Evento eliminado.», não um erro", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockRejectedValueOnce(erro404("evento_inexistente"));
    obterFalso.mockResolvedValueOnce(semOEvento(11));

    await tocar(confirmar());

    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(aviso()).toHaveTextContent(TEXTOS.eventoEliminado);
    expect(aviso()?.textContent).not.toContain(TEXTOS.jaNaoExiste);
  });

  it("5xx: a de confirmar fecha, a de editar MANTÉM-SE e a sua linha de estado diz a frase de eliminar do servidor; o evento fica", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockRejectedValueOnce(erroDoServidor(500));

    await tocar(confirmar());

    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
    expect(
      within(folha(TEXTOS.tituloEditar)).getByText(TEXTOS.servidorEliminar),
    ).toBeInTheDocument();
    expect(haLinhaDe(FADO)).toBe(true);
    expect(eliminarFalso).toHaveBeenCalledTimes(1);
  });

  it("401: aoPerderSessao uma vez", async () => {
    const sessao = await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockRejectedValueOnce(erro401());
    await tocar(confirmar());
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it("a gravação passou mas a recarga falhou: o aviso fica e junta «Guardei, mas não consegui atualizar a lista.» com «Atualizar»", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockResolvedValueOnce(undefined);
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(confirmar());

    expect(screen.getByText(TEXTOS.recarregarFalhou)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.atualizar })).toBeInTheDocument();
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
  });
});

describe("sem resposta ao eliminar (regra 10): o ecrã não sabe; a lista é que diz", () => {
  it("o evento já não está: «Evento eliminado.»; um só DELETE (não reenvia)", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockResolvedValueOnce(semOEvento(11));

    await tocar(confirmar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(haFolha(TEXTOS.tituloEliminar)).toBe(false);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(aviso()).toHaveTextContent(TEXTOS.eventoEliminado);
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
  });

  it("o evento continua lá: aviso de erro «Não consegui eliminar o evento. Verifica a ligação…»; nunca «eliminado»", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(confirmar());

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(aviso()?.textContent).toMatch(/^\s*Erro\./);
    expect(aviso()).toHaveTextContent(TEXTOS.eliminarContinuaLa);
    expect(aviso()?.textContent).not.toContain(TEXTOS.eventoEliminado);
    expect(haLinhaDe(FADO)).toBe(true);
  });

  it("a recarga também falha: a linha de «Guardei, mas…» e o aviso «Não sei se o evento foi eliminado…»", async () => {
    await abrirEventos();
    await abrirEliminar();
    eliminarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(confirmar());

    expect(screen.getByText(TEXTOS.recarregarFalhou)).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(TEXTOS.eliminarSemSaber);
    expect(aviso()?.textContent).not.toContain(TEXTOS.eventoEliminado);
  });
});
