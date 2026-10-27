"""Os PRAGMAs de cada ligação SQLite (F2-01).

Três factos medidos nesta máquina (SQLite 3.50.4, SQLAlchemy 2.1.5) mandam
no desenho destes testes:

- `PRAGMA foreign_keys` numa ligação acabada de abrir devolve **0**. Sem o
  PRAGMA, uma chave estrangeira é decoração: o SQLite grava-a no DDL e não a
  verifica. Quem prova por comportamento que o PRAGMA está ligado é
  `tests/modelos/test_ementa.py::test_produto_com_categoria_inexistente_e_rejeitado`.
- `PRAGMA busy_timeout` devolve **5000 sem código nenhum nosso**, porque o
  `pysqlite` aplica o seu `timeout=5.0` por omissão. Isto é o que torna
  `test_ligacao_nova_tem_wal_fk_e_busy_timeout` insuficiente sozinho: a sua
  terceira asserção passa com o nosso código desligado.
  `test_busy_timeout_vem_do_nosso_codigo_e_nao_da_omissao_do_driver` é o
  único teste deste ficheiro que distingue "funcionou" de "coincidiu", e é
  por isso o teste central da bateria.
- `PRAGMA journal_mode` numa base de dados `:memory:` devolve `memory`, e
  `PRAGMA journal_mode=WAL` sobre ela devolve `memory` **sem erro nenhum**.
  Um motor que peça WAL e não verifique a resposta serve, em silêncio, uma
  base de dados sem WAL — ver
  `test_wal_que_nao_se_aplica_rebenta_em_vez_de_passar_em_silencio`.

Todos os motores destes testes assentam numa base de dados **em ficheiro**,
dentro de `tmp_path`, nunca `:memory:` (regra do `backend/CLAUDE.md`). A
única exceção é o T4, onde a base de dados em memória é o próprio objeto do
teste.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Connection, Engine

from tests.apoio_mensagens import contem_marca_pt_pt, texto_de_toda_a_cadeia

#: Valor fora de qualquer omissão: não é o 5000 do `pysqlite`, não é 0, e
#: não é um número redondo que alguém pudesse escrever por acaso.
BUSY_TIMEOUT_INVENTADO = 7321

NOMES_DOS_PRAGMAS = ("journal_mode", "foreign_keys", "busy_timeout")


def _url_de_ficheiro(caminho: Path) -> str:
    """URL SQLAlchemy para uma base de dados SQLite **em ficheiro**."""
    return f"sqlite:///{caminho}"


def _ler_pragmas(ligacao: Connection) -> dict[str, Any]:
    return {
        nome: ligacao.exec_driver_sql(f"PRAGMA {nome}").scalar()
        for nome in NOMES_DOS_PRAGMAS
    }


def test_app_db_expoe_obter_engine_com_cache() -> None:
    """`app.db.obter_engine` existe e é um `lru_cache` — a fixture conta com isso.

    `tests/conftest.py::_limpar_cache_do_motor` tolera a ausência deste nome
    (a F2-01 ainda não aterrou) com um `getattr`. Este teste é o que impede
    essa tolerância de se tornar um guarda cego: enquanto o nome não
    existir, falha; se um dia alguém o remover ou lhe tirar o `lru_cache`,
    volta a falhar, em vez de a suite inteira passar a correr com um motor
    partilhado entre testes.
    """
    import app.db

    assert hasattr(app.db, "obter_engine"), (
        "app/db.py tem de expor `obter_engine()`; `tests/conftest.py` limpa "
        "a cache dele entre testes"
    )
    assert hasattr(app.db.obter_engine, "cache_clear"), (
        "`obter_engine` tem de ser decorada com `lru_cache`: sem cache não "
        "há nada a limpar, e cada chamada construiria um motor novo"
    )


def test_busy_timeout_ms_e_5000_como_manda_o_backend_claude_md() -> None:
    """A constante vale 5000 ms, o valor fixado em `backend/CLAUDE.md`.

    Sozinho, este teste não prova nada sobre nenhuma ligação — prova só o
    valor da constante. Quem prova que a constante chega à ligação é
    `test_busy_timeout_vem_do_nosso_codigo_e_nao_da_omissao_do_driver`.
    """
    from app.db import BUSY_TIMEOUT_MS

    assert BUSY_TIMEOUT_MS == 5000


def test_ligacao_nova_tem_wal_fk_e_busy_timeout(tmp_path: Path) -> None:
    """T1: os três PRAGMAs certos numa ligação nova sobre uma BD em ficheiro."""
    from app.db import BUSY_TIMEOUT_MS, criar_engine

    motor = criar_engine(_url_de_ficheiro(tmp_path / "pragmas.db"))
    try:
        with motor.connect() as ligacao:
            pragmas = _ler_pragmas(ligacao)
    finally:
        motor.dispose()

    assert pragmas["journal_mode"] == "wal", (
        "sem WAL, um leitor e um escritor concorrentes bloqueiam-se; é o "
        "modo que `backend/CLAUDE.md` fixa"
    )
    assert pragmas["foreign_keys"] == 1, (
        "sem este PRAGMA (0 por omissão em cada ligação nova), as chaves "
        "estrangeiras ficam escritas no DDL e nunca são verificadas"
    )
    assert pragmas["busy_timeout"] == BUSY_TIMEOUT_MS


def test_busy_timeout_vem_do_nosso_codigo_e_nao_da_omissao_do_driver(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T2, o teste central: o `busy_timeout` da ligação é **o nosso**.

    `PRAGMA busy_timeout` devolve 5000 numa ligação do `pysqlite` sem uma
    linha de código nosso, porque o driver aplica `timeout=5.0` por omissão.
    Qualquer teste que afirme `busy_timeout == 5000` passa com o nosso
    código apagado — passa por coincidência, não por funcionar.

    Este troca a constante por um valor que nenhuma omissão produz e lê o
    resultado numa ligação nova. Se o PRAGMA desaparecer de `criar_engine`,
    a ligação volta aos 5000 do driver e este teste — e só este — fica
    vermelho.

    Ponto de extensão que isto exige do implementador: o PRAGMA tem de ler
    `BUSY_TIMEOUT_MS` do módulo **no momento em que a ligação abre** (uma
    referência ao nome global dentro do ouvinte do evento `connect`), nunca
    capturá-la num valor por omissão de argumento nem numa f-string
    avaliada à importação do módulo.
    """
    import app.db

    monkeypatch.setattr(app.db, "BUSY_TIMEOUT_MS", BUSY_TIMEOUT_INVENTADO)

    motor = app.db.criar_engine(_url_de_ficheiro(tmp_path / "busy.db"))
    try:
        with motor.connect() as ligacao:
            lido = ligacao.exec_driver_sql("PRAGMA busy_timeout").scalar()
    finally:
        motor.dispose()

    assert lido == BUSY_TIMEOUT_INVENTADO, (
        f"a ligação devolveu busy_timeout={lido} em vez de "
        f"{BUSY_TIMEOUT_INVENTADO}. Se for 5000, não é o nosso valor: é o "
        "`timeout=5.0` por omissão do pysqlite, e o PRAGMA que julgamos "
        "aplicar nunca correu (ou foi avaliado à importação, antes do "
        "monkeypatch)"
    )


