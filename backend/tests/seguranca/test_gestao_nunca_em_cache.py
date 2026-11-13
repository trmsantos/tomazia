"""Toda a resposta de sucesso de `/gestao` leva `Cache-Control: no-store`.

"Por construção": a F2-06 pôs o cabeçalho à mão numa rota (a imagem) e
esqueceu-se das outras (`GET /gestao/fotos`). Uma lista de categorias ou um
preço em cache de um browser partilhado é o dono a ver a ementa de ontem.

O teste decide o mecanismo (dependência do router, middleware...), mas tem de
cobrir também as `Response` diretas, como a imagem das fotos, e os erros
`404` e `409` que o código levanta.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests import apoio_fotos
from tests.apoio_gestao import CABECALHO_MUTACAO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

CASOS: tuple[tuple[str, str, object, int], ...] = (
    ("GET", "/gestao/categorias", None, 200),
    ("POST", "/gestao/categorias", {"nome": "Vinhos"}, 201),
    ("PATCH", "/gestao/categorias/10", {"nome": "Entradas"}, 200),
    ("PUT", "/gestao/categorias/ordem", {"ids": [30, 10, 20]}, 204),
    (
        "POST",
        "/gestao/produtos",
        {"categoria_id": 10, "nome": "M", "preco_cent": 1},
        201,
    ),
    ("PATCH", "/gestao/produtos/101", {"preco_cent": 5}, 200),
    ("PUT", "/gestao/categorias/10/produtos/ordem", {"ids": [103, 102, 101]}, 204),
    ("DELETE", "/gestao/produtos/101", None, 204),
    ("DELETE", "/gestao/categorias/30", None, 204),
    ("GET", "/gestao/fotos", None, 200),
    # erros levantados pelo nosso código
    ("PATCH", "/gestao/categorias/999", {"nome": "X"}, 404),
    ("DELETE", "/gestao/produtos/999", None, 404),
    ("DELETE", "/gestao/categorias/10", None, 409),
    ("POST", "/gestao/categorias", {"nome": "Petiscos"}, 409),
)


@pytest.mark.parametrize(
    "metodo,caminho,corpo,estado", CASOS, ids=[f"{c[0]} {c[1]} {c[3]}" for c in CASOS]
)
def test_responde_sem_cache(
    gestao: TestClient, metodo: str, caminho: str, corpo: object, estado: int
) -> None:
    pedido = {"json": corpo} if corpo is not None else {}
    resposta = gestao.request(metodo, caminho, headers=CABECALHO_MUTACAO, **pedido)
    assert resposta.status_code == estado, resposta.text
    assert resposta.headers.get("cache-control") == "no-store"


def test_a_imagem_de_uma_foto_continua_sem_cache(gestao: TestClient) -> None:
    envio = apoio_fotos.enviar_foto(gestao, apoio_fotos.jpeg_valido())
    assert envio.status_code == 202, envio.text
    resposta = gestao.get("/gestao/fotos/1/imagem")
    assert resposta.status_code == 200, resposta.text
    assert resposta.headers.get("cache-control") == "no-store"


def test_o_403_do_guarda_e_o_404_de_caminho_inexistente_tambem(
    gestao: TestClient,
) -> None:
    sem_cabecalho = gestao.post("/gestao/categorias", json={"nome": "Vinhos"})
    assert sem_cabecalho.status_code == 403, sem_cabecalho.text
    assert sem_cabecalho.headers.get("cache-control") == "no-store"

    inexistente = gestao.get("/gestao/nao-existe")
    assert inexistente.status_code == 404, inexistente.text
    assert inexistente.json()["erro"] == "nao_encontrado"
    assert inexistente.headers.get("cache-control") == "no-store"


def test_fora_de_gestao_o_404_nao_ganha_no_store(gestao: TestClient) -> None:
    resposta = gestao.get("/nao-existe")
    assert resposta.status_code == 404
    assert resposta.headers.get("cache-control") != "no-store"
