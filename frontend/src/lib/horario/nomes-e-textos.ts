/**
 * Como se escrevem os nomes dos dias, a hora, o período e a linha do momento
 * (F3-06a, 5.1, 5.2 e 9).
 *
 * Não importa nada de `pages/gestao`: o texto do público não pode depender de
 * uma pasta que o público nunca carrega.
 *
 * Cada forma da secção 9 é escrita por uma regra, e a regra está ao lado da
 * frase: o artigo («às», «à 01:00», «à meia-noite»), o dia («na quinta», «no
 * sábado») e a forma «próxima», que só vale quando o dia da abertura é o de hoje.
 */
import type { DiaDaSemana, EstadoDoHorario, Periodo } from "./estado-do-horario";

/** Os nomes completos da tabela (5.2). */
export const NOMES_DOS_DIAS: Record<DiaDaSemana, string> = {
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
  sabado: "Sábado",
  domingo: "Domingo",
};

/**
 * O dia na frase: minúsculas, sem «-feira», e com o artigo que lhe cabe («na
 * quinta», «no sábado»). O género decide também o «próxima»/«próximo».
 */
const NA_FRASE: Record<
  DiaDaSemana,
  { artigo: "na" | "no"; proximo: "próxima" | "próximo"; nome: string }
> = {
  segunda: { artigo: "na", proximo: "próxima", nome: "segunda" },
  terca: { artigo: "na", proximo: "próxima", nome: "terça" },
  quarta: { artigo: "na", proximo: "próxima", nome: "quarta" },
  quinta: { artigo: "na", proximo: "próxima", nome: "quinta" },
  sexta: { artigo: "na", proximo: "próxima", nome: "sexta" },
  sabado: { artigo: "no", proximo: "próximo", nome: "sábado" },
  domingo: { artigo: "no", proximo: "próximo", nome: "domingo" },
};

const MEIA_NOITE = "00:00";

/**
 * A hora com o artigo: «às 02:00», «à 01:30» e «à meia-noite».
 *
 * «às» para todas as horas **exceto a hora 1** («à 01:00») e a meia-noite
 * exata, que se diz por extenso: «até às 00:00» lê-se como uma data de
 * computador. Só na linha do momento; a tabela mantém «00:00».
 */
export function horaPorExtenso(hora: string): string {
  if (hora === MEIA_NOITE) return "à meia-noite";
  return hora.startsWith("01:") ? `à ${hora}` : `às ${hora}`;
}

/** «17:00 às 02:00». «às» sempre, e nunca «-»: um leitor de ecrã diz «menos». */
export function textoDoPeriodo(periodo: Periodo): string {
  return `${periodo.abre} às ${periodo.fecha}`;
}

/**
 * A linha do momento: «Aberto até às 02:00», «Fechado · Abre amanhã às 17:00».
 *
 * **«Fechado» sozinho só quando não há próxima abertura**: os sete dias sem
 * períodos, uma afirmação do dono.
 */
export function textoDaLinhaDoMomento(estado: EstadoDoHorario): string {
  if (estado.tipo === "aberto") return `Aberto até ${horaPorExtenso(estado.fechaAs)}`;
  if (estado.abre === null) return "Fechado";

  const { quando, hora } = estado.abre;
  return `Fechado · Abre ${quandoNaFrase(quando, estado.hoje)} ${horaPorExtenso(hora)}`;
}

function quandoNaFrase(quando: "hoje" | "amanhã" | DiaDaSemana, hoje: DiaDaSemana): string {
  if (quando === "hoje" || quando === "amanhã") return quando;

  const dia = NA_FRASE[quando];
  // A mesma terça da semana que vem: «na terça» seria ambíguo, e hoje é terça.
  if (quando === hoje) return `${dia.artigo} ${dia.proximo} ${dia.nome}`;
  return `${dia.artigo} ${dia.nome}`;
}
