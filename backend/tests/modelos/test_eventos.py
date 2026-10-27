"""Eventos: a data é opcional no rascunho e obrigatória para publicar (F2-01).

Tudo o que está aqui vem do ADR 0009
(`docs/decisoes/0009-data-de-evento-obrigatoria-para-publicar.md`), que é
quem decide que `eventos.inicio` é anulável com

    CHECK (publicado = 0 OR inicio IS NOT NULL)  -- ck_eventos_publicado_exige_inicio

e que `eventos.publicado` é `NOT NULL`. As duas metades do critério da
tarefa ("evento publicado sem data rejeitado") vivem em `INSERT` **e** em
`UPDATE`, e o `UPDATE` é o que importa: publicar um rascunho que já existe é
o que o botão "Publicar" faz todos os dias.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.modelos.apoio import INSTANTE_FALSO, novo_evento

#: O nome está fixado pelo ADR 0009, que o cita textualmente. O SQLite
#: devolve-o na mensagem de erro, e é dele que a F2-05 vai depender para
#: responder em PT-PT junto do campo certo.
RESTRICAO = "ck_eventos_publicado_exige_inicio"


def test_rascunho_sem_data_e_aceite(sessao: Session) -> None:
    """Um rascunho pode não ter data — é onde a F2-08 põe os eventos do site antigo.

    `docs/legado/esquema-bd-antiga.sql` declara `data_evento DATE NOT NULL`
    e o site PHP contornava-o com a string vazia. Esses eventos têm de ter
    onde entrar sem ninguém inventar uma data.
    """
    sessao.add(
        novo_evento(titulo="Rascunho sem data de exemplo", inicio=None, publicado=False)
    )
    sessao.commit()

    linha = sessao.execute(text("SELECT titulo, inicio, publicado FROM eventos")).one()

    assert linha.inicio is None
    assert linha.publicado == 0


def test_publicar_sem_data_e_rejeitado(sessao: Session) -> None:
    """As duas metades do critério, no mesmo teste: `INSERT` e `UPDATE`.

    Quem se esquece do `UPDATE` é o teste, não o SQLite (ADR 0009). Um teste
    que só exercitasse o `INSERT` deixaria passar uma implementação futura
    que movesse a validação para o modelo e só a corresse na criação — e o
    botão "Publicar" da gestão, que é um `UPDATE`, deixava de ser guardado
    por coisa nenhuma.

    As duas asserções exigem o nome da restrição na mensagem. É isso que
    prova que foi a **base de dados** a recusar, e não um validador do lado
    do Python que um script como o `scripts/importar_bd_antiga.py`
    contornaria por escrever direto.
    """
    sessao.add(
        novo_evento(titulo="Publicado sem data de exemplo", inicio=None, publicado=True)
    )
    with pytest.raises(IntegrityError) as informacao_insert:
        sessao.commit()
    sessao.rollback()

    assert RESTRICAO in str(informacao_insert.value), (
        f"o INSERT foi recusado, mas não por {RESTRICAO}:\n{informacao_insert.value}"
    )

    rascunho = novo_evento(
        titulo="Rascunho a publicar de exemplo", inicio=None, publicado=False
    )
    sessao.add(rascunho)
    sessao.commit()
    identificador = rascunho.id

    with pytest.raises(IntegrityError) as informacao_update:
        sessao.execute(
            text("UPDATE eventos SET publicado = 1 WHERE id = :id"),
            {"id": identificador},
        )
        sessao.commit()
    sessao.rollback()

    assert RESTRICAO in str(informacao_update.value), (
        "publicar um rascunho sem data passou pelo UPDATE — é o caminho do "
        f"botão 'Publicar' da gestão:\n{informacao_update.value}"
    )


def test_publicar_com_data_e_aceite(sessao: Session) -> None:
    """O guarda testado contra o seu próprio sucesso falso.

    Um `CHECK (0)`, ou um `CHECK` com os operandos trocados, deixava o teste
    de cima verde e tornava impossível publicar fosse o que fosse. Este fixa
    que a restrição só recusa o caso que tem de recusar — pelos dois
    caminhos, tal como o teste anterior.
    """
    sessao.add(
        novo_evento(
            titulo="Publicado com data de exemplo",
            inicio=INSTANTE_FALSO,
            publicado=True,
        )
    )
    sessao.commit()

    rascunho = novo_evento(
        titulo="Rascunho com data de exemplo", inicio=INSTANTE_FALSO, publicado=False
    )
    sessao.add(rascunho)
    sessao.commit()

    sessao.execute(
        text("UPDATE eventos SET publicado = 1 WHERE id = :id"), {"id": rascunho.id}
    )
    sessao.commit()

    publicados = sessao.execute(
        text("SELECT COUNT(*) FROM eventos WHERE publicado = 1")
    ).scalar_one()
    assert publicados == 2


def test_publicado_nulo_e_rejeitado_senao_a_restricao_nasce_com_um_buraco(
    sessao: Session,
) -> None:
    """`publicado` tem de ser `NOT NULL`, e isso é correção, não arrumação.

    Em SQLite um `CHECK` só falha quando a expressão dá **falso**; com um
    operando NULL dá NULL, e NULL não é falso — passa. Medido no ADR 0009:

        publicado ANULÁVEL, (publicado=NULL, inicio=NULL)  -> ACEITE
        publicado NOT NULL, (publicado=NULL, inicio=NULL)  -> NOT NULL constraint failed

    Sem este teste, a restrição do teste acima nasce com um buraco por onde
    passa exatamente o caso que ela existe para fechar.
    """
    with pytest.raises(IntegrityError) as informacao:
        sessao.execute(
            text(
                "INSERT INTO eventos (titulo, inicio, publicado) "
                "VALUES ('Evento de exemplo sem nada', NULL, NULL)"
            )
        )
        sessao.commit()
    sessao.rollback()

    assert "not null" in str(informacao.value).lower(), (
        "um evento com `publicado` a NULL entrou (ou foi recusado por outro "
        f"motivo): o CHECK do ADR 0009 fica com um buraco:\n{informacao.value}"
    )
