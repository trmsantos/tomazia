"""Fixtures partilhadas por todos os testes do backend.

Garantem que nenhum teste lê ou escreve o `.env` real do repositório nem a
pasta `var/` de desenvolvimento, e que a cache de `obter_definicoes()` (um
`lru_cache`) nunca "vaza" definições de um teste para o seguinte.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

VARIAVEIS_DE_DEFINICOES = (
    "AMBIENTE",
    "DATA_DIR",
    "MEDIA_DIR",
    "BASE_DADOS_URL",
    "SEGREDO_SESSAO",
)


@pytest.fixture(autouse=True)
def isolar_definicoes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    """Isola cada teste da configuração do ambiente real.

    - Limpa as variáveis de ambiente de `Definicoes` antes de cada teste,
      para que nenhum valor deixado por um teste anterior (ou pelo
      ambiente de quem corre os testes) contamine o seguinte.
    - Muda a pasta de trabalho para um `tmp_path` vazio, para que, se
      `app.config` carregar um ficheiro `.env` relativo à pasta de
      trabalho, nunca encontre o `.env` real do repositório.
    - Aponta `DATA_DIR` para dentro desse `tmp_path`, para nenhum teste
      escrever na pasta `var/` de desenvolvimento do repositório.
    - Limpa a cache de `obter_definicoes()` antes e depois do teste, já
      que é decorada com `lru_cache` e, de outra forma, o primeiro teste a
      chamá-la "fixava" as definições para todos os testes seguintes.

    Testes que precisem de verificar os valores por omissão (sem nenhuma
    variável de ambiente definida) devem fazer o seu próprio
    `monkeypatch.delenv("DATA_DIR")` e voltar a limpar a cache.
    """
    for variavel in VARIAVEIS_DE_DEFINICOES:
        monkeypatch.delenv(variavel, raising=False)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "var"))

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()
    yield
    obter_definicoes.cache_clear()
