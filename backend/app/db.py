"""Ligação à base de dados: a fábrica de motores e os PRAGMAs do SQLite.

Os três PRAGMAs (`busy_timeout`, `journal_mode=WAL`, `foreign_keys=ON`,
por esta ordem) vivem no ouvinte do evento `connect` do motor, e não
noutro sítio, por três razões medidas:

- um PRAGMA é por **ligação**, não por processo. `foreign_keys` e
  `busy_timeout` morrem com a ligação que os recebeu; só o
  `journal_mode=WAL` fica gravado no cabeçalho do ficheiro. Um motor que
  os aplicasse uma vez, numa ligação de aquecimento, serviria o resto da
  vida do processo com as chaves estrangeiras desligadas;
- `PRAGMA foreign_keys` numa ligação acabada de abrir devolve **0**. Sem
  o PRAGMA, uma chave estrangeira é decoração: o SQLite grava-a no DDL e
  nunca a verifica;
- `PRAGMA busy_timeout` devolve **5000 sem código nenhum nosso**, porque
  o `pysqlite` aplica o seu `timeout=5.0` por omissão. É por isso que a
  constante tem de ser lida no momento em que a ligação abre, e não
  fixada numa f-string avaliada à importação: só assim se distingue "o
  nosso valor chegou lá" de "calhou ser o mesmo".

Num `lifespan` seriam código morto — o a2wsgi não emite eventos
`lifespan` (ADR 0003). Em `criar_app()` cobririam a aplicação e deixavam
de fora o `alembic`, os `scripts/` e todas as ligações que o pool abre
depois da primeira. E nunca dentro do `upgrade()` de uma migração,
porque aí correm dentro da transação do Alembic, onde o SQLite recusa a
mudança de modo e devolve o modo antigo **sem erro**.

Não há motor nem fábrica de sessões ao nível do módulo, de propósito: um
motor fixado no import amarra o processo inteiro à primeira
`BASE_DADOS_URL` que vir, e impediria a base de dados temporária por
teste.
"""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session

from app.config import obter_definicoes

#: Quanto tempo uma ligação espera por uma tabela bloqueada antes de
#: desistir, em milissegundos. Fixado em `backend/CLAUDE.md`.
BUSY_TIMEOUT_MS: int = 5000

#: Nomes determinísticos para índices e restrições. O ADR 0009 depende
#: disto: o SQLite devolve o nome da restrição na mensagem de erro
#: (`CHECK constraint failed: ck_eventos_publicado_exige_inicio`), e é
#: esse nome que permite responder em PT-PT junto do campo certo em vez
#: de um 500 genérico. Um nome gerado pelo SQLAlchemy sem convenção muda
#: com a versão e não serve para isso.
CONVENCAO_DE_NOMES: dict[str, str] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=CONVENCAO_DE_NOMES)


def _mensagem_sem_wal(modo_obtido: object) -> str:
    return (
        "A base de dados não ficou em modo WAL: `PRAGMA journal_mode` "
        f"devolveu {modo_obtido!r} em vez de 'wal'. O SQLite não dá erro "
        "quando recusa a mudança de modo, por isso isto é o único sítio "
        "onde se nota. Acontece com uma base de dados em memória "
        "(`sqlite://`), que nunca entra em WAL, e com um ficheiro aberto "
        "dentro de uma transação. Verifica a BASE_DADOS_URL: tem de "
        "apontar para um ficheiro."
    )


def _mensagem_sem_busy_timeout(valor_obtido: object, esperado: int) -> str:
    return (
        "A ligação não ficou com o `busy_timeout` que pedimos: "
        f"`PRAGMA busy_timeout` devolveu {valor_obtido!r} em vez de "
        f"{esperado}. Sem ele, duas escritas ao mesmo tempo desistem uma "
        "da outra de imediato em vez de esperarem, e o pedido rebenta com "
        "'database is locked'. O SQLite não dá erro quando o PRAGMA não "
        "pega, por isso isto é o único sítio onde se nota."
    )


