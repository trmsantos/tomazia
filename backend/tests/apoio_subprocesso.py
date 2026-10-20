"""Apoio para testes que correm `backend/passenger_wsgi.py` a sério.

Não é um ficheiro de testes (não começa por `test_`): é usado pelos testes
de `tests/test_passenger_wsgi.py` e `tests/seguranca/test_arranque_passenger.py`.

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

import shutil
import subprocess
import sys
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent

# Nunca herdado do processo de testes: só o suficiente para o Python do
# `.venv` arrancar e encontrar bibliotecas do sistema operativo.
AMBIENTE_MINIMO: dict[str, str] = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"}


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
    timeout: float = 15,
) -> subprocess.CompletedProcess[str]:
    """Corre, num subprocesso, a importação de `passenger_wsgi.py` por caminho.

    Carrega o módulo com `importlib.util.spec_from_file_location`, nunca com
    `python passenger_wsgi.py` (como script) nem com `PYTHONPATH` a apontar
    para `pasta_tomazia_api`: as duas formas acrescentariam essa pasta a
    `sys.path` só por o Python arrancar assim, mascarando uma eventual falta
    do `sys.path.insert(0, ...)` dentro do próprio `passenger_wsgi.py`. Com
    `python -c`, `sys.path[0]` fica `""` — a pasta de trabalho (`cwd`), que
    nunca é `pasta_tomazia_api` nestes testes — por isso só o
    `chdir`/`sys.path.insert` do próprio ficheiro tornam `import app.main`
    possível.

    `codigo_depois_de_importar` corre depois de `application` (o atributo de
    `passenger_wsgi`) estar disponível nesse nome, no subprocesso.
    """
    caminho_passenger_wsgi = pasta_tomazia_api / "passenger_wsgi.py"
    bootstrap = (
        "import importlib.util\n"
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
