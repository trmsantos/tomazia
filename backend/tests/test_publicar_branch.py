"""`deploy/publicar-branch.sh --pasta <pasta> --sha <sha> --branch deploy`: a branch `deploy`.

Põe a árvore da branch `deploy` igual à pasta montada (o `--saida` de
`deploy/montar.sh`, embora estes testes construam essa pasta diretamente,
sem precisar de correr `montar.sh`) e empurra fast-forward para `origin`.
Um `git init --bare`, dentro de `tmp_path`, faz de `origin` — nunca tocamos
no repositório real, nem na branch `deploy` real.

`deploy/publicar-branch.sh` ainda não existe — é o infra que o escreve a
seguir. Por isso estes testes falham agora com um `FileNotFoundError`
claro (nunca o importamos, invocamo-lo sempre por subprocesso, direto do
seu caminho real em `deploy/`: ao contrário de `montar.sh`,
`publicar-branch.sh` não precisa de nenhum ficheiro irmão relativo ao seu
próprio caminho — só de `--pasta` e de operações git em `cwd` — por isso
não há necessidade de copiar `deploy/` para uma árvore de trabalho falsa
aqui).

## Dois repositórios git, dois papéis (nenhum é o repositório real)

- `bare` (`git init --bare`): o remoto — o que a UAPI/`Setup Python App`
  puxaria do lado do servidor. É aqui que se verifica o resultado: a
  branch `deploy` foi criada/avançada, `main` nunca mexe, não houve push
  com `--force`.
- `repo_origem` (`git init` normal, com `origin` a apontar para `bare`): o
  "checkout do projeto" onde o workflow correria `publicar-branch.sh` —
  com um histórico linear de commits vazios (`git commit --allow-empty`),
  cujos SHAs a sério são usados como `--sha`. É contra este histórico que
  o script tem de conseguir responder "este SHA é antepassado daquele
  outro?" (`git merge-base --is-ancestor`), por isso tem de ser um
  repositório git a sério, nunca uma string MD5/SHA1 inventada sem
  commits por trás.

## Ponto de extensão assumido (sinalizado ao implementador)

Para recusar um SHA antepassado do já publicado, o script precisa de
saber qual foi o último `--sha` publicado. Assumimos que fica registado na
própria mensagem do commit que o script cria em `deploy` (p. ex. como a
única linha, ou como um "trailer"), lido de volta a partir do
`origin/deploy` atual (via `git fetch`) — nunca de um ficheiro local fora
do controlo de versões, que uma corrida nova de CI não teria. Estes
testes não verificam essa mensagem diretamente, só o comportamento
(recusa/aceita, estado da branch) — por isso continuam válidos seja qual
for a convenção exata escolhida, desde que a informação sobreviva entre
invocações **através do que é empurrado para o remoto**.

`GIT_CEILING_DIRECTORIES=tmp_path` em todo o lado, como no resto da suite
(ver `tests/seguranca/test_s10_ficheiros_proibidos.py`): mesmo correndo
esta suite de dentro de um clone git real, nenhuma operação git destes
testes consegue "subir" e encontrar esse repositório por engano.

## Achado da validação por mutação (pedida pelo Tomás, depois dos scripts reais existirem)

A implementação real de `publicar-branch.sh` recusa publicar sobre uma
branch `deploy` cujo commit de topo não tenha uma linha `Sha-Origem: <sha>`
reconhecida (histórico "não reconhecido" — ver o `README.md`/comentários
do próprio script). Isto significa que `test_push_sem_force_recusa_quando_o_remoto_divergiu`
(a seguir), tal como escrito originalmente, **nunca chegava a exercitar o
próprio `git push`**: a branch divergente que ele constrói (um commit órfão,
sem a linha `Sha-Origem:`) é apanhada pela verificação de proveniência,
MUITO antes do script sequer tentar um `git push`. Confirmado por mutação:
acrescentar `--force` ao `git push` do script **não derrubava este teste
nenhum** — passava por acidente, provando a recusa errada (proveniência),
não a ausência de `--force`.

Por isso este ficheiro agora tem dois testes separados para duas garantias
diferentes:

- `test_recusa_quando_o_historico_remoto_nao_e_reconhecido` (antigo
  `test_push_sem_force_recusa_quando_o_remoto_divergiu`, renomeado e com o
  docstring corrigido): continua válido e vale a pena manter — prende a
  verificação de proveniência, uma guarda real e distinta — mas já não
  pretende provar a ausência de `--force`.
- `test_git_push_nunca_leva_flag_de_force` (novo): prova a ausência de
  `--force` a sério, por observação direta do comportamento — um `git`
  "espião" (um executável `git` fabricado, posto à frente no `PATH`, que
  regista os argumentos de cada chamada e depois invoca o `git` a sério)
  em vez de inferir a partir de uma recusa que podia ter outra causa. É a
  forma de testar o comportamento sem depender de conseguir reproduzir a
  corrida (*race*) real entre o `fetch` e o `push` do script — que, por
  este desenhar sempre o pai do commit novo a partir do tip acabado de
  obter, só falharia mesmo (sem `--force`) nessa janela estreita entre as
  duas chamadas git do próprio script, não reproduzível de fora sem
  instrumentar o script.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parents[2]
SCRIPT = RAIZ_REPO / "deploy" / "publicar-branch.sh"


def _ambiente(tmp_path: Path) -> dict[str, str]:
    ambiente = os.environ.copy()
    ambiente["GIT_CEILING_DIRECTORIES"] = str(tmp_path)
    ambiente["GIT_TERMINAL_PROMPT"] = "0"
    return ambiente


def _git(repo: Path, tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Corre `git` com sucesso esperado (usado só para preparar o mundo do teste, nunca para o script sob teste)."""
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


