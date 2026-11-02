/**
 * F3-03, 13.2 — o cabeçalho fixo, com as cinco leituras do `/info`.
 *
 * Contrato que este ficheiro fixa (é o que o agente frontend tem de
 * cumprir):
 *
 * ```tsx
 * // src/pages/publico/Cabecalho.tsx
 * export type EstadoDoInfo =
 *   | { estado: "a-carregar" }
 *   | { estado: "pronto"; info: Info }
 *   | { estado: "falhou" };
 *
 * export function Cabecalho({ info }: { info: EstadoDoInfo }): ReactElement;
 * ```
 *
 * Desenha a ligação de salto (fora do `<header>`), o `<header>` com o `<h1>`
 * e o botão "WiFi", e a `FolhaWifi` como irmã — nunca filha — do cabeçalho.
 * **Não pede nada à API**: quem pede o `/info` é o `App.tsx`, uma vez, ao
 * montar (secção 2).
 *
 * **O que este ficheiro prova:** que o cabeçalho é o **mesmo** nas cinco
 * leituras da tabela de 6.2 — e não só que o `<h1>` e o botão lá estão, mas
 * que o desenho é píxel a píxel o mesmo nó a nó; que a ligação de salto é a
 * primeira paragem e aponta para `#lista-da-ementa`; que o logótipo não é uma
 * ligação; que o botão abre uma folha nas cinco leituras, por isso a pergunta
 * tem sempre resposta; e que **um `/info` falhado não escreve `rede: null` no
 * estado** (6.5). Esta última é a asserção que a regra 10 pede e é a única
 * das quatro que **não se vê no ecrã**: é a que a F3-06 vai herdar para o
 * horário e para a morada.
 *
 * **O que deixa passar:** tudo o que é posição e tamanho. O jsdom não tem
 * layout: a altura de 61 px do cabeçalho, a folga do `<main>`, o encaixe com
 * a barra de chips e o facto de a ligação de salto só se ver com foco não se
 * podem provar aqui, e tentá-lo dá um teste verde sobre nada. É
 * `e2e/cabecalho.spec.ts` que os fecha.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../App";
import { obterEmenta, obterInfo } from "../../lib/api/publico";
import { ErroDaApi } from "../../lib/api/cliente";
import {
  A_CARREGAR,
  CINCO_LEITURAS,
  ID_DO_DESTINO_DO_SALTO,
  INFO_COM_WIFI,
  INFO_SEM_REDE,
  TEXTOS_DO_WIFI,
} from "../../testes/cabecalho";
import type { EstadoDoInfo } from "../../testes/cabecalho";
import { EMENTA_DE_TESTE, NOME_DO_BAR } from "../../testes/ementa";
import { instalarDeslocamento, instalarMatchMedia } from "../../testes/jsdom-da-ementa";
import type { DeslocamentoFalso, MediaFalsa } from "../../testes/jsdom-da-ementa";
import { Cabecalho } from "./Cabecalho";

vi.mock("../../lib/api/publico", () => ({ obterEmenta: vi.fn(), obterInfo: vi.fn() }));

/**
 * O `Cabecalho` passa inteiro, embrulhado num espião — a mesma técnica que o
 * `Ementa.test.tsx` usa no `indexarEmenta`. Nada do comportamento muda; o que
 * se ganha é poder **ler a propriedade** que o `App.tsx` lhe entrega, que é a
 * única forma de ver a diferença entre "nunca configurado" e "não consegui
 * perguntar" — no ecrã elas são a mesma frase, de propósito (6.2).
 */
vi.mock("./Cabecalho", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("./Cabecalho")>();
  return { ...original, Cabecalho: vi.fn(original.Cabecalho) };
});

const pedirEmenta = vi.mocked(obterEmenta);
const pedirInfo = vi.mocked(obterInfo);
const cabecalhoEspiado = vi.mocked(Cabecalho);

/**
 * O suficiente para dizer "a primeira paragem de `Tab`" dentro do jsdom.
 *
 * A lista canónica — a que o varrimento a sério usa — é o
 * `SELETOR_INTERATIVO` de `e2e/apoio/pagina.ts`, e é lá que a ordem de
 * tabulação se prova com teclas a sério. Esta é a de cá: em jsdom não há
 * `Tab`, há ordem de documento, e o que ela permite afirmar é que **nenhum
 * controlo aparece antes da ligação de salto no DOM**.
 */
const CONTROLOS = 'a[href], button, input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])';

let deslocamento: DeslocamentoFalso;
let media: MediaFalsa;

