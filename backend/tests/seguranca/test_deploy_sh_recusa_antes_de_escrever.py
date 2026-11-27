"""Três guardas de `deploy/deploy.sh` que recusam ANTES de escrever (ronda de segurança da F1-04).

Os três achados são independentes uns dos outros, mas vivem no mesmo
ficheiro porque exigem exatamente o mesmo mundo: uma instalação de servidor
falsa, completa e válida, em que só a coisa testada está errada. Construir
esse mundo três vezes só multiplicava a cópia (já existem outras em
`tests/seguranca/test_deploy_sh.py` e
`tests/seguranca/test_deploy_sh_exclui_htaccess_em_profundidade.py`).

## Achado 1 — o `rsync --delete` do frontend não tinha precondição nenhuma

De todos os `rsync --delete` do script, o do frontend era o único cujo lado
da ORIGEM não era verificado: o do `api/` tem o `VERSION` validado mesmo
acima. Com `$ORIGEM/frontend/dist/` presente mas sem `index.html` (um
`.gitignore` dentro do pacote a amputar o commit publicado — ver
`test_publicar_branch_arvore_igual_ao_pacote.py` —, um `montar.sh` futuro
com um erro, um `git pull` parcial no servidor), o `--delete` espelhava uma
pasta vazia ou incompleta sobre o `WEB`: apagava `index.html` e `assets/`
do site em produção. E o deploy continuava, saía 0, e o
`esperar-versao.sh` dava verde — porque a API fica de pé na mesma. Site em
baixo, pipeline toda verde.

Por isso os testes exigem as duas metades, e a segunda é a que interessa:
não basta recusar, tem de recusar sem ter escrito nada. A árvore do `WEB` é
fotografada byte a byte antes e depois.

## Achado 2 — o `realpath` sem rede (regra 10, com consequência destrutiva)

A linha era

```bash
web_real=$(realpath "$web_bruto" 2>/dev/null) || web_real="$web_bruto"
```

e isso trata "não consegui resolver este caminho" como "resolve para si
próprio" — a regra 10 do `CLAUDE.md` da raiz, na variante mais cara:
`"$home_real"/*`, no `case` logo a seguir, tem um `*` que casa com barras,
portanto um `WEB` como `$HOME/../../tmp/fora` passava o guarda do `$HOME`
intacto, com os `..` por resolver.

O teste que já existia (`test_web_fora_do_home_recusado`, em
`test_deploy_sh.py`) não apanhava isto porque usa um caminho EXISTENTE: aí
o `realpath` corre bem, normaliza os `..`, e o guarda do `$HOME` faz o seu
trabalho. O caso que escapava precisa de um `WEB` que **não exista**.

### O que é observável, e o que não é (lido com atenção, para o Tomás)

Com o fallback reposto, este deploy continua a ser recusado — mas pelo
guarda errado: o `[ ! -f "$WEB/.htaccess" ]`, poucas linhas abaixo, falha
porque o caminho não existe, e o operador recebe "WEB não tem .htaccess"
quando o que de facto aconteceu foi "não consegui resolver o WEB". É
precisamente a confusão que a regra 10 proíbe, e é o que estes testes
prendem: a MENSAGEM.

Não se consegue construir, por um teste honesto, o cenário em que o
fallback deixa mesmo o `rsync --delete` escrever fora do `$HOME`: para
chegar ao `rsync`, `$WEB/.htaccess` e `$WEB/media` têm de ser alcançáveis
através do caminho por resolver, e se o são então o `realpath` também teria
conseguido resolvê-lo (o kernel resolve os `..` da mesma maneira nos dois
sítios) — e aí é o guarda do `$HOME` que o apanha, com ou sem fallback. Por
isso nenhum teste aqui finge provar a escrita fora do `$HOME`: provam a
recusa, a ausência de escrita, e que as duas avarias se distinguem uma da
outra. Ver o relatório desta ronda.

## Achado 3 — a mesma precondição em falta, do lado do `api/`

Simétrico do achado 1, e encontrado por causa dele: o `rsync --delete` que
espelha `$ORIGEM/api/app/` sobre `$API/app/` também não olhava para o lado
da origem. O `VERSION`, validado mesmo acima no script, prova que o pacote
foi montado — nunca que o `app/` lá dentro traz alguma coisa. Com um
`api/app/` presente mas vazio, o `--delete` limpava o `$API/app`.

A diferença em relação ao achado 1 é o que acontece a seguir, e é o que
torna o estrago mais difícil de ver: o deploy abortava no `alembic`, antes
do `touch tmp/restart.txt`, por isso o Passenger nunca reiniciava e a app
velha continuava a servir — de memória. O site ficava de pé, o disco
ficava destruído, e o deploy seguinte partia de nada. Por isso os testes
afirmam as duas metades: recusar, e não ter escrito nada.

## O mundo dos testes

`HOME` falso dentro de `tmp_path`, `pip` e `alembic` como stubs
registadores dentro do virtualenv falso (nunca tocam numa rede nem
instalam nada), `cp`, `mv`, `rm` e `mkdir` os reais do sistema. Nunca
se contacta o cPanel nem se lê a BD antiga (regras 1 e 3 do `CLAUDE.md`). A forma de `$ORIGEM` é a
que `deploy/montar.sh` produz de facto — o código dentro de `api/`, os
estáticos dentro de `frontend/dist/`; a prova de que é mesmo essa é
`tests/seguranca/test_integracao_pacote_deploy.py`, que corre os dois
scripts reais um a seguir ao outro, nunca este ficheiro.

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import os
import shutil
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

_STUB_REGISTADOR = """\
#!/usr/bin/env bash
printf 'EVENTO={nome} ARGS=%s\\n' "$*" >> "${{TOMAZIA_TESTE_LOG_{nome_maiusculas}}}"
exit 0
"""

MARCADOR_VELHO = "marcador-velho-ja-no-servidor.txt"
MARCADOR_NOVO = "marcador-novo-no-pacote.txt"


def _escrever_stub(caminho: Path, conteudo: str) -> None:
    caminho.write_text(conteudo, encoding="utf-8")
    caminho.chmod(caminho.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


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


def _preparar_instalacao_valida(raiz: Path) -> Instalacao:
    """Uma instalação falsa completa e VÁLIDA: a partir daqui, cada teste estraga só o que quer testar."""
    home = raiz / "home"
    api = home / "tomazia_api"
    origem = home / "repositories" / "tomazia"
    web = home / "novo-dominio-exemplo"
    venv_bin = home / "virtualenv" / "tomazia_api" / "3.11" / "bin"

    for pasta in (api, origem, web, venv_bin):
        pasta.mkdir(parents=True, exist_ok=True)

    # API: o que já lá está, de uma instalação anterior.
    (api / ".env").write_text(CONTEUDO_ENV_FALSO, encoding="utf-8")
    (api / "app").mkdir()
    (api / "app" / MARCADOR_VELHO).write_text("velho\n", encoding="utf-8")

    # ORIGEM: o pacote montado, com a forma que `deploy/montar.sh` escreve.
    (origem / "api" / "app").mkdir(parents=True)
    (origem / "api" / "app" / MARCADOR_NOVO).write_text("novo\n", encoding="utf-8")
    # `api/app/main.py`: precondição do script (achado 3, abaixo). Numa
    # instalação VÁLIDA tem de lá estar — senão os testes dos achados 1 e 2
    # passariam por esta recusa, e não pela que dizem exercitar.
    (origem / "api" / "app" / "main.py").write_text(
        "# aplicacao falsa\n", encoding="utf-8"
    )
    (origem / "api" / "migrations").mkdir()
    (origem / "api" / "migrations" / "env.py").write_text(
        "# migrations falsas\n", encoding="utf-8"
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
    (origem / "frontend" / "dist" / "assets").mkdir(parents=True)
    (origem / "frontend" / "dist" / "index.html").write_text(
        "<html>novo</html>\n", encoding="utf-8"
    )
    (origem / "frontend" / "dist" / "assets" / "novo-cd34.js").write_text(
        "console.log('novo')\n", encoding="utf-8"
    )

    # WEB: o site que já está no ar e que um deploy recusado nunca pode tocar.
    (web / ".htaccess").write_text("# diretivas reais do servidor\n", encoding="utf-8")
    (web / "media").mkdir()
    (web / "media" / "foto-aprovada.webp").write_bytes(b"conteudo-imagem-falso")
    (web / ".well-known").mkdir()
    (web / ".well-known" / "verificacao.txt").write_text(
        "verificacao\n", encoding="utf-8"
    )
    (web / "index.html").write_text("<html>site no ar</html>\n", encoding="utf-8")
    (web / "assets").mkdir()
    (web / "assets" / "velho-ab12.js").write_text(
        "console.log('velho')\n", encoding="utf-8"
    )

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

    log_pip = raiz / "log-pip.txt"
    log_alembic = raiz / "log-alembic.txt"

    return Instalacao(
        home=home,
        api=api,
        origem=origem,
        web=web,
        config=config,
        log_pip=log_pip,
        log_alembic=log_alembic,
        ambiente={
            "HOME": str(home),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "TOMAZIA_TESTE_LOG_PIP": str(log_pip),
            "TOMAZIA_TESTE_LOG_ALEMBIC": str(log_alembic),
        },
    )


def _correr_deploy(instalacao: Instalacao) -> subprocess.CompletedProcess[str]:
    if not CAMINHO_SCRIPT.is_file():
        pytest.fail(f"{CAMINHO_SCRIPT} não existe.")
    return subprocess.run(
        ["bash", str(CAMINHO_SCRIPT)],
        env=dict(instalacao.ambiente),
        cwd=str(instalacao.home),
        capture_output=True,
        text=True,
        timeout=30,
    )


def _mensagem(resultado: subprocess.CompletedProcess[str]) -> str:
    return resultado.stdout + resultado.stderr


def _ler_log(caminho: Path) -> str:
    return caminho.read_text(encoding="utf-8") if caminho.is_file() else ""


def _instantaneo(pasta: Path) -> dict[str, bytes]:
    """Conteúdo de uma árvore, ficheiro a ficheiro (ocultos incluídos), para comparar antes/depois."""
    return {
        caminho.relative_to(pasta).as_posix(): caminho.read_bytes()
        for caminho in sorted(pasta.rglob("*"))
        if caminho.is_file()
    }


def _assert_nada_escrito(
    instalacao: Instalacao, antes_do_web: dict[str, bytes]
) -> None:
    """Nada mudou no servidor: nem o site, nem o código da API, nem o sinal de reinício."""
    assert _instantaneo(instalacao.web) == antes_do_web, (
        "O WEB mudou apesar do deploy ter sido recusado. É exatamente este o "
        "estrago: o `rsync --delete` do frontend espelha a origem, e uma "
        "origem incompleta apaga o site em produção."
    )
    assert _ler_log(instalacao.log_pip) == "", (
        "O pip foi chamado — a recusa tem de acontecer antes de qualquer escrita."
    )
    assert _ler_log(instalacao.log_alembic) == "", (
        "O alembic foi chamado — a recusa tem de acontecer antes de qualquer escrita."
    )
    assert not (instalacao.api / "tmp" / "restart.txt").exists(), (
        "tmp/restart.txt existe: o Passenger ia reiniciar por cima de um "
        "deploy que nem chegou a correr."
    )
    assert (instalacao.api / "app" / MARCADOR_VELHO).exists(), (
        "O código antigo da API desapareceu — a sincronização do código chegou a correr."
    )
    assert not (instalacao.api / "app" / MARCADOR_NOVO).exists(), (
        "O código novo foi sincronizado — a recusa chegou tarde demais."
    )


# --- Achado 1: precondição do frontend ------------------------------------

#: Como é que um `frontend/dist/` pode chegar ao servidor sem `index.html`.
#: Os dois estados são igualmente destrutivos para um `rsync --delete`.
ESTADOS_SEM_INDEX = {
    "so_assets": ["assets/novo-cd34.js"],
    "vazio": [],
}


@pytest.mark.parametrize(
    "estado", sorted(ESTADOS_SEM_INDEX), ids=sorted(ESTADOS_SEM_INDEX)
)
def test_frontend_do_pacote_sem_index_html_e_recusado(
    tmp_path: Path, estado: str
) -> None:
    """Sem `index.html` na origem, o `rsync --delete` apagaria o site — e o deploy saía 0, com o esperar-versao.sh verde."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    dist = instalacao.origem / "frontend" / "dist"
    shutil.rmtree(dist)
    dist.mkdir(parents=True)
    for relativo in ESTADOS_SEM_INDEX[estado]:
        caminho = dist / relativo
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text("console.log('novo')\n", encoding="utf-8")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0, (
        "Um pacote com frontend/dist/ sem index.html tem de ser recusado: "
        "sincronizá-lo com --delete apaga o site em produção, e o deploy "
        f"acabaria verde na mesma.\n{_mensagem(resultado)}"
    )


