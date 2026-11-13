"""O corpo de um pedido tem teto, e o teto aplica-se antes da sessão (F2-05a).

Medido na revisão: `PUT /gestao/categorias/ordem` sem sessão, só com
`X-Tomazia: 1`, com 10 MB de JSON, deu 401 ao fim de 2,9 s e 62 MB de pico
de memória — o FastAPI lê e interpreta o corpo **antes** das dependências do
router, e o teto de ids do `PedidoOrdem` só vale depois do parse. Quem não
tem sessão conseguia, portanto, fazer o servidor trabalhar à vontade.

`app.limite_do_corpo.LimiteDoCorpo` é um middleware ASGI que recusa com `413`
(`corpo_demasiado_grande`): pelo `Content-Length`, antes de o corpo chegar, e
contando os bytes à medida que chegam (o `Content-Length` pode mentir, ou
faltar num pedido em troços).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

import pytest

from app.schemas.gestao import PedidoOrdem
from tests.apoio_gestao import CABECALHO_MUTACAO, exigir_erro, fotografia

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

UM_MIB = 1024 * 1024


def _json_de(tamanho: int) -> bytes:
    """Um `PedidoOrdem` sintaticamente válido com pelo menos `tamanho` bytes."""
    ids = ",".join(["1"] * (tamanho // 2))
    return f'{{"ids":[{ids}]}}'.encode()


def _com_sonda(cliente: TestClient, chamadas: list[str]) -> FastAPI:
    """Acrescenta `POST /gestao/sonda`, cujo handler regista que correu."""

    def sonda(corpo: PedidoOrdem) -> None:
        chamadas.append("correu")

    cliente.app.add_api_route("/gestao/sonda", sonda, methods=["POST"])  # type: ignore[attr-defined]
    app: FastAPI = cliente.app  # type: ignore[assignment]
    return app


def _chamar_asgi(
    app: Any,
    cabecalhos: list[tuple[bytes, bytes]],
    pedacos: list[bytes],
    *,
    metodo: str = "POST",
    caminho: str = "/gestao/sonda",
    raiz: str = "",
) -> tuple[int, dict[str, str], bytes]:
    """Um `POST /gestao/sonda` direto à app, com o corpo em `pedacos`."""
    enviados: list[dict[str, Any]] = []
    por_enviar = list(pedacos)

    async def receber() -> dict[str, Any]:
        if por_enviar:
            pedaco = por_enviar.pop(0)
            return {
                "type": "http.request",
                "body": pedaco,
                "more_body": bool(por_enviar),
            }
        return {"type": "http.disconnect"}

    async def enviar(mensagem: dict[str, Any]) -> None:
        enviados.append(mensagem)

    escopo = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": metodo,
        "scheme": "https",
        # Como o a2wsgi monta em produção: `path` = `SCRIPT_NAME` + `PATH_INFO`.
        "path": raiz + caminho,
        "raw_path": (raiz + caminho).encode(),
        "query_string": b"",
        "root_path": raiz,
        "headers": [(b"x-tomazia", b"1"), (b"content-type", b"application/json")]
        + cabecalhos,
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 443),
    }
    asyncio.run(app(escopo, receber, enviar))
    inicio = next(m for m in enviados if m["type"] == "http.response.start")
    corpo = b"".join(
        m.get("body", b"") for m in enviados if m["type"] == "http.response.body"
    )
    cabs = {k.decode().lower(): v.decode() for k, v in inicio["headers"]}
    return int(inicio["status"]), cabs, corpo


def test_corpo_de_1_mib_sem_sessao_e_413_e_nada_corre(
    cliente_sem_sessao_com_ementa: TestClient, motor: Engine
) -> None:
    antes = fotografia(motor)
    resposta = cliente_sem_sessao_com_ementa.put(
        "/gestao/categorias/ordem",
        content=_json_de(UM_MIB),
        headers={**CABECALHO_MUTACAO, "Content-Type": "application/json"},
    )
    corpo = exigir_erro(resposta, 413, "corpo_demasiado_grande")
    assert "campo" not in corpo
    assert resposta.headers.get("cache-control") == "no-store"
    assert fotografia(motor) == antes


def test_content_length_acima_do_teto_recusa_sem_ler_o_corpo(
    cliente: TestClient,
) -> None:
    chamadas: list[str] = []
    app = _com_sonda(cliente, chamadas)
    estado, cabecalhos, _ = _chamar_asgi(
        app, [(b"content-length", str(UM_MIB).encode())], [b'{"ids":[1]}']
    )
    assert estado == 413
    assert cabecalhos.get("cache-control") == "no-store"
    assert chamadas == []


def test_content_length_a_mentir_e_cortado_a_contar_os_bytes(
    cliente: TestClient,
) -> None:
    """Diz 10 bytes, manda 1 MiB em troços de 16 KiB."""
    chamadas: list[str] = []
    app = _com_sonda(cliente, chamadas)
    corpo = _json_de(UM_MIB)
    pedacos = [corpo[i : i + 16384] for i in range(0, len(corpo), 16384)]
    estado, _, texto = _chamar_asgi(app, [(b"content-length", b"10")], pedacos)
    assert estado == 413, texto
    assert b"corpo_demasiado_grande" in texto
    assert chamadas == []


def test_pedido_em_trocos_sem_content_length_e_cortado(cliente: TestClient) -> None:
    chamadas: list[str] = []
    app = _com_sonda(cliente, chamadas)
    corpo = _json_de(UM_MIB)
    pedacos = [corpo[i : i + 16384] for i in range(0, len(corpo), 16384)]
    estado, _, texto = _chamar_asgi(app, [(b"transfer-encoding", b"chunked")], pedacos)
    assert estado == 413, texto
    assert chamadas == []


def test_o_cliente_http_em_trocos_tambem_e_cortado(
    cliente_sem_sessao_com_ementa: TestClient,
) -> None:
    corpo = _json_de(UM_MIB)

    def troços() -> Any:
        for i in range(0, len(corpo), 16384):
            yield corpo[i : i + 16384]

    resposta = cliente_sem_sessao_com_ementa.put(
        "/gestao/categorias/ordem",
        content=troços(),
        headers={**CABECALHO_MUTACAO, "Content-Type": "application/json"},
    )
    exigir_erro(resposta, 413, "corpo_demasiado_grande")


def test_corpo_pequeno_continua_a_funcionar(gestao: TestClient) -> None:
    resposta = gestao.put(
        "/gestao/categorias/ordem",
        json={"ids": [30, 10, 20]},
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 204, resposta.text


def test_corpo_pequeno_na_sonda_corre_o_handler(cliente: TestClient) -> None:
    """Controlo: o 413 acima não vem de a sonda nunca poder correr."""
    chamadas: list[str] = []
    app = _com_sonda(cliente, chamadas)
    estado, _, texto = _chamar_asgi(app, [], [b'{"ids":[1,2]}'])
    assert estado == 200, texto
    assert chamadas == ["correu"]


def test_delete_sem_corpo_nem_content_length_nao_e_recusado(
    gestao: TestClient,
) -> None:
    resposta = gestao.delete("/gestao/categorias/30", headers=CABECALHO_MUTACAO)
    assert resposta.status_code == 204, resposta.text


@pytest.mark.parametrize("tamanho", [100 * 1024])
def test_o_upload_de_fotos_mantem_o_teto_proprio(
    cliente: TestClient, tamanho: int
) -> None:
    """`POST /fotos` tem o seu teto (8 MiB + margem) e fica isento deste."""
    resposta = cliente.post(
        "/fotos",
        content=b"x" * tamanho,
        headers={
            **CABECALHO_MUTACAO,
            "Content-Type": "multipart/form-data; boundary=x",
        },
    )
    assert resposta.json().get("erro") != "corpo_demasiado_grande", resposta.text


# --- Com o prefixo de produção: path="/api/...", root_path="/api" ----------


def test_com_prefixo_o_upload_de_fotos_continua_isento(cliente: TestClient) -> None:
    estado, _, texto = _chamar_asgi(
        cliente.app,
        [
            (b"content-length", str(100 * 1024).encode()),
            (b"content-type", b"multipart/form-data; boundary=x"),
        ],
        [b"x" * (100 * 1024)],
        caminho="/fotos",
        raiz="/api",
    )
    assert b"corpo_demasiado_grande" not in texto, (estado, texto)


def test_com_prefixo_a_gestao_com_100_kb_e_413_com_no_store(
    cliente: TestClient,
) -> None:
    estado, cabecalhos, texto = _chamar_asgi(
        cliente.app,
        [(b"content-length", str(100 * 1000).encode())],
        [b"x" * (100 * 1000)],
        metodo="PUT",
        caminho="/gestao/categorias/ordem",
        raiz="/api",
    )
    assert estado == 413, texto
    assert b"corpo_demasiado_grande" in texto
    assert cabecalhos.get("cache-control") == "no-store"


def test_com_prefixo_o_404_de_gestao_tem_no_store(cliente: TestClient) -> None:
    estado, cabecalhos, texto = _chamar_asgi(
        cliente.app, [], [], metodo="GET", caminho="/gestao/nada", raiz="/api"
    )
    assert estado == 404, texto
    assert cabecalhos.get("cache-control") == "no-store"
