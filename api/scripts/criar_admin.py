"""Cria, desbloqueia, ou muda a password de uma conta de administração.

Corre-se assim, com o destino a vir da `BASE_DADOS_URL` como no `alembic`:

    AMBIENTE=producao python scripts/criar_admin.py --utilizador NOME

Três modos, mutuamente exclusivos:

- sem opção extra: **cria** uma conta nova. Recusa se já existir uma com o
  mesmo `utilizador` — nunca substitui uma conta em silêncio;
- `--desbloquear`: põe `tentativas_falhadas = 0` e `bloqueado_ate = NULL`,
  sem tocar em `sessao_versao` (herança da F2-04: uma sessão aberta
  sobrevive ao bloqueio). Não pede password nenhuma;
- `--mudar-password`: pede a password nova (com confirmação, como o modo
  de criação) e grava-a, **incrementando `sessao_versao`** — mata as
  sessões antigas, decisão do Tomás de 9 de novembro de 2026
  (`docs/TAREFAS.md`, F2-02). É a saída para uma password esquecida:
  recriar é recusado, e `--desbloquear` não serve porque a conta não está
  bloqueada.

**A password nunca entra por argumento, em modo nenhum.** É sempre pedida
no terminal, duas vezes (entrada e confirmação), e as duas têm de bater
certo. Só é recusada se for **vazia**; abaixo de 12 caracteres é um aviso,
não uma recusa (`docs/TAREFAS.md`, F2-02: um mínimo duro seria um
requisito inventado, e isto é a conta do dono, num caminho só-SSH, já com
o bloqueio de 15 minutos a defender o login).

Estado de saída `0` só quando a operação pedida teve sucesso; diferente de
zero em qualquer recusa.

## A armadilha medida: `getpass` não recusa sem terminal

`getpass.getpass()` abre `/dev/tty` diretamente, não `sys.stdin` — e só
quando isso falha é que cai de volta para `sys.stdin`, **sem avisar que a
entrada já não é segura**. Medido (`docs/TAREFAS.md`, F2-02): com um
`pipe` que só tenha uma linha vazia, `getpass` lê `''`, emite um
`GetPassWarning` e **tem sucesso** — cria-se uma conta de admin com
password vazia. Com `stdin` em `/dev/null`, dá `EOFError`. Três situações
("tenho um terminal a sério", "tenho um `pipe`", "tenho `/dev/null`"),
três comportamentos nativos, e só um deles rebenta sozinho.

Por isso há um guarda próprio, `exigir_terminal`, chamado **antes** de
qualquer `getpass.getpass()`: recusa quando `sys.stdin.isatty()` é falso,
sem nunca chegar a chamar `getpass`. Este guarda é estritamente mais
conservador do que o necessário — recusa também o caso em que há um
terminal de controlo mas `stdin` foi substituído por um `pipe`, onde o
`getpass` teria pedido corretamente, abrindo `/dev/tty` — mas é simples,
previsível, e quem canaliza texto para um script que pede uma password
interativamente está a fazer algo estranho de qualquer maneira. **Não
apagar este guarda por "parecer" redundante**: sem ele, o comportamento
nativo do `getpass` é exatamente a falha de segurança que este ficheiro
existe para fechar.

E são **três recusas com três frases diferentes** (regra 10 do
`CLAUDE.md`): "não estás num terminal" (`pipe`) ≠ "o terminal fechou-se a
meio" (`/dev/null`, ou qualquer dispositivo que não seja nem um terminal
nem um `pipe`) ≠ "escreveste uma password vazia" (há terminal a sério, e
ele entregou os dados pedidos — só que um deles está em branco).

## Porque a verificação de duplicado vem antes do pedido de password

No modo de criação, o `utilizador` é verificado **antes** de se pedir
qualquer password: evita um pedido inútil quando a conta já existe, e,
mais importante, evita o cenário medido em
`tests/seguranca/test_criar_admin_nao_mostra_a_password.py` — deixar
subir um `IntegrityError` da restrição `UNIQUE` da base de dados em vez de
verificar primeiro traz, dentro da própria mensagem da exceção, o `INSERT`
e os parâmetros ligados — **o `hash_password` incluído**. Mesmo assim, a
criação continua protegida por um `try/except IntegrityError` à volta do
próprio `INSERT`, para a corrida entre duas instâncias deste script (a
janela entre a verificação e a escrita) não deixar subir essa mensagem; a
recusa nesse caso tem a sua própria frase, sem o detalhe do erro.

## Uma base de dados por migrar é uma recusa nomeada, não um crash

`backend/CLAUDE.md`: sem `alembic upgrade head` não há tabelas nenhumas, e
é o caso normal de quem serve pela primeira vez — não um imprevisto. Antes
de abrir qualquer sessão do ORM, `problema_do_destino` verifica, com uma
ligação crua só de leitura, que o ficheiro existe e que a tabela `admins`
já lá está — o mesmo padrão que `scripts/backup.py::problema_da_origem` já
usa com `Path.is_file()` antes de qualquer `connect`. Sem isto, a primeira
consulta ao ORM levantava um `sqlite3.OperationalError: no such table:
admins`, com o `SELECT` inteiro por cima, e saía como «Rebentei a meio» —
a frase do imprevisto, para uma condição que o `CLAUDE.md` descreve em
detalhe.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sqlite3
import stat
import sys
from collections.abc import Sequence
from pathlib import Path

# O `sys.path` antes de qualquer coisa que toque no pacote `app`, pela
# mesma razão que em `passenger_wsgi.py` e em `scripts/importar_bd_antiga.py`:
# corrido como `python scripts/criar_admin.py`, o `sys.path[0]` é a pasta
# `scripts/`, e `import app` não encontrava nada.
RAIZ_INSTALACAO = Path(__file__).resolve().parent.parent
if str(RAIZ_INSTALACAO) not in sys.path:
    sys.path.insert(0, str(RAIZ_INSTALACAO))

from pydantic import ValidationError  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import Definicoes, obter_definicoes  # noqa: E402
from app.db import (  # noqa: E402
    abrir_so_leitura,
    criar_engine,
    tem_cabecalho_sqlite,
)
from app.linha_de_comandos import (  # noqa: E402
    AnalisadorEmPortugues,
    descrever_erro_de_configuracao,
)
from app.models.admins import Admin  # noqa: E402
from app.services.auth import (  # noqa: E402
    ResultadoDesbloqueio,
    desbloquear_admin,
    mudar_password,
    registar_admin,
)

#: Decisão do Tomás, `docs/TAREFAS.md` F2-02: abaixo disto é aviso, não
#: recusa.
COMPRIMENTO_MINIMO_SEM_AVISO = 12

_COMO_CORRER = (
    "Corre o script diretamente numa sessão SSH e escreve a password quando for pedida."
)
MENSAGEM_SEM_TERMINAL_PIPE = (
    "Não estás num terminal: a entrada vem de outro comando, e a password "
    f"nunca pode ser canalizada. {_COMO_CORRER}"
)
MENSAGEM_SEM_TERMINAL_OUTRO = (
    "Não estás num terminal: a entrada está fechada ou vazia (por exemplo, "
    f"numa tarefa agendada). {_COMO_CORRER}"
)
MENSAGEM_PASSWORD_VAZIA = (
    "A password está em branco e não é aceite. Corre o script outra vez e "
    "escreve uma password."
)
MENSAGEM_PASSWORDS_DIFERENTES = (
    "A password e a confirmação não são iguais. Corre o script outra vez e "
    "escreve as duas com cuidado."
)
AVISO_PASSWORD_CURTA = (
    f"Aviso: a password tem menos de {COMPRIMENTO_MINIMO_SEM_AVISO} "
    "caracteres. Não é recusada, mas uma mais comprida é mais difícil de "
    "adivinhar."
)


class Recusa(Exception):
    """O script não pode continuar. A mensagem diz porquê."""


# --- O guarda do terminal, e o pedido da password ---------------------------


def _e_um_pipe(descritor: int) -> bool:
    """Se o descritor de ficheiro `descritor` é um `FIFO` (um `pipe`).

    Distingue um `pipe` de `/dev/null`: os dois têm `isatty()` falso, mas
    só o `pipe` é um `FIFO` — `/dev/null` é um dispositivo de caracteres.
    É esta distinção que dá às duas recusas sem terminal frases
    diferentes (ver o cabeçalho deste ficheiro).
    """
    return stat.S_ISFIFO(os.fstat(descritor).st_mode)


def exigir_terminal() -> None:
    """Recusa, com uma de duas frases, antes de qualquer `getpass.getpass()`.

    Ver "A armadilha medida" no cabeçalho deste ficheiro: o `getpass`
    nativo não recusa sozinho sem terminal — este guarda é o que faz isso
    acontecer, e tem de correr **antes** do primeiro pedido de password.
    """
    if sys.stdin.isatty():
        return
    if _e_um_pipe(0):
        raise Recusa(MENSAGEM_SEM_TERMINAL_PIPE)
    raise Recusa(MENSAGEM_SEM_TERMINAL_OUTRO)


def pedir_password_nova() -> str:
    """Pede a password nova, com confirmação, e devolve-a já validada.

    Chama `exigir_terminal` primeiro, sempre — nenhum dos dois
    `getpass.getpass()` corre sem isso. Só recusa por estar vazia; abaixo
    de 12 caracteres é um aviso impresso em `stdout`, não uma recusa
    (`docs/TAREFAS.md`, F2-02).
    """
    exigir_terminal()
    primeira = getpass.getpass("Password nova: ")
    if not primeira:
        raise Recusa(MENSAGEM_PASSWORD_VAZIA)
    confirmacao = getpass.getpass("Confirma a password nova: ")
    if primeira != confirmacao:
        raise Recusa(MENSAGEM_PASSWORDS_DIFERENTES)
    if len(primeira) < COMPRIMENTO_MINIMO_SEM_AVISO:
        print(AVISO_PASSWORD_CURTA)
    return primeira


_CONFIRMAR_CONTA = "confirma o nome em --utilizador e a BASE_DADOS_URL/AMBIENTE."

# --- Os três modos -----------------------------------------------------------


def _criar(sessao: Session, utilizador: str) -> int:
    """Cria uma conta nova. Recusa se `utilizador` já existir.

    A verificação de duplicado vem antes de se pedir qualquer password —
    ver "Porque a verificação de duplicado vem antes do pedido de
    password" no cabeçalho deste ficheiro.
    """
    existente = sessao.scalar(select(Admin).where(Admin.utilizador == utilizador))
    if existente is not None:
        return recusar(
            [
                f"Já existe uma conta para «{utilizador}». Não a substituo: "
                "recriar eliminaria em silêncio a conta que lá está. Se a "
                f"password se perdeu, corre --mudar-password --utilizador "
                f"{utilizador}; se a conta ficou bloqueada, corre "
                f"--desbloquear --utilizador {utilizador}."
            ]
        )

    try:
        password = pedir_password_nova()
    except Recusa as recusa:
        return recusar([str(recusa)])

    try:
        registar_admin(sessao, utilizador, password)
    except IntegrityError:
        # A corrida entre a verificação acima e este `INSERT` — duas
        # instâncias deste script ao mesmo tempo. Nunca se deixa subir a
        # mensagem da exceção: ela traz o `INSERT` e os parâmetros
        # ligados, `hash_password` incluído (ver o cabeçalho deste
        # ficheiro).
        sessao.rollback()
        return recusar(
            [
                f"Já existe uma conta para «{utilizador}» — apareceu entre a "
                "verificação e a escrita (outra execução deste script ao "
                "mesmo tempo?). Não gravei nada. Se a password se perdeu, "
                f"corre --mudar-password --utilizador {utilizador}."
            ]
        )

    print(f"Criei a conta «{utilizador}».")
    return 0


def _mudar_a_password(sessao: Session, utilizador: str) -> int:
    """Muda a password de `utilizador`. Recusa se a conta não existir."""
    existente = sessao.scalar(select(Admin).where(Admin.utilizador == utilizador))
    if existente is None:
        return recusar(
            [
                f"Não existe nenhuma conta para «{utilizador}»: {_CONFIRMAR_CONTA} "
                "Para criar a conta, corre o script sem --mudar-password."
            ]
        )

    try:
        password = pedir_password_nova()
    except Recusa as recusa:
        return recusar([str(recusa)])

    if mudar_password(sessao, utilizador, password) is None:
        # A conta desapareceu entre a verificação e a escrita.
        return recusar(
            [
                f"A conta «{utilizador}» deixou de existir entre a "
                f"verificação e a escrita: {_CONFIRMAR_CONTA} Não mudei a "
                "password."
            ]
        )
    print(
        f"Mudei a password de «{utilizador}»; todas as sessões antigas "
        "foram terminadas."
    )
    return 0


def _desbloquear(sessao: Session, utilizador: str) -> int:
    """Desbloqueia `utilizador`. Não pede password nenhuma."""
    resultado = desbloquear_admin(sessao, utilizador)
    if resultado is ResultadoDesbloqueio.NAO_EXISTE:
        return recusar(
            [f"Não existe nenhuma conta para «{utilizador}»: {_CONFIRMAR_CONTA}"]
        )
    if resultado is ResultadoDesbloqueio.NAO_ESTAVA_BLOQUEADA:
        print(
            f"A conta «{utilizador}» não estava bloqueada; não mudei nada. Se "
            "o dono não consegue entrar, a password pode estar errada: usa "
            f"--mudar-password --utilizador {utilizador}."
        )
        return 0
    print(f"Desbloqueei a conta «{utilizador}».")
    return 0


# --- O destino: existe, e já foi migrado? -----------------------------------


def caminho_do_destino(definicoes: Definicoes) -> Path:
    """O ficheiro SQLite para onde a `BASE_DADOS_URL` aponta."""
    url = make_url(definicoes.base_dados_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        # `render_as_string(hide_password=True)`, nunca a cadeia original:
        # esta recusa só dispara para URLs que não são SQLite, exatamente
        # as que trazem `utilizador:password@servidor` lá dentro.
        raise Recusa(
            "A BASE_DADOS_URL não aponta para um ficheiro SQLite "
            f"(«{url.render_as_string(hide_password=True)}»), e este script "
            "só sabe escrever num. Confirma a configuração (e o AMBIENTE)."
        )
    return Path(url.database).resolve()


def problema_do_destino(destino: Path) -> str | None:
    """O destino existe e já tem a tabela `admins`? Se não, a frase da recusa.

    Verificado por fora do ORM, com uma ligação crua só de leitura —
    ver "Uma base de dados por migrar é uma recusa nomeada" no cabeçalho
    deste ficheiro. **Nenhuma** sessão do SQLAlchemy abre antes disto.
    """
    # `stat()` e não `Path.is_file()`: em Python 3.13+ o `is_file()` engole o
    # `PermissionError` e junta "não existe" com "não consegui ver" (regra 10).
    try:
        info = destino.stat()
    except FileNotFoundError:
        return (
            f"A base de dados {destino} não existe. Confirma a BASE_DADOS_URL "
            "e o AMBIENTE; se for a primeira vez, cria-se com «alembic "
            "upgrade head»."
        )
    except OSError as erro:
        return (
            f"Não consegui verificar o destino {destino} ({erro}). Confirma "
            "as permissões da pasta e a BASE_DADOS_URL."
        )
    if not stat.S_ISREG(info.st_mode):
        return f"O destino {destino} não é um ficheiro. Confirma a BASE_DADOS_URL."
    try:
        # 0 bytes passa: é uma base de dados por migrar (a recusa abaixo).
        if info.st_size > 0 and not tem_cabecalho_sqlite(destino):
            return (
                f"O destino {destino} não é uma base de dados SQLite (não "
                "começa pelo cabeçalho de uma). Confirma a BASE_DADOS_URL."
            )
        ligacao = abrir_so_leitura(destino)
        try:
            tabelas = {
                nome
                for (nome,) in ligacao.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
        finally:
            ligacao.close()
    except (OSError, sqlite3.Error) as erro:
        return (
            f"Não consegui ler o destino {destino} ({erro}). Confirma as "
            "permissões e a BASE_DADOS_URL."
        )
    if "admins" not in tabelas:
        return (
            f"O destino {destino} ainda não tem a tabela admins: nunca lhe "
            "correu migração nenhuma. Corre `alembic upgrade head` antes "
            "de criar, desbloquear, ou mudar a password de uma conta."
        )
    return None


# --- O relatório, o argparse, e o ponto de entrada --------------------------


def recusar(problemas: Sequence[str]) -> int:
    for problema in problemas:
        print(problema)
    print("Não criei, nem mudei, nem desbloqueei conta nenhuma.")
    return 1


def conclusao_do_rebentamento(erro: BaseException) -> str:
    """A conclusão de um defeito do script — não uma recusa. Ver
    `scripts/importar_bd_antiga.py::conclusao_do_rebentamento`, o mesmo
    raciocínio: o detalhe do erro vai na linha de cima, porque a mensagem
    de um `IntegrityError` do SQLAlchemy pode trazer várias linhas, e
    metê-la dentro desta partia a conclusão ao meio.
    """
    return (
        f"Erro inesperado ({type(erro).__name__}): é um defeito do script, "
        "não uma recusa. O detalhe está acima e o traceback a seguir. Garanto "
        "que nada fica gravado a meio: cada alteração é gravada de uma só "
        "vez, ou não é gravada."
    )


def construir_analisador() -> argparse.ArgumentParser:
    """A linha de comandos, com o texto todo em português."""
    analisador = AnalisadorEmPortugues(
        prog="criar_admin.py",
        description=(
            "Cria, desbloqueia, ou muda a password de uma conta de "
            "administração. A password nunca entra por argumento: é "
            "sempre pedida no terminal, duas vezes."
        ),
        epilog=(
            "O destino vem da configuração (BASE_DADOS_URL), como no "
            "alembic, e a variável AMBIENTE é obrigatória. Exemplos:\n"
            "  criar uma conta:\n"
            "    AMBIENTE=producao python scripts/criar_admin.py "
            "--utilizador dono\n"
            "  desbloquear uma conta:\n"
            "    AMBIENTE=producao python scripts/criar_admin.py "
            "--utilizador dono --desbloquear\n"
            "  mudar a password:\n"
            "    AMBIENTE=producao python scripts/criar_admin.py "
            "--utilizador dono --mudar-password"
        ),
    )
    analisador.add_argument(
        "--utilizador",
        required=True,
        metavar="NOME",
        help="o nome de utilizador da conta.",
    )
    grupo = analisador.add_mutually_exclusive_group()
    grupo.add_argument(
        "--desbloquear",
        action="store_true",
        help=(
            "desbloqueia a conta (limpa as tentativas falhadas e o "
            "bloqueio). Não pede password e não termina as sessões abertas."
        ),
    )
    grupo.add_argument(
        "--mudar-password",
        action="store_true",
        help=(
            "pede uma password nova (com confirmação) para uma conta já "
            "existente, e termina as sessões abertas."
        ),
    )
    return analisador


def executar(opcoes: argparse.Namespace) -> int:
    try:
        definicoes = obter_definicoes()
    except ValidationError as erro:
        return recusar([descrever_erro_de_configuracao(erro)])

    try:
        destino = caminho_do_destino(definicoes)
    except Recusa as recusa:
        return recusar([str(recusa)])

    problema = problema_do_destino(destino)
    if problema is not None:
        return recusar([problema])

    motor = criar_engine(definicoes.base_dados_url)
    try:
        with Session(motor) as sessao:
            if opcoes.desbloquear:
                return _desbloquear(sessao, opcoes.utilizador)
            if opcoes.mudar_password:
                return _mudar_a_password(sessao, opcoes.utilizador)
            return _criar(sessao, opcoes.utilizador)
    finally:
        motor.dispose()


def main(argumentos: Sequence[str] | None = None) -> int:
    opcoes = construir_analisador().parse_args(argumentos)
    try:
        return executar(opcoes)
    except Exception as erro:
        # Ver `scripts/importar_bd_antiga.py::main`: o mesmo raciocínio. O
        # detalhe do erro sai em `stdout`, antes da conclusão, e a exceção
        # segue viagem para o `traceback` em `stderr` — nunca engolida.
        print(f"O erro foi: {type(erro).__name__}: {erro}")
        print(conclusao_do_rebentamento(erro))
        raise


if __name__ == "__main__":
    raise SystemExit(main())