@pytest.mark.parametrize(
    "estado", sorted(ESTADOS_SEM_INDEX), ids=sorted(ESTADOS_SEM_INDEX)
)
def test_frontend_do_pacote_sem_index_html_nao_escreve_nada(
    tmp_path: Path, estado: str
) -> None:
    """A metade que interessa: recusar tarde (depois do rsync) seria tão mau como não recusar."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    dist = instalacao.origem / "frontend" / "dist"
    shutil.rmtree(dist)
    dist.mkdir(parents=True)
    for relativo in ESTADOS_SEM_INDEX[estado]:
        caminho = dist / relativo
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text("console.log('novo')\n", encoding="utf-8")

    antes = _instantaneo(instalacao.web)
    assert "index.html" in antes and "assets/velho-ab12.js" in antes, (
        "premissa do teste: o site tem de estar no ar antes do deploy"
    )

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0, _mensagem(resultado)
    _assert_nada_escrito(instalacao, antes)


# --- Achado 2: o `realpath` sem rede (regra 10) ----------------------------


def _apontar_web_para(instalacao: Instalacao, caminho: str) -> None:
    instalacao.config.write_text(f"WEB={caminho}\n", encoding="utf-8")


def _web_inexistente_que_sai_do_home(instalacao: Instalacao) -> str:
    """Um `WEB` com `..` a sair do `$HOME`, para um sítio que não existe.

    Construído a partir do `$HOME` já RESOLVIDO (nunca do caminho tal como
    foi dado): é assim que o prefixo bate certo, letra a letra, com o
    `"$home_real"/*` do `case` do script — que é precisamente o guarda que
    o fallback antigo deixava passar. Com um prefixo não resolvido, o
    `case` falharia por outra razão e o teste deixava de exercitar o que diz
    exercitar.
    """
    home_resolvido = os.path.realpath(instalacao.home)
    return f"{home_resolvido}/../../fora-do-home-tomazia/web-que-nunca-existiu"


def test_web_que_nao_se_consegue_resolver_e_recusado_sem_escrever_nada(
    tmp_path: Path,
) -> None:
    """Recusa, não escreve nada, e diz a verdade sobre o que aconteceu: não conseguiu resolver o caminho."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    web_bruto = _web_inexistente_que_sai_do_home(instalacao)
    _apontar_web_para(instalacao, web_bruto)

    destino_real = Path(os.path.normpath(web_bruto))
    assert not destino_real.exists(), (
        "premissa do teste: o caminho de destino não pode existir"
    )
    antes = _instantaneo(instalacao.web)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0, _mensagem(resultado)
    _assert_nada_escrito(instalacao, antes)
    assert not destino_real.exists(), (
        f"O deploy criou {destino_real} — escreveu fora do $HOME."
    )

    mensagem = _mensagem(resultado)
    assert "não consegui resolver" in mensagem, (
        "O `realpath` falhou, e é isso que a recusa tem de dizer. Com o "
        'fallback antigo (`|| web_real="$web_bruto"`), o caminho por '
        "resolver passava o guarda do $HOME intacto — os `..` ficavam lá, e "
        'o `*` do padrão `"$home_real"/*` casa com barras — e a recusa '
        "acabava por vir do guarda do .htaccess, a dizer uma coisa "
        f'("o WEB não tem .htaccess") por outra:\n{mensagem}'
    )
    assert ".htaccess" not in mensagem, (
        "A recusa veio do guarda do .htaccess, não do `realpath`: isso é "
        "relatar 'não consegui resolver o caminho' como 'o caminho não tem "
        f".htaccess' — regra 10, a confundir avaria com resposta.\n{mensagem}"
    )


