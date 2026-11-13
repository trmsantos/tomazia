"""O CSV de clientes não deixa um campo partir colunas nem linhas (F2-05c).

O separador é `;` e as linhas acabam em `\\r\\n`. Um nome como
`Ana; "A Boa"\\nSilva` escrito à mão (`";".join(...)`) acrescentava uma
coluna e uma linha à folha do dono, e permitia a um inscrito **empurrar** o
seu telemóvel para a coluna de outro campo, ou fabricar uma linha falsa de
outro cliente. O módulo `csv` põe aspas e duplica as aspas internas; estes
testes leem o ficheiro de volta e contam colunas e linhas.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.apoio_gestao import (
    CABECALHO_DO_CSV,
    linhas_do_csv,
    semear_cliente_com,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

HOSTIS = [
    "Ana;Silva",
    'Ana "A Boa" Silva',
    'Ana"; "x',
    "Ana\nSilva",
    "Ana\r\nSilva",
    "Ana\rSilva",
    'a;b"c"\nd;e\r\nf',
    ";;;;;",
    '"""',
    "linha1\n2;falsa@exemplo.test;912;x;1;y",
]


@pytest.mark.parametrize("valor", HOSTIS, ids=[repr(v)[:30] for v in HOSTIS])
def test_o_valor_fica_numa_so_celula_e_o_ficheiro_numa_so_linha_por_cliente(
    sessao_de_admin: TestClient, sessao: Session, valor: str
) -> None:
    semear_cliente_com(sessao, 1, nome=valor, telemovel=valor)
    semear_cliente_com(sessao, 2, nome="Outro Cliente")
    resposta = sessao_de_admin.get("/gestao/clientes.csv")
    assert resposta.status_code == 200, resposta.text
    linhas = linhas_do_csv(resposta)

    assert len(linhas) == 3, f"cabeçalho + 2 clientes, vieram {len(linhas)}: {linhas}"
    assert linhas[0] == CABECALHO_DO_CSV
    assert all(len(linha) == len(CABECALHO_DO_CSV) for linha in linhas), linhas
    por_nome = {linha[0]: linha for linha in linhas[1:]}
    assert set(por_nome) == {valor, "Outro Cliente"}
    assert por_nome[valor][2] == valor
    assert por_nome[valor][1] == "cliente1@exemplo.test"
    assert por_nome["Outro Cliente"][1] == "cliente2@exemplo.test"


def test_o_email_com_separador_tambem_nao_parte_a_linha(
    sessao_de_admin: TestClient, sessao: Session
) -> None:
    semear_cliente_com(sessao, 1, email='a;b"c@exemplo.test')
    linhas = linhas_do_csv(sessao_de_admin.get("/gestao/clientes.csv"))
    assert len(linhas) == 2
    assert linhas[1][1] == 'a;b"c@exemplo.test'
    assert len(linhas[1]) == len(CABECALHO_DO_CSV)


def test_as_linhas_acabam_em_crlf_e_o_separador_e_ponto_e_virgula(
    sessao_de_admin: TestClient, sessao: Session
) -> None:
    semear_cliente_com(sessao, 1)
    corpo = sessao_de_admin.get("/gestao/clientes.csv").content.decode("utf-8-sig")
    assert corpo.endswith("\r\n")
    primeira = corpo.split("\r\n", 1)[0]
    assert primeira == ";".join(CABECALHO_DO_CSV)
    assert not corpo.startswith("sep=")
