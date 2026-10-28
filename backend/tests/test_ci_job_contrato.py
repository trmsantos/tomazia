"""Lint estrutural do job `contrato` de `.github/workflows/ci.yml` (F2-09, infra).

O `ci.yml` não era afirmado por nenhum teste — ao contrário do
`deploy.yml` e do `saude.yml`, que têm o `test_workflows.py`. Este
ficheiro cobre a parte do `contrato` de que a F2-09 depende, e só essa.

Duas invariantes, e a segunda é a menos óbvia:

1. **A ordem.** O OpenAPI é exportado ANTES de os tipos serem gerados, e
   a guarda vem DEPOIS de os gerar. Uma guarda que corresse antes do
   gerador comparava o repositório consigo próprio e ficava verde para
   sempre.
2. **`frontend/openapi.json` é ignorado pelo git E o job exporta-o.** É
   o que fecha, por construção, o buraco de `python -m app.openapi` só
   escrever o ficheiro depois de construir o esquema com sucesso: um
   export falhado deixa o ficheiro antigo intacto, e uma corrida sobre um
   ficheiro velho pareceria perfeitamente saudável. No CI isso não pode
   acontecer porque o ficheiro NUNCA vem do checkout (está ignorado) e o
   export é um comando direto num `run:` — um `criar_app()` que rebente
   leva o job atrás, e os passos seguintes nem chegam a correr. Tirar o
   ficheiro do `.gitignore`, ou mover o export para um sítio onde a sua
   falha não derrube o job, reabre o buraco sem tocar em código nenhum.
   Daí as duas metades estarem presas no mesmo teste.

O YAML é lido como DADOS (`yaml.safe_load`), nunca com `grep` sobre
texto: um `grep` encontra a mesma palavra num comentário, num nome de
passo ou num job completamente diferente.

**Dependência:** `pyyaml`, já no grupo `dev` de `backend/pyproject.toml`
(ver o cabeçalho de `test_workflows.py`). Sem `importorskip` de
propósito: um `skip` silencioso deixaria passar despercebido que este
guarda nunca correu.

## O que estes testes deixam passar

- **Não provam comportamento nenhum.** Nada aqui corre o workflow. Um
  passo cujo `run:` não faça nada de útil — ou que falhe sempre, ou que
  passe sempre — continua a passar nestes testes, desde que esteja na
  posição certa e mencione o que se procura. O que a guarda FAZ está em
  `test_verificar_gerado_em_dia.py`; que o `gerar-api` gere mesmo alguma
  coisa não está em teste nenhum do backend.
- **Não verificam que `frontend/src/lib/api/gerado` existe no disco.** O
  caminho é afirmado como texto, no `--caminho` do passo. Se a pasta não
  existir, quem o diz é o CI a correr (a guarda sai 3), não estes testes.
- **Só olham para o job `contrato`.** O resto do `ci.yml` (jobs
  `backend`, `frontend`, `seguranca`, `resumo`) continua sem cobertura
  aqui.
- **A ordem é verificada por índice, não por dependência real.** Dois
  passos na ordem certa mas sem relação nenhuma entre si passam.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

RAIZ_REPO = Path(__file__).resolve().parents[2]
CAMINHO_CI_YML = RAIZ_REPO / ".github" / "workflows" / "ci.yml"
CAMINHO_GITIGNORE = RAIZ_REPO / ".gitignore"
SCRIPT_DA_GUARDA = RAIZ_REPO / ".github" / "scripts" / "verificar-gerado-em-dia.sh"

#: Artefacto gerado pelo `python -m app.openapi`, consumido pelo
#: `gerar-api`. Ignorado de propósito: ver o docstring do módulo.
OPENAPI_EXPORTADO = "frontend/openapi.json"

#: Prefixo onde os tipos gerados têm de viver. O resto de
#: `frontend/src/lib/api` é código escrito à mão (o cliente com
#: `X-Tomazia` e `credentials: "include"`) e tem toda a legitimidade para
#: divergir do que o gerador escreve.
PREFIXO_DOS_TIPOS_GERADOS = "frontend/src/lib/api/"


def _carregar_ci() -> dict[str, Any]:
    if not CAMINHO_CI_YML.is_file():
        pytest.fail(f"{CAMINHO_CI_YML} não existe.")
    conteudo = yaml.safe_load(CAMINHO_CI_YML.read_text(encoding="utf-8"))
    assert isinstance(conteudo, dict), f"{CAMINHO_CI_YML} não é um mapeamento YAML."
    return conteudo


def _passos_do_contrato() -> list[dict[str, Any]]:
    jobs = _carregar_ci().get("jobs")
    assert isinstance(jobs, dict), "o ci.yml não tem 'jobs'."
    contrato = jobs.get("contrato")
    assert isinstance(contrato, dict), (
        "o job 'contrato' desapareceu do ci.yml. O nome é um contrato "
        "público (ver o cabeçalho do ficheiro): se mudou de propósito, "
        "este teste muda com ele, no mesmo PR."
    )
    passos = contrato.get("steps")
    assert isinstance(passos, list) and passos, "o job 'contrato' não tem passos."
    for passo in passos:
        assert isinstance(passo, dict), f"passo que não é um mapeamento: {passo!r}"
    return passos


def _indice_por_run(
    passos: list[dict[str, Any]], agulha: str, *, excluindo: str | None = None
) -> int:
    """Índice do ÚNICO passo cujo `run:` contém `agulha` (e não contém `excluindo`). Zero ou vários é falha, nunca um palpite.

    `excluindo` existe por um caso concreto: a própria guarda menciona
    `gerar-api` dentro do `--sugestao`, por isso procurar só por
    "gerar-api" encontra dois passos. Excluir pelo nome do script
    distingue-os sem depender do texto exato do comando que gera.
    """
    indices = [
        i
        for i, p in enumerate(passos)
        if agulha in (p.get("run") or "")
        and (excluindo is None or excluindo not in (p.get("run") or ""))
    ]
    if not indices:
        pytest.fail(
            f"nenhum passo do job 'contrato' corre algo com {agulha!r}. "
            f"Passos: {[p.get('name') for p in passos]!r}"
        )
    if len(indices) > 1:
        pytest.fail(
            f"{len(indices)} passos do job 'contrato' correm algo com "
            f"{agulha!r} (índices {indices}); este teste não sabe qual é o "
            "que interessa, e adivinhar seria pior do que falhar."
        )
    return indices[0]


def _indice_por_uses(passos: list[dict[str, Any]], agulha: str) -> int:
    """Índice do ÚNICO passo cujo `uses:` contém `agulha`."""
    indices = [i for i, p in enumerate(passos) if agulha in (p.get("uses") or "")]
    if not indices:
        pytest.fail(
            f"nenhum passo do job 'contrato' usa {agulha!r}. "
            f"Passos: {[p.get('name') for p in passos]!r}"
        )
    if len(indices) > 1:
        pytest.fail(
            f"{len(indices)} passos do job 'contrato' usam {agulha!r} "
            f"(índices {indices}); este teste não sabe qual é o que interessa."
        )
    return indices[0]


def _passo_da_guarda(passos: list[dict[str, Any]]) -> dict[str, Any]:
    return passos[_indice_por_run(passos, SCRIPT_DA_GUARDA.name)]


# --- A ordem dos passos ---


def test_o_openapi_e_exportado_antes_de_gerar_os_tipos() -> None:
    """O gerador lê `frontend/openapi.json`; se o export viesse depois, leria o ficheiro errado (ou nenhum).

    Deixa passar: que o export produza um esquema correto — só que corre
    antes.
    """
    passos = _passos_do_contrato()

    indice_export = _indice_por_run(passos, "app.openapi")
    indice_gerar = _indice_por_run(passos, "gerar-api", excluindo=SCRIPT_DA_GUARDA.name)

    assert indice_export < indice_gerar, (
        f"o export do OpenAPI (passo {indice_export}) tem de vir antes do "
        f"'gerar-api' (passo {indice_gerar}): o gerador lê o ficheiro que "
        "o export escreve."
    )


def test_a_guarda_vem_depois_de_gerar_os_tipos() -> None:
    """A guarda compara o disco com o que está versionado: antes do gerador, comparava o repositório consigo próprio.

    Deixa passar: uma guarda que corra o script com os argumentos
    errados — isso é `test_o_caminho_vigiado_e_a_pasta_dos_tipos_gerados`.
    """
    passos = _passos_do_contrato()

    indice_gerar = _indice_por_run(passos, "gerar-api", excluindo=SCRIPT_DA_GUARDA.name)
    indice_guarda = _indice_por_run(passos, SCRIPT_DA_GUARDA.name)

    assert indice_gerar < indice_guarda, (
        f"a guarda (passo {indice_guarda}) tem de correr DEPOIS do "
        f"'gerar-api' (passo {indice_gerar}); antes dele não compara nada."
    )


def test_os_jq_verificam_o_export_antes_de_o_node_existir() -> None:
    """Os dois `jq` são a verificação do primeiro elo, e correm antes de o Node ser instalado.

    É o que distingue "o backend não soube exportar o esquema" de "o
    gerador de tipos não soube ler o esquema": sem eles, as duas avarias
    chegavam ao `gerar-api` e saíam de lá com a mesma cara.

    Deixa passar: o conteúdo do esquema para além da rota `/health`.
    """
    passos = _passos_do_contrato()

    indice_export = _indice_por_run(passos, "app.openapi")
    indice_json_valido = _indice_por_run(passos, "jq empty")
    indice_tem_health = _indice_por_run(passos, '.paths["/health"]')
    indice_node = _indice_por_uses(passos, "actions/setup-node")

    for nome, indice in (
        ("jq empty", indice_json_valido),
        ("jq .paths[/health]", indice_tem_health),
    ):
        assert indice_export < indice < indice_node, (
            f"o passo {nome} (índice {indice}) tem de correr depois do "
            f"export (índice {indice_export}) e antes do setup-node "
            f"(índice {indice_node}); senão deixa de distinguir um export "
            "avariado de um gerador avariado."
        )


# --- A guarda em si ---


def test_a_guarda_chama_o_script_partilhado() -> None:
    """A guarda não volta a ser um `if [ -n "$(git status ...)" ]` embutido no `run:`.

    Essa forma engole o estado do git: com o `git` a falhar, a saída vem
    vazia, o `-n` dá falso e o passo fica verde (dentro da condição de um
    `if`, o `set -e` está desligado). O script tem estados de saída
    distintos e é testado em `test_verificar_gerado_em_dia.py`.

    Deixa passar: um `run:` que chame o script e depois faça `|| true` —
    nada aqui lê o resto do comando.
    """
    passos = _passos_do_contrato()
    passo = _passo_da_guarda(passos)
    comando = passo.get("run") or ""

    assert SCRIPT_DA_GUARDA.is_file(), (
        f"o passo da guarda chama {SCRIPT_DA_GUARDA.name}, mas "
        f"{SCRIPT_DA_GUARDA} não existe no repositório."
    )
    assert os.access(SCRIPT_DA_GUARDA, os.X_OK), (
        f"{SCRIPT_DA_GUARDA} tem de estar versionado com o bit de "
        "execução: o passo invoca-o diretamente, não através de 'bash'."
    )
    assert "--caminho" in comando, (
        "a guarda tem de passar pelo menos um --caminho; sem caminhos o "
        f"script recusa-se a correr. Comando:\n{comando}"
    )
    assert "working-directory" not in passo, (
        "o passo da guarda não pode ter 'working-directory': tanto o "
        "caminho do script como o --caminho são relativos à raiz do "
        f"checkout. Passo: {passo!r}"
    )


def test_o_caminho_vigiado_e_a_pasta_dos_tipos_gerados() -> None:
    """O caminho vigiado é a pasta dos tipos GERADOS, não `src/lib/api` inteiro.

    O resto de `src/lib/api` é código escrito à mão — o cliente com
    `X-Tomazia` e `credentials: "include"` — lintado e testado pelo job
    `frontend`. Vigiá-lo com esta guarda fazia o CI exigir que código de
    pessoas coincidisse com o que um gerador escreve.

    Deixa passar: que a pasta exista. Se o `gerar-api` não escrever lá
    nada, quem o diz é a guarda a correr no CI (sai 3), não este teste —
    aqui o caminho é só texto.
    """
    passos = _passos_do_contrato()
    comando = _passo_da_guarda(passos).get("run") or ""

    caminhos = re.findall(r"--caminho\s+(\S+)", comando)
    assert caminhos, f"não encontrei nenhum valor de --caminho em:\n{comando}"

    for caminho in caminhos:
        assert caminho.startswith(PREFIXO_DOS_TIPOS_GERADOS), (
            f"o --caminho {caminho!r} tem de estar dentro de "
            f"{PREFIXO_DOS_TIPOS_GERADOS!r}."
        )
        assert caminho.rstrip("/") != PREFIXO_DOS_TIPOS_GERADOS.rstrip("/"), (
            f"o --caminho não pode ser {PREFIXO_DOS_TIPOS_GERADOS!r} "
            "inteiro: essa pasta tem também o cliente escrito à mão, que "
            "não é gerado e não tem de coincidir com nada."
        )


# --- A invariante que fecha o buraco do export que falha ---


def _git_diz_que_e_ignorado(caminho_relativo: str) -> bool:
    """Pergunta ao git, não ao texto do `.gitignore`: as regras podem estar em vários ficheiros e negar-se umas às outras.

    `0` = ignorado, `1` = não ignorado, `>= 2` = não consegui perguntar —
    e este último nunca pode ser lido como "não ignorado" (regra 10).
    """
    resultado = subprocess.run(
        [
            "git",
            "-C",
            str(RAIZ_REPO),
            "check-ignore",
            "--no-index",
            "--",
            caminho_relativo,
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if resultado.returncode == 0:
        return True
    if resultado.returncode == 1:
        return False
    pytest.fail(
        "'git check-ignore' não respondeu (estado "
        f"{resultado.returncode}); não é seguro concluir que "
        f"{caminho_relativo!r} não está ignorado.\nstderr:\n{resultado.stderr}"
    )


def test_openapi_json_e_ignorado_pelo_git_e_o_job_exporta_o() -> None:
    """As duas metades da resposta ao export que falha em silêncio, presas juntas.

    `python -m app.openapi` só escreve o ficheiro depois de construir o
    esquema com sucesso — um export falhado deixa o ficheiro antigo
    INTACTO. No CI isso não chega a ser um problema por duas razões
    estruturais, e só juntas:

    1. `frontend/openapi.json` está ignorado, por isso nunca vem do
       checkout: não há ficheiro antigo nenhum para sobreviver.
    2. O export é um comando direto num `run:`, por isso um `criar_app()`
       que rebente leva o job atrás e os passos seguintes nem correm.

    Tirar o ficheiro do `.gitignore` reabre o buraco sem tocar em código
    nenhum — e é por isso que isto é um teste, e não um comentário.

    Deixa passar: o passo de export podia ter `continue-on-error: true` e
    este teste não dava por nada (nada aqui lê essa chave); e nada aqui
    prova que o `app.openapi` escreve mesmo o ficheiro — isso é
    `test_openapi_export.py`.
    """
    passos = _passos_do_contrato()

    # Metade 1: o git ignora-o mesmo (a pergunta é feita ao git, não ao texto).
    assert _git_diz_que_e_ignorado(OPENAPI_EXPORTADO), (
        f"{OPENAPI_EXPORTADO} deixou de estar ignorado pelo git: passa a "
        "poder vir do checkout, e um export falhado deixaria o job a "
        "trabalhar sobre um esquema velho sem ninguém dar por isso."
    )
    # E a regra tem de estar à vista no .gitignore da raiz, onde se procura.
    linhas = [
        linha.strip()
        for linha in CAMINHO_GITIGNORE.read_text(encoding="utf-8").splitlines()
    ]
    assert OPENAPI_EXPORTADO in linhas, (
        f"{OPENAPI_EXPORTADO} tem de estar no {CAMINHO_GITIGNORE.name} da "
        "raiz, onde quem procura o vai ler — não só a ser ignorado por "
        "alguma regra indireta."
    )

    # Metade 2: o job exporta-o, num `run:` cuja falha derruba o job.
    passo_export = passos[_indice_por_run(passos, "app.openapi")]
    assert passo_export.get("continue-on-error") in (None, False), (
        "o passo de export não pode ter 'continue-on-error': a sua falha "
        "é o que impede os passos seguintes de correrem sobre um esquema "
        f"que não existe. Passo: {passo_export!r}"
    )
