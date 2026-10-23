"""S-12: a pasta de deploy nunca leva `.claude/`, `CLAUDE.md`, `docs/`, `tests/` ou `e2e/`.

Regra 4 do `CLAUDE.md` da raiz; critério S-12 em `docs/ESPECIFICACAO.md`:
"Pasta de deploy com `.claude/`, `CLAUDE.md`, `docs/`, `tests/` ou `e2e/` →
CI falha". `docs/TAREFAS.md` (F1-04) descreve o mecanismo: "o CI corre
`montar.sh` e falha se a pasta tiver [...] (S-12, com o `CLAUDE.md`
excluído por padrão recursivo — há três)".

Planta cada proibido na árvore de origem e prova que não sai no pacote
produzido por `deploy/montar.sh`. Este ficheiro não testa nenhum
"verificador" isoladamente — não sabemos (nem precisamos de saber) se a
exclusão acontece dentro do próprio `montar.sh`, ou se um passo à parte do
CI é que inspeciona o pacote depois; testamos só o resultado, que é o que
interessa: o conteúdo da pasta que `montar.sh` produz.

Por isso, ao contrário de `tests/test_montar.py` (que exige
`returncode == 0` nos testes de contrato), os testes aqui não exigem
nenhum código de saída específico: um `montar.sh` que recuse (código ≠ 0)
ao encontrar algo proibido protege tanto quanto um que o exclua em
silêncio e termine com sucesso — o que nunca pode acontecer é o inverso,
`returncode == 0` com algo proibido dentro do pacote. Se `montar.sh`
recusar, a pasta de saída pode nem chegar a existir; tratamos isso como
"nada de proibido encontrado" (não há nada para encontrar).

`deploy/montar.sh` ainda não existe — é o infra que o escreve a seguir.
Por isso, hoje, a `fixture` de módulo `pacote` falha logo no arranque com
`FileNotFoundError` (nunca importamos o script, só o invocamos por
subprocesso), e todos os testes deste ficheiro aparecem como `ERROR` por
essa razão — não por erro de importação ou de recolha dos testes.

## O caso que mais importa: os três `CLAUDE.md` reais — e porque sozinhos não bastam

Há três `CLAUDE.md` no repositório: na raiz, em `backend/` e em
`frontend/`. Um padrão de exclusão ancorado na raiz do pacote (ex.:
`rm -f "$saida/CLAUDE.md"`) apanha só o primeiro e deixa os outros dois no
servidor. Os três ficheiros reais do repositório são o teste do padrão
recursivo — sem preparação nenhuma: a árvore de trabalho copia o
`backend/`, o `frontend/` e a raiz do repositório tal como estão.

**Achado da validação por mutação (pedida pelo Tomás, depois dos scripts
reais existirem):** `test_nenhum_dos_tres_claude_md_reais_sai_no_pacote`
sozinho **passava por acidente**. Um mutante de `montar.sh` que excluísse
`CLAUDE.md` só na raiz do pacote (exatamente o bug descrito acima) não
derrubava este teste nenhuma — porque `montar.sh` copia por uma lista
restrita de itens (`backend/app`, `backend/migrations`, ...,
`frontend/dist`, `deploy/`), nunca `backend/` ou `frontend/` por inteiro.
`backend/CLAUDE.md` e `frontend/CLAUDE.md` são SIBLINGS de `app/` e de
`dist/`, nunca copiados para dentro do pacote de qualquer forma — o teste
"dos três reais" testava uma exclusão que nunca chegava a ser exercitada.
A mesma lacuna existia em `test_pasta_claude_da_raiz_nao_sai_no_pacote`
(o `.claude/` real da raiz é, pela mesma razão, outro sibling nunca
copiado). Por isso este ficheiro planta TAMBÉM `CLAUDE.md` e `.claude/`
ANINHADOS dentro de `backend/app/` e de `frontend/dist/` (ver abaixo) —
são esses, não os três reais, que provam a sério o padrão recursivo.
Os três reais e o `.claude/` da raiz ficam como estavam (não fazem mal
nenhum, e protegem contra uma mudança futura de mecanismo), mas já não são
os únicos a dizer a esta história.

## As restantes plantações, e porque ficam dentro de pastas que são copiadas de certeza

`backend/CLAUDE.md`, `frontend/CLAUDE.md`, a `docs/` da raiz e o `.claude/`
da raiz nunca fariam parte do pacote de qualquer forma, mesmo com um
`montar.sh` que não exclua nada de propósito — nenhum deles está na lista
de itens que `.claude/agents/infra.md` diz que o pacote leva (`backend/app`,
`backend/migrations`, `backend/scripts`, `backend/alembic.ini`,
`backend/passenger_wsgi.py`, `backend/requirements.txt`, `frontend/dist`,
`deploy/`, `VERSION`). Para as plantações seguintes (e para `CLAUDE.md`/
`.claude/`, depois do achado acima) serem um teste a sério (que falha de
verdade com uma implementação descuidada, não só com uma lista de origem
mal escolhida), colocamo-las DENTRO de pastas que estão nessa lista —
`backend/app/`, `frontend/dist/` — onde uma cópia descuidada ("copiar a
pasta toda") as levaria mesmo, a não ser que `montar.sh` as exclua
explicitamente:

- `CLAUDE.md` dentro de `backend/app/` e dentro de `frontend/dist/` (ver
  acima: o achado da validação por mutação).
- `.claude/` (não vazia, com um ficheiro lá dentro) dentro de
  `frontend/dist/` (mesmo achado, para a diretoria).
- `docs/` vazia dentro de `frontend/dist/` (o caso do arquiteto: uma
  diretoria sem ficheiros lá dentro não tem `-type f` nenhum).
- `backend/app/tests/` vazia (caminho exato pedido pelo arquiteto).
- `.env` e `x.db`, dentro de `backend/app/`.
- `e2e/` dentro de `frontend/dist/`, com um ficheiro lá dentro (para além
  dos casos vazios acima, prova que uma diretoria proibida com conteúdo
  também não escapa).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]

SHA_VALIDO = hashlib.sha1(
    b"commit de teste do test_s12_pasta_de_deploy.py, nunca real"
).hexdigest()
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

NOMES_PROIBIDOS = {".claude", "CLAUDE.md", "docs", "tests", "e2e"}


def _ambiente() -> dict[str, str]:
    return os.environ.copy()


def _copiar_se_existir(origem: Path, destino: Path) -> None:
    if not origem.exists():
        return
    if origem.is_dir():
        shutil.copytree(origem, destino, ignore=_IGNORAR_NA_COPIA)
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origem, destino)


def _construir_arvore_com_proibidos_plantados(tmp_path: Path) -> Path:
    """Cópia de trabalho do repositório real, mais cada proibido do S-12 plantado.

    Os três `CLAUDE.md` reais (raiz, `backend/`, `frontend/`) e a `docs/` e
    o `.claude/` reais da raiz chegam de graça, ao copiar o conteúdo real
    do repositório — mas **não bastam sozinhos**: a validação por mutação
    pedida pelo Tomás confirmou que `montar.sh` copia por uma lista restrita
    de itens (`backend/app`, `backend/migrations`, ..., `frontend/dist`,
    `deploy/`), nunca `backend/` ou `frontend/` por inteiro — por isso
    `backend/CLAUDE.md`, `frontend/CLAUDE.md` e o `.claude/` da raiz nunca
    seriam copiados de qualquer forma, quer a exclusão recursiva funcione
    quer não. Um mutante que excluísse `CLAUDE.md` só na raiz do pacote (ou
    que deixasse de tratar `.claude/` como diretoria) não derrubava nada
    destes três testes "de graça" — passavam por acidente, não porque a
    exclusão recursiva estivesse a ser testada a sério. Por isso plantamos
    também `CLAUDE.md` e `.claude/` ANINHADOS dentro de `backend/app/` e de
    `frontend/dist/` (que são copiados de certeza), ao lado das restantes
    plantações (ver o docstring do módulo).
    """
    raiz = tmp_path / "trabalho"
    raiz.mkdir()

    _copiar_se_existir(RAIZ_REPO / "backend", raiz / "backend")
    _copiar_se_existir(RAIZ_REPO / "frontend", raiz / "frontend")
    _copiar_se_existir(RAIZ_REPO / "deploy", raiz / "deploy")
    _copiar_se_existir(RAIZ_REPO / "CLAUDE.md", raiz / "CLAUDE.md")
    _copiar_se_existir(RAIZ_REPO / "docs", raiz / "docs")
    _copiar_se_existir(RAIZ_REPO / ".claude", raiz / ".claude")

    # `frontend/dist` nunca existe no repositório real (é o resultado de
    # `npm run build`): fabricamo-lo, com o mínimo para ser um pacote
    # plausível, e plantamos aqui dentro os proibidos que precisam de estar
    # numa pasta copiada de certeza.
    pasta_dist = raiz / "frontend" / "dist"
    pasta_dist.mkdir(parents=True, exist_ok=True)
    (pasta_dist / "index.html").write_text(
        "<!doctype html><html></html>\n", encoding="utf-8"
    )
    (pasta_dist / "docs").mkdir()  # vazia, de propósito: o caso do arquiteto
    (pasta_dist / "e2e").mkdir()
    (pasta_dist / "e2e" / "exemplo.spec.ts").write_text(
        "// especificação falsa, nunca um teste a sério\n", encoding="utf-8"
    )
    (pasta_dist / "CLAUDE.md").write_text(
        "# instruções falsas, plantadas dentro de frontend/dist/\n",
        encoding="utf-8",
    )
    (pasta_dist / ".claude").mkdir()
    (pasta_dist / ".claude" / "agente-falso.md").write_text(
        "# agente falso, plantado dentro de frontend/dist/\n", encoding="utf-8"
    )

    pasta_app = raiz / "backend" / "app"
    (pasta_app / "tests").mkdir(parents=True)  # vazia, caminho exato do arquiteto
    (pasta_app / ".env").write_text(
        "SEGREDO_SESSAO=falso-nunca-real\n", encoding="utf-8"
    )
    (pasta_app / "x.db").write_bytes(b"conteudo binario falso, nunca uma bd real")
    (pasta_app / "CLAUDE.md").write_text(
        "# instruções falsas, plantadas dentro de backend/app/\n",
        encoding="utf-8",
    )

    return raiz


def _correr_montar(
    raiz_trabalho: Path, *, sha: str, saida: Path, timeout: float = 30
) -> subprocess.CompletedProcess[str]:
    script = raiz_trabalho / "deploy" / "montar.sh"
    return subprocess.run(
        [str(script), "--sha", sha, "--saida", str(saida)],
        cwd=raiz_trabalho,
        env=_ambiente(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _nomes_proibidos_presentes(pasta: Path, nomes: set[str]) -> set[str]:
    """Caminhos relativos, dentro de `pasta`, cujo nome (ficheiro OU diretoria, vazia ou não) está em `nomes`.

    De propósito, com `Path.rglob`, não com `find -type f`: uma diretoria
    vazia (p. ex. uma `docs/` sem nada lá dentro) continua a ser um
    resultado de `rglob`, mesmo sem conter nenhum ficheiro — é exatamente o
    caso que um guarda que só soubesse procurar ficheiros deixaria passar.
    Devolve um conjunto vazio se `pasta` nem sequer existir (tratado como
    "nada de proibido encontrado": ver o docstring do módulo sobre
    `montar.sh` poder recusar em vez de produzir pacote nenhum).
    """
    if not pasta.is_dir():
        return set()
    return {
        caminho.relative_to(pasta).as_posix()
        for caminho in pasta.rglob("*")
        if caminho.name in nomes
    }


@pytest.fixture(scope="module")
def pacote(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Corre `montar.sh` uma única vez sobre a árvore com os proibidos plantados; devolve a pasta de saída."""
    tmp_path = tmp_path_factory.mktemp("s12")
    raiz_trabalho = _construir_arvore_com_proibidos_plantados(tmp_path)
    saida = tmp_path / "saida"
    _correr_montar(raiz_trabalho, sha=SHA_VALIDO, saida=saida)
    return saida


