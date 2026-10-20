"""Testes de segurança do arranque sob o Passenger (F1-02).

Três falhas que vêm da revisão da F1-01 e que falham em silêncio — nenhuma
delas rebenta de forma óbvia se o bloqueante estiver presente, por isso cada
uma é pareada com um teste que prova o oposto, para que nenhum destes testes
passe só porque o cenário nunca chegou a ser exercitado a sério:

1. Teste estático (AST): nenhum import de `app` nem chamada a
   `obter_definicoes()` pode aparecer, em `passenger_wsgi.py`, antes do
   `os.chdir(...)` ao nível do módulo.
2. Prova comportamental: produção insegura tem de rebentar, mencionando
   `SEGREDO_SESSAO`, mesmo com `cwd` fora de `tomazia_api/` e com o
   ambiente do processo de testes completamente limpo.
3. Contrapositivo, obrigatório: o mesmo cenário, com um segredo forte,
   arranca e responde 200. Sem isto, o teste 2 passaria trivialmente mesmo
   que ninguém alguma vez lesse o ficheiro de ambiente.
4. `TOMAZIA_ENV_FILE`: `obter_definicoes()` lê o ficheiro apontado por essa
   variável, nunca um `.env` que esteja por acaso na pasta de trabalho.

Os testes 2 e 3 correm em subprocesso (ver `tests/apoio_subprocesso.py`):
importar `passenger_wsgi` dentro do processo de testes mudaria a pasta de
trabalho do processo de testes e importaria `app.main` sob produção,
contaminando tudo o que viesse a seguir.
"""

from __future__ import annotations

import ast
import secrets
from pathlib import Path

import pytest

from tests import apoio_subprocesso

RAIZ_BACKEND = Path(__file__).resolve().parent.parent.parent


def _contem_import_de_app(no: ast.AST) -> bool:
    for sub in ast.walk(no):
        if isinstance(sub, ast.Import) and any(
            alias.name == "app" or alias.name.startswith("app.") for alias in sub.names
        ):
            return True
        if (
            isinstance(sub, ast.ImportFrom)
            and sub.module
            and (sub.module == "app" or sub.module.startswith("app."))
        ):
            return True
    return False


def _contem_chamada_a_obter_definicoes(no: ast.AST) -> bool:
    for sub in ast.walk(no):
        if isinstance(sub, ast.Call):
            alvo = sub.func
            nome = (
                alvo.id
                if isinstance(alvo, ast.Name)
                else alvo.attr
                if isinstance(alvo, ast.Attribute)
                else None
            )
            if nome == "obter_definicoes":
                return True
    return False


def _contem_chamada_a_os_chdir(no: ast.AST) -> bool:
    for sub in ast.walk(no):
        if (
            isinstance(sub, ast.Call)
            and isinstance(sub.func, ast.Attribute)
            and sub.func.attr == "chdir"
            and isinstance(sub.func.value, ast.Name)
            and sub.func.value.id == "os"
        ):
            return True
    return False


def test_import_de_app_e_obter_definicoes_nunca_antes_do_os_chdir() -> None:
    """O único teste que apanha um `from app... import ...` acrescentado ao cabeçalho do ficheiro.

    `obter_definicoes()` tem `lru_cache`: se alguma coisa importar `app.config`
    (ou qualquer outro submódulo de `app`, direta ou indiretamente, incluindo
    através de uma chamada a `obter_definicoes()`) antes de `os.chdir(BASE_DIR)`
    e de `sys.path.insert(0, str(BASE_DIR))` correrem, o valor validado por
    `Definicoes` fica fixado para o processo inteiro — e a guarda de produção
    (que rejeita um `SEGREDO_SESSAO` inseguro) nunca mais dispara, porque a
    `Definicoes` real já foi construída, em cache, antes de o ambiente da
    aplicação (incluindo `TOMAZIA_ENV_FILE`, resolvido relativo a `BASE_DIR`)
    estar completo.
    """
    caminho = RAIZ_BACKEND / "passenger_wsgi.py"
    codigo_fonte = caminho.read_text(encoding="utf-8")
    arvore = ast.parse(codigo_fonte, filename=str(caminho))

    indice_chdir = next(
        (
            indice
            for indice, instrucao in enumerate(arvore.body)
            if _contem_chamada_a_os_chdir(instrucao)
        ),
        None,
    )
    assert indice_chdir is not None, (
        "passenger_wsgi.py tem de chamar os.chdir(...) ao nível do módulo"
    )

    for instrucao in arvore.body[:indice_chdir]:
        assert not _contem_import_de_app(instrucao), (
            "um import de `app` aparece antes do os.chdir(...) em "
            "passenger_wsgi.py — isto fixa a `Definicoes` em cache antes de "
            "o ambiente estar completo"
        )
        assert not _contem_chamada_a_obter_definicoes(instrucao), (
            "uma chamada a obter_definicoes() aparece antes do os.chdir(...) "
            "em passenger_wsgi.py — pelo mesmo motivo"
        )


