"""Apoio da F2-02: lançadores de `scripts/criar_admin.py` e `scripts/backup.py`.

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_legado.py` e `tests/apoio_subprocesso.py` não são. É usado por
`tests/test_criar_admin.py`, `tests/test_backup.py` e por
`tests/seguranca/test_criar_admin_nao_mostra_a_password.py`.

## O contrato dos dois scripts, que estes testes fixam

### `scripts/criar_admin.py`

```bash
AMBIENTE=... python scripts/criar_admin.py --utilizador NOME [--desbloquear | --mudar-password]
```

- `--utilizador` é **sempre** obrigatório.
- Sem opção extra: **cria** uma conta nova. Recusa se já existir uma com o
  mesmo `utilizador` — e nem o hash nem o `sessao_versao` dessa conta
  mudam (`docs/TAREFAS.md`, F2-02).
- `--desbloquear`: põe `tentativas_falhadas = 0` e `bloqueado_ate = NULL`,
  **sem tocar no `sessao_versao`** (decisão do Tomás, herança da F2-04).
  Não pede password nenhuma — é a propriedade que o distingue dos outros
  dois modos, e o que permite correr com `stdin` em `/dev/null`.
- `--mudar-password`: pede a password nova (com confirmação, como o modo
  de criação) e grava-a, **incrementando o `sessao_versao`** — mata as
  sessões antigas, decisão do Tomás de 9 de novembro de 2026.
- A password **nunca** entra por argumento. É sempre pedida no terminal,
  duas vezes (entrada e confirmação); as duas têm de bater certo.
- Estado de saída `0` só quando a operação pedida teve sucesso; diferente
  de zero em qualquer recusa.

### `scripts/backup.py`

```bash
AMBIENTE=... python scripts/backup.py
```

Sem argumentos nenhuns. Copia `BASE_DADOS_URL` (pela API de backup do
SQLite — nunca um `shutil.copyfile`, ver abaixo) para dentro de
`backups_dir` (`DATA_DIR/backups`, `app/config.py`), e mantém só os 30
ficheiros de backup mais recentes **por nome**.

## A contagem do nome dos backups é um contrato que este ficheiro fixa

`docs/TAREFAS.md` decide "30 ficheiros, por nome" mas não decide o
formato do nome. Como os testes de rotação precisam de forjar ficheiros
que o script reconheça como backups seus (para os poder contar, manter e
descartar), o nome tem de ser um contrato explícito — fixado aqui, não
adivinhado pelo implementador. Se um dia mudar, muda-se aqui **e** no
script, de propósito, nunca um sem o outro.

Formato: `tomazia-AAAAMMDDTHHMMSSZ.db`, instante em UTC. Fixo em largura e
com os campos do mais para o menos significativo, por isso a ordem
alfabética **é** a ordem cronológica — a propriedade que
`PADRAO_NOME_DE_BACKUP`/`nome_de_backup` existem para garantir.

## O ponto de extensão que falta: o relógio do backup

O teste da colisão de nomes ("nome já existente → recusa, não
sobrescreve") precisa de forçar duas corridas a calhar no mesmo segundo —
e com um relógio de parede real isso é uma corrida verdadeira, não um
teste determinístico. Pela mesma razão que `tests/apoio_auth.py::
fixar_relogio_auth` injeta `agora_utc` em processo, mas aqui o script
corre num **subprocesso**, por isso a injeção tem de ser por ambiente:

**`scripts/backup.py` tem de ler a variável de ambiente
`TOMAZIA_AGORA_UTC`** (uma data e hora ISO 8601, com fuso) e usá-la como
"agora" em vez de `datetime.now(UTC)`, quando estiver definida. Sem
isto, `test_nome_ja_existente_recusa_e_nao_sobrescreve` só pode mesmo
tentar a corrida de duas chamadas no mesmo segundo, o que o torna
instável por construção — exatamente o que este projeto evita em todo o
lado (ver `tests/apoio_auth.py::fixar_relogio_auth`, `RelogioFixo`).

## A armadilha medida: `TCSAFLUSH` pode bloquear para sempre com um pty sintético

Os testes que pedem a password interativamente (`correr_criar_admin`, por
baixo `correr_com_pty`) precisam de um pseudo-terminal real — `getpass.getpass()`
abre `/dev/tty` diretamente (não `sys.stdin`), e isso só existe quando o
processo tem mesmo um terminal de controlo. Um `subprocess.PIPE` nunca
chega.

Medido (macOS, Python 3.14, mas o mecanismo é POSIX): se se escrever
**mais do que uma linha** para o lado master do pty antes de o processo
filho ter oportunidade de consumir a primeira, o
`termios.tcsetattr(fd, TCSAFLUSH, ...)` que o `getpass` chama para
**restaurar** as definições do terminal, depois de ler essa primeira
linha, **bloqueia indefinidamente** — `TCSAFLUSH` inclui "descartar a
entrada não lida", e com uma segunda linha ainda em fila isso nunca
regressa. Um `getpass.getpass()` chamado duas vezes seguidas (password e
confirmação) é precisamente o caso: escrever as duas linhas de uma vez
pendura o processo todo, incluindo o `os.waitpid` de quem o lançou.

E o mesmo `TCSAFLUSH` morde também à entrada: o `getpass` desliga o eco
com ele **antes** de escrever a pergunta, e o que já estiver em fila nesse
instante é descartado. Uma linha escrita cedo de mais perde-se, o
`getpass` fica à espera dela até ao `timeout`, e o script morre com
SIGHUP (estado `-1`) e `stdout` vazio.

A primeira versão deste ficheiro escrevia por relógio, com uma pausa fixa
de 0,25 s. Passava sozinha e falhava na bateria completa — medido: nove
falhas numa volta, uma noutra, sempre testes diferentes — porque com a
máquina carregada o Python demora mais do que isso a chegar ao `getpass`.

Por isso cada linha só é escrita **depois de a pergunta aparecer** no lado
master do pty (`FIM_DE_PERGUNTA`), como faz o `expect` do `pexpect`. A
pergunta é escrita depois do `TCSAFLUSH` que desliga o eco e antes do
que o restaura, e por isso, a partir dela, a linha escrita é lida — seja
qual for a carga da máquina.
"""

