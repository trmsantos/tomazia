"""`GET /ementa`: categorias visíveis com os produtos disponíveis, por ordem.

Envelope nomeado (`{"categorias": [...]}`), nunca um array no topo: um
array no topo da resposta é um contrato que não se consegue estender sem o
partir, e a F2-09 gera TypeScript a partir dele.

Cada teste corre duas vezes, `[modelos]` e `[migracao]`.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_publico import (
    CHAVES_CATEGORIA,
    CHAVES_EMENTA,
    CHAVES_PRODUTO,
    EMENTA_ESPERADA,
    IDS_DE_CATEGORIAS_ESCONDIDAS,
    IDS_DE_PRODUTOS_ESCONDIDOS,
)


@pytest.fixture
def ementa(cliente: TestClient, sessao: Session) -> dict[str, Any]:
    """O cenário armadilhado semeado e a resposta de `GET /ementa` já lida."""
    apoio_publico.semear_cenario(sessao)
    return apoio_publico.obter_json(cliente, "/ementa")


class TestForma:
    def test_o_topo_e_um_objeto_com_a_chave_categorias_e_mais_nenhuma(
        self, ementa: dict[str, Any]
    ) -> None:
        """Deixa passar: nada sobre o conteúdo da lista — só sobre o envelope."""
        assert set(ementa.keys()) == set(CHAVES_EMENTA)
        assert isinstance(ementa["categorias"], list)

    def test_cada_categoria_tem_exatamente_as_chaves_do_contrato(
        self, ementa: dict[str, Any]
    ) -> None:
        """O único guarda que transforma "apareceu um campo novo" em vermelho.

        Colunas explícitas no `select` e um `response_model` fazem o campo
        não sair — mas em silêncio, e nenhum dos dois fica vermelho quando
        alguém troca o `select` por `select(Categoria)`. Este fica.

        `ordem` não é uma chave: a ordem está na posição dos elementos.

        Deixa passar: o **tipo** de cada valor. Um `slug` que viesse a
        `null` passava aqui.
        """
        assert ementa["categorias"], "o cenário tem categorias visíveis"
        for categoria in ementa["categorias"]:
            assert set(categoria.keys()) == set(CHAVES_CATEGORIA), categoria

    def test_cada_produto_tem_exatamente_as_chaves_do_contrato(
        self, ementa: dict[str, Any]
    ) -> None:
        """Deixa passar: o mesmo que o teste das categorias — tipos, não.

        E não apanha um produto a mais ou a menos; isso é o teste de ordem.
        """
        produtos = [p for c in ementa["categorias"] for p in c["produtos"]]

        assert produtos, "o cenário tem produtos disponíveis"
        for produto in produtos:
            assert set(produto.keys()) == set(CHAVES_PRODUTO), produto


class TestOrdemEFiltro:
    def test_categorias_e_produtos_saem_na_ordem_exata_do_contrato(
        self, ementa: dict[str, Any]
    ) -> None:
        """Ordem por `ordem` ascendente e, em empate, por `id` ascendente.

        O cenário tem uma categoria com `ordem = 5` e um id baixo (20): uma
        implementação que ordene só por `id` devolve `[10, 20, 30]` e fica
        vermelha. E tem um produto com `ordem = 3` e o id mais baixo da
        categoria (150), pela mesma razão.

        Deixa passar: **o desempate por `id` não é discriminante**. Os
        empates em `ordem = 0` são resolvidos pelo SQLite por `rowid`, que
        aqui é o `id`, por isso uma implementação sem desempate explícito
        devolve a mesma coisa por acaso. O desempate que discrimina é o da
        galeria (`criada_em` descendente), em `test_galeria.py`.
        """
        obtido = tuple(
            (categoria["id"], tuple(produto["id"] for produto in categoria["produtos"]))
            for categoria in ementa["categorias"]
        )

        assert obtido == EMENTA_ESPERADA

    def test_nenhuma_categoria_escondida_aparece(self, ementa: dict[str, Any]) -> None:
        """A invisível, a que só tem indisponíveis e a que não tem produtos.

        Deixa passar: duplicados (é o teste a seguir) e campos a mais (é o
        teste das chaves).
        """
        ids = {categoria["id"] for categoria in ementa["categorias"]}

        for id_escondido in IDS_DE_CATEGORIAS_ESCONDIDAS:
            assert id_escondido not in ids, (
                f"a categoria {id_escondido} não podia aparecer; vieram {sorted(ids)}"
            )

    def test_nenhum_produto_escondido_aparece(self, ementa: dict[str, Any]) -> None:
        """Indisponíveis, e disponíveis dentro de uma categoria invisível.

        Deixa passar: o mesmo que o de cima.
        """
        ids = {p["id"] for c in ementa["categorias"] for p in c["produtos"]}

        for id_escondido in IDS_DE_PRODUTOS_ESCONDIDOS:
            assert id_escondido not in ids, (
                f"o produto {id_escondido} não podia aparecer; vieram {sorted(ids)}"
            )

    def test_nenhuma_categoria_e_nenhum_produto_vem_repetido(
        self, ementa: dict[str, Any]
    ) -> None:
        """O teste que apanha o `join`.

        A igualdade de conjuntos dos testes de cima apanha um filtro
        perdido, mas **não apanha duplicados**: um `join` a mais duplica a
        categoria das bebidas (tem três produtos) e o conjunto normaliza-a
        de volta a um elemento. Esta asserção é a que fica vermelha.

        Deixa passar: uma implementação que devolva as categorias certas e
        duplique **produtos** dentro delas só é apanhada pela segunda
        asserção — que existe pela mesma razão.
        """
        ids_de_categorias = [categoria["id"] for categoria in ementa["categorias"]]
        assert len(ids_de_categorias) == len(set(ids_de_categorias)), (
            f"categorias repetidas na resposta: {ids_de_categorias}"
        )

        for categoria in ementa["categorias"]:
            ids_de_produtos = [produto["id"] for produto in categoria["produtos"]]
            assert len(ids_de_produtos) == len(set(ids_de_produtos)), (
                f"produtos repetidos na categoria {categoria['id']}: {ids_de_produtos}"
            )


class TestValores:
    def test_o_preco_sai_em_centimos_inteiros_e_o_zero_sobrevive(
        self, ementa: dict[str, Any]
    ) -> None:
        """Preços em cêntimos (`int`), nunca em euros nem em texto.

        O produto de 0 cêntimos existe de propósito: a água de cortesia é
        um preço legítimo, e um `if produto.preco_cent:` pelo caminho
        fá-la-ia desaparecer ou sair a `null`.

        Deixa passar: um preço convertido ao dobro ou dividido por 100 com
        resto zero — compara-se com os valores semeados, mas só destes
        dois produtos.
        """
        por_id = {
            produto["id"]: produto
            for categoria in ementa["categorias"]
            for produto in categoria["produtos"]
        }

        tremocos = por_id[apoio_publico.ID_PROD_TREMOCOS]
        assert tremocos["preco_cent"] == 0
        assert isinstance(tremocos["preco_cent"], int)
        assert not isinstance(tremocos["preco_cent"], bool)

        imperial = por_id[apoio_publico.ID_PROD_IMPERIAL]
        assert imperial["preco_cent"] == 150
        assert isinstance(imperial["preco_cent"], int)

    def test_a_descricao_ausente_sai_a_null_e_a_presente_sai_inteira(
        self, ementa: dict[str, Any]
    ) -> None:
        """`descricao` é opcional: `null`, nunca `""` nem a chave em falta.

        Deixa passar: texto com aspas e `<script>` — é o S-09, em
        `tests/seguranca/`.
        """
        por_id = {
            produto["id"]: produto
            for categoria in ementa["categorias"]
            for produto in categoria["produtos"]
        }

        assert por_id[apoio_publico.ID_PROD_IMPERIAL]["descricao"] is None
        assert por_id[apoio_publico.ID_PROD_VINHO]["descricao"] == "Tinto de exemplo"

    def test_o_slug_e_o_nome_saem_tal_como_estao_guardados(
        self, ementa: dict[str, Any]
    ) -> None:
        """Deixa passar: nada sobre categorias que não estas duas."""
        por_id = {categoria["id"]: categoria for categoria in ementa["categorias"]}

        bebidas = por_id[apoio_publico.ID_CAT_BEBIDAS]
        assert bebidas["nome"] == "Bebidas de exemplo"
        assert bebidas["slug"] == "bebidas-de-exemplo"


class TestEmentaVazia:
    def test_sem_categorias_nenhumas_devolve_200_com_a_lista_vazia(
        self, cliente: TestClient
    ) -> None:
        """Lista vazia é `{"categorias": []}` com 200.

        Nunca 404 (a ementa existe, está vazia), nunca 204 (o frontend
        precisa do envelope para distinguir "vazio" de "falhou"), nunca
        `null`.

        Deixa passar: a base de dados está vazia mas o esquema existe. Uma
        app que rebentasse com a tabela em falta não é o que isto mede.
        """
        resposta = cliente.get("/ementa")

        assert resposta.status_code == 200
        assert resposta.json() == {"categorias": []}

    def test_uma_categoria_visivel_sem_produtos_disponiveis_nao_sai_sozinha(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Com só a armadilha semeada, a ementa fica vazia — não com uma casca.

        É o mesmo filtro do cenário completo, isolado: aqui a resposta
        certa é a lista vazia, e uma implementação que devolva a categoria
        com `produtos: []` fica vermelha sem ambiguidade nenhuma.

        Deixa passar: nada sobre a ordem nem sobre as chaves.
        """
        from app.models.ementa import Categoria, Produto

        sessao.add(
            Categoria(
                id=apoio_publico.ID_CAT_SO_INDISPONIVEIS,
                nome=f"Garrafeira {apoio_publico.MARCA} de exemplo",
                slug="garrafeira-de-exemplo",
                ordem=0,
                visivel=True,
            )
        )
        sessao.flush()
        sessao.add(
            Produto(
                id=apoio_publico.ID_PROD_SO_IND_A,
                categoria_id=apoio_publico.ID_CAT_SO_INDISPONIVEIS,
                nome=f"Garrafa {apoio_publico.MARCA} de exemplo",
                descricao=None,
                preco_cent=1500,
                disponivel=False,
                ordem=0,
            )
        )
        sessao.commit()

        resposta = cliente.get("/ementa")

        assert resposta.status_code == 200
        assert resposta.json() == {"categorias": []}
