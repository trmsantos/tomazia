/**
 * F3-06a, 11 (critérios 1 a 5, 8 e 9) — a secção «Visita-nos», desenhada.
 *
 * Contrato que este ficheiro define e que `VisitaNos.tsx` tem de cumprir:
 *
 * ```tsx
 * export type EstadoDaSeccao =
 *   | { estado: "a-carregar" }
 *   | { estado: "pronto"; info: Info }
 *   | { estado: "falhou"; estadoHttp: number | null };   // o `estado` do ErroDaApi; null = sem resposta
 *
 * export function VisitaNos(props: {
 *   info: EstadoDaSeccao;
 *   /** Repete o pedido do `/info`. Cumpre-se quando a tentativa acaba, bem ou mal; nunca rejeita. *\/
 *   aoTentarOutraVez: () => Promise<void>;
 * }): ReactElement | null
 * ```
 *
 * Devolve `null` quando nenhum bloco tem o que mostrar (4.4). Não pede nada à
 * rede: o `App.tsx` pede o `/info` uma vez e passa o mesmo estado ao cabeçalho
 * e a esta secção (2.3). O estado `falhou` do `App`/`Cabecalho` passa a trazer
 * `estadoHttp` — o tipo vive hoje em `Cabecalho.tsx`, que a F3-08 também toca.
 *
 * **O que prova:** os quatro estados com DOMs distintos (a regra 10: «não
 * consegui perguntar», «por configurar» e «a carregar» não se confundem); que
 * «Fechado» só se escreve quando o dono o disse; que cada campo vazio esconde a
 * sua linha; as ligações (S-13: nada de `javascript:`); a tabela; os alvos de
 * 44 px **pela classe** (o jsdom não tem layout: a medida é de
 * `e2e/visita-nos.spec.ts`); a ordem do DOM; e que não há dourado.
 *
 * **O que deixa passar:** layout, pintura, o anel de foco e o axe
 * (`e2e/visita-nos.spec.ts`); o temporizador (`VisitaNos.relogio.test.tsx`); o
 * «Lisboa em falta» (`VisitaNos.sem-lisboa.test.tsx`).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
  A_CARREGAR,
  ID_DA_SECCAO,
  ID_DO_TITULO,
  INSTAGRAM_DE_TESTE,
  LINHAS_DO_MOMENTO,
  MAPS_DE_TESTE,
  MORADA_DE_TESTE,
  MOMENTOS,
  NOMES_DOS_DIAS_NA_TABELA,
  TELEFONE_DE_TESTE,
  TEXTOS_DO_VISITA_NOS as T,
  falhou,
  horarioFechadoASemanaToda,
  horarioPadrao,
  infoCom,
  infoCompleta,
  infoVazia,
  pronto,
} from "../../testes/visita-nos";
import type { EstadoDaSeccao } from "../../testes/visita-nos";
import { semanaDeTeste } from "../../testes/gestao";
import { VisitaNos } from "./VisitaNos";

/** O momento por omissão: quinta 17:00 em ponto, com o bar a abrir. */
function desenhar(
  estado: EstadoDaSeccao,
  opcoes: { momento?: string; aoTentarOutraVez?: () => Promise<void> } = {},
): RenderResult & { aoTentarOutraVez: Mock<() => Promise<void>> } {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(opcoes.momento ?? MOMENTOS.qui17h00));

  const aoTentarOutraVez = vi.fn<() => Promise<void>>(
    opcoes.aoTentarOutraVez ?? (() => Promise.resolve()),
  );
  const resultado = render(<VisitaNos info={estado} aoTentarOutraVez={aoTentarOutraVez} />);

  return { ...resultado, aoTentarOutraVez };
}

afterEach(() => {
  vi.useRealTimers();
});

function seccao(container: HTMLElement): HTMLElement {
  const encontrada = container.querySelector<HTMLElement>(`section#${ID_DA_SECCAO}`);
  if (encontrada === null) throw new Error("a secção #visita-nos não está no DOM");
  return encontrada;
}

/** O `<p>` que vem logo a seguir ao `<h3>` «Horário». */
function linhaDoMomento(container: HTMLElement): HTMLElement {
  const titulo = within(seccao(container)).getByRole("heading", {
    name: T.tituloDoHorario,
    level: 3,
  });
  const linha = titulo.nextElementSibling;
  if (linha === null || linha.tagName !== "P") {
    throw new Error("a linha do momento (um <p>) devia vir logo a seguir ao <h3> «Horário»");
  }
  return linha as HTMLElement;
}

function tabela(container: HTMLElement): HTMLTableElement {
  return within(seccao(container)).getByRole("table", { name: T.legendaDaTabela });
}

function linhasDaTabela(container: HTMLElement): HTMLTableRowElement[] {
  return [...tabela(container).querySelectorAll("tr")];
}

function etiquetas(container: HTMLElement): string[] {
  return [...seccao(container).querySelectorAll("dt")].map((dt) => dt.textContent);
}

function ligacao(container: HTMLElement, nome: string | RegExp): HTMLAnchorElement {
  return within(seccao(container)).getByRole("link", { name: nome });
}

