"""C2: `app.services.fotos.aprovar` distingue "não havia ficheiro" de "não consegui movê-lo".

Medido (achado de revisão da F2-06): uma primeira versão usava
`origem.exists()` para decidir se havia um ficheiro para mover.
`Path.exists()` devolve `False` tanto para "não está lá" como para "não
consegui procurar" (um `OSError` de permissões, por exemplo) — exatamente
a regra 10 do `CLAUDE.md`. Em produção, aprovar uma foto cujos bytes não
puderam ser movidos por uma falha real (permissões, disco cheio) tratava
isso como "não havia nada para mover", respondia `200`, marcava `aprovada`
e a galeria passava a listar uma imagem partida, em silêncio.

A correção distingue pelo tipo da exceção: só `FileNotFoundError` conta
como "não havia nada para mover"; qualquer outro `OSError` sobe.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_um_oserror_que_nao_e_filenotfound_sobe_em_vez_de_ser_engolido(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient, sessao: Session
) -> None:
    from app.models.fotos import EstadoFoto, Foto
    from app.services import fotos as servico

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text
    linha = sessao.scalars(select(Foto)).one()
    id_foto = linha.id

    def replace_com_falha(
        origem: object, destino: object, *args: object, **kwargs: object
    ) -> None:
        raise PermissionError("simulado: sem permissões para mover o ficheiro")

    # `servico.os` é o módulo `os` verdadeiro (o mesmo objeto); o
    # `monkeypatch` desfaz isto sozinho no fim do teste.
    monkeypatch.setattr(servico.os, "replace", replace_com_falha)

    with pytest.raises(PermissionError):
        servico.aprovar(sessao, id_foto)

    sessao.expire_all()
    linha_depois = sessao.get(Foto, id_foto)
    assert linha_depois is not None
    assert linha_depois.estado == EstadoFoto.PENDENTE, (
        "um `OSError` real na tentativa de mover o ficheiro não pode deixar "
        "a foto marcada como aprovada"
    )


def test_filenotfound_continua_a_tratar_se_como_nao_havia_nada_para_mover(
    cliente: TestClient, sessao: Session
) -> None:
    """Controlo: o caso real (um envio genuíno) continua a aprovar normalmente."""
    from app.models.fotos import EstadoFoto, Foto

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text
    linha = sessao.scalars(select(Foto)).one()

    from app.services import fotos as servico

    aprovada = servico.aprovar(sessao, linha.id)
    assert aprovada.estado == EstadoFoto.APROVADA