from __future__ import annotations

import contextlib
import os
import re
import select
import signal
import sqlite3
import sys
import time
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, NamedTuple

import pytest

from tests import apoio_esquema

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
RAIZ_REPO = RAIZ_BACKEND.parent

CAMINHO_CRIAR_ADMIN = RAIZ_BACKEND / "scripts" / "criar_admin.py"
CAMINHO_BACKUP = RAIZ_BACKEND / "scripts" / "backup.py"


def _mensagem_script_em_falta(caminho: Path) -> str:
    return (
        f"{caminho.relative_to(RAIZ_REPO)} ainda não existe. É um script da "
        "F2-02, e é isto que estes testes existem para pedir: enquanto ele "
        "não aterrar, toda a bateria que o lança falha aqui, nesta mensagem, "
        "e não num `FileNotFoundError` nem num caminho mal escrito."
    )


MENSAGEM_CRIAR_ADMIN_EM_FALTA = _mensagem_script_em_falta(CAMINHO_CRIAR_ADMIN)
MENSAGEM_BACKUP_EM_FALTA = _mensagem_script_em_falta(CAMINHO_BACKUP)


def carregar_script(caminho: Path) -> Any:
    """Importa `caminho` (um script de `scripts/`) como módulo, em processo.

    Para os testes que exercitam uma função do script sem subprocesso
    (condições que o subprocesso não consegue forjar: uma corrida entre a
    verificação e a escrita, uma origem que desaparece a meio).
    """
    import importlib.util

    especificacao = importlib.util.spec_from_file_location(
        f"script_{caminho.stem}", caminho
    )
    assert especificacao is not None and especificacao.loader is not None
    modulo = importlib.util.module_from_spec(especificacao)
    # Os `dataclass` do script procuram o módulo em `sys.modules`.
    sys.modules[especificacao.name] = modulo
    especificacao.loader.exec_module(modulo)
    return modulo


