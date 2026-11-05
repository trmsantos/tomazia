"""Fixtures de HTTP partilhadas pelas baterias que falam com a app pela rede.

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_esquema.py` e `tests/apoio_subprocesso.py` não são. As
fixtures daqui são importadas pelos `conftest.py` que precisam delas
(`tests/publico/`, `tests/seguranca/`), em vez de viverem num conftest
só — `tests/seguranca/test_s09_*.py` precisa exatamente das mesmas, e
duplicá-las era garantir que as duas cópias divergiam.

## Porque é que `cliente` é parametrizada por origem do esquema

Pela mesma razão que a fixture `motor` de `tests/modelos/conftest.py`: cada
teste corre **duas vezes**, uma com o esquema construído pelos modelos
(`Base.metadata.create_all`) e outra com o esquema construído pela migração
(`alembic upgrade head`). Os identificadores ficam `[modelos]` e
`[migracao]`.

Aqui a razão é ainda mais direta do que lá: o que o servidor tem é o
esquema da migração, e uma rota pública só está provada quando se provou
que **esse** esquema a consegue servir. Uma coluna que exista no modelo e
não na migração dá `no such column` em produção e verde em
desenvolvimento.

O custo é um `alembic upgrade head` por sessão de testes e por conftest que
importe estas fixtures, não por teste: o ficheiro é construído uma vez e
copiado para cada teste.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import Engine, event, make_url
from sqlalchemy.orm import Session

from tests import apoio_esquema

if TYPE_CHECKING:  # pragma: no cover - só para anotações
    from fastapi.testclient import TestClient

#: Os dois caminhos por onde o esquema pode nascer.
ORIGENS_DO_ESQUEMA = ("modelos", "migracao")

TABELAS_ESPERADAS = frozenset(
    {
        "categorias",
        "produtos",
        "eventos",
        "fotos",
        "clientes",
        "admins",
        "definicoes",
        # F2-06: sustenta o limite de 5 envios por hora por IP, contando
        # tentativas (não só envios aceites) — ver `app/models/limites.py`.
        "tentativas_de_envio",
    }
)


@pytest.fixture(scope="session")
def _bd_modelo_em_head(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    """Uma base de dados em head, construída uma vez por sessão de testes.

    Cópia deliberada da fixture homónima de `tests/modelos/conftest.py`,
    incluindo o `chmod` da pasta: este caminho é devolvido a todos os
    testes da sessão, e um teste que lhe chame `criar_engine` — que força o
    WAL — deixava lá sidecars e contaminava todas as cópias seguintes.
    Pôr o ficheiro a `0444` não chega, porque criar sidecars depende das
    permissões da **pasta**.
    """
    pasta = tmp_path_factory.mktemp("esquema-em-head-para-http")
    modelo = apoio_esquema.construir_bd_com_alembic(pasta / "modelo.db")
    pasta.chmod(0o555)
    try:
        yield modelo
    finally:
        pasta.chmod(0o755)


@pytest.fixture(params=ORIGENS_DO_ESQUEMA)
def origem_do_esquema(request: pytest.FixtureRequest) -> str:
    """`"modelos"` ou `"migracao"` — o parâmetro que duplica cada teste."""
    assert isinstance(request.param, str)
    return request.param


def _caminho_da_base_de_dados() -> Path:
    from app.config import obter_definicoes

    url = make_url(obter_definicoes().base_dados_url)
    assert url.database is not None, (
        "BASE_DADOS_URL não aponta para um ficheiro; os testes do backend "
        "nunca usam `:memory:` (ver backend/CLAUDE.md)"
    )
    return Path(url.database)


def _exigir_as_tabelas_esperadas(motor_da_sessao: Engine, origem: str) -> None:
    from sqlalchemy import inspect

    tabelas = set(inspect(motor_da_sessao).get_table_names()) - {"alembic_version"}
    assert tabelas == set(TABELAS_ESPERADAS), (
        f"o esquema construído por `{origem}` tem {sorted(tabelas)} em vez "
        f"das {len(TABELAS_ESPERADAS)} tabelas esperadas. A falha é da "
        "fixture, não do teste"
    )


@pytest.fixture
def motor(request: pytest.FixtureRequest, origem_do_esquema: str) -> Iterator[Engine]:
    """O motor da aplicação, sobre um esquema vindo de uma das duas origens."""
    from app.db import Base, obter_engine

    # Importar cada módulo explicitamente, em vez de contar com o que
    # `app/models/__init__.py` reexporte: um `__init__.py` que se esqueça
    # de um agregado deixaria `Base.metadata` incompleto e `create_all`
    # criaria menos tabelas, em silêncio.
    from app.models import (  # noqa: F401 - o import é o efeito que queremos
        admins,
        clientes,
        definicoes,
        ementa,
        eventos,
        fotos,
        limites,
    )

    if origem_do_esquema == "migracao":
        # Pedido aqui, e não na assinatura, para quem corra só
        # `-k modelos` não pagar o subprocesso do Alembic, e para uma
        # migração partida deixar vermelha só a metade `[migracao]`.
        modelo = request.getfixturevalue("_bd_modelo_em_head")
        destino = _caminho_da_base_de_dados()
        apoio_esquema.exigir_destino_sem_vestigios(destino)
        # Antes de `obter_engine()`: o motor é preguiçoso e ainda não
        # abriu o ficheiro, por isso a cópia não passa por baixo de uma
        # ligação aberta.
        shutil.copyfile(modelo, destino)

    motor_da_sessao = obter_engine()

    if origem_do_esquema == "modelos":
        Base.metadata.create_all(motor_da_sessao)

    _exigir_as_tabelas_esperadas(motor_da_sessao, origem_do_esquema)

    yield motor_da_sessao
    motor_da_sessao.dispose()


@pytest.fixture
def sessao(motor: Engine) -> Iterator[Session]:
    """Sessão para **semear** dados, separada da que a app usa no pedido.

    De propósito: a app abre a sua própria sessão por pedido
    (`app.db.obter_sessao`). Semear por esta e ler pela da app é o que
    prova que os dados foram mesmo escritos no ficheiro, e não que ficaram
    na identity map de uma sessão partilhada.
    """
    with Session(motor) as sessao_de_teste:
        yield sessao_de_teste


@pytest.fixture
def cliente(motor: Engine) -> Iterator[TestClient]:
    """Um `TestClient` sobre uma app acabada de criar.

    `criar_app()` e não `app.main.app`: a app do módulo é construída à
    importação, uma só vez por processo, e os testes de enumeração de rotas
    precisam de ver a app que a configuração **deste** teste produz.

    Depende de `motor` para o esquema existir antes do primeiro pedido.
    """
    from fastapi.testclient import TestClient

    from app.main import criar_app

    with TestClient(criar_app()) as cliente_de_teste:
        yield cliente_de_teste


class ContadorDeSQL:
    """Conta instruções SQL emitidas pelo motor, por pedido.

    Só conta dentro de `with contador.a_contar():`. Fora disso fica calado,
    para o SQL do próprio teste (semear dados) não entrar na conta.

    Os três PRAGMAs de `app/db.py` **não** contam: correm no evento
    `connect`, com um cursor cru do DBAPI, fora do caminho que dispara
    `before_cursor_execute` (confirmado pelos números deste contador).
    """

    def __init__(self) -> None:
        self.instrucoes: list[str] = []
        self._ligado = False

    @contextmanager
    def a_contar(self) -> Iterator[list[str]]:
        self.instrucoes = []
        self._ligado = True
        try:
            yield self.instrucoes
        finally:
            self._ligado = False

    def registar(self, instrucao: str) -> None:
        if self._ligado:
            self.instrucoes.append(instrucao)

    def resumo(self) -> str:
        linhas = "\n".join(f"  {i + 1}. {s}" for i, s in enumerate(self.instrucoes))
        return f"{len(self.instrucoes)} instruções:\n{linhas}"


@pytest.fixture
def contador_de_sql(motor: Engine) -> Iterator[ContadorDeSQL]:
    """Ouve `before_cursor_execute` no motor da app e conta as instruções."""
    contador = ContadorDeSQL()

    def ouvinte(
        _ligacao: Any,
        _cursor: Any,
        instrucao: str,
        _parametros: Any,
        _contexto: Any,
        _muitos: bool,
    ) -> None:
        contador.registar(instrucao)

    event.listen(motor, "before_cursor_execute", ouvinte)
    try:
        yield contador
    finally:
        event.remove(motor, "before_cursor_execute", ouvinte)
