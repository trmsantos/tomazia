"""Reordenar é atómico: ou muda tudo, ou não muda nada (F2-05a).

Critério da F2-05: "reordenar é atómico". O `sqlite3` legado só abre a
transação no primeiro DML, por isso ler-validar-escrever **não** é atómico:
duas reordenações (ou uma reordenação e um `POST`) podiam entrelaçar-se.
O desenho é escrever primeiro, verificar depois, na mesma transação: um
único `UPDATE ... CASE`, depois `rowcount == len(ids)` e `COUNT(*) ==
len(ids)`; se não, `ROLLBACK` e `409 lista_desatualizada`.

## O que se prova

1. **Efeito:** com uma lista que não é exatamente o conjunto atual (id de
   outra categoria, id apagado, id inventado, lista mais curta, lista mais
   comprida porque a antiga não conhece a categoria nova), a resposta é 409 e
   **nenhuma linha** de `categorias` ou `produtos` mudou, `ordem` incluída.
2. **Forma:** o primeiro SQL que toca em `categorias` (ou em `produtos`) é o
   `UPDATE`, e só há um — é isto, e não um `SELECT` antes, que dá o lock de
   escrita antes de validar. **Fixa o desenho do plano**; se o implementador
   achar outra forma atómica, a asserção da forma é para rever com o arquiteto
   (a de efeito mantém-se).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    ID_CAT_PETISCOS,
    exigir_erro,
    fotografia,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

    from tests.apoio_http import ContadorDeSQL

URL_CATEGORIAS = "/gestao/categorias/ordem"
URL_PETISCOS = f"/gestao/categorias/{ID_CAT_PETISCOS}/produtos/ordem"


def _pedir(cliente: TestClient, url: str, ids: list[Any]) -> Any:
    return cliente.put(url, json={"ids": ids}, headers=CABECALHO_MUTACAO)


class TestCategorias:
    @pytest.mark.parametrize(
        "descricao,ids",
        [
            ("um id inventado no lugar de um existente", [30, 10, 999]),
            ("lista mais curta", [30, 10]),
            ("lista mais comprida, com um id inventado", [30, 10, 20, 999]),
            ("tudo inventado", [998, 999, 997]),
        ],
    )
    def test_lista_que_nao_e_o_conjunto_atual_e_409_e_nada_muda(
        self, gestao: TestClient, motor: Engine, descricao: str, ids: list[int]
    ) -> None:
        antes = fotografia(motor)
        resposta = _pedir(gestao, URL_CATEGORIAS, ids)
        exigir_erro(resposta, 409, "lista_desatualizada")
        assert fotografia(motor) == antes, descricao

    def test_lista_antiga_depois_de_nascer_uma_categoria_e_409(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        """O dono tem o ecrã aberto; outro pedido cria uma categoria."""
        lista_antiga = [30, 10, 20]
        criada = gestao.post(
            "/gestao/categorias", json={"nome": "Vinhos"}, headers=CABECALHO_MUTACAO
        )
        assert criada.status_code == 201, criada.text
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_CATEGORIAS, lista_antiga), 409, "lista_desatualizada"
        )
        assert fotografia(motor) == antes

    def test_lista_antiga_depois_de_apagar_uma_categoria_e_409(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        lista_antiga = [30, 10, 20]
        apagada = gestao.delete("/gestao/categorias/30", headers=CABECALHO_MUTACAO)
        assert apagada.status_code == 204, apagada.text
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_CATEGORIAS, lista_antiga), 409, "lista_desatualizada"
        )
        assert fotografia(motor) == antes

    def test_a_lista_certa_a_seguir_a_um_409_funciona(self, gestao: TestClient) -> None:
        """O `ROLLBACK` não deixa a ligação nem o lock presos."""
        _pedir(gestao, URL_CATEGORIAS, [30, 10, 999])
        assert _pedir(gestao, URL_CATEGORIAS, [30, 10, 20]).status_code == 204


class TestProdutos:
    @pytest.mark.parametrize(
        "descricao,ids",
        [
            ("um produto de outra categoria no lugar de um dos seus", [103, 102, 201]),
            ("um produto de outra categoria a mais", [103, 102, 101, 201]),
            ("só produtos de outra categoria", [201]),
            ("lista mais curta", [103, 102]),
            ("id inventado", [103, 102, 999]),
        ],
    )
    def test_lista_que_nao_e_o_conjunto_atual_e_409_e_nada_muda(
        self, gestao: TestClient, motor: Engine, descricao: str, ids: list[int]
    ) -> None:
        """O caso do produto de outra categoria é o que o `AND categoria_id` apanha."""
        antes = fotografia(motor)
        resposta = _pedir(gestao, URL_PETISCOS, ids)
        exigir_erro(resposta, 409, "lista_desatualizada")
        assert fotografia(motor) == antes, descricao

    def test_lista_antiga_depois_de_nascer_um_produto_e_409(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        lista_antiga = [103, 102, 101]
        criado = gestao.post(
            "/gestao/produtos",
            json={"categoria_id": ID_CAT_PETISCOS, "nome": "Moelas", "preco_cent": 1},
            headers=CABECALHO_MUTACAO,
        )
        assert criado.status_code == 201, criado.text
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_PETISCOS, lista_antiga), 409, "lista_desatualizada"
        )
        assert fotografia(motor) == antes

    def test_lista_antiga_depois_de_um_produto_mudar_de_categoria_e_409(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        lista_antiga = [103, 102, 101]
        movido = gestao.patch(
            "/gestao/produtos/101",
            json={"categoria_id": 30},
            headers=CABECALHO_MUTACAO,
        )
        assert movido.status_code == 200, movido.text
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_PETISCOS, lista_antiga), 409, "lista_desatualizada"
        )
        assert fotografia(motor) == antes


class TestAForma:
    """O que se pode ler do SQL emitido: o `UPDATE` vem primeiro e é um só."""

    @staticmethod
    def _sobre(instrucoes: list[str], tabela: str) -> list[str]:
        """Os verbos (SELECT, UPDATE...) das instruções que citam a tabela."""
        padrao = re.compile(rf"\b{tabela}\b", re.IGNORECASE)
        return [
            i.strip().split(None, 1)[0].upper() for i in instrucoes if padrao.search(i)
        ]

    def test_categorias_o_primeiro_sql_sobre_categorias_e_um_update_so(
        self, gestao: TestClient, contador_de_sql: ContadorDeSQL
    ) -> None:
        with contador_de_sql.a_contar() as instrucoes:
            resposta = _pedir(gestao, URL_CATEGORIAS, [30, 10, 20])
        assert resposta.status_code == 204, resposta.text
        verbos = self._sobre(instrucoes, "categorias")
        assert verbos, contador_de_sql.resumo()
        assert verbos[0] == "UPDATE", (
            "o `UPDATE` tem de vir antes de qualquer leitura de `categorias`: "
            f"{contador_de_sql.resumo()}"
        )
        assert verbos.count("UPDATE") == 1, contador_de_sql.resumo()

    def test_produtos_o_primeiro_sql_sobre_produtos_e_um_update_so(
        self, gestao: TestClient, contador_de_sql: ContadorDeSQL
    ) -> None:
        with contador_de_sql.a_contar() as instrucoes:
            resposta = _pedir(gestao, URL_PETISCOS, [103, 102, 101])
        assert resposta.status_code == 204, resposta.text
        verbos = self._sobre(instrucoes, "produtos")
        assert verbos, contador_de_sql.resumo()
        assert verbos[0] == "UPDATE", contador_de_sql.resumo()
        assert verbos.count("UPDATE") == 1, contador_de_sql.resumo()