# --- O caso que mais importa: os três `CLAUDE.md` reais ---


def test_premissa_ha_mesmo_tres_claude_md_no_repositorio() -> None:
    """Confirma a premissa do teste a seguir: se algum dia deixar de haver três, este teste (não o outro) é que tem de falhar."""
    encontrados = sorted(
        p.relative_to(RAIZ_REPO).as_posix() for p in RAIZ_REPO.rglob("CLAUDE.md")
    )
    assert encontrados == [
        "CLAUDE.md",
        "backend/CLAUDE.md",
        "frontend/CLAUDE.md",
    ], (
        f"esperava exatamente três CLAUDE.md reais (raiz, backend/, "
        f"frontend/), encontrei {encontrados!r} — se isto mudou de "
        f"propósito, o teste abaixo precisa de ser revisto"
    )


def test_nenhum_dos_tres_claude_md_reais_sai_no_pacote(pacote: Path) -> None:
    """Os três reais (raiz, `backend/`, `frontend/`) — e, de propósito, também os dois aninhados em `backend/app/`/`frontend/dist/`.

    Os três reais são *siblings* de `app/`/`dist/`: nunca seriam copiados
    de qualquer forma, com ou sem exclusão a funcionar (ver o achado da
    validação por mutação no docstring do módulo). `encontrados` aqui
    cobre as DUAS fontes ao mesmo tempo (é a mesma procura, sobre o mesmo
    pacote) — mas são os dois CLAUDE.md aninhados, plantados dentro de
    pastas copiadas de certeza, que fazem este teste cair de verdade
    contra um padrão de exclusão ancorado só na raiz do pacote.
    """
    encontrados = _nomes_proibidos_presentes(pacote, {"CLAUDE.md"})
    assert encontrados == set(), (
        f"CLAUDE.md não pode sair no pacote (há três reais: raiz, "
        f"backend/, frontend/; e dois aninhados, plantados dentro de "
        f"backend/app/ e frontend/dist/); um padrão ancorado na raiz do "
        f"pacote apanha só o real da raiz. Encontrados: {encontrados!r}"
    )


