"""Lint estrutural de `.github/workflows/deploy.yml` e `saude.yml` (F1-04, infra).

Usa `pyyaml`. **Dependência nova:** se `uv run pytest` falhar logo na
coleção deste ficheiro com `ModuleNotFoundError: No module named 'yaml'`,
é porque `pyyaml` ainda não está no grupo `dev` de `backend/pyproject.toml`
— o infra acrescenta-o (uma linha de justificação no PR, regra do
`CLAUDE.md`); se não acrescentar, avisa o Tomás. Não há `importorskip`
aqui de propósito: um `skip` silencioso deixaria passar despercebido que
este guarda nunca correu.

Quase todos estes testes são lint estrutural: fazem `yaml.safe_load` sobre o
texto e inspecionam a árvore resultante, sem saber nada sobre a
implementação de `deploy.sh`/`pedir-deploy.sh`/etc. — só sobre a forma do
YAML à volta deles.

A exceção, no fim do ficheiro, são os dois testes do guarda do job
`porteiro`: esses extraem o `run:` desse passo da árvore YAML e **correm-no
mesmo**, com `bash`, num ambiente fabricado e com `gh` e `jq` substituídos
por stubs. Um lint estrutural não servia ali: a verificação vive dentro de
um `if` em shell, e só exercitá-la prova que um `workflow_run` vindo de um
fork é mesmo recusado. Nada disso contacta o GitHub (ver o docstring de
`_correr_guarda_do_porteiro`).

Fixação por SHA: aceita-se `uses: dono/acao@<40 hex>`, com ou sem
comentário `# vX.Y.Z` à frente (o YAML já descarta o comentário ao fazer
parse) — exatamente o padrão já usado em `ci.yml` e `claude.yml`.
"""

from __future__ import annotations

import json
import re
import stat
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

RAIZ_REPO = Path(__file__).resolve().parents[2]
CAMINHO_DEPLOY_YML = RAIZ_REPO / ".github" / "workflows" / "deploy.yml"
CAMINHO_SAUDE_YML = RAIZ_REPO / ".github" / "workflows" / "saude.yml"

_PADRAO_SHA40 = re.compile(r"^[^@\s]+@([0-9a-f]{40})$")


def _carregar(caminho: Path) -> dict[str, Any]:
    if not caminho.is_file():
        pytest.fail(f"{caminho} ainda não existe (é o infra que o escreve, na F1-04).")
    conteudo = yaml.safe_load(caminho.read_text(encoding="utf-8"))
    assert isinstance(conteudo, dict), f"{caminho} não é um mapeamento YAML válido."
    return conteudo


def _jobs(workflow: dict[str, Any]) -> dict[str, dict[str, Any]]:
    jobs = workflow.get("jobs")
    assert isinstance(jobs, dict) and jobs, "O workflow não tem nenhum job em 'jobs'."
    return jobs


def _passos(job: dict[str, Any]) -> list[dict[str, Any]]:
    passos = job.get("steps", [])
    assert isinstance(passos, list)
    return passos


def _usa_de_terceiros(uses: str) -> bool:
    """`True` para ações de terceiros (owner/repo@ref); `False` para ações locais (./caminho) ou docker://...`."""
    return not uses.startswith("./") and not uses.startswith("docker://")


def _todos_os_usos(workflow: dict[str, Any]) -> list[str]:
    usos: list[str] = []
    for job in _jobs(workflow).values():
        for passo in _passos(job):
            uses = passo.get("uses")
            if isinstance(uses, str):
                usos.append(uses)
    return usos


def _valores_recursivos(valor: Any) -> list[str]:
    """Todos os valores-folha de texto, em profundidade — para procurar `${{ secrets. ... }}` onde quer que esteja."""
    encontrados: list[str] = []
    if isinstance(valor, str):
        encontrados.append(valor)
    elif isinstance(valor, dict):
        for sub in valor.values():
            encontrados.extend(_valores_recursivos(sub))
    elif isinstance(valor, list):
        for sub in valor:
            encontrados.extend(_valores_recursivos(sub))
    return encontrados


