"""Contas de administração da área de gestão."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC, agora_utc


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Único: é por ele que o `POST /auth/login` procura a conta e é nele
    # que o bloqueio após 5 falhas se guarda. Duas linhas com o mesmo
    # utilizador davam ao atacante duas contas para gastar tentativas.
    utilizador: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    hash_password: Mapped[str] = mapped_column(String(255), nullable=False)
    # `NOT NULL` com omissão 0: em SQL, `NULL + 1` é NULL, e uma conta com
    # este campo a NULL nunca chegava às 5 falhas nem bloqueava.
    tentativas_falhadas: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bloqueado_ate: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
    criado_em: Mapped[datetime] = mapped_column(
        DataHoraUTC, nullable=False, default=agora_utc
    )
