"""Um inteiro acima de `2**63-1` nunca é um 500 (F2-05a).

Medido no plano da F2-05: um id de `2**70` no caminho dava 500
(`OverflowError` do SQLite), também nas rotas de fotos que já existiam. O
mesmo vale para ids e preços **no corpo**. A fronteira tem de os limitar:
`422 dados_invalidos`.

Usa `gestao_sem_excecoes`: o `TestClient` normal volta a levantar a exceção
do servidor, e "o teste caiu" não se distingue de "deu 500".

Os casos vêm de `METODOS_DE_GESTAO_POR_CAMINHO` (S-04), cruzada com a app real
no primeiro teste: rota nova com `{id}` obriga a entrar na tabela.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    MAIOR_ID_DO_SQLITE,
    corpo_valido,
    exigir_erro,
    fotografia,
)
from tests.apoio_rotas import rotas_declaradas
from tests.seguranca.test_s04_gestao_exige_sessao import METODOS_DE_GESTAO_POR_CAMINHO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

COM_ID: tuple[tuple[str, str], ...] = tuple(
    (metodo, caminho)
    for caminho, metodos in sorted(METODOS_DE_GESTAO_POR_CAMINHO.items())
    if "{" in caminho
    for metodo in sorted(metodos)
)
IDS_FORA_DO_INTERVALO = [2**63, 2**70, 0, -1]
IDS = [f"{m} {c}" for m, c in COM_ID]


def test_a_tabela_cobre_todas_as_rotas_de_gestao_com_parametro() -> None:
    from app.main import criar_app

    da_app = {
        (metodo, caminho)
        for caminho, metodos in rotas_declaradas(criar_app()).items()
        if caminho.startswith("/gestao") and "{" in caminho
        for metodo in metodos
    }
    assert da_app == set(COM_ID)
    assert any("fotos" in caminho for _, caminho in COM_ID)
    assert any("produtos" in caminho for _, caminho in COM_ID)
    assert any("eventos" in caminho for _, caminho in COM_ID)


def _pedir(cliente: TestClient, metodo: str, caminho: str, valor: int) -> Any:
    corpo = corpo_valido(metodo, caminho)
    pedido = {"json": corpo} if corpo is not None else {}
    return cliente.request(
        metodo,
        re.sub(r"\{[^}]+\}", str(valor), caminho),
        headers=CABECALHO_MUTACAO,
        **pedido,
    )


@pytest.mark.parametrize("metodo,caminho", COM_ID, ids=IDS)
@pytest.mark.parametrize("valor", IDS_FORA_DO_INTERVALO)
def test_id_no_caminho_fora_do_intervalo_e_422(
    gestao_sem_excecoes: TestClient, metodo: str, caminho: str, valor: int
) -> None:
    resposta = _pedir(gestao_sem_excecoes, metodo, caminho, valor)
    exigir_erro(resposta, 422, "dados_invalidos")


@pytest.mark.parametrize("metodo,caminho", COM_ID, ids=IDS)
def test_o_maior_id_valido_e_404_e_nao_500(
    gestao_sem_excecoes: TestClient, metodo: str, caminho: str
) -> None:
    resposta = _pedir(gestao_sem_excecoes, metodo, caminho, MAIOR_ID_DO_SQLITE)
    assert resposta.status_code == 404, resposta.text
    if "fotos" not in caminho:
        if caminho.startswith("/gestao/eventos/"):
            esperado = "evento_inexistente"
        elif caminho.startswith("/gestao/produtos/"):
            esperado = "produto_inexistente"
        else:
            esperado = "categoria_inexistente"
        assert resposta.json()["erro"] == esperado


CORPOS_FORA_DO_INTERVALO: tuple[tuple[str, str, dict[str, Any], str], ...] = tuple(
    (metodo, caminho, corpo, campo)
    for metodo, caminho, base, campo, valores in (
        (
            "POST",
            "/gestao/produtos",
            {"categoria_id": 10, "nome": "M", "preco_cent": 1},
            "preco_cent",
            (2**31, 2**63, 2**70, -1, 1e30),
        ),
        (
            "POST",
            "/gestao/produtos",
            {"categoria_id": 10, "nome": "M", "preco_cent": 1},
            "categoria_id",
            (2**63, 2**70, 0, -1),
        ),
        ("PATCH", "/gestao/produtos/101", {}, "preco_cent", (2**31, 2**70, -1, 1e30)),
        ("PATCH", "/gestao/produtos/101", {}, "categoria_id", (2**63, 2**70, 0)),
        ("PUT", "/gestao/categorias/ordem", {}, "ids", ([2**70], [2**63], [0], [-1])),
        (
            "PUT",
            "/gestao/categorias/10/produtos/ordem",
            {},
            "ids",
            ([2**70], [2**63], [0], [-1]),
        ),
    )
    for valor in valores
    for corpo in ({**base, campo: valor},)
)


@pytest.mark.parametrize(
    "metodo,caminho,corpo,campo",
    CORPOS_FORA_DO_INTERVALO,
    ids=[f"{m} {c} {k}={str(b[k])[:12]}" for m, c, b, k in CORPOS_FORA_DO_INTERVALO],
)
def test_inteiro_no_corpo_fora_do_intervalo_e_422_e_nada_muda(
    gestao_sem_excecoes: TestClient,
    motor: Engine,
    metodo: str,
    caminho: str,
    corpo: dict[str, Any],
    campo: str,
) -> None:
    antes = fotografia(motor)
    resposta = gestao_sem_excecoes.request(
        metodo, caminho, json=corpo, headers=CABECALHO_MUTACAO
    )
    exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
    assert fotografia(motor) == antes


def test_o_maior_id_valido_no_corpo_e_um_erro_nosso_nao_um_500(
    gestao_sem_excecoes: TestClient,
) -> None:
    resposta = gestao_sem_excecoes.post(
        "/gestao/produtos",
        json={"categoria_id": MAIOR_ID_DO_SQLITE, "nome": "M", "preco_cent": 1},
        headers=CABECALHO_MUTACAO,
    )
    exigir_erro(resposta, 422, "categoria_inexistente", campo="categoria_id")