def test_os_pragmas_valem_em_cada_ligacao_nao_so_na_primeira(tmp_path: Path) -> None:
    """T3: depois de `dispose()`, a ligação seguinte traz os três PRAGMAs.

    Dos três, só o `journal_mode=WAL` é persistente — fica no cabeçalho do
    ficheiro. `foreign_keys` e `busy_timeout` são propriedades da ligação e
    morrem com ela. Um motor que aplicasse os PRAGMAs uma única vez (no
    arranque, numa ligação de aquecimento) passaria num teste que só olha
    para a primeira ligação, e serviria o resto da vida do processo com as
    chaves estrangeiras desligadas.

    A segunda metade do teste é o que o impede de se contentar com o que o
    ficheiro guarda sozinho: aberto com o `sqlite3` puro, sem passar por
    `criar_engine`, o mesmo ficheiro já está em WAL — mas `foreign_keys`
    volta a 0. É a medida que mostra que as asserções acima têm conteúdo.
    """
    from app.db import BUSY_TIMEOUT_MS, criar_engine

    caminho = tmp_path / "cada-ligacao.db"
    motor = criar_engine(_url_de_ficheiro(caminho))
    try:
        with motor.connect() as primeira:
            assert _ler_pragmas(primeira)["foreign_keys"] == 1

        # Fecha o pool: a ligação a seguir é mesmo uma ligação nova ao
        # SQLite, não a mesma reciclada.
        motor.dispose()

        with motor.connect() as segunda:
            pragmas = _ler_pragmas(segunda)
    finally:
        motor.dispose()

    assert pragmas == {
        "journal_mode": "wal",
        "foreign_keys": 1,
        "busy_timeout": BUSY_TIMEOUT_MS,
    }

    ligacao_crua = sqlite3.connect(caminho)
    try:
        modo_cru = ligacao_crua.execute("PRAGMA journal_mode").fetchone()[0]
        fk_cru = ligacao_crua.execute("PRAGMA foreign_keys").fetchone()[0]
    finally:
        ligacao_crua.close()

    assert modo_cru == "wal", (
        "o WAL devia ter ficado gravado no cabeçalho do ficheiro — é o "
        "único dos três que persiste"
    )
    assert fk_cru == 0, (
        "`foreign_keys` numa ligação crua a este ficheiro devolveu "
        f"{fk_cru}, não 0. Se um dia o SQLite passar a ligá-lo por "
        "omissão, a asserção `foreign_keys == 1` acima deixa de provar que "
        "é o nosso código a ligá-lo, e este teste tem de ser repensado"
    )
    # O `busy_timeout` não entra nesta segunda metade de propósito: uma
    # ligação crua do `sqlite3` também devolve 5000 (o `timeout=5.0` do
    # driver), por isso a comparação não distinguiria nada. Quem distingue
    # é `test_busy_timeout_vem_do_nosso_codigo_e_nao_da_omissao_do_driver`.