beforeEach(() => {
  deslocamento = instalarDeslocamento();
  media = instalarMatchMedia();
  pedirEmenta.mockReset();
  pedirInfo.mockReset();
  cabecalhoEspiado.mockClear();
});

afterEach(() => {
  deslocamento.restaurar();
  media.restaurar();
});

function desenhar(info: EstadoDoInfo) {
  return render(<Cabecalho info={info} />);
}

function cabecalho(raiz: HTMLElement): HTMLElement {
  const encontrado = raiz.querySelector("header");
  expect(encontrado, "não encontrei o `<header>` — não verifiquei nada a seguir").not.toBeNull();
  return encontrado as HTMLElement;
}

/**
 * O HTML do cabeçalho sem os identificadores que o React gera.
 *
 * O `useId` dá nomes diferentes a cada montagem (`:r0:`, `«r3»`…), e sem os
 * apagar duas montagens do **mesmo** desenho nunca seriam iguais — o teste
 * da identidade passava a provar que o React conta.
 */
function desenhoDoCabecalho(raiz: HTMLElement): string {
  return cabecalho(raiz)
    .innerHTML.replace(/[«:][rR][0-9a-z]+[»:]/g, "ID")
    .replace(/\s+/g, " ")
    .trim();
}

describe("o cabeçalho não tem estados", () => {
  /**
   * **Prova:** que o `<h1>` e o botão "WiFi" existem nas cinco leituras do
   * `/info` — incluindo antes de a resposta chegar e depois de ela falhar.
   *
   * **Deixa passar:** que o botão esteja no sítio certo do ecrã. Em jsdom
   * "à direita" não quer dizer nada.
   */
  it("o nome do bar e o botão «WiFi» estão lá nas cinco leituras do `/info`", () => {
    for (const leitura of CINCO_LEITURAS) {
      const { unmount } = desenhar(leitura.info);

      expect(
        screen.getByRole("heading", { name: NOME_DO_BAR, level: 1 }),
        `${leitura.nome}: o nome do bar tem de estar no cabeçalho`,
      ).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: TEXTOS_DO_WIFI.wifi }),
        `${leitura.nome}: o botão "WiFi" está sempre lá (6.2, decisão do Tomás)`,
      ).toBeInTheDocument();

      unmount();
    }
  });

  /**
   * **Prova:** que o cabeçalho é o **mesmo nó a nó** nas cinco leituras.
   * Não é a mesma asserção da de cima: ali bastaria o botão existir, aqui
   * nada pode aparecer ao lado — nem um esqueleto, nem um aviso de erro,
   * nem uma vaga reservada. É isto que apaga a única mudança de layout que
   * o topo da página ainda podia sofrer depois da primeira pintura (6.3).
   *
   * **Deixa passar:** uma diferença que só exista em CSS computado (uma
   * classe que mude de cor com o estado). Em jsdom o HTML é igual e o ecrã
   * seria outro; quem vê isso é a captura `390-cabecalho`.
   */
  it("o desenho do cabeçalho é o mesmo nas cinco: nada aparece, nada salta", () => {
    const desenhos = CINCO_LEITURAS.map((leitura) => {
      const { container, unmount } = desenhar(leitura.info);
      const html = desenhoDoCabecalho(container);
      unmount();
      return { nome: leitura.nome, html };
    });

    const referencia = desenhos[0];
    expect(referencia, "guarda: a tabela de 6.2 tem de ter cinco linhas").toBeDefined();
    if (referencia === undefined) return;

    const diferentes = desenhos
      .filter((desenho) => desenho.html !== referencia.html)
      .map(
        (desenho) =>
          `${desenho.nome}:\n  ${desenho.html}\n  mas «${referencia.nome}» é\n  ${referencia.html}`,
      );

    expect(
      diferentes,
      "o cabeçalho custa 61 px em todas as páginas e a cada momento; o que ele não " +
        "pode é mudar depois da primeira pintura (6.3)",
    ).toEqual([]);
  });

  /**
   * **Prova:** que tocar em "WiFi" dá sempre uma resposta — há uma folha do
   * outro lado nas cinco leituras, com o nome acessível "WiFi".
   *
   * **Deixa passar:** o que a folha diz. É `FolhaWifi.test.tsx`.
   */
  it("em qualquer leitura, tocar em «WiFi» abre uma folha chamada «WiFi»", async () => {
    for (const leitura of CINCO_LEITURAS) {
      const { unmount } = desenhar(leitura.info);

      fireEvent.click(screen.getByRole("button", { name: TEXTOS_DO_WIFI.wifi }));

      const folha = await screen.findByRole("dialog");
      expect(
        within(folha).getByRole("heading", { name: TEXTOS_DO_WIFI.wifi }),
        `${leitura.nome}: quem toca em "WiFi" fica a saber alguma coisa (6.2)`,
      ).toBeInTheDocument();

      unmount();
    }
  });

  /**
   * **Prova:** que a Folha não é filha do `<header>`.
   *
   * **Deixa passar:** a camada de topo e o `::backdrop`, que em jsdom não
   * existem. A razão de ser desta asserção é essa mesma: um `<dialog>`
   * escrito dentro de uma caixa fixa de 61 px com contexto de empilhamento
   * próprio é um defeito que só aparece num browser (secção 2).
   */
  it("a Folha é irmã do cabeçalho, não filha dele", async () => {
    const { container } = desenhar(A_CARREGAR);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DO_WIFI.wifi }));
    await screen.findByRole("dialog");

    expect(
      cabecalho(container).querySelector("dialog"),
      "escrever o `<dialog>` dentro do cabeçalho fixo é pedir um defeito que só se vê " +
        "num browser (secção 2)",
    ).toBeNull();
    expect(container.querySelector("dialog"), "e a Folha tem de existir").not.toBeNull();
  });

  /**
   * **Prova:** que o cabeçalho não vai buscar o `/info` por dentro.
   *
   * Porquê: o `/info` é `no-store` de propósito, e dois componentes a pedir
   * o mesmo são dois pedidos numa ligação de dados móveis. E quem pede fica
   * responsável por distinguir os três estados de 6.5 — essa distinção vive
   * melhor num sítio só.
   */
  it("o cabeçalho não pede o `/info`: quem pede é o `App.tsx`", () => {
    desenhar(A_CARREGAR);

    expect(
      pedirInfo,
      "o `/info` é pedido uma vez, no `App.tsx`, e desce por propriedade (secção 2)",
    ).not.toHaveBeenCalled();
  });
});

