"""`deploy/deploy.sh` tem um trinco contra deploys em paralelo (F1-05).

## O achado

No primeiro deploy real, o Tomás carregou duas vezes em "Deploy HEAD
Commit" e correram dois `deploy.sh` ao mesmo tempo, os dois a apagar e a
copiar nas mesmas pastas e os dois a caminho do `alembic`. O cPanel não os
serializa. O `deploy.sh` passou a tomar um trinco (`mkdir` atómico de
`$HOME/.tomazia-deploy.trinco`, com o PID lá dentro) antes de tudo.

## O que se prova

- Dois deploys realmente em paralelo: o segundo sai com "outro deploy está
  a correr" e não toca em nada; o primeiro acaba bem.
- Um trinco abandonado por um processo morto (incluindo um `kill -9` real
  a meio de um deploy) é recuperado, e a saída di-lo.
- Regra 10: "o trinco está tomado", "não consegui criar o trinco", "o
  trinco não tem PID", "o PID é lixo" e "não consegui saber se o dono está
  vivo" são cinco mensagens diferentes, e só a primeira diz que outro
  deploy está a correr.
- O trinco é libertado no fim, com sucesso, com falha, com recusa de um
  guarda e com SIGTERM.

`HOME` falso em `tmp_path`, `pip` e `alembic` como stubs; nunca o cPanel
nem a BD antiga (regras 1 e 3 do `CLAUDE.md`). Vive em `tests/seguranca/`
pela regra 5.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path

import pytest

from tests.seguranca.test_deploy_sh import (
    CAMINHO_SCRIPT,
    Instalacao,
    _correr_deploy,
    _escrever_stub,
    _preparar_instalacao_valida,
)

OCUPADO = "outro deploy está a correr"

_PIP_QUE_ESPERA = """\
#!/usr/bin/env bash
printf 'EVENTO=pip ARGS=%s\\n' "$*" >> "${TOMAZIA_TESTE_LOG_PIP}"
: > "${TOMAZIA_TESTE_PIP_COMECOU}"
i=0
while [ ! -e "${TOMAZIA_TESTE_PIP_PODE_ACABAR}" ]; do
  i=$((i + 1))
  if [ "$i" -gt 600 ]; then exit 1; fi
  sleep 0.05
done
exit 0
"""


def _trinco(instalacao: Instalacao) -> Path:
    return instalacao.home / ".tomazia-deploy.trinco"


def _mensagem(resultado: subprocess.CompletedProcess[str]) -> str:
    return resultado.stdout + resultado.stderr


def _ler(caminho: Path) -> str:
    return caminho.read_text(encoding="utf-8") if caminho.is_file() else ""


def _instantaneo(pasta: Path) -> dict[str, bytes]:
    return {
        caminho.relative_to(pasta).as_posix(): caminho.read_bytes()
        for caminho in sorted(pasta.rglob("*"))
        if caminho.is_file()
    }


def _pid_morto() -> int:
    processo = subprocess.Popen(["true"])
    processo.wait()
    return processo.pid


def _assert_nada_tocado(
    instalacao: Instalacao, web_antes: dict[str, bytes], pip_antes: str = ""
) -> None:
    assert _instantaneo(instalacao.web) == web_antes, "O WEB mudou."
    assert _ler(instalacao.log_pip) == pip_antes, "O pip correu."
    assert _ler(instalacao.log_alembic) == "", "O alembic correu."
    assert not (instalacao.api / "tmp" / "restart.txt").exists()


def _com_pip_que_espera(instalacao: Instalacao, tmp_path: Path) -> tuple[Path, Path]:
    comecou = tmp_path / "pip-comecou"
    pode_acabar = tmp_path / "pip-pode-acabar"
    _escrever_stub(instalacao.venv_bin / "pip", _PIP_QUE_ESPERA)
    instalacao.ambiente["TOMAZIA_TESTE_PIP_COMECOU"] = str(comecou)
    instalacao.ambiente["TOMAZIA_TESTE_PIP_PODE_ACABAR"] = str(pode_acabar)
    return comecou, pode_acabar


def _arrancar_em_fundo(instalacao: Instalacao) -> subprocess.Popen[str]:
    return subprocess.Popen(
        ["bash", str(CAMINHO_SCRIPT)],
        env=dict(instalacao.ambiente),
        cwd=str(instalacao.home),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _esperar_por(caminho: Path, processo: subprocess.Popen[str]) -> None:
    limite = time.monotonic() + 20
    while not caminho.exists():
        if processo.poll() is not None:
            saida, erro = processo.communicate()
            pytest.fail(f"o deploy terminou antes do pip:\n{saida}\n{erro}")
        if time.monotonic() > limite:
            processo.kill()
            pytest.fail("o pip do primeiro deploy nunca arrancou")
        time.sleep(0.05)


# --- Dois deploys ao mesmo tempo -----------------------------------------------


def test_dois_deploys_em_paralelo_so_um_corre(tmp_path: Path) -> None:
    """O caso exato: o segundo clique em "Deploy" não pode pôr um segundo deploy a mexer nas mesmas pastas."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    comecou, pode_acabar = _com_pip_que_espera(instalacao, tmp_path)

    primeiro = _arrancar_em_fundo(instalacao)
    try:
        _esperar_por(comecou, primeiro)
        web_antes = _instantaneo(instalacao.web)
        pip_antes = _ler(instalacao.log_pip)

        segundo = _correr_deploy(instalacao)

        assert segundo.returncode != 0, _mensagem(segundo)
        assert OCUPADO in _mensagem(segundo), _mensagem(segundo)
        _assert_nada_tocado(instalacao, web_antes, pip_antes)
        assert pip_antes.count("EVENTO=pip") == 1
        assert _ler(_trinco(instalacao) / "pid").strip() == str(primeiro.pid), (
            "O segundo deploy mexeu no trinco do primeiro."
        )
    finally:
        pode_acabar.touch()
        saida, erro = primeiro.communicate(timeout=60)

    assert primeiro.returncode == 0, f"{saida}\n{erro}"
    assert (instalacao.web / "index.html").read_text(encoding="utf-8") == (
        "<html>novo</html>\n"
    )
    assert not _trinco(instalacao).exists(), "O trinco ficou depois do fim."


