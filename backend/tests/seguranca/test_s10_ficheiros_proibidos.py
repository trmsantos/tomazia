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

import pytest

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


# --- Ficheiros auxiliares do modo WAL do SQLite ---
#
# `backend/CLAUDE.md` manda correr o SQLite em modo WAL. Um `-wal` contém
# as transações recentes em claro; um `-shm` e um `-journal` são do mesmo
# género. Nenhum termina em `.db`, `.sqlite` ou `.sqlite3`, por isso o
# padrão `*.db`/`*.sqlite`/`*.sqlite3` sozinho não os apanha.


def test_ficheiro_db_wal_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/antiga.db-wal")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "antiga.db-wal" in resultado.stdout


def test_ficheiro_db_shm_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/antiga.db-shm")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "antiga.db-shm" in resultado.stdout


def test_ficheiro_db_journal_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/antiga.db-journal")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "antiga.db-journal" in resultado.stdout


def test_ficheiro_sqlite_journal_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/copia.sqlite-journal")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "copia.sqlite-journal" in resultado.stdout


# --- Dumps SQL, e a exceção do esquema legado ---
#
# `dump.sql` e `copia.sql.gz` são o veículo mais provável dos dados reais
# do site PHP antigo. `docs/legado/esquema-bd-antiga.sql` é a exceção: é
# o esquema (DDL), não dados, e está versionado de propósito para consulta
# durante a migração.


def test_dump_sql_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "backend/var/dump.sql")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "backend/var/dump.sql" in resultado.stdout


def test_dump_sql_gz_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "copia.sql.gz")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "copia.sql.gz" in resultado.stdout


def test_esquema_bd_antiga_e_a_excecao_e_passa(tmp_path: Path) -> None:
    """`docs/legado/esquema-bd-antiga.sql` é esquema (DDL) do MySQL antigo, não dados: exceção por caminho exato.

    Confirmado no próprio script (`EXCECOES_CAMINHO`, em
    `verificar-ficheiros-proibidos.sh`): o caminho exato
    "docs/legado/esquema-bd-antiga.sql", tal como o ficheiro real do
    repositório — não um padrão nem uma pasta inteira.
    """
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "docs/legado/esquema-bd-antiga.sql")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 0, resultado.stderr


def test_mesmo_nome_do_esquema_legado_noutro_caminho_falha(tmp_path: Path) -> None:
    """A exceção é pelo caminho exato, não pelo nome base: o mesmo ficheiro noutra pasta continua proibido.

    Prende uma implementação preguiçosa que excecionasse por
    `basename == "esquema-bd-antiga.sql"` em vez do caminho completo —
    isso deixaria passar qualquer dump colocado com esse nome em
    qualquer pasta do repositório.
    """
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "outra-pasta/esquema-bd-antiga.sql")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr


# --- Ligações simbólicas (modo --pasta) ---
#
# `find` sem `-L` trata uma ligação simbólica como tipo `l`, nunca `f`;
# `-type f` exclui-a da procura, qualquer que seja o nome dela ou o que
# ela aponte. É a fuga que estes dois testes prendem.


