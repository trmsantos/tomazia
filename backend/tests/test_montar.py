"""`deploy/montar.sh --sha <40 hex> --saida <pasta>`: o contrato do pacote de deploy.

Prende o contrato descrito em `docs/TAREFAS.md` (F1-04) e em
`.claude/agents/infra.md`: a pasta de deploy leva só `backend/app`,
`backend/migrations`, `backend/scripts` (quando existir — ainda não existe
hoje, chega só na F2-02), `backend/alembic.ini`, `backend/passenger_wsgi.py`,
`backend/requirements.txt`, `frontend/dist`, `deploy/` e `VERSION`; nunca
`.claude/`, `CLAUDE.md`, `docs/`, `tests/` ou `e2e/` (isso é o critério S-12,
testado à parte em `tests/seguranca/test_s12_pasta_de_deploy.py` — este
ficheiro testa o resto do contrato: a lista exata de ficheiros, o conteúdo
de `VERSION`, a validade e posição de `.cpanel.yml`, as recusas e a
idempotência).

`deploy/montar.sh` ainda não existe — é o infra que o escreve a seguir.
Por isso estes testes falham agora com um erro claro de "ficheiro não
encontrado" (ou, quando a pasta de trabalho simula a árvore inteira,
primeiro com um `FileNotFoundError` do subprocesso): nunca o importamos,
invocamo-lo sempre por subprocesso.

## Como se constrói a árvore de trabalho (e porquê)

`montar.sh` recebe só `--sha` e `--saida` — nada que diga onde fica a raiz
do projeto. Para isto funcionar contra uma árvore de teste (sem precisar de
`git`, ao contrário de `publicar-branch.sh`), assume-se que o script resolve
a sua própria raiz a partir do seu próprio caminho (algo como
`cd "$(dirname "$0")/.." && pwd`), nunca via `git rev-parse`. Isto não está
escrito em lado nenhum do plano — é um ponto de extensão que este ficheiro
de testes precisa e que fica sinalizado aqui para o infra: sem ele, nenhum
destes testes consegue correr `montar.sh` contra uma árvore que não seja o
próprio checkout do repositório.

Os testes "de contrato" (lista exata de ficheiros, `VERSION`, `.cpanel.yml`,
idempotência) correm contra uma cópia de trabalho do **conteúdo real** do
repositório (`backend/`, `frontend/`, `deploy/`, lido, nunca escrito) — só
`frontend/dist` é fabricado: construir o frontend a sério (`npm run build`)
é lento e traz ruído (hashes de ficheiros que mudam a cada build) para um
teste que só quer provar que `montar.sh` copia `frontend/dist` para o
pacote. Uma árvore de trabalho com um `frontend/dist/index.html` mínimo e
fabricado prova o mesmo contrato sem essa lentidão. Os testes de recusa
usam árvores mais pequenas e totalmente fabricadas, como o arquiteto pediu.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[2]
SCRIPT_REAL = RAIZ_REPO / "deploy" / "montar.sh"

#: 40 carateres hexadecimais, como um SHA de commit a sério — mas calculado
#: a partir de texto claramente falso, nunca um SHA de um commit real.
SHA_VALIDO = hashlib.sha1(b"commit de teste do montar.sh, nunca real").hexdigest()
assert len(SHA_VALIDO) == 40

_IGNORAR_NA_COPIA = shutil.ignore_patterns(
    ".venv",
    "node_modules",
    "__pycache__",
    "*.pyc",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".impeccable",
    ".DS_Store",
    "dist",
)

_A_CORRER_COMO_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def _ambiente() -> dict[str, str]:
    """Ambiente do subprocesso. `montar.sh` não faz operações git, por isso herda o ambiente inteiro (precisa de `cp`, `rm`, `mkdir`, etc. do `PATH` normal)."""
    return os.environ.copy()


def _correr_montar(
    raiz_trabalho: Path, *, sha: str, saida: Path, timeout: float = 30
) -> subprocess.CompletedProcess[str]:
    """Invoca `<raiz_trabalho>/deploy/montar.sh` por subprocesso. Nunca o importa."""
    script = raiz_trabalho / "deploy" / "montar.sh"
    return subprocess.run(
        [str(script), "--sha", sha, "--saida", str(saida)],
        cwd=raiz_trabalho,
        env=_ambiente(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _copiar_se_existir(origem: Path, destino: Path) -> None:
    if not origem.exists():
        return
    if origem.is_dir():
        shutil.copytree(origem, destino, ignore=_IGNORAR_NA_COPIA)
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origem, destino)


def _construir_arvore_completa(tmp_path: Path) -> Path:
    """Cópia de trabalho do conteúdo real do repositório, mais um `frontend/dist` fabricado.

    Usada pelos testes de contrato (lista exata, `VERSION`, `.cpanel.yml`,
    idempotência): nunca escreve no repositório real, só lê dele. Inclui de
    propósito ficheiros que `montar.sh` nunca deve copiar para o pacote
    (`backend/CLAUDE.md`, `backend/tests/`, `backend/pyproject.toml`, a
    `docs/` e o `.claude/` da raiz) — não para os testar aqui (isso é
    `test_s12_pasta_de_deploy.py`), mas porque são conteúdo real do
    `backend/` e do repositório, e copiar `backend/` "a direito" é mais
    simples e mais fiel do que recriar uma árvore `backend/` falsa só com os
    ficheiros "bons".
    """
    raiz = tmp_path / "trabalho"
    raiz.mkdir()

    _copiar_se_existir(RAIZ_REPO / "backend", raiz / "backend")
    _copiar_se_existir(RAIZ_REPO / "frontend", raiz / "frontend")
    _copiar_se_existir(RAIZ_REPO / "deploy", raiz / "deploy")
    _copiar_se_existir(RAIZ_REPO / "CLAUDE.md", raiz / "CLAUDE.md")
    _copiar_se_existir(RAIZ_REPO / "docs", raiz / "docs")
    _copiar_se_existir(RAIZ_REPO / ".claude", raiz / ".claude")

    # `frontend/dist` é sempre fabricado (ver o docstring do módulo): nunca
    # existe no repositório real, porque é o resultado de `npm run build`.
    pasta_dist = raiz / "frontend" / "dist"
    pasta_dist.mkdir(parents=True, exist_ok=True)
    (pasta_dist / "index.html").write_text(
        "<!doctype html><html><head><title>Bar da Tomazia</title></head>"
        "<body>pacote de teste, fabricado pelo test_montar.py</body></html>\n",
        encoding="utf-8",
    )
    (pasta_dist / "assets").mkdir(exist_ok=True)
    (pasta_dist / "assets" / "app.js").write_text(
        "// ficheiro fabricado pelo test_montar.py, nunca um build a sério\n",
        encoding="utf-8",
    )

    return raiz


def _construir_arvore_minima(tmp_path: Path, *, com_index_html: bool = True) -> Path:
    """Árvore pequena e totalmente fabricada, para os casos de recusa.

    Leva só o essencial para `montar.sh` ter algo que copiar (e o próprio
    `deploy/` real, copiado do repositório, para o script sob teste estar
    presente) — nunca o `backend/` ou `frontend/` reais inteiros.
    """
    raiz = tmp_path / "trabalho-minimo"
    raiz.mkdir()

    (raiz / "backend" / "app").mkdir(parents=True)
    (raiz / "backend" / "app" / "__init__.py").write_text("", encoding="utf-8")
    (raiz / "backend" / "migrations").mkdir(parents=True)
    (raiz / "backend" / "migrations" / "env.py").write_text(
        "# migração falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "alembic.ini").write_text(
        "[alembic]\nscript_location = migrations\n", encoding="utf-8"
    )
    (raiz / "backend" / "passenger_wsgi.py").write_text(
        "# passenger_wsgi falso\n", encoding="utf-8"
    )
    (raiz / "backend" / "requirements.txt").write_text("fastapi\n", encoding="utf-8")

    pasta_dist = raiz / "frontend" / "dist"
    pasta_dist.mkdir(parents=True)
    if com_index_html:
        (pasta_dist / "index.html").write_text(
            "<!doctype html><html></html>\n", encoding="utf-8"
        )

    _copiar_se_existir(RAIZ_REPO / "deploy", raiz / "deploy")

    return raiz


def _listar_ficheiros_relativos(pasta: Path) -> set[str]:
    if not pasta.is_dir():
        return set()
    return {
        caminho.relative_to(pasta).as_posix()
        for caminho in pasta.rglob("*")
        if caminho.is_file()
    }


def _hashes_dos_ficheiros(pasta: Path) -> dict[str, str]:
    return {
        relativo: hashlib.sha256((pasta / relativo).read_bytes()).hexdigest()
        for relativo in _listar_ficheiros_relativos(pasta)
    }


def _analisar_cpanel_yml(texto: str) -> list[str]:
    """Leitura mínima e estrita da forma esperada de um `.cpanel.yml`.

    Não é um parser de YAML genérico — o backend não depende de `PyYAML`
    (uma dependência nova pede uma linha de justificação num PR, fora do
    âmbito de um ficheiro só de testes) — mas basta para a forma mínima que
    o cPanel exige e documenta: um mapeamento de topo com uma única chave
    `deployment`, que mapeia para `tasks`, uma sequência de bloco. Rejeita
    tabs (inválidos em YAML) e qualquer desvio da forma
    `deployment:` / `  tasks:` / `    - <comando>` (repetido).

    Lança `AssertionError` com uma mensagem clara em qualquer desvio da
    forma esperada — exatamente o que "é YAML válido com uma só tarefa"
    precisa de verificar. Devolve a lista de tarefas encontradas.
    """
    assert "\t" not in texto, "tabs não são válidos em YAML"

    linhas = [
        linha
        for linha in texto.splitlines()
        if linha.strip() != "" and not linha.strip().startswith("#")
    ]
    if linhas and linhas[0].strip() == "---":
        linhas = linhas[1:]

    assert linhas, "ficheiro .cpanel.yml vazio"
    assert linhas[0] == "deployment:", (
        f"esperava uma única chave de topo 'deployment:', vi {linhas[0]!r}"
    )
    assert len(linhas) > 1 and linhas[1].strip() == "tasks:", (
        f"esperava 'tasks:' logo a seguir a 'deployment:', vi "
        f"{linhas[1] if len(linhas) > 1 else '<fim do ficheiro>'!r}"
    )
    indentacao_tasks = len(linhas[1]) - len(linhas[1].lstrip(" "))
    assert indentacao_tasks > 0, "'tasks:' tem de estar indentado sob 'deployment:'"

    tarefas: list[str] = []
    for linha in linhas[2:]:
        indentacao = len(linha) - len(linha.lstrip(" "))
        conteudo = linha.strip()
        assert indentacao > indentacao_tasks, (
            f"linha fora do bloco 'deployment.tasks': {linha!r}"
        )
        assert conteudo.startswith("- "), (
            f"esperava um item de sequência '- ...' dentro de 'tasks:', vi {linha!r}"
        )
        tarefas.append(conteudo[2:].strip())

    return tarefas


# --- O contrato do pacote, contra o conteúdo real do repositório ---


def test_pacote_tem_exatamente_a_lista_esperada_de_ficheiros(tmp_path: Path) -> None:
    raiz_trabalho = _construir_arvore_completa(tmp_path)
    saida = tmp_path / "saida"

    resultado = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)

    assert resultado.returncode == 0, resultado.stderr

    esperado: set[str] = {".cpanel.yml", "api/VERSION"}
    for nome in ("app", "migrations"):
        origem = raiz_trabalho / "backend" / nome
        esperado |= {f"api/{nome}/{rel}" for rel in _listar_ficheiros_relativos(origem)}
    pasta_scripts = raiz_trabalho / "backend" / "scripts"
    if pasta_scripts.is_dir():
        esperado |= {
            f"api/scripts/{rel}" for rel in _listar_ficheiros_relativos(pasta_scripts)
        }
    esperado.add("api/alembic.ini")
    esperado.add("api/passenger_wsgi.py")
    esperado.add("api/requirements.txt")
    esperado |= {
        f"frontend/dist/{rel}"
        for rel in _listar_ficheiros_relativos(raiz_trabalho / "frontend" / "dist")
    }
    esperado |= {
        f"deploy/{rel}" for rel in _listar_ficheiros_relativos(raiz_trabalho / "deploy")
    }

    atual = _listar_ficheiros_relativos(saida)

    assert atual == esperado


def test_version_contem_o_sha_e_mais_nada(tmp_path: Path) -> None:
    raiz_trabalho = _construir_arvore_completa(tmp_path)
    saida = tmp_path / "saida"

    resultado = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)

    assert resultado.returncode == 0, resultado.stderr
    conteudo = (saida / "api" / "VERSION").read_text(encoding="utf-8")
    assert conteudo == SHA_VALIDO, (
        f"api/VERSION tem de conter exatamente o SHA, sem mais nada "
        f"(sem newline, sem espaços): {conteudo!r}"
    )


def test_cpanel_yml_esta_na_raiz_e_e_yaml_valido_com_uma_so_tarefa(
    tmp_path: Path,
) -> None:
    raiz_trabalho = _construir_arvore_completa(tmp_path)
    saida = tmp_path / "saida"

    resultado = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)

    assert resultado.returncode == 0, resultado.stderr
    caminho_cpanel_yml = saida / ".cpanel.yml"
    assert caminho_cpanel_yml.is_file(), (
        "'.cpanel.yml' tem de estar na raiz do pacote: o cPanel só o lê aí"
    )
    # Não impomos aqui se `.cpanel.yml` também fica (duplicado) dentro de
    # `deploy/`: o que importa, e o cPanel exige, é que exista na raiz. Se o
    # ficheiro de origem for `deploy/.cpanel.yml`, é natural que a cópia
    # inteira de `deploy/` o leve também para dentro do pacote — isso não é
    # um problema, só a ausência na raiz é que seria.

    tarefas = _analisar_cpanel_yml(caminho_cpanel_yml.read_text(encoding="utf-8"))
    assert len(tarefas) == 1, (
        f"'.cpanel.yml' tem de ter uma única tarefa em 'deployment.tasks', "
        f"encontrei {len(tarefas)}: {tarefas!r}"
    )


def test_idempotencia_duas_corridas_dao_a_mesma_arvore(tmp_path: Path) -> None:
    """Duas corridas seguidas, com o mesmo SHA, para a mesma pasta de saída, dão exatamente a mesma árvore."""
    raiz_trabalho = _construir_arvore_completa(tmp_path)
    saida = tmp_path / "saida"

    primeira = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)
    assert primeira.returncode == 0, primeira.stderr
    listagem_1 = _listar_ficheiros_relativos(saida)
    hashes_1 = _hashes_dos_ficheiros(saida)

    segunda = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)
    assert segunda.returncode == 0, segunda.stderr
    listagem_2 = _listar_ficheiros_relativos(saida)
    hashes_2 = _hashes_dos_ficheiros(saida)

    assert listagem_1 == listagem_2
    assert hashes_1 == hashes_2


# --- Recusas, contra árvores pequenas e fabricadas ---


def test_recusa_quando_frontend_dist_sem_index_html(tmp_path: Path) -> None:
    raiz_trabalho = _construir_arvore_minima(tmp_path, com_index_html=False)
    saida = tmp_path / "saida"

    resultado = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)

    assert resultado.returncode != 0, (
        "tem de recusar sem 'frontend/dist/index.html' (o build não correu)"
    )


@pytest.mark.parametrize(
    "sha_invalido",
    [
        "",
        "abc123",
        "a" * 39,
        "a" * 41,
        "A" * 40,  # maiúsculas: o padrão é `[0-9a-f]`, nunca `[0-9A-F]`
        "g" * 40,  # 'g' não é hexadecimal
        "../../../../etc/passwd" + "a" * 20,
        "a" * 40 + "\n",
    ],
    ids=[
        "vazio",
        "demasiado-curto-e-nao-hex",
        "39-caracteres",
        "41-caracteres",
        "maiusculas",
        "nao-hexadecimal",
        "tentativa-de-travessia-de-caminho",
        "newline-a-seguir",
    ],
)
def test_recusa_sha_fora_do_padrao(tmp_path: Path, sha_invalido: str) -> None:
    raiz_trabalho = _construir_arvore_minima(tmp_path)
    saida = tmp_path / "saida"

    resultado = _correr_montar(raiz_trabalho, sha=sha_invalido, saida=saida)

    assert resultado.returncode != 0, (
        f"tem de recusar um SHA fora de ^[0-9a-f]{{40}}$: {sha_invalido!r}"
    )


@pytest.mark.skipif(
    _A_CORRER_COMO_ROOT,
    reason="a correr como root, as permissões de ficheiros não bloqueiam a escrita",
)
def test_recusa_quando_pasta_de_saida_nao_pode_ser_limpa(tmp_path: Path) -> None:
    """A pasta de saída já existe, com um subitem que não se consegue remover.

    `bloqueada` fica sem nenhuma permissão: para `montar.sh` limpar `saida`
    por inteiro, tem de conseguir listar e apagar o que está dentro de
    `bloqueada`, e isso exige, no mínimo, permissão de execução nessa
    pasta. Sem ela, uma limpeza (`rm -rf`) falha a meio e `montar.sh` tem de
    detetar isso e sair com código diferente de zero — nunca seguir em
    frente como se a pasta estivesse limpa.
    """
    raiz_trabalho = _construir_arvore_minima(tmp_path)
    saida = tmp_path / "saida"
    saida.mkdir()
    bloqueada = saida / "bloqueada"
    bloqueada.mkdir()
    (bloqueada / "ficheiro.txt").write_text("conteudo falso\n", encoding="utf-8")
    bloqueada.chmod(0o000)

    try:
        resultado = _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)
        assert resultado.returncode != 0, (
            "tem de recusar quando a pasta de saída não pode ser limpa"
        )
    finally:
        bloqueada.chmod(0o755)
