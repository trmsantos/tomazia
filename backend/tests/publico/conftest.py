"""Fixtures dos testes dos endpoints públicos (F2-03).

Todas vêm de `tests/apoio_http.py`, que as partilha com
`tests/seguranca/test_s09_texto_guardado_e_devolvido_igual.py`. Importá-las
aqui é o que as regista para esta pasta.

Cada teste que peça `cliente`, `motor` ou `sessao` corre **duas vezes**,
`[modelos]` e `[migracao]` — ver o docstring de `tests/apoio_http.py`.
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
