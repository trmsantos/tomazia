/**
 * F3-04, 12.1 — a data de um evento, em Lisboa, com o relógio preso.
 *
 * Contrato que este ficheiro define e que `data-do-evento.ts` tem de cumprir:
 *
 * ```ts
 * export type DataDoEvento = { grande: string; pequena: string };
 * export function formatarDataDoEvento(inicio: string, agora: Date): DataDoEvento;
 * export const DIAS_DA_SEMANA: readonly string[];  // 7, minúsculas, 0 = domingo
 * export const MESES: readonly string[];           // 12, minúsculas, 0 = janeiro
 * ```
 *
 * `grande` é a linha em letra de título a 34 px; `pequena` é a de 14 px por baixo.
 * A função é **pura**: recebe o `agora` e nunca lê `Date.now()` (5.6). É isso
 * que a torna testável com relógio fixo, e é a mesma escolha que o
 * `inicio_do_dia_do_bar` do backend já fez do outro lado.
 *
 * **Porque é que quase tudo desta tarefa se verifica aqui:** é aqui que vive
 * quase toda a decisão. As seis formas de 5.2, as duas fronteiras (os 7 dias
 * e o ano), o fuso de Lisboa contra o do aparelho, os dois dias de mudança de
 * hora e a prova que fecha a janela dos 6 dias — tudo isto é a cadeia de
 * caracteres que sai daqui.
 *
 * **O que este ficheiro inteiro deixa passar:** tudo o que não seja a cadeia
 * de caracteres. Não sabe que a data é a maior coisa do cartão, não sabe em
 * que `<span>` ela cai, não sabe se o componente a chama com o `agora` certo
 * em vez de um `Date.now()` escondido lá dentro, e não sabe se alguma destas
 * cadeias chega sequer ao ecrã. Isso é `Eventos.test.tsx` e `eventos.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DIAS_ESPERADOS,
  MESES_ESPERADOS,
  aPartirDas,
  comMaiuscula,
  comecouAs,
  dataPorExtenso,
  diaEHora,
} from "../../testes/eventos";
import { comOFusoDoAparelhoEm } from "../../testes/fuso";
import { DIAS_DA_SEMANA, MESES, formatarDataDoEvento } from "./data-do-evento";

/** 2 de novembro de 2026, segunda-feira, 10:00 em Lisboa (UTC+0 em novembro). */
const SEGUNDA_DE_MANHA = new Date("2026-11-02T10:00:00Z");

/**
 * Trocar o `Intl.DateTimeFormat` do processo e **recarregar o módulo** por
 * baixo dele.
 *
 * O recarregamento não é zelo: o formatador constrói-se uma vez, ao carregar
 * o módulo (5.4), e um espião posto depois do `import` nunca via essa
 * chamada — o teste passaria a verde sem ter olhado para nada.
 *
 * A reposição é num `finally` porque um `Intl` partido que ficasse de pé
 * levava à frente todos os testes seguintes deste ficheiro, com mensagens
 * sobre outra coisa qualquer.
 */
async function comODateTimeFormatTrocado(
  substituto: typeof Intl.DateTimeFormat,
  correr: (modulo: typeof import("./data-do-evento")) => void | Promise<void>,
): Promise<void> {
  const real = Intl.DateTimeFormat;
  Intl.DateTimeFormat = substituto;
  vi.resetModules();
  try {
    await correr(await import("./data-do-evento"));
  } finally {
    Intl.DateTimeFormat = real;
    vi.resetModules();
  }
}

