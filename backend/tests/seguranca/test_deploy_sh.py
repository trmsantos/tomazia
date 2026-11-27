"""`deploy/deploy.sh`, o script que corre no servidor, contra uma instalação falsa (F1-04, infra).

Nunca contacta o cPanel real nem lê a BD antiga (regra 3 e regra 1 do
`CLAUDE.md`): tudo aqui vive num `HOME=$(mktemp -d)` fabricado por este
ficheiro, ao estilo descrito em `.claude/agents/infra.md` ("Testas scripts
com ... um HOME falso"). `pip` e `alembic` são stubs no `PATH` (nunca
tocam numa rede nem instalam nada); `cp`, `mv`, `rm` e `mkdir` são os reais
do sistema — exceto num único teste, que substitui mesmo o `cp` por um
stub malicioso de propósito (ver
`test_sincronizacao_que_apaga_env_a_meio_e_apanhada_na_verificacao_seguinte`).
O `deploy.sh` já não usa `rsync` (o CageFS do cPanel não o tem); a prova
de que corre sem ele está em `test_deploy_sh_sincroniza_sem_rsync.py`.

O que este ficheiro prova (e o que não prova):

- Invocação: `HOME=<falso> bash deploy/deploy.sh`, sem argumentos — tudo
  deriva de `$HOME` por convenção, tal como a árvore do servidor descrita
  em `docs/ESPECIFICACAO.md`:
    - `$HOME/tomazia_api/` — `API`: `.env`, `passenger_wsgi.py`, `app/`,
      `migrations/`, `scripts/`, `alembic.ini`, `requirements.txt`,
      `VERSION`, `tmp/restart.txt` (o sinal de reinício do Passenger).
    - `$HOME/repositories/tomazia/` — `ORIGEM`: o pacote que
      `deploy/montar.sh --saida` produz, com o código dentro de `api/`
      (`api/app` — com um `main.py` lá dentro, que é precondição do
      script —, `api/migrations`, `api/scripts` quando existir,
      `api/alembic.ini`, `api/passenger_wsgi.py`, `api/requirements.txt`,
      `api/VERSION`) e os estáticos dentro de `frontend/dist/` — nunca à
      solta na raiz do pacote.
    - `$HOME/virtualenv/tomazia_api/<versao>/bin/activate` — localizado
      por glob (`$HOME/virtualenv/tomazia_api/*/bin/activate`), nunca por
      um nome de versão fixo (o cPanel escolhe a versão).
- `$HOME/.tomazia-deploy.conf` — o **ficheiro de configuração** do próprio
  `deploy.sh` (nunca o `.env` da app): uma linha `WEB=<caminho absoluto>`,
  sem aspas. É aqui que o Tomás aponta `WEB` para a pasta do subdomínio
  (`~/novo.<domínio>`, servida em `new.<domínio>`) durante a construção
  e para `public_html` no corte final (F5-02) — persistente, fora do pacote sincronizado, para sobreviver a cada deploy automático.
- `.env` (`API/.env`) é só a configuração da app. `deploy.sh` nunca lê o
  conteúdo, só confirma que existe — antes de mexer em nada, e outra vez
  depois das sincronizações, antes de tocar em `tmp/restart.txt`.

Esta forma de `ORIGEM` já não é um "ponto de extensão a confirmar": é o
que `deploy/montar.sh` produz de facto, e a instalação falsa fabricada
abaixo (`_preparar_instalacao_valida`) tem de refletir isso byte a byte,
nunca uma suposição à parte. Durante algum tempo não refletiu — a versão
anterior deste ficheiro fabricava `ORIGEM` com o código e o `VERSION` à
solta na raiz do pacote (sem o nível `api/`) e os estáticos em
`frontend/` (sem o `dist/`), porque foi escrita em paralelo com
`montar.sh`, sem o script real para conferir contra. Os testes AQUI
passavam na mesma, porque testam só `deploy.sh` isoladamente, contra uma
árvore que ESTE ficheiro controla — nunca provam que essa árvore é a
mesma que `montar.sh` produz de verdade. Essa prova (os dois scripts
reais, um a seguir ao outro, sobre o mesmo pacote) é
`tests/seguranca/test_integracao_pacote_deploy.py`, não este ficheiro:
é lá que fica presa a costura entre `montar.sh` e `deploy.sh`.
"""

