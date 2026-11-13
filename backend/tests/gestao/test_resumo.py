"""`GET /gestao/resumo` (F2-05b, decisão do Tomás).

`RespostaResumo {fotos_pendentes, proximos_eventos, novos_registos}`:

- `fotos_pendentes`: as fotos no estado `pendente` (a mesma definição da fila
  de moderação, `GET /gestao/fotos`);
- `proximos_eventos`: os `proximos` de `GET /gestao/eventos`, **até 3**;
- `novos_registos`: os clientes com `criado_em >= agora - 7 dias`, janela
  deslizante de 7 x 24 h. O limite é **inclusivo**.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import pytest

from tests.apoio_gestao import (
    CAMPOS_DO_EVENTO,
    ID_EVT_PUBLICADO,
    fixar_relogio_gestao,
    semear_cliente,
    semear_evento,
)
from tests.apoio_publico import exigir_relogio_lido

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

LISBOA = ZoneInfo("Europe/Lisbon")
AGORA = datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)


def _resumo(cliente: TestClient) -> dict[str, Any]:
    resposta = cliente.get("/gestao/resumo")
    assert resposta.status_code == 200, resposta.text
    corpo: dict[str, Any] = resposta.json()
    return corpo


def _semear_foto(sessao: Session, identificador: int, estado: str) -> None:
    from app.models.fotos import EstadoFoto, Foto

    sessao.add(
        Foto(
            id=identificador,
            ficheiro=f"foto{identificador}.webp",
            estado=EstadoFoto(estado),
            ip_hash="0" * 64,
        )
    )
    sessao.commit()


def test_com_tudo_vazio_da_zeros_e_uma_lista_vazia(
    sessao_de_admin: TestClient,
) -> None:
    assert _resumo(sessao_de_admin) == {
        "fotos_pendentes": 0,
        "proximos_eventos": [],
        "novos_registos": 0,
    }


def test_so_tem_estas_tres_chaves(gestao: TestClient) -> None:
    assert set(_resumo(gestao)) == {
        "fotos_pendentes",
        "proximos_eventos",
        "novos_registos",
    }


class TestFotosPendentes:
    def test_conta_so_as_pendentes(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        _semear_foto(sessao, 1, "pendente")
        _semear_foto(sessao, 2, "pendente")
        _semear_foto(sessao, 3, "aprovada")
        _semear_foto(sessao, 4, "rejeitada")
        _semear_foto(sessao, 5, "aprovada")
        assert _resumo(sessao_de_admin)["fotos_pendentes"] == 2

    def test_e_o_mesmo_numero_da_fila_de_moderacao(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        for identificador, estado in enumerate(
            ["pendente", "aprovada", "pendente", "rejeitada", "pendente"], start=1
        ):
            _semear_foto(sessao, identificador, estado)
        fila = sessao_de_admin.get("/gestao/fotos").json()["fotos"]
        assert _resumo(sessao_de_admin)["fotos_pendentes"] == len(fila) == 3

    def test_sem_pendentes_da_zero_mesmo_com_fotos_aprovadas(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        _semear_foto(sessao, 1, "aprovada")
        assert _resumo(sessao_de_admin)["fotos_pendentes"] == 0


class TestProximosEventos:
    def test_tem_no_maximo_tres_e_pela_ordem_dos_proximos(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        for identificador, dia in ((601, 9), (602, 7), (603, 8), (604, 6), (605, 10)):
            semear_evento(
                sessao,
                identificador,
                inicio=datetime(2099, 7, dia, 21, 0, tzinfo=UTC),
                publicado=True,
            )
        proximos = _resumo(sessao_de_admin)["proximos_eventos"]
        assert [evento["id"] for evento in proximos] == [604, 602, 603]

    def test_tem_o_esquema_do_evento_de_gestao(self, gestao: TestClient) -> None:
        proximos = _resumo(gestao)["proximos_eventos"]
        assert [evento["id"] for evento in proximos] == [ID_EVT_PUBLICADO]
        assert set(proximos[0]) == CAMPOS_DO_EVENTO

    def test_sao_os_mesmos_de_gestao_eventos(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        for identificador in range(610, 614):
            semear_evento(
                sessao,
                identificador,
                inicio=datetime(2099, 7, identificador - 600, 21, 0, tzinfo=UTC),
                publicado=True,
            )
        listados = sessao_de_admin.get("/gestao/eventos").json()["proximos"]
        assert _resumo(sessao_de_admin)["proximos_eventos"] == listados[:3]

    def test_ignora_rascunhos_e_passados_com_o_relogio_fixo(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def lisboa(mes: int, dia: int, hora: int, minuto: int = 0) -> datetime:
            return datetime(2026, mes, dia, hora, minuto, tzinfo=LISBOA)

        semear_evento(sessao, 620, inicio=lisboa(7, 14, 23, 59), publicado=True)
        semear_evento(sessao, 621, inicio=lisboa(7, 15, 0, 30), publicado=True)
        semear_evento(sessao, 622, inicio=lisboa(7, 20, 21), publicado=False)
        semear_evento(sessao, 623, inicio=None, publicado=False)
        relogio = fixar_relogio_gestao(monkeypatch, AGORA)
        proximos = _resumo(sessao_de_admin)["proximos_eventos"]
        exigir_relogio_lido(relogio)
        assert [evento["id"] for evento in proximos] == [621]


class TestNovosRegistos:
    """Janela deslizante de 7 x 24 h a partir de agora, com o relógio fixo."""

    def _semear(self, sessao: Session) -> None:
        agora = AGORA.astimezone(UTC)
        semear_cliente(
            sessao, 1, criado_em=agora - timedelta(days=6, hours=23)
        )  # dentro
        semear_cliente(sessao, 2, criado_em=agora - timedelta(days=7, hours=1))  # fora
        semear_cliente(sessao, 3, criado_em=agora - timedelta(minutes=5))  # dentro
        semear_cliente(sessao, 4, criado_em=agora - timedelta(days=30))  # fora

    def test_conta_6d23h_e_nao_conta_7d1h(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._semear(sessao)
        relogio = fixar_relogio_gestao(monkeypatch, AGORA)
        assert _resumo(sessao_de_admin)["novos_registos"] == 2
        exigir_relogio_lido(relogio)

    def test_o_limite_de_exatamente_7_dias_conta(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """`criado_em >= agora - 7 dias`: o limite é inclusivo."""
        agora = AGORA.astimezone(UTC)
        semear_cliente(sessao, 1, criado_em=agora - timedelta(days=7))
        semear_cliente(sessao, 2, criado_em=agora - timedelta(days=7, seconds=1))
        fixar_relogio_gestao(monkeypatch, AGORA)
        assert _resumo(sessao_de_admin)["novos_registos"] == 1

    def test_a_janela_e_de_168_horas_e_nao_de_7_dias_civis(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A 29/10/2026 às 09:00 (UTC+0) a janela volta a 22/10 09:00Z, em UTC.

        Um cliente de 22/10 às 08:30 de Lisboa (07:30Z, em hora de verão) está a
        7 d 1 h 30 min de distância em tempo real e fica de fora; um de 22/10
        às 10:30 de Lisboa (09:30Z) está a 6 d 23 h 30 min e entra.
        """
        agora = datetime(2026, 10, 29, 9, 0, tzinfo=LISBOA)
        semear_cliente(
            sessao, 1, criado_em=datetime(2026, 10, 22, 8, 30, tzinfo=LISBOA)
        )
        semear_cliente(
            sessao, 2, criado_em=datetime(2026, 10, 22, 10, 30, tzinfo=LISBOA)
        )
        fixar_relogio_gestao(monkeypatch, agora)
        assert _resumo(sessao_de_admin)["novos_registos"] == 1

    def test_sem_clientes_da_zero(
        self, sessao_de_admin: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fixar_relogio_gestao(monkeypatch, AGORA)
        assert _resumo(sessao_de_admin)["novos_registos"] == 0
