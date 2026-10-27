"""`GET /galeria`: as fotos aprovadas, as mais recentes primeiro, até 24.

Envelope nomeado (`{"fotos": [...]}`). `estado`, `enviada_por`, `ip_hash`,
`criada_em` e `moderada_em` **não saem**: o que o público vê é a foto e a
legenda.

O teto de 24 vive numa constante nomeada em `app.services.publico`. Um
número escrito a meio de uma expressão é um número que ninguém encontra
quando quer mudá-lo — e este vai ser mudado (a F3-03 mostra seis no ecrã
inicial e abre a grelha completa a partir daí).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_publico import (
    CHAVES_FOTO,
    CHAVES_GALERIA,
    FOTOS_ESPERADAS,
    IDS_DE_FOTOS_ESCONDIDAS,
)

#: O teto da especificação desta tarefa. Escrito aqui em vez de importado
#: da app de propósito: importar a constante e compará-la consigo própria
#: só provaria que ela existe.
MAXIMO_ESPERADO = 24


def _semear_fotos_aprovadas(sessao: Session, quantas: int) -> list[int]:
    """`quantas` fotos aprovadas, uma por segundo, com ids crescentes."""
    from app.models.fotos import EstadoFoto, Foto

    base = datetime.now(UTC).replace(microsecond=0) - timedelta(hours=2)
    ids = []
    for numero in range(quantas):
        id_foto = 1000 + numero
        ids.append(id_foto)
        sessao.add(
            Foto(
                id=id_foto,
                ficheiro=f"00000000-0000-4000-8000-{id_foto:012d}.webp",
                estado=EstadoFoto.APROVADA,
                descricao=None,
                enviada_por=None,
                ip_hash=f"hash-falso-de-ip-{id_foto:016d}",
                criada_em=base + timedelta(seconds=numero),
                moderada_em=base + timedelta(seconds=numero),
            )
        )
    sessao.commit()
    return ids


@pytest.fixture
def galeria(cliente: TestClient, sessao: Session) -> dict[str, Any]:
    """O cenário armadilhado semeado e a resposta de `GET /galeria` já lida."""
    apoio_publico.semear_cenario(sessao)
    return apoio_publico.obter_json(cliente, "/galeria")


class TestForma:
    def test_o_topo_e_um_objeto_com_a_chave_fotos_e_mais_nenhuma(
        self, galeria: dict[str, Any]
    ) -> None:
        """Deixa passar: nada sobre o conteúdo da lista."""
        assert set(galeria.keys()) == set(CHAVES_GALERIA)
        assert isinstance(galeria["fotos"], list)

    def test_cada_foto_tem_exatamente_as_chaves_do_contrato(
        self, galeria: dict[str, Any]
    ) -> None:
        """Três chaves. `ip_hash` e `enviada_por` ficam de fora.

        Não é arrumação: o `ip_hash` é o que limita cinco envios por hora
        por IP (F2-06) e publicá-lo dava a qualquer pessoa a lista de
        hashes para comparar; o `enviada_por` é o nome de quem enviou a
        foto, que a especificação mostra na gestão e não no site.

        Deixa passar: os tipos dos valores.
        """
        assert galeria["fotos"], "o cenário tem fotos aprovadas"
        for foto in galeria["fotos"]:
            assert set(foto.keys()) == set(CHAVES_FOTO), foto

    def test_o_ficheiro_e_um_nome_e_nunca_um_caminho(
        self, galeria: dict[str, Any]
    ) -> None:
        """Quem lê o nome junta-o a `public_html/media`; a API não decide a pasta.

        Deixa passar: um nome que não existe em disco, e a extensão.
        """
        for foto in galeria["fotos"]:
            assert "/" not in foto["ficheiro"], foto
            assert "\\" not in foto["ficheiro"], foto
            assert ".." not in foto["ficheiro"], foto

    def test_a_descricao_ausente_sai_a_null_e_a_presente_sai_inteira(
        self, galeria: dict[str, Any]
    ) -> None:
        """Deixa passar: texto com aspas e `<script>` — é o S-09."""
        por_id = {foto["id"]: foto for foto in galeria["fotos"]}

        assert por_id[apoio_publico.ID_FOTO_RECENTE_A]["descricao"] is None
        assert (
            por_id[apoio_publico.ID_FOTO_ANTIGA]["descricao"] == "Esplanada de exemplo"
        )


class TestOrdemEFiltro:
    def test_as_mais_recentes_primeiro_com_desempate_por_id_descendente(
        self, galeria: dict[str, Any]
    ) -> None:
        """**O desempate que discrimina.**

        `fotos.criada_em` vem do `CURRENT_TIMESTAMP`, com resolução de um
        segundo: duas fotos enviadas no mesmo segundo empatam, e isso é o
        caso normal quando alguém envia duas seguidas. O cenário tem duas
        no mesmo instante, ids 100 e 300.

        Ao contrário dos empates ascendentes da ementa e dos eventos, este
        discrimina: sem desempate explícito, o SQLite ordena de forma
        estável por `rowid` **ascendente** e devolve `[100, 300]`; o
        contrato pede `[300, 100]`.

        Deixa passar: três fotos chegam para a ordem, não para provar que a
        ordenação é feita em SQL e não em Python depois do teto de 24 —
        isso é `test_o_teto_corta_as_mais_antigas_e_nao_as_mais_recentes`.
        """
        obtido = tuple(foto["id"] for foto in galeria["fotos"])

        assert obtido == FOTOS_ESPERADAS

    def test_nenhuma_foto_por_moderar_ou_rejeitada_aparece(
        self, galeria: dict[str, Any]
    ) -> None:
        """A pendente é o critério S-03 do lado da lista.

        O S-03 (F2-06) prende o URL da imagem de uma foto pendente a 404.
        Este prende o passo anterior: a foto pendente não é sequer
        anunciada.

        Deixa passar: duplicados, e o ficheiro servido pelo Apache.
        """
        ids = {foto["id"] for foto in galeria["fotos"]}

        for id_escondido in IDS_DE_FOTOS_ESCONDIDAS:
            assert id_escondido not in ids, (
                f"a foto {id_escondido} não podia aparecer; vieram {sorted(ids)}"
            )

    def test_nenhuma_foto_vem_repetida(self, galeria: dict[str, Any]) -> None:
        """Deixa passar: só vê o que saiu."""
        ids = [foto["id"] for foto in galeria["fotos"]]

        assert len(ids) == len(set(ids)), f"fotos repetidas na resposta: {ids}"


class TestTeto:
    def test_a_constante_do_teto_existe_e_vale_24(self) -> None:
        """O teto tem nome, e o nome é onde se vai mexer nele.

        Deixa passar: que a constante seja mesmo usada pela consulta. É o
        teste a seguir que o mede.
        """
        from app.services.publico import MAXIMO_FOTOS_NA_GALERIA

        assert MAXIMO_FOTOS_NA_GALERIA == MAXIMO_ESPERADO

    def test_com_mais_do_que_o_teto_a_resposta_traz_exatamente_o_teto(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Trinta aprovadas, vinte e quatro na resposta.

        Deixa passar: **quais** as 24 (é o teste a seguir).
        """
        _semear_fotos_aprovadas(sessao, 30)

        resposta = cliente.get("/galeria")

        assert resposta.status_code == 200
        assert len(resposta.json()["fotos"]) == MAXIMO_ESPERADO

    def test_o_teto_corta_as_mais_antigas_e_nao_as_mais_recentes(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """A ordem tem de ser aplicada **antes** do corte, em SQL.

        Um `LIMIT` sobre uma consulta sem `ORDER BY`, ou uma ordenação
        feita em Python depois de cortar, devolve 24 fotos — só que as
        erradas. É o defeito que o teste da contagem sozinho deixa passar.

        Deixa passar: a ordem dentro das 24 já é testada noutro sítio; o
        que esta asserção prende é o conjunto e a primeira posição.
        """
        ids = _semear_fotos_aprovadas(sessao, 30)
        mais_recentes = sorted(ids, reverse=True)[:MAXIMO_ESPERADO]

        corpo = apoio_publico.obter_json(cliente, "/galeria")

        obtidos = [foto["id"] for foto in corpo["fotos"]]
        assert obtidos == mais_recentes

    def test_com_menos_do_que_o_teto_vem_tudo(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """O controlo de sucesso falso do teto.

        Sem isto, uma implementação com `LIMIT 0` passava nos dois testes
        de cima por não haver nada a contar.

        Deixa passar: nada sobre a ordem.
        """
        _semear_fotos_aprovadas(sessao, 3)

        corpo = apoio_publico.obter_json(cliente, "/galeria")

        assert len(corpo["fotos"]) == 3


class TestGaleriaVazia:
    def test_sem_fotos_aprovadas_devolve_200_com_a_lista_vazia(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Com uma pendente lá dentro: vazia não é o mesmo que sem fotos.

        Deixa passar: nunca 404, nunca 204 — mas só para este caso.
        """
        from app.models.fotos import EstadoFoto, Foto

        sessao.add(
            Foto(
                id=apoio_publico.ID_FOTO_PENDENTE,
                ficheiro=f"{apoio_publico.MARCA}-pendente.webp",
                estado=EstadoFoto.PENDENTE,
                descricao=f"Pendente {apoio_publico.MARCA} de exemplo",
                enviada_por=None,
                ip_hash="hash-falso-de-ip-0000000000000009",
                criada_em=datetime.now(UTC).replace(microsecond=0),
                moderada_em=None,
            )
        )
        sessao.commit()

        resposta = cliente.get("/galeria")

        assert resposta.status_code == 200
        assert resposta.json() == {"fotos": []}