from __future__ import annotations

import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
CAMINHO_SCRIPT = RAIZ_REPO / "deploy" / "deploy.sh"

CONTEUDO_ENV_FALSO = """\
AMBIENTE=producao
DATA_DIR=/caminho/inventado/tomazia_data
MEDIA_DIR=/caminho/inventado/public_html/media
BASE_DADOS_URL=sqlite:////caminho/inventado/tomazia_data/tomazia.db
SEGREDO_SESSAO=segredo-de-teste-nunca-usado-em-producao-abc123
"""

CONTEUDO_ACTIVATE_FALSO = """\
#!/usr/bin/env bash
export PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd):$PATH"
export VIRTUAL_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"""

MARCADOR_NOVO = "marcador-novo-no-pacote.txt"
MARCADOR_VELHO = "marcador-velho-ja-no-servidor.txt"


def _tornar_executavel(caminho: Path) -> None:
    caminho.chmod(caminho.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def _escrever_stub(caminho: Path, conteudo: str) -> None:
    caminho.write_text(conteudo, encoding="utf-8")
    _tornar_executavel(caminho)


_STUB_REGISTADOR = """\
#!/usr/bin/env bash
ts=$(python3 -c "import time; print(time.time())")
marcador=0
if [ -n "${{TOMAZIA_TESTE_MARCADOR_SINCRONIZADO:-}}" ] && [ -e "${{TOMAZIA_TESTE_MARCADOR_SINCRONIZADO}}" ]; then
  marcador=1
fi
printf 'EVENTO={nome} ARGS=%s MARCADOR=%s TS=%s\\n' "$*" "$marcador" "$ts" >> "${{TOMAZIA_TESTE_LOG_{nome_maiusculas}}}"
if [ "${{TOMAZIA_TESTE_FALHAR_{nome_maiusculas}:-0}}" = "1" ]; then
  echo "{nome} stub: a falhar de proposito (TOMAZIA_TESTE_FALHAR_{nome_maiusculas}=1)" >&2
  exit 1
fi
exit 0
"""


@dataclass
class Instalacao:
    home: Path
    api: Path
    origem: Path
    web: Path
    config: Path
    venv_bin: Path
    log_pip: Path
    log_alembic: Path
    ambiente: dict[str, str]


def _preparar_instalacao_valida(tmp_path: Path) -> Instalacao:
    """Constrói uma instalação falsa completa e válida, pronta para um deploy com sucesso.

    Cada teste parte daqui e estraga só o que quer testar — nunca o
    inverso (construir cada cenário do zero evitaria reaproveitar bugs
    entre testes, mas tornaria cada teste frágil a qualquer detalhe novo
    exigido pelo "contrato" acima).
    """
    home = tmp_path / "home"
    api = home / "tomazia_api"
    origem = home / "repositories" / "tomazia"
    web = home / "novo-dominio-exemplo"
    venv_dir = home / "virtualenv" / "tomazia_api" / "3.11"
    venv_bin = venv_dir / "bin"

    for pasta in (api, origem, web, venv_bin, home / "repositories"):
        pasta.mkdir(parents=True, exist_ok=True)

    # API: o que já lá está de uma instalação anterior.
    (api / ".env").write_text(CONTEUDO_ENV_FALSO, encoding="utf-8")
    (api / "app").mkdir()
    (api / "app" / MARCADOR_VELHO).write_text("velho\n", encoding="utf-8")

    # ORIGEM: o pacote montado (ver docstring do módulo e
    # `tests/seguranca/test_integracao_pacote_deploy.py`, que corre
    # `montar.sh` a sério e prova esta forma contra o script real, em vez
    # de a fabricar aqui). `montar.sh` escreve o código dentro de `api/`
    # e os estáticos dentro de `frontend/dist/` — nunca à solta na raiz do
    # pacote.
    (origem / "api" / "app").mkdir(parents=True)
    (origem / "api" / "app" / MARCADOR_NOVO).write_text("novo\n", encoding="utf-8")
    # `api/app/main.py` é precondição do `deploy.sh` (ver
    # `test_deploy_sh_recusa_antes_de_escrever.py`): um `api/app/` presente
    # mas sem a app lá dentro faz o `rsync --delete` esvaziar o `$API/app`,
    # e por isso é recusado antes de qualquer escrita. Numa instalação
    # VÁLIDA tem de lá estar — senão todos os testes abaixo que esperam
    # `returncode != 0` passariam por esta recusa em vez da que dizem
    # testar, e os que esperam um deploy com sucesso falhariam.
    (origem / "api" / "app" / "main.py").write_text(
        "# aplicacao falsa\n", encoding="utf-8"
    )
    (origem / "api" / "migrations").mkdir()
    (origem / "api" / "migrations" / "env.py").write_text(
        "# migrations falsas\n", encoding="utf-8"
    )
    (origem / "api" / "scripts").mkdir()
    (origem / "api" / "scripts" / "backup.py").write_text(
        "# script falso\n", encoding="utf-8"
    )
    (origem / "api" / "alembic.ini").write_text(
        "# alembic.ini falso\n", encoding="utf-8"
    )
    (origem / "api" / "passenger_wsgi.py").write_text(
        "# passenger_wsgi falso\n", encoding="utf-8"
    )
    (origem / "api" / "requirements.txt").write_text(
        "fastapi==0.0.0\n", encoding="utf-8"
    )
    (origem / "api" / "VERSION").write_text("abc1234\n", encoding="utf-8")
    (origem / "frontend" / "dist").mkdir(parents=True)
    (origem / "frontend" / "dist" / "index.html").write_text(
        "<html>novo</html>\n", encoding="utf-8"
    )
    (origem / "frontend" / "dist" / "assets").mkdir()
    (origem / "frontend" / "dist" / "assets" / "novo-cd34.js").write_text(
        "console.log('novo')\n", encoding="utf-8"
    )

    # WEB: o que já lá está e tem de sobreviver ao deploy.
    (web / ".htaccess").write_text("# diretivas reais do servidor\n", encoding="utf-8")
    (web / "media").mkdir()
    (web / "media" / "foto-aprovada.webp").write_bytes(b"conteudo-imagem-falso")
    (web / ".well-known").mkdir()
    (web / ".well-known" / "verificacao.txt").write_text(
        "verificacao\n", encoding="utf-8"
    )
    (web / "assets").mkdir()
    (web / "assets" / "velho-ab12.js").write_text(
        "console.log('velho')\n", encoding="utf-8"
    )

    # Virtualenv falso: activate + stubs de pip e alembic lá dentro —
    # só alcançáveis depois de um `source .../activate` a sério.
    _escrever_stub(venv_bin / "activate", CONTEUDO_ACTIVATE_FALSO)
    _escrever_stub(
        venv_bin / "pip",
        _STUB_REGISTADOR.format(nome="pip", nome_maiusculas="PIP"),
    )
    _escrever_stub(
        venv_bin / "alembic",
        _STUB_REGISTADOR.format(nome="alembic", nome_maiusculas="ALEMBIC"),
    )

    config = home / ".tomazia-deploy.conf"
    config.write_text(f"WEB={web}\n", encoding="utf-8")

    log_pip = tmp_path / "log-pip.txt"
    log_alembic = tmp_path / "log-alembic.txt"

    ambiente = {
        "HOME": str(home),
        "PATH": "/usr/bin:/bin:/usr/local/bin",
        "TOMAZIA_TESTE_LOG_PIP": str(log_pip),
        "TOMAZIA_TESTE_LOG_ALEMBIC": str(log_alembic),
        "TOMAZIA_TESTE_MARCADOR_SINCRONIZADO": str(api / "app" / MARCADOR_NOVO),
    }

    return Instalacao(
        home=home,
        api=api,
        origem=origem,
        web=web,
        config=config,
        venv_bin=venv_bin,
        log_pip=log_pip,
        log_alembic=log_alembic,
        ambiente=ambiente,
    )


def _correr_deploy(
    instalacao: Instalacao,
    *,
    ambiente_extra: dict[str, str] | None = None,
    tempo_max: float = 30.0,
) -> subprocess.CompletedProcess[str]:
    if not CAMINHO_SCRIPT.is_file():
        pytest.fail(
            f"{CAMINHO_SCRIPT} ainda não existe (é o infra que o escreve, na F1-04)."
        )
    ambiente = dict(instalacao.ambiente)
    if ambiente_extra:
        ambiente.update(ambiente_extra)
    return subprocess.run(
        ["bash", str(CAMINHO_SCRIPT)],
        env=ambiente,
        cwd=str(instalacao.home),
        capture_output=True,
        text=True,
        timeout=tempo_max,
    )


def _restart_existe(instalacao: Instalacao) -> bool:
    return (instalacao.api / "tmp" / "restart.txt").is_file()


def _ler_log(caminho: Path) -> str:
    return caminho.read_text(encoding="utf-8") if caminho.is_file() else ""


def _assert_nada_escrito(instalacao: Instalacao) -> None:
    """Nenhum stub correu e o restart nunca foi sinalizado — nada mudou no servidor."""
    assert _ler_log(instalacao.log_pip) == "", (
        "O pip foi chamado, mas o script devia ter recusado antes disso."
    )
    assert not _restart_existe(instalacao), (
        "tmp/restart.txt existe, mas o script devia ter recusado antes de "
        "sinalizar o reinício."
    )


# --- O teste que a tarefa exige (docs/TAREFAS.md) --------------------------


def test_env_ausente_falha_e_nao_reinicia(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    (instalacao.api / ".env").unlink()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert not _restart_existe(instalacao), (
        "tmp/restart.txt não pode existir sem .env: o Passenger reiniciaria "
        "a servir um erro de configuração em vez da app."
    )


def test_env_ausente_e_recusado_antes_de_qualquer_escrita(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    (instalacao.api / ".env").unlink()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    _assert_nada_escrito(instalacao)


def test_env_como_symlink_pendurado_da_mensagem_diferente_de_ausente(
    tmp_path: Path,
) -> None:
    """Regra 10: `.env` como symlink para um alvo que não existe não é a mesma avaria que `.env` em falta."""
    instalacao_ausente = _preparar_instalacao_valida(tmp_path / "ausente")
    (instalacao_ausente.api / ".env").unlink()
    resultado_ausente = _correr_deploy(instalacao_ausente)

    instalacao_symlink = _preparar_instalacao_valida(tmp_path / "symlink")
    (instalacao_symlink.api / ".env").unlink()
    (instalacao_symlink.api / ".env").symlink_to(
        instalacao_symlink.home / "nao-existe-mesmo" / ".env"
    )
    resultado_symlink = _correr_deploy(instalacao_symlink)

    assert resultado_ausente.returncode != 0
    assert resultado_symlink.returncode != 0
    assert not _restart_existe(instalacao_ausente)
    assert not _restart_existe(instalacao_symlink)

    mensagem_ausente = resultado_ausente.stdout + resultado_ausente.stderr
    mensagem_symlink = resultado_symlink.stdout + resultado_symlink.stderr
    assert mensagem_ausente != mensagem_symlink, (
        ".env em falta e .env como symlink pendurado (o alvo não existe) "
        "têm de produzir mensagens de diagnóstico diferentes — são avarias "
        "diferentes, mesmo que o resultado final (recusar) seja o mesmo."
    )


# --- O que importa mais: a sincronização a apagar o .env a meio ------------


def test_sincronizacao_que_apaga_env_a_meio_e_apanhada_na_verificacao_seguinte(
    tmp_path: Path,
) -> None:
    """Um `cp` que apague `.env` a meio da sincronização tem de ser apanhado DEPOIS dela, nunca só no início.

    Era um `rsync` adulterado quando o `deploy.sh` usava `rsync`; agora é
    o `cp`, a ferramenta que a sincronização chama por cada ficheiro. O
    primeiro `cp` do script é já dentro da sincronização (depois do pip).
    """
    instalacao = _preparar_instalacao_valida(tmp_path)

    cp_real = _localizar_cp_real()
    stub_bin = tmp_path / "stub-cp-malicioso"
    stub_bin.mkdir()
    _escrever_stub(
        stub_bin / "cp",
        f"""\
#!/usr/bin/env bash
{cp_real} "$@"
codigo=$?
rm -f "$TOMAZIA_TESTE_ENV_A_APAGAR"
exit $codigo
""",
    )

    ambiente_extra = {
        "PATH": f"{stub_bin}:{instalacao.ambiente['PATH']}",
        "TOMAZIA_TESTE_ENV_A_APAGAR": str(instalacao.api / ".env"),
    }

    resultado = _correr_deploy(instalacao, ambiente_extra=ambiente_extra)

    assert resultado.returncode != 0, (
        "Com o .env apagado a meio da sincronização, o deploy tem de falhar, "
        "não reiniciar a app com uma configuração em falta."
    )
    assert not _restart_existe(instalacao)
    # O pip correu (a instalação começou válida); é a verificação DEPOIS da
    # sincronização que tem de apanhar isto — nunca só a do início.
    assert _ler_log(instalacao.log_pip) != "", (
        "O pip nunca chegou a correr — isto testa a verificação DEPOIS da "
        "sincronização, não a do início (essa já está noutro teste)."
    )
    assert (instalacao.api / "app" / MARCADOR_NOVO).exists(), (
        "premissa do teste: a sincronização tem de ter corrido (e o stub "
        "do cp com ela) — senão quem recusou foi outro guarda."
    )
    assert _ler_log(instalacao.log_alembic) == "", (
        "alembic correu mesmo com o .env apagado a meio da sincronização — "
        "a verificação seguinte tem de travar antes das migrações."
    )


def _localizar_cp_real() -> str:
    import shutil

    caminho = shutil.which("cp", path="/usr/bin:/bin")
    assert caminho is not None, "cp não está instalado nesta máquina de testes."
    return caminho


# --- O que sobrevive e o que desaparece na sincronização do frontend ------


def test_frontend_preserva_media_htaccess_well_known_e_remove_ficheiro_antigo(
    tmp_path: Path,
) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)

    conteudo_htaccess_antes = (instalacao.web / ".htaccess").read_bytes()
    conteudo_media_antes = (
        instalacao.web / "media" / "foto-aprovada.webp"
    ).read_bytes()
    conteudo_well_known_antes = (
        instalacao.web / ".well-known" / "verificacao.txt"
    ).read_bytes()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, resultado.stderr
    assert (instalacao.web / ".htaccess").read_bytes() == conteudo_htaccess_antes
    assert (
        instalacao.web / "media" / "foto-aprovada.webp"
    ).read_bytes() == conteudo_media_antes
    assert (
        instalacao.web / ".well-known" / "verificacao.txt"
    ).read_bytes() == conteudo_well_known_antes
    assert not (instalacao.web / "assets" / "velho-ab12.js").exists(), (
        "Um ficheiro do frontend que já não está no pacote tem de "
        "desaparecer do WEB (modo site, que apaga o que já não está na origem)."
    )
    assert (instalacao.web / "index.html").read_text(
        encoding="utf-8"
    ) == "<html>novo</html>\n"
    assert (instalacao.web / "assets" / "novo-cd34.js").is_file()


# --- Recusa antes de escrever o que quer que seja --------------------------


def test_falta_ficheiro_de_configuracao(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    instalacao.config.unlink()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    _assert_nada_escrito(instalacao)


def test_web_relativo_recusado(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    instalacao.config.write_text("WEB=novo-dominio-exemplo\n", encoding="utf-8")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    _assert_nada_escrito(instalacao)
    assert not (instalacao.web / "index.html").exists()


def test_web_fora_do_home_recusado(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    web_fora = tmp_path / "fora-do-home" / "web"
    web_fora.mkdir(parents=True)
    (web_fora / ".htaccess").write_text("x", encoding="utf-8")
    (web_fora / "media").mkdir()
    instalacao.config.write_text(f"WEB={web_fora}\n", encoding="utf-8")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    _assert_nada_escrito(instalacao)
    assert not (web_fora / "index.html").exists()


def test_web_sem_htaccess_recusado(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    (instalacao.web / ".htaccess").unlink()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    _assert_nada_escrito(instalacao)
    assert not (instalacao.web / "index.html").exists()


def test_web_sem_media_recusado(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    import shutil

    shutil.rmtree(instalacao.web / "media")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    _assert_nada_escrito(instalacao)
    assert not (instalacao.web / "index.html").exists()


# --- Ordem, provada pelo registo dos stubs ----------------------------------


def test_ordem_pip_sincronizacao_alembic_version_restart(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, resultado.stderr

    log_pip = _ler_log(instalacao.log_pip)
    log_alembic = _ler_log(instalacao.log_alembic)
    assert log_pip, "pip nunca foi chamado."
    assert log_alembic, "alembic nunca foi chamado."

    assert "MARCADOR=0" in log_pip, (
        "O pip correu depois do código já estar sincronizado — tinha de "
        "correr ANTES da sincronização do código (install -r requirements.txt não "
        "depende do código da app em si)."
    )
    assert "MARCADOR=1" in log_alembic, (
        "O alembic correu antes do código estar sincronizado — tem de "
        "correr DEPOIS da sincronização do código (as migrações vêm com o "
        "código novo)."
    )

    ts_alembic = float(log_alembic.strip().split("TS=")[-1])
    mtime_version = (instalacao.api / "VERSION").stat().st_mtime
    mtime_restart = (instalacao.api / "tmp" / "restart.txt").stat().st_mtime

    assert ts_alembic <= mtime_version, (
        "VERSION foi escrito antes do alembic correr — tem de ser "
        "penúltimo, depois das migrações."
    )
    assert mtime_version <= mtime_restart, (
        "tmp/restart.txt não pode ter um mtime anterior ao de VERSION — "
        "o touch final tem de ser mesmo o último passo."
    )


def test_pip_a_falhar_nao_sincroniza_codigo_e_sai_com_erro(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)

    resultado = _correr_deploy(
        instalacao, ambiente_extra={"TOMAZIA_TESTE_FALHAR_PIP": "1"}
    )

    assert resultado.returncode != 0
    assert not (instalacao.api / "app" / MARCADOR_NOVO).exists(), (
        "O código não pode ter sido sincronizado: o pip falhou antes do "
        "sincronização do código."
    )
    assert (instalacao.api / "app" / MARCADOR_VELHO).exists(), (
        "O ficheiro antigo ainda devia lá estar — a sincronização nunca correu."
    )
    assert _ler_log(instalacao.log_alembic) == "", (
        "alembic não pode ter corrido se o pip falhou."
    )
    assert not _restart_existe(instalacao)


# --- VERSION ausente ou fora do formato no pacote --------------------------


def test_version_ausente_no_pacote_recusa(tmp_path: Path) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    (instalacao.origem / "api" / "VERSION").unlink()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert not _restart_existe(instalacao)


@pytest.mark.parametrize(
    "conteudo_invalido",
    ["", "   \n", "sha com espaços\n", "a" * 100],
    ids=["vazio", "so_espacos", "com_espacos", "longo_demais"],
)
def test_version_fora_do_formato_no_pacote_recusa(
    tmp_path: Path, conteudo_invalido: str
) -> None:
    instalacao = _preparar_instalacao_valida(tmp_path)
    (instalacao.origem / "api" / "VERSION").write_text(
        conteudo_invalido, encoding="utf-8"
    )

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0
    assert not _restart_existe(instalacao)


# --- Guarda estática ---------------------------------------------------------


def test_script_existe() -> None:
    assert CAMINHO_SCRIPT.is_file(), (
        f"{CAMINHO_SCRIPT} ainda não existe (é o infra que o escreve, na F1-04)."
    )
