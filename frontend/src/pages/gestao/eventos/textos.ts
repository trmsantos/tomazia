/**
 * O texto visível dos eventos na gestão, todo ele (F4-03, `docs/ecras/F4-03.md`, 16).
 *
 * PT-PT, maiúscula só no início, sem emojis, sem setas, reticências em `…`. Os ecrãs e os
 * testes pegam aqui, nunca em frases escritas à mão. «Tem a certeza?» é a única frase formal
 * (regra 6 do `CLAUDE.md`); o resto fala por «tu».
 *
 * Três frases de aviso existem em duas formas, de propósito: a que leva o título
 * («Publiquei «X». No site, pode levar um minuto a aparecer.») e o pedaço que lhe é comum
 * (`eventoPublicadoNoSite`, `eventoPublicadoSoTres`, `eventoNoArquivo`). A frase com título é
 * sempre construída a partir do pedaço, para as duas nunca discordarem.
 */

/** A primeira letra em minúscula: a data de uma frase («… para quinta-feira, 19 de novembro…»). */
function minuscula(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** Os pedaços de frase que mais de uma frase usa (uma só escrita de cada). */
const SITE_UM_MINUTO_A_APARECER = "No site, pode levar um minuto a aparecer.";
const SO_TRES = "o site só mostra os três primeiros eventos.";
const NO_ARQUIVO = "ficou no arquivo: a data já passou e o site não o mostra.";
const SEM_DATA = "Sem data, não se pode publicar. Abre o evento e escolhe uma.";

export const TEXTOS = {
  // --- A página -------------------------------------------------------------
  titulo: "Eventos",
  novoEvento: "Novo evento",
  proximos: "Próximos",
  rascunhos: "Rascunhos",
  arquivo: "Arquivo",
  linhaDosProximos: "O site mostra os três primeiros, por ordem de data.",
  linhaDosRascunhos: "Os rascunhos não aparecem no site.",
  divisoria: "O site só mostra os três eventos de cima. Os de baixo ficam à espera.",
  esconderOArquivo: "Esconder o arquivo",
  verOArquivo: (n: number): string => `Ver o arquivo (${String(n)})`,
  mostrarMais: (n: number): string => `Mostrar mais ${String(n)}`,

  // --- A linha --------------------------------------------------------------
  /** A linha da data de um rascunho sem data (4.4): é a própria frase, sem nota à parte. */
  semData: SEM_DATA,
  /** Igual a `semData`: o contrato de nomes tem as duas chaves, o ecrã desenha a frase uma vez. */
  notaSemData: SEM_DATA,
  notaPassada: "A data já passou. Se publicares, o evento vai para o arquivo.",
  notaHoje: "Hoje.",
  duplicar: "Duplicar",
  aDuplicar: "A duplicar…",
  /** «às 22:00», e «à 01:00» à uma da manhã: uma só função escreve a hora em todas as frases. */
  comHora: (hhmm: string): string => (hhmm.startsWith("01:") ? `à ${hhmm}` : `às ${hhmm}`),
  publicadoDe: (titulo: string): string => `Publicado, ${titulo}`,
  etiquetaPublicado: "Publicado",
  duplicarDe: (titulo: string): string => `Duplicar ${titulo}`,

  // --- Vazio e carregar -----------------------------------------------------
  vazioTitulo: "Ainda não há eventos.",
  vazioLinha: "Quando criares um, aparece aqui.",
  proximosVazios:
    "Não há eventos publicados para os próximos dias. O site não mostra a secção de eventos.",
  carregarTitulo: "Não consegui carregar os eventos.",
  carregarSemResposta: "Verifica a ligação e tenta outra vez.",
  carregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  /** Um aparelho sem a hora de Lisboa não escreve datas (regra 10: nunca uma data no fuso errado). */
  semLisboaTitulo: "Não consegui mostrar os eventos.",
  semLisboa:
    "Este aparelho não sabe que horas são em Lisboa, por isso não consigo escrever as datas. Tenta noutro aparelho.",

  // --- A folha de criar e de editar ----------------------------------------
  tituloCriar: "Novo evento",
  tituloEditar: "Editar evento",
  etiquetaTitulo: "Título",
  etiquetaDescricao: "Descrição (opcional)",
  etiquetaData: "Data",
  etiquetaHora: "Hora",
  contadorFaltam: (n: number): string => `Faltam ${String(n)} caracteres.`,
  contadorUm: "Falta 1 carácter.",
  contadorLimite: "Chegaste ao limite de 1000 caracteres.",
  avisoDeFuso: "A hora é a de Lisboa, mesmo que o telemóvel esteja noutro fuso.",
  ajudaMeiaNoite: "Depois da meia-noite conta como o dia seguinte.",
  /** Num evento já publicado: a data passada tira-o do site. */
  dataPassada: "Esta data já passou. O evento vai para o arquivo e não aparece no site.",
  /** Em «Novo evento» e num rascunho: ainda se pode escolher não publicar. */
  dataPassadaRascunho:
    "Esta data já passou. Se publicares, o evento vai para o arquivo e não aparece no site.",
  dataLonge: "Esta data é daqui a mais de um ano. Confirma o ano.",
  assimApareceTitulo: "Assim aparece no site.",
  legendaPublicado: "É assim que o site mostra este evento.",
  legendaRascunho: "Assim vai aparecer no site, quando o publicares.",
  temCartaz: "Este evento tem cartaz, que não se pode mudar por aqui.",
  estadoRascunho: "Rascunho. Não aparece no site.",
  estadoPublicado: "Publicado. Para o despublicar, usa o interruptor da lista.",
  publicar: "Publicar",
  guardarRascunho: "Guardar rascunho",
  guardarAlteracoes: "Guardar alterações",
  aGuardar: "A guardar…",
  cancelar: "Cancelar",
  eliminarEvento: "Eliminar evento",

  // --- A folha de duplicar --------------------------------------------------
  tituloDuplicar: "Duplicar evento",
  tituloDoOriginal: (titulo: string): string => `«${titulo}»`,
  daquiASemanas: (n: number): string =>
    n === 1 ? "Daqui a 1 semana" : `Daqui a ${String(n)} semanas`,

  // --- A folha de eliminar --------------------------------------------------
  tituloEliminar: "Tem a certeza?",
  vaisEliminar: (titulo: string, data: string | null): string =>
    data === null
      ? `Vais eliminar «${titulo}», que ainda não tem data.`
      : `Vais eliminar «${titulo}» (${minuscula(data)}).`,
  eliminarAviso: "Se estiver publicado, deixa de aparecer no site. Não se pode desfazer.",
  eliminar: "Eliminar",
  aEliminar: "A eliminar…",

  // --- Erros de campo -------------------------------------------------------
  erroTituloVazio: "Escreve o título do evento.",
  erroTituloLongo: "O título tem no máximo 120 caracteres.",
  erroDescricaoLonga: "A descrição tem no máximo 1000 caracteres.",
  erroDataVazia: "Escolhe a data.",
  erroDataIncompleta: "A data não está completa.",
  erroDataInvalida: "Escolhe uma data válida.",
  erroHoraVazia: "Escolhe a hora.",
  erroHoraIncompleta: "A hora não está completa.",
  erroHoraInexistente:
    "Nessa noite os relógios avançam da 01:00 para as 02:00, e essa hora não existe. Escolhe outra.",
  erroPublicarSemData: "Para publicar, escolhe a data e a hora.",
  erro422Titulo: "O título não é válido.",
  erro422Descricao: "A descrição não é válida.",
  erro422Data: "Esta data não é válida.",
  erro422SemCampo: "Não consegui guardar. Confirma os campos e tenta outra vez.",
  corrigeOsCampos: "Corrige os campos assinalados.",

  // --- Avisos de sucesso ----------------------------------------------------
  eventoPublicadoNoSite: SITE_UM_MINUTO_A_APARECER,
  eventoPublicadoSoTres: SO_TRES,
  eventoNoArquivo: NO_ARQUIVO,
  publicadoNoSite: (titulo: string): string =>
    `Publiquei «${titulo}». ${SITE_UM_MINUTO_A_APARECER}`,
  publicadoSoTres: (titulo: string): string => `Publiquei «${titulo}», mas ${SO_TRES}`,
  publicadoNoArquivo: (titulo: string): string => `«${titulo}» ${NO_ARQUIVO}`,
  despublicadoDoSite: (titulo: string): string =>
    `«${titulo}» passou a rascunho. No site, pode levar um minuto a desaparecer.`,
  rascunhoGuardado: "Rascunho guardado. Ainda não aparece no site.",
  eventoAtualizado: "Evento atualizado. No site, pode levar um minuto a mudar.",
  eventoAtualizadoSoTres: "Evento atualizado, mas o site só mostra os três primeiros eventos.",
  rascunhoAtualizado: "Rascunho atualizado.",
  rascunhoCriadoPara: (data: string): string => `Rascunho criado para ${minuscula(data)}.`,
  rascunhoCriadoSemData: "Rascunho criado, ainda sem data.",
  eventoEliminado: "Evento eliminado.",
  eventoEliminadoNoSite: "Evento eliminado. No site, pode levar um minuto a desaparecer.",
  eventoGuardadoSemResposta: "O evento ficou guardado. Atualizei a lista.",

  // --- Avisos de erro e «não sei» -------------------------------------------
  duplicarSemSaber:
    "Não sei se o rascunho ficou criado. Atualizei a lista: vê se já lá está antes de tentar outra vez.",
  duplicar422: "Não consegui duplicar este evento. Confirma a data dele e tenta outra vez.",
  duplicarServidor:
    "Não consegui duplicar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  eliminarContinuaLa: "Não consegui eliminar o evento. Verifica a ligação e tenta outra vez.",
  eliminarSemSaber: "Não sei se o evento foi eliminado. Atualiza a lista para ver.",
  desfazer: "Desfazer",
  desfazerSemResposta: "Não consegui desfazer. Verifica a ligação e tenta outra vez.",
  desfazerServidor:
    "Não consegui desfazer. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  desfazerRascunhoFicou: "Não consegui desfazer. O rascunho ficou na lista.",
  semRespostaGuardar:
    "Não sei se as alterações ficaram guardadas. Volta a tocar no mesmo botão: guardar duas vezes dá o mesmo resultado.",
  semRespostaInterruptor:
    "Não sei se ficou guardado. Toca no interruptor outra vez: repetir dá o mesmo resultado.",
  criarNaoEncontrado: "Não encontrei o evento na lista. Podes tentar outra vez.",
  criarSemSaber: "Não sei se o evento ficou guardado. Verifica a ligação e atualiza a lista.",
  servidorGuardar:
    "Não consegui guardar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  servidorEliminar:
    "Não consegui eliminar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  jaNaoExiste: "Este evento já não existe. Atualizei a lista.",
  /** Um 422 `evento_sem_data` (outro telemóvel limpou a data): a mesma frase da linha sem data. */
  semDataCorrida: SEM_DATA,

  // --- A lista ficou velha --------------------------------------------------
  recarregarFalhou: "Guardei, mas não consegui atualizar a lista.",
  recarregarSemResposta: "Verifica a ligação e toca em Atualizar.",
  recarregarServidor: "O problema é nosso. Toca em Atualizar daqui a pouco.",
  atualizar: "Atualizar",

  // --- Sair com alterações por guardar --------------------------------------
  saidaTitulo: "Há alterações por guardar.",
  saidaLinha: "Se saíres agora, perdes o que escreveste.",
  saidaSair: "Sair sem guardar",
  saidaContinuar: "Continuar a editar",
} as const;

/** O `campo` de um 422 → a frase junto do campo (10.2). `evento_sem_data` tem a sua própria. */
export const ERRO_422_POR_CAMPO = {
  titulo: TEXTOS.erro422Titulo,
  inicio: TEXTOS.erro422Data,
  descricao: TEXTOS.erro422Descricao,
} as const;
