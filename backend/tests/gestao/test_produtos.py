"""`POST/PATCH/DELETE /gestao/produtos` (F2-05a)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CAMPOS_DO_PRODUTO,
    ID_CAT_BEBIDAS,
    ID_CAT_PETISCOS,
    ID_CAT_SOBREMESAS,
    ID_PROD_AZEITONAS,
    ID_PROD_PICA_PAU,
    ID_PROD_TREMOCOS,
    MAIOR_ID_DO_SQLITE,
    ORDEM_DOS_PETISCOS,
    exigir_erro,
    fotografia,
    ids_dos_produtos,
    ler_ementa_de_gestao,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

MAIOR_PRECO = 2**31 - 1


def _criar(cliente: TestClient, **campos: Any) -> Any:
    corpo = {"categoria_id": ID_CAT_PETISCOS, "nome": "Moelas", "preco_cent": 600}
    corpo.update(campos)
    return cliente.post("/gestao/produtos", json=corpo, headers=CABECALHO_MUTACAO)


def _alterar(cliente: TestClient, identificador: int, corpo: dict[str, Any]) -> Any:
    return cliente.patch(
        f"/gestao/produtos/{identificador}", json=corpo, headers=CABECALHO_MUTACAO
    )


def _alterar_ok(cliente: TestClient, identificador: int, corpo: dict[str, Any]) -> Any:
    """`PATCH` que tem de dar 200; devolve o corpo."""
    resposta = _alterar(cliente, identificador, corpo)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


def _produto(cliente: TestClient, identificador: int) -> dict[str, Any]:
    for categoria in ler_ementa_de_gestao(cliente)["categorias"]:
        for produto in categoria["produtos"]:
            if produto["id"] == identificador:
                found: dict[str, Any] = produto
                return found
    raise AssertionError(f"o produto {identificador} não existe")


class TestCriar:
    def test_201_no_fim_da_categoria_com_omissoes(self, gestao: TestClient) -> None:
        resposta = _criar(gestao)
        assert resposta.status_code == 201, resposta.text
        novo = resposta.json()
        assert set(novo) == CAMPOS_DO_PRODUTO
        assert novo["categoria_id"] == ID_CAT_PETISCOS
        assert novo["nome"] == "Moelas"
        assert novo["descricao"] is None
        assert novo["preco_cent"] == 600
        assert novo["disponivel"] is True
        corpo = ler_ementa_de_gestao(gestao)
        assert ids_dos_produtos(corpo, ID_CAT_PETISCOS) == [
            *ORDEM_DOS_PETISCOS,
            novo["id"],
        ]

    def test_aparece_na_ementa_publica(self, gestao: TestClient) -> None:
        _criar(gestao, nome="Moelas picantes")
        nomes = [
            p["nome"]
            for c in gestao.get("/ementa").json()["categorias"]
            for p in c["produtos"]
        ]
        assert "Moelas picantes" in nomes

    def test_categoria_vazia_e_invisivel_aceitam_produtos(
        self, gestao: TestClient
    ) -> None:
        for categoria in (ID_CAT_BEBIDAS, ID_CAT_SOBREMESAS):
            resposta = _criar(gestao, categoria_id=categoria)
            assert resposta.status_code == 201, resposta.text

    def test_descricao_disponivel_e_preco_zero(self, gestao: TestClient) -> None:
        resposta = _criar(gestao, descricao="Da casa", disponivel=False, preco_cent=0)
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["descricao"] == "Da casa"
        assert resposta.json()["disponivel"] is False
        assert resposta.json()["preco_cent"] == 0

    def test_nome_apara_e_descricao_vazia_vira_null(self, gestao: TestClient) -> None:
        resposta = _criar(gestao, nome="  Moelas \t", descricao="")
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["nome"] == "Moelas"
        assert resposta.json()["descricao"] is None

    @pytest.mark.parametrize("nome", ["", "   "])
    def test_nome_vazio_e_422(self, gestao: TestClient, nome: str) -> None:
        exigir_erro(_criar(gestao, nome=nome), 422, "dados_invalidos", campo="nome")

    def test_limites_de_texto(self, gestao: TestClient) -> None:
        assert _criar(gestao, nome="n" * 120, descricao="d" * 280).status_code == 201
        exigir_erro(
            _criar(gestao, nome="n" * 121), 422, "dados_invalidos", campo="nome"
        )
        exigir_erro(
            _criar(gestao, descricao="d" * 281),
            422,
            "dados_invalidos",
            campo="descricao",
        )

    def test_limites_do_preco(self, gestao: TestClient) -> None:
        assert _criar(gestao, preco_cent=MAIOR_PRECO).status_code == 201
        for invalido in (-1, MAIOR_PRECO + 1, 12.5, "abc", None):
            exigir_erro(
                _criar(gestao, preco_cent=invalido),
                422,
                "dados_invalidos",
                campo="preco_cent",
            )

    def test_categoria_inexistente_e_422_com_campo_e_nada_se_cria(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        for identificador in (999, MAIOR_ID_DO_SQLITE):
            exigir_erro(
                _criar(gestao, categoria_id=identificador),
                422,
                "categoria_inexistente",
                campo="categoria_id",
            )
        assert fotografia(motor) == antes

    def test_sem_categoria_id_e_422(self, gestao: TestClient) -> None:
        resposta = gestao.post(
            "/gestao/produtos",
            json={"nome": "Moelas", "preco_cent": 1},
            headers=CABECALHO_MUTACAO,
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo="categoria_id")


class TestAlterar:
    def test_preco_absoluto_e_resposta_completa(self, gestao: TestClient) -> None:
        resposta = _alterar(gestao, ID_PROD_TREMOCOS, {"preco_cent": 175})
        assert resposta.status_code == 200, resposta.text
        produto = resposta.json()
        assert set(produto) == CAMPOS_DO_PRODUTO
        assert produto["preco_cent"] == 175
        assert produto["nome"] == "Tremoços"
        assert produto["descricao"] == "Com sal"
        assert produto["disponivel"] is True
        assert _produto(gestao, ID_PROD_TREMOCOS)["preco_cent"] == 175

    def test_disponivel_e_valor_absoluto_nunca_alterna(
        self, gestao: TestClient
    ) -> None:
        for _ in range(2):
            resposta = _alterar(gestao, ID_PROD_TREMOCOS, {"disponivel": False})
            assert resposta.json()["disponivel"] is False
        assert (
            _alterar_ok(gestao, ID_PROD_TREMOCOS, {"disponivel": True})["disponivel"]
            is True
        )

    def test_desfazer_e_outro_patch_com_o_valor_anterior(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        _alterar(gestao, ID_PROD_TREMOCOS, {"preco_cent": 999, "disponivel": False})
        assert fotografia(motor) != antes
        _alterar(gestao, ID_PROD_TREMOCOS, {"preco_cent": 150, "disponivel": True})
        assert fotografia(motor) == antes

    def test_ausente_nao_e_null_para_a_descricao(self, gestao: TestClient) -> None:
        _alterar(gestao, ID_PROD_TREMOCOS, {"preco_cent": 160})
        assert _produto(gestao, ID_PROD_TREMOCOS)["descricao"] == "Com sal"
        resposta = _alterar(gestao, ID_PROD_TREMOCOS, {"descricao": None})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["descricao"] is None
        assert _produto(gestao, ID_PROD_TREMOCOS)["descricao"] is None

    def test_descricao_vazia_vira_null(self, gestao: TestClient) -> None:
        resposta = _alterar(gestao, ID_PROD_TREMOCOS, {"descricao": ""})
        assert resposta.json()["descricao"] is None

    def test_nome_apara_e_limites(self, gestao: TestClient) -> None:
        assert (
            _alterar_ok(gestao, ID_PROD_TREMOCOS, {"nome": " Novo "})["nome"] == "Novo"
        )
        for corpo, campo in (
            ({"nome": "   "}, "nome"),
            ({"nome": "n" * 121}, "nome"),
            ({"descricao": "d" * 281}, "descricao"),
            ({"preco_cent": -1}, "preco_cent"),
            ({"preco_cent": MAIOR_PRECO + 1}, "preco_cent"),
        ):
            exigir_erro(
                _alterar(gestao, ID_PROD_TREMOCOS, corpo),
                422,
                "dados_invalidos",
                campo=campo,
            )

    @pytest.mark.parametrize(
        "campo", ["nome", "preco_cent", "disponivel", "categoria_id"]
    )
    def test_null_so_vale_para_a_descricao(
        self, gestao: TestClient, campo: str
    ) -> None:
        exigir_erro(
            _alterar(gestao, ID_PROD_TREMOCOS, {campo: None}),
            422,
            "dados_invalidos",
            campo=campo,
        )

    def test_mudar_de_categoria_poe_no_fim_da_nova_e_nao_mexe_na_velha(
        self, gestao: TestClient
    ) -> None:
        _criar(gestao, categoria_id=ID_CAT_BEBIDAS, nome="Imperial")
        resposta = _alterar(gestao, ID_PROD_AZEITONAS, {"categoria_id": ID_CAT_BEBIDAS})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["categoria_id"] == ID_CAT_BEBIDAS
        corpo = ler_ementa_de_gestao(gestao)
        assert ids_dos_produtos(corpo, ID_CAT_PETISCOS) == [
            ID_PROD_PICA_PAU,
            ID_PROD_TREMOCOS,
        ]
        bebidas = ids_dos_produtos(corpo, ID_CAT_BEBIDAS)
        assert bebidas[-1] == ID_PROD_AZEITONAS
        assert len(bebidas) == 2

    def test_a_mesma_categoria_nao_muda_a_posicao(self, gestao: TestClient) -> None:
        _alterar(gestao, ID_PROD_PICA_PAU, {"categoria_id": ID_CAT_PETISCOS})
        corpo = ler_ementa_de_gestao(gestao)
        assert ids_dos_produtos(corpo, ID_CAT_PETISCOS) == ORDEM_DOS_PETISCOS

    def test_categoria_inexistente_e_422_com_campo(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        exigir_erro(
            _alterar(gestao, ID_PROD_TREMOCOS, {"categoria_id": 999}),
            422,
            "categoria_inexistente",
            campo="categoria_id",
        )
        assert fotografia(motor) == antes

    def test_corpo_vazio_e_200_e_nao_altera_nada(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        produto = _alterar_ok(gestao, ID_PROD_TREMOCOS, {})
        assert set(produto) == CAMPOS_DO_PRODUTO
        assert produto["nome"] == "Tremoços"
        assert fotografia(motor) == antes

    @pytest.mark.parametrize("identificador", [999, MAIOR_ID_DO_SQLITE])
    def test_inexistente_e_404_com_codigo_proprio(
        self, gestao: TestClient, identificador: int
    ) -> None:
        exigir_erro(
            _alterar(gestao, identificador, {"preco_cent": 1}),
            404,
            "produto_inexistente",
        )


class TestEliminar:
    def test_204_sem_corpo_e_so_aquele_desaparece(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        resposta = gestao.delete(
            f"/gestao/produtos/{ID_PROD_PICA_PAU}", headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 204, resposta.text
        assert resposta.content == b""
        corpo = ler_ementa_de_gestao(gestao)
        assert ids_dos_produtos(corpo, ID_CAT_PETISCOS) == [
            ID_PROD_AZEITONAS,
            ID_PROD_TREMOCOS,
        ]
        assert len(fotografia(motor)["categorias"]) == 3

    def test_inexistente_e_404_e_duas_vezes_tambem(self, gestao: TestClient) -> None:
        url = f"/gestao/produtos/{ID_PROD_PICA_PAU}"
        assert gestao.delete(url, headers=CABECALHO_MUTACAO).status_code == 204
        exigir_erro(
            gestao.delete(url, headers=CABECALHO_MUTACAO), 404, "produto_inexistente"
        )


def test_mensagens_de_inexistente_pedem_para_recarregar(gestao: TestClient) -> None:
    produto = exigir_erro(
        _alterar(gestao, 999, {"preco_cent": 1}), 404, "produto_inexistente"
    )
    assert produto["mensagem"] == (
        "Este produto já não existe. Recarrega a página e tenta novamente."
    )
    categoria = exigir_erro(
        gestao.delete("/gestao/categorias/999", headers=CABECALHO_MUTACAO),
        404,
        "categoria_inexistente",
    )
    assert categoria["mensagem"] == (
        "Esta categoria já não existe. Recarrega a página e tenta novamente."
    )