def _chaves_recursivas(valor: Any) -> list[str]:
    encontradas: list[str] = []
    if isinstance(valor, dict):
        for chave, sub in valor.items():
            encontradas.append(str(chave))
            encontradas.extend(_chaves_recursivas(sub))
    elif isinstance(valor, list):
        for sub in valor:
            encontradas.extend(_chaves_recursivas(sub))
    return encontradas


def _usa_segredos(job: dict[str, Any]) -> bool:
    return any("secrets." in valor for valor in _valores_recursivos(job))


def _nome_do_environment(job: dict[str, Any]) -> str | None:
    ambiente = job.get("environment")
    if isinstance(ambiente, str):
        return ambiente
    if isinstance(ambiente, dict):
        nome = ambiente.get("name")
        return nome if isinstance(nome, str) else None
    return None


WORKFLOWS = pytest.mark.parametrize(
    "caminho",
    [CAMINHO_DEPLOY_YML, CAMINHO_SAUDE_YML],
    ids=["deploy.yml", "saude.yml"],
)


@WORKFLOWS
def test_ficheiro_existe_e_e_yaml_valido(caminho: Path) -> None:
    _carregar(caminho)


@WORKFLOWS
def test_acoes_de_terceiros_fixadas_por_sha40(caminho: Path) -> None:
    """Toda ação de terceiros (`uses:`) fixada por SHA de 40 hex.

    Não exige que exista pelo menos uma: um job que só corre `curl` (como
    `saude.yml` bem pode fazer) não usa nenhuma ação — não há nada a
    prender aqui, e exigir uma seria inventar um requisito novo.
    """
    workflow = _carregar(caminho)
    usos = [uso for uso in _todos_os_usos(workflow) if _usa_de_terceiros(uso)]
    for uso in usos:
        assert _PADRAO_SHA40.match(uso), (
            f"{uso!r} em {caminho.name} não está fixado por um SHA de 40 "
            "hexadecimais (owner/repo@<40 hex>)."
        )


@WORKFLOWS
def test_permissions_declaradas_em_todos_os_jobs(caminho: Path) -> None:
    workflow = _carregar(caminho)
    for nome_job, job in _jobs(workflow).items():
        assert "permissions" in job, (
            f"O job {nome_job!r} de {caminho.name} não declara 'permissions' próprias."
        )


@WORKFLOWS
def test_timeout_minutes_em_todos_os_jobs(caminho: Path) -> None:
    workflow = _carregar(caminho)
    for nome_job, job in _jobs(workflow).items():
        assert "timeout-minutes" in job, (
            f"O job {nome_job!r} de {caminho.name} não declara 'timeout-minutes'."
        )


@WORKFLOWS
def test_concurrency_cancel_in_progress_false(caminho: Path) -> None:
    workflow = _carregar(caminho)
    concorrencia = workflow.get("concurrency")
    assert isinstance(concorrencia, dict), (
        f"{caminho.name} não declara 'concurrency' ao nível do workflow."
    )
    assert concorrencia.get("cancel-in-progress") is False, (
        f"{caminho.name}: 'concurrency.cancel-in-progress' tem de ser "
        "explicitamente 'false' — um deploy ou uma verificação de saúde a "
        "meio nunca pode ser cancelado por uma corrida seguinte."
    )


@WORKFLOWS
def test_environment_production_nos_jobs_com_segredos(caminho: Path) -> None:
    workflow = _carregar(caminho)
    jobs_com_segredos = {
        nome: job for nome, job in _jobs(workflow).items() if _usa_segredos(job)
    }
    assert jobs_com_segredos, (
        f"Nenhum job de {caminho.name} usa segredos (${{{{ secrets.* }}}}) — "
        "inesperado para um workflow de deploy ou de verificação de saúde."
    )
    for nome_job, job in jobs_com_segredos.items():
        assert _nome_do_environment(job) == "production", (
            f"O job {nome_job!r} de {caminho.name} usa segredos mas não tem "
            "'environment: production'."
        )


