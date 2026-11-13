"""O campo `campo` do envelope e o que o 422 nunca devolve (F2-05a)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.apoio_gestao import CABECALHO_MUTACAO, exigir_erro

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_o_422_diz_qual_o_campo_do_corpo(gestao: TestClient) -> None:
    resposta = gestao.post(
        "/gestao/produtos",
        json={"categoria_id": 10, "nome": "A", "preco_cent": -1},
        headers=CABECALHO_MUTACAO,
    )
    exigir_erro(resposta, 422, "dados_invalidos", campo="preco_cent")


def test_o_campo_de_uma_lista_e_o_da_lista(gestao: TestClient) -> None:
    resposta = gestao.put(
        "/gestao/categorias/ordem",
        json={"ids": [10, "x", 30]},
        headers=CABECALHO_MUTACAO,
    )
    exigir_erro(resposta, 422, "dados_invalidos", campo="ids")


def test_campo_a_mais_e_nomeado(gestao: TestClient) -> None:
    resposta = gestao.post(
        "/gestao/categorias",
        json={"nome": "Vinhos", "slug": "x"},
        headers=CABECALHO_MUTACAO,
    )
    exigir_erro(resposta, 422, "dados_invalidos", campo="slug")


def test_erro_no_caminho_nao_inventa_um_campo(gestao: TestClient) -> None:
    resposta = gestao.patch(
        "/gestao/categorias/abc", json={"nome": "X"}, headers=CABECALHO_MUTACAO
    )
    corpo = exigir_erro(resposta, 422, "dados_invalidos")
    assert corpo.get("campo") is None


def test_json_partido_e_422_sem_campo_obrigatorio(gestao: TestClient) -> None:
    resposta = gestao.post(
        "/gestao/categorias",
        content=b'{"nome": ',
        headers={**CABECALHO_MUTACAO, "Content-Type": "application/json"},
    )
    corpo = exigir_erro(resposta, 422, "dados_invalidos")
    assert corpo.get("campo") is None or isinstance(corpo["campo"], str)


def test_o_422_nunca_repete_o_valor_enviado(gestao: TestClient) -> None:
    marca = "MARCADOR-DE-TESTE-NAO-REPETIR"
    resposta = gestao.post(
        "/gestao/produtos",
        json={"categoria_id": 10, "nome": "A", "preco_cent": marca},
        headers=CABECALHO_MUTACAO,
    )
    exigir_erro(resposta, 422, "dados_invalidos", campo="preco_cent")
    assert marca not in resposta.text


def test_o_envelope_existente_do_login_continua_igual(cliente: TestClient) -> None:
    """Aditivo: o 422 do login mantém `erro` e `mensagem`."""
    resposta = cliente.post("/auth/login", json={}, headers=CABECALHO_MUTACAO)
    corpo = exigir_erro(resposta, 422, "dados_invalidos")
    assert set(corpo) <= {"erro", "mensagem", "campo"}


def test_chave_inventada_enorme_nao_volta_no_campo(gestao: TestClient) -> None:
    chave = "k" * 10_000
    resposta = gestao.post(
        "/gestao/categorias",
        json={"nome": "Vinhos", chave: 1},
        headers=CABECALHO_MUTACAO,
    )
    corpo = exigir_erro(resposta, 422, "dados_invalidos")
    assert corpo.get("campo") is None
    assert chave not in resposta.text


def test_chave_inventada_com_marcas_nao_volta_no_campo(gestao: TestClient) -> None:
    resposta = gestao.post(
        "/gestao/categorias",
        json={"nome": "Vinhos", "<script>": 1},
        headers=CABECALHO_MUTACAO,
    )
    corpo = exigir_erro(resposta, 422, "dados_invalidos")
    assert corpo.get("campo") is None
