"""Limite de 5 envios por hora por IP (`docs/TAREFAS.md`, F2-06).

Decisões do Tomás — não reabertas aqui:

- o limite conta **tentativas** (`tentativas_de_envio`, ADR 0018), não
  linhas de `fotos`: a decisão original (5 de novembro de 2026) era contar
  envios aceites, substituída horas depois quando medido que um ficheiro
  de 58 bytes gastava dezenas de MB de RSS sem gastar quota nenhuma;
- **rejeitar continua a apagar os bytes e a manter a linha de `fotos`**,
  mas já não é isso que sustenta o limite (`test_rejeitar_as_cinco_nao_liberta_o_balde`,
  abaixo, prova agora que a tentativa fica registada, não que a linha de
  `fotos` fica);
- o dono salta o limite: com sessão de admin válida, `POST /fotos` não
  conta para o balde nem lhe regista tentativa nenhuma — mesmo quando o
  balde do IP dele já está cheio
  (`test_sessao_de_admin_nao_conta_mesmo_com_o_balde_do_ip_cheio`).

O relógio congela-se por `agora_utc`, nunca `sleep` — ver
`tests.apoio_fotos.fixar_relogio_fotos`, no mesmo padrão de
`tests.apoio_auth.fixar_relogio_auth`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

from tests import apoio_fotos
from tests.apoio_auth import CABECALHO_MUTACAO

if TYPE_CHECKING:
    import pytest
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.models.admins import Admin

INSTANTE_BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)
JANELA = timedelta(hours=1)


def _cinco_envios_aceites(cliente: TestClient) -> None:
    for numero in range(1, 6):
        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
        assert resposta.status_code == 202, (
            f"o envio número {numero} devolveu {resposta.status_code}, não 202: "
            f"{resposta.text}"
        )


class TestMaquinaDeEstados:
    def test_cinco_passam_o_sexto_e_429_com_retry_after_e_segundos_em_falta(
        self, monkeypatch: pytest.MonkeyPatch, sessao: Session
    ) -> None:
        apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
        cliente = apoio_fotos.cliente_com_ip("203.0.113.11")

        _cinco_envios_aceites(cliente)
        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())

        assert resposta.status_code == 429, resposta.text
        cabecalhos_em_minusculas = {chave.lower() for chave in resposta.headers}
        assert "retry-after" in cabecalhos_em_minusculas
        segundos_do_cabecalho = int(resposta.headers["retry-after"])
        assert 0 < segundos_do_cabecalho <= JANELA.total_seconds()

        corpo = resposta.json()
        assert {"erro", "mensagem", "segundos_em_falta"} <= set(corpo)
        assert 0 < corpo["segundos_em_falta"] <= JANELA.total_seconds()

    def test_com_o_relogio_avancado_uma_hora_volta_a_passar(
        self, monkeypatch: pytest.MonkeyPatch, sessao: Session
    ) -> None:
        relogio = apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
        cliente = apoio_fotos.cliente_com_ip("203.0.113.12")

        _cinco_envios_aceites(cliente)
        bloqueada = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
        assert bloqueada.status_code == 429, bloqueada.text

        relogio.instante = INSTANTE_BASE + JANELA + timedelta(seconds=1)
        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())

        assert resposta.status_code == 202, (
            "passada mais de uma hora sobre o primeiro envio, o balde tinha "
            f"de estar livre outra vez: {resposta.text}"
        )

    def test_dois_ips_diferentes_nao_partilham_balde(
        self, monkeypatch: pytest.MonkeyPatch, sessao: Session
    ) -> None:
        apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
        _cinco_envios_aceites(apoio_fotos.cliente_com_ip("203.0.113.13"))

        resposta = apoio_fotos.enviar_foto(
            apoio_fotos.cliente_com_ip("198.51.100.13"), apoio_fotos.jpeg_valido()
        )

        assert resposta.status_code == 202, (
            "um IP que nunca enviou nada não pode herdar o balde cheio de "
            f"outro: {resposta.text}"
        )

    def test_x_forwarded_for_forjado_nao_compra_balde_novo(
        self, monkeypatch: pytest.MonkeyPatch, sessao: Session
    ) -> None:
        apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
        cliente = apoio_fotos.cliente_com_ip("203.0.113.14")
        _cinco_envios_aceites(cliente)

        resposta = apoio_fotos.enviar_foto(
            cliente,
            apoio_fotos.jpeg_valido(),
            cabecalhos_extra={"X-Forwarded-For": "198.51.100.99"},
        )

        assert resposta.status_code == 429, (
            "um `X-Forwarded-For` forjado não pode dar a quem já gastou o "
            f"balde um balde novo em nome de outro IP: {resposta.text}"
        )

    def test_sessao_de_admin_nao_conta_mesmo_com_o_balde_do_ip_cheio(
        self, monkeypatch: pytest.MonkeyPatch, admin: Admin, sessao: Session
    ) -> None:
        apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
        ip = "203.0.113.15"
        anonimo = apoio_fotos.cliente_com_ip(ip)
        _cinco_envios_aceites(anonimo)
        bloqueada = apoio_fotos.enviar_foto(anonimo, apoio_fotos.jpeg_valido())
        assert bloqueada.status_code == 429, bloqueada.text

        cliente_admin = apoio_fotos.cliente_admin_com_ip(ip)
        resposta = apoio_fotos.enviar_foto(cliente_admin, apoio_fotos.jpeg_valido())

        assert resposta.status_code == 202, (
            "uma sessão de admin válida salta o limite, mesmo quando o "
            f"balde do IP já está cheio: {resposta.text}"
        )

    def test_rejeitar_as_cinco_nao_liberta_o_balde(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao: Session,
        sessao_de_admin: TestClient,
    ) -> None:
        """A condição que a decisão do Tomás pede provada: a linha fica, só o estado muda."""
        from app.models.fotos import Foto

        apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
        cliente = apoio_fotos.cliente_com_ip("203.0.113.16")
        _cinco_envios_aceites(cliente)

        ids = sessao.scalars(select(Foto.id)).all()
        assert len(ids) == 5
        for id_foto in ids:
            resposta = sessao_de_admin.post(
                f"/gestao/fotos/{id_foto}/rejeitar", headers=CABECALHO_MUTACAO
            )
            assert resposta.status_code == 200, resposta.text

        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())

        assert resposta.status_code == 429, (
            "rejeitar as cinco fotos não pode libertar o balde: a linha de "
            f"`fotos` fica, só o estado muda: {resposta.text}"
        )
