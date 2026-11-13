"""Os corpos da gestão da ementa (`/gestao/categorias`, `/gestao/produtos`).

- Os pedidos recusam campos desconhecidos (`extra="forbid"`): `id`, `ordem`
  ou `slug` no corpo são um `422`, nunca ignorados em silêncio.
- O texto guarda-se tal como foi escrito (nunca escape HTML); só se apara
  o espaço das pontas. Os comprimentos máximos são os das colunas, validados
  aqui porque o SQLite não impõe `String(n)`.
- Inteiros com limites: um número acima de `2**63-1` rebentava o driver.
- Nos `PATCH`, "ausente" e `null` são coisas diferentes (lê-se o
  `model_fields_set`). `null` só vale para a `descricao`; nos outros campos
  é um `422` com o nome do campo.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    field_validator,
)
from pydantic.json_schema import SkipJsonSchema

from app.dependencias import MAIOR_INTEIRO_DO_SQLITE

NomeDaCategoria = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]
NomeDoProduto = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
DescricaoDoProduto = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=280)
]
IdNoCorpo = Annotated[int, Field(strict=True, ge=1, le=MAIOR_INTEIRO_DO_SQLITE)]
#: Cêntimos. O teto é o de um inteiro de 32 bits: muito acima de qualquer preço.
PrecoEmCentimos = Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]

#: O `UPDATE ... CASE` da reordenação liga 3 parâmetros por id (`WHEN`,
#: `THEN` e `IN`), mais um filtro nos produtos: 300 ids são 901, abaixo dos
#: 999 que o SQLite aceitava antes da 3.32 (a versão do servidor não é
#: conhecida). Mais do que isto numa lista de ordem não é uma ementa.
MAXIMO_DE_IDS_NA_ORDEM = 300


class _Corpo(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _descricao_vazia_e_nula(valor: str | None) -> str | None:
    return valor or None


# --------------------------------------------------------------------------
# Respostas
# --------------------------------------------------------------------------


class ProdutoGestao(BaseModel):
    id: int
    categoria_id: int
    nome: str
    descricao: str | None
    preco_cent: int
    disponivel: bool


class CategoriaGestao(BaseModel):
    id: int
    nome: str
    slug: str
    visivel: bool
    produtos: list[ProdutoGestao]


class RespostaEmentaGestao(BaseModel):
    """Corpo de `GET /gestao/categorias`: tudo, incluindo o que está escondido."""

    categorias: list[CategoriaGestao]


# --------------------------------------------------------------------------
# Pedidos
# --------------------------------------------------------------------------


class PedidoCriarCategoria(_Corpo):
    nome: NomeDaCategoria
    visivel: StrictBool = True


class PedidoAlterarCategoria(_Corpo):
    """Só se altera o que vem no corpo. O `slug` nunca muda."""

    nome: NomeDaCategoria | SkipJsonSchema[None] = None
    visivel: StrictBool | SkipJsonSchema[None] = None

    @field_validator("nome", "visivel", mode="before")
    @classmethod
    def _null_nao_e_ausente(cls, valor: Any) -> Any:
        if valor is None:
            raise ValueError("este campo não aceita null")
        return valor


class PedidoCriarProduto(_Corpo):
    categoria_id: IdNoCorpo
    nome: NomeDoProduto
    descricao: DescricaoDoProduto | None = None
    preco_cent: PrecoEmCentimos
    disponivel: StrictBool = True

    @field_validator("descricao")
    @classmethod
    def _descricao_vazia(cls, valor: str | None) -> str | None:
        return _descricao_vazia_e_nula(valor)


class PedidoAlterarProduto(_Corpo):
    """`PATCH` com valores absolutos: preço e disponibilidade nunca alternam."""

    # `SkipJsonSchema[None]`: o validador abaixo recusa `null`, e o esquema
    # não deve prometer o contrário. Só a `descricao` admite `null`.
    categoria_id: IdNoCorpo | SkipJsonSchema[None] = None
    nome: NomeDoProduto | SkipJsonSchema[None] = None
    descricao: DescricaoDoProduto | None = None
    preco_cent: PrecoEmCentimos | SkipJsonSchema[None] = None
    disponivel: StrictBool | SkipJsonSchema[None] = None

    @field_validator("categoria_id", "nome", "preco_cent", "disponivel", mode="before")
    @classmethod
    def _null_nao_e_ausente(cls, valor: Any) -> Any:
        if valor is None:
            raise ValueError("este campo não aceita null")
        return valor

    @field_validator("descricao")
    @classmethod
    def _descricao_vazia(cls, valor: str | None) -> str | None:
        return _descricao_vazia_e_nula(valor)


class PedidoOrdem(_Corpo):
    """A lista completa de ids, na ordem pretendida, sem repetidos."""

    ids: Annotated[list[IdNoCorpo], Field(max_length=MAXIMO_DE_IDS_NA_ORDEM)]

    @field_validator("ids")
    @classmethod
    def _sem_repetidos(cls, valor: list[int]) -> list[int]:
        if len(set(valor)) != len(valor):
            raise ValueError("há ids repetidos")
        return valor
