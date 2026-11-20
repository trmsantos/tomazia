/**
 * F3-04, 12.2 — a secção dos próximos eventos, com um cliente falso.
 *
 * Contrato que este ficheiro define e que `Eventos.tsx` tem de cumprir:
 *
 * ```tsx
 * export function Eventos(): ReactElement | null
 * ```
 *
 * Desenha a `<section id="eventos" aria-labelledby="titulo-eventos">` inteira
 * (3): o `<h2>`, a `<ul>` com um `<li>` por evento, a linha de 7.2 e, no
 * caminho falhado, o `EstadoVazio` em `tom="erro"` com o "Tentar outra vez".
 * Vai buscar os dados sozinha a `obterEventos()` ao montar — o pedido é desta
 * secção e não do `App.tsx` (8.1).
 *
 * **O que este ficheiro prova:** os cinco estados de 8, incluindo os dois que
 * a regra 10 obriga a separar (sem eventos a secção some, pedido falhado a
 * secção aparece); o corte nos três e a linha dos excedentes; que o nome
 * acessível do `<h3>` traz a data, a hora e o nome (4.3); que as palavras da
 * data se calculam **no browser contra o relógio** e não vêm da resposta
 * (5.5); que o cartaz só existe quando há `imagem`, com `alt` igual ao título
 * (6.4), e que a caixa sai do cartão quando a imagem falha (6.3); e que a
 * secção não acrescenta paragens de `Tab` ao caminho normal, e acrescenta
 * exactamente uma no erro (2.2).
 *
 * **O que deixa passar:** tudo o que precisa de layout. Em jsdom não há
 * posição, não há altura, não há proporção e não há imagens a carregar de
 * verdade — a caixa 3:2 pode estar a 1 px de altura e este ficheiro passa, o
 * `<h2>` pode nascer por cima da ementa e este ficheiro passa, e o `error` do
 * `<img>` tem de ser disparado à mão porque o jsdom não vai buscar byte
 * nenhum. Isso é `e2e/eventos.spec.ts`. Deixa passar também a cadeia de
 * caracteres da data em si: aqui ela constrói-se com a mesma função que o
 * componente usa, de propósito (4.3), por isso uma tabela de dias em inglês
 * passava daqui com as duas pontas a dizer "Thursday". Quem a prende é
 * `src/lib/formato/data-do-evento.test.ts` e `src/textos-pt-pt.test.ts`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../../lib/api/cliente";
import type { OpcoesDePedido } from "../../lib/api/cliente";
import { formatarDataDoEvento } from "../../lib/formato/data-do-evento";
import { obterEventos } from "../../lib/api/publico";
import type { Eventos as RespostaDosEventos } from "../../lib/api/publico";
import {
  AGORA,
  CARTAZ_DE_TESTE,
  COM_E_SEM_CARTAZ,
  EVENTO_DE_HOJE,
  EVENTO_DE_HOJE_JA_COMECADO,
  ID_DA_SECCAO,
  ID_DO_TITULO,
  PASSAGEM_DE_ANO,
  QUATRO_EVENTOS,
  SAMBA_A_DEZASSETE_DIAS,
  SAMBA_A_QUARENTA_E_CINCO_DIAS,
  SAMBA_A_TRES_DIAS,
  SEM_EVENTOS,
  TEXTOS_DOS_EVENTOS,
  TRES_EVENTOS,
  UM_EVENTO,
  evento,
  resposta,
} from "../../testes/eventos";
import type { EventoPublico } from "../../testes/eventos";
import { Eventos } from "./Eventos";

vi.mock("../../lib/api/publico", () => ({ obterEventos: vi.fn() }));

/**
 * O módulo da data passa **inteiro**, com a função embrulhada num espião.
 *
 * Nada do comportamento muda — o que se ganha é poder fazê-la lançar, que é
 * a única forma de chegar ao caminho de 5.4 sem desmontar o `Intl` do
 * processo a meio de um teste de componente. Mockar o módulo com valores
 * fixos era pior do que inútil: o nome acessível esperado passava a ser
 * escrito à mão, que é precisamente o que 4.3 proíbe.
 */
vi.mock("../../lib/formato/data-do-evento", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../lib/formato/data-do-evento")>();
  return { ...original, formatarDataDoEvento: vi.fn(original.formatarDataDoEvento) };
});

const pedir = vi.mocked(obterEventos);
const formatar = vi.mocked(formatarDataDoEvento);

/** O nome do motivo de um `abort`, ou o motivo em texto quando não tem nome. */
function nomeDaRazao(razao: unknown): string {
  if (typeof razao === "object" && razao !== null && "name" in razao) {
    return String((razao as { name: unknown }).name);
  }
  return String(razao);
}

type PedidoEmCurso = {
  sinal: AbortSignal | undefined;
  resolver: (corpo: RespostaDosEventos) => void;
  rejeitar: (erro: unknown) => void;
};

/**
 * Um `obterEventos` que fica pendurado até o teste mandar.
 *
 * Pendurado e não `mockResolvedValue`, porque metade dos estados de 8 — o
 * "a carregar" e o botão a dizer "A tentar…" — **só existem enquanto o
 * pedido está no ar**. Com uma promessa já cumprida nunca se chega a ver o
 * estado que interessa.
 */
function clienteFalso(): PedidoEmCurso[] {
  const pedidos: PedidoEmCurso[] = [];

  pedir.mockImplementation((opcoes?: OpcoesDePedido) => {
    let resolver: (corpo: RespostaDosEventos) => void = () => undefined;
    let rejeitar: (erro: unknown) => void = () => undefined;
    const promessa = new Promise<RespostaDosEventos>((cumprir, falhar) => {
      resolver = cumprir;
      rejeitar = falhar;
    });

    /*
     * **O falso reage ao `abort`, como o cliente verdadeiro** — e é isso
     * que dá rede ao prazo de 10 s. Um falso que ignorasse o sinal deixava
     * a promessa pendurada para sempre: o temporizador disparava, o sinal
     * abortava, e **nada** chegava ao `.catch`. Apagar o `setTimeout`
     * inteiro do componente passava na mesma, e o sintoma dessa mutação é
     * o pior desta secção — secção invisível, que aqui se lê exactamente
     * como "não há eventos marcados".
     *
     * A tradução é a do `src/lib/api/cliente.ts`: um prazo esgotado chega
     * como `ErroDaApi` **sem estado**, porque não houve resposta nenhuma.
     * Um cancelamento nosso sai cru, que é o que o componente tem de saber
     * distinguir.
     */
    const sinal = opcoes?.sinal;
    sinal?.addEventListener("abort", () => {
      if (nomeDaRazao(sinal.reason) === "TimeoutError") {
        rejeitar(
          new ErroDaApi("O servidor demorou demasiado a responder. Tenta outra vez.", {
            estado: null,
            codigo: null,
          }),
        );
        return;
      }
      rejeitar(sinal.reason);
    });

    pedidos.push({ sinal, resolver, rejeitar });
    return promessa;
  });

  return pedidos;
}

