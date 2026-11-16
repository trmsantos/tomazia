import { formatarPreco } from "../../../lib/formato/preco";

/**
 * O texto visível da ementa na gestão (`docs/ecras/F4-02.md`, secção 14), num só
 * sítio: os ecrãs e os avisos partilham frases (a de «Não consegui guardar»
 * serve o preço, o interruptor e a folha), e duas cópias discordavam em silêncio.
 *
 * Português de Portugal, maiúscula só no início, sem emojis nem setas.
 */
export const TEXTOS = {
  titulo: "Ementa",
  pesquisa: "Pesquisar produto",
  navegacaoDeCategorias: "Categorias",
  umProdutoEncontrado: "1 produto encontrado.",
  semResultadosTitulo: "Não encontrei nada com esse nome.",
  semResultadosLinha: "Tenta outra palavra ou limpa a pesquisa para veres a ementa toda.",
  limparPesquisa: "Limpar pesquisa",

  categoriaEscondida: "Esta categoria não aparece na ementa.",
  categoriaSemProdutos:
    "Ainda não há produtos nesta categoria. Enquanto estiver vazia, não aparece na ementa.",
  categoriaTodaIndisponivel:
    "Todos os produtos desta categoria estão indisponíveis. Enquanto for assim, não aparece na ementa.",
  produtoIndisponivel: "Não aparece na ementa.",

  adicionarProduto: "Adicionar produto",
  etiquetaDoPreco: "Preço, em euros",
  etiquetaDisponivel: "Disponível",
  guardar: "Guardar",
  aGuardar: "A guardar…",
  cancelar: "Cancelar",
  desfazer: "Desfazer",

  erroPrecoVazio: "Escreve o preço.",
  erroPrecoInvalido: "Escreve só algarismos e vírgula, como 6,50.",
  erroPrecoDecimais: "Usa no máximo dois algarismos depois da vírgula, como 6,50.",
  erroPrecoAlto: "O preço é demasiado alto.",
  erroPreco422: "O preço não é válido.",

  avisoOferta: "Este produto fica como oferta na ementa.",
  alteracaoDesfeita: "Alteração desfeita.",

  ordenar: "Ordenar",
  guardarOrdem: "Guardar ordem",
  subir: "Subir",
  descer: "Descer",
  paraOInicio: "Para o início",
  paraOFim: "Para o fim",
  ordemGuardada: "Ordem guardada.",

  erroGuardarSemResposta: "Não consegui guardar. Verifica a ligação e tenta outra vez.",
  erroCriarSemResposta:
    "Não sei se o produto ficou guardado. Atualizei a lista: vê se já lá está antes de tentar outra vez.",
  erroGuardarServidor:
    "Não consegui guardar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  erro422SemCampo: "Não consegui guardar. Confirma os campos e tenta outra vez.",
  erroOrdemSemResposta: "Não consegui guardar a ordem. Verifica a ligação e tenta outra vez.",
  erroOrdemServidor:
    "Não consegui guardar a ordem. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  erro409:
    "A ordem não ficou guardada porque a lista mudou entretanto. Atualizei-a: confirma a ordem e tenta outra vez.",
  erroDesfazerOrdem409:
    "Não consegui repor a ordem anterior: a ementa mudou entretanto. Já mostro a lista atual.",
  erroDesfazerSemResposta: "Não consegui desfazer. Verifica a ligação e tenta outra vez.",
  erroDesfazerOrdemServidor: "Não consegui desfazer. A ordem nova continua guardada.",
  erro404Produto: "Este produto já não existe. Atualizei a ementa.",
  erro404Categoria: "Esta categoria já não existe. Atualizei a ementa.",

  vazioTitulo: "Ainda não há ementa.",
  vazioLinha: "Ainda não há categorias para mostrar.",
  erroDeCarregarTitulo: "Não consegui carregar a ementa.",
  erroDeCarregarSemResposta: "Verifica a ligação e tenta outra vez.",
  erroDeCarregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  listaDesatualizadaSemResposta:
    "A lista pode estar desatualizada. Verifica a ligação e tenta outra vez.",
  listaDesatualizadaServidor:
    "A lista pode estar desatualizada. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  tituloAdicionar: "Adicionar produto",
  tituloEditar: "Editar produto",
  etiquetaNome: "Nome (obrigatório)",
  etiquetaDescricao: "Descrição (opcional)",
  etiquetaPrecoDaFolha: "Preço, em euros, com IVA (obrigatório)",
  etiquetaCategoria: "Categoria (obrigatória)",
  escolheACategoria: "Escolhe a categoria",
  guardarProduto: "Guardar produto",
  guardarAlteracoes: "Guardar alterações",
  erroNomeVazio: "Escreve o nome do produto.",
  erroNomeLongo: "O nome tem no máximo 120 caracteres.",
  erroDescricaoLonga: "A descrição tem no máximo 280 caracteres.",
  erroCategoriaEmFalta: "Escolhe a categoria.",
  erroCategoriaInexistente: "Essa categoria já não existe. Escolhe outra.",
  produtoAdicionado: "Produto adicionado.",
  produtoAtualizado: "Produto atualizado.",
} as const;

