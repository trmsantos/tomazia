"""S-10: `.db`, `.sqlite`/`.sqlite3` ou `.env` nunca entram no repositório ou no build.

Prende o contrato de `.github/scripts/verificar-ficheiros-proibidos.sh`
(F1-03, agente infra), descrito em `docs/TAREFAS.md`: "passo que falha se
houver `.db`, `.sqlite` ou `.env` no repositório". Este ficheiro de testes
não sabe nada sobre a implementação do script — invoca-o sempre por
subprocesso, nunca o importa — por isso falha agora com um erro claro de
"ficheiro não encontrado": o script ainda não existe, é o infra que o está
a escrever em paralelo.

Todos os padrões que este guarda procura (`*.db`, `*.sqlite`, `*.sqlite3`,
`.env`, `.env.*`, `*.env`, com `.env.example` como única exceção) já estão
no `.gitignore` da raiz do repositório. Por isso o único caminho para um
desses ficheiros entrar no índice do git é `git add --force` (um `git add
-f` feito de propósito, ou por engano) ou uma edição descuidada ao próprio
`.gitignore` — este guarda é a rede de segurança para esse caminho, e é por
isso que todos os testes do modo `--git` a seguir usam `git add --force`
sobre repositórios git vazios, criados de propósito em `tmp_path`: nunca
tocam no repositório real, e não precisam de `commit` nenhum, porque
`--git` lê o índice (`git ls-files`), não o histórico.

O modo `--pasta` (usado pelo job do frontend sobre o `dist/` gerado) não
precisa de nada disto: os ficheiros aí nem sequer são versionados, só têm
de existir na pasta — por isso esses testes escrevem o ficheiro falso
diretamente, sem `git` nenhum.

O código de saída `2` (uso errado: argumento inválido, pasta inexistente,
ou `--git` fora de um repositório git) é o caso que mais interessa prender
bem: um guarda que devolvesse `0` nesses casos (em vez de `2`) seria um
guarda que, por uma pasta inexistente ou um `cwd` errado, deixaria passar
tudo em silêncio — exatamente o género de falha que este critério de
segurança existe para apanhar.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parents[3]
SCRIPT = RAIZ_REPO / ".github" / "scripts" / "verificar-ficheiros-proibidos.sh"

CONTEUDO_FICHEIRO_FALSO = "conteudo falso, nunca dados reais\n"


def _repositorio_git_vazio(tmp_path: Path) -> Path:
    """Cria um repositório git vazio dentro de `tmp_path`, nunca o repositório real.

    Sem `user.email`/`user.name`: os testes deste ficheiro só usam o
    índice (`git add`), nunca fazem `commit`, por isso não precisam de
    identidade nenhuma configurada.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, tmp_path, "init", "--quiet")
    return repo


