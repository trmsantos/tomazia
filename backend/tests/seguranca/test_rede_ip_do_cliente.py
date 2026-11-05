"""`app/rede.py`: de onde vem o IP do cliente (ADR 0017), sem teste nenhum até aqui.

O ADR promete "um teste prende os dois sentidos": dois pedidos do mesmo
par TCP com `X-Forwarded-For` diferentes partilham o mesmo balde (já
coberto por
`tests/seguranca/test_limite_de_envios_por_ip.py::test_x_forwarded_for_forjado_nao_compra_balde_novo`),
e com `PROXIES_DE_CONFIANCA` a apontar para o par TCP, o cabeçalho passa a
valer. Faltava também o caso que o `TestClient` nunca produz sozinho —
`request.client is None` — e por isso precisa de um `Request` montado à
mão.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

IP_DO_CLIENTE = "203.0.113.200"
IP_DO_PROXY = "198.51.100.1"
IP_DE_OUTRO_PROXY = "198.51.100.2"


def _pedido(
    *, cliente_tcp: tuple[str, int] | None, cabecalhos: dict[str, str] | None = None
):
    """Um `starlette.requests.Request` montado à mão, com `client` escolhido.

    `TestClient` põe sempre `client=("testclient", 50000)` — nunca `None`
    — por isso é preciso construir o `scope` ASGI diretamente para chegar
    ao caso "não há par TCP".
    """
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [
            (chave.lower().encode("latin-1"), valor.encode("latin-1"))
            for chave, valor in (cabecalhos or {}).items()
        ],
        "client": cliente_tcp,
        "server": ("testserver", 80),
        "scheme": "http",
        "query_string": b"",
    }
    return Request(scope)


def test_sem_par_tcp_devolve_none_sem_rebentar() -> None:
    from app.rede import ip_do_cliente

    pedido = _pedido(cliente_tcp=None)
    assert ip_do_cliente(pedido) is None


def test_sem_proxies_de_confianca_devolve_o_par_tcp_mesmo_com_x_forwarded_for() -> None:
    """Vazio por omissão: o `X-Forwarded-For` nunca se lê sem configuração."""
    from app.rede import ip_do_cliente

    pedido = _pedido(
        cliente_tcp=(IP_DO_CLIENTE, 54321),
        cabecalhos={"X-Forwarded-For": "1.2.3.4"},
    )
    assert ip_do_cliente(pedido) == IP_DO_CLIENTE


def test_com_proxy_de_confianca_toma_a_entrada_mais_a_direita_que_nao_e_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Uma cadeia de dois proxies: a entrada do cliente é a mais à esquerda."""
    from app.config import obter_definicoes
    from app.rede import ip_do_cliente

    monkeypatch.setenv("PROXIES_DE_CONFIANCA", f"{IP_DO_PROXY},{IP_DE_OUTRO_PROXY}")
    obter_definicoes.cache_clear()
    try:
        # O par TCP é o proxy mais próximo do servidor (`IP_DO_PROXY`). A
        # cadeia tem outro proxy de confiança no meio e o cliente real na
        # ponta esquerda, a única entrada que ele próprio escreve.
        pedido = _pedido(
            cliente_tcp=(IP_DO_PROXY, 443),
            cabecalhos={"X-Forwarded-For": f"{IP_DO_CLIENTE}, {IP_DE_OUTRO_PROXY}"},
        )
        assert ip_do_cliente(pedido) == IP_DO_CLIENTE
    finally:
        obter_definicoes.cache_clear()


def test_com_proxy_de_confianca_mas_sem_cabecalho_devolve_o_par_tcp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import obter_definicoes
    from app.rede import ip_do_cliente

    monkeypatch.setenv("PROXIES_DE_CONFIANCA", IP_DO_PROXY)
    obter_definicoes.cache_clear()
    try:
        pedido = _pedido(cliente_tcp=(IP_DO_PROXY, 443))
        assert ip_do_cliente(pedido) == IP_DO_PROXY
    finally:
        obter_definicoes.cache_clear()


def test_um_proxy_nao_declarado_nao_tem_o_x_forwarded_for_lido() -> None:
    """Controlo: sem `PROXIES_DE_CONFIANCA`, mesmo vindo de um IP "parecido com proxy"."""
    from app.rede import ip_do_cliente

    pedido = _pedido(
        cliente_tcp=(IP_DO_PROXY, 443),
        cabecalhos={"X-Forwarded-For": IP_DO_CLIENTE},
    )
    assert ip_do_cliente(pedido) == IP_DO_PROXY
