/**
 * O texto da tabela 12 de `docs/ecras/F4-04b.md`, por extenso e **sem dependências** (nem React nem
 * o ecrã): serve os testes de componente (`fotos-gestao.tsx` reexporta-o) e as varreduras de
 * texto, que correm em `node`. Só para testes; nada em produção o importa.
 */
export const TEXTOS_APROVADAS = {
  titulo: "Fotos no site",
  tituloN: (n: number): string => `Fotos no site (${String(n)})`,
  eliminar: "Eliminar",
  aEliminar: "A eliminar…",
  cancelar: "Cancelar",
  nomeDoBotao: (quando: string): string => `Eliminar foto aprovada ${quando}`,
  aprovadaEm: (quando: string): string => `Aprovada ${quando}`,
  enviadaPor: (nome: string): string => `Enviada por ${nome}`,
  semImagem: "Sem imagem",
  vazioTitulo: "Ainda não há fotos no site.",
  vazioLinha: "As que aprovares aparecem aqui.",
  carregarTitulo: "Não consegui carregar as fotos do site.",
  carregarSemResposta: "Verifica a ligação e tenta outra vez.",
  carregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  aMostrar: (x: number, n: number): string => `A mostrar ${String(x)} de ${String(n)}.`,
  mostrarMais: "Mostrar mais fotos",
  tituloDaFolha: "Tem a certeza?",
  avisoDaFolha: "A foto deixa de aparecer no site e é eliminada. Não se pode desfazer.",
  naoSeMostra: "Esta foto não se consegue mostrar.",
  erroNaFolha:
    "Não consegui eliminar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  avisoEliminada: "Foto eliminada.",
  jaNaoExistia: "Essa foto já não existia.",
  jaNaoEstaNoSite: "Essa foto já não está no site.",
  aVerificar: "Não consegui confirmar se a foto foi eliminada. A verificar…",
  continuaSemResposta: "Não consegui eliminar. Verifica a ligação e tenta outra vez.",
  semConfirmar:
    "Não consegui confirmar se a foto foi eliminada. Verifica a ligação e toca em Verificar outra vez.",
  verificarOutraVez: "Verificar outra vez",
  desatualizada: "Não consegui atualizar esta lista. Pode estar desatualizada.",
} as const;
