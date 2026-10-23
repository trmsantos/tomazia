"""`deploy/pedir-deploy.sh` perante uma UAPI do cPanel simulada (F1-04, infra).

A UAPI do cPanel **responde sempre 200**, mesmo quando o pedido falhou —
documentado em `docs/TAREFAS.md` e em `.claude/agents/infra.md`. Um script
que confiasse no código HTTP para decidir sucesso leria sempre "sucesso".
Por isso `pedir-deploy.sh` tem de ler o campo `status` do corpo JSON, e
estes testes montam um `http.server` real em `127.0.0.1`, numa porta
aleatória, para provar isso — nunca contactam o cPanel verdadeiro (regra 3
do `CLAUDE.md`). A base do URL entra pela variável de ambiente
`TOMAZIA_CPANEL_BASE_URL`, apontada para este servidor local em cada teste.

`deploy/pedir-deploy.sh` já existe, e os testes abaixo confirmam-no a
sério: cada um invoca o script real por subprocesso (nunca o importa)
contra o `http.server` local acima — nunca uma segunda árvore fabricada
que precisasse de alinhar com outro script real. É essa diferença que
torna esta frase inofensiva aqui, ao contrário do que aconteceu em
`tests/seguranca/test_deploy_sh.py` antes da correção: lá, o que ficava
por confirmar não era como invocar o script, era a FORMA DO PACOTE que um
segundo script real (`deploy/montar.sh`) entrega — só correr os dois
scripts a sério, um a seguir ao outro, podia desmentir essa suposição (é
o que prova `tests/seguranca/test_integracao_pacote_deploy.py`). Aqui não
há segundo script: o "servidor" é este próprio `http.server` de teste, por
isso os testes abaixo, a passar contra o script real, já confirmam tudo o
que havia para confirmar.

O contrato que fica provado:

- `TOMAZIA_CPANEL_BASE_URL`: base do URL da UAPI (ex.: `http://127.0.0.1:PORTA`).
- `TOMAZIA_CPANEL_USER`: utilizador do cPanel, para o cabeçalho
  `Authorization: cpanel <utilizador>:<token>` (ou equivalente).
- `TOMAZIA_CPANEL_TOKEN`: o token da API. **Nunca pode aparecer em stdout
  nem em stderr**, seja qual for a forma como o script o transmite (cabeçalho
  ou query string) — é o que `test_token_nunca_aparece_na_saida` prova, em
  todos os cenários abaixo.
- Nenhum argumento de CLI: tudo entra por ambiente, para `deploy.yml` poder
  invocar o script sem construir uma linha de comandos com o token lá
  dentro (que ficaria nos logs do GitHub Actions).
- O script chama algum caminho dentro de `/execute/` (o prefixo real da
  UAPI). Este stub responde a **qualquer** caminho sob `/execute/`, de
  propósito: o módulo/função UAPI exato (`VersionControl::update`,
  `VersionControlDeployment::create`, ou outro) é decisão do infra, e não é
  isso que este ficheiro testa — o que importa aqui é só a leitura do
  `status` na resposta, nunca o endpoint exato.

Se o script não aceitar estas variáveis, ou usar argumentos de CLI para o
token, o infra avisa o Tomás para ajustarmos o contrato.

Nota prática para quem desenvolver a partir daqui: o hook do projeto
(`.claude/hooks/proteger.sh`) bloqueia um comando de Bash que contenha,
literalmente, um `curl`/`wget` com `/execute/` no texto. Os testes abaixo
nunca escrevem esse texto num comando de Bash: invocam sempre
`pedir-deploy.sh`, que é quem fala com `/execute/`, dentro de um
subprocesso do próprio pytest. Corre sempre com `uv run pytest`, nunca com
um `curl .../execute/...` escrito à mão numa shell.
"""

from __future__ import annotations

import http.server
import os
import re
import socket
import subprocess
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
CAMINHO_SCRIPT = RAIZ_REPO / "deploy" / "pedir-deploy.sh"

TOKEN_SENTINELA = "cpanel-token-sentinela-NUNCA-DEVE-APARECER-f7a93c21"
UTILIZADOR_FALSO = "utilizador-exemplo-test"


