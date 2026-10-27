"""Clientes inscritos nas novidades."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC, agora_utc

#: Mínimo de caracteres do token de cancelamento. É uma credencial: quem
#: a tiver cancela a subscrição sem sessão nenhuma. Sem este mínimo o
#: esquema aceitava a string vazia, e uma linha assim deixava qualquer
#: pedido com token vazio cancelar aquela subscrição.
TAMANHO_MINIMO_TOKEN_CANCELAR = 32


class Cliente(Base):
    __tablename__ = "clientes"
    __table_args__ = (
        CheckConstraint(
            f"length(token_cancelar) >= {TAMANHO_MINIMO_TOKEN_CANCELAR}",
            name="token_cancelar_tamanho_minimo",
        ),
    )

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
    # `server_default` como em `fotos.criada_em` e `admins.criado_em`: o
    # `default=` é do lado do Python e não corre num `INSERT` em SQL
    # cru, onde a coluna é `NOT NULL` e ficava sem valor nenhum.
    criado_em: Mapped[datetime] = mapped_column(
        DataHoraUTC,
        nullable=False,
        default=agora_utc,
        server_default=func.current_timestamp(),
    )
