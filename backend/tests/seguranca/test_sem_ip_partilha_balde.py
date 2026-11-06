"""H: `ip_do_cliente()` a devolver `None` cai num balde partilhado — escrito e exercitado.

`app.rede.ip_do_cliente` devolve `None` quando não há par TCP (ADR 0017,
medido: o `a2wsgi` nem sempre preenche `scope["client"]`). `app.routers.
fotos._exigir_limite_de_envios` trata isso como `hash_do_ip("")` — todos os
pedidos sem par TCP partilham, por isso, o mesmo balde de 5 por hora.

Era já o comportamento correto (a escolha conservadora: mais seguro um
balde partilhado do que inventar um IP ou deixar o limite nunca encher),
mas não estava escrito nem exercitado em teste nenhum.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def _cliente_sem_par_tcp() -> TestClient:
    """Um `TestClient` sobre a app real, com `request.client` sempre `None`."""
    from fastapi.testclient import TestClient as TestClientReal

    from app.main import criar_app

    return TestClientReal(criar_app(), base_url="https://testserver", client=None)


def test_dois_clientes_sem_par_tcp_partilham_o_mesmo_balde(sessao: Session) -> None:
    primeiro = _cliente_sem_par_tcp()
    for numero in range(1, 6):
        resposta = apoio_fotos.enviar_foto(primeiro, apoio_fotos.jpeg_valido())
        assert resposta.status_code == 202, (
            f"a tentativa {numero} do primeiro cliente devolveu "
            f"{resposta.status_code}: {resposta.text}"
        )

    # Um cliente diferente, mas também sem par TCP nenhum: tem de herdar o
    # mesmo balde já cheio, porque os dois hasheiam a mesma string vazia.
    segundo = _cliente_sem_par_tcp()
    resposta = apoio_fotos.enviar_foto(segundo, apoio_fotos.jpeg_valido())

    assert resposta.status_code == 429, (
        "dois clientes sem par TCP (`request.client is None`) têm de "
        f"partilhar o mesmo balde: {resposta.text}"
    )
