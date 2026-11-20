/**
 * F4-03, spec 5 e 6, plano 5.3, 5.4 e 11 — as ações da linha: o interruptor «Publicado, {título}»
 * (publicar e despublicar num toque) e «Duplicar {título}» (a folha com as três datas, um toque
 * cria), com «Desfazer».
 *
 *  - O interruptor é **otimista** e manda **só** `{ publicado: <valor absoluto> }`; a linha só
 *    muda de parte depois da resposta **e** do recarregamento; «Desfazer» é uma compensação
 *    (valor anterior) e **não** mostra outro aviso (spec 5: o interruptor a voltar é a
 *    confirmação).
 *  - O aviso depende da parte onde a lista **recarregada** põe o evento (as quatro frases).
 *  - «Duplicar» abre uma folha com **três botões** («Daqui a 1/2/3 semanas», cada um com a data
 *    real); um toque cria (um só `POST` com `{semanas}`), a data do aviso é **a da resposta**, e
 *    «Desfazer» apaga a cópia (`DELETE`). Só o original **sem data** duplica com um toque, sem
 *    folha e sem corpo (`semanas = null`).
 *  - Sem resposta nunca se reenvia (um `POST` repetido criava duas cópias); o ecrã recarrega.
 *
 * **Deixa passar:** o foco devolvido pelo `<dialog>` e a cor da opção principal (e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  erro401,
  erro404,
  erro422,
  erro422EventoSemData,
  erroDoServidor,
  erroSemResposta,
  eventoDeTeste,
  eventosDeGestaoDeTeste,
  type EventoGestao,
  type RespostaEventosGestao,
} from "../../../testes/gestao";
import {
  abrirEventos,
  alterarFalso,
  aviso,
  assentar,
  botao,
  botaoDuplicar,
  comSinal,
  contem,
  desfazerDoAviso,
  duplicarFalso,
  eliminarFalso,
  haFolha,
  interruptorDe,
  obterFalso,
  opcaoDeSemanas,
  pendente,
  prepararApi,
  scrollFalso,
  secao,
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

/** A lista depois de um evento mudar de parte, como o servidor a daria. */
function lista(
  mexer: (l: RespostaEventosGestao) => void,
  base: RespostaEventosGestao = eventosDeGestaoDeTeste(),
): RespostaEventosGestao {
  mexer(base);
  return base;
}

function tirar(l: RespostaEventosGestao, id: number): EventoGestao {
  for (const parte of [l.proximos, l.rascunhos, l.arquivo]) {
    const i = parte.findIndex((e) => e.id === id);
    if (i >= 0) return parte.splice(i, 1)[0] as EventoGestao;
  }
  throw new Error(`evento ${String(id)} não está em nenhuma lista`);
}

const RASCUNHO = "Rascunho com data"; // id 21, 20/11 22:00
const FADO = "Fado ao vivo"; // id 11, publicado, 1.º dos próximos

