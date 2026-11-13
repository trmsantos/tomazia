"""S-09, o lado da escrita: texto com aspas e `<script>` entra pela gestão e sai igual.

O `test_s09_texto_guardado_e_devolvido_igual.py` semeia pelo ORM e avisa que
"uma API de escrita que escape o texto antes de o guardar passa por aqui sem
queixa". Este ficheiro fecha esse buraco para categorias e produtos (F2-05a):
entra por `POST` e `PATCH`, e tem de sair idêntico em `GET /gestao/categorias`,
em `GET /ementa` e na própria linha da base de dados.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

from tests.apoio_gestao import CABECALHO_MUTACAO, ler_ementa_de_gestao
from tests.apoio_publico import TEXTO_PERIGOSO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

OUTRO = "Outro \"texto\" <b>negrito</b> & mais 'aspas'"


def _linha(motor: Engine, sql: str, identificador: int) -> tuple[object, ...]:
    with motor.connect() as ligacao:
        linha = ligacao.execute(text(sql), {"i": identificador}).one()
    return tuple(linha)


def _na_ementa_publica(
    cliente: TestClient,
) -> tuple[list[str], list[tuple[str, str | None]]]:
    categorias = cliente.get("/ementa").json()["categorias"]
    return (
        [c["nome"] for c in categorias],
        [(p["nome"], p["descricao"]) for c in categorias for p in c["produtos"]],
    )


def test_o_texto_de_controlo_tem_o_que_o_criterio_pede() -> None:
    assert (
        '"' in TEXTO_PERIGOSO and "<script>" in TEXTO_PERIGOSO and "&" in TEXTO_PERIGOSO
    )


def test_entra_por_post_e_sai_igual_em_todo_o_lado(
    gestao: TestClient, motor: Engine
) -> None:
    categoria = gestao.post(
        "/gestao/categorias",
        json={"nome": TEXTO_PERIGOSO},
        headers=CABECALHO_MUTACAO,
    )
    assert categoria.status_code == 201, categoria.text
    assert categoria.json()["nome"] == TEXTO_PERIGOSO
    id_categoria = categoria.json()["id"]

    produto = gestao.post(
        "/gestao/produtos",
        json={
            "categoria_id": id_categoria,
            "nome": TEXTO_PERIGOSO,
            "descricao": TEXTO_PERIGOSO,
            "preco_cent": 250,
        },
        headers=CABECALHO_MUTACAO,
    )
    assert produto.status_code == 201, produto.text
    assert produto.json()["nome"] == TEXTO_PERIGOSO
    assert produto.json()["descricao"] == TEXTO_PERIGOSO
    id_produto = produto.json()["id"]

    de_gestao = next(
        c for c in ler_ementa_de_gestao(gestao)["categorias"] if c["id"] == id_categoria
    )
    assert de_gestao["nome"] == TEXTO_PERIGOSO
    assert de_gestao["produtos"][0]["nome"] == TEXTO_PERIGOSO
    assert de_gestao["produtos"][0]["descricao"] == TEXTO_PERIGOSO

    nomes, produtos = _na_ementa_publica(gestao)
    assert TEXTO_PERIGOSO in nomes
    assert (TEXTO_PERIGOSO, TEXTO_PERIGOSO) in produtos

    assert _linha(motor, "SELECT nome FROM categorias WHERE id = :i", id_categoria) == (
        TEXTO_PERIGOSO,
    )
    assert _linha(
        motor, "SELECT nome, descricao FROM produtos WHERE id = :i", id_produto
    ) == (TEXTO_PERIGOSO, TEXTO_PERIGOSO)


def test_entra_por_patch_e_sai_igual_em_todo_o_lado(
    gestao: TestClient, motor: Engine
) -> None:
    categoria = gestao.patch(
        "/gestao/categorias/10", json={"nome": OUTRO}, headers=CABECALHO_MUTACAO
    )
    assert categoria.status_code == 200, categoria.text
    assert categoria.json()["nome"] == OUTRO
    produto = gestao.patch(
        "/gestao/produtos/101",
        json={"nome": OUTRO, "descricao": OUTRO},
        headers=CABECALHO_MUTACAO,
    )
    assert produto.status_code == 200, produto.text
    assert produto.json()["nome"] == OUTRO
    assert produto.json()["descricao"] == OUTRO

    nomes, produtos = _na_ementa_publica(gestao)
    assert OUTRO in nomes
    assert (OUTRO, OUTRO) in produtos
    assert _linha(motor, "SELECT nome FROM categorias WHERE id = :i", 10) == (OUTRO,)
    assert _linha(motor, "SELECT nome, descricao FROM produtos WHERE id = :i", 101) == (
        OUTRO,
        OUTRO,
    )


def test_nunca_aparece_um_escape_html(gestao: TestClient) -> None:
    resposta = gestao.patch(
        "/gestao/produtos/101",
        json={"nome": "Tosta & Queijo"},
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 200, resposta.text
    corpo = gestao.get("/gestao/categorias").text
    assert "&amp;" not in corpo and "&lt;" not in corpo and "&quot;" not in corpo
