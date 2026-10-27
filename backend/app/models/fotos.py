"""Fotos da galeria e a fila de moderação."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC, agora_utc


class EstadoFoto(StrEnum):
    """Os três estados de `docs/ESPECIFICACAO.md`."""

    PENDENTE = "pendente"
    APROVADA = "aprovada"
    REJEITADA = "rejeitada"


#: O `Enum` do SQLAlchemy guarda o **nome** do membro, não o valor, a
#: menos que se lhe diga o contrário — e o que a especificação fixa, e o
#: que os scripts da F2-02 e da F2-08 escrevem por SQL cru, são os
#: valores em minúsculas. `create_constraint=True` também não é omissão:
#: sem ele não fica `CHECK` nenhum na base de dados e o SQLite aceita
#: `'banana'` sem pestanejar, com a validação a viver só do lado do
#: Python — onde um `INSERT` cru não passa.
TIPO_ESTADO_FOTO = Enum(
    EstadoFoto,
    native_enum=False,
    length=10,
    create_constraint=True,
    values_callable=lambda membros: [membro.value for membro in membros],
)


class Foto(Base):
    __tablename__ = "fotos"
    __table_args__ = (
        # `ficheiro` é um nome, nunca um caminho: quem o lê junta-o a
        # `DATA_DIR/pendentes` ou a `public_html/media`. A defesa
        # principal continua a ser da fronteira — a F2-06 ignora o nome
        # que o cliente manda e gera um nome aleatório —, mas um `CHECK`
        # não se acrescenta a uma tabela que já existe sem a reconstruir
        # (regra 7), e a F2-08 escreve direto, sem passar pela API.
        CheckConstraint(
            "instr(ficheiro, '/') = 0 AND instr(ficheiro, '\\') = 0 "
            "AND instr(ficheiro, '..') = 0",
            name="ficheiro_sem_caminho",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ficheiro: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    estado: Mapped[EstadoFoto] = mapped_column(
        TIPO_ESTADO_FOTO, nullable=False, default=EstadoFoto.PENDENTE
    )
    descricao: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enviada_por: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Sem `ip_hash` não há limite de 5 envios por hora por IP (F2-06):
    # uma linha sem ele é um envio que não conta para o limite.
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # O `server_default` não é redundante com o `default=`: o `default=`
    # é do lado do Python e não corre num `INSERT` em SQL cru, que é como
    # os scripts da F2-02 e da F2-08 escrevem.
    criada_em: Mapped[datetime] = mapped_column(
        DataHoraUTC,
        nullable=False,
        default=agora_utc,
        server_default=func.current_timestamp(),
    )
    # Anulável: uma foto por moderar ainda não tem data de moderação, e
    # isso não é um valor em falta — é o estado normal da fila.
    moderada_em: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
