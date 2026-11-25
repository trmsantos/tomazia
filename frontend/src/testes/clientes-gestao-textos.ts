/**
 * O texto da tabela 12 de `docs/ecras/F4-05b.md`, por extenso e **sem dependências** (nem React nem
 * os ecrãs): serve os testes de componente, os e2e e as varreduras de texto, que correm em `node`.
 * Os testes comparam o que o ecrã desenha com **estas** frases, não com o `textos.ts` do ecrã
 * (senão um erro de escrita passava por «igual a si próprio»). Só para testes; nada em produção o
 * importa.
 */
export const TEXTOS_INICIO = {
  titulo: "Início",
  fotosTitulo: "Fotos à espera",
  eventosTitulo: "Próximos eventos",
  registosTitulo: "Novos registos",
  fotos0: "Não há fotos à espera.",
  fotos1: "Há 1 foto à espera.",
  fotosN: (n: number): string => `Há ${String(n)} fotos à espera.`,
  irParaAFila: "Ir para a fila de fotos",
  eventosVazio: "Não há eventos publicados daqui para a frente.",
  verOsEventos: "Ver os eventos",
  registos0: "Ninguém se registou nos últimos 7 dias.",
  registos1: "Houve 1 novo registo nos últimos 7 dias.",
  registosN: (n: number): string => `Houve ${String(n)} novos registos nos últimos 7 dias.`,
  verOsClientes: "Ver os clientes",
  erroTitulo: "Não consegui carregar o resumo.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  desatualizado: "Não consegui atualizar o resumo. Pode estar desatualizado.",
} as const;

export const TEXTOS_CLIENTES = {
  titulo: "Clientes",
  tituloDoDocumento: "Clientes — Gestão — Bar da Tomazia",
  voltar: "Voltar a Mais",
  linhaNoMais: "Clientes",
  descricaoNoMais: "Quem se registou no site",
  h2: "Clientes registados",
  h2N: (n: number): string => `Clientes registados (${String(n)})`,
  eliminar: "Eliminar",
  aEliminar: "A eliminar…",
  cancelar: "Cancelar",
  consentimento: (data: string): string => `Consentimento dado a ${data}.`,
  vazioTitulo: "Não há clientes registados.",
  vazioLinha: "Quem se registar no site aparece aqui.",
  erroTitulo: "Não consegui carregar os clientes.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
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
  erroNaFolha:
    "Não consegui eliminar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  avisoEliminado: "Cliente eliminado.",
  jaNaoExistia: "Esse cliente já não existia.",
  aVerificar: "Não consegui confirmar se o cliente foi eliminado. A verificar…",
  continuaSemResposta: "Não consegui eliminar. Verifica a ligação e tenta outra vez.",
  semConfirmar:
    "Não consegui confirmar se o cliente foi eliminado. Verifica a ligação e toca em Verificar outra vez.",
  verificarOutraVez: "Verificar outra vez",
  desatualizada: "Não consegui atualizar esta lista. Pode estar desatualizada.",
  sessaoTerminou: "A sessão terminou. Entra outra vez.",
} as const;
