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
from typing import Any, Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.caminhos import RAIZ_APP

SEGREDO_SESSAO_OMISSAO = "desenvolvimento-sem-segredo"
SEGREDO_SESSAO_PLACEHOLDER_ENV_EXAMPLE = "<gera-um-segredo-com-o-comando-acima>"
SEGREDO_SESSAO_TAMANHO_MINIMO = 32

MENSAGEM_AMBIENTE_OBRIGATORIO = (
    "A variável de ambiente AMBIENTE é obrigatória; os valores aceites são "
    "'desenvolvimento' ou 'producao'. Define-a no ficheiro de ambiente "
    "(`.env` em desenvolvimento, o `.env` do servidor em produção) antes de "
    "voltar a correr este comando."
)


def caminho_ficheiro_de_ambiente() -> Path:
    """Resolve o ficheiro de ambiente a usar, sempre para um caminho absoluto.

    Se `TOMAZIA_ENV_FILE` estiver definida, usa-a; senão, usa `RAIZ_APP /
    ".env"` — a pasta que contém o pacote `app` (`backend/` em
    desenvolvimento, `tomazia_api/` em produção), não a pasta de trabalho
    do processo. Isto é o que permite ao `passenger_wsgi.py` fazer
    `os.chdir(BASE_DIR)` sem que `Definicoes` passe a procurar o `.env` na
    pasta de trabalho errada, e o que permite aos testes isolarem-se do
    `.env` real do repositório apontando `TOMAZIA_ENV_FILE` para um
    caminho inexistente, independentemente da pasta de trabalho.

    Um valor relativo em `TOMAZIA_ENV_FILE` continuaria relativo à pasta de
    trabalho do processo nesse preciso momento se não passasse por
    `.resolve()` aqui — é esta chamada que garante o caminho absoluto, não
    o facto de a variável "parecer" vir de outro lado.
    """
    variavel = os.environ.get("TOMAZIA_ENV_FILE")
    if variavel:
        return Path(variavel).resolve()
    return RAIZ_APP / ".env"


# Nome privado antigo, mantido como alias: `tests/seguranca/test_arranque_passenger.py`
# importa-o diretamente (`test_tomazia_env_file_relativo_fica_resolvido_para_absoluto`)
# e essa suite não se altera nesta ronda. `passenger_wsgi.py` — o módulo que
# promoveu esta função de detalhe interno a dependência entre módulos — usa
# só o nome público.


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

    # Sem valor por omissão, de propósito (achado da quarta ronda de
    # correções da F1-02): com um valor por omissão qualquer, um ficheiro de
    # ambiente vazio, só com comentários, sem a linha AMBIENTE, ou com uma
    # gralha na chave (que `extra="ignore"` engole em silêncio) arrancava
    # sempre em desenvolvimento — com o segredo de desenvolvimento publicado
    # no repositório e a documentação toda aberta, mesmo com um ficheiro de
    # ambiente que existe e passa as guardas de `passenger_wsgi.py`. Tornar o
    # campo obrigatório fecha isto em `Definicoes`, não só no Passenger: também
    # protege o SSH, `python -m app.openapi`, o Alembic e scripts futuros que
    # importem `app.config` diretamente.
    ambiente: Literal["desenvolvimento", "producao"]
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

    @model_validator(mode="before")
    @classmethod
    def _exigir_ambiente(cls, dados: Any) -> Any:
        """Troca o "Field required" genérico do pydantic por uma mensagem em PT-PT.

        Corre antes da validação de campos, sobre o dicionário já composto
        pelas fontes de `pydantic-settings` (ficheiro de ambiente e
        variáveis de processo); por isso `dados.get("ambiente")` aqui reflete
        exatamente o que `Literal["desenvolvimento", "producao"]` veria a
        seguir — incluindo os casos em que `ambiente` nunca chega a existir
        no dicionário (ficheiro vazio, só com comentários, sem a linha
        AMBIENTE, ou com uma gralha na chave que `extra="ignore"` engoliu).
        """
        if isinstance(dados, dict) and not dados.get("ambiente"):
            raise ValueError(MENSAGEM_AMBIENTE_OBRIGATORIO)
        return dados

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
    # O mypy sintetiza o `__init__` de `Definicoes` a partir dos campos
    # (PEP 681) e por isso não vê `_env_file`, uma chave privada que o
    # `BaseSettings` aceita em runtime para escolher o ficheiro de
    # ambiente a carregar.
    return Definicoes(_env_file=caminho_ficheiro_de_ambiente())  # type: ignore[call-arg]
