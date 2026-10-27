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

O esquema cria-se com `Base.metadata.create_all`, não com o Alembic: é mais
rápido e é sobre os **modelos** que estes testes falam. Quem prende os
modelos à migração é `tests/test_migracao_inicial.py::test_modelos_e_migracao_nao_divergem`.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session


@pytest.fixture
def motor() -> Iterator[Engine]:
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

    from app.db import Base, obter_engine

    motor_da_sessao = obter_engine()
    Base.metadata.create_all(motor_da_sessao)
    yield motor_da_sessao
    motor_da_sessao.dispose()


@pytest.fixture
def sessao(motor: Engine) -> Iterator[Session]:
    with Session(motor) as sessao_de_teste:
        yield sessao_de_teste
