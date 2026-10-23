"""O `rsync` do frontend de `deploy/deploy.sh` nunca leva para o site uma ligação que sai do pacote (terceira ronda da F1-04).

## O achado

`rsync -a` preserva ligações simbólicas tal e qual, e o Apache do cPanel
segue-as (`SymLinksIfOwnerMatch`). Uma ligação dentro do build —

    frontend/dist/logo.svg -> ../tomazia_api/.env

— aterrava no `WEB` como ligação e, a partir dali, o conteúdo do ficheiro
para onde aponta era servido por HTTP, com um nome inocente e uma extensão
que ninguém vai inspecionar. O ficheiro nunca esteve no pacote: só o texto
do destino, que é um atributo da ligação, viajou.

Isto tem duas camadas. A primeira é `montar.sh`, que recusa o pacote
inteiro se encontrar uma ligação (ver
`test_montar_recusa_ligacoes_simbolicas.py`). Esta é a segunda, e corre no
último sítio antes do site: `--safe-links` no `rsync` do frontend, que faz
o `rsync` ignorar qualquer ligação cujo destino saia da árvore que está a
copiar (aqui, `$ORIGEM/frontend/dist/`).

Duas camadas e não uma porque elas protegem de coisas diferentes. O
`montar.sh` corre no runner, sobre o pacote acabado de montar; o `rsync`
corre no servidor, sobre o que o `git pull --ff-only` da branch `deploy`
deixou em `$HOME/repositories/tomazia` — e o git guarda e restaura
ligações simbólicas sem drama nenhum (modo `120000`). Entre um e outro há
uma publicação, uma branch e um pull: o `deploy.sh` não pode assumir que o
que recebeu foi montado hoje, nem por este `montar.sh`.

## O mundo do teste

É por isso que o pacote aqui é montado a sério, com o `montar.sh` real, e
a ligação é plantada DEPOIS, já dentro do pacote montado — a simular
exatamente o que chega ao servidor, não o que sai do runner. Plantá-la
antes só exercitaria a primeira camada outra vez.

O alvo da ligação é um ficheiro do `$HOME` falso, fora do pacote, com
conteúdo claramente falso (regra 1 do `CLAUDE.md`). A ligação é escrita
como `../tomazia_api/<ficheiro>` de propósito: a partir do `WEB`
(`$HOME/novo-dominio-exemplo/`) esse caminho relativo resolve certinho
para o ficheiro — ou seja, se ela chegasse ao site, era mesmo servível, e
não uma ligação pendurada sem consequência. É isso que o teste quer poder
afirmar.

Nunca se contacta o cPanel nem se lê a BD antiga (regras 1 e 3 do
`CLAUDE.md`): `HOME` falso em `tmp_path`, `pip` e `alembic` como stubs
silenciosos dentro do virtualenv falso, `rsync` o real do sistema.

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
    b"commit de teste do test_deploy_sh_nao_sincroniza_ligacoes_para_fora_do_pacote.py"
).hexdigest()
assert len(SHA_VALIDO) == 40

#: Vive em `$HOME/tomazia_api/`, fora do pacote e fora do `WEB`. É o que a
#: ligação intrusa tenta expor.
NOME_FICHEIRO_FORA_DO_PACOTE = "configuracao-falsa.txt"
CONTEUDO_FORA_DO_PACOTE = (
    "SEGREDO_SESSAO=segredo-de-teste-nunca-usado-em-producao-abc123\n"
)

#: O nome com que a ligação se disfarça no site, e o destino relativo que,
#: a partir do `WEB`, resolve para o ficheiro acima.
NOME_DA_LIGACAO = "logo.svg"
DESTINO_DA_LIGACAO = f"../tomazia_api/{NOME_FICHEIRO_FORA_DO_PACOTE}"

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
    """Árvore de trabalho fabricada (sem ligação nenhuma) com o `deploy/` real copiado."""
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
    """`$HOME` falso: API (com o ficheiro que a ligação quer expor), WEB e um virtualenv com stubs."""
    home = tmp_path / "home"
    api = home / "tomazia_api"
    origem = home / "repositories" / "tomazia"
    web = home / "novo-dominio-exemplo"
    venv_bin = home / "virtualenv" / "tomazia_api" / "3.11" / "bin"

    for pasta in (api, web, venv_bin, home / "repositories"):
        pasta.mkdir(parents=True, exist_ok=True)

    (api / ".env").write_text(CONTEUDO_ENV_FALSO, encoding="utf-8")
    (api / NOME_FICHEIRO_FORA_DO_PACOTE).write_text(
        CONTEUDO_FORA_DO_PACOTE, encoding="utf-8"
    )

    (web / ".htaccess").write_text("# diretivas reais do servidor\n", encoding="utf-8")
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
        ambiente={"HOME": str(home), "PATH": "/usr/bin:/bin:/usr/local/bin"},
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


def _plantar_ligacao_no_pacote(instalacao: Instalacao) -> Path:
    """A ligação intrusa, posta no pacote JÁ montado — como um pacote que chega ao servidor pela branch `deploy`."""
    ligacao = instalacao.origem / "frontend" / "dist" / NOME_DA_LIGACAO
    ligacao.symlink_to(DESTINO_DA_LIGACAO)
    assert ligacao.is_symlink(), "premissa do teste: foi criada mesmo uma ligação"
    return ligacao


def _conteudos_servidos(web: Path) -> dict[str, str]:
    """O que o Apache conseguiria ler debaixo do `WEB`, ligações seguidas."""
    conteudos: dict[str, str] = {}
    for raiz, _pastas, ficheiros in os.walk(web, followlinks=True):
        for nome in ficheiros:
            caminho = Path(raiz) / nome
            try:
                conteudos[str(caminho.relative_to(web))] = caminho.read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError:
                # Ligação pendurada: não se lê, logo não se serve.
                continue
    return conteudos


def test_uma_ligacao_que_sai_do_pacote_nunca_chega_ao_web(tmp_path: Path) -> None:
    """O caso exato do achado: `dist/logo.svg -> ../tomazia_api/<ficheiro>` não pode aterrar no site."""
    raiz = _construir_arvore_minima(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)
    _montar_pacote(raiz, instalacao)
    _plantar_ligacao_no_pacote(instalacao)

    # Premissa: se a ligação chegasse ao WEB, resolveria mesmo — o teste
    # não está a provar segurança com uma ligação pendurada inofensiva.
    assert (instalacao.web / DESTINO_DA_LIGACAO).resolve() == (
        instalacao.api / NOME_FICHEIRO_FORA_DO_PACOTE
    ).resolve()

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, (
        "deploy.sh tem de completar o deploy, deixando a ligação de fora — "
        "quem recusa o pacote é o montar.sh, no runner.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )

    caminho_no_web = instalacao.web / NOME_DA_LIGACAO
    assert not os.path.lexists(caminho_no_web), (
        f"A ligação chegou ao site como {caminho_no_web}. O `rsync -a` do "
        "frontend precisa de `--safe-links`: sem isso copia a ligação tal e "
        "qual, o Apache segue-a (SymLinksIfOwnerMatch) e serve por HTTP o "
        "ficheiro que está do outro lado — que nunca esteve no pacote nem "
        "passou por guarda nenhum. (`lexists` e não `exists`: uma ligação "
        "pendurada não 'existe', mas chegou na mesma.)"
    )

    servidos = _conteudos_servidos(instalacao.web)
    assert CONTEUDO_FORA_DO_PACOTE not in servidos.values(), (
        "O conteúdo de um ficheiro de fora do pacote tornou-se legível "
        f"debaixo do WEB. Entradas vistas: {sorted(servidos)!r}"
    )


def test_o_resto_do_build_chega_ao_web_na_mesma(tmp_path: Path) -> None:
    """A outra metade: `--safe-links` deixa de fora a ligação, nunca o build.

    Sem isto, um `rsync` que falhasse (ou que não copiasse nada) passava no
    teste acima com distinção — e o site ficava vazio.
    """
    raiz = _construir_arvore_minima(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)
    _montar_pacote(raiz, instalacao)
    _plantar_ligacao_no_pacote(instalacao)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, (
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
    assert (instalacao.web / "index.html").read_text(encoding="utf-8") == (
        "<!doctype html><html><body>pacote de teste</body></html>\n"
    ), (
        "O `index.html` do pacote não chegou ao site. A ligação intrusa fica "
        "de fora; o resto do build tem de passar na mesma."
    )
    assert (instalacao.web / "assets" / "app.js").is_file(), (
        "O resto do build tem de ser sincronizado — a exclusão é só da "
        "ligação, não da pasta que a continha."
    )
    assert (instalacao.web / "media" / "foto-aprovada.webp").is_file(), (
        "A pasta media/ do servidor tem de sobreviver ao deploy."
    )
