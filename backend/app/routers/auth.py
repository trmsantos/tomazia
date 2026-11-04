"""As três rotas de sessão: `POST /login`, `POST /logout`, `GET /eu`.

Sem lógica: leem a sessão da base de dados, escrevem ou apagam o cookie, e
entregam o resto a `app/services/auth.py` — o mesmo padrão de
`app/routers/publico.py` com `app/services/publico.py`.

Declaradas sem o prefixo `/api` (é o Passenger que o acrescenta via
`SCRIPT_NAME` em produção); o prefixo `/auth` deste router é que dá os
caminhos finais `/auth/login`, `/auth/logout`, `/auth/eu`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response

from app.dependencias import SessaoDaBD
from app.models.admins import Admin
from app.schemas.auth import PedidoLogin, RespostaAdmin
from app.services import auth as servico

#: Nunca em cache: um `Set-Cookie` ou um `401`/`200` de sessão guardados
#: por um proxy partilhado mostrariam a próxima pessoa como autenticada
#: (ou não) sem ter feito pedido nenhum.
SEM_CACHE = "no-store"

router = APIRouter(prefix="/auth", tags=["auth"])


def _definir_cookie_de_sessao(
    resposta: Response, admin_id: int, sessao_versao: int
) -> None:
    resposta.set_cookie(
        key=servico.NOME_DO_COOKIE,
        value=servico.assinar_sessao(admin_id, sessao_versao),
        max_age=int(servico.VALIDADE_DA_SESSAO.total_seconds()),
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


@router.post("/login", response_model=RespostaAdmin)
def login(resposta: Response, sessao: SessaoDaBD, corpo: PedidoLogin) -> RespostaAdmin:
    """Verifica as credenciais e abre sessão.

    `400 {"erro": "credenciais_invalidas"}` para utilizador inexistente,
    password errada, ou os dois — sempre a mesma resposta (ver
    `app.services.auth.autenticar`). `429 {"erro": "conta_bloqueada", ...}`
    depois de 5 falhas seguidas.
    """
    admin = servico.autenticar(sessao, corpo.utilizador, corpo.password)
    _definir_cookie_de_sessao(resposta, admin.id, admin.sessao_versao)
    resposta.headers["Cache-Control"] = SEM_CACHE
    return RespostaAdmin(id=admin.id, utilizador=admin.utilizador)


@router.post("/logout", status_code=204)
def logout(
    resposta: Response,
    sessao: SessaoDaBD,
    valor_da_sessao: Annotated[str | None, Cookie(alias=servico.NOME_DO_COOKIE)] = None,
) -> None:
    """Fecha a sessão, apagando o cookie. Idempotente: não exige sessão.

    Quando o cookie recebido tem assinatura e validade boas, tenta
    incrementar `admins.sessao_versao` (`servico.terminar_sessoes`) — um
    cookie assinado, sozinho, continuaria a servir até às 12 horas mesmo
    depois de um logout, porque a assinatura e a validade no tempo não
    sabem que houve um pedido de logout entretanto. "Tenta" porque
    `terminar_sessoes` só mexe na linha se a versão que o cookie leva
    ainda for a atual da conta: um cookie já revogado por um logout
    anterior (replay) não volta a incrementar nada. Sem cookie nenhum, ou
    com um cookie inválido por qualquer outra razão (assinatura,
    validade), não há sequer essa tentativa. Nos três casos, 204.

    Isto termina **todas** as sessões daquele admin, não só a deste
    browser; com uma conta só, por agora, não há diferença visível.

    O `delete_cookie` repete exatamente `path` e `samesite` do
    `set_cookie` do login — um atributo diferente faz o browser tratá-los
    como dois cookies distintos e não apaga nada.
    """
    if valor_da_sessao:
        lida = servico.ler_sessao(valor_da_sessao)
        if lida is not None:
            servico.terminar_sessoes(sessao, lida.admin_id, lida.versao)
    resposta.delete_cookie(
        key=servico.NOME_DO_COOKIE,
        path="/",
        httponly=True,
        secure=True,
        samesite="strict",
    )
    resposta.headers["Cache-Control"] = SEM_CACHE


@router.get("/eu", response_model=RespostaAdmin)
def eu(
    resposta: Response, admin: Annotated[Admin, Depends(servico.exigir_admin)]
) -> RespostaAdmin:
    """Quem está autenticado. `401 {"erro": "sessao_em_falta"}` sem sessão válida."""
    resposta.headers["Cache-Control"] = SEM_CACHE
    return RespostaAdmin(id=admin.id, utilizador=admin.utilizador)
