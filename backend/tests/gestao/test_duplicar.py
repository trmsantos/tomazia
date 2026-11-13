"""`POST /gestao/eventos/{id}/duplicar` (F2-05b, decisão do Tomás).

A cópia é sempre um **rascunho**, com o mesmo `titulo`, `descricao` e `imagem`.
O `inicio` mantém a **hora de parede de `Europe/Lisbon`** e o dia da semana:

- o candidato é o original **+ 7 dias somados na hora de parede de Lisboa**
  (somar 7 × 24 h em UTC erra uma hora na semana da mudança da hora);
- se o candidato não for **estritamente posterior a agora**, soma-se mais 7
  dias de cada vez, até à primeira data posterior a agora.

## Regras escolhidas pelo engenheiro de testes, a seguir pelo backend

1. **A fronteira "agora" é o instante atual (`agora_utc()`), não o corte do
   dia do bar.** Uma cópia às 22:00 de hoje, pedida às 23:30, já passou: um
   rascunho para uma hora que já foi não serve ao dono. A comparação é
   estrita: um candidato **igual** a agora não é "depois de agora" e salta
   mais uma semana; um segundo antes, não.
2. **Hora de parede inexistente** (o salto da primavera: em Lisboa, a
   01:00-02:00 do último domingo de março) **ou ambígua** (o recuo do
   outono: 01:00-02:00 do último domingo de outubro): `fold=0`, a regra do
   PEP 495 que o `zoneinfo` aplica por omissão.
   - inexistente: `01:30` de 28/03/2027 lê-se com o deslocamento de antes do
     salto (UTC+0), dando `01:30Z`, que em Lisboa se escreve `02:30`: a
     hora pedida mais uma hora (as 01:30 dão 02:30);
   - ambígua: `01:30` de 25/10/2026 lê-se como a **primeira** ocorrência
     (UTC+1), dando `00:30Z`.
3. Um original sem `inicio` dá uma cópia sem `inicio`, sem ler o relógio.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CAMPOS_DO_EVENTO,
    ID_EVT_PUBLICADO,
    ID_EVT_RASCUNHO_SEM_DATA,
    MAIOR_ID_DO_SQLITE,
    exigir_erro,
    fixar_relogio_gestao,
    fotografia,
    semear_evento,
)
from tests.apoio_publico import exigir_relogio_lido

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

LISBOA = ZoneInfo("Europe/Lisbon")
ID_ORIGINAL = 500


def _lisboa(
    ano: int, mes: int, dia: int, hora: int, minuto: int = 0, segundo: int = 0
) -> datetime:
    return datetime(ano, mes, dia, hora, minuto, segundo, tzinfo=LISBOA)


def _duplicar(cliente: TestClient, identificador: int) -> Any:
    return cliente.post(
        f"/gestao/eventos/{identificador}/duplicar", headers=CABECALHO_MUTACAO
    )


def _inicio_da_copia(
    cliente: TestClient, sessao: Session, original: datetime
) -> datetime:
    """Semeia o original, duplica-o (com o relógio já fixado) e devolve o `inicio`."""
    semear_evento(sessao, ID_ORIGINAL, inicio=original, publicado=True)
    resposta = _duplicar(cliente, ID_ORIGINAL)
    assert resposta.status_code == 201, resposta.text
    return datetime.fromisoformat(resposta.json()["inicio"])


@pytest.fixture
def relogio_de_julho(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Quinta-feira, 16/07/2026, 20:00 em Lisboa."""
    return fixar_relogio_gestao(monkeypatch, _lisboa(2026, 7, 16, 20, 0))


