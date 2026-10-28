"""Quantas instruções SQL custa cada pedido público.

A ementa é a página inicial do site, servida por um SQLite num cPanel
partilhado com 30 processos de entrada. Uma implementação que percorra as
categorias e peça os produtos de cada uma (carregamento preguiçoso) devolve
exatamente a mesma resposta com N+1 consultas — e nenhum teste de conteúdo
fica vermelho por causa disso.

Dois guardas, porque medem coisas diferentes:

- **o teto**: um número máximo de instruções por pedido, generoso o
  suficiente para não escolher a implementação (um `join` com `unique()` e
  dois `select` com `selectinload` passam os dois);
- **a invariância**: a contagem não pode crescer quando os dados crescem.
  É esta que apanha o N+1 mesmo que alguém suba o teto.

As instruções são contadas no evento `before_cursor_execute` do motor da
app. Os três PRAGMAs de `app/db.py` não entram na conta: correm no evento
`connect`, com um cursor cru do DBAPI.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_http import ContadorDeSQL
from tests.apoio_publico import CAMINHOS_DA_F2_03

#: Teto de instruções SQL por pedido. Generoso de propósito: o que se quer
#: apanhar é a ordem de grandeza (1 ou 2 consultas contra uma por linha),
#: não a escolha entre um `join` e um `selectinload`.
TETOS_DE_SQL = {
    "/ementa": 3,
    "/eventos": 2,
    "/galeria": 2,
    "/info": 2,
}


def _engordar_o_cenario(sessao: Session, quantos: int = 12) -> None:
    """Mais categorias, produtos, eventos e fotos, todos visíveis.

    Serve a invariância: com mais linhas, uma implementação preguiçosa
    emite mais instruções; uma que carregue tudo de uma vez emite as
    mesmas.
    """
    from app.models.ementa import Categoria, Produto
    from app.models.eventos import Evento
    from app.models.fotos import EstadoFoto, Foto

    agora = datetime.now(UTC).replace(microsecond=0)
    for numero in range(quantos):
        id_categoria = 2000 + numero
        sessao.add(
            Categoria(
                id=id_categoria,
                nome=f"Categoria {numero} de exemplo",
                slug=f"categoria-{numero}-de-exemplo",
                ordem=10 + numero,
                visivel=True,
            )
        )
        sessao.flush()
        for indice in range(3):
            sessao.add(
                Produto(
                    id=id_categoria * 10 + indice,
                    categoria_id=id_categoria,
                    nome=f"Produto {numero}-{indice} de exemplo",
                    descricao=None,
                    preco_cent=100 + indice,
                    disponivel=True,
                    ordem=indice,
                )
            )
        sessao.add(
            Evento(
                id=3000 + numero,
                titulo=f"Evento {numero} de exemplo",
                inicio=agora + timedelta(days=10, minutes=numero),
                descricao=None,
                imagem=None,
                publicado=True,
            )
        )
        sessao.add(
            Foto(
                id=4000 + numero,
                ficheiro=f"00000000-0000-4000-8000-{4000 + numero:012d}.webp",
                estado=EstadoFoto.APROVADA,
                descricao=None,
                enviada_por=None,
                ip_hash=f"hash-falso-de-ip-{4000 + numero:016d}",
                criada_em=agora - timedelta(minutes=numero),
                moderada_em=agora,
            )
        )
    sessao.commit()


@pytest.mark.parametrize("caminho", CAMINHOS_DA_F2_03)
def test_cada_pedido_fica_abaixo_do_teto_de_instrucoes_sql(
    cliente: TestClient,
    sessao: Session,
    contador_de_sql: ContadorDeSQL,
    caminho: str,
) -> None:
    """O teto, com o cenário armadilhado semeado.

    O cenário tem três categorias visíveis: um carregamento preguiçoso dá
    quatro instruções na ementa e passa o teto de três.

    Deixa passar: uma implementação que faça uma consulta só mas traga a
    tabela inteira para memória e filtre em Python. O número de instruções
    não diz nada sobre o número de linhas lidas.
    """
    apoio_publico.semear_cenario(sessao)

    with contador_de_sql.a_contar():
        resposta = cliente.get(caminho)

    assert resposta.status_code == 200, resposta.text
    assert len(contador_de_sql.instrucoes) <= TETOS_DE_SQL[caminho], (
        f"{caminho} emitiu {contador_de_sql.resumo()}"
    )


@pytest.mark.parametrize("caminho", CAMINHOS_DA_F2_03)
def test_o_numero_de_instrucoes_nao_cresce_com_o_numero_de_linhas(
    cliente: TestClient,
    sessao: Session,
    contador_de_sql: ContadorDeSQL,
    caminho: str,
) -> None:
    """A invariância: mais dados, as mesmas instruções.

    É o guarda que sobrevive a alguém subir o teto para "fazer passar": a
    contagem com doze categorias a mais tem de ser **igual** à contagem com
    o cenário pequeno, não só menor do que um número.

    Deixa passar: uma implementação com um número fixo mas alto de
    consultas (por exemplo, uma por tabela do projeto) — é o teto que trata
    disso. Os dois juntos é que fecham o caso.
    """
    apoio_publico.semear_cenario(sessao)
    with contador_de_sql.a_contar() as poucas:
        primeira = cliente.get(caminho)
    com_poucos_dados = len(poucas)

    _engordar_o_cenario(sessao)
    with contador_de_sql.a_contar() as muitas:
        segunda = cliente.get(caminho)
    com_muitos_dados = len(muitas)

    assert primeira.status_code == 200
    assert segunda.status_code == 200
    assert com_poucos_dados > 0, (
        f"{caminho} não emitiu instrução SQL nenhuma: ou a resposta não vem "
        "da base de dados, ou o contador não está ligado ao motor que a app "
        "usa. Nos dois casos, a comparação de baixo não prova nada"
    )
    assert com_muitos_dados == com_poucos_dados, (
        f"{caminho} passou de {com_poucos_dados} para {com_muitos_dados} "
        f"instruções só por haver mais linhas:\n{contador_de_sql.resumo()}"
    )
