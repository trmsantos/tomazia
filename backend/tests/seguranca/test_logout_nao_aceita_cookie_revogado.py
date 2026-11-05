"""O replay de um logout antigo não pode matar uma sessão mais recente.

Falha de segurança encontrada em revisão da F2-04 (ver
`docs/decisoes/0016-o-logout-revoga-por-versao-da-sessao.md`):
`app/routers/auth.py` validava o cookie recebido em `POST /auth/logout`
com `ler_sessao` (assinatura e validade) mas `terminar_sessoes` incrementava
`admins.sessao_versao` **sem verificar se o cookie ainda era a versão
atual da conta**. Isso abre um replay: guardar um cookie já revogado por
um primeiro logout e reenviá-lo a `POST /auth/logout` outra vez volta a
incrementar o contador — e mata qualquer sessão mais recente da mesma
conta, incluindo uma legítima aberta depois do primeiro logout:

```
1. login            -> cookie A
2. logout com A     -> 204, versão passa a 1
3. login            -> cookie B (versão 1)
4. /auth/eu com B   -> 200
5. REPLAY do logout com A (já revogado) -> 204
6. /auth/eu com B   -> 401 de novo   <- a sessão legítima morreu
```

Quem guarde uma cópia de um cookie antigo repete o passo 5 a qualquer
momento durante as 12 horas de vida assinada dele e mantém o dono
permanentemente fora da gestão.

Regra 5 do `CLAUDE.md`: cada falha de segurança corrigida ganha um teste
aqui.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    nome_e_valor_do_cookie,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from app.models.admins import Admin


def test_replay_de_logout_antigo_nao_revoga_sessao_mais_recente(
    cliente_seguro: TestClient, admin: Admin
) -> None:
    """A sequência medida em revisão, com um controlo a provar que o primeiro logout revoga mesmo."""
    primeiro_login = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert primeiro_login.status_code == 200, primeiro_login.text
    cookie_a = nome_e_valor_do_cookie(primeiro_login)

    primeiro_logout = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
    assert primeiro_logout.status_code == 204, primeiro_logout.text

    # Controlo: sem isto, um `terminar_sessoes` que não fizesse nada
    # também deixaria o resto deste teste passar, sem provar nada sobre um
    # replay — teria é passado por um logout que nunca revogou coisa
    # nenhuma.
    cliente_seguro.cookies.set(*cookie_a)
    resposta_com_a_apos_o_primeiro_logout = cliente_seguro.get("/auth/eu")
    assert resposta_com_a_apos_o_primeiro_logout.status_code == 401, (
        "o primeiro logout tem de revogar mesmo o cookie A — sem isto, o "
        "resto deste teste não prova nada sobre um replay"
    )

    segundo_login = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert segundo_login.status_code == 200, segundo_login.text
    cookie_b = nome_e_valor_do_cookie(segundo_login)

    # O replay: reenvia o cookie A, já revogado, a um segundo `POST /auth/logout`.
    cliente_seguro.cookies.set(*cookie_a)
    replay_do_logout = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
    assert replay_do_logout.status_code == 204, (
        "o logout continua idempotente: um cookie já revogado não é um "
        "erro, só não faz mais nada"
    )

    # A sessão B, aberta depois do primeiro logout, tem de continuar viva.
    cliente_seguro.cookies.set(*cookie_b)
    resposta_com_b_apos_o_replay = cliente_seguro.get("/auth/eu")
    assert resposta_com_b_apos_o_replay.status_code == 200, (
        "o replay de um logout antigo (cookie A, já revogado) matou a "
        "sessão B, mais recente — é exatamente o bug: `terminar_sessoes` "
        "incrementava `sessao_versao` sem comparar com a versão que o "
        "cookie recebido levava"
    )
