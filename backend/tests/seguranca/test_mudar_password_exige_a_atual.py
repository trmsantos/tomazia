"""`POST /gestao/conta/password` exige a password atual (F2-05c).

Sem ela, um **cookie roubado** (um telemóvel esquecido, um computador
partilhado, 12 horas de validade) chegava para ficar com a conta para
sempre: o ladrão mudava a password, o dono ficava à porta, e as outras
sessões só morriam por acaso. Com ela, quem tem o cookie mas não sabe a
password não consegue mudar nada.

Tudo aqui prova duas coisas: a resposta (400 `password_atual_errada` ou
422), e que **nada mudou** — nem o hash, nem a versão da sessão, nem as
outras tabelas (`fotografia`), e que a password antiga continua a entrar.
O contador de falhas é de outro ficheiro (`..._conta_para_o_bloqueio`).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import text

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_ERRADA_DE_EXEMPLO,
    PASSWORD_FALSA,
)
from tests.apoio_gestao import PASSWORD_NOVA_FALSA, exigir_erro, fotografia

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

ROTA = "/gestao/conta/password"


def _hash_e_versao(motor: Engine) -> tuple[str, int]:
    with motor.connect() as ligacao:
        linha = ligacao.execute(
            text("SELECT hash_password, sessao_versao FROM admins")
        ).one()
    return linha[0], linha[1]


def _a_antiga_continua_a_entrar(cliente: TestClient) -> None:
    from fastapi.testclient import TestClient as Cliente

    from app.main import criar_app

    with Cliente(criar_app(), base_url="https://testserver") as outro:
        resposta = outro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, resposta.text


def _pedir(cliente: TestClient, corpo: dict[str, Any]) -> Any:
    return cliente.post(ROTA, json=corpo, headers=CABECALHO_MUTACAO)


@pytest.mark.parametrize(
    "atual",
    [
        PASSWORD_ERRADA_DE_EXEMPLO,
        PASSWORD_NOVA_FALSA,  # a nova não serve de atual
        PASSWORD_FALSA.upper(),
        PASSWORD_FALSA + " ",
        " " + PASSWORD_FALSA,
        PASSWORD_FALSA[:-1],
    ],
    ids=["errada", "a-nova", "maiusculas", "espaco-atras", "espaco-frente", "curta"],
)
def test_atual_errada_e_400_e_nada_muda(
    gestao: TestClient, motor: Engine, atual: str
) -> None:
    antes = fotografia(motor)
    hash_antes, versao_antes = _hash_e_versao(motor)

    resposta = _pedir(
        gestao, {"password_atual": atual, "password_nova": PASSWORD_NOVA_FALSA}
    )

    exigir_erro(resposta, 400, "password_atual_errada", campo="password_atual")
    assert "set-cookie" not in resposta.headers, "um erro não reemite a sessão"
    assert _hash_e_versao(motor) == (hash_antes, versao_antes)
    # Só o contador de falhas pode ter mudado; tudo o resto fica igual.
    depois = fotografia(motor)
    assert {k: v for k, v in depois.items() if k != "admins"} == {
        k: v for k, v in antes.items() if k != "admins"
    }
    _a_antiga_continua_a_entrar(gestao)


def test_a_resposta_ao_erro_nao_repete_nenhuma_das_passwords(
    gestao: TestClient,
) -> None:
    resposta = _pedir(
        gestao,
        {"password_atual": PASSWORD_ERRADA_DE_EXEMPLO, "password_nova": "NOVA-X-9"},
    )
    assert resposta.status_code == 400
    assert PASSWORD_ERRADA_DE_EXEMPLO not in resposta.text
    assert "NOVA-X-9" not in resposta.text


@pytest.mark.parametrize(
    "corpo,campo",
    [
        ({"password_nova": PASSWORD_NOVA_FALSA}, "password_atual"),
        (
            {"password_atual": None, "password_nova": PASSWORD_NOVA_FALSA},
            "password_atual",
        ),
        (
            {"password_atual": "", "password_nova": PASSWORD_NOVA_FALSA},
            "password_atual",
        ),
        (
            {"password_atual": 12345, "password_nova": PASSWORD_NOVA_FALSA},
            "password_atual",
        ),
        ({"password_atual": PASSWORD_FALSA}, "password_nova"),
        ({"password_atual": PASSWORD_FALSA, "password_nova": ""}, "password_nova"),
        ({"password_atual": PASSWORD_FALSA, "password_nova": None}, "password_nova"),
        ({"password_atual": PASSWORD_FALSA, "password_nova": 12345}, "password_nova"),
    ],
    ids=[
        "sem-atual",
        "atual-null",
        "atual-vazia",
        "atual-numero",
        "sem-nova",
        "nova-vazia",
        "nova-null",
        "nova-numero",
    ],
)
def test_corpo_incompleto_ou_invalido_e_422_e_nada_muda(
    gestao: TestClient, motor: Engine, corpo: dict[str, Any], campo: str
) -> None:
    antes = fotografia(motor)
    resposta = _pedir(gestao, corpo)
    exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
    assert fotografia(motor) == antes, "um 422 não conta como tentativa falhada"
    _a_antiga_continua_a_entrar(gestao)


@pytest.mark.parametrize("campo", ["password_atual", "password_nova"])
def test_passwords_acima_de_1024_carateres_sao_422_antes_do_argon2(
    gestao: TestClient, motor: Engine, campo: str
) -> None:
    """O teto limita o custo do argon2 que um pedido pode obrigar a pagar."""
    antes = fotografia(motor)
    corpo = {"password_atual": PASSWORD_FALSA, "password_nova": PASSWORD_NOVA_FALSA}
    corpo[campo] = "a" * 1025
    resposta = _pedir(gestao, corpo)
    exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
    assert fotografia(motor) == antes


def test_o_corpo_nao_tem_utilizador_nem_outros_campos(
    gestao: TestClient, motor: Engine
) -> None:
    """A rota muda a password de **quem tem a sessão**, nunca a de outra conta."""
    antes = fotografia(motor)
    for extra in ("utilizador", "admin_id", "id", "hash_password"):
        resposta = _pedir(
            gestao,
            {
                "password_atual": PASSWORD_FALSA,
                "password_nova": PASSWORD_NOVA_FALSA,
                extra: "dono-de-exemplo" if extra == "utilizador" else 1,
            },
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo=extra)
    assert fotografia(motor) == antes


def test_controlo_com_a_atual_certa_muda(gestao: TestClient, motor: Engine) -> None:
    """Sem isto, todos os 400 acima podiam ser de uma rota que nunca muda nada."""
    hash_antes, _ = _hash_e_versao(motor)
    resposta = _pedir(
        gestao, {"password_atual": PASSWORD_FALSA, "password_nova": PASSWORD_NOVA_FALSA}
    )
    assert resposta.status_code == 200, resposta.text
    assert _hash_e_versao(motor)[0] != hash_antes
