"""A password atual errada conta para o **mesmo** bloqueio do login (F2-05c, S-07).

Sem isto, `POST /gestao/conta/password` seria um sítio para **adivinhar a
password sem limite** com um cookie roubado, contornando os 15 minutos
depois de 5 falhas do S-07: o login bloqueia, esta rota não, e a password
adivinha-se por aqui.

O contador é **um só, por conta**, nas mesmas colunas
(`admins.tentativas_falhadas`, `admins.bloqueado_ate`):

- cinco falhas nesta rota: todas 400 `password_atual_errada`; a sexta é 429
  `conta_bloqueada` com `segundos_em_falta` e `Retry-After` (a mesma forma
  do login);
- o bloqueio vale **nos dois sentidos**: bloqueada aqui, o login também dá
  429; bloqueada no login, esta rota dá 429 mesmo com a password **certa**;
- com a conta bloqueada, **nada é verificado** nem estendido: o hash, o
  contador e `bloqueado_ate` ficam como estavam, e a password certa não
  muda nada;
- a sessão já aberta sobrevive ao bloqueio (decisão da F2-04: o bloqueio
  defende a porta, não a sala): o 429 vem da regra do bloqueio, não de um 401;
- uma mudança bem-sucedida repõe o contador a zero;
- depois dos 15 minutos o bloqueio acaba.

Relógio congelado (`fixar_relogio_auth`), **antes** do login, para o cookie
não nascer "do futuro". Nada de `sleep`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import text

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_ERRADA_DE_EXEMPLO,
    PASSWORD_FALSA,
    fixar_relogio_auth,
)
from tests.apoio_gestao import PASSWORD_NOVA_FALSA, exigir_erro
from tests.apoio_publico import RelogioFixo

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

    from app.models.admins import Admin

ROTA = "/gestao/conta/password"
INSTANTE_BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)
DURACAO_DO_BLOQUEIO = timedelta(minutes=15)

ERRADA = {
    "password_atual": PASSWORD_ERRADA_DE_EXEMPLO,
    "password_nova": PASSWORD_NOVA_FALSA,
}
CERTA = {"password_atual": PASSWORD_FALSA, "password_nova": PASSWORD_NOVA_FALSA}


@pytest.fixture
def entrada(
    monkeypatch: pytest.MonkeyPatch, cliente_seguro: TestClient, admin: Admin
) -> tuple[TestClient, RelogioFixo]:
    relogio = fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
    resposta = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert resposta.status_code == 200, resposta.text
    return cliente_seguro, relogio


def _pedir(cliente: TestClient, corpo: dict[str, str]) -> Any:
    return cliente.post(ROTA, json=corpo, headers=CABECALHO_MUTACAO)


def _login(cliente: TestClient, password: str) -> Any:
    return cliente.post(
        "/auth/login",
        json={"utilizador": CREDENCIAIS_FALSAS["utilizador"], "password": password},
        headers=CABECALHO_MUTACAO,
    )


def _estado(motor: Engine) -> tuple[str, int, int, str | None]:
    """`(hash, tentativas, sessao_versao, bloqueado_ate)` pelo SQL cru."""
    with motor.connect() as ligacao:
        linha = ligacao.execute(
            text(
                "SELECT hash_password, tentativas_falhadas, sessao_versao, "
                "bloqueado_ate FROM admins"
            )
        ).one()
    return linha[0], linha[1], linha[2], linha[3]


def _outro_cliente() -> Any:
    from fastapi.testclient import TestClient as Cliente

    from app.main import criar_app

    return Cliente(criar_app(), base_url="https://testserver")


def test_cinco_falhas_dao_400_e_a_sexta_e_429_com_o_tempo_em_falta(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    cliente, _ = entrada
    for numero in range(1, 6):
        resposta = _pedir(cliente, ERRADA)
        assert resposta.status_code == 400, (
            f"a tentativa {numero} devolveu {resposta.status_code}, não 400"
        )
        assert resposta.json()["erro"] == "password_atual_errada"
    assert _estado(motor)[1] == 5

    resposta = _pedir(cliente, ERRADA)

    corpo = exigir_erro(resposta, 429, "conta_bloqueada")
    assert corpo["segundos_em_falta"] == int(DURACAO_DO_BLOQUEIO.total_seconds())
    assert resposta.headers["retry-after"] == "900"
    assert resposta.headers.get("cache-control") == "no-store"
    assert "set-cookie" not in resposta.headers


def test_bloqueada_aqui_o_login_tambem_e_429(
    entrada: tuple[TestClient, RelogioFixo],
) -> None:
    cliente, _ = entrada
    for _ in range(5):
        _pedir(cliente, ERRADA)

    with _outro_cliente() as outro:
        resposta = _login(outro, PASSWORD_FALSA)
    exigir_erro(resposta, 429, "conta_bloqueada")


def test_bloqueada_no_login_esta_rota_e_429_mesmo_com_a_password_certa(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    """E a sessão aberta antes sobrevive: o 429 não é um 401."""
    cliente, _ = entrada
    with _outro_cliente() as outro:
        for _ in range(5):
            assert _login(outro, PASSWORD_ERRADA_DE_EXEMPLO).status_code == 400
    antes = _estado(motor)

    resposta = _pedir(cliente, CERTA)

    exigir_erro(resposta, 429, "conta_bloqueada")
    assert resposta.json()["segundos_em_falta"] > 0
    assert "set-cookie" not in resposta.headers
    assert _estado(motor) == antes, "um 429 não muda nem estende nada"


def test_o_contador_e_um_so_falhas_de_um_lado_e_do_outro_somam(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    cliente, _ = entrada
    with _outro_cliente() as outro:
        for _ in range(3):
            assert _login(outro, PASSWORD_ERRADA_DE_EXEMPLO).status_code == 400
    assert _pedir(cliente, ERRADA).status_code == 400
    assert _pedir(cliente, ERRADA).status_code == 400  # a quinta no total
    assert _estado(motor)[1] == 5
    assert _estado(motor)[3] is not None, "`bloqueado_ate` por preencher"

    exigir_erro(_pedir(cliente, ERRADA), 429, "conta_bloqueada")


def test_bloqueada_a_password_certa_nao_muda_nada(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    cliente, _ = entrada
    for _ in range(5):
        _pedir(cliente, ERRADA)
    antes = _estado(motor)

    resposta = _pedir(cliente, CERTA)

    exigir_erro(resposta, 429, "conta_bloqueada")
    assert _estado(motor) == antes
    with _outro_cliente() as outro:
        # A password antiga continua a ser a verdadeira (depois do bloqueio).
        exigir_erro(_login(outro, PASSWORD_FALSA), 429, "conta_bloqueada")


def test_depois_dos_15_minutos_o_bloqueio_acaba_e_a_certa_muda(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    cliente, relogio = entrada
    for _ in range(5):
        _pedir(cliente, ERRADA)
    assert _pedir(cliente, CERTA).status_code == 429

    relogio.instante = INSTANTE_BASE + DURACAO_DO_BLOQUEIO + timedelta(seconds=1)
    resposta = _pedir(cliente, CERTA)

    assert resposta.status_code == 200, resposta.text
    hash_depois, tentativas, _, bloqueado = _estado(motor)
    assert tentativas == 0
    assert bloqueado is None


def test_uma_mudanca_bem_sucedida_repoe_o_contador(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    cliente, _ = entrada
    for _ in range(3):
        assert _pedir(cliente, ERRADA).status_code == 400
    assert _estado(motor)[1] == 3

    resposta = _pedir(cliente, CERTA)

    assert resposta.status_code == 200, resposta.text
    _, tentativas, _, bloqueado = _estado(motor)
    assert tentativas == 0
    assert bloqueado is None


def test_um_422_nao_conta_como_tentativa(
    entrada: tuple[TestClient, RelogioFixo], motor: Engine
) -> None:
    cliente, _ = entrada
    for _ in range(6):
        assert (
            _pedir(
                cliente, {"password_atual": PASSWORD_FALSA, "password_nova": ""}
            ).status_code
            == 422
        )
    assert _estado(motor)[1] == 0
