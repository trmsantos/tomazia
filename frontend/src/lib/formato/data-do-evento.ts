/**
 * A data de um evento, em Lisboa, escrita como se fala à porta de um bar.
 *
 * F3-04, 5.2 a 5.6. Duas linhas por cartão: a `grande`, em letra de título a 34 px,
 * e a `pequena`, a 14 px por baixo dela. As duas nunca dizem a mesma coisa
 * duas vezes e juntas dizem sempre o suficiente.
 *
 * | `d` | `grande` | `pequena` |
 * | --- | --- | --- |
 * | 0, ainda não começou | `Hoje` | `A partir das 22:00` |
 * | 0, já começou | `Hoje` | `Começou às 22:00` |
 * | 1 | `Amanhã` | `A partir das 22:00` |
 * | 2 a 6 | `Quinta-feira` | `A partir das 22:00` |
 * | 7 ou mais, no ano corrente | `17 de dezembro` | `Quinta-feira, a partir das 22:00` |
 * | 7 ou mais, noutro ano | `1 de janeiro de 2027` | `Sexta-feira, a partir das 22:00` |
 *
 * Três decisões que este ficheiro carrega, e que não se mudam aqui sem passar
 * pela secção 9 da especificação:
 *
 * 1. **A função é pura** e recebe o `agora`: nunca lê `Date.now()` (5.6). É o
 *    que a torna testável com relógio preso, e é a mesma escolha que o
 *    `inicio_do_dia_do_bar` do backend já fez do outro lado.
 * 2. **Nada disto vem da API** (5.5). `GET /eventos` tem cache de 60 s: um
 *    "Hoje" cozido na resposta servia-se na manhã seguinte, a toda a gente,
 *    sobre um evento que já tinha passado.
 * 3. **Os nomes dos dias e dos meses são a tabela daqui de baixo**, nunca o
 *    que o browser devolver (5.4). Um aparelho com ICU reduzido escreve
 *    "Thursday" no meio de uma página em português, o CI não o apanha — o Node
 *    tem ICU completo — e a varredura do Q-05 também não o apanharia, porque a
 *    palavra inglesa não estaria escrita em ficheiro nenhum nosso.
 */

/** As duas linhas de data de um cartão de evento (F3-04, 4.2). */
export type DataDoEvento = {
  /** A linha em letra de título a 34 px: `Hoje`, `Quinta-feira`, `17 de dezembro`. */
  grande: string;
  /** A linha de 14 px: `A partir das 22:00`, `Começou às 22:00`. */
  pequena: string;
};

/**
 * Os sete nomes, em minúsculas, pela ordem de `Date#getUTCDay()`.
 *
 * A maiúscula é de início de linha e põe-se na hora de escrever, porque em
 * português os dias são minúsculos no meio de uma frase (9, nota 2).
 */
export const DIAS_DA_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/** Os doze meses, em minúsculas, com o índice do mês civil menos um. */
export const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/** O fuso em que o bar vive. Nada aqui lê o do aparelho (5.4). */
const FUSO_DO_BAR = "Europe/Lisbon";

/** Um dia civil em milissegundos, para a aritmética de `Date.UTC` (5.4). */
const UM_DIA = 86_400_000;

/** A partir daqui a data grande deixa de ser o nome do dia (5.2). */
const DIAS_DA_JANELA_DO_NOME = 6;

/**
 * As partes de um instante, já lidas em Lisboa e só em números.
 *
 * Nunca `getDate()` nem `getHours()`: esses leem o fuso do aparelho e dão a
 * data certa em Lisboa e errada em todo o lado (5.4).
 */
export type PartesEmLisboa = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
};

/**
 * O formatador, construído **uma vez** ao carregar o módulo, e o que correu
 * mal se ele não se conseguiu construir.
 *
 * `Intl.DateTimeFormat` com um `timeZone` que o aparelho não conhece lança
 * `RangeError`. Se essa exceção subisse no `import`, não era a secção dos
 * eventos que desaparecia: era a página inteira a não arrancar, com a ementa e
 * o cabeçalho lá dentro. Por isso **importar nunca falha e chamar falha** —
 * quem apanha é o componente, e o que ele mostra é o estado de erro. "Não
 * consegui saber que dia é em Lisboa" não pode sair igual a "o evento é hoje"
 * (regra 10 do `CLAUDE.md`, aplicada ao desenho em 5.4).
 */
const { formatador, erroAoConstruir } = construirFormatador();

