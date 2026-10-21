"""`deploy/esperar-versao.sh` perante um `/api/health` simulado (F1-04, infra).

O mesmo princípio de `tests/seguranca/test_pedir_deploy.py` — um `http.server`
real em `127.0.0.1`, numa porta aleatória, nunca o servidor verdadeiro —
mas aqui com uma **sequência programada** de respostas, porque o script faz
polling: pede, espera, pede outra vez, até a versão certa aparecer ou o
tempo esgotar.

Contrato assumido com o infra (ponto de extensão, a confirmar — descrito
aqui porque o script ainda não existe):

    deploy/esperar-versao.sh <url-base> <sha-esperado> \\
        <timeout-segundos> <intervalo-segundos> <inicio-deploy-iso8601>

- `<url-base>`: ex. `http://127.0.0.1:PORTA` (sem `/api/health` no fim; o
  script acrescenta o caminho).
- `<sha-esperado>`: a versão que `GET /api/health` tem de devolver.
- `<timeout-segundos>` e `<intervalo-segundos>` são **parâmetros, não
  constantes** — é o que `docs/TAREFAS.md`/o arquiteto pediram
  explicitamente, para os testes não demorarem minutos. Se o script não os
  aceitar como argumentos, o infra avisa o Tomás.
- `<inicio-deploy-iso8601>`: instante (UTC, ISO 8601) em que o deploy
  começou. O script só dá sucesso se a versão bater certo **e** o
  `arrancado_em` da resposta for posterior a este instante — é o que prova
  "código novo a correr", não só "um ficheiro VERSION mudou" (ver a secção
  "Mais" da tarefa F1-04).

Classificação que o script tem de fazer a cada leitura (tabela da tarefa):
curl falha por ligação/timeout/reset, ou HTTP 502/503/504, ou 200 com versão
antiga/"dev" → "ainda não" (continua a tentar); 200 com `text/html` ou JSON
inválido, HTTP 4xx exceto 429, erro de TLS, ou JSON sem `versao`/`versao`
vazia/`estado != "ok"` → "falhou já" (sai imediatamente, sem esperar pelo
timeout); 200 com JSON válido, versão esperada e `arrancado_em` posterior
ao início do deploy, **N vezes seguidas** → sucesso.

Assume-se aqui N = 2 leituras consecutivas (decisão arbitrária, documentada
para o infra poder confirmá-la ou ajustá-la): o suficiente para não dar
"verde" numa única leitura porventura inconsistente, sem exigir um número
de parâmetro novo que a tarefa não pediu. Os testes abaixo que dependem de
N nunca fixam o valor exato acima de 2 como uma igualdade frágil — provam
só que uma leitura "antiga" a meio da sequência obriga a reiniciar a
contagem (verdade para qualquer N >= 2), exceto o teste dedicado ao
sucesso simples, que assume N = 2 explicitamente.
"""

from __future__ import annotations

import http.server
import os
import socket
import subprocess
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[2]
CAMINHO_SCRIPT = RAIZ_REPO / "deploy" / "esperar-versao.sh"

SHA_ESPERADO = "sha-novo-esperado-abc1234"
SHA_ANTIGO = "sha-antigo-persistente-sentinela-9f81"


def _agora_iso() -> str:
    return datetime.now(UTC).isoformat()


def _depois(instante_iso: str, segundos: float = 2.0) -> str:
    """Um instante ISO 8601 claramente posterior a `instante_iso`.

    Nunca confiar na ordem relativa de duas chamadas a `_agora_iso()`
    separadas (uma para `arrancado_em`, outra para `inicio_deploy`): o
    relógio avança, mas por microssegundos, e um teste que construísse a
    lista de passos ANTES de capturar `inicio_deploy` ficaria com um
    `arrancado_em` implícito mais cedo do que o início do deploy — o
    oposto do que o cenário de sucesso precisa. Usar sempre esta função,
    com uma margem de segundos (não microssegundos), elimina essa
    fragilidade de vez.
    """
    return (
        datetime.fromisoformat(instante_iso) + timedelta(seconds=segundos)
    ).isoformat()


