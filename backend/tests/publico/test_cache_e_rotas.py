"""A tabela das rotas públicas, e a prova de que ela está completa.

No padrão do critério S-04 (`docs/ESPECIFICACAO.md`: "lista gerada a partir
das rotas"): em vez de uma lista escrita à mão que envelhece em silêncio,
percorrem-se as rotas que a app declara, tiram-se as públicas e exige-se
que cada uma esteja na tabela — e a tabela é a mesma que alimenta o teste
de cache e o teste da marca.

O efeito: **uma rota pública nova fica vermelha até alguém decidir o que
ela expõe.** É o oposto de uma lista que ninguém atualiza.

**A travessia é `tests/apoio_rotas.py::rotas_declaradas`, e não um
`for rota in criar_app().routes`.** A diferença não é estilo: medido com
FastAPI 0.161.1, o `include_router()` não copia as rotas para
`app.routes` — deixa lá um `_IncludedRouter`, que não é uma rota, não tem
`.routes`, e guarda o router original e o prefixo num `include_context` à
parte. O varrimento ingénuo devolve **lista vazia** numa app que tem rotas,
e um teste de enumeração que confunda "não há rotas" com "não sei onde elas
estão" fica verde a dizer que verificou tudo. `rotas_declaradas` desce a
partir de `aplicacao.router`, acumula os prefixos de cada nível e rebenta
diante de um objeto de rota que não saiba classificar.

A F2-04 vai copiar este ficheiro como padrão do S-04: é por isso que o
texto tem de dizer o que o código faz, e não o que parecia natural fazer.
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
        consegui procurar" não podem dar o mesmo resultado (regra 10). Não
        é hipotético: um `for rota in criar_app().routes` com
        `isinstance(rota, APIRoute)` devolve zero nesta versão do FastAPI,
        e foi este teste que o apanhou.

        Deixa passar: nada sobre quais as rotas.
        """
        from app.main import criar_app

        aplicacao = criar_app()
        exigir_cobertura_do_openapi(aplicacao)

        assert _rotas_publicas(aplicacao), (
            "a travessia de `tests/apoio_rotas.py` não encontrou rota "
            "pública nenhuma nesta app. Ou a app não tem rotas, ou a "
            "travessia deixou de saber ler a versão do FastAPI instalada — "
            "e nos dois casos os testes seguintes não provam nada"
        )

    def test_nenhuma_rota_publica_tem_parametros_no_caminho(self) -> None:
        """Um `/{id}` não se testa com uma tabela de caminhos fixos.

        Em vez de o saltar — o que daria a "não há nada a verificar" o
        mesmo resultado que a "está tudo verificado" —, falha a dizer que a
        tabela tem de crescer, se algum dia uma rota pública trouxer um
        parâmetro no caminho.

        **A F2-06 não traz isso.** Uma versão anterior deste comentário
        prometia `GET /fotos/{id}` público; o Tomás decidiu que a imagem
        de uma foto pendente é só de admins
        (`GET /gestao/fotos/{id}/imagem`, atrás de `exigir_admin`), nunca
        pública. A F2-06 acrescenta só `POST /fotos`, sem parâmetro nenhum
        no caminho (ver `tests/apoio_publico.py::CONTRATO_PUBLICO`), e este
        guarda continua com zero casos depois dela.

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


class TestIndexacao:
    """`X-Robots-Tag: noindex` na `/info`, e **em mais lado nenhum**.

    A password do WiFi sai em texto na `/info` — é decisão registada do
    Tomás no ADR 0011, é o ecrã do QR code na mesa. Pública e indexada não
    são a mesma coisa: sem o cabeçalho, a password, a morada e o telefone
    ficam pesquisáveis a partir de fora, para sempre, por quem nunca
    procurou o bar.

    O negativo pesa tanto como o positivo. A ementa e os eventos são
    conteúdo que **queremos** indexado: é como as pessoas encontram o bar.
    Um `noindex` posto em todas as rotas "por segurança" tira o site do
    Google e passava num teste que só verificasse a `/info`.
    """

    def test_a_tabela_tem_rotas_dos_dois_lados(self) -> None:
        """O controlo de sucesso falso dos dois testes de baixo.

        Se a coluna `robots` ficasse toda a `None` — alguém a apagar a
        entrada da `/info` para "fazer passar" —, o teste parametrizado
        continuava verde, a verificar cinco ausências e nenhuma presença.
        "Não há cabeçalho nenhum para verificar" e "verifiquei todos os
        cabeçalhos" não podem dar o mesmo resultado (regra 10).

        Deixa passar: nada sobre as respostas; é um guarda sobre a tabela.
        """
        com_cabecalho = [
            caminho
            for caminho, contrato in CONTRATO_PUBLICO.items()
            if contrato.robots is not None
        ]
        sem_cabecalho = [
            caminho
            for caminho, contrato in CONTRATO_PUBLICO.items()
            if contrato.robots is None
        ]

        assert com_cabecalho, "nenhuma rota na tabela espera `X-Robots-Tag`"
        assert sem_cabecalho, "nenhuma rota na tabela recusa `X-Robots-Tag`"

    @pytest.mark.parametrize("caminho", CAMINHOS_PUBLICOS_GET)
    def test_o_x_robots_tag_e_exatamente_o_da_tabela_ou_nao_existe(
        self, cliente: TestClient, sessao: Session, caminho: str
    ) -> None:
        """Presença e valor onde a tabela o manda; ausência onde não manda.

        Com o cenário semeado, para o cabeçalho não poder viver só no ramo
        do "não há dados" — o mesmo defeito que o par do `Cache-Control`
        apanha.

        Deixa passar: o que os motores de busca fazem com o cabeçalho (e
        se o Apache o repete ou o substitui em produção). E não vê a
        `<meta name="robots">` do HTML, que é do frontend: esta rota serve
        JSON, e o cabeçalho é a única forma de o dizer.
        """
        from tests import apoio_publico

        apoio_publico.semear_cenario(sessao)
        esperado = CONTRATO_PUBLICO[caminho].robots

        resposta = cliente.get(caminho)

        assert resposta.status_code == 200, resposta.text
        if esperado is None:
            assert "x-robots-tag" not in resposta.headers, (
                f"{caminho} trouxe `X-Robots-Tag: "
                f"{resposta.headers.get('x-robots-tag')}`. Esta rota é "
                "conteúdo que queremos indexado: é como as pessoas "
                "encontram o bar"
            )
        else:
            assert resposta.headers["x-robots-tag"] == esperado
