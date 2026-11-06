"""Os corpos de `POST /fotos` e da moderação (`/gestao/fotos*`).

**`ip_hash` nunca entra em nenhum esquema**: publicá-lo entregava a
qualquer admin a lista de hashes de IP para comparar contra registos
próprios, o que não é o que a moderação precisa para decidir — a mesma
leitura que `app/schemas/publico.py` já faz para a galeria pública.

Envelopes nomeados no topo (`{"fotos": [...]}`), nunca um array: o mesmo
padrão de `RespostaGaleria` e das outras respostas públicas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.fotos import EstadoFoto


class RespostaEnvioFoto(BaseModel):
    """Corpo de sucesso de `POST /fotos`.

    Sem `id`, de propósito: é o que torna este corpo **byte a byte igual**
    ao de um envio apanhado pelo campo-isco contra bots — inventar um `id`
    para um envio que nunca aconteceu distinguiria os dois casos, e é
    exatamente essa distinção que o isco não pode dar a um robô.
    """

    estado: Literal["pendente"] = "pendente"


class FotoPendente(BaseModel):
    """Uma linha da fila de moderação (`GET /gestao/fotos`). Nunca leva `ip_hash`."""

    id: int
    #: Nome de ficheiro, nunca um caminho (`CHECK` da F2-01).
    ficheiro: str
    descricao: str | None
    enviada_por: str | None
    criada_em: datetime


class RespostaFilaDeModeracao(BaseModel):
    """Corpo de `GET /gestao/fotos`."""

    fotos: list[FotoPendente]


class RespostaModeracao(BaseModel):
    """Corpo de sucesso de aprovar ou rejeitar uma foto."""

    id: int
    estado: EstadoFoto
