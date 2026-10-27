"""Datas: UTC na base de dados, `Europe/Lisbon` só na apresentação (F2-01).

`backend/CLAUDE.md` fixa a regra; `app/models/tipos.py::DataHoraUTC` é quem
a faz cumprir. Dois comportamentos, e os dois são precisos:

1. Um instante que chega com desvio é convertido para UTC **antes** de ser
   escrito, e relê-se em UTC. Sem a conversão, dois eventos criados à mesma
   hora em épocas diferentes do ano ordenam-se mal, e a secção "Esta
   semana" (F3-04) mostra eventos pela hora errada durante metade do ano.
2. Um `datetime` ingénuo (sem fuso) é **recusado**, não adivinhado. Adivinhar
   é o que parte: o mesmo valor guardado em janeiro e em julho fica com uma
   hora de diferença, sem nada no registo a dizer qual foi.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from tests.apoio_mensagens import contem_marca_pt_pt, texto_de_toda_a_cadeia
from tests.modelos.apoio import novo_evento

#: `+01:00` é o desvio de Lisboa no verão (WEST). Fixa-se como desvio
#: literal, não com `ZoneInfo("Europe/Lisbon")`, para o teste não depender
#: da base de dados de fusos do sistema onde corre.
DESVIO_DE_LISBOA_NO_VERAO = timezone(timedelta(hours=1))

MEIO_DIA_EM_LISBOA = datetime(2026, 6, 20, 12, 0, tzinfo=DESVIO_DE_LISBOA_NO_VERAO)


def test_instante_com_desvio_guarda_se_em_utc_e_rele_se_em_utc(
    sessao: Session,
) -> None:
    """`12:00+01:00` guarda `11:00` e relê-se como `11:00+00:00`."""
    evento = novo_evento(
        titulo="Noite de verão de exemplo",
        inicio=MEIO_DIA_EM_LISBOA,
        publicado=True,
    )
    sessao.add(evento)
    sessao.commit()

    # O que está mesmo escrito na coluna, sem o tipo da coluna pelo meio.
    guardado = str(sessao.execute(text("SELECT inicio FROM eventos")).scalar_one())
    assert "11:00" in guardado, (
        f"a coluna guardou {guardado!r}: devia ser o instante em UTC (11:00)"
    )
    assert "12:00" not in guardado, (
        f"a coluna guardou {guardado!r}: a hora local foi escrita tal e "
        "qual, sem conversão para UTC"
    )

    sessao.expire_all()
    from app.models.eventos import Evento

    lido = sessao.execute(select(Evento)).scalar_one()

    assert lido.inicio is not None
    assert lido.inicio.tzinfo is not None, (
        f"`inicio` releu-se sem fuso: {lido.inicio!r}"
    )
    assert lido.inicio.utcoffset() == timedelta(0), (
        f"`inicio` releu-se fora de UTC: {lido.inicio!r}"
    )
    assert lido.inicio.hour == 11
    # A ida e volta tem de preservar o instante, não só o formato.
    assert lido.inicio == MEIO_DIA_EM_LISBOA


def test_datetime_ingenuo_e_recusado_em_pt_pt(sessao: Session) -> None:
    """Sem fuso, a escrita é recusada — nunca adivinhada.

    O contrato que isto impõe ao implementador: a mensagem é nossa, em
    português de Portugal, e diz que falta o fuso horário (a palavra "fuso"
    tem de lá estar). Não serve o "can't compare offset-naive and
    offset-aware datetimes" do Python nem um `TypeError` seco do
    SQLAlchemy: a F2-05 vai precisar de a mostrar ao dono.
    """
    ingenuo = datetime(2026, 6, 20, 12, 0)

    erro: BaseException | None = None
    try:
        sessao.add(
            novo_evento(
                titulo="Evento ingénuo de exemplo", inicio=ingenuo, publicado=True
            )
        )
        sessao.commit()
    # O tipo exato depende de onde o SQLAlchemy embrulha o erro do
    # `TypeDecorator`; o contrato está nas asserções sobre a mensagem.
    except Exception as excecao:
        erro = excecao
    finally:
        sessao.rollback()

    assert erro is not None, (
        "um `datetime` sem fuso foi guardado à mesma. Guardar um instante "
        "sem saber a que fuso pertence é guardar uma hora errada metade do "
        "ano, sem nada no registo a dizer qual"
    )

    mensagem = texto_de_toda_a_cadeia(erro)
    assert "fuso" in mensagem.lower(), (
        f"a mensagem não diz que falta o fuso horário:\n{mensagem}"
    )
    assert contem_marca_pt_pt(mensagem), (
        f"a mensagem não é nossa nem está em PT-PT:\n{mensagem}"
    )


def test_instante_ja_em_utc_passa_sem_mexer(sessao: Session) -> None:
    """O guarda de cima testado contra o seu próprio sucesso falso.

    Um `DataHoraUTC` que recusasse tudo o que lhe chega deixava o teste
    anterior verde. Este fixa que só o `datetime` **sem fuso** é recusado.
    """
    from datetime import UTC

    instante = datetime(2026, 6, 20, 11, 0, tzinfo=UTC)
    sessao.add(
        novo_evento(titulo="Já em UTC de exemplo", inicio=instante, publicado=True)
    )
    sessao.commit()
    sessao.expire_all()

    from app.models.eventos import Evento

    lido = sessao.execute(select(Evento)).scalar_one()
    assert lido.inicio == instante
