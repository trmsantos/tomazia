"""Leitura da versão da aplicação, a partir do ficheiro `VERSION`.

O `deploy.sh` da F1-04 escreve o SHA completo do commit (40 carateres) em
`VERSION`, ao lado de `passenger_wsgi.py` — nunca o SHA abreviado ("curto"):
o git aumenta o comprimento do SHA abreviado à medida que o repositório
cresce, e se o `deploy.sh` e o `esperar-versao.sh` o calculassem em
momentos diferentes a comparação entre os dois nunca casaria, e o
`esperar-versao.sh` esperaria para sempre. `obter_versao()` lê-o, sem cache
(nunca `lru_cache`), com o caminho resolvido a cada chamada — nunca
capturado antes, à importação — para que o `GET /health` reflita sempre o
ficheiro atual, mesmo que um processo Passenger sobreviva a um deploy que o
reescreva.

Nunca propaga exceção: qualquer erro de leitura, ou um conteúdo fora do
formato aceite, devolve `"dev"`. O caminho do ficheiro nunca entra na
resposta.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.caminhos import RAIZ_APP

CAMINHO_VERSION = RAIZ_APP / "VERSION"

_VERSAO_OMISSAO = "dev"
_TAMANHO_MAXIMO_LIDO = 200
_PADRAO_VERSAO_VALIDA = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def obter_versao(caminho: Path | None = None) -> str:
    """Lê a primeira linha de `VERSION` (ou de `caminho`), saneada.

    Lê no máximo ~200 bytes, considera só a primeira linha, tira espaços
    nas pontas e aceita-a apenas se corresponder a `^[A-Za-z0-9._-]{1,64}$`.
    Qualquer outro caso — ficheiro em falta, pasta em vez de ficheiro,
    sem permissão de leitura, bytes que não são UTF-8 válido, conteúdo
    vazio ou fora do formato aceite — devolve `"dev"`.
    """
    caminho_a_ler = caminho if caminho is not None else CAMINHO_VERSION

    try:
        with caminho_a_ler.open("rb") as ficheiro:
            bruto = ficheiro.read(_TAMANHO_MAXIMO_LIDO)
    except (FileNotFoundError, IsADirectoryError, PermissionError, OSError):
        return _VERSAO_OMISSAO

    try:
        texto = bruto.decode("utf-8")
    except UnicodeDecodeError:
        return _VERSAO_OMISSAO

    linhas = texto.splitlines()
    primeira_linha = linhas[0].strip() if linhas else ""

    if not _PADRAO_VERSAO_VALIDA.match(primeira_linha):
        return _VERSAO_OMISSAO

    return primeira_linha
