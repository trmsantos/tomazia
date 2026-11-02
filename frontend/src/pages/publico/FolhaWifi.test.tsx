/**
 * F3-03, 13.3 — a Folha do WiFi, com os cinco estados do `/info` e os três
 * caminhos da cópia.
 *
 * Contrato que este ficheiro fixa:
 *
 * ```tsx
 * // src/pages/publico/FolhaWifi.tsx
 * export function FolhaWifi({ aberta, info, aoFechar }: {
 *   aberta: boolean;
 *   info: EstadoDoInfo;      // o mesmo tipo do `Cabecalho`
 *   aoFechar: () => void;
 * }): ReactElement;
 * ```
 *
 * Desenha a `Folha` (F3-01) com o título "WiFi" e, lá dentro, uma de três
 * coisas: o esqueleto com `aria-busy` enquanto o `/info` vem a caminho; a
 * rede, a password grande e o "Copiar password" quando as duas estão
 * configuradas; ou "Pergunta no balcão." nos outros três casos.
 *
 * **O que este ficheiro prova:** que sem `navigator.clipboard` não há botão;
 * que com a API a recusar aparece a frase de falha e o botão continua lá;
 * que com a API a aceitar aparece "Password copiada." e o que foi escrito na
 * área de transferência é **igual caractere a caractere** ao que veio da API,
 * incluindo o espaço no fim (critério S-09); que dois toques dão dois
 * anúncios; que a mensagem não tem temporizador e vai-se embora com a Folha;
 * que sem `rede`, sem `password` e com o pedido falhado a Folha mostra
 * "Pergunta no balcão." e mais nada; que com o pedido ainda no ar ela está
 * `aria-busy` e **não** manda ninguém ao balcão; e que em estado nenhum o
 * site afirma que este bar não tem WiFi.
 *
 * **O que deixa passar:** que a linha viva esteja no sítio certo do ecrã e
 * que se veja por cima da cortina; que a password quebre onde calha e se
 * selecione com um toque; e que o lugar da linha esteja reservado antes de a
 * mensagem chegar. Tudo isso é layout — é `e2e/cabecalho.spec.ts` e é a
 * captura.
 *
 * O `<dialog>` do jsdom não prende o foco, não fecha com `Esc` e não desenha
 * `::backdrop` (ver `src/testes/dialogo-jsdom.ts`): isso é do browser e do
 * componente `Folha`, e está provado em `e2e/componentes.spec.ts`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  A_CARREGAR,
  FRASES_QUE_O_SITE_NAO_DIZ,
  ID_DA_PASSWORD,
  INFO_COM_WIFI,
  LEITURAS_QUE_MANDAM_AO_BALCAO,
  PASSWORD_DE_TESTE,
  REDE_DE_TESTE,
  TEXTOS_DO_WIFI,
  instalarAreaDeTransferencia,
  pronto,
} from "../../testes/cabecalho";
import type { AreaDeTransferenciaFalsa, EstadoDoInfo } from "../../testes/cabecalho";
import { FolhaWifi } from "./FolhaWifi";

/** Procurar sem colapsar o espaço: a password de teste acaba num espaço. */
const TAL_E_QUAL = { normalizer: (texto: string) => texto };

let areaDeTransferencia: AreaDeTransferenciaFalsa | null = null;

function comAreaDeTransferencia(
  comportamento: "aceita" | "recusa" | "ausente",
): AreaDeTransferenciaFalsa {
  areaDeTransferencia = instalarAreaDeTransferencia(comportamento);
  return areaDeTransferencia;
}

beforeEach(() => {
  areaDeTransferencia = null;
});

afterEach(() => {
  areaDeTransferencia?.restaurar();
  vi.useRealTimers();
});

function desenhar(info: EstadoDoInfo, aoFechar = (): void => undefined) {
  return render(<FolhaWifi aberta info={info} aoFechar={aoFechar} />);
}

function folha(): HTMLElement {
  return screen.getByRole("dialog");
}

/** O botão de copiar, ou `null` — a ausência dele é uma asserção (8.1). */
function botaoDeCopiar(): HTMLElement | null {
  return screen.queryByRole("button", { name: TEXTOS_DO_WIFI.copiar });
}

/**
 * Carregar em "Copiar password", com o guarda da regra 10 à frente.
 *
 * Sem ele, uma Folha sem botão falhava com «Unable to fire a "click" event»,
 * que é uma mensagem sobre a Testing Library e não sobre o ecrã: "o botão não
 * copiou" e "não havia botão nenhum" são defeitos diferentes e têm de ler-se
 * diferentes.
 */
