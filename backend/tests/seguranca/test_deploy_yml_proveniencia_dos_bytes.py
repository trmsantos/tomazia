"""A proveniência dos BYTES que o `deploy.yml` executa (ronda de segurança da F1-04).

## O achado original, e o que sobrou dele

O job `montar` corre `npm ci` — código de terceiros, com escrita em TODA a
árvore de trabalho desse job, `deploy/` incluído. Enquanto os jobs `pedir` e
`verificar` iam buscar `deploy/pedir-deploy.sh` e `deploy/esperar-versao.sh`
ao artefacto montado nesse job, um `postinstall` malicioso tinha um canal
direto para o único sítio do pipeline onde o token do cPanel existe:
reescrevia o script em `deploy/`, `montar.sh` copiava-o para o pacote sem
dar por isso, e o job `pedir` executava-o com `secrets.TOMAZIA_CPANEL_TOKEN`
no ambiente. O S-12/S-10 não apanha nada disto: olha para NOMES de caminho,
nunca para a proveniência dos bytes.

A primeira correção tratou de `pedir` e `verificar` (checkout sparse próprio,
do SHA aprovado). A segunda ronda mostrou que isso não chegava: o job
`montar` continuava a montar o pacote INTEIRO e o `publicar` repunha só
`pacote/deploy/` e `pacote/.cpanel.yml` a partir do seu checkout — portanto
`api/app/`, `api/passenger_wsgi.py` e `api/requirements.txt` continuavam a
ser bytes que o `npm ci` podia ter tocado, e iam na mesma para a branch
`deploy` e daí para o servidor. O `--require-hashes` do `deploy.sh` não
ajudava nada nesse cenário: validaria os pacotes contra os hashes que o
próprio atacante tinha acabado de escrever em `requirements.txt`.

## O desenho que este ficheiro prega

- `montar` só faz `npm ci && npm run build`, e publica um artefacto que
  carrega **só** `frontend/dist`.
- `publicar` faz o seu próprio checkout, descarrega esse artefacto para
  `frontend/dist` e corre lá `deploy/montar.sh`. Por isso `api/` e `deploy/`
  saem do clone que o Actions acabou de fazer, nunca da árvore onde o `npm`
  correu. O único produto que viaja do job `montar` são ficheiros servidos
  a browsers, nunca importados pelo Passenger nem instalados pelo pip.
- Os guardas S-12 e S-10 correm no `publicar`, sobre o pacote montado: têm
  de auditar exatamente os bytes que a seguir são publicados, nunca uma
  cópia anterior deles.

O invariante que mais importa aqui, e o mais fácil de desfazer por
distração num refactor, é **o artefacto não carregar nada para lá de
`frontend/dist`**: é essa a propriedade que impede o buraco de voltar.
Alargar o `path` do `upload-artifact` para `.` (ou acrescentar-lhe uma
segunda linha com `backend` ou `deploy`) repunha o canal inteiro sem mudar
mais nada no ficheiro — por isso
`test_o_artefacto_do_montar_nao_carrega_nada_para_la_de_frontend_dist`
compara a lista de caminhos por igualdade, nunca por "contém".

Tudo o que depende da ORDEM dos passos é comparado por ÍNDICE, nunca por
presença: montar antes de auditar, auditar antes de publicar. A ordem é o
que faz o desenho funcionar — um pacote auditado depois de publicado, ou
montado antes do artefacto chegar, passaria num teste de presença e não
protegia nada.

## Como se lê o ficheiro

Sempre com `yaml.safe_load`, nunca com `grep` sobre o texto: um comentário
com a palavra `download-artifact` (e este ficheiro tem muitos, a explicar
precisamente o que já não se faz) daria um falso positivo ou um falso
negativo a qualquer busca textual. Tudo o que se afirma abaixo sai da
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

#: O único caminho que o artefacto do job `montar` pode carregar.
CAMINHO_DO_ARTEFACTO = "frontend/dist"

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


def _nome(passo: dict[str, Any]) -> str:
    nome = passo.get("name")
    return nome if isinstance(nome, str) else "(sem nome)"


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


def _usa_acao(passo: dict[str, Any], acao: str) -> bool:
    uses = passo.get("uses")
    return isinstance(uses, str) and uses.split("@")[0].endswith(acao)


def _descarrega_artefacto(passo: dict[str, Any]) -> bool:
    return _usa_acao(passo, "actions/download-artifact")


def _publica_artefacto(passo: dict[str, Any]) -> bool:
    return _usa_acao(passo, "actions/upload-artifact")


def _e_checkout(passo: dict[str, Any]) -> bool:
    return _usa_acao(passo, "actions/checkout")


def _com(passo: dict[str, Any]) -> dict[str, Any]:
    com = passo.get("with")
    assert isinstance(com, dict), f"O passo {_nome(passo)!r} não tem bloco 'with'."
    return com


def _linhas_de_caminho(valor: Any, de_onde: str) -> list[str]:
    """`with.path` de um passo de artefacto, como lista de padrões (uma por linha)."""
    assert isinstance(valor, str) and valor.strip(), (
        f"{de_onde} não declara um 'with.path' de texto (vi {valor!r})."
    )
    return [linha.strip() for linha in valor.splitlines() if linha.strip()]


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


def _argumento(comando: str, opcao: str) -> str | None:
    """Valor de `--<opcao> <valor>` (com ou sem aspas) num `run:`.

    As aspas contam: os valores reais deste workflow são expressões do
    Actions (`"${{ runner.temp }}/pacote"`), com espaços lá dentro — um
    `split()` ingénuo partia-as ao meio e comparava lixo com lixo.
    """
    correspondencia = re.search(
        rf"--{re.escape(opcao)}\s+(?:\"([^\"]*)\"|'([^']*)'|(\S+))", comando
    )
    if correspondencia is None:
        return None
    for grupo in correspondencia.groups():
        if grupo is not None:
            return grupo.rstrip("/")
    return None


def _indices_de_run(job: dict[str, Any], agulha: str) -> list[int]:
    """Índices dos passos do job cujo `run:` menciona `agulha`."""
    return [
        indice
        for indice, passo in enumerate(_passos(job))
        if isinstance(passo.get("run"), str) and agulha in passo["run"]
    ]


def _indice_unico(job: dict[str, Any], agulha: str, porque: str) -> int:
    indices = _indices_de_run(job, agulha)
    assert len(indices) == 1, (
        f"Esperava exatamente um passo com {agulha!r} no 'run:' (encontrei "
        f"{len(indices)}). {porque}"
    )
    return indices[0]


# --- 1. O artefacto carrega só `frontend/dist` -----------------------------


def test_o_artefacto_do_montar_nao_carrega_nada_para_la_de_frontend_dist() -> None:
    """O invariante central: só os estáticos compilados saem do job onde o `npm ci` correu.

    Comparação por IGUALDADE da lista de caminhos, nunca por "contém": um
    `path:` alargado para `.`, ou com uma segunda linha a dizer `backend` ou
    `deploy`, repunha o canal de contrabando inteiro sem mudar mais nada no
    workflow — e passaria num teste que só confirmasse que `frontend/dist`
    lá está.
    """
    uploads = [
        (nome_job, passo)
        for nome_job, job in _jobs().items()
        for passo in _passos(job)
        if _publica_artefacto(passo)
    ]
    assert len(uploads) == 1, (
        "deploy.yml tem de publicar exatamente um artefacto, no job "
        f"'montar' (encontrei {len(uploads)}: "
        f"{[(nome_job, _nome(passo)) for nome_job, passo in uploads]!r})."
    )
    nome_job, passo = uploads[0]
    assert nome_job == "montar", (
        f"O único artefacto do workflow tem de ser publicado pelo job "
        f"'montar', não por {nome_job!r}."
    )

    com = _com(passo)
    caminhos = _linhas_de_caminho(com.get("path"), f"O upload-artifact de {nome_job!r}")
    assert caminhos == [CAMINHO_DO_ARTEFACTO], (
        f"O artefacto do job 'montar' carrega {caminhos!r}; só pode carregar "
        f"['{CAMINHO_DO_ARTEFACTO}']. Tudo o que sai deste job passou por "
        "'npm ci' — código de terceiros, com escrita em toda a árvore de "
        "trabalho. 'frontend/dist' são ficheiros servidos a browsers; "
        "'backend/', 'deploy/' e '.cpanel.yml' são executados no servidor e "
        "têm de vir do checkout limpo do job 'publicar'."
    )


def test_o_job_montar_nao_monta_nem_publica_o_pacote() -> None:
    """Montar o pacote no job do `npm ci` é exatamente o achado desta ronda: lá, `montar.sh` leria bytes que o npm pôde reescrever."""
    montar = _job("montar")
    for agulha in ("montar.sh", "publicar-branch.sh"):
        indices = _indices_de_run(montar, agulha)
        assert indices == [], (
            f"O job 'montar' corre {agulha!r} (passos "
            f"{[_nome(_passos(montar)[i]) for i in indices]!r}). Esse job corre "
            "'npm ci' com escrita em toda a árvore de trabalho: o pacote tem "
            "de ser montado no job 'publicar', a partir do checkout dele."
        )


def test_o_artefacto_descarregado_no_publicar_e_o_mesmo_e_aterra_em_frontend_dist() -> (
    None
):
    """Um só artefacto, com o mesmo nome dos dois lados, a aterrar onde o `montar.sh` espera o build."""
    upload = [passo for passo in _passos(_job("montar")) if _publica_artefacto(passo)]
    descargas = [
        (nome_job, passo)
        for nome_job, job in _jobs().items()
        for passo in _passos(job)
        if _descarrega_artefacto(passo)
    ]
    assert len(upload) == 1 and len(descargas) == 1, (
        f"Esperava um upload-artifact e um download-artifact em deploy.yml "
        f"(vi {len(upload)} e {len(descargas)})."
    )
    nome_job, descarga = descargas[0]
    assert nome_job == "publicar", (
        f"O artefacto só pode ser descarregado no job 'publicar', não em {nome_job!r}."
    )

    nome_enviado = _com(upload[0]).get("name")
    nome_recebido = _com(descarga).get("name")
    assert nome_enviado == nome_recebido == "frontend-dist", (
        "O artefacto tem de se chamar 'frontend-dist' dos dois lados (vi "
        f"{nome_enviado!r} no upload e {nome_recebido!r} no download)."
    )

    destino = _linhas_de_caminho(
        _com(descarga).get("path"), "O download-artifact do job 'publicar'"
    )
    assert destino == [CAMINHO_DO_ARTEFACTO], (
        f"O artefacto tem de aterrar em '{CAMINHO_DO_ARTEFACTO}' dentro do "
        f"checkout do job 'publicar' (vi {destino!r}) — é lá que "
        "'deploy/montar.sh' vai buscar o build do frontend."
    )


def test_upload_artifact_do_montar_inclui_ficheiros_ocultos() -> None:
    """Sem `include-hidden-files: true`, o `upload-artifact` (>= v4.4.0) deixa cair os ocultos do build — e audita-se uma coisa enquanto viaja outra."""
    uploads = [passo for passo in _passos(_job("montar")) if _publica_artefacto(passo)]
    assert len(uploads) == 1, (
        f"O job 'montar' tem de publicar exatamente um artefacto (vi {len(uploads)})."
    )
    com = _com(uploads[0])
    assert com.get("include-hidden-files") is True, (
        "O upload-artifact do job 'montar' tem de ter 'include-hidden-files: "
        f"true' (vi {com.get('include-hidden-files')!r}). Sem isso, um "
        "ficheiro oculto do build (o Vite produz-nos) nunca chega ao job "
        "'publicar': o S-10 auditou-o em disco, mas não é ele que viaja — e "
        "o pacote publicado deixa de ser o pacote auditado."
    )


# --- 2. O `publicar` monta do seu checkout, audita e só depois publica -----


def test_publicar_monta_audita_e_publica_por_esta_ordem() -> None:
    """A ordem é o que faz o desenho funcionar, e é por isso que se comparam índices e não presenças.

    Checkout → descarregar só `frontend/dist` → `montar.sh` (lê `api/` e
    `deploy/` do checkout) → S-12 → S-10 → `publicar-branch.sh`. Auditar
    antes de montar audita uma pasta que ainda não existe; auditar depois de
    publicar chega tarde; montar antes do download produz um pacote sem
    frontend nenhum.
    """
    publicar = _job("publicar")
    passos = _passos(publicar)

    indices_checkout = [i for i, passo in enumerate(passos) if _e_checkout(passo)]
    assert len(indices_checkout) == 1, (
        f"O job 'publicar' tem de ter exatamente um actions/checkout (vi "
        f"{len(indices_checkout)}) — é de lá que vêm os bytes de 'api/' e "
        "'deploy/' que entram no pacote."
    )
    indices_download = [
        i for i, passo in enumerate(passos) if _descarrega_artefacto(passo)
    ]
    assert len(indices_download) == 1, (
        f"O job 'publicar' tem de descarregar o artefacto exatamente uma vez "
        f"(vi {len(indices_download)})."
    )

    indice_montagem = _indice_unico(
        publicar,
        "montar.sh",
        "É aqui que o pacote é montado, a partir do checkout deste job.",
    )
    indice_s12 = _indice_unico(
        publicar,
        "--conjunto s12",
        "O guarda S-12 tem de correr sobre o pacote montado, neste job.",
    )
    indice_s10 = _indice_unico(
        publicar,
        "--conjunto s10",
        "O guarda S-10 tem de correr sobre o pacote montado, neste job.",
    )
    indice_publicacao = _indice_unico(
        publicar,
        "publicar-branch.sh",
        "É o passo que empurra o pacote para a branch 'deploy'.",
    )

    ordem = [
        ("actions/checkout", indices_checkout[0]),
        ("download-artifact", indices_download[0]),
        ("deploy/montar.sh", indice_montagem),
        ("guarda S-12", indice_s12),
        ("guarda S-10", indice_s10),
        ("deploy/publicar-branch.sh", indice_publicacao),
    ]
    for (nome_antes, indice_antes), (nome_depois, indice_depois) in zip(
        ordem, ordem[1:], strict=False
    ):
        assert indice_antes < indice_depois, (
            f"No job 'publicar', {nome_antes!r} (índice {indice_antes}) tem de "
            f"correr ANTES de {nome_depois!r} (índice {indice_depois}). A "
            f"ordem é o que faz este desenho funcionar: "
            f"{[nome for nome, _ in ordem]!r}."
        )


def test_o_pacote_auditado_e_exatamente_o_pacote_publicado() -> None:
    """A pasta que o `montar.sh` escreve, a que os dois guardas leem e a que o `publicar-branch.sh` empurra têm de ser a MESMA.

    Com três caminhos diferentes, cada passo continuava a parecer certo
    sozinho: montava-se uma pasta, auditava-se outra e publicava-se uma
    terceira, e nenhum teste de presença dava por isso.
    """
    publicar = _job("publicar")
    passos = _passos(publicar)

    indice_montagem = _indice_unico(
        publicar,
        "montar.sh",
        "É esse passo que define, com '--saida', qual é a pasta do pacote.",
    )
    pacote_montado = _argumento(passos[indice_montagem]["run"], "saida")
    assert pacote_montado, (
        "O passo que corre 'deploy/montar.sh' no job 'publicar' não passa "
        "'--saida <pasta>' — sem isso não há como saber o que é auditado a "
        "seguir."
    )

    for agulha, opcao, quem in (
        ("--conjunto s12", "pasta", "o guarda S-12"),
        ("--conjunto s10", "pasta", "o guarda S-10"),
        ("publicar-branch.sh", "pasta", "a publicação na branch 'deploy'"),
    ):
        indice = _indice_unico(
            publicar, agulha, f"É o passo onde corre {quem}, sobre o pacote."
        )
        alvo = _argumento(passos[indice]["run"], opcao)
        assert alvo == pacote_montado, (
            f"No job 'publicar', {quem} usa --{opcao} {alvo!r}, mas o pacote "
            f"montado é {pacote_montado!r}. Auditar (ou publicar) uma pasta "
            "diferente da montada é auditar uma coisa e publicar outra."
        )


def test_o_checkout_do_publicar_tem_historico_completo() -> None:
    """`publicar-branch.sh` recusa um retrocesso com `git merge-base --is-ancestor`, e isso precisa dos objetos todos — um clone raso não serve."""
    checkouts = [passo for passo in _passos(_job("publicar")) if _e_checkout(passo)]
    assert len(checkouts) == 1, (
        f"O job 'publicar' tem de ter exatamente um actions/checkout (vi "
        f"{len(checkouts)})."
    )
    profundidade = _com(checkouts[0]).get("fetch-depth")
    assert profundidade == 0, (
        "O checkout do job 'publicar' tem de ter 'fetch-depth: 0' (vi "
        f"{profundidade!r}): sem o histórico completo, o guarda "
        "anti-retrocesso de 'publicar-branch.sh' não consegue confirmar se o "
        "SHA novo é antepassado do já publicado — e um guarda que não "
        "consegue verificar tem de abortar, nunca deixar passar."
    )


# --- 3. Nenhum byte do artefacto corre onde há segredos --------------------


def test_nenhum_job_com_segredos_descarrega_o_artefacto() -> None:
    """O artefacto é montado depois do `npm ci`: nunca pode ser descarregado num job com o token do cPanel no ambiente."""
    for nome_job, job in _jobs_com_segredos().items():
        passos_de_download = [
            _nome(passo) for passo in _passos(job) if _descarrega_artefacto(passo)
        ]
        assert passos_de_download == [], (
            f"O job {nome_job!r} tem segredos no ambiente e descarrega o "
            f"artefacto do job 'montar' nos passos {passos_de_download!r}. "
            "Esse artefacto sai de um job onde 'npm ci' correu com escrita "
            "em toda a árvore de trabalho: seria um canal de contrabando do "
            "npm para o servidor. Usa um actions/checkout sparse de deploy/, "
            "do SHA aprovado."
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
                    f"O job {nome_job!r}, no passo {_nome(passo)!r}, refere o "
                    f"caminho do artefacto ({caminho!r}) com segredos no "
                    "ambiente."
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


# --- 4. O mesmo SHA aprovado em todo o workflow ----------------------------


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