@WORKFLOWS
def test_sem_pull_request_target(caminho: Path) -> None:
    workflow = _carregar(caminho)
    chaves = _chaves_recursivas(workflow.get("on", {}))
    assert "pull_request_target" not in chaves, (
        f"{caminho.name} reage a pull_request_target — nunca com checkout "
        "do código de um PR de fora."
    )


def test_job_publicar_e_o_unico_com_contents_write() -> None:
    workflow = _carregar(CAMINHO_DEPLOY_YML)
    jobs = _jobs(workflow)
    jobs_com_escrita = [
        nome
        for nome, job in jobs.items()
        if isinstance(job.get("permissions"), dict)
        and job["permissions"].get("contents") == "write"
    ]
    assert jobs_com_escrita == ["publicar"], (
        "O único job com 'permissions.contents: write' em deploy.yml tem de "
        f"se chamar 'publicar'. Encontrados: {jobs_com_escrita!r}."
    )


def test_saude_yml_nao_tem_nenhum_job_com_contents_write() -> None:
    workflow = _carregar(CAMINHO_SAUDE_YML)
    for nome_job, job in _jobs(workflow).items():
        permissoes = job.get("permissions")
        if isinstance(permissoes, dict):
            assert permissoes.get("contents") != "write", (
                f"O job {nome_job!r} de saude.yml não precisa de escrever no "
                "repositório — é só uma verificação de /api/health."
            )


_PADRAO_GESTOR_DE_PACOTES = re.compile(
    r"(?<![\w./-])(npm|npx|pip3?|uv|uvx|yarn|pnpm)(?![\w./-])"
)


def test_job_publicar_nao_corre_gestor_de_pacotes_nenhum() -> None:
    """O job publicar é o único com contents: write — a mesma ameaça do claude.yml: um postinstall malicioso a ler o token do .git/config."""
    workflow = _carregar(CAMINHO_DEPLOY_YML)
    jobs = _jobs(workflow)
    assert "publicar" in jobs, "deploy.yml não tem um job chamado 'publicar'."
    job_publicar = jobs["publicar"]
    for passo in _passos(job_publicar):
        comando = passo.get("run")
        if not isinstance(comando, str):
            continue
        correspondencia = _PADRAO_GESTOR_DE_PACOTES.search(comando)
        assert correspondencia is None, (
            "O job 'publicar' (o único com contents: write) corre "
            f"{correspondencia.group(0) if correspondencia else '?'!r} num "
            f"passo: {passo.get('name', '(sem nome)')!r}. Isso abre a porta "
            "a um postinstall malicioso a ler o token do .git/config, tal "
            "como no claude.yml."
        )


# --- O guarda do job `porteiro` contra um workflow_run de um fork ---------
#
# `on: workflow_run: branches: [main]` filtra pelo NOME da branch que
# terminou, não pelo repositório onde ela vive. Um PR de um fork cuja branch
# se chame `main` faz o `ci.yml` correr e, ao terminar, dispara este
# `deploy.yml` — e um `workflow_run` corre sempre no contexto do repositório
# BASE, com os segredos dele. A única coisa que separa esse cenário de um
# deploy a sério é a comparação de `head_repository.full_name` com
# `GITHUB_REPOSITORY`, dentro do passo do `porteiro`. Até esta ronda não
# tinha teste nenhum.
#
# Dois testes, e os dois fazem falta: o do fork prova que recusa, e o do
# próprio repositório é o controlo — sem ele, um erro no arnês (um stub
# partido, um `${{ ... }}` que o bash não sabe ler) daria "recusou" por
# razão nenhuma e passaria por prova.

#: Um SHA sintaticamente válido, de commit nenhum: o guarda do `porteiro`
#: só exige `^[0-9a-f]{40}$`, e a confirmação contra a API é feita por um
#: stub aqui.
SHA_FALSO = "0" * 39 + "a"

#: O repositório real, tal como o Actions o põe em `GITHUB_REPOSITORY`.
REPOSITORIO_BASE = "trmsantos/tomazia"

