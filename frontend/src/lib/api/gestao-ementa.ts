/**
 * A API da ementa na gestão (F4-02): carregar tudo, criar e alterar produtos,
 * reordenar os produtos de uma categoria.
 *
 * **A superfície é exatamente estas quatro funções.** Categorias (criar,
 * renomear, reordenar, esconder) e eliminar produto são da F4-02b: nem
 * `reordenarCategorias` nem nenhum `DELETE` existem aqui.
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa). Os erros
 * chegam como `ErroDaApi`: `estado === null` é «não houve resposta» — e numa
 * mutação isso quer dizer **não sei se gravou**, por isso este módulo nunca
 * repete um pedido por conta própria (um `POST` repetido duplicava o produto).
 */
import { type OpcoesDePedido, pedir } from "./cliente";
import type { components, paths } from "./gerado/esquema";

const CAMINHO_CATEGORIAS = "/gestao/categorias" satisfies keyof paths;
const CAMINHO_PRODUTOS = "/gestao/produtos" satisfies keyof paths;
const CAMINHO_PRODUTO = "/gestao/produtos/{id}" satisfies keyof paths;
const CAMINHO_ORDEM_DOS_PRODUTOS = "/gestao/categorias/{id}/produtos/ordem" satisfies keyof paths;

export type EmentaGestao = components["schemas"]["RespostaEmentaGestao"];
export type CategoriaGestao = components["schemas"]["CategoriaGestao"];
export type ProdutoGestao = components["schemas"]["ProdutoGestao"];
export type NovoProduto = components["schemas"]["PedidoCriarProduto"];
export type AlteracaoDeProduto = components["schemas"]["PedidoAlterarProduto"];

/** `GET /api/gestao/categorias` — todas as categorias e todos os produtos, escondidos e indisponíveis incluídos. */
export function obterEmentaGestao(opcoes?: OpcoesDePedido): Promise<EmentaGestao> {
  return pedir<EmentaGestao>(CAMINHO_CATEGORIAS, opcoes);
}

/** `POST /api/gestao/produtos` — 201, no fim da categoria. A descrição vazia omite-se. */
export function criarProduto(novo: NovoProduto, opcoes?: OpcoesDePedido): Promise<ProdutoGestao> {
  const { descricao, ...resto } = novo;
  const corpo: Record<string, unknown> = { ...resto };
  if (descricao !== undefined && descricao !== null && descricao !== "") {
    corpo["descricao"] = descricao;
  }
  return pedir<ProdutoGestao>(CAMINHO_PRODUTOS, { ...opcoes, metodo: "POST", corpo });
}

/**
 * `PATCH /api/gestao/produtos/{id}` — só as chaves que o chamador deu. `null`
 * só passa na `descricao` (é a forma de a limpar); as outras chaves nunca o
 * levam: o tipo já não o permite e o filtro garante-o em execução.
 */
export function alterarProduto(
  id: number,
  alteracao: AlteracaoDeProduto,
  opcoes?: OpcoesDePedido,
): Promise<ProdutoGestao> {
  const corpo: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(alteracao)) {
    if (valor === undefined) continue;
    if (valor === null && chave !== "descricao") continue;
    corpo[chave] = valor;
  }
  return pedir<ProdutoGestao>(CAMINHO_PRODUTO.replace("{id}", String(id)), {
    ...opcoes,
    metodo: "PATCH",
    corpo,
  });
}

/**
 * `PUT /api/gestao/categorias/{id}/produtos/ordem` — 204. `ids` é a lista
 * **completa** da categoria, indisponíveis incluídos. 409 `lista_desatualizada`
 * quando a categoria mudou entretanto.
 */
export async function reordenarProdutos(
  categoriaId: number,
  ids: readonly number[],
  opcoes?: OpcoesDePedido,
): Promise<void> {
  await pedir<undefined>(CAMINHO_ORDEM_DOS_PRODUTOS.replace("{id}", String(categoriaId)), {
    ...opcoes,
    metodo: "PUT",
    corpo: { ids: [...ids] },
    semCorpo: true,
  });
}