/** Deixa a micro-fila correr: é o que faz o `await` do componente avançar. */
async function deixarAssentar(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Monta, responde com `corpo`, e devolve quando o ecrã já está pintado. */
async function comResposta(corpo: RespostaDosEventos): Promise<RenderResult> {
  const pedidos = clienteFalso();
  const desenho = render(<Eventos />);
  await act(async () => {
    pedidos[0]?.resolver(corpo);
    await Promise.resolve();
  });
  return desenho;
}

/**
 * Monta e falha o pedido. `estado: null` é a rede em baixo; um número é o
 * servidor a responder mal — são as duas metades de 8.2.
 */
async function comFalha(
  estado: number | null,
): Promise<{ desenho: RenderResult; pedidos: PedidoEmCurso[] }> {
  const pedidos = clienteFalso();
  const desenho = render(<Eventos />);
  await act(async () => {
    pedidos[0]?.rejeitar(new ErroDaApi("falhou", { estado, codigo: null }));
    await Promise.resolve();
  });
  return { desenho, pedidos };
}

/** A secção, ou `null` quando ela não existe. Nunca lança. */
function seccao(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#${ID_DA_SECCAO}`);
}

/**
 * O texto todo da secção, para comparar dois estados de erro **inteiros**.
 *
 * Lança quando a secção não existe, em vez de devolver `""`: duas cadeias
 * vazias são iguais uma à outra, e um teste que compare dois ecrãs que não
 * foram desenhados passa a dizer "estes dois são diferentes" sem ter lido
 * nenhum (regra 10).
 */
function textoDaSeccao(): string {
  const regiao = seccao();
  if (regiao === null) {
    throw new Error(
      `não encontrei a <section id="${ID_DA_SECCAO}"> para lhe ler o texto. Isto é ` +
        "uma falha de leitura, e não dois ecrãs de erro a serem diferentes.",
    );
  }
  return regiao.textContent ?? "";
}

/**
 * Tudo o que pára um `Tab` dentro de um elemento.
 *
 * Escrito à mão e não com uma biblioteca de tabulação: o que se quer contar
 * aqui é **zero**, e um seletor que não condiga com nada devolve zero
 * também. Por isso o teste que conta zero confirma, na mesma execução, que
 * o caminho do erro dá um — senão provava-se o seletor e não a secção
 * (regra 10).
 */
function paragensDeTab(dentro: HTMLElement): Element[] {
  return [
    ...dentro.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"),
  ].filter((elemento) => elemento.getAttribute("tabindex") !== "-1");
}

/** O nome acessível que o `<h3>` de um evento tem de ter, por 4.3. */
function cabecalhoEsperado(evento: EventoPublico, agora: Date = AGORA): string {
  const data = formatarDataDoEvento(evento.inicio, agora);
  return `${data.grande} ${data.pequena} ${evento.titulo}`;
}

beforeEach(() => {
  /*
   * O relógio prende-se **antes** de montar seja o que for. O componente lê
   * `new Date()` no render para alimentar a função pura de 5.6, e sem isto
   * cada cartão da fixtura mudava de forma todos os dias: o `d = 3` do samba
   * seria 2 amanhã e 0 na quinta, e este ficheiro falhava uma vez por
   * semana por razões que nada têm a ver com o código.
   */
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  pedir.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a secção existe, ou não existe (8, 13)", () => {
  it("enquanto o pedido está no ar não há secção nenhuma — nem esqueleto", async () => {
    // 8.1: um esqueleto prometia uma secção que, na maior parte dos dias,
    // acaba por desaparecer. A asserção é sobre o **título** e sobre o nó,
    // não sobre uma classe: é a diferença entre não existir e estar
    // invisível, e só a primeira é que não promete nada.
    //
    // Deixa passar: o salto de altura que a chegada dos eventos provoca no
    // que está por baixo. É um preço aceite por escrito em 8.1 e mede-se no
    // browser, não aqui.
    clienteFalso();
    const { container } = render(<Eventos />);
    await deixarAssentar();

    expect(screen.queryByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("sem eventos marcados, a secção desaparece inteira", async () => {
    // O requisito da `TAREFAS.md`, e a primeira metade da regra 10. Repara
    // que o pedido **correu bem**: uma lista vazia é uma resposta, não uma
    // avaria, e o ecrã certo para ela é nenhum ecrã.
    //
    // Deixa passar: os 64 px de respiro entre as secções ficarem lá sem
    // conteúdo. Em jsdom não há altura; quem o apanha é a captura de 12.4.
    const { container } = await comResposta(SEM_EVENTOS);

    expect(screen.queryByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })).toBeNull();
    expect(seccao()).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("com um evento, a secção aparece e não guarda lugar para os outros dois", async () => {
    // Uma grelha de três com duas células vazias dava um cartão e dois
    // buracos. A asserção que o apanha é a contagem de `listitem`: **um**,
    // e não um mais dois vazios.
    await comResposta(UM_EVENTO);

    expect(screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("com o pedido falhado, a secção aparece — com título e com saída", async () => {
    // **O defeito mais provável desta tarefa**, escrito como teste: a secção
    // que some sem eventos a sumir também quando ninguém conseguiu
    // perguntar. As duas metades afirmam-se as duas, porque uma só não
    // separa nada — um componente que devolvesse sempre `null` passava
    // metade deste teste e um que mostrasse sempre a secção passava a outra.
    await comFalha(null);

    expect(screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.erroTitulo }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez }),
      "sem o botão, o ecrã diz que falhou e não diz o que fazer a seguir",
    ).toBeInTheDocument();
  });

  it("«não há eventos» e «não consegui perguntar» não dão o mesmo ecrã", async () => {
    // A regra 10 numa asserção só: os dois caminhos têm de produzir DOM
    // diferente. Está escrito assim, com os dois lados medidos na mesma
    // execução, porque os testes de cima podem passar com a secção a sumir
    // sempre — bastaria que o `getByRole` do erro estivesse a apanhar o
    // título de outro sítio qualquer da página.
    //
    // Deixa passar: os dois ecrãs serem ambos errados, desde que sejam
    // diferentes um do outro. É de propósito: o que cada um tem de ter está
    // nos testes de cima, e aqui prova-se só que não colapsaram num.
    const vazio = await comResposta(SEM_EVENTOS);
    const htmlDoVazio = vazio.container.innerHTML;
    vazio.unmount();

    const falhado = await comFalha(null);
    const htmlDoErro = falhado.desenho.container.innerHTML;

    expect(htmlDoVazio, "guarda: o caminho vazio tem mesmo de ter desenhado nada").toBe("");
    expect(htmlDoErro).not.toBe(htmlDoVazio);
  });

  it("o `<h2>` é quem nomeia a secção, pelo `id` do contrato (3)", async () => {
    // `aria-labelledby` e não `aria-label`: o nome da região e o texto que
    // se vê são a mesma palavra, e dois sítios para a mesma palavra é um
    // sítio onde elas podem divergir.
    await comResposta(TRES_EVENTOS);

    const regiao = seccao();
    expect(regiao, "a secção tem de existir para se poder olhar para ela").not.toBeNull();
    expect(regiao).toHaveAttribute("aria-labelledby", ID_DO_TITULO);
    expect(screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })).toHaveAttribute(
      "id",
      ID_DO_TITULO,
    );
  });

  it("o título é o mesmo em todos os estados, erro incluído (9, nota 1)", async () => {
    // "Próximos eventos" e não "Esta semana" (ADR 0015), e não um título
    // diferente no erro — com a rede em baixo, dois nomes para a mesma
    // secção fazem-na ler como duas secções.
    //
    // Deixa passar: a palavra estar certa. Isso é a tabela de 9 e o
    // `textos-dos-eventos.test.ts`; aqui prova-se só que é a mesma nos dois.
    const comEventos = await comResposta(QUATRO_EVENTOS);
    const tituloComEventos = within(comEventos.container).getByRole("heading", {
      name: TEXTOS_DOS_EVENTOS.titulo,
    }).textContent;
    comEventos.unmount();

    const falhado = await comFalha(500);

    expect(
      within(falhado.desenho.container).getByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })
        .textContent,
    ).toBe(tituloComEventos);
  });

  it("a secção não é uma região viva (3)", async () => {
    // Uma `aria-live` aqui anunciava a chegada dos eventos **por cima** de
    // quem estava a ler a ementa, quinhentos píxeis acima. A secção aparece
    // uma vez e nunca mais muda sozinha, e um anúncio para isso é uma
    // interrupção sem notícia.
    await comResposta(TRES_EVENTOS);

    const regiao = seccao();
    expect(regiao).not.toBeNull();
    expect(regiao).not.toHaveAttribute("aria-live");
    expect(regiao?.querySelector("[aria-live]")).toBeNull();
  });
});

