"""C3: `Content-Length` acima do teto é `413`, antes do multipart ser interpretado.

Medido (achado de revisão da F2-06): `grep` por `413` em `tests/` não
devolvia nada antes deste ficheiro — apagar
`app.routers.fotos._verificar_content_length` não fazia nenhum teste
falhar.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.apoio_auth import CABECALHO_MUTACAO

if TYPE_CHECKING:
    import pytest
    from fastapi.testclient import TestClient


def test_content_length_acima_do_teto_e_413_sem_interpretar_o_multipart(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient
) -> None:
    import starlette.requests

    from app.routers import fotos as roteador

    chamadas: list[None] = []
    original = starlette.requests.Request.form

    def espia(self: starlette.requests.Request, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        chamadas.append(None)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(starlette.requests.Request, "form", espia)

    # Um corpo deste tamanho não precisa de existir de verdade para este
    # teste: o guarda só lê o cabeçalho `Content-Length`, nunca o corpo
    # em si, antes de recusar. Um `content=` mais pequeno do que o
    # cabeçalho diz é suficiente — e mais rápido do que gerar bytes a mais.
    tamanho_a_mais = roteador.LIMITE_CONTENT_LENGTH + 1
    resposta = cliente.post(
        "/fotos",
        content=b"corpo-qualquer",
        headers={
            **CABECALHO_MUTACAO,
            "Content-Type": "multipart/form-data; boundary=x",
            "Content-Length": str(tamanho_a_mais),
        },
    )

    assert resposta.status_code == 413, resposta.text
    assert resposta.json()["erro"] == "ficheiro_grande_demais"
    assert chamadas == [], (
        "o multipart foi interpretado apesar de o `Content-Length` "
        "declarar um corpo acima do teto"
    )


def test_content_length_exatamente_no_teto_nao_e_recusado_por_este_guarda(
    cliente: TestClient,
) -> None:
    """Controlo: o teto é o limite, não um valor arbitrário abaixo dele."""
    from app.routers import fotos as roteador

    resposta = cliente.post(
        "/fotos",
        content=b"corpo-qualquer",
        headers={
            **CABECALHO_MUTACAO,
            "Content-Type": "multipart/form-data; boundary=x",
            "Content-Length": str(roteador.LIMITE_CONTENT_LENGTH),
        },
    )

    # Passa o guarda do `Content-Length` (não é 413); o que vier a seguir
    # (um corpo multipart malformado) não é o que este teste verifica.
    assert resposta.status_code != 413, resposta.text
