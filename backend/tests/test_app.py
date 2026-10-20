"""Testes do esqueleto de `app.main`.

Nesta tarefa (F1-01) a app ainda não tem rotas nenhumas: o `GET /health`
só chega na F1-02. Aqui só se confirma que a fábrica da app funciona, que
o `lifespan` arranca e termina sem erros, e que, sem rotas, qualquer
caminho devolve 404 (em vez de, por exemplo, rebentar a arrancar).
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


def test_get_raiz_devolve_404_porque_ainda_nao_ha_rotas() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as cliente:
        resposta = cliente.get("/")

    assert resposta.status_code == 404
