"""A marca: nada do que está escondido pode aparecer em resposta nenhuma.

O cenário armadilhado põe `MARCA` em tudo o que não pode sair — categoria
invisível, categoria sem produtos disponíveis, produto indisponível, evento
rascunho, evento passado, foto pendente, foto rejeitada, e uma chave de
`definicoes` que não é publicada — e este ficheiro exige que a marca **não
apareça no corpo** de nenhuma das rotas públicas.

`MARCA not in resposta.text` e não uma comparação campo a campo: é o que
apanha a fuga por **qualquer** campo, incluindo campos que ainda não
existem. Um campo novo acrescentado por distração a um `response_model`
não tem teste nenhum à espera dele — tem este.

A marca está também em `fotos.ip_hash` e `fotos.enviada_por` de uma foto
**aprovada**, que aparece na galeria. É o que distingue "a linha está
escondida" de "o campo está escondido": sem ela, um `SELECT *` sobre as
linhas aprovadas passava neste ficheiro inteiro.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_publico import CAMINHOS_PUBLICOS_GET, MARCA


def _colunas_de_texto_com_a_marca(motor: Engine) -> dict[str, int]:
    """Por `tabela.coluna`, quantas linhas contêm a marca. Em SQL cru."""
    contagens: dict[str, int] = {}
    with motor.connect() as ligacao:
        tabelas = [
            linha[0]
            for linha in ligacao.execute(
                text("SELECT name FROM sqlite_master WHERE type = 'table'")
            )
            if not linha[0].startswith("sqlite_") and linha[0] != "alembic_version"
        ]
        for tabela in tabelas:
            for linha in ligacao.execute(text(f"PRAGMA table_info({tabela})")):
                coluna = linha[1]
                quantas = ligacao.execute(
                    text(
                        f'SELECT COUNT(*) FROM "{tabela}" '
                        f'WHERE CAST("{coluna}" AS TEXT) LIKE :padrao'
                    ),
                    {"padrao": f"%{MARCA}%"},
                ).scalar_one()
                if quantas:
                    contagens[f"{tabela}.{coluna}"] = int(quantas)
    return contagens


class TestAArmadilhaEstaArmada:
    def test_a_marca_esta_mesmo_na_base_de_dados_antes_de_se_pedir_fuga_nenhuma(
        self, motor: Engine, sessao: Session
    ) -> None:
        """O controlo de sucesso falso de todo este ficheiro.

        Se `semear_cenario` falhasse em silêncio — uma coluna renomeada, um
        `commit` perdido —, os testes da marca ficavam todos verdes por não
        haver marca nenhuma para fugir. Este conta-a na base de dados, em
        SQL cru, e diz em que colunas está.

        Exige também a marca nos dois campos de uma foto **aprovada**: é
        essa linha que prova que o que está escondido é o campo e não a
        linha.

        Deixa passar: nada sobre as respostas; é um teste sobre o cenário.
        """
        apoio_publico.semear_cenario(sessao)

        contagens = _colunas_de_texto_com_a_marca(motor)

        assert "fotos.ip_hash" in contagens, contagens
        assert "fotos.enviada_por" in contagens, contagens
        assert "categorias.nome" in contagens, contagens
        assert "produtos.nome" in contagens, contagens
        assert "eventos.titulo" in contagens, contagens
        assert "definicoes.valor" in contagens, contagens
        assert sum(contagens.values()) >= 15, contagens


class TestNenhumaRotaDeixaFugirAMarca:
    @pytest.mark.parametrize("caminho", CAMINHOS_PUBLICOS_GET)
    def test_a_marca_nao_aparece_no_corpo_da_resposta(
        self, cliente: TestClient, sessao: Session, caminho: str
    ) -> None:
        """A asserção que apanha a fuga por um campo que ainda não existe.

        O `status_code == 200` vem primeiro de propósito: um 500 tem um
        corpo sem marca nenhuma e passava a asserção de baixo sem nada
        estar certo — "falhou" e "não deixou fugir" não podem dar o mesmo
        resultado (regra 10).

        Deixa passar: uma fuga que o JSON **escape** (um campo com
        `\\u004e...`). A marca é ASCII e nenhum serializador a escapa
        hoje; se um dia um escapar, esta asserção fica cega. E deixa
        passar fugas pelos cabeçalhos: só olha para o corpo.
        """
        apoio_publico.semear_cenario(sessao)

        resposta = cliente.get(caminho)

        assert resposta.status_code == 200, resposta.text
        assert MARCA not in resposta.text, (
            f"{caminho} deixou escapar conteúdo escondido. Corpo: {resposta.text}"
        )

    def test_a_chave_interna_de_definicoes_nao_aparece_na_info(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """`definicoes` é chave/valor: publicar a tabela é publicar o futuro.

        A chave interna do cenário existe para que "devolver tudo o que
        está em `definicoes`" seja vermelho hoje, e não no dia em que
        alguém guardar lá um token.

        Deixa passar: o nome da chave pode aparecer noutro endpoint — só se
        olha para `/info`.
        """
        apoio_publico.semear_cenario(sessao)

        resposta = cliente.get("/info")

        assert resposta.status_code == 200
        assert apoio_publico.CHAVE_INTERNA_NAO_PUBLICADA not in resposta.text