# --- Os restantes proibidos da raiz, que chegam de graça ao copiar o repositório ---


def test_pasta_claude_da_raiz_nao_sai_no_pacote(pacote: Path) -> None:
    """O `.claude/` real da raiz — e, de propósito, também o aninhado em `frontend/dist/`.

    Mesma ressalva do teste do `CLAUDE.md` acima: o `.claude/` real da
    raiz é um *sibling* de `backend/`/`frontend/`, nunca copiado de
    qualquer forma — é o `.claude/` aninhado dentro de `frontend/dist/`
    (plantado, não vazio) que faz este teste cair de verdade contra uma
    implementação que deixe de tratar `.claude/` como diretoria.
    """
    assert (RAIZ_REPO / ".claude").is_dir()  # premissa: existe mesmo, de graça
    encontrados = _nomes_proibidos_presentes(pacote, {".claude"})
    assert encontrados == set(), f".claude/ não pode sair no pacote: {encontrados!r}"


def test_docs_nao_sai_no_pacote(pacote: Path) -> None:
    """Cobre dois casos de uma só vez, porque os dois acabam no mesmo pacote e na mesma verificação:

    a `docs/` real da raiz (não vazia, chega de graça ao copiar o
    repositório) e uma `docs/` fabricada e **vazia** dentro de
    `frontend/dist/` — o caso que o arquiteto pediu para prender: uma
    diretoria sem ficheiros lá dentro não tem `-type f` nenhum.
    """
    assert (RAIZ_REPO / "docs").is_dir()  # premissa: a real existe, de graça
    encontrados = _nomes_proibidos_presentes(pacote, {"docs"})
    assert encontrados == set(), f"docs/ não pode sair no pacote: {encontrados!r}"


