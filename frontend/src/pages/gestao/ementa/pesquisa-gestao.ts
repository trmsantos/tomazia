import { normalizar } from "../../../lib/ementa/pesquisa";
import type { CategoriaGestao } from "../../../lib/api/gestao-ementa";

/**
 * O índice de pesquisa da gestão (F4-02, 3.1).
 *
 * Reusa `normalizar` da pesquisa pública (sem acentos, sem maiúsculas) mas
 * **não deita fora as categorias vazias** como o `indexarEmenta` público: a
 * gestão mostra tudo, escondido e indisponível incluídos. E condiz **só com o
 * nome do produto**: na gestão procura-se um produto para o mudar, e «gin» a
 * trazer a categoria inteira de gin é ruído.
 *
 * Cuidado: o `normalizar` não junta espaços; faz-se aqui, para `vinho   tinto`
 * condizer com `Vinho tinto`.
 */
export type IndiceDaGestao = {
  categoria: CategoriaGestao;
  produtos: { procuravel: string; id: number }[];
}[];

function juntarEspacos(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

export function indexarEmentaGestao(categorias: readonly CategoriaGestao[]): IndiceDaGestao {
  return categorias.map((categoria) => ({
    categoria,
    produtos: categoria.produtos.map((produto) => ({
      id: produto.id,
      procuravel: normalizar(juntarEspacos(produto.nome)),
    })),
  }));
}

/**
 * Termo vazio ou só espaços: **todas** as categorias, vazias e escondidas
 * incluídas. Com termo: só as categorias com produtos que condizem, cada uma só
 * com esses, pela ordem original.
 */
export function filtrarEmentaGestao(indice: IndiceDaGestao, termo: string): CategoriaGestao[] {
  const procurado = normalizar(juntarEspacos(termo));
  if (procurado === "") return indice.map((entrada) => entrada.categoria);

  const encontradas: CategoriaGestao[] = [];
  for (const entrada of indice) {
    const ids = new Set(
      entrada.produtos.filter((p) => p.procuravel.includes(procurado)).map((p) => p.id),
    );
    if (ids.size === 0) continue;
    encontradas.push({
      ...entrada.categoria,
      produtos: entrada.categoria.produtos.filter((produto) => ids.has(produto.id)),
    });
  }
  return encontradas;
}
