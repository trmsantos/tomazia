"""A migração inicial do Alembic (F2-01).

Critério literal da tarefa: `alembic upgrade head` cria a base de dados do
zero. Isso não se prova dentro do processo de testes — prova-se a correr o
comando, num subprocesso, contra um ficheiro que ainda não existe. É o
mesmo comando que o `deploy/deploy.sh` corre no servidor, e no servidor não
há nenhum `Base.metadata.create_all` a tapar buracos.

Nos testes que correm o Alembic, a regra 10 do `CLAUDE.md` aplica-se com
força: o código de saída verifica-se à mão e o `stdout`/`stderr` entra na
mensagem da asserção. Sem isso, "o alembic rebentou a importar `app.models`"
e "o alembic correu e o esquema está errado" dariam a mesma linha vermelha.
"""

from __future__ import annotations

import ast
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent

#: As sete tabelas da secção "Modelo de dados" de `docs/ESPECIFICACAO.md`.
TABELAS_ESPERADAS = frozenset(
    {
        "categorias",
        "produtos",
        "eventos",
        "fotos",
        "clientes",
        "admins",
        "definicoes",
    }
)

#: Prefixos da convenção de nomes de `Base.metadata`. O ADR 0009 depende
#: deles: a F2-05 mapeia a restrição violada para uma mensagem em PT-PT
#: junto do campo certo a partir do nome que o SQLite devolve no erro.
PREFIXOS_DA_CONVENCAO = ("pk_", "fk_", "uq_", "ck_", "ix_")

#: Nome fixado pelo ADR 0009, citado lá textualmente.
RESTRICAO_PUBLICADO_EXIGE_INICIO = "ck_eventos_publicado_exige_inicio"


def _ambiente_do_alembic(base_dados: Path) -> dict[str, str]:
    """Ambiente mínimo para o subprocesso, isolado do `backend/.env` real.

    Nunca se herda o ambiente de quem corre os testes: a `BASE_DADOS_URL`
    tem de ser a do teste, e o `TOMAZIA_ENV_FILE` tem de apontar para um
    caminho inexistente, senão o `.env` do repositório decide qual é a base
    de dados que o Alembic abre.
    """
    return {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "PYTHONPATH": str(RAIZ_BACKEND),
        "AMBIENTE": "desenvolvimento",
        "BASE_DADOS_URL": f"sqlite:///{base_dados}",
        "TOMAZIA_ENV_FILE": str(
            base_dados.parent / "isolamento-de-testes-nao-existe" / ".env"
        ),
    }


def _correr_alembic(
    *argumentos: str, base_dados: Path
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *argumentos],
        cwd=RAIZ_BACKEND,
        env=_ambiente_do_alembic(base_dados),
        capture_output=True,
        text=True,
        timeout=120,
    )


def _relatorio(rotulo: str, resultado: subprocess.CompletedProcess[str]) -> str:
    """Mensagem de asserção com tudo o que o subprocesso disse.

    Regra 10: um código de saída não-zero do Alembic tanto quer dizer
    "detetei diferenças" como "rebentei a importar". A mensagem traz o
    `stdout` e o `stderr` para que a diferença se veja sem reproduzir nada à
    mão.
    """
    return (
        f"{rotulo} terminou com código {resultado.returncode}\n"
        f"--- stdout ---\n{resultado.stdout}\n"
        f"--- stderr ---\n{resultado.stderr}"
    )


def _caminho_de_bd_inexistente(tmp_path: Path) -> Path:
    pasta = tmp_path / "dados-do-servidor"
    pasta.mkdir(parents=True, exist_ok=True)
    base_dados = pasta / "tomazia.db"
    assert not base_dados.exists()
    return base_dados


