"""Ponto de entrada WSGI para o Passenger (cPanel).

A ordem das instruções é o contrato de segurança deste ficheiro: só
biblioteca padrão primeiro, `chdir` e `sys.path` ajustados antes de
qualquer coisa que toque no pacote `app`. `app.config.obter_definicoes()`
tem `lru_cache`: se algum carregamento do Passenger importasse `app` (ou
chamasse `obter_definicoes()`, direta ou indiretamente) antes de o
ambiente estar completo — antes do `chdir` para esta pasta e, por essa
via, antes de `TOMAZIA_ENV_FILE`/`RAIZ_APP` resolverem o `.env` certo —, o
valor validado por `Definicoes` ficaria fixado, em cache, para o processo
inteiro. A guarda que rejeita um `SEGREDO_SESSAO` inseguro em produção
nunca mais dispararia: é uma falha aberta, o site serviria produção com o
segredo de desenvolvimento publicado no repositório.
"""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

os.chdir(BASE_DIR)

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Defensiva: se, apesar da ordem acima, algo já tiver importado
# `app.config` e chamado `obter_definicoes()` antes deste ponto (por
# exemplo, um carregamento anterior do Passenger no mesmo processo),
# limpa a cache para que a próxima chamada volte a validar o ambiente
# completo, já com o `chdir`/`sys.path` desta pasta em vigor.
if "app.config" in sys.modules:
    sys.modules["app.config"].obter_definicoes.cache_clear()

from a2wsgi import ASGIMiddleware  # noqa: E402

from app.main import app  # noqa: E402

# Uma instância por processo, nunca por pedido: o `ASGIMiddleware` arranca
# um event loop numa thread própria.
application = ASGIMiddleware(app)  # type: ignore[arg-type]