describe("onde a secção vive (2.1, 3)", () => {
  it("é uma <section id=visita-nos> com aria-labelledby no <h2> «Visita-nos»", () => {
    const { container } = desenhar(pronto(infoCompleta()));

    const s = seccao(container);
    const h2 = within(s).getByRole("heading", { level: 2, name: T.titulo });

    expect(h2.id).toBe(ID_DO_TITULO);
    expect(s.getAttribute("aria-labelledby")).toBe(ID_DO_TITULO);
    expect(s.getAttribute("aria-busy")).not.toBe("true");
  });

  it("dois cartões, ambos superficie-painel, nunca creme; <h2> > <h3>, sem saltos", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const s = seccao(container);

    const titulos = [...s.querySelectorAll("h2, h3, h4")].map(
      (t) => `${t.tagName}:${t.textContent}`,
    );
    expect(titulos).toEqual([
      `H2:${T.titulo}`,
      `H3:${T.tituloDoHorario}`,
      `H3:${T.tituloDosContactos}`,
    ]);

    const cartoes = s.querySelectorAll(".superficie-painel");
    expect(cartoes).toHaveLength(2);
    expect(s.querySelector(".superficie-creme"), "a carta é o único creme").toBeNull();
    expect(within(cartoes[0] as HTMLElement).getByRole("heading", { level: 3 })).toHaveTextContent(
      T.tituloDoHorario,
    );
    expect(within(cartoes[1] as HTMLElement).getByRole("heading", { level: 3 })).toHaveTextContent(
      T.tituloDosContactos,
    );
  });

  it("não desconta o cabeçalho outra vez, nem leva scroll-margin (isso é do <main> e da F3-09)", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const s = seccao(container);

    expect(s.className).not.toMatch(/pt-cabecalho|scroll-m|scroll-mt/);
  });

  it("sem iframe, sem imagem, sem ícone, sem title nem aria-label a repetir o texto", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const s = seccao(container);

    expect(s.querySelector("iframe")).toBeNull();
    expect(s.querySelector("img, svg, picture, canvas, object, embed")).toBeNull();
    expect(s.querySelectorAll("[title]")).toHaveLength(0);
    expect(s.querySelectorAll("[aria-label]")).toHaveLength(0);
  });
});

