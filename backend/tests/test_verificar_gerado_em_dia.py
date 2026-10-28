"""`.github/scripts/verificar-gerado-em-dia.sh`: a guarda "os tipos gerados estão em dia?" (F2-09).

O critério da F2-09 é literal — "o CI falha se os tipos gerados não
estiverem atualizados" — e a guarda que o cumpria estava embutida num
`run:` do job `contrato`, assim:

    if [ -n "$(git status --porcelain -- frontend/src/lib/api)" ]; then ...

Tinha três buracos, e este ficheiro prende a resposta a cada um:

- **Provava ausência de diferença, não presença de geração.** Um gerador
  que não escreva nada não deixa diferença nenhuma, e a guarda ficava
  verde. Resposta: o caminho que não existe (ou existe vazio) sai **3**,
  nunca 0 — `test_caminho_inexistente_sai_tres`,
  `test_diretoria_vazia_sai_tres`.
- **A substituição de comandos engolia o estado do git.** Com o `git` a
  falhar (128, a razão em stderr), a saída vinha vazia, o `-n` dava falso
  e o passo ficava **verde** — e o `set -e` não salva, porque dentro da
  condição de um `if` o `errexit` está desligado. Resposta: o estado é
  guardado à mão e sai **2** — `test_git_que_nao_responde_sai_dois`, o
  irmão de `tests/seguranca/test_montar_auditoria_distingue_avaria.py`.
- **Nenhum caminho era "todos os caminhos".** Resposta: zero `--caminho`
  é erro de uso, nunca sucesso — `test_sem_caminho_nenhum_e_erro`.

Cada teste invoca o script REAL por subprocesso, a partir do seu caminho
verdadeiro dentro do checkout (nunca uma cópia, nunca um import), contra
um repositório git fabricado em `tmp_path`. `GIT_CEILING_DIRECTORIES=tmp_path`
em todo o lado, como no resto da suite (ver `test_publicar_branch.py`):
mesmo a correr de dentro de um clone git real, nenhuma operação git
destes testes consegue "subir" e encontrar o repositório do projeto por
engano. Nada aqui escreve no repositório real nem contacta a rede.

## O que estes testes deixam passar

- **Nada sobre o `ci.yml`.** Que o job `contrato` chame mesmo este
  script, com o caminho certo e na ordem certa, é `test_ci_job_contrato.py`;
  aqui o script podia estar a ser chamado por ninguém e passava na mesma.
- **Nada sobre o gerador.** Nenhum teste corre `npm run gerar-api`: os
  "tipos" são ficheiros de texto fabricados. Um `gerar-api` que escreva
  lixo (mas escreva, e sempre o mesmo lixo) passa por esta guarda.
- **`--literal-pathspecs` não é exercitado.** Todos os caminhos usados
  aqui são nomes simples, sem `*`, `?` nem magia de pathspec; se a flag
  desaparecesse do script, nenhum destes testes caía.
- **A mensagem não é afirmada palavra a palavra**, só que a sugestão de
  `--sugestao` e a razão dada pelo git chegam à saída. Reescrever o texto
  à volta não parte nada — de propósito.
- **O `git` do sistema é o que estiver na máquina.** Comportamentos que
  dependam de uma versão específica do git (p. ex. o `--no-index` do
  `check-ignore`) só se descobrem a correr isto, não a lê-lo.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[2]
SCRIPT = RAIZ_REPO / ".github" / "scripts" / "verificar-gerado-em-dia.sh"

EM_DIA = 0
HA_DIFERENCAS = 1
NAO_CONSEGUI_VERIFICAR = 2
CAMINHO_INEXISTENTE = 3
USO_ERRADO = 64

#: Caminho vigiado dentro do repositório fabricado. Imita a forma do
#: caminho real (`frontend/src/lib/api/gerado`) sem lhe estar preso: o
#: que liga os dois é `test_ci_job_contrato.py`, não este ficheiro.
GERADO = "src/lib/api/gerado"
TIPOS = f"{GERADO}/esquema.ts"

#: Ficheiro escrito à mão, irmão da pasta gerada: existe para provar que
#: a guarda olha só para o `--caminho` que lhe deram.
ESCRITO_A_MAO = "src/lib/api/cliente.ts"

#: `git` de teste: regista o subcomando de cada chamada, avaria o que o
#: teste mandar avariar (128 + razão em stderr, como um índice corrompido
#: ou um repositório em falta) e delega todos os outros no `git` real.
#: Mesmo princípio do `find` de teste em
#: `tests/seguranca/test_montar_auditoria_distingue_avaria.py`.
#:
#: O subcomando é o PRIMEIRO argumento que não começa por `-`: o script
#: chama `git --literal-pathspecs status ...` e `git check-ignore
#: --no-index -- ...`, por isso a posição não é fixa.
STUB_GIT = """\
#!/usr/bin/env bash
set -u

