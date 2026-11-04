"""Critério S-06: mutação sem `X-Tomazia` é 403.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-06 | Mutação sem `X-Tomazia` | 403 |

`docs/ESPECIFICACAO.md`: "cabeçalho `X-Tomazia: 1` obrigatório em
mutações". O plano da F2-04 é explícito sobre a forma: **guarda por
middleware sobre o método, não `Depends` por rota.** Um `Depends`
esquecido numa rota nova da F2-05 é um buraco silencioso; um guarda
estrutural (aplicado antes de saber qual rota vai responder) não tem onde
ser esquecido.

## Como se prova "estrutural" às cegas, sem olhar ao código

Em vez de inspecionar `app.user_middleware` (o que amarraria o teste à
forma exata da implementação), acrescenta-se uma rota de sonda **depois**
de `criar_app()` já ter devolvido a app, sem `Depends` nenhum declarado
nela. Se o guarda fosse um `Depends` posto rota a rota, esta rota nova
passava sem cabeçalho nenhum — é precisamente esse buraco que o plano da
F2-04 quer impedir antes de a F2-05 o criar. Só um guarda que corra para
**todo** o pedido, antes ou independentemente da rota resolvida,
continua a aplicar-se aqui.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from app.marca import MENSAGEM_CABECALHO_EM_FALTA
from tests.apoio_auth import CREDENCIAIS_FALSAS

if TYPE_CHECKING:
    from fastapi import FastAPI

METODOS_DE_MUTACAO = ("POST", "PUT", "PATCH", "DELETE")
CAMINHO_DA_SONDA = "/__sonda_s06__"
CABECALHO_CORRETO = {"X-Tomazia": "1"}


def _app_com_sonda(metodo: str) -> FastAPI:
    """A app real, com uma rota de sonda acrescentada depois de construída.

    Sem `Depends` nenhum: é o que torna esta rota equivalente a uma rota
    nova da F2-05 que alguém esqueceu de proteger à mão — o guarda do
    S-06, para continuar a aplicar-se aqui, tem de ser estrutural.
    """
    from app.main import criar_app

    aplicacao = criar_app()

    async def sonda() -> dict[str, bool]:
        return {"ok": True}

    aplicacao.add_api_route(CAMINHO_DA_SONDA, sonda, methods=[metodo])
    return aplicacao


def _cliente_para(metodo: str) -> object:
    from fastapi.testclient import TestClient

    return TestClient(_app_com_sonda(metodo), base_url="https://testserver")


class TestGuardaEstruturalSobreOMetodo:
    @pytest.mark.parametrize("metodo", METODOS_DE_MUTACAO)
    def test_mutacao_sem_cabecalho_e_403_mesmo_numa_rota_sem_depends(
        self, metodo: str
    ) -> None:
        """A prova central: nenhum `Depends` na rota, e ainda assim 403.

        Deixa passar: nada sobre o corpo da rota em si — só que o guarda
        intercetou o pedido antes dela correr.
        """
        cliente = _cliente_para(metodo)
        resposta = getattr(cliente, metodo.lower())(CAMINHO_DA_SONDA)
        assert resposta.status_code == 403
        corpo = resposta.json()
        assert corpo["erro"] == "cabecalho_x_tomazia_em_falta"
        # Texto do ui-ux: a frase anterior nomeava o cabeçalho e o valor
        # exato esperado — divulgação desnecessária, mesmo não sendo uma
        # vulnerabilidade (a guarda não depende de segredo nenhum).
        assert corpo["mensagem"] == MENSAGEM_CABECALHO_EM_FALTA
        assert "X-Tomazia" not in corpo["mensagem"]

    @pytest.mark.parametrize("metodo", METODOS_DE_MUTACAO)
    def test_mutacao_com_cabecalho_correto_nao_e_bloqueada_por_este_guarda(
        self, metodo: str
    ) -> None:
        """Pode continuar a dar outro erro (por exemplo, falta de sessão).

        O que se prova aqui é só que **não é este guarda** a travar o
        pedido quando o cabeçalho vem certo.
        """
        cliente = _cliente_para(metodo)
        resposta = getattr(cliente, metodo.lower())(
            CAMINHO_DA_SONDA, headers=CABECALHO_CORRETO
        )
        assert resposta.status_code != 403

    def test_get_nunca_precisa_do_cabecalho(self) -> None:
        cliente = _cliente_para("GET")
        resposta = cliente.get(CAMINHO_DA_SONDA)
        assert resposta.status_code != 403

    def test_head_nunca_precisa_do_cabecalho(self) -> None:
        cliente = _cliente_para("GET")
        resposta = cliente.head(CAMINHO_DA_SONDA)
        assert resposta.status_code != 403

    def test_options_nunca_precisa_do_cabecalho(self) -> None:
        from fastapi.testclient import TestClient

        from app.main import criar_app

        cliente = TestClient(criar_app(), base_url="https://testserver")
        resposta = cliente.options("/health")
        assert resposta.status_code != 403


class TestValorDoCabecalho:
    def test_valor_diferente_de_1_e_403_igual_a_ausente(self) -> None:
        """ "Presente mas diferente" tem de dar o mesmo resultado que "ausente".

        Um guarda que aceitasse qualquer valor não vazio (`"true"`, `"0"`,
        `"sim"`) deixava de ser um cabeçalho de intenção explícita e
        passava a ser só "o cliente escreveu alguma coisa aqui".
        """
        cliente = _cliente_para("POST")
        resposta = cliente.post(CAMINHO_DA_SONDA, headers={"X-Tomazia": "2"})
        assert resposta.status_code == 403


class TestLoginIncluidoSemExcecao:
    def test_login_sem_x_tomazia_e_403(self) -> None:
        """`/auth/login` não é uma exceção ao S-06, apesar de ser a porta de entrada."""
        from fastapi.testclient import TestClient

        from app.main import criar_app

        cliente = TestClient(criar_app(), base_url="https://testserver")
        resposta = cliente.post("/auth/login", json=CREDENCIAIS_FALSAS)
        assert resposta.status_code == 403
