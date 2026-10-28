"""`GET /galeria`: todas as fotos aprovadas, as mais recentes primeiro.

Envelope nomeado (`{"fotos": [...]}`). `estado`, `enviada_por`, `ip_hash`,
`criada_em` e `moderada_em` **não saem**: o que o público vê é a foto e a
legenda.

**Sem teto.** Esta bateria teve, numa versão, um teto de 24 fotos numa
constante nomeada. Não vinha da especificação — que só diz "grelha de duas
colunas com as seis últimas fotos; ecrã inteiro com deslizar", e isso é o
que a **F3-03 mostra**, não o que a API devolve —, não vinha da tarefa e
não tinha ADR. Era um requisito inventado, e a revisão de código apanhou-o.
O Tomás decidiu: todas as aprovadas, sem teto.

Fica registado porque o erro não era o número: era escolher um número em
nome de quem decide. Se um dia houver fotos a mais para uma resposta só, a
paginação é uma decisão com data, não um `LIMIT` que apareceu num teste.
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
        self, galeria: dict[str, Any], sessao: Session
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

        A primeira asserção é a sonda do empate: lê as duas fotos da base
        de dados e confirma que partilham mesmo o `criada_em`. O campo não
        sai na resposta, por isso sem esta sonda alguém que mexesse nos
        instantes do cenário desarmava o empate e este teste — o único
        desempate discriminante da bateria toda — passava a verificar uma
        lista sem empates nenhuns, sem ficar vermelho.

        Deixa passar: três fotos chegam para a ordem, não para provar que a
        ordenação é feita sobre o conjunto inteiro — isso é
        `TestSemTeto::test_todas_as_fotos_aprovadas_saem_por_ordem`.
        """
        from app.models.fotos import Foto

        primeira = sessao.get(Foto, apoio_publico.ID_FOTO_RECENTE_B)
        segunda = sessao.get(Foto, apoio_publico.ID_FOTO_RECENTE_A)
        assert primeira is not None and segunda is not None
        assert primeira.criada_em == segunda.criada_em, (
            "o cenário já não arma o empate em `criada_em` que este teste "
            "existe para prender"
        )

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


class TestSemTeto:
    def test_todas_as_fotos_aprovadas_saem_por_ordem(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Trinta aprovadas, trinta na resposta, pela ordem do contrato.

        Prende as duas coisas de uma vez: que não há teto nenhum (o
        contrato é "todas as aprovadas") e que a ordenação é aplicada sobre
        o conjunto inteiro. Uma ordenação feita em Python sobre uma fatia,
        ou um `LIMIT` sem `ORDER BY`, devolvia outra lista.

        Deixa passar: um teto acima de 30 — não há aqui uma varredura de
        tamanhos. E não diz nada sobre o custo de servir muitas fotos: o
        número de instruções SQL é `test_consultas.py`, o tamanho da
        resposta não é medido em lado nenhum. Se um dia for preciso,
        pagina-se com uma decisão escrita, não com um número num teste.
        """
        ids = _semear_fotos_aprovadas(sessao, 30)

        corpo = apoio_publico.obter_json(cliente, "/galeria")

        assert [foto["id"] for foto in corpo["fotos"]] == sorted(ids, reverse=True)


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
