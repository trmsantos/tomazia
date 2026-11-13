"""S-09, o lado da escrita dos eventos (F2-05b).

O `titulo` e a `descricao` com aspas, `&` e `<script>` entram por `POST` e
`PATCH`, e saem **idênticos** em `GET /gestao/eventos`, no `/eventos` público
(quando publicado), na cópia de `duplicar` e na própria linha da base de dados.
Quem escapa é o frontend (React), nunca o servidor ao guardar.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from tests.apoio_gestao import CABECALHO_MUTACAO
from tests.apoio_publico import TEXTO_PERIGOSO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

OUTRO = "Outro \"texto\" <b>negrito</b> & mais 'aspas'"
INICIO = "2099-07-02T21:00:00Z"


def _linha(motor: Engine, identificador: int) -> tuple[Any, ...]:
    with motor.connect() as ligacao:
        linha = ligacao.execute(
            text("SELECT titulo, descricao FROM eventos WHERE id = :i"),
            {"i": identificador},
        ).one()
    return tuple(linha)


def _de_gestao(cliente: TestClient, identificador: int) -> dict[str, Any]:
    corpo = cliente.get("/gestao/eventos").json()
    for lista in corpo.values():
        for evento in lista:
            if evento["id"] == identificador:
                achado: dict[str, Any] = evento
                return achado
    raise AssertionError(f"o evento {identificador} não está em nenhuma lista")


def _no_publico(cliente: TestClient, identificador: int) -> dict[str, Any]:
    for evento in cliente.get("/eventos").json()["eventos"]:
        if evento["id"] == identificador:
            achado: dict[str, Any] = evento
            return achado
    raise AssertionError(f"o evento {identificador} não está em `/eventos`")


def test_entra_por_post_e_sai_igual_em_todo_o_lado(
    sessao_de_admin: TestClient, motor: Engine
) -> None:
    resposta = sessao_de_admin.post(
        "/gestao/eventos",
        json={
            "titulo": TEXTO_PERIGOSO,
            "descricao": TEXTO_PERIGOSO,
            "inicio": INICIO,
            "publicado": True,
        },
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 201, resposta.text
    assert resposta.json()["titulo"] == TEXTO_PERIGOSO
    assert resposta.json()["descricao"] == TEXTO_PERIGOSO
    identificador = resposta.json()["id"]

    de_gestao = _de_gestao(sessao_de_admin, identificador)
    assert de_gestao["titulo"] == TEXTO_PERIGOSO
    assert de_gestao["descricao"] == TEXTO_PERIGOSO

    publico = _no_publico(sessao_de_admin, identificador)
    assert publico["titulo"] == TEXTO_PERIGOSO
    assert publico["descricao"] == TEXTO_PERIGOSO

    assert _linha(motor, identificador) == (TEXTO_PERIGOSO, TEXTO_PERIGOSO)


def test_entra_por_patch_e_sai_igual_em_todo_o_lado(
    sessao_de_admin: TestClient, motor: Engine
) -> None:
    criado = sessao_de_admin.post(
        "/gestao/eventos",
        json={"titulo": "Fados", "inicio": INICIO, "publicado": True},
        headers=CABECALHO_MUTACAO,
    )
    assert criado.status_code == 201, criado.text
    identificador = criado.json()["id"]

    resposta = sessao_de_admin.patch(
        f"/gestao/eventos/{identificador}",
        json={"titulo": OUTRO, "descricao": OUTRO},
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 200, resposta.text
    assert resposta.json()["titulo"] == OUTRO
    assert resposta.json()["descricao"] == OUTRO
    assert _de_gestao(sessao_de_admin, identificador)["titulo"] == OUTRO
    assert _no_publico(sessao_de_admin, identificador)["descricao"] == OUTRO
    assert _linha(motor, identificador) == (OUTRO, OUTRO)


def test_a_copia_do_duplicar_leva_o_texto_tal_como_estava(
    sessao_de_admin: TestClient, motor: Engine
) -> None:
    criado = sessao_de_admin.post(
        "/gestao/eventos",
        json={"titulo": TEXTO_PERIGOSO, "descricao": OUTRO, "inicio": INICIO},
        headers=CABECALHO_MUTACAO,
    )
    assert criado.status_code == 201, criado.text
    copia = sessao_de_admin.post(
        f"/gestao/eventos/{criado.json()['id']}/duplicar", headers=CABECALHO_MUTACAO
    )
    assert copia.status_code == 201, copia.text
    assert copia.json()["titulo"] == TEXTO_PERIGOSO
    assert copia.json()["descricao"] == OUTRO
    assert _linha(motor, copia.json()["id"]) == (TEXTO_PERIGOSO, OUTRO)
