"""S-06 sobre as rotas da F2-05a: `PUT`, `PATCH` e `DELETE` sem `X-Tomazia` são 403.

O guarda é um middleware sobre o método (ver `test_s06_mutacao_exige_x_tomazia.py`),
por isso um 403 também sai em caminhos que não existem — daí o primeiro teste,
que prova que a lista de mutações da **app real** inclui as rotas novas. Sem
ele, este ficheiro passava a verde com zero rotas de categorias na app.

Pedidos **com sessão válida e corpo válido**: o 403 tem de vir do guarda, e a
ementa tem de ficar tal e qual.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.apoio_gestao import caminho_concreto, corpo_valido, fotografia
from tests.apoio_rotas import rotas_declaradas

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

NOVAS: tuple[tuple[str, str], ...] = (
    ("POST", "/gestao/categorias"),
    ("PATCH", "/gestao/categorias/{id}"),
    ("DELETE", "/gestao/categorias/{id}"),
    ("PUT", "/gestao/categorias/ordem"),
    ("POST", "/gestao/produtos"),
    ("PATCH", "/gestao/produtos/{id}"),
    ("DELETE", "/gestao/produtos/{id}"),
    ("PUT", "/gestao/categorias/{id}/produtos/ordem"),
)


def test_a_app_real_declara_as_mutacoes_novas() -> None:
    from app.main import criar_app

    declaradas = rotas_declaradas(criar_app())
    em_falta = [
        (metodo, caminho)
        for metodo, caminho in NOVAS
        if metodo not in declaradas.get(caminho, frozenset())
    ]
    assert em_falta == [], f"a app não declara: {em_falta}"


@pytest.mark.parametrize("metodo,caminho", NOVAS, ids=[f"{m} {c}" for m, c in NOVAS])
def test_sem_x_tomazia_e_403_e_nada_muda(
    gestao: TestClient, motor: Engine, metodo: str, caminho: str
) -> None:
    antes = fotografia(motor)
    corpo = corpo_valido(metodo, caminho)
    pedido = {"json": corpo} if corpo is not None else {}
    resposta = gestao.request(metodo, caminho_concreto(metodo, caminho), **pedido)
    assert resposta.status_code == 403, resposta.text
    assert resposta.json()["erro"] == "cabecalho_x_tomazia_em_falta"
    assert fotografia(motor) == antes
