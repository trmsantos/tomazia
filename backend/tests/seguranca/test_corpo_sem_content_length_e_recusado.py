"""B1: um corpo sem `Content-Length` não tem teto nenhum — até este guarda.

Medido (achado de revisão da F2-06): o `max_part_size` do Starlette só
limita **campos de texto**. Em
`starlette/formparsers.py::MultiPartParser.on_part_data`, o teste contra
`max_part_size` só corre quando `self._current_part.file is None` — ou
seja, nunca para a parte que é mesmo o ficheiro. Um corpo sem
`Content-Length` (`Transfer-Encoding: chunked`) não tinha, por isso, teto
nenhum a protegê-lo: medido, 64 MiB em troços custam `+194 MB` de RSS
antes de qualquer código nosso medir o corpo.

A correção é recusar: `Content-Length` ausente ou não numérico é `411`,
antes de o FastAPI sequer começar a interpretar o multipart. Este ficheiro
prova os dois lados — a recusa, e que o corpo nunca chega a ser lido.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.apoio_auth import CABECALHO_MUTACAO
from tests.apoio_fotos import jpeg_valido

if TYPE_CHECKING:
    import pytest
    from fastapi.testclient import TestClient

BOUNDARY = "fronteira-de-teste-s-corpo-sem-tamanho"


def _corpo_multipart(conteudo_do_ficheiro: bytes) -> bytes:
    """Um corpo `multipart/form-data` válido, construído à mão (sem `httpx`).

    Construído à mão, e não com `files=` do `httpx`, porque é o próprio
    `httpx` quem calcula o `Content-Length` quando conhece o corpo
    inteiro à partida — este teste precisa exatamente do caso em que não
    o conhece.
    """
    linhas = [
        f"--{BOUNDARY}",
        'Content-Disposition: form-data; name="ficheiro"; filename="foto.jpg"',
        "Content-Type: image/jpeg",
        "",
    ]
    cabecalho = ("\r\n".join(linhas) + "\r\n").encode("ascii")
    rodape = f"\r\n--{BOUNDARY}--\r\n".encode("ascii")
    return cabecalho + conteudo_do_ficheiro + rodape


def _em_troços(corpo: bytes, tamanho_do_troco: int = 4096):
    """Um gerador dos bytes de `corpo`, em pedaços — é isto que faz o `httpx`
    enviar `Transfer-Encoding: chunked` em vez de um `Content-Length`
    (medido: um `content=` que seja um gerador, não `bytes`, não tem
    tamanho conhecido à partida)."""
    for inicio in range(0, len(corpo), tamanho_do_troco):
        yield corpo[inicio : inicio + tamanho_do_troco]


def test_sem_content_length_e_411_e_o_formulario_nunca_e_interpretado(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient
) -> None:
    import starlette.requests

    chamadas: list[None] = []
    original = starlette.requests.Request.form

    def espia(self: starlette.requests.Request, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        chamadas.append(None)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(starlette.requests.Request, "form", espia)

    corpo = _corpo_multipart(jpeg_valido())
    resposta = cliente.post(
        "/fotos",
        content=_em_troços(corpo),
        headers={
            **CABECALHO_MUTACAO,
            "Content-Type": f"multipart/form-data; boundary={BOUNDARY}",
        },
    )

    assert "content-length" not in {
        chave.lower() for chave in resposta.request.headers
    }, "o cenário depende de o pedido não ter `Content-Length`"

    assert resposta.status_code == 411, resposta.text
    corpo_json = resposta.json()
    assert corpo_json["erro"] == "tamanho_do_pedido_em_falta"

    assert chamadas == [], (
        "`Request.form()` foi chamado mesmo sem `Content-Length` — o corpo "
        "chegou a ser interpretado antes da recusa, que é exatamente o que "
        "este guarda existe para impedir"
    )


def test_com_content_length_o_formulario_e_interpretado_normalmente(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient
) -> None:
    """Controlo de sucesso falso: o espião tem de registar uma chamada no caminho feliz."""
    import starlette.requests

    chamadas: list[None] = []
    original = starlette.requests.Request.form

    def espia(self: starlette.requests.Request, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        chamadas.append(None)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(starlette.requests.Request, "form", espia)

    resposta = cliente.post(
        "/fotos",
        files={"ficheiro": ("foto.jpg", jpeg_valido(), "image/jpeg")},
        headers=CABECALHO_MUTACAO,
    )

    assert resposta.status_code == 202, resposta.text
    assert chamadas, (
        "o espião nunca registou nenhuma chamada a `Request.form()` nem no "
        "caminho feliz — a montagem do espião é que estaria errada, não o "
        "comportamento da rota"
    )
