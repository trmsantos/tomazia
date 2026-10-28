"""Fixtures da bateria de segurança.

Hoje só as de HTTP, de que o S-09 precisa: as mesmas de
`tests/publico/conftest.py`, vindas do mesmo sítio
(`tests/apoio_http.py`), para as duas cópias não poderem divergir.

Nenhuma é `autouse`: os ficheiros de segurança que já existem não as pedem
e continuam a correr exatamente como antes.
"""

from __future__ import annotations

from tests.apoio_http import (  # noqa: F401 - o import é o registo da fixture
    _bd_modelo_em_head,
    cliente,
    contador_de_sql,
    motor,
    origem_do_esquema,
    sessao,
)
