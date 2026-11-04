"""O envelope de erro `{"erro", "mensagem"}` também cobre os 404 e os 405.

Achado em revisão da F2-04: `app/erros.py` registava o tratador só para
`fastapi.HTTPException`, mas é `starlette.exceptions.HTTPException` —
uma classe-mãe, não uma subclasse — que o próprio Starlette levanta
quando nenhuma rota corresponde (404) ou quando a rota existe mas não
aceita o método (405). Medido antes da correção: `GET
/caminho-que-nao-existe` devolvia `{"detail":"Not Found"}` e `GET
/auth/login` devolvia `{"detail":"Method Not Allowed"}` — o `{"detail":
...}` por omissão do Starlette, em inglês, exatamente o que o módulo diz
estar a substituir (regra 6 do `CLAUDE.md`: texto visível em PT-PT).
"""

from __future__ import annotations


def test_404_sai_no_envelope_em_pt_pt() -> None:
    from fastapi.testclient import TestClient

    from app.main import criar_app

    with TestClient(criar_app()) as cliente:
        resposta = cliente.get("/caminho-que-nao-existe")

    assert resposta.status_code == 404
    corpo = resposta.json()
    assert set(corpo) == {"erro", "mensagem"}, (
        f"um 404 do Starlette (rota nenhuma corresponde) ainda não vem no "
        f"envelope: {corpo!r}"
    )
    assert corpo["erro"] == "nao_encontrado"
    assert corpo["mensagem"] == "O endereço pedido não existe."
    assert "Not Found" not in corpo["mensagem"]


def test_405_sai_no_envelope_em_pt_pt() -> None:
    from fastapi.testclient import TestClient

    from app.main import criar_app

    # `/health` só aceita GET (e HEAD); um POST aqui é método não permitido,
    # não falta de X-Tomazia — por isso usa uma rota que não é de mutação
    # nenhuma, para o guarda do S-06 não ser quem responde primeiro.
    with TestClient(criar_app()) as cliente:
        resposta = cliente.post("/health", headers={"X-Tomazia": "1"})

    assert resposta.status_code == 405
    corpo = resposta.json()
    assert set(corpo) == {"erro", "mensagem"}, (
        f"um 405 do Starlette (rota existe, método não) ainda não vem no "
        f"envelope: {corpo!r}"
    )
    assert corpo["erro"] == "metodo_nao_permitido"
    assert corpo["mensagem"] == "Este método não é suportado neste endereço."
    assert "Method Not Allowed" not in corpo["mensagem"]
