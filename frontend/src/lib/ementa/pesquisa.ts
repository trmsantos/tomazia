/**
 * A pesquisa da ementa, no cliente (F3-02, secção 4).
 *
 * Não há rota de pesquisa e não vai haver: a ementa inteira já veio num
 * pedido, e filtrar aqui é instantâneo, funciona com a rede em baixo e não
 * gasta dados.
 *
 * O que condiz: o nome do produto, por subcadeia, e o nome da categoria — e
 * nesse caso o cartão vem **inteiro**, porque quem escreve «cafes» quer os
 * cafés todos. A descrição **não** condiz: uma tónica a aparecer numa pesquisa
 * por «gin» porque a descrição diz «com gin» é um resultado que a pessoa não
 * consegue explicar a olhar para o ecrã. A regra, em voz alta: o que se
 * pesquisa é o que se vê em letra grande.
 *
 * Os acentos ignoram-se **nos dois sentidos**, e é por isso que há um índice:
 * normaliza-se uma vez por produto, quando a ementa chega, e não a cada tecla.
 * Normalizar só o termo é o erro clássico — encontra o que está sem acento e
 * falha o que o tem — e passa despercebido a qualquer bateria cujas fixturas
 * não tenham acentos.
 *
 * O resultado normalizado nunca chega ao ecrã: serve só para comparar.
 */
import type { Ementa } from "../api/publico";

/** Um cartão da ementa, como vem da API. */
export type CategoriaPublica = Ementa["categorias"][number];

/** Uma linha da ementa, como vem da API. */
export type ProdutoPublico = CategoriaPublica["produtos"][number];

/** O produto com o seu nome já normalizado. */
export type ProdutoIndexado = {
  produto: ProdutoPublico;
  procuravel: string;
};

/** A categoria com o nome dela e os dos produtos já normalizados. */
export type CategoriaIndexada = {
  categoria: CategoriaPublica;
  procuravel: string;
  produtos: ProdutoIndexado[];
};

/**
 * Sem acentos e em minúsculas, para comparar.
 *
 * A decomposição separa a letra do acento e a classe de diacríticos apaga o
 * acento; as minúsculas vão com o locale português, que é o que trata o caso
 * das letras com diacrítico da mesma maneira em todas as plataformas.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt");
}

/**
 * O índice da ementa, construído uma vez quando ela chega.
 *
 * Deita fora as categorias sem produtos. O backend nunca devolve nenhuma (a
 * junção interna trata disso), mas o frontend não confia nisso — e é daqui que
 * sai a invariante «um chip por cartão, sempre»: os chips e os cartões saem
 * ambos desta lista.
 */
export function indexarEmenta(categorias: readonly CategoriaPublica[]): CategoriaIndexada[] {
  return categorias
    .filter((categoria) => categoria.produtos.length > 0)
    .map((categoria) => ({
      categoria,
      procuravel: normalizar(categoria.nome),
      produtos: categoria.produtos.map((produto) => ({
        produto,
        procuravel: normalizar(produto.nome),
      })),
    }));
}

/**
 * Os cartões que condizem com o termo, pela ordem original.
 *
 * Um termo que não é uma pesquisa — vazio, só espaços — devolve a ementa
 * inteira. Sem mínimo de caracteres: esperar pela segunda letra faz o campo
 * parecer avariado durante uma tecla.
 */
export function filtrarEmenta(
  indice: readonly CategoriaIndexada[],
  termo: string,
): CategoriaPublica[] {
  const procurado = normalizar(termo.trim().replace(/\s+/g, " "));
  if (procurado === "") return indice.map((entrada) => entrada.categoria);

  const encontradas: CategoriaPublica[] = [];

  for (const entrada of indice) {
    if (entrada.procuravel.includes(procurado)) {
      encontradas.push(entrada.categoria);
      continue;
    }

    const produtos = entrada.produtos
      .filter((linha) => linha.procuravel.includes(procurado))
      .map((linha) => linha.produto);

    if (produtos.length > 0) encontradas.push({ ...entrada.categoria, produtos });
  }

  return encontradas;
}