describe("o corte nos três, e a linha dos excedentes (7.1, 7.2)", () => {
  it("quatro na resposta dão três cartões e a frase", async () => {
    // O corte é desta secção e não do backend (7.1): a API manda tudo, por
    // ordem de data, e a F4-03 conta com a lista inteira.
    await comResposta(QUATRO_EVENTOS);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(TEXTOS_DOS_EVENTOS.maisEventos)).toBeInTheDocument();
  });

  it("exatamente três dão três cartões e nenhuma frase", async () => {
    // O outro lado da fronteira, e é por isso que os dois casos existem:
    // um `eventos.length >= 3` passava o teste de cima inteiro e mentia
    // aqui, a dizer que há mais quando não há nada a mais.
    await comResposta(TRES_EVENTOS);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.maisEventos)).toBeNull();
  });

  it("com um só também não há frase nenhuma", async () => {
    await comResposta(UM_EVENTO);

    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.maisEventos)).toBeNull();
  });

  it("os três que ficam são os três primeiros da resposta", async () => {
    // "Os três mais próximos" só é verdade porque a lista vem ordenada
    // (ADR 0010): quem corta não reordena. O quarto da fixtura é a passagem
    // de ano, e ele **não** pode estar no ecrã — um `slice(-3)` dava três
    // cartões, passava a contagem de cima, e mostrava os três mais
    // distantes.
    await comResposta(QUATRO_EVENTOS);

    const cartoes = screen.getAllByRole("listitem");
    expect(cartoes[0]).toHaveTextContent(SAMBA_A_TRES_DIAS.titulo);
    expect(cartoes[2]).toHaveTextContent(SAMBA_A_QUARENTA_E_CINCO_DIAS.titulo);
    expect(screen.queryByText(PASSAGEM_DE_ANO.titulo)).toBeNull();
  });

  it("a frase não é ligação nem botão — não há para onde mandar ninguém (7.2)", async () => {
    // Não existe ecrã público de eventos neste projeto. Uma seta ou um
    // `<a>` aqui prometiam um sítio que não existe, e quem carregasse
    // ficava a saber que o site lhe mentiu.
    await comResposta(QUATRO_EVENTOS);

    const frase = screen.getByText(TEXTOS_DOS_EVENTOS.maisEventos);
    expect(frase.closest("a")).toBeNull();
    expect(frase.closest("button")).toBeNull();
    expect(frase.textContent, "sem seta, e com ponto final porque é uma frase (9)").toBe(
      TEXTOS_DOS_EVENTOS.maisEventos,
    );
  });

  it("três cartões com o mesmo título continuam a ser três cartões (7.3)", async () => {
    // A repetição é real — a noite de samba é às quintas — e o ecrã público
    // mostra-a tal como vem. Uma deduplicação por título escondia duas das
    // três datas e o site passava a afirmar que só há uma noite de samba.
    await comResposta(TRES_EVENTOS);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText(SAMBA_A_TRES_DIAS.titulo)).toHaveLength(3);
  });

  it("os cartões são itens de uma lista, e a lista é uma só (3)", async () => {
    // Um leitor de ecrã anuncia "lista com 3 itens", que é a informação que
    // o olho recebe de graça. Três `<ul>` de um item davam três anúncios de
    // "lista com 1 item" e a contagem desaparecia.
    await comResposta(TRES_EVENTOS);

    const listas = screen.getAllByRole("list");
    expect(listas).toHaveLength(1);
    expect(within(listas[0] as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("o cabeçalho composto do cartão (4.3)", () => {
  it("o nome acessível do `<h3>` traz a data, a hora e o nome, por esta ordem", async () => {
    // Quem salta de cabeçalho em cabeçalho ouve o cartão inteiro na ordem
    // em que ele está desenhado. Com o `<h3>` a conter só o nome, a data
    // ficava **acima** do cabeçalho e quem saltasse tinha de voltar atrás.
    //
    // O esperado constrói-se com a mesma função que o componente usa, e
    // **não** à mão: o nome acessível muda com o relógio (4.3, nota final).
    // O preço está escrito no cabeçalho deste ficheiro — uma tabela de dias
    // em inglês passa daqui com as duas pontas a dizer o mesmo.
    await comResposta(UM_EVENTO);

    const cabecalho = screen.getByRole("heading", { level: 3 });
    expect(cabecalho).toHaveAccessibleName(cabecalhoEsperado(SAMBA_A_TRES_DIAS));
  });

  it("há um `<h3>` por cartão, e nenhum nível a mais (3)", async () => {
    // `h1` (o nome do bar) → `h2` (Próximos eventos) → `h3` (cada evento),
    // sem saltos. Um `<h4>` para a descrição, ou um `<h3>` para o nome
    // **dentro** de outro `<h3>` para a data, partia a navegação por
    // títulos sem partir nada no ecrã.
    await comResposta(TRES_EVENTOS);

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("as três linhas do cabeçalho são três, e separadas", async () => {
    // "Hoje", "A partir das 22:00" e o nome vivem em três `<span>` com
    // tamanhos diferentes (4.2). Uma só linha de texto corrido dava o mesmo
    // nome acessível do primeiro teste deste bloco e um cartão sem escada
    // tipográfica nenhuma — por isso o nome acessível sozinho não chega.
    await comResposta(resposta([EVENTO_DE_HOJE]));

    const cabecalho = screen.getByRole("heading", { level: 3 });
    const data = formatarDataDoEvento(EVENTO_DE_HOJE.inicio, AGORA);
    const linhas = [...cabecalho.children].map((filho) => filho.textContent);

    expect(linhas).toEqual([data.grande, data.pequena, EVENTO_DE_HOJE.titulo]);
  });

  it("a descrição aparece inteira, e fora do cabeçalho", async () => {
    // Sem corte e sem "ver mais" (10): não há ecrã de detalhe para onde
    // mandar quem quer ler o resto. Fora do `<h3>` porque quem salta de
    // cabeçalho em cabeçalho não quer ouvir o parágrafo todo.
    await comResposta(UM_EVENTO);

    const descricao = SAMBA_A_TRES_DIAS.descricao;
    expect(descricao, "guarda: a fixtura tem mesmo de trazer descrição").not.toBeNull();
    const paragrafo = screen.getByText(descricao as string);
    expect(paragrafo.closest("h3")).toBeNull();
  });

  it("as quebras de linha da descrição respeitam-se: o parágrafo leva `whitespace-pre-line` e o texto é o que o dono escreveu (F4-03, decisão do Tomás)", async () => {
    // O `<textarea>` da gestão aceita quebras de linha, e o dono espera ver no site o que
    // escreveu: sem `white-space: pre-line` as duas linhas fundiam-se numa. Uma classe do Tailwind,
    // a única alteração desta tarefa ao ecrã público. O jsdom não carrega o CSS, por isso aqui
    // prova-se a classe e o texto sem tocar nele; o estilo calculado, no Chromium, está em
    // `e2e/gestao-eventos.spec.ts`.
    const comLinhas = evento({
      id: 70,
      titulo: "Noite com duas linhas",
      inicio: "2026-11-05T22:00:00+00:00",
      descricao: "Primeira linha.\nSegunda linha.\n\nTerceiro parágrafo.",
    });
    await comResposta(resposta([comLinhas]));

    const paragrafo = screen.getByText(
      (_texto, no) => no?.tagName === "P" && no.textContent === comLinhas.descricao,
    );
    expect(paragrafo).toHaveClass("whitespace-pre-line");
    expect(paragrafo.textContent).toBe("Primeira linha.\nSegunda linha.\n\nTerceiro parágrafo.");
    expect(paragrafo.closest("h3")).toBeNull();
    expect(
      paragrafo.querySelector("br"),
      "as quebras não viram <br>: é o CSS que as desenha",
    ).toBeNull();
  });

  it("um evento sem descrição não deixa parágrafo vazio", async () => {
    // Um `<p>` com `null` lá dentro não se vê, mas ocupa a sua linha de
    // altura e o cartão curto deixa de ser curto. O que se mede é o número
    // de `<p>` dentro do cartão: zero.
    await comResposta(resposta([SAMBA_A_DEZASSETE_DIAS]));

    const cartao = screen.getByRole("listitem");
    expect(
      SAMBA_A_DEZASSETE_DIAS.descricao,
      "guarda: este da fixtura não tem descrição",
    ).toBeNull();
    expect(cartao.querySelectorAll("p")).toHaveLength(0);
  });

  it("o cartão não diz nada sobre preço nem entrada (4.4)", async () => {
    // A entrada é sempre livre, e isso não se escreve: é verdade em todos
    // os cartões. Este teste existe para apanhar a boa intenção de quem
    // acrescentar "Entrada livre" sem passar por 4.4 — e é a secção 4.4 que
    // deixa de ser verdade no dia em que houver um evento pago.
    await comResposta(QUATRO_EVENTOS);

    const texto = seccao()?.textContent ?? "";
    expect(texto).not.toMatch(/entrada/i);
    expect(texto).not.toMatch(/grátis|gratuito/i);
    expect(texto, "nem preço nenhum: a secção não tem euros").not.toMatch(/€/);
  });
});

describe("as palavras da data calculam-se no browser (5.5, 5.6)", () => {
  it("a mesma resposta lê-se «Quinta-feira» hoje e «Hoje» na quinta", async () => {
    // **O defeito que o cache de 60 s transforma em mentira.** Se "hoje",
    // "amanhã" e "já começou" viessem cozidos na resposta do `GET /eventos`,
    // a resposta guardada às 23:59 servia-se às 00:01 a dizer "Hoje" sobre
    // o dia de ontem. A prova é esta: **o mesmo corpo**, dois relógios,
    // duas palavras.
    //
    // Deixa passar: a palavra estar certa — isso é `data-do-evento.test.ts`.
    // Aqui prova-se só que ela depende do relógio e não da resposta.
    const primeiro = await comResposta(resposta([SAMBA_A_TRES_DIAS]));
    const naSegunda = within(primeiro.container).getByRole("heading", { level: 3 }).textContent;
    primeiro.unmount();

    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    const segundo = await comResposta(resposta([SAMBA_A_TRES_DIAS]));
    const naQuinta = within(segundo.container).getByRole("heading", { level: 3 }).textContent;

    expect(naSegunda).not.toBe(naQuinta);
    expect(naQuinta).toContain(TEXTOS_DOS_EVENTOS.hoje);
    expect(naSegunda, "a três dias lê-se o nome do dia, não «Hoje»").not.toContain(
      TEXTOS_DOS_EVENTOS.hoje,
    );
  });

  it("o componente chama a função pura com o `agora` do relógio", async () => {
    // A forma errada que isto apanha é a inversa da de cima: a função é
    // pura e recebe o `agora`, mas o componente passa-lhe um `agora`
    // congelado na primeira montagem, ou — pior — a função é chamada com o
    // `inicio` e lê `Date.now()` lá dentro. Qualquer das duas sobrevive ao
    // teste anterior numa montagem nova; o que não sobrevive é a cadeia
    // sair igual à que a função pura produz para **este** instante.
    await comResposta(resposta([EVENTO_DE_HOJE_JA_COMECADO]));

    expect(screen.getByRole("heading", { level: 3 })).toHaveAccessibleName(
      cabecalhoEsperado(EVENTO_DE_HOJE_JA_COMECADO),
    );
    expect(
      screen.getByRole("heading", { level: 3 }).textContent,
      "um evento de hoje que já começou não se pode ler como coisa que ainda vai acontecer (5.3)",
    ).toContain("Começou às");
  });

  it("dois eventos diferentes nunca mostram a mesma data grande (13)", async () => {
    // O critério da revisão, executável. Com `d = 3`, `d = 17` e `d = 45`,
    // as três datas grandes são três cadeias distintas — e é isso que
    // permite distinguir três cartões com o mesmo título (7.3).
    await comResposta(TRES_EVENTOS);

    const grandes = screen
      .getAllByRole("heading", { level: 3 })
      .map((cabecalho) => cabecalho.children[0]?.textContent);

    expect(new Set(grandes).size, `as três datas grandes foram ${JSON.stringify(grandes)}`).toBe(3);
  });

  it("um evento que já começou continua visível (13)", async () => {
    // Não desaparece à hora de início: desaparece à meia-noite, e quem
    // decide isso é o backend. Um filtro no componente — `inicio > agora` —
    // tirava do ecrã o evento que está a acontecer **enquanto ele está a
    // acontecer**, que é quando mais interessa.
    await comResposta(resposta([EVENTO_DE_HOJE_JA_COMECADO]));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(EVENTO_DE_HOJE_JA_COMECADO.titulo)).toBeInTheDocument();
  });
});

describe("o cartaz (6.1, 6.3, 6.4)", () => {
  it("um evento sem `imagem` não tem imagem nenhuma — e não tem buraco", async () => {
    // 6.1: um cartão sem cartaz é um cartão inteiro, não um cartão com um
    // sítio vazio. O que se mede é a ausência das duas coisas: do `<img>` e
    // da caixa que lhe estaria reservada.
    await comResposta(resposta([SAMBA_A_DEZASSETE_DIAS]));

    const cartao = screen.getByRole("listitem");
    expect(within(cartao).queryByRole("img")).toBeNull();
    expect(cartao.querySelectorAll(".aspect-cartaz")).toHaveLength(0);
  });

  it("com cartaz e sem cartaz, um por baixo do outro, só um tem imagem", async () => {
    // O par da captura `390-evento-sem-cartaz.png`. Montados juntos porque
    // é assim que o defeito aparece: uma caixa desenhada sempre passa os
    // dois testes separados e dá um buraco no segundo cartão.
    await comResposta(COM_E_SEM_CARTAZ);

    const cartoes = screen.getAllByRole("listitem");
    expect(within(cartoes[0] as HTMLElement).getAllByRole("img")).toHaveLength(1);
    expect(within(cartoes[1] as HTMLElement).queryByRole("img")).toBeNull();
  });

  it("o `alt` é o título do evento, e não a palavra «cartaz» (6.4)", async () => {
    // "Cartaz" nomeia o objeto em vez de nomear a coisa: quem ouve fica a
    // saber que há uma imagem e continua sem saber de quê. O custo — ouvir
    // o nome duas vezes — está aceite por escrito em 6.4.
    await comResposta(UM_EVENTO);

    const imagem = screen.getByRole("img");
    expect(imagem).toHaveAttribute("alt", SAMBA_A_TRES_DIAS.titulo);
    expect(
      imagem.getAttribute("alt"),
      "nem «cartaz», nem «imagem de», nem o nome do ficheiro",
    ).not.toMatch(/cartaz|imagem|\.png/i);
  });

  it("o `src` é o nome do ficheiro servido de `/media/`, sem caminho nenhum", async () => {
    // O contrato manda um nome de ficheiro, não um URL (fixtura). O
    // componente põe-lhe `/media/` à frente e mais nada: um domínio
    // absoluto morria na CSP `img-src 'self'` (ADR 0008) e um caminho vindo
    // da API era a travessia de diretório a entrar pela porta da frente.
    await comResposta(UM_EVENTO);

    expect(screen.getByRole("img")).toHaveAttribute("src", `/media/${CARTAZ_DE_TESTE}`);
  });

  it("a imagem é `lazy`, e as três não disputam a ementa (12.6)", async () => {
    // A secção nasce abaixo de uma ementa de onze categorias: nenhuma
    // destas imagens está no ecrã quando a página pinta. Sem `lazy`, três
    // cartazes competem com a carta pela mesma ligação de dados móveis.
    await comResposta(TRES_EVENTOS);

    for (const imagem of screen.getAllByRole("img")) {
      expect(imagem).toHaveAttribute("loading", "lazy");
    }
  });

  it("quando a imagem falha, a caixa sai do cartão (6.3)", async () => {
    // Um 404 em `/media/` é um caso normal e não uma avaria: a F2-08
    // importou nomes de ficheiro da base de dados antiga e esses ficheiros
    // podem nunca ter chegado ao servidor. Deixar lá a caixa vazia era um
    // buraco permanente.
    //
    // O `error` dispara-se à mão porque **o jsdom não vai buscar byte
    // nenhum** — nenhuma imagem falha sozinha aqui. O que este teste prova
    // é que existe um tratador e que ele tira a caixa inteira, não só o
    // `<img>`; que o 404 verdadeiro chega a dispará-lo é `eventos.spec.ts`.
    await comResposta(UM_EVENTO);

    const imagem = screen.getByRole("img");
    const caixa = imagem.closest(".aspect-cartaz");
    expect(
      caixa,
      "guarda: a caixa 3:2 tem mesmo de existir antes de a imagem falhar",
    ).not.toBeNull();

    await act(async () => {
      fireEvent.error(imagem);
    });

    const cartao = screen.getByRole("listitem");
    expect(within(cartao).queryByRole("img"), "o `<img>` partido não pode ficar").toBeNull();
    expect(
      cartao.querySelectorAll(".aspect-cartaz"),
      "e a caixa sai com ele: um cartão sem cartaz, não um cartão com um buraco",
    ).toHaveLength(0);
  });
});

describe("o erro, e as suas duas linhas (8.2)", () => {
  it("sem resposta, a segunda linha fala da ligação", async () => {
    // `estado: null` é o `fetch` a rejeitar: rede em baixo, DNS, túnel. A
    // pessoa pode fazer alguma coisa, e a frase diz-lhe o quê.
    await comFalha(null);

    expect(screen.getByText(TEXTOS_DOS_EVENTOS.erroSemResposta)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.erroComResposta)).toBeNull();
  });

  it("com o servidor a responder mal, a segunda linha assume a culpa", async () => {
    // Um 500 não é a ligação de ninguém. Mandar verificar o WiFi a quem tem
    // WiFi é mandá-lo resolver um problema que não é dele — e o problema
    // continua lá depois de ele desligar e ligar o router.
    await comFalha(500);

    expect(screen.getByText(TEXTOS_DOS_EVENTOS.erroComResposta)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.erroSemResposta)).toBeNull();
  });

  it("o título do erro é o verbo da ementa, na cor de erro (8.2)", async () => {
    // "Não consegui **carregar** os eventos.", como "Não consegui carregar
    // a ementa.": com a rede em baixo os dois blocos existem ao mesmo tempo
    // na mesma página, e dois verbos diferentes para a mesma avaria fazem-nos
    // ler como dois problemas distintos.
    //
    // A cor é a prova de que o `EstadoVazio` vai com `tom="erro"`. É o
    // único sítio deste ficheiro onde se pega por classe, e é porque o
    // `tom` não tem outro sinal no DOM — sem ele, o erro sai desenhado
    // exactamente como o vazio.
    await comFalha(null);

    const titulo = screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.erroTitulo });
    expect(titulo.textContent).toContain("carregar");
    expect(titulo).toHaveClass("text-erro");
  });

  it("o botão é secundário: o único dourado da secção é o anel de foco (13)", async () => {
    // O dourado da página pública está gasto no "WiFi" do cabeçalho (F3-03,
    // 6.1) e aqui não há ação principal nenhuma. Conta-se **dourado** e não
    // "ação", porque é o dourado que se vê: um fio dourado no cartão ou uma
    // data dourada passavam num teste que contasse botões principais.
    await comFalha(null);

    const regiao = seccao();
    expect(regiao).not.toBeNull();
    const comDourado = [...(regiao?.querySelectorAll("*") ?? [])].filter((elemento) =>
      /(^|[\s:])(bg|text|border)-acao\b/.test(elemento.className.toString()),
    );

    expect(
      comDourado.map((elemento) => elemento.className.toString()),
      "o anel de foco é `focus-visible:` e não conta; qualquer outro dourado conta",
    ).toEqual([]);
  });

  it("«Tentar outra vez» faz um pedido novo", async () => {
    // A outra metade da regra 10: ver que falhou não chega se não houver
    // saída. Um botão que não refaz o pedido é um botão decorativo.
    const { pedidos } = await comFalha(null);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez }));

    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });
  });

  it("durante a tentativa o botão fica no sítio, a dizer «A tentar…»", async () => {
    // 8.3: voltar ao estado `a-carregar` faria a secção **desaparecer**,
    // botão incluído, e o foco de quem acabou de carregar caía para o
    // `<body>` — largado no topo da página, sem explicação.
    //
    // A asserção é sobre **o mesmo nó do DOM**, não sobre o nome acessível:
    // durante a tentativa o botão passa a chamar-se "A tentar…", e
    // procurá-lo pelo nome antigo dizia "desmontou" quando ele está lá.
    const { pedidos } = await comFalha(null);
    const botao = screen.getByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez });
    botao.focus();

    fireEvent.click(botao);
    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });

    expect(document.body.contains(botao), "o botão não pode desmontar durante a tentativa").toBe(
      true,
    );
    expect(botao).toHaveTextContent(TEXTOS_DOS_EVENTOS.aTentar);
    expect(botao, "e fica marcado como ocupado").toHaveAttribute("aria-busy", "true");
    expect(document.activeElement, "o foco não sai do botão").toBe(botao);
  });

  it("uma tentativa que corre bem troca o erro pelos cartões", async () => {
    const { pedidos } = await comFalha(null);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez }));
    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });

    await act(async () => {
      pedidos[1]?.resolver(TRES_EVENTOS);
      await Promise.resolve();
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: TEXTOS_DOS_EVENTOS.erroTitulo })).toBeNull();
  });

  it("uma tentativa que traz uma lista vazia faz a secção desaparecer (8.3)", async () => {
    // E aí desaparece **com razão**: o pedido correu bem e não há eventos.
    // É o único caminho em que a secção pode sumir depois de ter estado no
    // ecrã, e está escrito em 8.3 que é assim de propósito.
    const { desenho, pedidos } = await comFalha(null);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez }));
    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });

    await act(async () => {
      pedidos[1]?.resolver(SEM_EVENTOS);
      await Promise.resolve();
    });

    expect(desenho.container).toBeEmptyDOMElement();
  });

  it("uma tentativa que falha outra vez não deixa o botão preso em «A tentar…»", async () => {
    // O defeito que a ementa já teve: o `setATentar(false)` escrito só no
    // ramo feliz deixa o botão ocupado para sempre, a prometer um pedido
    // que já acabou. Carregar nele outra vez não faz nada e não há nada no
    // ecrã que explique porquê.
    const { pedidos } = await comFalha(null);
    const botao = screen.getByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez });

    fireEvent.click(botao);
    await waitFor(() => {
      expect(pedidos).toHaveLength(2);
    });

    await act(async () => {
      pedidos[1]?.rejeitar(new ErroDaApi("falhou outra vez", { estado: null, codigo: null }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(botao).toHaveTextContent(TEXTOS_DOS_EVENTOS.tentarOutraVez);
    });
    expect(botao).not.toHaveAttribute("aria-busy", "true");
  });
});

