"""Apoio partilhado pelos testes de arranque, WSGI e export do OpenAPI.

Não é um ficheiro de testes (não começa por `test_`): é usado pelos testes
de `tests/test_passenger_wsgi.py`, `tests/test_openapi_export.py` e por
vários ficheiros de `tests/seguranca/`. Fica em `tests/` (não em
`tests/seguranca/`) de propósito: um módulo de apoio, sem `test_` no nome,
não conta como "ficheiro de testes fora de `tests/seguranca/`" — é a mesma
distinção que já valia para `copiar_tomazia_api_falso` e
`correr_passenger_wsgi_isolado`, só que agora também para `chamar_wsgi` e
`construir_ambiente_isolado_para_openapi`, que antes viviam duplicados ou
importados de um ficheiro `test_*.py` por um `tests/seguranca/` que não
devia depender dele.

Importar `passenger_wsgi` dentro do processo de testes seria perigoso: o
próprio módulo muda a pasta de trabalho do processo (`os.chdir`) e importa
`app.main` sob o ambiente que estiver definido nesse momento — contaminando
todos os testes que corram a seguir, no mesmo processo. Por isso estas
funções copiam `passenger_wsgi.py` e o pacote `app/` reais para uma pasta
`tomazia_api/` falsa (normalmente dentro de `tmp_path`) e correm um
subprocesso `python` à parte, com um ambiente mínimo construído de propósito
— nunca o ambiente (nem o `.env`) do repositório ou de quem corre os testes.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

RAIZ_BACKEND = Path(__file__).resolve().parent.parent

# Ambiente mínimo para `python -m app.openapi` isolado do `backend/.env`
# real: só o necessário para o Python do `.venv` arrancar e encontrar o
# pacote `app` (via `PYTHONPATH`, nunca via `cwd`).
_AMBIENTE_BASE_OPENAPI: dict[str, str] = {
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONPATH": str(RAIZ_BACKEND),
}


def chamar_wsgi(
    aplicacao_wsgi: Any, script_name: str, path_info: str, metodo: str = "GET"
) -> tuple[str, dict[str, str], bytes]:
    """Chama uma app WSGI (tipicamente `ASGIMiddleware(app)`) diretamente, sem servidor.

    Antes vivia duplicada em `tests/test_passenger_wsgi.py` e
    `tests/seguranca/test_documentacao_desligada_em_producao.py` — a
    duplicação justificava-se com "`tests/seguranca/` não deve depender de
    ficheiros de teste fora de si", mas um módulo de apoio como este,
    partilhado e sem `test_` no nome, não é um desses ficheiros: já era a
    mesma lógica que `copiar_tomazia_api_falso` e
    `correr_passenger_wsgi_isolado` seguiam.
    """
    ambiente = {
        "REQUEST_METHOD": metodo,
        "SCRIPT_NAME": script_name,
        "PATH_INFO": path_info,
        "SERVER_NAME": "testserver",
        "SERVER_PORT": "80",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(b""),
        "wsgi.errors": io.BytesIO(),
        "QUERY_STRING": "",
        "CONTENT_TYPE": "",
        "CONTENT_LENGTH": "",
    }
    capturado: dict[str, object] = {}

    def start_response(
        status: str, headers: list[tuple[str, str]], exc_info: Any = None
    ) -> None:
        capturado["status"] = status
        capturado["headers"] = dict(headers)

    corpo = b"".join(aplicacao_wsgi(ambiente, start_response))
    return capturado["status"], capturado["headers"], corpo  # type: ignore[return-value]


def construir_ambiente_isolado_para_openapi(destino: Path) -> dict[str, str]:
    """Ambiente de subprocesso para `python -m app.openapi`, isolado do `backend/.env` real.

    Extraída de `tests/test_openapi_export.py` (reaproveitada por
    `tests/seguranca/test_isolamento_de_subprocessos.py`) precisamente para
    o isolamento poder ser verificado sem ter de correr o subprocesso: só a
    asserção sobre este dicionário já prende o achado [média] da ronda de
    correções da F1-02 — viver aqui, num módulo de apoio, em vez de um
    `tests/seguranca/` a importar um privado de um `test_*.py`, é o que
    deixa `uv run pytest tests/seguranca` autónomo de novo.

    Define `AMBIENTE=desenvolvimento` explicitamente: desde que `ambiente`
    deixou de ter um valor por omissão em `Definicoes`, um subprocesso sem
    `.env` nenhum (o caso aqui, de propósito) e sem `AMBIENTE` na `env`
    rebentaria com "Field required" em vez de exportar o esquema — e esse
    não é o achado que este ambiente isolado existe para prender.
    """
    ambiente = dict(_AMBIENTE_BASE_OPENAPI)
    ambiente["AMBIENTE"] = "desenvolvimento"
    # Nunca o `.env` do `backend/` real: um caminho inexistente dentro do
    # `tmp_path` do teste que pediu este export (`destino.parent`), para
    # cada teste ficar isolado do ambiente de quem corre a suite.
    ambiente["TOMAZIA_ENV_FILE"] = str(
        destino.parent / "isolamento-de-testes-nao-existe" / ".env"
    )
    return ambiente


# Nunca herdado do processo de testes: só o suficiente para o Python do
# `.venv` arrancar e encontrar bibliotecas do sistema operativo.
AMBIENTE_MINIMO: dict[str, str] = {
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    # Sem isto, `python -c` acrescenta sempre `""` (a pasta de trabalho) a
    # `sys.path[0]`. Isso bastava, sozinho, para tornar `import app.main`
    # possível mesmo que o `sys.path.insert(0, str(BASE_DIR))` do próprio
    # `passenger_wsgi.py` desaparecesse por completo — o `os.chdir(BASE_DIR)`
    # do ficheiro já deixava `cwd` certo para essa entrada `""` funcionar, e a
    # falta do `insert` passava sempre despercebida. Com `PYTHONSAFEPATH=1`,
    # essa entrada nunca é acrescentada: só o `sys.path.insert(...)` do
    # próprio `passenger_wsgi.py` torna o import possível, não importa a
    # pasta de trabalho. Ver o docstring de `correr_passenger_wsgi_isolado`.
    "PYTHONSAFEPATH": "1",
}


def copiar_tomazia_api_falso(destino: Path) -> Path:
    """Copia `passenger_wsgi.py` e o pacote `app/` reais para `destino`.

    Reproduz, em miniatura, a pasta `tomazia_api/` do servidor descrita em
    `docs/ESPECIFICACAO.md`: `passenger_wsgi.py` e `app/` lado a lado.
    Devolve `destino`.
    """
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copy2(RAIZ_BACKEND / "passenger_wsgi.py", destino / "passenger_wsgi.py")
    shutil.copytree(
        RAIZ_BACKEND / "app",
        destino / "app",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    return destino


def codigo_chamar_wsgi(*, script_name: str, path_info: str, variavel_app: str) -> str:
    """Código Python que chama `variavel_app` como WSGI e imprime o resultado.

    Imprime, em `stdout`, uma linha `STATUS=<linha de estado completa>`
    (p. ex. `STATUS=200 OK`) e uma linha `CORPO=<corpo da resposta, utf-8>`.
    Os testes que usam isto correm isto num subprocesso e procuram estas
    linhas em `resultado.stdout`.
    """
    return f"""
