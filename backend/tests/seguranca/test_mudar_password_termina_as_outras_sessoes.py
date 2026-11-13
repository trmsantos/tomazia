"""Mudar a password mata as outras sessões e reemite a de quem muda (F2-05c).

Com cookie assinado, uma sessão sobrevive à mudança da password se nada a
revogar: quem tivesse um cookie roubado continuava lá dentro 12 horas
depois de o dono "mudar a password" para se proteger. O ADR 0016 já tem o
mecanismo (`admins.sessao_versao`); esta rota usa-o:

- o cookie **antigo** (de qualquer sessão, incluindo o de quem muda) dá 401;
- a resposta traz um cookie **novo**, com a versão nova, e é com ele que
  quem mudou continua na gestão, sem ter de entrar outra vez;
- esse cookie novo tem exatamente os atributos de segurança do login:
  nome com prefixo `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`,
  `Path=/`, **sem** `Domain`, e a mesma validade de 12 horas. Lê-se do
  `Set-Cookie` **diretamente**: o `TestClient` nunca devolve um cookie
  `Secure` sem `https`, e "o cookie pegou" não distingue um atributo em falta.
"""

from __future__ import annotations

from http.cookies import Morsel, SimpleCookie
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_FALSA,
    nome_e_valor_do_cookie,
)
from tests.apoio_gestao import PASSWORD_NOVA_FALSA

if TYPE_CHECKING:
    import httpx
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

    from app.models.admins import Admin

ROTA = "/gestao/conta/password"
CORPO = {"password_atual": PASSWORD_FALSA, "password_nova": PASSWORD_NOVA_FALSA}
VALIDADE_EM_SEGUNDOS = 12 * 3600


def _novo_cliente() -> Any:
    from fastapi.testclient import TestClient as Cliente

    from app.main import criar_app

    return Cliente(criar_app(), base_url="https://testserver")


def _entrar(cliente: TestClient) -> tuple[str, str]:
    resposta = cliente.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert resposta.status_code == 200, resposta.text
    return nome_e_valor_do_cookie(resposta)


def _com_cookie(nome: str, valor: str) -> Any:
    cliente = _novo_cliente()
    cliente.cookies.set(nome, valor)
    return cliente


def _versao(motor: Engine) -> int:
    with motor.connect() as ligacao:
        return int(
            ligacao.execute(text("SELECT sessao_versao FROM admins")).scalar_one()
        )


def _morsel(resposta: httpx.Response) -> tuple[str, Morsel[str]]:
    cabecalhos = resposta.headers.get_list("set-cookie")
    assert len(cabecalhos) == 1, (
        f"esperava exatamente um `Set-Cookie`, vieram {len(cabecalhos)}: {cabecalhos!r}"
    )
    biscoito: SimpleCookie[str] = SimpleCookie()
    biscoito.load(cabecalhos[0])
    ((nome, morsel),) = biscoito.items()
    return nome, morsel


def test_o_cookie_antigo_morre_e_o_novo_serve(
    cliente_seguro: TestClient, admin: Admin, motor: Engine
) -> None:
    # Duas sessões: A (a que vai ser morta de fora) e B (a que muda a password).
    nome_a, valor_a = _entrar(cliente_seguro)
    with _novo_cliente() as quem_muda:
        nome_b, valor_b = _entrar(quem_muda)
        assert _com_cookie(nome_a, valor_a).get("/auth/eu").status_code == 200
        versao_antes = _versao(motor)

        resposta = quem_muda.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)

        assert resposta.status_code == 200, resposta.text
        nome_novo, morsel = _morsel(resposta)
        valor_novo = morsel.value

    assert _versao(motor) == versao_antes + 1

    assert nome_novo == nome_b
    assert valor_novo != valor_b, "o cookie novo tem de ser outro valor"
    for antigo in ((nome_a, valor_a), (nome_b, valor_b)):
        for caminho in ("/auth/eu", "/gestao/resumo"):
            r = _com_cookie(*antigo).get(caminho)
            assert r.status_code == 401, (
                f"{caminho} com um cookie antigo: {r.status_code}"
            )
            assert r.json()["erro"] == "sessao_em_falta"
    for caminho in ("/auth/eu", "/gestao/resumo"):
        r = _com_cookie(nome_novo, valor_novo).get(caminho)
        assert r.status_code == 200, f"{caminho} com o cookie novo: {r.status_code}"


def test_o_cookie_novo_tem_os_atributos_do_login(
    sessao_de_admin: TestClient,
) -> None:
    resposta = sessao_de_admin.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)
    assert resposta.status_code == 200, resposta.text

    nome, morsel = _morsel(resposta)
    assert nome.startswith("__Host-"), nome
    assert morsel["secure"] is True
    assert morsel["httponly"] is True
    assert morsel["samesite"].lower() == "strict"
    assert morsel["path"] == "/"
    assert not morsel["domain"], "um cookie `__Host-` com `Domain` é recusado"
    assert int(morsel["max-age"]) == VALIDADE_EM_SEGUNDOS
    assert resposta.headers.get("cache-control") == "no-store"


def test_os_atributos_sao_os_mesmos_do_cookie_do_login(
    cliente_seguro: TestClient, admin: Admin
) -> None:
    """Um só sítio define o cookie: os dois `Set-Cookie` diferem só no valor."""
    login = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    mudanca = cliente_seguro.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)
    assert mudanca.status_code == 200, mudanca.text

    nome_l, morsel_l = _morsel(login)
    nome_m, morsel_m = _morsel(mudanca)
    assert nome_l == nome_m
    for atributo in ("secure", "httponly", "samesite", "path", "domain", "max-age"):
        assert morsel_l[atributo] == morsel_m[atributo], atributo


def test_quem_mudou_continua_e_pode_mudar_outra_vez_com_o_cookie_novo(
    sessao_de_admin: TestClient,
) -> None:
    primeira = sessao_de_admin.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)
    assert primeira.status_code == 200, primeira.text
    assert sessao_de_admin.get("/gestao/resumo").status_code == 200

    segunda = sessao_de_admin.post(
        ROTA,
        json={"password_atual": PASSWORD_NOVA_FALSA, "password_nova": PASSWORD_FALSA},
        headers=CABECALHO_MUTACAO,
    )
    assert segunda.status_code == 200, segunda.text
    assert sessao_de_admin.get("/gestao/resumo").status_code == 200


def test_o_logout_de_quem_mudou_ainda_funciona_e_revoga_o_cookie_novo(
    sessao_de_admin: TestClient,
) -> None:
    resposta = sessao_de_admin.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO)
    nome, morsel = _morsel(resposta)
    assert (
        sessao_de_admin.post("/auth/logout", headers=CABECALHO_MUTACAO).status_code
        == 204
    )
    assert _com_cookie(nome, morsel.value).get("/auth/eu").status_code == 401


def test_a_password_antiga_deixa_de_entrar_e_a_nova_entra(
    sessao_de_admin: TestClient,
) -> None:
    assert (
        sessao_de_admin.post(ROTA, json=CORPO, headers=CABECALHO_MUTACAO).status_code
        == 200
    )
    with _novo_cliente() as outro:
        antiga = outro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert antiga.status_code == 400
        nova = outro.post(
            "/auth/login",
            json={
                "utilizador": CREDENCIAIS_FALSAS["utilizador"],
                "password": PASSWORD_NOVA_FALSA,
            },
            headers=CABECALHO_MUTACAO,
        )
        assert nova.status_code == 200, nova.text
