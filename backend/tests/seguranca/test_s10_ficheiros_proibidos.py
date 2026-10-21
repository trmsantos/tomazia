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


def _adicionar_forcado(
    repo: Path,
    tmp_path: Path,
    caminho_relativo: str,
    conteudo: str = CONTEUDO_FICHEIRO_FALSO,
) -> None:
    """Escreve um ficheiro falso e força-o para o índice com `git add --force`.

    `--force` é essencial: sem ele, todos os padrões testados aqui seriam
    recusados pelo próprio `.gitignore` antes de o guarda sequer entrar em
    jogo, e o teste não estaria a verificar nada.

    `conteudo` tem omissão `CONTEUDO_FICHEIRO_FALSO`: a maioria dos testes
    deste ficheiro só precisa do nome/caminho para disparar o padrão, nunca
    do conteúdo. Os testes do guarda de conteúdo da exceção do esquema
    legado (abaixo) é que passam um `conteudo` à medida, com uma instrução
    de dados a sério.
    """
    caminho = repo / caminho_relativo
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(conteudo, encoding="utf-8")
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


# --- Master journals do SQLite: as três famílias têm de se comportar da mesma forma ---
#
# Um master journal (`-mj` seguido de um sufixo de hash hexadecimal) é o
# ficheiro auxiliar de uma transação multi-base do SQLite; tal como o
# `-wal`/`-shm`/`-journal` acima, contém dados a sério e nenhum termina em
# `.db`, `.sqlite` ou `.sqlite3`. Confirmado hoje: `a.db-mj0A1B2C3D` e
# `a.sqlite-mj0A1B` passavam, mas `a.sqlite3-mj0A1B` já era apanhado (pelo
# padrão `*.sqlite3-*`, que por acaso também casa um sufixo `-mj...`) —
# uma assimetria entre as três famílias, não uma proteção deliberada.


def test_ficheiro_db_master_journal_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/antiga.db-mj0A1B2C3D")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "antiga.db-mj0A1B2C3D" in resultado.stdout


def test_ficheiro_sqlite_master_journal_falha(tmp_path: Path) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/copia.sqlite-mj0A1B")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "copia.sqlite-mj0A1B" in resultado.stdout


def test_ficheiro_sqlite3_master_journal_falha(tmp_path: Path) -> None:
    """A família `.sqlite3` já apanhava isto antes das outras duas: fica aqui como prova de que a simetria não a quebrou."""
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, "var/copia.sqlite3-mj0A1B")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "copia.sqlite3-mj0A1B" in resultado.stdout


# --- Cópias comprimidas ou renomeadas ---
#
# Confirmado hoje: todas estas passavam. Nenhuma termina em `.db`,
# `.sqlite` ou `.sqlite3` sozinho (`.db.gz`/`.db.bak`/`.db.zip` têm mais
# uma extensão a seguir; `.db3`/`.sqlitedb` nem sequer têm o ponto no
# sítio certo), mas são todas formas óbvias de uma base de dados (ou um
# dump) escapar ao guarda só porque mudou de nome ou foi comprimida.


@pytest.mark.parametrize(
    "nome_ficheiro",
    [
        "copia.db.gz",
        "copia.db.bak",
        "copia.db.zip",
        "copia.db3",
        "copia.sqlitedb",
        "dump.mysql",
    ],
)
def test_copia_comprimida_ou_renomeada_falha(
    tmp_path: Path, nome_ficheiro: str
) -> None:
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(repo, tmp_path, f"var/{nome_ficheiro}")

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert nome_ficheiro in resultado.stdout


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

    Este teste e `test_esquema_legado_com_insert_de_dados_falha` (abaixo)
    são os dois que, juntos, dizem a regra toda: a exceção é só pelo
    CAMINHO ("este `.sql` em particular pode existir"), nunca pelo
    CONTEÚDO ("o que estiver lá dentro passa"). Sozinho, este teste
    deixaria passar despercebido um guarda que excecionasse o caminho sem
    nunca olhar para dentro do ficheiro — foi exatamente isso que o
    revisor-seguranca apanhou: um `mysqldump` completo (sem
    `--no-data`), com um `INSERT INTO` a sério, passava neste mesmo
    caminho.
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


# --- O conteúdo do esquema legado: a exceção é só pelo caminho, nunca pelo conteúdo ---
#
# Reproduzido pelo revisor-seguranca: um `mysqldump` completo (em vez de
# `mysqldump --no-data`) dentro de `docs/legado/esquema-bd-antiga.sql`
# passava a verde, porque a exceção acima olhava só para o caminho. É a
# única porta que este guarda abre de propósito para um `.sql`, e não
# pode ser uma porta que fica aberta independentemente do que lá é posto
# depois — por isso a exceção tem de ler o conteúdo, mesmo neste caminho
# exato, à procura de uma instrução que insira dados.