def test_nao_conseguir_resolver_o_web_e_o_web_estar_fora_do_home_dizem_coisas_diferentes(
    tmp_path: Path,
) -> None:
    """Regra 10: "este WEB fica fora do \\$HOME" é uma resposta; "não consegui resolver este WEB" é uma avaria. Nunca a mesma mensagem."""
    instalacao_irresoluvel = _preparar_instalacao_valida(tmp_path / "irresoluvel")
    _apontar_web_para(
        instalacao_irresoluvel,
        _web_inexistente_que_sai_do_home(instalacao_irresoluvel),
    )
    resultado_irresoluvel = _correr_deploy(instalacao_irresoluvel)

    instalacao_fora = _preparar_instalacao_valida(tmp_path / "fora")
    web_fora = tmp_path / "fora-do-home" / "web"
    (web_fora / "media").mkdir(parents=True)
    (web_fora / ".htaccess").write_text("# outro sítio\n", encoding="utf-8")
    _apontar_web_para(instalacao_fora, str(web_fora))
    resultado_fora = _correr_deploy(instalacao_fora)

    assert resultado_irresoluvel.returncode != 0
    assert resultado_fora.returncode != 0
    assert not (web_fora / "index.html").exists(), (
        "O deploy sincronizou para um WEB fora do $HOME."
    )

    assert "não consegui resolver" in _mensagem(resultado_irresoluvel), (
        "Um WEB que o `realpath` não consegue resolver tem de ser recusado "
        "por isso mesmo, e não por nenhum guarda posterior:\n"
        f"{_mensagem(resultado_irresoluvel)}"
    )
    assert "dentro de" in _mensagem(resultado_fora), (
        "Um WEB que resolve para fora do $HOME tem de ser recusado por esse "
        f"guarda:\n{_mensagem(resultado_fora)}"
    )
    assert "não consegui resolver" not in _mensagem(resultado_fora), (
        "Um WEB que se resolveu bem (só está no sítio errado) não pode ser "
        "relatado como um caminho irresolúvel — são avarias diferentes."
    )


