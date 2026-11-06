"""E8: um `Content-Type: multipart/form-data` sem `boundary` é recusado, não 500.

Hoje quem salva isto é o próprio Starlette (`MultiPartException` sem
`boundary`, convertida em `HTTPException(400, ...)` dentro de
`Request._get_form`, porque a app corre dentro do FastAPI) — mas isso não
tinha rede nenhuma: nada garantia que a app não acabasse por desembrulhar
essa exceção de outra forma, nem que a resposta saísse no envelope
`{"erro", "mensagem"}` da especificação.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.apoio_auth import CABECALHO_MUTACAO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_sem_boundary_e_recusado_com_o_envelope_da_api(cliente: TestClient) -> None:
    resposta = cliente.post(
        "/fotos",
        content=b"--qualquer-coisa\r\nConteudo\r\n",
        headers={
            **CABECALHO_MUTACAO,
            "Content-Type": "multipart/form-data",
            "Content-Length": "29",
        },
    )

    assert resposta.status_code < 500, (
        f"um multipart sem `boundary` não pode dar um 500: {resposta.text}"
    )
    corpo = resposta.json()
    assert "erro" in corpo and "mensagem" in corpo, corpo