function copiar(): void {
  const botao = botaoDeCopiar();
  expect(
    botao,
    `não encontrei o botão «${TEXTOS_DO_WIFI.copiar}» — isto é a ausência do botão, ` +
      "não uma cópia falhada",
  ).not.toBeNull();
  if (botao === null) return;
  fireEvent.click(botao);
}

function linhaViva(): HTMLElement {
  return within(folha()).getByRole("status");
}

describe("com a rede e a password configuradas", () => {
  /**
   * **Prova:** a escada de 7.1 — a etiqueta, a rede e a password — e que a
   * password chega ao ecrã **tal e qual** veio da API, com o espaço no fim.
   *
   * **Deixa passar:** os três tamanhos (14 → 21 → 34). É CSS, e em jsdom
   * não há tamanho nenhum.
   */
  it("mostra a rede, a password inteira e o botão de copiar", () => {
    comAreaDeTransferencia("aceita");
    desenhar(pronto(INFO_COM_WIFI));

    const dentro = within(folha());
    expect(dentro.getByText(TEXTOS_DO_WIFI.rede)).toBeInTheDocument();
    expect(dentro.getByText(REDE_DE_TESTE)).toBeInTheDocument();
    expect(dentro.getByText(TEXTOS_DO_WIFI.password)).toBeInTheDocument();

    const password = dentro.getByText(PASSWORD_DE_TESTE, TAL_E_QUAL);
    expect(
      password.textContent,
      "a password sai da API como está guardada, sem aparar (S-09): um espaço no fim " +
        "é invisível no ecrã e vai inteiro para a área de transferência",
    ).toBe(PASSWORD_DE_TESTE);
    expect(
      password.id,
      "a password precisa de `id` próprio: é ela que o e2e mede, e pelo texto não se " +
        "lhe chega (o espaço do fim é normalizado antes da comparação)",
    ).toBe(ID_DA_PASSWORD);

    expect(botaoDeCopiar()).toBeInTheDocument();
  });

  /**
   * **Prova:** que a password não é um campo de formulário.
   *
   * No iOS um `<input readonly>` abre o teclado, e um valor com ar de
   * editável num bar é um valor que alguém vai tentar mudar (7.2).
   */
  it("a password não é um campo editável", () => {
    comAreaDeTransferencia("aceita");
    desenhar(pronto(INFO_COM_WIFI));

    expect(folha().querySelector("input, textarea")).toBeNull();
  });

  /**
   * **Prova:** que a linha viva existe **vazia** desde a primeira pintura.
   *
   * É a lição da F3-01, 7.5: uma região viva inserida já com texto muitas
   * vezes não é anunciada. Quem a inserir só quando há mensagem tem um
   * teste verde no ecrã e um leitor de ecrã calado.
   */
  it("a linha viva está no DOM desde o início, e vazia", () => {
    comAreaDeTransferencia("aceita");
    desenhar(pronto(INFO_COM_WIFI));

    expect(linhaViva().textContent?.trim()).toBe("");
  });
});

