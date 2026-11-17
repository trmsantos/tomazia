/**
 * Apoio dos testes do horário no formulário (F4-05a): constrói
 * `HorarioNoFormulario`/`DiaNoFormulario` de um modo legível e lê os erros de
 * `validarHorario`. Só para testes; nada em produção o importa.
 *
 * Contrato do módulo `src/pages/gestao/definicoes/horario-do-formulario.ts`
 * (plano 2.5, tal como o QA o usa):
 *
 * ```ts
 * export type DiaDaSemana = "segunda" | … | "domingo";
 * export const DIAS_DA_SEMANA: readonly DiaDaSemana[];     // de segunda a domingo
 * export type EstadoDoDia = "por_preencher" | "fechado" | "aberto";
 * export type PeriodoNoFormulario = { chave: string; abre: string; fecha: string; abreIncompleto: boolean; fechaIncompleto: boolean };
 * export type DiaNoFormulario = { dia: DiaDaSemana; estado: EstadoDoDia; periodos: PeriodoNoFormulario[] };
 * export type HorarioNoFormulario = { modo: "sem_horario" } | { modo: "editar"; dias: DiaNoFormulario[] };
 * export type ErrosDoHorario = {
 *   porDia: Partial<Record<DiaDaSemana, string>>;                                 // dia por preencher, aberto sem períodos, períodos a mais, SOBREPOSIÇÃO
 *   porPeriodo: Record<string, { abre?: string; fecha?: string }>;                // por `chave` do período
 * };
 * export function daApi(horario: DiaDoHorario[] | null): HorarioNoFormulario;
 * export function comecarHorario(): HorarioNoFormulario;   // sete dias "por_preencher", zero períodos
 * export function paraApi(h: HorarioNoFormulario): DiaDoHorario[] | null;
 * export function validarHorario(h: HorarioNoFormulario): ErrosDoHorario;
 * ```
 *
 * (A sobreposição vai em `porDia`, não em `porPeriodo`: a spec 6.6 põe-na na linha
 * de erro do dia. `porPeriodo` só tem `abre` e `fecha`, que o ecrã escreve junto do campo.)
 */
import {
  daApi,
  type DiaNoFormulario,
  type ErrosDoHorario,
  type HorarioNoFormulario,
  type PeriodoNoFormulario,
} from "../pages/gestao/definicoes/horario-do-formulario";
import { type DiaDaSemana, type DiaDoHorario, semanaDeTeste } from "./gestao";

export type Editar = Extract<HorarioNoFormulario, { modo: "editar" }>;

let contador = 0;

/** Um período do formulário, com uma `chave` própria. */
export function periodoNoFormulario(
  abre: string,
  fecha: string,
  extra: Partial<PeriodoNoFormulario> = {},
): PeriodoNoFormulario {
  contador += 1;
  return {
    chave: `p-de-teste-${String(contador)}`,
    abre,
    fecha,
    abreIncompleto: false,
    fechaIncompleto: false,
    ...extra,
  };
}

/** O horário do formulário a partir de `semanaDeTeste(...)` (passa por `daApi`). */
export function formularioDe(periodos: Parameters<typeof semanaDeTeste>[0] = {}): Editar {
  const h = daApi(semanaDeTeste(periodos));
  if (h.modo !== "editar") throw new Error("daApi de uma lista devia dar o modo editar");
  return h;
}

export function diaDe(h: Editar, dia: DiaDaSemana): DiaNoFormulario {
  const encontrado = h.dias.find((d) => d.dia === dia);
  if (encontrado === undefined) throw new Error(`o formulário não tem ${dia}`);
  return encontrado;
}

/** Uma cópia do horário com o dia substituído. */
export function comDia(h: Editar, dia: DiaDaSemana, mudar: Partial<DiaNoFormulario>): Editar {
  return { modo: "editar", dias: h.dias.map((d) => (d.dia === dia ? { ...d, ...mudar } : d)) };
}

/** Quantos erros há, de qualquer tipo (um `undefined` não conta). */
export function contarErros(erros: ErrosDoHorario): number {
  const porDia = Object.values(erros.porDia).filter((t) => t !== undefined && t !== "").length;
  const porPeriodo = Object.values(erros.porPeriodo).reduce(
    (soma, e) => soma + [e.abre, e.fecha].filter((t) => t !== undefined && t !== "").length,
    0,
  );
  return porDia + porPeriodo;
}

export function semErros(erros: ErrosDoHorario): boolean {
  return contarErros(erros) === 0;
}

/** O horário tal como a API o devolveria, para comparar ida e volta. */
export function comoApi(periodos: Parameters<typeof semanaDeTeste>[0]): DiaDoHorario[] {
  return semanaDeTeste(periodos);
}