def test_modo_pasta_symlink_para_db_fora_da_pasta_falha(tmp_path: Path) -> None:
    """Uma ligação cujo nome parece proibido não pode escapar por só ser uma ligação.

    O ficheiro real (`segredo.db`) vive fora da pasta percorrida; só a
    ligação (`legado.db`) está dentro de `dist/`. Sem seguir a ligação
    (`find -L`), o guarda nunca chega a ver que o tipo final é um
    ficheiro normal, e `-type f` descarta-a logo por ela ser, ela
    própria, uma ligação.
    """
    fora = tmp_path / "fora"
    fora.mkdir()
    (fora / "segredo.db").write_text(CONTEUDO_FICHEIRO_FALSO, encoding="utf-8")

    pasta_dist = tmp_path / "dist"
    pasta_dist.mkdir()
    (pasta_dist / "legado.db").symlink_to(fora / "segredo.db")

    resultado = _correr("--pasta", str(pasta_dist), cwd=tmp_path, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "legado.db" in resultado.stdout


def test_modo_pasta_pasta_symlink_com_db_e_env_falha(tmp_path: Path) -> None:
    """Uma pasta ligada para fora de `$dir` tem de ser atravessada, não ignorada.

    Sem `-L`, `find` não desce por uma pasta ligada: o conteúdo dela
    fica invisível ao guarda, mesmo que lá dentro estejam uma base de
    dados e um ficheiro de ambiente a sério.
    """
    fora = tmp_path / "fora-pasta"
    fora.mkdir()
    (fora / "segredo.db").write_text(CONTEUDO_FICHEIRO_FALSO, encoding="utf-8")
    (fora / ".env").write_text(CONTEUDO_FICHEIRO_FALSO, encoding="utf-8")

    pasta_dist = tmp_path / "dist"
    pasta_dist.mkdir()
    (pasta_dist / "legado").symlink_to(fora, target_is_directory=True)

    resultado = _correr("--pasta", str(pasta_dist), cwd=tmp_path, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "legado/segredo.db" in resultado.stdout
    assert "legado/.env" in resultado.stdout


# --- A procura em si a falhar: índice corrompido, pasta sem permissão ---
#
# Quarta vez que esta família de falha aparece no projeto: um comando de
# procura que falha a meio (em vez de simplesmente não encontrar nada)
# tem de ser tratado como "não sei", nunca como "está tudo limpo". As
# duas formas óbvias de uma procura falhar: o índice do git ilegível, e
# uma subpasta sem permissão de leitura.

_A_CORRER_COMO_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def test_modo_git_indice_corrompido_sai_com_uso_errado(tmp_path: Path) -> None:
    """Um `$GIT_DIR/index` corrompido tem de sair `2`, nunca `0`.

    `git ls-files` falha com um índice ilegível (escreve "fatal:" para o
    stderr e sai com erro); sem verificar esse estado, o guarda seguiria
    em frente como se tivesse percorrido um repositório vazio — nada
    encontrado, tudo bem. É exatamente a falha silenciosa que este
    critério de segurança existe para apanhar.
    """
    repo = _repositorio_git_vazio(tmp_path)
    (repo / "README.md").write_text("ementa do bar\n", encoding="utf-8")
    _git(repo, tmp_path, "add", "--", "README.md")

    indice = repo / ".git" / "index"
    indice.write_bytes(b"isto nao e um indice git valido, so lixo\x00\x01\x02" * 4)

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 2, resultado.stderr


@pytest.mark.skipif(
    _A_CORRER_COMO_ROOT,
    reason="a correr como root, as permissões de ficheiros não bloqueiam a leitura",
)
def test_modo_pasta_subpasta_sem_permissao_sai_com_uso_errado(tmp_path: Path) -> None:
    """Uma subpasta sem permissão de leitura tem de sair `2`, nunca `0`.

    `find` escreve "Permission denied" para o stderr e sai com erro ao
    tentar entrar nessa subpasta; sem verificar esse estado, o guarda
    seguiria em frente como se a subpasta tivesse sido revistada e
    estivesse limpa.

    A subpasta volta a ter permissões no final (`finally`), senão o
    `tmp_path` do pytest não se consegue limpar sozinho.
    """
    pasta_dist = tmp_path / "dist"
    subpasta = pasta_dist / "sem-permissao"
    subpasta.mkdir(parents=True)
    (subpasta / "dummy.txt").write_text("x\n", encoding="utf-8")
    subpasta.chmod(0o000)

    try:
        resultado = _correr("--pasta", str(pasta_dist), cwd=tmp_path, tmp_path=tmp_path)
        assert resultado.returncode == 2, resultado.stderr
    finally:
        subpasta.chmod(0o755)


# --- Submódulos: o conteúdo tem de ser visto, não só o gitlink ---


def test_modo_git_submodulo_com_db_e_visto_com_recurse_submodules(
    tmp_path: Path,
) -> None:
    """Um `.db` dentro de um submódulo tem de ser visto, não escondido atrás do gitlink.

    `git ls-files`, sem `--recurse-submodules`, para no gitlink (o
    ponteiro para o commit do submódulo, caminho `sub`) e nunca lista o
    que está dentro dele — mesmo que o submódulo esteja clonado e o
    ficheiro exista mesmo ali, no disco.
    """
    fonte_submodulo = tmp_path / "submodulo-fonte"
    fonte_submodulo.mkdir()
    _git(fonte_submodulo, tmp_path, "init", "--quiet")
    _git(fonte_submodulo, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(fonte_submodulo, tmp_path, "config", "user.name", "QA Tomazia")
    (fonte_submodulo / "segredo.db").write_text(
        CONTEUDO_FICHEIRO_FALSO, encoding="utf-8"
    )
    _git(fonte_submodulo, tmp_path, "add", "segredo.db")
    _git(fonte_submodulo, tmp_path, "commit", "--quiet", "-m", "falso, só para teste")

    repo = _repositorio_git_vazio(tmp_path)
    _git(
        repo,
        tmp_path,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "--quiet",
        str(fonte_submodulo),
        "sub",
    )

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "sub/segredo.db" in resultado.stdout
