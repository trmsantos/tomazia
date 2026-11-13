"""O `token_cancelar` nunca sai da API de gestão (F2-05c).

O token é uma **credencial**: quem o tiver cancela a inscrição de um
cliente (`POST /novidades/cancelar`, F2-07) sem mais nada. O dono precisa de
ver quem se inscreveu, não de ter na folha de cálculo, ou num ecrã
partilhado, as chaves de cancelamento de todos.

Prova-se por três lados: o JSON da lista, o CSV, e o esquema do OpenAPI. E
nos dois sentidos: o valor (`TOKEN_DA_ANA`) e o **nome** do campo.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    ID_CLI_ANA,
    TOKEN_DA_ANA,
    TOKEN_DO_RUI,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

PEDACOS_DOS_TOKENS = ("token-secreto", "nunca-sai")


def _sem_token(texto: str) -> None:
    for pedaco in (TOKEN_DA_ANA, TOKEN_DO_RUI, *PEDACOS_DOS_TOKENS):
        assert pedaco not in texto, f"o token vazou: {pedaco!r}"
    assert "token" not in texto.lower()
    assert "cancelar" not in texto.lower()


def test_o_json_da_lista_nao_tem_o_token(gestao: TestClient) -> None:
    resposta = gestao.get("/gestao/clientes")
    assert resposta.status_code == 200, resposta.text
    assert len(resposta.json()["clientes"]) == 2, "sem clientes o teste não prova nada"
    _sem_token(resposta.text)


def test_o_csv_nao_tem_o_token(gestao: TestClient) -> None:
    resposta = gestao.get("/gestao/clientes.csv")
    assert resposta.status_code == 200, resposta.text
    assert resposta.text.count("\r\n") >= 3, "sem clientes o teste não prova nada"
    _sem_token(resposta.content.decode("utf-8-sig"))


def test_o_delete_nao_devolve_nada(gestao: TestClient) -> None:
    resposta = gestao.delete(
        f"/gestao/clientes/{ID_CLI_ANA}", headers=CABECALHO_MUTACAO
    )
    assert resposta.status_code == 204, resposta.text
    assert resposta.content == b""


def _propriedades(esquema: Any) -> set[str]:
    nomes: set[str] = set()
    if isinstance(esquema, dict):
        for chave, valor in esquema.items():
            if chave == "properties" and isinstance(valor, dict):
                nomes |= set(valor)
            nomes |= _propriedades(valor)
    elif isinstance(esquema, list):
        for item in esquema:
            nomes |= _propriedades(item)
    return nomes


def test_nenhum_esquema_de_cliente_do_openapi_tem_o_token() -> None:
    from app.main import criar_app

    esquemas = criar_app().openapi()["components"]["schemas"]
    assert "ClienteGestao" in esquemas, "o esquema esperado não existe"
    nomes = _propriedades(esquemas["ClienteGestao"])
    assert not [n for n in nomes if "token" in n.lower()], nomes
    # O `RespostaDeErro` é o único sítio onde "cancelar" poderia aparecer por
    # engano; o texto completo do OpenAPI das rotas de clientes não o nomeia.
    caminhos = criar_app().openapi()["paths"]
    for caminho in ("/gestao/clientes", "/gestao/clientes.csv"):
        assert "token" not in json.dumps(caminhos[caminho]).lower()