describe("o horário: a linha do momento e a tabela (5.1, 5.2)", () => {
  it("a linha é um <p> logo a seguir ao <h3>, antes da tabela, e não é região viva", () => {
    const { container } = desenhar(pronto(infoCompleta()));

    const linha = linhaDoMomento(container);

    expect(linha).toHaveTextContent(LINHAS_DO_MOMENTO.ateAsDuas);
    expect(linha.nextElementSibling?.tagName).toBe("TABLE");
    expect(linha.className).toMatch(/text-seccao/);
    expect(linha.className).toMatch(/font-forte/);
    expect(
      seccao(container).querySelector('[aria-live], [role="status"], [role="alert"]'),
    ).toBeNull();
  });

  it("a tabela tem legenda só para o leitor de ecrã e sete linhas, de segunda a domingo", () => {
    const { container } = desenhar(pronto(infoCompleta()), { momento: MOMENTOS.dom12h00 });

    const t = tabela(container);
    const legenda = t.querySelector("caption");

    expect(legenda?.textContent).toBe(T.legendaDaTabela);
    expect(legenda?.className).toMatch(/sr-only/);
    expect(t.querySelector("thead")).toBeNull();

    const cabecas = [...t.querySelectorAll("tr > th")];
    expect(cabecas.map((th) => th.textContent)).toEqual([...NOMES_DOS_DIAS_NA_TABELA]);
    expect(cabecas.every((th) => th.getAttribute("scope") === "row")).toBe(true);
    expect(linhasDaTabela(container)).toHaveLength(7);
  });

  it("a ordem é a do contrato, não a do dia de hoje", () => {
    for (const momento of [MOMENTOS.seg12h00, MOMENTOS.qui17h00, MOMENTOS.dom12h00]) {
      const { container, unmount } = desenhar(pronto(infoCompleta()), { momento });

      expect(
        [...tabela(container).querySelectorAll("tr > th")].map((th) => th.textContent),
        momento,
      ).toEqual([...NOMES_DOS_DIAS_NA_TABELA]);
      unmount();
    }
  });

  it("cada período é «{abre} às {fecha}», um por linha de texto, na mesma célula", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const linhas = linhasDaTabela(container);
    const sexta = linhas[4] as HTMLTableRowElement;

    expect(sexta.querySelectorAll("th")).toHaveLength(1);
    const celula = sexta.querySelector("td") as HTMLTableCellElement;
    const periodos = [...celula.querySelectorAll("span.block")];

    expect(periodos.map((p) => p.textContent)).toEqual(["12:00 às 15:00", "19:00 às 02:00"]);
    expect(celula.className).toMatch(/text-right/);
    expect(celula.outerHTML).toMatch(/tabular-nums/);

    // Um dia com um só período também vai num <span class="block">, e o período que
    // passa da meia-noite não leva anotação.
    const terca = linhas[1]?.querySelector("td") as HTMLTableCellElement;
    expect(terca.textContent).toBe("17:00 às 02:00");
    expect(terca.textContent).not.toMatch(/seguinte|\(|-|–/);
  });

  it("um dia sem períodos é «Fechado» em text-texto-suave, e só esses", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const linhas = linhasDaTabela(container);

    for (const indice of [0, 6]) {
      const celula = linhas[indice]?.querySelector("td") as HTMLTableCellElement;
      expect(celula.textContent).toBe(T.fechado);
      expect(`${celula.className} ${celula.innerHTML}`).toMatch(/text-texto-suave/);
    }
    expect(linhas[1]?.querySelector("td")?.innerHTML).not.toMatch(/text-texto-suave/);
  });

  it("na tabela a meia-noite mantém-se «00:00»; na linha do momento diz-se «meia-noite»", () => {
    const horario = semanaDeTeste({ terca: [["17:00", "00:00"]] });
    const { container } = desenhar(pronto(infoCom({ horario })), { momento: MOMENTOS.ter23h30 });

    expect(linhaDoMomento(container)).toHaveTextContent(LINHAS_DO_MOMENTO.ateAMeiaNoite);
    expect(linhasDaTabela(container)[1]?.querySelector("td")).toHaveTextContent("17:00 às 00:00");
  });

  it("separadores: border-t entre linhas, nunca no topo da primeira", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const linhas = linhasDaTabela(container);

    expect(linhas[0]?.className).not.toMatch(/border-t/);
    for (const linha of linhas.slice(1)) {
      expect(linha.className).toMatch(/border-t/);
      expect(linha.className).toMatch(/border-fio-interno/);
    }
  });

  it("a tabela não tem nada focável", () => {
    const { container } = desenhar(pronto(infoCompleta()));

    expect(
      tabela(container).querySelectorAll("a, button, input, select, textarea, [tabindex]"),
    ).toHaveLength(0);
  });

  describe("a linha do momento, com relógio fixo (critério 1)", () => {
    it.each([
      ["quarta 23:00", MOMENTOS.qua23h00, LINHAS_DO_MOMENTO.ateAsDuas],
      ["quinta 01:30", MOMENTOS.qui01h30, LINHAS_DO_MOMENTO.ateAsDuas],
      ["quinta 02:00 em ponto", MOMENTOS.qui02h00, LINHAS_DO_MOMENTO.fechadoAbreHoje],
      ["quinta 17:00 em ponto", MOMENTOS.qui17h00, LINHAS_DO_MOMENTO.ateAsDuas],
      ["quinta 16:59", MOMENTOS.qui16h59, LINHAS_DO_MOMENTO.fechadoAbreHoje],
      ["domingo 01:30", MOMENTOS.dom01h30, LINHAS_DO_MOMENTO.ateAsDuas],
      ["domingo 12:00", MOMENTOS.dom12h00, "Fechado · Abre na terça às 17:00"],
      ["segunda 12:00", MOMENTOS.seg12h00, LINHAS_DO_MOMENTO.fechadoAbreAmanha],
      ["segunda 00:30 (domingo em UTC)", MOMENTOS.seg00h30, LINHAS_DO_MOMENTO.fechadoAbreAmanha],
      ["terça 10:00", MOMENTOS.ter10h00, LINHAS_DO_MOMENTO.fechadoAbreHoje],
      ["quarta 00:30 (terça em UTC)", MOMENTOS.qua00h30, LINHAS_DO_MOMENTO.ateAsDuas],
      ["quarta 23:00 de dezembro", MOMENTOS.invernoQua23h00, LINHAS_DO_MOMENTO.ateAsDuas],
    ])("horário padrão, %s → «%s»", (_nome, momento, texto) => {
      const { container } = desenhar(pronto(infoCom({ horario: horarioPadrao() })), { momento });

      expect(linhaDoMomento(container).textContent).toBe(texto);
    });

    it("fecho à 01:00 → «até à 01:00»; fecho às 00:00 → «até à meia-noite»", () => {
      const umaHora = desenhar(
        pronto(infoCom({ horario: semanaDeTeste({ terca: [["17:00", "01:00"]] }) })),
        { momento: MOMENTOS.ter23h00 },
      );
      expect(linhaDoMomento(umaHora.container).textContent).toBe(LINHAS_DO_MOMENTO.ateAUma);
      umaHora.unmount();

      const meiaNoite = desenhar(
        pronto(infoCom({ horario: semanaDeTeste({ terca: [["17:00", "00:00"]] }) })),
        { momento: MOMENTOS.ter23h30 },
      );
      expect(linhaDoMomento(meiaNoite.container).textContent).toBe(LINHAS_DO_MOMENTO.ateAMeiaNoite);
    });

    it("17:00–00:00 e 00:00–02:00 no dia seguinte: uma só cadeia «até às 02:00»", () => {
      const horario = semanaDeTeste({ terca: [["17:00", "00:00"]], quarta: [["00:00", "02:00"]] });
      const { container } = desenhar(pronto(infoCom({ horario })), { momento: MOMENTOS.ter23h30 });

      expect(linhaDoMomento(container).textContent).toBe(LINHAS_DO_MOMENTO.ateAsDuas);
    });

    it("dois períodos num dia: às 16:00 «Fechado · Abre hoje às 19:00»", () => {
      const { container } = desenhar(pronto(infoCompleta()), { momento: MOMENTOS.sex16h00 });

      expect(linhaDoMomento(container).textContent).toBe("Fechado · Abre hoje às 19:00");
    });

    it("só abre às terças das 12:00 às 15:00: «próxima terça» na terça, «na terça» na quarta", () => {
      const horario = semanaDeTeste({ terca: [["12:00", "15:00"]] });

      const naTerca = desenhar(pronto(infoCom({ horario })), { momento: MOMENTOS.ter16h00 });
      expect(linhaDoMomento(naTerca.container).textContent).toBe(
        "Fechado · Abre na próxima terça às 12:00",
      );
      naTerca.unmount();

      const naQuarta = desenhar(pronto(infoCom({ horario })), { momento: MOMENTOS.qua12h00 });
      expect(linhaDoMomento(naQuarta.container).textContent).toBe(
        "Fechado · Abre na terça às 12:00",
      );
    });
  });

  describe("o destaque do dia (5.2)", () => {
    function atuais(container: HTMLElement): HTMLElement[] {
      return [...seccao(container).querySelectorAll<HTMLElement>("[aria-current]")];
    }

    it.each([
      ["quinta 17:00: o próprio dia", MOMENTOS.qui17h00, "Quinta-feira"],
      ["quinta 01:30: o período de quarta ainda decorre", MOMENTOS.qui01h30, "Quarta-feira"],
      ["domingo 01:30: o de sábado", MOMENTOS.dom01h30, "Sábado"],
      ["segunda 12:00: sem período, o dia civil", MOMENTOS.seg12h00, "Segunda-feira"],
      ["quinta 02:00: acabou, passa a quinta", MOMENTOS.qui02h00, "Quinta-feira"],
      ["segunda 00:30 (domingo em UTC)", MOMENTOS.seg00h30, "Segunda-feira"],
    ])("%s → %s", (_nome, momento, dia) => {
      const { container } = desenhar(pronto(infoCom({ horario: horarioPadrao() })), { momento });

      const marcados = atuais(container);
      expect(marcados).toHaveLength(1);
      expect(marcados[0]?.tagName).toBe("TR");
      expect(marcados[0]?.getAttribute("aria-current")).toBe("date");
      expect(marcados[0]?.querySelector("th")?.textContent).toBe(dia);
    });

    it("as duas células do dia levam font-forte, e as outras linhas não", () => {
      const { container } = desenhar(pronto(infoCompleta()), { momento: MOMENTOS.qui17h00 });

      for (const linha of linhasDaTabela(container)) {
        const destacada = linha.getAttribute("aria-current") === "date";
        for (const celula of linha.querySelectorAll("th, td")) {
          expect(
            /\bfont-forte\b/.test(celula.className),
            `${linha.textContent ?? ""} (${destacada ? "destacada" : "normal"})`,
          ).toBe(destacada);
        }
      }
    });

    it("o destaque é peso, não cor: nenhuma classe de cor nova na linha de hoje", () => {
      const { container } = desenhar(pronto(infoCompleta()), { momento: MOMENTOS.qui17h00 });
      const hoje = seccao(container).querySelector('[aria-current="date"]') as HTMLElement;

      expect(hoje.outerHTML).not.toMatch(/acao|dourado|latao|bg-|border-l|border-b/);
    });
  });
});

