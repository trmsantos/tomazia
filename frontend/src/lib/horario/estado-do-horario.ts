/**
 * «Está aberto?», em hora de relógio de Lisboa (F3-06a, 5.1 e 5.3; ADR 0010 e 0011).
 *
 * Duas funções puras e uma de agendamento, todas a receber o `agora`: nada aqui
 * lê `Date.now()`, e é isso que as torna testáveis com o relógio preso.
 *
 * **Tudo se calcula em minutos de relógio.** O dia de hoje em Lisboa é o minuto
 * 0 e cada dia civil vale 1440 minutos, com o ontem em -1440. Nunca se faz uma
 * diferença de instantes: nas duas noites de mudança de hora o dia tem 23 ou 25
 * horas reais, e «às 02:00» continua a ser as 02:00 que o relógio da parede
 * diz (ADR 0011: um horário é hora de parede, não um instante).
 *
 * **Os períodos vêm de uma função** (`PeriodosDaData`), e não do horário: a
 * F4-06 põe lá as exceções por data sem mudar mais nada. `periodosDaSemana` é a
 * de hoje, o dia da semana da data contra o horário do contrato.
 *
 * Sem `Intl` com Lisboa levanta `ErroSemLisboa` (o mesmo da data dos eventos, e
 * é de lá que vem a leitura da hora): o chamador mostra a tabela sem a linha do
 * momento. Nunca se adivinha com o relógio do aparelho.
 */
import type { Info } from "../api/publico";
import { ErroSemLisboa, partesEmLisboa } from "../formato/data-do-evento";

export { ErroSemLisboa };

type Horario = NonNullable<Info["horario"]>;

/** Os nomes que o contrato da API usa: sem acentos, é um identificador (ADR 0011). */
export type DiaDaSemana = Horario[number]["dia"];
export type Periodo = { abre: string; fecha: string };
/** `AAAA-MM-DD`, o dia civil de Lisboa. */
export type DataCivil = string;
export type PeriodosDaData = (data: DataCivil) => readonly Periodo[];

export type EstadoDoHorario =
  | { tipo: "aberto"; fechaAs: string; hoje: DiaDaSemana; destaque: DiaDaSemana }
  | {
      tipo: "fechado";
      abre: { quando: "hoje" | "amanhã" | DiaDaSemana; hora: string } | null;
      hoje: DiaDaSemana;
      destaque: DiaDaSemana;
    };

/** Pela ordem de `Date#getUTCDay()`: domingo é 0. */
const DIAS_PELO_GETUTCDAY: readonly DiaDaSemana[] = [
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
];

const MINUTOS_DO_DIA = 1440;
const MS_DO_MINUTO = 60_000;
const MS_DO_DIA = 86_400_000;

/** Quantos dias para trás (o período que ainda decorre) e para a frente (a próxima semana inteira). */
const DIAS_PARA_TRAS = 1;
const DIAS_PARA_A_FRENTE = 7;

/** O prazo máximo de um temporizador (5.3, 2): as noites de mudança de hora têm 23 ou 25 horas. */
const UMA_HORA_EM_MS = 3_600_000;
/** Nunca se agenda um temporizador de zero: uma fronteira a meio segundo não pode fazer um ciclo apertado. */
const PRAZO_MINIMO_EM_MS = 1000;
/** Para o temporizador acordar já do lado de lá da fronteira, e não no último milissegundo de antes. */
const FOLGA_EM_MS = 50;

/**
 * Os períodos de uma data, a partir do horário do contrato.
 *
 * Uma data civil de Lisboa é um dia da semana, e é só isso que o horário
 * semanal sabe dela. Um dia que o contrato não traga devolve a lista vazia: o
 * contrato garante os sete (ADR 0011), e a tabela só escreve «Fechado» onde o
 * contrato o diz.
 */
