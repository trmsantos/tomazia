"""Definições do bar, em chave/valor.

As sete chaves de `docs/ESPECIFICACAO.md` (`wifi_rede`, `wifi_password`,
`horario`, `morada`, `telefone`, `instagram`, `maps_url`) são **dados**,
não colunas: é o que permite ao dono mudar a password do WiFi e ela
aparecer no site público sem um deploy.
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Definicao(Base):
    __tablename__ = "definicoes"

    chave: Mapped[str] = mapped_column(String(60), primary_key=True)
    # `Text` e não `String(n)`: o `horario` é um JSON por dia, e não há
    # limite útil a impor aqui. A string vazia é um valor legítimo —
    # "ainda não há password de WiFi" diz-se assim, não com NULL.
    valor: Mapped[str] = mapped_column(Text, nullable=False)