def exigir_criar_admin() -> Path:
    """O caminho de `criar_admin.py`, ou um erro que diz que ainda não existe."""
    if not CAMINHO_CRIAR_ADMIN.is_file():
        raise RuntimeError(MENSAGEM_CRIAR_ADMIN_EM_FALTA)
    return CAMINHO_CRIAR_ADMIN


def exigir_backup() -> Path:
    """O caminho de `backup.py`, ou um erro que diz que ainda não existe."""
    if not CAMINHO_BACKUP.is_file():
        raise RuntimeError(MENSAGEM_BACKUP_EM_FALTA)
    return CAMINHO_BACKUP


# --- Dados falsos (regra 1 do CLAUDE.md) ----------------------------------

#: Nunca o dono real. Claramente inventado, como `tests/apoio_auth.py::
#: UTILIZADOR_FALSO`, mas um nome diferente — estes testes correm o script
#: por fora da app, e confundir as duas contas numa mensagem de erro seria
#: confuso de depurar.
UTILIZADOR_DE_EXEMPLO = "dono-de-exemplo-f2-02"

#: >= 12 carateres de propósito: é o limiar do aviso (não recusa) que o
#: Tomás decidiu; os testes que querem ficar calados sobre esse aviso usam
#: uma password já acima dele.
PASSWORD_DE_EXEMPLO = "palavra-passe-nova-de-exemplo-0002"
PASSWORD_DE_EXEMPLO_B = "palavra-passe-nova-de-exemplo-0003"
PASSWORD_MUDADA_DE_EXEMPLO = "palavra-passe-mudada-de-exemplo-0004"

#: O que alguém tentaria "passar por cima" de um `echo ... | script`. Não
#: pode nunca criar conta nenhuma.
PASSWORD_DE_PIPE_DE_EXEMPLO = "password-escrita-num-pipe-de-exemplo"


# --- Ambiente dos subprocessos ---------------------------------------------


def _ambiente_base(destino_bd: Path, *, isolamento: Path) -> dict[str, str]:
    """Ambiente mínimo, isolado do `backend/.env` real.

    Mesmo padrão de `tests/apoio_legado.py::ambiente_do_importador` e de
    `tests/apoio_esquema.py::ambiente_do_alembic`: nunca se herda o
    ambiente de quem corre os testes, e `BASE_DADOS_URL` aponta sempre
    para o ficheiro do teste.
    """
    return {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "PYTHONPATH": str(RAIZ_BACKEND),
        "AMBIENTE": "desenvolvimento",
        "BASE_DADOS_URL": f"sqlite:///{destino_bd}",
        "DATA_DIR": str(isolamento / "dados"),
        "TOMAZIA_ENV_FILE": str(
            isolamento / "isolamento-de-testes-nao-existe" / ".env"
        ),
    }


def ambiente_criar_admin(
    destino_bd: Path,
    *,
    isolamento: Path | None = None,
    ambiente_extra: Mapping[str, str] | None = None,
    remover: Sequence[str] = (),
) -> dict[str, str]:
    """Ambiente para `criar_admin.py`.

    `remover` tira chaves do ambiente mínimo depois de o construir — é o
    que `test_sem_ambiente_recusa_e_nada_escreve` usa para apagar
    `AMBIENTE` de propósito, sem correr o risco de o herdar de quem corre
    os testes.
    """
    ambiente = _ambiente_base(destino_bd, isolamento=isolamento or destino_bd.parent)
    ambiente.update(ambiente_extra or {})
    for chave in remover:
        ambiente.pop(chave, None)
    return ambiente


