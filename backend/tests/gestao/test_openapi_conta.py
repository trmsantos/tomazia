"""O OpenAPI da F2-05c: definições, clientes (com o CSV) e mudar password.

Os tipos do frontend (F4-05) geram-se a partir disto: nomes de esquemas,
campos, `text/csv` na resposta do ficheiro e o envelope de erro em todos os
4xx (o 401 de `/gestao/*` incluído).
"""

from __future__ import annotations

from typing import Any

import pytest

REF_ERRO = "#/components/schemas/RespostaDeErro"


def _esquema() -> dict[str, Any]:
    from app.main import criar_app

    esquema: dict[str, Any] = criar_app().openapi()
    return esquema


def _operacao(metodo: str, caminho: str) -> dict[str, Any]:
    operacao: dict[str, Any] = _esquema()["paths"][caminho][metodo]
    return operacao


def _ref_do_corpo(resposta: dict[str, Any]) -> str | None:
    ref = (
        resposta.get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
    )
    return ref if isinstance(ref, str) else None


NOVAS: dict[tuple[str, str], set[str]] = {
    ("get", "/gestao/definicoes"): {"200", "401"},
    ("put", "/gestao/definicoes"): {"200", "401", "422"},
    ("get", "/gestao/clientes"): {"200", "401"},
    ("get", "/gestao/clientes.csv"): {"200", "401"},
    ("delete", "/gestao/clientes/{id}"): {"204", "401", "404", "422"},
    ("post", "/gestao/conta/password"): {"200", "400", "401", "422", "429"},
}


@pytest.mark.parametrize("metodo,caminho", sorted(NOVAS), ids=lambda v: str(v))
def test_cada_rota_documenta_os_seus_codigos_e_todos_os_4xx_usam_o_envelope(
    metodo: str, caminho: str
) -> None:
    respostas = _operacao(metodo, caminho)["responses"]
    assert NOVAS[(metodo, caminho)] <= set(respostas)
    for codigo, resposta in respostas.items():
        if codigo.startswith("4"):
            assert _ref_do_corpo(resposta) == REF_ERRO, f"{metodo} {caminho} {codigo}"


def test_o_csv_documenta_text_csv_na_resposta_200() -> None:
    conteudo = _operacao("get", "/gestao/clientes.csv")["responses"]["200"]["content"]
    assert "text/csv" in conteudo
    assert "application/json" not in conteudo, "o ficheiro não é JSON"


def test_os_esquemas_novos_existem_com_estes_nomes_e_campos() -> None:
    esquemas = _esquema()["components"]["schemas"]
    sete = {
        "wifi_rede",
        "wifi_password",
        "morada",
        "telefone",
        "instagram",
        "maps_url",
        "horario",
    }
    assert set(esquemas["PedidoDefinicoes"]["properties"]) == sete
    assert set(esquemas["DefinicoesGestao"]["properties"]) == sete | {"horario_estado"}
    assert set(esquemas["ClienteGestao"]["properties"]) == {
        "id",
        "nome",
        "email",
        "telemovel",
        "consentimento_em",
        "versao_termos",
        "criado_em",
    }
    assert set(esquemas["PedidoMudarPassword"]["properties"]) == {
        "password_atual",
        "password_nova",
    }


@pytest.mark.parametrize("nome", ["PedidoDefinicoes", "PedidoMudarPassword"])
def test_os_pedidos_recusam_campos_a_mais(nome: str) -> None:
    assert (
        _esquema()["components"]["schemas"][nome].get("additionalProperties") is False
    )


def test_o_pedido_de_mudar_password_leva_as_duas_e_limita_o_comprimento() -> None:
    modelo = _esquema()["components"]["schemas"]["PedidoMudarPassword"]
    assert set(modelo["required"]) == {"password_atual", "password_nova"}
    for campo in ("password_atual", "password_nova"):
        propriedade = modelo["properties"][campo]
        assert propriedade["minLength"] == 1
        assert propriedade["maxLength"] == 1024


def test_o_pedido_de_definicoes_exige_os_sete_campos() -> None:
    modelo = _esquema()["components"]["schemas"]["PedidoDefinicoes"]
    assert set(modelo["required"]) == set(modelo["properties"])


def test_o_estado_do_horario_so_tem_tres_valores() -> None:
    esquemas = _esquema()["components"]["schemas"]
    estado = esquemas["DefinicoesGestao"]["properties"]["horario_estado"]
    valores = estado.get("enum")
    if valores is None:  # `$ref` para um enum nomeado
        valores = esquemas[estado["$ref"].rsplit("/", 1)[1]]["enum"]
    assert set(valores) == {"configurado", "nao_configurado", "invalido"}


def test_a_lista_de_clientes_e_um_envelope_nomeado() -> None:
    """Nunca um array no topo (ver `app/schemas/publico.py`): não se estende."""
    esquemas = _esquema()["components"]["schemas"]
    ref = _operacao("get", "/gestao/clientes")["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"]
    envelope = esquemas[ref.rsplit("/", 1)[1]]
    assert set(envelope["properties"]) == {"clientes"}
    assert envelope["properties"]["clientes"]["items"]["$ref"].endswith(
        "/ClienteGestao"
    )


def test_o_429_da_mudanca_de_password_documenta_o_tempo_em_falta() -> None:
    resposta = _operacao("post", "/gestao/conta/password")["responses"]["429"]
    assert "conta_bloqueada" in resposta["description"]
    modelo = _esquema()["components"]["schemas"]["RespostaDeErro"]
    assert "segundos_em_falta" in modelo["properties"]