subcomando=""
for argumento in "$@"; do
  case "$argumento" in
    -*) ;;
    *) subcomando="$argumento"; break ;;
  esac
done

printf '%s\\n' "$subcomando" >>"${TOMAZIA_TESTE_GIT_REGISTO}"

if [ "$subcomando" = "${TOMAZIA_TESTE_GIT_AVARIADO}" ]; then
  echo "fatal: avaria fabricada pelo teste em 'git ${subcomando}'" >&2
  exit 128
fi

exec "${TOMAZIA_TESTE_GIT_REAL}" "$@"
"""


def _ambiente(tmp_path: Path) -> dict[str, str]:
    ambiente = os.environ.copy()
    ambiente["GIT_CEILING_DIRECTORIES"] = str(tmp_path)
    ambiente["GIT_TERMINAL_PROMPT"] = "0"
    return ambiente


def _git(repo: Path, tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Corre `git` com sucesso esperado — só para preparar o mundo do teste, nunca o que está sob teste."""
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


def _escrever(repo: Path, relativo: str, conteudo: str) -> Path:
    caminho = repo / relativo
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(conteudo, encoding="utf-8")
    return caminho


def _preparar_repo(tmp_path: Path) -> Path:
    """Repositório git fabricado, com os "tipos gerados" já versionados e a árvore limpa."""
    repo = tmp_path / "projeto"
    repo.mkdir()
    _git(repo, tmp_path, "init", "--quiet")
    _git(repo, tmp_path, "config", "user.email", "qa@exemplo.test")
    _git(repo, tmp_path, "config", "user.name", "QA Tomazia")
    _escrever(repo, TIPOS, "export type Ementa = { nome: string };\n")
    _escrever(repo, ESCRITO_A_MAO, "export const base = '/api';\n")
    _git(repo, tmp_path, "add", "-A")
    _git(repo, tmp_path, "commit", "--quiet", "-m", "tipos gerados, falsos")
    return repo


