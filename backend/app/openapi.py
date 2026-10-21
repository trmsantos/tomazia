"""Exporta o esquema OpenAPI da app para `frontend/openapi.json`.

Corre-se como `python -m app.openapi [destino]`. Constrói o esquema com
`criar_app().openapi()` — nunca com a app de produção (`app.main.app`),
para o esquema exportado nunca depender do `AMBIENTE` de quem o gera, nem
arriscar rebentar se faltar um `SEGREDO_SESSAO` forte no ambiente de quem
corre o comando.

O destino por omissão é resolvido a partir de `__file__` (via `RAIZ_APP`),
nunca relativo à pasta de trabalho de quem invoca o comando.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.caminhos import RAIZ_APP
from app.main import criar_app

CAMINHO_OPENAPI_OMISSAO = RAIZ_APP.parent / "frontend" / "openapi.json"


def _exportar(destino: Path) -> None:
    esquema = criar_app().openapi()
    conteudo = json.dumps(esquema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(conteudo, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    argumentos = sys.argv[1:] if argv is None else argv
    destino = Path(argumentos[0]) if argumentos else CAMINHO_OPENAPI_OMISSAO

    _exportar(destino)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