# --- Trinco tomado por um processo vivo ------------------------------------------


def test_trinco_de_um_processo_vivo_recusa_sem_tocar_em_nada(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    _trinco(instalacao).mkdir()
    (_trinco(instalacao) / "pid").write_text(f"{os.getpid()}\n", encoding="utf-8")
    web_antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert OCUPADO in _mensagem(resultado), _mensagem(resultado)
    assert str(os.getpid()) in _mensagem(resultado), "A mensagem tem de dizer o PID."
    _assert_nada_tocado(instalacao, web_antes)
    assert _ler(_trinco(instalacao) / "pid") == f"{os.getpid()}\n", (
        "Quem recusa não pode mexer no trinco do outro."
    )


# --- Trinco abandonado -----------------------------------------------------------


def test_trinco_abandonado_por_processo_morto_e_recuperado(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    morto = _pid_morto()
    _trinco(instalacao).mkdir()
    (_trinco(instalacao) / "pid").write_text(f"{morto}\n", encoding="utf-8")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, _mensagem(resultado)
    assert "abandonado" in _mensagem(resultado) and str(morto) in _mensagem(
        resultado
    ), f"A recuperação tem de ser dita na saída:\n{_mensagem(resultado)}"
    assert OCUPADO not in _mensagem(resultado)
    assert (instalacao.api / "tmp" / "restart.txt").is_file()
    assert not _trinco(instalacao).exists()
    sobras = [p.name for p in instalacao.home.iterdir() if "abandonado" in p.name]
    assert sobras == [], f"Ficaram restos da recuperação: {sobras!r}"


def test_kill_9_a_meio_deixa_um_trinco_que_o_deploy_seguinte_recupera(
    tmp_path: Path,
) -> None:
    """O caso real do trinco abandonado: um deploy morto à força (o cPanel a matá-lo por tempo) não liberta nada."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    comecou, pode_acabar = _com_pip_que_espera(instalacao, tmp_path)

    primeiro = _arrancar_em_fundo(instalacao)
    try:
        _esperar_por(comecou, primeiro)
        primeiro.send_signal(signal.SIGKILL)
        primeiro.wait(timeout=30)
    finally:
        # O stub do pip fica órfão com os pipes do bash abertos: tem de
        # acabar antes de o `communicate` poder ler até ao fim.
        pode_acabar.touch()
    primeiro.communicate(timeout=30)

    assert _ler(_trinco(instalacao) / "pid").strip() == str(primeiro.pid), (
        "premissa: o kill -9 não deixa o trap correr, o trinco fica lá"
    )

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, _mensagem(resultado)
    assert "abandonado" in _mensagem(resultado), _mensagem(resultado)
    assert not _trinco(instalacao).exists()


# --- Regra 10: cada avaria com a sua mensagem -------------------------------------


def test_trinco_sem_pid_recusa_com_mensagem_propria(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    _trinco(instalacao).mkdir()
    web_antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert "não tem PID" in _mensagem(resultado), _mensagem(resultado)
    assert OCUPADO not in _mensagem(resultado)
    _assert_nada_tocado(instalacao, web_antes)
    assert _trinco(instalacao).is_dir(), "Um trinco que não se percebe não se apaga."


@pytest.mark.parametrize("conteudo", ["", "abc\n", "0\n", "-5\n", "12 34\n"])
def test_trinco_com_pid_invalido_recusa_com_mensagem_propria(
    tmp_path: Path, conteudo: str
) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    _trinco(instalacao).mkdir()
    (_trinco(instalacao) / "pid").write_text(conteudo, encoding="utf-8")
    web_antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert "não tem um PID válido" in _mensagem(resultado), _mensagem(resultado)
    assert OCUPADO not in _mensagem(resultado)
    _assert_nada_tocado(instalacao, web_antes)


def test_trinco_que_nao_se_consegue_criar_e_avaria_e_nao_ocupado(
    tmp_path: Path,
) -> None:
    """Um ficheiro com o nome do trinco faz o `mkdir` falhar sem haver deploy nenhum a correr."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    _trinco(instalacao).write_text("não sou um trinco\n", encoding="utf-8")
    web_antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert "não consegui criar o trinco" in _mensagem(resultado), _mensagem(resultado)
    assert "O mkdir disse: mkdir:" in _mensagem(resultado), (
        "A avaria tem de mostrar o stderr do mkdir:\n" + _mensagem(resultado)
    )
    assert OCUPADO not in _mensagem(resultado)
    _assert_nada_tocado(instalacao, web_antes)
    assert _ler(_trinco(instalacao)) == "não sou um trinco\n"


def test_pid_da_pasta_movida_ilegivel_nao_e_tratado_como_outro_deploy(
    tmp_path: Path,
) -> None:
    """Um `cat` que falha só na pasta `.abandonado.*` simula "não consegui ler o PID movido"."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    morto = _pid_morto()
    _trinco(instalacao).mkdir()
    (_trinco(instalacao) / "pid").write_text(f"{morto}\n", encoding="utf-8")
    stub_bin = tmp_path / "stub-cat"
    stub_bin.mkdir()
    _escrever_stub(
        stub_bin / "cat",
        "#!/usr/bin/env bash\n"
        'case "$*" in *.abandonado.*) echo "cat stub: a falhar" >&2; exit 1 ;; esac\n'
        'exec /bin/cat "$@"\n',
    )
    web_antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(
        instalacao,
        ambiente_extra={"PATH": f"{stub_bin}:{instalacao.ambiente['PATH']}"},
    )

    assert resultado.returncode != 0
    assert "não consegui ler o PID da pasta do trinco" in _mensagem(resultado), (
        _mensagem(resultado)
    )
    assert OCUPADO not in _mensagem(resultado), (
        "Um PID ilegível foi tratado como 'outro deploy está a correr' — regra 10."
    )
    _assert_nada_tocado(instalacao, web_antes)
    assert _ler(_trinco(instalacao) / "pid") == f"{morto}\n", (
        "O trinco devia ter sido devolvido ao sítio."
    )


@pytest.mark.skipif(
    hasattr(os, "geteuid") and os.geteuid() == 0,
    reason="como root, o kill -0 ao PID 1 dá certo e o caso não se constrói",
)
def test_dono_que_nao_se_consegue_verificar_nao_e_tratado_como_morto(
    tmp_path: Path,
) -> None:
    """O PID 1 é do root: o `kill -0` falha com "Operation not permitted", que não é "não existe"."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    _trinco(instalacao).mkdir()
    (_trinco(instalacao) / "pid").write_text("1\n", encoding="utf-8")
    web_antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert "não consegui saber se esse processo ainda existe" in _mensagem(resultado), (
        _mensagem(resultado)
    )
    assert "abandonado" not in _mensagem(resultado), (
        "Um dono que não se consegue verificar foi tratado como morto e o "
        "trinco recuperado — regra 10."
    )
    _assert_nada_tocado(instalacao, web_antes)
    assert _ler(_trinco(instalacao) / "pid") == "1\n"


# --- O trinco é sempre libertado ---------------------------------------------------


def test_trinco_libertado_depois_de_sucesso(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    resultado = _correr_deploy(instalacao)
    assert resultado.returncode == 0, _mensagem(resultado)
    assert not _trinco(instalacao).exists()


def test_trinco_libertado_depois_de_falha_a_meio(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    resultado = _correr_deploy(
        instalacao, ambiente_extra={"TOMAZIA_TESTE_FALHAR_PIP": "1"}
    )
    assert resultado.returncode != 0
    assert "falhou no passo" in _mensagem(resultado)
    assert not _trinco(instalacao).exists()


def test_trinco_libertado_depois_de_recusa_de_um_guarda(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    instalacao.config.unlink()
    resultado = _correr_deploy(instalacao)
    assert resultado.returncode != 0
    assert not _trinco(instalacao).exists()


def test_trinco_libertado_depois_de_sigterm(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    comecou, pode_acabar = _com_pip_que_espera(instalacao, tmp_path)

    processo = _arrancar_em_fundo(instalacao)
    try:
        _esperar_por(comecou, processo)
        processo.send_signal(signal.SIGTERM)
    finally:
        # O bash só corre o trap quando o filho em primeiro plano acaba.
        pode_acabar.touch()
    processo.communicate(timeout=60)

    assert processo.returncode != 0
    assert not _trinco(instalacao).exists()
    assert not (instalacao.api / "tmp" / "restart.txt").exists()