describe("publicar com o interruptor", () => {
  it("toca: o interruptor liga de imediato; PATCH com SÓ {publicado: true}; a linha ainda está nos Rascunhos", async () => {
    await abrirEventos();
    const resposta = pendente<EventoGestao>();
    alterarFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(interruptorDe(RASCUNHO));

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).toHaveBeenCalledWith(21, { publicado: true }, comSinal);
    expect(interruptorDe(RASCUNHO)).toBeChecked();
    expect(interruptorDe(RASCUNHO)).toHaveAttribute("aria-disabled", "true");
    expect(
      within(secao(TEXTOS.rascunhos)).getByRole("button", { name: RASCUNHO }),
    ).toBeInTheDocument();
    expect(aviso()).toBeNull();
  });

  it("enquanto o pedido corre, outro toque no mesmo interruptor não faz segundo pedido", async () => {
    await abrirEventos();
    alterarFalso.mockReturnValueOnce(pendente<EventoGestao>().promessa);

    await tocar(interruptorDe(RASCUNHO));
    await tocar(interruptorDe(RASCUNHO));

    expect(alterarFalso).toHaveBeenCalledTimes(1);
  });

  it("a linha só muda de parte depois da resposta e do recarregamento; o aviso diz «no site» entre os três primeiros", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(
      eventoDeTeste({ id: 21, titulo: RASCUNHO, inicio: "2026-11-04T22:00:00Z" }),
    );
    const recarga = pendente<RespostaEventosGestao>();
    obterFalso.mockReturnValueOnce(recarga.promessa);

    await tocar(interruptorDe(RASCUNHO));
    expect(
      within(secao(TEXTOS.rascunhos)).queryByRole("button", { name: RASCUNHO }),
      "a lista antiga fica à vista até o GET chegar",
    ).not.toBeNull();

    recarga.resolver(
      lista((l) => {
        const e = tirar(l, 21);
        l.proximos.unshift({ ...e, publicado: true, inicio: "2026-11-04T22:00:00Z" });
      }),
    );
    await assentar();

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(
      within(secao(TEXTOS.proximos)).getByRole("button", { name: RASCUNHO }),
    ).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(TEXTOS.publicadoNoSite(RASCUNHO));
    expect(desfazerDoAviso()).not.toBeNull();
  });

  it("depois dos três primeiros: o aviso diz que o site só mostra os três", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, titulo: RASCUNHO }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => {
        const e = tirar(l, 21);
        l.proximos.push({ ...e, publicado: true }); // 20/11: depois do 4.º
      }),
    );

    await tocar(interruptorDe(RASCUNHO));

    expect(aviso()).toHaveTextContent(TEXTOS.publicadoSoTres(RASCUNHO));
    expect(aviso()?.textContent).not.toContain(TEXTOS.publicadoNoSite(RASCUNHO));
    expect(desfazerDoAviso()).not.toBeNull();
  });

  it("a data já passou: o evento cai no arquivo e o aviso diz que o site não o mostra", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, titulo: RASCUNHO }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => {
        const e = tirar(l, 21);
        l.arquivo.unshift({ ...e, publicado: true, inicio: "2026-10-30T22:00:00Z" });
      }),
    );

    await tocar(interruptorDe(RASCUNHO));

    expect(aviso()).toHaveTextContent(TEXTOS.publicadoNoArquivo(RASCUNHO));
    expect(desfazerDoAviso()).not.toBeNull();
  });

  it("«Desfazer» manda o valor ABSOLUTO anterior ({publicado: false}), fecha o aviso e não mostra outro", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, titulo: RASCUNHO }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => {
        const e = tirar(l, 21);
        l.proximos.push({ ...e, publicado: true });
      }),
    );
    await tocar(interruptorDe(RASCUNHO));

    alterarFalso.mockResolvedValueOnce(
      eventoDeTeste({ id: 21, titulo: RASCUNHO, publicado: false }),
    );
    obterFalso.mockResolvedValueOnce(eventosDeGestaoDeTeste());
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(alterarFalso).toHaveBeenCalledTimes(2);
    expect(alterarFalso).toHaveBeenLastCalledWith(21, { publicado: false }, comSinal);
    expect(aviso()).toBeNull();
    expect(
      within(secao(TEXTOS.rascunhos)).getByRole("button", { name: RASCUNHO }),
    ).toBeInTheDocument();
    expect(interruptorDe(RASCUNHO)).not.toBeChecked();
  });

  it("5xx: o interruptor volta ao valor que tinha e o aviso (erro) diz a frase do servidor", async () => {
    await abrirEventos();
    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));

    await tocar(interruptorDe(RASCUNHO));

    expect(interruptorDe(RASCUNHO)).not.toBeChecked();
    expect(interruptorDe(RASCUNHO)).not.toHaveAttribute("aria-disabled", "true");
    expect(aviso()).toHaveTextContent(TEXTOS.servidorGuardar);
    expect(aviso()?.textContent).not.toContain(TEXTOS.semRespostaInterruptor);
    expect(desfazerDoAviso()).toBeNull();
  });

  it("sem resposta: o interruptor volta e o aviso diz «não sei se ficou guardado» — nunca «guardado» nem «não guardei»", async () => {
    await abrirEventos();
    alterarFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(interruptorDe(RASCUNHO));

    expect(interruptorDe(RASCUNHO)).not.toBeChecked();
    expect(aviso()).toHaveTextContent(TEXTOS.semRespostaInterruptor);
    expect(aviso()?.textContent).not.toContain(TEXTOS.servidorGuardar);
    expect(
      alterarFalso,
      "um PATCH absoluto até seria seguro, mas quem repete é o dono",
    ).toHaveBeenCalledTimes(1);
  });

  it("404: o ecrã recarrega e diz que o evento já não existe", async () => {
    await abrirEventos();
    alterarFalso.mockRejectedValueOnce(erro404("evento_inexistente"));
    obterFalso.mockResolvedValueOnce(lista((l) => void tirar(l, 21)));

    await tocar(interruptorDe(RASCUNHO));

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()).toHaveTextContent(TEXTOS.jaNaoExiste);
    expect(screen.queryByRole("button", { name: RASCUNHO })).toBeNull();
  });

  it("422 evento_sem_data (outro telemóvel limpou a data): o aviso diz para abrir o evento e escolher; nunca a mensagem do backend", async () => {
    await abrirEventos();
    alterarFalso.mockRejectedValueOnce(erro422EventoSemData());

    await tocar(interruptorDe(RASCUNHO));

    expect(interruptorDe(RASCUNHO)).not.toBeChecked();
    expect(aviso()).toHaveTextContent(TEXTOS.semDataCorrida);
    expect(document.body.textContent).not.toContain("mensagem do backend");
  });

  it("401: aoPerderSessao uma vez", async () => {
    const sessao = await abrirEventos();
    alterarFalso.mockRejectedValueOnce(erro401());
    await tocar(interruptorDe(RASCUNHO));
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it("a gravação passou mas o recarregamento falhou: a lista de antes fica, o aviso de sucesso fica e junta «Guardei, mas…» com «Atualizar»", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, titulo: RASCUNHO }));
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(interruptorDe(RASCUNHO));

    expect(screen.getByText(TEXTOS.recarregarFalhou)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.recarregarSemResposta)).toBeInTheDocument();
    expect(
      screen.queryByText(TEXTOS.carregarTitulo),
      "nunca o ecrã de erro: há uma lista que se pode usar",
    ).toBeNull();
    expect(screen.getByRole("button", { name: RASCUNHO })).toBeInTheDocument();
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);

    // «Atualizar» faz o mesmo GET.
    obterFalso.mockResolvedValueOnce(
      lista((l) => {
        const e = tirar(l, 21);
        l.proximos.push({ ...e, publicado: true });
      }),
    );
    await tocar(botao(TEXTOS.atualizar));
    expect(screen.queryByText(TEXTOS.recarregarFalhou)).toBeNull();
    expect(
      within(secao(TEXTOS.proximos)).getByRole("button", { name: RASCUNHO }),
    ).toBeInTheDocument();
  });

  it("o recarregamento falha com 5xx: a frase de servidor, não a de ligação", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, titulo: RASCUNHO }));
    obterFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(interruptorDe(RASCUNHO));
    expect(screen.getByText(TEXTOS.recarregarServidor)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.recarregarSemResposta)).toBeNull();
  });

  it("uma ação nova substitui o aviso, e o «Desfazer» do primeiro já não existe", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, titulo: RASCUNHO }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => l.proximos.push({ ...tirar(l, 21), publicado: true })),
    );
    await tocar(interruptorDe(RASCUNHO));
    expect(screen.getAllByRole("button", { name: TEXTOS.desfazer })).toHaveLength(1);

    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO, publicado: false }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => {
        l.proximos.push({ ...tirar(l, 21), publicado: true });
        l.rascunhos.push({ ...tirar(l, 11), publicado: false });
      }),
    );
    await tocar(interruptorDe(FADO));

    expect(aviso()).toHaveTextContent(TEXTOS.despublicadoDoSite(FADO));
    expect(screen.getAllByRole("button", { name: TEXTOS.desfazer })).toHaveLength(1);
  });
});

