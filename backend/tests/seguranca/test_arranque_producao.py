"""Testes de segurança do arranque em produção.

Prendem o contrato de dois bloqueantes encontrados na ronda de correções
da F1-01:

1. **A guarda de produção tem de correr no arranque a sério.** `app.main`
   chama `obter_definicoes()` ao nível do módulo, dentro de `criar_app()`,
   e `app = criar_app()` corre à importação — por isso tanto chamar
   `criar_app()` diretamente como importar `app.main` do zero, sob
   `AMBIENTE=producao` com um `SEGREDO_SESSAO` inseguro, têm de rebentar
   com `pydantic.ValidationError` antes de qualquer rota responder.
2. **A guarda rejeita mais do que uma cadeia exata.** `""`, `"   "`,
   variações de maiúsculas/minúsculas, um espaço à direita, o placeholder
   do `backend/.env.example` (com ou sem os sinais `<>`) e qualquer valor
   com menos de 32 caracteres são todos rejeitados em produção.

Contrato que o validador implementa (`app.config._impedir_segredo_omissao_em_producao`):
em produção, o `SEGREDO_SESSAO` é normalizado com `.strip()`, depois
`.strip("<>")` (tira sinais `<`/`>` nas pontas, para apanhar quem copiou o
placeholder do `.env.example` e apagou só parte dele) e `.lower()`; rejeita
se o resultado normalizado for igual ao valor de omissão normalizado ou ao
placeholder normalizado, e rejeita sempre que o valor (só com `.strip()`,
sem a normalização de `<>`/maiúsculas) tenha menos de 32 caracteres.
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

    Os dois testes a seguir exercitam caminhos diferentes do mesmo
    bloqueante, de propósito: `criar_app()` chamada diretamente (a
    fábrica, isolada), e o import de `app.main` seguido do arranque do
    `TestClient` (o caminho que o Passenger exercita a sério). Se só um
    deles rebentasse, o outro caminho de arranque ficaria sem prova.
    """

    def test_criar_app_rebenta_com_segredo_de_omissao_em_producao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`criar_app()` sozinha tem de rebentar quando chamada em produção insegura.

        Importa `app.main` primeiro sob um ambiente seguro (desenvolvimento,
        fora do `pytest.raises`): só assim o import pode suceder sem
        levantar nada, deixando o módulo carregado e `criar_app` acessível.
        Só depois muda para `AMBIENTE=producao` com o segredo de omissão,
        limpa a cache de `obter_definicoes`, e chama `modulo.criar_app()`
        diretamente — sem reimportar o módulo — dentro do `pytest.raises`.

        Isto corrige um furo da ronda anterior: lá, o import inseguro e a
        chamada a `criar_app()` estavam os dois dentro do mesmo
        `pytest.raises`; como `app = criar_app()` corre ao nível do módulo
        durante o import, a exceção vinha sempre do import, e
        `modulo.criar_app()` nunca chegava a ser executado — o teste
        passava pela razão errada (ou antes, nem chegava a exercitar o que
        o nome promete). Separando os dois, é mesmo a chamada à fábrica que
        fica provada aqui.
        """
        monkeypatch.setenv("AMBIENTE", "desenvolvimento")
        monkeypatch.delenv("SEGREDO_SESSAO", raising=False)
        _limpar_cache_definicoes()
        modulo = _reimportar_app_main()

        monkeypatch.setenv("AMBIENTE", "producao")
        # SEGREDO_SESSAO fica por definir de propósito: fica com o valor de
        # omissão de desenvolvimento, que a guarda de produção rejeita.
        _limpar_cache_definicoes()

        with pytest.raises(pydantic.ValidationError):
            modulo.criar_app()

    def test_importar_app_main_e_arrancar_testclient_rebenta_em_producao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Reproduz o que o Passenger faz a sério: importar o módulo e arrancar.

        Prende o cenário completo do bloqueante: com `AMBIENTE=producao` e o
        segredo de omissão, nem o import do módulo (que corre `app =
        criar_app()`) nem o arranque do `lifespan` (dentro do `with
        TestClient(...)`) podem terminar com sucesso — o import tem de
        rebentar antes de o `TestClient` chegar a responder a nada.
        """
        monkeypatch.setenv("AMBIENTE", "producao")
        _limpar_cache_definicoes()

        from fastapi.testclient import TestClient

        with pytest.raises(pydantic.ValidationError):
            modulo = _reimportar_app_main()
            with TestClient(modulo.app) as cliente:
                cliente.get("/")


