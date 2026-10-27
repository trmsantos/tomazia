"""A ementa: categorias e os produtos de cada uma."""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Categoria(Base):
    __tablename__ = "categorias"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(60), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    ordem: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    visivel: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("1")
    )


class Produto(Base):
    __tablename__ = "produtos"
    __table_args__ = (
        # `≥ 0`, não `> 0`: a água de cortesia e qualquer produto de
        # oferta custam 0 cêntimos e têm de caber na ementa.
        CheckConstraint("preco_cent >= 0", name="preco_cent_nao_negativo"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # `ON DELETE RESTRICT`: apagar uma categoria na gestão não pode levar
    # os produtos atrás em silêncio (CASCADE) nem deixá-los órfãos
    # (SET NULL). Quem quiser apagar a categoria trata primeiro dos
    # produtos.
    categoria_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("categorias.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    descricao: Mapped[str | None] = mapped_column(String(280), nullable=True)
    preco_cent: Mapped[int] = mapped_column(Integer, nullable=False)
    # O `server_default` não é redundante com o `default=`: o `default=`
    # é do lado do Python e não corre num `INSERT` em SQL cru. Sem ele,
    # o `importar_bd_antiga.py` da F2-08 — que escreve direto, e é esta
    # a tabela que ele vai encher — rebentava com
    # `NOT NULL constraint failed: produtos.disponivel`.
    disponivel: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("1")
    )
    ordem: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
