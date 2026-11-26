import { MESES, partesEmLisboa } from "../../../lib/formato/data-do-evento";

/**
 * Todo o texto visível de «Mais › Clientes» (F4-05b, `docs/ecras/F4-05b.md`, secção 12). PT-PT,
 * tratamento por tu, maiúscula só no início, reticências em `…`. «Tem a certeza?» é a única frase
 * formal. O ecrã **nunca** mostra a `mensagem` do backend: só as frases daqui.
 */
export const TEXTOS = {
  titulo: "Clientes",
  voltar: "Voltar a Mais",
  linhaNoMais: "Clientes",
  descricaoNoMais: "Quem se registou no site",

  h2: "Clientes registados",
  h2N: (n: number): string => `Clientes registados (${String(n)})`,
  eliminar: "Eliminar",
  consentimento: (data: string): string => `Consentimento dado a ${data}.`,

  vazioTitulo: "Não há clientes registados.",
  vazioLinha: "Quem se registar no site aparece aqui.",

  erroTitulo: "Não consegui carregar os clientes.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  desatualizada: "Não consegui atualizar esta lista. Pode estar desatualizada.",

  aMostrar: (x: number, n: number): string => `A mostrar ${String(x)} de ${String(n)}.`,
  mostrarMais: "Mostrar mais clientes",

  exportar: "Exportar CSV",
  aPreparar: "A preparar…",
  ajudaDoCsv: "Descarrega todos os clientes, com a versão dos termos e a data de inscrição.",
  avisoDoCsv: "O ficheiro tem dados pessoais dos clientes. Guarda-o só onde precisares.",
  csvPreparado: "Ficheiro CSV preparado. Se não aparecer nas descargas, exporta outra vez.",
  csvSemResposta: "Não consegui preparar o ficheiro. Verifica a ligação e tenta outra vez.",
  csvServidor:
    "Não consegui preparar o ficheiro. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  tituloDaFolha: "Tem a certeza?",
  consequencia: "Os dados deste cliente são eliminados e não se pode desfazer.",
  linhaDoCsv: "Um CSV que já descarregaste continua a ter este cliente.",
  aEliminar: "A eliminar…",
  cancelar: "Cancelar",
  erroNaFolha:
    "Não consegui eliminar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  avisoEliminado: "Cliente eliminado.",
  jaNaoExistia: "Esse cliente já não existia.",

  // Sem resposta (spec 7.6): nunca se diz «eliminado» nem «não eliminado» como facto.
  aVerificar: "Não consegui confirmar se o cliente foi eliminado. A verificar…",
  continuaSemResposta: "Não consegui eliminar. Verifica a ligação e tenta outra vez.",
  semConfirmar:
    "Não consegui confirmar se o cliente foi eliminado. Verifica a ligação e toca em Verificar outra vez.",
  verificarOutraVez: "Verificar outra vez",
} as const;

/**
 * «14 de novembro de 2026»: o dia do consentimento em Lisboa, **sempre com o ano** (a lista tem
 * clientes de anos diferentes) e sem hora. Lança se o aparelho não souber ler Lisboa: o ecrã trata
 * isso como erro de carregar, nunca como uma data no fuso do aparelho.
 */
export function dataDoConsentimento(instante: string): string {
  const { ano, mes, dia } = partesEmLisboa(new Date(instante));
  const nomeDoMes = MESES[mes - 1];
  if (nomeDoMes === undefined) {
    throw new Error("Não consegui escrever a data: o mês não está na tabela.");
  }
  return `${String(dia)} de ${nomeDoMes} de ${String(ano)}`;
}
