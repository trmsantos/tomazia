import { partesEmLisboa } from "../../../lib/formato/data-do-evento";
import { instantesDaParede, paredeComoUtc } from "./hora-de-lisboa";

/**
 * As três datas que a folha «Duplicar evento» oferece (F4-03, plano 11): uma **pré-visualização**
 * da regra do servidor, que é a única autoridade (`backend/tests/gestao/test_duplicar.py`).
 *
 * `k0` é o menor `k ≥ 1` com `original + 7k dias` (hora de parede de Lisboa) **estritamente
 * depois** de agora; a opção `n` fica em `original + 7·(k0 + n − 1)` dias. Cada candidato parte
 * da parede do original, nunca do anterior, para a hora não fugir a cada mudança de hora.
 *
 * Imita o `fold=0` do servidor também na hora que não existe (dá a hora de depois do salto):
 * aqui o dono não escreve hora nenhuma, só escolhe uma das três datas que o servidor vai dar.
 * A data que vale é a da resposta do servidor, nunca esta.
 *
 * Pura: o `agora` entra por argumento; só `Date.UTC` e `partesEmLisboa`, nunca o fuso do aparelho.
 */
export type OpcaoDeCopia = { semanas: 1 | 2 | 3; inicio: string };

const SETE_DIAS = 7 * 86_400_000;
const TRES_HORAS = 3 * 3_600_000;

/** O instante da parede, como o `fold=0`: a primeira das repetidas; a que não existe usa o deslocamento de antes do salto. */
function instanteComFold0(parede: number): number {
  const [primeiro] = instantesDaParede(parede);
  if (primeiro !== undefined) return primeiro;
  return parede - (paredeComoUtc(parede - TRES_HORAS) - (parede - TRES_HORAS));
}

export function datasDaCopia(inicio: string, agora: Date): OpcaoDeCopia[] {
  const original = new Date(inicio).getTime();
  const p = partesEmLisboa(new Date(original));
  const candidato = (k: number): number =>
    instanteComFold0(Date.UTC(p.ano, p.mes - 1, p.dia + 7 * k, p.hora, p.minuto));

  // Começa perto do `k0` (dois a menos, por causa das mudanças de hora) e sobe até passar agora.
  let k = Math.max(1, Math.floor((agora.getTime() - original) / SETE_DIAS) - 2);
  while (candidato(k) <= agora.getTime()) k += 1;
  const k0 = k;

  return ([1, 2, 3] as const).map((semanas) => ({
    semanas,
    inicio: new Date(candidato(k0 + semanas - 1)).toISOString(),
  }));
}
