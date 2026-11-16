import type { CategoriaGestao, ProdutoGestao } from "../../../lib/api/gestao-ementa";

/**
 * O redutor puro da lista da ementa de gestão (F4-02): tudo sem mutar o
 * argumento, e devolvendo **a mesma referência** quando nada muda, para o React
 * não redesenhar o que não se tocou.
 *
 * «Repor do servidor» não precisa de função: é trocar a lista inteira pela da
 * resposta do `GET`.
 */
export type Movimento = "subir" | "descer" | "inicio" | "fim";

/**
 * Troca o produto (pelo `id`) pela resposta do servidor, na mesma posição. Se o
 * `categoria_id` mudou, sai da categoria antiga e entra **no fim** da nova (é o
 * que o backend faz). Um `id` desconhecido deixa a lista como estava.
 */
export function substituirProduto(
  categorias: CategoriaGestao[],
  produto: ProdutoGestao,
): CategoriaGestao[] {
  const origem = categorias.find((categoria) =>
    categoria.produtos.some((existente) => existente.id === produto.id),
  );
  if (origem === undefined) return categorias;

  if (origem.id === produto.categoria_id) {
    return categorias.map((categoria) =>
      categoria === origem
        ? {
            ...categoria,
            produtos: categoria.produtos.map((existente) =>
              existente.id === produto.id ? produto : existente,
            ),
          }
        : categoria,
    );
  }

  return categorias.map((categoria) => {
    if (categoria === origem) {
      return {
        ...categoria,
        produtos: categoria.produtos.filter((existente) => existente.id !== produto.id),
      };
    }
    if (categoria.id === produto.categoria_id) {
      return { ...categoria, produtos: [...categoria.produtos, produto] };
    }
    return categoria;
  });
}

/** Acrescenta no fim da categoria do produto. */
export function acrescentarProduto(
  categorias: CategoriaGestao[],
  produto: ProdutoGestao,
): CategoriaGestao[] {
  if (!categorias.some((categoria) => categoria.id === produto.categoria_id)) return categorias;
  return categorias.map((categoria) =>
    categoria.id === produto.categoria_id
      ? { ...categoria, produtos: [...categoria.produtos, produto] }
      : categoria,
  );
}

/** Move um item da lista; nos limites (ou com um `id` desconhecido) não faz nada. */
export function moverNaLista<T extends { id: number }>(
  lista: readonly T[],
  id: number,
  movimento: Movimento,
): T[] {
  const de = lista.findIndex((item) => item.id === id);
  if (de === -1) return [...lista];

  const ultimo = lista.length - 1;
  const para = {
    subir: Math.max(de - 1, 0),
    descer: Math.min(de + 1, ultimo),
    inicio: 0,
    fim: ultimo,
  }[movimento];
  if (para === de) return [...lista];

  const nova = [...lista];
  const [movido] = nova.splice(de, 1);
  if (movido !== undefined) nova.splice(para, 0, movido);
  return nova;
}

/**
 * Põe os produtos da categoria pela ordem dos `ids` (para o «Desfazer» e para o
 * «Cancelar»). Um produto que os `ids` não nomeiam fica no fim, na ordem em que
 * estava: nunca se perde um produto por uma lista incompleta.
 */
export function ordenarProdutosDaCategoria(
  categorias: CategoriaGestao[],
  categoriaId: number,
  ids: readonly number[],
): CategoriaGestao[] {
  return categorias.map((categoria) => {
    if (categoria.id !== categoriaId) return categoria;
    const posicao = new Map(ids.map((id, indice) => [id, indice]));
    const dentro = categoria.produtos
      .filter((produto) => posicao.has(produto.id))
      .sort((a, b) => (posicao.get(a.id) ?? 0) - (posicao.get(b.id) ?? 0));
    const fora = categoria.produtos.filter((produto) => !posicao.has(produto.id));
    return { ...categoria, produtos: [...dentro, ...fora] };
  });
}

/**
 * Repõe só o campo `disponivel` do produto `id`, no item que a lista tem **agora**
 * (não numa cópia antiga): um preço ou um nome guardados entretanto ficam. Um `id`
 * desconhecido deixa a lista como estava.
 */
export function reporDisponivel(
  categorias: CategoriaGestao[],
  id: number,
  disponivel: boolean,
): CategoriaGestao[] {
  if (!categorias.some((c) => c.produtos.some((produto) => produto.id === id))) return categorias;
  return categorias.map((categoria) =>
    categoria.produtos.some((produto) => produto.id === id)
      ? {
          ...categoria,
          produtos: categoria.produtos.map((produto) =>
            produto.id === id ? { ...produto, disponivel } : produto,
          ),
        }
      : categoria,
  );
}
