"""As quatro rotas públicas de leitura: `/ementa`, `/eventos`, `/galeria`, `/info`.

Declaradas sem o prefixo `/api`: é o Passenger que o acrescenta via
`SCRIPT_NAME` em produção (ver `app/main.py` e `passenger_wsgi.py`).

Cada rota decide o seu `Cache-Control`, e as quatro não decidem o mesmo.
A ementa e os eventos mudam quando o dono os edita e podem esperar um
minuto. A galeria muda quando ele modera uma foto e a `/info` quando
muda a password do WiFi: nessas duas, um minuto de cache é um minuto a
mostrar o que já não é verdade a quem está sentado à mesa.

As funções não têm lógica nenhuma. Leem a sessão, escrevem o cabeçalho e
entregam o trabalho a `app/services/publico.py` — que é onde as consultas
e as regras estão, à vista e testáveis sem HTTP.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db import obter_sessao
from app.schemas.publico import (
    RespostaEmenta,
    RespostaEventos,
    RespostaGaleria,
    RespostaInfo,
)
from app.services import publico as servico

#: Um minuto. O suficiente para aguentar uma rajada de leituras no mesmo
#: SQLite sem o dono esperar por uma edição mais do que isso.
CACHE_DE_UM_MINUTO = "max-age=60"

#: Nada em cache. Ver o cabeçalho do módulo.
SEM_CACHE = "no-store"

router = APIRouter(tags=["publico"])

#: A sessão da base de dados do pedido, fechada no fim por `obter_sessao`.
SessaoDaBD = Annotated[Session, Depends(obter_sessao)]


@router.get("/ementa", response_model=RespostaEmenta)
def obter_ementa(response: Response, sessao: SessaoDaBD) -> RespostaEmenta:
    """Categorias visíveis com os produtos disponíveis, por ordem.

    Sem categorias, devolve `{"categorias": []}` com 200 — nunca 404 (a
    ementa existe, está vazia) e nunca 204 (o frontend precisa do
    envelope para distinguir "vazio" de "falhou").
    """
    response.headers["Cache-Control"] = CACHE_DE_UM_MINUTO
    return servico.obter_ementa(sessao)


@router.get("/eventos", response_model=RespostaEventos)
def obter_eventos(response: Response, sessao: SessaoDaBD) -> RespostaEventos:
    """Os eventos publicados a partir de hoje, hoje em Lisboa (ADR 0010)."""
    response.headers["Cache-Control"] = CACHE_DE_UM_MINUTO
    return servico.obter_eventos(sessao)


@router.get("/galeria", response_model=RespostaGaleria)
def obter_galeria(response: Response, sessao: SessaoDaBD) -> RespostaGaleria:
    """As fotos aprovadas, as mais recentes primeiro.

    Devolve nomes de ficheiro, nunca bytes: as imagens são servidas pelo
    Apache a partir de `public_html/media` (as aprovadas) e pela F2-06 (as
    pendentes, só a admins).
    """
    response.headers["Cache-Control"] = SEM_CACHE
    return servico.obter_galeria(sessao)


@router.get("/info", response_model=RespostaInfo)
def obter_info(response: Response, sessao: SessaoDaBD) -> RespostaInfo:
    """WiFi, morada, contactos e horário.

    Um horário mal escrito dá `horario: null` e um erro no log, não um
    500: os outros campos estão no mesmo ecrã (ADR 0011).
    """
    response.headers["Cache-Control"] = SEM_CACHE
    return servico.obter_info(sessao)