describe("`horario: null` não é «Fechado» (critério 2, 4.4)", () => {
  it("some só o bloco do horário: sem <h3>, sem linha, sem tabela, sem a palavra «Fechado»", () => {
    const { container } = desenhar(
      pronto(infoCom({ morada: MORADA_DE_TESTE, telefone: TELEFONE_DE_TESTE, horario: null })),
    );
    const s = seccao(container);

    expect(within(s).queryByRole("heading", { name: T.tituloDoHorario })).toBeNull();
    expect(within(s).queryByRole("table")).toBeNull();
    expect(s.querySelector("p")).toBeNull();
    expect(s.textContent).not.toMatch(/fechado|aberto|abre /i);
    expect(within(s).getByRole("heading", { name: T.tituloDosContactos })).toBeInTheDocument();
    expect(s.querySelectorAll(".superficie-painel")).toHaveLength(1);
  });

  it("sete dias vazios são uma afirmação do dono: «Fechado» na linha e nas sete linhas", () => {
    const { container } = desenhar(pronto(infoCom({ horario: horarioFechadoASemanaToda() })));

    expect(linhaDoMomento(container).textContent).toBe(LINHAS_DO_MOMENTO.fechadoSo);
    const celulas = [...tabela(container).querySelectorAll("td")];
    expect(celulas).toHaveLength(7);
    expect(celulas.every((td) => td.textContent === T.fechado)).toBe(true);
    // A secção existe só com o horário: não há segundo cartão.
    expect(seccao(container).querySelectorAll(".superficie-painel")).toHaveLength(1);
  });

  it("só o horário: um cartão, sem «Morada e contactos» nem <dl>", () => {
    const { container } = desenhar(pronto(infoCom({ horario: horarioPadrao() })));
    const s = seccao(container);

    expect(within(s).queryByRole("heading", { name: T.tituloDosContactos })).toBeNull();
    expect(s.querySelector("dl")).toBeNull();
    expect(s.querySelectorAll(".superficie-painel")).toHaveLength(1);
  });
});

