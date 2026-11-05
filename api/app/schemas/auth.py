"""Os corpos de `/auth/*`.

Os nomes dos campos de `PedidoLogin` (`utilizador`, `password`) não vêm de
`docs/ESPECIFICACAO.md` — só o nome da coluna da base de dados está lá.
São os mesmos de `tests/apoio_auth.py::CREDENCIAIS_FALSAS`, para os dois
lados nunca divergirem.
"""

from __future__ import annotations

from pydantic import BaseModel


class PedidoLogin(BaseModel):
    """Corpo de `POST /auth/login`."""

    utilizador: str
    password: str


class RespostaAdmin(BaseModel):
    """Corpo de `GET /auth/eu` e do sucesso de `POST /auth/login`.

    Nunca o `hash_password`: só o que a área de gestão precisa para saber
    quem está autenticado.
    """

    id: int
    utilizador: str
