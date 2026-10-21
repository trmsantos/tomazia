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

As duas guardas a seguir (ficheiro de ambiente regular e legível; dentro
desta instalação) vivem deliberadamente aqui, nunca em `app/config.py`: os
testes isolam-se do `.env` real apontando `TOMAZIA_ENV_FILE` para fora de
`RAIZ_APP` de propósito (ver `tests/conftest.py`), e pôr estas guardas em
`obter_definicoes()` partiria esse isolamento para a suite inteira.
"""

import os
import sys
from pathlib import Path
from typing import NoReturn

BASE_DIR = Path(__file__).resolve().parent


def _abortar(mensagem: str) -> NoReturn:
    """Escreve `mensagem` em stderr e aborta o arranque com um `RuntimeError`.

    Um único ponto de falha para o canário e para as duas guardas abaixo:
    antes, um usava `raise RuntimeError(...)` e os outros dois
    `sys.stderr.write(...)` seguido de `raise SystemExit(1)`, sem nenhuma
    razão para a diferença — e o `SystemExit` apaga o traceback no log do
    Passenger, o que torna a causa mais difícil de ver depois. Escreve-se
    a mensagem explicitamente em stderr (para quem só veja essa saída, sem
    traceback) e levanta-se sempre o mesmo tipo de exceção.
    """
    sys.stderr.write(mensagem + "\n")
    raise RuntimeError(mensagem)


os.chdir(BASE_DIR)

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Canário, não guarda: a proteção real é a ORDEM das instruções acima. Se,
# apesar dela, `app.config` ou `app.main` já estiverem em `sys.modules`
# neste ponto, é porque algo os importou antes do `chdir`/`sys.path` — e
# nesse caso `app = criar_app()` já correu com o ambiente incompleto;
# limpar a cache de `obter_definicoes()` não repete a validação nem
# reconstrói a app. Falha em voz alta em vez de mascarar o problema.
if "app.config" in sys.modules or "app.main" in sys.modules:
    _abortar(
        "app.config ou app.main já estava importado antes de "
        "passenger_wsgi.py ajustar a pasta de trabalho e o sys.path — a "
        "validação de produção pode ter corrido com o ambiente incompleto."
    )

from app.config import caminho_ficheiro_de_ambiente  # noqa: E402

_ficheiro_de_ambiente = caminho_ficheiro_de_ambiente()

# Risco: um ficheiro de ambiente em falta é ignorado em silêncio pelo
# pydantic-settings — `ambiente` cairia no valor por omissão
# "desenvolvimento" e a app arrancaria a servir produção com o segredo de
# desenvolvimento publicado no repositório e a documentação toda aberta.
# É o cenário do primeiro deploy, antes de o `.env` ser colocado no
# servidor — por isso recusa-se a arrancar em vez de assumir isso.
if not _ficheiro_de_ambiente.is_file():
    _abortar(
        "Erro de arranque: o ficheiro de ambiente "
        f"'{_ficheiro_de_ambiente}' não existe ou não é um ficheiro "
        "regular legível (pode ser uma diretoria ou um dispositivo como "
        "/dev/null). Confirma que o `.env` já foi colocado no servidor "
        "antes de reiniciar a aplicação."
    )

# Risco: `TOMAZIA_ENV_FILE` é uma variável de ambiente do processo — em
# produção, exatamente a primitiva que um `SetEnv TOMAZIA_ENV_FILE ...`
# num `.htaccess` honrado pelo Apache escreveria. Um caminho fora desta
# instalação nunca pode escolher a configuração de produção a partir de
# fora, mesmo que o ficheiro em si seja válido.
if not _ficheiro_de_ambiente.is_relative_to(BASE_DIR):
    _abortar(
        "Erro de arranque: o ficheiro de ambiente "
        f"'{_ficheiro_de_ambiente}' está fora de '{BASE_DIR}'. "
        "TOMAZIA_ENV_FILE só pode apontar para um ficheiro dentro desta "
        "instalação."
    )

from a2wsgi import ASGIMiddleware  # noqa: E402

from app.main import app  # noqa: E402

# Uma instância por processo, nunca por pedido: o `ASGIMiddleware` arranca
# um event loop numa thread própria.
application = ASGIMiddleware(app)  # type: ignore[arg-type]
