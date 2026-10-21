"""Fábrica da aplicação FastAPI.

As rotas definem-se sempre sem o prefixo `/api`; em produção o Passenger
passa-o em `SCRIPT_NAME`.

Em produção o a2wsgi (`passenger_wsgi.py`) monta esta app com
`ASGIMiddleware`, que **não corre o protocolo `lifespan`**: nada posto num
`lifespan` desta app chega a executar sob o Passenger. É por isso que a
validação da configuração (a chamada a `obter_definicoes()` abaixo) corre
diretamente em `criar_app()`, nunca num `lifespan`.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.config import obter_definicoes
from app.routers import saude


def criar_app() -> FastAPI:
    # Força a validação das definições a correr no arranque: é aqui que o
    # `model_validator` de `Definicoes` rejeita um `SEGREDO_SESSAO` inseguro
    # em produção. Sem isto, a guarda nunca é exercitada sob o Passenger.
    definicoes = obter_definicoes()

    if definicoes.ambiente == "producao":
        # Os três, não só o `/docs`: o `/redoc` serve o mesmo conteúdo, e o
        # `/openapi.json` publicaria o mapa completo da superfície de
        # gestão (`/gestao/*`, `/auth/*`, esquemas de entrada) a quem não
        # tem sessão nenhuma.
        aplicacao = FastAPI(
            title="Bar da Tomazia — API",
            docs_url=None,
            redoc_url=None,
            openapi_url=None,
        )
    else:
        aplicacao = FastAPI(title="Bar da Tomazia — API")

    aplicacao.include_router(saude.router)
    return aplicacao


app = criar_app()