describe("«Copiar password», os três caminhos", () => {
  /**
   * **Prova:** que sem API de cópia **não há botão**, e que a password
   * continua grande e no ecrã.
   *
   * Uma ação que se sabe de antemão que não pode funcionar não se oferece —
   * e é outra vez a forma da regra 10: "tentei e não consegui" e "aqui não
   * se copia" são coisas diferentes e dão resultados diferentes (8.1).
   */
  it("sem `navigator.clipboard` não há botão, e a password fica", () => {
    comAreaDeTransferencia("ausente");
    desenhar(pronto(INFO_COM_WIFI));

    expect(
      botaoDeCopiar(),
      "em `http://` a partir de um IP da rede local — tipicamente o dono, do balcão " +
        "— a API não existe, e um botão que não pode funcionar não se mostra (8.1)",
    ).toBeNull();
    expect(within(folha()).getByText(PASSWORD_DE_TESTE, TAL_E_QUAL)).toBeInTheDocument();
  });

  /**
   * **Prova:** que a cópia entrega a password **caractere a caractere** e
   * que a confirmação aparece na linha viva.
   *
   * **Deixa passar:** que a área de transferência do sistema fique mesmo
   * com aquilo. Isso é do browser.
   */
  it("com a API a aceitar, copia o valor exacto e diz «Password copiada.»", async () => {
    const area = comAreaDeTransferencia("aceita");
    desenhar(pronto(INFO_COM_WIFI));

    copiar();

    await waitFor(() => {
      expect(linhaViva().textContent).toBe(TEXTOS_DO_WIFI.copiou);
    });
    expect(
      area.escrito,
      "o que vai para a área de transferência é o que o dono gravou, incluindo o " +
        "espaço no fim que no ecrã não se vê (S-09)",
    ).toEqual([PASSWORD_DE_TESTE]);
  });

  /**
   * **Prova:** que uma recusa da API diz onde está a password, que o botão
   * fica como estava e que a password continua no ecrã.
   *
   * A frase diz **onde está a password**, não o que fazer ao browser: a
   * pessoa está à mesa, no escuro, prestes a escrever dezasseis caracteres
   * à mão (10, nota 4).
   */
  it("com a API a recusar, diz onde a password está e o botão continua lá", async () => {
    comAreaDeTransferencia("recusa");
    desenhar(pronto(INFO_COM_WIFI));

    copiar();

    await waitFor(() => {
      expect(linhaViva().textContent).toBe(TEXTOS_DO_WIFI.naoCopiou);
    });
    expect(botaoDeCopiar(), "pronto para outra tentativa (8.1)").toBeInTheDocument();
    expect(botaoDeCopiar()).not.toBeDisabled();
    expect(within(folha()).getByText(PASSWORD_DE_TESTE, TAL_E_QUAL)).toBeInTheDocument();
  });

  /**
   * **Prova:** que a falha é anunciada como estado e não como alerta.
   *
   * Nada se perdeu e a password continua no ecrã: um `alert` interrompia a
   * leitura da password para dizer que a password não foi copiada, que é o
   * pior momento possível para interromper. E trocar o `role` do mesmo nó
   * entre uma coisa e outra é um defeito por si só (8.3).
   */
  it("a falha usa a mesma região viva, e não um alerta", async () => {
    comAreaDeTransferencia("recusa");
    desenhar(pronto(INFO_COM_WIFI));

    copiar();
    await screen.findByText(TEXTOS_DO_WIFI.naoCopiou);

    expect(within(folha()).queryAllByRole("alert")).toEqual([]);
    expect(within(folha()).getAllByRole("status")).toHaveLength(1);
  });

  /**
   * **Prova:** que o segundo toque volta a ser anunciado.
   *
   * Escrever o mesmo texto numa região viva que já o tem não anuncia nada —
   * o leitor de ecrã não vê mudança nenhuma porque não **há** mudança
   * nenhuma no DOM. O critério é o resultado: dois toques, duas alterações
   * da região (8.4).
   *
   * **Deixa passar:** que o anúncio seja mesmo feito. Nenhum teste em jsdom
   * ouve um leitor de ecrã; o que se mede é a condição sem a qual ele
   * nunca falaria.
   */
  it("dois toques dão dois anúncios", async () => {
    comAreaDeTransferencia("aceita");
    desenhar(pronto(INFO_COM_WIFI));

    copiar();
    await screen.findByText(TEXTOS_DO_WIFI.copiou);

    const casa = linhaViva().parentElement;
    expect(casa, "não encontrei o lugar da linha viva — não verifiquei nada").not.toBeNull();
    if (casa === null) return;

    const alteracoes: MutationRecord[] = [];
    const observador = new MutationObserver((registos) => alteracoes.push(...registos));
    observador.observe(casa, { childList: true, characterData: true, subtree: true });

    copiar();

    try {
      await waitFor(() => {
        expect(
          alteracoes.length,
          "a região viva não mudou ao segundo toque: escrever o mesmo texto onde ele " +
            "já está não anuncia nada, e quem carregou outra vez não ouve resposta (8.4)",
        ).toBeGreaterThan(0);
      });
    } finally {
      observador.disconnect();
    }

    expect(linhaViva().textContent).toBe(TEXTOS_DO_WIFI.copiou);
  });
});

describe("quanto tempo a mensagem fica", () => {
  /**
   * **Prova:** que não há temporizador nenhum — a mensagem de falha
   * continua lá um minuto depois.
   *
   * É a que não pode desaparecer: quem não conseguiu copiar está prestes a
   * escrever dezasseis caracteres à mão, e a frase que lhe diz onde eles
   * estão era a primeira a sumir-se (8.4).
   */
  it("a mensagem de falha não se vai embora sozinha", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    comAreaDeTransferencia("recusa");
    desenhar(pronto(INFO_COM_WIFI));

    copiar();
    await screen.findByText(TEXTOS_DO_WIFI.naoCopiou);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(
      linhaViva().textContent,
      "uma mensagem que desaparece sozinha abre a conversa do WCAG 2.2.1 e aqui não " +
        "compra nada: quem fecha a Folha é a pessoa (8.4)",
    ).toBe(TEXTOS_DO_WIFI.naoCopiou);
  });

  /**
   * **Prova:** que a mensagem vai com a Folha. Reabrir dá uma linha vazia,
   * não a resposta da visita anterior.
   */
  it("fechar a Folha leva a mensagem com ela", async () => {
    comAreaDeTransferencia("aceita");
    const { rerender } = desenhar(pronto(INFO_COM_WIFI));

    copiar();
    await screen.findByText(TEXTOS_DO_WIFI.copiou);

    rerender(<FolhaWifi aberta={false} info={pronto(INFO_COM_WIFI)} aoFechar={() => undefined} />);
    rerender(<FolhaWifi aberta info={pronto(INFO_COM_WIFI)} aoFechar={() => undefined} />);

    expect(linhaViva().textContent?.trim()).toBe("");
  });
});

