"""As definições do bar na gestão (ADR 0011).

`definicoes` é uma tabela chave/valor. Aqui só se lêem e escrevem as sete
chaves do contrato; qualquer outra linha fica como está e nunca sai.

- **Texto vazio** vai como `""` (é assim que a BD diz "não há"); o `/info`
  público dá-lhe `null`.
- **`horario_estado`** distingue na gestão o que o `/info` junta em `null`:
  chave ausente (ou vazia) = `nao_configurado`; existe mas não valida =
  `invalido` (e 200, nunca 500, inclusive `"[" * 20000`, que no `json` dá
  `RecursionError`); senão `configurado`.
- **`PUT` numa só transação:** ou muda tudo ou nada. `horario: null` apaga a
  chave.
"""

from __future__ import annotations

import json

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.definicoes import Definicao
from app.schemas.gestao import DefinicoesGestao, EstadoDoHorario, PedidoDefinicoes
from app.schemas.publico import interpretar_horario

CHAVES_DE_TEXTO = (
    "wifi_rede",
    "wifi_password",
    "morada",
    "telefone",
    "instagram",
    "maps_url",
)
CHAVE_HORARIO = "horario"


def obter_definicoes(sessao: Session) -> DefinicoesGestao:
    linhas = sessao.execute(
        select(Definicao.chave, Definicao.valor).where(
            Definicao.chave.in_((*CHAVES_DE_TEXTO, CHAVE_HORARIO))
        )
    ).all()
    valores = {linha.chave: linha.valor for linha in linhas}

    bruto = valores.get(CHAVE_HORARIO)
    horario = None
    estado: EstadoDoHorario
    if bruto is None or not bruto.strip():
        estado = "nao_configurado"
    else:
        try:
            horario = interpretar_horario(bruto)
            estado = "configurado"
        except (ValueError, RecursionError):
            estado = "invalido"

    return DefinicoesGestao(
        wifi_rede=valores.get("wifi_rede", ""),
        wifi_password=valores.get("wifi_password", ""),
        morada=valores.get("morada", ""),
        telefone=valores.get("telefone", ""),
        instagram=valores.get("instagram", ""),
        maps_url=valores.get("maps_url", ""),
        horario=horario,
        horario_estado=estado,
    )


def substituir_definicoes(
    sessao: Session, pedido: PedidoDefinicoes
) -> DefinicoesGestao:
    for chave in CHAVES_DE_TEXTO:
        sessao.merge(Definicao(chave=chave, valor=getattr(pedido, chave)))
    if pedido.horario is None:
        sessao.execute(delete(Definicao).where(Definicao.chave == CHAVE_HORARIO))
    else:
        sessao.merge(
            Definicao(
                chave=CHAVE_HORARIO,
                valor=json.dumps([d.model_dump() for d in pedido.horario]),
            )
        )
    sessao.commit()
    return obter_definicoes(sessao)
