"""Testes do esqueleto de `app.main`.

Desde a F1-02 a app já tem rotas (`GET /health`, testado em
`test_health.py` e `test_passenger_wsgi.py`). Aqui só se confirma que a
fábrica da app funciona, que o `lifespan` arranca e termina sem erros, e
que a raiz (`/`) continua sem rota própria — devolve 404, não por a app
ainda não ter rotas nenhumas, mas porque nenhuma rota responde exatamente a
`/`.
"""

from __future__ import annotations


def test_criar_app_devolve_app_com_titulo_definido() -> None:
    from app.main import criar_app

    aplicacao = criar_app()

    assert aplicacao.title
    assert isinstance(aplicacao.title, str)


def test_lifespan_arranca_e_termina_sem_rebentar() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as cliente:
        assert cliente is not None


def test_get_raiz_devolve_404_porque_nao_ha_rota_para_a_raiz() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as cliente:
        resposta = cliente.get("/")

    assert resposta.status_code == 404
