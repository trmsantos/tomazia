"""Testes do contrato WSGI/Passenger (F1-02).

Dois grupos de testes (um terceiro, `/docs`/`/redoc`/`/openapi.json`
desligados em produção, vive agora só em
`tests/seguranca/test_documentacao_desligada_em_producao.py` — é um critério
de segurança, tem de estar dentro de `tests/seguranca/` para `uv run pytest
tests/seguranca` o apanhar se alguém o destapar, em vez de ficar escondido
aqui):

1. A app (`app.main.app`) montada com `a2wsgi.ASGIMiddleware` responde bem a
   `SCRIPT_NAME=/api`: `/health` dá 200, um caminho inexistente dá 404. Estes
   testes correm no processo de testes, em cima de `app.main.app`
   diretamente — não precisam do ficheiro `passenger_wsgi.py` em si, só da
   combinação FastAPI + a2wsgi.
2. `passenger_wsgi.application` existe e responde — este, sim, importa o
   ficheiro `backend/passenger_wsgi.py` a sério, por isso corre num
   subprocesso isolado (ver `tests/apoio_subprocesso.py`).
3. O canário do `lifespan`: prova, com uma app instrumentada, que o a2wsgi
   não corre o protocolo `lifespan` — o contrato que `app.main` depende dele
   não existir (nada posto num `lifespan` corre em produção sob o
   Passenger).
"""

from __future__ import annotations

import importlib
import io
import json
import secrets
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from tests import apoio_subprocesso


def _chamar_wsgi(
    aplicacao_wsgi: Any, script_name: str, path_info: str, metodo: str = "GET"
) -> tuple[str, dict[str, str], bytes]:
    """Chama uma app WSGI (tipicamente `ASGIMiddleware(app)`) diretamente, sem servidor."""
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


def _reimportar_app_main() -> ModuleType:
    sys.modules.pop("app.main", None)
    return importlib.import_module("app.main")


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


class TestDespachoComPrefixoApi:
    def test_script_name_api_e_health_devolve_200_com_estado_e_versao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Critério da tarefa: `SCRIPT_NAME=/api` + `PATH_INFO=/health` → 200, com `estado` e `versao`."""
        from a2wsgi import ASGIMiddleware

        monkeypatch.setenv("AMBIENTE", "desenvolvimento")
        monkeypatch.delenv("SEGREDO_SESSAO", raising=False)
        from app.config import obter_definicoes

        obter_definicoes.cache_clear()
        modulo = _reimportar_app_main()

        aplicacao_wsgi = ASGIMiddleware(modulo.app)
        status, _, corpo = _chamar_wsgi(aplicacao_wsgi, "/api", "/health")

        assert status.startswith("200")
        corpo_json = json.loads(corpo)
        assert "estado" in corpo_json
        assert "versao" in corpo_json

    def test_script_name_api_e_caminho_inexistente_devolve_404_so_no_codigo(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """404 em código; nunca se afirma o corpo — o formato `{"erro", "mensagem"}` não é desta tarefa."""
        from a2wsgi import ASGIMiddleware

        monkeypatch.setenv("AMBIENTE", "desenvolvimento")
        monkeypatch.delenv("SEGREDO_SESSAO", raising=False)
        from app.config import obter_definicoes

        obter_definicoes.cache_clear()
        modulo = _reimportar_app_main()

        aplicacao_wsgi = ASGIMiddleware(modulo.app)
        status, _, _ = _chamar_wsgi(aplicacao_wsgi, "/api", "/nao-existe")

        assert status.startswith("404")


class TestPassengerWsgiApplication:
    def test_application_existe_e_e_chamavel(self, tmp_path: Path) -> None:
        """`passenger_wsgi.application` existe e responde — importado a sério, em subprocesso.

        Corre num subprocesso isolado (ver `tests/apoio_subprocesso.py`) para
        nunca mudar a pasta de trabalho nem importar `app.main` dentro do
        processo de testes.

        Cria um `.env` dentro de `pasta_tomazia_api/` de propósito: depois da
        correção do achado [alta] da ronda de correções (`passenger_wsgi.py`
        recusa arrancar se o ficheiro de ambiente resolvido não existir),
        este teste deixaria de arrancar sem ele — e este teste tem de
        continuar verde, é um caminho feliz, não um teste de segurança. Os
        cenários sem `.env` vivem em
        `tests/seguranca/test_arranque_passenger.py`.

        `AMBIENTE=producao`, com um segredo forte, não por acaso: desde a
        segunda camada que afirma `obter_definicoes().ambiente == "producao"`
        depois de importar `app.main`, este ponto de entrada só serve
        produção — um `.env` em desenvolvimento já não é um caminho feliz
        aqui, deixou de o ser (ver
        `tests/seguranca/test_arranque_passenger.py::TestPontoDeEntradaSoServeProducao`).
        """
        segredo_forte = secrets.token_urlsafe(48)
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        (pasta_tomazia_api / ".env").write_text(
            f"AMBIENTE=producao\nSEGREDO_SESSAO={segredo_forte}\n", encoding="utf-8"
        )
        outra_pasta = tmp_path / "outra-pasta-de-trabalho"
        outra_pasta.mkdir()

        codigo = (
            "assert callable(application), 'application tem de ser chamável'\n"
            + apoio_subprocesso.codigo_chamar_wsgi(
                script_name="/api", path_info="/health", variavel_app="application"
            )
        )
        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar=codigo,
        )

        assert resultado.returncode == 0, resultado.stderr
        assert "STATUS=200" in resultado.stdout


class TestLifespanNaoCorreSobA2wsgi:
    def test_lifespan_nao_corre_canario_de_boas_noticias(self) -> None:
        """Canário: o a2wsgi não corre o protocolo `lifespan` — e isso é bom sabê-lo já.

        Uma app instrumentada, servida pelo `ASGIMiddleware`, responde 200
        e a flag de arranque fica `False` (nunca posta a `True` pelo
        `lifespan`, que nunca corre).

        Se este teste viesse a falhar numa subida de versão do `a2wsgi`, é
        porque o a2wsgi passou a implementar `lifespan` — e isso seria uma
        boa notícia (deixaria de ser preciso o cuidado de nunca pôr nada de
        essencial num `lifespan` desta app). Rever o ADR correspondente
        nessa altura, em vez de corrigir este teste às cegas.
        """
        from collections.abc import AsyncIterator
        from contextlib import asynccontextmanager

        from a2wsgi import ASGIMiddleware
        from fastapi import FastAPI

        arrancou_via_lifespan = False

        @asynccontextmanager
        async def lifespan(aplicacao: FastAPI) -> AsyncIterator[None]:
            nonlocal arrancou_via_lifespan
            arrancou_via_lifespan = True
            yield

        app_instrumentada = FastAPI(lifespan=lifespan)

        @app_instrumentada.get("/sonda")
        def sonda() -> dict[str, bool]:
            return {"ok": True}

        aplicacao_wsgi = ASGIMiddleware(app_instrumentada)  # type: ignore[arg-type]
        status, _, _ = _chamar_wsgi(aplicacao_wsgi, "", "/sonda")

        assert status.startswith("200")
        assert arrancou_via_lifespan is False
