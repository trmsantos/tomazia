import { partesEmLisboa } from "../../../lib/formato/data-do-evento";

/**
 * A hora de parede do campo ↔ o instante, **sempre em Lisboa** (F4-03, plano 4, spec 7.2).
 *
 * O `<input type="date">` e o `<input type="time">` dão a hora de parede, sem fuso. O browser
 * não converte nada: é este módulo que diz que essa parede é a de Lisboa, seja qual for o fuso
 * do telemóvel. Tudo vem de `partesEmLisboa` (a tabela e o formatador da data pública), nunca de
 * `getTimezoneOffset()` nem de `Date` com o fuso do aparelho; e as contas são todas `Date.UTC`.
 */

const UMA_HORA = 3_600_000;
const TRES_HORAS = 3 * UMA_HORA;
const ANO_MINIMO = 1970;
const ANO_MAXIMO = 9000;

const PAREDE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A parede de Lisboa de um instante, lida como se fosse UTC (só para contas). */
export function paredeComoUtc(instante: number): number {
  const p = partesEmLisboa(new Date(instante));
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
}

function dois(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * UTC → a parede de Lisboa, para o `value` dos campos: `"2026-11-20T22:00"`. Os segundos
 * descartam-se (os campos são de minutos).
 */
export function paraCampo(inicio: string): string {
  const p = partesEmLisboa(new Date(inicio));
  return `${String(p.ano).padStart(4, "0")}-${dois(p.mes)}-${dois(p.dia)}T${dois(p.hora)}:${dois(p.minuto)}`;
}

export type MotivoDeRecusa =
  "vazio" | "incompleto" | "invalido" | "inexistente" | "fora_do_intervalo";

export type LeituraDoCampo = { ok: true; inicio: string } | { ok: false; motivo: MotivoDeRecusa };

/**
 * Os instantes que têm esta parede em Lisboa, do mais cedo ao mais tarde: nenhum (a hora que
 * não existe na noite em que os relógios avançam), um (o caso normal) ou dois (a hora repetida
 * na noite em que atrasam). Os candidatos são a parede menos o deslocamento de antes e o de
 * depois de uma eventual mudança, e fica cada um que volta a dar a mesma parede.
 */
export function instantesDaParede(parede: number): number[] {
  const deslocamentos = new Set([
    paredeComoUtc(parede - TRES_HORAS) - (parede - TRES_HORAS),
    paredeComoUtc(parede + TRES_HORAS) - (parede + TRES_HORAS),
  ]);
  const validos = [...deslocamentos]
    .map((deslocamento) => parede - deslocamento)
    .filter((instante) => paredeComoUtc(instante) === parede);
  return [...new Set(validos)].sort((a, b) => a - b);
}

/**
 * Parede de Lisboa → instante UTC (`"2026-11-20T22:00:00Z"`).
 *
 * `incompleto` vem do `validity.badInput` do campo, que o chamador passa: um campo escrito a
 * meio tem `value === ""`, e «não escreveu» não se lê como «escreveu metade» (regra 10).
 *
 *  - a hora **repetida** (último domingo de outubro, 01:00–01:59) fica a **primeira**, como o
 *    `duplicar` do backend (`fold=0`);
 *  - a hora que **não existe** (último domingo de março, 01:00–01:59) é `inexistente`: o ecrã
 *    nunca inventa uma hora que o dono não escreveu.
 */
export function deCampo(valor: string, incompleto: boolean): LeituraDoCampo {
  if (incompleto) return { ok: false, motivo: "incompleto" };
  if (valor === "") return { ok: false, motivo: "vazio" };

  const partes = PAREDE.exec(valor);
  if (partes === null) return { ok: false, motivo: "invalido" };
  const [ano, mes, dia, hora, minuto] = partes.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (mes < 1 || mes > 12 || dia < 1 || hora > 23 || minuto > 59) {
    return { ok: false, motivo: "invalido" };
  }
  // Antes do `Date.UTC`: ele lê os anos 0 a 99 como 1900 a 1999.
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO) return { ok: false, motivo: "fora_do_intervalo" };

  const parede = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const relida = new Date(parede);
  if (relida.getUTCMonth() !== mes - 1 || relida.getUTCDate() !== dia) {
    return { ok: false, motivo: "invalido" };
  }

  const [primeiro] = instantesDaParede(parede);
  if (primeiro === undefined) return { ok: false, motivo: "inexistente" };
  return { ok: true, inicio: new Date(primeiro).toISOString().replace(".000Z", "Z") };
}
