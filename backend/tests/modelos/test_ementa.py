"""Categorias e produtos (F2-01).

Três dos critérios da tarefa estão aqui: slug único, preço ≥ 0 e — por
comportamento, que é a única forma que conta — chaves estrangeiras
verificadas. O quarto teste é um empréstimo ao S-09: o texto volta byte a
byte, sem escape HTML. O critério completo do S-09 é da F2-03; aqui prende-se
só a metade que vive na camada de dados, porque é aqui que um
`htmlspecialchars` à portuguesa se instalaria sem ninguém dar por isso.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.modelos.apoio import nova_categoria, novo_produto

#: Texto com aspas, sinais de maior/menor e um `<script>`: o que um dono
#: distraído (ou um atacante) escreve no nome de um produto. Guarda-se tal
#: como foi escrito — o escape é da camada de apresentação, nunca da base
#: de dados (`backend/CLAUDE.md`).
TEXTO_HOSTIL = 'Bitoque "da casa" <script>alert(1)</script> & cia. — 5\'5"'


def test_slug_duplicado_e_rejeitado(sessao: Session) -> None:
    """Critério da tarefa: o slug de uma categoria é único."""
    sessao.add(nova_categoria(nome="Bebidas de exemplo", slug="bebidas-de-exemplo"))
    sessao.commit()

    sessao.add(nova_categoria(nome="Outro nome de exemplo", slug="bebidas-de-exemplo"))
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "slug" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a do slug:\n{informacao.value}"
    )


def test_slugs_diferentes_convivem(sessao: Session) -> None:
    """O guarda de cima testado contra o seu próprio sucesso falso.

    Uma restrição de unicidade posta na coluna errada (ou um `UNIQUE` no
    `nome`) deixava o teste anterior verde na mesma. Este fixa que a
    unicidade é mesmo do `slug`: dois nomes diferentes com slugs diferentes
    entram os dois.
    """
    sessao.add(nova_categoria(nome="Bebidas de exemplo", slug="bebidas-de-exemplo"))
    sessao.add(nova_categoria(nome="Comidas de exemplo", slug="comidas-de-exemplo"))
    sessao.commit()

    quantas = sessao.execute(text("SELECT COUNT(*) FROM categorias")).scalar_one()
    assert quantas == 2


def test_preco_negativo_e_rejeitado(sessao: Session) -> None:
    """Critério da tarefa: `preco_cent >= 0`. O `-1` rebenta, o `0` passa.

    O `0` não é um extra: sem ele, um `CHECK (preco_cent > 0)` passava neste
    teste e proibia a água de cortesia e qualquer produto de oferta. A
    especificação diz `≥ 0`, não `> 0`.
    """
    categoria = nova_categoria()
    sessao.add(categoria)
    sessao.commit()

    sessao.add(
        novo_produto(categoria.id, nome="Produto de exemplo mal pago", preco_cent=-1)
    )
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "preco_cent" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a do preço:\n{informacao.value}"
    )

    sessao.add(
        novo_produto(categoria.id, nome="Água de exemplo (oferta)", preco_cent=0)
    )
    sessao.commit()

    quantos = sessao.execute(text("SELECT COUNT(*) FROM produtos")).scalar_one()
    assert quantos == 1


def test_produto_com_categoria_inexistente_e_rejeitado(sessao: Session) -> None:
    """Prova, por comportamento, que `PRAGMA foreign_keys=ON` está ativo.

    Este é o teste que importa sobre as chaves estrangeiras.
    `tests/test_db_pragmas.py` afirma que o PRAGMA está a 1 numa ligação; só
    um `INSERT` órfão a ser recusado prova que a restrição é verificada no
    caminho real, com a sessão da aplicação. Sem o PRAGMA, o SQLite aceita
    isto sem um aviso: a chave estrangeira fica escrita no DDL e nunca é
    olhada.
    """
    sessao.add(novo_produto(424242, nome="Produto órfão de exemplo"))
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "foreign key" in str(informacao.value).lower(), (
        "o INSERT foi recusado, mas não pela chave estrangeira — "
        f"`PRAGMA foreign_keys` está desligado?\n{informacao.value}"
    )


def test_apagar_categoria_com_produtos_e_rejeitado(sessao: Session) -> None:
    """`ON DELETE RESTRICT`: a categoria não se apaga por baixo dos produtos.

    Sem isto, apagar uma categoria na gestão (F2-05) levava os produtos
    atrás, em silêncio e sem confirmação nenhuma — ou deixava-os órfãos, se
    a chave fosse `ON DELETE SET NULL`.
    """
    categoria = nova_categoria()
    sessao.add(categoria)
    sessao.commit()
    sessao.add(novo_produto(categoria.id, nome="Imperial de exemplo"))
    sessao.commit()

    with pytest.raises(IntegrityError) as informacao:
        sessao.execute(
            text("DELETE FROM categorias WHERE id = :id"), {"id": categoria.id}
        )
        sessao.commit()
    sessao.rollback()

    assert "foreign key" in str(informacao.value).lower(), (
        f"o DELETE foi recusado, mas não pela chave estrangeira:\n{informacao.value}"
    )


def test_texto_do_produto_volta_byte_a_byte_sem_escape(sessao: Session) -> None:
    """Empréstimo ao S-09: nada de escape HTML ao guardar.

    A leitura é feita em SQL cru, de propósito: ler pelo ORM podia
    devolver o objeto que ainda está na sessão, com o texto original em
    memória, e o teste passava com a base de dados a guardar
    `&lt;script&gt;`.
    """
    categoria = nova_categoria()
    sessao.add(categoria)
    sessao.commit()

    sessao.add(novo_produto(categoria.id, nome=TEXTO_HOSTIL, descricao=TEXTO_HOSTIL))
    sessao.commit()

    linha = sessao.execute(text("SELECT nome, descricao FROM produtos")).one()

    assert linha.nome == TEXTO_HOSTIL
    assert linha.descricao == TEXTO_HOSTIL
    assert "&lt;" not in linha.nome
    assert "&amp;" not in linha.nome
    assert "&quot;" not in linha.nome


def test_insert_cru_sem_os_opcionais_usa_os_valores_por_omissao(
    sessao: Session,
) -> None:
    """As omissões de `categorias` e `produtos` vivem na **base de dados**.

    O `importar_bd_antiga.py` da F2-08 escreve direto, em SQL, sem ORM: é
    esta a tabela que ele vai encher com os 140 produtos e as 11
    categorias. Um `default=` só do lado do Python não corre nesse caminho,
    e sem `server_default` o script rebentava com
    `NOT NULL constraint failed: produtos.disponivel`.

    E os valores importam, não só a existência: `disponivel` e `visivel` a
    1 (um produto importado aparece na ementa, que é o que o dono espera
    ao migrar) e `ordem` a 0 (ordenação por decidir, não uma posição
    inventada).
    """
    sessao.execute(
        text(
            "INSERT INTO categorias (nome, slug) "
            "VALUES ('Importada de exemplo', 'importada-de-exemplo')"
        )
    )
    categoria_id = sessao.execute(
        text("SELECT id FROM categorias WHERE slug = 'importada-de-exemplo'")
    ).scalar_one()
    sessao.execute(
        text(
            "INSERT INTO produtos (categoria_id, nome, preco_cent) "
            "VALUES (:categoria_id, 'Importado de exemplo', 650)"
        ),
        {"categoria_id": categoria_id},
    )
    sessao.commit()

    categoria = sessao.execute(text("SELECT visivel, ordem FROM categorias")).one()
    assert categoria.visivel == 1
    assert categoria.ordem == 0

    produto = sessao.execute(
        text("SELECT disponivel, ordem, descricao FROM produtos")
    ).one()
    assert produto.disponivel == 1
    assert produto.ordem == 0
    assert produto.descricao is None