describe("a ligação «Saltar para a ementa»", () => {
  /**
   * **Prova:** que a ligação existe, que diz o que a tabela de 10 manda, que
   * aponta para `#lista-da-ementa` e que **nenhum controlo aparece antes
   * dela** no documento.
   *
   * **Deixa passar:** que ela se veja ao receber foco e que não ocupe lugar
   * nenhum sem ele — as duas são CSS e medem-se com layout
   * (`e2e/cabecalho.spec.ts`). E deixa passar o destino: que o
   * `#lista-da-ementa` exista nos quatro estados da ementa é
   * `lista-da-ementa.test.tsx`.
   */
  it("é a primeira paragem possível e aponta para a lista da ementa", () => {
    const { container } = desenhar(A_CARREGAR);

    const ligacao = screen.getByRole("link", { name: TEXTOS_DO_WIFI.saltar });
    expect(ligacao).toHaveAttribute("href", `#${ID_DO_DESTINO_DO_SALTO}`);

    expect(
      container.querySelector(CONTROLOS),
      "treze controlos à frente de zero controlos é o retrato de uma página que " +
        "precisa de uma ligação de salto (5.1) — e ela tem de vir antes deles",
    ).toBe(ligacao);
  });

  /**
   * **Prova:** que a ligação vive **fora** do `<header>`.
   *
   * Dentro, ficava presa numa caixa de altura fixa de 61 px, e ela cresce
   * até 44 px quando recebe foco (5.3).
   */
  it("vive fora do cabeçalho, para não ser espremida pelos 61 px", () => {
    const { container } = desenhar(A_CARREGAR);
    const ligacao = screen.getByRole("link", { name: TEXTOS_DO_WIFI.saltar });

    expect(cabecalho(container).contains(ligacao)).toBe(false);
  });

  /**
   * **Prova:** que não é `hidden` nem `display: none` por atributo ou
   * estilo em linha, e que não foi tirada da ordem de tabulação com um
   * `tabindex="-1"`. Qualquer um dos três a tornava inútil (5.3).
   *
   * **Deixa passar:** o `display: none` que venha de uma classe. Em jsdom as
   * classes do Tailwind não pintam nada, por isso um `.hidden` passa aqui
   * incólume — é o `e2e` que a foca e mede.
   */
  it("não está escondida de uma maneira que a tire do teclado", () => {
    desenhar(A_CARREGAR);
    const ligacao = screen.getByRole("link", { name: TEXTOS_DO_WIFI.saltar });

    expect(ligacao).not.toHaveAttribute("hidden");
    expect(ligacao).not.toHaveAttribute("tabindex", "-1");
    expect(ligacao.style.display, "«display: none» tira-a do teclado e torna-a inútil").not.toBe(
      "none",
    );
  });

  /**
   * **Prova:** que dentro do cabeçalho não há ligação nenhuma.
   *
   * Uma ligação para o topo de uma página que é uma só seria uma paragem de
   * `Tab` a não fazer nada (secção 2).
   */
  it("o logótipo não é uma ligação", () => {
    const { container } = desenhar(A_CARREGAR);

    expect(within(cabecalho(container)).queryAllByRole("link")).toEqual([]);
  });
});