function construirFormatador(): {
  formatador: Intl.DateTimeFormat | null;
  erroAoConstruir: unknown;
} {
  try {
    return {
      formatador: new Intl.DateTimeFormat("pt-PT", {
        timeZone: FUSO_DO_BAR,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      erroAoConstruir: null,
    };
  } catch (erro) {
    return { formatador: null, erroAoConstruir: erro };
  }
}

/** O aparelho não conhece o fuso de Lisboa (a única falha que a gestão trata como «sem Lisboa»). */
export class ErroSemLisboa extends Error {}

/**
 * Lê um instante em Lisboa, em números. Falha alto se não houver Lisboa.
 *
 * Exportada na F4-03: a gestão dos eventos lê a hora de Lisboa pela mesma tabela e pelo mesmo
 * formatador, e não por uma segunda cópia (uma forma só de falhar sem Lisboa).
 */
export function partesEmLisboa(instante: Date): PartesEmLisboa {
  if (formatador === null) {
    throw new ErroSemLisboa(
      `Não consegui ler a data no fuso ${FUSO_DO_BAR}: este aparelho não o conhece.`,
      { cause: erroAoConstruir },
    );
  }

  const lidas: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const parte of formatador.formatToParts(instante)) {
    if (parte.type !== "literal") lidas[parte.type] = Number(parte.value);
  }

  const { year, month, day, hour, minute } = lidas;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(
      `Não consegui ler a data no fuso ${FUSO_DO_BAR}: o formatador não devolveu ` +
        "o ano, o mês, o dia, a hora e o minuto todos.",
    );
  }

  return { ano: year, mes: month, dia: day, hora: hour, minuto: minute };
}

/**
 * A meia-noite daquele dia civil, como instante UTC, só para contas.
 *
 * É sobre estes valores que o `d` se calcula, e é isso que o põe a salvo dos
 * dois domingos em que Lisboa muda de hora: o dia 29 de março tem 23 horas
 * reais e o 25 de outubro tem 25, e uma diferença de instantes a dividir por
 * 86 400 000 devolve 0,958 ou 1,042 em vez de 1 (5.4).
 */
function diaCivil({ ano, mes, dia }: PartesEmLisboa): number {
  return Date.UTC(ano, mes - 1, dia);
}

/** `Quinta-feira` a partir de `quinta-feira`: a maiúscula é da linha. */
function comMaiuscula(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1);
}

/** `22:00`, com dois pontos e sempre com minutos (9, nota 3). */
function horaEMinuto({ hora, minuto }: PartesEmLisboa): string {
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

/**
 * O nome do dia da semana, calculado e não pedido.
 *
 * A partir do ano, do mês e do dia já lidos em Lisboa: é aritmética de
 * calendário, sem fuso e sem locale (5.4).
 */
function nomeDoDia(partes: PartesEmLisboa): string {
  return daTabela(DIAS_DA_SEMANA, new Date(diaCivil(partes)).getUTCDay(), "dia da semana");
}

/** `17 de dezembro`, e `1 de janeiro de 2027` fora do ano corrente (5.2). */
function porExtenso(doEvento: PartesEmLisboa, anoCorrente: number): string {
  const base = `${String(doEvento.dia)} de ${daTabela(MESES, doEvento.mes - 1, "mês")}`;
  return doEvento.ano === anoCorrente ? base : `${base} de ${String(doEvento.ano)}`;
}

/**
 * Uma palavra da tabela, ou um erro alto.
 *
 * O índice vem de uma conta e as tabelas têm sete e doze entradas, por isso
 * isto nunca devia disparar. Está escrito porque o modo de falha sem ele é o
 * pior possível: num template, uma entrada em falta imprime-se como
 * `17 de undefined` no meio do cartão. Um índice fora da tabela é "não
 * consegui saber que dia é", e esse caminho já tem ecrã — o de erro (5.4).
 */
function daTabela(tabela: readonly string[], indice: number, oQue: string): string {
  const palavra = tabela[indice];
  if (palavra === undefined) {
    throw new Error(
      `Não consegui escrever o ${oQue}: o índice ${String(indice)} não está na tabela.`,
    );
  }
  return palavra;
}

/**
 * As duas linhas de data de um evento, a partir do `inicio` e do `agora`.
 *
 * @param inicio O instante com fuso que a API manda, como vem.
 * @param agora O instante contra o qual se lê. Passa-se sempre, nunca se lê.
 * @throws Se o aparelho não conhecer o fuso de Lisboa (5.4).
 */
export function formatarDataDoEvento(inicio: string, agora: Date): DataDoEvento {
  const doEvento = partesEmLisboa(new Date(inicio));
  const deHoje = partesEmLisboa(agora);

  const d = (diaCivil(doEvento) - diaCivil(deHoje)) / UM_DIA;
  const hora = horaEMinuto(doEvento);
  // O limiar é o instante, não o dia: a frase troca ao segundo (5.3).
  const jaComecou = agora.getTime() >= new Date(inicio).getTime();
  // A linha de baixo recupera o dia da semana exatamente quando a de cima o
  // perde (5.2). Um evento já passado — que o backend não manda — cai do mesmo
  // lado, por ser o único que escreve a data inteira.
  const foraDaJanela = d < 0 || d > DIAS_DA_JANELA_DO_NOME;

  let grande: string;
  if (d === 0) grande = "Hoje";
  else if (d === 1) grande = "Amanhã";
  else if (!foraDaJanela) grande = comMaiuscula(nomeDoDia(doEvento));
  else grande = porExtenso(doEvento, deHoje.ano);

  let pequena: string;
  if (d === 0 && jaComecou) pequena = `Começou às ${hora}`;
  else if (foraDaJanela) pequena = `${comMaiuscula(nomeDoDia(doEvento))}, a partir das ${hora}`;
  else pequena = `A partir das ${hora}`;

  return { grande, pequena };
}
