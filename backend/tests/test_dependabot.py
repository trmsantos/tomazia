"""Os tetos de versão do frontend (ADR 0007).

Três decisões — Tailwind na 3.4, tipos de Node a acompanhar o `.nvmrc`,
eslint no 9 — vivem em `.github/dependabot.yml`. Este ficheiro prende-as.

O teste que mais interessa é o do `@types/node`. Dos três tetos é o único
cuja violação é SILENCIOSA: subir o Tailwind parte o build, subir o
eslint parte o `npm ci` (peer do `eslint-plugin-jsx-a11y`), mas tipos de
Node 26 com um Node 22 a correr compilam sem uma queixa e só falham em
execução, quando alguém usa uma API que a versão real não tem.

O ADR tem o critério de levantamento de cada teto. Se um deles for
levantado de propósito, o teste correspondente cai — e é suposto: cai
junto com a entrada no `dependabot.yml`, no mesmo PR, com o ADR
atualizado.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

RAIZ_REPO = Path(__file__).resolve().parents[2]
DEPENDABOT = RAIZ_REPO / ".github" / "dependabot.yml"
PACKAGE_JSON = RAIZ_REPO / "frontend" / "package.json"
NVMRC = RAIZ_REPO / ".nvmrc"

# Quatro pacotes, três razões: o `eslint` e o `@eslint/js` sobem juntos e
# caem pelo mesmo motivo.
COM_TETO_DE_MAJOR = ["tailwindcss", "@types/node", "eslint", "@eslint/js"]


def _bloco_npm() -> dict:
    config = yaml.safe_load(DEPENDABOT.read_text(encoding="utf-8"))
    blocos = [u for u in config["updates"] if u["package-ecosystem"] == "npm"]
    assert len(blocos) == 1, (
        f"esperava um único bloco npm em {DEPENDABOT.name}, encontrei "
        f"{len(blocos)} — este ficheiro de teste olha só para o primeiro."
    )
    return blocos[0]


def _major(intervalo: str) -> int:
    """`^22.20.5` -> 22. Rejeita o que não souber ler, em vez de adivinhar."""
    achado = re.match(r"^[\^~]?(\d+)\.", intervalo)
    assert achado is not None, (
        f"não sei ler o major de '{intervalo}' — se a forma do intervalo "
        "mudou, este teste tem de ser atualizado em vez de ignorado."
    )
    return int(achado.group(1))


@pytest.mark.parametrize("pacote", COM_TETO_DE_MAJOR)
def test_dependabot_ignora_o_major(pacote: str) -> None:
    """Cada teto do ADR 0007 tem de estar mesmo no `dependabot.yml`."""
    ignorados = {
        entrada["dependency-name"]: entrada.get("update-types", [])
        for entrada in _bloco_npm().get("ignore", [])
    }
    assert pacote in ignorados, (
        f"'{pacote}' devia ter um teto de major em {DEPENDABOT.name} (ADR "
        "0007). Sem ele, o Dependabot volta a propor a subida — foi assim "
        "que o PR #6 apareceu."
    )
    assert "version-update:semver-major" in ignorados[pacote], (
        f"o teto de '{pacote}' tem de ser só do major: os minor e patch "
        "têm de continuar a chegar, que é por onde vêm as correções de "
        "segurança."
    )


def test_tipos_de_node_acompanham_o_nvmrc() -> None:
    """O major de `@types/node` segue o `.nvmrc`, nem acima nem abaixo.

    É o teto silencioso: tipos de uma versão que não corremos deixam o
    `tsc` aceitar código que rebenta em execução.
    """
    nvmrc = NVMRC.read_text(encoding="utf-8").strip()
    major_runtime = _major(f"{nvmrc}.0.0" if "." not in nvmrc else nvmrc)

    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    intervalo = package["devDependencies"]["@types/node"]
    major_tipos = _major(intervalo)

    assert major_tipos == major_runtime, (
        f"`@types/node` está em {major_tipos}.x e o `.nvmrc` diz "
        f"{major_runtime}. Os tipos descrevem a biblioteca padrão de um "
        "Node que não é o que corre — o `tsc` passa a aceitar código que "
        "falha em execução. Sobem os dois no mesmo PR, ou nenhum (ADR 0007)."
    )