def _tabelas_de_negocio(base_dados: Path) -> set[str]:
    """Tabelas em `sqlite_master`, sem as internas do SQLite nem a do Alembic."""
    ligacao = sqlite3.connect(base_dados)
    try:
        nomes = {
            linha[0]
            for linha in ligacao.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    finally:
        ligacao.close()
    return {
        nome
        for nome in nomes
        if not nome.startswith("sqlite_") and nome != "alembic_version"
    }


def test_upgrade_head_cria_a_bd_do_zero(tmp_path: Path) -> None:
    """T5, o critério literal da tarefa: ficheiro inexistente → sete tabelas."""
    base_dados = _caminho_de_bd_inexistente(tmp_path)

    resultado = _correr_alembic("upgrade", "head", base_dados=base_dados)

    assert resultado.returncode == 0, _relatorio("alembic upgrade head", resultado)
    assert base_dados.exists(), _relatorio(
        "alembic upgrade head saiu com 0 mas não deixou ficheiro nenhum",
        resultado,
    )

    tabelas = _tabelas_de_negocio(base_dados)

    assert tabelas == set(TABELAS_ESPERADAS), (
        f"tabelas criadas: {sorted(tabelas)}\n"
        f"esperadas: {sorted(TABELAS_ESPERADAS)}\n"
        f"a faltar: {sorted(TABELAS_ESPERADAS - tabelas)}\n"
        f"a mais: {sorted(tabelas - TABELAS_ESPERADAS)}"
    )


def test_a_bd_criada_pelo_alembic_fica_em_wal(tmp_path: Path) -> None:
    """T6: o ficheiro criado pelo Alembic já está em WAL.

    Lido com o `sqlite3` puro, sem SQLAlchemy nenhum pelo meio: se a leitura
    passasse por `criar_engine`, seria a própria leitura a pôr a base de
    dados em WAL e o teste provaria apenas que sabe ligar o modo.

    É a prova para o `alembic upgrade head` do `deploy/deploy.sh`, que é
    quem cria a base de dados no servidor. Se `migrations/env.py` abrir o
    motor por fora da fábrica de `app/db.py` (ver o teste seguinte), a base
    de dados nasce em `delete` e só um reinício com a aplicação a abri-la
    pela fábrica a corrigiria — se alguém reparasse.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)

    resultado = _correr_alembic("upgrade", "head", base_dados=base_dados)
    assert resultado.returncode == 0, _relatorio("alembic upgrade head", resultado)

    ligacao = sqlite3.connect(base_dados)
    try:
        modo = ligacao.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        ligacao.close()

    assert modo == "wal", (
        f"a base de dados criada pelo Alembic ficou em journal_mode="
        f"'{modo}'. É o estado em que o servidor ficaria depois de um "
        "deploy que corre `alembic upgrade head` numa base de dados nova"
    )


def _nomes_chamados(arvore: ast.AST) -> set[str]:
    """Nomes de tudo o que é chamado na árvore, incluindo chamadas a atributos."""
    nomes: set[str] = set()
    for no in ast.walk(arvore):
        if not isinstance(no, ast.Call):
            continue
        alvo = no.func
        if isinstance(alvo, ast.Name):
            nomes.add(alvo.id)
        elif isinstance(alvo, ast.Attribute):
            nomes.add(alvo.attr)
    return nomes


def _nomes_importados(arvore: ast.AST) -> set[str]:
    nomes: set[str] = set()
    for no in ast.walk(arvore):
        if isinstance(no, ast.Import | ast.ImportFrom):
            nomes.update(alias.asname or alias.name for alias in no.names)
    return nomes


def test_helper_distingue_as_duas_fabricas_de_motor() -> None:
    """Prova, sozinho, que o guarda sintático abaixo tem conteúdo.

    Um `_nomes_chamados` que devolvesse sempre `set()` deixaria o teste
    seguinte verde com qualquer `env.py` — o guarda passaria a aprovar tudo
    em silêncio. Estes três casos fixam que o helper vê as duas fábricas e
    não as confunde uma com a outra.
    """
    assert _nomes_chamados(ast.parse("engine_from_config(seccao)")) == {
        "engine_from_config"
    }
    assert _nomes_chamados(ast.parse("criar_engine(url)")) == {"criar_engine"}
    assert _nomes_chamados(ast.parse("app.db.criar_engine(url)")) == {"criar_engine"}
    assert "criar_engine" not in _nomes_chamados(ast.parse("engine_from_config(x)"))
    assert _nomes_importados(
        ast.parse("from sqlalchemy import engine_from_config")
    ) == {"engine_from_config"}


def test_env_py_nao_constroi_motores_fora_da_fabrica() -> None:
    """T7: `migrations/env.py` usa `criar_engine`, nunca `engine_from_config`.

    Guarda sintático, pela mesma técnica de
    `tests/seguranca/test_arranque_passenger.py`: percorre a árvore do
    ficheiro em vez de o importar (importar `env.py` corre migrações).

    O motivo é o teste anterior. Os PRAGMAs vivem todos no evento `connect`
    da fábrica de `app/db.py`; um motor construído pelo Alembic com
    `engine_from_config` nunca passa por lá, e a base de dados que o
    servidor cria no deploy nasce sem WAL e com as chaves estrangeiras
    desligadas — incluindo durante as próprias migrações de dados.
    """
    caminho = RAIZ_BACKEND / "migrations" / "env.py"
    arvore = ast.parse(caminho.read_text(encoding="utf-8"), filename=str(caminho))

    chamadas = _nomes_chamados(arvore)
    importados = _nomes_importados(arvore)

    assert "criar_engine" in chamadas, (
        "migrations/env.py tem de construir o motor com `criar_engine` de "
        "`app.db`: é o único sítio onde os três PRAGMAs são aplicados"
    )
    assert "engine_from_config" not in chamadas, (
        "migrations/env.py chama `engine_from_config`: esse motor não passa "
        "pelo evento `connect` de `app/db.py` e abre a base de dados sem "
        "WAL e sem `foreign_keys`"
    )
    assert "engine_from_config" not in importados, (
        "migrations/env.py ainda importa `engine_from_config`; mesmo sem o "
        "chamar hoje, deixa a porta aberta para o próximo a reintroduzir"
    )
    assert "create_engine" not in chamadas, (
        "migrations/env.py chama `create_engine` diretamente, contornando "
        "a fábrica de `app/db.py` pelo mesmo efeito"
    )


def test_modelos_e_migracao_nao_divergem(tmp_path: Path) -> None:
    """T8: `alembic check` não encontra operações pendentes.

    Prende as duas metades uma à outra: a migração escrita à mão e os
    modelos de `app/models/`. Sem isto, um `Column` acrescentado a um modelo
    e esquecido na migração passa despercebido até ao servidor — onde só a
    migração corre.

    A verificação das sete tabelas antes do `alembic check` não é
    redundante com o T5: é o que impede este teste de passar por vazio.
    Sem nenhuma migração e sem nenhum modelo, `Base.metadata` e a base de
    dados também "não divergem", e o `alembic check` sai com 0 — que foi
    exatamente o que se mediu com o repositório no estado em que a F2-01
    começou.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)

    subida = _correr_alembic("upgrade", "head", base_dados=base_dados)
    assert subida.returncode == 0, _relatorio("alembic upgrade head", subida)

    tabelas = _tabelas_de_negocio(base_dados)
    assert tabelas == set(TABELAS_ESPERADAS), (
        "não há nada para comparar: a base de dados em head tem "
        f"{sorted(tabelas)} em vez das sete tabelas. Um `alembic check` "
        "sobre um esquema vazio passa sempre"
    )

    verificacao = _correr_alembic("check", base_dados=base_dados)

    assert verificacao.returncode == 0, _relatorio("alembic check", verificacao)