# --- Achado 3: precondição da app, do lado do `api/` -----------------------

#: Como é que um `api/app/` pode chegar ao servidor sem a app lá dentro.
#: Simétrico do `ESTADOS_SEM_INDEX` acima, e igualmente destrutivo para o
#: `rsync --delete` que espelha `$ORIGEM/api/app/` sobre `$API/app/`.
ESTADOS_SEM_MAIN = {
    "so_outro_ficheiro": [MARCADOR_NOVO],
    "vazio": [],
}


@pytest.mark.parametrize(
    "estado", sorted(ESTADOS_SEM_MAIN), ids=sorted(ESTADOS_SEM_MAIN)
)
def test_app_do_pacote_sem_main_py_e_recusada(tmp_path: Path, estado: str) -> None:
    """Sem `api/app/main.py` na origem, o `rsync --delete` esvaziava o `$API/app`.

    O `VERSION`, validado mesmo acima no script, prova que o pacote foi
    montado — nunca que o `app/` lá dentro traz alguma coisa. Esta é a
    mesma rede do `index.html`, do lado do `api/`.
    """
    instalacao = _preparar_instalacao_valida(tmp_path)
    app_do_pacote = instalacao.origem / "api" / "app"
    shutil.rmtree(app_do_pacote)
    app_do_pacote.mkdir(parents=True)
    for relativo in ESTADOS_SEM_MAIN[estado]:
        (app_do_pacote / relativo).write_text("novo\n", encoding="utf-8")

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0, (
        "Um pacote com api/app/ sem main.py tem de ser recusado: "
        "sincronizá-lo com --delete apaga o código da app em produção.\n"
        f"{_mensagem(resultado)}"
    )
    assert "main.py" in _mensagem(resultado), (
        "A recusa tem de dizer o que falta no pacote — senão é "
        "indistinguível de uma avaria qualquer do script:\n"
        f"{_mensagem(resultado)}"
    )


