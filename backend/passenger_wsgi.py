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

As três guardas a seguir (ficheiro de ambiente regular e legível; dentro
desta instalação; ambiente lido é mesmo "producao") vivem deliberadamente
aqui, nunca em `app/config.py`, por duas razões que não se misturam.

A primeira é o isolamento dos testes: eles isolam-se do `.env` real
apontando `TOMAZIA_ENV_FILE` para fora de `RAIZ_APP` de propósito (ver
`tests/conftest.py`), e pôr a guarda do ficheiro regular e legível ou a da
contenção dentro da instalação em `obter_definicoes()` partiria esse
isolamento para a suite inteira.

A segunda é a divisão de responsabilidade a sério, para lá dessa
conveniência de teste: o *conteúdo* da configuração valida-se em
`Definicoes` (`app/config.py`), que o aplica em qualquer ponto de
entrada — SSH, `python -m app.openapi`, Alembic, scripts futuros, todos
igualmente sujeitos a `ambiente` ser obrigatório e a um `SEGREDO_SESSAO`
fraco ser recusado em produção. O *continente* — ser um ficheiro regular,
estar dentro desta instalação, e o ambiente lido ser mesmo produção, nunca
outra coisa — verifica-se aqui, porque só este ponto de entrada tem de ser
sempre produção; os outros (testes, scripts correidos à mão em
desenvolvimento) não podem ter essa exigência. É esta divisão, não só o
isolamento dos testes, que decide onde nasce a próxima guarda: se for
sobre o *valor* de um campo, nasce em `Definicoes`; se for sobre o ponto
de entrada em si — que ficheiro se lê, que processo é este —, nasce aqui.
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

from app.config import caminho_ficheiro_de_ambiente, obter_definicoes  # noqa: E402

_ficheiro_de_ambiente = caminho_ficheiro_de_ambiente()

# Esta guarda não ficou redundante quando `ambiente` passou a ser
# obrigatório em `Definicoes` (`app/config.py`), sem valor por omissão —
# hoje um ficheiro de ambiente em falta já não cai em "desenvolvimento" em
# silêncio, rebenta. Continua a disparar primeiro, por três razões:
#
# 1. Diagnóstico: sem ela, o cenário mais provável de todos — o primeiro
#    deploy, antes de o `.env` ser colocado no servidor — daria um
#    `ValidationError` genérico do pydantic a quem está a instalar, bem
#    pior do que a mensagem explícita abaixo.
# 2. O FIFO: um `.env` que seja um FIFO (`os.mkfifo`) não dá uma leitura
#    vazia como um ficheiro em falta dá — pendura o worker do Passenger
#    para sempre, à espera de um leitor ou escritor do outro lado. Medido
#    por acidente ao mutar `is_file()` para `exists()` aqui: a suite de
#    testes passou de 3 para 18 segundos, presa no timeout do subprocesso
#    em vez de rebentar depressa.
# 3. `AMBIENTE` (e `SEGREDO_SESSAO`) podem vir do ambiente do processo, não
#    só do ficheiro: o Setup Python App do cPanel define variáveis assim.
#    Se vierem de lá e o ficheiro de ambiente tiver entretanto
#    desaparecido, `Definicoes` fica satisfeita na mesma — só esta guarda
#    repara que o ficheiro não está lá.
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

# Segunda camada, por baixo de `ambiente` ser obrigatório em `Definicoes`:
# uma variável de ambiente real (`AMBIENTE=desenvolvimento`, definida no
# ambiente do próprio processo, nunca no ficheiro) ganha ao ficheiro de
# ambiente — é o que faz o `pytest` e os comandos de linha funcionarem com
# um `.env` de produção presente mas sem interferir. Mas é exatamente a
# mesma primitiva de escrita que a guarda de contenção acima combate (um
# `SetEnv AMBIENTE desenvolvimento` num `.htaccess` honrado pelo Apache):
# com um ficheiro de ambiente de produção completo e correto, bastaria essa
# variável para o Passenger arrancar em desenvolvimento — reabrindo
# `/docs` e `/openapi.json` e desligando a guarda do segredo fraco — sem
# tocar num único ficheiro desta instalação. Este ponto de entrada só serve
# produção; afirma-se isso explicitamente, depois de `app.main` já ter
# construído a app com a mesma `Definicoes` (em cache) que se lê aqui.
_definicoes = obter_definicoes()
if _definicoes.ambiente != "producao":
    _abortar(
        "Erro de arranque: o ponto de entrada do Passenger "
        "(passenger_wsgi.py) só serve produção, mas o ambiente lido foi "
        f"'{_definicoes.ambiente}'. Confirma que AMBIENTE=producao não "
        "está a ser sobreposto por uma variável de ambiente do processo "
        "(p. ex. no Setup Python App do cPanel)."
    )

# Uma instância por processo, nunca por pedido: o `ASGIMiddleware` arranca
# um event loop numa thread própria.
application = ASGIMiddleware(app)  # type: ignore[arg-type]
