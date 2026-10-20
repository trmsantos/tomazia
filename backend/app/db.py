"""Ligação à base de dados.

Nesta tarefa (F1-01) só existe o andaime: a classe base declarativa, o
motor e a fábrica de sessões. Modelos, tabelas e o modo WAL do SQLite
chegam na F2-01.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import obter_definicoes

_definicoes = obter_definicoes()

_connect_args: dict[str, object] = (
    {"check_same_thread": False}
    if _definicoes.base_dados_url.startswith("sqlite")
    else {}
)

engine = create_engine(_definicoes.base_dados_url, connect_args=_connect_args)

SessaoLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def obter_sessao() -> Iterator[Session]:
    sessao = SessaoLocal()
    try:
        yield sessao
    finally:
        sessao.close()
