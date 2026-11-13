"""Os corpos de gestão recusam campos que não declaram (F2-05a).

`extra="forbid"`: sem isto, `{"id": 5}`, `{"ordem": 0}` ou `{"slug": "x"}`
são ignorados em silêncio — e o dia em que alguém ler esses campos no
serviço, são mass assignment. Um campo a mais e um erro de escrita
("preco" em vez de "preco_cent") também devolvem 200 sem fazer nada.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CORPOS_VALIDOS,
    caminho_concreto,
    fotografia,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

ROTAS = tuple(sorted(CORPOS_VALIDOS))
EXTRAS = ("id", "ordem", "slug", "inventado", "preco", "imagem")


def test_ha_rotas_com_corpo_para_provar() -> None:
    assert len(ROTAS) == 10


@pytest.mark.parametrize("metodo,caminho", ROTAS, ids=[f"{m} {c}" for m, c in ROTAS])
@pytest.mark.parametrize("extra", EXTRAS)
def test_campo_a_mais_e_422_e_nada_muda(
    gestao: TestClient, motor: Engine, metodo: str, caminho: str, extra: str
) -> None:
    antes = fotografia(motor)
    corpo: dict[str, Any] = {**CORPOS_VALIDOS[(metodo, caminho)], extra: 1}
    resposta = gestao.request(
        metodo,
        caminho_concreto(metodo, caminho),
        json=corpo,
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 422, resposta.text
    assert resposta.json()["erro"] == "dados_invalidos"
    assert resposta.json().get("campo") == extra
    assert fotografia(motor) == antes


@pytest.mark.parametrize("metodo,caminho", ROTAS, ids=[f"{m} {c}" for m, c in ROTAS])
def test_o_corpo_valido_de_controlo_e_aceite(
    gestao: TestClient, metodo: str, caminho: str
) -> None:
    """Sem isto, o 422 acima podia ser de um corpo que nunca foi válido."""
    resposta = gestao.request(
        metodo,
        caminho_concreto(metodo, caminho),
        json=CORPOS_VALIDOS[(metodo, caminho)],
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code in (200, 201, 204), resposta.text


@pytest.mark.parametrize("metodo,caminho", ROTAS, ids=[f"{m} {c}" for m, c in ROTAS])
@pytest.mark.parametrize("corpo", [[], "texto", 5, None])
def test_corpo_que_nao_e_um_objeto_e_422(
    gestao: TestClient, motor: Engine, metodo: str, caminho: str, corpo: Any
) -> None:
    antes = fotografia(motor)
    resposta = gestao.request(
        metodo,
        caminho_concreto(metodo, caminho),
        json=corpo,
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 422, resposta.text
    assert fotografia(motor) == antes


@pytest.mark.parametrize("metodo,caminho", ROTAS, ids=[f"{m} {c}" for m, c in ROTAS])
def test_json_com_content_type_de_formulario_e_422(
    gestao: TestClient, motor: Engine, metodo: str, caminho: str
) -> None:
    """Um JSON válido enviado como `text/plain` não é lido como JSON."""
    antes = fotografia(motor)
    resposta = gestao.request(
        metodo,
        caminho_concreto(metodo, caminho),
        content=b'{"nome": "x", "ids": [1]}',
        headers={**CABECALHO_MUTACAO, "Content-Type": "text/plain"},
    )
    assert resposta.status_code == 422, resposta.text
    assert fotografia(motor) == antes
