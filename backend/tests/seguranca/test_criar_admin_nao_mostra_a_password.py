"""`scripts/criar_admin.py` nunca imprime a password nem o hash (F2-02).

Regra 5 do `CLAUDE.md`. Precedente:
`tests/seguranca/test_importador_nao_mostra_a_password_do_destino.py` — o
mesmo raciocínio, outro script: o relatório destes scripts corre-se por
SSH, sai em `stdout`/`stderr`, e é desses dois fluxos que alguém copia e
cola quando pede ajuda.

**O detalhe medido que este ficheiro existe para prender:** a mensagem de
um `sqlalchemy.exc.IntegrityError` traz o `SQL` **e os parâmetros ligados**
— ou seja, se `criar_admin.py` recusar um utilizador duplicado deixando a
`UNIQUE constraint failed` da base de dados subir sem a apanhar, o
`hash_password` (já calculado, já pronto a inserir) sai impresso dentro da
mensagem da exceção. Por isso o cenário mais importante deste ficheiro não
é o caminho feliz — é tentar **recriar** um utilizador que já existe, que é
precisamente o caminho que dispara essa restrição.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from tests.apoio_scripts_de_admin import (
    correr_criar_admin,
    correr_criar_admin_com_pipe,
    criar_admin_com_sucesso,
)

#: Cadeias únicas e improváveis, no molde dos marcadores de
#: `tests/apoio_legado.py`: se aparecerem nalgum byte de `stdout`/`stderr`,
#: foi o script que as lá pôs.
PASSWORD_MARCADOR = "psw-marcador-criar-admin-f2-02-7c3e1a9b-nao-pode-sair"
PASSWORD_MARCADOR_B = "psw-marcador-criar-admin-f2-02-a4f08d6c-recriar"
PASSWORD_MARCADOR_MUDADA = "psw-marcador-criar-admin-f2-02-5e2b9f31-mudada"

#: O prefixo de um hash argon2id (`argon2-cffi`). Se isto aparecer em
#: qualquer saída, é o hash — não a password em claro — a escapar.
PREFIXO_DO_HASH = "$argon2id$"

UTILIZADOR = "dono-de-exemplo-s05-password"


def _sem_marcadores(resultado_tudo: str, *marcadores: str) -> None:
    for marcador in marcadores:
        assert marcador not in resultado_tudo, (
            f"'{marcador}' apareceu na saída do script: {resultado_tudo!r}"
        )
    assert PREFIXO_DO_HASH not in resultado_tudo, (
        f"um hash argon2id apareceu na saída do script: {resultado_tudo!r}"
    )


def test_criar_a_conta_nao_mostra_a_password_nem_o_hash(bd_em_head: Path) -> None:
    """O caminho feliz: nem a password escrita, nem o hash que ela gerou."""
    resultado = correr_criar_admin(
        destino_bd=bd_em_head,
        utilizador=UTILIZADOR,
        entradas=[PASSWORD_MARCADOR, PASSWORD_MARCADOR],
    )
    assert resultado.estado == 0, resultado.relatorio()
    _sem_marcadores(resultado.tudo, PASSWORD_MARCADOR)


def test_recriar_um_utilizador_existente_nao_mostra_a_password_nem_o_hash(
    bd_em_head: Path,
) -> None:
    """O cenário que importa: é aqui que uma `IntegrityError` mal apanhada fala demais.

    Recriar é recusado (`docs/TAREFAS.md`, F2-02) — e se essa recusa vier
    de deixar subir a exceção da restrição `UNIQUE` da base de dados em
    vez de a apanhar antes, a mensagem da exceção traz o `INSERT` e os
    parâmetros, **hash incluído**.
    """
    criar_admin_com_sucesso(
        destino_bd=bd_em_head, utilizador=UTILIZADOR, password=PASSWORD_MARCADOR
    )

    resultado = correr_criar_admin(
        destino_bd=bd_em_head,
        utilizador=UTILIZADOR,
        entradas=[PASSWORD_MARCADOR_B, PASSWORD_MARCADOR_B],
    )

    assert resultado.estado != 0, resultado.relatorio()
    _sem_marcadores(resultado.tudo, PASSWORD_MARCADOR, PASSWORD_MARCADOR_B)


def test_mudar_password_nao_mostra_a_password_nem_o_hash(bd_em_head: Path) -> None:
    """A password nova, a antiga, e o hash — nenhuma das três na saída."""
    criar_admin_com_sucesso(
        destino_bd=bd_em_head, utilizador=UTILIZADOR, password=PASSWORD_MARCADOR
    )

    resultado = correr_criar_admin(
        destino_bd=bd_em_head,
        utilizador=UTILIZADOR,
        argumentos_extra=["--mudar-password"],
        entradas=[PASSWORD_MARCADOR_MUDADA, PASSWORD_MARCADOR_MUDADA],
    )

    assert resultado.estado == 0, resultado.relatorio()
    _sem_marcadores(resultado.tudo, PASSWORD_MARCADOR, PASSWORD_MARCADOR_MUDADA)


def test_a_password_escrita_num_pipe_tambem_nao_e_ecoada(bd_em_head: Path) -> None:
    """A recusa do guarda do terminal não pode citar o que veio no `pipe`."""
    resultado = correr_criar_admin_com_pipe(
        destino_bd=bd_em_head,
        utilizador=UTILIZADOR,
        entrada=PASSWORD_MARCADOR + "\n",
    )

    assert resultado.estado != 0, resultado.relatorio()
    _sem_marcadores(resultado.tudo, PASSWORD_MARCADOR)


# --- BD trancada: o hash não sai na mensagem do `OperationalError` ---------
#
# Medido na revisão da F2-02: com um `BEGIN EXCLUSIVE` aberto noutra
# ligação, o `INSERT`/`UPDATE` espera o `busy_timeout` (5000 ms) e rebenta com
# `OperationalError: database is locked ... [parameters: ('$argon2id$...',
# ...)]`, em `stdout` e outra vez no `traceback`. O `hide_parameters=True`
# do motor (`app/db.py::criar_engine`) é o que o fecha. Cada caso demora ~5 s.


@contextlib.contextmanager
def _bd_trancada(caminho: Path) -> Iterator[None]:
    ligacao = sqlite3.connect(str(caminho), isolation_level=None)
    try:
        ligacao.execute("BEGIN EXCLUSIVE")
        yield
    finally:
        ligacao.close()


def test_bd_trancada_ao_criar_nao_mostra_a_password_nem_o_hash(
    bd_em_head: Path,
) -> None:
    with _bd_trancada(bd_em_head):
        resultado = correr_criar_admin(
            destino_bd=bd_em_head,
            utilizador=UTILIZADOR,
            entradas=[PASSWORD_MARCADOR, PASSWORD_MARCADOR],
            timeout=40,
        )

    assert resultado.estado != 0, resultado.relatorio()
    assert "locked" in resultado.tudo, (
        "o cenário não produziu a BD trancada que o teste pretende "
        f"exercitar: {resultado.relatorio()}"
    )
    _sem_marcadores(resultado.tudo, PASSWORD_MARCADOR)


def test_bd_trancada_ao_mudar_a_password_nao_mostra_a_password_nem_o_hash(
    bd_em_head: Path,
) -> None:
    criar_admin_com_sucesso(
        destino_bd=bd_em_head, utilizador=UTILIZADOR, password=PASSWORD_MARCADOR
    )

    with _bd_trancada(bd_em_head):
        resultado = correr_criar_admin(
            destino_bd=bd_em_head,
            utilizador=UTILIZADOR,
            argumentos_extra=["--mudar-password"],
            entradas=[PASSWORD_MARCADOR_MUDADA, PASSWORD_MARCADOR_MUDADA],
            timeout=40,
        )

    assert resultado.estado != 0, resultado.relatorio()
    assert "locked" in resultado.tudo, resultado.relatorio()
    _sem_marcadores(resultado.tudo, PASSWORD_MARCADOR, PASSWORD_MARCADOR_MUDADA)
