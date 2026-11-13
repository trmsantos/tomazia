"""O teto do corpo dos pedidos, aplicado antes de qualquer autenticação.

O FastAPI lê e interpreta o corpo **antes** de resolver as dependências do
router, `exigir_admin` incluída. Medido na revisão da F2-05a: um
`PUT /gestao/categorias/ordem` sem sessão com 10 MB de JSON deu `401` ao
fim de 2,9 s e com 62 MB de pico de memória. Um teto no esquema (o máximo de
ids do `PedidoOrdem`) só vale depois do parse, e não chega.

Este middleware ASGI **puro** (não `BaseHTTPMiddleware`, que lê o corpo por
sua conta) recusa com `413 corpo_demasiado_grande` de duas maneiras:

- pelo `Content-Length`, antes de o corpo chegar sequer à aplicação;
- contando os bytes à medida que a aplicação os lê, porque o
  `Content-Length` pode mentir (declarar pouco e mandar muito) ou faltar
  (`Transfer-Encoding: chunked`). Passado o teto, o `receive` levanta uma
  `HTTPException` que o tratador de `app/erros.py` transforma no envelope.

**O teto é 64 KiB.** O maior corpo legítimo é uma lista de ordem com 300
ids (cerca de 6 KB), ou um produto com `nome` e `descricao` no máximo (até
cerca de 2,5 KB com todos os caracteres escapados em `\\uXXXX`). 64 KiB dá
uma ordem de grandeza de folga, e é pouco para quem quer gastar memória.

**Não há `411` aqui**, ao contrário do upload de fotos: um `DELETE` ou um
`POST` de aprovação não levam corpo nem `Content-Length`, e isso é HTTP
válido (sem `Content-Length` nem `Transfer-Encoding` o corpo é vazio). O que
seria o buraco — um corpo em troços — fica coberto pela contagem.

**O upload de fotos (`POST /fotos`) fica isento:** tem o seu teto, de 8 MiB
mais margem, em `app/routers/fotos.py`. Dar-lhe 64 KiB partia-o.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.erros import caminho_de_gestao, caminho_sem_prefixo

LIMITE_DO_CORPO_BYTES = 64 * 1024

MENSAGEM_CORPO_DEMASIADO_GRANDE = "Os dados enviados são demasiado grandes."

METODOS_COM_CORPO = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Caminhos (sem o prefixo `/api`) que têm o seu próprio teto.
CAMINHOS_ISENTOS = frozenset({"/fotos"})


def _corpo_demasiado_grande() -> dict[str, str]:
    return {
        "erro": "corpo_demasiado_grande",
        "mensagem": MENSAGEM_CORPO_DEMASIADO_GRANDE,
    }


class LimiteDoCorpo:
    def __init__(self, app: ASGIApp, limite: int = LIMITE_DO_CORPO_BYTES) -> None:
        self.app = app
        self.limite = limite

    async def __call__(self, escopo: Scope, receber: Receive, enviar: Send) -> None:
        if (
            escopo["type"] != "http"
            or escopo["method"] not in METODOS_COM_CORPO
            or caminho_sem_prefixo(escopo).rstrip("/") in CAMINHOS_ISENTOS
        ):
            await self.app(escopo, receber, enviar)
            return

        for nome, valor in escopo["headers"]:
            if nome == b"content-length":
                try:
                    declarado = int(valor)
                except ValueError:
                    break  # a contagem abaixo protege na mesma
                if declarado > self.limite:
                    cabecalhos = (
                        {"Cache-Control": "no-store"}
                        if caminho_de_gestao(escopo)
                        else None
                    )
                    resposta = JSONResponse(
                        _corpo_demasiado_grande(), status_code=413, headers=cabecalhos
                    )
                    await resposta(escopo, receber, enviar)
                    return
                break

        recebidos = 0

        async def receber_com_teto() -> Message:
            nonlocal recebidos
            mensagem = await receber()
            if mensagem["type"] == "http.request":
                recebidos += len(mensagem.get("body", b""))
                if recebidos > self.limite:
                    detalhe: Any = _corpo_demasiado_grande()
                    raise HTTPException(status_code=413, detail=detalhe)
            return mensagem

        await self.app(escopo, receber_com_teto, enviar)
