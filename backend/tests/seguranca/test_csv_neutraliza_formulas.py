"""O CSV de clientes neutraliza fórmulas (CSV injection, F2-05c).

O Excel (e o LibreOffice) executam como fórmula uma célula que comece por
`=`, `+`, `-` ou `@`, e tratam uma tabulação ou uma quebra de linha à frente
como o início de outra. O nome, o email e o telemóvel vêm de um formulário
**público**: quem se inscrever com `=HYPERLINK("http://...", "Clica")` põe
uma ligação ou um comando na folha do dono quando ele a abrir.

Regra (decisão registada no plano, e igual em **todas** as colunas de texto,
incluindo o telemóvel `+351...`): se o primeiro carácter da célula for `\t`,
`\r` ou `\n`, ou se o primeiro carácter a seguir aos espaços da frente for
`=`, `+`, `-` ou `@`, a célula ganha um `'` à frente. O resto fica como veio.
Os testes leem o ficheiro de volta com o módulo `csv`, que é o que um leitor
de folhas de cálculo faz.

A API JSON (`GET /gestao/clientes`) **não** muda: devolve o valor original.
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

PERIGOSOS = [
    '=HYPERLINK("http://evil.example.test","Clica")',
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(A1:A9)",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
    "  =1+1",
    " +cmd",
    " @x",
    "\t-x",
    "=cmd|' /C calc'!A0",
    # Espaço em branco de qualquer tipo à frente, não só o ASCII.
    " \t=1",
    " =1",
    "\u3000=1",  # espaço ideográfico
    "\u00a0=1",  # espaço de não quebra
    "\ufeff=1",  # BOM
    "\ufeff +1",
    "\u2003@x",
    "  Ana",  # qualquer espaço à frente neutraliza, mesmo sem fórmula
]

#: As colunas de texto que um cliente pode escrever, com o índice no CSV.
COLUNAS = [("nome", 0), ("email", 1), ("telemovel", 2), ("versao_termos", 4)]

SEGUROS = [
    "João Ç",
    "912345678",
    "ana@exemplo.test",
    "Maria-José",
    "a=b",
    "x+y",
    "1-2",
    "a@b",
]


def _ler(cliente: TestClient) -> list[list[str]]:
    resposta = cliente.get("/gestao/clientes.csv")
    assert resposta.status_code == 200, resposta.text
    return linhas_do_csv(resposta)


@pytest.mark.parametrize("coluna,indice", COLUNAS, ids=[c for c, _ in COLUNAS])
@pytest.mark.parametrize("valor", PERIGOSOS, ids=[repr(v)[:30] for v in PERIGOSOS])
def test_a_celula_perigosa_ganha_um_apostrofo_e_o_resto_fica_igual(
    sessao_de_admin: TestClient,
    sessao: Session,
    coluna: str,
    indice: int,
    valor: str,
) -> None:
    semear_cliente_com(sessao, 1, **{coluna: valor})
    linhas = _ler(sessao_de_admin)
    assert linhas[0] == CABECALHO_DO_CSV
    assert len(linhas) == 2, linhas
    assert linhas[1][indice] == "'" + valor
    # Nenhuma outra célula de texto foi tocada.
    for outra, i in COLUNAS:
        if outra != coluna:
            esperado = {
                "nome": "Cliente 1",
                "email": "cliente1@exemplo.test",
                "telemovel": "912345678",
                "versao_termos": "1",
            }[outra]
            assert linhas[1][i] == esperado


def test_o_telemovel_com_mais_351_tambem_ganha_o_apostrofo(
    sessao_de_admin: TestClient, sessao: Session
) -> None:
    """Decisão registada: nenhuma exceção para `+351...`."""
    semear_cliente_com(sessao, 1, telemovel="+351912345678")
    assert _ler(sessao_de_admin)[1][2] == "'+351912345678"


@pytest.mark.parametrize("valor", SEGUROS, ids=[repr(v) for v in SEGUROS])
def test_o_que_nao_e_perigoso_sai_intacto(
    sessao_de_admin: TestClient, sessao: Session, valor: str
) -> None:
    """Controlo: um `'` a mais em todo o lado também seria uma falha."""
    semear_cliente_com(sessao, 1, nome=valor, telemovel=valor)
    linhas = _ler(sessao_de_admin)
    assert linhas[1][0] == valor
    assert linhas[1][2] == valor


def test_sem_telemovel_a_celula_fica_vazia_e_nao_um_apostrofo(
    sessao_de_admin: TestClient, sessao: Session
) -> None:
    semear_cliente_com(sessao, 1, telemovel=None)
    assert _ler(sessao_de_admin)[1][2] == ""


def test_as_datas_geradas_nunca_ganham_apostrofo(
    sessao_de_admin: TestClient, sessao: Session
) -> None:
    semear_cliente_com(sessao, 1)
    linha = _ler(sessao_de_admin)[1]
    assert not linha[3].startswith("'")
    assert not linha[5].startswith("'")


def test_a_api_json_devolve_o_valor_original_sem_apostrofo(
    sessao_de_admin: TestClient, sessao: Session
) -> None:
    semear_cliente_com(sessao, 1, nome="=1+1", telemovel="+351912345678")
    resposta = sessao_de_admin.get("/gestao/clientes")
    assert resposta.status_code == 200, resposta.text
    (cliente,) = resposta.json()["clientes"]
    assert cliente["nome"] == "=1+1"
    assert cliente["telemovel"] == "+351912345678"
