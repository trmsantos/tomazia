"""`deploy/publicar-branch.sh`: o guarda anti-retrocesso quando o objeto do `--sha` não existe localmente (regra 10 do `CLAUDE.md`).

## O defeito apontado pelo revisor-codigo

O guarda anti-retrocesso de `publicar-branch.sh` decide se `--sha` é um
retrocesso assim:

```bash
if git merge-base --is-ancestor "$sha" "$sha_anterior"; then
  echo "Erro: ... recuso publicar um retrocesso." >&2
  exit 1
fi
```

`git merge-base --is-ancestor` tem TRÊS saídas possíveis, nunca duas
(`git-merge-base(1)`): `0` ("$sha" é antepassado), `1` ("$sha" não é
antepassado) — e, quando um dos dois objetos não existe no repositório
local, **`128`**, com "fatal: Not a valid commit name ..." em stderr. Um
`if` normal do bash só distingue "zero" de "não-zero": lê tanto `1` como
`128` como "falso", e o script segue em frente como se tivesse confirmado
que não é um retrocesso — quando na verdade nunca conseguiu verificar nada.
É a regra 10 do `CLAUDE.md` da raiz ("'não encontrei' e 'não consegui
procurar' nunca podem dar o mesmo resultado") na sua sétima instância
conhecida neste projeto (ver o commit "docs: regra 10, um guarda tem de
distinguir vazio de avaria").

A consequência é grave precisamente porque acontece no guarda desenhado
para proteger contra o cenário mais perigoso: alguém (ou algo) passa um
`--sha` que não corresponde a nenhum commit conhecido localmente — por
exemplo um `repo_origem` raso, mal sincronizado, ou um SHA transcrito à
mão — e o "retrocesso" é publicado em silêncio, exatamente o que este
guarda existe para impedir.

## Como se fabrica "o objeto não está disponível", sem mentir sobre o SHA

Para provar isto a sério, o `--sha` usado tem de ser SINTATICAMENTE válido
(40 hexadecimais) e corresponder a um commit git REAL — nunca uma string
inventada à mão, que já seria recusada por `[[ "$sha" =~ ^[0-9a-f]{40}$ ]]`
ou por outras razões antes sequer de chegar ao `merge-base`. A forma mais
simples e honesta de ter um SHA real mas ausente é criar um commit num
repositório git completamente à parte (nunca relacionado, por fetch ou
remoto, com `repo_origem`/`bare` usados neste teste) e usar o SHA desse
commit: o objeto existe a sério nalgum lado, mas nunca chega às entranhas
de `repo_origem`, que é onde `publicar-branch.sh` corre.

Reusa o mesmo desenho de `tests/test_publicar_branch.py` (dois
repositórios git, `bare` como remoto e `repo_origem` como o "checkout do
projeto"), com `GIT_CEILING_DIRECTORIES=tmp_path` em todo o lado, pela
mesma razão (nenhuma operação git consegue "subir" e encontrar o
repositório real do projeto por engano).
"""

from __future__ import annotations

import os
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
    """Corre `git` com sucesso esperado (usado só para preparar o mundo do teste, nunca para o script sob teste)."""
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