describe("sem rede, sem password, ou com o pedido falhado", () => {
  /**
   * **Prova:** que os três estados dão a mesma folha: uma frase só.
   *
   * Sem etiquetas e sem valores vazios — etiquetas com nada por baixo são
   * duas vagas por preencher, e a Folha passaria a parecer um formulário a
   * meio em vez de uma resposta (7.3). E sem botão de copiar, porque não há
   * nada para copiar.
   */
  it("dizem «Pergunta no balcão.» e mais nada", () => {
    for (const leitura of LEITURAS_QUE_MANDAM_AO_BALCAO) {
      comAreaDeTransferencia("aceita");
      const { unmount } = desenhar(leitura.info);
      const dentro = within(folha());

      expect(
        dentro.getByText(TEXTOS_DO_WIFI.perguntaNoBalcao),
        `${leitura.nome}: é a mesma frase da ementa vazia, e é a voz do site para ` +
          "tudo o que ele não sabe (7.3)",
      ).toBeInTheDocument();
      expect(
        dentro.queryByText(TEXTOS_DO_WIFI.rede),
        `${leitura.nome}: sem etiquetas — uma etiqueta sem valor é uma vaga por preencher`,
      ).toBeNull();
      expect(dentro.queryByText(TEXTOS_DO_WIFI.password)).toBeNull();
      expect(botaoDeCopiar(), `${leitura.nome}: não há nada para copiar`).toBeNull();

      // O único botão que fica é o «×» da Folha, que é do componente.
      const botoes = dentro.getAllByRole("button").map((botao) => botao.getAttribute("aria-label"));
      expect(botoes).toEqual([TEXTOS_DO_WIFI.fechar]);

      unmount();
      areaDeTransferencia?.restaurar();
    }
  });

  /**
   * **Prova, pela negativa:** que em estado nenhum a Folha afirma que este
   * bar não tem WiFi.
   *
   * `null` é "não sei". "Não há WiFi", "sem password" ou "rede aberta" são
   * afirmações sobre o negócio, e só o dono as pode fazer (10, nota 5). É a
   * linha que o botão sempre presente **não** pode fazer o site atravessar.
   */
  it("em lado nenhum se diz que o bar não tem WiFi", () => {
    const todas = [...LEITURAS_QUE_MANDAM_AO_BALCAO, { nome: "a carregar", info: A_CARREGAR }];

    for (const leitura of todas) {
      comAreaDeTransferencia("aceita");
      const { unmount } = desenhar(leitura.info);
      const texto = folha().textContent ?? "";

      for (const frase of FRASES_QUE_O_SITE_NAO_DIZ) {
        expect(
          frase.test(texto),
          `${leitura.nome}: a Folha diz «${texto.trim()}», e ${String(frase)} é uma ` +
            "afirmação sobre o bar que só o dono pode fazer",
        ).toBe(false);
      }

      unmount();
      areaDeTransferencia?.restaurar();
    }
  });
});

describe("enquanto o `/info` vem a caminho", () => {
  /**
   * **Prova:** que este é o estado que **não** colapsa com os outros: há
   * `aria-busy`, não há botão, e não se manda ninguém ao balcão.
   *
   * A janela é curta e é real: o pedido parte ao montar, e numa ligação de
   * dados móveis fracos ainda está no ar quando alguém toca no botão.
   * Mandar essa pessoa ao balcão meio segundo antes de a password chegar é
   * o único erro que esta Folha pode cometer sozinha (6.4).
   *
   * **Deixa passar:** a forma do esqueleto. Que ele tenha a forma do que
   * vem a seguir vê-se na captura, não aqui.
   */
  it("mostra um esqueleto com `aria-busy` e não manda ninguém ao balcão", () => {
    comAreaDeTransferencia("aceita");
    desenhar(A_CARREGAR);

    expect(
      folha().querySelector('[aria-busy="true"]'),
      "a carregar leva `aria-busy`, como a ementa (6.4)",
    ).not.toBeNull();
    expect(
      within(folha()).queryByText(TEXTOS_DO_WIFI.perguntaNoBalcao),
      "o passo seguinte da pessoa aqui não é ir ao balcão — é esperar meio segundo, " +
        "e nós sabemos disso (6.4)",
    ).toBeNull();
    expect(botaoDeCopiar(), "ainda não há password para copiar").toBeNull();
  });
});
