/**
 * F4-03, plano 7.2 e spec 4, 9 e 13 — o ecrã «Eventos»: carregar, os estados (regra 10), as
 * três partes, a linha, a divisória dos três primeiros e o arquivo que se abre. Criar/editar,
 * as ações da linha, eliminar e sair têm os seus ficheiros (`EventosGestao.folha.test.tsx`,
 * `.linha.test.tsx`, `.eliminar.test.tsx`, `.saida.test.tsx`).
 *
 * Contrato: ver `src/testes/eventos-gestao.tsx`. Onde o plano e a spec divergem, os textos e o
 * desenho são os da spec (as partes Rascunhos e Arquivo só se desenham se têm eventos; «Novo
 * evento» fica à vista mesmo em erro) e o contrato, os ficheiros e os testes os do plano.
 *
 * **Regra 10, o que mais importa aqui:** rede, 5xx, um corpo ilegível ou um `TypeError` **nunca**
 * desenham uma lista nem «Ainda não há eventos.»; o vazio só vem de um `200` com as três listas
 * vazias.
 *
 * **Deixa passar:** layout, 44 px, foco visível e axe (e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  erro401,
  erroDoServidor,
  erroSemResposta,
  eventoDeTeste,
  eventosDeGestaoDeTeste,
  eventosDeGestaoVazios,
} from "../../../testes/gestao";
import {
  abrirEventos,
  alterarFalso,
  aviso,
  assentar,
  botaoDuplicar,
  comSinal,
  haLinhaDe,
  interruptorDe,
  linhaDe,
  obterFalso,
  pendente,
  prepararApi,
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

function h1(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

function semLista(): void {
  expect(screen.queryAllByRole("listitem"), "nenhuma linha de evento").toEqual([]);
  expect(screen.queryAllByRole("region")).toEqual([]);
  expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
  expect(screen.queryByText(TEXTOS.proximosVazios)).toBeNull();
}

describe("carregar", () => {
  it("um GET com o sinal; o <h1> «Eventos» com tabindex -1; «Novo evento» já à vista", async () => {
    await abrirEventos();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(h1()).toHaveTextContent(TEXTOS.titulo);
    expect(h1()).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: TEXTOS.novoEvento })).toBeInTheDocument();
  });

  it("enquanto não responde: esqueleto sem texto, aria-busy, nenhuma linha; o <h1> e «Novo evento» já lá estão", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirEventos();

    expect(h1()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.novoEvento })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    semLista();
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });
});

describe("200: as três partes", () => {
  it("<h2> Próximos, Rascunhos e Arquivo, por esta ordem, cada um numa região com o seu nome", async () => {
    await abrirEventos();
    const titulos = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titulos).toEqual([TEXTOS.proximos, TEXTOS.rascunhos, TEXTOS.arquivo]);
    expect(secao(TEXTOS.proximos)).toBeInTheDocument();
    expect(secao(TEXTOS.rascunhos)).toBeInTheDocument();
    expect(secao(TEXTOS.arquivo)).toBeInTheDocument();
  });

  it("cada parte diz o que o site faz com ela", async () => {
    await abrirEventos();
    expect(within(secao(TEXTOS.proximos)).getByText(TEXTOS.linhaDosProximos)).toBeInTheDocument();
    expect(within(secao(TEXTOS.rascunhos)).getByText(TEXTOS.linhaDosRascunhos)).toBeInTheDocument();
  });

  it("os próximos pela ordem em que vêm; os rascunhos também (o sem data no fim)", async () => {
    await abrirEventos();
    const proximos = within(secao(TEXTOS.proximos))
      .getAllByRole("button", {
        name: /^(Fado ao vivo|Karaoke de teste|Sessão de jazz|Concerto de teste)$/,
      })
      .map((b) => b.textContent);
    expect(proximos).toEqual([
      "Fado ao vivo",
      "Karaoke de teste",
      "Sessão de jazz",
      "Concerto de teste",
    ]);
    const rascunhos = within(secao(TEXTOS.rascunhos))
      .getAllByRole("button", { name: /^(Rascunho com data|Rascunho importado)$/ })
      .map((b) => b.textContent);
    expect(rascunhos).toEqual(["Rascunho com data", "Rascunho importado"]);
  });

  it("Rascunhos e Arquivo não se desenham quando estão vazios; Próximos desenha-se sempre", async () => {
    prepararApi({
      proximos: [eventoDeTeste({ id: 1, titulo: "Só um" })],
      rascunhos: [],
      arquivo: [],
    });
    await abrirEventos();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      TEXTOS.proximos,
    ]);
  });
});

describe("a linha de evento", () => {
  it("o título é um botão; a data é absoluta, em Lisboa, com a forma da spec 4.4", async () => {
    await abrirEventos();
    expect(linhaDe("Fado ao vivo")).toHaveTextContent(
      `Quinta-feira, 5 de novembro, ${TEXTOS.comHora("22:00")}`,
    );
    expect(linhaDe("Concerto de teste")).toHaveTextContent(
      `Quinta-feira, 19 de novembro, ${TEXTOS.comHora("22:00")}`,
    );
  });

  it("00:30 é do dia certo (o instante UTC já é o dia certo, mas a hora lê-se 00:30)", async () => {
    await abrirEventos();
    expect(linhaDe("Karaoke de teste")).toHaveTextContent(
      `Sexta-feira, 6 de novembro, ${TEXTOS.comHora("00:30")}`,
    );
  });

  it("cada linha dos próximos e dos rascunhos tem o interruptor «Publicado, {título}» e «Duplicar {título}»", async () => {
    await abrirEventos();
    for (const titulo of ["Fado ao vivo", "Rascunho com data", "Rascunho importado"]) {
      const linha = linhaDe(titulo);
      expect(
        within(linha).getByRole("switch", { name: TEXTOS.publicadoDe(titulo) }),
      ).toBeInTheDocument();
      expect(
        within(linha).getByRole("button", { name: TEXTOS.duplicarDe(titulo) }),
      ).toBeInTheDocument();
    }
    expect(interruptorDe("Fado ao vivo")).toBeChecked();
    expect(interruptorDe("Rascunho com data")).not.toBeChecked();
  });

  it("o botão do título não leva o texto do ícone (o lápis é decorativo)", async () => {
    await abrirEventos();
    expect(screen.getByRole("button", { name: "Fado ao vivo" })).toBeInTheDocument();
  });

  it("rascunho sem data: «Sem data.», a nota, o interruptor aria-disabled e nenhum pedido ao tocar", async () => {
    await abrirEventos();
    const linha = linhaDe("Rascunho importado");

    expect(within(linha).getByText(TEXTOS.semData)).toBeInTheDocument();
    expect(within(linha).getByText(TEXTOS.notaSemData)).toBeInTheDocument();
    expect(interruptorDe("Rascunho importado")).toHaveAttribute("aria-disabled", "true");

    await tocar(interruptorDe("Rascunho importado"));
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
  });

  it("rascunho com data já passada (corte estimado): a nota diz que vai para o arquivo", async () => {
    prepararApi({
      proximos: [],
      rascunhos: [
        eventoDeTeste({
          id: 1,
          titulo: "Rascunho velho",
          inicio: "2026-10-20T22:00:00Z",
          publicado: false,
        }),
        // Um rascunho com data futura, para a comparação: o teste pedia esta linha sem a criar.
        eventoDeTeste({
          id: 2,
          titulo: "Rascunho com data",
          inicio: "2026-11-20T22:00:00Z",
          publicado: false,
        }),
      ],
      arquivo: [],
    });
    await abrirEventos();
    expect(within(linhaDe("Rascunho velho")).getByText(TEXTOS.notaPassada)).toBeInTheDocument();
    expect(within(linhaDe("Rascunho com data")).queryByText(TEXTOS.notaPassada)).toBeNull();
  });

  it("publicado de hoje: a nota «Hoje.»; as outras linhas não a têm", async () => {
    prepararApi({
      proximos: [
        eventoDeTeste({ id: 1, titulo: "Fado de hoje", inicio: "2026-11-02T22:00:00Z" }),
        eventoDeTeste({ id: 2, titulo: "Fado de amanhã", inicio: "2026-11-03T22:00:00Z" }),
      ],
      rascunhos: [],
      arquivo: [],
    });
    await abrirEventos();
    expect(within(linhaDe("Fado de hoje")).getByText(TEXTOS.notaHoje)).toBeInTheDocument();
    expect(within(linhaDe("Fado de amanhã")).queryByText(TEXTOS.notaHoje)).toBeNull();
  });

  it("o relógio lê-se num só sítio: a nota «Hoje.» só muda depois do `visibilitychange`", async () => {
    prepararApi({
      proximos: [eventoDeTeste({ id: 1, titulo: "Fado de hoje", inicio: "2026-11-02T22:00:00Z" })],
      rascunhos: [],
      arquivo: [],
    });
    await abrirEventos();
    expect(screen.getByText(TEXTOS.notaHoje)).toBeInTheDocument();

    vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
    await assentar();
    expect(
      screen.getByText(TEXTOS.notaHoje),
      "renderizar de novo não relê o relógio",
    ).toBeInTheDocument();

    fireEvent(document, new Event("visibilitychange"));
    await assentar();
    expect(screen.queryByText(TEXTOS.notaHoje)).toBeNull();
  });

  it("um título de 120 caracteres não se corta (o botão tem o texto todo)", async () => {
    const titulo = "T".repeat(120);
    prepararApi({ proximos: [eventoDeTeste({ id: 1, titulo })], rascunhos: [], arquivo: [] });
    await abrirEventos();
    expect(screen.getByRole("button", { name: titulo })).toHaveTextContent(titulo);
  });

  it("o título e a descrição (texto do dono) nunca são HTML", async () => {
    prepararApi({
      proximos: [eventoDeTeste({ id: 1, titulo: '<img src=x onerror="alert(1)">' })],
      rascunhos: [],
      arquivo: [],
    });
    await abrirEventos();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(
      screen.getByRole("button", { name: '<img src=x onerror="alert(1)">' }),
    ).toBeInTheDocument();
  });
});

describe("a divisória dos três primeiros (o que o site mostra)", () => {
  function proximos(n: number) {
    return Array.from({ length: n }, (_, i) =>
      eventoDeTeste({
        id: i + 1,
        titulo: `Evento ${String(i + 1)}`,
        inicio: `2026-11-${String(5 + i).padStart(2, "0")}T22:00:00Z`,
      }),
    );
  }

  it("com 4: entre o 3.º e o 4.º, e sem ser botão nem ligação", async () => {
    prepararApi({ proximos: proximos(4), rascunhos: [], arquivo: [] });
    await abrirEventos();
    const itens = within(secao(TEXTOS.proximos)).getAllByRole("listitem");

    expect(itens).toHaveLength(5);
    expect(itens[3]).toHaveTextContent(TEXTOS.divisoria);
    expect(within(itens[3] as HTMLElement).queryAllByRole("button")).toEqual([]);
    expect(within(itens[3] as HTMLElement).queryAllByRole("link")).toEqual([]);
    expect(itens[4]).toHaveTextContent("Evento 4");
  });

  it("a divisória tem aria-label igual ao texto, para o leitor de ecrã anunciar a fronteira", async () => {
    prepararApi({ proximos: proximos(4), rascunhos: [], arquivo: [] });
    await abrirEventos();
    expect(screen.getByLabelText(TEXTOS.divisoria, { selector: "li" })).toBeInTheDocument();
  });

  it("com 3 (ou menos) não há divisória; com 0 também não há a linha de cima", async () => {
    prepararApi({ proximos: proximos(3), rascunhos: [], arquivo: [] });
    await abrirEventos();
    expect(screen.queryByText(TEXTOS.divisoria)).toBeNull();
    expect(screen.getByText(TEXTOS.linhaDosProximos)).toBeInTheDocument();
  });

  it("sem próximos mas com rascunhos: a parte desenha-se com a frase própria, sem lista nem a linha de cima", async () => {
    prepararApi({
      proximos: [],
      rascunhos: [eventoDeTeste({ id: 9, titulo: "Só rascunho", publicado: false })],
      arquivo: [],
    });
    await abrirEventos();

    expect(within(secao(TEXTOS.proximos)).getByText(TEXTOS.proximosVazios)).toBeInTheDocument();
    expect(within(secao(TEXTOS.proximos)).queryAllByRole("listitem")).toEqual([]);
    expect(screen.queryByText(TEXTOS.linhaDosProximos)).toBeNull();
    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
  });
});

describe("o arquivo: recolhido, 20 de cada vez", () => {
  function arquivo(n: number) {
    return Array.from({ length: n }, (_, i) =>
      eventoDeTeste({
        id: 100 + i,
        titulo: `Passado ${String(i + 1).padStart(2, "0")}`,
        inicio: "2026-10-10T22:00:00Z",
      }),
    );
  }
  const linhasDoArquivo = () =>
    within(secao(TEXTOS.arquivo)).queryAllByRole("button", { name: /^Passado \d\d$/ });

  it("começa recolhido: só o botão «Ver o arquivo (n)» com aria-expanded=false, nenhuma linha", async () => {
    await abrirEventos();
    const botao = screen.getByRole("button", { name: TEXTOS.verOArquivo(2) });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(haLinhaDe("Noite de samba")).toBe(false);
    expect(haLinhaDe("Fado de outubro")).toBe(false);
  });

  it("abrir mostra as linhas, o botão passa a «Esconder o arquivo» e o foco fica nele; as do arquivo têm «Duplicar» e não têm interruptor", async () => {
    await abrirEventos();
    const botao = screen.getByRole("button", { name: TEXTOS.verOArquivo(2) });
    botao.focus();
    await tocar(botao);

    const aberto = screen.getByRole("button", { name: TEXTOS.esconderOArquivo });
    expect(aberto).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(aberto);
    const linha = linhaDe("Noite de samba");
    expect(linha).toHaveTextContent(`Quinta-feira, 29 de outubro, ${TEXTOS.comHora("22:00")}`);
    expect(linhaDe("Fado de outubro")).toHaveTextContent(
      `Quinta-feira, 15 de outubro, ${TEXTOS.comHora("22:00")}`,
    );
    expect(within(linha).queryByRole("switch")).toBeNull();
    expect(botaoDuplicar("Noite de samba")).toBeInTheDocument();

    await tocar(aberto);
    expect(haLinhaDe("Noite de samba")).toBe(false);
  });

  it("45 eventos: 20, depois 40, depois 45; sem «Mostrar mais» quando acabam", async () => {
    prepararApi({ proximos: [], rascunhos: [], arquivo: arquivo(45) });
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: TEXTOS.verOArquivo(45) }));

    expect(linhasDoArquivo()).toHaveLength(20);
    await tocar(screen.getByRole("button", { name: TEXTOS.mostrarMais(20) }));
    expect(linhasDoArquivo()).toHaveLength(40);
    await tocar(screen.getByRole("button", { name: TEXTOS.mostrarMais(5) }));
    expect(linhasDoArquivo()).toHaveLength(45);
    expect(screen.queryByRole("button", { name: /^Mostrar mais/ })).toBeNull();
  });

  it("com 20 ou menos não há «Mostrar mais»", async () => {
    prepararApi({ proximos: [], rascunhos: [], arquivo: arquivo(20) });
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: TEXTOS.verOArquivo(20) }));
    expect(linhasDoArquivo()).toHaveLength(20);
    expect(screen.queryByRole("button", { name: /^Mostrar mais/ })).toBeNull();
  });
});

describe("vazio ≠ erro ≠ parte vazia (regra 10)", () => {
  it("200 com as três listas vazias: «Ainda não há eventos.» e nenhum «Não consegui…»; «Novo evento» continua", async () => {
    prepararApi(eventosDeGestaoVazios());
    await abrirEventos();

    expect(screen.getByText(TEXTOS.vazioTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.vazioLinha)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    expect(screen.getByRole("button", { name: TEXTOS.novoEvento })).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });
});

describe("carregar falha: nunca uma lista (regra 10)", () => {
  it("sem resposta: o erro de ligação, «Tentar outra vez», nenhuma lista; o <h1> e «Novo evento» ficam", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirEventos();

    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.carregarSemResposta)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.carregarServidor)).toBeNull();
    expect(screen.getByRole("button", { name: TEXTOS.tentarOutraVez })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.novoEvento })).toBeInTheDocument();
    expect(h1()).toBeInTheDocument();
    semLista();
  });

  it.each([500, 503, 403])(
    "%i: a frase de servidor (não a de ligação), nenhuma lista",
    async (estado) => {
      obterFalso.mockRejectedValue(erroDoServidor(estado));
      await abrirEventos();

      expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
      expect(screen.getByText(TEXTOS.carregarServidor)).toBeInTheDocument();
      expect(screen.queryByText(TEXTOS.carregarSemResposta)).toBeNull();
      semLista();
    },
  );

  it("um 200 ilegível (ErroDaApi de estado 200) é erro do servidor, nunca «sem resposta» nem «não há eventos»", async () => {
    obterFalso.mockRejectedValue(erroDoServidor(200));
    await abrirEventos();
    expect(screen.getByText(TEXTOS.carregarServidor)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.carregarSemResposta)).toBeNull();
    semLista();
  });

  it("um TypeError do nosso código ou um erro qualquer: erro, não o esqueleto para sempre", async () => {
    obterFalso.mockRejectedValue(new TypeError("x is undefined"));
    await abrirEventos();
    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    semLista();
  });

  it("a mensagem do backend / do cliente nunca aparece", async () => {
    obterFalso.mockRejectedValue(erroDoServidor(500));
    await abrirEventos();
    expect(document.body.textContent).not.toMatch(/mensagem do cliente|mensagem do backend/);
  });

  it("«Tentar outra vez»: «A tentar…» com aria-busy; se agora correr bem, aparece a lista", async () => {
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirEventos();
    const segunda = pendente<ReturnType<typeof eventosDeGestaoDeTeste>>();
    obterFalso.mockReturnValueOnce(segunda.promessa);

    await tocar(screen.getByRole("button", { name: TEXTOS.tentarOutraVez }));
    expect(screen.getByRole("button", { name: TEXTOS.aTentar })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    segunda.resolver(eventosDeGestaoDeTeste());
    await assentar();
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(haLinhaDe("Fado ao vivo")).toBe(true);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("se falhar outra vez, continua sem lista", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: TEXTOS.tentarOutraVez }));
    expect(obterFalso).toHaveBeenCalledTimes(2);
    semLista();
  });
});

describe("sessão (401)", () => {
  it("401 ao carregar: aoPerderSessao uma vez, e nenhuma lista nem erro de carregar", async () => {
    obterFalso.mockRejectedValue(erro401());
    const sessao = await abrirEventos();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    semLista();
  });
});
