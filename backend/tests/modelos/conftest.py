"""Fixtures dos testes dos modelos (F2-01).

A base de dados vem de `obter_engine()` — ou seja, da `BASE_DADOS_URL` que
`tests/conftest.py` aponta para um ficheiro dentro do `tmp_path` do teste.
É de propósito que não há aqui nenhum motor construído à parte: estes testes
só provam o que provam (chaves estrangeiras verificadas, restrições a
disparar) se correrem sobre uma ligação com os três PRAGMAs aplicados, e
`obter_engine()` é o caminho real da aplicação.

Nunca `:memory:` — ver `backend/CLAUDE.md`. Uma base de dados em memória
nunca entra em WAL e rebentaria no guarda de `app/db.py` antes de qualquer
asserção destes ficheiros.

## Porque é que a fixture `motor` é parametrizada

Cada teste desta pasta corre **duas vezes**: uma com o esquema construído
pelos modelos (`Base.metadata.create_all`) e outra com o esquema construído
pela migração (`alembic upgrade head`). Os identificadores ficam
`[modelos]` e `[migracao]`.

Não é zelo. Construir só pelos modelos deixava um buraco estrutural, e o
buraco foi medido: **com o `CHECK (preco_cent >= 0)` apagado da migração, a
bateria inteira ficava verde — `alembic check` incluído.** O
`compare_metadata`, que é o que o `alembic check` usa, vê uma `UNIQUE` em
falta e um `ondelete` trocado, mas **não vê `CHECK` constraints nem
`server_default`**. Dizia "não há divergência" quando havia.

O que isso custava: alguém mexe na migração — edição à mão, rebate de
merge, o PR seguinte — e a base de dados de produção passa a aceitar
`preco_cent = -1` e `estado = 'banana'`, escritos em SQL cru pelo
`importar_bd_antiga.py` da F2-08, com tudo verde. E a migração é, pela regra
7 do `CLAUDE.md`, o único ficheiro que não se corrige depois.

Parametrizar é mais forte do que listar as restrições à mão num teste de
DDL (que também existe, em `tests/test_migracao_inicial.py`): qualquer
defeito futuro da migração é apanhado pelos testes de comportamento que já
existem, sem ninguém se ter de lembrar de acrescentar uma asserção.

O custo é um `alembic upgrade head` **por sessão**, não por teste: o
ficheiro é construído uma vez e copiado para cada teste.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, make_url
from sqlalchemy.orm import Session

from tests import apoio_esquema

#: Os dois caminhos por onde o esquema pode nascer. `modelos` é o que a
#: aplicação usa nos testes; `migracao` é o que o servidor tem mesmo, posto
#: lá pelo `alembic upgrade head` do `deploy/deploy.sh`.
ORIGENS_DO_ESQUEMA = ("modelos", "migracao")


@pytest.fixture(scope="session")
def _bd_construida_pelo_alembic(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Uma base de dados em head, construída uma vez por sessão de testes.

    Correr `alembic upgrade head` num subprocesso por cada teste custava
    cerca de meio segundo vezes o número de testes desta pasta. Construir
    uma vez e copiar o ficheiro dá o mesmo esquema por uma fração do tempo,
    e a cópia é por teste — nenhum teste vê dados de outro.
    """
    destino = tmp_path_factory.mktemp("esquema-da-migracao") / "modelo.db"
    return apoio_esquema.construir_bd_com_alembic(destino)


@pytest.fixture(params=ORIGENS_DO_ESQUEMA)
def origem_do_esquema(request: pytest.FixtureRequest) -> str:
    """`"modelos"` ou `"migracao"` — o parâmetro que duplica cada teste."""
    assert isinstance(request.param, str)
    return request.param


@pytest.fixture
def motor(request: pytest.FixtureRequest, origem_do_esquema: str) -> Iterator[Engine]:
    from app.db import Base, obter_engine

    # Importar cada módulo explicitamente, em vez de contar com o que
    # `app/models/__init__.py` reexporte: um `__init__.py` que se esqueça de
    # um agregado deixaria `Base.metadata` incompleto e `create_all` criaria
    # menos tabelas, em silêncio.
    from app.models import (  # noqa: F401 - o import é o efeito que queremos
        admins,
        clientes,
        definicoes,
        ementa,
        eventos,
        fotos,
    )

    if origem_do_esquema == "migracao":
        # Pedido aqui, e não na assinatura da fixture, para quem corra só
        # `-k modelos` não pagar o subprocesso do Alembic — e, mais
        # importante, para uma migração partida deixar vermelha só a
        # metade `[migracao]`, em vez de apagar a bateria inteira com
        # erros de fixture que não dizem qual é o problema.
        modelo = request.getfixturevalue("_bd_construida_pelo_alembic")
        # Antes de `obter_engine()`: o motor é preguiçoso e ainda não abriu
        # o ficheiro, por isso a cópia não passa por baixo de uma ligação
        # aberta.
        shutil.copyfile(modelo, _caminho_da_base_de_dados())

    motor_da_sessao = obter_engine()

    if origem_do_esquema == "modelos":
        Base.metadata.create_all(motor_da_sessao)

    # Não é a mesma coisa que "o esquema está certo" — é só a garantia de
    # que *algum* esquema foi construído. Sem isto, um caminho que falhasse
    # em silêncio deixava os testes a falhar um a um com "no such table",
    # sem dizer que o problema era da fixture.
    _exigir_as_sete_tabelas(motor_da_sessao, origem_do_esquema)

    yield motor_da_sessao
    motor_da_sessao.dispose()


@pytest.fixture
def sessao(motor: Engine) -> Iterator[Session]:
    with Session(motor) as sessao_de_teste:
        yield sessao_de_teste


def _caminho_da_base_de_dados() -> Path:
    """O ficheiro para onde `BASE_DADOS_URL` aponta neste teste."""
    from app.config import obter_definicoes

    url = make_url(obter_definicoes().base_dados_url)
    assert url.database is not None, (
        "BASE_DADOS_URL não aponta para um ficheiro; os testes do backend "
        "nunca usam `:memory:` (ver backend/CLAUDE.md)"
    )
    return Path(url.database)


def _exigir_as_sete_tabelas(motor_da_sessao: Engine, origem: str) -> None:
    from sqlalchemy import inspect

    tabelas = set(inspect(motor_da_sessao).get_table_names()) - {"alembic_version"}
    esperadas = {
        "categorias",
        "produtos",
        "eventos",
        "fotos",
        "clientes",
        "admins",
        "definicoes",
    }
    assert tabelas == esperadas, (
        f"o esquema construído por `{origem}` tem {sorted(tabelas)} em vez "
        f"das sete tabelas. A falha é da fixture, não do teste"
    )
