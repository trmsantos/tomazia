import type { DiaDoHorario } from "../../../lib/api/gestao-definicoes";
import { TEXTOS, faltaOHorarioDe } from "./textos";

/**
 * O horário tal como o formulário o guarda (F4-05a, 2.5): puro, sem React.
 *
 * **«Por preencher» existe para não inventar factos sobre o bar** (ADR 0011): sete
 * dias fechados é uma afirmação que só o dono faz. Começar de um horário vazio não
 * dá sete «Fechado» nem sete «Aberto» sem horas: cada dia começa por decidir, e
 * guardar com um dia por decidir é um erro local.
 */
export type DiaDaSemana = DiaDoHorario["dia"];

/** De segunda a domingo: a ordem do backend e do editor. */
export const DIAS_DA_SEMANA: readonly DiaDaSemana[] = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
];

export const MAXIMO_DE_PERIODOS = 6;

export type EstadoDoDia = "por_preencher" | "fechado" | "aberto";

export type PeriodoNoFormulario = {
  /** Identifica o período entre renders (nunca vai para a API). */
  chave: string;
  abre: string;
  fecha: string;
  /** `validity.badInput` com o valor vazio: escreveu metade da hora (≠ não escreveu). */
  abreIncompleto: boolean;
  fechaIncompleto: boolean;
};

export type DiaNoFormulario = {
  dia: DiaDaSemana;
  estado: EstadoDoDia;
  /** Um dia «Fechado» guarda aqui os períodos em memória, para se poder desmarcar sem perder. */
  periodos: PeriodoNoFormulario[];
};

export type HorarioNoFormulario =
  { modo: "sem_horario" } | { modo: "editar"; dias: DiaNoFormulario[] };

export type ErrosDoHorario = {
  /** Dia por preencher, aberto sem períodos, períodos a mais, sobreposição. */
  porDia: Partial<Record<DiaDaSemana, string>>;
  /** Por `chave` do período; só `abre` e `fecha`. */
  porPeriodo: Record<string, { abre?: string; fecha?: string }>;
};

let contador = 0;

export function novaChave(): string {
  contador += 1;
  return `periodo-${String(contador)}`;
}

/** Um período com as horas **vazias**: o ecrã não inventa uma hora de abertura. */
export function periodoVazio(): PeriodoNoFormulario {
  return { chave: novaChave(), abre: "", fecha: "", abreIncompleto: false, fechaIncompleto: false };
}

/** `null` (também o do `invalido`) → sem horário; `[]` num dia → fechado; com períodos → aberto. */
export function daApi(horario: DiaDoHorario[] | null): HorarioNoFormulario {
  if (horario === null) return { modo: "sem_horario" };
  return {
    modo: "editar",
    dias: DIAS_DA_SEMANA.map((dia) => {
      const periodos = (horario.find((d) => d.dia === dia)?.periodos ?? []).map((p) => ({
        chave: novaChave(),
        abre: p.abre,
        fecha: p.fecha,
        abreIncompleto: false,
        fechaIncompleto: false,
      }));
      return { dia, estado: periodos.length === 0 ? "fechado" : "aberto", periodos };
    }),
  };
}

/** Sete dias «por preencher», zero períodos. */
export function comecarHorario(): HorarioNoFormulario {
  return {
    modo: "editar",
    dias: DIAS_DA_SEMANA.map((dia) => ({ dia, estado: "por_preencher", periodos: [] })),
  };
}

/** Só depois de `validarHorario` sem erros. Fechado → `[]`; aberto → períodos por ordem de abertura. */
export function paraApi(horario: HorarioNoFormulario): DiaDoHorario[] | null {
  if (horario.modo === "sem_horario") return null;
  return horario.dias.map((d) => ({
    dia: d.dia,
    periodos:
      d.estado === "aberto"
        ? [...d.periodos]
            .sort((a, b) => (a.abre < b.abre ? -1 : a.abre > b.abre ? 1 : 0))
            .map((p) => ({ abre: p.abre, fecha: p.fecha }))
        : [],
  }));
}

const HORA_VALIDA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function minutos(hora: string): number {
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
}

/** `fecha` anterior a `abre`: o período fecha no dia seguinte. */
export function fechaDepoisDaMeiaNoite(abre: string, fecha: string): boolean {
  return HORA_VALIDA.test(abre) && HORA_VALIDA.test(fecha) && minutos(fecha) < minutos(abre);
}

function erroDaHora(valor: string, incompleto: boolean, vazia: string): string | undefined {
  if (valor === "") return incompleto ? TEXTOS.erroHoraIncompleta : vazia;
  return HORA_VALIDA.test(valor) ? undefined : TEXTOS.erroHoraInvalida;
}

/**
 * Espelho do backend (`_validar_horario_na_escrita`): até 6 períodos, `abre !=
 * fecha`, sem sobreposição **no mesmo dia** medida na linha do dia (`fecha <
 * abre` soma 24 h; começar quando o outro acaba é válido). Não vê sobreposição
 * **entre** dias: o backend também não. Mais o que só o editor vê: dia por
 * preencher, dia aberto sem períodos, hora vazia e hora incompleta. Devolve
 * **todos** os erros de uma vez.
 */
export function validarHorario(horario: HorarioNoFormulario): ErrosDoHorario {
  const erros: ErrosDoHorario = { porDia: {}, porPeriodo: {} };
  if (horario.modo === "sem_horario") return erros;

  for (const d of horario.dias) {
    if (d.estado === "por_preencher") {
      erros.porDia[d.dia] = faltaOHorarioDe(d.dia);
      continue;
    }
    if (d.estado === "fechado") continue;
    if (d.periodos.length === 0) {
      erros.porDia[d.dia] = TEXTOS.erroDiaSemPeriodos;
      continue;
    }

    const intervalos: Array<readonly [number, number]> = [];
    for (const p of d.periodos) {
      const abre = erroDaHora(p.abre, p.abreIncompleto, TEXTOS.erroHoraAbre);
      const fecha = erroDaHora(p.fecha, p.fechaIncompleto, TEXTOS.erroHoraFecha);
      const doPeriodo: { abre?: string; fecha?: string } = {};
      if (abre !== undefined) doPeriodo.abre = abre;
      if (fecha !== undefined) doPeriodo.fecha = fecha;
      if (abre === undefined && fecha === undefined) {
        if (p.abre === p.fecha) doPeriodo.fecha = TEXTOS.erroHoraIgual;
        else {
          const inicio = minutos(p.abre);
          const fim = minutos(p.fecha);
          intervalos.push([inicio, fim < inicio ? fim + 1440 : fim]);
        }
      }
      if (doPeriodo.abre !== undefined || doPeriodo.fecha !== undefined) {
        erros.porPeriodo[p.chave] = doPeriodo;
      }
    }

    if (d.periodos.length > MAXIMO_DE_PERIODOS) {
      erros.porDia[d.dia] = TEXTOS.erroPeriodosDemais;
      continue;
    }
    intervalos.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i + 1 < intervalos.length; i += 1) {
      const atual = intervalos[i];
      const seguinte = intervalos[i + 1];
      if (atual !== undefined && seguinte !== undefined && seguinte[0] < atual[1]) {
        erros.porDia[d.dia] = TEXTOS.erroSobreposicao;
        break;
      }
    }
  }
  return erros;
}

/** Não há nenhum erro (de dia nem de período). */
export function horarioSemErros(erros: ErrosDoHorario): boolean {
  return Object.keys(erros.porDia).length === 0 && Object.keys(erros.porPeriodo).length === 0;
}