describe("despublicar com o interruptor", () => {
  it("PATCH com SÓ {publicado: false}; o aviso diz «deixou de estar publicado» e leva «Desfazer»", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO, publicado: false }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => l.rascunhos.unshift({ ...tirar(l, 11), publicado: false })),
    );

    await tocar(interruptorDe(FADO));

    expect(alterarFalso).toHaveBeenCalledWith(11, { publicado: false }, comSinal);
    expect(within(secao(TEXTOS.rascunhos)).getByRole("button", { name: FADO })).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(TEXTOS.despublicadoDoSite(FADO));
    expect(desfazerDoAviso()).not.toBeNull();
  });

  it("«Desfazer» manda {publicado: true}", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO, publicado: false }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => l.rascunhos.unshift({ ...tirar(l, 11), publicado: false })),
    );
    await tocar(interruptorDe(FADO));

    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO }));
    obterFalso.mockResolvedValueOnce(eventosDeGestaoDeTeste());
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(alterarFalso).toHaveBeenLastCalledWith(11, { publicado: true }, comSinal);
  });

  it("«Desfazer» que falha com 5xx: o interruptor fica como o servidor o tem e o aviso diz «Não consegui desfazer…» (frase do servidor)", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO, publicado: false }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => l.rascunhos.unshift({ ...tirar(l, 11), publicado: false })),
    );
    await tocar(interruptorDe(FADO));

    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(interruptorDe(FADO)).not.toBeChecked();
    expect(aviso()).toHaveTextContent(TEXTOS.desfazerServidor);
    expect(aviso()?.textContent).not.toContain(TEXTOS.desfazerSemResposta);
  });

  it("«Desfazer» sem resposta: a frase de ligação; recarrega para ver o que ficou; nunca diz «desfeito»", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO, publicado: false }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => l.rascunhos.unshift({ ...tirar(l, 11), publicado: false })),
    );
    await tocar(interruptorDe(FADO));
    const antes = obterFalso.mock.calls.length;

    alterarFalso.mockRejectedValueOnce(erroSemResposta());
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(aviso()).toHaveTextContent(TEXTOS.desfazerSemResposta);
    expect(obterFalso.mock.calls.length).toBeGreaterThan(antes);
  });

  it("«Desfazer» com 404: recarrega e diz que já não existe", async () => {
    await abrirEventos();
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: FADO, publicado: false }));
    obterFalso.mockResolvedValueOnce(
      lista((l) => l.rascunhos.unshift({ ...tirar(l, 11), publicado: false })),
    );
    await tocar(interruptorDe(FADO));

    alterarFalso.mockRejectedValueOnce(erro404("evento_inexistente"));
    obterFalso.mockResolvedValueOnce(lista((l) => void tirar(l, 11)));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(aviso()).toHaveTextContent(TEXTOS.jaNaoExiste);
    expect(screen.queryByRole("button", { name: FADO })).toBeNull();
  });
});

