"""O cookie de sessão: os quatro atributos, a validade no servidor, e as rejeições.

`docs/ESPECIFICACAO.md`: "cookie de sessão assinado, `HttpOnly`, `Secure`,
`SameSite=Strict`, 12 horas".

Todos os testes daqui usam `cliente_seguro` (`tests/apoio_auth.py`), nunca a
fixture `cliente` normal: o `Secure` do cookie só sobrevive a um
ida-e-volta em `https://testserver`. Ver o docstring de `cliente_seguro`
para a armadilha medida e o porquê.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from typing import TYPE_CHECKING

import pytest

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    fixar_relogio_auth,
    nome_e_valor_do_cookie,
)

if TYPE_CHECKING:
    import httpx
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

    from app.models.admins import Admin

#: Fixo, com fuso: nenhum teste depende da hora real a que corre.
INSTANTE_DO_LOGIN = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)

#: `docs/ESPECIFICACAO.md`: "12 horas".
VALIDADE_DA_SESSAO = timedelta(hours=12)


def _cookie_da_resposta(resposta: httpx.Response) -> SimpleCookie[str]:
    cabecalho = resposta.headers.get("set-cookie")
    assert cabecalho, "a resposta não trouxe nenhum `Set-Cookie`"
    bolacha: SimpleCookie[str] = SimpleCookie()
    bolacha.load(cabecalho)
    return bolacha


class TestAtributosDoCookie:
    def test_cookie_tem_httponly_secure_samesite_strict_e_path_raiz(
        self, cliente_seguro: TestClient, admin: Admin
    ) -> None:
        """Os quatro atributos de segurança, lidos do `Set-Cookie` — nunca por round-trip.

        `Secure` em particular: só se prova a ler o cabeçalho. Um
        round-trip bem sucedido não prova nada sobre `Secure` (o
        `cliente_seguro` reenviaria o cookie de qualquer forma, com ou sem
        o atributo), e um round-trip falhado não diz se falhou por o
        `Secure` estar lá (correto) ou por outra razão qualquer (regra 10).
        """
        resposta = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, resposta.text

        bolacha = _cookie_da_resposta(resposta)
        (morsel,) = bolacha.values()

        assert morsel["httponly"] is True
        assert morsel["secure"] is True
        assert morsel["samesite"].lower() == "strict"
        assert morsel["path"] == "/"


class TestValidadeDeDozeHorasNoServidor:
    def test_sessao_ainda_valida_pouco_antes_das_doze_horas(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        admin: Admin,
    ) -> None:
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_DO_LOGIN)
        resposta_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta_login.status_code == 200, resposta_login.text

        relogio.instante = INSTANTE_DO_LOGIN + VALIDADE_DA_SESSAO - timedelta(seconds=1)
        resposta = cliente_seguro.get("/auth/eu")
        assert resposta.status_code == 200

    def test_sessao_expira_ao_fim_de_doze_horas_mesmo_sem_o_cliente_saber(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        admin: Admin,
    ) -> None:
        """A validade é imposta pelo servidor, não pelo `Max-Age` do cookie.

        O relógio que avança aqui é só o do **servidor** (`agora_utc`
        injetado); o `TestClient` continua a enviar exatamente o mesmo
        cookie que recebeu, sem o jar dele achar que expirou — porque o
        `Max-Age` conta a partir do relógio real da máquina, que esta
        fixture nunca toca. Se o servidor só confiasse no `Max-Age` para
        decidir, este pedido passava.
        """
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_DO_LOGIN)
        resposta_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta_login.status_code == 200, resposta_login.text

        relogio.instante = INSTANTE_DO_LOGIN + VALIDADE_DA_SESSAO + timedelta(seconds=1)
        resposta = cliente_seguro.get("/auth/eu")
        assert resposta.status_code == 401


class TestCookieRejeitado:
    def test_cookie_adulterado_e_401(
        self, cliente_seguro: TestClient, admin: Admin
    ) -> None:
        resposta_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta_login.status_code == 200, resposta_login.text
        nome, valor = nome_e_valor_do_cookie(resposta_login)

        adulterado = valor[:-1] + ("0" if valor[-1:] != "0" else "1")
        cliente_seguro.cookies.set(nome, adulterado)

        resposta = cliente_seguro.get("/auth/eu")
        assert resposta.status_code == 401

    def test_cookie_assinado_com_outro_segredo_e_401(
        self,
        monkeypatch: pytest.MonkeyPatch,
        motor: Engine,
        admin: Admin,
    ) -> None:
        """Um cookie válido, mas assinado com outro `SEGREDO_SESSAO`, não serve.

        Não há dois servidores a sério: a app nasce duas vezes no mesmo
        processo, com o `SEGREDO_SESSAO` trocado a meio — o que
        `obter_definicoes()` (um `lru_cache`) obriga a fazer. A base de
        dados é a mesma nas duas (`app.db.obter_engine()` não depende do
        segredo), por isso o `admin` de apoio existe para as duas.

        Deixa passar: o formato exato da assinatura (`itsdangerous` ou
        outro) — só que trocar o segredo invalida o cookie.
        """
        from fastapi.testclient import TestClient

        import app.config
        from app.main import criar_app

        monkeypatch.setenv("SEGREDO_SESSAO", "segredo-de-exemplo-com-outro-valor-aaaa")
        app.config.obter_definicoes.cache_clear()
        with TestClient(criar_app(), base_url="https://testserver") as cliente_outro:
            resposta_login = cliente_outro.post(
                "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
            )
            assert resposta_login.status_code == 200, resposta_login.text
            nome, valor_com_outro_segredo = nome_e_valor_do_cookie(resposta_login)

        monkeypatch.setenv("SEGREDO_SESSAO", "segredo-de-exemplo-original-bbbb")
        app.config.obter_definicoes.cache_clear()
        with TestClient(criar_app(), base_url="https://testserver") as cliente_original:
            cliente_original.cookies.set(nome, valor_com_outro_segredo)
            resposta = cliente_original.get("/auth/eu")

        assert resposta.status_code == 401


class TestLogoutApagaOCookie:
    def test_logout_apaga_o_cookie_com_path_e_samesite_iguais_ao_do_login(
        self, cliente_seguro: TestClient, admin: Admin
    ) -> None:
        """Um `delete_cookie` com atributos diferentes do login não apaga nada no browser.

        O browser só substitui um cookie por outro se `name`, `path` (e,
        para a maioria, `domain`) coincidirem; `SameSite` entra aqui porque
        o login e o logout têm de concordar na mesma política, não porque o
        browser a use para decidir se apaga. Testar isto com `SimpleCookie`
        em vez de olhar para a string à mão é o que não quebra se a ordem
        dos atributos no cabeçalho mudar.
        """
        resposta_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta_login.status_code == 200, resposta_login.text
        (morsel_login,) = _cookie_da_resposta(resposta_login).values()

        resposta_logout = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
        assert resposta_logout.status_code == 204, resposta_logout.text
        (morsel_logout,) = _cookie_da_resposta(resposta_logout).values()

        assert morsel_logout["path"] == morsel_login["path"], (
            "o `Set-Cookie` do logout tem um `Path` diferente do login "
            f"({morsel_logout['path']!r} vs {morsel_login['path']!r})"
        )
        assert morsel_logout["samesite"].lower() == morsel_login["samesite"].lower()

        # Prova final: a sessão antiga já não serve, mesmo que o cliente
        # ainda tivesse o cookie original na mão.
        cliente_seguro.cookies.set(*nome_e_valor_do_cookie(resposta_login))
        resposta_eu = cliente_seguro.get("/auth/eu")
        assert resposta_eu.status_code == 401
