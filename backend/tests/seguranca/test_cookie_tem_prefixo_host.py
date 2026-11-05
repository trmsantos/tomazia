"""O cookie de sessão tem de levar o prefixo `__Host-`, e tem de o continuar a levar.

Falha de segurança encontrada em revisão da F2-04. Sem o prefixo, quem
controle **um subdomínio qualquer** do domínio de produção pode escrever
um cookie com o mesmo nome e um `Domain=` do domínio-pai. O browser passa
a enviar os dois ao site, a ordem entre eles não é garantida, e o do
atacante pode ensombrar o verdadeiro — o dono fica à porta da gestão sem
perceber porquê, e sem que limpar a sessão do lado de cá resolva.

O prefixo `__Host-` fecha isto porque o browser recusa guardar um cookie
assim chamado que não seja `Secure`, não tenha `Path=/`, ou traga um
`Domain=`. Um subdomínio deixa de conseguir escrever por cima.

**O que este teste deixa passar, e porque é que ele existe:** quando a
defesa foi acrescentada, nenhum teste a prendia. Medido em revisão —
renomear a constante de volta para `"sessao_tomazia"` deixava **362
testes verdes**. O apoio dos testes lê o nome do cookie da resposta
(`nome_e_valor_do_cookie` devolve-o em vez de o impor) e o
`_cookie_da_resposta` faz `(morsel,) = ...` sem olhar para ele, por isso
um rename era invisível aos dois lados.

E há o caso simétrico, que é pior porque falha **aberto**: acrescentar um
`domain=` ao `set_cookie` faria **todos** os browsers recusarem um cookie
`__Host-`. O dono deixava de conseguir entrar — com o CI todo verde,
porque o `TestClient` não aplica as regras de prefixo. Por isso este
teste olha para os quatro atributos, e não só para o nome.

Os dois sentidos são verificados no `Set-Cookie` do login **e** no do
logout: um `delete_cookie` que não repita os mesmos atributos não apaga
nada no browser, e um que perca o prefixo não apaga o cookie certo.

Regra 5 do `CLAUDE.md`: cada falha de segurança corrigida ganha um teste
aqui.
"""

from __future__ import annotations

from http.cookies import SimpleCookie
from typing import TYPE_CHECKING

import pytest

from tests.apoio_auth import CABECALHO_MUTACAO, CREDENCIAIS_FALSAS

if TYPE_CHECKING:
    import httpx
    from fastapi.testclient import TestClient

#: O prefixo e os três atributos que o browser exige para o aceitar.
#: Fonte: a especificação dos prefixos de nome de cookie (RFC 6265bis).
PREFIXO = "__Host-"


def _morsel_da_resposta(resposta: httpx.Response) -> tuple[str, SimpleCookie]:
    """O nome e o `Morsel` do único `Set-Cookie` da resposta.

    Lê o cabeçalho em vez do `resposta.cookies` do httpx porque é o
    cabeçalho que o browser vê — e é lá que os atributos vivem.
    """
    cabecalhos = resposta.headers.get_list("set-cookie")
    assert len(cabecalhos) == 1, (
        f"esperava exatamente um `Set-Cookie`, vieram {len(cabecalhos)}: "
        f"{cabecalhos!r}. Com mais do que um, este teste estaria a medir "
        "o cookie errado e passaria por acidente"
    )
    biscoito = SimpleCookie()
    biscoito.load(cabecalhos[0])
    (nome,) = biscoito.keys()
    return nome, biscoito


def _exigir_prefixo_e_atributos(resposta: httpx.Response, onde: str) -> None:
    nome, biscoito = _morsel_da_resposta(resposta)
    morsel = biscoito[nome]

    assert nome.startswith(PREFIXO), (
        f"o cookie do {onde} chama-se {nome!r} e não começa por {PREFIXO!r}. "
        "Sem o prefixo, um subdomínio do domínio de produção pode escrever "
        "um cookie com este nome e `Domain=` do domínio-pai, e ensombrar a "
        "sessão verdadeira"
    )

    # Os três requisitos do prefixo. Qualquer um em falta faz o browser
    # **recusar** o cookie — e aí o dono não entra de todo. O TestClient
    # não aplica estas regras, por isso é aqui que têm de ser apanhadas.
    assert morsel["secure"] is True, f"o cookie do {onde} não é `Secure`"
    assert morsel["path"] == "/", (
        f"o cookie do {onde} tem `Path={morsel['path']!r}`, e o prefixo "
        "`__Host-` exige `Path=/`"
    )
    assert not morsel["domain"], (
        f"o cookie do {onde} traz `Domain={morsel['domain']!r}`. Um cookie "
        "`__Host-` com `Domain` é recusado por **todos** os browsers: o "
        "dono deixaria de conseguir entrar, e o CI não daria por nada"
    )


@pytest.mark.usefixtures("admin")
def test_o_cookie_do_login_tem_o_prefixo_e_os_tres_atributos(
    cliente_seguro: TestClient,
) -> None:
    """O `Set-Cookie` que emite a sessão."""
    resposta = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert resposta.status_code == 200, resposta.text
    _exigir_prefixo_e_atributos(resposta, "login")


def test_o_cookie_do_logout_tem_o_prefixo_e_os_tres_atributos(
    sessao_de_admin: TestClient,
) -> None:
    """O `Set-Cookie` que a apaga.

    Um `delete_cookie` que perca o prefixo ou mude um atributo não apaga
    o cookie do login — o browser trata-os como dois cookies distintos.
    """
    resposta = sessao_de_admin.post("/auth/logout", headers=CABECALHO_MUTACAO)
    assert resposta.status_code == 204, resposta.text
    _exigir_prefixo_e_atributos(resposta, "logout")


@pytest.mark.usefixtures("admin")
def test_o_login_e_o_logout_usam_exatamente_o_mesmo_nome(
    cliente_seguro: TestClient,
) -> None:
    """Dois nomes diferentes deixariam a sessão viva depois de "Sair"."""
    login = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert login.status_code == 200, login.text
    nome_do_login, _ = _morsel_da_resposta(login)

    logout = cliente_seguro.post("/auth/logout", headers=CABECALHO_MUTACAO)
    assert logout.status_code == 204, logout.text
    nome_do_logout, _ = _morsel_da_resposta(logout)

    assert nome_do_logout == nome_do_login, (
        f"o login emite {nome_do_login!r} e o logout apaga "
        f"{nome_do_logout!r}; o browser trataria os dois como cookies "
        "distintos e a sessão sobreviveria ao botão Sair"
    )
