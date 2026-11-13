"""`POST /gestao/conta/password` (F2-05c): o caminho feliz e cada erro.

`PedidoMudarPassword {password_atual: str(1..1024), password_nova:
str(1..1024)}`, sem `utilizador` (muda a password de quem tem a sessão).

| Estado | `erro` | Quando |
| --- | --- | --- |
| 200 | — | `RespostaAdmin {id, utilizador}` + `Set-Cookie` novo |
| 400 | `password_atual_errada` (`campo: "password_atual"`) | a atual não confere |
| 401 | `sessao_em_falta` | sem sessão, ou sessão revogada |
| 422 | `dados_invalidos` | corpo inválido; a nova **vazia** (só a vazia: uma nova só com espaços passa, como no `criar_admin.py`) |
| 429 | `conta_bloqueada` | a conta está bloqueada (ver `tests/seguranca/`) |

O 401, o bloqueio, os atributos do cookie e o fim das outras sessões estão em
`tests/seguranca/test_mudar_password_*.py`; aqui, o resto.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import text

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_ERRADA_DE_EXEMPLO,
    PASSWORD_FALSA,
    UTILIZADOR_FALSO,
)
from tests.apoio_gestao import PASSWORD_NOVA_FALSA, exigir_erro

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

    from app.models.admins import Admin

ROTA = "/gestao/conta/password"
CORPO = {"password_atual": PASSWORD_FALSA, "password_nova": PASSWORD_NOVA_FALSA}


def _pedir(cliente: TestClient, corpo: dict[str, Any]) -> Any:
    return cliente.post(ROTA, json=corpo, headers=CABECALHO_MUTACAO)


def _login(password: str) -> Any:
    from fastapi.testclient import TestClient as Cliente

    from app.main import criar_app

    with Cliente(criar_app(), base_url="https://testserver") as outro:
        return outro.post(
            "/auth/login",
            json={"utilizador": UTILIZADOR_FALSO, "password": password},
            headers=CABECALHO_MUTACAO,
        )


def _linha_do_admin(motor: Engine) -> Any:
    with motor.connect() as ligacao:
        return ligacao.execute(
            text(
                "SELECT hash_password, tentativas_falhadas, bloqueado_ate, "
                "sessao_versao FROM admins"
            )
        ).one()


def test_o_caminho_feliz(sessao_de_admin: TestClient, admin: Admin) -> None:
    resposta = _pedir(sessao_de_admin, CORPO)
    assert resposta.status_code == 200, resposta.text
    assert resposta.json() == {"id": admin.id, "utilizador": UTILIZADOR_FALSO}
    assert resposta.headers.get("cache-control") == "no-store"
    assert resposta.headers.get_list("set-cookie"), "traz a sessão reemitida"

    assert _login(PASSWORD_NOVA_FALSA).status_code == 200
    antiga = _login(PASSWORD_FALSA)
    exigir_erro(antiga, 400, "credenciais_invalidas")


def test_guarda_um_hash_argon2id_da_nova_e_nunca_a_nova(
    sessao_de_admin: TestClient, motor: Engine
) -> None:
    from app.services.auth import verificar_password

    antes = _linha_do_admin(motor)
    assert _pedir(sessao_de_admin, CORPO).status_code == 200
    depois = _linha_do_admin(motor)

    assert depois.hash_password != antes.hash_password
    assert depois.hash_password.startswith("$argon2id$")
    assert PASSWORD_NOVA_FALSA not in depois.hash_password
    assert verificar_password(depois.hash_password, PASSWORD_NOVA_FALSA)
    assert not verificar_password(depois.hash_password, PASSWORD_FALSA)
    assert depois.sessao_versao == antes.sessao_versao + 1
    assert depois.tentativas_falhadas == 0
    assert depois.bloqueado_ate is None


def test_a_resposta_nao_leva_hash_nem_passwords(sessao_de_admin: TestClient) -> None:
    resposta = _pedir(sessao_de_admin, CORPO)
    assert set(resposta.json()) == {"id", "utilizador"}
    for proibido in (PASSWORD_FALSA, PASSWORD_NOVA_FALSA, "argon2", "hash"):
        assert proibido not in resposta.text


@pytest.mark.parametrize(
    "nova",
    [
        "   ",  # só espaços: só a vazia é recusada
        "x",  # sem regra de complexidade
        "ção-ÇÃO-p@ss-ü-日本語",
        "a" * 1024,  # no teto
        PASSWORD_FALSA,  # igual à atual: não há regra contra
    ],
    ids=["so-espacos", "um-carater", "unicode", "teto-1024", "igual-a-atual"],
)
def test_a_nova_aceite_serve_para_entrar(
    sessao_de_admin: TestClient, nova: str
) -> None:
    resposta = _pedir(
        sessao_de_admin, {"password_atual": PASSWORD_FALSA, "password_nova": nova}
    )
    assert resposta.status_code == 200, resposta.text
    assert _login(nova).status_code == 200


def test_uma_atual_errada_conta_uma_falha_e_diz_qual_o_campo(
    sessao_de_admin: TestClient, motor: Engine
) -> None:
    resposta = _pedir(
        sessao_de_admin,
        {"password_atual": PASSWORD_ERRADA_DE_EXEMPLO, "password_nova": "x"},
    )
    exigir_erro(resposta, 400, "password_atual_errada", campo="password_atual")
    linha = _linha_do_admin(motor)
    assert linha.tentativas_falhadas == 1
    assert linha.bloqueado_ate is None


def test_sem_sessao_e_401(cliente_seguro: TestClient, admin: Admin) -> None:
    resposta = _pedir(cliente_seguro, CORPO)
    exigir_erro(resposta, 401, "sessao_em_falta")
    assert resposta.headers.get("cache-control") == "no-store"
    assert _login(PASSWORD_FALSA).status_code == 200, "nada mudou"


def test_a_rota_so_aceita_post(sessao_de_admin: TestClient) -> None:
    for metodo in ("get", "put", "patch", "delete"):
        resposta = getattr(sessao_de_admin, metodo)(ROTA, headers=CABECALHO_MUTACAO)
        assert resposta.status_code == 405, (metodo, resposta.text)


def test_nenhuma_password_vai_parar_ao_registo(
    sessao_de_admin: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """Nem no sucesso nem no 400: as passwords não se registam em log."""
    caplog.set_level(logging.DEBUG)
    falha = _pedir(
        sessao_de_admin,
        {
            "password_atual": PASSWORD_ERRADA_DE_EXEMPLO,
            "password_nova": "NOVA-NO-LOG-1",
        },
    )
    assert falha.status_code == 400, falha.text
    sucesso = _pedir(sessao_de_admin, {**CORPO, "password_nova": "NOVA-NO-LOG-2"})
    assert sucesso.status_code == 200, sucesso.text
    for segredo in (
        PASSWORD_ERRADA_DE_EXEMPLO,
        PASSWORD_FALSA,
        "NOVA-NO-LOG-1",
        "NOVA-NO-LOG-2",
    ):
        assert segredo not in caplog.text


def test_o_login_continua_igual_depois_de_a_rota_existir(
    cliente_seguro: TestClient, admin: Admin
) -> None:
    """Controlo: a máquina de estados partilhada não mudou o login."""
    certo = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert certo.status_code == 200
    errado = cliente_seguro.post(
        "/auth/login",
        json={**CREDENCIAIS_FALSAS, "password": PASSWORD_ERRADA_DE_EXEMPLO},
        headers=CABECALHO_MUTACAO,
    )
    exigir_erro(errado, 400, "credenciais_invalidas")