def test_tests_nao_sai_no_pacote(pacote: Path) -> None:
    """Cobre dois casos de uma só vez, porque os dois acabam no mesmo pacote e na mesma verificação:

    `backend/tests/` (a suite real, irmã de `app/`, com ficheiros a
    sério) e `backend/app/tests/` (fabricada e **vazia**, aninhada dentro
    de `app/` — caminho exato pedido pelo arquiteto). Não fixamos o
    caminho esperado dentro do pacote (p. ex. `api/tests`): não sabemos,
    nem precisamos de saber, que nome `montar.sh` dá à pasta que recebe o
    conteúdo de `backend/` — só que `tests/`, venha de onde vier, nunca
    pode sobreviver.
    """
    assert (
        RAIZ_REPO / "backend" / "tests"
    ).is_dir()  # premissa: a real existe, de graça
    encontrados = _nomes_proibidos_presentes(pacote, {"tests"})
    assert encontrados == set(), f"tests/ não pode sair no pacote: {encontrados!r}"


# --- As restantes plantações, dentro de pastas que fazem mesmo parte do pacote ---


def test_e2e_com_conteudo_dentro_de_frontend_dist_nao_sai_no_pacote(
    pacote: Path,
) -> None:
    encontrados = _nomes_proibidos_presentes(pacote, {"e2e"})
    assert encontrados == set(), f"e2e/ não pode sair no pacote: {encontrados!r}"
    # Nem sequer o ficheiro lá dentro, caso a diretoria tenha sobrevivido
    # mas só com parte do conteúdo filtrado:
    assert not list(pacote.rglob("exemplo.spec.ts"))


def test_env_plantado_dentro_de_backend_app_nao_sai_no_pacote(pacote: Path) -> None:
    assert not list(pacote.rglob(".env")), (
        "um .env (mesmo dentro de backend/app/, que faz parte do pacote) "
        "nunca pode sair no pacote de deploy"
    )


def test_x_db_plantado_dentro_de_backend_app_nao_sai_no_pacote(pacote: Path) -> None:
    assert not list(pacote.rglob("x.db")), (
        "um .db (mesmo dentro de backend/app/, que faz parte do pacote) "
        "nunca pode sair no pacote de deploy"
    )
