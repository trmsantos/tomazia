"""`criar_app()` monta mesmo `app.routers.gestao.router` em `/gestao`.

Achado em revisão da F2-04: com `gestao.router` a ter zero rotas (é assim
até à F2-05), apagar `aplicacao.include_router(gestao.router,
prefix="/gestao")` de `app/main.py` não faz nenhuma das quatro camadas de
`tests/seguranca/test_s04_gestao_exige_sessao.py` ficar vermelha —

- a Camada 1 só prova que a travessia de rotas continua a funcionar;
- a Camada 2 constrói a sua **própria** app de sonda, nunca a real;
- a Camada 3 compara `_rotas_de_gestao(criar_app())` com um conjunto
  **vazio** — e um `criar_app()` sem o `include_router` nenhum também dá
  um conjunto vazio, pela razão errada;
- a Camada 4 lê `gestao.router.dependencies` diretamente do módulo, sem
  nunca perguntar a `criar_app()` se o incluiu.

Ou seja: o fio que liga o router real à app real pode partir-se em
silêncio, sem nenhum teste da F2-04 notar — até a F2-05 pôr lá a primeira
rota a sério e ela não aparecer em lado nenhum.

Este teste acrescenta uma rota de sonda ao **router real**
(`app.routers.gestao.router`) antes de `criar_app()` correr, e confirma
que ela responde em `/gestao/<sonda>` — não com 404 (que diria que
`/gestao` nunca chegou a ser montado), mas com 401 (a sonda herda
`exigir_admin` das `dependencies` do router, sem sessão nenhuma). A sonda
é removida a seguir, para não vazar para outros testes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI


def test_criar_app_monta_o_router_de_gestao_no_prefixo_gestao() -> None:
    from fastapi.testclient import TestClient

    from app.main import criar_app
    from app.routers import gestao

    numero_de_rotas_antes = len(gestao.router.routes)

    @gestao.router.get("/__sonda_de_montagem__")
    def sonda() -> dict[str, bool]:  # pragma: no cover - nunca chega a correr
        return {"ok": True}

    try:
        aplicacao: FastAPI = criar_app()
        with TestClient(aplicacao) as cliente:
            resposta = cliente.get("/gestao/__sonda_de_montagem__")
    finally:
        # Limpa a rota de sonda do router partilhado, para não ficar lá
        # para os outros testes do processo.
        del gestao.router.routes[numero_de_rotas_antes:]

    assert resposta.status_code == 401, (
        f"esperava 401 (a sonda está protegida por `exigir_admin`, sem "
        f"sessão nenhuma), veio {resposta.status_code}. Um 404 aqui "
        "diria que `/gestao` não está montado em `criar_app()` — "
        "exatamente o fio-de-disparo que este teste existe para prender"
    )
