"""Fixtures dos testes da gestão da ementa (F2-05a).

Mesmo padrão de `tests/fotos/conftest.py`: regista aqui as fixtures de
`tests/apoio_http.py`, `tests/apoio_auth.py` e `tests/apoio_gestao.py`.
Cada teste corre duas vezes, `[modelos]` e `[migracao]`.
"""

from __future__ import annotations

from tests.apoio_auth import (  # noqa: F401 - o import é o registo da fixture
    admin,
    cliente_seguro,
    sessao_de_admin,
)
from tests.apoio_gestao import (  # noqa: F401 - o import é o registo da fixture
    cliente_sem_sessao_com_ementa,
    gestao,
    gestao_sem_excecoes,
)
from tests.apoio_http import (  # noqa: F401 - o import é o registo da fixture
    _bd_modelo_em_head,
    cliente,
    contador_de_sql,
    motor,
    origem_do_esquema,
    sessao,
)
