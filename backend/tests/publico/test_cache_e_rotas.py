"""A tabela das rotas públicas, e a prova de que ela está completa.

No padrão do critério S-04 (`docs/ESPECIFICACAO.md`: "lista gerada a partir
das rotas"): em vez de uma lista escrita à mão que envelhece em silêncio,
percorre-se `criar_app().routes`, tiram-se as públicas e exige-se que cada
uma esteja na tabela — e a tabela é a mesma que alimenta o teste de cache e
o teste da marca.

O efeito: **uma rota pública nova fica vermelha até alguém decidir o que
ela expõe.** É o oposto de uma lista que ninguém atualiza.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.apoio_publico import CAMINHOS_PUBLICOS_GET, CONTRATO_PUBLICO
from tests.apoio_rotas import (
    caminhos_da_documentacao,
    exigir_cobertura_do_openapi,
    rotas_declaradas,
)

#: Os prefixos que não são públicos. `/gestao/*` exige sessão (S-04) e
#: `/auth/*` é a porta de entrada dela.
PREFIXOS_PRIVADOS = ("/gestao", "/auth")


def _rotas_publicas(aplicacao: FastAPI) -> dict[str, frozenset[str]]:
    """Caminho -> métodos, para as rotas públicas que a app declara.

    A travessia vive em `tests/apoio_rotas.py` e é a mesma que a F2-04 vai
    usar para o S-04: `include_router()` não copia as rotas para
    `app.routes` nesta versão do FastAPI, e um `for rota in app.routes`
    ingénuo devolve lista vazia numa app que tem rotas.

    Tira as da documentação (lidas da app, não escritas à mão) e as de
    `/gestao/*` e `/auth/*`, que não são públicas.
    """
    documentacao = caminhos_da_documentacao(aplicacao)
    return {
        caminho: metodos
        for caminho, metodos in rotas_declaradas(aplicacao).items()
        if caminho not in documentacao and not caminho.startswith(PREFIXOS_PRIVADOS)
    }


class TestEnumeracaoDasRotas:
    def test_a_app_declara_rotas_publicas(self) -> None:
        """O controlo de sucesso falso da enumeração.

        Um filtro que não apanhasse rota nenhuma deixava os testes de baixo
        verdes com conjuntos vazios dos dois lados. "Não encontrei" e "não
        consegui procurar" não podem dar o mesmo resultado (regra 10).

        Deixa passar: nada sobre quais as rotas.
        """
        from app.main import criar_app

        aplicacao = criar_app()
        exigir_cobertura_do_openapi(aplicacao)

        assert _rotas_publicas(aplicacao), (
            "não foi encontrada rota pública nenhuma em `criar_app().routes`. "
            "Ou a app não tem rotas, ou o filtro desta função deixou de as "
            "reconhecer — e nos dois casos os testes seguintes não provam nada"
        )

    def test_nenhuma_rota_publica_tem_parametros_no_caminho(self) -> None:
        """Um `/{id}` não se testa com uma tabela de caminhos fixos.

        Em vez de o saltar — o que daria a "não há nada a verificar" o
        mesmo resultado que a "está tudo verificado" —, falha a dizer que a
        tabela tem de crescer. Quando a F2-06 acrescentar
        `GET /fotos/{id}`, é aqui que se decide como se testa.

        Deixa passar: nada; é um guarda, não um teste de comportamento.
        """
        from app.main import criar_app

        com_parametros = sorted(
            caminho for caminho in _rotas_publicas(criar_app()) if "{" in caminho
        )

        assert not com_parametros, (
            f"estas rotas públicas têm parâmetros no caminho: {com_parametros}. "
            "A tabela `CONTRATO_PUBLICO` de `tests/apoio_publico.py` só sabe "
            "caminhos fixos: tem de ser estendida (com valores de exemplo para "
            "os parâmetros) antes de estas rotas poderem ser verificadas. "
            "Saltá-las seria dar o mesmo resultado a 'não encontrei' e a 'não "
            "consegui verificar'"
        )

    def test_a_tabela_tem_exatamente_as_rotas_publicas_da_app(self) -> None:
        """Nem a mais nem a menos, e com os mesmos métodos.

        Uma rota pública nova fica vermelha aqui, e acrescentá-la à tabela
        obriga a decidir o cabeçalho de cache **e** mete-a no teste da
        marca, que é o que pergunta o que ela expõe.

        Deixa passar: o que a rota faz. Esta é uma asserção sobre a lista.
        """
        from app.main import criar_app

        encontradas = _rotas_publicas(criar_app())
        esperadas = {
            caminho: contrato.metodos for caminho, contrato in CONTRATO_PUBLICO.items()
        }

        assert encontradas == esperadas

    def test_os_caminhos_do_teste_da_marca_sao_os_da_tabela(self) -> None:
        """A lista que o teste da marca percorre é derivada, não escrita.

        Sem isto, a tabela podia crescer e o teste da marca ficar a
        percorrer a lista antiga — exatamente o envelhecimento silencioso
        que esta bateria existe para impedir.

        Deixa passar: que o teste da marca seja mesmo executado; isso vê-se
        nos identificadores do pytest.
        """
        esperados = {
            caminho
            for caminho, contrato in CONTRATO_PUBLICO.items()
            if "GET" in contrato.metodos
        }

        assert set(CAMINHOS_PUBLICOS_GET) == esperados


class TestCacheControl:
    @pytest.mark.parametrize("caminho", CAMINHOS_PUBLICOS_GET)
    def test_cada_rota_publica_devolve_o_cache_control_da_tabela(
        self, cliente: TestClient, caminho: str
    ) -> None:
        """`max-age=60` na ementa e nos eventos; `no-store` no resto.

        A ementa e os eventos mudam quando o dono os edita e podem esperar
        um minuto. A galeria muda quando ele modera uma foto e a `/info`
        quando muda a password do WiFi — nessas, um minuto de cache é um
        minuto a mostrar o que já não é verdade.

        A comparação é de igualdade exata, não de "contém": um
        `no-store, max-age=60` é uma contradição que o "contém" deixava
        passar.

        Deixa passar: o que um CDN ou o Apache fazem com o cabeçalho
        depois, e cabeçalhos de cache a mais (`ETag`, `Expires`).
        """
        resposta = cliente.get(caminho)

        assert resposta.status_code == 200, resposta.text
        assert resposta.headers["cache-control"] == CONTRATO_PUBLICO[caminho].cache

    @pytest.mark.parametrize("caminho", CAMINHOS_PUBLICOS_GET)
    def test_o_cabecalho_de_cache_nao_depende_de_haver_dados(
        self, cliente: TestClient, sessao: Session, caminho: str
    ) -> None:
        """Com a base de dados cheia, o cabeçalho é o mesmo que com ela vazia.

        Um `Cache-Control` escrito só num dos ramos da função (o do "há
        dados") é um defeito que o teste de cima, que corre com a base de
        dados vazia, deixava passar inteiro.

        Deixa passar: respostas de erro (4xx, 5xx), que não passam por
        aqui.
        """
        from tests import apoio_publico

        apoio_publico.semear_cenario(sessao)

        resposta = cliente.get(caminho)

        assert resposta.status_code == 200, resposta.text
        assert resposta.headers["cache-control"] == CONTRATO_PUBLICO[caminho].cache
