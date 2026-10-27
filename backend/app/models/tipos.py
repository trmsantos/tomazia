"""Tipos de coluna partilhados pelos modelos.

`backend/CLAUDE.md` fixa a regra: datas em UTC na base de dados,
`Europe/Lisbon` só na apresentação. `DataHoraUTC` é quem a faz cumprir, e
existe porque o `DateTime(timezone=True)` do SQLAlchemy não a cumpre em
SQLite: medido, um `12:00+01:00` fica escrito como `2026-07-01 12:00:00`
e relê-se ingénuo — o deslocamento desaparece em silêncio, e o mesmo
instante passa a valer uma hora a mais durante metade do ano.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, Dialect
from sqlalchemy.types import TypeDecorator

MENSAGEM_SEM_FUSO = (
    "O instante não traz fuso horário. Um `datetime` ingénuo não diz a "
    "que fuso pertence, e guardá-lo seria guardar uma hora errada "
    "durante metade do ano, sem nada no registo a dizer qual. Tem de vir "
    "com `tzinfo` (em UTC, ou em qualquer fuso — a conversão é feita "
    "aqui)."
)


def agora_utc() -> datetime:
    """O instante atual, sempre com fuso e sempre em UTC."""
    return datetime.now(UTC)


class DataHoraUTC(TypeDecorator[datetime]):
    """Instantes com fuso à entrada e à saída, guardados em UTC.

    - à escrita: recusa um `datetime` ingénuo, converte o resto para UTC
      e guarda sem `tzinfo` (é o que a coluna do SQLite aguenta);
    - à leitura: devolve sempre `tzinfo=UTC`, incluindo para valores que
      não fomos nós a escrever — o `CURRENT_TIMESTAMP` do SQLite, que
      serve de `server_default` a `fotos.criada_em`, escreve
      `2026-10-27 12:34:56`, sem fuso e sem frações de segundo, e os
      scripts da F2-02 e da F2-08 escrevem por SQL, sem ORM.
    """

    impl = DateTime
    #: O tipo não tem estado que dependa da instância, por isso o
    #: SQLAlchemy pode guardar em cache as instruções que o usam.
    cache_ok = True

    def process_bind_param(
        self, value: datetime | None, dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            raise ValueError(MENSAGEM_SEM_FUSO)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(
        self, value: datetime | None, dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
