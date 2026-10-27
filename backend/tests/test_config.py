"""Testes do contrato de `app.config`.

Fixam os valores por omissão de desenvolvimento, a derivação de
`pendentes_dir`/`backups_dir` a partir de `data_dir`, a sobreposição por
variáveis de ambiente e a guarda que impede arrancar em produção com o
segredo de sessão de desenvolvimento.
"""

from __future__ import annotations

from pathlib import Path

import pydantic
import pytest


def test_omissoes_de_desenvolvimento(monkeypatch: pytest.MonkeyPatch) -> None:
    """Com o AMBIENTE definido e mais nada, valem os valores da tabela do contrato.

    O `ambiente` não entra nas asserções: deixou de ter valor por omissão e é
    a fixture que o define, por isso lê-lo aqui seria ler de volta o que ela
    pôs. Quem prende a obrigatoriedade é
    `tests/seguranca/test_arranque_passenger.py`.
    """
    # A fixture `isolar_definicoes` já aponta DATA_DIR e BASE_DADOS_URL para
    # dentro de um tmp_path, para nenhum teste escrever em `var/` nem abrir a
    # base de dados de desenvolvimento; aqui interessa-nos o valor por
    # omissão real da classe, por isso removemo-las antes de medir.
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("BASE_DADOS_URL", raising=False)

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()
    definicoes = obter_definicoes()

    assert definicoes.data_dir == Path("./var")
    assert definicoes.media_dir == Path("./var/media")
    assert definicoes.base_dados_url == "sqlite:///./var/dev.db"
    assert definicoes.segredo_sessao == "desenvolvimento-sem-segredo"


def test_pendentes_e_backups_derivados_de_data_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`pendentes_dir` e `backups_dir` são sempre `data_dir/pendentes` e `data_dir/backups`."""
    pasta_dados = tmp_path / "dados-personalizados"
    monkeypatch.setenv("DATA_DIR", str(pasta_dados))

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()
    definicoes = obter_definicoes()

    assert definicoes.data_dir == pasta_dados
    assert definicoes.pendentes_dir == pasta_dados / "pendentes"
    assert definicoes.backups_dir == pasta_dados / "backups"


def test_variaveis_de_ambiente_sobrepoem_se_as_omissoes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Cada variável de ambiente da tabela do contrato sobrepõe-se ao valor por omissão."""
    pasta_dados = tmp_path / "dados"
    pasta_media = tmp_path / "media-personalizada"

    monkeypatch.setenv("AMBIENTE", "desenvolvimento")
    monkeypatch.setenv("DATA_DIR", str(pasta_dados))
    monkeypatch.setenv("MEDIA_DIR", str(pasta_media))
    monkeypatch.setenv("BASE_DADOS_URL", "sqlite:///./outra-pasta/bd-de-teste.db")
    monkeypatch.setenv("SEGREDO_SESSAO", "segredo-de-teste-bem-comprido")

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()
    definicoes = obter_definicoes()

    assert definicoes.ambiente == "desenvolvimento"
    assert definicoes.data_dir == pasta_dados
    assert definicoes.media_dir == pasta_media
    assert definicoes.base_dados_url == "sqlite:///./outra-pasta/bd-de-teste.db"
    assert definicoes.segredo_sessao == "segredo-de-teste-bem-comprido"


def test_producao_sem_segredo_sessao_levanta_erro(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`AMBIENTE=producao` com o segredo de sessão de omissão tem de rebentar.

    Isto testa só o validador de `Definicoes`, chamando `obter_definicoes()`
    diretamente — não prova que o arranque real da app (`app.main`) o
    invoca. Essa cobertura está em
    `backend/tests/seguranca/test_arranque_producao.py`.
    """
    monkeypatch.setenv("AMBIENTE", "producao")
    # SEGREDO_SESSAO fica por definir de propósito: deve ficar com o valor
    # de omissão de desenvolvimento, que a guarda de produção rejeita.

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()

    with pytest.raises(pydantic.ValidationError):
        obter_definicoes()


def test_producao_com_segredo_sessao_proprio_arranca(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`AMBIENTE=producao` com um `SEGREDO_SESSAO` próprio não levanta erro nenhum."""
    monkeypatch.setenv("AMBIENTE", "producao")
    monkeypatch.setenv("SEGREDO_SESSAO", "segredo-forte-de-producao-de-teste")

    from app.config import obter_definicoes

    obter_definicoes.cache_clear()
    definicoes = obter_definicoes()

    assert definicoes.ambiente == "producao"
    assert definicoes.segredo_sessao == "segredo-forte-de-producao-de-teste"
