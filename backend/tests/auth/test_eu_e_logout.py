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