def _correr(
    repo: Path,
    tmp_path: Path,
    *args: str,
    ambiente: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Invoca o script REAL por subprocesso, a partir do seu caminho verdadeiro. Nunca o importa."""
    return subprocess.run(
        [str(SCRIPT), *args],
        cwd=repo,
        env=_ambiente(tmp_path) if ambiente is None else ambiente,
        capture_output=True,
        text=True,
        timeout=30,
    )


def _ambiente_com_git_avariado(
    tmp_path: Path, *, subcomando_avariado: str
) -> tuple[dict[str, str], Path]:
    """Ambiente com o `git` de teste à frente no `PATH`. Devolve também o ficheiro de registo."""
    git_real = shutil.which("git")
    assert git_real is not None, "git tem de estar no PATH para este teste correr"

    pasta_stub = tmp_path / "bin-de-teste"
    pasta_stub.mkdir(parents=True, exist_ok=True)
    stub = pasta_stub / "git"
    stub.write_text(STUB_GIT, encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    registo = tmp_path / "git-registo.txt"

    ambiente = _ambiente(tmp_path)
    ambiente["PATH"] = f"{pasta_stub}{os.pathsep}{ambiente['PATH']}"
    ambiente["TOMAZIA_TESTE_GIT_REAL"] = git_real
    ambiente["TOMAZIA_TESTE_GIT_REGISTO"] = str(registo)
    ambiente["TOMAZIA_TESTE_GIT_AVARIADO"] = subcomando_avariado
    return ambiente, registo


def _subcomandos(registo: Path) -> list[str]:
    if not registo.is_file():
        return []
    return registo.read_text(encoding="utf-8").split()


# --- Em dia (0) e com diferenças (1) ---


def test_controlo_arvore_limpa_sai_zero(tmp_path: Path) -> None:
    """Controlo: sem isto, um script que saísse != 0 em qualquer caso fazia todos os testes de falha abaixo passar pela razão errada.

    Deixa passar: qualquer coisa sobre o conteúdo dos ficheiros. Só diz
    que uma árvore sem deriva nenhuma é aceite.
    """
    repo = _preparar_repo(tmp_path)

    resultado = _correr(repo, tmp_path, "--caminho", GERADO)

    assert resultado.returncode == EM_DIA, (
        f"uma árvore limpa tem de sair {EM_DIA}.\nstdout:\n{resultado.stdout}\n"
        f"stderr:\n{resultado.stderr}"
    )


def test_ficheiro_gerado_alterado_sai_um(tmp_path: Path) -> None:
    """O caso central do critério da F2-09: os tipos versionados não são o que o gerador acabou de escrever.

    Deixa passar: um gerador que produza sempre o mesmo ficheiro errado —
    a guarda compara com o que está versionado, não com a verdade.
    """
    repo = _preparar_repo(tmp_path)
    _escrever(repo, TIPOS, "export type Ementa = { nome: string; preco: number };\n")

    resultado = _correr(
        repo,
        tmp_path,
        "--caminho",
        GERADO,
        "--sugestao",
        "cd frontend && npm run gerar-api",
    )

    assert resultado.returncode == HA_DIFERENCAS, (
        f"um tipo gerado alterado tem de sair {HA_DIFERENCAS}.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
    saida = resultado.stdout + resultado.stderr
    assert "npm run gerar-api" in saida, (
        "a sugestão de --sugestao tem de chegar a quem vê a falha; senão "
        f"sabe que falhou e não o que fazer. Saída:\n{saida}"
    )
    assert TIPOS in saida, (
        f"o caminho exato que mudou tem de aparecer na saída. Saída:\n{saida}"
    )


def test_ficheiro_novo_por_versionar_dentro_do_caminho_sai_um(tmp_path: Path) -> None:
    """Um tipo gerado NOVO e nunca commitado também é deriva — é por isto que a guarda usa `--untracked-files=all`.

    Sem `--untracked-files=all` (ou com `git diff --exit-code`, que nem o
    vê), este caso saía 0: não há diferença nenhuma num ficheiro que o
    git ainda não conhece.

    Deixa passar: um ficheiro novo criado FORA do caminho vigiado, que é
    o que se quer (ver `test_mudanca_fora_do_caminho_nao_conta`).
    """
    repo = _preparar_repo(tmp_path)
    _escrever(repo, f"{GERADO}/operacoes.ts", "export type Operacoes = never;\n")

    resultado = _correr(repo, tmp_path, "--caminho", GERADO)

    assert resultado.returncode == HA_DIFERENCAS, (
        f"um ficheiro gerado novo e por versionar tem de sair {HA_DIFERENCAS}.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
    assert "operacoes.ts" in resultado.stdout + resultado.stderr


def test_untracked_files_all_vence_a_configuracao_do_repositorio(
    tmp_path: Path,
) -> None:
    """`--untracked-files=all` explícito, e não o valor por omissão: a configuração do repositório pode esconder os ficheiros novos.

    Achado de validação por mutação: tirar `--untracked-files=all` do
    script não derrubava `test_ficheiro_novo_por_versionar_dentro_do_caminho_sai_um`.
    Com o valor por omissão (`normal`), um ficheiro novo dentro de uma
    pasta que já tem conteúdo versionado aparece à mesma — aquele teste
    passava pela razão errada. O que a flag explícita compra mesmo é
    imunidade a `status.showUntrackedFiles=no`, que esconde os ficheiros
    novos TODOS e deixaria esta guarda verde sobre um gerador que só
    acrescenta ficheiros. A configuração pode vir do repositório ou da
    máquina de quem corre, e nenhuma delas é nossa.

    Deixa passar: `status.showUntrackedFiles=normal` com uma pasta
    gerada inteiramente nova (o git mostra `?? pasta/`, a guarda falha na
    mesma — só com menos detalhe na mensagem).
    """
    repo = _preparar_repo(tmp_path)
    _git(repo, tmp_path, "config", "status.showUntrackedFiles", "no")
    _escrever(repo, f"{GERADO}/operacoes.ts", "export type Operacoes = never;\n")

    # Premissa, explícita: sem a flag, o git não diz nada sobre o ficheiro novo.
    estado = _git(repo, tmp_path, "status", "--porcelain", "--", GERADO)
    assert estado.stdout == "", (
        "premissa deste teste: com status.showUntrackedFiles=no, um "
        "'git status --porcelain' sem a flag não vê o ficheiro novo. "
        f"Viu: {estado.stdout!r}"
    )

    resultado = _correr(repo, tmp_path, "--caminho", GERADO)

    assert resultado.returncode == HA_DIFERENCAS, (
        "a guarda tem de passar '--untracked-files=all' explicitamente; "
        "senão a configuração do repositório (ou da máquina) decide o que "
        f"ela consegue ver.\nstdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )


def test_ficheiro_gerado_apagado_sai_um(tmp_path: Path) -> None:
    """O outro buraco do `git diff --exit-code`: um ficheiro que deixou de existir não tem diff para mostrar.

    Deixa passar: a pasta inteira apagada, que é outro caso (sai 3, ver
    `test_caminho_inexistente_sai_tres`).
    """
    repo = _preparar_repo(tmp_path)
    _escrever(repo, f"{GERADO}/.gitkeep", "")
    (repo / TIPOS).unlink()

    resultado = _correr(repo, tmp_path, "--caminho", GERADO)

    assert resultado.returncode == HA_DIFERENCAS, (
        f"um tipo gerado apagado tem de sair {HA_DIFERENCAS}.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )


def test_mudanca_fora_do_caminho_nao_conta(tmp_path: Path) -> None:
    """O `--caminho` tem de delimitar mesmo: o cliente escrito à mão, ao lado da pasta gerada, pode divergir à vontade.

    É o que justifica estreitar o caminho de `src/lib/api` para
    `src/lib/api/gerado` no `ci.yml`: o resto da pasta é código de
    pessoas, lintado e testado pelo job `frontend`.

    Deixa passar: nada diz que o caminho REAL do `ci.yml` é o certo —
    isso é `test_ci_job_contrato.py`.
    """
    repo = _preparar_repo(tmp_path)
    _escrever(repo, ESCRITO_A_MAO, "export const base = '/api/v2';\n")
    _escrever(repo, "src/lib/api/novo-a-mao.ts", "export const x = 1;\n")

    resultado = _correr(repo, tmp_path, "--caminho", GERADO)

    assert resultado.returncode == EM_DIA, (
        "alterações fora do --caminho não podem contar como deriva dos "
        f"tipos gerados.\nstdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )


def test_segundo_caminho_tambem_e_verificado(tmp_path: Path) -> None:
    """`--caminho` é repetível, e cada um conta: uma deriva no segundo tem de falhar tanto como no primeiro.

    Sem isto, uma implementação que só olhasse para o primeiro `--caminho`
    passava em todos os outros testes deste ficheiro.

    Deixa passar: a ordem e o número de caminhos na mensagem de erro.
    """
    repo = _preparar_repo(tmp_path)
    _escrever(repo, "src/lib/outro-gerado/tipos.ts", "export type A = 1;\n")
    _git(repo, tmp_path, "add", "-A")
    _git(repo, tmp_path, "commit", "--quiet", "-m", "segundo gerado, falso")
    _escrever(repo, "src/lib/outro-gerado/tipos.ts", "export type A = 2;\n")

    resultado = _correr(
        repo, tmp_path, "--caminho", GERADO, "--caminho", "src/lib/outro-gerado"
    )

    assert resultado.returncode == HA_DIFERENCAS, (
        "uma deriva no segundo --caminho tem de falhar tanto como no "
        f"primeiro.\nstdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )


# --- "Não consegui perguntar" nunca é "não há diferenças" (2) ---


def test_controlo_o_git_de_teste_e_mesmo_usado_e_nao_altera_o_resultado(
    tmp_path: Path,
) -> None:
    """Controlo do `git` de teste: sem avaria nenhuma injetada, a árvore limpa continua a sair 0 — e passou mesmo pelo stub.

    Sem este controlo, `test_git_que_nao_responde_sai_dois` podia passar
    por o stub nem sequer ser chamado (um `git` resolvido por caminho
    absoluto dentro do script, por exemplo), ou por o stub partir tudo
    por outra razão qualquer.

    Deixa passar: a ordem exata dos subcomandos. Só exige que os dois que
    importam (`check-ignore` e `status`) tenham passado por aqui.
    """
    repo = _preparar_repo(tmp_path)
    ambiente, registo = _ambiente_com_git_avariado(
        tmp_path, subcomando_avariado="nenhum"
    )

    resultado = _correr(repo, tmp_path, "--caminho", GERADO, ambiente=ambiente)

    assert resultado.returncode == EM_DIA, (
        "com o git de teste no PATH mas sem avaria nenhuma, uma árvore "
        f"limpa tem de continuar a sair {EM_DIA}.\nstdout:\n{resultado.stdout}\n"
        f"stderr:\n{resultado.stderr}"
    )
    vistos = _subcomandos(registo)
    assert "status" in vistos and "check-ignore" in vistos, (
        "o git de teste tem de ver o 'check-ignore' e o 'status' do "
        f"script; viu {vistos!r}. Sem isto, o teste de avaria a seguir "
        "nunca avariaria nada."
    )


@pytest.mark.parametrize("subcomando_avariado", ["status", "check-ignore"])
def test_git_que_nao_responde_sai_dois(
    tmp_path: Path, subcomando_avariado: str
) -> None:
    """Regra 10, na forma mais pura: "não há diferenças" e "não consegui perguntar" nunca podem dar o mesmo resultado.

    A árvore está LIMPA (o mesmo cenário de
    `test_controlo_arvore_limpa_sai_zero`, que sai 0), e só o git é que
    avaria. Se o script lesse `[ -n "$(git status ...)" ]`, a saída vinha
    vazia, o `-n` dava falso e isto ficava verde — e o `set -e` não
    salvaria, porque dentro da condição de um `if` o `errexit` está
    desligado.

    Deixa passar: qualquer outra avaria do git que não seja um estado de
    saída != 0 — um `git` que mentisse com estado 0 e saída vazia é
    indistinguível de um git sadio, aqui e em qualquer outro sítio.
    """
    repo = _preparar_repo(tmp_path)
    ambiente, registo = _ambiente_com_git_avariado(
        tmp_path, subcomando_avariado=subcomando_avariado
    )

    resultado = _correr(repo, tmp_path, "--caminho", GERADO, ambiente=ambiente)

    assert subcomando_avariado in _subcomandos(registo), (
        f"o 'git {subcomando_avariado}' nem chegou a correr — este teste "
        f"não avariou nada. Subcomandos vistos: {_subcomandos(registo)!r}."
    )
    assert resultado.returncode != EM_DIA, (
        f"o 'git {subcomando_avariado}' saiu 128 e a guarda ficou VERDE. "
        "Um guarda que passa porque não conseguiu perguntar é um guarda "
        f"que não existe.\nstdout:\n{resultado.stdout}"
    )
    assert resultado.returncode == NAO_CONSEGUI_VERIFICAR, (
        f"'o git não respondeu' tem de ter o seu próprio estado de saída "
        f"({NAO_CONSEGUI_VERIFICAR}), distinto de 'há diferenças' "
        f"({HA_DIFERENCAS}) e de 'não foi gerado nada' ({CAMINHO_INEXISTENTE}); "
        f"saiu {resultado.returncode}.\nstdout:\n{resultado.stdout}\n"
        f"stderr:\n{resultado.stderr}"
    )
    assert "avaria fabricada pelo teste" in resultado.stderr, (
        "a razão dada pelo próprio git tem de chegar a quem investiga — "
        f"senão fica a saber que falhou, mas não porquê. stderr:\n{resultado.stderr}"
    )


def test_caminho_abrangido_pelo_gitignore_sai_dois(tmp_path: Path) -> None:
    """Um caminho ignorado é invisível para o `git status`: ficheiros gerados novos nunca lá apareceriam, e a guarda ficava verde para sempre.

    Não é hipotético neste projeto: o `frontend/openapi.json` já é um
    artefacto gerado e ignorado de propósito, e ignorar "os ficheiros
    gerados" é o passo seguinte que parece óbvio e cega esta guarda.

    Deixa passar: uma regra de `.gitignore` que abranja só PARTE do
    caminho (p. ex. `*.d.ts` dentro da pasta gerada) — o `check-ignore`
    sobre a pasta responde "não ignorada" e os ficheiros abrangidos
    continuam invisíveis.
    """
    repo = _preparar_repo(tmp_path)
    _escrever(repo, ".gitignore", f"{GERADO}/\n")
    _escrever(repo, f"{GERADO}/operacoes.ts", "export type Operacoes = never;\n")

    # Premissa do teste, explícita: o `git status` sozinho não vê nada
    # aqui — é exatamente por isso que a guarda não se pode ficar por ele.
    estado = _git(
        repo, tmp_path, "status", "--porcelain", "--untracked-files=all", "--", GERADO
    )
    assert estado.stdout == "", (
        "premissa deste teste: com a pasta no .gitignore, o 'git status' "
        f"não tem nada a dizer sobre ela. Disse: {estado.stdout!r}"
    )

    resultado = _correr(repo, tmp_path, "--caminho", GERADO)

    assert resultado.returncode == NAO_CONSEGUI_VERIFICAR, (
        "um caminho abrangido pelo .gitignore não é 'em dia': é 'não "
        f"consigo verificar isto' ({NAO_CONSEGUI_VERIFICAR}). Saiu "
        f"{resultado.returncode}.\nstdout:\n{resultado.stdout}\n"
        f"stderr:\n{resultado.stderr}"
    )
    assert ".gitignore" in resultado.stdout + resultado.stderr


# --- "Não foi gerado nada" nunca é "está em dia" (3) ---


def test_caminho_inexistente_sai_tres(tmp_path: Path) -> None:
    """O gerador falhou em silêncio e não escreveu nada: não há diferença nenhuma a assinalar, e é por isso mesmo que não pode ser 0.

    É o buraco (a): a guarda antiga provava ausência de diferença, não
    presença de geração.

    Deixa passar: um caminho que existe com o conteúdo errado — isso é um
    problema do gerador, não desta guarda.
    """
    repo = _preparar_repo(tmp_path)

    resultado = _correr(repo, tmp_path, "--caminho", "src/lib/api/nunca-gerado")

    assert resultado.returncode == CAMINHO_INEXISTENTE, (
        f"um caminho que não existe tem de sair {CAMINHO_INEXISTENTE}, "
        f"nunca {EM_DIA}; saiu {resultado.returncode}.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
    assert "nunca-gerado" in resultado.stdout + resultado.stderr


def test_diretoria_vazia_sai_tres(tmp_path: Path) -> None:
    """Uma pasta vazia é "não foi gerado nada" com outra roupa: o git não versiona pastas, por isso o `status` não teria nada a dizer.

    Deixa passar: uma pasta com um ficheiro gerado a zero bytes, ou com
    só um `.gitkeep` — conta como conteúdo.
    """
    repo = _preparar_repo(tmp_path)
    (repo / "src" / "lib" / "api" / "vazio").mkdir(parents=True)

    resultado = _correr(repo, tmp_path, "--caminho", "src/lib/api/vazio")

    assert resultado.returncode == CAMINHO_INEXISTENTE, (
        "uma pasta vazia depois de correr o gerador tem de sair "
        f"{CAMINHO_INEXISTENTE}, nunca {EM_DIA}; saiu {resultado.returncode}.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )


# --- Uso errado (64), que nunca é sucesso ---


def test_sem_caminho_nenhum_e_erro(tmp_path: Path) -> None:
    """Zero caminhos é "não verifiquei nada", e isso nunca pode sair 0.

    O estado de saída é deliberadamente distinto do 2: assim
    `test_git_que_nao_responde_sai_dois` não pode passar por acidente só
    por ter os argumentos trocados.

    Deixa passar: a redação da mensagem de uso.
    """
    repo = _preparar_repo(tmp_path)

    resultado = _correr(repo, tmp_path, "--sugestao", "npm run gerar-api")

    assert resultado.returncode == USO_ERRADO, (
        f"sem nenhum --caminho o script tem de sair {USO_ERRADO} (uso "
        f"errado), nunca {EM_DIA} nem {NAO_CONSEGUI_VERIFICAR}; saiu "
        f"{resultado.returncode}.\nstdout:\n{resultado.stdout}\n"
        f"stderr:\n{resultado.stderr}"
    )


@pytest.mark.parametrize(
    "argumentos",
    [
        pytest.param(["--caminho"], id="caminho-sem-valor"),
        pytest.param(["--caminho", ""], id="caminho-vazio"),
        pytest.param(["--caminho", GERADO, "--sugestao"], id="sugestao-sem-valor"),
        pytest.param(["--caminho", GERADO, "--desconhecido"], id="argumento-estranho"),
    ],
)
def test_argumentos_invalidos_sao_erro(tmp_path: Path, argumentos: list[str]) -> None:
    """Um argumento mal passado nunca pode ser lido como "verifiquei e está tudo bem".

    O `--caminho ""` tem razão própria: um pathspec vazio é um erro para
    o git, mas noutras ferramentas significaria "tudo" — num guarda, as
    duas leituras são más.

    Deixa passar: a ordem de verificação dos argumentos.
    """
    repo = _preparar_repo(tmp_path)

    resultado = _correr(repo, tmp_path, *argumentos)

    assert resultado.returncode == USO_ERRADO, (
        f"{argumentos!r} tem de sair {USO_ERRADO}; saiu {resultado.returncode}.\n"
        f"stdout:\n{resultado.stdout}\nstderr:\n{resultado.stderr}"
    )
