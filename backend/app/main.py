"""Fábrica da aplicação FastAPI.

Nesta tarefa (F1-01) a app ainda não tem rotas: o `GET /health` chega na
F1-02. As rotas definem-se sempre sem o prefixo `/api`; em produção o
Passenger passa-o em `SCRIPT_NAME`.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.config import obter_definicoes


def criar_app() -> FastAPI:
    # Força a validação das definições a correr no arranque: é aqui que o
    # `model_validator` de `Definicoes` rejeita um `SEGREDO_SESSAO` inseguro
    # em produção. Sem isto, a guarda nunca é exercitada sob o Passenger.
    obter_definicoes()
    return FastAPI(title="Bar da Tomazia — API")


app = criar_app()
