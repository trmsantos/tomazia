"""A gestão da ementa: categorias, produtos e a ordem de ambos.

Três decisões que atravessam o ficheiro:

- **Escrever primeiro, verificar depois.** O `sqlite3` do Python só abre a
  transação no primeiro `INSERT`/`UPDATE`/`DELETE`: ler, validar e escrever
  não é atómico, e dois pedidos podiam entrelaçar-se. Na reordenação o
  primeiro SQL sobre a tabela é o `UPDATE`, que abre a transação e fica com
  o lock de escrita; só depois se confere, ainda dentro dela, se a lista era
  exatamente o conjunto atual. Se não era, `ROLLBACK`.
- **A posição no fim** calcula-se na própria instrução (`MAX(ordem) + 1` numa
  subconsulta do `INSERT`), não lida antes: dois `POST` ao mesmo tempo não
  empatam.
- **O slug fica fixo** depois de criado. Mudar o nome não o muda: o nome não
  tem unicidade e o `slug` é o que os links e a importação usam.

Nada aqui faz escape de texto: guarda-se o que foi escrito.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import case, delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.erros import ErroDaApi
from app.models.ementa import Categoria, Produto
from app.schemas.gestao import (
    CategoriaGestao,
    PedidoAlterarCategoria,
    PedidoAlterarProduto,
    PedidoCriarCategoria,
    PedidoCriarProduto,
    ProdutoGestao,
    RespostaEmentaGestao,
)
from app.services.sql import id_inserido, linhas_afetadas
from app.slug import normalizar_slug

MENSAGEM_CATEGORIA_INEXISTENTE = (
    "Esta categoria já não existe. Recarrega a página e tenta novamente."
)
MENSAGEM_PRODUTO_INEXISTENTE = (
    "Este produto já não existe. Recarrega a página e tenta novamente."
)
MENSAGEM_CATEGORIA_REPETIDA = (
    "Já existe uma categoria com este nome ou com um nome muito parecido. "
    "Escolhe outro nome."
)
MENSAGEM_CATEGORIA_COM_PRODUTOS = (
    "Esta categoria ainda tem produtos. Elimina-os ou muda-os de categoria primeiro."
)
MENSAGEM_LISTA_DESATUALIZADA = (
    "A lista mudou entretanto. Recarrega a página e tenta novamente."
)
LIMITE_DO_SLUG = 60  # `String(60)` da coluna `categorias.slug`
MENSAGEM_NOME_COMPRIDO_NO_SLUG = "O nome é demasiado comprido. Escolhe um mais curto."
MENSAGEM_NOME_SEM_LETRAS = "O nome tem de ter pelo menos uma letra ou um algarismo."


def _produto_de_gestao(linha: Any) -> ProdutoGestao:
    return ProdutoGestao(
        id=linha.id,
        categoria_id=linha.categoria_id,
        nome=linha.nome,
        descricao=linha.descricao,
        preco_cent=linha.preco_cent,
        disponivel=linha.disponivel,
    )


_COLUNAS_DO_PRODUTO = (
    Produto.id,
    Produto.categoria_id,
    Produto.nome,
    Produto.descricao,
    Produto.preco_cent,
    Produto.disponivel,
)


def _produtos_da_categoria(sessao: Session, categoria_id: int) -> list[ProdutoGestao]:
    linhas = sessao.execute(
        select(*_COLUNAS_DO_PRODUTO)
        .where(Produto.categoria_id == categoria_id)
        .order_by(Produto.ordem, Produto.id)
    ).all()
    return [_produto_de_gestao(linha) for linha in linhas]


def _categoria_de_gestao(sessao: Session, categoria: Categoria) -> CategoriaGestao:
    return CategoriaGestao(
        id=categoria.id,
        nome=categoria.nome,
        slug=categoria.slug,
        visivel=categoria.visivel,
        produtos=_produtos_da_categoria(sessao, categoria.id),
    )


def _categoria_existe(sessao: Session, categoria_id: int) -> bool:
    return (
        sessao.execute(select(Categoria.id).where(Categoria.id == categoria_id)).first()
        is not None
    )


def _categoria_inexistente() -> ErroDaApi:
    return ErroDaApi(404, "categoria_inexistente", MENSAGEM_CATEGORIA_INEXISTENTE)


def _categoria_inexistente_no_corpo() -> ErroDaApi:
    return ErroDaApi(
        422,
        "categoria_inexistente",
        MENSAGEM_CATEGORIA_INEXISTENTE,
        campo="categoria_id",
    )


def _produto_inexistente() -> ErroDaApi:
    return ErroDaApi(404, "produto_inexistente", MENSAGEM_PRODUTO_INEXISTENTE)


# --------------------------------------------------------------------------
# Ler
# --------------------------------------------------------------------------


def obter_ementa(sessao: Session) -> RespostaEmentaGestao:
    """Tudo, incluindo categorias escondidas e produtos indisponíveis."""
    categorias = sessao.execute(
        select(Categoria).order_by(Categoria.ordem, Categoria.id)
    ).scalars()
    produtos_por_categoria: dict[int, list[ProdutoGestao]] = {}
    linhas = sessao.execute(
        select(*_COLUNAS_DO_PRODUTO).order_by(Produto.ordem, Produto.id)
    ).all()
    for linha in linhas:
        produtos_por_categoria.setdefault(linha.categoria_id, []).append(
            _produto_de_gestao(linha)
        )
    return RespostaEmentaGestao(
        categorias=[
            CategoriaGestao(
                id=categoria.id,
                nome=categoria.nome,
                slug=categoria.slug,
                visivel=categoria.visivel,
                produtos=produtos_por_categoria.get(categoria.id, []),
            )
            for categoria in categorias
        ]
    )


# --------------------------------------------------------------------------
# Categorias
# --------------------------------------------------------------------------


def criar_categoria(sessao: Session, pedido: PedidoCriarCategoria) -> CategoriaGestao:
    slug = normalizar_slug(pedido.nome)
    if not slug:
        raise ErroDaApi(422, "dados_invalidos", MENSAGEM_NOME_SEM_LETRAS, campo="nome")
    if len(slug) > LIMITE_DO_SLUG:
        # O NFKD expande (a ligadura "ﬃ" dá "ffi"): um nome de 60 caracteres
        # pode dar um slug maior do que a coluna, que o SQLite não impõe.
        raise ErroDaApi(
            422, "dados_invalidos", MENSAGEM_NOME_COMPRIDO_NO_SLUG, campo="nome"
        )
    # Uma só instrução: a posição no fim lê-se na própria escrita.
    proxima = select(func.coalesce(func.max(Categoria.ordem) + 1, 0)).scalar_subquery()
    try:
        # `inserted_primary_key` e não `.returning()`: este só existe a partir
        # do SQLite 3.35, e a versão do servidor não é conhecida.
        novo_id = id_inserido(
            sessao.execute(
                insert(Categoria).values(
                    nome=pedido.nome, slug=slug, visivel=pedido.visivel, ordem=proxima
                )
            )
        )
        sessao.commit()
    except IntegrityError as erro:
        # A única restrição que um `INSERT` de categoria pode falhar é a
        # unicidade do `slug`.
        sessao.rollback()
        raise ErroDaApi(
            409, "categoria_repetida", MENSAGEM_CATEGORIA_REPETIDA
        ) from erro
    return CategoriaGestao(
        id=novo_id,
        nome=pedido.nome,
        slug=slug,
        visivel=pedido.visivel,
        produtos=[],
    )


def alterar_categoria(
    sessao: Session, id_categoria: int, pedido: PedidoAlterarCategoria
) -> CategoriaGestao:
    categoria = sessao.get(Categoria, id_categoria)
    if categoria is None:
        raise _categoria_inexistente()
    if "nome" in pedido.model_fields_set and pedido.nome is not None:
        categoria.nome = pedido.nome
    if "visivel" in pedido.model_fields_set and pedido.visivel is not None:
        categoria.visivel = pedido.visivel
    sessao.commit()
    return _categoria_de_gestao(sessao, categoria)


def eliminar_categoria(sessao: Session, id_categoria: int) -> None:
    try:
        apagadas = linhas_afetadas(
            sessao.execute(delete(Categoria).where(Categoria.id == id_categoria))
        )
    except IntegrityError as erro:
        # `ON DELETE RESTRICT`: a categoria ainda tem produtos.
        sessao.rollback()
        raise ErroDaApi(
            409, "categoria_com_produtos", MENSAGEM_CATEGORIA_COM_PRODUTOS
        ) from erro
    if apagadas == 0:
        sessao.rollback()
        raise _categoria_inexistente()
    sessao.commit()


# --------------------------------------------------------------------------
# Produtos
# --------------------------------------------------------------------------


def _ordem_no_fim_da_categoria(categoria_id: int) -> Any:
    return (
        select(func.coalesce(func.max(Produto.ordem) + 1, 0))
        .where(Produto.categoria_id == categoria_id)
        .scalar_subquery()
    )


def criar_produto(sessao: Session, pedido: PedidoCriarProduto) -> ProdutoGestao:
    if not _categoria_existe(sessao, pedido.categoria_id):
        raise _categoria_inexistente_no_corpo()
    try:
        novo_id = id_inserido(
            sessao.execute(
                insert(Produto).values(
                    categoria_id=pedido.categoria_id,
                    nome=pedido.nome,
                    descricao=pedido.descricao,
                    preco_cent=pedido.preco_cent,
                    disponivel=pedido.disponivel,
                    ordem=_ordem_no_fim_da_categoria(pedido.categoria_id),
                )
            )
        )
        sessao.commit()
    except IntegrityError as erro:
        # A categoria foi eliminada entre a verificação e a escrita.
        sessao.rollback()
        raise _categoria_inexistente_no_corpo() from erro
    return ProdutoGestao(
        id=novo_id,
        categoria_id=pedido.categoria_id,
        nome=pedido.nome,
        descricao=pedido.descricao,
        preco_cent=pedido.preco_cent,
        disponivel=pedido.disponivel,
    )


def alterar_produto(
    sessao: Session, id_produto: int, pedido: PedidoAlterarProduto
) -> ProdutoGestao:
    atual = sessao.execute(
        select(Produto.id, Produto.categoria_id).where(Produto.id == id_produto)
    ).first()
    if atual is None:
        raise _produto_inexistente()

    campos = pedido.model_fields_set
    valores: dict[str, Any] = {}
    for campo in ("nome", "descricao", "preco_cent", "disponivel"):
        if campo in campos:
            valores[campo] = getattr(pedido, campo)
    nova_categoria = pedido.categoria_id if "categoria_id" in campos else None
    if nova_categoria is not None and nova_categoria != atual.categoria_id:
        if not _categoria_existe(sessao, nova_categoria):
            raise _categoria_inexistente_no_corpo()
        valores["categoria_id"] = nova_categoria
        valores["ordem"] = _ordem_no_fim_da_categoria(nova_categoria)

    if valores:
        try:
            alterados = linhas_afetadas(
                sessao.execute(
                    update(Produto).where(Produto.id == id_produto).values(**valores)
                )
            )
            if alterados == 0:
                sessao.rollback()
                raise _produto_inexistente()
            sessao.commit()
        except IntegrityError as erro:
            sessao.rollback()
            raise _categoria_inexistente_no_corpo() from erro

    linha = sessao.execute(
        select(*_COLUNAS_DO_PRODUTO).where(Produto.id == id_produto)
    ).first()
    if linha is None:  # eliminado entre o `UPDATE` e a leitura
        raise _produto_inexistente()
    return _produto_de_gestao(linha)


def eliminar_produto(sessao: Session, id_produto: int) -> None:
    apagados = linhas_afetadas(
        sessao.execute(delete(Produto).where(Produto.id == id_produto))
    )
    if apagados == 0:
        sessao.rollback()
        raise _produto_inexistente()
    sessao.commit()


# --------------------------------------------------------------------------
# Ordem
# --------------------------------------------------------------------------


def _reordenar(
    sessao: Session,
    modelo: type[Categoria] | type[Produto],
    ids: list[int],
    *filtro: Any,
) -> None:
    """`ordem` passa a ser a posição em `ids`, ou nada muda e é `409`.

    `ids` tem de ser **exatamente** o conjunto atual (`filtro` delimita-o):
    nem de menos (uma categoria que nasceu entretanto), nem de mais (uma
    apagada, ou de outra categoria). O `UPDATE` vem primeiro porque é ele que
    abre a transação e fica com o lock de escrita; a contagem seguinte lê o
    que esta transação vê, e ninguém lhe escreve entre as duas.
    """
    alterados = 0
    if ids:
        posicoes = case(
            {id_: posicao for posicao, id_ in enumerate(ids)}, value=modelo.id
        )
        alterados = linhas_afetadas(
            sessao.execute(
                update(modelo)
                .where(modelo.id.in_(ids), *filtro)
                .values(ordem=posicoes)
                .execution_options(synchronize_session=False)
            )
        )
    existentes = sessao.execute(
        select(func.count()).select_from(modelo).where(*filtro)
    ).scalar_one()
    if alterados != len(ids) or existentes != len(ids):
        sessao.rollback()
        raise ErroDaApi(409, "lista_desatualizada", MENSAGEM_LISTA_DESATUALIZADA)
    sessao.commit()


def reordenar_categorias(sessao: Session, ids: list[int]) -> None:
    _reordenar(sessao, Categoria, ids)


def reordenar_produtos(sessao: Session, id_categoria: int, ids: list[int]) -> None:
    try:
        _reordenar(sessao, Produto, ids, Produto.categoria_id == id_categoria)
    except ErroDaApi:
        # Com o `ROLLBACK` feito, "a lista está velha" distingue-se de "a
        # categoria nem existe".
        if not _categoria_existe(sessao, id_categoria):
            raise _categoria_inexistente() from None
        raise
    else:
        if not _categoria_existe(sessao, id_categoria):
            raise _categoria_inexistente()
