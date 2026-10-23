"""A costura entre `deploy/montar.sh` e `deploy/deploy.sh`: o que um escreve é o que o outro lê.

## Porque este ficheiro existe

`tests/test_montar.py` prova o contrato de `montar.sh` contra uma árvore de
trabalho fabricada, lendo só o que `montar.sh` produziu. `tests/seguranca/
test_deploy_sh.py` prova o comportamento de `deploy.sh` isoladamente, contra
uma árvore `$HOME` falsa cujo `ORIGEM` (`$HOME/repositories/tomazia`) é
fabricado à mão por esse ficheiro — nunca o pacote real montado. As duas
frentes (infra a escrever `montar.sh`, infra a escrever `deploy.sh`)
correram em paralelo, cada uma testando o seu próprio mundo; nenhuma delas
prova que os DOIS concordam sobre a forma do pacote.

Não concordavam: `montar.sh` escreve o código em `<saida>/api/app`,
`<saida>/api/migrations`, etc., e os estáticos em
`<saida>/frontend/dist/`; a versão de `deploy.sh` revista pelo
revisor-codigo lia `$ORIGEM/app/`, `$ORIGEM/migrations/`, `$ORIGEM/VERSION`
e sincronizava `$ORIGEM/frontend/` (não `$ORIGEM/frontend/dist/`) — falta
sempre um nível inteiro (`api/`, e `dist/` do lado do frontend). O primeiro
deploy a sério morria na primeira linha que tocasse em código, com 247
testes verdes por cima: nenhum deles corria os dois scripts reais, um a
seguir ao outro, sobre o mesmo pacote.

Este ficheiro fecha exatamente esse buraco: monta o pacote com o
`montar.sh` REAL (nunca uma árvore `ORIGEM` fabricada) e corre o
`deploy.sh` REAL sobre a saída dele, dentro de um `$HOME` falso. Não está
ligado a nenhum critério S-NN enumerado em `docs/ESPECIFICACAO.md` — vive
em `tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz ("cada falha de
segurança corrigida ganha um teste em `backend/tests/seguranca/`"): um
primeiro deploy a sério a morrer em produção, sem nenhum teste a apanhar,
é exatamente esse tipo de falha.

## O que NÃO se fabrica aqui

A árvore de trabalho para `montar.sh` reutiliza o mesmo princípio de
`tests/test_montar.py::_construir_arvore_completa`: cópia de trabalho do
`backend/` e do `deploy/` REAIS do repositório (lidos, nunca escritos), só
com `frontend/dist` fabricado (um `npm run build` a sério é lento e traz
ruído de hashes que mudam a cada build). `backend/scripts` não é
fabricado — não existe no repositório hoje (só nasce na F2-02) — e é
precisamente esse o estado que o primeiro teste abaixo exercita: o pacote
real, montado hoje, não tem `api/scripts/`, e isso sozinho não pode matar
o deploy.

A instalação-servidor falsa (`$HOME`, `API`, `WEB`, o virtualenv com stubs
de `pip`/`alembic`) segue o mesmo desenho de
`tests/seguranca/test_deploy_sh.py::_preparar_instalacao_valida` — a única
diferença de propósito é que `ORIGEM` (`$HOME/repositories/tomazia`) não é
escrito à mão por este ficheiro: é o próprio `--saida` passado a
`montar.sh`. O pacote que `deploy.sh` lê é, byte a byte, o pacote que
`montar.sh` produziu.

## O caso dedicado "sem `backend/scripts`"

Além do teste com a árvore completa (onde `backend/scripts` já está
ausente, por ser o estado real do repositório), há um segundo teste com
uma árvore mínima e totalmente fabricada que garante essa ausência
mesmo depois de `backend/scripts` vir a existir (F2-02) — para que esta
garantia não desapareça silenciosamente só por o repositório ter mudado.
`deploy.sh` tem de aceitar um pacote sem `api/scripts/` sem morrer (nem
com um `rsync` que recuse por a pasta de origem não existir).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parents[3]
MONTAR = RAIZ_REPO / "deploy" / "montar.sh"
DEPLOY = RAIZ_REPO / "deploy" / "deploy.sh"

#: 40 carateres hexadecimais, como um SHA de commit a sério — mas calculado
#: a partir de texto claramente falso, nunca um SHA de um commit real.
SHA_VALIDO = hashlib.sha1(
    b"commit de teste do test_integracao_pacote_deploy.py, nunca real"
).hexdigest()
assert len(SHA_VALIDO) == 40

_IGNORAR_NA_COPIA = shutil.ignore_patterns(
    ".venv",
    "node_modules",
    "__pycache__",
    "*.pyc",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".impeccable",
    ".DS_Store",
    "dist",
)

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

_STUB_REGISTADOR = """\
#!/usr/bin/env bash
printf 'EVENTO={nome} ARGS=%s\\n' "$*" >> "${{TOMAZIA_TESTE_LOG_{nome_maiusculas}}}"
exit 0
"""

MARCADOR_VELHO = "marcador-velho-ja-no-servidor.txt"


def _tornar_executavel(caminho: Path) -> None:
    caminho.chmod(caminho.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def _escrever_stub(caminho: Path, conteudo: str) -> None:
    caminho.write_text(conteudo, encoding="utf-8")
    _tornar_executavel(caminho)


def _copiar_se_existir(origem: Path, destino: Path) -> None:
    if not origem.exists():
        return
    if origem.is_dir():
        shutil.copytree(origem, destino, ignore=_IGNORAR_NA_COPIA)
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origem, destino)


def _fabricar_frontend_dist(raiz: Path) -> None:
    pasta_dist = raiz / "frontend" / "dist"
    pasta_dist.mkdir(parents=True, exist_ok=True)
    (pasta_dist / "index.html").write_text(
        "<!doctype html><html><head><title>Bar da Tomazia</title></head>"
        "<body>pacote de teste, fabricado pelo "
        "test_integracao_pacote_deploy.py</body></html>\n",
        encoding="utf-8",
    )
    (pasta_dist / "assets").mkdir(exist_ok=True)
    (pasta_dist / "assets" / "app.js").write_text(
        "// ficheiro fabricado, nunca um build a sério\n", encoding="utf-8"
    )


def _construir_arvore_trabalho_completa(tmp_path: Path) -> Path:
    """Cópia de trabalho do `backend/` e `deploy/` REAIS do repositório, mais um `frontend/dist` fabricado.

    Nunca escreve no repositório real, só lê dele (ver docstring do
    módulo). `backend/scripts` não é fabricado: não existe no repositório
    hoje, e é esse o estado que o teste de integração principal, abaixo,
    exercita a sério.
    """
    raiz = tmp_path / "trabalho"
    raiz.mkdir()

    _copiar_se_existir(RAIZ_REPO / "backend", raiz / "backend")
    _copiar_se_existir(RAIZ_REPO / "deploy", raiz / "deploy")
    _fabricar_frontend_dist(raiz)

    return raiz


def _construir_arvore_trabalho_minima_sem_scripts(tmp_path: Path) -> Path:
    """Árvore pequena e totalmente fabricada, garantida sem `backend/scripts` — independente do estado atual do repositório real."""
    raiz = tmp_path / "trabalho-minimo"
    raiz.mkdir()

    (raiz / "backend" / "app").mkdir(parents=True)
    (raiz / "backend" / "app" / "__init__.py").write_text("", encoding="utf-8")
    (raiz / "backend" / "app" / "main.py").write_text(
        "# aplicacao falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "migrations").mkdir(parents=True)
    (raiz / "backend" / "migrations" / "env.py").write_text(
        "# migracao falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "alembic.ini").write_text(
        "[alembic]\nscript_location = migrations\n", encoding="utf-8"
    )
    (raiz / "backend" / "passenger_wsgi.py").write_text(
        "# passenger_wsgi falso\n", encoding="utf-8"
    )
    (raiz / "backend" / "requirements.txt").write_text("fastapi\n", encoding="utf-8")
    # De propósito, SEM `backend/scripts`.

    _fabricar_frontend_dist(raiz)
    _copiar_se_existir(RAIZ_REPO / "deploy", raiz / "deploy")

    return raiz


def _correr_montar(
    raiz_trabalho: Path, *, sha: str, saida: Path, timeout: float = 30
) -> subprocess.CompletedProcess[str]:
    """Invoca `<raiz_trabalho>/deploy/montar.sh` por subprocesso. Nunca o importa."""
    script = raiz_trabalho / "deploy" / "montar.sh"
    return subprocess.run(
        [str(script), "--sha", sha, "--saida", str(saida)],
        cwd=raiz_trabalho,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


@dataclass
class Instalacao:
    home: Path
    api: Path
    origem: Path
    web: Path
    config: Path
    log_pip: Path
    log_alembic: Path
    ambiente: dict[str, str]


def _preparar_servidor_falso(tmp_path: Path) -> Instalacao:
    """Constrói `$HOME` falso (API, WEB, virtualenv com stubs) — mesmo desenho de `test_deploy_sh.py::_preparar_instalacao_valida`.

    A diferença de propósito: `origem` (`$HOME/repositories/tomazia`) não é
    escrita por esta função — é o `--saida` que o chamador passa a
    `montar.sh`. Esta função só cria a pasta `repositories/` vazia, para
    `montar.sh` ter onde escrever.
    """
    home = tmp_path / "home"
    api = home / "tomazia_api"
    origem = home / "repositories" / "tomazia"
    web = home / "novo-dominio-exemplo"
    venv_dir = home / "virtualenv" / "tomazia_api" / "3.11"
    venv_bin = venv_dir / "bin"

    for pasta in (api, web, venv_bin, home / "repositories"):
        pasta.mkdir(parents=True, exist_ok=True)

    (api / ".env").write_text(CONTEUDO_ENV_FALSO, encoding="utf-8")
    (api / "app").mkdir()
    (api / "app" / MARCADOR_VELHO).write_text("velho\n", encoding="utf-8")

    (web / ".htaccess").write_text("# diretivas reais do servidor\n", encoding="utf-8")
    (web / "media").mkdir()
    (web / "media" / "foto-aprovada.webp").write_bytes(b"conteudo-imagem-falso")

    _escrever_stub(venv_bin / "activate", CONTEUDO_ACTIVATE_FALSO)
    _escrever_stub(
        venv_bin / "pip", _STUB_REGISTADOR.format(nome="pip", nome_maiusculas="PIP")
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
    }

    return Instalacao(
        home=home,
        api=api,
        origem=origem,
        web=web,
        config=config,
        log_pip=log_pip,
        log_alembic=log_alembic,
        ambiente=ambiente,
    )


def _correr_deploy(
    instalacao: Instalacao, *, tempo_max: float = 30.0
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(DEPLOY)],
        env=instalacao.ambiente,
        cwd=str(instalacao.home),
        capture_output=True,
        text=True,
        timeout=tempo_max,
    )


# --- O teste principal: o pacote real, tal como o repositório está hoje ---


def test_pacote_montado_por_montar_sh_e_aceite_por_deploy_sh(tmp_path: Path) -> None:
    """Corre `montar.sh` a sério e depois `deploy.sh` a sério sobre a saída dele — a costura que nenhum outro ficheiro de testes prende."""
    raiz_trabalho = _construir_arvore_trabalho_completa(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)

    resultado_montar = _correr_montar(
        raiz_trabalho, sha=SHA_VALIDO, saida=instalacao.origem
    )
    assert resultado_montar.returncode == 0, (
        f"montar.sh falhou a montar o pacote: {resultado_montar.stderr}"
    )

    # Sanidade: o pacote real, montado hoje, não tem `api/scripts/` —
    # `backend/scripts` não existe no repositório (só nasce na F2-02).
    assert not (instalacao.origem / "api" / "scripts").exists()

    resultado_deploy = _correr_deploy(instalacao)

    assert resultado_deploy.returncode == 0, (
        "deploy.sh tem de aceitar, sem recusar, o pacote REAL que montar.sh "
        f"produziu.\nstdout:\n{resultado_deploy.stdout}\nstderr:\n{resultado_deploy.stderr}"
    )

    assert (instalacao.api / "app" / "main.py").is_file(), (
        "o código novo (backend/app/main.py) tem de estar sincronizado em "
        "tomazia_api/app/"
    )
    assert not (instalacao.api / "app" / MARCADOR_VELHO).exists(), (
        "o ficheiro antigo de tomazia_api/app/ tem de desaparecer (rsync --delete)"
    )
    assert (instalacao.api / "migrations" / "env.py").is_file()

    conteudo_version = (instalacao.api / "VERSION").read_text(encoding="utf-8")
    assert conteudo_version == SHA_VALIDO, (
        f"tomazia_api/VERSION tem de conter exatamente o SHA do pacote, "
        f"vi {conteudo_version!r}"
    )

    assert (instalacao.web / "index.html").is_file(), (
        "o index.html do frontend tem de ficar na RAIZ de WEB, nunca em WEB/dist/"
    )
    assert not (instalacao.web / "dist").exists(), (
        "WEB não pode ter uma subpasta 'dist/' — o conteúdo de "
        "frontend/dist/ do pacote vai para a RAIZ de WEB"
    )

    assert (instalacao.api / "tmp" / "restart.txt").is_file(), (
        "tmp/restart.txt tem de ser criado no fim, para o Passenger reiniciar"
    )


# --- O caso dedicado: pacote sem `api/scripts/` não pode matar o deploy ---


def test_pacote_sem_scripts_nao_falha_o_deploy(tmp_path: Path) -> None:
    """`backend/scripts` só nasce na F2-02: um pacote sem `api/scripts/` tem de ser aceite por `deploy.sh` na mesma."""
    raiz_trabalho = _construir_arvore_trabalho_minima_sem_scripts(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)

    resultado_montar = _correr_montar(
        raiz_trabalho, sha=SHA_VALIDO, saida=instalacao.origem
    )
    assert resultado_montar.returncode == 0, (
        f"montar.sh falhou a montar o pacote: {resultado_montar.stderr}"
    )
    assert not (instalacao.origem / "api" / "scripts").exists(), (
        "premissa do teste: o pacote não pode ter api/scripts/"
    )

    resultado_deploy = _correr_deploy(instalacao)

    assert resultado_deploy.returncode == 0, (
        "deploy.sh não pode morrer só porque o pacote não tem api/scripts/ "
        "(essa pasta só nasce na F2-02).\n"
        f"stdout:\n{resultado_deploy.stdout}\nstderr:\n{resultado_deploy.stderr}"
    )
    assert (instalacao.api / "tmp" / "restart.txt").is_file()