export function periodosDaSemana(horario: Horario): PeriodosDaData {
  return (data) => {
    const [ano, mes, dia] = data.split("-").map(Number);
    const diaDaSemana = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1)).getUTCDay();
    const nome = DIAS_PELO_GETUTCDAY[diaDaSemana];
    return horario.find((entrada) => entrada.dia === nome)?.periodos ?? [];
  };
}

/** Um intervalo em minutos desde as 00:00 de hoje; `dia` é o dia (relativo a hoje) em que o período abre. */
type Intervalo = { inicio: number; fim: number; dia: number };

type Leitura = {
  /** Os minutos desde as 00:00 de hoje, em Lisboa. */
  agoraEmMinutos: number;
  /** A meia-noite de hoje em Lisboa, como instante UTC, só para contas de calendário. */
  baseDeHoje: number;
  hoje: DiaDaSemana;
  /** Os períodos tal como o horário os escreve, ordenados pela abertura. */
  brutos: Intervalo[];
  /** Os mesmos, com os que se tocam ou sobrepõem já fundidos. */
  cadeias: Intervalo[];
};

function minutosDeUmaHora(hora: string): number | null {
  const lida = /^(\d{2}):(\d{2})$/.exec(hora);
  if (lida === null) return null;
  return Number(lida[1]) * 60 + Number(lida[2]);
}

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

function horaDeUmMinuto(minutosDoDia: number): string {
  const dentroDoDia = ((minutosDoDia % MINUTOS_DO_DIA) + MINUTOS_DO_DIA) % MINUTOS_DO_DIA;
  return `${doisDigitos(Math.floor(dentroDoDia / 60))}:${doisDigitos(dentroDoDia % 60)}`;
}

function nomeDoDia(baseDeHoje: number, dias: number): DiaDaSemana {
  const nome = DIAS_PELO_GETUTCDAY[new Date(baseDeHoje + dias * MS_DO_DIA).getUTCDay()];
  if (nome === undefined) throw new Error("O dia da semana ficou fora da tabela.");
  return nome;
}

function ler(periodosDaData: PeriodosDaData, agora: Date): Leitura {
  const partes = partesEmLisboa(agora);
  const baseDeHoje = Date.UTC(partes.ano, partes.mes - 1, partes.dia);

  const brutos: Intervalo[] = [];
  for (let dia = -DIAS_PARA_TRAS; dia <= DIAS_PARA_A_FRENTE; dia += 1) {
    const data = new Date(baseDeHoje + dia * MS_DO_DIA).toISOString().slice(0, 10);
    for (const periodo of periodosDaData(data)) {
      const abre = minutosDeUmaHora(periodo.abre);
      const fecha = minutosDeUmaHora(periodo.fecha);
      // `fecha == abre` é inválido na escrita (ADR 0011); aqui não tem duração.
      if (abre === null || fecha === null || abre === fecha) continue;
      // `fecha < abre`: fecha no dia seguinte.
      const fim = fecha < abre ? fecha + MINUTOS_DO_DIA : fecha;
      brutos.push({
        inicio: dia * MINUTOS_DO_DIA + abre,
        fim: dia * MINUTOS_DO_DIA + fim,
        dia,
      });
    }
  }
  brutos.sort((a, b) => a.inicio - b.inicio);

  const cadeias: Intervalo[] = [];
  for (const intervalo of brutos) {
    const ultima = cadeias[cadeias.length - 1];
    if (ultima !== undefined && intervalo.inicio <= ultima.fim) {
      ultima.fim = Math.max(ultima.fim, intervalo.fim);
    } else {
      cadeias.push({ ...intervalo });
    }
  }

  return {
    agoraEmMinutos: partes.hora * 60 + partes.minuto,
    baseDeHoje,
    hoje: nomeDoDia(baseDeHoje, 0),
    brutos,
    cadeias,
  };
}

/**
 * Aberto ou fechado, com a hora do próximo fecho ou da próxima abertura.
 *
 * `destaque` é o dia da tabela a pôr em negrito: o dia cujo período está a
 * decorrer agora (à 01:00 de quinta com o de quarta aberto: `quarta`) e, sem
 * período a decorrer, o dia civil de Lisboa.
 *
 * Abertura inclusiva, fecho exclusivo: às 02:00 em ponto já está fechado.
 *
 * @throws ErroSemLisboa se o aparelho não conhecer o fuso de Lisboa.
 */