export function encontrados(quantos: number): string {
  return quantos === 1 ? TEXTOS.umProdutoEncontrado : `${String(quantos)} produtos encontrados.`;
}

/** «{nome} voltou a estar disponível.» / «{nome} deixou de estar disponível.» */
export function avisoDeDisponivel(nome: string, disponivel: boolean): string {
  return disponivel ? `${nome} voltou a estar disponível.` : `${nome} deixou de estar disponível.`;
}

export function avisoDePrecoAtualizado(novoCent: number): string {
  return `Preço atualizado para ${formatarPreco(novoCent)}.`;
}

/** O aviso das dez vezes: o valor novo e, por baixo, o que lá estava. */
export function avisoDeSubida(novoCent: number, anteriorCent: number): string {
  return `${avisoDePrecoAtualizado(novoCent)} Antes era ${formatarPreco(anteriorCent)}.`;
}

export function avisoDePrecoQueFicou(precoCent: number): string {
  if (precoCent === 0) return "Não consegui desfazer. Este produto continua como oferta.";
  return `Não consegui desfazer. O preço continua ${formatarPreco(precoCent)}.`;
}

export function avisoDeDisponivelQueFicou(nome: string, disponivel: boolean): string {
  return `Não consegui desfazer. ${nome} continua ${disponivel ? "disponível" : "indisponível"}.`;
}

export function produtoMovidoPara(categoria: string): string {
  return `Produto movido para ${categoria}.`;
}

export function aOrdenar(categoria: string): string {
  return `A ordenar ${categoria}.`;
}

export function posicao(nome: string, n: number, total: number): string {
  return `${nome}: posição ${String(n)} de ${String(total)}.`;
}

export function jaEmPrimeiro(nome: string): string {
  return `${nome} já está em primeiro lugar.`;
}

export function jaEmUltimo(nome: string): string {
  return `${nome} já está em último lugar.`;
}

/** O nome do botão do preço: o que o leitor de ecrã diz, com o produto. */
export function nomeDoBotaoDoPreco(nome: string, precoCent: number): string {
  const preco = formatarPreco(precoCent);
  if (preco === "") return `Alterar o preço de ${nome}, sem preço`;
  return `Alterar o preço de ${nome}, agora ${precoCent === 0 ? "oferta" : preco}`;
}

export const TEXTO_DO_ERRO_DE_PRECO = {
  vazio: TEXTOS.erroPrecoVazio,
  invalido: TEXTOS.erroPrecoInvalido,
  decimais: TEXTOS.erroPrecoDecimais,
  demasiado_grande: TEXTOS.erroPrecoAlto,
} as const;