_EXPRESSAO_REPOSITORIO_DE_ORIGEM = (
    "${{ github.event.workflow_run.head_repository.full_name }}"
)


def _passo_do_guarda_do_porteiro() -> tuple[str, dict[str, Any]]:
    """O `run:` do passo do `porteiro` que valida o `workflow_run`, e o `env:` dele.

    O passo é localizado pelo que importa — ser ele a receber
    `head_repository.full_name` — e nunca pela posição ou pelo nome. Se essa
    ligação desaparecer do `env:`, isto falha aqui mesmo: sem ela, o shell
    lá dentro estaria a comparar uma variável vazia com o repositório, e o
    `if` nunca dispararia.
    """
    workflow = _carregar(CAMINHO_DEPLOY_YML)
    jobs = _jobs(workflow)
    assert "porteiro" in jobs, "deploy.yml não tem um job chamado 'porteiro'."

    candidatos = [
        passo
        for passo in _passos(jobs["porteiro"])
        if isinstance(passo, dict)
        and isinstance(passo.get("run"), str)
        and isinstance(passo.get("env"), dict)
        and _EXPRESSAO_REPOSITORIO_DE_ORIGEM in passo["env"].values()
    ]
    assert len(candidatos) == 1, (
        "Esperava exatamente um passo do job 'porteiro' a receber "
        f"{_EXPRESSAO_REPOSITORIO_DE_ORIGEM!r} no seu 'env:' (encontrei "
        f"{len(candidatos)}). É a única coisa que distingue um workflow_run "
        "deste repositório de um workflow_run de um fork cuja branch também "
        "se chame 'main' — e o 'run:' desse passo tem de o comparar com "
        "GITHUB_REPOSITORY."
    )
    passo = candidatos[0]
    return passo["run"], passo["env"]


def _nome_da_variavel_do_repositorio_de_origem(ambiente: dict[str, Any]) -> str:
    nomes = [
        nome
        for nome, valor in ambiente.items()
        if valor == _EXPRESSAO_REPOSITORIO_DE_ORIGEM
    ]
    assert len(nomes) == 1, (
        f"Esperava uma variável de ambiente ligada a "
        f"{_EXPRESSAO_REPOSITORIO_DE_ORIGEM!r} (vi {nomes!r})."
    )
    return str(nomes[0])


def _preparar_stubs(tmp_path: Path, resposta_da_api: str) -> Path:
    """`gh` e `jq` falsos, numa pasta própria para pôr à frente no `PATH`.

    O `gh` devolve a resposta que o teste lhe mandar devolver e NUNCA toca
    numa rede (regra 3 do `CLAUDE.md`: os agentes vivem só no repositório).
    O `jq` falso só sabe o que o guarda lhe pede: ler uma chave de topo
    (`.head_sha`, `.conclusion`, `.status`) de um objeto JSON vindo do
    stdin, com a semântica de `-r` para texto.
    """
    pasta = tmp_path / "bin"
    pasta.mkdir()

    (pasta / "gh").write_text(
        '#!/usr/bin/env bash\nprintf %s "${TOMAZIA_TESTE_RESPOSTA_GH}"\n',
        encoding="utf-8",
    )
    (pasta / "jq").write_text(
        "#!/usr/bin/env bash\n"
        'filtro=""\n'
        'for argumento in "$@"; do filtro="$argumento"; done\n'
        "python3 -c '\n"
        "import json, sys\n"
        'valor = json.load(sys.stdin).get(sys.argv[1].lstrip("."))\n'
        "print(valor if isinstance(valor, str) else json.dumps(valor))\n"
        '\' "$filtro"\n',
        encoding="utf-8",
    )
    for nome in ("gh", "jq"):
        caminho = pasta / nome
        caminho.chmod(
            caminho.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
        )

    _ = resposta_da_api  # entregue por variável de ambiente, nunca por argumento
    return pasta