def _git(repo: Path, tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Corre `git` sobre `repo`, nunca sobre o repositório real que contém estes testes."""
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


def _adicionar_forcado(repo: Path, tmp_path: Path, caminho_relativo: str) -> None:
    """Escreve um ficheiro falso e força-o para o índice com `git add --force`.

    `--force` é essencial: sem ele, todos os padrões testados aqui seriam
    recusados pelo próprio `.gitignore` antes de o guarda sequer entrar em
    jogo, e o teste não estaria a verificar nada.
    """
    caminho = repo / caminho_relativo
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(CONTEUDO_FICHEIRO_FALSO, encoding="utf-8")
    _git(repo, tmp_path, "add", "--force", "--", caminho_relativo)


def _ambiente(tmp_path: Path, *, github_actions: bool = False) -> dict[str, str]:
    """Ambiente do subprocesso, nunca contaminado pelo `GITHUB_ACTIONS` de quem corre os testes.

    `GIT_CEILING_DIRECTORIES=tmp_path` impede o `git` de subir acima da
    pasta de teste à procura de um `.git` — mesmo correndo esta suite, por
    acidente, de dentro de um clone git real, `--git` sobre uma pasta sem
    `.git` própria nunca "encontraria" esse repositório por engano.
    """
    ambiente = os.environ.copy()
    ambiente["GIT_CEILING_DIRECTORIES"] = str(tmp_path)
    if github_actions:
        ambiente["GITHUB_ACTIONS"] = "true"
    else:
        ambiente.pop("GITHUB_ACTIONS", None)
    return ambiente


def _correr(
    *args: str, cwd: Path, tmp_path: Path, github_actions: bool = False
) -> subprocess.CompletedProcess[str]:
    """Invoca o script por subprocesso. Nunca importa nada dele."""
    return subprocess.run(
        [str(SCRIPT), *args],
        cwd=cwd,
        env=_ambiente(tmp_path, github_actions=github_actions),
        capture_output=True,
        text=True,
        timeout=15,
    )


# --- Modo `--git`: ficheiros versionados (índice), via `git ls-files` ---


def test_ficheiro_db_forcado_no_indice_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/falso.db")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "var/falso.db" in resultado.stdout


def test_env_na_raiz_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, ".env")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr


def test_env_example_e_a_unica_excecao(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "backend/.env.example")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 0, resultado.stderr


def test_config_env_falha_pelo_padrao_asterisco_env(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "config.env")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr


def test_ficheiro_sqlite3_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "dados.sqlite3")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr


def test_ficheiro_dbf_nao_termina_em_db_passa(tmp_path: Path) -> None:
    """`notas.dbf` não é apanhado por `*.db`: o padrão tem de casar a extensão toda, não um prefixo."""
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "notas.dbf")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 0, resultado.stderr


def test_repositorio_sem_ficheiros_proibidos_passa(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    (repo / "README.md").write_text("ementa do bar\n", encoding="utf-8")
    _git(repo, tmp_path, "add", "--", "README.md")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 0, resultado.stderr


def test_modo_git_fora_de_repositorio_sai_com_uso_errado(tmp_path: Path) -> None:
    """Uma pasta sem `.git` tem de sair `2` (uso errado), nunca `0` (nada encontrado).

    Um `0` aqui seria um guarda que, invocado por engano fora de um
    repositório git (p. ex. um `cwd` errado no workflow), diria sempre
    "está tudo bem" sem nunca ter olhado para ficheiro nenhum.
    """
    pasta_sem_git = tmp_path / "nao-e-um-repositorio"
    pasta_sem_git.mkdir()

    resultado = _correr(
        "--git", str(pasta_sem_git), cwd=pasta_sem_git, tmp_path=tmp_path
    )

    assert resultado.returncode == 2, resultado.stderr


# --- Modo `--pasta`: percorre uma pasta com `find`, versionada ou não ---


def test_modo_pasta_ficheiro_sqlite_nao_versionado_falha(tmp_path: Path) -> None:
    pasta_dist = tmp_path / "dist"
    pasta_dist.mkdir()
    (pasta_dist / "falso.sqlite").write_text(CONTEUDO_FICHEIRO_FALSO, encoding="utf-8")

    resultado = _correr("--pasta", str(pasta_dist), cwd=tmp_path, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "falso.sqlite" in resultado.stdout


def test_modo_pasta_limpa_passa(tmp_path: Path) -> None:
    pasta_dist = tmp_path / "dist"
    pasta_dist.mkdir()
    (pasta_dist / "indice.html").write_text("<html></html>\n", encoding="utf-8")

    resultado = _correr("--pasta", str(pasta_dist), cwd=tmp_path, tmp_path=tmp_path)

    assert resultado.returncode == 0, resultado.stderr


def test_modo_pasta_inexistente_sai_com_uso_errado(tmp_path: Path) -> None:
    """Uma pasta inexistente tem de sair `2`, nunca `0`.

    É o caso que o arquiteto pediu para prender com mais cuidado: um
    `find` sobre uma pasta que não existe não encontra ficheiros nenhuns,
    e um script descuidado podia confundir "não encontrei nada de
    proibido" com "a pasta nem sequer existe" — os dois têm de dar códigos
    de saída diferentes.
    """
    pasta_inexistente = tmp_path / "nao-existe"

    resultado = _correr(
        "--pasta", str(pasta_inexistente), cwd=tmp_path, tmp_path=tmp_path
    )

    assert resultado.returncode == 2, resultado.stderr


# --- Anotações do GitHub Actions: só com `GITHUB_ACTIONS=true` ---


def test_anotacao_github_actions_quando_variavel_esta_definida(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/falso.db")

    resultado = _correr(
        "--git", str(repo), cwd=repo, tmp_path=tmp_path, github_actions=True
    )

    assert resultado.returncode == 1, resultado.stderr
    assert "::error file=var/falso.db::" in resultado.stdout


def test_sem_anotacao_quando_github_actions_nao_esta_definida(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/falso.db")

    resultado = _correr(
        "--git", str(repo), cwd=repo, tmp_path=tmp_path, github_actions=False
    )

    assert resultado.returncode == 1, resultado.stderr
    assert "var/falso.db" in resultado.stdout
    assert "::error" not in resultado.stdout
