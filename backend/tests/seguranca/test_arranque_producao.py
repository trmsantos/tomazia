"""Testes de segurança do arranque em produção.

Prendem dois bloqueantes da ronda de correções da F1-01:

1. **A guarda de produção nunca corre no arranque.** `backend/app/main.py`
   só importa `fastapi`; nada no caminho de arranque toca em `app.config`,
   por isso o `model_validator` de `Definicoes` é código morto quando a
   app arranca a sério. Hoje, com `AMBIENTE=producao` e o `SEGREDO_SESSAO`
   por omissão, `from app.main import app` importa sem erro, o `lifespan`
   arranca e o `TestClient` responde 404 — devia rebentar antes disso.
2. **A guarda só rejeitava uma cadeia exata.** `""`, `"   "`, variações de
   maiúsculas/minúsculas, um espaço à direita e o placeholder literal do
   `backend/.env.example` passavam todos em produção.

Contrato que a correção implementa (e que estes testes assumem): em
produção o `SEGREDO_SESSAO` é comparado depois de `.strip()`, rejeita
vazio e só-espaços, rejeita o valor de omissão sem olhar a maiúsculas,
rejeita o placeholder do ficheiro-exemplo e exige pelo menos 32
caracteres.
"""

from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from types import ModuleType

import pydantic
import pytest


def _limpar_cache_definicoes() -> None:
    from app.config import obter_definicoes

    obter_definicoes.cache_clear()


def _reimportar_app_main() -> ModuleType:
    """Força uma reexecução de `app.main`, como o Passenger faz a sério.

    `app.main` só é importado uma vez por processo: se o módulo já estiver
    em `sys.modules` (de um import anterior, sob outro ambiente), `import
    app.main` devolveria a mesma app já construída, sem nunca exercitar o
    arranque com o ambiente deste teste. Por isso remove-se o módulo da
    cache antes de o reimportar.
    """
    sys.modules.pop("app.main", None)
    return importlib.import_module("app.main")


@pytest.fixture(autouse=True)
def _isolar_app_main() -> Iterator[None]:
    """Garante que estes testes nunca dependem da ordem de recolha do pytest.

    `app.main` só executa o seu código de nível de módulo (incluindo `app =
    criar_app()`) da primeira vez que é importado no processo. Se outro
    ficheiro de testes o tivesse já importado com sucesso antes deste (sob
    um ambiente seguro), `import app.main` devolveria essa app em cache sem
    voltar a exercitar o arranque — e os testes deste ficheiro deixariam de
    rebentar. Por isso removem-se, antes e depois de cada teste, qualquer
    `app.main` que esteja em `sys.modules`, para cada teste reexecutar
    sempre o módulo do zero, sob o ambiente que ele próprio define, e para
    não deixar em cache uma app construída sob um `SEGREDO_SESSAO`
    inseguro para os testes seguintes.
    """
    sys.modules.pop("app.main", None)
    yield
    sys.modules.pop("app.main", None)


class TestArranqueRebentaEmProducaoComSegredoDeOmissao:
    """Bloqueante 1: o arranque tem de validar o `SEGREDO_SESSAO` a sério.

    Hoje nenhum destes dois testes rebenta: `criar_app()` devolve uma app
    utilizável e o `TestClient` arranca e responde 404. Os testes têm de
    falhar agora por isso — "não rebentou" —, não por erro de importação.
    """

    def test_criar_app_rebenta_com_segredo_de_omissao_em_producao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`criar_app()` sozinho, sem precisar de `TestClient`, tem de rebentar.

        Reimporta `app.main` do zero dentro do bloco que espera a exceção
        (a mesma ideia de `_reimportar_app_main()` usada no teste a seguir):
        assim o teste rebenta sempre por causa do `SEGREDO_SESSAO` inseguro,
        e não por depender de `app.main` ainda não ter sido importado por
        nenhum outro teste.
        """
        monkeypatch.setenv("AMBIENTE", "producao")
        # SEGREDO_SESSAO fica por definir de propósito: fica com o valor de
        # omissão de desenvolvimento, que a guarda de produção rejeita.
        _limpar_cache_definicoes()

        with pytest.raises(pydantic.ValidationError):
            modulo = _reimportar_app_main()
            modulo.criar_app()

    def test_importar_app_main_e_arrancar_testclient_rebenta_em_producao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Reproduz o que o Passenger faz a sério: importar o módulo e arrancar.

        Isto prende exatamente o cenário descrito no bloqueante: com
        `AMBIENTE=producao` e o segredo de omissão, nem o import do módulo
        nem o arranque do `lifespan` (dentro do `with TestClient(...)`)
        podem terminar com sucesso — hoje terminam os dois, e um pedido a
        `/` chega a responder 404.
        """
        monkeypatch.setenv("AMBIENTE", "producao")
        _limpar_cache_definicoes()

        from fastapi.testclient import TestClient

        with pytest.raises(pydantic.ValidationError):
            modulo = _reimportar_app_main()
            with TestClient(modulo.app) as cliente:
                cliente.get("/")


class TestRigorDoSegredoDeSessaoEmProducao:
    """Bloqueante 2: a guarda tem de rejeitar mais do que uma cadeia exata."""

    @pytest.mark.parametrize(
        "segredo_sessao",
        [
            pytest.param("", id="vazio"),
            pytest.param("   ", id="so-espacos"),
            pytest.param(
                "desenvolvimento-sem-segredo ",
                id="valor-de-omissao-com-espaco-a-direita",
            ),
            pytest.param(
                "DESENVOLVIMENTO-SEM-SEGREDO", id="valor-de-omissao-em-maiusculas"
            ),
            pytest.param(
                "<gera-um-segredo-com-o-comando-acima>",
                id="placeholder-literal-do-env-example",
            ),
            pytest.param("a" * 31, id="demasiado-curto-31-caracteres"),
        ],
    )
    def test_segredo_invalido_rebenta_em_producao(
        self, monkeypatch: pytest.MonkeyPatch, segredo_sessao: str
    ) -> None:
        monkeypatch.setenv("AMBIENTE", "producao")
        monkeypatch.setenv("SEGREDO_SESSAO", segredo_sessao)
        _limpar_cache_definicoes()

        from app.config import obter_definicoes

        with pytest.raises(pydantic.ValidationError):
            obter_definicoes()
