"""O OpenAPI das rotas de sessão documenta as respostas de erro reais."""

from __future__ import annotations

from typing import Any


def _respostas(caminho: str, metodo: str) -> dict[str, Any]:
    from app.main import criar_app

    esquema = criar_app().openapi()
    return dict(esquema["paths"][caminho][metodo]["responses"])


def test_login_documenta_400_422_e_429() -> None:
    respostas = _respostas("/auth/login", "post")
    assert {"200", "400", "422", "429"} <= set(respostas)
    for codigo in ("400", "422", "429"):
        assert respostas[codigo]["description"].strip()
    assert "HTTPValidationError" not in str(respostas["422"])


def test_logout_nao_promete_erros_que_nao_devolve() -> None:
    respostas = _respostas("/auth/logout", "post")
    assert "204" in respostas


def test_eu_documenta_401() -> None:
    respostas = _respostas("/auth/eu", "get")
    assert {"200", "401"} <= set(respostas)
    assert respostas["401"]["description"].strip()
