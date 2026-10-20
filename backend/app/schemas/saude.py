"""Esquema da resposta de `GET /health`."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class RespostaSaude(BaseModel):
    """Corpo de `GET /health`.

    Usada como `response_model`: nenhuma chave extra escapa na resposta,
    mesmo que a função da rota devolva mais do que isto.
    """

    estado: Literal["ok"]
    versao: str
