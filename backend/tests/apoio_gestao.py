"""Apoio dos testes da gestão da ementa (F2-05a).

Não é um ficheiro de testes (não começa por `test_`). É importado por
`tests/gestao/conftest.py` e por `tests/seguranca/conftest.py`, pela mesma
razão que `tests/apoio_http.py` e `tests/apoio_auth.py` o são: uma só
definição das fixtures e do cenário, para a pasta funcional e a de segurança
nunca divergirem.

## O cenário (`semear_ementa`)

Armadilhado de propósito, para que um teste de ordem não passe por
coincidência:

| Categoria | nome | slug | ordem | visível | produtos (por ordem de leitura) |
| --- | --- | --- | --- | --- | --- |
| 10 | Petiscos | petiscos | 1 | sim | 102 (ordem 0), 103 (ordem 1), 101 (ordem 2) |
| 20 | Sobremesas | sobremesas | 0 | **não** | 201 (indisponível) |
| 30 | Bebidas | bebidas | 1 | sim | nenhum |

- a ordem de leitura das categorias é **20, 10, 30**: nenhuma coincide com a
  ordem dos ids, e 10 e 30 empatam em `ordem` (desempata o `id`);
- há uma categoria invisível e um produto indisponível, porque a gestão
  mostra **tudo**, ao contrário da ementa pública;
- a categoria 30 está vazia (é a única que se pode eliminar sem 409).

## Dois pontos de extensão que estes testes pressupõem

1. Os módulos novos têm estes nomes: `app/schemas/erros.py` (`RespostaDeErro`),
   `app/schemas/gestao.py`, `app/slug.py` (`normalizar_slug`).
2. A forma do erro de um recurso inexistente é o `ErroDaApi` com os códigos
   `categoria_inexistente` e `produto_inexistente` (nunca `HTTPException`).
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import text

if TYPE_CHECKING:  # pragma: no cover - só para anotações
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

    from app.models.admins import Admin

CABECALHO_MUTACAO: dict[str, str] = {"X-Tomazia": "1"}

#: O maior inteiro que o SQLite guarda. Acima disto o driver levanta
#: `OverflowError`, que sem limite na fronteira dava 500.
MAIOR_ID_DO_SQLITE = 2**63 - 1

ID_CAT_PETISCOS = 10
ID_CAT_SOBREMESAS = 20  # invisível
ID_CAT_BEBIDAS = 30  # vazia

ID_PROD_TREMOCOS = 101
ID_PROD_AZEITONAS = 102
ID_PROD_PICA_PAU = 103
ID_PROD_TARTE = 201  # indisponível, na categoria invisível

#: A ordem em que a gestão lê o cenário.
ORDEM_DAS_CATEGORIAS = [ID_CAT_SOBREMESAS, ID_CAT_PETISCOS, ID_CAT_BEBIDAS]
ORDEM_DOS_PETISCOS = [ID_PROD_AZEITONAS, ID_PROD_PICA_PAU, ID_PROD_TREMOCOS]

CAMPOS_DA_CATEGORIA = {"id", "nome", "slug", "visivel", "produtos"}
CAMPOS_DO_PRODUTO = {
    "id",
    "categoria_id",
    "nome",
    "descricao",
    "preco_cent",
    "disponivel",
}

#: Corpos válidos de cada mutação com corpo, por (método, caminho com `{id}`).
#: Usados pelos testes de segurança, que precisam de um pedido **bem formado**
#: para provar que é a sessão, o limite ou o campo a mais — e não um 422
#: qualquer — que decide o resultado.
CORPOS_VALIDOS: dict[tuple[str, str], dict[str, Any]] = {
    ("POST", "/gestao/categorias"): {"nome": "Vinhos"},
    ("PATCH", "/gestao/categorias/{id}"): {"nome": "Novo nome"},
    ("PUT", "/gestao/categorias/ordem"): {
        "ids": [ID_CAT_BEBIDAS, ID_CAT_PETISCOS, ID_CAT_SOBREMESAS]
    },
    ("POST", "/gestao/produtos"): {
        "categoria_id": ID_CAT_PETISCOS,
        "nome": "Moelas",
        "preco_cent": 600,
    },
    ("PATCH", "/gestao/produtos/{id}"): {"preco_cent": 999},
    ("PUT", "/gestao/categorias/{id}/produtos/ordem"): {
        "ids": [ID_PROD_PICA_PAU, ID_PROD_AZEITONAS, ID_PROD_TREMOCOS]
    },
}

#: Mutações que não levam corpo. Uma mutação de `/gestao` que não esteja nem
#: aqui nem em `CORPOS_VALIDOS` faz `corpo_valido` rebentar: rota nova obriga
#: a decidir, em vez de ser saltada em silêncio (regra 10).
MUTACOES_SEM_CORPO: frozenset[tuple[str, str]] = frozenset(
    {
        ("DELETE", "/gestao/categorias/{id}"),
        ("DELETE", "/gestao/produtos/{id}"),
        ("POST", "/gestao/fotos/{id}/aprovar"),
        ("POST", "/gestao/fotos/{id}/rejeitar"),
    }
)

#: Um id que existe no cenário e que a mutação consegue alterar. `DELETE` de
#: categoria usa a vazia: se vazasse, a contagem mudava.
_ID_CONCRETO: dict[tuple[str, str], int] = {
    ("DELETE", "/gestao/categorias/{id}"): ID_CAT_BEBIDAS,
    ("DELETE", "/gestao/produtos/{id}"): ID_PROD_TREMOCOS,
}


def corpo_valido(metodo: str, caminho: str) -> dict[str, Any] | None:
    """O corpo válido de `(metodo, caminho)`, `None` se a rota não leva corpo."""
    chave = (metodo.upper(), caminho)
    if chave in CORPOS_VALIDOS:
        return CORPOS_VALIDOS[chave]
    if chave in MUTACOES_SEM_CORPO or chave[0] in ("GET", "HEAD"):
        return None
    raise AssertionError(
        f"{metodo} {caminho} não está em `CORPOS_VALIDOS` nem em "
        "`MUTACOES_SEM_CORPO` de `tests/apoio_gestao.py`. Uma rota de gestão "
        "nova tem de ser classificada ali: saltá-la daria o mesmo resultado a "
        "'esta rota não precisa de teste' e 'ninguém reparou nela'."
    )


def caminho_concreto(metodo: str, caminho: str) -> str:
    """O caminho com um id que existe no cenário (ou `1`, nas fotos)."""
    chave = (metodo.upper(), caminho)
    if chave in _ID_CONCRETO:
        return caminho.replace("{id}", str(_ID_CONCRETO[chave]))
    if caminho.startswith("/gestao/produtos"):
        identificador = ID_PROD_TREMOCOS
    elif caminho.startswith("/gestao/categorias"):
        identificador = ID_CAT_PETISCOS
    else:
        identificador = 1
    return re.sub(r"\{[^}]+\}", str(identificador), caminho)


def semear_ementa(sessao: Session) -> None:
    """Semeia o cenário da tabela do docstring do módulo."""
    from app.models.ementa import Categoria, Produto

    sessao.add_all(
        [
            Categoria(
                id=ID_CAT_PETISCOS,
                nome="Petiscos",
                slug="petiscos",
                ordem=1,
                visivel=True,
            ),
            Categoria(
                id=ID_CAT_SOBREMESAS,
                nome="Sobremesas",
                slug="sobremesas",
                ordem=0,
                visivel=False,
            ),
            Categoria(
                id=ID_CAT_BEBIDAS,
                nome="Bebidas",
                slug="bebidas",
                ordem=1,
                visivel=True,
            ),
        ]
    )
    sessao.flush()
    sessao.add_all(
        [
            Produto(
                id=ID_PROD_TREMOCOS,
                categoria_id=ID_CAT_PETISCOS,
                nome="Tremoços",
                descricao="Com sal",
                preco_cent=150,
                disponivel=True,
                ordem=2,
            ),
            Produto(
                id=ID_PROD_AZEITONAS,
                categoria_id=ID_CAT_PETISCOS,
                nome="Azeitonas",
                descricao=None,
                preco_cent=250,
                disponivel=True,
                ordem=0,
            ),
            Produto(
                id=ID_PROD_PICA_PAU,
                categoria_id=ID_CAT_PETISCOS,
                nome="Pica-pau",
                descricao="De porco",
                preco_cent=900,
                disponivel=True,
                ordem=1,
            ),
            Produto(
                id=ID_PROD_TARTE,
                categoria_id=ID_CAT_SOBREMESAS,
                nome="Tarte da casa",
                descricao=None,
                preco_cent=350,
                disponivel=False,
                ordem=0,
            ),
        ]
    )
    sessao.commit()


def fotografia(motor: Engine) -> dict[str, list[tuple[Any, ...]]]:
    """Todas as linhas de `categorias` e `produtos`, lidas por uma ligação nova.

    Ligação nova de propósito: a `sessao` de semear fica com uma transação de
    leitura aberta e, em WAL, não veria o que a app escreveu depois.
    """
    instantaneo: dict[str, list[tuple[Any, ...]]] = {}
    with motor.connect() as ligacao:
        for tabela in ("categorias", "produtos"):
            linhas = ligacao.execute(text(f"SELECT * FROM {tabela} ORDER BY id")).all()
            instantaneo[tabela] = [tuple(linha) for linha in linhas]
    return instantaneo


def ids_das_categorias(corpo: dict[str, Any]) -> list[int]:
    return [categoria["id"] for categoria in corpo["categorias"]]


def ids_dos_produtos(corpo: dict[str, Any], categoria_id: int) -> list[int]:
    for categoria in corpo["categorias"]:
        if categoria["id"] == categoria_id:
            return [produto["id"] for produto in categoria["produtos"]]
    raise AssertionError(f"a categoria {categoria_id} não está na resposta")


def ler_ementa_de_gestao(cliente: TestClient) -> dict[str, Any]:
    resposta = cliente.get("/gestao/categorias")
    assert resposta.status_code == 200, resposta.text
    corpo: dict[str, Any] = resposta.json()
    return corpo


def ordens_na_bd(motor: Engine, tabela: str, **filtro: int) -> dict[int, int]:
    """`{id: ordem}` lido da própria coluna, com um filtro opcional."""
    assert tabela in ("categorias", "produtos")
    condicao = " AND ".join(f"{coluna} = :{coluna}" for coluna in filtro) or "1 = 1"
    with motor.connect() as ligacao:
        linhas = ligacao.execute(
            text(f"SELECT id, ordem FROM {tabela} WHERE {condicao}"),  # noqa: S608
            filtro,
        ).all()
    return {linha[0]: linha[1] for linha in linhas}


def exigir_erro(
    resposta: Any, estado: int, codigo: str, *, campo: str | None = None
) -> dict[str, Any]:
    """Afirma o envelope `{erro, mensagem[, campo]}` e devolve o corpo."""
    assert resposta.status_code == estado, (
        f"esperava {estado}, veio {resposta.status_code}: {resposta.text}"
    )
    corpo: dict[str, Any] = resposta.json()
    assert "detail" not in corpo, f"saiu o `detail` por omissão do FastAPI: {corpo}"
    assert corpo.get("erro") == codigo, f"esperava erro={codigo!r}: {corpo}"
    assert isinstance(corpo.get("mensagem"), str)
    assert corpo["mensagem"].strip(), f"mensagem vazia: {corpo}"
    assert set(corpo) <= {"erro", "mensagem", "campo"}, (
        f"chaves a mais no envelope: {sorted(corpo)}"
    )
    if campo is not None:
        assert corpo.get("campo") == campo, f"esperava campo={campo!r}: {corpo}"
    return corpo


@pytest.fixture
def gestao(sessao_de_admin: TestClient, sessao: Session) -> TestClient:
    """`sessao_de_admin` com o cenário semeado."""
    semear_ementa(sessao)
    return sessao_de_admin


@pytest.fixture
def cliente_sem_sessao_com_ementa(cliente: TestClient, sessao: Session) -> TestClient:
    """O cliente **sem** sessão, com o cenário semeado."""
    semear_ementa(sessao)
    return cliente


@pytest.fixture
def gestao_sem_excecoes(motor: Engine, sessao: Session, admin: Admin) -> Iterator[Any]:
    """Como `gestao`, mas um erro do servidor sai como 500 em vez de rebentar o teste.

    O `TestClient` por omissão volta a levantar a exceção do servidor, o que
    esconde a diferença entre "500" e "o teste caiu": para provar que um id
    enorme **não** é um 500 é preciso ver o estado.
    """
    from fastapi.testclient import TestClient

    from app.main import criar_app
    from tests.apoio_auth import CREDENCIAIS_FALSAS

    semear_ementa(sessao)
    with TestClient(
        criar_app(),
        base_url="https://testserver",
        raise_server_exceptions=False,
    ) as cliente_de_teste:
        resposta = cliente_de_teste.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, resposta.text
        yield cliente_de_teste
