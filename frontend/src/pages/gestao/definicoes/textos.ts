import type { DiaDaSemana } from "./horario-do-formulario";

/**
 * Todo o texto visível de «Mais › Definições» (F4-05a, `docs/ecras/F4-05a.md`,
 * secção 16). PT-PT, tratamento por tu, maiúscula só no início, reticências em `…`.
 *
 * O ecrã **nunca** mostra a `mensagem` do backend (é genérica): usa o `campo` do
 * 422 e as frases daqui.
 */

/**
 * O que dizem «onde aparece» os painéis do horário (singular) e dos contactos
 * (plural). Duas frases completas, e não uma cauda comum.
 *
 * Dizem «secção» e não «página» (está na mesma página que a ementa) e não dizem
 * onde ela está: as secções podem mudar de ordem e «no fim da página» passava a
 * ser falso (F3-06a, 9.1).
 */
export const ONDE_APARECE_VISITA_NOS = {
  singular: "Aparece na secção Visita-nos do site.",
  plural: "Aparecem na secção Visita-nos do site. Deixa um campo vazio para o esconder.",
} as const;

export const TEXTOS = {
  titulo: "Definições",
  voltarAMais: "Voltar a Mais",
  ligacaoNoMais: "Definições",
  linhaDaLigacaoNoMais: "WiFi, horário, morada e contactos",
  primeiraVez: "Ainda não há definições guardadas. Preenche o que quiseres e guarda.",

  painelWifi: "WiFi",
  painelHorario: "Horário",
  painelContactos: "Morada e contactos",
  ondeApareceWifi:
    "Aparece no botão WiFi do site. Qualquer pessoa pode ver a password, mesmo sem estar no bar.",
  ondeApareceHorario: ONDE_APARECE_VISITA_NOS.singular,
  ondeApareceContactos: ONDE_APARECE_VISITA_NOS.plural,

  etiquetaRede: "Nome da rede",
  etiquetaPassword: "Password do WiFi",
  etiquetaMorada: "Morada",
  etiquetaTelefone: "Telefone",
  etiquetaInstagram: "Instagram",
  etiquetaMaps: "Link do Google Maps",
  ajudaInstagram:
    "O endereço completo do perfil, a começar por https://www.instagram.com/ Não escrevas só o @nome.",
  ajudaMaps: "Cola aqui o link que o Google Maps dá em Partilhar.",
  wifiVazio: "Sem a rede ou sem a password, o site mostra «Pergunta no balcão.»",
  wifiEspacos: "Este texto começa ou acaba com um espaço. Fica guardado tal como está.",

  horarioNaoConfigurado:
    "O horário ainda não está configurado. Enquanto for assim, o site não mostra o horário.",
  configurarHorario: "Configurar o horário",
  horarioInvalido: "O horário guardado não é válido e o site não o mostra. Escreve um novo.",
  escreverHorarioNovo: "Escrever um horário novo",
  horarioInvalidoAviso:
    "Se guardares as outras definições sem escreveres um horário novo, o horário inválido é apagado.",
  fechado: "Fechado.",
  diaPorDecidir: "Por preencher.",
  marcarComoFechado: "Marcar como fechado",
  abre: "Abre",
  fecha: "Fecha",
  adicionarPeriodo: "Adicionar período",
  limiteDePeriodos: "No máximo seis períodos por dia.",
  copiarParaOutrosDias: "Copiar para outros dias",
  removerOHorario: "Remover o horário",
  horarioRemovido: "Horário removido. Falta guardar para o site deixar de o mostrar.",
  desfazer: "Desfazer",
  copiarNenhum: "Nenhum",
  copiarTodos: "Todos",
  cancelar: "Cancelar",
  copiar: "Copiar",

  guardar: "Guardar alterações",
  aGuardar: "A guardar…",
  haAlteracoes: "Há alterações por guardar.",
  corrigeOsCampos: "Corrige os campos assinalados.",
  sucesso: "Definições guardadas.",

  erroTextoLongo: "O texto tem no máximo 200 caracteres.",
  erroTextoQuebra: "O texto tem de estar numa só linha.",
  erroLinkEspacos: "O endereço não pode ter espaços.",
  erroLinkEsquema: "O endereço tem de começar por https://.",
  erroLinkArroba:
    "Escreve o endereço do perfil, como https://www.instagram.com/nome. Não escrevas só o @nome.",
  erroLinkIncompleto: "O endereço não está completo.",
  erroLinkInstagram: "Usa o endereço do perfil no instagram.com, a começar por https://.",
  erroLinkLongo: "O endereço tem no máximo 500 caracteres.",
  erroHoraAbre: "Indica a hora a que abre.",
  erroHoraFecha: "Indica a hora a que fecha.",
  erroHoraIncompleta: "A hora está incompleta. Escolhe a hora e os minutos.",
  erroHoraInvalida: "Esta hora não é válida. Escolhe-a no seletor.",
  erroHoraIgual: "A hora de fecho tem de ser diferente da de abertura.",
  erroSobreposicao: "Há períodos que se sobrepõem. Confirma as horas.",
  erroDiaSemPeriodos: "Acrescenta um período ou marca o dia como fechado.",
  erroPeriodosDemais: "Há períodos a mais. O máximo são seis por dia.",

  guardarSemResposta:
    "Não sei se as alterações ficaram guardadas. Toca em Guardar alterações outra vez: guardar duas vezes dá o mesmo resultado.",
  guardarServidor:
    "Não consegui guardar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  guardar422SemCampo: "Não consegui guardar. Confirma os campos e tenta outra vez.",

  carregarTitulo: "Não consegui carregar as definições.",
  carregarSemResposta: "Verifica a ligação e tenta outra vez.",
  carregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",

  saidaTitulo: "Há alterações por guardar.",
  saidaLinha: "Se saíres agora, perdes o que escreveste.",
  saidaSair: "Sair sem guardar",
  saidaContinuar: "Continuar a editar",
} as const;

