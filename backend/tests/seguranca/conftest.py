"""Fixtures da bateria de segurança.

As de HTTP, de que o S-09 precisa: as mesmas de `tests/publico/conftest.py`,
vindas do mesmo sítio (`tests/apoio_http.py`), para as duas cópias não
poderem divergir. Desde a F2-04, também as de autenticação
(`tests/apoio_auth.py`), que o S-04, o S-06 e o S-07 precisam — pelo mesmo
motivo: `tests/auth/conftest.py` regista as mesmas, e um segundo conjunto
escrito à mão aqui divergia no dia em que alguém mexesse só num dos dois.

Nenhuma é `autouse`: os ficheiros de segurança que já existem não as pedem
e continuam a correr exatamente como antes.
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

# A F2-02: a base de dados em `head` que
# `test_criar_admin_nao_mostra_a_password.py` usa para lançar
# `criar_admin.py`.
from tests.apoio_scripts_de_admin import (  # noqa: F401 - o import é o registo da fixture
    _bd_modelo_scripts,
    bd_em_head,
)
