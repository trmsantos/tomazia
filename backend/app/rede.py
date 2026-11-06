"""De onde vem o IP do cliente — `docs/decisoes/0017-de-onde-vem-o-ip-do-cliente.md`.

Em produção a app corre atrás do a2wsgi: `request.client` pode ser `None`
quando o `environ` do WSGI não traz `REMOTE_ADDR` **e** `REMOTE_PORT`. "Não
há IP" é um resultado próprio desta função — `str | None` —, nunca um
`AttributeError` (que seria um 500 numa rota pública) e nunca um valor
inventado.

O `X-Forwarded-For` **nunca** se lê por omissão. Só quando o IP do par TCP
está em `PROXIES_DE_CONFIANCA` (`app/config.py`, vazio por omissão) é que
se lê, e mesmo aí toma-se a entrada **mais à direita que não seja, ela
própria, um proxy de confiança** — as entradas à esquerda são as que o
cliente pode escrever livremente.
"""

from __future__ import annotations

from fastapi import Request

from app.config import obter_definicoes


def _proxies_de_confianca() -> frozenset[str]:
    """A lista de `PROXIES_DE_CONFIANCA`, separada por vírgulas.

    `app/config.py` guarda-a como uma única `str` (vazia por omissão) e
    não como lista: `pydantic-settings` leria uma lista a partir de uma
    variável de ambiente como JSON, e um `.env` não é JSON. A separação
    vive aqui, no único sítio que a lê.
    """
    bruto = obter_definicoes().proxies_de_confianca
    return frozenset(parte.strip() for parte in bruto.split(",") if parte.strip())


def ip_do_cliente(request: Request) -> str | None:
    """O IP do par TCP, ou a entrada de `X-Forwarded-For` que o substitui.

    `None` quando `request.client` é `None` (par TCP desconhecido) — nunca
    se inventa um IP, nunca se levanta `AttributeError`.
    """
    par_tcp = request.client
    if par_tcp is None:
        return None

    ip_do_par = par_tcp.host
    proxies = _proxies_de_confianca()
    if ip_do_par not in proxies:
        # O par TCP não é um proxy declarado: é ele o cliente. Um
        # `X-Forwarded-For` que o próprio pedido traga, forjado ou não,
        # nunca entra em jogo aqui.
        return ip_do_par

    cabecalho = request.headers.get("X-Forwarded-For")
    if not cabecalho:
        return ip_do_par

    entradas = [parte.strip() for parte in cabecalho.split(",") if parte.strip()]
    for entrada in reversed(entradas):
        if entrada not in proxies:
            return entrada
    # Todas as entradas são, elas próprias, proxies de confiança — não há
    # cliente nenhum para além deles. O par TCP (um proxy) é o que sobra.
    return ip_do_par