import io

_capturado = {{}}


def _start_response(status, headers, exc_info=None):
    _capturado["status"] = status
    _capturado["headers"] = headers


_environ = {{
    "REQUEST_METHOD": "GET",
    "SCRIPT_NAME": {script_name!r},
    "PATH_INFO": {path_info!r},
    "SERVER_NAME": "testserver",
    "SERVER_PORT": "80",
    "SERVER_PROTOCOL": "HTTP/1.1",
    "wsgi.url_scheme": "http",
    "wsgi.input": io.BytesIO(b""),
    "wsgi.errors": io.BytesIO(),
    "QUERY_STRING": "",
    "CONTENT_TYPE": "",
    "CONTENT_LENGTH": "",
}}
_corpo = b"".join({variavel_app}(_environ, _start_response))
print("STATUS=" + _capturado["status"])
print("CORPO=" + _corpo.decode("utf-8"))
"""


def correr_passenger_wsgi_isolado(
    *,
    pasta_tomazia_api: Path,
    cwd: Path,
    ambiente: dict[str, str],
    codigo_depois_de_importar: str,
    codigo_antes_de_importar: str = "",
    timeout: float = 15,
) -> subprocess.CompletedProcess[str]:
    """Corre, num subprocesso, a importação de `passenger_wsgi.py` por caminho.

    Carrega o módulo com `importlib.util.spec_from_file_location`, nunca com
    `python passenger_wsgi.py` (como script) nem com `PYTHONPATH` a apontar
    para `pasta_tomazia_api`: as duas formas acrescentariam essa pasta a
    `sys.path` só por o Python arrancar assim, mascarando uma eventual falta
    do `sys.path.insert(0, ...)` dentro do próprio `passenger_wsgi.py`.

    Com `python -c` e `PYTHONSAFEPATH=1` (ver `AMBIENTE_MINIMO`), `sys.path[0]`
    nunca fica `""` (a pasta de trabalho) — por isso só o
    `sys.path.insert(0, str(BASE_DIR))` do próprio `passenger_wsgi.py` torna
    `import app.main` possível, não importa a pasta de trabalho corrente nem
    o `os.chdir(BASE_DIR)`. Isto é o que faz os dois mecanismos serem
    exercitados a sério, em separado: tirar só o `sys.path.insert` parte a
    importação (com ou sem `os.chdir`); tirar só o `os.chdir` continua a
    importar bem — muda apenas `os.getcwd()` depois de importado, por isso
    quem precisa de apanhar essa remoção tem de afirmá-lo explicitamente (ver
    `tests/seguranca/test_arranque_passenger.py`), nunca confiar em a
    importação ter sucedido ou falhado.

    `codigo_antes_de_importar` corre antes de `importlib` sequer tocar em
    `passenger_wsgi.py` — é o que permite a um teste colocar `sys.modules`
    no estado que o canário de `passenger_wsgi.py` existe para apanhar
    (`app.config`/`app.main` já carregado por um carregamento anterior do
    Passenger no mesmo processo), sem isso contaminar o processo de testes
    em si (tudo corre no subprocesso).

    `codigo_depois_de_importar` corre depois de `application` (o atributo de
    `passenger_wsgi`) estar disponível nesse nome, no subprocesso.
    """
    caminho_passenger_wsgi = pasta_tomazia_api / "passenger_wsgi.py"
    bootstrap = (
        codigo_antes_de_importar + "import importlib.util\n"
        "spec = importlib.util.spec_from_file_location(\n"
        f"    'passenger_wsgi', {str(caminho_passenger_wsgi)!r}\n"
        ")\n"
        "modulo = importlib.util.module_from_spec(spec)\n"
        "assert spec.loader is not None\n"
        "spec.loader.exec_module(modulo)\n"
        "application = modulo.application\n"
    ) + codigo_depois_de_importar
    return subprocess.run(
        [sys.executable, "-c", bootstrap],
        cwd=cwd,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
