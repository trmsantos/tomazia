"""Lint estrutural de `.github/workflows/deploy.yml` e `saude.yml` (F1-04, infra).

Usa `pyyaml`. **Dependência nova:** se `uv run pytest` falhar logo na
coleção deste ficheiro com `ModuleNotFoundError: No module named 'yaml'`,
é porque `pyyaml` ainda não está no grupo `dev` de `backend/pyproject.toml`
— o infra acrescenta-o (uma linha de justificação no PR, regra do
`CLAUDE.md`); se não acrescentar, avisa o Tomás. Não há `importorskip`
aqui de propósito: um `skip` silencioso deixaria passar despercebido que
este guarda nunca correu.

Nenhum destes testes importa ou corre os workflows — só faz `yaml.safe_load`
sobre o texto e inspeciona a árvore resultante. Não sabe nada sobre a
implementação de `deploy.sh`/`pedir-deploy.sh`/etc.; só sobre a forma do
YAML à volta deles. `deploy.yml` e `saude.yml` ainda não existem: os testes
falham agora com "ficheiro não encontrado", não com erro de sintaxe.

Fixação por SHA: aceita-se `uses: dono/acao@<40 hex>`, com ou sem
comentário `# vX.Y.Z` à frente (o YAML já descarta o comentário ao fazer
parse) — exatamente o padrão já usado em `ci.yml` e `claude.yml`.
"""

from __future__ import annotations

import re
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
