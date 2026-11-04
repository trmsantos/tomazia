"""Critério S-07: bloqueio de 15 minutos depois de 5 falhas de login.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-07 | Sexta tentativa de login falhada | 429 com tempo de espera |

`docs/ESPECIFICACAO.md`: "bloqueio de 15 minutos após 5 falhas". Decisões
do Tomás, lidas à letra:

- a 1.ª à 5.ª falha respondem sempre 400 — só a **6.ª** vê o 429;
- o bloqueio conta **por conta**, nas colunas `admins.tentativas_falhadas`
  e `admins.bloqueado_ate` (já existentes desde a F2-01) — sem dimensão de
  IP, sem tabela nova;
- uma sessão já aberta sobrevive ao bloqueio da conta: o bloqueio defende a
  porta, não a sala (não testado aqui — é `test_cookie.py`/`test_s04` que
  já provam que uma sessão válida continua a funcionar independentemente
  destes testes).

Tudo com o relógio congelado (`tests/apoio_auth.py::fixar_relogio_auth`) —
**nada de `sleep`**.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_ERRADA_DE_EXEMPLO,
    fixar_relogio_auth,
)

if TYPE_CHECKING:
    import httpx
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.models.admins import Admin

INSTANTE_BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)

#: `docs/ESPECIFICACAO.md`: "bloqueio de 15 minutos".
DURACAO_DO_BLOQUEIO = timedelta(minutes=15)

CORPO_PASSWORD_ERRADA: dict[str, str] = {
    "utilizador": CREDENCIAIS_FALSAS["utilizador"],
    "password": PASSWORD_ERRADA_DE_EXEMPLO,
}


def _tentar_login(
    cliente: TestClient, corpo: dict[str, str] | None = None
) -> httpx.Response:
    return cliente.post(
        "/auth/login", json=corpo or CORPO_PASSWORD_ERRADA, headers=CABECALHO_MUTACAO
    )


def _interpretar_instante(valor: str | datetime | None) -> datetime | None:
    """Normaliza o que `SELECT ... FROM admins` devolve para um `datetime` com fuso.

    Medido: o `sqlite3` por trás de uma consulta em `text()` cru (fora do
    `TypeDecorator` `DataHoraUTC`, que só atua em consultas feitas pelo
    ORM mapeado) devolve uma `str` como `'2026-06-20 10:15:00'`, não um
    `datetime`. Guardado como UTC sem fuso (`DataHoraUTC`), por isso o
    fuso aplicado aqui é sempre UTC.
    """
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=UTC)
    return datetime.fromisoformat(valor).replace(tzinfo=UTC)


def _ler_contador(sessao: Session, admin_id: int) -> tuple[int, datetime | None]:
    linha = sessao.execute(
        text("SELECT tentativas_falhadas, bloqueado_ate FROM admins WHERE id = :id"),
        {"id": admin_id},
    ).one()
    return linha.tentativas_falhadas, _interpretar_instante(linha.bloqueado_ate)


@pytest.mark.usefixtures("admin")
class TestMaquinaDeEstados:
    def test_as_cinco_primeiras_falhas_dao_sempre_400(
        self, monkeypatch: pytest.MonkeyPatch, cliente_seguro: TestClient
    ) -> None:
        """Decisão do Tomás: a 5.ª falha ainda é 400, igual às quatro primeiras.

        Só a 6.ª tentativa vê o bloqueio — testar isto por fora (sem olhar
        à BD) é o que prova que o cliente nunca recebe um sinal diferente
        mesmo na fronteira do bloqueio.
        """
        fixar_relogio_auth(monkeypatch, INSTANTE_BASE)

        for numero_da_tentativa in range(1, 6):
            resposta = _tentar_login(cliente_seguro)
            assert resposta.status_code == 400, (
                f"a tentativa número {numero_da_tentativa} devolveu "
                f"{resposta.status_code}, não 400"
            )

    def test_a_sexta_falha_e_429_com_retry_after_e_segundos_em_falta(
        self, monkeypatch: pytest.MonkeyPatch, cliente_seguro: TestClient
    ) -> None:
        fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
        for _ in range(5):
            _tentar_login(cliente_seguro)

        resposta = _tentar_login(cliente_seguro)

        assert resposta.status_code == 429
        cabecalhos_em_minusculas = {chave.lower() for chave in resposta.headers}
        assert "retry-after" in cabecalhos_em_minusculas
        segundos_do_cabecalho = int(resposta.headers["retry-after"])
        assert 0 < segundos_do_cabecalho <= DURACAO_DO_BLOQUEIO.total_seconds()

        corpo = resposta.json()
        assert {"erro", "mensagem", "segundos_em_falta"} <= set(corpo)
        assert 0 < corpo["segundos_em_falta"] <= DURACAO_DO_BLOQUEIO.total_seconds()
        # O código, não só a forma: a F4-01 vai ramificar por este valor
        # para mostrar o tempo que falta, e um rename silencioso passaria
        # com o `<=` acima sozinho.
        assert corpo["erro"] == "conta_bloqueada"

    def test_bloqueio_regista_cinco_tentativas_e_quinze_minutos_na_bd(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        sessao: Session,
        admin: Admin,
    ) -> None:
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
        for _ in range(5):
            _tentar_login(cliente_seguro)

        tentativas, bloqueado_ate = _ler_contador(sessao, admin.id)
        assert tentativas == 5
        assert bloqueado_ate == relogio.instante + DURACAO_DO_BLOQUEIO

    def test_tentativa_durante_o_bloqueio_nao_incrementa_nem_estende(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        sessao: Session,
        admin: Admin,
    ) -> None:
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
        for _ in range(5):
            _tentar_login(cliente_seguro)
        tentativas_apos_bloqueio, bloqueado_ate_original = _ler_contador(
            sessao, admin.id
        )

        relogio.instante = INSTANTE_BASE + timedelta(minutes=5)
        resposta = _tentar_login(cliente_seguro)
        assert resposta.status_code == 429

        tentativas_depois, bloqueado_ate_depois = _ler_contador(sessao, admin.id)
        assert tentativas_depois == tentativas_apos_bloqueio == 5, (
            "uma tentativa feita durante o bloqueio não pode incrementar o "
            "contador: um atacante em ciclo nunca deixaria o relógio ver o "
            "bloqueio expirar, e o contador cresceria para sempre sem razão"
        )
        assert bloqueado_ate_depois == bloqueado_ate_original, (
            "uma tentativa durante o bloqueio não pode estender "
            "`bloqueado_ate`: estender entregava um bloqueio permanente a "
            "quem fizesse pedidos em ciclo, porque o relógio nunca o "
            "apanharia parado tempo suficiente para expirar"
        )

    def test_bloqueio_expirado_poe_o_contador_a_zero_antes_de_avaliar(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        sessao: Session,
        admin: Admin,
    ) -> None:
        """A armadilha descrita por extenso no plano da F2-04.

        Sem repor o contador a zero, a conta sai do bloqueio ainda com
        `tentativas_falhadas = 5` na BD; uma falha a seguir, com um
        `+= 1` ingénuo, dava 6 — avaliado como sexta falha, bloqueia outra
        vez, para sempre, com o dono a nunca conseguir entrar e o atacante
        a gastar zero tentativas novas. A tentativa que seguir o fim do
        bloqueio tem de ser avaliada como a *primeira* falha de um
        contador a zero.
        """
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
        for _ in range(5):
            _tentar_login(cliente_seguro)

        relogio.instante = INSTANTE_BASE + DURACAO_DO_BLOQUEIO + timedelta(seconds=1)
        resposta = _tentar_login(cliente_seguro)

        assert resposta.status_code == 400, (
            "depois do bloqueio expirar, a tentativa seguinte devolveu "
            f"{resposta.status_code}; devia ser 400 (uma primeira falha "
            "nova), não 429 (bloqueio a continuar porque o contador nunca "
            "foi reposto a zero)"
        )
        tentativas, bloqueado_ate = _ler_contador(sessao, admin.id)
        assert tentativas == 1
        assert bloqueado_ate is None

    def test_sucesso_limpa_tentativas_e_bloqueio(
        self,
        monkeypatch: pytest.MonkeyPatch,
        cliente_seguro: TestClient,
        sessao: Session,
        admin: Admin,
    ) -> None:
        fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
        for _ in range(3):
            _tentar_login(cliente_seguro)

        resposta = cliente_seguro.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, resposta.text

        tentativas, bloqueado_ate = _ler_contador(sessao, admin.id)
        assert tentativas == 0
        assert bloqueado_ate is None
