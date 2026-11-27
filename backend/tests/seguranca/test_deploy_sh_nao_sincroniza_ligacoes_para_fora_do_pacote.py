"""`deploy/deploy.sh` recusa um pacote com ligações simbólicas, antes de escrever o que quer que seja (terceira ronda da F1-04; refeito na F1-05, sem `rsync`).

## O achado

Uma ligação simbólica dentro do build —

    frontend/dist/logo.svg -> ../tomazia_api/.env

— aterrava no `WEB` como ligação e, a partir dali, o Apache do cPanel
seguia-a (`SymLinksIfOwnerMatch`) e servia por HTTP o conteúdo do ficheiro
para onde aponta, com um nome inocente e uma extensão que ninguém vai
inspecionar. O ficheiro nunca esteve no pacote: só o texto do destino, que
é um atributo da ligação, viajou.

Isto tem duas camadas. A primeira é `montar.sh`, que recusa o pacote
inteiro se encontrar uma ligação (ver
`test_montar_recusa_ligacoes_simbolicas.py`). Esta é a segunda, e corre no
servidor, sobre o que o `git pull --ff-only` da branch `deploy` deixou em
`$HOME/repositories/tomazia` — e o git guarda e restaura ligações
simbólicas sem drama nenhum (modo `120000`). Entre um e outro há uma
publicação, uma branch e um pull: o `deploy.sh` não pode assumir que o que
recebeu foi montado hoje, nem por este `montar.sh`.

## O que mudou na F1-05

A segunda camada era o `--safe-links` do `rsync`, que IGNORAVA em silêncio
as ligações que saíam da árvore e copiava o resto. O CageFS do cPanel não
tem `rsync`, e a sincronização passou a ser feita com `cp`/`mv`/`rm`. O
`cp` segue ligações; em vez de reproduzir "seguir só as boas", o
`deploy.sh` passou a recusar o pacote inteiro, com uma mensagem própria,
se houver QUALQUER ligação em `api/` ou em `frontend/dist/` — antes do pip,
antes de qualquer escrita. Um pacote com uma ligação não saiu do
`montar.sh` deste repositório, e um deploy que o aceitasse em parte só
escondia isso.

E a regra 10, outra vez: a procura é um `find`, e um `find` que falha
(uma pasta ilegível) não é "não há ligações". As duas recusas têm de
dizer coisas diferentes — é o último teste deste ficheiro.

## O mundo do teste

O pacote é montado a sério, com o `montar.sh` real, e a ligação é
plantada DEPOIS, já dentro do pacote montado — a simular exatamente o que
chega ao servidor, não o que sai do runner. Plantá-la antes só
exercitaria a primeira camada outra vez.

O alvo da ligação é um ficheiro do `$HOME` falso, fora do pacote, com
conteúdo claramente falso (regra 1 do `CLAUDE.md`). A ligação é escrita
como `../tomazia_api/<ficheiro>` de propósito: a partir do `WEB`
(`$HOME/novo-dominio-exemplo/`) esse caminho relativo resolve certinho
para o ficheiro — ou seja, se ela chegasse ao site, era mesmo servível, e
não uma ligação pendurada sem consequência.

Nunca se contacta o cPanel nem se lê a BD antiga (regras 1 e 3 do
`CLAUDE.md`): `HOME` falso em `tmp_path`, `pip` e `alembic` como stubs
registadores dentro do virtualenv falso.

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
from collections.abc import Iterator
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

#: O pedaço da mensagem que só a recusa por ligações encontradas diz.
MENSAGEM_LIGACOES = "o pacote tem ligações simbólicas"
#: O pedaço da mensagem que só a recusa por o `find` ter falhado diz.
MENSAGEM_FIND_FALHOU = "não consegui procurar ligações simbólicas"

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
printf 'EVENTO={nome} ARGS=%s\\n' "$*" >> "${{TOMAZIA_TESTE_LOG}}"
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
    log: Path
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
    (web / "index.html").write_text("<html>site no ar</html>\n", encoding="utf-8")

    _escrever_stub(venv_bin / "activate", CONTEUDO_ACTIVATE_FALSO)
    _escrever_stub(venv_bin / "pip", _STUB_REGISTADOR.format(nome="pip"))
    _escrever_stub(venv_bin / "alembic", _STUB_REGISTADOR.format(nome="alembic"))

    (home / ".tomazia-deploy.conf").write_text(f"WEB={web}\n", encoding="utf-8")

    log = tmp_path / "log-stubs.txt"
    return Instalacao(
        home=home,
        api=api,
        origem=origem,
        web=web,
        log=log,
        ambiente={
            "HOME": str(home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "TOMAZIA_TESTE_LOG": str(log),
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


def _mensagem(resultado: subprocess.CompletedProcess[str]) -> str:
    return resultado.stdout + resultado.stderr


def _instantaneo(pasta: Path) -> dict[str, bytes | str]:
    """Árvore inteira, ficheiros e ligações (sem as seguir), para comparar antes/depois."""
    resultado: dict[str, bytes | str] = {}
    for raiz, pastas, ficheiros in os.walk(pasta):
        for nome in [*pastas, *ficheiros]:
            caminho = Path(raiz) / nome
            relativo = caminho.relative_to(pasta).as_posix()
            if caminho.is_symlink():
                resultado[relativo] = f"-> {os.readlink(caminho)}"
            elif caminho.is_file():
                resultado[relativo] = caminho.read_bytes()
            else:
                resultado[relativo] = "<pasta>"
    return resultado


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


def _assert_recusado_sem_escrever(
    instalacao: Instalacao,
    resultado: subprocess.CompletedProcess[str],
    web_antes: dict[str, bytes | str],
) -> None:
    assert resultado.returncode != 0, (
        "Um pacote com uma ligação simbólica tem de ser recusado.\n"
        f"{_mensagem(resultado)}"
    )
    assert _instantaneo(instalacao.web) == web_antes, (
        "O WEB mudou apesar do deploy ter sido recusado — a recusa tem de "
        "vir antes de qualquer escrita."
    )
    log = instalacao.log.read_text(encoding="utf-8") if instalacao.log.is_file() else ""
    assert log == "", (
        f"O pip ou o alembic correram — a recusa chegou tarde demais:\n{log}"
    )
    assert not (instalacao.api / "app").exists(), (
        "O código da API foi sincronizado — a recusa chegou tarde demais."
    )
    assert not (instalacao.api / "tmp" / "restart.txt").exists()


@pytest.fixture
def instalacao_montada(tmp_path: Path) -> Iterator[Instalacao]:
    raiz = _construir_arvore_minima(tmp_path)
    instalacao = _preparar_servidor_falso(tmp_path)
    _montar_pacote(raiz, instalacao)
    yield instalacao


def test_uma_ligacao_que_sai_do_pacote_e_recusada_e_nunca_chega_ao_web(
    instalacao_montada: Instalacao,
) -> None:
    """O caso exato do achado: `dist/logo.svg -> ../tomazia_api/<ficheiro>` não pode aterrar no site."""
    instalacao = instalacao_montada
    ligacao = instalacao.origem / "frontend" / "dist" / NOME_DA_LIGACAO
    ligacao.symlink_to(DESTINO_DA_LIGACAO)
    assert ligacao.is_symlink(), "premissa do teste: foi criada mesmo uma ligação"

    # Premissa: se a ligação chegasse ao WEB, resolveria mesmo — o teste
    # não está a provar segurança com uma ligação pendurada inofensiva.
    assert (instalacao.web / DESTINO_DA_LIGACAO).resolve() == (
        instalacao.api / NOME_FICHEIRO_FORA_DO_PACOTE
    ).resolve()

    antes = _instantaneo(instalacao.web)
    resultado = _correr_deploy(instalacao)

    _assert_recusado_sem_escrever(instalacao, resultado, antes)
    assert MENSAGEM_LIGACOES in _mensagem(resultado), (
        "A recusa tem de dizer que encontrou ligações simbólicas — senão é "
        f"indistinguível de qualquer outra avaria:\n{_mensagem(resultado)}"
    )
    assert str(ligacao) in _mensagem(resultado), (
        "A recusa tem de dizer QUAL é a ligação, para o Tomás a ir ver."
    )

    caminho_no_web = instalacao.web / NOME_DA_LIGACAO
    assert not os.path.lexists(caminho_no_web), (
        f"A ligação chegou ao site como {caminho_no_web}. (`lexists` e não "
        "`exists`: uma ligação pendurada não 'existe', mas chegou na mesma.)"
    )
    assert CONTEUDO_FORA_DO_PACOTE not in _conteudos_servidos(instalacao.web).values()


@pytest.mark.parametrize(
    ("relativo", "destino"),
    [
        # Uma ligação "boa", que fica dentro do build. O `--safe-links`
        # deixava-a passar; agora recusa-se também: o `cp` segue ligações,
        # e o pacote do `montar.sh` nunca as tem.
        ("frontend/dist/atalho.js", "assets/app.js"),
        # Do lado da API: o código não é servido por HTTP, mas o `cp`
        # copiava o CONTEÚDO do destino para `tomazia_api/app/`.
        ("api/app/config_extra.py", "../../../../tomazia_api/.env"),
        # Uma pasta inteira como ligação.
        ("frontend/dist/imagens", "/"),
    ],
    ids=["interna_ao_build", "na_api", "pasta_para_a_raiz"],
)
def test_qualquer_ligacao_no_pacote_e_recusada(
    instalacao_montada: Instalacao, relativo: str, destino: str
) -> None:
    instalacao = instalacao_montada
    ligacao = instalacao.origem / relativo
    ligacao.symlink_to(destino)

    antes = _instantaneo(instalacao.web)
    resultado = _correr_deploy(instalacao)

    _assert_recusado_sem_escrever(instalacao, resultado, antes)
    assert MENSAGEM_LIGACOES in _mensagem(resultado), _mensagem(resultado)


def test_pacote_sem_ligacoes_e_aceite(instalacao_montada: Instalacao) -> None:
    """Controlo: o guarda não pode estar a recusar tudo. Sem isto, os testes acima passavam com um `deploy.sh` que recusasse sempre."""
    instalacao = instalacao_montada
    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, _mensagem(resultado)
    assert MENSAGEM_LIGACOES not in _mensagem(resultado)
    assert (instalacao.web / "index.html").read_text(encoding="utf-8") == (
        "<!doctype html><html><body>pacote de teste</body></html>\n"
    )
    assert (instalacao.web / "assets" / "app.js").is_file()
    assert (instalacao.web / "media" / "foto-aprovada.webp").is_file()


@pytest.mark.skipif(
    hasattr(os, "geteuid") and os.geteuid() == 0,
    reason="como root, uma pasta sem permissões continua legível e o find não falha",
)
def test_find_que_falha_nao_e_relatado_como_pacote_sem_ligacoes(
    instalacao_montada: Instalacao,
) -> None:
    """Regra 10: "não consegui procurar" nunca pode dar o mesmo que "não havia nada".

    Uma pasta ilegível no pacote faz o `find` falhar. Se o código de saída
    caísse num `if` sem ser lido, o deploy seguia como se não houvesse
    ligações — e a sincronização, a seguir, ou morria a meio ou tratava a
    pasta como vazia.
    """
    instalacao = instalacao_montada
    ilegivel = instalacao.origem / "frontend" / "dist" / "assets"
    antes = _instantaneo(instalacao.web)
    ilegivel.chmod(0)
    try:
        resultado = _correr_deploy(instalacao)
    finally:
        ilegivel.chmod(0o755)

    _assert_recusado_sem_escrever(instalacao, resultado, antes)
    assert MENSAGEM_FIND_FALHOU in _mensagem(resultado), _mensagem(resultado)
    assert MENSAGEM_LIGACOES not in _mensagem(resultado), (
        "O find falhou e a recusa disse que encontrou ligações — é outra "
        f"avaria, com outra mensagem:\n{_mensagem(resultado)}"
    )
