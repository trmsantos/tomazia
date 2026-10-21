"""Rota `GET /health`.

Declarada sem o prefixo `/api`: é o Passenger que o acrescenta via
`SCRIPT_NAME` em produção (ver `app/main.py` e `passenger_wsgi.py`).
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from app.schemas.saude import RespostaSaude
from app.versao import obter_versao

router = APIRouter()


@router.get("/health", response_model=RespostaSaude)
def obter_saude(response: Response) -> RespostaSaude:
    """Estado da app e versão corrente.

    A versão é lida com `obter_versao()`, sem argumentos, a cada pedido —
    nunca uma só vez à importação — e a resposta nunca fica em cache: o
    `esperar-versao.sh` e o workflow horário da F1-04 fazem polling deste
    endpoint à espera de um valor novo, e uma resposta em cache fá-los-ia
    esperar por um valor já servido.
    """
    response.headers["Cache-Control"] = "no-store"
    return RespostaSaude(estado="ok", versao=obter_versao())
