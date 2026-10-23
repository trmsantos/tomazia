"""Fábrica da aplicação FastAPI.

As rotas definem-se sempre sem o prefixo `/api`; em produção o Passenger
passa-o em `SCRIPT_NAME`.

Em produção o a2wsgi (`passenger_wsgi.py`) monta esta app com
`ASGIMiddleware`, que **não corre o protocolo `lifespan`**: nada posto num
`lifespan` desta app chega a executar sob o Passenger. É por isso que a
validação da configuração (a chamada a `obter_definicoes()` abaixo) corre
diretamente em `criar_app()`, nunca num `lifespan`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import FastAPI

from app.config import obter_definicoes
from app.routers import saude

#: Instante, em UTC, em que este *processo* importou `app.main` — não em
#: que um pedido chegou, nem em que `criar_app()` correu. É calculado uma
#: única vez, à importação do módulo, precisamente para ser uma
#: propriedade do processo: o `esperar-versao.sh` da F1-04 só pode provar
#: que o Passenger já arrancou código novo (e não um processo velho a
#: responder com um `VERSION` novo) se este valor não mudar entre pedidos
#: nem entre chamadas a `criar_app()` no mesmo processo — e se fosse
#: recalculado em qualquer um dos dois, deixaria de o ser.
#:
#: É `str`, não `datetime`: queremos controlar o formato exato que sai pela
#: rede, sem depender de como o Pydantic serializa um `datetime` (que pode
#: incluir microssegundos). Formatamos nós próprios como
#: `%Y-%m-%dT%H:%M:%SZ` — sem frações de segundo — porque é esse o formato
#: que `jq`'s `fromdateiso8601` (e `strptime` em shell) exige para o
#: conseguir comparar com outro instante.
ARRANCADO_EM: str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def criar_app() -> FastAPI:
    # Força a validação das definições a correr no arranque: é aqui que o
    # `model_validator` de `Definicoes` rejeita um `SEGREDO_SESSAO` inseguro
    # em produção. Sem isto, a guarda nunca é exercitada sob o Passenger.
    definicoes = obter_definicoes()

    if definicoes.ambiente == "producao":
        # Os três, não só o `/docs`: o `/redoc` serve o mesmo conteúdo, e o
        # `/openapi.json` publicaria o mapa completo da superfície de
        # gestão (`/gestao/*`, `/auth/*`, esquemas de entrada) a quem não
        # tem sessão nenhuma.
        aplicacao = FastAPI(
            title="Bar da Tomazia — API",
            docs_url=None,
            redoc_url=None,
            openapi_url=None,
        )
    else:
        aplicacao = FastAPI(title="Bar da Tomazia — API")

    # Não recalcula `ARRANCADO_EM`: só copia a constante do processo para o
    # `state` desta app, para a rota de `/health` a conseguir ler sem um
    # import circular com este módulo. `criar_app()` pode correr mais do
    # que uma vez no mesmo processo (os testes fazem-no); o valor copiado
    # é sempre o mesmo porque a constante já estava calculada antes.
    aplicacao.state.arrancado_em = ARRANCADO_EM

    aplicacao.include_router(saude.router)
    return aplicacao


app = criar_app()
