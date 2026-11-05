"""`GET /auth/eu` e `POST /auth/logout`.

`/auth/eu` nunca exige `X-Tomazia` (é uma leitura — ver S-06); `/auth/logout`
exige-o sempre, por ser uma mutação, sem exceção para si próprio.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from tests.apoio_auth import CABECALHO_MUTACAO, CREDENCIAIS_FALSAS, fixar_relogio_auth

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from app.models.admins import Admin

INSTANTE_DO_LOGIN = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)
VALIDADE_DA_SESSAO = timedelta(hours=12)


class TestEu:
    def test_sem_sessao_devolve_401_no_envelope(
        self, cliente_seguro: TestClient
    ) -> None:
        resposta = cliente_seguro.get("/auth/eu")

        assert resposta.status_code == 401
        corpo = resposta.json()
        assert set(corpo) == {"erro", "mensagem"}
        # O código, não só a forma: a F4-01 vai ramificar por este valor
        # (por exemplo, para mandar para o ecrã de login), e um rename
        # silencioso do código passaria com `set(corpo) == {...}` sozinho.
        assert corpo["erro"] == "sessao_em_falta"
        assert corpo["mensagem"] == (
            "Sessão inexistente ou expirada. Inicia sessão novamente."
        )

    @pytest.mark.parametrize(
        "com_sessao", [False, True], ids=["sem_sessao", "com_sessao"]
    )
    def test_cache_control_e_sempre_no_store(
        self, sessao_de_admin: TestClient, cliente_seguro: TestClient, com_sessao: bool
    ) -> None:
        """Nunca em cache — nem autenticado nem anónimo.

        Um `GET /auth/eu` em cache de um navegador partilhado (ou de um
        proxy) é a diferença entre a próxima pessoa a usar o telemóvel ver
        "sessão encerrada" e ver o nome do dono.
        """
        cliente = sessao_de_admin if com_sessao else cliente_seguro
        resposta = cliente.get("/auth/eu")
        assert resposta.headers.get("cache-control") == "no-store"

    def test_com_sessao_valida_devolve_200(self, sessao_de_admin: TestClient) -> None:
        resposta = sessao_de_admin.get("/auth/eu")
        assert resposta.status_code == 200

    def test_nao_exige_x_tomazia(self, cliente_seguro: TestClient) -> None:
        """Uma leitura nunca é bloqueada pelo guarda do S-06.

        Sem sessão o resultado continua a ser 401 (não é isto que se
        testa) — o que se testa é que nunca é 403 por falta do cabeçalho.
        """
        resposta = cliente_seguro.get("/auth/eu")
        assert resposta.status_code != 403


class TestLogout:
    def test_exige_x_tomazia(self, sessao_de_admin: TestClient) -> None:
        resposta = sessao_de_admin.post("/auth/logout")
        assert resposta.status_code == 403

    def test_com_sessao_devolve_204(self, sessao_de_admin: TestClient) -> None:
        resposta = sessao_de_admin.post("/auth/logout", headers=CABECALHO_MUTACAO)
        assert resposta.status_code == 204

    def test_e_idempotente_sem_cookie_nenhum(self, cliente_seguro: TestClient) -> None:
        """Chamar logout sem nunca ter tido sessão não é um erro."""
        resposta = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
        assert resposta.status_code == 204

    def test_e_idempotente_com_cookie_ja_caducado(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        admin: Admin,
    ) -> None:
        """Logout depois da sessão já ter expirado também não é um erro.

        O `admin` do login nem precisa de ainda existir para o logout
        funcionar: apagar um cookie que já não serve é sempre seguro.
        """
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_DO_LOGIN)
        resposta_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta_login.status_code == 200, resposta_login.text

        relogio.instante = INSTANTE_DO_LOGIN + VALIDADE_DA_SESSAO + timedelta(seconds=1)
        resposta_logout = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
        assert resposta_logout.status_code == 204

    def test_login_depois_de_logout_continua_a_funcionar(
        self, cliente_seguro: TestClient, admin: Admin
    ) -> None:
        """Um cookie emitido *depois* de um logout tem de servir normalmente.

        Achado em revisão da F2-04 por mutação: trocar a versão gravada no
        cookie do login por um `0` fixo, em vez de `admin.sessao_versao`,
        deixava `tests/auth` e `tests/seguranca` inteiros verdes (355
        testes) — a suite não tinha nenhum caso em que a conta já tivesse
        passado por um logout antes de um login. Em produção isso tranca o
        dono fora da conta para sempre a partir do primeiro logout: a
        linha fica na versão 1, todo cookie novo nasce com uma versão fixa
        que nunca mais bate.
        """
        primeiro_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert primeiro_login.status_code == 200, primeiro_login.text

        logout = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
        assert logout.status_code == 204, logout.text

        segundo_login = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert segundo_login.status_code == 200, segundo_login.text

        resposta = cliente_seguro.get("/auth/eu")
        assert resposta.status_code == 200

    def test_logout_termina_todas_as_sessoes_do_mesmo_admin(
        self, cliente_seguro: TestClient, admin: Admin
    ) -> None:
        """ADR 0016: o logout termina *todas* as sessões da conta, não só a de quem clicou.

        Duas sessões de verdade (dois `TestClient`, a mesma conta, a mesma
        base de dados — `app.db.obter_engine()` está em cache por
        processo) em vez de reenviar o mesmo cookie ao mesmo cliente: é o
        que distingue "o logout invalida a conta inteira" de "o logout só
        apaga o cookie deste browser", que os outros testes desta classe
        não provam sozinhos.
        """
        from fastapi.testclient import TestClient as ClienteDeTeste

        from app.main import criar_app

        login_no_primeiro_browser = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert login_no_primeiro_browser.status_code == 200, (
            login_no_primeiro_browser.text
        )

        with ClienteDeTeste(
            criar_app(), base_url="https://testserver"
        ) as segundo_browser:
            login_no_segundo_browser = segundo_browser.post(
                "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
            )
            assert login_no_segundo_browser.status_code == 200, (
                login_no_segundo_browser.text
            )

            logout_no_primeiro_browser = cliente_seguro.post(
                "/auth/logout", headers=CABECALHO_MUTACAO
            )
            assert logout_no_primeiro_browser.status_code == 204

            resposta_no_segundo_browser = segundo_browser.get("/auth/eu")

        assert resposta_no_segundo_browser.status_code == 401, (
            "o logout no primeiro browser devia ter terminado também a "
            "sessão do segundo, aberta na mesma conta"
        )
