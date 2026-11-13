"""Cópia de segurança da base de dados, pela API de backup do SQLite.

Corre-se assim, sem argumentos nenhuns — a origem e o destino vêm da
configuração, como no `alembic`:

    AMBIENTE=producao python scripts/backup.py

A origem é `BASE_DADOS_URL`; o destino é `DATA_DIR/backups`
(`Definicoes.backups_dir`, `app/config.py`). Mantém só os **30 ficheiros**
de backup mais recentes **por nome** — não 30 dias (`docs/TAREFAS.md`,
F2-02): a janela em dias depende de quem agenda a corrida (F1-05).

Estado de saída `0` só quando o backup ficou feito; diferente de zero em
qualquer recusa. O relatório sai em `stdout`, no mesmo molde de
`scripts/importar_bd_antiga.py`: a última linha não vazia é a conclusão, e
um defeito do script (não uma recusa) imprime o detalhe do erro em
`stdout` e deixa o `traceback` subir, em `stderr`.

## As duas medições da F2-02 que isto aplica (`docs/TAREFAS.md`)

1. **`sqlite3.connect()` num caminho inexistente cria um ficheiro de 0
   bytes, sem erro nenhum.** A verificação da origem é um `stat()` (não
   `Path.is_file()`, que em Python 3.13+ engole o `PermissionError`) —
   e, para distinguir "vazia" de "não é SQLite", a leitura do
   cabeçalho — **antes** de qualquer `connect`. Sem isto, uma origem
   ausente (ou um `tomazia.db` de 0 bytes, que abre lindamente e dá 500
   em produção) enchia as 30 ranhuras com cópias de nada.
2. **O relógio injetável.** O teste da colisão de nomes precisa de forçar
   duas corridas a calhar no mesmo segundo — e com o relógio de parede
   isso é uma corrida verdadeira, não um teste determinístico. Por isso
   este script lê a variável de ambiente `TOMAZIA_AGORA_UTC` (uma data e
   hora ISO 8601, com fuso) como "agora", quando ela existir, em vez de
   `datetime.now(UTC)`. O contrato completo — incluindo o nome do
   ficheiro, `tomazia-AAAAMMDDTHHMMSSZ.db` — está fixado em
   `tests/apoio_scripts_de_admin.py`, que é quem o usa para forjar
   ficheiros; se um dia mudar, muda-se aqui **e** lá, de propósito.

## Porque é `Connection.backup`, e nunca um `shutil.copyfile`

O `app/db.py` põe cada ligação em modo WAL. Em WAL, parte dos `commit`
mais recentes vive só no ficheiro `-wal`, ao lado do principal — um
`cp`/`copyfile` do ficheiro principal sozinho dá uma cópia **sem essas
últimas escritas**, e essa cópia abre sem erro nenhum, ela só não tem os
dados. A API de backup do SQLite (`sqlite3.Connection.backup`) lê o
estado atual da base de dados, WAL incluído, e é por isso a única forma
aceite aqui. Há um teste que escreve e faz `commit` **sem checkpoint** e
exige essa linha na cópia (`tests/test_backup.py::
test_dados_so_no_wal_entram_na_copia`): um `shutil.copyfile` falha-o.

## A ordem das operações

1. `stat()` na origem, antes de qualquer `connect`; depois o
   tamanho (0 bytes é "vazia", não "não existe"); depois o cabeçalho
   SQLite (`SQLite format 3\\0`), outra vez sem `connect`.
2. Cria a pasta de destino se não existir. **Não cria a origem.**
3. Recusa se já existir um ficheiro com o nome que este instante geraria
   — nunca sobrescreve um backup existente.
4. Copia para `<nome>.<pid>.parcial` (único por execução) e só faz `os.replace` para o nome final
   depois de verificar a cópia — nunca escreve direto no nome final, para
   um disco cheio a meio não deixar um ficheiro truncado a ocupar uma das
   30 ranhuras com o nome de um backup.
5. Verifica **antes** de publicar: `PRAGMA integrity_check` **e** o
   conjunto de nomes de tabela igual ao da origem — o `integrity_check`
   sozinho não chega, uma base de dados vazia também passa.
6. Poda **depois** de a cópia nova estar no sítio, nunca antes: uma
   corrida falhada não pode encurtar a retenção. Só apaga nomes que batam
   com o padrão exato do backup.
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import stat
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

# O `sys.path` antes de qualquer coisa que toque no pacote `app`, pela
# mesma razão que em `passenger_wsgi.py` e em `scripts/importar_bd_antiga.py`:
# corrido como `python scripts/backup.py`, o `sys.path[0]` é a pasta
# `scripts/`, e `import app` não encontrava nada.
RAIZ_INSTALACAO = Path(__file__).resolve().parent.parent
if str(RAIZ_INSTALACAO) not in sys.path:
    sys.path.insert(0, str(RAIZ_INSTALACAO))

from pydantic import ValidationError  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.config import Definicoes, obter_definicoes  # noqa: E402
from app.db import abrir_so_leitura, tem_cabecalho_sqlite  # noqa: E402
from app.linha_de_comandos import (  # noqa: E402
    AnalisadorEmPortugues,
    descrever_erro_de_configuracao,
)

#: A variável de ambiente que faz as vezes do relógio de parede. Ver a
#: secção "O relógio injetável" no cabeçalho deste ficheiro.
VARIAVEL_DO_RELOGIO = "TOMAZIA_AGORA_UTC"

#: O contrato do nome dos ficheiros de backup — fixado também em
#: `tests/apoio_scripts_de_admin.py`. Muda-se nos dois sítios, de propósito,
#: nunca só num.
PREFIXO_BACKUP = "tomazia-"
SUFIXO_BACKUP = ".db"
FORMATO_TIMESTAMP_BACKUP = "%Y%m%dT%H%M%SZ"
PADRAO_NOME_DE_BACKUP = re.compile(r"^tomazia-\d{8}T\d{6}Z\.db$")

#: `docs/TAREFAS.md`, F2-02: "os últimos 30 são 30 ficheiros", não 30 dias.
MAXIMO_DE_BACKUPS = 30


class Recusa(Exception):
    """O script não pode continuar. A mensagem diz porquê."""


_SO_OS_TESTES = (
    f"Só os testes a usam: no servidor, corre «unset {VARIAVEL_DO_RELOGIO}» e "
    "tenta outra vez."
)


def agora() -> datetime:
    """ "Agora", em UTC — de `TOMAZIA_AGORA_UTC` quando definida, senão o relógio.

    Ver a secção "O relógio injetável" no cabeçalho deste ficheiro.
    """
    bruto = os.environ.get(VARIAVEL_DO_RELOGIO)
    if not bruto:
        return datetime.now(UTC)
    try:
        instante = datetime.fromisoformat(bruto)
    except ValueError as erro:
        raise Recusa(
            f"A variável {VARIAVEL_DO_RELOGIO} tem «{bruto}», que não é uma "
            f"data e hora ISO 8601. {_SO_OS_TESTES}"
        ) from erro
    if instante.tzinfo is None:
        raise Recusa(
            f"A variável {VARIAVEL_DO_RELOGIO} tem «{bruto}», sem fuso "
            f"horário. {_SO_OS_TESTES}"
        )
    return instante.astimezone(UTC)


def nome_de_backup(instante: datetime) -> str:
    """O nome de ficheiro deste backup, para `instante` (já em UTC)."""
    return (
        f"{PREFIXO_BACKUP}{instante.strftime(FORMATO_TIMESTAMP_BACKUP)}{SUFIXO_BACKUP}"
    )


# --- A origem ---------------------------------------------------------------


def caminho_da_origem(definicoes: Definicoes) -> Path:
    """O ficheiro SQLite para onde a `BASE_DADOS_URL` aponta."""
    url = make_url(definicoes.base_dados_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        # `render_as_string(hide_password=True)`, nunca a cadeia original:
        # esta recusa só dispara para URLs que não são SQLite, exatamente
        # as que trazem `utilizador:password@servidor` lá dentro, e o
        # relatório deste script é texto que se copia e cola.
        raise Recusa(
            "A BASE_DADOS_URL não aponta para um ficheiro SQLite "
            f"(«{url.render_as_string(hide_password=True)}»), e este script "
            "só sabe copiar um. Confirma a configuração (e o AMBIENTE)."
        )
    return Path(url.database).resolve()


def problema_da_origem(origem: Path) -> str | None:
    """A origem dá para copiar? `None` se dá; a frase da recusa, se não dá.

    As verificações, por esta ordem, e **nenhuma delas** abre uma ligação
    SQLite: é a medição da F2-02 (ver o cabeçalho deste ficheiro). Usa
    `stat()` e não `Path.is_file()`: em Python 3.13+ o `is_file()` engole o
    `PermissionError` e junta "não existe" com "não consegui ver" (regra 10
    do `CLAUDE.md`); o servidor aceita 3.11 ou superior.
    """
    try:
        info = origem.stat()
    except FileNotFoundError:
        return f"A origem {origem} não existe. Confirma a BASE_DADOS_URL e o AMBIENTE."
    except OSError as erro:
        return (
            f"Não consegui verificar a origem {origem} ({erro}). Confirma as "
            "permissões da pasta e a BASE_DADOS_URL."
        )
    if not stat.S_ISREG(info.st_mode):
        return (
            f"A origem {origem} não é um ficheiro. Confirma a BASE_DADOS_URL "
            "e o AMBIENTE."
        )
    if info.st_size == 0:
        return (
            f"A origem {origem} existe mas está vazia (0 bytes) — não é um "
            "ficheiro SQLite válido para copiar. Confirma a BASE_DADOS_URL."
        )
    try:
        e_sqlite = tem_cabecalho_sqlite(origem)
    except OSError as erro:
        return f"Não consegui ler a origem {origem} ({erro}). Confirma as permissões."
    if not e_sqlite:
        return (
            f"A origem {origem} tem {info.st_size} bytes e não tem o "
            "cabeçalho de um ficheiro SQLite. Não parece uma base de "
            "dados SQLite. Confirma a BASE_DADOS_URL."
        )
    return None


# --- A cópia, pela API de backup do SQLite ----------------------------------


def _tabelas_de(ligacao: sqlite3.Connection) -> set[str]:
    return {
        nome
        for (nome,) in ligacao.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def _lista(nomes: set[str]) -> str:
    return ", ".join(sorted(nomes)) or "nenhuma"


def _problema_da_copia(parcial: Path, origem: Path) -> str | None:
    """Verifica a cópia **antes** de ela ser publicada (ver o cabeçalho).

    O `integrity_check` sozinho não chega — uma base de dados vazia também
    dá "ok" — por isso compara-se também o conjunto de tabelas com o da
    origem. Levanta `sqlite3.Error` se não conseguir abrir uma das duas.
    """
    copia_lig = sqlite3.connect(str(parcial))
    try:
        (resultado,) = copia_lig.execute("PRAGMA integrity_check").fetchone()
        if str(resultado).strip().lower() != "ok":
            return (
                "A cópia falhou a verificação de integridade: "
                f"{resultado}. Não a guardei e a base de dados original não "
                "foi tocada. Corre o script outra vez."
            )
        tabelas_da_copia = _tabelas_de(copia_lig)
    finally:
        copia_lig.close()

    origem_lig = abrir_so_leitura(origem)
    try:
        tabelas_da_origem = _tabelas_de(origem_lig)
    finally:
        origem_lig.close()

    if tabelas_da_copia != tabelas_da_origem:
        return (
            "A cópia não tem as mesmas tabelas que a base de dados original "
            f"(cópia: {_lista(tabelas_da_copia)}; original: "
            f"{_lista(tabelas_da_origem)}). Não a guardei. Corre o script "
            "outra vez."
        )
    return None


def copiar_e_verificar(origem: Path, parcial: Path) -> str | None:
    """Copia `origem` para `parcial` pela API de backup do SQLite, e verifica.

    **Nunca um `shutil.copyfile`** — ver a secção "Porque é
    `Connection.backup`" no cabeçalho deste ficheiro: em modo WAL, parte
    dos `commit` mais recentes vive só no `-wal`, e uma cópia de ficheiros
    não traz essas escritas, sem erro nenhum a avisar.

    Devolve a frase da recusa se a verificação falhar; levanta `OSError` ou
    `sqlite3.Error` (nunca apanhados aqui) se não conseguir ler a origem ou
    escrever `parcial` — por exemplo, uma pasta de destino sem permissão de
    escrita, ou um disco cheio. Quem chama decide o que fazer com os dois
    casos.
    """
    origem_lig = abrir_so_leitura(origem)
    try:
        parcial_lig = sqlite3.connect(str(parcial))
        try:
            origem_lig.backup(parcial_lig)
        finally:
            parcial_lig.close()
    finally:
        origem_lig.close()
    return _problema_da_copia(parcial, origem)


def _limpar_parcial(parcial: Path) -> str | None:
    """Elimina `parcial` (e os ficheiros que o SQLite lhe junta), se lá estiverem.

    Devolve a frase do problema se não conseguir; `None` se não ficou nada.
    """
    falhas: list[str] = []
    for sufixo in ("", "-journal", "-wal", "-shm"):
        try:
            Path(f"{parcial}{sufixo}").unlink(missing_ok=True)
        except OSError as erro:
            falhas.append(f"{parcial.name}{sufixo} ({erro})")
    if falhas:
        return (
            "Não consegui eliminar o que sobrou da cópia: "
            + ", ".join(falhas)
            + ". Elimina esses ficheiros à mão na pasta de backups (não são "
            "cópias válidas)."
        )
    return None


# --- A poda ------------------------------------------------------------------


@dataclass(frozen=True)
class ResultadoDaPoda:
    eliminadas: int
    #: Cada problema continua a frase "não consegui …" (ver `fazer_backup`).
    problemas: tuple[str, ...]


def podar(pasta: Path, *, manter: int = MAXIMO_DE_BACKUPS) -> ResultadoDaPoda:
    """Mantém só os `manter` backups mais recentes **por nome**, e elimina o resto.

    Por nome, não por `mtime` (`docs/TAREFAS.md`, F2-02): uma cópia feita
    com `cp -a`, ou um restauro, mexe na `mtime` e faz a ordem mentir — o
    nome, fixo em largura e do campo mais para o menos significativo
    (`tests/apoio_scripts_de_admin.py`), não.

    Só mexe em ficheiros cujo nome bata com `PADRAO_NOME_DE_BACKUP` — um
    `README.txt` ou um backup manual, fora do padrão, nunca são tocados.

    "Zero para eliminar" e "não consegui listar a pasta" são coisas
    diferentes (regra 10 do `CLAUDE.md`): a segunda vem como um problema no
    resultado, não como zero eliminadas em silêncio.
    """
    try:
        nomes = sorted(
            entrada.name
            for entrada in pasta.iterdir()
            if entrada.is_file() and PADRAO_NOME_DE_BACKUP.match(entrada.name)
        )
    except OSError as erro:
        return ResultadoDaPoda(
            eliminadas=0,
            problemas=(
                f"listar {pasta} para eliminar as cópias antigas: {erro} "
                f"({type(erro).__name__}). Ficaram todas, por precaução: "
                "prefiro guardar a mais do que eliminar sem saber o que lá está.",
            ),
        )

    a_eliminar = nomes[: max(0, len(nomes) - manter)]
    eliminadas = 0
    problemas: list[str] = []
    for nome in a_eliminar:
        try:
            (pasta / nome).unlink()
            eliminadas += 1
        except OSError as erro:
            problemas.append(f"eliminar {nome}: {erro} ({type(erro).__name__}).")
    return ResultadoDaPoda(eliminadas=eliminadas, problemas=tuple(problemas))


# --- O relatório -------------------------------------------------------------


def recusar(problemas: Sequence[str]) -> int:
    for problema in problemas:
        print(problema)
    print("Não escrevi backup nenhum.")
    return 1


def conclusao_do_rebentamento(erro: BaseException) -> str:
    """A conclusão de um defeito do script — não uma recusa. Ver
    `scripts/importar_bd_antiga.py::conclusao_do_rebentamento`, o mesmo
    raciocínio: o detalhe do erro vai na linha de cima, porque a
    mensagem de um erro do SQLite pode trazer várias linhas, e metê-la
    dentro desta partia a conclusão ao meio.
    """
    return (
        f"Erro inesperado ({type(erro).__name__}): é um defeito do script, "
        "não uma recusa. O detalhe está acima e o traceback a seguir. As "
        "cópias anteriores ficam intactas: uma cópia a meio fica num "
        "ficheiro à parte e nunca com o nome de um backup."
    )


# --- O trabalho todo ---------------------------------------------------------


def _falha_de_escrita(pasta: Path, erro: BaseException) -> str:
    return (
        f"Não consegui escrever o backup em {pasta}: {erro} "
        f"({type(erro).__name__}). Confirma que a pasta tem permissão de "
        "escrita e que o disco não está cheio."
    )


def _escrever_backup(origem: Path, pasta: Path, nome: str) -> str | None:
    """Copia, verifica e publica. `None` se o backup ficou feito.

    Tudo o que pode falhar por falta de permissão, de espaço ou de
    ficheiro (`OSError`, `sqlite3.Error`) é uma recusa nomeada, não um
    defeito do script. O `.parcial` tem um nome único por execução (o
    `pid`), para duas execuções ao mesmo tempo não se apagarem uma à
    outra, e é eliminado em qualquer falha.
    """
    destino = pasta / nome
    parcial = pasta / f"{nome}.{os.getpid()}.parcial"
    problema: str | None
    try:
        # `parents=False`: o `DATA_DIR` não se cria aqui. Se faltar, é a
        # configuração que está errada, e criá-lo escondia isso.
        pasta.mkdir(parents=False, exist_ok=True)
    except FileNotFoundError:
        return (
            f"A pasta de dados {pasta.parent} não existe. Confirma o "
            "DATA_DIR e o AMBIENTE."
        )
    except OSError as erro:
        return _falha_de_escrita(pasta, erro)

    try:
        # Os ficheiros têm hashes de passwords: tira à pasta o acesso do
        # grupo e dos outros, e deixa o do dono como está (uma pasta sem
        # escrita continua a ser uma recusa, não é corrigida aqui). Se não
        # conseguir, os ficheiros já ficam a 0o600 pela `umask`: é um aviso.
        pasta.chmod(stat.S_IMODE(pasta.stat().st_mode) & 0o700)
    except OSError as erro:
        print(
            f"Aviso: não consegui restringir as permissões de {pasta} "
            f"({erro}); o backup continua."
        )

    sobras: str | None = None
    try:
        try:
            destino.stat()
        except FileNotFoundError:
            problema = copiar_e_verificar(origem, parcial)
            if problema is None:
                os.replace(parcial, destino)
        else:
            problema = (
                f"Já existe um backup chamado {nome} em {pasta}. Não o "
                "substituo. Espera um segundo e corre outra vez."
            )
    except (OSError, sqlite3.Error) as erro:
        problema = _falha_de_escrita(pasta, erro)
    finally:
        sobras = _limpar_parcial(parcial)
    if sobras is not None:
        print(sobras)
    return problema


def fazer_backup() -> int:
    try:
        definicoes = obter_definicoes()
    except ValidationError as erro:
        return recusar([descrever_erro_de_configuracao(erro)])

    try:
        origem = caminho_da_origem(definicoes)
    except Recusa as recusa:
        return recusar([str(recusa)])

    pasta_de_backups = definicoes.backups_dir

    print(f"Origem: {origem}")
    print(f"Pasta de backups: {pasta_de_backups}")

    problema = problema_da_origem(origem)
    if problema is not None:
        return recusar([problema])

    try:
        instante = agora()
    except Recusa as recusa:
        return recusar([str(recusa)])

    nome = nome_de_backup(instante)
    problema = _escrever_backup(origem, pasta_de_backups, nome)
    if problema is not None:
        return recusar([problema])

    resultado_da_poda = podar(pasta_de_backups)
    for problema_da_poda in resultado_da_poda.problemas:
        print(f"Aviso: o backup foi feito, mas não consegui {problema_da_poda}")

    print(
        f"Cópias antigas eliminadas: {resultado_da_poda.eliminadas} "
        f"(guardo as {MAXIMO_DE_BACKUPS} mais recentes)."
    )
    print(f"Backup feito: {pasta_de_backups / nome}")
    return 0


def construir_analisador() -> argparse.ArgumentParser:
    """A linha de comandos — sem argumentos nenhuns além do `-h`."""
    return AnalisadorEmPortugues(
        prog="backup.py",
        description=(
            "Faz uma cópia de segurança da base de dados (BASE_DADOS_URL) "
            f"para DATA_DIR/backups e mantém as {MAXIMO_DE_BACKUPS} mais "
            "recentes."
        ),
        epilog=(
            "A origem e o destino vêm da configuração, como no alembic, e "
            "a variável AMBIENTE é obrigatória. Exemplo:\n"
            "  AMBIENTE=producao python scripts/backup.py"
        ),
    )


def main(argumentos: Sequence[str] | None = None) -> int:
    # Os backups têm hashes de passwords: tudo o que este processo criar
    # (pasta, ficheiros do SQLite) fica só para o dono.
    os.umask(0o077)
    construir_analisador().parse_args(argumentos)
    try:
        return fazer_backup()
    except Exception as erro:
        # Ver `scripts/importar_bd_antiga.py::main`: o mesmo raciocínio. O
        # detalhe do erro sai em `stdout`, antes da conclusão, e a exceção
        # segue viagem para o `traceback` em `stderr` — nunca engolida.
        print(f"O erro foi: {type(erro).__name__}: {erro}")
        print(conclusao_do_rebentamento(erro))
        raise


if __name__ == "__main__":
    raise SystemExit(main())
