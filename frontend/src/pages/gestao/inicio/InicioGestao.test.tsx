/**
 * F4-05b, `docs/ecras/F4-05b.md` secção 4 e critérios 1 a 4 — o Início: as três secções pela
 * ordem certa, o botão dourado **só** com fotos à espera (0, 1 e 5), as ligações («Ver os
 * eventos», «Ver os clientes»; os eventos **não** são ligações), as frases de 0, 1 e n, e os
 * estados distintos (a carregar, pronto, erro) — com a regra 10: `pronto` só vem de um `200`
 * válido; um erro, um corpo ilegível ou um cancelamento **nunca** são zeros.
 *
 * **Deixa passar:** o primeiro bloco acima da dobra, os 44 px, o anel de foco e o axe (e2e).
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventosDoResumo, resumoDeTeste, resumoVazio } from "../../../testes/clientes-dados";
import {
  MENSAGEM_DO_BACKEND,
  T,
  abrirInicio,
  assentar,
  avancar,
  botaoTentarOutraVez,
  comSinal,
  esconderAAba,
  erroDe,
  erroIlegivel,
  erroSemResposta,
  esqueletos,
  h1,
  h2s,
  haBotaoTentarOutraVez,
  haEsqueleto,
  ligacaoDasFotos,
  ligacaoDosClientes,
  ligacaoDosEventos,
  linhaDeEstado,
  pendente,
  prepararApi,
  resumoFalso,
  seccao,
  seccoes,
  tocar,
  voltarAAba,
  within,
  type RespostaResumo,
} from "../../../testes/inicio-gestao";
import { eventoDeTeste } from "../../../testes/gestao";

vi.mock("../../../lib/api/gestao-resumo", () => ({ obterResumo: vi.fn() }));

beforeEach(() => {
  prepararApi(resumoDeTeste());
});

describe("a ordem e a estrutura (4.1, critério 1)", () => {
  it("<h1 tabindex=-1> «Início» e, depois, três <section aria-labelledby>: Fotos à espera, Próximos eventos, Novos registos — nesta ordem", async () => {
    await abrirInicio();

    expect(h1()).toHaveTextContent(T.titulo);
    expect(h1()).toHaveAttribute("tabindex", "-1");
    const regioes = seccoes();
    expect(regioes).toHaveLength(3);
    expect(regioes.map((r) => r.getAttribute("aria-labelledby")).every((v) => v !== null)).toBe(
      true,
    );
    expect(h2s().map((h) => h.textContent)).toEqual([
      T.fotosTitulo,
      T.eventosTitulo,
      T.registosTitulo,
    ]);
    expect(regioes.map((r) => r.querySelector("h2")?.textContent)).toEqual([
      T.fotosTitulo,
      T.eventosTitulo,
      T.registosTitulo,
    ]);
    const principal = h1();
    expect(
      principal.compareDocumentPosition(regioes[0] as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("o «Início» genérico da F4-01 (o vazio «Ainda não há nada aqui.») já não existe", async () => {
    await abrirInicio();
    expect(screen.queryByText("Ainda não há nada aqui.")).toBeNull();
    expect(screen.queryByText("Esta página não tem conteúdo nesta versão.")).toBeNull();
  });

  it("pede o resumo UMA vez ao montar, com `{ sinal }`, e nada de polling com o tempo", async () => {
    await abrirInicio();
    expect(resumoFalso).toHaveBeenCalledTimes(1);
    expect(resumoFalso).toHaveBeenCalledWith(comSinal);

    await avancar(10 * 60_000);

    expect(resumoFalso).toHaveBeenCalledTimes(1);
  });

  it("sem painéis, sem creme e sem sombra: o Início é texto sobre o bordô", async () => {
    await abrirInicio();
    for (const r of seccoes()) {
      expect(r.className).not.toMatch(/superficie-painel|bg-creme|shadow/);
    }
  });

  it("os blocos separam-se por um fio (`border-t border-fio-interno`), o primeiro sem fio", async () => {
    await abrirInicio();
    const [a, b, c] = seccoes() as [HTMLElement, HTMLElement, HTMLElement];
    expect(a.className).not.toMatch(/border-t/);
    for (const r of [b, c]) {
      expect(r.className).toMatch(/border-t/);
      expect(r.className).toMatch(/border-fio-interno/);
    }
  });
});

describe("fotos à espera (4.2, critério 2)", () => {
  it.each([
    [0, T.fotos0, false],
    [1, T.fotos1, true],
    [5, T.fotosN(5), true],
    [3, T.fotosN(3), true],
    [1234, T.fotosN(1234), true],
  ])("%i: a frase certa e o botão só com fotos", async (n, frase, temBotao) => {
    prepararApi(resumoDeTeste({ fotos_pendentes: n }));
    await abrirInicio();

    expect(seccao(T.fotosTitulo)).toHaveTextContent(frase);
    expect(ligacaoDasFotos() !== null).toBe(temBotao);
  });

  it("com 0 fotos NÃO há botão principal nenhum (nenhum `bg-acao`) em toda a página", async () => {
    prepararApi(resumoDeTeste({ fotos_pendentes: 0 }));
    await abrirInicio();
    expect(document.querySelector('[class*="bg-acao"]')).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("sem «!», sem vermelho: é uma tarefa, não um alarme", async () => {
    await abrirInicio();
    const s = seccao(T.fotosTitulo);
    expect(s.textContent).not.toContain("!");
    expect(s.querySelector(".text-erro")).toBeNull();
  });

  it("«Ir para a fila de fotos» é uma ligação (<a href=/gestao/galeria>) com o aspeto do Botao principal e `min-h-toque`; o ÚNICO dourado", async () => {
    await abrirInicio();
    const l = ligacaoDasFotos() as HTMLElement;
    expect(l.tagName).toBe("A");
    expect(l).toHaveAttribute("href", "/gestao/galeria");
    expect(l.className).toMatch(/bg-acao/);
    expect(l.className).toMatch(/min-h-toque/);
    expect(l.className).toMatch(/px-6/);
    expect(document.querySelectorAll('[class*="bg-acao"]')).toHaveLength(1);
  });

  it("tocar leva a /gestao/galeria pelo `navegar` (muda o endereço, sem recarregar)", async () => {
    await abrirInicio();
    const l = ligacaoDasFotos() as HTMLElement;
    const evento = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });

    l.dispatchEvent(evento);

    expect(evento.defaultPrevented, "o clique simples é nosso").toBe(true);
    expect(window.location.pathname).toBe("/gestao/galeria");
  });

  it("Ctrl+clique (abrir noutro separador) NÃO é interceptado", async () => {
    await abrirInicio();
    const l = ligacaoDasFotos() as HTMLElement;
    const evento = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });

    l.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe("/gestao");
  });

  it("o botão vem a seguir à frase, na mesma secção", async () => {
    await abrirInicio();
    const s = seccao(T.fotosTitulo);
    const frase = screen.getByText(T.fotosN(3));
    expect(s).toContainElement(ligacaoDasFotos() as HTMLElement);
    expect(
      frase.compareDocumentPosition(ligacaoDasFotos() as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("próximos eventos (4.3, critério 3)", () => {
  it("até 3 linhas: título e a data absoluta de Lisboa (Quinta-feira, 5 de novembro, às 22:00), SEM ligações dentro", async () => {
    await abrirInicio();
    const s = seccao(T.eventosTitulo);
    const linhas = within(s).getAllByRole("listitem");

    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toHaveTextContent("Fado ao vivo");
    expect(linhas[0]).toHaveTextContent("Quinta-feira, 5 de novembro, às 22:00");
    expect(linhas[1]).toHaveTextContent("Karaoke de teste");
    expect(linhas[1]).toHaveTextContent("Sexta-feira, 6 de novembro, às 00:30");
    expect(linhas[2]).toHaveTextContent("Sessão de jazz");
    for (const li of linhas) {
      expect(li.querySelector("a, button"), "as linhas de evento não são ligações").toBeNull();
    }
  });

  it("o ano só se não for o corrente (2027 leva o ano; 2026 não)", async () => {
    prepararApi(
      resumoDeTeste({
        proximos_eventos: [
          eventoDeTeste({ id: 1, titulo: "Ano Novo", inicio: "2027-01-01T22:00:00Z" }),
          eventoDeTeste({ id: 2, titulo: "Este ano", inicio: "2026-12-04T22:00:00Z" }),
        ],
      }),
    );
    await abrirInicio();
    expect(screen.getByText("Sexta-feira, 1 de janeiro de 2027, às 22:00")).toBeInTheDocument();
    expect(screen.getByText("Sexta-feira, 4 de dezembro, às 22:00")).toBeInTheDocument();
  });

  it("UMA só ligação «Ver os eventos» → /gestao/eventos (nunca uma por linha), dentro da secção", async () => {
    await abrirInicio();
    const s = seccao(T.eventosTitulo);
    expect(within(s).getAllByRole("link")).toHaveLength(1);
    expect(ligacaoDosEventos()).toHaveAttribute("href", "/gestao/eventos");
    expect(s).toContainElement(ligacaoDosEventos());
  });

  it("a ligação não é um botão dourado: texto sublinhado, `min-h-toque`, `inline-flex`", async () => {
    await abrirInicio();
    const l = ligacaoDosEventos();
    expect(l.className).toMatch(/underline/);
    expect(l.className).toMatch(/min-h-toque/);
    expect(l.className).toMatch(/inline-flex/);
    expect(l.className).not.toMatch(/bg-acao/);
  });

  it("sem eventos: «Não há eventos publicados daqui para a frente.» e a ligação «Ver os eventos» (é o caminho para criar um)", async () => {
    prepararApi(resumoVazio());
    await abrirInicio();
    const s = seccao(T.eventosTitulo);
    expect(s).toHaveTextContent(T.eventosVazio);
    expect(within(s).queryAllByRole("listitem")).toHaveLength(0);
    expect(ligacaoDosEventos()).toHaveAttribute("href", "/gestao/eventos");
  });

  it("um evento: uma linha e a ligação", async () => {
    prepararApi(resumoDeTeste({ proximos_eventos: eventosDoResumo(1) }));
    await abrirInicio();
    expect(within(seccao(T.eventosTitulo)).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(T.verOsEventos)).toBeInTheDocument();
  });

  it("o título do evento é texto do dono mas só texto (HTML não vira elemento) e quebra (`break-words`, `line-clamp-2`)", async () => {
    prepararApi(
      resumoDeTeste({
        proximos_eventos: [
          eventoDeTeste({
            id: 1,
            titulo: "<b>Fado</b> " + "x".repeat(200),
            inicio: "2026-11-05T22:00:00Z",
          }),
        ],
      }),
    );
    await abrirInicio();
    const li = within(seccao(T.eventosTitulo)).getByRole("listitem");
    expect(li.querySelector("b")).toBeNull();
    const titulo = within(li).getByText(/<b>Fado<\/b>/);
    expect(titulo.className).toMatch(/break-words/);
    expect(titulo.className).toMatch(/line-clamp-2/);
  });

  it("um evento com `inicio` ilegível é um corpo ilegível: o erro de carregar (a API recusa-o; o ecrã não o desenha como «nunca»)", async () => {
    resumoFalso.mockRejectedValue(erroIlegivel());
    await abrirInicio();
    expect(screen.getByText(T.erroTitulo)).toBeInTheDocument();
    expect(seccoes()).toHaveLength(0);
  });
});

describe("novos registos (4.3)", () => {
  it.each([
    [0, T.registos0],
    [1, T.registos1],
    [2, T.registosN(2)],
    [37, T.registosN(37)],
  ])("%i: «%s»", async (n, frase) => {
    prepararApi(resumoDeTeste({ novos_registos: n }));
    await abrirInicio();
    expect(seccao(T.registosTitulo)).toHaveTextContent(frase);
  });

  it("o zero é uma frase de facto: não diz «ainda», nem «formulário», nem «tenta outra vez»", async () => {
    prepararApi(resumoVazio());
    await abrirInicio();
    const texto = seccao(T.registosTitulo).textContent ?? "";
    expect(texto).toContain(T.registos0);
    expect(texto).not.toMatch(/ainda|formul[áa]rio|tenta|existe|erro/i);
  });

  it("«Ver os clientes» → /gestao/mais/clientes, SEMPRE (também com 0), uma só ligação, texto e não botão dourado", async () => {
    for (const n of [0, 1, 9]) {
      prepararApi(resumoDeTeste({ novos_registos: n }));
      await abrirInicio();
      expect(ligacaoDosClientes()).toHaveAttribute("href", "/gestao/mais/clientes");
      expect(seccao(T.registosTitulo)).toContainElement(ligacaoDosClientes());
      expect(ligacaoDosClientes().className).not.toMatch(/bg-acao/);
      expect(ligacaoDosClientes().className).toMatch(/min-h-toque/);
      const { cleanup } = await import("@testing-library/react");
      cleanup();
    }
  });

  it("os links de texto levam aos sítios certos pelo `navegar` (eventos e clientes)", async () => {
    await abrirInicio();
    const aEventos = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    ligacaoDosEventos().dispatchEvent(aEventos);
    expect(aEventos.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe("/gestao/eventos");

    const aClientes = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    ligacaoDosClientes().dispatchEvent(aClientes);
    expect(aClientes.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe("/gestao/mais/clientes");
  });
});

describe("a carregar (4.4, critério 4)", () => {
  it("o <h1> e três blocos de esqueleto SEM texto, aria-busy, sem botões nem ligações; nada de números", async () => {
    resumoFalso.mockReturnValue(pendente<never>().promessa);
    await abrirInicio();

    expect(h1()).toHaveTextContent(T.titulo);
    expect(esqueletos().length).toBeGreaterThanOrEqual(1);
    for (const no of esqueletos()) {
      expect(no.textContent?.trim(), "o esqueleto não tem texto").toBe("");
      expect(no.querySelector("a, button")).toBeNull();
    }
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\d/);
    expect(screen.queryByText(T.fotos0)).toBeNull();
    expect(screen.queryByText(T.registos0)).toBeNull();
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
  });

  it("barras `w-1/2` (uma por <h2>) e `w-3/4` (uma por corpo), em `bg-fio-interno`", async () => {
    resumoFalso.mockReturnValue(pendente<never>().promessa);
    await abrirInicio();
    const html = esqueletos()
      .map((n) => n.outerHTML)
      .join("");
    expect((html.match(/w-1\/2/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((html.match(/w-3\/4/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/bg-fio-interno/);
  });

  it("quando o resumo chega, o esqueleto sai e aparecem as três secções", async () => {
    const resposta = pendente<RespostaResumo>();
    resumoFalso.mockReturnValueOnce(resposta.promessa);
    await abrirInicio();
    expect(haEsqueleto()).toBe(true);

    resposta.resolver(resumoDeTeste());
    await assentar();

    expect(haEsqueleto()).toBe(false);
    expect(seccoes()).toHaveLength(3);
  });
});

describe("erro (4.4, critério 4): NUNCA zeros", () => {
  it.each([
    ["sem resposta (rede, DNS, prazo)", erroSemResposta, T.erroSemResposta],
    ["500", () => erroDe(500), T.erroServidor],
    ["502", () => erroDe(502), T.erroServidor],
    ["403", () => erroDe(403), T.erroServidor],
    [
      "um corpo ilegível (`fotos_pendentes` negativo ou fracionário, lista que não é lista…)",
      erroIlegivel,
      T.erroServidor,
    ],
  ])(
    "%s: o título, a linha certa e «Tentar outra vez»; sem as três secções, sem ligações, sem zeros",
    async (_nome, fazer, linha) => {
      resumoFalso.mockRejectedValue(fazer());
      await abrirInicio();

      expect(screen.getByText(T.erroTitulo)).toBeInTheDocument();
      expect(screen.getByText(linha)).toBeInTheDocument();
      expect(screen.getByText(T.erroTitulo).className).toMatch(/text-erro/);
      expect(botaoTentarOutraVez()).toBeInTheDocument();
      expect(seccoes()).toHaveLength(0);
      expect(h2s()).toHaveLength(0);
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      for (const frase of [T.fotos0, T.registos0, T.eventosVazio]) {
        expect(
          screen.queryByText(frase),
          `«${frase}» é «não há nada»: não pode existir num erro`,
        ).toBeNull();
      }
      expect(document.body.textContent).not.toMatch(/\bHá \d|Houve \d/);
      expect(document.body.textContent).not.toContain(MENSAGEM_DO_BACKEND);
      expect(h1()).toHaveTextContent(T.titulo);
    },
  );

  it("as duas linhas são diferentes (sem resposta ≠ o servidor respondeu)", async () => {
    expect(T.erroSemResposta).not.toBe(T.erroServidor);
    resumoFalso.mockRejectedValue(erroSemResposta());
    await abrirInicio();
    expect(screen.queryByText(T.erroServidor)).toBeNull();
  });

  it("«Tentar outra vez» repete o GET («A tentar…» com aria-busy) e, com sucesso, mostra o resumo", async () => {
    resumoFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirInicio();
    const resposta = pendente<RespostaResumo>();
    resumoFalso.mockReturnValueOnce(resposta.promessa);

    await tocar(botaoTentarOutraVez());

    expect(resumoFalso).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: T.aTentar })).toHaveAttribute("aria-busy", "true");
    resposta.resolver(resumoDeTeste());
    await assentar();
    expect(seccoes()).toHaveLength(3);
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
  });

  it("se «Tentar outra vez» falha outra vez, continua a ser o erro", async () => {
    resumoFalso.mockRejectedValue(erroDe(500));
    await abrirInicio();
    await tocar(botaoTentarOutraVez());
    expect(screen.getByText(T.erroTitulo)).toBeInTheDocument();
    expect(seccoes()).toHaveLength(0);
  });
});

describe("401 (4.4)", () => {
  it("aoPerderSessao UMA vez, sem erro e sem zeros; nada de «Tentar outra vez»", async () => {
    resumoFalso.mockRejectedValue(erroDe(401));
    const sessao = await abrirInicio();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(T.erroTitulo)).toBeNull();
    expect(seccoes()).toHaveLength(0);
    expect(haBotaoTentarOutraVez()).toBe(false);
    expect(resumoFalso).toHaveBeenCalledTimes(1);
  });
});

describe("cada visita é uma leitura nova (secção 2)", () => {
  it("desmontar e montar outra vez pede outra vez; enquanto não chega NÃO se vêem os números da visita anterior", async () => {
    await abrirInicio();
    expect(screen.getByText(T.fotosN(3))).toBeInTheDocument();
    const { cleanup } = await import("@testing-library/react");
    cleanup();

    resumoFalso.mockReturnValueOnce(pendente<never>().promessa);
    await abrirInicio();

    expect(resumoFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(T.fotosN(3))).toBeNull();
    expect(haEsqueleto()).toBe(true);
  });

  it("o resumo não vai para o armazenamento do browser", async () => {
    const guardar = vi.spyOn(Storage.prototype, "setItem");
    await abrirInicio();
    expect(guardar).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    guardar.mockRestore();
  });
});

describe("releitura silenciosa ao voltar à aba (4.4)", () => {
  it("pede outra vez SEM esqueleto e substitui os números", async () => {
    await abrirInicio();
    const resposta = pendente<RespostaResumo>();
    resumoFalso.mockReturnValueOnce(resposta.promessa);

    await voltarAAba();

    expect(resumoFalso).toHaveBeenCalledTimes(2);
    expect(haEsqueleto()).toBe(false);
    expect(screen.getByText(T.fotosN(3))).toBeInTheDocument();
    resposta.resolver(resumoDeTeste({ fotos_pendentes: 7 }));
    await assentar();
    expect(screen.getByText(T.fotosN(7))).toBeInTheDocument();
  });

  it("uma aba que fica oculta não pede nada", async () => {
    await abrirInicio();
    await esconderAAba();
    expect(resumoFalso).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sem resposta", erroSemResposta],
    ["500", () => erroDe(500)],
    ["corpo ilegível", erroIlegivel],
  ])(
    "se falha (%s) e já havia resumo, MANTÉM-SE e a linha diz «Pode estar desatualizado.» com «Tentar outra vez»",
    async (_n, fazer) => {
      await abrirInicio();
      resumoFalso.mockRejectedValueOnce(fazer());

      await voltarAAba();

      expect(seccoes()).toHaveLength(3);
      expect(screen.getByText(T.fotosN(3))).toBeInTheDocument();
      expect(linhaDeEstado(T.desatualizado)).not.toBeNull();
      expect(screen.queryByText(T.erroTitulo)).toBeNull();
      expect(botaoTentarOutraVez()).toBeInTheDocument();
    },
  );

  it("«Tentar outra vez» da linha repete só o GET e, com sucesso, tira a linha", async () => {
    await abrirInicio();
    resumoFalso.mockRejectedValueOnce(erroSemResposta());
    await voltarAAba();
    resumoFalso.mockClear();

    await tocar(botaoTentarOutraVez());

    expect(resumoFalso).toHaveBeenCalledTimes(1);
    expect(linhaDeEstado(T.desatualizado)).toBeNull();
    expect(seccoes()).toHaveLength(3);
  });

  it("um 401 na releitura leva ao login", async () => {
    const sessao = await abrirInicio();
    resumoFalso.mockRejectedValueOnce(erroDe(401));
    await voltarAAba();
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it("uma releitura que traz zeros (200 válido) mostra zeros: é a verdade do servidor", async () => {
    await abrirInicio();
    resumoFalso.mockResolvedValueOnce(resumoVazio());
    await voltarAAba();
    expect(screen.getByText(T.fotos0)).toBeInTheDocument();
    expect(ligacaoDasFotos()).toBeNull();
  });
});

describe("cancelamento (desmontar) não é erro", () => {
  it("desmontar a meio aborta o pedido e nada se desenha por isso", async () => {
    let sinal: AbortSignal | undefined;
    resumoFalso.mockImplementationOnce((opcoes) => {
      sinal = opcoes?.sinal;
      return new Promise((_c, falhar) => {
        sinal?.addEventListener("abort", () => {
          falhar(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const sessao = await abrirInicio();
    const { cleanup } = await import("@testing-library/react");

    cleanup();
    await assentar();

    expect(sinal?.aborted).toBe(true);
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(T.erroTitulo);
  });

  it("no StrictMode o pedido cancelado do primeiro efeito não vira erro: no fim, o resumo", async () => {
    resumoFalso.mockReset();
    resumoFalso
      .mockImplementationOnce(
        (opcoes) =>
          new Promise((_c, falhar) => {
            opcoes?.sinal?.addEventListener("abort", () => {
              falhar(new DOMException("Aborted", "AbortError"));
            });
          }),
      )
      .mockImplementation(() => Promise.resolve(resumoDeTeste()));

    await abrirInicio(undefined, { estrito: true });

    expect(screen.queryByText(T.erroTitulo)).toBeNull();
    expect(seccoes()).toHaveLength(3);
  });
});
