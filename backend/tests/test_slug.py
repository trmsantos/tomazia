"""`app/slug.py`: o `normalizar_slug` que o importador e a gestão partilham."""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
SCRIPT = RAIZ_BACKEND / "scripts" / "importar_bd_antiga.py"


@pytest.mark.parametrize(
    "nome,slug",
    [
        ("Bebidas", "bebidas"),
        ("bebidas", "bebidas"),
        ("Cafés & Chás", "cafes-chas"),
        ("Whisky 12 anos", "whisky-12-anos"),
        ("  Licores  ", "licores"),
        ("ÇÃO", "cao"),
        ("!!! ???", ""),
        ("", ""),
    ],
)
def test_normalizar_slug(nome: str, slug: str) -> None:
    from app.slug import normalizar_slug

    assert normalizar_slug(nome) == slug


def test_o_importador_usa_a_mesma_funcao_em_vez_de_a_copiar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.slug import normalizar_slug

    arvore = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    definicoes = [
        no.name
        for no in ast.walk(arvore)
        if isinstance(no, ast.FunctionDef) and no.name == "normalizar_slug"
    ]
    assert definicoes == [], "o importador ainda define a sua própria cópia"

    especificacao = importlib.util.spec_from_file_location("importador_slug", SCRIPT)
    assert especificacao is not None and especificacao.loader is not None
    modulo = importlib.util.module_from_spec(especificacao)
    # Os `dataclass` do script procuram o módulo em `sys.modules`.
    monkeypatch.setitem(sys.modules, especificacao.name, modulo)
    especificacao.loader.exec_module(modulo)
    assert modulo.normalizar_slug is normalizar_slug
