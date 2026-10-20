"""Configuração da aplicação, lida de variáveis de ambiente.

Os valores por omissão são seguros para desenvolvimento local: apontam
para pastas e ficheiros dentro de `./var`, nunca para a base de dados
antiga nem para segredos reais. Em produção, as variáveis de ambiente
reais (definidas no `.env` do servidor, nunca neste repositório)
sobrepõem-se a estes valores.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.caminhos import RAIZ_APP

SEGREDO_SESSAO_OMISSAO = "desenvolvimento-sem-segredo"
SEGREDO_SESSAO_PLACEHOLDER_ENV_EXAMPLE = "<gera-um-segredo-com-o-comando-acima>"
SEGREDO_SESSAO_TAMANHO_MINIMO = 32


def _caminho_ficheiro_de_ambiente() -> Path:
    """Resolve o ficheiro de ambiente a usar, nunca relativo à pasta de trabalho.

    Se `TOMAZIA_ENV_FILE` estiver definida, usa-a; senão, usa `RAIZ_APP /
    ".env"` — a pasta que contém o pacote `app` (`backend/` em
    desenvolvimento, `tomazia_api/` em produção), não a pasta de trabalho
    do processo. Isto é o que permite ao `passenger_wsgi.py` fazer
    `os.chdir(BASE_DIR)` sem que `Definicoes` passe a procurar o `.env` na
    pasta de trabalho errada, e o que permite aos testes isolarem-se do
    `.env` real do repositório apontando `TOMAZIA_ENV_FILE` para um
    caminho inexistente, independentemente da pasta de trabalho.
    """
    variavel = os.environ.get("TOMAZIA_ENV_FILE")
    if variavel:
        return Path(variavel)
    return RAIZ_APP / ".env"


def _normalizar_segredo_para_comparacao(valor: str) -> str:
    """Normaliza um segredo só para o comparar com valores inseguros conhecidos.

    Tira espaços nas pontas, tira os sinais `<` e `>` que sobram de quem
    copiou o placeholder do `.env.example` e apagou só parte dele, e
    ignora maiúsculas/minúsculas. Usa-se apenas para decidir se o valor é
    o de omissão ou o placeholder; o `segredo_sessao` guardado nunca passa
    por esta normalização.
    """
    return valor.strip().strip("<>").strip().lower()


class Definicoes(BaseSettings):
    """Definições da aplicação, lidas de variáveis de ambiente."""

    model_config = SettingsConfigDict(env_file_encoding="utf-8", extra="ignore")

    ambiente: Literal["desenvolvimento", "producao"] = "desenvolvimento"
    data_dir: Path = Path("./var")
    media_dir: Path = Path("./var/media")
    base_dados_url: str = "sqlite:///./var/dev.db"
    segredo_sessao: str = SEGREDO_SESSAO_OMISSAO

    @property
    def pendentes_dir(self) -> Path:
        return self.data_dir / "pendentes"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @model_validator(mode="after")
    def _impedir_segredo_omissao_em_producao(self) -> Definicoes:
        if self.ambiente != "producao":
            return self

        segredo = self.segredo_sessao.strip()
        segredo_normalizado = _normalizar_segredo_para_comparacao(self.segredo_sessao)
        omissao_normalizada = _normalizar_segredo_para_comparacao(
            SEGREDO_SESSAO_OMISSAO
        )
        placeholder_normalizado = _normalizar_segredo_para_comparacao(
            SEGREDO_SESSAO_PLACEHOLDER_ENV_EXAMPLE
        )
        invalido = (
            not segredo_normalizado
            or segredo_normalizado in (omissao_normalizada, placeholder_normalizado)
            or len(segredo) < SEGREDO_SESSAO_TAMANHO_MINIMO
        )
        if invalido:
            raise ValueError(
                "Em produção é obrigatório definir SEGREDO_SESSAO com um "
                "valor próprio, com pelo menos "
                f"{SEGREDO_SESSAO_TAMANHO_MINIMO} caracteres; o valor de "
                "omissão de desenvolvimento e o placeholder do "
                "`.env.example` não são seguros. Gera um valor próprio com "
                "o comando descrito em `backend/.env.example`: "
                'python -c "import secrets; '
                'print(secrets.token_urlsafe(48))"'
            )
        return self


@lru_cache
def obter_definicoes() -> Definicoes:
    return Definicoes(_env_file=_caminho_ficheiro_de_ambiente())