describe("teclado: zero paragens no caminho normal, uma no erro (2.2)", () => {
  it("com cartões não há onde o `Tab` pare, e com erro há exatamente um sítio", async () => {
    // 2.2: a secção entra entre a ementa e o que vem a seguir sem
    // acrescentar nada à ordem de tabulação. Não há ligações nos cartões,
    // não há "ver mais" e a imagem não é focável.
    //
    // Os dois lados medem-se na mesma execução de propósito: um seletor que
    // deixasse de condizer com fosse o que fosse devolvia zero no primeiro
    // caso e passava a dizer "não acrescenta paragens" sem ter olhado para
    // nada. O segundo número é o guarda (regra 10).
    const comCartoes = await comResposta(QUATRO_EVENTOS);
    const regiaoNormal = comCartoes.container.querySelector<HTMLElement>(`#${ID_DA_SECCAO}`);
    expect(regiaoNormal, "guarda: a secção tem de existir para se contar nela").not.toBeNull();
    const noCaminhoNormal = paragensDeTab(regiaoNormal as HTMLElement);
    comCartoes.unmount();

    const falhado = await comFalha(null);
    const regiaoDeErro = falhado.desenho.container.querySelector<HTMLElement>(`#${ID_DA_SECCAO}`);
    const noErro = paragensDeTab(regiaoDeErro as HTMLElement);

    expect(
      noCaminhoNormal.map((elemento) => elemento.outerHTML),
      "a secção dos eventos não acrescenta paragens de `Tab` ao caminho normal",
    ).toEqual([]);
    expect(noErro, "guarda: o seletor condiz com alguma coisa — no erro há o botão").toHaveLength(
      1,
    );
    expect(noErro[0]).toHaveAccessibleName(TEXTOS_DOS_EVENTOS.tentarOutraVez);
  });

  it("o cartaz não é focável nem interativo", async () => {
    // Uma imagem com `tabindex` ou dentro de um `<a>` dava uma paragem por
    // cartão e prometia um ecrã de detalhe que não existe.
    await comResposta(TRES_EVENTOS);

    for (const imagem of screen.getAllByRole("img")) {
      expect(imagem).not.toHaveAttribute("tabindex");
      expect(imagem.closest("a")).toBeNull();
      expect(imagem.closest("button")).toBeNull();
    }
  });
});

