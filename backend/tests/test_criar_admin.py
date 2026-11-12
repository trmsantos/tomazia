"""`scripts/criar_admin.py` (F2-02): criar, `--desbloquear`, `--mudar-password`.

Molde de `tests/test_importar_bd_antiga.py`: cada teste chama
`tests.apoio_scripts_de_admin.exigir_criar_admin()` (direta ou
indiretamente, através dos lançadores) antes de correr nada, por isso toda
a bateria falha com `MENSAGEM_CRIAR_ADMIN_EM_FALTA` enquanto o script não
existir — nunca com um `FileNotFoundError` cru nem um `ImportError` a meio
da recolha.

As decisões do Tomás que esta bateria fixa (`docs/TAREFAS.md`, F2-02):

- a password só é recusada **vazia**; o resto é um aviso, não uma recusa
  (não testado aqui: um aviso sem recusa é indistinguível de "nada
  aconteceu" vista de fora, exceto no texto impresso, e esse texto não é
  um comportamento com consequência que valha a pena fixar num teste);
- `--mudar-password` incrementa `sessao_versao`; `--desbloquear` não toca
  lá, porque a F2-04 decidiu que uma sessão aberta sobrevive ao bloqueio;
- recriar um utilizador existente é recusado, sem tocar na conta.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.erros import ErroDaApi
from tests.apoio_legado import mensagem_sem_dados
from tests.apoio_scripts_de_admin import (
    PASSWORD_DE_EXEMPLO,
    PASSWORD_DE_EXEMPLO_B,
    PASSWORD_DE_PIPE_DE_EXEMPLO,
    PASSWORD_MUDADA_DE_EXEMPLO,
    RAIZ_BACKEND,
    UTILIZADOR_DE_EXEMPLO,
    AutenticacaoNoDestino,
    ambiente_criar_admin,
    autenticar_no_destino,
    carregar_script,
    contar_admins,
    correr_com_stdin_devnull,
    correr_criar_admin,
    correr_criar_admin_com_devnull,
    correr_criar_admin_com_pipe,
    criar_admin_com_sucesso,
    definir_bloqueio,
    exigir_criar_admin,
    ler_admin,
)

if TYPE_CHECKING:
    from tests.apoio_scripts_de_admin import ResultadoDoScript


# --- A criação, no caminho feliz --------------------------------------------


def test_criar_a_conta_e_a_password_criada_autentica(bd_em_head: Path) -> None:
    """A asserção que mais interessa: o invólucro não divergiu do login.

    Não basta o script dizer que criou a conta — a prova é chamar
    `app.services.auth.autenticar`, a mesma função que `POST /auth/login`
    usa, contra a base de dados que o script escreveu.
    """
    resultado = criar_admin_com_sucesso(destino_bd=bd_em_head)

    autenticado = autenticar_no_destino(
        bd_em_head, UTILIZADOR_DE_EXEMPLO, PASSWORD_DE_EXEMPLO
    )
    assert autenticado.utilizador == UTILIZADOR_DE_EXEMPLO, resultado.relatorio()


def test_conta_nova_comeca_com_sessao_versao_zero(bd_em_head: Path) -> None:
    """Uma conta acabada de criar nunca começa já com sessões para revogar."""
    criar_admin_com_sucesso(destino_bd=bd_em_head)

    linha = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert linha is not None
    assert linha["sessao_versao"] == 0


# --- As três recusas do guarda do terminal ----------------------------------
#
# Medido na F2-02 (`docs/TAREFAS.md`): `getpass.getpass()` não recusa sem
# terminal — só `stdin` em `/dev/null` levanta `EOFError` sozinho; um
# `pipe`, mesmo vazio, "tem sucesso" com uma password que ninguém quis.
# O guarda tem de ser `sys.stdin.isatty()` **antes** de qualquer pedido, e
# são três recusas com três frases diferentes (regra 10 do `CLAUDE.md`).


def test_stdin_em_pipe_recusa_com_a_frase_do_terminal(bd_em_head: Path) -> None:
    """Um `echo password | criar_admin.py` não pode criar conta nenhuma.

    É o caso ingénuo que a F2-02 mediu: sem este guarda, um `pipe` com
    texto "tem sucesso" e cria uma conta com a password que lá estava.
    """
    resultado = correr_criar_admin_com_pipe(destino_bd=bd_em_head)

    assert resultado.estado != 0, resultado.relatorio()
    assert "terminal" in resultado.tudo.lower(), (
        f"a recusa não menciona 'terminal': {resultado.relatorio()}"
    )
    assert PASSWORD_DE_PIPE_DE_EXEMPLO not in resultado.tudo, (
        f"a password escrita no pipe apareceu na saída: {resultado.relatorio()}"
    )
    assert contar_admins(bd_em_head) == 0, resultado.relatorio()


def test_stdin_em_devnull_recusa_com_outra_frase(bd_em_head: Path) -> None:
    """`/dev/null` também não é um terminal — mas não é um `pipe`.

    A frase tem de ser **diferente** da do `pipe` (ver o teste anterior):
    um `pipe` e `/dev/null` são as duas formas medidas de "sem terminal", e
    confundir os dois casos na mesma frase é a troca que a regra 10 do
    `CLAUDE.md` proíbe — a pessoa a investigar um `--desbloquear` que
    falhou não pode ler a mesma frase que alguém que tentou um `pipe`.
    """
    resultado = correr_criar_admin_com_devnull(destino_bd=bd_em_head)

    assert resultado.estado != 0, resultado.relatorio()
    assert contar_admins(bd_em_head) == 0, resultado.relatorio()

    mensagem_pipe = correr_criar_admin_com_pipe(destino_bd=bd_em_head).tudo
    assert resultado.tudo != mensagem_pipe, (
        "a recusa de `/dev/null` é igual, palavra por palavra, à do `pipe` "
        f"— as duas têm de dizer coisas diferentes\n{resultado.relatorio()}"
    )


def test_password_vazia_num_terminal_recusa_com_outra_frase_ainda(
    bd_em_head: Path,
) -> None:
    """Num terminal a sério, só a password **vazia** é recusa (não o aviso < 12).

    A terceira frase: nem "não estás num terminal" nem "o terminal
    fechou-se a meio" — aqui há mesmo um terminal, e ele entregou os dados
    pedidos; só que um deles é vazio.
    """
    resultado = correr_criar_admin(destino_bd=bd_em_head, entradas=["", ""])

    assert resultado.estado != 0, resultado.relatorio()
    assert "em branco" in resultado.tudo.lower(), (
        f"a recusa não menciona password em branco: {resultado.relatorio()}"
    )
    assert contar_admins(bd_em_head) == 0, resultado.relatorio()


def test_as_tres_recusas_do_terminal_tem_frases_todas_diferentes(
    bd_em_head: Path,
) -> None:
    """Junta as três, de propósito: é a afirmação que o `docs/TAREFAS.md` pede.

    "não estás num terminal" ≠ "o terminal fechou-se a meio" ≠ "escreveste
    uma password vazia". As três têm de se distinguir mesmo depois de se
    tirarem os dados do caso (`mensagem_sem_dados`, de
    `tests/apoio_legado.py`) — senão duas recusas que só diferem num
    número ou num caminho passavam por "frases diferentes" sem o serem.
    """
    pipe = correr_criar_admin_com_pipe(destino_bd=bd_em_head)
    devnull = correr_criar_admin_com_devnull(destino_bd=bd_em_head)
    vazia = correr_criar_admin(destino_bd=bd_em_head, entradas=["", ""])

    frases = {
        "pipe": mensagem_sem_dados(pipe.tudo, ()),
        "devnull": mensagem_sem_dados(devnull.tudo, ()),
        "vazia": mensagem_sem_dados(vazia.tudo, ()),
    }
    assert len(set(frases.values())) == 3, (
        f"duas das três recusas do terminal são iguais: {frases}"
    )


# --- As duas digitações ------------------------------------------------------


def test_as_duas_digitacoes_diferentes_recusam(bd_em_head: Path) -> None:
    """Escrever a password duas vezes só serve se as duas baterem certo."""
    resultado = correr_criar_admin(
        destino_bd=bd_em_head,
        entradas=[PASSWORD_DE_EXEMPLO, PASSWORD_DE_EXEMPLO_B],
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert contar_admins(bd_em_head) == 0, resultado.relatorio()


# --- Recriar um utilizador existente -----------------------------------------


def test_utilizador_que_ja_existe_recusa_sem_tocar_na_conta(bd_em_head: Path) -> None:
    """Recriar é recusado — nunca substitui uma conta em silêncio.

    `docs/TAREFAS.md`, F2-02: é a razão de existir do `--mudar-password`
    (a saída para uma password esquecida não é "recriar por cima").
    """
    criar_admin_com_sucesso(destino_bd=bd_em_head)
    antes = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert antes is not None

    resultado = correr_criar_admin(
        destino_bd=bd_em_head,
        entradas=[PASSWORD_DE_EXEMPLO_B, PASSWORD_DE_EXEMPLO_B],
    )
    assert resultado.estado != 0, resultado.relatorio()

    depois = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert depois is not None
    assert depois["hash_password"] == antes["hash_password"], (
        f"o hash mudou ao tentar recriar: {resultado.relatorio()}"
    )
    assert depois["sessao_versao"] == antes["sessao_versao"], (
        f"o sessao_versao mudou ao tentar recriar: {resultado.relatorio()}"
    )
    assert contar_admins(bd_em_head) == 1, resultado.relatorio()


# --- `--desbloquear` ---------------------------------------------------------


def _bloquear(bd_em_head: Path) -> None:
    from datetime import UTC, datetime

    definir_bloqueio(
        bd_em_head,
        UTILIZADOR_DE_EXEMPLO,
        tentativas_falhadas=5,
        bloqueado_ate=datetime(2030, 1, 1, tzinfo=UTC),
    )


def test_desbloquear_uma_conta_bloqueada(bd_em_head: Path) -> None:
    """Sucesso, as duas colunas limpas, e o `sessao_versao` **inalterado**.

    Herança da F2-04 (`docs/TAREFAS.md`): uma sessão aberta sobrevive ao
    bloqueio, e destrancar não pode ser o que a mata — por isso
    `--desbloquear` não toca no `sessao_versao`.
    """
    criar_admin_com_sucesso(destino_bd=bd_em_head)
    antes = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert antes is not None
    _bloquear(bd_em_head)

    resultado = correr_criar_admin_com_devnull(
        destino_bd=bd_em_head, argumentos_extra=["--desbloquear"]
    )

    assert resultado.estado == 0, resultado.relatorio()
    depois = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert depois is not None
    assert depois["tentativas_falhadas"] == 0, resultado.relatorio()
    assert depois["bloqueado_ate"] is None, resultado.relatorio()
    assert depois["sessao_versao"] == antes["sessao_versao"], (
        f"--desbloquear mudou o sessao_versao: {resultado.relatorio()}"
    )


def test_desbloquear_nao_pede_password_funciona_com_stdin_em_devnull(
    bd_em_head: Path,
) -> None:
    """A propriedade que distingue `--desbloquear` dos outros dois modos.

    Não pede password nenhuma — por isso corre com `stdin` em `/dev/null`
    sem recusar, ao contrário do modo de criação (ver os testes das três
    recusas do terminal, acima).
    """
    criar_admin_com_sucesso(destino_bd=bd_em_head)
    _bloquear(bd_em_head)

    resultado = correr_criar_admin_com_devnull(
        destino_bd=bd_em_head, argumentos_extra=["--desbloquear"]
    )

    assert resultado.estado == 0, resultado.relatorio()


def test_desbloquear_sem_conta_recusa_com_frase_propria(bd_em_head: Path) -> None:
    """Não há conta nenhuma para destrancar — recusa, com a sua frase."""
    resultado = correr_criar_admin_com_devnull(
        destino_bd=bd_em_head, argumentos_extra=["--desbloquear"]
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert contar_admins(bd_em_head) == 0, resultado.relatorio()


def test_desbloquear_conta_que_nao_estava_bloqueada(bd_em_head: Path) -> None:
    """Sucesso — mas com uma frase diferente de "desbloqueei".

    Não havia nada para desbloquear; dizer "desbloqueei" seria afirmar algo
    que não aconteceu (regra 10: "não havia nada a fazer" não é a mesma
    frase que "fiz o que me pediram").
    """
    criar_admin_com_sucesso(destino_bd=bd_em_head)

    resultado = correr_criar_admin_com_devnull(
        destino_bd=bd_em_head, argumentos_extra=["--desbloquear"]
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert "desbloqueei" not in resultado.tudo.lower(), (
        "uma conta que não estava bloqueada não pode ser anunciada com a "
        f"mesma frase de uma que estava: {resultado.relatorio()}"
    )


# --- `--mudar-password` ------------------------------------------------------


def test_mudar_password_a_nova_autentica_a_antiga_nao_e_sessao_versao_incrementa(
    bd_em_head: Path,
) -> None:
    """A decisão do Tomás de 9 de novembro de 2026, por inteiro.

    Mudar a password mata as sessões antigas — é o que qualquer pessoa
    espera, e o que a F2-04 deixou pronto no `sessao_versao`.
    """
    criar_admin_com_sucesso(destino_bd=bd_em_head)
    antes = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert antes is not None

    resultado = correr_criar_admin(
        destino_bd=bd_em_head,
        argumentos_extra=["--mudar-password"],
        entradas=[PASSWORD_MUDADA_DE_EXEMPLO, PASSWORD_MUDADA_DE_EXEMPLO],
    )
    assert resultado.estado == 0, resultado.relatorio()

    autenticado: AutenticacaoNoDestino = autenticar_no_destino(
        bd_em_head, UTILIZADOR_DE_EXEMPLO, PASSWORD_MUDADA_DE_EXEMPLO
    )
    assert autenticado.utilizador == UTILIZADOR_DE_EXEMPLO

    with pytest.raises((ErroDaApi, SQLAlchemyError)):
        autenticar_no_destino(bd_em_head, UTILIZADOR_DE_EXEMPLO, PASSWORD_DE_EXEMPLO)

    depois = ler_admin(bd_em_head, UTILIZADOR_DE_EXEMPLO)
    assert depois is not None
    assert depois["sessao_versao"] == antes["sessao_versao"] + 1, resultado.relatorio()


# --- A base de dados ainda não foi migrada -----------------------------------


def test_bd_por_migrar_recusa_nomeada_com_o_comando_que_resolve(
    tmp_path: Path,
) -> None:
    """Sem `alembic upgrade head`, a recusa é nomeada — nunca um crash com SQL.

    `backend/CLAUDE.md`: sem a migração não há tabelas nenhumas, e é o
    caso normal de quem serve pela primeira vez — não um imprevisto.
    Achado em revisão: a primeira versão deixava subir um
    `sqlite3.OperationalError: no such table: admins`, com o `SELECT`
    inteiro por cima, e o relatório concluía «Rebentei a meio» — a frase
    do imprevisto, para uma condição que o `CLAUDE.md` descreve em
    detalhe. `scripts/backup.py` já trata o equivalente (a origem não
    existe) como uma recusa nomeada; este teste fixa que
    `criar_admin.py` faz o mesmo, com `--desbloquear` para não depender
    de um terminal nem de uma password.
    """
    script = exigir_criar_admin()
    destino = tmp_path / "bd" / "tomazia-sem-migrar.db"
    destino.parent.mkdir(parents=True, exist_ok=True)
    ambiente = ambiente_criar_admin(destino, isolamento=tmp_path)

    resultado = correr_com_stdin_devnull(
        script,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
        cwd=script.parent.parent,
        ambiente=ambiente,
    )

    assert resultado.estado == 1, resultado.relatorio()
    assert "alembic upgrade head" in resultado.tudo, (
        f"a recusa não menciona o comando que resolve: {resultado.relatorio()}"
    )
    assert "Rebentei a meio" not in resultado.tudo, (
        "uma base de dados por migrar é uma condição prevista, não um "
        f"imprevisto: {resultado.relatorio()}"
    )
    assert not destino.exists(), (
        "o script não deve criar a base de dados sozinho — isso é o "
        f"`alembic upgrade head`: {resultado.relatorio()}"
    )


# --- Sem `AMBIENTE` ----------------------------------------------------------


def test_sem_ambiente_recusa_e_nada_escreve(bd_em_head: Path, tmp_path: Path) -> None:
    """`backend/CLAUDE.md`: `AMBIENTE` é obrigatório, sem omissão — scripts incluídos.

    Faltando, o script tem de recusar antes de escrever seja o que for —
    nunca cair em "desenvolvimento" por omissão.
    """
    script = exigir_criar_admin()
    ambiente = ambiente_criar_admin(
        bd_em_head, isolamento=tmp_path, remover=["AMBIENTE"]
    )

    resultado: ResultadoDoScript = correr_com_stdin_devnull(
        script,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO],
        cwd=script.parent.parent,
        ambiente=ambiente,
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert contar_admins(bd_em_head) == 0, resultado.relatorio()


# --- O que as revisões da F2-02 acrescentaram -------------------------------


def _correr_devnull(
    bd: Path, argumentos: list[str], *, isolamento: Path | None = None, **extra: str
) -> ResultadoDoScript:
    script = exigir_criar_admin()
    ambiente = ambiente_criar_admin(bd, isolamento=isolamento, ambiente_extra=extra)
    return correr_com_stdin_devnull(
        script, argumentos, cwd=RAIZ_BACKEND, ambiente=ambiente
    )


def test_destino_numa_pasta_ilegivel_nao_e_dado_como_inexistente(
    bd_em_head: Path, tmp_path: Path
) -> None:
    """Regra 10: "não consegui ver" não é "não existe" (`Path.is_file()` 3.13+)."""
    if os.geteuid() == 0:
        pytest.skip("root ignora as permissões: skip visível (regra 10)")

    pasta_mae = bd_em_head.parent
    pasta_mae.chmod(0o000)
    try:
        ilegivel = _correr_devnull(
            bd_em_head,
            ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
            isolamento=tmp_path,
        )
    finally:
        pasta_mae.chmod(0o755)
    ausente = _correr_devnull(
        tmp_path / "bd" / "nao-existe.db",
        ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
        isolamento=tmp_path,
    )

    assert ilegivel.estado == 1, ilegivel.relatorio()
    assert "Não consegui verificar" in ilegivel.stdout, ilegivel.relatorio()
    assert "não existe" not in ilegivel.stdout, ilegivel.relatorio()
    assert "Rebentei" not in ilegivel.tudo and "Traceback" not in ilegivel.tudo
    assert "não existe" in ausente.stdout, ausente.relatorio()


def test_destino_que_nao_e_sqlite_recusa_com_frase_propria(tmp_path: Path) -> None:
    destino = tmp_path / "bd" / "nao-e-sqlite.db"
    destino.parent.mkdir(parents=True)
    destino.write_bytes(b"isto nao e uma base de dados SQLite\n" * 10)

    resultado = _correr_devnull(
        destino,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
        isolamento=tmp_path,
    )

    assert resultado.estado == 1, resultado.relatorio()
    assert "não é uma base de dados SQLite" in resultado.stdout, resultado.relatorio()
    assert "Rebentei" not in resultado.tudo, resultado.relatorio()
    assert "Erro inesperado" not in resultado.tudo, resultado.relatorio()
    assert "Traceback" not in resultado.tudo, resultado.relatorio()


def test_destino_com_0_bytes_recusa_sem_traceback(tmp_path: Path) -> None:
    destino = tmp_path / "bd" / "vazia.db"
    destino.parent.mkdir(parents=True)
    destino.touch()

    resultado = _correr_devnull(
        destino,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
        isolamento=tmp_path,
    )

    assert resultado.estado == 1, resultado.relatorio()
    assert "Traceback" not in resultado.tudo, resultado.relatorio()


def test_url_que_nao_e_sqlite_manda_confirmar_a_configuracao(
    bd_em_head: Path,
) -> None:
    resultado = _correr_devnull(
        bd_em_head,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
        BASE_DADOS_URL="postgresql://alguem:segredo-xyz@servidor/bd",
    )

    assert resultado.estado == 1, resultado.relatorio()
    assert resultado.stdout.startswith("A BASE_DADOS_URL não aponta"), (
        resultado.relatorio()
    )
    assert "Confirma a configuração (e o AMBIENTE)." in resultado.stdout
    assert "segredo-xyz" not in resultado.tudo, resultado.relatorio()


def test_recusas_sem_terminal_dizem_o_que_fazer_e_sem_jargao(
    bd_em_head: Path,
) -> None:
    pipe = correr_criar_admin_com_pipe(destino_bd=bd_em_head)
    devnull = correr_criar_admin_com_devnull(destino_bd=bd_em_head)

    for resultado in (pipe, devnull):
        assert resultado.estado != 0, resultado.relatorio()
        assert (
            "Corre o script diretamente numa sessão SSH e escreve a password "
            "quando for pedida" in resultado.stdout
        ), resultado.relatorio()
        for jargao in ("pipe", "getpass", "cron", "stderr", "Rebentei"):
            assert jargao not in resultado.tudo, (jargao, resultado.relatorio())


def test_password_vazia_e_diferentes_mandam_correr_o_script_outra_vez(
    bd_em_head: Path,
) -> None:
    vazia = correr_criar_admin(destino_bd=bd_em_head, entradas=["", ""])
    diferentes = correr_criar_admin(
        destino_bd=bd_em_head, entradas=[PASSWORD_DE_EXEMPLO, PASSWORD_DE_EXEMPLO_B]
    )

    for resultado in (vazia, diferentes):
        assert "Corre o script outra vez" in resultado.stdout, resultado.relatorio()


def test_conta_inexistente_diz_o_passo_seguinte(bd_em_head: Path) -> None:
    desbloquear = _correr_devnull(
        bd_em_head, ["--utilizador", "ninguem", "--desbloquear"]
    )
    mudar = correr_criar_admin(
        destino_bd=bd_em_head,
        utilizador="ninguem",
        argumentos_extra=["--mudar-password"],
        entradas=[],
    )

    for resultado in (desbloquear, mudar):
        assert resultado.estado == 1, resultado.relatorio()
        assert (
            "confirma o nome em --utilizador e a BASE_DADOS_URL/AMBIENTE"
            in resultado.stdout
        ), resultado.relatorio()


def test_conta_nao_bloqueada_diz_que_nao_mudou_nada_e_aponta_para_mudar_password(
    bd_em_head: Path,
) -> None:
    criar_admin_com_sucesso(destino_bd=bd_em_head)

    resultado = correr_criar_admin_com_devnull(
        destino_bd=bd_em_head, argumentos_extra=["--desbloquear"]
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert "não estava bloqueada; não mudei nada" in resultado.stdout
    assert (
        f"--mudar-password --utilizador {UTILIZADOR_DE_EXEMPLO}" in resultado.stdout
    ), resultado.relatorio()


def test_ajuda_em_portugues_com_um_exemplo_por_modo(tmp_path: Path) -> None:
    resultado = _correr_devnull(tmp_path / "x.db", ["--help"], isolamento=tmp_path)
    junto = " ".join(resultado.stdout.split())

    assert resultado.estado == 0, resultado.relatorio()
    assert "uso:" in resultado.stdout and "usage:" not in resultado.stdout
    assert (
        "desbloqueia a conta (limpa as tentativas falhadas e o bloqueio). Não "
        "pede password e não termina as sessões abertas." in junto
    ), resultado.relatorio()
    for coluna in ("tentativas_falhadas", "bloqueado_ate", "sessao_versao"):
        assert coluna not in resultado.stdout, resultado.relatorio()
    exemplos = [
        linha
        for linha in resultado.stdout.splitlines()
        if "scripts/criar_admin.py" in linha
    ]
    assert len(exemplos) >= 3, resultado.relatorio()
    assert any("--desbloquear" in e for e in exemplos)
    assert any("--mudar-password" in e for e in exemplos)
    assert any(
        "--desbloquear" not in e and "--mudar-password" not in e for e in exemplos
    )


def test_erros_do_argparse_em_portugues(tmp_path: Path) -> None:
    em_falta = _correr_devnull(tmp_path / "x.db", [], isolamento=tmp_path)
    juntos = _correr_devnull(
        tmp_path / "x.db",
        ["--utilizador", "a", "--desbloquear", "--mudar-password"],
        isolamento=tmp_path,
    )

    assert em_falta.estado == 2, em_falta.relatorio()
    assert "Erro: falta o argumento obrigatório --utilizador." in em_falta.stderr
    assert "required" not in em_falta.stderr, em_falta.relatorio()
    assert juntos.estado == 2, juntos.relatorio()
    assert (
        "Erro: --desbloquear e --mudar-password não podem ser usados em conjunto."
        in juntos.stderr
    ), juntos.relatorio()
    assert "not allowed" not in juntos.stderr, juntos.relatorio()


def test_erro_inesperado_diz_que_e_defeito_e_que_nada_ficou_gravado_a_meio() -> None:
    modulo: Any = carregar_script(exigir_criar_admin())

    frase = modulo.conclusao_do_rebentamento(ValueError("x"))

    assert frase.startswith(
        "Erro inesperado (ValueError): é um defeito do script, não uma recusa. "
        "O detalhe está acima e o traceback a seguir."
    ), frase
    assert "nada fica gravado a meio" in frase, frase
    for jargao in ("Rebentei", "commit", "stderr"):
        assert jargao not in frase, frase


def _sessao_com_conta(bd: Path) -> Session:
    from app.db import criar_engine
    from app.services.auth import registar_admin

    sessao = Session(criar_engine(f"sqlite:///{bd}"))
    registar_admin(sessao, UTILIZADOR_DE_EXEMPLO, PASSWORD_DE_EXEMPLO)
    return sessao


def test_mudar_password_que_devolve_none_e_uma_recusa(
    bd_em_head: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """A conta desapareceu entre a verificação e a escrita: nunca "Mudei"."""
    modulo: Any = carregar_script(exigir_criar_admin())
    monkeypatch.setattr(modulo, "pedir_password_nova", lambda: "x" * 20)
    monkeypatch.setattr(modulo, "mudar_password", lambda *_a: None)
    sessao = _sessao_com_conta(bd_em_head)
    try:
        estado = modulo._mudar_a_password(sessao, UTILIZADOR_DE_EXEMPLO)
    finally:
        sessao.close()

    saida = capsys.readouterr().out
    assert estado == 1, saida
    assert "Mudei" not in saida, saida
    assert "confirma o nome em --utilizador" in saida, saida


def test_corrida_no_insert_aponta_para_mudar_password_e_nao_para_tentar_outra_vez(
    bd_em_head: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    modulo: Any = carregar_script(exigir_criar_admin())
    monkeypatch.setattr(modulo, "pedir_password_nova", lambda: "x" * 20)

    def _corrida(*_a: object) -> None:
        raise IntegrityError("INSERT", None, Exception("UNIQUE"))

    monkeypatch.setattr(modulo, "registar_admin", _corrida)
    from app.db import criar_engine

    sessao = Session(criar_engine(f"sqlite:///{bd_em_head}"))
    try:
        estado = modulo._criar(sessao, "novo-utilizador")
    finally:
        sessao.close()

    saida = capsys.readouterr().out
    assert estado == 1, saida
    assert "tenta outra vez" not in saida.lower(), saida
    assert "--mudar-password --utilizador novo-utilizador" in saida, saida


# --- Terceira volta -----------------------------------------------------------


def test_destino_inexistente_diz_o_que_confirmar_e_como_criar(tmp_path: Path) -> None:
    destino = tmp_path / "bd" / "nao-existe.db"

    resultado = _correr_devnull(
        destino,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO, "--desbloquear"],
        isolamento=tmp_path,
    )

    assert (
        f"A base de dados {destino.resolve()} não existe. Confirma a "
        "BASE_DADOS_URL e o AMBIENTE; se for a primeira vez, cria-se com "
        "«alembic upgrade head»."
    ) in resultado.stdout, resultado.relatorio()


def test_password_em_branco_nao_e_aceite_sem_a_sério(bd_em_head: Path) -> None:
    resultado = correr_criar_admin(destino_bd=bd_em_head, entradas=["", ""])

    assert (
        "A password está em branco e não é aceite. Corre o script outra vez "
        "e escreve uma password."
    ) in resultado.stdout, resultado.relatorio()
    assert "a sério" not in resultado.stdout


def test_a_frase_da_conta_nao_bloqueada_acaba_com_ponto_final(
    bd_em_head: Path,
) -> None:
    criar_admin_com_sucesso(destino_bd=bd_em_head)

    resultado = correr_criar_admin_com_devnull(
        destino_bd=bd_em_head, argumentos_extra=["--desbloquear"]
    )

    assert resultado.stdout.rstrip().endswith(
        f"--mudar-password --utilizador {UTILIZADOR_DE_EXEMPLO}."
    ), resultado.relatorio()


def test_destino_com_cardinal_no_nome_abre_se_so_em_leitura(
    bd_em_head: Path, tmp_path: Path
) -> None:
    """`#` num f-string `file:` corta o caminho; `as_uri()` escapa-o."""
    import shutil

    destino = tmp_path / "bd" / "tomazia#1.db"
    shutil.copyfile(bd_em_head, destino)
    criar_admin_com_sucesso(destino_bd=destino)

    resultado = correr_criar_admin_com_devnull(
        destino_bd=destino, argumentos_extra=["--desbloquear"]
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert "não estava bloqueada" in resultado.stdout, resultado.relatorio()


def test_erro_de_configuracao_diz_o_campo_sem_o_valor_e_sem_ponto_duplicado(
    bd_em_head: Path,
) -> None:
    resultado = _correr_devnull(
        bd_em_head,
        ["--utilizador", UTILIZADOR_DE_EXEMPLO],
        AMBIENTE="valor-marcador-9",
    )

    assert resultado.estado == 1, resultado.relatorio()
    assert "AMBIENTE: Input should be" in resultado.stdout, resultado.relatorio()
    assert "valor-marcador-9" not in resultado.tudo, resultado.relatorio()
    assert ".." not in resultado.stdout, resultado.relatorio()
    assert "Value error," not in resultado.stdout, resultado.relatorio()


def test_argumento_sem_valor_em_portugues(tmp_path: Path) -> None:
    resultado = _correr_devnull(
        tmp_path / "x.db", ["--utilizador"], isolamento=tmp_path
    )

    assert resultado.estado == 2, resultado.relatorio()
    assert "Erro: o argumento --utilizador precisa de um valor." in resultado.stderr
    assert "expected" not in resultado.stderr, resultado.relatorio()
