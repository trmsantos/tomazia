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


#: Fixado em `app/models/clientes.py::TAMANHO_MINIMO_TOKEN_CANCELAR`.
#: Repetido aqui de propósito, em vez de importado: um teste que leia a
#: constante do código que testa concorda sempre com ele, inclusive quando
#: alguém a baixa para 1.
TAMANHO_MINIMO_TOKEN = 32

RESTRICAO_TOKEN = "ck_clientes_token_cancelar_tamanho_minimo"


@pytest.mark.parametrize(
    "token",
    [
        "",
        "curto",
        "a" * (TAMANHO_MINIMO_TOKEN - 1),
    ],
    ids=["vazio", "curto", "um-caractere-a-menos"],
)
def test_token_cancelar_curto_de_mais_e_rejeitado(sessao: Session, token: str) -> None:
    """O token é uma credencial: quem o tiver cancela sem sessão nenhuma.

    Sem o mínimo, o esquema aceitava a string vazia — e uma linha assim
    deixava qualquer pedido com token vazio cancelar aquela subscrição. O
    caso de um caractere a menos é o que distingue "há um mínimo" de "há um
    mínimo no sítio certo".
    """
    sessao.add(novo_cliente(token_cancelar=token))
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert RESTRICAO_TOKEN in str(informacao.value), (
        f"o token {token!r} ({len(token)} caracteres) foi recusado, mas "
        f"não por {RESTRICAO_TOKEN}:\n{informacao.value}"
    )


def test_token_cancelar_com_o_tamanho_minimo_e_aceite(sessao: Session) -> None:
    """O guarda de cima testado contra o seu próprio sucesso falso.

    Um `>` em vez de `>=`, ou um mínimo maior do que o que a F2-07 gera,
    deixava os testes acima verdes e tornava impossível inscrever alguém.
    Exatamente no limite, e um acima.
    """
    sessao.add(
        novo_cliente(
            email="no-limite@exemplo.test",
            token_cancelar="a" * TAMANHO_MINIMO_TOKEN,
        )
    )
    sessao.add(
        novo_cliente(
            email="acima-do-limite@exemplo.test",
            token_cancelar="b" * (TAMANHO_MINIMO_TOKEN + 1),
        )
    )
    sessao.commit()

    quantos = sessao.execute(text("SELECT COUNT(*) FROM clientes")).scalar_one()
    assert quantos == 2
