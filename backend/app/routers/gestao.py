"""O router da área de gestão: protegido por construção, não rota a rota.

`dependencies=[Depends(exigir_admin)]` no **router**, não em cada rota: uma
rota nova que esqueça `Depends(exigir_admin)` à mão fica protegida na mesma,
porque a proteção não depende de ninguém se lembrar de a repetir.
`tests/seguranca/test_s04_gestao_exige_sessao.py` (Camada 4) lê exatamente isto.

O mesmo vale para o `Cache-Control: no-store`: vem da `route_class` do
router (`RotaDeGestao`), não de cada função. Cobre as respostas `Response`
diretas (a imagem de uma foto) e, pelos tratadores de `app/erros.py`, também
os erros.

Sem lógica aqui: o trabalho é de `app/services/gestao.py` e
`app/services/fotos.py`, no mesmo padrão de `app/routers/publico.py`.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.routing import APIRoute

from app.dependencias import IdDaBD, SessaoDaBD
from app.schemas.erros import RespostaDeErro
from app.schemas.fotos import RespostaFilaDeModeracao, RespostaModeracao
from app.schemas.gestao import (
    CategoriaGestao,
    PedidoAlterarCategoria,
    PedidoAlterarProduto,
    PedidoCriarCategoria,
    PedidoCriarProduto,
    PedidoOrdem,
    ProdutoGestao,
    RespostaEmentaGestao,
)
from app.services import fotos as servico
from app.services import gestao as ementa
from app.services.auth import exigir_admin

#: Nunca em cache: a foto que o dono acabou de rejeitar não pode continuar
#: a aparecer a partir da cache do browser dele.
SEM_CACHE = "no-store"


class RotaDeGestao(APIRoute):
    """Toda a resposta de uma rota de gestão sai com `no-store`.

    Os erros recebem o mesmo cabeçalho pelo caminho do pedido
    (`app.erros.caminho_de_gestao`), que também cobre os que nunca chegam
    a casar uma rota.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def tratador(pedido: Request) -> Response:
            resposta = await original(pedido)
            resposta.headers["Cache-Control"] = SEM_CACHE
            return resposta

        return tratador


#: Para o OpenAPI: `GET /fotos/{id}/imagem` devolve bytes de imagem, nunca
#: JSON — sem isto, o esquema gerado prometia `application/json` (o
#: omisso do FastAPI) e o TypeScript gerado tratava a resposta como se
#: fosse um objeto. Mesma família de achado da herança da F2-04.
_RESPOSTA_IMAGEM: dict[int | str, dict[str, Any]] = {
    200: {"content": {"image/webp": {}}}
}

#: O `401` vem da dependência do router, comum a todas as rotas.
_R401: dict[int | str, dict[str, Any]] = {
    401: {"model": RespostaDeErro, "description": "Sem sessão válida."}
}


def _respostas(*codigos: tuple[int, str]) -> dict[int | str, dict[str, Any]]:
    """O `401` mais os códigos que a rota levanta, todos com o envelope."""
    respostas = dict(_R401)
    for estado, descricao in codigos:
        respostas[estado] = {"model": RespostaDeErro, "description": descricao}
    return respostas


_422 = (422, "Corpo ou parâmetros inválidos: `erro` é `dados_invalidos`.")
_404_CATEGORIA = (404, "A categoria não existe: `categoria_inexistente`.")
_404_PRODUTO = (404, "O produto não existe: `produto_inexistente`.")
_409_LISTA = (409, "A lista já não é o conjunto atual: `lista_desatualizada`.")

router = APIRouter(
    dependencies=[Depends(exigir_admin)], route_class=RotaDeGestao, responses=_R401
)


_404_FOTO = (404, "A foto não existe: `foto_nao_encontrada`.")


@router.get("/fotos", response_model=RespostaFilaDeModeracao)
def listar_fotos_pendentes(sessao: SessaoDaBD) -> RespostaFilaDeModeracao:
    """A fila de moderação, da foto mais antiga para a mais recente."""
    return servico.listar_pendentes(sessao)


@router.get(
    "/fotos/{id}/imagem",
    responses={**_RESPOSTA_IMAGEM, **_respostas(_404_FOTO, _422)},
)
def obter_imagem_pendente(id_foto: IdDaBD, sessao: SessaoDaBD) -> Response:
    """Os bytes de uma foto, pendente ou já aprovada. `404` sem ela (S-03)."""
    conteudo = servico.obter_bytes_da_imagem(sessao, id_foto)
    return Response(content=conteudo, media_type="image/webp")


@router.post(
    "/fotos/{id}/aprovar",
    response_model=RespostaModeracao,
    responses=_respostas(
        _404_FOTO, (409, "A foto já foi moderada: `foto_ja_moderada`."), _422
    ),
)
def aprovar_foto(id_foto: IdDaBD, sessao: SessaoDaBD) -> RespostaModeracao:
    """Move a foto para `MEDIA_DIR` e marca-a aprovada. `409` se já moderada."""
    foto = servico.aprovar(sessao, id_foto)
    return RespostaModeracao(id=foto.id, estado=foto.estado)


