"""O envelope de erro de toda a API, tal como o OpenAPI o promete."""

from __future__ import annotations

from pydantic import BaseModel


class RespostaDeErro(BaseModel):
    """`{"erro", "mensagem"}` da especificação, com dois opcionais.

    - `campo`: o campo do corpo a que o erro se refere (422 e alguns 409).
    - `segundos_em_falta`: só o `429 conta_bloqueada` do login.
    """

    erro: str
    mensagem: str
    campo: str | None = None
    segundos_em_falta: int | None = None
