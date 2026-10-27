"""Clientes inscritos nas novidades."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC, agora_utc


class Cliente(Base):
    __tablename__ = "clientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(80), nullable=False)
    # Único: é por aqui que a F2-07 decide se uma subscrição é nova ou
    # repetida. Sem a unicidade, a mesma pessoa fica com duas linhas e um
    # "cancelar" só apaga uma.
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    telemovel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    consentimento_em: Mapped[datetime] = mapped_column(DataHoraUTC, nullable=False)
    versao_termos: Mapped[str] = mapped_column(String(20), nullable=False)
    # Único: é o que autoriza o `POST /novidades/cancelar` sem sessão
    # nenhuma. Dois clientes com o mesmo token davam a um deles o poder
    # de cancelar a subscrição do outro.
    token_cancelar: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    criado_em: Mapped[datetime] = mapped_column(
        DataHoraUTC, nullable=False, default=agora_utc
    )
