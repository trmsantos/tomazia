"""Pequenos auxiliares de SQL partilhados pelos serviços de gestão."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy import CursorResult


def linhas_afetadas(resultado: Any) -> int:
    """O `rowcount` de um `UPDATE` ou `DELETE`."""
    return int(cast("CursorResult[Any]", resultado).rowcount)


def id_inserido(resultado: Any) -> int:
    """A chave primária de um `INSERT`, sem `RETURNING`.

    `inserted_primary_key` e não `.returning()`: este só existe a partir do
    SQLite 3.35, e a versão do servidor não é conhecida.
    """
    chave = cast("CursorResult[Any]", resultado).inserted_primary_key
    if chave is None:
        raise RuntimeError("o INSERT não devolveu a chave primária")
    return int(chave[0])