def test_wal_que_nao_se_aplica_rebenta_em_vez_de_passar_em_silencio() -> None:
    """T4: pedir WAL e não o conseguir tem de ser um erro, em PT-PT.

    `PRAGMA journal_mode=WAL` numa base de dados em memória **não falha**:
    devolve `memory` e segue em frente. Um `criar_engine` que emita o PRAGMA
    e ignore a resposta entrega, calado, um motor sem WAL — e é exatamente
    assim que uma base de dados de produção acabaria em `delete` sem ninguém
    dar por isso, se a URL viesse errada do `.env`.

    O erro pode nascer em `criar_engine(...)` ou na primeira ligação: as
    duas colocações passam aqui. O que não passa é não haver erro nenhum.
    """
    # Fora do `try`: se `criar_engine` não existir, é um `ImportError` a
    # dizê-lo, não um "a base de dados em memória rebentou, logo está bem".
    from app.db import criar_engine

    motor: Engine | None = None
    erro: BaseException | None = None
    try:
        motor = criar_engine("sqlite://")
        with motor.connect() as ligacao:
            ligacao.exec_driver_sql("SELECT 1")
    # Apanha-se `Exception` de propósito: o contrato é "rebenta", e o tipo
    # exato depende de onde o SQLAlchemy embrulha o erro do ouvinte do
    # evento `connect`. O que o teste exige da exceção está nas asserções
    # sobre a mensagem, abaixo.
    except Exception as excecao:
        erro = excecao
    finally:
        if motor is not None:
            motor.dispose()

    assert erro is not None, (
        "`criar_engine('sqlite://')` ligou-se sem reclamar: o motor aceitou "
        "uma base de dados que ficou com journal_mode='memory'. Pedir WAL "
        "sem verificar a resposta do PRAGMA é o mesmo que não o pedir"
    )

    mensagem = texto_de_toda_a_cadeia(erro)
    assert "wal" in mensagem.lower(), (
        f"a mensagem não nomeia o modo que falta:\n{mensagem}"
    )
    assert "memory" in mensagem.lower(), (
        "a mensagem tem de dizer o modo que a base de dados ficou mesmo a "
        f"ter ('memory'), não só o que queríamos:\n{mensagem}"
    )
    assert contem_marca_pt_pt(mensagem), (
        "a mensagem tem de ser nossa e em português de Portugal, não a do "
        f"SQLAlchemy ou a do sqlite3:\n{mensagem}"
    )


def test_obter_engine_usa_a_url_das_definicoes_e_guarda_em_cache() -> None:
    """`obter_engine()` serve o mesmo motor e aponta para a BD das definições.

    A fixture `isolar_definicoes` aponta `BASE_DADOS_URL` para um ficheiro
    dentro de `tmp_path`; este teste prende as duas pontas — que
    `obter_engine()` passa por `obter_definicoes()` e que a cache serve o
    mesmo objeto, que é o que `_limpar_cache_do_motor` existe para limpar.
    """
    from app.config import obter_definicoes
    from app.db import obter_engine

    primeiro = obter_engine()
    segundo = obter_engine()

    assert primeiro is segundo
    assert str(primeiro.url) == obter_definicoes().base_dados_url