describe("a secção só existe com o que mostrar (critério 3, 4.4)", () => {
  it.each([
    ["tudo a null", infoVazia()],
    [
      "tudo vazio ou só espaços",
      infoCom({ morada: "", telefone: "   ", instagram: " ", maps_url: "\n" }),
    ],
    [
      "tudo inválido",
      infoCom({
        maps_url: "javascript:alert(1)",
        instagram: "https://evil.com/bar",
        morada: "  \t ",
        telefone: "",
      }),
    ],
    ["maps http", infoCom({ maps_url: "http://exemplo.test/x" })],
    ["instagram como @nome", infoCom({ instagram: "@bar_exemplo" })],
    [
      "instagram de outro anfitrião parecido",
      infoCom({ instagram: "https://instagram.com.evil.pt/x" }),
    ],
  ])("%s: a secção não está no DOM (nem <h2>, nem espaço)", (_nome, info) => {
    const { container } = desenhar(pronto(info));

    expect(screen.queryByRole("heading", { name: T.titulo })).toBeNull();
    expect(container.querySelector("section")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it.each([
    [{ morada: MORADA_DE_TESTE }, [T.etiquetaMorada]],
    [{ telefone: TELEFONE_DE_TESTE }, [T.etiquetaTelefone]],
    [{ instagram: INSTAGRAM_DE_TESTE }, [T.etiquetaInstagram]],
    [{ maps_url: MAPS_DE_TESTE }, [T.etiquetaLocalizacao]],
    [
      { morada: MORADA_DE_TESTE, telefone: TELEFONE_DE_TESTE },
      [T.etiquetaMorada, T.etiquetaTelefone],
    ],
    [
      { morada: MORADA_DE_TESTE, instagram: INSTAGRAM_DE_TESTE },
      [T.etiquetaMorada, T.etiquetaInstagram],
    ],
    [
      { morada: MORADA_DE_TESTE, telefone: TELEFONE_DE_TESTE, instagram: INSTAGRAM_DE_TESTE },
      [T.etiquetaMorada, T.etiquetaTelefone, T.etiquetaInstagram],
    ],
    [{ morada: MORADA_DE_TESTE, maps_url: MAPS_DE_TESTE }, [T.etiquetaMorada]],
    [
      {
        telefone: TELEFONE_DE_TESTE,
        maps_url: "javascript:alert(1)",
        instagram: "https://evil.com/x",
      },
      [T.etiquetaTelefone],
    ],
  ])("com %j só aparecem as etiquetas %j, cada uma com o seu valor", (campos, esperadas) => {
    const { container } = desenhar(pronto(infoCom(campos)));
    const s = seccao(container);

    expect(etiquetas(container)).toEqual(esperadas);
    // Sem etiqueta órfã: cada <dt> tem um <dd> com algo dentro, logo a seguir.
    for (const dt of s.querySelectorAll("dt")) {
      const dd = dt.nextElementSibling;
      expect(dd?.tagName).toBe("DD");
      expect(dd?.textContent?.trim()).not.toBe("");
    }
    expect(s.textContent).not.toMatch(/não disponível|n\/d|indisponível|sem morada|sem telefone/i);
    expect(s.querySelectorAll(".superficie-painel")).toHaveLength(1);
  });

  it("com tudo, os pares vêm por esta ordem: Morada, Telefone, Instagram", () => {
    const { container } = desenhar(pronto(infoCompleta()));

    expect(etiquetas(container)).toEqual([
      T.etiquetaMorada,
      T.etiquetaTelefone,
      T.etiquetaInstagram,
    ]);
    const dl = seccao(container).querySelector("dl") as HTMLElement;
    for (const dt of dl.querySelectorAll("dt")) {
      expect(dt.className).toMatch(/text-nota/);
      expect(dt.className).toMatch(/text-texto-suave/);
    }
    for (const dd of dl.querySelectorAll("dd")) {
      expect(dd.className).toMatch(/text-corpo/);
      expect(dd.className).not.toMatch(/overflow-hidden/);
    }
  });
});

describe("a morada (6.1)", () => {
  it("o texto tal como veio, com as quebras de linha, sem «Como chegar» nem pino", () => {
    const { container } = desenhar(pronto(infoCom({ morada: MORADA_DE_TESTE })));
    const morada = seccao(container).querySelector(".whitespace-pre-line") as HTMLElement;

    expect(morada.textContent).toBe(MORADA_DE_TESTE);
    expect(morada.className).toMatch(
      /\[overflow-wrap:anywhere\]|break-words|break-all|\[word-break/,
    );
    expect(seccao(container).textContent).not.toMatch(/como chegar/i);
  });
});

describe("Abrir no Google Maps (6.2, critério 5)", () => {
  it("https válido: uma ligação com o href igual, no mesmo separador, sem rel", () => {
    const { container } = desenhar(
      pronto(infoCom({ morada: MORADA_DE_TESTE, maps_url: MAPS_DE_TESTE })),
    );
    const botao = ligacao(container, T.abrirNoMaps);

    expect(botao.getAttribute("href")).toBe(MAPS_DE_TESTE);
    expect(botao.hasAttribute("target")).toBe(false);
    expect(botao.hasAttribute("rel")).toBe(false);
  });

  it("vem depois do texto da morada, dentro do mesmo par", () => {
    const { container } = desenhar(
      pronto(infoCom({ morada: MORADA_DE_TESTE, maps_url: MAPS_DE_TESTE })),
    );
    const botao = ligacao(container, T.abrirNoMaps);
    const dd = botao.closest("dd") as HTMLElement;
    const morada = dd.querySelector(".whitespace-pre-line") as HTMLElement;

    expect(dd.previousElementSibling?.textContent).toBe(T.etiquetaMorada);
    expect(morada.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("tem o aspeto do Botão secundário (contorno, texto creme), nunca dourado, e 44 px de altura mínima", () => {
    const { container } = desenhar(pronto(infoCom({ maps_url: MAPS_DE_TESTE })));
    const botao = ligacao(container, T.abrirNoMaps);

    expect(botao.className).toMatch(/\bborder\b/);
    expect(botao.className).toMatch(/border-contorno/);
    expect(botao.className).toMatch(/text-texto\b/);
    expect(botao.className).not.toMatch(/bg-acao|text-sobre-acao|dourado|latao/);
    expect(botao.className).toMatch(/\bmin-h-(alvo-)?toque\b/);
    expect(botao.className).not.toMatch(/\bw-full\b|\bw-screen\b/);
  });

  it("sem morada mas com Maps: o par chama-se «Localização» e só tem o botão", () => {
    const { container } = desenhar(pronto(infoCom({ maps_url: MAPS_DE_TESTE })));
    const botao = ligacao(container, T.abrirNoMaps);

    expect(etiquetas(container)).toEqual([T.etiquetaLocalizacao]);
    expect(botao.closest("dd")?.textContent).toBe(T.abrirNoMaps);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "http://exemplo.test/mapa",
    "tel:+351912345678",
    " https://exemplo.test/x",
    "https://user@exemplo.test/x",
    "https:///x",
    "não é um endereço",
  ])("«%s» não dá botão", (url) => {
    const { container } = desenhar(pronto(infoCom({ morada: MORADA_DE_TESTE, maps_url: url })));

    expect(within(seccao(container)).queryByRole("link", { name: T.abrirNoMaps })).toBeNull();
    expect(seccao(container).querySelector("a")).toBeNull();
  });
});

describe("o telefone (6.3, critério 5)", () => {
  it.each([
    ["234 123 456", "tel:234123456"],
    ["+351 234 123 456", "tel:+351234123456"],
    ["912 345 678", "tel:912345678"],
    ["00351 234 123 456", "tel:+351234123456"],
  ])("«%s» é a ligação %s, e a ligação é a linha inteira, com o texto original", (texto, href) => {
    const { container } = desenhar(pronto(infoCom({ telefone: texto })));
    const a = ligacao(container, texto);
    const dd = a.closest("dd") as HTMLElement;

    expect(a.getAttribute("href")).toBe(href);
    expect(a.textContent).toBe(texto);
    expect(dd.textContent).toBe(texto);
    expect(a.hasAttribute("target")).toBe(false);
    expect(a.className).toMatch(/\binline-flex\b/);
    expect(a.className).toMatch(/\bmin-h-(alvo-)?toque\b/);
    expect(a.className).toMatch(/\bitems-center\b/);
    expect(a.className).toMatch(/\bunderline\b/);
    expect(a.className).toMatch(/underline-offset-2/);
    expect(`${a.className} ${a.innerHTML}`).toMatch(/tabular-nums/);
  });

  it.each(["Pergunta no balcão", "liga-nos", "234 123 456 (chamada para a rede fixa)", "12345678"])(
    "«%s» é só texto, sem ligação, exatamente como o dono o escreveu",
    (texto) => {
      const { container } = desenhar(pronto(infoCom({ telefone: texto })));
      const s = seccao(container);

      expect(s.querySelector("a")).toBeNull();
      expect(s.querySelector("dd")?.textContent).toBe(texto);
    },
  );

  it("<script> no telefone é texto: nada se executa e nada se liga", () => {
    const perigo = "<script>alert(1)</script>";
    const { container } = desenhar(pronto(infoCom({ telefone: perigo })));

    expect(container.querySelector("script")).toBeNull();
    expect(seccao(container).querySelector("a")).toBeNull();
    expect(seccao(container).querySelector("dd")?.textContent).toBe(perigo);
  });
});

describe("o Instagram (6.4, critério 5)", () => {
  it.each([
    ["https://www.instagram.com/bar_tomazia/", "@bar_tomazia"],
    ["https://instagram.com/bar.exemplo", "@bar.exemplo"],
    ["https://instagram.com/p/xyz", T.verNoInstagram],
    ["https://instagram.com/", T.verNoInstagram],
    ["https://instagram.com/reel/abc", T.verNoInstagram],
    ["https://instagram.com/explore", T.verNoInstagram],
  ])("%s → ligação «%s», no mesmo separador", (url, rotulo) => {
    const { container } = desenhar(pronto(infoCom({ instagram: url })));
    const a = ligacao(container, rotulo);

    expect(a.getAttribute("href")).toBe(url);
    expect(a.hasAttribute("target")).toBe(false);
    expect(a.hasAttribute("rel")).toBe(false);
    expect(a.className).toMatch(/\bmin-h-(alvo-)?toque\b/);
    expect(a.className).toMatch(/\bunderline\b/);
    expect(a.className).toMatch(/underline-offset-2/);
    expect(a.closest("dd")?.previousElementSibling?.textContent).toBe(T.etiquetaInstagram);
  });

  it.each([
    "https://evil.com/bar",
    "https://instagram.com.evil.pt/bar",
    "https://evil.pt/instagram.com",
    "http://instagram.com/bar",
  ])("«%s» deixa o par ausente (conta como vazio, sem «ligação inválida»)", (url) => {
    const { container } = desenhar(
      pronto(infoCom({ instagram: url, telefone: TELEFONE_DE_TESTE })),
    );

    expect(etiquetas(container)).toEqual([T.etiquetaTelefone]);
    expect(within(seccao(container)).queryByText(T.etiquetaInstagram)).toBeNull();
    expect(seccao(container).textContent).not.toMatch(/inválid|evil/i);
  });
});

describe("a ordem de tabulação (2.2, critério 8)", () => {
  const FOCAVEIS = "a[href], button, input, select, textarea, summary, [tabindex]";

  it("Maps, telefone, Instagram: é a ordem do DOM e não há nada mais focável", () => {
    const { container } = desenhar(pronto(infoCompleta()));
    const focaveis = [...seccao(container).querySelectorAll<HTMLElement>(FOCAVEIS)];

    expect(focaveis.map((el) => el.getAttribute("href"))).toEqual([
      MAPS_DE_TESTE,
      "tel:912345678",
      INSTAGRAM_DE_TESTE,
    ]);
    expect(focaveis.some((el) => el.hasAttribute("tabindex"))).toBe(false);
  });

  it("o telefone como texto sai da ordem: ficam o Maps e o Instagram", () => {
    const { container } = desenhar(pronto({ ...infoCompleta(), telefone: "Pergunta no balcão" }));
    const focaveis = [...seccao(container).querySelectorAll<HTMLElement>(FOCAVEIS)];

    expect(focaveis.map((el) => el.getAttribute("href"))).toEqual([
      MAPS_DE_TESTE,
      INSTAGRAM_DE_TESTE,
    ]);
  });

  it("nenhuma ligação leva target (mesmo separador, decisão do Tomás)", () => {
    const { container } = desenhar(pronto(infoCompleta()));

    expect(seccao(container).querySelectorAll("a[target]")).toHaveLength(0);
    expect(seccao(container).querySelectorAll("a")).toHaveLength(3);
  });
});

describe("sem dourado nem verde/vermelho (3, critério 9)", () => {
  it.each([
    ["pronto e aberto", pronto(infoCompleta()), MOMENTOS.qui17h00],
    ["pronto e fechado", pronto(infoCompleta()), MOMENTOS.seg12h00],
    ["a carregar", A_CARREGAR, MOMENTOS.qui17h00],
  ])("nenhuma classe de ação, dourado ou latão em %s", (_nome, estado, momento) => {
    const { container } = desenhar(estado, { momento });
    const classes = [...seccao(container).querySelectorAll("[class]")]
      .map((el) => el.getAttribute("class") ?? "")
      .join(" ");

    expect(classes.length, "guarda: não li classe nenhuma").toBeGreaterThan(0);
    expect(classes).not.toMatch(/acao|dourado|latao/);
    expect(classes).not.toMatch(/(text|bg|border)-(green|red|emerald|rose|lime|sucesso)/);
  });

  it("a linha do momento é texto: sem cor de estado, «Aberto»/«Fechado» são palavras", () => {
    const { container } = desenhar(pronto(infoCompleta()), { momento: MOMENTOS.qui17h00 });
    const linha = linhaDoMomento(container);

    expect(linha.className).toMatch(/text-texto\b/);
    expect(linha.className).not.toMatch(/acao|erro|sucesso|green|red/);
  });
});

describe("a carregar (4.1)", () => {
  it("o <h2> e dois esqueletos, sem texto, sem «Fechado», com aria-busy", () => {
    const { container } = desenhar(A_CARREGAR);
    const s = seccao(container);

    expect(within(s).getByRole("heading", { level: 2, name: T.titulo })).toBeInTheDocument();
    expect(s.getAttribute("aria-busy")).toBe("true");
    expect(s.textContent).toBe(T.titulo);
    expect(s.textContent).not.toMatch(/fechado|aberto|a carregar|carregar…/i);

    const cartoes = [...s.querySelectorAll(".superficie-painel")];
    expect(cartoes).toHaveLength(2);
    // Primeiro cartão: a linha do momento (21 px) e os sete dias (17 px). Segundo: três pares.
    expect(cartoes[0]?.querySelectorAll(".bg-fio-interno")).toHaveLength(8);
    expect(cartoes[1]?.querySelectorAll(".bg-fio-interno")).toHaveLength(6);
  });

  it("as barras são rounded-pequeno, aria-hidden e sem animação; nada é focável nem lido", () => {
    const { container } = desenhar(A_CARREGAR);
    const s = seccao(container);
    const barras = [...s.querySelectorAll<HTMLElement>(".bg-fio-interno")];

    for (const barra of barras) {
      expect(barra.className).toMatch(/rounded-pequeno/);
      expect(barra.closest('[aria-hidden="true"]'), barra.className).not.toBeNull();
    }
    expect(s.innerHTML).not.toMatch(/animate-|transition|motion-/);
    expect(s.querySelector("a, button, table, dl, [aria-live]")).toBeNull();
    expect(s.querySelectorAll("h3")).toHaveLength(0);
  });
});

describe("falhou (4.2, critério 4)", () => {
  it("o <h2> fica, com o título do erro (tom erro) e a linha de «sem resposta»", () => {
    const { container } = desenhar(falhou(null));
    const s = seccao(container);

    expect(within(s).getByRole("heading", { level: 2, name: T.titulo })).toBeInTheDocument();
    const titulo = within(s).getByRole("heading", { level: 3, name: T.erroTitulo });
    expect(titulo.className).toMatch(/text-erro/);
    expect(within(s).getByText(T.erroSemResposta)).toBeInTheDocument();
    expect(within(s).queryByText(T.erroComResposta)).toBeNull();
    expect(s.getAttribute("aria-busy")).not.toBe("true");
  });

  it.each([500, 502, 404, 429])(
    "com o servidor a responder (%i) a linha é «o problema é nosso»",
    (http) => {
      const { container } = desenhar(falhou(http));
      const s = seccao(container);

      expect(within(s).getByText(T.erroComResposta)).toBeInTheDocument();
      expect(within(s).queryByText(T.erroSemResposta)).toBeNull();
      expect(within(s).getByRole("heading", { level: 3, name: T.erroTitulo })).toBeInTheDocument();
    },
  );

  it("não afirma nada sobre o bar: sem «Fechado», sem horário, sem tabela, sem contactos", () => {
    const { container } = desenhar(falhou(500));
    const s = seccao(container);

    expect(s.textContent).not.toMatch(/fechado|aberto|abre /i);
    expect(s.querySelector("table, dl, a")).toBeNull();
    expect(within(s).queryByRole("heading", { name: T.tituloDoHorario })).toBeNull();
    expect(within(s).queryByRole("heading", { name: T.tituloDosContactos })).toBeNull();
  });

  it("a única paragem é «Tentar outra vez», com 44 px", () => {
    const { container } = desenhar(falhou(null));
    const focaveis = seccao(container).querySelectorAll<HTMLElement>("a, button, [tabindex]");
    const botao = within(seccao(container)).getByRole("button", { name: T.tentarOutraVez });

    expect([...focaveis]).toEqual([botao]);
    expect(botao.className).toMatch(/\bmin-h-(alvo-)?toque\b/);
    expect(botao.className).not.toMatch(/bg-acao/);
  });

  it("«Tentar outra vez» chama aoTentarOutraVez uma vez; enquanto dura diz «A tentar…»", async () => {
    let acabar: () => void = () => undefined;
    const { container, aoTentarOutraVez } = desenhar(falhou(null), {
      aoTentarOutraVez: () =>
        new Promise<void>((cumprir) => {
          acabar = cumprir;
        }),
    });
    const botao = within(seccao(container)).getByRole("button", { name: T.tentarOutraVez });

    fireEvent.click(botao);

    expect(aoTentarOutraVez).toHaveBeenCalledTimes(1);
    const aTentar = within(seccao(container)).getByRole("button", { name: T.aTentar });
    expect(aTentar.getAttribute("aria-busy")).toBe("true");
    // «aria-disabled» (4.2) não se exige: a ementa, os eventos e a galeria usam só `aTrabalhar` do Botão (aria-busy).
    expect(aTentar.hasAttribute("disabled"), "nunca `disabled`: o foco não se perde").toBe(false);

    // Nada de esqueleto nem de secção a piscar enquanto tenta.
    expect(seccao(container).getAttribute("aria-busy")).not.toBe("true");
    expect(within(seccao(container)).getByText(T.erroTitulo)).toBeInTheDocument();

    // Um segundo toque durante a tentativa não repete o pedido.
    fireEvent.click(aTentar);
    expect(aoTentarOutraVez).toHaveBeenCalledTimes(1);

    await act(async () => {
      acabar();
      await Promise.resolve();
    });

    // Falhou outra vez: tudo igual, sem mensagem a dobrar, o botão volta ao que era.
    expect(within(seccao(container)).getAllByText(T.erroTitulo)).toHaveLength(1);
    expect(within(seccao(container)).getAllByText(T.erroSemResposta)).toHaveLength(1);
    expect(
      within(seccao(container)).getByRole("button", { name: T.tentarOutraVez }),
    ).toBeInTheDocument();
  });

  it("quando a tentativa dá certo o foco não se move para a secção (4.2)", async () => {
    const { container, rerender, aoTentarOutraVez } = desenhar(falhou(500));
    const botao = within(seccao(container)).getByRole("button", { name: T.tentarOutraVez });
    botao.focus();

    fireEvent.click(botao);
    await act(async () => {
      await Promise.resolve();
    });
    rerender(<VisitaNos info={pronto(infoCompleta())} aoTentarOutraVez={aoTentarOutraVez} />);

    const s = seccao(container);
    expect(s.contains(document.activeElement), "o foco foi levado para dentro da secção").toBe(
      false,
    );
    expect(s.querySelector("[tabindex]")).toBeNull();
    expect(s.querySelector("[autofocus]")).toBeNull();
  });
});

describe("os quatro estados têm quatro DOMs (regra 10)", () => {
  it("a carregar, falhou, por configurar e pronto nunca se confundem", () => {
    const html = new Map<string, string>();

    for (const [nome, estado] of [
      ["a carregar", A_CARREGAR],
      ["falhou", falhou(null)],
      ["por configurar", pronto(infoVazia())],
      ["pronto", pronto(infoCompleta())],
    ] as const) {
      const { container, unmount } = desenhar(estado);
      html.set(nome, container.innerHTML);
      unmount();
    }

    expect(new Set(html.values()).size).toBe(4);
    // Só o «por configurar» deixa a página sem a secção: os outros três têm o <h2>.
    expect(html.get("por configurar")).toBe("");
    for (const nome of ["a carregar", "falhou", "pronto"]) {
      expect(html.get(nome), nome).toContain(`>${T.titulo}<`);
    }
  });

  it("«Fechado» só aparece onde o dono o disse", () => {
    const comFechado: string[] = [];

    for (const [nome, estado] of [
      ["a carregar", A_CARREGAR],
      ["falhou", falhou(500)],
      ["por configurar", pronto(infoVazia())],
      ["horário null com contactos", pronto(infoCom({ telefone: TELEFONE_DE_TESTE }))],
    ] as const) {
      const { container, unmount } = desenhar(estado);
      if (/fechado/i.test(container.textContent)) comFechado.push(nome);
      unmount();
    }

    expect(comFechado).toEqual([]);
  });
});

describe("texto português de Portugal, sem setas nem emoji (Q-05)", () => {
  it.each([
    ["aberto", pronto(infoCompleta()), MOMENTOS.qui17h00],
    ["fechado", pronto(infoCompleta()), MOMENTOS.seg12h00],
    ["erro", falhou(500), MOMENTOS.qui17h00],
  ])("em %s a secção não tem «—», «→» nem emoji", (_nome, estado, momento) => {
    const { container } = desenhar(estado, { momento });
    const texto = seccao(container).textContent;

    expect(texto.length).toBeGreaterThan(0);
    expect(texto).not.toMatch(/—|→|\p{Extended_Pictographic}/u);
    expect(texto).not.toMatch(/cardápio|arquivo|deletar/i);
  });
});
