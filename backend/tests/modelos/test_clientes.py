"""Clientes das novidades: email e token de cancelamento únicos (F2-01).

Os dois índices únicos não são arrumação. O `email` é a chave por onde a
F2-07 decide se um pedido de subscrição é novo ou repetido; sem ele, a
mesma pessoa fica com duas linhas e um "cancelar" só apaga uma. O
`token_cancelar` é o que autoriza o `POST /novidades/cancelar` sem sessão
nenhuma: dois clientes com o mesmo token davam a um deles o poder de
cancelar a subscrição do outro.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.modelos.apoio import EMAIL_FALSO, TOKEN_CANCELAR_FALSO, novo_cliente


def test_email_duplicado_e_rejeitado(sessao: Session) -> None:
    sessao.add(novo_cliente())
    sessao.commit()

    sessao.add(
        novo_cliente(
            nome="Outro Cliente de Exemplo",
            token_cancelar="token-falso-de-cancelamento-0002",
        )
    )
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "email" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a do email:\n{informacao.value}"
    )


def test_token_cancelar_duplicado_e_rejeitado(sessao: Session) -> None:
    """Dois tokens iguais dariam a um cliente o poder de cancelar o do outro."""
    sessao.add(novo_cliente())
    sessao.commit()

    sessao.add(
        novo_cliente(
            nome="Outro Cliente de Exemplo",
            email="outro@exemplo.test",
            token_cancelar=TOKEN_CANCELAR_FALSO,
        )
    )
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "token_cancelar" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a do token:\n{informacao.value}"
    )


def test_dois_clientes_diferentes_convivem(sessao: Session) -> None:
    """O guarda testado contra o seu próprio sucesso falso.

    Uma unicidade posta no `nome` (ou uma restrição de mais) deixaria os
    dois testes de cima verdes e tornaria impossível ter dois homónimos
    inscritos nas novidades.
    """
    sessao.add(novo_cliente(nome="Cliente de Exemplo"))
    sessao.add(
        novo_cliente(
            nome="Cliente de Exemplo",
            email="outro@exemplo.test",
            token_cancelar="token-falso-de-cancelamento-0002",
        )
    )
    sessao.commit()

    quantos = sessao.execute(text("SELECT COUNT(*) FROM clientes")).scalar_one()
    assert quantos == 2


def test_telemovel_e_opcional(sessao: Session) -> None:
    """A especificação marca `telemovel` como opcional: quem não o dá inscreve-se na mesma."""
    sessao.add(novo_cliente(telemovel=None))
    sessao.commit()

    guardado = sessao.execute(
        text("SELECT telemovel FROM clientes WHERE email = :email"),
        {"email": EMAIL_FALSO},
    ).scalar_one()
    assert guardado is None
