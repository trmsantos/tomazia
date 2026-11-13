"""O envelope de erro `{"erro", "mensagem"}` da especificação.

`docs/ESPECIFICACAO.md`, linha 51: "Erros em JSON:
`{"erro": "codigo", "mensagem": "Texto em PT-PT."}`." Até à F2-04 nenhum
código do `app/` levantava isto: não havia um único `HTTPException` no
projeto, e um corpo malformado saía no `{"detail": [...]}` por omissão do
FastAPI (`RequestValidationError`).

Três coisas, não uma:

- `ErroDaApi`, para o código da aplicação levantar com um código curto e
  uma mensagem em PT-PT — é o que `app/services/auth.py` usa para as
  credenciais inválidas, o bloqueio e a sessão em falta;
- um `exception_handler` para `starlette.exceptions.HTTPException`, **não**
  só `fastapi.HTTPException`. Achado em revisão da F2-04: o FastAPI define
  a sua `HTTPException` como uma subclasse da do Starlette, e é a do
  Starlette que a própria framework levanta para os 404 (rota nenhuma
  corresponde) e os 405 (rota existe, método não) — registar só a
  subclasse do FastAPI deixa esses dois de fora, inalcançáveis, e a
  resposta sai em inglês (`{"detail": "Not Found"}`) em vez do envelope.
  Registar pela classe do Starlette continua a apanhar a subclasse do
  FastAPI (a procura de tratador é por MRO), incluindo um `detail` já na
  forma do envelope que uma dependência como `exigir_admin` queira usar.
  Para os casos genéricos (404, 405, e qualquer outro sem essa forma), o
  texto não é o `detail` em bruto (inglês, vindo do Starlette) — é
  `_MENSAGENS_POR_ESTADO`, a par de `_CODIGOS_POR_ESTADO`;
- um `exception_handler` para `RequestValidationError`, para um corpo ou
  parâmetros inválidos saírem no envelope em vez do `{"detail": [...]}`.

Os três ficam registados de uma vez por `registar_tratadores_de_erro`,
chamada em `app.main.criar_app()`.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException

MENSAGEM_CORPO_INVALIDO = (
    "Os dados enviados não são válidos. Verifica os campos e tenta novamente."
)
MENSAGEM_ERRO_INESPERADO = (
    "Ocorreu um erro inesperado. O problema é nosso; tenta novamente daqui a pouco."
)
#: O fundo dos 4xx. A `MENSAGEM_ERRO_INESPERADO` pede desculpa, e isso
#: serve um 500 mas **mente** num 413 ou num 415: a culpa é do pedido,
#: não nossa. Separar as duas famílias é o que impede um upload grande
#: demais, na F2-06, de sair a dizer que a avaria foi do servidor.
MENSAGEM_PEDIDO_RECUSADO = "O pedido não pôde ser processado."

#: Um código curto por estado HTTP, para o tratador de `HTTPException`
#: nunca inventar um `"erro"` vazio. Não é um mapa exaustivo — só os
#: estados que uma `HTTPException` levantada pelo nosso código, pelo
#: FastAPI ou pelo próprio Starlette (404, 405) podem razoavelmente
#: trazer; qualquer outro cai no genérico `"erro"`.
_CODIGOS_POR_ESTADO: dict[int, str] = {
    status.HTTP_404_NOT_FOUND: "nao_encontrado",
    status.HTTP_405_METHOD_NOT_ALLOWED: "metodo_nao_permitido",
}

#: O texto em PT-PT a par de `_CODIGOS_POR_ESTADO` — nunca o `detail` em
#: bruto de uma `HTTPException` genérica (a do Starlette vem em inglês:
#: "Not Found", "Method Not Allowed"). Regra 6 do `CLAUDE.md`: texto
#: visível em português de Portugal, sempre.
_MENSAGENS_POR_ESTADO: dict[int, str] = {
    status.HTTP_404_NOT_FOUND: "O endereço pedido não existe.",
    status.HTTP_405_METHOD_NOT_ALLOWED: "Este método não é suportado neste endereço.",
}


def _e_do_cliente(estado: int) -> bool:
    """4xx é o pedido que está mal; 5xx somos nós."""
    return status.HTTP_400_BAD_REQUEST <= estado < status.HTTP_500_INTERNAL_SERVER_ERROR


def _codigo_de_estado(estado: int) -> str:
    conhecido = _CODIGOS_POR_ESTADO.get(estado)
    if conhecido is not None:
        return conhecido
    return "pedido_recusado" if _e_do_cliente(estado) else "erro"


def _mensagem_de_estado(estado: int) -> str:
    conhecida = _MENSAGENS_POR_ESTADO.get(estado)
    if conhecida is not None:
        return conhecida
    return (
        MENSAGEM_PEDIDO_RECUSADO if _e_do_cliente(estado) else MENSAGEM_ERRO_INESPERADO
    )


class ErroDaApi(Exception):
    """Um erro HTTP com o envelope `{"erro", "mensagem"}` da especificação.

    `campo`: o campo do corpo a que o erro se refere, quando faz sentido.
    `extra`: campos adicionais a juntar ao corpo da resposta — por
    exemplo, `segundos_em_falta` no `429` do S-07. `cabecalhos`: cabeçalhos
    adicionais a juntar à resposta — por exemplo, `Retry-After` no mesmo
    `429`, ou `Cache-Control: no-store` num `401` de `/auth/eu`.
    """

    def __init__(
        self,
        estado: int,
        codigo: str,
        mensagem: str,
        *,
        campo: str | None = None,
        extra: dict[str, Any] | None = None,
        cabecalhos: dict[str, str] | None = None,
    ) -> None:
        super().__init__(mensagem)
        self.estado = estado
        self.codigo = codigo
        self.mensagem = mensagem
        self.campo = campo
        self.extra = extra or {}
        self.cabecalhos = cabecalhos or {}

    def corpo(self) -> dict[str, Any]:
        corpo: dict[str, Any] = {"erro": self.codigo, "mensagem": self.mensagem}
        if self.campo is not None:
            corpo["campo"] = self.campo
        return {**corpo, **self.extra}


def caminho_sem_prefixo(escopo: Any) -> str:
    """O caminho do pedido sem o `root_path` (`/api` sob o Passenger).

    Em produção o a2wsgi monta `path` = `SCRIPT_NAME` + `PATH_INFO` e
    `root_path` = `SCRIPT_NAME`: os caminhos das rotas não levam o prefixo.
    É a única função que o corta; os middlewares e os tratadores usam-na.
    """
    caminho = str(escopo.get("path", ""))
    raiz = str(escopo.get("root_path", ""))
    if raiz and caminho.startswith(raiz):
        caminho = caminho[len(raiz) :]
    return caminho


def caminho_de_gestao(escopo: Any) -> bool:
    """O pedido é para `/gestao` (sem contar o prefixo `/api` do Passenger)?

    Pelo **caminho do pedido**, não pela rota que casou: assim cobre também
    o 404 de um caminho que não existe debaixo de `/gestao`, o `403` do
    `GuardaXTomazia` e o `413` do `LimiteDoCorpo`, que nunca chegam a casar
    uma rota. É um só mecanismo para todos os erros.
    """
    caminho = caminho_sem_prefixo(escopo)
    return caminho == "/gestao" or caminho.startswith("/gestao/")


def _cabecalhos_da_rota(pedido: Request, cabecalhos: Mapping[str, str] | None) -> Any:
    """Junta `Cache-Control: no-store` quando o pedido é de gestão."""
    if caminho_de_gestao(pedido.scope):
        return {"Cache-Control": "no-store", **(cabecalhos or {})}
    return dict(cabecalhos) if cabecalhos else None


def _tratar_erro_da_api(pedido: Request, excecao: Exception) -> JSONResponse:
    assert isinstance(excecao, ErroDaApi)  # garantido por `add_exception_handler`
    return JSONResponse(
        status_code=excecao.estado,
        content=excecao.corpo(),
        headers=_cabecalhos_da_rota(pedido, excecao.cabecalhos),
    )


#: Os dois estados que, por norma, não podem ter corpo. O
#: `ExceptionMiddleware.http_exception` do Starlette abre com esta mesma
#: verificação; ao registar o nosso tratador pela classe-mãe passámos a
#: substituí-lo, e o guarda desapareceu em silêncio junto com ele. Sem
#: isto, um `HTTPException(304)` sai com corpo JSON num estado que não o
#: pode ter: o `TestClient` engole, o h11 por baixo do uvicorn não.
_ESTADOS_SEM_CORPO = frozenset(
    {status.HTTP_204_NO_CONTENT, status.HTTP_304_NOT_MODIFIED}
)


def _tratar_http_exception(pedido: Request, excecao: Exception) -> Response:
    assert isinstance(excecao, HTTPException)
    if excecao.status_code in _ESTADOS_SEM_CORPO:
        return Response(status_code=excecao.status_code, headers=excecao.headers)
    detalhe = excecao.detail
    if (
        isinstance(detalhe, dict)
        and isinstance(detalhe.get("erro"), str)
        and isinstance(detalhe.get("mensagem"), str)
    ):
        # Uma dependência (por exemplo `app.services.auth.exigir_admin`)
        # que precise de funcionar também numa app sem este tratador
        # (`fastapi.FastAPI()` já trata `HTTPException` por omissão) pode
        # levantá-la com um `detail` já na forma do envelope, em vez do
        # código genérico por estado abaixo.
        corpo: dict[str, Any] = {
            "erro": detalhe["erro"],
            "mensagem": detalhe["mensagem"],
        }
    else:
        # Nunca o `detalhe` em bruto: para uma `HTTPException` genérica —
        # sobretudo a do Starlette, que a própria framework levanta para
        # 404 e 405 — o `detail` vem em inglês ("Not Found", "Method Not
        # Allowed"). O texto visível tem de ser PT-PT sempre (regra 6),
        # por isso a mensagem vem sempre de `_mensagem_de_estado`, nunca
        # do que a exceção trouxe.
        corpo = {
            "erro": _codigo_de_estado(excecao.status_code),
            "mensagem": _mensagem_de_estado(excecao.status_code),
        }
    return JSONResponse(
        status_code=excecao.status_code,
        content=corpo,
        headers=_cabecalhos_da_rota(pedido, excecao.headers),
    )


#: Um nome de campo plausível: letras, algarismos e `_`, até 64.
_PARECE_UM_CAMPO = re.compile(r"[A-Za-z0-9_]{1,64}")


def _campo_do_corpo(excecao: RequestValidationError) -> str | None:
    """O primeiro componente do `loc` de um erro **do corpo**, ou `None`.

    Só o nome do campo: nunca o valor enviado (`input`) nem a mensagem do
    Pydantic, que o pode repetir. Erros do caminho ou da query não
    inventam um campo. Um campo a mais (`extra_forbidden`) tem `loc`
    `("body", "slug")` e sai nomeado; um corpo que nem é um objeto, ou um
    JSON partido, tem `loc` `("body",)` e fica sem campo.
    """
    for erro in excecao.errors():
        loc = erro.get("loc", ())
        if len(loc) >= 2 and loc[0] == "body" and isinstance(loc[1], str):
            campo = loc[1]
            # Num `extra_forbidden` o nome é o que o cliente inventou, sem
            # limite de tamanho e com os caracteres que quisesse. Só volta
            # se parecer um nome de campo; senão, o erro fica sem `campo`.
            if erro.get("type") == "extra_forbidden" and not _PARECE_UM_CAMPO.fullmatch(
                campo
            ):
                return None
            return campo
    return None


def _tratar_erro_de_validacao(pedido: Request, excecao: Exception) -> JSONResponse:
    assert isinstance(excecao, RequestValidationError)
    corpo: dict[str, Any] = {
        "erro": "dados_invalidos",
        "mensagem": MENSAGEM_CORPO_INVALIDO,
    }
    campo = _campo_do_corpo(excecao)
    if campo is not None:
        corpo["campo"] = campo
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content=corpo,
        headers=_cabecalhos_da_rota(pedido, None),
    )


def registar_tratadores_de_erro(aplicacao: FastAPI) -> None:
    """Regista os três `exception_handler` que produzem o envelope de erro.

    `HTTPException` é a classe do `starlette.exceptions`, não a do
    `fastapi` (que a estende): registar pela base apanha as duas, pela
    procura por MRO — incluindo os 404 e 405 que o próprio Starlette
    levanta antes de qualquer rota nossa correr.
    """
    aplicacao.add_exception_handler(ErroDaApi, _tratar_erro_da_api)
    aplicacao.add_exception_handler(HTTPException, _tratar_http_exception)
    aplicacao.add_exception_handler(RequestValidationError, _tratar_erro_de_validacao)
