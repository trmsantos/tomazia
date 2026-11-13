"""`PUT /gestao/categorias/ordem` e `PUT /gestao/categorias/{id}/produtos/ordem`.

A atomicidade (409, nada muda) está em
`tests/seguranca/test_reordenar_e_atomico.py`; aqui, o caminho feliz e os 4xx
que não dependem de corrida.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    ID_CAT_BEBIDAS,
    ID_CAT_PETISCOS,
    ID_PROD_AZEITONAS,
    ID_PROD_PICA_PAU,
    ID_PROD_TREMOCOS,
    MAIOR_ID_DO_SQLITE,
    exigir_erro,
    fotografia,
    ids_das_categorias,
    ids_dos_produtos,
    ler_ementa_de_gestao,
    ordens_na_bd,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

URL_CATEGORIAS = "/gestao/categorias/ordem"
URL_PETISCOS = f"/gestao/categorias/{ID_CAT_PETISCOS}/produtos/ordem"


def _pedir(cliente: TestClient, url: str, corpo: Any) -> Any:
    return cliente.put(url, json=corpo, headers=CABECALHO_MUTACAO)


class TestOrdemDasCategorias:
    def test_a_ordem_lida_de_volta_e_a_pedida(self, gestao: TestClient) -> None:
        pedida = [ID_CAT_BEBIDAS, ID_CAT_PETISCOS, 20]
        resposta = _pedir(gestao, URL_CATEGORIAS, {"ids": pedida})
        assert resposta.status_code == 204, resposta.text
        assert resposta.content == b""
        assert ids_das_categorias(ler_ementa_de_gestao(gestao)) == pedida

    def test_a_coluna_ordem_passa_a_ser_a_posicao(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        """Parte de um empate (10 e 30 com ordem 1): fica 0, 1, 2 sem empates."""
        pedida = [30, 10, 20]
        _pedir(gestao, URL_CATEGORIAS, {"ids": pedida})
        assert ordens_na_bd(motor, "categorias") == {30: 0, 10: 1, 20: 2}

    def test_pedir_a_ordem_atual_e_inofensivo_e_repetivel(
        self, gestao: TestClient
    ) -> None:
        atual = ids_das_categorias(ler_ementa_de_gestao(gestao))
        for _ in range(2):
            assert _pedir(gestao, URL_CATEGORIAS, {"ids": atual}).status_code == 204
        assert ids_das_categorias(ler_ementa_de_gestao(gestao)) == atual

    def test_a_ementa_publica_segue_a_nova_ordem(self, gestao: TestClient) -> None:
        # a 20 está invisível: na pública só aparecem 10 e 30
        _pedir(gestao, URL_CATEGORIAS, {"ids": [30, 10, 20]})
        # a 30 não tem produtos, por isso a pública só mostra a 10; criamos um
        gestao.post(
            "/gestao/produtos",
            json={"categoria_id": 30, "nome": "Imperial", "preco_cent": 150},
            headers=CABECALHO_MUTACAO,
        )
        nomes = [c["nome"] for c in gestao.get("/ementa").json()["categorias"]]
        assert nomes == ["Bebidas", "Petiscos"]

    def test_nao_mexe_na_ordem_dos_produtos(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = ordens_na_bd(motor, "produtos")
        resposta = _pedir(gestao, URL_CATEGORIAS, {"ids": [30, 10, 20]})
        assert resposta.status_code == 204, resposta.text
        assert ordens_na_bd(motor, "produtos") == antes

    @pytest.mark.parametrize(
        "corpo,campo",
        [
            ({"ids": [30, 30, 10]}, "ids"),
            ({"ids": [10, 10, 10]}, "ids"),
            ({"ids": [0, 10, 20]}, "ids"),
            ({"ids": [-1, 10, 20]}, "ids"),
            ({"ids": ["a", 10, 20]}, "ids"),
            ({"ids": 10}, "ids"),
            ({"ids": None}, "ids"),
            ({}, "ids"),
        ],
    )
    def test_corpo_invalido_e_422_e_nada_muda(
        self,
        gestao: TestClient,
        motor: Engine,
        corpo: dict[str, Any],
        campo: str,
    ) -> None:
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_CATEGORIAS, corpo), 422, "dados_invalidos", campo=campo
        )
        assert fotografia(motor) == antes

    def test_pedido_de_ordem_nao_e_confundido_com_o_id_de_uma_categoria(
        self, gestao: TestClient
    ) -> None:
        """`/categorias/ordem` está declarada antes de `/categorias/{id}`."""
        resposta = _pedir(gestao, URL_CATEGORIAS, {"ids": [10, 20, 30]})
        assert resposta.status_code == 204, resposta.text


class TestOrdemDosProdutos:
    def test_a_ordem_lida_de_volta_e_a_pedida(self, gestao: TestClient) -> None:
        pedida = [ID_PROD_TREMOCOS, ID_PROD_PICA_PAU, ID_PROD_AZEITONAS]
        resposta = _pedir(gestao, URL_PETISCOS, {"ids": pedida})
        assert resposta.status_code == 204, resposta.text
        corpo = ler_ementa_de_gestao(gestao)
        assert ids_dos_produtos(corpo, ID_CAT_PETISCOS) == pedida

    def test_a_coluna_ordem_passa_a_ser_a_posicao(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        _pedir(gestao, URL_PETISCOS, {"ids": [103, 101, 102]})
        assert ordens_na_bd(motor, "produtos", categoria_id=ID_CAT_PETISCOS) == {
            103: 0,
            101: 1,
            102: 2,
        }

    def test_nao_mexe_nos_produtos_das_outras_categorias(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        outros = ordens_na_bd(motor, "produtos", categoria_id=20)
        resposta = _pedir(gestao, URL_PETISCOS, {"ids": [103, 101, 102]})
        assert resposta.status_code == 204, resposta.text
        assert ordens_na_bd(motor, "produtos", categoria_id=20) == outros

    @pytest.mark.parametrize("identificador", [999, MAIOR_ID_DO_SQLITE])
    def test_categoria_inexistente_e_404(
        self, gestao: TestClient, identificador: int
    ) -> None:
        resposta = _pedir(
            gestao,
            f"/gestao/categorias/{identificador}/produtos/ordem",
            {"ids": [101, 102, 103]},
        )
        exigir_erro(resposta, 404, "categoria_inexistente")

    @pytest.mark.parametrize(
        "ids", [[101, 101, 102], [0, 101, 102], [-5, 102, 103], ["x", 1, 2]]
    )
    def test_ids_invalidos_sao_422_e_nada_muda(
        self, gestao: TestClient, motor: Engine, ids: list[Any]
    ) -> None:
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_PETISCOS, {"ids": ids}),
            422,
            "dados_invalidos",
            campo="ids",
        )
        assert fotografia(motor) == antes


class TestListaVazia:
    """`ids: []` segue a regra geral: o conjunto atual tem de ser mesmo vazio."""

    def test_categoria_sem_produtos_aceita_lista_vazia(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = _pedir(
            gestao, f"/gestao/categorias/{ID_CAT_BEBIDAS}/produtos/ordem", {"ids": []}
        )
        assert resposta.status_code == 204, resposta.text
        assert fotografia(motor) == antes

    def test_categoria_com_produtos_recusa_lista_vazia(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_PETISCOS, {"ids": []}), 409, "lista_desatualizada"
        )
        assert fotografia(motor) == antes

    def test_categorias_recusam_lista_vazia_enquanto_houver_categorias(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        exigir_erro(
            _pedir(gestao, URL_CATEGORIAS, {"ids": []}), 409, "lista_desatualizada"
        )
        assert fotografia(motor) == antes

    def test_categoria_inexistente_com_lista_vazia_e_404(
        self, gestao: TestClient
    ) -> None:
        resposta = _pedir(gestao, "/gestao/categorias/999/produtos/ordem", {"ids": []})
        exigir_erro(resposta, 404, "categoria_inexistente")


class TestOMaximoDeIds:
    """300 ids, para o `UPDATE ... CASE` ficar abaixo dos 999 parâmetros.

    O SQLite só aceita mais de 999 variáveis a partir da 3.32, e a versão do
    servidor (CloudLinux) não é conhecida.
    """

    def _semear(self, sessao: Any, quantas: int) -> list[int]:
        from app.models.ementa import Categoria

        sessao.add_all(
            Categoria(id=1000 + n, nome=f"C{n}", slug=f"c{n}", ordem=n)
            for n in range(quantas)
        )
        sessao.commit()
        return [1000 + n for n in range(quantas)]

    def test_com_exatamente_o_maximo_funciona_com_menos_de_999_parametros(
        self, gestao: TestClient, sessao: Any, motor: Engine
    ) -> None:
        from sqlalchemy import event

        novos = self._semear(sessao, 300 - 3)
        pedida = [*reversed(novos), 10, 20, 30]
        assert len(pedida) == 300
        contagens: list[int] = []

        def espia(_lig: Any, _cur: Any, _sql: str, parametros: Any, *_: Any) -> None:
            contagens.append(len(parametros))

        event.listen(motor, "before_cursor_execute", espia)
        try:
            resposta = _pedir(gestao, URL_CATEGORIAS, {"ids": pedida})
        finally:
            event.remove(motor, "before_cursor_execute", espia)
        assert resposta.status_code == 204, resposta.text
        assert ids_das_categorias(ler_ementa_de_gestao(gestao)) == pedida
        assert max(contagens) < 999, max(contagens)

    def test_acima_do_maximo_e_422(self, gestao: TestClient, motor: Engine) -> None:
        antes = fotografia(motor)
        resposta = _pedir(gestao, URL_CATEGORIAS, {"ids": list(range(1, 302))})
        exigir_erro(resposta, 422, "dados_invalidos", campo="ids")
        assert fotografia(motor) == antes
