"""Critério S-04: cada rota `/gestao/*`, sem sessão, é 401.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-04 | Cada rota `/gestao/*` sem sessão (lista gerada a partir das rotas) | 401 em todas |

## O problema honesto desta tarefa

A F2-04 **não cria nenhuma rota `/gestao/*`** — são todas da F2-05 (CRUD de
categorias/produtos/eventos) e da F2-06 (moderação de fotos). Um teste
parametrizado sobre "a lista gerada a partir das rotas" produziria **zero
casos** hoje e ficaria verde sem ter verificado nada — exatamente o "não
encontrei" a disfarçar-se de "está tudo verificado" que a regra 10 do
`CLAUDE.md` proíbe.

Por isso esta bateria tem quatro camadas, e não uma só:

1. **Controlo da travessia** — a app real continua a ter rotas nalgum
   lado, e a travessia (`tests/apoio_rotas.py`) continua a vê-las.
2. **Comportamento**, numa app de teste construída aqui mesmo, com uma
   rota de sonda protegida pelas `dependencies` do router **real** de
   gestão: sem cookie, cookie adulterado, expirado, assinado com outro
   segredo, e com o `admin_id` apagado da BD → 401 em todos; sessão boa →
   200.
3. **Igualdade explícita da lista gerada**, no padrão do
   `CONTRATO_PUBLICO` de `tests/apoio_publico.py`: hoje o conjunto
   esperado é vazio, **e está escrito aqui porquê** — para "zero porque
   ainda não há nenhuma" nunca mais dar o mesmo resultado que "zero porque
   a travessia partiu". Quando a F2-05 acrescentar a primeira rota, esta
   igualdade fica vermelha, e é isso que obriga alguém a vir decidir se
   ela também fica protegida.
4. **Estrutural** — o router de gestão declara `exigir_admin` nas suas
   `dependencies`. Assertável hoje, com zero rotas.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    fixar_relogio_auth,
    nome_e_valor_do_cookie,
)
from tests.apoio_rotas import exigir_cobertura_do_openapi, rotas_declaradas

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.models.admins import Admin

INSTANTE_BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)
VALIDADE_DA_SESSAO = timedelta(hours=12)

#: F2-04 não cria nenhuma rota `/gestao/*` — são todas da F2-05 e da F2-06.
#: O conjunto vazio aqui é uma decisão explícita, não um esquecimento: é o
#: que distingue "zero porque ainda não há nenhuma" de "zero porque a
#: travessia partiu" (a Camada 1, acima). Quando a F2-05 acrescentar a
#: primeira rota de gestão, este `assert` fica vermelho — e é exatamente
#: isso que obriga a decidir, naquele PR, se ela fica protegida.
ROTAS_DE_GESTAO_ESPERADAS: frozenset[str] = frozenset()


def _rotas_de_gestao(aplicacao: FastAPI) -> frozenset[str]:
    return frozenset(
        caminho
        for caminho in rotas_declaradas(aplicacao)
        if caminho.startswith("/gestao")
    )


class TestCamada1ControloDaTravessia:
    def test_a_travessia_continua_a_ver_rotas_na_app_real(self) -> None:
        """Sucesso falso: sem isto, zero rotas de gestão podia ser "a travessia partiu".

        Deixa passar: nada sobre `/gestao/*` — só que a travessia em si
        continua a saber ler esta versão do FastAPI.
        """
        from app.main import criar_app

        aplicacao = criar_app()
        exigir_cobertura_do_openapi(aplicacao)
        assert rotas_declaradas(aplicacao), (
            "a travessia não encontrou rota nenhuma na app real — a app não "
            "tem rotas (improvável) ou a travessia partiu. Nos dois casos, "
            "os testes de `/gestao/*` abaixo não provariam nada"
        )


class TestCamada2ComportamentoNaAppDeTeste:
    """Uma rota de sonda, protegida pelas `dependencies` do router real de gestão."""

    @staticmethod
    def _app_de_sonda() -> FastAPI:
        from fastapi import APIRouter, FastAPI

        from app.routers import gestao

        #: Lê `gestao.router.dependencies` em vez de mutar o router
        #: partilhado: se a F2-05 esquecer `exigir_admin` no router real,
        #: esta lista vem vazia e a rota de sonda fica tão desprotegida
        #: quanto a real ficaria — é isso que faz este teste falhar pela
        #: razão certa em vez de testar uma cópia à parte das dependências.
        roteador_de_sonda = APIRouter(dependencies=gestao.router.dependencies)

        @roteador_de_sonda.get("/sonda")
        def sonda() -> dict[str, bool]:
            return {"ok": True}

        aplicacao = FastAPI()
        aplicacao.include_router(roteador_de_sonda, prefix="/gestao")
        return aplicacao

    @classmethod
    def _cliente_de_sonda(cls) -> TestClient:
        from fastapi.testclient import TestClient

        return TestClient(cls._app_de_sonda(), base_url="https://testserver")

    @staticmethod
    def _cookie_de_login_valido() -> tuple[str, str]:
        """Faz login na app **real** (`app.main`) e devolve (nome, valor) do cookie.

        A mesma base de dados serve as duas apps: `app.db.obter_engine()`
        está em cache por processo e não depende de qual `criar_app()` a
        chama.
        """
        from fastapi.testclient import TestClient

        from app.main import criar_app

        with TestClient(criar_app(), base_url="https://testserver") as cliente:
            resposta = cliente.post(
                "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
            )
            assert resposta.status_code == 200, (
                f"o login de apoio falhou ({resposta.status_code}): {resposta.text}"
            )
            return nome_e_valor_do_cookie(resposta)

    def test_sem_cookie_e_401(self) -> None:
        cliente = self._cliente_de_sonda()
        resposta = cliente.get("/gestao/sonda")
        assert resposta.status_code == 401

    @pytest.mark.usefixtures("admin")
    def test_sessao_boa_e_200(self) -> None:
        nome, valor = self._cookie_de_login_valido()
        cliente = self._cliente_de_sonda()
        cliente.cookies.set(nome, valor)
        resposta = cliente.get("/gestao/sonda")
        assert resposta.status_code == 200

    @pytest.mark.usefixtures("admin")
    def test_cookie_adulterado_e_401(self) -> None:
        nome, valor = self._cookie_de_login_valido()
        cliente = self._cliente_de_sonda()
        cliente.cookies.set(nome, valor[:-1] + ("0" if valor[-1:] != "0" else "1"))
        resposta = cliente.get("/gestao/sonda")
        assert resposta.status_code == 401

    def test_cookie_expirado_e_401(
        self, monkeypatch: pytest.MonkeyPatch, admin: Admin
    ) -> None:
        relogio = fixar_relogio_auth(monkeypatch, INSTANTE_BASE)
        nome, valor = self._cookie_de_login_valido()

        relogio.instante = INSTANTE_BASE + VALIDADE_DA_SESSAO + timedelta(seconds=1)
        cliente = self._cliente_de_sonda()
        cliente.cookies.set(nome, valor)
        resposta = cliente.get("/gestao/sonda")
        assert resposta.status_code == 401

    def test_cookie_assinado_com_outro_segredo_e_401(
        self, monkeypatch: pytest.MonkeyPatch, admin: Admin
    ) -> None:
        from fastapi.testclient import TestClient

        import app.config
        from app.main import criar_app

        monkeypatch.setenv("SEGREDO_SESSAO", "outro-segredo-de-exemplo-s04-zzzz")
        app.config.obter_definicoes.cache_clear()
        with TestClient(criar_app(), base_url="https://testserver") as cliente_outro:
            resposta = cliente_outro.post(
                "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
            )
            assert resposta.status_code == 200, resposta.text
            nome, valor = nome_e_valor_do_cookie(resposta)

        monkeypatch.delenv("SEGREDO_SESSAO", raising=False)
        app.config.obter_definicoes.cache_clear()

        cliente = self._cliente_de_sonda()
        cliente.cookies.set(nome, valor)
        resposta = cliente.get("/gestao/sonda")
        assert resposta.status_code == 401

    def test_admin_apagado_da_bd_e_401(self, admin: Admin, sessao: Session) -> None:
        nome, valor = self._cookie_de_login_valido()

        sessao.delete(admin)
        sessao.commit()

        cliente = self._cliente_de_sonda()
        cliente.cookies.set(nome, valor)
        resposta = cliente.get("/gestao/sonda")
        assert resposta.status_code == 401


class TestCamada3ListaExplicita:
    def test_a_lista_de_rotas_de_gestao_e_exatamente_a_esperada(self) -> None:
        # Import solto de propósito (e não numa `try`/`except`): se
        # `app.routers.gestao` ainda não existir, este teste tem de
        # rebentar a dizer "módulo que não existe", não ficar
        # silenciosamente verde por a app principal não ter nenhuma rota
        # de gestão por nenhures incluída.
        from app.main import criar_app
        from app.routers import gestao  # noqa: F401

        assert _rotas_de_gestao(criar_app()) == ROTAS_DE_GESTAO_ESPERADAS


class TestCamada4Estrutural:
    def test_router_de_gestao_declara_exigir_admin_nas_dependencies(self) -> None:
        """Por construção, não por rota: um `Depends` esquecido não é um buraco aqui.

        `dependencies=[Depends(exigir_admin)]` no **router** de gestão
        protege qualquer rota que a F2-05 e a F2-06 lá venham a pôr, sem
        ninguém ter de se lembrar de o repetir rota a rota.
        """
        from app.routers import gestao
        from app.services.auth import exigir_admin

        dependencias = {d.dependency for d in gestao.router.dependencies}
        assert exigir_admin in dependencias, (
            "o router de `/gestao` não tem `exigir_admin` nas suas "
            "`dependencies`. É isto, não um `Depends` por rota, que torna "
            "impossível uma rota nova da F2-05 nascer sem proteção"
        )
