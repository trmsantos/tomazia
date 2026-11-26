/**
 * O texto visível fixo da secção «Visita-nos», todo ele, palavra por palavra
 * como está na secção 9 de `docs/ecras/F3-06a.md` (validada pelo dominio-bar).
 *
 * As frases que dependem da hora («Aberto até às 02:00», «Fechado · Abre
 * amanhã às 17:00») e os nomes dos dias escrevem-se em
 * `src/lib/horario/nomes-e-textos.ts`. O rótulo «Ver no Instagram» é devolvido
 * por `src/lib/ligacoes/contactos.ts` e está aqui para a tabela da secção 9
 * ter a cópia que `textos-do-visita-nos.test.ts` confere.
 */
export const TEXTOS = {
  titulo: "Visita-nos",
  tituloDoHorario: "Horário",
  legendaDaTabela: "Horário de abertura",
  fechado: "Fechado",
  tituloDosContactos: "Morada e contactos",
  etiquetaMorada: "Morada",
  etiquetaLocalizacao: "Localização",
  etiquetaTelefone: "Telefone",
  etiquetaInstagram: "Instagram",
  abrirNoMaps: "Abrir no Google Maps",
  verNoInstagram: "Ver no Instagram",
  erroTitulo: "Não consegui carregar o horário e os contactos.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
} as const;
