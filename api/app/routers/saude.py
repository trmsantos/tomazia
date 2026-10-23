"""Rota `GET /health`.

Declarada sem o prefixo `/api`: é o Passenger que o acrescenta via
`SCRIPT_NAME` em produção (ver `app/main.py` e `passenger_wsgi.py`).
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.schemas.saude import RespostaSaude
from app.versao import obter_versao

router = APIRouter()


@router.get("/health", response_model=RespostaSaude)
def obter_saude(request: Request, response: Response) -> RespostaSaude:
    """Estado da app, versão corrente e instante de arranque do processo.

    A versão é lida com `obter_versao()`, sem argumentos, a cada pedido —
    nunca uma só vez à importação — e a resposta nunca fica em cache: o
    `esperar-versao.sh` e o workflow horário da F1-04 fazem polling deste
    endpoint à espera de um valor novo, e uma resposta em cache fá-los-ia
    esperar por um valor já servido.

    `arrancado_em` vem de `request.app.state.arrancado_em`, que `criar_app()`
    só copia da constante `app.main.ARRANCADO_EM` — calculada uma única vez,
    à importação do módulo. Não se lê `app.main.ARRANCADO_EM` diretamente
    aqui para não criar um import circular com `app.main` (que importa este
    router); ler do `state` da app do pedido dá o mesmo valor sem esse ciclo.
    """
    response.headers["Cache-Control"] = "no-store"
    return RespostaSaude(
        estado="ok",
        versao=obter_versao(),
        arrancado_em=request.app.state.arrancado_em,
    )
