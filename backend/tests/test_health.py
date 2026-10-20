"""Testes do endpoint `GET /health`.

Declarado sem o prefixo `/api` (o Passenger acrescenta-o via `SCRIPT_NAME`,
testado em `test_passenger_wsgi.py`). Aqui testa-se só a rota, através do
`TestClient` em cima de `app.main.app`: código 200, corpo exatamente
`{"estado": "ok", "versao": "<sha|dev>"}`, cabeçalho `Cache-Control:
no-store`, e que a versão nunca fica em cache entre pedidos.

Estes testes assumem que a rota lê a versão chamando `obter_versao()` sem
argumentos a cada pedido (nunca uma só vez, à importação) — é por isso que
dá para substituir `app.versao.CAMINHO_VERSION` (por `monkeypatch.setattr`)
antes de uma `TestClient` arrancar e ver esse valor refletido nas respostas.
Isto está implícito no contrato "sem cache, caminho resolvido na chamada" de
`app/versao.py`; sinalizado aqui para quem implementar a rota.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _criar_cliente_com_caminho_version(
    monkeypatch: pytest.MonkeyPatch, caminho_version: Path
) -> TestClient:
    from app import versao
    from app.main import app as aplicacao

    monkeypatch.setattr(versao, "CAMINHO_VERSION", caminho_version)
    return TestClient(aplicacao)


def test_sem_ficheiro_version_devolve_200_com_corpo_exato_dev(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cliente = _criar_cliente_com_caminho_version(
        monkeypatch, tmp_path / "VERSION-inexistente"
    )

    with cliente:
        resposta = cliente.get("/health")

    assert resposta.status_code == 200
    assert resposta.json() == {"estado": "ok", "versao": "dev"}


def test_com_version_devolve_200_com_corpo_exato_do_sha(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    caminho = tmp_path / "VERSION"
    caminho.write_text("9d6df5d\n", encoding="utf-8")
    cliente = _criar_cliente_com_caminho_version(monkeypatch, caminho)

    with cliente:
        resposta = cliente.get("/health")

    assert resposta.status_code == 200
    assert resposta.json() == {"estado": "ok", "versao": "9d6df5d"}


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