class TestAMudancaDeHora:
    def test_a_semana_da_mudanca_do_outono_mantem_as_22h_de_lisboa(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Quinta 22/10/2026 22:00 (21:00Z) +7 dias = 29/10 22:00 de Lisboa (22:00Z).

        Somado em UTC dava 29/10 21:00Z, ou seja, 21:00 em Lisboa.
        """
        relogio = fixar_relogio_gestao(monkeypatch, _lisboa(2026, 10, 1, 12, 0))
        original = datetime(2026, 10, 22, 21, 0, tzinfo=UTC)
        assert original.astimezone(LISBOA).hour == 22
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        exigir_relogio_lido(relogio)
        assert inicio == datetime(2026, 10, 29, 22, 0, tzinfo=UTC)
        assert inicio.astimezone(LISBOA).hour == 22

    def test_a_semana_da_mudanca_da_primavera_mantem_as_22h_de_lisboa(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Quinta 25/03/2027 22:00 (22:00Z) +7 dias = 01/04 22:00 de Lisboa (21:00Z)."""
        fixar_relogio_gestao(monkeypatch, _lisboa(2027, 3, 1, 12, 0))
        original = datetime(2027, 3, 25, 22, 0, tzinfo=UTC)
        assert original.astimezone(LISBOA).hour == 22
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        assert inicio == datetime(2027, 4, 1, 21, 0, tzinfo=UTC)
        assert inicio.astimezone(LISBOA).hour == 22


class TestHoraInexistenteOuAmbigua:
    def test_hora_inexistente_fica_uma_hora_mais_tarde(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Dom 21/03/2027 01:30 +7 = 28/03 01:30, que não existe em Lisboa.

        `fold=0`: lê-se com o deslocamento de antes do salto, `01:30Z`, que em
        Lisboa se escreve `02:30`.
        """
        fixar_relogio_gestao(monkeypatch, _lisboa(2027, 3, 1, 12, 0))
        original = _lisboa(2027, 3, 21, 1, 30)
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        assert inicio == datetime(2027, 3, 28, 1, 30, tzinfo=UTC)
        assert inicio.astimezone(LISBOA).hour == 2

    def test_hora_ambigua_fica_com_a_primeira_ocorrencia(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Dom 18/10/2026 01:30 +7 = 25/10 01:30, que acontece duas vezes.

        `fold=0`: a primeira, ainda em hora de verão (UTC+1), `00:30Z`.
        """
        fixar_relogio_gestao(monkeypatch, _lisboa(2026, 10, 1, 12, 0))
        original = _lisboa(2026, 10, 18, 1, 30)
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        assert inicio == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)


class TestOQueSeCopia:
    def test_original_no_futuro_da_mais_sete_dias(
        self, sessao_de_admin: TestClient, sessao: Session, relogio_de_julho: Any
    ) -> None:
        original = _lisboa(2026, 7, 27, 21, 0)  # segunda
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        exigir_relogio_lido(relogio_de_julho)
        assert inicio == _lisboa(2026, 8, 3, 21, 0)
        assert inicio.astimezone(LISBOA).weekday() == original.weekday()

    def test_original_que_so_passou_ha_pouco_da_mais_sete_se_for_futuro(
        self, sessao_de_admin: TestClient, sessao: Session, relogio_de_julho: Any
    ) -> None:
        """Original de 15/07 (quarta) 21:00: +7 = 22/07, depois de agora (16/07)."""
        inicio = _inicio_da_copia(sessao_de_admin, sessao, _lisboa(2026, 7, 15, 21, 0))
        assert inicio == _lisboa(2026, 7, 22, 21, 0)

    def test_original_no_arquivo_da_a_proxima_data_futura(
        self, sessao_de_admin: TestClient, sessao: Session, relogio_de_julho: Any
    ) -> None:
        """Original de quinta 02/07 22:00; agora, quinta 16/07 20:00.

        +7 = 09/07 (passou); +14 = 16/07 22:00, duas horas depois de agora.
        """
        original = _lisboa(2026, 7, 2, 22, 0)
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        exigir_relogio_lido(relogio_de_julho)
        assert inicio == _lisboa(2026, 7, 16, 22, 0)
        assert inicio.astimezone(LISBOA).weekday() == 3  # quinta
        assert inicio.astimezone(LISBOA).time() == original.time()

    def test_original_muito_antigo_avanca_ate_depois_de_agora(
        self, sessao_de_admin: TestClient, sessao: Session, relogio_de_julho: Any
    ) -> None:
        """Quinta 15/01/2026 22:00 (inverno, 22:00Z) ainda dá quinta 22:00 de Lisboa em julho (21:00Z)."""
        original = _lisboa(2026, 1, 15, 22, 0)
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        assert inicio == _lisboa(2026, 7, 16, 22, 0)
        assert inicio.astimezone(LISBOA).time() == original.time()
        assert inicio.astimezone(LISBOA).weekday() == original.weekday()

    def test_a_cada_salto_de_semana_a_hora_de_parede_nao_foge(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Original em julho (UTC+1), agora em dezembro: a cópia mantém as 22:00 de Lisboa (UTC+0)."""
        fixar_relogio_gestao(monkeypatch, _lisboa(2026, 12, 1, 12, 0))
        original = _lisboa(2026, 7, 2, 22, 0)  # quinta
        inicio = _inicio_da_copia(sessao_de_admin, sessao, original)
        assert inicio == _lisboa(2026, 12, 3, 22, 0)  # quinta
        assert inicio == datetime(2026, 12, 3, 22, 0, tzinfo=UTC)

    def test_copia_e_sempre_rascunho_com_titulo_descricao_e_imagem(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        semear_evento(
            sessao,
            ID_ORIGINAL,
            inicio=datetime(2099, 6, 4, 21, 0, tzinfo=UTC),
            publicado=True,
            titulo='Fados "ao vivo"',
            descricao="Entrada livre",
            imagem="cartaz.webp",
        )
        resposta = _duplicar(sessao_de_admin, ID_ORIGINAL)
        assert resposta.status_code == 201, resposta.text
        copia = resposta.json()
        assert set(copia) == CAMPOS_DO_EVENTO
        assert copia["id"] != ID_ORIGINAL
        assert copia["publicado"] is False
        assert copia["titulo"] == 'Fados "ao vivo"'
        assert copia["descricao"] == "Entrada livre"
        assert copia["imagem"] == "cartaz.webp"
        assert datetime.fromisoformat(copia["inicio"]) == datetime(
            2099, 6, 11, 21, 0, tzinfo=UTC
        )

    def test_o_original_fica_como_estava(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        assert _duplicar(gestao, ID_EVT_PUBLICADO).status_code == 201
        depois = fotografia(motor)
        assert depois["categorias"] == antes["categorias"]
        assert depois["produtos"] == antes["produtos"]
        assert [linha for linha in depois["eventos"] if linha in antes["eventos"]] == (
            antes["eventos"]
        )
        assert len(depois["eventos"]) == len(antes["eventos"]) + 1

    def test_a_copia_de_um_publicado_nao_aparece_no_site_publico(
        self, gestao: TestClient
    ) -> None:
        resposta = _duplicar(gestao, ID_EVT_PUBLICADO)
        assert resposta.status_code == 201, resposta.text
        copia = resposta.json()["id"]
        rascunhos = gestao.get("/gestao/eventos").json()["rascunhos"]
        assert copia in [evento["id"] for evento in rascunhos]
        publicos = [e["id"] for e in gestao.get("/eventos").json()["eventos"]]
        assert copia not in publicos

    def test_original_rascunho_com_data_da_rascunho(
        self, sessao_de_admin: TestClient, sessao: Session, relogio_de_julho: Any
    ) -> None:
        semear_evento(
            sessao, ID_ORIGINAL, inicio=_lisboa(2026, 7, 27, 21), publicado=False
        )
        resposta = _duplicar(sessao_de_admin, ID_ORIGINAL)
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["publicado"] is False

    def test_original_sem_data_da_copia_sem_data(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        resposta = _duplicar(gestao, ID_EVT_RASCUNHO_SEM_DATA)
        assert resposta.status_code == 201, resposta.text
        copia = resposta.json()
        assert copia["inicio"] is None
        assert copia["publicado"] is False
        assert copia["titulo"] == "Festa por marcar"
        assert copia["id"] != ID_EVT_RASCUNHO_SEM_DATA


class TestAFronteiraDeAgora:
    """O instante atual, e não o corte do dia do bar (regra 1 do docstring)."""

    ORIGINAL = _lisboa(2026, 7, 2, 22, 0)  # quinta; candidato: 09/07, depois 16/07

    def _copia_com_agora_em(
        self,
        cliente: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
        agora: datetime,
    ) -> datetime:
        relogio = fixar_relogio_gestao(monkeypatch, agora)
        inicio = _inicio_da_copia(cliente, sessao, self.ORIGINAL)
        exigir_relogio_lido(relogio)
        return inicio

    def test_um_segundo_antes_do_candidato_aceita_o_candidato(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        inicio = self._copia_com_agora_em(
            sessao_de_admin, sessao, monkeypatch, _lisboa(2026, 7, 16, 21, 59, 59)
        )
        assert inicio == _lisboa(2026, 7, 16, 22, 0)

    def test_agora_igual_ao_candidato_salta_uma_semana(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Igual a agora não é "depois de agora"."""
        inicio = self._copia_com_agora_em(
            sessao_de_admin, sessao, monkeypatch, _lisboa(2026, 7, 16, 22, 0)
        )
        assert inicio == _lisboa(2026, 7, 23, 22, 0)

    def test_hoje_mas_ja_passou_salta_mesmo_dentro_do_dia_do_bar(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """16/07 22:00 está dentro do dia do bar de 16/07 às 23:30, mas já passou.

        Com o corte do dia do bar a cópia saía para as 22:00 de hoje, uma hora
        que o dono já não pode usar.
        """
        inicio = self._copia_com_agora_em(
            sessao_de_admin, sessao, monkeypatch, _lisboa(2026, 7, 16, 23, 30)
        )
        assert inicio == _lisboa(2026, 7, 23, 22, 0)


class TestErros:
    def test_inexistente_e_404(self, gestao: TestClient, motor: Engine) -> None:
        antes = fotografia(motor)
        exigir_erro(_duplicar(gestao, 999), 404, "evento_inexistente")
        assert fotografia(motor) == antes

    def test_o_maior_id_valido_e_404(self, gestao: TestClient) -> None:
        exigir_erro(_duplicar(gestao, MAIOR_ID_DO_SQLITE), 404, "evento_inexistente")