@pytest.mark.parametrize(
    "estado", sorted(ESTADOS_SEM_MAIN), ids=sorted(ESTADOS_SEM_MAIN)
)
def test_app_do_pacote_sem_main_py_nao_escreve_nada(
    tmp_path: Path, estado: str
) -> None:
    """A metade que interessa: recusar depois do `rsync` deixava o disco destruído.

    O deploy abortaria a seguir no alembic, antes do `restart.txt` — por
    isso a app velha continuava a servir, de memória —, mas o `$API/app`
    em disco já tinha ficado vazio, e o deploy seguinte partia de nada.
    """
    instalacao = _preparar_instalacao_valida(tmp_path)
    app_do_pacote = instalacao.origem / "api" / "app"
    shutil.rmtree(app_do_pacote)
    app_do_pacote.mkdir(parents=True)
    for relativo in ESTADOS_SEM_MAIN[estado]:
        (app_do_pacote / relativo).write_text("novo\n", encoding="utf-8")

    antes = _instantaneo(instalacao.web)
    assert (instalacao.api / "app" / MARCADOR_VELHO).is_file(), (
        "premissa do teste: a app antiga tem de estar em disco antes do deploy"
    )

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0, _mensagem(resultado)
    _assert_nada_escrito(instalacao, antes)
    assert (instalacao.api / "app" / MARCADOR_VELHO).read_text(
        encoding="utf-8"
    ) == "velho\n", (
        "O código antigo da API foi apagado por um deploy que acabou "
        "recusado. É exatamente este o estrago: o `rsync --delete` espelha "
        "`$ORIGEM/api/app/` sobre `$API/app/`, e uma origem vazia esvazia o "
        "destino."
    )
