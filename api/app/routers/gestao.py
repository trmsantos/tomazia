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
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.routing import APIRoute

from app.dependencias import IdDaBD, SessaoDaBD
from app.models.admins import Admin
from app.schemas.auth import RespostaAdmin
from app.schemas.erros import RespostaDeErro
from app.schemas.fotos import RespostaFilaDeModeracao, RespostaModeracao
from app.schemas.gestao import (
    CategoriaGestao,
    DefinicoesGestao,
    EventoGestao,
    PedidoAlterarCategoria,
    PedidoAlterarEvento,
    PedidoAlterarProduto,
    PedidoCriarCategoria,
    PedidoCriarEvento,
    PedidoCriarProduto,
    PedidoDefinicoes,
    PedidoMudarPassword,
    PedidoOrdem,
    ProdutoGestao,
    RespostaClientes,
    RespostaEmentaGestao,
    RespostaEventosGestao,
    RespostaResumo,
)
from app.services import auth as servico_auth
from app.services import clientes as servico_clientes
from app.services import definicoes as servico_definicoes
from app.services import eventos as servico_eventos
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


# --------------------------------------------------------------------------
# Eventos e resumo
# --------------------------------------------------------------------------

_404_EVENTO = (404, "O evento não existe: `evento_inexistente`.")


@router.get("/eventos", response_model=RespostaEventosGestao)
def listar_eventos(sessao: SessaoDaBD) -> RespostaEventosGestao:
    """`proximos`, `rascunhos` e `arquivo`, divididos no servidor (ADR 0010)."""
    return servico_eventos.obter_eventos(sessao)


@router.post(
    "/eventos",
    status_code=201,
    response_model=EventoGestao,
    responses=_respostas(_422),
)
def criar_evento(sessao: SessaoDaBD, corpo: PedidoCriarEvento) -> EventoGestao:
    """Cria um evento. A data (com fuso) é obrigatória (ADR 0009)."""
    return servico_eventos.criar_evento(sessao, corpo)


@router.patch(
    "/eventos/{id}",
    response_model=EventoGestao,
    responses=_respostas(
        _404_EVENTO,
        (
            422,
            "Corpo inválido (`dados_invalidos`) ou publicar sem data "
            "(`evento_sem_data`, com `campo` = `inicio`).",
        ),
    ),
)
def alterar_evento(
    id_evento: IdDaBD, sessao: SessaoDaBD, corpo: PedidoAlterarEvento
) -> EventoGestao:
    """Só muda o que vem no corpo. `inicio` nunca é `null`; `{}` não muda nada."""
    return servico_eventos.alterar_evento(sessao, id_evento, corpo)


@router.delete(
    "/eventos/{id}",
    status_code=204,
    responses=_respostas(_404_EVENTO, _422),
)
def eliminar_evento(id_evento: IdDaBD, sessao: SessaoDaBD) -> None:
    servico_eventos.eliminar_evento(sessao, id_evento)


@router.post(
    "/eventos/{id}/duplicar",
    status_code=201,
    response_model=EventoGestao,
    responses=_respostas(_404_EVENTO, _422),
)
def duplicar_evento(id_evento: IdDaBD, sessao: SessaoDaBD) -> EventoGestao:
    """Cria um rascunho na próxima semana livre, à mesma hora de Lisboa."""
    return servico_eventos.duplicar_evento(sessao, id_evento)


@router.get("/resumo", response_model=RespostaResumo)
def obter_resumo(sessao: SessaoDaBD) -> RespostaResumo:
    """Fotos pendentes, próximos eventos (até 3) e novos registos (7 dias)."""
    return servico_eventos.obter_resumo(sessao)


# --------------------------------------------------------------------------
# Definições, clientes e conta
# --------------------------------------------------------------------------

_404_CLIENTE = (404, "O cliente não existe: `cliente_inexistente`.")

_RESPOSTA_CSV: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/csv": {}}, "description": "O ficheiro CSV (UTF-8 com BOM)."}
}


@router.get("/definicoes", response_model=DefinicoesGestao)
def obter_definicoes(sessao: SessaoDaBD) -> DefinicoesGestao:
    """As sete definições; texto vazio como `""`, e o estado do horário."""
    return servico_definicoes.obter_definicoes(sessao)


@router.put(
    "/definicoes",
    response_model=DefinicoesGestao,
    responses=_respostas(
        (
            422,
            "Corpo inválido: `dados_invalidos`, com `campo`. O `maps_url` e o "
            "`instagram` só aceitam `https://`; o horário tem os sete dias, "
            "sem períodos sobrepostos.",
        )
    ),
)
def substituir_definicoes(
    sessao: SessaoDaBD, corpo: PedidoDefinicoes
) -> DefinicoesGestao:
    """Substitui os sete campos numa só transação. `horario: null` apaga-o."""
    return servico_definicoes.substituir_definicoes(sessao, corpo)


@router.get("/clientes", response_model=RespostaClientes)
def listar_clientes(sessao: SessaoDaBD) -> RespostaClientes:
    """Do mais recente para o mais antigo, sem nenhuma credencial."""
    return servico_clientes.obter_clientes(sessao)


@router.get(
    "/clientes.csv",
    response_class=Response,
    responses={**_RESPOSTA_CSV, **_respostas()},
)
def descarregar_clientes_csv(sessao: SessaoDaBD) -> Response:
    """O CSV dos clientes, a abrir bem no Excel em português."""
    corpo, nome = servico_clientes.gerar_csv(sessao)
    return Response(
        content=corpo,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


@router.delete(
    "/clientes/{id}",
    status_code=204,
    responses=_respostas(_404_CLIENTE, _422),
)
def eliminar_cliente(id_cliente: IdDaBD, sessao: SessaoDaBD) -> None:
    """Apaga mesmo (eliminação a pedido, RGPD)."""
    servico_clientes.eliminar_cliente(sessao, id_cliente)


@router.post(
    "/conta/password",
    response_model=RespostaAdmin,
    responses=_respostas(
        (400, "A password atual não confere: `password_atual_errada`, com `campo`."),
        (
            429,
            "Conta bloqueada depois de 5 falhas: `conta_bloqueada`, com "
            "`segundos_em_falta` e `Retry-After`.",
        ),
        _422,
    ),
)
def mudar_password(
    resposta: Response,
    sessao: SessaoDaBD,
    admin: Annotated[Admin, Depends(exigir_admin)],
    corpo: PedidoMudarPassword,
) -> RespostaAdmin:
    """Muda a password de quem tem a sessão e reemite a sessão desta pessoa.

    Pede a atual, que conta para o mesmo bloqueio do login. As outras
    sessões terminam (`sessao_versao`); a de quem muda continua, com o
    cookie novo desta resposta.
    """
    admin_id, utilizador = admin.id, admin.utilizador
    versao = servico_auth.mudar_password_da_sessao(
        sessao, admin, corpo.password_atual, corpo.password_nova
    )
    servico_auth.definir_cookie_de_sessao(resposta, admin_id, versao)
    return RespostaAdmin(id=admin_id, utilizador=utilizador)
