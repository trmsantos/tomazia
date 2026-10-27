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


#: Os mesmos valores que `tests/modelos/test_fotos.py` recusa em
#: `fotos.ficheiro`: `eventos.imagem` é também um nome de ficheiro, nunca
#: um caminho, e quem o lê junta-o a uma pasta.
IMAGENS_COM_CAMINHO = (
    "../fora-de-exemplo.webp",
    "pasta/dentro-de-exemplo.webp",
    "pasta\\dentro-de-exemplo.webp",
    "/absoluto-de-exemplo.webp",
    "..oculto-de-exemplo.webp",
)

RESTRICAO_IMAGEM = "ck_eventos_imagem_sem_caminho"


@pytest.mark.parametrize("imagem", IMAGENS_COM_CAMINHO)
def test_imagem_com_caminho_e_rejeitada(sessao: Session, imagem: str) -> None:
    """A base de dados recusa uma `imagem` que não seja só um nome.

    A defesa principal é da fronteira (a F4-03 valida antes de guardar),
    mas a F2-08 importa nomes de imagem do site antigo sem passar pela API,
    e um `CHECK` não se acrescenta depois sem reconstruir a tabela.
    """
    sessao.add(
        novo_evento(
            titulo="Evento com imagem de exemplo",
            imagem=imagem,
            inicio=INSTANTE_FALSO,
            publicado=True,
        )
    )
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert RESTRICAO_IMAGEM in str(informacao.value), (
        f"{imagem!r} foi recusada, mas não por {RESTRICAO_IMAGEM}:\n{informacao.value}"
    )


def test_evento_sem_imagem_e_com_imagem_simples_sao_aceites(sessao: Session) -> None:
    """O guarda de cima testado contra o seu próprio sucesso falso.

    Duas metades, e a primeira é a que a restrição tem mesmo de acautelar:
    `imagem` é anulável, e em SQLite um `CHECK` sobre uma coluna NULL dá
    NULL — que não é falso, logo passa. Mas uma condição escrita sem o
    `IS NULL` explícito depende desse acaso; se alguém a reescrever com
    uma função que trate o NULL de outra maneira, "evento sem imagem"
    deixa de entrar. A segunda metade fixa que um nome normal passa.
    """
    sessao.add(
        novo_evento(
            titulo="Evento sem imagem de exemplo",
            imagem=None,
            inicio=INSTANTE_FALSO,
            publicado=True,
        )
    )
    sessao.add(
        novo_evento(
            titulo="Evento com cartaz de exemplo",
            imagem="cartaz-de-exemplo.webp",
            inicio=INSTANTE_FALSO,
            publicado=True,
        )
    )
    sessao.commit()

    quantos = sessao.execute(text("SELECT COUNT(*) FROM eventos")).scalar_one()
    assert quantos == 2


def test_insert_cru_sem_publicado_nasce_como_rascunho(sessao: Session) -> None:
    """`eventos.publicado` tem omissão **do lado da base de dados**: 0.

    Um `default=False` só do lado do Python não corre num `INSERT` em SQL
    cru, e é assim que o `importar_bd_antiga.py` da F2-08 escreve. Sem o
    `server_default`, esse script rebentava com
    `NOT NULL constraint failed: eventos.publicado`.

    E a omissão tem de ser 0, não 1: os eventos do site antigo entram como
    **rascunho** (ADR 0009). Uma omissão trocada publicava-os todos no site
    no momento da importação.
    """
    sessao.execute(text("INSERT INTO eventos (titulo) VALUES ('Importado de exemplo')"))
    sessao.commit()

    linha = sessao.execute(text("SELECT publicado, inicio FROM eventos")).one()

    assert linha.publicado == 0
    assert linha.inicio is None
