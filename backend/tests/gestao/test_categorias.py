"""`GET/POST/PATCH/DELETE /gestao/categorias` (F2-05a)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CAMPOS_DA_CATEGORIA,
    CAMPOS_DO_PRODUTO,
    ID_CAT_BEBIDAS,
    ID_CAT_PETISCOS,
    ID_CAT_SOBREMESAS,
    MAIOR_ID_DO_SQLITE,
    ORDEM_DAS_CATEGORIAS,
    ORDEM_DOS_PETISCOS,
    exigir_erro,
    fotografia,
    ids_das_categorias,
    ids_dos_produtos,
    ler_ementa_de_gestao,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine


class TestLer:
    def test_devolve_tudo_incluindo_invisiveis_e_indisponiveis_por_ordem_e_id(
        self, gestao: TestClient
    ) -> None:
        corpo = ler_ementa_de_gestao(gestao)
        assert set(corpo) == {"categorias"}
        assert ids_das_categorias(corpo) == ORDEM_DAS_CATEGORIAS
        assert ids_dos_produtos(corpo, ID_CAT_PETISCOS) == ORDEM_DOS_PETISCOS
        assert ids_dos_produtos(corpo, ID_CAT_SOBREMESAS) == [201]
        assert ids_dos_produtos(corpo, ID_CAT_BEBIDAS) == []

    def test_a_forma_exata_de_categoria_e_produto(self, gestao: TestClient) -> None:
        corpo = ler_ementa_de_gestao(gestao)
        sobremesas, petiscos, _ = corpo["categorias"]
        assert set(petiscos) == CAMPOS_DA_CATEGORIA
        assert petiscos["nome"] == "Petiscos"
        assert petiscos["slug"] == "petiscos"
        assert petiscos["visivel"] is True
        assert sobremesas["visivel"] is False
        for produto in petiscos["produtos"]:
            assert set(produto) == CAMPOS_DO_PRODUTO
            assert produto["categoria_id"] == ID_CAT_PETISCOS
            assert isinstance(produto["preco_cent"], int)
        azeitonas = petiscos["produtos"][0]
        assert azeitonas["descricao"] is None
        assert azeitonas["preco_cent"] == 250
        assert sobremesas["produtos"][0]["disponivel"] is False

    def test_sem_nada_na_ementa_devolve_lista_vazia(
        self, sessao_de_admin: TestClient
    ) -> None:
        assert ler_ementa_de_gestao(sessao_de_admin) == {"categorias": []}


class TestCriar:
    def test_201_com_a_categoria_no_fim_e_sem_produtos(
        self, gestao: TestClient
    ) -> None:
        resposta = gestao.post(
            "/gestao/categorias", json={"nome": "Vinhos"}, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 201, resposta.text
        nova = resposta.json()
        assert set(nova) == CAMPOS_DA_CATEGORIA
        assert nova["nome"] == "Vinhos"
        assert nova["slug"] == "vinhos"
        assert nova["visivel"] is True
        assert nova["produtos"] == []
        corpo = ler_ementa_de_gestao(gestao)
        assert ids_das_categorias(corpo) == [*ORDEM_DAS_CATEGORIAS, nova["id"]]

    def test_visivel_falso_e_aceite(self, gestao: TestClient) -> None:
        resposta = gestao.post(
            "/gestao/categorias",
            json={"nome": "Vinhos", "visivel": False},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["visivel"] is False

    def test_o_slug_tira_acentos_e_sinais(self, gestao: TestClient) -> None:
        resposta = gestao.post(
            "/gestao/categorias",
            json={"nome": "Cafés & Chás"},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["slug"] == "cafes-chas"

    def test_o_nome_apara_os_espacos_das_pontas(self, gestao: TestClient) -> None:
        resposta = gestao.post(
            "/gestao/categorias",
            json={"nome": "  Cafés quentes \t"},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["nome"] == "Cafés quentes"
        assert resposta.json()["slug"] == "cafes-quentes"

    @pytest.mark.parametrize("nome", ["", "   ", " \t "])
    def test_nome_vazio_ou_so_espacos_e_422(
        self, gestao: TestClient, motor: Engine, nome: str
    ) -> None:
        antes = fotografia(motor)
        resposta = gestao.post(
            "/gestao/categorias", json={"nome": nome}, headers=CABECALHO_MUTACAO
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo="nome")
        assert fotografia(motor) == antes

    def test_nome_sem_letras_nem_algarismos_da_slug_vazio_e_422(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = gestao.post(
            "/gestao/categorias", json={"nome": "!!! ???"}, headers=CABECALHO_MUTACAO
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo="nome")
        assert fotografia(motor) == antes

    def test_o_limite_do_nome_e_60(self, gestao: TestClient) -> None:
        ok = gestao.post(
            "/gestao/categorias", json={"nome": "a" * 60}, headers=CABECALHO_MUTACAO
        )
        assert ok.status_code == 201, ok.text
        demais = gestao.post(
            "/gestao/categorias", json={"nome": "b" * 61}, headers=CABECALHO_MUTACAO
        )
        exigir_erro(demais, 422, "dados_invalidos", campo="nome")

    def test_o_limite_conta_depois_de_aparar(self, gestao: TestClient) -> None:
        resposta = gestao.post(
            "/gestao/categorias",
            json={"nome": "  " + "c" * 60 + "  "},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 201, resposta.text

    @pytest.mark.parametrize(
        "corpo,campo",
        [
            ({}, "nome"),
            ({"nome": None}, "nome"),
            ({"nome": 123}, "nome"),
            ({"nome": "Vinhos", "visivel": "talvez"}, "visivel"),
        ],
    )
    def test_corpo_invalido_e_422_com_o_campo(
        self, gestao: TestClient, corpo: dict[str, object], campo: str
    ) -> None:
        resposta = gestao.post(
            "/gestao/categorias", json=corpo, headers=CABECALHO_MUTACAO
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)

    def test_slug_acima_de_60_depois_de_normalizar_e_422(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        """Um nome de 21 caracteres que o NFKD expande para um slug de 63."""
        antes = fotografia(motor)
        nome = "\ufb03" * 21  # a ligadura "ffi" dá "ffi" três vezes
        assert len(nome) <= 60
        resposta = gestao.post(
            "/gestao/categorias", json={"nome": nome}, headers=CABECALHO_MUTACAO
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo="nome")
        assert fotografia(motor) == antes

    def test_slug_de_exatamente_60_e_aceite(self, gestao: TestClient) -> None:
        resposta = gestao.post(
            "/gestao/categorias",
            json={"nome": "\ufb03" * 20},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 201, resposta.text
        assert len(resposta.json()["slug"]) == 60

    @pytest.mark.parametrize(
        "nome", ["petiscos", "PETISCOS", "  Pétiscos  ", "Sobremesas"]
    )
    def test_slug_repetido_e_409_e_nada_se_cria(
        self, gestao: TestClient, motor: Engine, nome: str
    ) -> None:
        """Inclui "Sobremesas": a categoria que colide está invisível."""
        antes = fotografia(motor)
        resposta = gestao.post(
            "/gestao/categorias", json={"nome": nome}, headers=CABECALHO_MUTACAO
        )
        corpo = exigir_erro(resposta, 409, "categoria_repetida")
        assert corpo["mensagem"] == (
            "Já existe uma categoria com este nome ou com um nome muito parecido. "
            "Escolhe outro nome."
        )
        assert fotografia(motor) == antes


class TestAlterar:
    def test_mudar_o_nome_nao_muda_o_slug(self, gestao: TestClient) -> None:
        resposta = gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json={"nome": "Entradas"},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 200, resposta.text
        alterada = resposta.json()
        assert set(alterada) == CAMPOS_DA_CATEGORIA
        assert alterada["nome"] == "Entradas"
        assert alterada["slug"] == "petiscos"
        assert [p["id"] for p in alterada["produtos"]] == ORDEM_DOS_PETISCOS

    def test_nao_muda_a_posicao_na_lista(self, gestao: TestClient) -> None:
        gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json={"nome": "Entradas", "visivel": False},
            headers=CABECALHO_MUTACAO,
        )
        assert ids_das_categorias(ler_ementa_de_gestao(gestao)) == ORDEM_DAS_CATEGORIAS

    def test_esconder_tira_a_categoria_da_ementa_publica(
        self, gestao: TestClient
    ) -> None:
        antes = gestao.get("/ementa").json()
        assert "Petiscos" in [c["nome"] for c in antes["categorias"]]
        resposta = gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json={"visivel": False},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["visivel"] is False
        depois = gestao.get("/ementa").json()
        assert "Petiscos" not in [c["nome"] for c in depois["categorias"]]

    def test_campo_ausente_nao_se_mexe(self, gestao: TestClient) -> None:
        gestao.patch(
            f"/gestao/categorias/{ID_CAT_SOBREMESAS}",
            json={"nome": "Doces"},
            headers=CABECALHO_MUTACAO,
        )
        corpo = ler_ementa_de_gestao(gestao)
        sobremesas = next(c for c in corpo["categorias"] if c["id"] == 20)
        assert sobremesas["nome"] == "Doces"
        assert sobremesas["visivel"] is False

    def test_o_nome_apara_e_tem_limite(self, gestao: TestClient) -> None:
        aparado = gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json={"nome": "  Entradas  "},
            headers=CABECALHO_MUTACAO,
        )
        assert aparado.status_code == 200, aparado.text
        assert aparado.json()["nome"] == "Entradas"
        for nome in ("   ", "x" * 61):
            resposta = gestao.patch(
                f"/gestao/categorias/{ID_CAT_PETISCOS}",
                json={"nome": nome},
                headers=CABECALHO_MUTACAO,
            )
            exigir_erro(resposta, 422, "dados_invalidos", campo="nome")

    @pytest.mark.parametrize(
        "corpo,campo", [({"nome": None}, "nome"), ({"visivel": None}, "visivel")]
    )
    def test_null_nao_e_ausente_e_nao_e_aceite(
        self, gestao: TestClient, corpo: dict[str, None], campo: str
    ) -> None:
        resposta = gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json=corpo,
            headers=CABECALHO_MUTACAO,
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)

    @pytest.mark.parametrize("identificador", [999, MAIOR_ID_DO_SQLITE])
    def test_inexistente_e_404_com_codigo_proprio(
        self, gestao: TestClient, identificador: int
    ) -> None:
        resposta = gestao.patch(
            f"/gestao/categorias/{identificador}",
            json={"nome": "X"},
            headers=CABECALHO_MUTACAO,
        )
        exigir_erro(resposta, 404, "categoria_inexistente")

    def test_corpo_vazio_e_200_e_nao_altera_nada(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json={},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["nome"] == "Petiscos"
        assert fotografia(motor) == antes

    def test_mudar_o_nome_para_o_de_outra_categoria_nunca_da_409(
        self, gestao: TestClient
    ) -> None:
        """O slug fica fixo e o nome não tem unicidade."""
        resposta = gestao.patch(
            f"/gestao/categorias/{ID_CAT_PETISCOS}",
            json={"nome": "Sobremesas"},
            headers=CABECALHO_MUTACAO,
        )
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["slug"] == "petiscos"


class TestEliminar:
    def test_vazia_e_204_sem_corpo_e_desaparece(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        resposta = gestao.delete(
            f"/gestao/categorias/{ID_CAT_BEBIDAS}", headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 204, resposta.text
        assert resposta.content == b""
        assert ID_CAT_BEBIDAS not in ids_das_categorias(ler_ementa_de_gestao(gestao))
        assert [linha[0] for linha in fotografia(motor)["categorias"]] == [10, 20]

    @pytest.mark.parametrize("categoria", [ID_CAT_PETISCOS, ID_CAT_SOBREMESAS])
    def test_com_produtos_e_409_e_nada_se_apaga(
        self, gestao: TestClient, motor: Engine, categoria: int
    ) -> None:
        """A 20 está invisível e a sua tarte indisponível: contam na mesma."""
        antes = fotografia(motor)
        resposta = gestao.delete(
            f"/gestao/categorias/{categoria}", headers=CABECALHO_MUTACAO
        )
        exigir_erro(resposta, 409, "categoria_com_produtos")
        assert fotografia(motor) == antes

    def test_inexistente_e_404(self, gestao: TestClient) -> None:
        resposta = gestao.delete("/gestao/categorias/999", headers=CABECALHO_MUTACAO)
        exigir_erro(resposta, 404, "categoria_inexistente")

    def test_eliminar_duas_vezes_da_404_na_segunda(self, gestao: TestClient) -> None:
        url = f"/gestao/categorias/{ID_CAT_BEBIDAS}"
        assert gestao.delete(url, headers=CABECALHO_MUTACAO).status_code == 204
        exigir_erro(
            gestao.delete(url, headers=CABECALHO_MUTACAO), 404, "categoria_inexistente"
        )

    def test_depois_de_eliminar_os_produtos_ja_pode_ser_eliminada(
        self, gestao: TestClient
    ) -> None:
        for produto in (101, 102, 103):
            resposta = gestao.delete(
                f"/gestao/produtos/{produto}", headers=CABECALHO_MUTACAO
            )
            assert resposta.status_code == 204, resposta.text
        resposta = gestao.delete(
            f"/gestao/categorias/{ID_CAT_PETISCOS}", headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 204, resposta.text


class TestSemReturning:
    """`RETURNING` só existe a partir do SQLite 3.35; a do servidor não é conhecida."""

    def test_criar_categoria_e_produto_nao_emitem_returning(
        self, gestao: TestClient, contador_de_sql: Any
    ) -> None:
        with contador_de_sql.a_contar() as instrucoes:
            categoria = gestao.post(
                "/gestao/categorias", json={"nome": "Vinhos"}, headers=CABECALHO_MUTACAO
            )
            produto = gestao.post(
                "/gestao/produtos",
                json={"categoria_id": 10, "nome": "Moelas", "preco_cent": 600},
                headers=CABECALHO_MUTACAO,
            )
        assert categoria.status_code == 201, categoria.text
        assert produto.status_code == 201, produto.text
        inserts = [i for i in instrucoes if i.lstrip().upper().startswith("INSERT")]
        assert len(inserts) == 2, instrucoes
        assert not [i for i in instrucoes if "RETURNING" in i.upper()], instrucoes
