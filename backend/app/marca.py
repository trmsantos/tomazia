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

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

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

MENSAGEM_CABECALHO_EM_FALTA = "Esta operação exige o cabeçalho X-Tomazia com o valor 1."


class GuardaXTomazia(BaseHTTPMiddleware):
    """Responde `403` a qualquer mutação sem `X-Tomazia: 1`, antes do router."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if (
            request.method in METODOS_DE_MUTACAO
            and request.headers.get(NOME_DO_CABECALHO) != VALOR_EXIGIDO
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "erro": "cabecalho_x_tomazia_em_falta",
                    "mensagem": MENSAGEM_CABECALHO_EM_FALTA,
                },
            )
        return await call_next(request)