def _resposta_saude(
    *, estado: str = "ok", versao: str = SHA_ESPERADO, arrancado_em: str | None = None
) -> bytes:
    if arrancado_em is None:
        arrancado_em = _agora_iso()
    campos = []
    if estado is not None:
        campos.append(f'"estado":{_json_str(estado)}')
    if versao is not None:
        campos.append(f'"versao":{_json_str(versao)}')
    if arrancado_em is not None:
        campos.append(f'"arrancado_em":{_json_str(arrancado_em)}')
    return ("{" + ",".join(campos) + "}").encode("utf-8")


def _json_str(valor: str) -> str:
    escapado = valor.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escapado}"'


class _PassoReset:
    """Marcador: para este pedido, fecha a ligação sem escrever resposta nenhuma (simula um reset)."""


RESET = _PassoReset()


class _Passo:
    __slots__ = ("status", "content_type", "corpo")

    def __init__(
        self,
        status: int = 200,
        content_type: str = "application/json",
        corpo: bytes = b"",
    ) -> None:
        self.status = status
        self.content_type = content_type
        self.corpo = corpo


def _passo_saude(**kwargs: object) -> _Passo:
    return _Passo(
        status=200, content_type="application/json", corpo=_resposta_saude(**kwargs)
    )  # type: ignore[arg-type]


def _fabricar_manipulador(
    passos: list[_Passo | _PassoReset], pedidos: list[float]
) -> type[http.server.BaseHTTPRequestHandler]:
    class Manipulador(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _responder(self) -> None:
            # O índice tem de se basear no número de pedidos ANTES deste
            # (0 para o primeiro pedido): calcular depois de um
            # `pedidos.append` já incrementado dava o passo seguinte ao
            # certo, deslocando a sequência inteira num — e nenhum teste
            # exerceria de facto o primeiro passo programado.
            indice = min(len(pedidos), len(passos) - 1)
            pedidos.append(time.monotonic())
            passo = passos[indice]
            if isinstance(passo, _PassoReset):
                # Fecha a ligação crua, sem resposta: o cliente vê uma
                # falha de ligação (reset / "empty reply"), não um HTTP
                # normal.
                self.close_connection = True
                with suppress(OSError):
                    self.connection.shutdown(socket.SHUT_RDWR)
                return
            self.send_response(passo.status)
            self.send_header("Content-Type", passo.content_type)
            self.send_header("Content-Length", str(len(passo.corpo)))
            self.end_headers()
            self.wfile.write(passo.corpo)

        def do_GET(self) -> None:  # noqa: N802
            self._responder()

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

    return Manipulador


@contextmanager
def _servidor(passos: list[_Passo | _PassoReset]) -> Iterator[tuple[str, list[float]]]:
    pedidos: list[float] = []
    httpd = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), _fabricar_manipulador(passos, pedidos)
    )
    fio = threading.Thread(target=httpd.serve_forever, daemon=True)
    fio.start()
    try:
        porta = httpd.server_address[1]
        yield f"http://127.0.0.1:{porta}", pedidos
    finally:
        httpd.shutdown()
        httpd.server_close()
        fio.join(timeout=5)