/**
 * F3-03, 6.5 — a regra 10, no único sítio onde ela não se vê no ecrã.
 *
 * "Nunca configurado", "ainda não respondeu" e "falhou" desenham-se em dois
 * ecrãs, e isso é uma decisão de desenho (6.2). **Um estado a ser reescrito
 * como o outro é um defeito** — e tem uma forma concreta e tentadora:
 *
 * ```ts
 * .catch(() => setInfo({ wifi: { rede: null, password: null }, … }))
 * ```
 *
 * Onde se paga: na F3-06. O mesmo payload traz a morada, o telefone e o
 * horário, e lá os dois estados **não** têm o mesmo desenho — `horario: null`
 * faz a secção "Visita-nos" sumir-se com um ar de decisão, e um pedido
 * falhado faria o mesmo sem que ninguém tivesse decidido nada.
 *
 * **Deixa passar:** o nome que a implementação dê a cada estado. O que se
 * prende é que os três sejam **distinguíveis** à saída do `App.tsx` e que o
 * falhado não carregue um payload inventado.
 */
describe("os três estados do `/info` no `App.tsx`", () => {
  /** As propriedades que o `App.tsx` entregou ao cabeçalho, por ordem. */
  function entregues(): unknown[] {
    return cabecalhoEspiado.mock.calls.map((chamada) => (chamada[0] as { info: unknown }).info);
  }

  /** Procura uma chave do payload do `/info` em qualquer profundidade. */
  function contemChave(valor: unknown, nomes: string[]): string | null {
    if (valor === null || typeof valor !== "object") return null;
    for (const [chave, interior] of Object.entries(valor as Record<string, unknown>)) {
      if (nomes.includes(chave)) return chave;
      const fundo = contemChave(interior, nomes);
      if (fundo !== null) return fundo;
    }
    return null;
  }

  async function desenharOApp(): Promise<{ inicial: unknown; final: unknown }> {
    pedirEmenta.mockResolvedValue(EMENTA_DE_TESTE);
    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(
        cabecalhoEspiado,
        "o `App.tsx` tem de desenhar o `Cabecalho` e passar-lhe o estado do `/info`",
      ).toHaveBeenCalled();
    });
    const inicial = entregues()[0];

    // Deixa o `/info` assentar: a propriedade final é a que interessa.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        entregues().at(-1),
        "a resposta do `/info` chegou e o estado não mudou — o `App.tsx` ficou a " +
          "carregar para sempre",
      ).not.toEqual(inicial);
    });

    const final = entregues().at(-1);
    unmount();
    return { inicial, final };
  }

  it("«nunca configurado» e «falhou» não dão o mesmo estado", async () => {
    pedirInfo.mockResolvedValue(INFO_SEM_REDE);
    const configurado = await desenharOApp();

    cabecalhoEspiado.mockClear();
    pedirInfo.mockRejectedValue(
      new ErroDaApi("não houve resposta", { estado: null, codigo: null }),
    );
    const falhado = await desenharOApp();

    expect(
      falhado.final,
      "`.catch(() => setInfo({ wifi: { rede: null … } }))` transforma «não consegui " +
        "perguntar» na **afirmação** de que não há WiFi, morada, telefone nem horário. " +
        "Desenhá-los igual é uma decisão; reescrever um como o outro é um defeito (6.5)",
    ).not.toEqual(configurado.final);

    expect(
      contemChave(falhado.final, ["rede", "password", "horario", "morada", "telefone"]),
      "o estado de «falhou» não pode carregar um payload inventado: a F3-06 herda " +
        "estes três estados e precisa deles separados",
    ).toBeNull();
  });

  it("«ainda não respondeu» também é um estado à parte", async () => {
    pedirInfo.mockResolvedValue(INFO_COM_WIFI);
    const { inicial, final } = await desenharOApp();

    expect(
      inicial,
      "enquanto o pedido está no ar, a Folha mostra esqueleto e não manda ninguém ao " +
        "balcão (6.4) — por isso este estado não pode nascer igual a nenhum dos outros",
    ).not.toEqual(final);
    expect(contemChave(inicial, ["rede", "password"])).toBeNull();
  });
});
