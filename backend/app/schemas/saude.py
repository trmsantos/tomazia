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
    #: Instante (UTC) em que este processo importou `app.main`, formatado
    #: como `%Y-%m-%dT%H:%M:%SZ`. É `str`, não `datetime`: assim o formato
    #: que sai pela rede é sempre exatamente este, sem frações de segundo e
    #: sem depender da serialização de `datetime` do Pydantic — é o que o
    #: `esperar-versao.sh` da F1-04 precisa para o comparar com `jq`,
    #: inequivocamente, contra o instante em que o deploy começou.
    arrancado_em: str
