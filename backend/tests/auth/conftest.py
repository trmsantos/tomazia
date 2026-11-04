"""Fixtures dos testes de autenticação (F2-04).

Junta as fixtures de HTTP (`tests/apoio_http.py`) às de autenticação
(`tests/apoio_auth.py`), no mesmo padrão que `tests/publico/conftest.py` e
`tests/seguranca/conftest.py` já seguem para as suas próprias baterias:
importar aqui é o que regista as fixtures para esta pasta, sem duplicar o
código que as define.

Cada teste que peça `cliente`, `cliente_seguro`, `motor`, `sessao` ou
`admin` corre **duas vezes**, `[modelos]` e `[migracao]` — ver o docstring
de `tests/apoio_http.py`.
"""

from __future__ import annotations

from tests.apoio_auth import (  # noqa: F401 - o import é o registo da fixture
    admin,
    cliente_seguro,
    sessao_de_admin,
)
from tests.apoio_http import (  # noqa: F401 - o import é o registo da fixture
    _bd_modelo_em_head,
    cliente,
    contador_de_sql,
    motor,
    origem_do_esquema,
    sessao,
)