class _Resposta:
    __slots__ = ("status", "content_type", "corpo", "atraso")

    def __init__(
        self,
        status: int = 200,
        content_type: str | None = "application/json",
        corpo: bytes = b"",
        atraso: float = 0.0,
    ) -> None:
        self.status = status
        self.content_type = content_type
        self.corpo = corpo
        self.atraso = atraso


def _fabricar_manipulador(
    resposta: _Resposta,
) -> type[http.server.BaseHTTPRequestHandler]:
    class Manipulador(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _responder(self) -> None:
            if resposta.atraso:
                import time

                time.sleep(resposta.atraso)
            caminhos = getattr(self.server, "caminhos_pedidos", None)
            if caminhos is not None:
                caminhos.append(self.path)
            self.send_response(resposta.status)
            if resposta.content_type is not None:
                self.send_header("Content-Type", resposta.content_type)
            self.send_header("Content-Length", str(len(resposta.corpo)))
            self.end_headers()
            self.wfile.write(resposta.corpo)

        def do_GET(self) -> None:  # noqa: N802 (nome imposto pela stdlib)
            self._responder()

        def do_POST(self) -> None:  # noqa: N802
            self._responder()

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

    return Manipulador


@contextmanager
def _servidor(resposta: _Resposta) -> Iterator[str]:
    """Sobe um `http.server` real em 127.0.0.1:porta-aleatória, com uma única resposta fixa."""
    httpd = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), _fabricar_manipulador(resposta)
    )
    httpd.caminhos_pedidos = []  # type: ignore[attr-defined]
    fio = threading.Thread(target=httpd.serve_forever, daemon=True)
    fio.start()
    try:
        porta = httpd.server_address[1]
        yield f"http://127.0.0.1:{porta}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        fio.join(timeout=5)