def ambiente_backup(
    origem_bd: Path,
    *,
    data_dir: Path,
    isolamento: Path | None = None,
    agora_utc: datetime | None = None,
    ambiente_extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Ambiente para `backup.py`. `data_dir` é de onde `backups_dir` deriva.

    `agora_utc`, quando dado, viaja em `TOMAZIA_AGORA_UTC` — o ponto de
    extensão descrito no cabeçalho deste ficheiro, para os testes de
    rotação e de colisão de nome não dependerem do relógio de parede.
    """
    ambiente = _ambiente_base(origem_bd, isolamento=isolamento or origem_bd.parent)
    ambiente["DATA_DIR"] = str(data_dir)
    if agora_utc is not None:
        ambiente["TOMAZIA_AGORA_UTC"] = agora_utc.isoformat()
    ambiente.update(ambiente_extra or {})
    return ambiente


# --- O resultado de uma corrida ---------------------------------------------


@dataclass(frozen=True)
class ResultadoDoScript:
    """O que um subprocesso de `criar_admin.py` ou `backup.py` disse."""

    estado: int
    stdout: str
    stderr: str
    comando: tuple[str, ...]

    @property
    def tudo(self) -> str:
        """`stdout` e `stderr` juntos — onde quer que a mensagem tenha ido."""
        return self.stdout + self.stderr

    def relatorio(self, rotulo: str = "script") -> str:
        """Regra 10: um estado não-zero tanto é "recusei" como "rebentei".

        A mensagem traz os dois fluxos para a diferença se ver sem
        reproduzir nada à mão.
        """
        return (
            f"{rotulo} {' '.join(self.comando)}\n"
            f"terminou com estado {self.estado}\n"
            f"--- stdout ---\n{self.stdout}\n"
            f"--- stderr ---\n{self.stderr}"
        )


# --- Lançar com stdin "normal" (pipe / /dev/null), sem pty -----------------


def correr_com_stdin_pipe(
    script: Path,
    argumentos: Sequence[str],
    *,
    cwd: Path,
    ambiente: Mapping[str, str],
    entrada: str,
    timeout: float = 30,
) -> ResultadoDoScript:
    """Corre `script` com `stdin` ligado a um `pipe` com `entrada` escrita.

    Um `pipe`, nunca um terminal: `sys.stdin.isatty()` é `False` aqui,
    tal como seria com `echo ... | python script.py`.
    """
    import subprocess

    comando = (sys.executable, str(script), *argumentos)
    concluido = subprocess.run(
        comando,
        cwd=cwd,
        env=dict(ambiente),
        input=entrada,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return ResultadoDoScript(
        estado=concluido.returncode,
        stdout=concluido.stdout,
        stderr=concluido.stderr,
        comando=comando,
    )


def correr_com_stdin_devnull(
    script: Path,
    argumentos: Sequence[str],
    *,
    cwd: Path,
    ambiente: Mapping[str, str],
    timeout: float = 30,
) -> ResultadoDoScript:
    """Corre `script` com `stdin` ligado a `/dev/null`.

    Também não é um terminal (`isatty()` é `False`), mas é um dispositivo
    de caracteres, não um `FIFO` — a distinção que permite ao script dar
    uma segunda frase, diferente da do `pipe` (ver o cabeçalho deste
    ficheiro e `docs/TAREFAS.md`, F2-02).
    """
    import subprocess

    comando = (sys.executable, str(script), *argumentos)
    concluido = subprocess.run(
        comando,
        cwd=cwd,
        env=dict(ambiente),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return ResultadoDoScript(
        estado=concluido.returncode,
        stdout=concluido.stdout,
        stderr=concluido.stderr,
        comando=comando,
    )


# --- Lançar com um pseudo-terminal real -------------------------------------

#: Como acaba cada pergunta do `criar_admin.py` ("Password nova: ",
#: "Confirma a password nova: "). Uma linha só é escrita no pty depois de o
#: que o terminal mostrou desde a escrita anterior acabar nisto — ver a
#: secção "A armadilha medida" no cabeçalho deste ficheiro.
FIM_DE_PERGUNTA = b": "

#: Tempo extra concedido, depois do `timeout` pedido, a um processo a quem
#: se fechou o pty sem escrever mais nada, antes de se desistir e o matar.
#: Só entra em jogo quando algo correu mal (o script pede mais linhas do
#: que as fornecidas) — nunca no caminho feliz.
PRAZO_DE_ENCERRAMENTO = 3.0


def correr_com_pty(
    script: Path,
    argumentos: Sequence[str],
    *,
    cwd: Path,
    ambiente: Mapping[str, str],
    entradas: Sequence[str] = (),
    timeout: float = 20,
) -> ResultadoDoScript:
    """Corre `script` com `stdin` ligado a um pseudo-terminal real.

    Necessário porque `getpass.getpass()` abre `/dev/tty` diretamente
    (não `sys.stdin`) sempre que há um terminal de controlo — e só há um
    terminal de controlo com um pty a sério, nunca com um `subprocess.PIPE`.

    `entradas` são as linhas "escritas" (cada uma seguida de newline),
    **uma de cada vez**, cada uma só depois de a pergunta correspondente
    aparecer no terminal — ver o cabeçalho deste ficheiro. `stdout` e `stderr` do processo são lidos de
    *pipes* à parte (nunca do pty): o que o script imprime nunca se mistura
    com o que o pty ecoa.

    Usa `os.forkpty()` em vez de `subprocess.Popen(stdin=slave_fd)`: medido
    que o segundo **não** estabelece o terminal de controlo do processo
    filho (o `slave_fd` já estava aberto antes do `fork`; só um `open()` a
    sério do dispositivo, pelo processo sessão-líder, o faz) — e sem
    terminal de controlo, `getpass` nunca consegue abrir `/dev/tty`.
    """
    stdout_r, stdout_w = os.pipe()
    stderr_r, stderr_w = os.pipe()

    pid, master_fd = os.forkpty()
    if pid == 0:  # pragma: no cover - corre no processo filho
        try:
            os.close(stdout_r)
            os.close(stderr_r)
            os.dup2(stdout_w, 1)
            os.dup2(stderr_w, 2)
            os.close(stdout_w)
            os.close(stderr_w)
            os.chdir(str(cwd))
            os.execvpe(
                sys.executable,
                [sys.executable, str(script), *argumentos],
                dict(ambiente),
            )
        except BaseException:
            pass
        os._exit(127)

    os.close(stdout_w)
    os.close(stderr_w)
    os.set_blocking(stdout_r, False)
    os.set_blocking(stderr_r, False)
    os.set_blocking(master_fd, False)

    comando = (sys.executable, str(script), *argumentos)
    saida = b""
    erro = b""
    fds = {stdout_r, stderr_r, master_fd}
    pendentes = list(entradas)
    erro_de_escrita: OSError | None = None
    limite = time.monotonic() + timeout
    # O que o terminal mostrou desde a última linha escrita. Recomeça a
    # cada escrita, para que a pergunta que já foi respondida não sirva de
    # sinal à linha seguinte.
    terminal = b""

    while fds:
        agora = time.monotonic()
        restante = limite - agora
        if restante <= 0:
            break
        if pendentes and terminal.endswith(FIM_DE_PERGUNTA):
            linha = pendentes.pop(0)
            try:
                os.write(master_fd, (linha + "\n").encode("utf-8"))
            except OSError as falha:
                # Não se engole: a pergunta apareceu e a resposta não
                # chegou ao script. Guarda-se, para falhar com ela depois
                # de arrumar o processo, em vez de esperar o `timeout`.
                erro_de_escrita = falha
                break
            terminal = b""
        prontos, _, _ = select.select(list(fds), [], [], min(restante, 0.05))
        for fd in prontos:
            try:
                pedaco = os.read(fd, 4096)
            except OSError:
                pedaco = b""
            if not pedaco:
                fds.discard(fd)
                continue
            if fd == stdout_r:
                saida += pedaco
            elif fd == stderr_r:
                erro += pedaco
            else:
                # o que sai do próprio `master_fd` (as perguntas) só serve
                # para saber quando escrever: as asserções olham para
                # `stdout`/`stderr`, lidos dos `pipes` à parte.
                terminal += pedaco

    # Se ainda há `fds` por aqui, o processo pediu mais linhas do que as
    # fornecidas (ou nunca mais respondeu). Fecha o pty — simula o
    # terminal a desligar-se — e dá-lhe um prazo curto antes de o abater:
    # um teste mal calibrado tem de falhar numa asserção, não pendurar a
    # bateria toda.
    with contextlib.suppress(OSError):
        os.close(master_fd)

    prazo = time.monotonic() + PRAZO_DE_ENCERRAMENTO
    pid_saiu = 0
    estado_bruto = 0
    while time.monotonic() < prazo:
        pid_saiu, estado_bruto = os.waitpid(pid, os.WNOHANG)
        if pid_saiu:
            break
        time.sleep(0.05)
    if not pid_saiu:
        os.kill(pid, signal.SIGKILL)
        pid_saiu, estado_bruto = os.waitpid(pid, 0)

    for fd in (stdout_r, stderr_r):
        try:
            while True:
                pedaco = os.read(fd, 4096)
                if not pedaco:
                    break
                if fd == stdout_r:
                    saida += pedaco
                else:
                    erro += pedaco
        except OSError:
            pass
        with contextlib.suppress(OSError):
            os.close(fd)

    if erro_de_escrita is not None:
        raise AssertionError(
            "não consegui escrever a resposta no pseudo-terminal "
            f"({erro_de_escrita!r}); stdout={saida.decode('utf-8', 'replace')!r} "
            f"stderr={erro.decode('utf-8', 'replace')!r}"
        ) from erro_de_escrita

    codigo = os.waitstatus_to_exitcode(estado_bruto)
    return ResultadoDoScript(
        estado=codigo,
        stdout=saida.decode("utf-8", errors="replace"),
        stderr=erro.decode("utf-8", errors="replace"),
        comando=comando,
    )


# --- `criar_admin.py`: lançadores de alto nível -----------------------------


def correr_criar_admin(
    *,
    destino_bd: Path,
    utilizador: str = UTILIZADOR_DE_EXEMPLO,
    entradas: Sequence[str],
    argumentos_extra: Sequence[str] = (),
    ambiente_extra: Mapping[str, str] | None = None,
    isolamento: Path | None = None,
    timeout: float = 20,
) -> ResultadoDoScript:
    """`criar_admin.py --utilizador <utilizador> <argumentos_extra>`, por pty.

    `entradas` são as linhas da password (e, em modos que a pedem duas
    vezes, da confirmação), na ordem em que o script as pedir.
    """
    script = exigir_criar_admin()
    ambiente = ambiente_criar_admin(
        destino_bd, isolamento=isolamento, ambiente_extra=ambiente_extra
    )
    return correr_com_pty(
        script,
        ["--utilizador", utilizador, *argumentos_extra],
        cwd=RAIZ_BACKEND,
        ambiente=ambiente,
        entradas=entradas,
        timeout=timeout,
    )


def criar_admin_com_sucesso(
    *,
    destino_bd: Path,
    utilizador: str = UTILIZADOR_DE_EXEMPLO,
    password: str = PASSWORD_DE_EXEMPLO,
    isolamento: Path | None = None,
) -> ResultadoDoScript:
    """Cria `utilizador`/`password`, com as duas digitações iguais.

    Falha alto (via `assert`) se o próprio script recusar: os testes que
    chamam isto já pressupõem uma conta criada, e um `assert` aqui separa
    "a fixture de apoio falhou" de "o comportamento em teste falhou".
    """
    resultado = correr_criar_admin(
        destino_bd=destino_bd,
        utilizador=utilizador,
        entradas=[password, password],
        isolamento=isolamento,
    )
    assert resultado.estado == 0, (
        f"a criação de apoio de '{utilizador}' falhou: {resultado.relatorio()}"
    )
    return resultado


def correr_criar_admin_com_pipe(
    *,
    destino_bd: Path,
    utilizador: str = UTILIZADOR_DE_EXEMPLO,
    entrada: str = PASSWORD_DE_PIPE_DE_EXEMPLO + "\n",
    isolamento: Path | None = None,
) -> ResultadoDoScript:
    """`criar_admin.py` com `stdin` num `pipe` — nunca um terminal."""
    script = exigir_criar_admin()
    ambiente = ambiente_criar_admin(destino_bd, isolamento=isolamento)
    return correr_com_stdin_pipe(
        script,
        ["--utilizador", utilizador],
        cwd=RAIZ_BACKEND,
        ambiente=ambiente,
        entrada=entrada,
    )


def correr_criar_admin_com_devnull(
    *,
    destino_bd: Path,
    utilizador: str = UTILIZADOR_DE_EXEMPLO,
    argumentos_extra: Sequence[str] = (),
    isolamento: Path | None = None,
) -> ResultadoDoScript:
    """`criar_admin.py` com `stdin` em `/dev/null`."""
    script = exigir_criar_admin()
    ambiente = ambiente_criar_admin(destino_bd, isolamento=isolamento)
    return correr_com_stdin_devnull(
        script,
        ["--utilizador", utilizador, *argumentos_extra],
        cwd=RAIZ_BACKEND,
        ambiente=ambiente,
    )


def contar_admins(destino_bd: Path) -> int:
    """`SELECT COUNT(*) FROM admins`, por uma ligação crua e só de leitura."""
    ligacao = sqlite3.connect(f"file:{destino_bd}?mode=ro", uri=True)
    try:
        (quantas,) = ligacao.execute("SELECT COUNT(*) FROM admins").fetchone()
        return int(quantas)
    finally:
        ligacao.close()


def ler_admin(destino_bd: Path, utilizador: str) -> sqlite3.Row | None:
    """A linha de `admins` para `utilizador`, ou `None`."""
    ligacao = sqlite3.connect(f"file:{destino_bd}?mode=ro", uri=True)
    ligacao.row_factory = sqlite3.Row
    try:
        return ligacao.execute(
            "SELECT * FROM admins WHERE utilizador = ?", (utilizador,)
        ).fetchone()
    finally:
        ligacao.close()


def definir_bloqueio(
    destino_bd: Path,
    utilizador: str,
    *,
    tentativas_falhadas: int,
    bloqueado_ate: datetime | None,
) -> None:
    """Põe `admins.tentativas_falhadas`/`bloqueado_ate` nos valores dados.

    Pelo ORM (não SQL cru): é o que faz `bloqueado_ate` gravar-se como o
    `DataHoraUTC` espera. Simula o que `app.services.auth.autenticar`
    deixaria depois de 5 falhas — sem ter de passar por `POST /auth/login`
    cinco vezes só para montar o cenário de `--desbloquear`.
    """
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from app.models.admins import Admin

    motor = create_engine(f"sqlite:///{destino_bd}")
    try:
        with Session(motor) as sessao:
            admin = sessao.scalar(select(Admin).where(Admin.utilizador == utilizador))
            assert admin is not None, (
                f"'{utilizador}' não existe em {destino_bd} — a fixture de "
                "apoio que o devia ter criado falhou antes deste ponto"
            )
            admin.tentativas_falhadas = tentativas_falhadas
            admin.bloqueado_ate = bloqueado_ate
            sessao.commit()
    finally:
        motor.dispose()


class AutenticacaoNoDestino(NamedTuple):
    """O que interessa de um `Admin` depois de `autenticar`, sem o objeto ORM.

    Nunca o objeto `Admin` em si: a sessão que o carregou fecha-se antes
    de devolver, e um atributo lido depois disso rebentaria com
    `DetachedInstanceError` — mais um caso do "não consegui ler" a
    disfarçar-se de outra coisa (regra 10) se não se tivesse isto em conta.
    """

    id: int
    utilizador: str
    sessao_versao: int


def autenticar_no_destino(
    destino_bd: Path, utilizador: str, password: str
) -> AutenticacaoNoDestino:
    """Chama `app.services.auth.autenticar` contra `destino_bd`.

    É a prova que mais interessa destes testes: que o invólucro
    (`criar_admin.py`) não divergiu do login — a mesma password que o
    script gravou tem de autenticar pela mesma função que
    `POST /auth/login` usa. Levanta `app.erros.ErroDaApi` para
    credenciais inválidas, exatamente como o login faria.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.services.auth import autenticar

    motor = create_engine(f"sqlite:///{destino_bd}")
    try:
        with Session(motor) as sessao:
            admin = autenticar(sessao, utilizador, password)
            return AutenticacaoNoDestino(
                id=admin.id,
                utilizador=admin.utilizador,
                sessao_versao=admin.sessao_versao,
            )
    finally:
        motor.dispose()


# --- `backup.py`: o nome dos ficheiros, e lançadores de alto nível ----------

PREFIXO_BACKUP = "tomazia-"
SUFIXO_BACKUP = ".db"
#: UTC, largura fixa, do campo mais para o menos significativo: a ordem
#: alfabética dos nomes **é** a ordem cronológica. É o contrato que a
#: Camada de rotação destes testes fixa para `backup.py` (ver o cabeçalho
#: deste ficheiro).
FORMATO_TIMESTAMP_BACKUP = "%Y%m%dT%H%M%SZ"
PADRAO_NOME_DE_BACKUP = re.compile(r"^tomazia-\d{8}T\d{6}Z\.db$")


def nome_de_backup(instante: datetime) -> str:
    """O nome de ficheiro que `backup.py` deve dar a uma cópia de `instante`."""
    return (
        f"{PREFIXO_BACKUP}{instante.strftime(FORMATO_TIMESTAMP_BACKUP)}{SUFIXO_BACKUP}"
    )


def e_nome_de_backup(nome: str) -> bool:
    """Se `nome` seria reconhecido por `backup.py` como um backup seu."""
    return bool(PADRAO_NOME_DE_BACKUP.match(nome))


def ficheiros_parciais(pasta: Path) -> list[Path]:
    """Qualquer `*.parcial` deixado para trás, em `pasta` e só lá.

    Uma escrita atómica (criar à parte, `os.rename` no fim) não deixa
    nenhum, nem no caminho feliz nem numa recusa a meio.
    """
    if not pasta.is_dir():
        return []
    return sorted(pasta.glob("*.parcial"))


def correr_backup(
    *,
    origem_bd: Path,
    data_dir: Path,
    agora_utc: datetime | None = None,
    ambiente_extra: Mapping[str, str] | None = None,
    isolamento: Path | None = None,
    timeout: float = 30,
    criar_data_dir: bool = True,
) -> ResultadoDoScript:
    """`backup.py`, sem argumentos. `stdin` em `/dev/null`: nunca é pedido nada.

    `criar_data_dir`: o `backup.py` não cria o `DATA_DIR` (recusa se faltar),
    por isso por omissão cria-se aqui, como o `alembic`/o deploy o fariam.
    """
    if criar_data_dir:
        data_dir.mkdir(parents=True, exist_ok=True)
    script = exigir_backup()
    ambiente = ambiente_backup(
        origem_bd,
        data_dir=data_dir,
        isolamento=isolamento,
        agora_utc=agora_utc,
        ambiente_extra=ambiente_extra,
    )
    return correr_com_stdin_devnull(
        script, [], cwd=RAIZ_BACKEND, ambiente=ambiente, timeout=timeout
    )


# --- Fixtures: uma base de dados em `head`, só para a F2-02 -----------------
#
# Cópia deliberada do molde de `tests/apoio_http.py::_bd_modelo_em_head` e
# de `tests/apoio_legado.py::_destino_modelo_em_head` — não reaproveitada
# delas: os nomes de ficheiro dessas fixtures são distintivos de outras
# tarefas (o de `apoio_legado.py` chama-se `destino-de-teste-f2-08.db`), e
# misturar os dois tornaria as mensagens de recusa confusas sobre a que
# tarefa pertence o destino que falhou.


@pytest.fixture(scope="session")
def _bd_modelo_scripts(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    """Uma base de dados em `head`, construída uma vez por sessão de testes."""
    pasta = tmp_path_factory.mktemp("esquema-em-head-para-scripts")
    modelo = apoio_esquema.construir_bd_com_alembic(pasta / "modelo.db")
    pasta.chmod(0o555)
    try:
        yield modelo
    finally:
        pasta.chmod(0o755)


@pytest.fixture
def bd_em_head(tmp_path: Path, _bd_modelo_scripts: Path) -> Path:
    """Uma cópia escrevível, nova em cada teste, da base de dados em `head`."""
    pasta = tmp_path / "bd"
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / "tomazia-de-teste.db"
    apoio_esquema.exigir_destino_sem_vestigios(destino)
    import shutil

    shutil.copyfile(_bd_modelo_scripts, destino)
    destino.chmod(0o644)
    return destino
