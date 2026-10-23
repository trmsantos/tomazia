"""O bit de execução dos scripts de `deploy/` (F1-04, infra).

`deploy.yml` invoca quatro deles diretamente, sem `bash` à frente —
`deploy/montar.sh --sha ... --saida ...`, `deploy/publicar-branch.sh
...`, `deploy/pedir-deploy.sh`, `deploy/esperar-versao.sh ...` — por isso
nesses o modo em disco é o que decide se o passo corre ou dá "Permission
denied".

O `deploy.sh` é a exceção, e vale a pena dizê-lo em vez de o arrumar na
mesma frase: o `.cpanel.yml` corre `/bin/bash deploy/deploy.sh`, com o
interpretador explícito, portanto para ESSE o bit é indiferente no
caminho que conta. Fica na varredura à mesma, por duas razões honestas —
consistência entre os cinco, e quem o corra à mão a partir da shell do
servidor, que é como se depura um deploy falhado.

O `deploy.yml` já teve um `chmod +x` antes desses passos. Deixou de o ter
quando o modo passou a estar em git (os cinco estão a `100755`), que é o
sítio certo para a informação viver: o `chmod` corrigia o sintoma em cada
corrida e escondia um ficheiro mal criado. Só que, sem este teste, um
script novo acrescentado a `deploy/` com o modo `100644` por omissão
passa o CI inteiro e só se descobre em produção, no meio de um deploy —
e os testes de `deploy/*.sh` que existem hoje nunca dariam por isso,
porque todos invocam o script por `bash <caminho>` (preciso para os
isolar num `$HOME` falso) ou pelo caminho de uma CÓPIA feita pelo próprio
teste, com o modo da cópia.

Por isso o teste é sobre a pasta, nunca sobre uma lista fixa de nomes:
varre `deploy/*.sh` e exige o bit de execução a todos. Um script novo
entra na varredura sozinho. A lista fixa aparece só uma vez, no teste de
controlo abaixo, para garantir que a varredura não está vazia (um
`glob` que deixasse de encontrar seja o que for faria o teste principal
passar sem verificar nada).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[2]
PASTA_DEPLOY = RAIZ_REPO / "deploy"

#: Os cinco que existem hoje. Só servem para provar que o `glob` do teste
#: principal encontra mesmo alguma coisa — a verificação em si é sobre
#: tudo o que esteja em `deploy/*.sh`, incluindo o que ainda não existe.
SCRIPTS_CONHECIDOS = [
    "deploy.sh",
    "esperar-versao.sh",
    "montar.sh",
    "pedir-deploy.sh",
    "publicar-branch.sh",
]


def _scripts() -> list[Path]:
    return sorted(PASTA_DEPLOY.glob("*.sh"))


def test_a_pasta_deploy_tem_os_scripts_conhecidos() -> None:
    """Controlo: sem isto, um `glob` vazio fazia o teste abaixo passar sem verificar nada."""
    assert PASTA_DEPLOY.is_dir(), f"{PASTA_DEPLOY} não existe."
    encontrados = [caminho.name for caminho in _scripts()]
    em_falta = [nome for nome in SCRIPTS_CONHECIDOS if nome not in encontrados]
    assert em_falta == [], (
        f"Faltam scripts em {PASTA_DEPLOY}: {em_falta!r}. Se algum foi "
        "mesmo removido ou mudou de nome, atualiza SCRIPTS_CONHECIDOS — "
        "esta lista existe para o teste do bit de execução não poder "
        f"passar a varrer uma pasta vazia. Encontrei {encontrados!r}."
    )


@pytest.mark.parametrize(
    "script", _scripts(), ids=lambda caminho: str(Path(caminho).name)
)
def test_script_de_deploy_tem_o_bit_de_execucao(script: Path) -> None:
    """`deploy.yml` invoca-os pelo caminho: sem o bit, o passo morre com "Permission denied"."""
    assert os.access(script, os.X_OK), (
        f"{script.relative_to(RAIZ_REPO)} não tem o bit de execução (modo "
        f"{script.stat().st_mode & 0o777:o}). O `deploy.yml` invoca estes "
        "scripts pelo caminho, sem `bash` à frente (a exceção é o "
        "`deploy.sh`, que o `.cpanel.yml` corre com `/bin/bash` explícito, "
        "mas que se corre à mão no servidor a depurar um deploy falhado) — "
        "o modo tem de estar em git (`git update-index --chmod=+x`), nunca "
        "num `chmod +x` do workflow."
    )
