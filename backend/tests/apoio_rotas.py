"""Enumeração das rotas que uma app FastAPI declara, com os caminhos finais.

Não é um ficheiro de testes (não começa por `test_`). Existe para o padrão
do critério S-04 — "lista gerada a partir das rotas" — que a F2-03 estreia
com as rotas públicas e a F2-04 vai usar para exigir 401 em todas as de
`/gestao/*`.

## Porque é que isto não é um `for rota in app.routes`

Era, e não chegava. Medido com FastAPI 0.161.1: `include_router()` **não**
copia as rotas para `app.routes`. Deixa lá um `_IncludedRouter`, que não é
uma rota, não tem `.routes`, e guarda o router original e o prefixo num
`include_context` à parte. Um `for rota in app.routes` com
`isinstance(rota, APIRoute)` devolve **lista vazia** numa app que tem
rotas — e um teste de enumeração que confunda "não há rotas" com "não sei
onde elas estão" é o pior dos dois mundos: fica verde a dizer que
verificou tudo.

Daí as duas defesas deste módulo:

- desce recursivamente por tudo o que saiba descer (routers incluídos,
  `Mount`), acumulando o prefixo de cada nível, e **rebenta** diante de um
  objeto de rota que não saiba classificar, em vez de o saltar;
- `exigir_cobertura_do_openapi` confronta o resultado com os caminhos do
  `app.openapi()`, que é a lista que o FastAPI publica. Se a travessia
  deixar de encontrar o que o FastAPI encontra, nota-se.

**O que ainda deixa passar:** uma rota declarada só num `Mount` de uma app
ASGI que não seja FastAPI (não tem `routes` para percorrer), e as rotas que
o `app.openapi()` esconde com `include_in_schema=False` — por isso a
travessia é a fonte e o OpenAPI é só o controlo, nunca o contrário.
"""

from __future__ import annotations

from typing import Any

#: Métodos que não são declarados por nós: o Starlette acrescenta `HEAD` a
#: cada `GET` e responde a `OPTIONS` sozinho.
METODOS_IMPLICITOS = frozenset({"HEAD", "OPTIONS"})


def _metodos(rota: Any) -> frozenset[str]:
    metodos = getattr(rota, "methods", None) or ()
    return frozenset(metodo.upper() for metodo in metodos) - METODOS_IMPLICITOS


def rotas_declaradas(aplicacao: Any) -> dict[str, frozenset[str]]:
    """Caminho final -> métodos, para todas as rotas que a app declara."""
    from fastapi.routing import APIRoute
    from starlette.routing import Mount, Route

    encontradas: dict[str, frozenset[str]] = {}
    desconhecidas: list[str] = []
    por_visitar: list[tuple[str, Any]] = [("", aplicacao.router)]

    while por_visitar:
        prefixo, atual = por_visitar.pop()
        for rota in list(getattr(atual, "routes", [])):
            if isinstance(rota, APIRoute | Route):
                caminho = prefixo + rota.path
                encontradas[caminho] = encontradas.get(caminho, frozenset()) | _metodos(
                    rota
                )
            elif hasattr(rota, "include_context"):
                # `_IncludedRouter` (FastAPI >= 0.161): o prefixo do
                # `include_router()` está aqui, não no caminho das rotas.
                contexto = rota.include_context
                por_visitar.append(
                    (
                        prefixo + getattr(contexto, "prefix", ""),
                        contexto.included_router,
                    )
                )
            elif isinstance(rota, Mount):
                por_visitar.append((prefixo + rota.path, rota))
            elif hasattr(rota, "routes"):
                por_visitar.append((prefixo, rota))
            else:
                desconhecidas.append(f"{type(rota).__module__}.{type(rota).__name__}")

    if desconhecidas:
        raise AssertionError(
            f"a travessia das rotas encontrou objetos que não sabe classificar: "
            f"{sorted(set(desconhecidas))}. Saltá-los daria o mesmo resultado a "
            "'esta app não tem mais rotas' e a 'não sei ler esta versão do "
            "FastAPI' — e é assim que um teste de enumeração fica verde sem "
            "ter enumerado nada. Atualiza `tests/apoio_rotas.py`"
        )

    return encontradas


def caminhos_da_documentacao(aplicacao: Any) -> set[str]:
    """`/openapi.json`, `/docs`, `/redoc` e o redireccionamento do Swagger.

    Lidos da app, não escritos à mão: em produção os três são `None` (o
    teste de `tests/seguranca/test_documentacao_desligada_em_producao.py`
    prende isso) e aqui o conjunto fica vazio sozinho.
    """
    caminhos = {
        aplicacao.openapi_url,
        aplicacao.docs_url,
        aplicacao.redoc_url,
        aplicacao.swagger_ui_oauth2_redirect_url,
    }
    return {caminho for caminho in caminhos if caminho}


def exigir_cobertura_do_openapi(aplicacao: Any) -> None:
    """Rebenta se o `app.openapi()` conhecer caminhos que a travessia não viu.

    O controlo de que a travessia continua a saber ler a versão do FastAPI
    instalada.
    """
    publicados = set(aplicacao.openapi().get("paths", {}))
    percorridos = set(rotas_declaradas(aplicacao))
    em_falta = sorted(publicados - percorridos)

    if em_falta:
        raise AssertionError(
            f"o `app.openapi()` publica {em_falta}, que a travessia de "
            "`rotas_declaradas` não encontrou. A travessia é a fonte da "
            "enumeração: se ela deixa de ver rotas, os testes que dela "
            "dependem ficam verdes sem verificar nada"
        )
