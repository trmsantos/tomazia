"""Critério de segurança: `/docs`, `/redoc` e `/openapi.json` desligados em produção.

Achado [baixa] da ronda de correções da F1-02: o único teste que prendia
isto vivia em `tests/test_passenger_wsgi.py`, fora de `tests/seguranca/`. O
revisor mutou `app/main.py` (tirou `openapi_url=None`) e `uv run pytest
tests/seguranca` ficou verde — a suite de segurança, que é o portão da
definição de pronto, não apanhou a regressão. Esta classe é a mesma, movida
para aqui: `/docs` e `/redoc` servem o mesmo conteúdo que `/openapi.json`
publicaria (o mapa completo da superfície de gestão, `/gestao/*`, `/auth/*`,
esquemas de entrada) a quem não tem sessão nenhuma.

`_chamar_wsgi` vivia duplicada aqui com a justificação de que
`tests/seguranca/` não devia depender de ficheiros de teste fora de si —
mas um módulo de apoio partilhado, sem `test_` no nome (`tests.apoio_subprocesso`,
já usado por outros ficheiros de `tests/seguranca/`), não é um desses
ficheiros. A função vive lá agora, como `chamar_wsgi`, sem cópia nenhuma.
"""

from __future__ import annotations

import importlib
import secrets
import sys
from collections.abc import Iterator

import pytest

from tests.apoio_subprocesso import chamar_wsgi


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
            status, _, _ = chamar_wsgi(aplicacao_wsgi, "", caminho)
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
            status, _, _ = chamar_wsgi(aplicacao_wsgi, "", caminho)
            assert status.startswith("200"), (
                f"{caminho} devia continuar ligado em desenvolvimento"
            )
