"""`GET /eventos`: os publicados a partir de hoje, hoje em `Europe/Lisbon`.

Envelope nomeado (`{"eventos": [...]}`), `inicio` **não anulável** e sempre
com fuso explícito em UTC, `imagem` como nome de ficheiro e nunca caminho,
ordem por `inicio` ascendente com desempate por `id`, sem limite.

O corte do dia é o do ADR 0010 e vive em `app.tempo.inicio_do_dia_do_bar`.
Os testes da função estão em `test_tempo.py`; os daqui provam que o
endpoint a usa, com o relógio injetado.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_publico import (
    CHAVES_EVENTO,
    CHAVES_EVENTOS,
    EVENTOS_ESPERADOS,
    IDS_DE_EVENTOS_ESCONDIDOS,
)

LISBOA = ZoneInfo("Europe/Lisbon")

#: ISO 8601 com fuso **explícito**: `Z` ou `±HH:MM`. Uma string sem
#: deslocamento nenhum (`2026-07-14T23:30:00`) é o defeito que isto apanha:
#: o browser lê-a como hora local e o cartaz do evento aparece com a hora
#: errada durante metade do ano.
PADRAO_INSTANTE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"
)


def _instante(valor: object) -> datetime:
    assert isinstance(valor, str), f"`inicio` tinha de ser uma string: {valor!r}"
    assert PADRAO_INSTANTE.match(valor), (
        f"{valor!r} não traz fuso horário explícito em ISO 8601 "
        "(ex.: '2026-07-14T23:30:00Z')"
    )
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def _semear_evento(
    sessao: Session, *, id_evento: int, inicio: datetime | None, publicado: bool
) -> None:
    from app.models.eventos import Evento

    sessao.add(
        Evento(
            id=id_evento,
            titulo=f"Evento {id_evento} de exemplo",
            inicio=inicio,
            descricao=None,
            imagem=None,
            publicado=publicado,
        )
    )
    sessao.commit()


@pytest.fixture
def eventos(cliente: TestClient, sessao: Session) -> dict[str, Any]:
    """O cenário armadilhado semeado e a resposta de `GET /eventos` já lida."""
    apoio_publico.semear_cenario(sessao)
    return apoio_publico.obter_json(cliente, "/eventos")


class TestForma:
    def test_o_topo_e_um_objeto_com_a_chave_eventos_e_mais_nenhuma(
        self, eventos: dict[str, Any]
    ) -> None:
        """Deixa passar: nada sobre o conteúdo da lista."""
        assert set(eventos.keys()) == set(CHAVES_EVENTOS)
        assert isinstance(eventos["eventos"], list)

    def test_cada_evento_tem_exatamente_as_chaves_do_contrato(
        self, eventos: dict[str, Any]
    ) -> None:
        """`publicado` não sai: quem vê a lista já sabe que estão publicados.

        Deixa passar: os tipos dos valores.
        """
        assert eventos["eventos"], "o cenário tem eventos publicados e futuros"
        for evento in eventos["eventos"]:
            assert set(evento.keys()) == set(CHAVES_EVENTO), evento

    def test_o_inicio_nunca_e_nulo_e_traz_sempre_fuso_em_utc(
        self, eventos: dict[str, Any]
    ) -> None:
        """`inicio` é não anulável na resposta, ao contrário da coluna.

        A coluna é anulável (um rascunho pode não ter data, ADR 0009), mas
        um evento sem data nunca está publicado — o `CHECK` da F2-01
        garante-o — e por isso o campo da resposta é obrigatório. É o que
        poupa ao frontend um `if (evento.inicio)` em todos os ecrãs.

        O cenário tem um rascunho **sem data nenhuma**: se o filtro de
        `publicado` se perder, isto rebenta aqui antes de rebentar em
        produção.

        Deixa passar: a escolha entre `Z` e `+00:00`. As duas trazem fuso
        explícito e o `Date` do browser lê as duas; o que se exige é que
        venha um.
        """
        for evento in eventos["eventos"]:
            assert evento["inicio"] is not None, evento
            assert _instante(evento["inicio"]).utcoffset() == timedelta(0), evento

    def test_a_imagem_e_um_nome_de_ficheiro_e_nunca_um_caminho(
        self, eventos: dict[str, Any]
    ) -> None:
        """Quem lê o nome junta-o a uma pasta; a resposta não decide a pasta.

        A base de dados já recusa `/`, `\\` e `..` por `CHECK` (F2-01); o
        que isto apanha é a resposta a **acrescentar** um prefixo
        (`/media/cartaz.webp`), que faria o frontend construir
        `/media//media/cartaz.webp` ou amarrar o cliente à estrutura de
        pastas do servidor.

        Deixa passar: um nome de ficheiro que não existe em disco. A
        resposta não verifica o ficheiro.
        """
        por_id = {evento["id"]: evento for evento in eventos["eventos"]}

        assert por_id[apoio_publico.ID_EVT_FADOS]["imagem"] == "cartaz-de-exemplo.webp"
        assert por_id[apoio_publico.ID_EVT_KARAOKE]["imagem"] is None
        for evento in eventos["eventos"]:
            imagem = evento["imagem"]
            if imagem is not None:
                assert "/" not in imagem and "\\" not in imagem, evento


class TestOrdemEFiltro:
    def test_eventos_saem_por_inicio_ascendente_com_desempate_por_id(
        self, eventos: dict[str, Any]
    ) -> None:
        """Dois eventos no mesmo instante e um mais tarde com id pelo meio.

        O quiz tem `id = 50` e é o último: uma implementação que ordene por
        `id` devolve `[20, 50, 70]` e fica vermelha.

        Deixa passar: **o desempate por `id` não é discriminante aqui**.
        Em ordem ascendente, o SQLite devolve os empates por `rowid`, que é
        o `id` — uma implementação sem desempate explícito acerta por
        acaso. O caso que discrimina é a ordem descendente da galeria.
        """
        obtido = tuple(evento["id"] for evento in eventos["eventos"])

        assert obtido == EVENTOS_ESPERADOS

    def test_nenhum_evento_escondido_aparece(self, eventos: dict[str, Any]) -> None:
        """Passado, rascunho com data futura, rascunho sem data.

        Deixa passar: duplicados.
        """
        ids = {evento["id"] for evento in eventos["eventos"]}

        for id_escondido in IDS_DE_EVENTOS_ESCONDIDOS:
            assert id_escondido not in ids, (
                f"o evento {id_escondido} não podia aparecer; vieram {sorted(ids)}"
            )

    def test_nenhum_evento_vem_repetido(self, eventos: dict[str, Any]) -> None:
        """A igualdade de conjuntos não apanha duplicados; esta asserção sim.

        Deixa passar: duplicados que o filtro já tivesse removido — só vê o
        que saiu.
        """
        ids = [evento["id"] for evento in eventos["eventos"]]

        assert len(ids) == len(set(ids)), f"eventos repetidos na resposta: {ids}"

    def test_nao_ha_limite_de_eventos(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """A secção "Esta semana" mostra três, mas isso é do frontend (F3-04).

        A API devolve todos os publicados a partir de hoje: o "Arquivo" da
        F4-03 e a página de eventos contam com isso. Um `LIMIT 3` copiado
        da especificação dos ecrãs só se nota quando o bar tem um mês
        cheio.

        Deixa passar: um limite acima de 30.
        """
        agora = datetime.now(UTC).replace(microsecond=0)
        for numero in range(30):
            _semear_evento(
                sessao,
                id_evento=1000 + numero,
                inicio=agora + timedelta(days=1, minutes=numero),
                publicado=True,
            )

        resposta = cliente.get("/eventos")

        assert resposta.status_code == 200
        assert len(resposta.json()["eventos"]) == 30


class TestCorteDoDiaNoEndpoint:
    """O corte do ADR 0010, exercitado pela rota, com o relógio fixado.

    O relógio é injetado por `apoio_publico.fixar_relogio`, que conta as
    leituras. A contagem é verificada em todos os testes desta classe: sem
    ela, um serviço que chamasse `datetime.now(UTC)` diretamente daria um
    teste vermelho com a mensagem errada — "o evento não apareceu" em vez
    de "o relógio nunca foi injetado" (regra 10 do `CLAUDE.md`).
    """

    def test_guarda_o_adr_0010_um_evento_das_00_30_ainda_esta_no_site_as_09_00(
        self, cliente: TestClient, sessao: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """**Este é o teste que guarda o ADR 0010 do lado do endpoint.**

        Se cair num rebate de merge, o defeito volta sem ninguém dar por
        ele: com o corte em UTC, um evento que começa às 00:30 de Lisboa
        desaparece do site à 01:00 da manhã — enquanto está a acontecer — e
        já não volta. É o horário em que este bar vive: fecha às 02:00.

        Julho, de propósito: é o único mês em que o corte certo
        (`2026-07-14T23:00:00Z`) e o corte "simplificado" para UTC
        (`2026-07-15T00:00:00Z`) são valores diferentes. O teste de inverno
        não serve para isto.

        Deixa passar: um corte que inclua **demasiado** (por exemplo,
        "tudo a partir de ontem"). É o teste a seguir que fecha esse lado.
        """
        inicio = datetime(2026, 7, 15, 0, 30, tzinfo=LISBOA)
        _semear_evento(sessao, id_evento=11, inicio=inicio, publicado=True)
        relogio = apoio_publico.fixar_relogio(
            monkeypatch, datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)
        )

        resposta = cliente.get("/eventos")

        apoio_publico.exigir_relogio_lido(relogio)
        assert resposta.status_code == 200
        assert [evento["id"] for evento in resposta.json()["eventos"]] == [11]

    def test_o_evento_das_00_30_de_ontem_ja_nao_aparece(
        self, cliente: TestClient, sessao: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """O par do teste de cima: o corte corta mesmo alguma coisa.

        Sem este, um `GET /eventos` que devolvesse tudo o que está
        publicado ficava verde no teste que guarda o ADR.

        Deixa passar: a fronteira exata (ver o teste do instante do corte).
        """
        inicio = datetime(2026, 7, 14, 0, 30, tzinfo=LISBOA)
        _semear_evento(sessao, id_evento=12, inicio=inicio, publicado=True)
        relogio = apoio_publico.fixar_relogio(
            monkeypatch, datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)
        )

        resposta = cliente.get("/eventos")

        apoio_publico.exigir_relogio_lido(relogio)
        assert resposta.status_code == 200
        assert resposta.json() == {"eventos": []}

    def test_no_inverno_o_evento_da_madrugada_tambem_fica(
        self, cliente: TestClient, sessao: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """**Não discrimina**, e está aqui na mesma.

        Em janeiro Lisboa é UTC: o corte certo e o corte em UTC são o mesmo
        valor, e uma implementação em UTC fica verde neste teste. Existe
        para prender o caso de inverno contra o defeito oposto — alguém a
        somar uma hora o ano inteiro, que esconderia este evento.

        Deixa passar: exatamente o defeito que o ADR 0010 descreve.
        """
        inicio = datetime(2026, 1, 15, 0, 30, tzinfo=LISBOA)
        _semear_evento(sessao, id_evento=13, inicio=inicio, publicado=True)
        relogio = apoio_publico.fixar_relogio(
            monkeypatch, datetime(2026, 1, 15, 9, 0, tzinfo=LISBOA)
        )

        resposta = cliente.get("/eventos")

        apoio_publico.exigir_relogio_lido(relogio)
        assert resposta.status_code == 200
        assert [evento["id"] for evento in resposta.json()["eventos"]] == [13]

    def test_o_evento_que_comeca_no_instante_do_corte_entra_e_o_anterior_nao(
        self, cliente: TestClient, sessao: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`inicio >= corte`, não `>`. A fronteira é fechada à esquerda.

        Meia-noite em ponto em Lisboa é um evento de hoje. Um segundo antes
        é de ontem.

        Deixa passar: um erro de um segundo para o outro lado só se nota
        nestes dois eventos; não há aqui uma varredura de instantes.
        """
        corte = datetime(2026, 7, 14, 23, 0, tzinfo=UTC)
        _semear_evento(sessao, id_evento=14, inicio=corte, publicado=True)
        _semear_evento(
            sessao, id_evento=15, inicio=corte - timedelta(seconds=1), publicado=True
        )
        relogio = apoio_publico.fixar_relogio(
            monkeypatch, datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)
        )

        resposta = cliente.get("/eventos")

        apoio_publico.exigir_relogio_lido(relogio)
        assert resposta.status_code == 200
        assert [evento["id"] for evento in resposta.json()["eventos"]] == [14]

    def test_o_instante_devolvido_e_o_mesmo_que_foi_guardado(
        self, cliente: TestClient, sessao: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """00:30 em Lisboa sai como 23:30Z do dia anterior — o mesmo instante.

        A conversão para hora de Lisboa é do frontend (F3-04). A API
        publica o instante, em UTC, sem o mexer.

        Deixa passar: a formatação (ver `_instante`).
        """
        inicio = datetime(2026, 7, 15, 0, 30, tzinfo=LISBOA)
        _semear_evento(sessao, id_evento=16, inicio=inicio, publicado=True)
        relogio = apoio_publico.fixar_relogio(
            monkeypatch, datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)
        )

        resposta = cliente.get("/eventos")

        apoio_publico.exigir_relogio_lido(relogio)
        (evento,) = resposta.json()["eventos"]
        assert _instante(evento["inicio"]) == datetime(2026, 7, 14, 23, 30, tzinfo=UTC)


class TestEventosVazios:
    def test_sem_eventos_nenhuns_devolve_200_com_a_lista_vazia(
        self, cliente: TestClient
    ) -> None:
        """Nunca 404, nunca 204, nunca `null`.

        Deixa passar: a secção "Esta semana" some no frontend sem eventos;
        isso é da F3-04, não daqui.
        """
        resposta = cliente.get("/eventos")

        assert resposta.status_code == 200
        assert resposta.json() == {"eventos": []}
