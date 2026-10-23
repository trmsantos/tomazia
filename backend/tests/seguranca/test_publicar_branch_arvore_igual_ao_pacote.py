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
2. Um guarda sobre o RESULTADO, não sobre a causa: conta as entradas de
   `git ls-tree -r` e compara com a contagem de ficheiros do pacote; se
   divergirem, recusa publicar. É esta camada que interessa mais, porque o
   `.gitignore` não é o único caminho para uma árvore incompleta — um
   `.git` aninhado, um erro de permissões, um `add` que falhe a meio. O
   guarda não precisa de conhecer a causa: o que se publica tem de ser, em
   número de ficheiros, o que se auditou.

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
import re
import subprocess
from pathlib import Path

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


# --- 2. O guarda de contagem: o resultado, não a causa --------------------


def test_recusa_publicar_uma_arvore_com_menos_entradas_do_que_o_pacote(
    tmp_path: Path,
) -> None:
    """O guarda que apanha as causas que o `--force` não cobre.

    A causa usada aqui é uma das citadas no próprio script: um `.git`
    aninhado dentro do pacote. O `git add` nunca indexa nada por baixo de um
    componente `.git` — nem com `--force`, nem com aviso nenhum: esses
    ficheiros somem-se da árvore em silêncio, e o `--force` não lhes toca.
    É precisamente por isso que o guarda é sobre o RESULTADO (quantas
    entradas tem a árvore vs quantos ficheiros tem o pacote) e não sobre
    causas conhecidas.

    A publicação anterior, limpa, não é decoração: é ela que permite exigir
    que a branch `deploy` fique EXATAMENTE onde estava. "Recusou" sem "não
    mexeu em nada" não chega.
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

    pacote_mau = _escrever(
        tmp_path / "pacote-mau",
        {
            "api/VERSION": sha_mau,
            "frontend/dist/index.html": "<html>2</html>\n",
            # Dois ficheiros que o `git add` nunca vai indexar, porque estão
            # por baixo de um componente `.git`. Em disco existem e foram
            # auditados; na árvore do commit não aparecem.
            "frontend/dist/vendor/.git/HEAD": "ref: refs/heads/main\n",
            "frontend/dist/vendor/.git/config": "[core]\n\trepositoryformatversion = 0\n",
        },
    )

    segunda = _correr_publicar(repo, tmp_path, pasta=pacote_mau, sha=sha_mau)

    assert segunda.returncode != 0, (
        "O pacote tem 4 ficheiros em disco e a árvore git só consegue ter 2 "
        "entradas: publicar isto seria publicar uma árvore que não é a que "
        "foi auditada. Tinha de ser recusado.\n"
        f"stdout:\n{segunda.stdout}\nstderr:\n{segunda.stderr}"
    )
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") == tip_publicado, (
        "Uma publicação recusada não pode mexer na branch 'deploy': o "
        "servidor continuaria a puxar o que já lá estava."
    )

    # A recusa tem de ser a do guarda de contagem, e não um `git push` que
    # falhou por outra razão qualquer: a mensagem traz as DUAS contagens, e
    # elas têm de ser diferentes entre si.
    mensagem = segunda.stdout + segunda.stderr
    entradas = re.search(r"(\d+)\s+entradas", mensagem)
    ficheiros = re.search(r"(\d+)\s+ficheiros", mensagem)
    assert entradas is not None and ficheiros is not None, (
        "A recusa não diz quantas entradas tem a árvore nem quantos "
        "ficheiros tem o pacote — sem isso não dá para distinguir este "
        f"guarda de uma avaria qualquer do git:\n{mensagem}"
    )
    assert entradas.group(1) != ficheiros.group(1), (
        "A mensagem de recusa diz que a árvore e o pacote têm o mesmo número "
        f"de ficheiros — então não é esta a recusa esperada:\n{mensagem}"
    )