def test_as_restricoes_da_bd_nascem_com_nomes_deterministicos(tmp_path: Path) -> None:
    """Toda a restrição nomeada segue a convenção, e a do ADR 0009 está lá.

    O ADR 0009 conta com isto: o SQLite devolve o nome da restrição na
    mensagem de erro (`CHECK constraint failed:
    ck_eventos_publicado_exige_inicio`), e é esse nome que permite à F2-05
    responder com uma mensagem em PT-PT junto do campo certo em vez de um
    500 genérico. Um nome gerado pelo SQLAlchemy sem convenção muda com a
    versão e não serve para isso.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)
    resultado = _correr_alembic("upgrade", "head", base_dados=base_dados)
    assert resultado.returncode == 0, _relatorio("alembic upgrade head", resultado)

    ligacao = sqlite3.connect(base_dados)
    try:
        ddl = "\n".join(
            linha[0]
            for linha in ligacao.execute(
                # `alembic_version` fica de fora: a tabela é do Alembic, não
                # nossa, e a restrição dela (`alembic_version_pkc`) nasce com
                # um nome que não passa — nem tem de passar — pela convenção
                # de `Base.metadata`.
                "SELECT sql FROM sqlite_master "
                "WHERE sql IS NOT NULL AND tbl_name <> 'alembic_version'"
            )
        )
    finally:
        ligacao.close()

    nomes = re.findall(r'CONSTRAINT\s+"?([A-Za-z0-9_]+)"?', ddl)
    assert nomes, f"nenhuma restrição nomeada no DDL criado:\n{ddl}"

    fora_da_convencao = [
        nome for nome in nomes if not nome.startswith(PREFIXOS_DA_CONVENCAO)
    ]
    assert not fora_da_convencao, (
        f"restrições com nomes fora da convenção {PREFIXOS_DA_CONVENCAO}: "
        f"{fora_da_convencao}"
    )

    assert RESTRICAO_PUBLICADO_EXIGE_INICIO in nomes, (
        f"a restrição {RESTRICAO_PUBLICADO_EXIGE_INICIO} do ADR 0009 não "
        f"existe na base de dados. Nomes encontrados: {sorted(set(nomes))}"
    )
