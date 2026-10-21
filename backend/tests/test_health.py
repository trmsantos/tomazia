"""Testes do endpoint `GET /health`.

Declarado sem o prefixo `/api` (o Passenger acrescenta-o via `SCRIPT_NAME`,
testado em `test_passenger_wsgi.py`). Aqui testa-se só a rota, através do
`TestClient` em cima de `app.main.app`: código 200, corpo com `estado`,
`versao` e `arrancado_em` — nem mais nem menos chaves —, cabeçalho
`Cache-Control: no-store`, e que a versão nunca fica em cache entre
pedidos.

Estes testes assumem que a rota lê a versão chamando `obter_versao()` sem
argumentos a cada pedido (nunca uma só vez, à importação) — é por isso que
dá para substituir `app.versao.CAMINHO_VERSION` (por `monkeypatch.setattr`)
antes de uma `TestClient` arrancar e ver esse valor refletido nas respostas.
Isto está implícito no contrato "sem cache, caminho resolvido na chamada" de
`app/versao.py`; sinalizado aqui para quem implementar a rota.

## `arrancado_em` (F1-04)

Campo acrescentado para o `esperar-versao.sh`: precisa de provar "código
novo a correr", não "um ficheiro mudou" — durante a janela de reinício do
Passenger, um processo velho pode continuar a responder, e só por acaso já
ver o `VERSION` novo (o ficheiro é partilhado por todos os processos; o
`arrancado_em`, não — é calculado uma única vez, à importação do processo).

`app.main.ARRANCADO_EM` já existe (calculado uma única vez, ao nível do
módulo, com `datetime.now(UTC)`) no momento em que este ficheiro foi escrito
— não há aqui nenhum ponto de extensão novo a pedir ao implementador: não
precisámos de injetar o relógio porque o valor é uma constante do módulo,
não recalculada por pedido, e o teste que prova isso
(`test_arrancado_em_nao_muda_entre_pedidos_mesmo_com_o_tempo_a_passar`)
usa um `time.sleep` real, curto, em vez de mexer no relógio.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

#: `%Y-%m-%dT%H:%M:%SZ`: UTC, sem frações de segundo (ver o docstring de
#: `app/schemas/saude.py` e `app/main.py`) — é o formato que `jq`'s
#: `fromdateiso8601` e `strptime` em shell exigem para o `esperar-versao.sh`
#: comparar com outro instante.
_PADRAO_ARRANCADO_EM = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

CHAVES_ESPERADAS = {"estado", "versao", "arrancado_em"}


def _criar_cliente_com_caminho_version(
    monkeypatch: pytest.MonkeyPatch, caminho_version: Path
) -> TestClient:
    from app import versao
    from app.main import app as aplicacao

    monkeypatch.setattr(versao, "CAMINHO_VERSION", caminho_version)
    return TestClient(aplicacao)


def _assert_arrancado_em_valido(valor: object) -> None:
    assert isinstance(valor, str)
    assert _PADRAO_ARRANCADO_EM.match(valor), (
        f"{valor!r} não tem a forma UTC ISO 8601 com 'Z' esperada "
        f"(ex.: '2026-10-21T14:02:11Z')"
    )


def test_sem_ficheiro_version_devolve_200_com_corpo_exato_dev(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cliente = _criar_cliente_com_caminho_version(
        monkeypatch, tmp_path / "VERSION-inexistente"
    )

    with cliente:
        resposta = cliente.get("/health")
        corpo = resposta.json()

    assert resposta.status_code == 200
    assert corpo.keys() == CHAVES_ESPERADAS
    assert corpo["estado"] == "ok"
    assert corpo["versao"] == "dev"
    _assert_arrancado_em_valido(corpo["arrancado_em"])


def test_com_version_devolve_200_com_corpo_exato_do_sha(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    caminho = tmp_path / "VERSION"
    caminho.write_text("9d6df5d\n", encoding="utf-8")
    cliente = _criar_cliente_com_caminho_version(monkeypatch, caminho)

    with cliente:
        resposta = cliente.get("/health")
        corpo = resposta.json()

    assert resposta.status_code == 200
    assert corpo.keys() == CHAVES_ESPERADAS
    assert corpo["estado"] == "ok"
    assert corpo["versao"] == "9d6df5d"
    _assert_arrancado_em_valido(corpo["arrancado_em"])


def test_corpo_tem_exatamente_tres_chaves_nem_mais_nem_menos(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Um endpoint público: não pode passar a divulgar estado interno por descuido.

    Par do teste de forma de `arrancado_em`: aquele confirma que a chave
    existe e tem a forma certa; este confirma que não ganhou companhia
    nenhuma por acidente (um campo de depuração esquecido, um `request.app`
    inteiro serializado, etc.).
    """
    cliente = _criar_cliente_com_caminho_version(
        monkeypatch, tmp_path / "VERSION-inexistente"
    )

    with cliente:
        corpo = cliente.get("/health").json()

    assert set(corpo.keys()) == CHAVES_ESPERADAS


def test_arrancado_em_nao_muda_entre_pedidos_mesmo_com_o_tempo_a_passar(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`arrancado_em` é propriedade do *processo*, não do pedido.

    Ao contrário de `versao` (que `test_sem_cache_entre_pedidos_na_mesma_app`
    prova que muda quando o `VERSION` muda), `arrancado_em` tem de ficar
    igual entre dois pedidos — é isso que permite ao `esperar-versao.sh`
    distinguir "processo novo" de "processo velho que, por coincidência, já
    vê o `VERSION` novo" durante a janela de reinício do Passenger.

    Usa um `time.sleep` real (>1 s) em vez de injetar o relógio: o valor sai
    com precisão ao segundo (sem frações), por isso um `arrancado_em`
    recalculado a cada pedido mudaria de string depois de mais de um
    segundo. Não foi preciso pedir um ponto de extensão ao implementador —
    `app.main.ARRANCADO_EM` já é uma constante do módulo, nunca recalculada
    por pedido.
    """
    cliente = _criar_cliente_com_caminho_version(
        monkeypatch, tmp_path / "VERSION-inexistente"
    )

    with cliente:
        primeira = cliente.get("/health").json()["arrancado_em"]
        time.sleep(1.1)
        segunda = cliente.get("/health").json()["arrancado_em"]

    _assert_arrancado_em_valido(primeira)
    _assert_arrancado_em_valido(segunda)
    assert primeira == segunda


def test_resposta_tem_cache_control_no_store(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cliente = _criar_cliente_com_caminho_version(
        monkeypatch, tmp_path / "VERSION-inexistente"
    )

    with cliente:
        resposta = cliente.get("/health")

    assert resposta.headers["cache-control"] == "no-store"


def test_sem_cache_entre_pedidos_na_mesma_app(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Dois pedidos na mesma app, escrevendo o `VERSION` entre eles, devolvem versões diferentes.

    É isto que o `esperar-versao.sh` da F1-04 precisa: se houvesse cache, um
    processo Passenger que sobrevivesse ao deploy reportaria o SHA antigo
    para sempre, e o script de deploy ficaria à espera de uma versão que a
    app nunca voltaria a reportar.
    """
    caminho = tmp_path / "VERSION"
    cliente = _criar_cliente_com_caminho_version(monkeypatch, caminho)

    with cliente:
        primeira = cliente.get("/health").json()["versao"]
        caminho.write_text("9d6df5d", encoding="utf-8")
        segunda = cliente.get("/health").json()["versao"]

    assert primeira == "dev"
    assert segunda == "9d6df5d"
    assert primeira != segunda