describe("duplicar: a folha com as três datas", () => {
  /** A cópia que o servidor devolveria: rascunho, no `inicio` dado. */
  function copia(inicio: string | null, id = 40, titulo = FADO): EventoGestao {
    return eventoDeTeste({ id, titulo, inicio, publicado: false });
  }
  function listaComCopia(c: EventoGestao): RespostaEventosGestao {
    return lista((l) => l.rascunhos.unshift(c));
  }

  it("tocar em «Duplicar» não faz pedido: abre a folha com três opções e as datas reais (+1, +2 e +3 semanas), sem uma quarta", async () => {
    await abrirEventos();

    await tocar(botaoDuplicar(FADO));

    expect(duplicarFalso).not.toHaveBeenCalled();
    expect(haFolha(TEXTOS.tituloDuplicar)).toBe(true);
    expect(opcaoDeSemanas(1)).toHaveTextContent(/12 de novembro/i);
    expect(opcaoDeSemanas(2)).toHaveTextContent(/19 de novembro/i);
    expect(opcaoDeSemanas(3)).toHaveTextContent(/26 de novembro/i);
    for (const n of [1, 2, 3]) {
      expect(opcaoDeSemanas(n)).toHaveTextContent(TEXTOS.comHora("22:00"));
    }
    expect(screen.queryByRole("button", { name: contem(TEXTOS.daquiASemanas(4)) })).toBeNull();
    expect(screen.queryByRole("button", { name: contem(TEXTOS.daquiASemanas(0)) })).toBeNull();
  });

  it("um toque na opção cria: um só POST com o `semanas` dessa opção", async () => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia("2026-11-19T22:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-11-19T22:00:00Z")));

    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(2));

    expect(duplicarFalso).toHaveBeenCalledTimes(1);
    expect(duplicarFalso).toHaveBeenCalledWith(11, 2, comSinal);
    expect(haFolha(TEXTOS.tituloDuplicar)).toBe(false);
  });

  it.each([1, 3])("a opção %i manda `semanas: %i`", async (n) => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia("2026-11-12T22:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-11-12T22:00:00Z")));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(n));
    expect(duplicarFalso).toHaveBeenCalledWith(11, n, comSinal);
  });

  it("a cópia aparece nos Rascunhos depois da recarga; a linha entra à vista e o foco vai ao botão do título dela; o aviso diz a data", async () => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia("2026-11-19T22:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-11-19T22:00:00Z")));

    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(2));

    expect(obterFalso).toHaveBeenCalledTimes(2);
    const titulo = within(secao(TEXTOS.rascunhos)).getByRole("button", { name: FADO });
    expect(titulo).toBeInTheDocument();
    expect(document.activeElement).toBe(titulo);
    expect(scrollFalso).toHaveBeenCalled();
    expect(aviso()).toHaveTextContent(
      TEXTOS.rascunhoCriadoPara(`quinta-feira, 19 de novembro, ${TEXTOS.comHora("22:00")}`),
    );
    expect(desfazerDoAviso()).not.toBeNull();
  });

  it("a data do aviso é a da RESPOSTA, nunca a da pré-visualização (relógio do telemóvel errado)", async () => {
    await abrirEventos();
    // A opção 2 mostrava 19/11; o servidor deu 26/11.
    duplicarFalso.mockResolvedValueOnce(copia("2026-11-26T22:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-11-26T22:00:00Z")));

    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(2));

    expect(aviso()).toHaveTextContent(
      TEXTOS.rascunhoCriadoPara(`quinta-feira, 26 de novembro, ${TEXTOS.comHora("22:00")}`),
    );
    expect(aviso()?.textContent).not.toMatch(/19 de novembro/);
  });

  it("hora de verão: 21:00Z lê-se 22:00 de Lisboa no aviso, nunca 21:00", async () => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia("2026-07-02T21:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-07-02T21:00:00Z")));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(1));
    expect(aviso()).toHaveTextContent(TEXTOS.comHora("22:00"));
    expect(aviso()?.textContent).not.toContain("21:00");
  });

  it("um original do arquivo (29/10) oferece 5/11, 12/11 e 19/11", async () => {
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: TEXTOS.verOArquivo(2) }));

    await tocar(botaoDuplicar("Noite de samba"));

    expect(opcaoDeSemanas(1)).toHaveTextContent(/5 de novembro/i);
    expect(opcaoDeSemanas(2)).toHaveTextContent(/12 de novembro/i);
    expect(opcaoDeSemanas(3)).toHaveTextContent(/19 de novembro/i);
  });

  it("o arquivo de 15/10 (hora de verão): as três opções são distintas e às 22:00 de Lisboa", async () => {
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: TEXTOS.verOArquivo(2) }));
    await tocar(botaoDuplicar("Fado de outubro"));

    const textos = [1, 2, 3].map((n) => opcaoDeSemanas(n).textContent ?? "");
    expect(new Set(textos).size).toBe(3);
    expect(textos[0]).toMatch(/5 de novembro/i);
    for (const t of textos) expect(t).toContain(TEXTOS.comHora("22:00"));
  });

  it("também há folha para um rascunho com data", async () => {
    await abrirEventos();
    await tocar(botaoDuplicar(RASCUNHO));
    expect(haFolha(TEXTOS.tituloDuplicar)).toBe(true);
    expect(opcaoDeSemanas(1)).toHaveTextContent(/27 de novembro/i);
  });

  it("original SEM data: nenhuma folha, o pedido sai logo, sem corpo (semanas null); o aviso diz «sem data»", async () => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia(null, 41, "Rascunho importado"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia(null, 41, "Rascunho importado")));

    await tocar(botaoDuplicar("Rascunho importado"));

    expect(haFolha(TEXTOS.tituloDuplicar)).toBe(false);
    expect(duplicarFalso).toHaveBeenCalledTimes(1);
    expect(duplicarFalso).toHaveBeenCalledWith(22, null, comSinal);
    expect(aviso()).toHaveTextContent(TEXTOS.rascunhoCriadoSemData);
  });

  it("«Desfazer» elimina a cópia (DELETE do id que veio no 201), fecha o aviso e recarrega, sem outro aviso", async () => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia("2026-11-19T22:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-11-19T22:00:00Z")));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(2));

    eliminarFalso.mockResolvedValueOnce(undefined);
    obterFalso.mockResolvedValueOnce(eventosDeGestaoDeTeste());
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(eliminarFalso).toHaveBeenCalledTimes(1);
    expect(eliminarFalso).toHaveBeenCalledWith(40, comSinal);
    expect(aviso()).toBeNull();
    expect(obterFalso).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole("button", { name: FADO })).toHaveLength(1);
  });

  it("«Desfazer» que falha: o aviso diz que o rascunho ficou na lista", async () => {
    await abrirEventos();
    duplicarFalso.mockResolvedValueOnce(copia("2026-11-19T22:00:00Z"));
    obterFalso.mockResolvedValueOnce(listaComCopia(copia("2026-11-19T22:00:00Z")));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(2));

    eliminarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(desfazerDoAviso() as HTMLElement);

    expect(aviso()).toHaveTextContent(TEXTOS.desfazerRascunhoFicou);
  });

  it("duas opções tocadas depressa: um só POST (o segundo toque não reenvia)", async () => {
    await abrirEventos();
    duplicarFalso.mockReturnValueOnce(pendente<EventoGestao>().promessa);
    await tocar(botaoDuplicar(FADO));

    fireEvent.click(opcaoDeSemanas(1));
    fireEvent.click(opcaoDeSemanas(2));
    await assentar();

    expect(duplicarFalso).toHaveBeenCalledTimes(1);
  });

  it("sem resposta: NÃO reenvia, recarrega por baixo e a frase não diz «Não consegui duplicar» (o servidor pode ter gravado)", async () => {
    await abrirEventos();
    duplicarFalso.mockRejectedValueOnce(erroSemResposta());

    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(2));

    expect(duplicarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(aviso()).toHaveTextContent(TEXTOS.duplicarSemSaber);
    expect(aviso()?.textContent).not.toContain(TEXTOS.duplicarServidor);
    expect(aviso()?.textContent).not.toMatch(/^\s*Erro\.\s*Não consegui duplicar/);
  });

  it("5xx: a frase do servidor; um só pedido", async () => {
    await abrirEventos();
    duplicarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(1));
    expect(aviso()).toHaveTextContent(TEXTOS.duplicarServidor);
    expect(duplicarFalso).toHaveBeenCalledTimes(1);
  });

  it("404: o original já não existe — recarrega e diz-o", async () => {
    await abrirEventos();
    duplicarFalso.mockRejectedValueOnce(erro404("evento_inexistente"));
    obterFalso.mockResolvedValueOnce(lista((l) => void tirar(l, 11)));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(1));

    expect(aviso()).toHaveTextContent(TEXTOS.jaNaoExiste);
    expect(screen.queryByRole("button", { name: FADO })).toBeNull();
    expect(haFolha(TEXTOS.tituloDuplicar)).toBe(false);
  });

  it("422 (data fora do intervalo ou campo=semanas): aviso genérico e recarrega; nunca a mensagem do backend", async () => {
    await abrirEventos();
    duplicarFalso.mockRejectedValueOnce(erro422("semanas"));
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(1));

    expect(aviso()).toHaveTextContent(TEXTOS.duplicar422);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("mensagem do backend");
  });

  it("401: aoPerderSessao uma vez; a ação não se repete", async () => {
    const sessao = await abrirEventos();
    duplicarFalso.mockRejectedValueOnce(erro401());
    await tocar(botaoDuplicar(FADO));
    await tocar(opcaoDeSemanas(1));
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(duplicarFalso).toHaveBeenCalledTimes(1);
  });

  it("fechar a folha sem escolher não faz pedido (Cancelar)", async () => {
    await abrirEventos();
    await tocar(botaoDuplicar(FADO));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    await assentar();
    expect(duplicarFalso).not.toHaveBeenCalled();
  });
});