export function estadoDoHorario(periodosDaData: PeriodosDaData, agora: Date): EstadoDoHorario {
  const { agoraEmMinutos, baseDeHoje, hoje, brutos, cadeias } = ler(periodosDaData, agora);

  const emCurso = cadeias.find((c) => c.inicio <= agoraEmMinutos && agoraEmMinutos < c.fim);
  if (emCurso !== undefined) {
    // O período que decorre e abriu primeiro dá o dia: numa cadeia de períodos
    // sobrepostos, a noite começou no dia mais antigo.
    const decorre = brutos.find((b) => b.inicio <= agoraEmMinutos && agoraEmMinutos < b.fim);
    return {
      tipo: "aberto",
      fechaAs: horaDeUmMinuto(emCurso.fim),
      hoje,
      destaque: nomeDoDia(baseDeHoje, decorre?.dia ?? 0),
    };
  }

  const proxima = cadeias.find((c) => c.inicio > agoraEmMinutos);
  if (proxima === undefined) {
    return { tipo: "fechado", abre: null, hoje, destaque: hoje };
  }

  const dias = Math.floor(proxima.inicio / MINUTOS_DO_DIA);
  const quando = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : nomeDoDia(baseDeHoje, dias);
  return {
    tipo: "fechado",
    abre: { quando, hora: horaDeUmMinuto(proxima.inicio) },
    hoje,
    destaque: hoje,
  };
}

/**
 * Quanto esperar até recalcular (5.3), em milissegundos.
 *
 * A próxima mudança é a que vier primeiro entre a próxima abertura ou fecho de
 * qualquer período e a meia-noite de Lisboa (o dia civil também muda a linha:
 * «amanhã» passa a «hoje»). **Nunca passa de uma hora**, mesmo que a mudança
 * esteja a dias: reagendar de hora a hora custa menos que um piscar de olhos e
 * poupa a conta das noites de 23 e 25 horas.
 *
 * A fronteira calcula-se em hora de relógio e converte-se para um instante com
 * uma correção: se entre agora e lá o relógio da parede saltar (a mudança de
 * hora), o instante real é uma hora para um lado ou para o outro.
 *
 * @throws ErroSemLisboa se o aparelho não conhecer o fuso de Lisboa.
 */
export function esperaAteAProximaMudanca(periodosDaData: PeriodosDaData, agora: Date): number {
  const { agoraEmMinutos, baseDeHoje, brutos } = ler(periodosDaData, agora);

  let alvo = MINUTOS_DO_DIA;
  for (const intervalo of brutos) {
    for (const fronteira of [intervalo.inicio, intervalo.fim]) {
      if (fronteira > agoraEmMinutos && fronteira < alvo) alvo = fronteira;
    }
  }

  // Todos os offsets de Lisboa são horas inteiras: os segundos do minuto são os de qualquer fuso.
  const segundosDoMinutoEmMs = ((agora.getTime() % MS_DO_MINUTO) + MS_DO_MINUTO) % MS_DO_MINUTO;
  let instante = agora.getTime() + (alvo - agoraEmMinutos) * MS_DO_MINUTO - segundosDoMinutoEmMs;

  const chegada = partesEmLisboa(new Date(instante));
  const chegadaEmMinutos =
    (Date.UTC(chegada.ano, chegada.mes - 1, chegada.dia) - baseDeHoje) / MS_DO_MINUTO +
    chegada.hora * 60 +
    chegada.minuto;
  instante -= (chegadaEmMinutos - alvo) * MS_DO_MINUTO;

  const espera = instante - agora.getTime() + FOLGA_EM_MS;
  return Math.min(Math.max(espera, PRAZO_MINIMO_EM_MS), UMA_HORA_EM_MS);
}