def _mensagem_sem_foreign_keys(valor_obtido: object) -> str:
    return (
        "A ligação não ficou com as chaves estrangeiras ligadas: "
        f"`PRAGMA foreign_keys` devolveu {valor_obtido!r} em vez de 1. "
        "Este PRAGMA é um no-op **silencioso** dentro de uma transação "
        "(medido: dentro de `BEGIN` devolve 0, fora devolve 1, nos dois "
        "casos sem exceção nenhuma). Sem ele, uma chave estrangeira é "
        "decoração que o SQLite grava no DDL e nunca verifica, e um "
        "produto pode apontar para uma categoria que não existe."
    )


def _ler_pragma(cursor: Any, nome: str) -> Any:
    """Lê um PRAGMA e devolve o valor, ou `None` se não vier linha nenhuma."""
    cursor.execute(f"PRAGMA {nome}")
    linha = cursor.fetchone()
    return linha[0] if linha else None


def _aplicar_pragmas_sqlite(ligacao_dbapi: Any, _registo: Any) -> None:
    """Aplica os três PRAGMAs a cada ligação nova do pool, e **relê os três**.

    Corre com o cursor do DBAPI, antes de o SQLAlchemy entregar a ligação
    a quem a pediu. `BUSY_TIMEOUT_MS` é lido aqui, do módulo, no momento
    em que a ligação abre.

    Nenhum dos três dá erro quando não pega — devolvem o valor antigo e
    seguem em frente. Por isso os três são relidos e os três rebentam:
    emitir um PRAGMA e não verificar a resposta é o mesmo que não o
    emitir, e dos três é o `foreign_keys` que sustenta a integridade
    referencial do projeto inteiro.

    A ordem não é arbitrária. O `busy_timeout` vem primeiro porque o
    `journal_mode=WAL` é o único dos três que precisa de acesso
    exclusivo ao ficheiro e pode apanhar um `SQLITE_BUSY`: a instrução
    que mais precisa do tempo de espera não pode ser a única a correr
    sem ele.
    """
    cursor = ligacao_dbapi.cursor()
    try:
        # Um PRAGMA não aceita parâmetros ligados; o valor é interpolado,
        # e por isso passa por `int()` antes de entrar na instrução.
        esperado = int(BUSY_TIMEOUT_MS)
        cursor.execute(f"PRAGMA busy_timeout={esperado}")
        obtido = _ler_pragma(cursor, "busy_timeout")
        if obtido != esperado:
            raise RuntimeError(_mensagem_sem_busy_timeout(obtido, esperado))

        cursor.execute("PRAGMA journal_mode=WAL")
        modo = _ler_pragma(cursor, "journal_mode")
        if str(modo).lower() != "wal":
            raise RuntimeError(_mensagem_sem_wal(modo))

        cursor.execute("PRAGMA foreign_keys=ON")
        ligadas = _ler_pragma(cursor, "foreign_keys")
        if ligadas != 1:
            raise RuntimeError(_mensagem_sem_foreign_keys(ligadas))
    finally:
        cursor.close()


def criar_engine(url: str) -> Engine:
    """Cria um motor e regista nele o ouvinte que aplica os PRAGMAs.

    É a única fábrica de motores do projeto. Quem construir um motor por
    fora (a aplicação, o `migrations/env.py`, um script) abre a base de
    dados sem WAL e com as chaves estrangeiras desligadas.
    """
    e_sqlite = url.startswith("sqlite")
    connect_args: dict[str, object] = {"check_same_thread": False} if e_sqlite else {}
    motor = create_engine(url, connect_args=connect_args)
    if e_sqlite:
        event.listen(motor, "connect", _aplicar_pragmas_sqlite)
    return motor


@lru_cache
def obter_engine() -> Engine:
    """O motor da aplicação, construído à primeira utilização.

    A cache é o que faz dele um só por processo; `tests/conftest.py`
    limpa-a entre testes, para cada teste ter a sua base de dados.
    """
    return criar_engine(obter_definicoes().base_dados_url)


def obter_sessao() -> Iterator[Session]:
    sessao = Session(bind=obter_engine(), autoflush=False)
    try:
        yield sessao
    finally:
        sessao.close()
