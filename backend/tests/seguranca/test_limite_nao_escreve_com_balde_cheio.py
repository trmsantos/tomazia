"""B: com o balde já cheio, `POST /fotos` responde `429` sem gravar nada.

Medido (achado de revisão da F2-06, consequência da correção anterior):
antes desta correção, `app.routers.fotos._exigir_limite_de_envios` gravava
a tentativa (`INSERT` + `commit`, um `fsync` do WAL) **sempre**, mesmo
quando o balde já estava provadamente cheio. 20 pedidos do mesmo IP davam
`[202×5, 429×15]` e **20 linhas** em `tentativas_de_envio` — um `INSERT`
permanente por pedido recusado, numa rota pública sem autenticação, sem
rota nem script que alguma vez as apague. Um corpo de 10 bytes compra uma
escrita durável.

A correção acrescenta uma contagem barata **antes** de gravar: se o balde
já tem `LIMITE_POR_HORA` tentativas na janela (sem contar a tentativa
atual), `429` sem `INSERT` nenhum. O `INSERT` + recontagem continua a ser
o caminho autoritativo que fecha a corrida de pedidos verdadeiramente
simultâneos (ver `test_limite_de_envios_por_ip.py` e o docstring de
`_exigir_limite_de_envios`) — esta correção só poupa as escritas de uma
**sequência** de pedidos contra um balde já fechado, não muda o resultado
de nenhum deles.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import func, select

from tests import apoio_fotos

if TYPE_CHECKING:
    import pytest
    from sqlalchemy.orm import Session

INSTANTE_BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)


def _contar_tentativas(sessao: Session) -> int:
    from app.models.limites import TentativaDeEnvio

    return sessao.execute(
        select(func.count()).select_from(TentativaDeEnvio)
    ).scalar_one()


def test_vinte_pedidos_contra_balde_cheio_gravam_no_maximo_cinco_tentativas(
    monkeypatch: pytest.MonkeyPatch, sessao: Session
) -> None:
    apoio_fotos.fixar_relogio_fotos(monkeypatch, INSTANTE_BASE)
    cliente = apoio_fotos.cliente_com_ip("203.0.113.80")

    codigos = []
    for _ in range(20):
        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
        codigos.append(resposta.status_code)

    assert codigos == [202] * 5 + [429] * 15, codigos

    tentativas = _contar_tentativas(sessao)
    assert tentativas == 5, (
        f"20 pedidos sequenciais contra um balde que fecha ao 5º só podiam "
        f"gravar 5 tentativas — gravaram {tentativas}. As escritas contra "
        "um balde já provadamente cheio não podem crescer uma por pedido"
    )
