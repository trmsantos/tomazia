"""Uma sessão revogada não muda a password, e a revogação a meio também não (F2-05c).

Dois casos, ambos 401 `sessao_em_falta` e **nada muda** (hash, versão, nem o
contador de falhas):

1. **Cookie já revogado** (um logout noutro separador antes do pedido): é o
   `exigir_admin` que o apanha. Mesmo com a password atual certa.
2. **Revogada entretanto**: o `exigir_admin` ainda viu a versão boa, mas
   entre isso e o `UPDATE` houve um logout noutro separador. O `UPDATE` é
   condicionado pela versão do cookie (`... WHERE id=? AND sessao_versao=?`);
   zero linhas afetadas = 401. Sem a condição, uma sessão revogada
   (cookie roubado e já anulado pelo dono) conseguia mudar a password e
   ainda **reemitia** uma sessão boa ao ladrão.

O segundo caso só se arma com um ponto de extensão: o teste substitui
`app.services.auth.verificar_password` por uma versão que, depois de
verificar a password a sério, faz o "logout do outro separador" por SQL.
O serviço tem de verificar a password atual **chamando `verificar_password`
pelo nome do módulo `app.services.auth`**, depois do `exigir_admin` e antes do
`UPDATE`. Se a substituta nunca for chamada o teste diz-o, em vez de passar
sem provar nada.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import text

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_FALSA,
    nome_e_valor_do_cookie,
)
from tests.apoio_gestao import PASSWORD_NOVA_FALSA, exigir_erro, fotografia

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

    from app.models.admins import Admin

ROTA = "/gestao/conta/password"
CORPO = {"password_atual": PASSWORD_FALSA, "password_nova": PASSWORD_NOVA_FALSA}


def _novo_cliente() -> Any:
    from fastapi.testclient import TestClient as Cliente

    from app.main import criar_app

    return Cliente(criar_app(), base_url="https://testserver")


def _versao(motor: Engine) -> int:
    with motor.connect() as ligacao:
        return int(
            ligacao.execute(text("SELECT sessao_versao FROM admins")).scalar_one()
        )


def _hash(motor: Engine) -> str:
    with motor.connect() as ligacao:
        return str(
            ligacao.execute(text("SELECT hash_password FROM admins")).scalar_one()
        )


def _a_antiga_ainda_entra() -> None:
    with _novo_cliente() as outro:
        resposta = outro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, resposta.text


def test_cookie_revogado_antes_do_pedido_e_401_e_nada_muda(
    cliente_seguro: TestClient, admin: Admin, motor: Engine
) -> None:
    resposta = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert resposta.status_code == 200, resposta.text
    cookie = nome_e_valor_do_cookie(resposta)

    # Outro separador faz logout: a versão da sessão sobe e o cookie morre.
    with _novo_cliente() as outro_separador:
        outro_separador.cookies.set(*cookie)
        assert (
            outro_separador.post("/auth/logout", headers=CABECALHO_MUTACAO).status_code
            == 204
        )
    antes = fotografia(motor)

    cliente_seguro.cookies.set(*cookie)
    resposta = cliente_seguro.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)

    exigir_erro(resposta, 401, "sessao_em_falta")
    assert "set-cookie" not in resposta.headers, "uma sessão revogada não é reemitida"
    assert fotografia(motor) == antes
    _a_antiga_ainda_entra()


def test_revogada_entre_a_verificacao_e_o_update_e_401_e_nada_muda(
    sessao_de_admin: TestClient,
    motor: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.auth as servico

    verificar_a_sério = servico.verificar_password
    estado = {"chamadas": 0}
    hash_antes = _hash(motor)
    versao_antes = _versao(motor)

    def verificar_e_depois_revogar(hash_password: str, password: str) -> bool:
        resultado = verificar_a_sério(hash_password, password)
        estado["chamadas"] += 1
        if estado["chamadas"] == 1:
            # O "logout noutro separador", por uma ligação à parte.
            with motor.begin() as ligacao:
                ligacao.execute(
                    text("UPDATE admins SET sessao_versao = sessao_versao + 1")
                )
        return resultado

    monkeypatch.setattr(servico, "verificar_password", verificar_e_depois_revogar)

    resposta = sessao_de_admin.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)

    assert estado["chamadas"] >= 1, (
        "a rota não chamou `app.services.auth.verificar_password` pelo nome do "
        "módulo: o teste não armou a corrida e não prova nada"
    )
    exigir_erro(resposta, 401, "sessao_em_falta")
    assert "set-cookie" not in resposta.headers
    assert _versao(motor) == versao_antes + 1, "só a revogação do outro separador"
    assert _hash(motor) == hash_antes, "o hash não pode ter mudado"
    _a_antiga_ainda_entra()