@router.post(
    "/fotos/{id}/rejeitar",
    response_model=RespostaModeracao,
    responses=_respostas(
        _404_FOTO, (409, "A foto já foi moderada: `foto_ja_moderada`."), _422
    ),
)
def rejeitar_foto(id_foto: IdDaBD, sessao: SessaoDaBD) -> RespostaModeracao:
    """Marca a foto rejeitada e apaga os bytes. A linha nunca se apaga."""
    foto = servico.rejeitar(sessao, id_foto)
    return RespostaModeracao(id=foto.id, estado=foto.estado)


# --------------------------------------------------------------------------
# Ementa: categorias, produtos e ordem
#
# `/categorias/ordem` declara-se antes de `/categorias/{id}`.
# --------------------------------------------------------------------------


@router.get("/categorias", response_model=RespostaEmentaGestao)
def listar_categorias(sessao: SessaoDaBD) -> RespostaEmentaGestao:
    """Toda a ementa, incluindo o escondido e o indisponível, por ordem."""
    return ementa.obter_ementa(sessao)


@router.post(
    "/categorias",
    status_code=201,
    response_model=CategoriaGestao,
    responses=_respostas((409, "O slug gerado já existe: `categoria_repetida`."), _422),
)
def criar_categoria(sessao: SessaoDaBD, corpo: PedidoCriarCategoria) -> CategoriaGestao:
    """Cria a categoria no fim. O slug vem do nome e nunca mais muda."""
    return ementa.criar_categoria(sessao, corpo)


@router.put(
    "/categorias/ordem",
    status_code=204,
    responses=_respostas(_409_LISTA, _422),
)
def reordenar_categorias(sessao: SessaoDaBD, corpo: PedidoOrdem) -> None:
    """`ids` é a lista completa das categorias, pela ordem pretendida."""
    ementa.reordenar_categorias(sessao, corpo.ids)


@router.patch(
    "/categorias/{id}",
    response_model=CategoriaGestao,
    responses=_respostas(_404_CATEGORIA, _422),
)
def alterar_categoria(
    id_categoria: IdDaBD, sessao: SessaoDaBD, corpo: PedidoAlterarCategoria
) -> CategoriaGestao:
    """Muda o nome e/ou a visibilidade. O slug não muda. Corpo `{}`: nada muda."""
    return ementa.alterar_categoria(sessao, id_categoria, corpo)


@router.delete(
    "/categorias/{id}",
    status_code=204,
    responses=_respostas(
        _404_CATEGORIA,
        (409, "A categoria ainda tem produtos: `categoria_com_produtos`."),
        _422,
    ),
)
def eliminar_categoria(id_categoria: IdDaBD, sessao: SessaoDaBD) -> None:
    ementa.eliminar_categoria(sessao, id_categoria)


@router.put(
    "/categorias/{id}/produtos/ordem",
    status_code=204,
    responses=_respostas(_404_CATEGORIA, _409_LISTA, _422),
)
def reordenar_produtos(
    id_categoria: IdDaBD, sessao: SessaoDaBD, corpo: PedidoOrdem
) -> None:
    """`ids` é a lista completa dos produtos desta categoria."""
    ementa.reordenar_produtos(sessao, id_categoria, corpo.ids)


@router.post(
    "/produtos",
    status_code=201,
    response_model=ProdutoGestao,
    responses=_respostas(
        (
            422,
            "Corpo inválido (`dados_invalidos`) ou categoria que não existe "
            "(`categoria_inexistente`, com `campo` = `categoria_id`).",
        )
    ),
)
def criar_produto(sessao: SessaoDaBD, corpo: PedidoCriarProduto) -> ProdutoGestao:
    """Cria o produto no fim da categoria."""
    return ementa.criar_produto(sessao, corpo)


@router.patch(
    "/produtos/{id}",
    response_model=ProdutoGestao,
    responses=_respostas(
        _404_PRODUTO,
        (
            422,
            "Corpo inválido (`dados_invalidos`) ou categoria que não existe "
            "(`categoria_inexistente`, com `campo` = `categoria_id`).",
        ),
    ),
)
def alterar_produto(
    id_produto: IdDaBD, sessao: SessaoDaBD, corpo: PedidoAlterarProduto
) -> ProdutoGestao:
    """Valores absolutos, nunca alternar. Mudar de categoria põe-no no fim da nova."""
    return ementa.alterar_produto(sessao, id_produto, corpo)


@router.delete(
    "/produtos/{id}",
    status_code=204,
    responses=_respostas(_404_PRODUTO, _422),
)
def eliminar_produto(id_produto: IdDaBD, sessao: SessaoDaBD) -> None:
    ementa.eliminar_produto(sessao, id_produto)