def _preparar_bare_com_main(tmp_path: Path) -> tuple[Path, str]:
    """`git init --bare`, com uma branch `main` semeada a partir de um clone descartável — nunca o repositório real."""
    bare = tmp_path / "origin.git"
    _git(tmp_path, tmp_path, "init", "--quiet", "--bare", str(bare))

    semente = tmp_path / "semente"
    semente.mkdir()
    _git(semente, tmp_path, "init", "--quiet")
    _git(semente, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(semente, tmp_path, "config", "user.name", "QA Tomazia")
    _git(semente, tmp_path, "checkout", "--quiet", "-b", "main")
    _git(
        semente, tmp_path, "commit", "--quiet", "--allow-empty", "-m", "inicial, falso"
    )
    _git(semente, tmp_path, "remote", "add", "origin", str(bare))
    _git(semente, tmp_path, "push", "--quiet", "origin", "main")
    sha_main = _git(semente, tmp_path, "rev-parse", "main").stdout.strip()
    return bare, sha_main


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


def _commit_sha_de_repositorio_nao_relacionado(tmp_path: Path) -> str:
    """Cria um commit real noutro repositório git, nunca ligado ao `repo_origem`/`bare` deste teste, e devolve o seu SHA.

    Um SHA sintaticamente válido (40 hexadecimais) e correspondente a um
    commit git a sério — nunca uma string inventada à mão — mas cujo
    objeto nunca chega às entranhas de `repo_origem`: exatamente "o objeto
    não está disponível localmente", sem mentir sobre a forma do SHA.
    """
    outro = tmp_path / "repositorio-sem-relacao-nenhuma"
    outro.mkdir()
    _git(outro, tmp_path, "init", "--quiet")
    _git(outro, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(outro, tmp_path, "config", "user.name", "QA Tomazia")
    _git(
        outro,
        tmp_path,
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "commit nao relacionado, o objeto nunca chega a repo_origem",
    )
    return _git(outro, tmp_path, "rev-parse", "HEAD").stdout.strip()


def _pasta_com_ficheiros(tmp_path: Path, nome: str, ficheiros: dict[str, str]) -> Path:
    pasta = tmp_path / nome
    pasta.mkdir()
    for relativo, conteudo in ficheiros.items():
        caminho = pasta / relativo
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(conteudo, encoding="utf-8")
    return pasta


def _correr_publicar(
    repo_origem: Path,
    tmp_path: Path,
    *,
    pasta: Path,
    sha: str,
    branch: str = "deploy",
    timeout: float = 30,
) -> subprocess.CompletedProcess[str]:
    """Invoca `deploy/publicar-branch.sh` por subprocesso, a partir do seu caminho real. Nunca o importa."""
    return subprocess.run(
        [str(SCRIPT), "--pasta", str(pasta), "--sha", sha, "--branch", branch],
        cwd=repo_origem,
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=timeout,
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


def _assert_main_intocado(bare: Path, tmp_path: Path, sha_main_esperado: str) -> None:
    atual = _rev_parse_no_bare(bare, tmp_path, "main")
    assert atual == sha_main_esperado, (
        "publicar-branch.sh nunca pode tocar na branch 'main' do remoto"
    )


def test_recusa_quando_objeto_do_sha_nao_esta_disponivel_localmente(
    tmp_path: Path,
) -> None:
    """Um `--sha` cujo objeto git não existe localmente tem de abortar a publicação, nunca ser tratado como "não é um retrocesso"."""
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    pasta1 = _pasta_com_ficheiros(tmp_path, "pacote-1", {"api/VERSION": sha1})

    primeira = _correr_publicar(repo, tmp_path, pasta=pasta1, sha=sha1, branch="deploy")
    assert primeira.returncode == 0, primeira.stderr
    tip_depois_da_primeira = _rev_parse_no_bare(bare, tmp_path, "deploy")
    assert tip_depois_da_primeira is not None

    sha_ausente = _commit_sha_de_repositorio_nao_relacionado(tmp_path)
    # Confirma a premissa do teste: `repo` (onde o script vai correr) não
    # conhece mesmo este objeto.
    verificacao_premissa = subprocess.run(
        ["git", "cat-file", "-e", sha_ausente],
        cwd=repo,
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert verificacao_premissa.returncode != 0, (
        "premissa do teste: 'repo_origem' não pode conhecer o objeto "
        f"{sha_ausente!r} antes de correr publicar-branch.sh"
    )

    pasta2 = _pasta_com_ficheiros(tmp_path, "pacote-2", {"api/VERSION": sha_ausente})

    segunda = _correr_publicar(
        repo, tmp_path, pasta=pasta2, sha=sha_ausente, branch="deploy"
    )

    assert segunda.returncode != 0, (
        "um --sha cujo objeto git não existe localmente tem de abortar a "
        "publicação. 'git merge-base --is-ancestor' sai com o código 128 "
        "quando um dos objetos não existe — um 'if' que só distinga zero "
        "de não-zero lê isso como 'não é antepassado' e deixa passar "
        "exatamente o retrocesso que este guarda devia travar (regra 10 "
        "do CLAUDE.md: 'não encontrei' e 'não consegui procurar' nunca "
        "podem dar o mesmo resultado)."
    )
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") == tip_depois_da_primeira, (
        "uma publicação abortada por esta avaria não pode mexer na branch 'deploy'"
    )
    _assert_main_intocado(bare, tmp_path, sha_main)