/** Um `Intl.DateTimeFormat` que funciona e que aponta o que lhe pedem. */
function espiarOsFormatadores(): {
  opcoes: Intl.DateTimeFormatOptions[];
  substituto: typeof Intl.DateTimeFormat;
} {
  const opcoes: Intl.DateTimeFormatOptions[] = [];
  const real = Intl.DateTimeFormat;

  const substituto = new Proxy(real, {
    construct: (_alvo, argumentos) => {
      opcoes.push((argumentos[1] as Intl.DateTimeFormatOptions | undefined) ?? {});
      return new real(
        argumentos[0] as Intl.LocalesArgument,
        argumentos[1] as Intl.DateTimeFormatOptions,
      );
    },
    apply: (_alvo, _este, argumentos) => {
      opcoes.push((argumentos[1] as Intl.DateTimeFormatOptions | undefined) ?? {});
      return real(
        argumentos[0] as Intl.LocalesArgument,
        argumentos[1] as Intl.DateTimeFormatOptions,
      );
    },
  });

  return { opcoes, substituto };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("as seis formas da data (5.2)", () => {
  it("hoje, antes de começar: «Hoje» e a hora prometida", () => {
    // Deixa passar: a troca ao segundo (é o teste a seguir) e tudo o que seja
    // o ecrã. Uma função que devolvesse sempre «Hoje» passava aqui.
    expect(formatarDataDoEvento("2026-11-02T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: "Hoje",
      pequena: aPartirDas("22:00"),
    });
  });

  it("hoje, já começado: «Começou às», e a troca é ao segundo", () => {
    // O limiar é o instante, não a hora cheia nem o dia (5.3). Três chamadas:
    // um segundo antes, no instante exato, e um segundo depois.
    //
    // Deixa passar: um limiar que use `>` em vez de `>=` **e** que erre por
    // menos de um segundo — não há cá milissegundos a meio.
    const inicio = "2026-11-02T22:00:00Z";

    expect(
      formatarDataDoEvento(inicio, new Date("2026-11-02T21:59:59Z")).pequena,
      "um segundo antes ainda é uma promessa",
    ).toBe(aPartirDas("22:00"));

    expect(
      formatarDataDoEvento(inicio, new Date("2026-11-02T22:00:00Z")).pequena,
      "no instante exato já começou: o contrato é `agora >= inicio` (5.3)",
    ).toBe(comecouAs("22:00"));

    expect(formatarDataDoEvento(inicio, new Date("2026-11-02T22:00:01Z")).pequena).toBe(
      comecouAs("22:00"),
    );
  });

  it("um evento das 00:30 ainda se lê «Começou às 00:30» às 18:00 (5.3)", () => {
    // É o caso que recusou o "É agora": o ADR 0010 mantém o evento visível
    // todo o dia civil, por isso a frase tem de continuar verdadeira dezassete
    // horas e meia depois.
    //
    // Deixa passar: uma implementação que escrevesse "Começou" a partir de
    // qualquer hora do dia, mesmo antes do início. Isso é o teste de cima.
    expect(formatarDataDoEvento("2026-11-02T00:30:00Z", new Date("2026-11-02T18:00:00Z"))).toEqual({
      grande: "Hoje",
      pequena: comecouAs("00:30"),
    });
  });

  it("amanhã: «Amanhã», e o nome do dia não aparece", () => {
    // Deixa passar: um `d` calculado em horas que por acaso acerte neste caso
    // (são 36 horas de diferença). O caso que o apanha está em «dias civis».
    expect(formatarDataDoEvento("2026-11-03T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: "Amanhã",
      pequena: aPartirDas("22:00"),
    });
  });

  it("de 2 a 6 dias: o nome do dia sozinho, com maiúscula de início de linha", () => {
    // `d = 2` (quarta) e `d = 6` (domingo): **os dois lados de dentro** da
    // janela. A fronteira de cima está no teste a seguir.
    //
    // Deixa passar: o nome vir do browser em vez da nossa tabela — em Node com
    // ICU completo as duas dão a mesma palavra. É o teste da tabela que o vê.
    expect(formatarDataDoEvento("2026-11-04T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: "Quarta-feira",
      pequena: aPartirDas("22:00"),
    });

    expect(formatarDataDoEvento("2026-11-08T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: "Domingo",
      pequena: aPartirDas("22:00"),
    });
  });

  it("aos 7 dias a janela fecha: data por extenso em cima, dia da semana em baixo", () => {
    // **Os dois lados da fronteira, ou ela não está testada** (12.1): `d = 6`
    // ainda é nome de dia, `d = 7` já é data. O 8 de novembro é domingo e o 9
    // é segunda-feira, por isso a troca não se pode confundir com uma troca de
    // semana.
    //
    // Deixa passar: a escolha do mês por extenso contra o mês em número — isso
    // é a tabela dos meses, mais abaixo.
    expect(formatarDataDoEvento("2026-11-08T22:00:00Z", SEGUNDA_DE_MANHA).grande).toBe("Domingo");

    expect(formatarDataDoEvento("2026-11-09T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: dataPorExtenso(9, "novembro"),
      pequena: diaEHora("segunda-feira", "22:00"),
    });
  });

  it("o exemplo que acompanha a especificação, as três linhas (5.2)", () => {
    // Deixa passar: nada que os testes de cima já não deixem. Está aqui porque
    // é o bloco que a especificação escreve à letra, e um teste que o copie é
    // o que torna a especificação verificável em vez de ilustrativa.
    expect(formatarDataDoEvento("2026-11-05T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: "Quinta-feira",
      pequena: aPartirDas("22:00"),
    });

    expect(formatarDataDoEvento("2026-11-19T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: dataPorExtenso(19, "novembro"),
      pequena: diaEHora("quinta-feira", "22:00"),
    });

    expect(formatarDataDoEvento("2026-12-17T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: dataPorExtenso(17, "dezembro"),
      pequena: diaEHora("quinta-feira", "22:00"),
    });
  });
});

describe("a fronteira do ano (5.2, sexta forma)", () => {
  /** 29 de dezembro de 2026, terça-feira, 10:00 em Lisboa. */
  const VESPERA_DO_ANO_NOVO = new Date("2026-12-29T10:00:00Z");

  it("dentro do ano corrente não há ano nenhum impresso", () => {
    // Relógio a 1 de dezembro para haver um `d >= 7` que ainda cai em 2026 —
    // a 29 de dezembro já não existe nenhum. O 20 de dezembro é domingo.
    //
    // Deixa passar: um ano impresso só a partir de doze meses de distância,
    // que é a regra errada que isto exclui. O caso que a apanha é o seguinte.
    expect(formatarDataDoEvento("2026-12-20T22:00:00Z", new Date("2026-12-01T10:00:00Z"))).toEqual({
      grande: dataPorExtenso(20, "dezembro"),
      pequena: diaEHora("domingo", "22:00"),
    });
  });

  it("fora do ano corrente o ano aparece — e o 31 de dezembro ao lado não o leva", () => {
    // Os dois lados, com o mesmo relógio: a 29 de dezembro, o 31 é `d = 2` e
    // sai «Quinta-feira» (o ano só entra quando a data por extenso já entrou);
    // o 20 de janeiro é `d = 22` e leva `de 2027`.
    //
    // Deixa passar: a regra ser "o ano do evento é diferente do ano de hoje"
    // lida no fuso **do aparelho** em vez do de Lisboa. São três horas por
    // ano, e têm teste próprio em «o fuso do aparelho».
    expect(formatarDataDoEvento("2026-12-31T22:00:00Z", VESPERA_DO_ANO_NOVO).grande).toBe(
      "Quinta-feira",
    );

    expect(formatarDataDoEvento("2027-01-20T22:00:00Z", VESPERA_DO_ANO_NOVO)).toEqual({
      grande: dataPorExtenso(20, "janeiro", 2027),
      pequena: diaEHora("quarta-feira", "22:00"),
    });
  });

  it("a passagem de ano da fixtura: «1 de janeiro de 2027», sexta-feira, 00:30", () => {
    // Deixa passar: nada de novo. É o cartão que a `QUATRO_EVENTOS` corta, e
    // está aqui porque é o único sítio onde a sexta forma e a hora depois da
    // meia-noite se vêem juntas.
    expect(formatarDataDoEvento("2027-01-01T00:30:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: dataPorExtenso(1, "janeiro", 2027),
      pequena: diaEHora("sexta-feira", "00:30"),
    });
  });
});

describe("o `d` conta dias civis de Lisboa, não horas (5.4)", () => {
  it("duas horas de distância, e são «Hoje» e «Amanhã»", () => {
    // 23:00 de hoje e 01:00 de amanhã: duas horas uma da outra. Uma conta em
    // horas dá `d = 0` para o segundo e escreve «Hoje» sobre o dia seguinte.
    //
    // Deixa passar: a conta em horas feita sobre as **meias-noites** de Lisboa
    // em vez dos instantes — essa só se parte nos dias de mudança de hora, e
    // é o que os dois testes a seguir fazem.
    const agora = new Date("2026-11-02T22:00:00Z");

    expect(formatarDataDoEvento("2026-11-02T23:00:00Z", agora).grande).toBe("Hoje");
    expect(formatarDataDoEvento("2026-11-03T01:00:00Z", agora).grande).toBe("Amanhã");
  });

  it("29 de março de 2026: o dia de 23 horas não transforma «Amanhã» em «Hoje»", () => {
    // Lisboa adianta às 01:00 UTC do dia 29. Da meia-noite do 29 à meia-noite
    // do 30 vão **23 horas reais**: um `(b - a) / 86400000` sobre instantes
    // devolve 0,958, que arredondado para baixo é 0 — e o cartão de amanhã
    // passa a dizer «Hoje», uma vez por ano, no dia em que ninguém está a
    // olhar para isto.
    //
    // Deixa passar: a hora mostrada estar certa — está no teste do verão.
    const agora = new Date("2026-03-29T12:00:00Z"); // 13:00 WEST, domingo

    expect(formatarDataDoEvento("2026-03-30T21:00:00Z", agora)).toEqual({
      grande: "Amanhã",
      pequena: aPartirDas("22:00"),
    });
  });

  it("25 de outubro de 2026: o dia de 25 horas também não", () => {
    // O simétrico do anterior: 1,042 em vez de 0,958. E no mesmo relógio, um
    // evento desse dia continua a ser «Hoje» — é o par que mostra que o
    // problema é a conta e não o dia.
    //
    // Deixa passar: um `(b - a) / 86400000` sobre instantes **arredondado**.
    // Os dois domingos erram por ±0,042, que o `Math.round` corrige, por isso
    // este teste e o de março passam os dois com essa conta. Quem a apanha é
    // o caso de hoje às 22:00 visto às 10:00: meio dia de distância, que o
    // mesmo arredondamento escreve «Amanhã».
    const agora = new Date("2026-10-25T12:00:00Z"); // 12:00 WET, domingo

    expect(formatarDataDoEvento("2026-10-26T22:00:00Z", agora).grande).toBe("Amanhã");
    expect(formatarDataDoEvento("2026-10-25T22:00:00Z", agora).grande).toBe("Hoje");
  });
});

describe("as palavras vêm da nossa tabela, não do browser (5.4)", () => {
  it("os sete dias e os doze meses são os da especificação, por ordem", () => {
    // A tabela do código contra a cópia do teste. É o que torna impossível
    // mudar uma palavra no código sem passar pela secção 9 — e, por aí, pelo
    // dominio-bar e pela varredura do Q-05.
    //
    // Deixa passar: o código ter a tabela certa e **não a usar**. Isso é o
    // teste do espião, a seguir.
    expect(DIAS_DA_SEMANA).toEqual([...DIAS_ESPERADOS]);
    expect(MESES).toEqual([...MESES_ESPERADOS]);
  });

  it("nenhum formatador é construído a pedir palavras ao ICU", async () => {
    // O espião apanha a implementação que pede `weekday: "long"` ou
    // `month: "long"` ao `Intl`. Num aparelho com ICU reduzido isso devolve
    // "Thursday" e "December" no meio da página, o CI nunca o apanha — o Node
    // tem ICU completo — e a varredura de texto também não, porque a palavra
    // não está escrita em ficheiro nenhum nosso. É o defeito que não deixa
    // rasto em lado nenhum.
    //
    // Deixa passar: pedir as palavras por outra via que não o
    // `Intl.DateTimeFormat` — `toLocaleDateString`, por exemplo. Essa escreve
    // palavras diferentes das da tabela e o teste de cima apanha-a.
    const espiao = espiarOsFormatadores();

    await comODateTimeFormatTrocado(espiao.substituto, (modulo) => {
      modulo.formatarDataDoEvento("2026-11-09T22:00:00Z", SEGUNDA_DE_MANHA);

      expect(
        espiao.opcoes.length,
        "nenhum `Intl.DateTimeFormat` foi construído: ou o espião não pegou, ou a " +
          "data está a sair de `getDate()`/`getHours()`, que lê o fuso do aparelho " +
          "(5.4). Nos dois casos este teste não verificou nada.",
      ).toBeGreaterThan(0);

      const comPalavras = espiao.opcoes.filter(
        (opcoes) =>
          opcoes.weekday !== undefined || opcoes.month === "long" || opcoes.month === "short",
      );

      expect(
        comPalavras,
        "um formatador pediu palavras ao ICU. Os nomes dos dias e dos meses são " +
          "uma tabela nossa (5.4): num aparelho com ICU reduzido isto escreve " +
          "«Thursday» no meio de uma página em português e nada no CI o vê.",
      ).toEqual([]);
    });
  });

  it("todo o formatador leva `timeZone: «Europe/Lisbon»`", async () => {
    // O outro lado da mesma moeda: um formatador sem `timeZone` lê o fuso do
    // aparelho e dá a data certa em Lisboa e errada em todo o lado.
    //
    // Deixa passar: o `hourCycle`. Um `h12` escreveria "10:00 PM" e isso
    // apanha-se nas cadeias dos testes de cima.
    const espiao = espiarOsFormatadores();

    await comODateTimeFormatTrocado(espiao.substituto, (modulo) => {
      modulo.formatarDataDoEvento("2026-11-09T22:00:00Z", SEGUNDA_DE_MANHA);

      expect(
        espiao.opcoes.length,
        "nenhum formatador construído: não verifiquei nada",
      ).toBeGreaterThan(0);
      expect(espiao.opcoes.map((opcoes) => opcoes.timeZone)).toEqual(
        espiao.opcoes.map(() => "Europe/Lisbon"),
      );
    });
  });
});

describe("o fuso do aparelho não é o de Lisboa (12.1)", () => {
  /**
   * Os casos que têm de dar o mesmo em qualquer parte do mundo.
   *
   * Dois de verão, de propósito: **um evento no inverno não prova nada sobre
   * o fuso**, porque em novembro e em janeiro Lisboa e UTC são o mesmo valor
   * (o ADR 0010 já o diz do lado do backend). O de 17 de julho às 00:30 é o
   * mais afiado: em UTC é ainda dia 16, por isso uma implementação que leia o
   * instante em UTC escreve «Hoje» e «Começou às 23:30» sobre um evento que em
   * Lisboa é amanhã e ainda não começou.
   */
  const CASOS = [
    {
      nome: "verão: 22:00 de Lisboa é 21:00 em UTC",
      inicio: "2026-07-16T21:00:00Z",
      agora: new Date("2026-07-14T10:00:00Z"),
      esperado: { grande: "Quinta-feira", pequena: aPartirDas("22:00") },
    },
    {
      nome: "verão: 00:30 de 17 de julho é ainda dia 16 em UTC",
      inicio: "2026-07-16T23:30:00Z",
      agora: new Date("2026-07-16T10:00:00Z"),
      esperado: { grande: "Amanhã", pequena: aPartirDas("00:30") },
    },
    {
      nome: "inverno: o caso de controlo, que em Lisboa acerta sempre",
      inicio: "2026-11-05T22:00:00Z",
      agora: SEGUNDA_DE_MANHA,
      esperado: { grande: "Quinta-feira", pequena: aPartirDas("22:00") },
    },
  ];

  for (const fuso of ["Pacific/Kiritimati", "America/Los_Angeles", "Europe/Lisbon"]) {
    describe(fuso, () => {
      for (const caso of CASOS) {
        it(caso.nome, () => {
          // Deixa passar: nada de novo em Lisboa — e é esse o ponto. Em
          // Lisboa uma implementação errada acerta, por isso o `Europe/Lisbon`
          // está na lista como controlo e os outros dois é que verificam.
          comOFusoDoAparelhoEm(fuso, () => {
            expect(formatarDataDoEvento(caso.inicio, caso.agora)).toEqual(caso.esperado);
          });
        });
      }
    });
  }

  it("o ano corrente é o de Lisboa, e não o do aparelho (−8)", () => {
    // 1 de janeiro de 2027, 00:30 em Lisboa. Num telemóvel em Los Angeles
    // ainda é 31 de dezembro de 2026, e um `agora.getFullYear()` devolve 2026:
    // o evento de 20 de janeiro de 2027 passaria a levar ano quando não devia.
    //
    // Deixa passar: o mesmo erro no **ano do evento** — está no caso seguinte,
    // pelo outro lado.
    comOFusoDoAparelhoEm("America/Los_Angeles", () => {
      expect(
        formatarDataDoEvento("2027-01-20T22:00:00Z", new Date("2027-01-01T00:30:00Z")).grande,
      ).toBe(dataPorExtenso(20, "janeiro"));
    });
  });

  it("o ano corrente é o de Lisboa, e não o do aparelho (+14)", () => {
    // O simétrico: 31 de dezembro de 2026 às 22:00 em Lisboa já é 1 de janeiro
    // de 2027 em Kiritimati. Um `agora.getFullYear()` devolve 2027 e o ano
    // **desaparecia** de um evento que é mesmo do ano seguinte.
    comOFusoDoAparelhoEm("Pacific/Kiritimati", () => {
      expect(
        formatarDataDoEvento("2027-01-20T22:00:00Z", new Date("2026-12-31T22:00:00Z")).grande,
      ).toBe(dataPorExtenso(20, "janeiro", 2027));
    });
  });
});

describe("a janela dos 2 a 6 dias é inequívoca por construção (5.2)", () => {
  it("de qualquer dia da semana, os cinco nomes são cinco nomes diferentes", () => {
    // A prova que fecha a janela nos 6: dois dias com o mesmo nome estão a
    // sete dias um do outro, por isso dois cartões entre `d = 2` e `d = 6`
    // nunca podem trazer o mesmo nome. Percorre-se a partir dos sete dias da
    // semana, senão a prova era sobre a segunda-feira e mais nada.
    //
    // Deixa passar: os nomes estarem certos. Aqui só se prova que são
    // distintos — um código que devolvesse "Dia 2".."Dia 6" passava.
    for (let desvio = 0; desvio < 7; desvio += 1) {
      const agora = new Date(Date.UTC(2026, 10, 2 + desvio, 10, 0, 0));
      const nomes = new Set<string>();

      for (let d = 2; d <= 6; d += 1) {
        const inicio = new Date(Date.UTC(2026, 10, 2 + desvio + d, 22, 0, 0)).toISOString();
        nomes.add(formatarDataDoEvento(inicio, agora).grande);
      }

      expect(
        [...nomes],
        `a partir de ${agora.toISOString()} dois dias da janela trouxeram o mesmo nome`,
      ).toHaveLength(5);
    }
  });

  it("e cada um desses nomes é um dos sete da tabela, com maiúscula", () => {
    // Deixa passar: a correspondência entre o nome e o dia certo — isso são as
    // cadeias dos testes das seis formas.
    const permitidos = DIAS_ESPERADOS.map(comMaiuscula);

    for (let d = 2; d <= 6; d += 1) {
      const inicio = new Date(Date.UTC(2026, 10, 2 + d, 22, 0, 0)).toISOString();
      expect(permitidos).toContain(formatarDataDoEvento(inicio, SEGUNDA_DE_MANHA).grande);
    }
  });
});

describe("a função é pura (5.5, 5.6)", () => {
  it("o relógio da máquina pode estar noutro dia que o resultado não muda", () => {
    // O `Date.now()` escondido é o defeito que o cache de 60 s transforma em
    // «Hoje» na manhã seguinte (5.5). Com os temporizadores falsos a dizer que
    // é 2027, o `agora` passado à mão tem de continuar a mandar.
    //
    // Deixa passar: um `Date.now()` usado só para a **hora** — a hora sai do
    // `inicio`, não do `agora`, e aqui ela não muda.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-06-15T10:00:00Z"));

    expect(formatarDataDoEvento("2026-11-02T22:00:00Z", SEGUNDA_DE_MANHA)).toEqual({
      grande: "Hoje",
      pequena: aPartirDas("22:00"),
    });
  });

  it("duas chamadas iguais dão o mesmo, e nenhuma delas altera o `agora`", () => {
    // Deixa passar: pouco. Está aqui porque uma implementação que faça
    // `agora.setHours(0, 0, 0, 0)` para achar a meia-noite **altera o objeto
    // de quem chamou** — e o segundo cartão da lista passa a ser formatado
    // contra um relógio diferente do primeiro.
    const agora = new Date("2026-11-02T10:00:00Z");
    const primeira = formatarDataDoEvento("2026-11-09T22:00:00Z", agora);
    const segunda = formatarDataDoEvento("2026-11-09T22:00:00Z", agora);

    expect(segunda).toEqual(primeira);
    expect(agora.toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });
});

describe("quando não há Lisboa nenhuma para ler (5.4)", () => {
  it("o módulo carrega à mesma, e é a chamada que falha", async () => {
    // `Intl.DateTimeFormat` com um `timeZone` desconhecido lança `RangeError`,
    // e o formatador constrói-se **ao carregar o módulo**. Se essa excessão
    // subisse no `import`, não era a secção dos eventos que desaparecia: era a
    // página inteira a não arrancar, ementa e cabeçalho incluídos.
    //
    // Por isso o contrato é este: importar nunca falha, chamar falha. Quem
    // apanha é o componente, e o que ele mostra é o estado de **erro** — "não
    // consegui saber que dia é em Lisboa" não pode sair igual a "o evento é
    // hoje" (regra 10).
    //
    // Deixa passar: o que o componente faz com a exceção. Isso é
    // `Eventos.test.tsx`.
    const semLisboa = new Proxy(Intl.DateTimeFormat, {
      construct: () => {
        throw new RangeError("Invalid time zone specified: Europe/Lisbon");
      },
    });

    await comODateTimeFormatTrocado(semLisboa, (modulo) => {
      expect(
        () => modulo.formatarDataDoEvento("2026-11-02T22:00:00Z", SEGUNDA_DE_MANHA),
        "a chamada tinha de falhar. Devolver uma data lida no fuso do aparelho é a " +
          "regra 10 ao contrário: «não consegui saber que dia é em Lisboa» a sair " +
          "igual a «o evento é hoje».",
      ).toThrow();
    });
  });
});
