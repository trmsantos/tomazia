import { DIAS_DA_SEMANA, MESES, partesEmLisboa } from "../../../lib/formato/data-do-evento";

const UM_DIA = 86_400_000;

/** `23:40`, com dois pontos e sempre com minutos. */
function horaEMinuto(hora: number, minuto: number): string {
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

/** «à 01:10» à uma da manhã; «às» em todas as outras (a regra da hora da F4-03). */
function comHora(hora: number, minuto: number): string {
  return `${hora === 1 ? "à" : "às"} ${horaEMinuto(hora, minuto)}`;
}

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
 * Quando a foto foi enviada, em Lisboa (F4-04, spec 4.3 e 15): `hoje, às 23:40`,
 * `ontem, à 01:10`, `no sábado, 14 de novembro, às 23:40` e, noutro ano, `na sexta-feira,
 * 1 de janeiro de 2027, às 22:00`. A linha junta «Enviada » à frente e o `alt` «Foto enviada »:
 * uma só fonte para a data.
 *
 * «Hoje» e «ontem» pelo dia de calendário de Lisboa (o horário do bar não entra: a hora vem
 * sempre escrita). Tudo lido por `partesEmLisboa`, nunca pelo fuso do aparelho; o `agora` entra
 * por argumento, a função nunca lê o relógio. Lança se o aparelho não conhecer Lisboa.
 */
export function quandoFoiEnviada(criadaEm: string, agora: Date): string {
  const foto = partesEmLisboa(new Date(criadaEm));
  const hoje = partesEmLisboa(agora);
  const hora = comHora(foto.hora, foto.minuto);

  const diaDaFoto = Date.UTC(foto.ano, foto.mes - 1, foto.dia);
  const diaDeHoje = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia);
  const dias = Math.round((diaDeHoje - diaDaFoto) / UM_DIA);

  if (dias === 0) return `hoje, ${hora}`;
  if (dias === 1) return `ontem, ${hora}`;

  const diaDaSemana = daTabela(DIAS_DA_SEMANA, new Date(diaDaFoto).getUTCDay(), "dia da semana");
  const artigo = diaDaSemana === "sábado" || diaDaSemana === "domingo" ? "no" : "na";
  const mes = daTabela(MESES, foto.mes - 1, "mês");
  const data = `${String(foto.dia)} de ${mes}${foto.ano === hoje.ano ? "" : ` de ${String(foto.ano)}`}`;
  return `${artigo} ${diaDaSemana}, ${data}, ${hora}`;
}
