"""Admins e definições (F2-01).

`admins.utilizador` é único porque é por ele que o `POST /auth/login` da
F2-04 procura a conta, e porque é nele que o bloqueio após 5 falhas se
guarda: duas linhas com o mesmo utilizador davam ao atacante duas contas
para gastar tentativas, e ao `criar_admin.py` da F2-02 uma forma silenciosa
de criar uma segunda conta com a mesma identidade.

`definicoes` é uma tabela chave/valor com a chave como chave primária. As
sete chaves da especificação (`wifi_rede`, `wifi_password`, `horario`,
`morada`, `telefone`, `instagram`, `maps_url`) são dados, não colunas: é o
que permite ao F4-05 mudar o WiFi e aparecer no site público sem deploy.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.modelos.apoio import nova_definicao, novo_admin

CHAVES_DE_DEFINICOES = (
    "wifi_rede",
    "wifi_password",
    "horario",
    "morada",
    "telefone",
    "instagram",
    "maps_url",
)


def test_utilizador_duplicado_e_rejeitado(sessao: Session) -> None:
    sessao.add(novo_admin(utilizador="dono-de-exemplo"))
    sessao.commit()

    sessao.add(
        novo_admin(
            utilizador="dono-de-exemplo",
            hash_password="$argon2id$outro$falso$para$testes",
        )
    )
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "utilizador" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a do utilizador:\n{informacao.value}"
    )


def test_admin_nasce_sem_tentativas_falhadas_e_sem_bloqueio(sessao: Session) -> None:
    """Uma conta acabada de criar não está bloqueada nem deve nada.

    Um `tentativas_falhadas` a NULL partiria o incremento do bloqueio da
    F2-04 (`NULL + 1` é NULL em SQL), e o dono ficava com uma conta que
    nunca bloqueia.
    """
    sessao.add(novo_admin())
    sessao.commit()

    linha = sessao.execute(
        text("SELECT tentativas_falhadas, bloqueado_ate FROM admins")
    ).one()

    assert linha.tentativas_falhadas == 0
    assert linha.bloqueado_ate is None


def test_chave_duplicada_em_definicoes_e_rejeitada(sessao: Session) -> None:
    """`definicoes.chave` é a chave primária: a mesma chave não entra duas vezes."""
    sessao.add(nova_definicao("wifi_rede", "Rede de exemplo"))
    sessao.commit()

    sessao.add(nova_definicao("wifi_rede", "Outra rede de exemplo"))
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "chave" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a da chave primária:\n{informacao.value}"
    )


def test_as_sete_chaves_da_especificacao_cabem(sessao: Session) -> None:
    """As sete chaves de `docs/ESPECIFICACAO.md` entram, incluindo o horário em JSON.

    O `horario` é um JSON por dia guardado como texto: o teste escreve-o
    para prender que `valor` aguenta mais do que uma linha curta.
    """
    horario = (
        '{"segunda": null, "terca": [["12:00", "15:00"], ["19:00", "23:00"]], '
        '"quarta": [["12:00", "15:00"]], "quinta": [["12:00", "15:00"]], '
        '"sexta": [["12:00", "02:00"]], "sabado": [["12:00", "02:00"]], '
        '"domingo": [["12:00", "15:00"]]}'
    )
    valores = {
        "wifi_rede": "Rede de exemplo",
        "wifi_password": "password-de-exemplo",
        "horario": horario,
        "morada": "Rua de Exemplo, 1, Estarreja",
        "telefone": "912345678",
        "instagram": "exemplo_de_conta",
        "maps_url": "https://exemplo.test/mapa",
    }

    for chave in CHAVES_DE_DEFINICOES:
        sessao.add(nova_definicao(chave, valores[chave]))
    sessao.commit()

    guardadas = {
        linha.chave: linha.valor
        for linha in sessao.execute(text("SELECT chave, valor FROM definicoes"))
    }

    assert set(guardadas) == set(CHAVES_DE_DEFINICOES)
    assert guardadas["horario"] == horario


def test_insert_cru_sem_tentativas_falhadas_comeca_a_zero(sessao: Session) -> None:
    """`admins.tentativas_falhadas` tem omissão 0 **na base de dados**.

    O `criar_admin.py` da F2-02 pode escrever por SQL cru, onde o
    `default=0` do lado do Python não corre. Sem `server_default`, o script
    rebentava — e, se a coluna fosse anulável para contornar isso, a conta
    nascia com NULL e nunca bloqueava: em SQL, `NULL + 1` é NULL, e a conta
    nunca chegava às 5 falhas.

    `criado_em` é passado à mão porque **não** tem `server_default` (só
    `default=agora_utc`, do lado do Python). O valor vai já em UTC e sem
    fuso, que é a forma como `DataHoraUTC` escreve.
    """
    sessao.execute(
        text(
            "INSERT INTO admins (utilizador, hash_password, criado_em) VALUES "
            "('criado-por-script-de-exemplo', '$argon2id$falso$para$testes', "
            "'2026-06-20 11:00:00')"
        )
    )
    sessao.commit()

    linha = sessao.execute(
        text("SELECT tentativas_falhadas, bloqueado_ate FROM admins")
    ).one()

    assert linha.tentativas_falhadas == 0
    assert linha.bloqueado_ate is None