def _preparar_cenario(tmp_path: Path, conteudo_env: str) -> tuple[Path, Path]:
    """Copia `tomazia_api/` falso para `tmp_path`, com um `.env` próprio, e uma `cwd` diferente."""
    pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
        tmp_path / "tomazia_api"
    )
    (pasta_tomazia_api / ".env").write_text(conteudo_env, encoding="utf-8")

    outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
    outra_pasta.mkdir()

    return pasta_tomazia_api, outra_pasta


def test_producao_com_segredo_inseguro_rebenta_e_stderr_menciona_segredo_sessao(
    tmp_path: Path,
) -> None:
    """Prova comportamental: produção insegura tem de rebentar, mencionando o `SEGREDO_SESSAO`.

    Falha se o `chdir` desaparecer de `passenger_wsgi.py` (o `app` deixa de
    ser importável e o erro passa a ser outro, nunca o de validação), se um
    import de `app` subir para o cabeçalho (nesse caso o teste AST já falha
    primeiro, mas aqui confirma-se que o comportamento também muda), ou se a
    resolução do ficheiro de ambiente voltar a ser relativa à pasta de
    trabalho (`outra_pasta`, aqui, não tem `.env` nenhum — só
    `pasta_tomazia_api/.env` tem).
    """
    pasta_tomazia_api, outra_pasta = _preparar_cenario(
        tmp_path, "AMBIENTE=producao\nSEGREDO_SESSAO=curto-demais\n"
    )

    resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
        pasta_tomazia_api=pasta_tomazia_api,
        cwd=outra_pasta,
        ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
        codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
    )

    assert resultado.returncode != 0
    assert "SEGREDO_SESSAO" in resultado.stderr


def test_producao_com_segredo_forte_arranca_e_health_responde_200(
    tmp_path: Path,
) -> None:
    """Contrapositivo, obrigatório: o mesmo cenário, com um segredo forte, tem de arrancar.

    Sem este teste, o anterior passaria trivialmente mesmo que o ficheiro de
    ambiente nunca fosse lido (bastaria `passenger_wsgi.py` rebentar sempre,
    por qualquer motivo). Os dois juntos é que provam alguma coisa: o
    `.env` de `tomazia_api/` é mesmo lido, e só o segredo é que decide se a
    produção arranca.
    """
    segredo_forte = secrets.token_urlsafe(48)
    pasta_tomazia_api, outra_pasta = _preparar_cenario(
        tmp_path, f"AMBIENTE=producao\nSEGREDO_SESSAO={segredo_forte}\n"
    )

    resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
        pasta_tomazia_api=pasta_tomazia_api,
        cwd=outra_pasta,
        ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
        codigo_depois_de_importar=apoio_subprocesso.codigo_chamar_wsgi(
            script_name="/api", path_info="/health", variavel_app="application"
        ),
    )

    assert resultado.returncode == 0, resultado.stderr
    assert "STATUS=200" in resultado.stdout


class TestTomaziaEnvFile:
    def test_obter_definicoes_le_o_ficheiro_apontado_por_tomazia_env_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        pasta_a = tmp_path / "a"
        pasta_b = tmp_path / "b"
        pasta_a.mkdir()
        pasta_b.mkdir()
        pasta_dados = pasta_a / "dados-de-a"
        (pasta_a / ".env").write_text(f"DATA_DIR={pasta_dados}\n", encoding="utf-8")

        monkeypatch.chdir(pasta_b)
        monkeypatch.setenv("TOMAZIA_ENV_FILE", str(pasta_a / ".env"))
        monkeypatch.delenv("DATA_DIR", raising=False)

        from app.config import obter_definicoes

        obter_definicoes.cache_clear()
        definicoes = obter_definicoes()

        assert definicoes.data_dir == pasta_dados

    def test_ficheiro_de_ambiente_na_pasta_de_trabalho_e_ignorado(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """No mesmo cenário, um `.env` em `b/` (a pasta de trabalho) é ignorado."""
        pasta_a = tmp_path / "a"
        pasta_b = tmp_path / "b"
        pasta_a.mkdir()
        pasta_b.mkdir()
        (pasta_a / ".env").write_text(
            "DATA_DIR=" + str(pasta_a / "dados-de-a") + "\n", encoding="utf-8"
        )
        (pasta_b / ".env").write_text("AMBIENTE=producao\n", encoding="utf-8")

        monkeypatch.chdir(pasta_b)
        monkeypatch.setenv("TOMAZIA_ENV_FILE", str(pasta_a / ".env"))
        monkeypatch.delenv("AMBIENTE", raising=False)

        from app.config import obter_definicoes

        obter_definicoes.cache_clear()
        definicoes = obter_definicoes()

        assert definicoes.ambiente == "desenvolvimento"
