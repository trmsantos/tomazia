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


# --------------------------------------------------------------------------
# O fundo do mapa, por família. Achado na segunda volta de revisão da F2-04.
# --------------------------------------------------------------------------


def _resposta_de_estado(estado: int, detalhe: object = None) -> tuple[int, object]:
    """Levanta uma `HTTPException(estado)` dentro da app real e devolve o que sai.

    A rota de sonda entra depois de `criar_app()` para o teste medir o
    tratador registado, e não uma app montada à mão que pudesse ter outra
    configuração.
    """
    from fastapi.testclient import TestClient
    from starlette.exceptions import HTTPException

    from app.main import criar_app

    aplicacao = criar_app()

    @aplicacao.get("/sonda-de-erro")
    def _sonda() -> None:
        raise HTTPException(status_code=estado, detail=detalhe)

    with TestClient(aplicacao) as cliente:
        resposta = cliente.get("/sonda-de-erro")

    corpo = None if not resposta.content else resposta.json()
    return resposta.status_code, corpo


def test_um_4xx_desconhecido_nao_pede_desculpa_como_se_fosse_avaria_nossa() -> None:
    """Um 413 ou 415 é o pedido que está mal, não o servidor.

    **O que este teste deixa passar:** antes da correção, o fundo de
    `_mensagem_de_estado` era a `MENSAGEM_ERRO_INESPERADO` — a frase dos
    500, que diz "O problema é nosso". Um 413 de upload grande demais
    saía a pedir desculpa por uma avaria que não houve, com o código
    genérico `"erro"`, que não serve para o frontend ramificar. Não havia
    caminho vivo que lá chegasse na F2-04; a F2-06 traz uploads e traz os
    413 e 415 com eles.
    """
    estado, corpo = _resposta_de_estado(413)

    assert estado == 413
    assert isinstance(corpo, dict)
    assert corpo["erro"] == "pedido_recusado", (
        f"um 4xx fora do mapa devia trazer um código próprio, veio {corpo!r}"
    )
    assert "O problema é nosso" not in corpo["mensagem"], (
        f"um 4xx está a pedir desculpa com a frase dos 500: {corpo['mensagem']!r}"
    )


def test_um_5xx_continua_a_assumir_a_culpa() -> None:
    """O outro lado da mesma linha: num 5xx a culpa é mesmo nossa."""
    estado, corpo = _resposta_de_estado(503)

    assert estado == 503
    assert isinstance(corpo, dict)
    assert corpo["erro"] == "erro"
    assert "O problema é nosso" in corpo["mensagem"], (
        f"um 5xx devia assumir a culpa, veio {corpo['mensagem']!r}"
    )


def test_os_estados_sem_corpo_continuam_sem_corpo() -> None:
    """O guarda do 204/304 que se perdeu ao registar pela classe-mãe.

    **O que este teste deixa passar:** o
    `ExceptionMiddleware.http_exception` do Starlette abre com esta mesma
    verificação. Ao substituir-lhe o tratador, o guarda desapareceu junto
    com ele, e um `HTTPException(304)` passou a sair com corpo JSON num
    estado que, por norma, não pode ter corpo. O `TestClient` engole;
    o h11, por baixo do uvicorn em produção, não.
    """
    for estado in (204, 304):
        resultado, corpo = _resposta_de_estado(estado)
        assert resultado == estado
        assert corpo is None, (
            f"um {estado} saiu com corpo {corpo!r}; este estado não o pode ter"
        )