def _correr_guarda_do_porteiro(
    tmp_path: Path, *, repositorio_de_origem: str
) -> subprocess.CompletedProcess[str]:
    """Corre, com `bash`, o `run:` do guarda do `porteiro`, num mundo fabricado.

    Nada aqui fala com o GitHub: `gh` e `jq` são stubs no `PATH`, e a
    resposta "da API" é a que este arnês escreve. O cenário é sempre o mais
    favorável possível a um atacante — CI com sucesso, numa branch chamada
    `main`, SHA bem formado, e a API a confirmar tudo — para que a ÚNICA
    coisa que decide o resultado seja o repositório de onde o
    `workflow_run` veio.
    """
    comando, ambiente_do_passo = _passo_do_guarda_do_porteiro()
    assert "${{" not in comando, (
        "O 'run:' do guarda do porteiro tem expressões ${{ ... }} do Actions "
        "lá dentro; o bash não as sabe ler, e este teste deixaria de provar "
        "o que diz provar. Os valores têm de entrar por 'env:'."
    )
    nome_variavel = _nome_da_variavel_do_repositorio_de_origem(ambiente_do_passo)

    resposta = json.dumps(
        {"head_sha": SHA_FALSO, "conclusion": "success", "status": "completed"}
    )
    pasta_stubs = _preparar_stubs(tmp_path, resposta)

    guiao = tmp_path / "passo-do-porteiro.sh"
    guiao.write_text(comando, encoding="utf-8")

    return subprocess.run(
        ["bash", str(guiao)],
        cwd=str(tmp_path),
        env={
            "PATH": f"{pasta_stubs}:/usr/bin:/bin",
            "HOME": str(tmp_path),
            "GH_TOKEN": "token-falso-de-teste-nunca-usado",
            "GITHUB_REPOSITORY": REPOSITORIO_BASE,
            "GITHUB_OUTPUT": str(tmp_path / "github-output"),
            "NOME_WORKFLOW": "CI",
            "CONCLUSAO": "success",
            "RAMO": "main",
            "SHA": SHA_FALSO,
            "RUN_ID": "1234567890",
            nome_variavel: repositorio_de_origem,
            "TOMAZIA_TESTE_RESPOSTA_GH": resposta,
        },
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_porteiro_recusa_um_workflow_run_de_um_fork(tmp_path: Path) -> None:
    """Um PR de um fork cuja branch se chame `main` dispara este workflow com o contexto (e os segredos) do repositório base."""
    fork = "atacante/tomazia"
    resultado = _correr_guarda_do_porteiro(tmp_path, repositorio_de_origem=fork)

    assert resultado.returncode != 0, (
        f"O guarda do 'porteiro' aceitou um workflow_run vindo de {fork!r}. "
        "Tudo o resto bate certo de propósito neste cenário (CI com sucesso, "
        "branch 'main', SHA válido, API a confirmar): a comparação de "
        "head_repository.full_name com GITHUB_REPOSITORY é a única coisa que "
        "separa isto de um deploy a sério, com o token do cPanel pelo "
        f"caminho.\nstdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
    saida = resultado.stdout + resultado.stderr
    assert fork in saida, (
        "A recusa não nomeia o repositório de onde veio o workflow_run — "
        "sem isso não se distingue esta recusa de qualquer outra do mesmo "
        f"passo:\n{saida}"
    )


def test_porteiro_aceita_um_workflow_run_do_proprio_repositorio(
    tmp_path: Path,
) -> None:
    """Controlo do arnês: no cenário idêntico, mas vindo do repositório base, o guarda tem de deixar passar.

    Sem este controlo, `test_porteiro_recusa_um_workflow_run_de_um_fork`
    passava por acidente — um stub partido, uma variável em falta ou um
    `set -u` a disparar davam "recusou" sem a verificação do repositório
    existir sequer.
    """
    resultado = _correr_guarda_do_porteiro(
        tmp_path, repositorio_de_origem=REPOSITORIO_BASE
    )

    assert resultado.returncode == 0, (
        "O guarda do 'porteiro' recusou um workflow_run legítimo (mesmo "
        "repositório, branch 'main', CI com sucesso, API a confirmar). Ou "
        "regrediu, ou o arnês deste teste deixou de reproduzir o ambiente do "
        f"passo.\nstdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