def test_esquema_legado_com_insert_de_dados_falha(tmp_path: Path) -> None:
    """Um `mysqldump` a direito (sem `--no-data`) no caminho excecionado continua proibido: a exceção é pelo caminho, nunca pelo conteúdo.

    Par de `test_esquema_bd_antiga_e_a_excecao_e_passa`, acima: aquele
    confirma que o caminho exato passa quando o conteúdo é só estrutura;
    este confirma que o mesmo caminho exato continua a falhar quando o
    conteúdo deixa de ser só estrutura. Os dois juntos é que dizem a
    regra — nenhum sozinho a diz toda.

    O `INSERT INTO` é o mesmo género de linha que um `mysqldump` real
    escreve a seguir ao `CREATE TABLE`, quando corre sem `--no-data`; os
    dados (nome, email, telefone) são claramente falsos, nunca de um
    cliente real.
    """
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(
        repo,
        tmp_path,
        "docs/legado/esquema-bd-antiga.sql",
        conteudo=(
            "-- MySQL dump 10.13  Distrib 8.0.34, for Linux (x86_64)\n"
            "--\n"
            "-- Host: localhost    Database: bd_tomazia_antiga\n"
            "-- ------------------------------------------------------\n"
            "\n"
            "DROP TABLE IF EXISTS `tomazia_clientes`;\n"
            "CREATE TABLE `tomazia_clientes` (\n"
            "  `id` int NOT NULL AUTO_INCREMENT,\n"
            "  `nome` varchar(100) DEFAULT NULL,\n"
            "  `email` varchar(100) DEFAULT NULL,\n"
            "  `telefone` varchar(20) DEFAULT NULL,\n"
            "  PRIMARY KEY (`id`)\n"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n"
            "\n"
            "--\n"
            "-- Dumping data for table `tomazia_clientes`\n"
            "--\n"
            "\n"
            "INSERT INTO `tomazia_clientes` VALUES "
            "(1,'Ana Silva','ana.silva@exemplo.test','912345678');\n"
        ),
    )

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "docs/legado/esquema-bd-antiga.sql" in resultado.stdout


def test_esquema_legado_com_load_data_em_minusculas_falha(tmp_path: Path) -> None:
    """`LOAD DATA` (ou `REPLACE`/`COPY`) prende tanto quanto `INSERT`: a regra é "qualquer instrução de dados", não só uma.

    Em minúsculas de propósito: confirma, ao mesmo tempo, que a procura
    por instruções de dados não distingue maiúsculas de minúsculas — um
    `mysqldump --tab` (estrutura e dados em ficheiros separados, a carregar
    com `load data infile`) é tão real quanto um `INSERT` a direito, e
    normalmente aparece em minúsculas no `.sql` gerado.
    """
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(
        repo,
        tmp_path,
        "docs/legado/esquema-bd-antiga.sql",
        conteudo=(
            "-- variante hipotética de um mysqldump com --tab: estrutura e\n"
            "-- dados em ficheiros separados, com 'load data infile' a\n"
            "-- carregar os dados de volta.\n"
            "\n"
            "create table `tomazia_clientes` (\n"
            "  `id` int not null auto_increment,\n"
            "  `nome` varchar(100) default null,\n"
            "  primary key (`id`)\n"
            ");\n"
            "\n"
            "load data infile '/tmp/tomazia_clientes.txt' "
            "into table `tomazia_clientes`;\n"
        ),
    )

    resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)

    assert resultado.returncode == 1, resultado.stderr
    assert "docs/legado/esquema-bd-antiga.sql" in resultado.stdout


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


@pytest.mark.skipif(
    _A_CORRER_COMO_ROOT,
    reason="a correr como root, as permissões de ficheiros não bloqueiam a leitura",
)
def test_esquema_legado_com_insert_ilegivel_nunca_passa(tmp_path: Path) -> None:
    """Um esquema legado com dados, mas ilegível, não pode ganhar a exceção por não se conseguir ler.

    Par de `test_esquema_legado_com_insert_de_dados_falha`, acima: aquele
    confirma que a exceção lê o conteúdo e apanha um `INSERT` quando
    consegue ler o ficheiro; este confirma o outro lado — quando o guarda
    NÃO consegue ler o ficheiro excecionado (`grep` falha com "Permission
    denied" e sai com um código de saída não-zero, nunca `0`), esse "não
    sei" não pode ser lido como "sem instruções de dados", e a exceção não
    pode ser concedida. É a quinta vez que esta família de falha aparece
    no projeto: um guarda que sai verde porque não conseguiu fazer o seu
    trabalho — desta vez no único sítio em que este guarda abre uma porta
    de propósito (a exceção do esquema legado).

    Aceita `1` (apanhado como ficheiro proibido, tal como o par legível,
    se a falha de leitura for tratada como "tem dados") ou `2` (uso
    errado/procura incompleta, tal como os outros guardas de "não
    consegui ler" deste ficheiro, se for tratada como erro fatal) —
    qualquer um dos dois é uma falha fechada; só `0` (passa) é que nunca
    pode acontecer.

    A permissão volta a ser reposta no final (`finally`), senão o
    `tmp_path` do pytest não se consegue limpar sozinho.
    """
    repo = _repositorio_git_vazio(tmp_path)
    _adicionar_forcado(
        repo,
        tmp_path,
        "docs/legado/esquema-bd-antiga.sql",
        conteudo=(
            "CREATE TABLE `tomazia_clientes` (\n"
            "  `id` int NOT NULL AUTO_INCREMENT,\n"
            "  PRIMARY KEY (`id`)\n"
            ");\n"
            "\n"
            "INSERT INTO `tomazia_clientes` VALUES "
            "(1,'Ana Silva','ana.silva@exemplo.test','912345678');\n"
        ),
    )

    caminho_disco = repo / "docs" / "legado" / "esquema-bd-antiga.sql"
    caminho_disco.chmod(0o000)

    try:
        resultado = _correr("--git", str(repo), cwd=repo, tmp_path=tmp_path)
        assert resultado.returncode in (1, 2), (
            f"saiu {resultado.returncode}, stdout={resultado.stdout!r}, "
            f"stderr={resultado.stderr!r}"
        )
    finally:
        caminho_disco.chmod(0o644)


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
