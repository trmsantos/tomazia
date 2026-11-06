"""C1: a orientação EXIF é aplicada aos píxeis, não só deitada fora.

Medido (achado de revisão da F2-06): um JPEG com `Orientation=6` — o caso
**normal** de uma foto tirada com o telemóvel na vertical — saía com as
dimensões originais e sem a etiqueta, ou seja **deitado**: o
`Image.frombytes` que esvazia o EXIF (S-02, EXIF removido) apagava a
etiqueta sem aplicar a rotação que ela descrevia. A galeria do bar
encher-se-ia de fotos de lado.

A correção é `ImageOps.exif_transpose(imagem)`, logo a seguir ao
`Image.load()` e antes do `convert("RGB")`/`frombytes` — ver
`app/services/imagens.py`.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: A etiqueta EXIF `Orientation`.
ID_ORIENTATION = 0x0112

#: `6` = "rodar 90° no sentido horário para mostrar corretamente" — o caso
#: de uma câmara segurada na vertical, lida pelo sensor na horizontal.
ORIENTACAO_90_GRAUS = 6


def _jpeg_deitado_com_orientacao(
    largura: int = 60, altura: int = 20, orientacao: int = ORIENTACAO_90_GRAUS
) -> bytes:
    """Um JPEG `largura`×`altura` tal como o sensor o gravou, com `Orientation` no EXIF."""
    origem = Image.new("RGB", (largura, altura), (10, 20, 30))
    exif = Image.Exif()
    exif[ID_ORIENTATION] = orientacao
    buffer = io.BytesIO()
    origem.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def test_a_origem_tem_mesmo_a_etiqueta_de_orientacao() -> None:
    """O guarda deste próprio ficheiro: sem a etiqueta na origem, nada abaixo provaria nada."""
    origem = _jpeg_deitado_com_orientacao()
    with Image.open(io.BytesIO(origem)) as imagem:
        assert imagem.size == (60, 20), (
            "a origem tem de nascer deitada, como a câmara a viu"
        )
        assert imagem.getexif().get(ID_ORIENTATION) == ORIENTACAO_90_GRAUS


def test_o_ficheiro_guardado_sai_com_a_rotacao_aplicada(
    cliente: TestClient, sessao: Session
) -> None:
    """60×20 com `Orientation=6` tem de sair 20×60 — rodado, não deitado."""
    resposta = apoio_fotos.enviar_foto(
        cliente,
        _jpeg_deitado_com_orientacao(),
        nome_ficheiro="vertical.jpg",
        tipo_mime="image/jpeg",
    )
    assert resposta.status_code == 202, resposta.text

    from app.config import obter_definicoes

    pendentes = list(obter_definicoes().pendentes_dir.iterdir())
    assert len(pendentes) == 1, (
        f"esperava um ficheiro em pendentes/, encontrei {pendentes}"
    )

    with Image.open(pendentes[0]) as guardada:
        assert guardada.size == (20, 60), (
            f"a imagem guardada tem {guardada.size}, esperava (20, 60) — a "
            "rotação da etiqueta EXIF não foi aplicada aos píxeis"
        )
        # A etiqueta em si continua ausente (S-02/EXIF removido): a prova
        # aqui é sobre os píxeis, não sobre a sobrevivência do metadado.
        assert ID_ORIENTATION not in dict(guardada.getexif())