describe("o pedido é desta secção, e parte ao montar (8.1)", () => {
  it("parte uma vez, sem esperar por toque nenhum", async () => {
    // Um pedido adiado para quando a secção chega perto do ecrã punha-a a
    // aparecer por baixo do polegar de quem está a ler a ementa.
    clienteFalso();
    render(<Eventos />);
    await deixarAssentar();

    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("desmontar aborta o pedido que está no ar", async () => {
    // Em `StrictMode` os efeitos correm duas vezes em desenvolvimento, e
    // sem isto ficavam dois `GET /eventos` no ar numa ligação de dados
    // móveis. É o mesmo que a `Ementa` e o `App` já fazem.
    const pedidos = clienteFalso();
    const { unmount } = render(<Eventos />);
    await deixarAssentar();

    expect(
      pedidos[0]?.sinal,
      "o pedido tem de levar sinal, ou não há nada para abortar",
    ).toBeDefined();
    expect(pedidos[0]?.sinal?.aborted, "guarda: antes de desmontar não está abortado").toBe(false);

    unmount();

    expect(pedidos[0]?.sinal?.aborted).toBe(true);
  });

  it("um cancelamento nosso não é uma resposta que não chegou", async () => {
    // A regra 10 outra vez, no terceiro sítio desta secção: em
    // `StrictMode` o primeiro pedido é abortado **por nós**, e tratar essa
    // rejeição como falha punha a secção em erro em desenvolvimento, todas
    // as vezes, com os eventos já na mão.
    const pedidos = clienteFalso();
    render(
      <StrictMode>
        <Eventos />
      </StrictMode>,
    );
    await deixarAssentar();

    expect(pedidos.length, "guarda: o `StrictMode` tem mesmo de montar duas vezes").toBeGreaterThan(
      1,
    );

    await act(async () => {
      pedidos[0]?.rejeitar(new DOMException("abortado", "AbortError"));
      pedidos[pedidos.length - 1]?.resolver(TRES_EVENTOS);
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: TEXTOS_DOS_EVENTOS.erroTitulo })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("quando não há Lisboa nenhuma para ler, a secção vai para erro (5.4)", async () => {
    // Um aparelho sem a base de dados de fusos faz `formatarDataDoEvento`
    // lançar `RangeError` (está provado em `data-do-evento.test.ts`). Se a
    // excessão subir do render, não é a secção dos eventos que desaparece:
    // é a página inteira a ficar em branco, ementa e cabeçalho incluídos.
    //
    // E o que se mostra é **erro** e não lista vazia: "não consegui saber
    // que dia é em Lisboa" não se pode ler como "não há eventos" (regra 10).
    //
    // Deixa passar: o que acontece a partir do segundo cartão. A fixtura
    // tem um evento só, de propósito, para a excessão ser uma.
    formatar.mockImplementationOnce(() => {
      throw new RangeError("Invalid time zone specified: Europe/Lisbon");
    });

    await comResposta(UM_EVENTO);

    expect(screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.erroSemLisboaTitulo }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("a terceira avaria: o aparelho não sabe ler datas de Lisboa (5.4)", () => {
  /** Põe `formatarDataDoEvento` a lançar, como num aparelho de ICU reduzido. */
  function semBaseDeFusos(): void {
    formatar.mockImplementationOnce(() => {
      throw new RangeError("Invalid time zone specified: Europe/Lisbon");
    });
  }

  it("diz «mostrar», e não «carregar»: os eventos chegaram", async () => {
    // As três partes do par antigo estavam erradas para quem lê. O pedido
    // correu bem — por isso o verbo muda, e tem de se **ler** como outra
    // avaria. "aparelho" é o vocabulário que `data-do-evento.ts` já usa.
    semBaseDeFusos();
    await comResposta(UM_EVENTO);

    const titulo = screen.getByRole("heading", {
      name: TEXTOS_DOS_EVENTOS.erroSemLisboaTitulo,
    });
    expect(titulo.textContent).toContain("mostrar");
    expect(titulo).toHaveClass("text-erro");
    expect(screen.getByText(TEXTOS_DOS_EVENTOS.erroSemLisboa)).toBeInTheDocument();
  });

  it("nenhuma das duas frases do erro de rede aparece aqui", async () => {
    // O par da ementa fica intacto e **fica onde estava**: aqui não entra.
    // "O problema é nosso" é falso (o problema é a base de fusos do
    // aparelho) e "Verifica a ligação" manda mexer no WiFi quem tem WiFi.
    semBaseDeFusos();
    await comResposta(UM_EVENTO);

    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.erroTitulo)).toBeNull();
    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.erroComResposta)).toBeNull();
    expect(screen.queryByText(TEXTOS_DOS_EVENTOS.erroSemResposta)).toBeNull();
  });

  it("não há «Tentar outra vez»: repetir não ensina o aparelho a ler datas", async () => {
    // Decisão do Tomás. O botão repetia o pedido, a resposta voltava boa, e
    // a formatação voltava a falhar — um botão que não pode funcionar é
    // pior do que nenhum. Os outros dois estados de erro mantêm-no.
    semBaseDeFusos();
    await comResposta(UM_EVENTO);

    expect(screen.queryByRole("button", { name: TEXTOS_DOS_EVENTOS.tentarOutraVez })).toBeNull();

    const regiao = seccao();
    expect(regiao).not.toBeNull();
    expect(
      paragensDeTab(regiao as HTMLElement),
      "e por isso esta é a única secção em erro sem paragem nenhuma de `Tab` (2.2)",
    ).toHaveLength(0);
  });

  it("este ecrã e os dois erros de rede são três ecrãs diferentes (regra 10)", async () => {
    // **É este o defeito que se está a corrigir.** Antes, o aparelho sem
    // Lisboa desenhava-se *byte a byte* como o erro do servidor: três
    // causas, duas frases. Compara-se o texto **inteiro** da secção, e não
    // frase a frase, porque é a igualdade completa que era o defeito.
    const doServidor = await comFalha(500);
    const textoDoServidor = textoDaSeccao();
    doServidor.desenho.unmount();

    const daRede = await comFalha(null);
    const textoDaRede = textoDaSeccao();
    daRede.desenho.unmount();

    semBaseDeFusos();
    await comResposta(UM_EVENTO);
    const textoDoAparelho = textoDaSeccao();

    // Guardas: os três ecrãs foram mesmo desenhados. Sem eles, três cadeias
    // vazias passavam no teste todo sem nunca terem sido lidas.
    expect(textoDoServidor, "guarda: o erro do servidor").toContain(
      TEXTOS_DOS_EVENTOS.erroComResposta,
    );
    expect(textoDaRede, "guarda: o erro de rede").toContain(TEXTOS_DOS_EVENTOS.erroSemResposta);
    expect(textoDoAparelho, "guarda: o aparelho sem Lisboa").toContain(
      TEXTOS_DOS_EVENTOS.erroSemLisboa,
    );

    expect(
      textoDoAparelho,
      "o aparelho sem Lisboa está a desenhar-se como o erro do servidor — é " +
        "exactamente o defeito que a Q-05 apanhou: o cliente lê «o problema é " +
        "nosso… tenta outra vez daqui a pouco» e carrega num botão que não pode " +
        "funcionar, para sempre",
    ).not.toBe(textoDoServidor);
    expect(
      textoDoAparelho,
      "o aparelho sem Lisboa está a desenhar-se como a rede em baixo, e a pessoa " +
        "fica a mexer no WiFi para resolver uma avaria que não é da ligação dela",
    ).not.toBe(textoDaRede);
    expect(
      textoDaRede,
      "guarda do próprio guarda: estes dois já se distinguiam, e têm de continuar " +
        "a distinguir-se — senão a comparação de cima passava por acidente",
    ).not.toBe(textoDoServidor);
  });
});

describe("o prazo de 10 s, e a ordem dos ramos do `catch`", () => {
  /*
   * **Sem este bloco, duas mutações passavam a verde** — e as duas dão o
   * mesmo sintoma: pedido pendurado, secção invisível para sempre. Nesta
   * secção isso lê-se exactamente como "não há eventos marcados", que é a
   * regra 10 outra vez, desta vez pelo relógio.
   *
   * 1. apagar o `window.setTimeout` inteiro do componente;
   * 2. pôr o guarda do cancelamento à frente do `ErroDaApi` no `.catch`.
   *
   * O `beforeEach` de cima finge **só o `Date`**, de propósito: é o que
   * mantém as datas dos cartões fixas sem parar os temporizadores do resto
   * do ficheiro. Aqui finge-se o relógio todo, que é o que permite avançar
   * os 10 s à mão.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  it("aos 9,999 s ainda não abortou", async () => {
    // O prazo não pode ser mais curto: uma rede fraca falha quando ia
    // conseguir, e a pessoa vê um erro por causa do nosso relógio.
    const pedidos = clienteFalso();
    render(<Eventos />);

    await act(async () => {
      vi.advanceTimersByTime(9_999);
    });

    expect(pedidos[0]?.sinal?.aborted).toBe(false);
    expect(
      screen.queryByRole("heading", { name: TEXTOS_DOS_EVENTOS.titulo }),
      "e até lá a secção continua sem existir: ainda está a carregar (8.1)",
    ).toBeNull();
  });

  it("aos 10 s aborta com `TimeoutError` e a secção passa a erro de rede", async () => {
    const pedidos = clienteFalso();
    render(<Eventos />);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    const sinal = pedidos[0]?.sinal;
    expect(
      sinal?.aborted,
      "sem prazo, um pedido pendurado deixa a secção invisível para sempre — e uma " +
        "secção invisível lê-se como «não há eventos marcados»",
    ).toBe(true);
    expect(
      nomeDaRazao(sinal?.reason),
      "tem de ser `TimeoutError` e não `AbortError`: o cliente olha para o **nome** " +
        "do motivo, e um `AbortError` era tomado por um cancelamento nosso",
    ).toBe("TimeoutError");

    await act(async () => {
      await Promise.resolve();
    });

    // **E é esta asserção que prende a ordem dos ramos do `.catch`.** Aqui o
    // sinal está abortado **e** o erro é um `ErroDaApi`: quem puser o guarda
    // do cancelamento à frente engole o caso e a secção fica a carregar para
    // sempre, sem botão nenhum para tentar outra vez.
    expect(
      screen.getByRole("heading", { name: TEXTOS_DOS_EVENTOS.erroTitulo }),
    ).toBeInTheDocument();
    expect(screen.getByText(TEXTOS_DOS_EVENTOS.erroSemResposta)).toBeInTheDocument();
  });

  it("o prazo morre com o desmontar e não aborta um pedido que já não existe", async () => {
    // Sem o `clearTimeout` da limpeza, um temporizador de uma secção
    // desmontada acordava 10 s depois e abortava um `AbortController` que
    // ninguém usava — sem sintoma visível e, por isso, sem teste a apanhá-lo.
    const pedidos = clienteFalso();
    const { unmount } = render(<Eventos />);
    unmount();

    expect(
      nomeDaRazao(pedidos[0]?.sinal?.reason),
      "desmontar é um cancelamento, não um prazo esgotado: os dois têm de se distinguir",
    ).not.toBe("TimeoutError");

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(vi.getTimerCount(), "não pode ficar temporizador nenhum por disparar").toBe(0);
  });
});