/** O que o 422 diz de cada campo de topo (o `campo` do envelope). Nunca a `mensagem` do backend. */
export const ERRO_422_POR_CAMPO = {
  wifi_rede: "Este texto não é válido.",
  wifi_password: "Este texto não é válido.",
  morada: "Este texto não é válido.",
  telefone: "Este texto não é válido.",
  instagram: "Este endereço não é válido.",
  maps_url: "Este endereço não é válido.",
  horario: "O horário não é válido. Confirma as horas de cada dia.",
} as const;

const NOMES_DOS_DIAS: Record<DiaDaSemana, string> = {
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
  sabado: "Sábado",
  domingo: "Domingo",
};

const DIA_SEGUINTE: Record<DiaDaSemana, DiaDaSemana> = {
  segunda: "terca",
  terca: "quarta",
  quarta: "quinta",
  quinta: "sexta",
  sexta: "sabado",
  sabado: "domingo",
  domingo: "segunda",
};

/** «Segunda-feira»: início de linha (etiqueta do interruptor). */
export function nomeDoDia(dia: DiaDaSemana): string {
  return NOMES_DOS_DIAS[dia];
}

/** «segunda-feira»: dentro de uma frase e em `aria-label`. */
export function nomeDoDiaEmFrase(dia: DiaDaSemana): string {
  return NOMES_DOS_DIAS[dia].toLowerCase();
}

export function legendaDoDia(dia: DiaDaSemana): string {
  return `Horário de ${nomeDoDiaEmFrase(dia)}`;
}

function nomeDaHora(etiqueta: string, dia: DiaDaSemana, n: number, total: number): string {
  return total === 1
    ? `${etiqueta}, ${nomeDoDiaEmFrase(dia)}`
    : `${etiqueta}, período ${String(n)} de ${nomeDoDiaEmFrase(dia)}`;
}

/** Começa pela etiqueta visível (WCAG 2.5.3). */
export function nomeDeAbre(dia: DiaDaSemana, n: number, total: number): string {
  return nomeDaHora(TEXTOS.abre, dia, n, total);
}

export function nomeDeFecha(dia: DiaDaSemana, n: number, total: number): string {
  return nomeDaHora(TEXTOS.fecha, dia, n, total);
}

export function rotuloDoPeriodo(n: number): string {
  return `Período ${String(n)}`;
}

export function nomeDeRemoverPeriodo(dia: DiaDaSemana, n: number): string {
  return `Remover período ${String(n)} de ${nomeDoDiaEmFrase(dia)}`;
}

/** «Fecha às 02:00 de sábado.»; à 01:00 diz-se no singular. */
export function fechaNoDiaSeguinte(dia: DiaDaSemana, hora: string): string {
  const preposicao = hora.startsWith("01:") ? "à" : "às";
  return `Fecha ${preposicao} ${hora} de ${nomeDoDiaEmFrase(DIA_SEGUINTE[dia])}.`;
}

export function copiadoPara(n: number): string {
  return n === 1 ? "Copiado para 1 dia." : `Copiado para ${String(n)} dias.`;
}

export function faltaOHorarioDe(dia: DiaDaSemana): string {
  return `Falta o horário de ${nomeDoDiaEmFrase(dia)}. Escolhe as horas ou marca o dia como fechado.`;
}

export function tituloDeCopiar(dia: DiaDaSemana): string {
  return `Copiar o horário de ${nomeDoDiaEmFrase(dia)}`;
}

export function explicacaoDeCopiar(dia: DiaDaSemana): string {
  return `O horário dos dias escolhidos é substituído pelo de ${nomeDoDiaEmFrase(dia)}.`;
}

/** Por baixo de «Adicionar período», só quando o dia tem **um** período. */
export const AJUDA_DO_PRIMEIRO_PERIODO = "Usa outro período se o bar fechar a meio do dia.";

/** O texto visível do botão; o nome acessível é `nomeDeRemoverPeriodo` (começa por este). */
export function textoDeRemoverPeriodo(n: number): string {
  return `Remover período ${String(n)}`;
}
