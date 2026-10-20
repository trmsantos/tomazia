"""Configuração da aplicação, lida de variáveis de ambiente.

Os valores por omissão são seguros para desenvolvimento local: apontam
para pastas e ficheiros dentro de `./var`, nunca para a base de dados
antiga nem para segredos reais. Em produção, as variáveis de ambiente
reais (definidas no `.env` do servidor, nunca neste repositório)
sobrepõem-se a estes valores.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SEGREDO_SESSAO_OMISSAO = "desenvolvimento-sem-segredo"
SEGREDO_SESSAO_PLACEHOLDER_ENV_EXAMPLE = "<gera-um-segredo-com-o-comando-acima>"
SEGREDO_SESSAO_TAMANHO_MINIMO = 32


class Definicoes(BaseSettings):
    """Definições da aplicação, lidas de variáveis de ambiente."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

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
        invalido = (
            not segredo
            or segredo.lower() == SEGREDO_SESSAO_OMISSAO.lower()
            or segredo == SEGREDO_SESSAO_PLACEHOLDER_ENV_EXAMPLE
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
    return Definicoes()
