"""Os clientes inscritos nas novidades: lista, CSV e eliminação.

O `token_cancelar` é uma credencial (quem o tem cancela a inscrição) e **nunca
sai**: as consultas escolhem as colunas, não a entidade.

O CSV abre bem no Excel em português: BOM + UTF-8, `;` como separador, `\\r\\n`
no fim de cada linha e **sem** a linha `sep=;` (com ela o Excel ignora a BOM e
estraga os acentos). Sem paginação: com algumas centenas de clientes é um
ficheiro de dezenas de KB; se algum dia passar das dezenas de milhares, passa
a streaming.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.erros import ErroDaApi
from app.models.clientes import Cliente
from app.models.tipos import agora_utc
from app.schemas.gestao import ClienteGestao, RespostaClientes
from app.services.sql import linhas_afetadas
from app.tempo import FUSO_DO_BAR

MENSAGEM_CLIENTE_INEXISTENTE = (
    "Este cliente já não existe. Recarrega a página e tenta novamente."
)
BOM = "\ufeff"
CABECALHO_DO_CSV = [
    "Nome",
    "Email",
    "Telemóvel",
    "Data do consentimento",
    "Versão dos termos",
    "Data de inscrição",
]

_COLUNAS = (
    Cliente.id,
    Cliente.nome,
    Cliente.email,
    Cliente.telemovel,
    Cliente.consentimento_em,
    Cliente.versao_termos,
    Cliente.criado_em,
)


def _clientes(sessao: Session) -> list[ClienteGestao]:
    linhas = sessao.execute(
        select(*_COLUNAS).order_by(Cliente.criado_em.desc(), Cliente.id.desc())
    ).all()
    return [
        ClienteGestao(
            id=linha.id,
            nome=linha.nome,
            email=linha.email,
            telemovel=linha.telemovel,
            consentimento_em=linha.consentimento_em,
            versao_termos=linha.versao_termos,
            criado_em=linha.criado_em,
        )
        for linha in linhas
    ]


def obter_clientes(sessao: Session) -> RespostaClientes:
    return RespostaClientes(clientes=_clientes(sessao))


def eliminar_cliente(sessao: Session, id_cliente: int) -> None:
    """Apaga **mesmo** (eliminação a pedido, RGPD): a linha não se marca."""
    apagados = linhas_afetadas(
        sessao.execute(delete(Cliente).where(Cliente.id == id_cliente))
    )
    if apagados == 0:
        sessao.rollback()
        raise ErroDaApi(404, "cliente_inexistente", MENSAGEM_CLIENTE_INEXISTENTE)
    sessao.commit()


def neutralizar_formula(valor: str) -> str:
    """Põe um `'` à frente de uma célula que o Excel leria como fórmula.

    O nome, o email e o telemóvel vêm de um formulário **público**. O Excel
    e o LibreOffice ignoram espaço à frente (o ASCII, a tabulação, o de não
    quebra, o ideográfico, a BOM...) antes de decidir se é uma fórmula, por
    isso a regra é: neutraliza-se se o primeiro carácter for espaço em branco
    de **qualquer** tipo (`str.isspace()`) ou a BOM, ou se for `=`, `+`, `-`
    ou `@`. Sem exceção para o telemóvel `+351...`.
    """
    if valor and (valor[0].isspace() or valor[0] in ("\ufeff", "=", "+", "-", "@")):
        return "'" + valor
    return valor


def _data(instante: datetime) -> str:
    return instante.astimezone(FUSO_DO_BAR).strftime("%d/%m/%Y %H:%M")


def gerar_csv(sessao: Session) -> tuple[bytes, str]:
    """`(corpo, nome do ficheiro)`; a data do nome é a de Lisboa de hoje."""
    saida = io.StringIO(newline="")
    escritor = csv.writer(saida, delimiter=";", lineterminator="\r\n")
    escritor.writerow(CABECALHO_DO_CSV)
    for cliente in _clientes(sessao):
        escritor.writerow(
            [
                neutralizar_formula(cliente.nome),
                neutralizar_formula(cliente.email),
                neutralizar_formula(cliente.telemovel or ""),
                _data(cliente.consentimento_em),
                neutralizar_formula(cliente.versao_termos),
                _data(cliente.criado_em),
            ]
        )
    hoje = agora_utc().astimezone(FUSO_DO_BAR).date().isoformat()
    return (BOM + saida.getvalue()).encode("utf-8"), f"clientes-{hoje}.csv"
