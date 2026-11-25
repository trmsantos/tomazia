"""O OpenAPI promete o que a app devolve (F2-05a).

Herança da F2-04: o OpenAPI documentava `422 -> HTTPValidationError`, mas a
app devolve `{erro, mensagem}`. Quem gera tipos a partir do esquema lia
`detail` e encontrava `undefined`.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

REF_ERRO = "#/components/schemas/RespostaDeErro"
METODOS_HTTP = ("get", "post", "put", "patch", "delete")


def _esquema() -> dict[str, Any]:
    from app.main import criar_app

    esquema: dict[str, Any] = criar_app().openapi()
    return esquema


def _operacoes() -> list[tuple[str, str, dict[str, Any]]]:
    return [
        (metodo, caminho, operacao)
        for caminho, item in _esquema()["paths"].items()
        for metodo, operacao in item.items()
        if metodo in METODOS_HTTP
    ]


def _ref_do_corpo(resposta: dict[str, Any]) -> str | None:
    conteudo = resposta.get("content", {}).get("application/json", {})
    ref = conteudo.get("schema", {}).get("$ref")
    return ref if isinstance(ref, str) else None


def test_o_openapi_nao_menciona_as_classes_de_erro_por_omissao() -> None:
    texto = json.dumps(_esquema())
    assert "HTTPValidationError" not in texto
    assert "ValidationError" not in texto.replace("RespostaDeErro", "")


def test_resposta_de_erro_tem_erro_mensagem_e_campo_opcional() -> None:
    modelo = _esquema()["components"]["schemas"]["RespostaDeErro"]
    assert {"erro", "mensagem", "campo"} <= set(modelo["properties"])
    assert set(modelo["required"]) == {"erro", "mensagem"}


def test_o_modelo_python_chama_se_resposta_de_erro() -> None:
    from app.schemas.erros import RespostaDeErro

    corpo = RespostaDeErro(erro="x", mensagem="y")
    assert corpo.campo is None


def test_todos_os_422_da_app_inteira_usam_o_envelope() -> None:
    com_422 = [
        (metodo, caminho)
        for metodo, caminho, operacao in _operacoes()
        if "422" in operacao["responses"]
    ]
    assert com_422, "nenhuma operação documenta 422; o teste não provava nada"
    for metodo, caminho, operacao in _operacoes():
        if "422" in operacao["responses"]:
            assert _ref_do_corpo(operacao["responses"]["422"]) == REF_ERRO, (
                f"{metodo.upper()} {caminho}: o 422 não aponta para RespostaDeErro"
            )


def test_toda_a_resposta_4xx_documentada_usa_o_envelope() -> None:
    for metodo, caminho, operacao in _operacoes():
        for codigo, resposta in operacao["responses"].items():
            if codigo.startswith("4"):
                assert _ref_do_corpo(resposta) == REF_ERRO, (
                    f"{metodo.upper()} {caminho} {codigo}: sem RespostaDeErro"
                )


def test_toda_a_operacao_de_gestao_documenta_o_401() -> None:
    de_gestao = [
        (metodo, caminho, operacao)
        for metodo, caminho, operacao in _operacoes()
        if caminho.startswith("/gestao")
    ]
    assert len(de_gestao) >= 21, (
        "as 4 de fotos, as 9 da F2-05a, as 6 da F2-05b e as 2 da F4-04b"
    )
    for metodo, caminho, operacao in de_gestao:
        respostas = operacao["responses"]
        assert "401" in respostas, f"{metodo.upper()} {caminho} não documenta 401"
        assert _ref_do_corpo(respostas["401"]) == REF_ERRO


#: Os códigos que cada rota nova documenta, além do 401.
CODIGOS_DOCUMENTADOS: dict[tuple[str, str], set[str]] = {
    ("get", "/gestao/categorias"): {"200"},
    ("post", "/gestao/categorias"): {"201", "409", "422"},
    ("patch", "/gestao/categorias/{id}"): {"200", "404", "422"},
    ("delete", "/gestao/categorias/{id}"): {"204", "404", "409", "422"},
    ("put", "/gestao/categorias/ordem"): {"204", "409", "422"},
    ("post", "/gestao/produtos"): {"201", "422"},
    ("patch", "/gestao/produtos/{id}"): {"200", "404", "422"},
    ("delete", "/gestao/produtos/{id}"): {"204", "404", "422"},
    ("put", "/gestao/categorias/{id}/produtos/ordem"): {"204", "404", "409", "422"},
    # F2-05b
    ("get", "/gestao/eventos"): {"200"},
    ("post", "/gestao/eventos"): {"201", "422"},
    ("patch", "/gestao/eventos/{id}"): {"200", "404", "422"},
    ("delete", "/gestao/eventos/{id}"): {"204", "404", "422"},
    ("post", "/gestao/eventos/{id}/duplicar"): {"201", "404", "422"},
    ("get", "/gestao/resumo"): {"200"},
    # F4-04b
    ("get", "/gestao/fotos/aprovadas"): {"200"},
    ("delete", "/gestao/fotos/{id}"): {"204", "401", "404", "409", "422", "500"},
}


@pytest.mark.parametrize(
    "metodo,caminho", sorted(CODIGOS_DOCUMENTADOS), ids=lambda v: str(v)
)
def test_cada_rota_nova_documenta_os_seus_codigos(metodo: str, caminho: str) -> None:
    respostas = _esquema()["paths"][caminho][metodo]["responses"]
    assert CODIGOS_DOCUMENTADOS[(metodo, caminho)] <= set(respostas)


NOMES_DOS_ESQUEMAS = {
    "CategoriaGestao",
    "ProdutoGestao",
    "RespostaEmentaGestao",
    "PedidoCriarCategoria",
    "PedidoAlterarCategoria",
    "PedidoCriarProduto",
    "PedidoAlterarProduto",
    "PedidoOrdem",
    # F2-05b
    "EventoGestao",
    "RespostaEventosGestao",
    "PedidoCriarEvento",
    "PedidoAlterarEvento",
    "RespostaResumo",
}
PEDIDOS = sorted(n for n in NOMES_DOS_ESQUEMAS if n.startswith("Pedido"))


def test_os_esquemas_novos_existem_com_estes_nomes() -> None:
    assert set(_esquema()["components"]["schemas"]) >= NOMES_DOS_ESQUEMAS


@pytest.mark.parametrize("nome", PEDIDOS)
def test_os_pedidos_recusam_campos_a_mais(nome: str) -> None:
    assert (
        _esquema()["components"]["schemas"][nome].get("additionalProperties") is False
    )


def test_os_campos_dos_esquemas_novos() -> None:
    esquemas = _esquema()["components"]["schemas"]
    assert set(esquemas["CategoriaGestao"]["properties"]) == {
        "id",
        "nome",
        "slug",
        "visivel",
        "produtos",
    }
    assert set(esquemas["ProdutoGestao"]["properties"]) == {
        "id",
        "categoria_id",
        "nome",
        "descricao",
        "preco_cent",
        "disponivel",
    }
    assert set(esquemas["PedidoCriarProduto"]["properties"]) == {
        "categoria_id",
        "nome",
        "descricao",
        "preco_cent",
        "disponivel",
    }
    assert set(esquemas["PedidoAlterarCategoria"]["properties"]) == {"nome", "visivel"}
    assert set(esquemas["PedidoOrdem"]["properties"]) == {"ids"}
    assert set(esquemas["PedidoCriarCategoria"]["properties"]) == {"nome", "visivel"}


def _admite_null(propriedade: dict[str, Any]) -> bool:
    return (
        any(
            isinstance(opcao, dict) and opcao.get("type") == "null"
            for opcao in propriedade.get("anyOf", [])
        )
        or propriedade.get("type") == "null"
    )


@pytest.mark.parametrize(
    "nome", ["PedidoAlterarCategoria", "PedidoAlterarProduto", "PedidoAlterarEvento"]
)
def test_nos_patch_so_a_descricao_admite_null(nome: str) -> None:
    """A API responde 422 a `null` nos outros campos: o esquema não o promete."""
    propriedades = _esquema()["components"]["schemas"][nome]["properties"]
    com_null = {campo for campo, p in propriedades.items() if _admite_null(p)}
    assert com_null <= {"descricao"}, com_null
    if nome in ("PedidoAlterarProduto", "PedidoAlterarEvento"):
        assert com_null == {"descricao"}


def test_o_422_mantem_a_descricao_propria_da_rota() -> None:
    caminhos = _esquema()["paths"]
    produtos = caminhos["/gestao/produtos"]["post"]["responses"]["422"]
    assert "categoria_inexistente" in produtos["description"]
    assert _ref_do_corpo(produtos) == REF_ERRO
    login = caminhos["/auth/login"]["post"]["responses"]["422"]
    assert "utilizador" in login["description"]
    assert _ref_do_corpo(login) == REF_ERRO


def test_os_campos_dos_esquemas_de_eventos_e_resumo() -> None:
    esquemas = _esquema()["components"]["schemas"]
    assert set(esquemas["EventoGestao"]["properties"]) == {
        "id",
        "titulo",
        "inicio",
        "descricao",
        "imagem",
        "publicado",
    }
    assert set(esquemas["RespostaEventosGestao"]["properties"]) == {
        "proximos",
        "rascunhos",
        "arquivo",
    }
    assert set(esquemas["PedidoCriarEvento"]["properties"]) == {
        "titulo",
        "inicio",
        "descricao",
        "publicado",
    }
    assert set(esquemas["PedidoAlterarEvento"]["properties"]) == {
        "titulo",
        "inicio",
        "descricao",
        "publicado",
    }
    assert set(esquemas["RespostaResumo"]["properties"]) == {
        "fotos_pendentes",
        "proximos_eventos",
        "novos_registos",
    }


def test_a_data_e_obrigatoria_ao_criar_e_nao_anulavel_ao_alterar() -> None:
    """ADR 0009: criar sem data é 422; o PATCH não apaga uma data."""
    esquemas = _esquema()["components"]["schemas"]
    assert "inicio" in esquemas["PedidoCriarEvento"]["required"]
    assert "titulo" in esquemas["PedidoCriarEvento"]["required"]
    assert not _admite_null(esquemas["PedidoCriarEvento"]["properties"]["inicio"])
    assert not _admite_null(esquemas["PedidoAlterarEvento"]["properties"]["inicio"])
    assert esquemas["PedidoAlterarEvento"].get("required", []) == []


def test_a_janela_dos_novos_registos_esta_documentada() -> None:
    """Decisão do Tomás: sete dias deslizantes a partir de agora, escritos no esquema."""
    propriedade = _esquema()["components"]["schemas"]["RespostaResumo"]["properties"][
        "novos_registos"
    ]
    descricao = propriedade.get("description", "")
    assert "7" in descricao or "sete" in descricao.lower(), descricao


def test_o_evento_de_gestao_admite_data_nula() -> None:
    """Um rascunho importado pode não ter data."""
    inicio = _esquema()["components"]["schemas"]["EventoGestao"]["properties"]["inicio"]
    assert _admite_null(inicio)