class TestRigorDoSegredoDeSessaoEmProducao:
    """Bloqueante 2: a guarda tem de rejeitar mais do que uma cadeia exata.

    Cada valor de `segredo_sessao` a seguir tem de ser rejeitado por uma
    cláusula diferente do validador, isolada das outras: nenhum teste deve
    passar só porque uma cláusula mais genérica (tipicamente o mínimo de
    32 caracteres) apanha o valor primeiro, escondendo que a cláusula que o
    nome do caso promete nem está a ser exercitada.
    """

    @pytest.mark.parametrize(
        "segredo_sessao",
        [
            pytest.param("", id="vazio"),
            pytest.param(
                " " * 40,
                id="so-espacos-apos-strip-fica-vazio",
                # 40 caracteres (>= 32): sem o `.strip()` inicial, isto não é
                # nem vazio, nem igual ao valor de omissão ou ao placeholder
                # (depois de normalizados), nem demasiado curto — passaria.
                # Só o `.strip()` o reduz a "" para a cláusula do vazio
                # apanhar. (O caso anterior, `"   "` com 3 espaços, era
                # apanhado pelo mínimo de 32 caracteres antes de chegar a
                # exercitar o `.strip()` — não provava nada sobre ele.)
            ),
            pytest.param(
                "desenvolvimento-sem-segredo ",
                id="valor-de-omissao-com-espaco-a-direita",
            ),
            pytest.param(
                "<<<DESENVOLVIMENTO-SEM-SEGREDO>>>",
                id="valor-de-omissao-em-maiusculas-com-sinais-de-fronteira",
                # 33 caracteres (>= 32): os sinais `<<<`/`>>>` só servem para
                # ultrapassar o mínimo sem mudar o valor depois de
                # normalizado — `.strip("<>")` tira-os, `.lower()` iguala as
                # maiúsculas, e o resultado fica igual ao valor de omissão.
                # Sem a comparação sem maiúsculas (ou sem o `.strip("<>")`
                # desta normalização), nada mais aqui o apanha: nem o
                # tamanho (33 >= 32), nem a comparação com o placeholder.
                #
                # Nota para quem rever este teste: o valor original sugerido
                # para este caso era `"DESENVOLVIMENTO-SEM-SEGREDO" +
                # "-xxxxx"` (33 caracteres). Verificado empiricamente: esse
                # valor nunca é rejeitado, em nenhuma versão do validador,
                # porque o sufixo `"-xxxxx"` torna-o literalmente diferente
                # do valor de omissão mesmo depois de ignorar maiúsculas —
                # não há normalização nenhuma (presente ou removida) que os
                # iguale. Substituído por este valor, que isola a cláusula a
                # sério.
            ),
            pytest.param(
                "<gera-um-segredo-com-o-comando-acima>",
                id="placeholder-literal-do-env-example",
            ),
            pytest.param(
                "gera-um-segredo-com-o-comando-acima",
                id="placeholder-sem-sinais-de-fronteira-minusculas",
                # Furo confirmado pelo Tomás: o placeholder do
                # `.env.example` sem os sinais `<>` (quem edita o
                # ficheiro-exemplo e apaga só os sinais, sem substituir o
                # resto) tem 35 caracteres — passa o mínimo — e era aceite
                # em produção antes desta normalização comparar também a
                # forma sem sinais.
            ),
            pytest.param(
                "GERA-UM-SEGREDO-COM-O-COMANDO-ACIMA",
                id="placeholder-sem-sinais-de-fronteira-maiusculas",
            ),
            pytest.param("a" * 31, id="demasiado-curto-31-caracteres"),
            pytest.param(
                "  <<<desenvolvimento-sem-segredo>>>  ",
                id="valor-de-omissao-com-espacos-fora-dos-sinais-de-fronteira",
                # Prende o `.strip()` inicial de `_normalizar_segredo_para_comparacao`
                # (`valor.strip().strip("<>").strip().lower()`): aqui os espaços
                # ficam por FORA dos sinais `<<<`/`>>>`, não dentro deles. Sem
                # aquele primeiro `.strip()`, o `.strip("<>")` seguinte não morde
                # (as pontas da cadeia são espaços, não `<`/`>`), e o `.strip()`
                # final só tira os espaços, deixando `segredo_normalizado` igual a
                # `"<<<desenvolvimento-sem-segredo>>>"` — diferente do valor de
                # omissão normalizado, e nenhuma outra cláusula o apanha (37
                # caracteres brutos, 33 depois do `.strip()` usado para `segredo`,
                # ambos acima do mínimo de 32). Hoje, com o `.strip()` inicial
                # presente, este teste já passa — é o caso de controlo que prova
                # que essa chamada faz trabalho real, não código morto.
            ),
            pytest.param(
                "<" * 40,
                id="apenas-sinais-de-fronteira-fica-vazio-apos-normalizar",
                # Confirmado pelo revisor de segurança: este valor ARRANCA em
                # produção com a cláusula `not segredo` (comparada com a cadeia
                # só com `.strip()`, sem a normalização de `<`/`>`): `segredo`
                # tem 40 caracteres (não vazio, e acima do mínimo de 32), por
                # isso nem `not segredo` nem `len(segredo) < 32` disparam. Mas
                # `segredo_normalizado` (que tira também os sinais `<`/`>`) fica
                # `""`, porque a cadeia inteira é feita desses sinais — um
                # segredo degenerado que devia ser rejeitado. A cláusula correta
                # testa `not segredo_normalizado`, não `not segredo`.
            ),
            pytest.param(
                "<>" * 18,
                id="sinais-de-fronteira-alternados-fica-vazio-apos-normalizar",
                # Mesmo furo que o caso anterior, com os sinais alternados em
                # vez de só `<`: 36 caracteres brutos (acima do mínimo), e
                # `segredo_normalizado` também fica `""` depois do
                # `.strip("<>")`, porque toda a cadeia é feita de `<`/`>`.
            ),
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

    def test_segredo_com_exatamente_32_caracteres_e_aceite_em_producao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Caso de fronteira: exatamente 32 caracteres (o mínimo) tem de ser aceite.

        Antes só havia um caso de tamanho junto à fronteira: 31 caracteres,
        rejeitado (acima, `demasiado-curto-31-caracteres`), e 34 caracteres,
        aceite (`test_config.py::test_producao_com_segredo_sessao_proprio_arranca`).
        Nenhum exercitava o valor exatamente no limite — `len(segredo) < 32`
        rejeita 31 e aceita 32; um `<=` por engano (ou um `+ 1` a mais nessa
        comparação) rejeitaria também este caso, e só este teste o prende.
        """
        monkeypatch.setenv("AMBIENTE", "producao")
        monkeypatch.setenv("SEGREDO_SESSAO", "a" * 32)
        _limpar_cache_definicoes()

        from app.config import obter_definicoes

        definicoes = obter_definicoes()

        assert definicoes.segredo_sessao == "a" * 32
