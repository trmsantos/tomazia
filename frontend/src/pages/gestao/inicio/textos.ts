/**
 * Todo o texto visível do Início da gestão (F4-05b, `docs/ecras/F4-05b.md`, secções 4 e 12).
 * PT-PT, tratamento por tu, maiúscula só no início, reticências em `…`. O ecrã **nunca** mostra a
 * `mensagem` do backend: só as frases daqui.
 */
export const TEXTOS = {
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

/** «Há 3 fotos à espera.» / «Há 1 foto à espera.» / «Não há fotos à espera.» */
export function fraseDasFotos(n: number): string {
  if (n === 0) return TEXTOS.fotos0;
  return n === 1 ? TEXTOS.fotos1 : TEXTOS.fotosN(n);
}

export function fraseDosRegistos(n: number): string {
  if (n === 0) return TEXTOS.registos0;
  return n === 1 ? TEXTOS.registos1 : TEXTOS.registosN(n);
}
