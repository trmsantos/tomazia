"""`deploy/deploy.sh` nunca sincroniza um `.htaccess` do pacote para o `WEB`, esteja a que profundidade estiver (ronda de segurança da F1-04).

## O achado

O `rsync` do frontend levava `--exclude='/.htaccess'`. Em `rsync`, uma
barra inicial ANCORA o padrão à raiz da transferência: `/.htaccess` só
corresponde ao `.htaccess` do topo de `frontend/dist/`. Um `.htaccess`
dentro de uma subpasta do build (`dist/assets/.htaccess`, vindo de uma
dependência ou de um erro) passava pelo filtro, aterrava em
`WEB/assets/.htaccess` e era honrado pelo Apache — o cPanel deixa
`AllowOverride All`, e um `.htaccess` numa subpasta sobrepõe-se, para essa
subpasta, à configuração real do servidor. O padrão passou a
`--exclude='.htaccess'`, sem âncora: corresponde ao nome base a qualquer
profundidade.

## Porque este teste planta o intruso DEPOIS do `montar.sh`

`montar.sh` recusa, desde a mesma ronda, qualquer pacote com um
`.htaccess` lá dentro (ver `test_montar_recusa_htaccess.py`). As duas
camadas existem porque fazem falta as duas: a de `montar.sh` protege o que
sai deste repositório, e a de `deploy.sh` protege o servidor de tudo o
resto — um pacote montado por uma versão antiga do `montar.sh`, uma
alteração manual no `$ORIGEM` do servidor, um ficheiro que apareça entre o
`git pull` do cPanel e o `rsync`. Testar a segunda camada obriga, por
isso, a chegar a um pacote com `.htaccess` lá dentro: monta-se o pacote
com o `montar.sh` REAL (que o aceita, porque está limpo) e planta-se o
intruso no pacote já montado, exatamente como a realidade o faria.

É o mesmo molde de `test_integracao_pacote_deploy.py`: `montar.sh` real,
`deploy.sh` real, um `$HOME` de servidor falso, e nenhum dos dois scripts
importado — sempre por subprocesso.

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
DEPLOY_REAL = RAIZ_REPO / "deploy"
DEPLOY_SH = DEPLOY_REAL / "deploy.sh"

SHA_VALIDO = hashlib.sha1(
    b"commit de teste do test_deploy_sh_exclui_htaccess_em_profundidade.py"
).hexdigest()
assert len(SHA_VALIDO) == 40

#: O `.htaccess` a sério do servidor, mantido à mão fora deste repositório.
#: Nenhum deploy lhe pode tocar.
CONTEUDO_HTACCESS_DO_SERVIDOR = (
    "# .htaccess REAL do servidor, mantido à mão pelo Tomás.\n"
    "# Nenhum deploy pode tocar nestas linhas.\n"
    'Header always set X-Content-Type-Options "nosniff"\n'
)

#: O intruso: o que um build contaminado poria dentro do pacote.
CONTEUDO_HTACCESS_INTRUSO = (
    "# .htaccess que nunca devia ter entrado no pacote\n"
    "Options +ExecCGI\n"
    "AddHandler cgi-script .jpg\n"
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

_STUB_SILENCIOSO = """\
#!/usr/bin/env bash
exit 0
"""


def _escrever_stub(caminho: Path, conteudo: str) -> None:
    caminho.write_text(conteudo, encoding="utf-8")
    caminho.chmod(caminho.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def _construir_arvore_minima(tmp_path: Path) -> Path:
    """Árvore de trabalho fabricada (sem `.htaccess` nenhum) com o `deploy/` real copiado."""
    raiz = tmp_path / "trabalho"
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

    dist = raiz / "frontend" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><body>pacote de teste</body></html>\n", encoding="utf-8"
    )
    (dist / "assets" / "app.js").write_text("// fabricado\n", encoding="utf-8")

    shutil.copytree(DEPLOY_REAL, raiz / "deploy")
    return raiz


@dataclass
class Instalacao:
    home: Path
    api: Path
    origem: Path
    web: Path
    ambiente: dict[str, str]


def _preparar_servidor_falso(tmp_path: Path) -> Instalacao:
    """`$HOME` falso: API, WEB (com o `.htaccess` real do servidor e `media/`) e um virtualenv com stubs de `pip`/`alembic`."""
    home = tmp_path / "home"
    api = home / "tomazia_api"
    origem = home / "repositories" / "tomazia"
    web = home / "novo-dominio-exemplo"
    venv_bin = home / "virtualenv" / "tomazia_api" / "3.11" / "bin"

    for pasta in (api, web, venv_bin, home / "repositories"):
        pasta.mkdir(parents=True, exist_ok=True)

    (api / ".env").write_text(CONTEUDO_ENV_FALSO, encoding="utf-8")
    (web / ".htaccess").write_text(CONTEUDO_HTACCESS_DO_SERVIDOR, encoding="utf-8")
    (web / "media").mkdir()
    (web / "media" / "foto-aprovada.webp").write_bytes(b"conteudo-imagem-falso")

    _escrever_stub(venv_bin / "activate", CONTEUDO_ACTIVATE_FALSO)
    _escrever_stub(venv_bin / "pip", _STUB_SILENCIOSO)
    _escrever_stub(venv_bin / "alembic", _STUB_SILENCIOSO)

    (home / ".tomazia-deploy.conf").write_text(f"WEB={web}\n", encoding="utf-8")

    return Instalacao(
        home=home,
        api=api,
        origem=origem,
        web=web,
        ambiente={
            "HOME": str(home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
        },
    )


def _montar_pacote(raiz_trabalho: Path, instalacao: Instalacao) -> None:
    script = raiz_trabalho / "deploy" / "montar.sh"
    resultado = subprocess.run(
        [str(script), "--sha", SHA_VALIDO, "--saida", str(instalacao.origem)],
        cwd=raiz_trabalho,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert resultado.returncode == 0, (
        f"montar.sh falhou a montar o pacote limpo: {resultado.stderr}"
    )


def _correr_deploy(instalacao: Instalacao) -> subprocess.CompletedProcess[str]:
    if not DEPLOY_SH.is_file():
        pytest.fail(f"{DEPLOY_SH} não existe.")
    return subprocess.run(
        ["bash", str(DEPLOY_SH)],
        env=instalacao.ambiente,
        cwd=str(instalacao.home),
        capture_output=True,
        text=True,
        timeout=60,
    )


def _plantar(pacote: Path, caminho_relativo: str) -> Path:
    intruso = pacote / caminho_relativo
    intruso.parent.mkdir(parents=True, exist_ok=True)
    intruso.write_text(CONTEUDO_HTACCESS_INTRUSO, encoding="utf-8")
    return intruso


def test_htaccess_em_subpasta_do_build_nunca_chega_ao_web(tmp_path: Path) -> None:
    """O caso exato do achado: `dist/assets/.htaccess` passava por um `--exclude` ancorado em `/` e aterrava em `WEB/assets/.htaccess`."""
    raiz = _construir_arvore_minima(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)
    _montar_pacote(raiz, instalacao)

    dist_do_pacote = instalacao.origem / "frontend" / "dist"
    _plantar(dist_do_pacote, "assets/.htaccess")
    _plantar(dist_do_pacote, "assets/fundo/mais-fundo/.htaccess")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, (
        "deploy.sh tem de completar o deploy, deixando os .htaccess de fora — "
        "não é ele que recusa o pacote (isso é o montar.sh).\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )

    assert not (instalacao.web / "assets" / ".htaccess").exists(), (
        "Um '.htaccess' de uma subpasta do build chegou a WEB/assets/. O "
        "--exclude do rsync do frontend tem de ser '.htaccess' SEM âncora: "
        "com '/.htaccess' só o do topo fica de fora, e o Apache honra "
        "qualquer um, a qualquer profundidade."
    )
    assert not (
        instalacao.web / "assets" / "fundo" / "mais-fundo" / ".htaccess"
    ).exists(), "Um '.htaccess' fundo no build chegou ao WEB."

    assert (instalacao.web / "assets" / "app.js").is_file(), (
        "O resto do build tem de continuar a ser sincronizado — a exclusão é "
        "só do '.htaccess', não da pasta que o continha."
    )
    assert (instalacao.web / ".htaccess").read_text(
        encoding="utf-8"
    ) == CONTEUDO_HTACCESS_DO_SERVIDOR, (
        "O '.htaccess' real do servidor tem de ficar byte a byte igual."
    )


def test_htaccess_na_raiz_do_build_nao_substitui_o_do_servidor(
    tmp_path: Path,
) -> None:
    """A outra metade: o `.htaccess` do topo do build também não pode escrever por cima do que o Tomás mantém à mão no servidor."""
    raiz = _construir_arvore_minima(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)
    _montar_pacote(raiz, instalacao)

    _plantar(instalacao.origem / "frontend" / "dist", ".htaccess")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, (
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
    assert (instalacao.web / ".htaccess").read_text(
        encoding="utf-8"
    ) == CONTEUDO_HTACCESS_DO_SERVIDOR, (
        "O '.htaccess' do pacote escreveu por cima do '.htaccess' real do "
        "servidor. O do servidor é mantido à mão, fora deste repositório, e "
        "nenhum deploy lhe pode tocar."
    )
    assert (instalacao.web / "index.html").is_file(), (
        "O deploy tem de ter corrido mesmo — sem isto, o teste acima passaria "
        "num deploy que não sincronizou nada."
    )
