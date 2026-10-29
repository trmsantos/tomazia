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

# As fixtures da F2-08 — a base de dados antiga **falsa**, o destino em
# `head` e a corrida feliz — vivem em `tests/apoio_legado.py` e registam-se
# aqui, não dentro de `tests/test_importar_bd_antiga.py`: importar uma
# fixture para dentro do módulo que a usa faz o nome da fixture e o nome do
# parâmetro do teste colidirem (F811 no ruff), e é por isso que as de HTTP
# também se registam num `conftest.py` e não no ficheiro de testes. Este
# conftest é o de `tests/`, por isso vale para `tests/seguranca/` também.
#
# Nenhuma é `autouse` e nenhuma constrói coisa nenhuma até alguém a pedir:
# os testes que já existem continuam a correr exatamente como antes.
from tests.apoio_legado import (  # noqa: F401 - o import é o registo das fixtures
    _destino_modelo_em_head,
    cenario_feliz,
    destino_em_head,
    media_dir,
    origem_falsa,
    pasta_de_imagens,
)

VARIAVEIS_DE_DEFINICOES = (
    "AMBIENTE",
    "DATA_DIR",
    "MEDIA_DIR",
    "BASE_DADOS_URL",
    "SEGREDO_SESSAO",
)


def _limpar_cache_do_motor() -> None:
    """Limpa a cache de `app.db.obter_engine()`, que também é um `lru_cache`.

    Sem isto, o primeiro teste a chamar `obter_engine()` fixava o motor (e
    com ele o ficheiro de base de dados dentro do seu `tmp_path`, já
    apagado) para toda a sessão de testes — exatamente o problema que
    `obter_definicoes.cache_clear()` resolve para a configuração.

    Tanto o `import app.db` como o acesso a `obter_engine` são
    deliberadamente **sem guarda**. Um `app/db.py` partido (erro de
    sintaxe, dependência em falta) ou sem o nome `obter_engine` tem de
    rebentar aqui, em voz alta. Enquanto a F2-01 não aterrou, a ausência
    do nome era tolerada com um `getattr`; agora que aterrou, essa
    tolerância passaria a confundir "ainda não existe" com "alguém
    renomeou", que é o que a regra 10 do `CLAUDE.md` proíbe — e o preço
    seria a suite inteira a correr, em silêncio, com um motor apontado a
    um `tmp_path` já apagado.
    """
    import app.db

    app.db.obter_engine.cache_clear()


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
      escrever na pasta `var/` de desenvolvimento do repositório, e **cria**
      a pasta: o SQLite não cria a pasta do ficheiro da base de dados.
    - Aponta `BASE_DADOS_URL` para um ficheiro dentro dessa pasta. Em
      ficheiro, nunca `:memory:` — ver `backend/CLAUDE.md`.
    - Limpa a cache de `obter_definicoes()` e de `obter_engine()` antes e
      depois do teste, já
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
    pasta_var = tmp_path / "var"
    # A pasta tem de existir mesmo: o valor por omissão de `base_dados_url`
    # (`sqlite:///./var/dev.db`) aponta para uma pasta que ninguém cria, e o
    # SQLite não a cria sozinho — o primeiro teste a tocar na base de dados
    # rebentava com "unable to open database file", um erro que não diz nada
    # sobre o que o teste queria provar.
    pasta_var.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("DATA_DIR", str(pasta_var))
    # Uma base de dados por teste, **em ficheiro**, dentro de `tmp_path` —
    # nunca `:memory:` (ver `backend/CLAUDE.md`). `PRAGMA journal_mode=WAL`
    # numa base de dados em memória devolve `memory`, nunca `wal` (medido,
    # SQLite 3.50.4), e o guarda do WAL em `app/db.py` recusa uma base de
    # dados que não consiga pôr em WAL: um teste sobre `:memory:` rebentaria
    # no guarda, não no que queria provar.
    monkeypatch.setenv("BASE_DADOS_URL", f"sqlite:///{pasta_var / 'teste.db'}")
    # Caminho inexistente de propósito: nenhum `.env` lá para ser lido.
    # Independente do `chdir` acima — mesmo que um teste mude de pasta de
    # trabalho depois, o ficheiro de ambiente real do repositório nunca
    # entra em jogo.
    monkeypatch.setenv(
        "TOMAZIA_ENV_FILE", str(tmp_path / "isolamento-de-testes-nao-existe" / ".env")
    )

    from app.config import obter_definicoes

    _limpar_cache_do_motor()
    obter_definicoes.cache_clear()
    yield
    _limpar_cache_do_motor()
    obter_definicoes.cache_clear()
