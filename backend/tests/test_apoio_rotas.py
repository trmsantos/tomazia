"""O apoio de travessia de `tests/apoio_rotas.py` testado contra si próprio.

Sem isto, a defesa do S-04 contra uma mudança de forma no contexto de
inclusão do FastAPI (ver a segunda secção do docstring de
`tests/apoio_rotas.py`) era código nunca exercitado: escrito a pensar numa
versão futura do FastAPI, mas só posto à prova no dia em que essa versão
chegasse — tarde para ser o teste a apanhá-lo.

Os objetos `_ContextoFalso*` abaixo imitam a forma mínima de um
`fastapi.routing._RouterIncludeContext` sem precisar de uma app FastAPI a
sério: só o suficiente para `rotas_declaradas` decidir se sabe lidar com
eles.
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.apoio_rotas import rotas_declaradas


class _RotaFalsaComIncludeContext:
    """Imita uma rota `_IncludedRouter`: só tem `.include_context`."""

    def __init__(self, contexto: Any) -> None:
        self.include_context = contexto


class _RouterFalso:
    """Imita o `.router`/router incluído: só tem `.routes`."""

    def __init__(self, routes: list[Any]) -> None:
        self.routes = routes


class _AppFalsa:
    """Imita a app: só tem `.router`."""

    def __init__(self, router: _RouterFalso) -> None:
        self.router = router


class _ContextoSemPrefixo:
    """Um contexto de inclusão que perdeu `.prefix` — a mudança a prevenir."""

    def __init__(self, included_router: Any) -> None:
        self.included_router = included_router
        # Sem atributo `prefix`, de propósito.


class _ContextoSemIncludedRouter:
    """Um contexto de inclusão que perdeu `.included_router`."""

    def __init__(self, prefix: str) -> None:
        self.prefix = prefix
        # Sem atributo `included_router`, de propósito.


def test_contexto_sem_prefixo_rebenta_em_vez_de_devolver_caminho_errado() -> None:
    """A asserção central do remendo: falta de `.prefix` não vira `""`.

    Antes do remendo, `getattr(contexto, "prefix", "")` lia isto como "sem
    prefixo" e a rota interna (`/categorias`) aparecia sem o `/gestao` à
    frente — calada, sem nenhum erro. É exatamente o resultado que a regra
    10 do `CLAUDE.md` proíbe: "não encontrei o prefixo" (porque não há) e
    "não consegui ler o prefixo" (porque a versão do FastAPI mudou) não
    podem dar o mesmo resultado.
    """
    router_interno = _RouterFalso(routes=[])
    contexto = _ContextoSemPrefixo(included_router=router_interno)
    rota_incluida = _RotaFalsaComIncludeContext(contexto)
    app_falsa = _AppFalsa(_RouterFalso(routes=[rota_incluida]))

    with pytest.raises(AssertionError, match=r"\.prefix"):
        rotas_declaradas(app_falsa)


def test_contexto_sem_included_router_tambem_rebenta() -> None:
    """A segunda metade da mesma verificação: falta de `.included_router`.

    Antes do remendo isto era um `AttributeError` cru do Python, sem
    explicação nenhuma do porquê nem do que fazer — útil só para quem já
    soubesse o que é um `_RouterIncludeContext`.
    """
    contexto = _ContextoSemIncludedRouter(prefix="/gestao")
    rota_incluida = _RotaFalsaComIncludeContext(contexto)
    app_falsa = _AppFalsa(_RouterFalso(routes=[rota_incluida]))

    with pytest.raises(AssertionError, match=r"included_router"):
        rotas_declaradas(app_falsa)


def test_contexto_com_os_dois_atributos_continua_a_funcionar() -> None:
    """O caminho feliz não regride: um contexto normal continua a acumular o prefixo.

    Sem este controlo, as duas asserções de cima podiam estar corretas e a
    travessia continuar quebrada para o caso comum (a maioria das rotas da
    app, que tem `.prefix` e `.included_router` como sempre teve).
    """
    from fastapi import APIRouter, FastAPI

    router_interno = APIRouter()

    @router_interno.get("/categorias")
    def categorias() -> list[str]:  # pragma: no cover - nunca é chamada
        return []

    app = FastAPI()
    app.include_router(router_interno, prefix="/gestao")

    encontradas = rotas_declaradas(app)

    assert "/gestao/categorias" in encontradas


# --- F2-05a: o `getattr(atual, "routes", [])` deixou de ser silencioso ------


def test_mount_de_uma_app_asgi_opaca_rebenta_em_vez_de_dar_zero_rotas() -> None:
    """`Mount.routes` faz `getattr(self.app, "routes", [])` por dentro: o
    silêncio é duplo. Uma app ASGI sem `.routes` não se pode enumerar, e
    "não tem rotas" não pode dar o mesmo resultado que "não consegui ver".
    """
    from fastapi import FastAPI
    from starlette.routing import Mount

    async def opaca(scope: Any, receive: Any, send: Any) -> None:  # pragma: no cover
        return None

    app = FastAPI()
    app.router.routes.append(Mount("/legado", app=opaca))

    with pytest.raises(AssertionError, match=r"Mount"):
        rotas_declaradas(app)


def test_no_sem_routes_rebenta_em_vez_de_ser_saltado() -> None:
    class _NoSemRoutes:
        pass

    app_falsa = _AppFalsa(_RouterFalso(routes=[_NoSemRoutes()]))
    with pytest.raises(AssertionError):
        rotas_declaradas(app_falsa)


def test_router_sem_routes_rebenta() -> None:
    class _RouterSemRoutes:
        pass

    class _AppComRouterSemRoutes:
        router = _RouterSemRoutes()

    with pytest.raises(AssertionError, match=r"\.routes"):
        rotas_declaradas(_AppComRouterSemRoutes())


def test_mount_de_uma_app_fastapi_continua_a_ser_percorrido() -> None:
    from fastapi import FastAPI
    from starlette.routing import Mount

    interna = FastAPI()

    @interna.get("/ping")
    def ping() -> dict[str, bool]:  # pragma: no cover - nunca é chamada
        return {"ok": True}

    externa = FastAPI()
    externa.router.routes.append(Mount("/sub", app=interna))

    assert "/sub/ping" in rotas_declaradas(externa)
