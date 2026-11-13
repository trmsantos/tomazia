"""Enumeração das rotas que uma app FastAPI declara, com os caminhos finais.

Não é um ficheiro de testes (não começa por `test_`). Existe para o padrão
do critério S-04 — "lista gerada a partir das rotas" — que a F2-03 estreia
com as rotas públicas e a F2-04 usa para exigir 401 em todas as de
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

## A segunda armadilha, dentro da primeira (achado da F2-04)

Medido de novo com FastAPI 0.162.0 — a versão instalada nesta tarefa — a
forma não mudou: `rota.include_context` continua a ser um
`fastapi.routing._RouterIncludeContext` com `.prefix` e `.included_router`.
**A armadilha sobreviveu ao upgrade 0.161.1 → 0.162.0**, que é o argumento
mais forte a favor da verificação explícita abaixo continuar a existir: um
upgrade que não a rebente é "ainda não aconteceu", nunca "nunca vai
acontecer".

Até à F2-04, o código lia o prefixo com `getattr(contexto, "prefix", "")`.
Nenhum router incluído até então usava `prefix=` em `include_router()` — só
`/gestao`, que a F2-04 estreia, usa — por isso o `getattr` nunca tinha
sido posto à prova com um prefixo a sério: um router sem `prefix=` dá
`contexto.prefix == ""`, e o `getattr` com omissão `""` acerta por
coincidência, não porque soubesse o que fazer.

Isto é exatamente a troca que a regra 10 do `CLAUDE.md` proíbe: um
`getattr(contexto, "prefix", "")` não distingue "este router não tem
prefixo" (`""`, legítimo) de "esta versão do FastAPI deixou de ter
`.prefix` no contexto de inclusão" (também cai em `""`, por acidente). Se
uma versão futura do FastAPI renomear ou tirar `.prefix`, uma rota
registada com `app.include_router(r, prefix="/gestao")` passaria a
aparecer como `/categorias`, em silêncio — e o S-04 passaria a verificar
zero rotas de gestão, a verde, exatamente o modo de falha que este
ficheiro inteiro existe para impedir. Por isso a travessia agora verifica
`.prefix` e `.included_router` explicitamente e **rebenta em voz alta**
quando um dos dois falta, em vez de assumir um valor que dá a duas coisas
diferentes o mesmo resultado.
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
        # Acesso direto, nunca `getattr(atual, "routes", [])`: um nó sem
        # `.routes` não é "um nó sem rotas", é um nó que a travessia não
        # sabe ler, e os dois não podem dar o mesmo resultado (regra 10).
        if not hasattr(atual, "routes"):
            raise AssertionError(
                f"{type(atual).__module__}.{type(atual).__name__} não tem "
                "`.routes`: a travessia não sabe enumerar as suas rotas, e "
                "saltá-lo daria o mesmo resultado a 'não tem rotas' e a 'não "
                "consegui ver'. Atualiza `tests/apoio_rotas.py`."
            )
        for rota in list(atual.routes):
            if isinstance(rota, APIRoute | Route):
                caminho = prefixo + rota.path
                encontradas[caminho] = encontradas.get(caminho, frozenset()) | _metodos(
                    rota
                )
            elif hasattr(rota, "include_context"):
                # `_IncludedRouter` (FastAPI >= 0.161): o prefixo do
                # `include_router()` está aqui, não no caminho das rotas.
                contexto = rota.include_context
                # Verificação explícita, não `getattr(contexto, "prefix", "")`:
                # um valor por omissão `""` dá o mesmo resultado a "este
                # router não tem prefixo" (legítimo) e a "esta versão do
                # FastAPI deixou de ter `.prefix` aqui" (grave) — é a troca
                # que a regra 10 do `CLAUDE.md` proíbe, e o motivo de ela
                # nunca ter sido posta à prova está na segunda secção do
                # docstring deste ficheiro. `included_router` teria o mesmo
                # problema com um `AttributeError` cru, sem explicação.
                if not hasattr(contexto, "prefix") or not hasattr(
                    contexto, "included_router"
                ):
                    raise AssertionError(
                        "o contexto de inclusão de "
                        f"{type(rota).__module__}.{type(rota).__name__} não "
                        "tem `.prefix` e/ou `.included_router` "
                        f"(tem: {sorted(vars(contexto)) if hasattr(contexto, '__dict__') else dir(contexto)}). "
                        'Saltar isto com um `getattr(..., "")` trataria uma '
                        "mudança na forma do contexto de inclusão como "
                        "'este router não tem prefixo' — exatamente o mesmo "
                        "resultado que um router incluído sem `prefix=`, e é "
                        "assim que uma rota de "
                        '`app.include_router(r, prefix="/gestao")` passaria '
                        "a aparecer sem o `/gestao`, em silêncio, e o S-04 "
                        "passaria a verificar `/categorias` em vez de "
                        "`/gestao/categorias` — zero rotas de gestão "
                        "encontradas, testes todos verdes. Atualiza "
                        "`tests/apoio_rotas.py` para a nova forma do "
                        "contexto de inclusão desta versão do FastAPI."
                    )
                por_visitar.append(
                    (prefixo + contexto.prefix, contexto.included_router)
                )
            elif isinstance(rota, Mount):
                # `Mount.routes` faz `getattr(self.app, "routes", [])` por
                # dentro, e esse silêncio é o mesmo que acima: inspeciona-se
                # a app montada diretamente.
                if not hasattr(rota.app, "routes"):
                    desconhecidas.append(
                        f"Mount({rota.path!r}) com a app ASGI opaca "
                        f"{type(rota.app).__module__}.{type(rota.app).__name__} "
                        "(sem `.routes`)"
                    )
                else:
                    por_visitar.append((prefixo + rota.path, rota.app))
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
