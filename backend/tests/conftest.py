"""Fixtures partilhadas por todos os testes do backend.

Garantem que nenhum teste lê ou escreve o `.env` real do repositório nem a
pasta `var/` de desenvolvimento, e que a cache de `obter_definicoes()` (um
`lru_cache`) nunca "vaza" definições de um teste para o seguinte.

Desde a F1-02, `app/config.py` resolve o ficheiro de ambiente a partir de
`TOMAZIA_ENV_FILE` (ou de `RAIZ_APP / ".env"` se a variável não estiver
definida) em vez de um `env_file=".env"` fixo, relativo à pasta de trabalho.
Por isso o isolamento aqui aponta `TOMAZIA_ENV_FILE` para um caminho
inexistente dentro de `tmp_path`: fica mais forte do que antes, porque deixa
de depender do `chdir` para nenhum teste encontrar, por acidente, o `.env`
real do repositório.

Também desde a F1-02 (achado da quarta ronda), `ambiente` deixa de ter um
valor por omissão em `Definicoes`: sem `AMBIENTE` definido em lado nenhum,
`obter_definicoes()` rebenta com `pydantic.ValidationError` ("Field
required"), não cai num valor "seguro" qualquer. Por isso esta fixture
define `AMBIENTE=desenvolvimento` explicitamente — o valor que todos os
testes que não mexem nele esperam — em vez de só o apagar como fazia antes
de `ambiente` passar a obrigatório. Testes que precisem de outro ambiente
(ou de testar a ausência da variável) continuam a sobrepor-se com o seu
próprio `monkeypatch.setenv`/`monkeypatch.delenv`, depois desta fixture
correr.
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

    # `ambiente` não tem valor por omissão em `Definicoes` (achado da quarta
    # ronda da F1-02): sem isto, qualquer teste que não defina AMBIENTE por
    # si próprio passaria a rebentar com "Field required" em vez de herdar
    # "desenvolvimento" como antes.
    monkeypatch.setenv("AMBIENTE", "desenvolvimento")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "var"))
    # Caminho inexistente de propósito: nenhum `.env` lá para ser lido.
    # Independente do `chdir` acima — mesmo que um teste mude de pasta de
    # trabalho depois, o ficheiro de ambiente real do repositório nunca
    # entra em jogo.
    monkeypatch.setenv(
        "TOMAZIA_ENV_FILE", str(tmp_path / "isolamento-de-testes-nao-existe" / ".env")
    )

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()
    yield
    obter_definicoes.cache_clear()