@contextmanager
def _porta_fechada() -> Iterator[str]:
    """Reserva uma porta local e fecha-a de imediato: ninguém está à escuta nela."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    porta = s.getsockname()[1]
    s.close()
    yield f"http://127.0.0.1:{porta}"


def _correr(
    base_url: str,
    *,
    token: str = TOKEN_SENTINELA,
    utilizador: str = UTILIZADOR_FALSO,
    tempo_max: float = 20.0,
) -> subprocess.CompletedProcess[str]:
    # Sem isto, um script em falta (bash devolve 127) faria "passar" por
    # acaso qualquer teste que só verifica `returncode != 0` — exatamente o
    # oposto de falhar pela razão certa enquanto o script não existe.
    if not CAMINHO_SCRIPT.is_file():
        pytest.fail(
            f"{CAMINHO_SCRIPT} ainda não existe (é o infra que o escreve, na F1-04)."
        )
    ambiente = dict(os.environ)
    ambiente["TOMAZIA_CPANEL_BASE_URL"] = base_url
    ambiente["TOMAZIA_CPANEL_TOKEN"] = token
    ambiente["TOMAZIA_CPANEL_USER"] = utilizador
    return subprocess.run(
        ["bash", str(CAMINHO_SCRIPT)],
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=tempo_max,
    )


def _assert_token_nao_vaza(resultado: subprocess.CompletedProcess[str]) -> None:
    assert TOKEN_SENTINELA not in resultado.stdout, (
        "O token apareceu em stdout. Nunca pode, em nenhum cenário."
    )
    assert TOKEN_SENTINELA not in resultado.stderr, (
        "O token apareceu em stderr. Nunca pode, em nenhum cenário."
    )


# --- Casos vindos de docs/TAREFAS.md e do plano do arquiteto ---------------


def test_status_1_sucesso() -> None:
    with _servidor(_Resposta(corpo=b'{"status":1,"data":{}}')) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode == 0
    _assert_token_nao_vaza(resultado)


def test_status_0_com_erros_falha_e_mensagem_em_stderr() -> None:
    mensagem = "repositorio bloqueado por outro deployment"
    corpo = ('{"status":0,"errors":["' + mensagem + '"],"data":null}').encode("utf-8")
    with _servidor(_Resposta(corpo=corpo)) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    assert mensagem in resultado.stderr, (
        "O texto do erro devolvido pela UAPI tem de aparecer em stderr "
        f"(critério explícito de docs/TAREFAS.md). stderr foi: {resultado.stderr!r}"
    )
    _assert_token_nao_vaza(resultado)


def test_status_string_1_sucesso() -> None:
    """O cPanel devolve números como string em vários endpoints; aceitar `1` e `"1"` é decisão deliberada."""
    with _servidor(_Resposta(corpo=b'{"status":"1"}')) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode == 0
    _assert_token_nao_vaza(resultado)


def test_html_de_login_falha() -> None:
    """Token errado: o cPanel devolve a página de login em HTML, com 200."""
    corpo = b"<!DOCTYPE html><html><body>Please log in</body></html>"
    with _servidor(_Resposta(content_type="text/html", corpo=corpo)) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    _assert_token_nao_vaza(resultado)


def test_json_invalido_falha() -> None:
    with _servidor(_Resposta(corpo=b"{isto nao e json valido")) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    _assert_token_nao_vaza(resultado)


@pytest.mark.parametrize(
    "corpo",
    [b'{"data":{}}', b'{"status":null,"data":{}}'],
    ids=["status_ausente", "status_null"],
)
def test_status_ausente_ou_null_falha(corpo: bytes) -> None:
    with _servidor(_Resposta(corpo=corpo)) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    _assert_token_nao_vaza(resultado)


@pytest.mark.parametrize("codigo", [403, 404])
def test_http_403_e_404_falham(codigo: int) -> None:
    with _servidor(
        _Resposta(status=codigo, content_type="text/plain", corpo=b"erro")
    ) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    _assert_token_nao_vaza(resultado)


def test_corpo_vazio_falha() -> None:
    with _servidor(_Resposta(corpo=b"")) as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    _assert_token_nao_vaza(resultado)


def test_servidor_desligado_falha() -> None:
    with _porta_fechada() as base_url:
        resultado = _correr(base_url)
    assert resultado.returncode != 0
    _assert_token_nao_vaza(resultado)


def test_servidor_lento_cortado_pelo_max_time_do_curl() -> None:
    """O --max-time do curl tem de cortar a ligação bem antes do nosso próprio timeout de teste."""
    import time

    inicio = time.monotonic()
    with _servidor(_Resposta(corpo=b'{"status":1}', atraso=30.0)) as base_url:
        resultado = _correr(base_url, tempo_max=25.0)
    duracao = time.monotonic() - inicio

    assert resultado.returncode != 0
    assert duracao < 20.0, (
        f"Demorou {duracao:.1f}s — parece que pedir-deploy.sh não tem "
        "--max-time nenhum no curl (ou tem um max-time maior que isto)."
    )
    _assert_token_nao_vaza(resultado)


# --- Guardas estáticas sobre o próprio script -------------------------------


def test_script_existe() -> None:
    assert CAMINHO_SCRIPT.is_file(), (
        f"{CAMINHO_SCRIPT} ainda não existe (é o infra que o escreve, na F1-04)."
    )


def test_script_nao_usa_opcoes_inseguras_de_tls() -> None:
    texto = (
        CAMINHO_SCRIPT.read_text(encoding="utf-8")
        if CAMINHO_SCRIPT.is_file()
        else pytest.fail(f"{CAMINHO_SCRIPT} ainda não existe.")
    )
    assert "--insecure" not in texto, (
        "pedir-deploy.sh não pode desligar a verificação de TLS (--insecure)."
    )
    # Clusters de opções curtas de um único travessão em que "k" é uma das
    # letras (`-k`, `-sk`, `-skL`, `-key`...): o `curl`/`getopt` trata cada
    # letra como uma opção própria, por isso `-sk` desliga TLS tanto quanto
    # `-k` sozinho. Nunca confundir com opções longas (`--insecure`,
    # `--token-key`), que começam por dois travessões e ficam de fora pelo
    # "(?<![\\w-])" antes do travessão simples.
    correspondencia = re.search(r"(?<![\w-])-[A-Za-z]*k[A-Za-z]*(?![\w-])", texto)
    assert correspondencia is None, (
        "pedir-deploy.sh não pode desligar a verificação de TLS do curl "
        f"(encontrado {correspondencia.group(0) if correspondencia else '?'!r})."
    )
