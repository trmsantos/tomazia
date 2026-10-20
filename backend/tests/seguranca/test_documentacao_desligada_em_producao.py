"""Critério de segurança: `/docs`, `/redoc` e `/openapi.json` desligados em produção.

Achado [baixa] da ronda de correções da F1-02: o único teste que prendia
isto vivia em `tests/test_passenger_wsgi.py`, fora de `tests/seguranca/`. O
revisor mutou `app/main.py` (tirou `openapi_url=None`) e `uv run pytest
tests/seguranca` ficou verde — a suite de segurança, que é o portão da
definição de pronto, não apanhou a regressão. Esta classe é a mesma, movida
para aqui: `/docs` e `/redoc` servem o mesmo conteúdo que `/openapi.json`
publicaria (o mapa completo da superfície de gestão, `/gestao/*`, `/auth/*`,
esquemas de entrada) a quem não tem sessão nenhuma.
"""

from __future__ import annotations

import importlib
import io
import secrets
import sys
from collections.abc import Iterator
from typing import Any

import pytest


def _chamar_wsgi(
    aplicacao_wsgi: Any, script_name: str, path_info: str, metodo: str = "GET"
) -> tuple[str, dict[str, str], bytes]:
    """Chama uma app WSGI (tipicamente `ASGIMiddleware(app)`) diretamente, sem servidor.

    Cópia deliberada da função homónima em `tests/test_passenger_wsgi.py`:
    este ficheiro tem de viver sozinho dentro de `tests/seguranca/` — ver o
    docstring do módulo — e `tests/seguranca/` nunca deve depender de
    ficheiros de teste fora de si para os seus critérios de segurança
    continuarem a passar sozinhos (`uv run pytest tests/seguranca`).
    """
    ambiente = {
        "REQUEST_METHOD": metodo,
        "SCRIPT_NAME": script_name,
        "PATH_INFO": path_info,
        "SERVER_NAME": "testserver",
        "SERVER_PORT": "80",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(b""),
        "wsgi.errors": io.BytesIO(),
        "QUERY_STRING": "",
        "CONTENT_TYPE": "",
        "CONTENT_LENGTH": "",
    }
    capturado: dict[str, object] = {}

    def start_response(
        status: str, headers: list[tuple[str, str]], exc_info: Any = None
    ) -> None:
        capturado["status"] = status
        capturado["headers"] = dict(headers)

    corpo = b"".join(aplicacao_wsgi(ambiente, start_response))
    return capturado["status"], capturado["headers"], corpo  # type: ignore[return-value]


@pytest.fixture(autouse=True)
def _isolar_app_main() -> Iterator[None]:
    """Cada teste reimporta `app.main` do zero, sob o ambiente que ele próprio define.

    Sem isto, um `app.main` já construído (sob outro `AMBIENTE`) ficaria em
    cache e os testes de `/docs`/`/redoc`/`/openapi.json` não exercitariam
    nada.
    """
    sys.modules.pop("app.main", None)
    yield
    sys.modules.pop("app.main", None)


class TestDocumentacaoDesligadaEmProducao:
    def test_producao_desliga_docs_redoc_e_openapi_json(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from a2wsgi import ASGIMiddleware

        segredo_forte = secrets.token_urlsafe(48)
        monkeypatch.setenv("AMBIENTE", "producao")
        monkeypatch.setenv("SEGREDO_SESSAO", segredo_forte)
        from app.config import obter_definicoes

        obter_definicoes.cache_clear()

        modulo = importlib.import_module("app.main")

        aplicacao_wsgi = ASGIMiddleware(modulo.app)
        for caminho in ("/docs", "/redoc", "/openapi.json"):
            status, _, _ = _chamar_wsgi(aplicacao_wsgi, "", caminho)
            assert status.startswith("404"), f"{caminho} devia dar 404 em produção"

    def test_desenvolvimento_mantem_docs_redoc_e_openapi_json(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from a2wsgi import ASGIMiddleware

        monkeypatch.setenv("AMBIENTE", "desenvolvimento")
        monkeypatch.delenv("SEGREDO_SESSAO", raising=False)
        from app.config import obter_definicoes

        obter_definicoes.cache_clear()

        modulo = importlib.import_module("app.main")

        aplicacao_wsgi = ASGIMiddleware(modulo.app)
        for caminho in ("/docs", "/redoc", "/openapi.json"):
            status, _, _ = _chamar_wsgi(aplicacao_wsgi, "", caminho)
            assert status.startswith("200"), (
                f"{caminho} devia continuar ligado em desenvolvimento"
            )
