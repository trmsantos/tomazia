"""Eventos: rascunhos sem data, publicados com data (ADR 0009)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC


class Evento(Base):
    __tablename__ = "eventos"
    __table_args__ = (
        # `publicado` é `NOT NULL` por causa da restrição abaixo, não por
        # arrumação. Em SQLite um `CHECK` só falha quando a expressão dá
        # **falso**; com um operando NULL dá NULL, e NULL não é falso —
        # passa. Com `publicado` anulável, uma linha com
        # `publicado = NULL` e `inicio = NULL` entrava sem queixa nenhuma
        # (medido). Ver ADR 0009.
        CheckConstraint(
            "publicado = 0 OR inicio IS NOT NULL", name="publicado_exige_inicio"
        ),
        # `imagem` é um nome de ficheiro, nunca um caminho: quem o lê
        # junta-o a uma pasta. A defesa principal é da fronteira (a
        # F4-03 valida antes de guardar), mas um `CHECK` não se
        # acrescenta a uma tabela que já existe sem a reconstruir
        # (regra 7), e a F2-08 importa nomes de imagem do site antigo
        # sem passar pela API. O `IS NULL` é explícito de propósito: a
        # coluna é anulável e "sem imagem" tem de continuar a entrar.
        CheckConstraint(
            "imagem IS NULL OR ("
            "instr(imagem, '/') = 0 AND instr(imagem, '\\') = 0 "
            "AND instr(imagem, '..') = 0)",
            name="imagem_sem_caminho",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(120), nullable=False)
    # Anulável de propósito: um rascunho pode não ter data, e é onde a
    # F2-08 põe os eventos do site antigo que tinham `data_evento` a ''.
    inicio: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)
    imagem: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # `server_default` pela mesma razão que `produtos.disponivel`: um
    # `INSERT` em SQL cru não corre o `default=` do lado do Python, e a
    # F2-08 escreve direto.
    publicado: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
