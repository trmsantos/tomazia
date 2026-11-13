"""A guarda do cabeçalho `X-Tomazia`, obrigatório em mutações (S-06).

`docs/ESPECIFICACAO.md`: "cabeçalho `X-Tomazia: 1` obrigatório em
mutações". Aplicada como **middleware sobre o método do pedido**, não como
`Depends` por rota: um `Depends` esquecido numa rota nova (da F2-05, por
exemplo) é um buraco silencioso; um middleware corre para todo o pedido,
antes de saber qual rota vai responder, e não tem onde ser esquecido —
`tests/seguranca/test_s06_mutacao_exige_x_tomazia.py` prova isto
acrescentando uma rota sem `Depends` nenhum **depois** de `criar_app()` já
ter devolvido a app, e exigindo `403` na mesma.

A resposta é escrita diretamente (não um `raise ErroDaApi(...)`): este
middleware corre **fora** do `ExceptionMiddleware` do Starlette — o mesmo
que aplica os `exception_handler` registados em `app/erros.py` —, por isso
uma exceção levantada aqui escaparia a esses tratadores e sairia como um
500 genérico do `ServerErrorMiddleware`, não como o `403` pretendido.
"""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.erros import caminho_de_gestao

#: O nome do cabeçalho e o único valor aceite. Um valor presente mas
#: diferente (`"0"`, `"true"`, `"2"`) tem de dar o mesmo resultado que um
#: cabeçalho ausente — não é "o cliente escreveu alguma coisa aqui", é uma
#: intenção explícita.
NOME_DO_CABECALHO = "X-Tomazia"
VALOR_EXIGIDO = "1"

#: POST/PUT/PATCH/DELETE mudam estado; GET, HEAD e OPTIONS nunca precisam
#: do cabeçalho — o Starlette responde a `OPTIONS` sozinho e acrescenta
#: `HEAD` a cada `GET`.
METODOS_DE_MUTACAO = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Texto do ui-ux, revisto em revisão da F2-04: a frase anterior nomeava o
#: cabeçalho e o valor exato esperado. Não é uma vulnerabilidade — a guarda
#: não depende de o nome ser secreto, depende de um browser não conseguir
#: pôr um cabeçalho à sua escolha num pedido de outra origem — mas é
#: divulgação desnecessária, e lia-se como avaria nossa em vez de um
#: pedido recusado de propósito.
MENSAGEM_CABECALHO_EM_FALTA = "Não foi possível processar este pedido a partir daqui."


class GuardaXTomazia:
    """Responde `403` a qualquer mutação sem `X-Tomazia: 1`, antes do router.

    ASGI puro, não `BaseHTTPMiddleware`: este corre o resto da app dentro
    de um grupo de tarefas, e uma exceção levantada ao ler o corpo (o `413`
    do `LimiteDoCorpo`) chegava ao FastAPI embrulhada num `ExceptionGroup`
    e saía como um `400` genérico.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, escopo: Scope, receber: Receive, enviar: Send) -> None:
        if (
            escopo["type"] == "http"
            and escopo["method"] in METODOS_DE_MUTACAO
            and Headers(scope=escopo).get(NOME_DO_CABECALHO) != VALOR_EXIGIDO
        ):
            resposta = JSONResponse(
                status_code=403,
                content={
                    "erro": "cabecalho_x_tomazia_em_falta",
                    "mensagem": MENSAGEM_CABECALHO_EM_FALTA,
                },
                # Fora do `ExceptionMiddleware`, por isso o `no-store` das
                # respostas de `/gestao` tem de vir daqui.
                headers=(
                    {"Cache-Control": "no-store"} if caminho_de_gestao(escopo) else None
                ),
            )
            await resposta(escopo, receber, enviar)
            return
        await self.app(escopo, receber, enviar)
