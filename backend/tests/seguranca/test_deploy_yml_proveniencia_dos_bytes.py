"""A proveniência dos BYTES que o `deploy.yml` executa (ronda de segurança da F1-04).

## O achado que estes testes prendem

O job `montar` corre `npm ci` — código de terceiros, com escrita em TODA a
árvore de trabalho desse job, `deploy/` incluído — e só DEPOIS monta o
pacote e o publica como artefacto. Enquanto os jobs `pedir` e `verificar`
iam buscar `deploy/pedir-deploy.sh` e `deploy/esperar-versao.sh` a esse
artefacto, um `postinstall` malicioso tinha um canal direto para o único
sítio do pipeline onde o token do cPanel existe: reescrevia o script em
`deploy/`, `montar.sh` copiava-o para o pacote sem dar por isso, e o job
`pedir` executava-o com `secrets.TOMAZIA_CPANEL_TOKEN` no ambiente. O
S-12/S-10 do job `montar` não apanha nada disto: olha para NOMES de
caminho, nunca para a proveniência dos bytes.

A correção tem três metades, e as três são prendidas aqui:

1. `pedir` e `verificar` deixam de descarregar o artefacto e passam a
   fazer o seu PRÓPRIO `actions/checkout` (sparse, só `deploy/`) do mesmo
   SHA que o `porteiro` aprovou, com `persist-credentials: false`.
2. O job `publicar` continua a descarregar o artefacto (é o pacote que vai
   para a branch `deploy`), mas SUBSTITUI `pacote/deploy/` e
   `pacote/.cpanel.yml` pelos do seu próprio checkout — e esse passo tem
   de estar ENTRE o `download-artifact` e o `publicar-branch.sh`. A ordem
   é o que o faz funcionar: antes do download, o download esmagava a
   substituição; depois do `publicar-branch.sh`, já tinha sido publicado o
   que o npm tocou. Por isso o teste abaixo compara ÍNDICES de passos, não
   presença.
3. O `upload-artifact` do job `montar` leva `include-hidden-files: true`
   — sem isso, `actions/upload-artifact` (>= v4.4.0) deixa cair todos os
   ficheiros ocultos, e o `.cpanel.yml` (na raiz do pacote e dentro de
   `deploy/`) nunca chegaria ao job `publicar`: a branch `deploy` ficava
   publicada sem ele e o cPanel não corria tarefa nenhuma. Pior para quem
   audita: os bytes verificados pelo S-12/S-10 em disco deixariam de ser
   os bytes que de facto viajam.

## Como se lê o ficheiro

Sempre com `yaml.safe_load`, nunca com `grep` sobre o texto: um comentário
com a palavra `download-artifact` (e este ficheiro tem muitos, a explicar
precisamente porque é que já não se usa) daria um falso positivo ou um
falso negativo a qualquer busca textual. Tudo o que se afirma abaixo sai da
árvore que o `pyyaml` devolve — incluindo o conteúdo dos `run:`, que é um
valor-folha dessa árvore como outro qualquer.

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz (cada falha de
segurança corrigida ganha um teste aqui).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

RAIZ_REPO = Path(__file__).resolve().parents[3]
CAMINHO_DEPLOY_YML = RAIZ_REPO / ".github" / "workflows" / "deploy.yml"

#: O único SHA que pode ser usado em qualquer sítio deste workflow: o que o
#: job `porteiro` confirmou contra a API. Nunca `github.sha` (que, num
#: evento `workflow_run`, é o tip ATUAL da `main` e pode já ter andado para
#: a frente).
SHA_APROVADO = "${{ github.event.workflow_run.head_sha }}"

_PADRAO_ENV = re.compile(r"^\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$")


def _carregar() -> dict[str, Any]:
    if not CAMINHO_DEPLOY_YML.is_file():
        pytest.fail(f"{CAMINHO_DEPLOY_YML} não existe.")
    conteudo = yaml.safe_load(CAMINHO_DEPLOY_YML.read_text(encoding="utf-8"))
    assert isinstance(conteudo, dict), "deploy.yml não é um mapeamento YAML válido."
    return conteudo


def _jobs() -> dict[str, dict[str, Any]]:
    jobs = _carregar().get("jobs")
    assert isinstance(jobs, dict) and jobs, "deploy.yml não tem jobs."
    return jobs


def _job(nome: str) -> dict[str, Any]:
    jobs = _jobs()
    assert nome in jobs, f"deploy.yml não tem um job chamado {nome!r}."
    return jobs[nome]


def _passos(job: dict[str, Any]) -> list[dict[str, Any]]:
    passos = job.get("steps", [])
    assert isinstance(passos, list), "'steps' de um job não é uma lista."
    return [passo for passo in passos if isinstance(passo, dict)]


def _valores_recursivos(valor: Any) -> list[str]:
    """Todos os valores-folha de texto, em profundidade."""
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


def _usa_segredos(job: dict[str, Any]) -> bool:
    return any("secrets." in valor for valor in _valores_recursivos(job))


def _jobs_com_segredos() -> dict[str, dict[str, Any]]:
    com_segredos = {nome: job for nome, job in _jobs().items() if _usa_segredos(job)}
    assert com_segredos, (
        "Nenhum job de deploy.yml usa segredos — inesperado, e tornaria "
        "vazios todos os testes deste ficheiro."
    )
    return com_segredos


def _descarrega_artefacto(passo: dict[str, Any]) -> bool:
    uses = passo.get("uses")
    return isinstance(uses, str) and uses.split("@")[0].endswith(
        "actions/download-artifact"
    )


def _e_checkout(passo: dict[str, Any]) -> bool:
    uses = passo.get("uses")
    return isinstance(uses, str) and uses.split("@")[0].endswith("actions/checkout")


def _com(passo: dict[str, Any]) -> dict[str, Any]:
    com = passo.get("with")
    assert isinstance(com, dict), (
        f"O passo {passo.get('name', '(sem nome)')!r} não tem bloco 'with'."
    )
    return com


def _caminhos_de_artefacto() -> set[str]:
    """Para onde cada `download-artifact` deste workflow escreve (`with.path`)."""
    caminhos: set[str] = set()
    for job in _jobs().values():
        for passo in _passos(job):
            if _descarrega_artefacto(passo):
                caminho = _com(passo).get("path")
                assert isinstance(caminho, str) and caminho, (
                    "Um passo 'download-artifact' não declara 'with.path'."
                )
                caminhos.add(caminho.rstrip("/"))
    return caminhos


def _resolver_ref(job: dict[str, Any], ref: Any) -> Any:
    """Resolve um `ref:` que seja `${{ env.X }}` para o valor de `env.X` do job."""
    if not isinstance(ref, str):
        return ref
    correspondencia = _PADRAO_ENV.match(ref.strip())
    if correspondencia is None:
        return ref
    ambiente = job.get("env")
    assert isinstance(ambiente, dict), (
        f"O ref {ref!r} aponta para env.{correspondencia.group(1)}, mas o job "
        "não declara 'env'."
    )
    return ambiente.get(correspondencia.group(1))


# --- 1. Nenhum byte do artefacto corre onde há segredos --------------------


def test_nenhum_job_com_segredos_descarrega_o_artefacto() -> None:
    """O artefacto é montado depois do `npm ci`: nunca pode ser descarregado num job com o token do cPanel no ambiente."""
    for nome_job, job in _jobs_com_segredos().items():
        passos_de_download = [
            passo.get("name", "(sem nome)")
            for passo in _passos(job)
            if _descarrega_artefacto(passo)
        ]
        assert passos_de_download == [], (
            f"O job {nome_job!r} tem segredos no ambiente e descarrega o "
            f"artefacto do job 'montar' nos passos {passos_de_download!r}. "
            "Esse artefacto é montado DEPOIS de 'npm ci' correr, com escrita "
            "em toda a árvore de trabalho (deploy/ incluído): seria um canal "
            "de contrabando do npm para o servidor. Usa um actions/checkout "
            "sparse de deploy/, do SHA aprovado."
        )


def test_nenhum_job_com_segredos_corre_nada_de_dentro_do_pacote_descarregado() -> None:
    """Mesmo sem passo de download, nenhum `run` de um job com segredos pode invocar algo de dentro da pasta onde o artefacto aterra."""
    caminhos = _caminhos_de_artefacto()
    assert caminhos, (
        "Nenhum passo deste workflow descarrega o artefacto — esperava-se "
        "pelo menos o job 'publicar'. Sem isso este teste não prova nada."
    )
    for nome_job, job in _jobs_com_segredos().items():
        for passo in _passos(job):
            comando = passo.get("run")
            if not isinstance(comando, str):
                continue
            for caminho in caminhos:
                assert caminho not in comando, (
                    f"O job {nome_job!r}, no passo "
                    f"{passo.get('name', '(sem nome)')!r}, refere o caminho do "
                    f"artefacto ({caminho!r}) com segredos no ambiente."
                )


@pytest.mark.parametrize("nome_job", ["pedir", "verificar"])
def test_pedir_e_verificar_vao_buscar_deploy_a_um_checkout_sparse_do_sha_aprovado(
    nome_job: str,
) -> None:
    """Um clone novo, feito pelo Actions a partir do GitHub, do mesmo SHA que o `porteiro` aprovou — nunca a árvore onde o npm correu."""
    job = _job(nome_job)
    checkouts = [passo for passo in _passos(job) if _e_checkout(passo)]
    assert len(checkouts) == 1, (
        f"O job {nome_job!r} tem de ter exatamente um actions/checkout "
        f"(encontrei {len(checkouts)}) — é de lá que vêm os bytes de deploy/."
    )
    com = _com(checkouts[0])

    assert _resolver_ref(job, com.get("ref")) == SHA_APROVADO, (
        f"O checkout do job {nome_job!r} tem de usar {SHA_APROVADO!r}, "
        f"vi {com.get('ref')!r}."
    )
    assert com.get("persist-credentials") is False, (
        f"O checkout do job {nome_job!r} tem de ter 'persist-credentials: "
        "false' — este job corre com segredos de produção no ambiente."
    )

    sparse = com.get("sparse-checkout")
    assert isinstance(sparse, str), (
        f"O checkout do job {nome_job!r} tem de ser sparse (só 'deploy/'), "
        f"vi sparse-checkout={sparse!r}."
    )
    caminhos_sparse = [linha.strip() for linha in sparse.splitlines() if linha.strip()]
    assert caminhos_sparse == ["deploy"], (
        f"O sparse-checkout do job {nome_job!r} tem de ser só 'deploy', "
        f"vi {caminhos_sparse!r}."
    )


# --- 2. O job `publicar` substitui os bytes, e fá-lo na ordem certa --------


def test_publicar_substitui_deploy_e_cpanel_yml_entre_o_download_e_a_publicacao() -> (
    None
):
    """A ordem é o que faz a correção funcionar: antes do download seria esmagada; depois do publicar-branch.sh chegaria tarde."""
    job = _job("publicar")
    passos = _passos(job)

    indices_download = [
        i for i, passo in enumerate(passos) if _descarrega_artefacto(passo)
    ]
    assert len(indices_download) == 1, (
        "O job 'publicar' tem de descarregar o artefacto exatamente uma vez "
        f"(encontrei {len(indices_download)})."
    )
    indice_download = indices_download[0]
    pacote = _com(passos[indice_download])["path"].rstrip("/")

    indices_substituicao = [
        i
        for i, passo in enumerate(passos)
        if isinstance(passo.get("run"), str)
        and re.search(rf"rm\s+-rf\b[^\n]*{re.escape(pacote)}/deploy", passo["run"])
    ]
    assert len(indices_substituicao) == 1, (
        "O job 'publicar' tem de ter exatamente um passo que substitua "
        f"'{pacote}/deploy' pelos bytes do próprio checkout (encontrei "
        f"{len(indices_substituicao)}). Sem ele, o que vai para a branch "
        "'deploy' são os bytes que o 'npm ci' pôde tocar no job 'montar'."
    )
    indice_substituicao = indices_substituicao[0]
    substituicao = passos[indice_substituicao]["run"]

    assert re.search(
        rf"cp\s+-a\b[^\n]*(?<![\w/.-])deploy(?![\w.-])[^\n]*{re.escape(pacote)}/deploy",
        substituicao,
    ), (
        "O passo de substituição tem de copiar o 'deploy/' do CHECKOUT para "
        f"'{pacote}/deploy'. Vi:\n{substituicao}"
    )
    assert re.search(
        rf"cp\s+[^\n]*deploy/\.cpanel\.yml[^\n]*{re.escape(pacote)}/\.cpanel\.yml",
        substituicao,
    ), (
        "O passo de substituição tem de repor também o '.cpanel.yml' da raiz "
        f"do pacote a partir do checkout. Vi:\n{substituicao}"
    )

    indices_publicacao = [
        i
        for i, passo in enumerate(passos)
        if isinstance(passo.get("run"), str) and "publicar-branch.sh" in passo["run"]
    ]
    assert len(indices_publicacao) == 1, (
        "O job 'publicar' tem de correr 'publicar-branch.sh' exatamente uma vez."
    )
    indice_publicacao = indices_publicacao[0]

    assert indice_download < indice_substituicao, (
        "O passo que substitui 'deploy/' no pacote corre ANTES do "
        f"download-artifact (índices {indice_substituicao} e "
        f"{indice_download}): o download escreveria por cima da substituição "
        "e os bytes que o npm tocou voltavam ao pacote."
    )
    assert indice_substituicao < indice_publicacao, (
        "O passo que substitui 'deploy/' no pacote corre DEPOIS do "
        f"'publicar-branch.sh' (índices {indice_substituicao} e "
        f"{indice_publicacao}): a branch 'deploy' já tinha sido publicada com "
        "os bytes que o npm tocou."
    )


# --- 3. O mesmo SHA aprovado em todo o workflow ----------------------------


def test_todos_os_checkouts_usam_o_sha_que_o_porteiro_aprovou() -> None:
    """`montar`, `publicar`, `pedir` e `verificar` clonam todos o MESMO commit — o que o CI validou por inteiro."""
    jobs_com_checkout: list[str] = []
    for nome_job, job in _jobs().items():
        for passo in _passos(job):
            if not _e_checkout(passo):
                continue
            jobs_com_checkout.append(nome_job)
            ref = _resolver_ref(job, _com(passo).get("ref"))
            assert ref == SHA_APROVADO, (
                f"O checkout do job {nome_job!r} usa ref={ref!r}; tem de usar "
                f"{SHA_APROVADO!r}, o SHA que o job 'porteiro' confirmou."
            )
    assert sorted(set(jobs_com_checkout)) == [
        "montar",
        "pedir",
        "publicar",
        "verificar",
    ], (
        "Os jobs que fazem checkout em deploy.yml têm de ser exatamente "
        "montar, publicar, pedir e verificar — encontrei "
        f"{sorted(set(jobs_com_checkout))!r}."
    )


def test_github_sha_nunca_aparece_em_valor_nenhum() -> None:
    """Num evento `workflow_run`, `github.sha` é o tip ATUAL da main — pode já não ser o SHA que o CI validou."""
    for nome_job, job in _jobs().items():
        for valor in _valores_recursivos(job):
            assert not re.search(r"github\.sha\b", valor), (
                f"O job {nome_job!r} usa 'github.sha' em {valor!r}. Num evento "
                "workflow_run isso é o tip atual da main, não o SHA aprovado."
            )


# --- 4. O artefacto leva os ficheiros ocultos ------------------------------


def test_upload_artifact_do_montar_inclui_ficheiros_ocultos() -> None:
    """Sem `include-hidden-files: true` o `.cpanel.yml` cai do pacote (upload-artifact ignora ocultos desde a v4.4.0) e o cPanel não corre tarefa nenhuma."""
    job = _job("montar")
    uploads = [
        passo
        for passo in _passos(job)
        if isinstance(passo.get("uses"), str)
        and passo["uses"].split("@")[0].endswith("actions/upload-artifact")
    ]
    assert len(uploads) == 1, (
        f"O job 'montar' tem de publicar exatamente um artefacto (vi {len(uploads)})."
    )
    com = _com(uploads[0])
    assert com.get("include-hidden-files") is True, (
        "O upload-artifact do job 'montar' tem de ter 'include-hidden-files: "
        f"true' (vi {com.get('include-hidden-files')!r}). Sem isso, o "
        "'.cpanel.yml' — na raiz do pacote e dentro de deploy/, os dois "
        "ocultos — nunca chega ao job 'publicar', a branch 'deploy' sai sem "
        "ele, e os bytes auditados pelo S-12/S-10 deixam de ser os bytes que "
        "viajam."
    )