def _preparar_bare_com_main(tmp_path: Path) -> tuple[Path, str]:
    """`git init --bare`, com uma branch `main` semeada a partir de um clone descartável — nunca o repositório real."""
    bare = tmp_path / "origin.git"
    _git(tmp_path, tmp_path, "init", "--quiet", "--bare", str(bare))

    semente = tmp_path / "semente"
    semente.mkdir()
    _git(semente, tmp_path, "init", "--quiet")
    _git(semente, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(semente, tmp_path, "config", "user.name", "QA Tomazia")
    _git(semente, tmp_path, "checkout", "--quiet", "-b", "main")
    _git(
        semente, tmp_path, "commit", "--quiet", "--allow-empty", "-m", "inicial, falso"
    )
    _git(semente, tmp_path, "remote", "add", "origin", str(bare))
    _git(semente, tmp_path, "push", "--quiet", "origin", "main")
    sha_main = _git(semente, tmp_path, "rev-parse", "main").stdout.strip()
    return bare, sha_main


def _preparar_repo_origem(tmp_path: Path, bare: Path) -> Path:
    """Representa "o checkout do projeto": histórico linear de commits vazios, `origin` a apontar para `bare`."""
    repo = tmp_path / "origem"
    repo.mkdir()
    _git(repo, tmp_path, "init", "--quiet")
    _git(repo, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(repo, tmp_path, "config", "user.name", "QA Tomazia")
    _git(repo, tmp_path, "remote", "add", "origin", str(bare))
    return repo


def _commit_vazio(repo: Path, tmp_path: Path, mensagem: str) -> str:
    _git(repo, tmp_path, "commit", "--quiet", "--allow-empty", "-m", mensagem)
    return _git(repo, tmp_path, "rev-parse", "HEAD").stdout.strip()


def _pasta_com_ficheiros(tmp_path: Path, nome: str, ficheiros: dict[str, str]) -> Path:
    pasta = tmp_path / nome
    pasta.mkdir()
    for relativo, conteudo in ficheiros.items():
        caminho = pasta / relativo
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(conteudo, encoding="utf-8")
    return pasta


def _correr_publicar(
    repo_origem: Path,
    tmp_path: Path,
    *,
    pasta: Path,
    sha: str,
    branch: str = "deploy",
    timeout: float = 30,
) -> subprocess.CompletedProcess[str]:
    """Invoca `deploy/publicar-branch.sh` por subprocesso, a partir do seu caminho real. Nunca o importa."""
    return subprocess.run(
        [str(SCRIPT), "--pasta", str(pasta), "--sha", sha, "--branch", branch],
        cwd=repo_origem,
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _rev_parse_no_bare(bare: Path, tmp_path: Path, ref: str) -> str | None:
    resultado = subprocess.run(
        ["git", "-C", str(bare), "rev-parse", "--verify", "--quiet", ref],
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=15,
    )
    if resultado.returncode != 0:
        return None
    return resultado.stdout.strip()


def _arvore_da_branch(
    bare: Path, tmp_path: Path, branch: str, destino_nome: str
) -> Path:
    """Clona `branch` do `bare` para um `tmp_path` fresco, só para inspeção — nunca escreve de volta."""
    destino = tmp_path / destino_nome
    _git(
        tmp_path,
        tmp_path,
        "clone",
        "--quiet",
        "--branch",
        branch,
        str(bare),
        str(destino),
    )
    return destino


def _listar_ficheiros_sem_git(pasta: Path) -> set[str]:
    return {
        caminho.relative_to(pasta).as_posix()
        for caminho in pasta.rglob("*")
        if caminho.is_file() and ".git" not in caminho.relative_to(pasta).parts
    }


def _conteudos(pasta: Path, relativos: set[str]) -> dict[str, bytes]:
    return {relativo: (pasta / relativo).read_bytes() for relativo in relativos}


def _ambiente_com_espiao_de_git(tmp_path: Path) -> tuple[dict[str, str], Path]:
    """Ambiente com um `git` "espião" à frente no `PATH`: regista cada chamada e invoca o `git` a sério a seguir.

    Usado só por `test_git_push_nunca_leva_flag_de_force`: é a forma de
    observar os argumentos exatos de cada `git push` feito por
    `publicar-branch.sh`, sem alterar o script nem adivinhar o
    comportamento a partir de um código de saída que pode ter outra
    causa (ver o docstring do módulo, sobre o achado da validação por
    mutação).
    """
    git_real = shutil.which("git")
    assert git_real is not None, "git tem de estar no PATH para este teste correr"

    pasta_espiao = tmp_path / "espiao-git"
    pasta_espiao.mkdir()
    registo = tmp_path / "git-spy.log"
    (pasta_espiao / "git").write_text(
        "#!/usr/bin/env bash\n"
        f'printf \'%s\\n\' "$*" >> "{registo}"\n'
        f'exec "{git_real}" "$@"\n',
        encoding="utf-8",
    )
    (pasta_espiao / "git").chmod(0o755)

    ambiente = _ambiente(tmp_path)
    ambiente["PATH"] = f"{pasta_espiao}{os.pathsep}{ambiente['PATH']}"
    return ambiente, registo


def _assert_main_intocado(bare: Path, tmp_path: Path, sha_main_esperado: str) -> None:
    atual = _rev_parse_no_bare(bare, tmp_path, "main")
    assert atual == sha_main_esperado, (
        "publicar-branch.sh nunca pode tocar na branch 'main' do remoto"
    )


# --- Primeira publicação, segunda publicação (fast-forward) ---


def test_primeira_publicacao_cria_a_branch_deploy(tmp_path: Path) -> None:
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    pasta = _pasta_com_ficheiros(
        tmp_path,
        "pacote-1",
        {"api/VERSION": sha1, "frontend/dist/index.html": "<html></html>\n"},
    )

    assert (
        _rev_parse_no_bare(bare, tmp_path, "deploy") is None
    )  # premissa: ainda não existe

    resultado = _correr_publicar(repo, tmp_path, pasta=pasta, sha=sha1, branch="deploy")

    assert resultado.returncode == 0, resultado.stderr
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") is not None

    conferencia = _arvore_da_branch(bare, tmp_path, "deploy", "conferencia-1")
    assert _listar_ficheiros_sem_git(conferencia) == _listar_ficheiros_sem_git(pasta)
    assert _conteudos(conferencia, {"api/VERSION"}) == _conteudos(
        pasta, {"api/VERSION"}
    )

    _assert_main_intocado(bare, tmp_path, sha_main)


def test_segunda_publicacao_e_fast_forward_e_passa_sem_force(tmp_path: Path) -> None:
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    sha2 = _commit_vazio(repo, tmp_path, "segundo commit falso")

    pasta1 = _pasta_com_ficheiros(tmp_path, "pacote-1", {"api/VERSION": sha1})
    pasta2 = _pasta_com_ficheiros(tmp_path, "pacote-2", {"api/VERSION": sha2})

    primeira = _correr_publicar(repo, tmp_path, pasta=pasta1, sha=sha1, branch="deploy")
    assert primeira.returncode == 0, primeira.stderr
    tip_depois_da_primeira = _rev_parse_no_bare(bare, tmp_path, "deploy")
    assert tip_depois_da_primeira is not None

    segunda = _correr_publicar(repo, tmp_path, pasta=pasta2, sha=sha2, branch="deploy")
    assert segunda.returncode == 0, segunda.stderr
    tip_depois_da_segunda = _rev_parse_no_bare(bare, tmp_path, "deploy")
    assert tip_depois_da_segunda is not None
    assert tip_depois_da_segunda != tip_depois_da_primeira

    # Fast-forward a sério: o tip antigo tem de ser antepassado do novo.
    verificacao = subprocess.run(
        [
            "git",
            "-C",
            str(bare),
            "merge-base",
            "--is-ancestor",
            tip_depois_da_primeira,
            tip_depois_da_segunda,
        ],
        env=_ambiente(tmp_path),
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert verificacao.returncode == 0, (
        "a segunda publicação tem de ser um fast-forward da primeira"
    )

    conferencia = _arvore_da_branch(bare, tmp_path, "deploy", "conferencia-2")
    assert _listar_ficheiros_sem_git(conferencia) == _listar_ficheiros_sem_git(pasta2)

    _assert_main_intocado(bare, tmp_path, sha_main)


def test_ficheiro_ausente_na_segunda_pasta_desaparece_da_branch(tmp_path: Path) -> None:
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    sha2 = _commit_vazio(repo, tmp_path, "segundo commit falso")

    pasta1 = _pasta_com_ficheiros(
        tmp_path,
        "pacote-1",
        {
            "api/VERSION": sha1,
            "fica.txt": "fica nas duas publicações\n",
            "so-na-primeira.txt": "só existe na primeira pasta montada\n",
        },
    )
    pasta2 = _pasta_com_ficheiros(
        tmp_path,
        "pacote-2",
        {"api/VERSION": sha2, "fica.txt": "fica nas duas publicações\n"},
    )

    primeira = _correr_publicar(repo, tmp_path, pasta=pasta1, sha=sha1, branch="deploy")
    assert primeira.returncode == 0, primeira.stderr

    segunda = _correr_publicar(repo, tmp_path, pasta=pasta2, sha=sha2, branch="deploy")
    assert segunda.returncode == 0, segunda.stderr

    conferencia = _arvore_da_branch(bare, tmp_path, "deploy", "conferencia")
    presentes = _listar_ficheiros_sem_git(conferencia)
    assert "so-na-primeira.txt" not in presentes
    assert "fica.txt" in presentes

    _assert_main_intocado(bare, tmp_path, sha_main)


def test_republicar_o_mesmo_sha_move_a_branch_na_mesma(tmp_path: Path) -> None:
    """Um commit vazio é permitido: senão um re-deploy manual não faz nada e parece ter feito."""
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "único commit falso")
    pasta = _pasta_com_ficheiros(tmp_path, "pacote", {"api/VERSION": sha1})

    primeira = _correr_publicar(repo, tmp_path, pasta=pasta, sha=sha1, branch="deploy")
    assert primeira.returncode == 0, primeira.stderr
    tip1 = _rev_parse_no_bare(bare, tmp_path, "deploy")

    segunda = _correr_publicar(repo, tmp_path, pasta=pasta, sha=sha1, branch="deploy")
    assert segunda.returncode == 0, segunda.stderr
    tip2 = _rev_parse_no_bare(bare, tmp_path, "deploy")

    assert tip1 is not None and tip2 is not None
    assert tip1 != tip2, (
        "republicar o mesmo SHA tem de mover a branch na mesma (um commit "
        "vazio é permitido) — senão um re-deploy manual não faz nada e "
        "parece ter feito"
    )

    conferencia = _arvore_da_branch(bare, tmp_path, "deploy", "conferencia")
    assert _listar_ficheiros_sem_git(conferencia) == _listar_ficheiros_sem_git(pasta)

    _assert_main_intocado(bare, tmp_path, sha_main)


# --- Anti-retrocesso ---


def test_recusa_publicar_sha_antepassado_do_ja_publicado(tmp_path: Path) -> None:
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "commit mais antigo")
    sha2 = _commit_vazio(repo, tmp_path, "commit mais recente, antepassado de sha1")

    pasta1 = _pasta_com_ficheiros(tmp_path, "pacote-1", {"api/VERSION": sha1})
    pasta2 = _pasta_com_ficheiros(tmp_path, "pacote-2", {"api/VERSION": sha2})

    # Publica o mais recente primeiro.
    primeira = _correr_publicar(repo, tmp_path, pasta=pasta2, sha=sha2, branch="deploy")
    assert primeira.returncode == 0, primeira.stderr
    tip_depois_da_primeira = _rev_parse_no_bare(bare, tmp_path, "deploy")

    # Agora tenta publicar o antepassado: tem de ser recusado.
    segunda = _correr_publicar(repo, tmp_path, pasta=pasta1, sha=sha1, branch="deploy")
    assert segunda.returncode != 0, (
        "publicar um SHA antepassado do já publicado tem de ser recusado "
        "(anti-retrocesso)"
    )

    tip_depois_da_segunda = _rev_parse_no_bare(bare, tmp_path, "deploy")
    assert tip_depois_da_segunda == tip_depois_da_primeira, (
        "uma publicação recusada não pode mexer na branch 'deploy'"
    )

    _assert_main_intocado(bare, tmp_path, sha_main)


# --- Nome de branch ---


def test_recusa_nome_de_branch_diferente_de_deploy(tmp_path: Path) -> None:
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "commit falso")
    pasta = _pasta_com_ficheiros(tmp_path, "pacote", {"api/VERSION": sha1})

    resultado = _correr_publicar(
        repo, tmp_path, pasta=pasta, sha=sha1, branch="producao"
    )

    assert resultado.returncode != 0, (
        "tem de recusar um nome de branch diferente de 'deploy'"
    )
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") is None
    assert _rev_parse_no_bare(bare, tmp_path, "producao") is None

    _assert_main_intocado(bare, tmp_path, sha_main)


# --- A ausência do `--force`, provada pelo comportamento ---


def test_recusa_quando_o_historico_remoto_nao_e_reconhecido(tmp_path: Path) -> None:
    """Prende a verificação de proveniência — NÃO prova, sozinho, a ausência de `--force` (ver o docstring do módulo).

    Chamava-se `test_push_sem_force_recusa_quando_o_remoto_divergiu` e
    pretendia provar a ausência de `--force`, divergindo a branch
    `deploy` do `bare` por fora do script (um commit órfão, sem relação
    nenhuma com o histórico que o script conhece) e confirmando que uma
    publicação a seguir era recusada. A validação por mutação (pedida
    pelo Tomás) confirmou que isto estava enganado: um commit órfão não
    tem a linha `Sha-Origem: <sha>` que o script exige para reconhecer o
    histórico de `deploy` como seu — por isso a recusa acontece ali,
    na verificação de proveniência, muito antes do script sequer chamar
    `git push`. Acrescentar `--force` ao `git push` do script não
    derrubava este teste nenhum: continua a recusar antes de lá chegar.

    Continua a ser um teste válido e a valer a pena manter — é a única
    cobertura de "a branch já existe, mas o commit de topo não é
    reconhecido como nosso" — só que já não figura como prova da
    ausência de `--force`. Essa prova está em
    `test_git_push_nunca_leva_flag_de_force`, a seguir.
    """
    bare, sha_main = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    sha2 = _commit_vazio(repo, tmp_path, "segundo commit falso")

    pasta1 = _pasta_com_ficheiros(tmp_path, "pacote-1", {"api/VERSION": sha1})
    pasta2 = _pasta_com_ficheiros(tmp_path, "pacote-2", {"api/VERSION": sha2})

    primeira = _correr_publicar(repo, tmp_path, pasta=pasta1, sha=sha1, branch="deploy")
    assert primeira.returncode == 0, primeira.stderr

    # Diverge 'deploy' no bare, fora do script: um clone descartável,
    # história completamente diferente (órfã), empurrada com força — só
    # aqui, para preparar o mundo do teste, nunca pelo script sob teste.
    divergente = tmp_path / "divergente"
    _git(tmp_path, tmp_path, "clone", "--quiet", str(bare), str(divergente))
    _git(divergente, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(divergente, tmp_path, "config", "user.name", "QA Tomazia")
    _git(
        divergente, tmp_path, "checkout", "--quiet", "--orphan", "divergencia-de-teste"
    )
    _git(
        divergente,
        tmp_path,
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "história sem relação nenhuma com a do repo_origem",
    )
    _git(
        divergente,
        tmp_path,
        "push",
        "--quiet",
        "--force",
        "origin",
        "divergencia-de-teste:deploy",
    )
    tip_divergente = _rev_parse_no_bare(bare, tmp_path, "deploy")
    assert tip_divergente is not None

    segunda = _correr_publicar(repo, tmp_path, pasta=pasta2, sha=sha2, branch="deploy")

    assert segunda.returncode != 0, (
        "uma branch 'deploy' cujo commit de topo não tem a linha "
        "'Sha-Origem: <sha>' reconhecida tem de ser recusada — histórico "
        "que o script não pode confirmar que é seu"
    )
    assert _rev_parse_no_bare(bare, tmp_path, "deploy") == tip_divergente, (
        "a branch divergente tem de ficar exatamente como estava: nenhuma "
        "tentativa de publicação recusada pode mexer nela"
    )

    _assert_main_intocado(bare, tmp_path, sha_main)


def test_git_push_nunca_leva_flag_de_force(tmp_path: Path) -> None:
    """Prova direta, por observação do comportamento, de que `publicar-branch.sh` nunca passa `--force`/`--force-with-lease`/`-f` a `git push`.

    Usa o `git` "espião" de `_ambiente_com_espiao_de_git` (ver o docstring
    do módulo, sobre o achado da validação por mutação): corre duas
    publicações a sério (a primeira cria a branch; a segunda é um
    fast-forward sobre a primeira), e depois confirma que NENHUMA das
    chamadas a `git push` registadas leva uma flag de force — nem
    `--force`, nem `--force-with-lease`, nem o equivalente curto `-f`.

    Esta é a prova que fica depois do achado: `test_recusa_quando_o_historico_remoto_nao_e_reconhecido`
    (acima) já não a faz sozinho, porque a recusa que ele prende acontece
    antes do script sequer chamar `git push`.
    """
    bare, _ = _preparar_bare_com_main(tmp_path)
    repo = _preparar_repo_origem(tmp_path, bare)
    sha1 = _commit_vazio(repo, tmp_path, "primeiro commit falso")
    sha2 = _commit_vazio(repo, tmp_path, "segundo commit falso")

    pasta1 = _pasta_com_ficheiros(tmp_path, "pacote-1", {"api/VERSION": sha1})
    pasta2 = _pasta_com_ficheiros(tmp_path, "pacote-2", {"api/VERSION": sha2})

    ambiente_espiao, registo = _ambiente_com_espiao_de_git(tmp_path)

    primeira = subprocess.run(
        [str(SCRIPT), "--pasta", str(pasta1), "--sha", sha1, "--branch", "deploy"],
        cwd=repo,
        env=ambiente_espiao,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert primeira.returncode == 0, primeira.stderr

    segunda = subprocess.run(
        [str(SCRIPT), "--pasta", str(pasta2), "--sha", sha2, "--branch", "deploy"],
        cwd=repo,
        env=ambiente_espiao,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert segunda.returncode == 0, segunda.stderr

    linhas_de_push = [
        linha
        for linha in registo.read_text(encoding="utf-8").splitlines()
        if linha.split() and linha.split()[0] == "push"
    ]
    assert len(linhas_de_push) >= 2, (
        f"esperava pelo menos duas chamadas a 'git push' (uma por "
        f"publicação), vi {len(linhas_de_push)}: {linhas_de_push!r}"
    )
    for linha in linhas_de_push:
        assert "--force" not in linha, f"'git push' com '--force': {linha!r}"
        assert "--force-with-lease" not in linha, (
            f"'git push' com '--force-with-lease': {linha!r}"
        )
        assert not re.search(r"(^|\s)-f(\s|$)", linha), (
            f"'git push' com '-f': {linha!r}"
        )