@contextmanager
def _servidor_atrasado(
    passos: list[_Passo | _PassoReset], atraso_arranque: float
) -> Iterator[tuple[str, list[float]]]:
    """Reserva uma porta, fecha-a, e só sobe o servidor a sério `atraso_arranque` segundos depois.

    Os primeiros pedidos do script encontram, por isso, uma ligação
    recusada — é assim que se simula "curl falha por ligação" sem nunca
    parar um servidor real a meio (o que teria um risco de corrida muito
    maior do que atrasar o arranque).
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    porta = s.getsockname()[1]
    s.close()

    pedidos: list[float] = []
    httpd_contentor: dict[str, http.server.ThreadingHTTPServer] = {}

    def _arrancar_mais_tarde() -> None:
        time.sleep(atraso_arranque)
        httpd = http.server.ThreadingHTTPServer(
            ("127.0.0.1", porta), _fabricar_manipulador(passos, pedidos)
        )
        httpd_contentor["servidor"] = httpd
        httpd.serve_forever()

    fio = threading.Thread(target=_arrancar_mais_tarde, daemon=True)
    fio.start()
    try:
        yield f"http://127.0.0.1:{porta}", pedidos
    finally:
        time.sleep(max(0.0, atraso_arranque - 0.01))
        servidor = httpd_contentor.get("servidor")
        if servidor is not None:
            servidor.shutdown()
            servidor.server_close()
        fio.join(timeout=5)


def _correr(
    base_url: str,
    sha_esperado: str,
    timeout_segundos: float,
    intervalo_segundos: float,
    inicio_deploy_iso: str,
    *,
    tempo_max_teste: float | None = None,
) -> subprocess.CompletedProcess[str]:
    if not CAMINHO_SCRIPT.is_file():
        pytest.fail(
            f"{CAMINHO_SCRIPT} ainda não existe (é o infra que o escreve, na F1-04)."
        )
    if tempo_max_teste is None:
        tempo_max_teste = timeout_segundos + 15.0
    return subprocess.run(
        [
            "bash",
            str(CAMINHO_SCRIPT),
            base_url,
            sha_esperado,
            str(timeout_segundos),
            str(intervalo_segundos),
            inicio_deploy_iso,
        ],
        env=dict(os.environ),
        capture_output=True,
        text=True,
        timeout=tempo_max_teste,
    )


# --- Sucesso --------------------------------------------------------------


def test_sucesso_apos_5xx_e_versao_antiga_com_pelo_menos_uma_espera() -> None:
    """503, 503, 200{antigo}, 200{novo}, ... -> sucesso, com pelo menos uma espera pelo meio."""
    inicio_deploy = _agora_iso()
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=503, content_type="text/plain", corpo=b"Service Unavailable"),
        _Passo(status=503, content_type="text/plain", corpo=b"Service Unavailable"),
        _passo_saude(versao=SHA_ANTIGO),
        _passo_saude(versao=SHA_ESPERADO, arrancado_em=_depois(inicio_deploy)),
    ]
    with _servidor(passos) as (base_url, pedidos):
        inicio = time.monotonic()
        resultado = _correr(base_url, SHA_ESPERADO, 15, 0.3, inicio_deploy)
        duracao = time.monotonic() - inicio

    assert resultado.returncode == 0, resultado.stderr
    assert len(pedidos) >= 4, "O script tem de ter feito pelo menos 4 pedidos."
    assert duracao >= 0.3, (
        "Não houve nenhuma espera visível entre pedidos — parece que o "
        "script não respeita o intervalo configurado."
    )


@pytest.mark.parametrize("codigo", [502, 503, 504])
def test_5xx_e_tratado_como_ainda_nao(codigo: int) -> None:
    inicio_deploy = _agora_iso()
    arrancado_em_novo = _depois(inicio_deploy)
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=codigo, content_type="text/plain", corpo=b"gateway"),
        _passo_saude(arrancado_em=arrancado_em_novo),
        _passo_saude(arrancado_em=arrancado_em_novo),
    ]
    with _servidor(passos) as (base_url, _pedidos):
        resultado = _correr(base_url, SHA_ESPERADO, 15, 0.2, inicio_deploy)
    assert resultado.returncode == 0, resultado.stderr


def test_ligacao_recusada_no_inicio_depois_sucesso() -> None:
    """Servidor "desligado" nos primeiros pedidos (ligação recusada) = ainda não, nunca falha definitiva."""
    inicio_deploy = _agora_iso()
    arrancado_em_novo = _depois(inicio_deploy)
    passos: list[_Passo | _PassoReset] = [
        _passo_saude(arrancado_em=arrancado_em_novo),
        _passo_saude(arrancado_em=arrancado_em_novo),
    ]
    with _servidor_atrasado(passos, atraso_arranque=0.6) as (base_url, pedidos):
        inicio = time.monotonic()
        resultado = _correr(base_url, SHA_ESPERADO, 20, 0.2, inicio_deploy)
        duracao = time.monotonic() - inicio

    assert resultado.returncode == 0, resultado.stderr
    assert duracao >= 0.5, (
        "Sucesso rápido demais para ter esperado pela ligação recusada."
    )


def test_ligacao_resetada_a_meio_depois_sucesso() -> None:
    """Uma ligação resetada (sem resposta nenhuma) é "ainda não", não falha definitiva."""
    inicio_deploy = _agora_iso()
    arrancado_em_novo = _depois(inicio_deploy)
    passos: list[_Passo | _PassoReset] = [
        RESET,
        RESET,
        _passo_saude(arrancado_em=arrancado_em_novo),
        _passo_saude(arrancado_em=arrancado_em_novo),
    ]
    with _servidor(passos) as (base_url, pedidos):
        resultado = _correr(base_url, SHA_ESPERADO, 20, 0.2, inicio_deploy)
    assert resultado.returncode == 0, resultado.stderr
    assert len(pedidos) >= 3


def test_429_e_tratado_como_ainda_nao_nao_como_falha_definitiva() -> None:
    """Exceção explícita da tabela: 429 nunca é "falhou já", mesmo sendo 4xx."""
    inicio_deploy = _agora_iso()
    arrancado_em_novo = _depois(inicio_deploy)
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=429, content_type="text/plain", corpo=b"too many requests"),
        _passo_saude(arrancado_em=arrancado_em_novo),
        _passo_saude(arrancado_em=arrancado_em_novo),
    ]
    with _servidor(passos) as (base_url, _pedidos):
        resultado = _correr(base_url, SHA_ESPERADO, 15, 0.2, inicio_deploy)
    assert resultado.returncode == 0, resultado.stderr


# --- Falha imediata (sem esperar pelo timeout) -----------------------------


def test_404_falha_imediata_sem_esperar_pelo_timeout() -> None:
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=404, content_type="text/plain", corpo=b"not found")
    ]
    with _servidor(passos) as (base_url, pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=25,
            intervalo_segundos=1,
            inicio_deploy_iso=_agora_iso(),
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio

    assert resultado.returncode != 0
    assert duracao < 10.0, (
        f"Demorou {duracao:.1f}s para um 404 — devia ter falhado de imediato, "
        "não esperado pelo timeout de 25s."
    )
    assert len(pedidos) == 1, "Um 404 tem de parar logo no primeiro pedido."


@pytest.mark.parametrize("codigo", [400, 401, 403, 410])
def test_4xx_exceto_429_falha_imediata(codigo: int) -> None:
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=codigo, content_type="text/plain", corpo=b"erro")
    ]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=25,
            intervalo_segundos=1,
            inicio_deploy_iso=_agora_iso(),
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0
    assert duracao < 10.0


def test_html_em_vez_de_json_falha_imediata() -> None:
    passos: list[_Passo | _PassoReset] = [
        _Passo(
            status=200,
            content_type="text/html",
            corpo=b"<html><body>nao e a api</body></html>",
        )
    ]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=25,
            intervalo_segundos=1,
            inicio_deploy_iso=_agora_iso(),
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0
    assert duracao < 10.0


def test_json_invalido_falha_imediata() -> None:
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=200, content_type="application/json", corpo=b"{nao e json")
    ]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=25,
            intervalo_segundos=1,
            inicio_deploy_iso=_agora_iso(),
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0
    assert duracao < 10.0


@pytest.mark.parametrize(
    "corpo",
    [
        b'{"estado":"ok","arrancado_em":"2026-01-01T00:00:00+00:00"}',
        b'{"estado":"ok","versao":"","arrancado_em":"2026-01-01T00:00:00+00:00"}',
        (
            '{"estado":"em_baixo","versao":"'
            + SHA_ESPERADO
            + '","arrancado_em":"2026-01-01T00:00:00+00:00"}'
        ).encode("utf-8"),
    ],
    ids=["sem_versao", "versao_vazia", "estado_nao_ok"],
)
def test_json_sem_versao_util_falha_imediata(corpo: bytes) -> None:
    passos: list[_Passo | _PassoReset] = [
        _Passo(status=200, content_type="application/json", corpo=corpo)
    ]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=25,
            intervalo_segundos=1,
            inicio_deploy_iso=_agora_iso(),
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0
    assert duracao < 10.0


def test_erro_de_tls_falha_imediata() -> None:
    """`https://` contra um servidor que só fala HTTP simples: o handshake TLS falha."""
    passos: list[_Passo | _PassoReset] = [_passo_saude()]
    with _servidor(passos) as (base_url_http, _pedidos):
        base_url_https = base_url_http.replace("http://", "https://")
        inicio = time.monotonic()
        resultado = _correr(
            base_url_https,
            SHA_ESPERADO,
            timeout_segundos=25,
            intervalo_segundos=1,
            inicio_deploy_iso=_agora_iso(),
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0
    assert duracao < 15.0


# --- "Ainda não" até esgotar o tempo (timeout real, mas pequeno) -----------


def test_sempre_sha_antigo_falha_por_timeout_e_imprime_ultima_observacao() -> None:
    passos: list[_Passo | _PassoReset] = [_passo_saude(versao=SHA_ANTIGO)]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=2,
            intervalo_segundos=0.3,
            inicio_deploy_iso=_agora_iso(),
        )
        duracao = time.monotonic() - inicio

    assert resultado.returncode != 0
    assert duracao >= 1.8, (
        "Devia ter esperado perto do timeout configurado (2s), não ter falhado de imediato."
    )
    assert duracao <= 8.0, (
        "Demorou bem mais do que o timeout configurado (2s) — parece que ignora o parâmetro."
    )
    saida = resultado.stdout + resultado.stderr
    assert SHA_ANTIGO in saida, (
        "A última observação (a versão antiga vista) tem de aparecer na saída "
        f"quando falha por timeout. Saída foi: {saida!r}"
    )


def test_versao_dev_nunca_da_sucesso() -> None:
    passos: list[_Passo | _PassoReset] = [_passo_saude(versao="dev")]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=2,
            intervalo_segundos=0.3,
            inicio_deploy_iso=_agora_iso(),
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0
    assert duracao >= 1.8


def test_arrancado_em_anterior_ao_inicio_do_deploy_nao_e_sucesso() -> None:
    """Versão certa, mas o processo que a serve é anterior ao deploy: não prova "código novo a correr"."""
    inicio_deploy = _agora_iso()
    arrancado_em_antigo = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    passos: list[_Passo | _PassoReset] = [
        _passo_saude(versao=SHA_ESPERADO, arrancado_em=arrancado_em_antigo)
    ]
    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=2,
            intervalo_segundos=0.3,
            inicio_deploy_iso=inicio_deploy,
        )
        duracao = time.monotonic() - inicio
    assert resultado.returncode != 0, (
        "Versão certa com arrancado_em ANTERIOR ao início do deploy não pode "
        "ser sucesso — é o mesmo processo antigo, o ficheiro VERSION só mudou "
        "no disco."
    )
    assert duracao >= 1.8, (
        "Isto é 'ainda não' (o processo pode reiniciar a qualquer momento), não falha imediata."
    )


# --- A regra das leituras consecutivas -------------------------------------


def test_leitura_antiga_a_meio_obriga_a_reiniciar_a_contagem() -> None:
    """novo, antigo, novo, novo, ... não pode dar verde na primeira leitura nem logo a seguir ao "antigo"."""
    inicio_deploy = _agora_iso()
    arrancado_em_novo = _depois(inicio_deploy)
    passos: list[_Passo | _PassoReset] = [
        _passo_saude(versao=SHA_ESPERADO, arrancado_em=arrancado_em_novo),
        _passo_saude(versao=SHA_ANTIGO),
        _passo_saude(versao=SHA_ESPERADO, arrancado_em=arrancado_em_novo),
        _passo_saude(versao=SHA_ESPERADO, arrancado_em=arrancado_em_novo),
    ]
    with _servidor(passos) as (base_url, pedidos):
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=15,
            intervalo_segundos=0.2,
            inicio_deploy_iso=inicio_deploy,
        )

    assert resultado.returncode == 0, resultado.stderr
    assert len(pedidos) >= 4, (
        "Sucesso cedo demais: a leitura 'antiga' na posição 2 tem de obrigar "
        "a reiniciar a contagem de leituras consecutivas — com qualquer N "
        ">= 2, não é possível ter sucesso antes do 4º pedido nesta sequência "
        "(novo, antigo, novo, novo)."
    )


def test_sucesso_exige_duas_leituras_consecutivas_nao_uma_so() -> None:
    """Assume N = 2: uma só leitura boa, seguida de falha HTTP, não pode ter dado sucesso antes."""
    inicio_deploy = _agora_iso()
    passos: list[_Passo | _PassoReset] = [
        _passo_saude(versao=SHA_ESPERADO, arrancado_em=_depois(inicio_deploy)),
        _Passo(status=404, content_type="text/plain", corpo=b"not found"),
    ]
    with _servidor(passos) as (base_url, pedidos):
        inicio = time.monotonic()
        resultado = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=15,
            intervalo_segundos=0.2,
            inicio_deploy_iso=inicio_deploy,
            tempo_max_teste=20,
        )
        duracao = time.monotonic() - inicio

    assert resultado.returncode != 0, (
        "Uma leitura boa isolada, seguida de 404, não podia ter dado sucesso "
        "— senão N=1 bastaria, e a regra das leituras consecutivas não "
        "estaria a ser aplicada."
    )
    assert duracao < 10.0, f"Demorou {duracao:.1f}s para um 404 após a leitura boa."
    assert len(pedidos) == 2, f"Esperava exatamente 2 pedidos, houve {len(pedidos)}."


# --- O timeout e o intervalo são parâmetros reais, não constantes ---------


def test_timeout_e_parametro_nao_constante() -> None:
    """Dois timeouts diferentes, para a mesma falha persistente, produzem durações proporcionalmente diferentes."""
    passos: list[_Passo | _PassoReset] = [_passo_saude(versao=SHA_ANTIGO)]

    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado_curto = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=1,
            intervalo_segundos=0.2,
            inicio_deploy_iso=_agora_iso(),
        )
        duracao_curta = time.monotonic() - inicio

    with _servidor(passos) as (base_url, _pedidos):
        inicio = time.monotonic()
        resultado_longo = _correr(
            base_url,
            SHA_ESPERADO,
            timeout_segundos=3,
            intervalo_segundos=0.2,
            inicio_deploy_iso=_agora_iso(),
        )
        duracao_longa = time.monotonic() - inicio

    assert resultado_curto.returncode != 0
    assert resultado_longo.returncode != 0
    assert duracao_longa > duracao_curta + 1.0, (
        f"timeout=1 demorou {duracao_curta:.2f}s, timeout=3 demorou "
        f"{duracao_longa:.2f}s — parecem iguais, como se o parâmetro fosse "
        "ignorado e um valor fixo no script mandasse."
    )


def test_script_existe() -> None:
    assert CAMINHO_SCRIPT.is_file(), (
        f"{CAMINHO_SCRIPT} ainda não existe (é o infra que o escreve, na F1-04)."
    )
