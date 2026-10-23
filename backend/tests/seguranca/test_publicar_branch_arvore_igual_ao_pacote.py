"""A árvore que `publicar-branch.sh` publica é, ficheiro a ficheiro, o pacote que acabou de ser auditado (ronda de segurança da F1-04).

## O achado

`publicar-branch.sh` construía a árvore do commit com

```bash
GIT_INDEX_FILE=... git --git-dir=... --work-tree="$pasta" -C "$pasta" add -A
```

e um `git add -A` respeita o `.gitignore`. Um `.gitignore` DENTRO do pacote
— `frontend/dist/.gitignore` com `*.js`, vindo de uma dependência de build
ou lá posto de propósito — fazia desaparecer ficheiros da árvore publicada
sem erro nenhum e sem uma linha de aviso. Provado num repositório de teste:
com esse `.gitignore`, a pasta auditada tinha `index.html` e
`assets/app.js`, e a árvore publicada ficou só com `.gitignore` e
`index.html`.

O resultado é o pior possível: audita-se uma coisa (os BYTES em disco, pelo
S-12/S-10) e publica-se outra (a árvore git, já amputada); o `deploy.sh` do
servidor sincroniza o que recebeu com `rsync --delete`, e o site desaparece
com a pipeline toda verde — o `esperar-versao.sh` continua a dar verde,
porque a API fica de pé.

A correção tem duas camadas, e este ficheiro prega as duas:

1. `add -A --force`, com `-c core.excludesFile=/dev/null`: nem um
   `.gitignore` do pacote nem um `.gitignore` global da máquina (que, num
   runner, nem sequer é nosso) podem tirar ficheiros da árvore.
2. Um guarda sobre o RESULTADO, não sobre a causa: lista os caminhos de
   `git ls-tree -r` e compara-os, como CONJUNTO, com os caminhos dos
   ficheiros do pacote; se divergirem, recusa publicar e diz quais
   divergem. É esta camada que interessa mais, porque o `.gitignore` não
   é o único caminho para uma árvore incompleta — um `.git` aninhado, um
   erro de permissões, um `add` que falhe a meio. O guarda não precisa de
   conhecer a causa: o que se publica tem de ser, caminho a caminho, o que
   se auditou.

## Conjuntos e não contagens (terceira ronda)

O guarda comparou contagens de linhas durante uma ronda, e trocou-se por
conjuntos. Vale a pena ser exato sobre o que isso corrigiu, porque a
primeira versão desta nota dizia o contrário e estava errada: **não havia
buraco nenhum**. O `find` imprime `N + E` linhas (E = newlines embutidos
em nomes de ficheiro) e o `git ls-tree` imprime `N - D` (D = ficheiros que
não entraram na árvore; os nomes com `\n` vinham citados, numa linha só).
Para as contagens baterem certo com um ficheiro em falta era preciso
`E + D = 0` — as duas distorções empurram para lados opostos, por isso o
erro de contagem só podia dar falso POSITIVO, nunca deixar passar um
ficheiro em falta.

O que a troca corrige, então:

- um pacote ÍNTEGRO com um nome com `\n` deixa de ser recusado (era o
  falso positivo) — `test_pacote_integro_com_um_nome_com_newline_e_publicado`;
- a recusa passa a dizer QUAL é o ficheiro que falta, em vez de dois
  números que não ajudam ninguém às duas da manhã.

O que a troca NÃO corrige, porque nunca esteve partido: um ficheiro fora
da árvore continua a ser recusado, com ou sem nomes esquisitos à mistura.
Esse é o teste central do guarda, e está parametrizado com as duas
situações exatamente para o deixar escrito.

`ls-tree -z | tr` desliga a citação do git: com ela, os dois lados partem
os nomes com `\n` da mesma maneira (duas entradas cada), e por isso um
pacote íntegro compara igual.

## O que NÃO está aqui, e porquê (para o Tomás)

Não há teste para a metade `-c core.excludesFile=/dev/null` isolada. Não é
descuido: `git add --force` ignora TODAS as fontes de exclusão, incluindo o
`core.excludesFile`, por isso um pacote que o `excludesFile` global
excluísse é publicado na mesma enquanto o `--force` lá estiver. Tirar só o
`core.excludesFile=/dev/null` não muda comportamento observável nenhum, e
um teste que fingisse prendê-lo passaria com a opção lá e sem ela. Ver o
relatório desta ronda.

## O mundo dos testes

Dois repositórios git dentro de `tmp_path`, como em
`tests/test_publicar_branch.py` e `tests/seguranca/test_publicar_branch_objeto_ausente.py`:
`bare` (`git init --bare`) faz de `origin`, e `repo_origem` faz do
"checkout do projeto" onde o workflow corre o script. Nunca se toca no
repositório real nem na branch `deploy` real. `GIT_CEILING_DIRECTORIES=tmp_path`
em todo o lado: mesmo correndo esta suite de dentro de um clone git, nenhuma
operação git destes testes consegue "subir" e encontrar esse repositório por
engano.

O script é sempre invocado por subprocesso, a partir do seu caminho real
dentro do checkout — nunca importado, nunca copiado — para encontrar
sozinho os ficheiros irmãos reais de que depende (o
`.github/scripts/verificar-ficheiros-proibidos.sh` do guarda S-12/S-10
interno).

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
SCRIPT = RAIZ_REPO / "deploy" / "publicar-branch.sh"


def _ambiente(tmp_path: Path) -> dict[str, str]:
    ambiente = os.environ.copy()
    ambiente["GIT_CEILING_DIRECTORIES"] = str(tmp_path)
    ambiente["GIT_TERMINAL_PROMPT"] = "0"
    return ambiente


def _git(repo: Path, tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Corre `git` com sucesso esperado (só para preparar o mundo do teste, nunca o script sob teste)."""
    resultado = subprocess.run(
        ["git", *args],
        cwd=repo,
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert resultado.returncode == 0, resultado.stderr
    return resultado


def _preparar_bare(tmp_path: Path) -> Path:
    bare = tmp_path / "origin.git"
    _git(tmp_path, tmp_path, "init", "--quiet", "--bare", str(bare))
    return bare


def _preparar_repo_origem(tmp_path: Path, bare: Path) -> Path:
    """Representa "o checkout do projeto": `origin` a apontar para `bare`."""
    repo = tmp_path / "origem"
    repo.mkdir()
    _git(repo, tmp_path, "init", "--quiet")
    _git(repo, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(repo, tmp_path, "config", "user.name", "QA Tomazia")
    _git(repo, tmp_path, "remote", "add", "origin", str(bare))
    return repo


def _commit_vazio(repo: Path, tmp_path: Path, mensagem: str) -> str:
    _git(repo, tmp_path, "commit", "--quiet", "--allow-empty", "-m", mensagem)
    return _git(repo, tmp_path, "rev-parse", "HEAD").stdout.strip()


def _correr_publicar(
    repo_origem: Path, tmp_path: Path, *, pasta: Path, sha: str
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(SCRIPT), "--pasta", str(pasta), "--sha", sha, "--branch", "deploy"],
        cwd=repo_origem,
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=30,
    )


def _rev_parse_no_bare(bare: Path, tmp_path: Path, ref: str) -> str | None:
    resultado = subprocess.run(
        ["git", "-C", str(bare), "rev-parse", "--verify", "--quiet", ref],
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=15,
    )
    if resultado.returncode != 0:
        return None
    return resultado.stdout.strip()


def _arvore_da_branch(bare: Path, tmp_path: Path, destino_nome: str) -> Path:
    """Clona a branch `deploy` do `bare` para um sítio novo, só para inspeção."""
    destino = tmp_path / destino_nome
    _git(
        tmp_path,
        tmp_path,
        "clone",
        "--quiet",
        "--branch",
        "deploy",
        str(bare),
        str(destino),
    )
    return destino


def _ficheiros_sem_git(pasta: Path) -> set[str]:
    return {
        caminho.relative_to(pasta).as_posix()
        for caminho in pasta.rglob("*")
        if caminho.is_file() and ".git" not in caminho.relative_to(pasta).parts
    }


def _escrever(pasta: Path, ficheiros: dict[str, str]) -> Path:
    pasta.mkdir(parents=True, exist_ok=True)
    for relativo, conteudo in ficheiros.items():
        caminho = pasta / relativo
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(conteudo, encoding="utf-8")
    return pasta


# --- 1. Um `.gitignore` dentro do pacote não pode amputar a publicação -----


def test_gitignore_dentro_do_pacote_nao_tira_ficheiros_da_arvore_publicada(
    tmp_path: Path,
) -> None:
    """O caso exato que foi reproduzido: `frontend/dist/.gitignore` com `*.js` fazia o bundle desaparecer da branch `deploy`.

    Sem `--force`, o `add -A` deixa `assets/app-a1b2c3.js` de fora; com o
    guarda de contagem a seguir, a publicação passa a ser recusada em vez de
    publicar uma árvore amputada — por isso este teste exige as duas coisas:
    sucesso E a árvore completa. Qualquer uma das duas a faltar derruba-o.
    """
    bare = _preparar_bare(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha = _commit_vazio(repo, tmp_path, "commit falso")

    pacote = _escrever(
        tmp_path / "pacote",
        {
            "api/VERSION": sha,
            # O intruso: um `.gitignore` que um build pode deixar dentro de
            # `dist/`. Nada no pacote o torna especial para o S-12/S-10 —
            # esses olham para nomes proibidos, não para regras de exclusão.
            "frontend/dist/.gitignore": "*.js\n",
            "frontend/dist/index.html": "<html>ementa</html>\n",
            "frontend/dist/assets/app-a1b2c3.js": "console.log('ementa')\n",
        },
    )

    resultado = _correr_publicar(repo, tmp_path, pasta=pacote, sha=sha)

    assert resultado.returncode == 0, (
        "A publicação tem de ter sucesso: um `.gitignore` dentro do pacote "
        "não é motivo para recusar, é motivo para o ignorar "
        f"(`add -A --force`).\nstderr:\n{resultado.stderr}"
    )

    publicado = _arvore_da_branch(bare, tmp_path, "conferencia")
    assert _ficheiros_sem_git(publicado) == _ficheiros_sem_git(pacote), (
        "A árvore publicada na branch 'deploy' não é a pasta auditada. Um "
        "`.gitignore` dentro do pacote tirou ficheiros do commit: o "
        "S-12/S-10 auditou os bytes em disco, mas o que foi publicado (e o "
        "que o `rsync --delete` do servidor vai espelhar) é outra coisa."
    )
    assert (publicado / "frontend" / "dist" / "assets" / "app-a1b2c3.js").read_text(
        encoding="utf-8"
    ) == "console.log('ementa')\n", (
        "O bundle do frontend chegou à branch 'deploy' com outro conteúdo."
    )


def test_a_contagem_de_ficheiros_publicados_bate_certo_com_a_do_pacote(
    tmp_path: Path,
) -> None:
    """A mesma garantia pelo outro lado: nenhum ficheiro do pacote fica para trás, nem aparece um a mais."""
    bare = _preparar_bare(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha = _commit_vazio(repo, tmp_path, "commit falso")

    pacote = _escrever(
        tmp_path / "pacote",
        {
            "api/VERSION": sha,
            "api/requirements.txt": "fastapi==0.0.0\n",
            "frontend/dist/.gitignore": "*.js\n*.css\nassets/\n",
            "frontend/dist/index.html": "<html>ementa</html>\n",
            "frontend/dist/assets/app-a1b2c3.js": "console.log(1)\n",
            "frontend/dist/assets/estilo-d4e5f6.css": "body{}\n",
        },
    )

    resultado = _correr_publicar(repo, tmp_path, pasta=pacote, sha=sha)
    assert resultado.returncode == 0, resultado.stderr

    publicado = _arvore_da_branch(bare, tmp_path, "conferencia")
    assert len(_ficheiros_sem_git(publicado)) == len(_ficheiros_sem_git(pacote)) == 6


# --- 2. O guarda do resultado: conjuntos de caminhos, não a causa ---------

#: Dois ficheiros que o `git add` nunca vai indexar, porque estão por
#: baixo de um componente `.git` — nem com `--force`, nem com aviso
#: nenhum. Em disco existem e foram auditados; na árvore do commit não
#: aparecem. É a causa mais limpa de reproduzir, e é exatamente por haver
#: várias (um erro de permissões, um `add` que falhe a meio) que o guarda
#: é sobre o RESULTADO.
FICHEIROS_QUE_NAO_ENTRAM_NA_ARVORE = {
    "frontend/dist/vendor/.git/HEAD": "ref: refs/heads/main\n",
    "frontend/dist/vendor/.git/config": "[core]\n\trepositoryformatversion = 0\n",
}

#: Um nome de ficheiro com um newline embutido. Não é teórico: o nome vem
#: do build, e um `\n` lá dentro é legal em qualquer sistema de ficheiros
#: POSIX. Aqui serve de "nome esquisito à mistura" — o caso em que contar
#: linhas dava números que não queriam dizer nada.
NOME_COM_NEWLINE = "frontend/dist/assets/app\nmalicioso.js"


@pytest.mark.parametrize(
    "com_nome_esquisito",
    [False, True],
    ids=["sem_nome_esquisito", "com_nome_com_newline"],
)
def test_recusa_publicar_quando_um_ficheiro_do_pacote_nao_entra_na_arvore(
    tmp_path: Path, com_nome_esquisito: bool
) -> None:
    """O teste central do guarda: o que foi auditado em disco tem de ser o que vai no commit.

    A publicação anterior, limpa, não é decoração: é ela que permite exigir
    que a branch `deploy` fique EXATAMENTE onde estava. "Recusou" sem "não
    mexeu em nada" não chega.

    A variante com um nome com `\n` existe para deixar escrito que o
    guarda não se desorienta com nomes esquisitos: um ficheiro a sair da
    árvore tem de ser recusado na mesma, com ou sem eles à mistura.
    """
    bare = _preparar_bare(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha_bom = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    sha_mau = _commit_vazio(repo, tmp_path, "segundo commit falso")

    pacote_bom = _escrever(
        tmp_path / "pacote-bom",
        {"api/VERSION": sha_bom, "frontend/dist/index.html": "<html>1</html>\n"},
    )
    primeira = _correr_publicar(repo, tmp_path, pasta=pacote_bom, sha=sha_bom)
    assert primeira.returncode == 0, primeira.stderr
    tip_publicado = _rev_parse_no_bare(bare, tmp_path, "deploy")
    assert tip_publicado is not None

    ficheiros = {
        "api/VERSION": sha_mau,
        "frontend/dist/index.html": "<html>2</html>\n",
        **FICHEIROS_QUE_NAO_ENTRAM_NA_ARVORE,
    }
    if com_nome_esquisito:
        ficheiros[NOME_COM_NEWLINE] = "console.log('nome esquisito')\n"
    pacote_mau = _escrever(tmp_path / "pacote-mau", ficheiros)

    segunda = _correr_publicar(repo, tmp_path, pasta=pacote_mau, sha=sha_mau)

    assert segunda.returncode != 0, (
        f"O pacote tem {len(ficheiros)} ficheiros em disco e dois deles não "
        "conseguem entrar na árvore git: publicar isto seria publicar uma "
        "árvore que não é a que foi auditada. Tinha de ser recusado.\n"
        f"stdout:\n{segunda.stdout}\nstderr:\n{segunda.stderr}"
    )
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") == tip_publicado, (
        "Uma publicação recusada não pode mexer na branch 'deploy': o "
        "servidor continuaria a puxar o que já lá estava."
    )

    # A recusa tem de ser a do guarda, e não um `git push` que falhou por
    # outra razão qualquer: a mensagem nomeia os ficheiros que ficaram de
    # fora. É esta a vantagem concreta de comparar conjuntos — dois números
    # diferentes não diziam QUAL.
    mensagem = segunda.stdout + segunda.stderr
    for caminho in FICHEIROS_QUE_NAO_ENTRAM_NA_ARVORE:
        assert caminho in mensagem, (
            f"A recusa não diz que {caminho!r} está no pacote e falta na "
            "árvore. Sem o nome do ficheiro, o guarda é indistinguível de "
            f"uma avaria qualquer do git:\n{mensagem}"
        )


def test_pacote_integro_com_um_nome_com_newline_e_publicado(tmp_path: Path) -> None:
    """O caso que a troca de contagens por conjuntos resolve de facto: um pacote íntegro não pode ser recusado por um nome esquisito.

    Com contagens, este pacote era recusado — falso positivo: o `find`
    contava duas linhas para o nome com `\n` e o `git ls-tree` contava uma
    (citada), e os números não batiam certo sem faltar ficheiro nenhum. Um
    deploy perfeitamente bom morria no último passo, com uma mensagem
    (`4 entradas` contra `5 ficheiros`) que não apontava para lado nenhum.

    `ls-tree -z | tr` desliga a citação: os dois lados passam a partir o
    nome da mesma maneira, e os conjuntos comparam iguais.
    """
    bare = _preparar_bare(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha = _commit_vazio(repo, tmp_path, "commit falso")

    pacote = _escrever(
        tmp_path / "pacote",
        {
            "api/VERSION": sha,
            "frontend/dist/index.html": "<html>ementa</html>\n",
            NOME_COM_NEWLINE: "console.log('nome esquisito')\n",
        },
    )

    resultado = _correr_publicar(repo, tmp_path, pasta=pacote, sha=sha)

    assert resultado.returncode == 0, (
        "Um pacote íntegro foi recusado por causa de um nome de ficheiro com "
        "um newline. O guarda compara o que vai ser publicado com o que foi "
        "auditado — e aqui são a mesma coisa; nenhum ficheiro ficou de fora "
        f"da árvore.\nstdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )

    publicado = _arvore_da_branch(bare, tmp_path, "conferencia")
    assert _ficheiros_sem_git(publicado) == _ficheiros_sem_git(pacote), (
        "A árvore publicada não é a pasta auditada."
    )
    assert NOME_COM_NEWLINE in _ficheiros_sem_git(publicado), (
        "O ficheiro com o nome esquisito tem de estar mesmo publicado, com o "
        "nome que tinha em disco — não basta a publicação ter saído 0."
    )


# --- 3. E quando não se consegue percorrer o pacote (regra 10) ------------

#: Um `find` de teste que falha a percorrer o pacote — exatamente como um
#: `find` real que tropeça numa subpasta sem permissão de leitura: nada em
#: stdout, a razão em stderr, estado 1. Qualquer outra invocação (não há
#: nenhuma neste script, mas isso é um detalhe dele, não deste stub) é
#: delegada no `find` verdadeiro.
STUB_FIND_QUE_FALHA = """\
#!/usr/bin/env bash
set -u

procura_do_pacote=0
for argumento in "$@"; do
  case "$argumento" in
    -print) procura_do_pacote=1 ;;
  esac
done

if [ "$procura_do_pacote" -eq 1 ]; then
  echo "find: './uma-subpasta-ilegivel': Permission denied" >&2
  exit 1
fi

exec "${TOMAZIA_TESTE_FIND_REAL}" "$@"
"""


def test_nao_conseguir_percorrer_o_pacote_aborta_a_publicacao(tmp_path: Path) -> None:
    """Regra 10: "o pacote não tem mais ficheiros" e "não consegui procurar" nunca podem dar o mesmo resultado.

    Sem o estado do `find` verificado à mão, uma procura que falhasse a
    meio devolvia uma lista curta (ou vazia) — e uma lista curta do lado do
    pacote faz o guarda concluir que está tudo bem, ou pior, que é a ÁRVORE
    que tem ficheiros a mais. O pacote seria publicado sem nunca ter sido
    percorrido por inteiro.

    A avaria injeta-se onde ela existe no mundo real, com um `find` de
    teste à frente no `PATH` — nunca com uma pasta sem permissões, que o
    `_escrever` deste ficheiro teria de criar e a que o próprio teste
    deixaria de conseguir aceder.
    """
    find_real = shutil.which("find")
    assert find_real is not None, "Não há 'find' nesta máquina de testes."

    bare = _preparar_bare(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha = _commit_vazio(repo, tmp_path, "commit falso")

    pacote = _escrever(
        tmp_path / "pacote",
        {"api/VERSION": sha, "frontend/dist/index.html": "<html>ementa</html>\n"},
    )

    pasta_stub = tmp_path / "bin-de-teste"
    pasta_stub.mkdir()
    stub = pasta_stub / "find"
    stub.write_text(STUB_FIND_QUE_FALHA, encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    ambiente = _ambiente(tmp_path)
    ambiente["PATH"] = f"{pasta_stub}{os.pathsep}{ambiente['PATH']}"
    ambiente["TOMAZIA_TESTE_FIND_REAL"] = find_real

    resultado = subprocess.run(
        [str(SCRIPT), "--pasta", str(pacote), "--sha", sha, "--branch", "deploy"],
        cwd=repo,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert resultado.returncode != 0, (
        "A procura pelos ficheiros do pacote falhou e a publicação seguiu em "
        "frente. Um pacote que não se conseguiu percorrer não pode ser dado "
        f"por igual à árvore.\nstdout:\n{resultado.stdout}"
    )
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") is None, (
        "A branch 'deploy' foi criada por uma publicação que abortou."
    )
    assert "Permission denied" in resultado.stderr, (
        "A razão da avaria (o stderr do próprio find) tem de chegar a quem "
        "corre o deploy — senão fica a saber que falhou, mas não porquê. "
        f"stderr foi:\n{resultado.stderr}"
    )
