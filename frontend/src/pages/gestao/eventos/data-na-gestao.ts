import { DIAS_DA_SEMANA, MESES, partesEmLisboa } from "../../../lib/formato/data-do-evento";
import { TEXTOS } from "./textos";

/**
 * A data de um evento como a gestão a escreve (F4-03, spec 4.4): **absoluta**, em Lisboa,
 * `Quinta-feira, 5 de novembro, às 22:00` — o ano só quando não é o corrente de Lisboa. O dono
 * planeia, e «Hoje» ou «Amanhã» desatualizavam-se a meio da noite.
 *
 * Função pura: o `agora` entra por argumento. Os nomes vêm das tabelas da data pública, nunca
 * do `Intl` do aparelho; sem a hora de Lisboa no aparelho, **lança** (o ecrã mostra o erro
 * próprio, nunca uma data no fuso do aparelho). Um `inicio` a `null` (só num rascunho) diz
 * `TEXTOS.semData`.
 */
export function formatarDataNaGestao(inicio: string | null, agora: Date): string {
  if (inicio === null) return TEXTOS.semData;

  const evento = partesEmLisboa(new Date(inicio));
  const corrente = partesEmLisboa(agora);

  const diaDaSemana =
    DIAS_DA_SEMANA[new Date(Date.UTC(evento.ano, evento.mes - 1, evento.dia)).getUTCDay()];
  const mes = MESES[evento.mes - 1];
  if (diaDaSemana === undefined || mes === undefined) {
    throw new Error("Não consegui escrever a data: o dia ou o mês não estão na tabela.");
  }

  const hora = `${String(evento.hora).padStart(2, "0")}:${String(evento.minuto).padStart(2, "0")}`;
  const nome = diaDaSemana.charAt(0).toUpperCase() + diaDaSemana.slice(1);
  const ano = evento.ano === corrente.ano ? "" : ` de ${String(evento.ano)}`;
  return `${nome}, ${String(evento.dia)} de ${mes}${ano}, ${TEXTOS.comHora(hora)}`;
}
