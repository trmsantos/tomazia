"""Caminhos absolutos partilhados pela aplicação.

`RAIZ_APP` é a pasta que contém o pacote `app` — `backend/` em
desenvolvimento, `tomazia_api/` em produção (ver `docs/ESPECIFICACAO.md`).
É a única fonte de caminhos absolutos: qualquer módulo que precise de um
caminho relativo à instalação (o `VERSION`, o destino por omissão do
OpenAPI, etc.) deriva-o daqui, nunca da pasta de trabalho do processo.
"""

from __future__ import annotations

from pathlib import Path

RAIZ_APP = Path(__file__).resolve().parent.parent
