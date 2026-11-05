"""E3: `convert("RGB")` antes do `frombytes` — sem teste até aqui, e carga a sério.

Medido em revisão: apagar o `convert("RGB")` de
`app.services.imagens.recodificar` não faz falhar teste nenhum — e um PNG
em paleta (o que sai de muitos screenshots e logótipos) chega ao disco
**todo preto**, com `202` e nada a queixar-se. O `frombytes` sobre uma
imagem `P` sem paleta anexada (a paleta não viaja em `tobytes()`) produz
índices sem cor nenhuma atrás — o WebP de saída fica negro.

Medido à parte (não neste ficheiro, em Python puro): sem `convert`, o
pixel que devia sair `(200, 0, 55)` sai `(0, 0, 0)`.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: Um tom claramente não preto, para a asserção distinguir "convertido
#: corretamente" (perto deste tom) de "ficou tudo a zeros" (preto).
COR_DA_PALETA = (200, 0, 55)


def _png_em_paleta() -> bytes:
    imagem = Image.new("P", (40, 30))
    paleta = []
    for indice in range(256):
        paleta.extend((indice, 0, 255 - indice))
    imagem.putpalette(paleta)
    imagem.paste(COR_DA_PALETA[0], (0, 0, 40, 30))
    buffer = io.BytesIO()
    imagem.save(buffer, format="PNG")
    return buffer.getvalue()


def test_a_origem_e_mesmo_em_paleta() -> None:
    """O guarda deste próprio ficheiro."""
    with Image.open(io.BytesIO(_png_em_paleta())) as imagem:
        assert imagem.mode == "P"


def test_o_ficheiro_guardado_nao_fica_todo_preto(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente, _png_em_paleta(), nome_ficheiro="paleta.png", tipo_mime="image/png"
    )
    assert resposta.status_code == 202, resposta.text

    from app.config import obter_definicoes

    pendentes = list(obter_definicoes().pendentes_dir.iterdir())
    assert len(pendentes) == 1

    with Image.open(pendentes[0]) as guardada:
        guardada = guardada.convert("RGB")
        pixel = guardada.getpixel((0, 0))

    assert pixel != (0, 0, 0), (
        f"o pixel guardado é {pixel} — ficou preto, sinal de que a "
        "paleta não foi convertida antes de os píxeis nus serem extraídos"
    )
    # Tolerância generosa: é WebP com perdas (quality=82), não um
    # resultado byte a byte.
    distancia = sum(abs(a - b) for a, b in zip(pixel, COR_DA_PALETA, strict=True))
    assert distancia < 30, (
        f"o pixel guardado é {pixel}, esperava algo perto de {COR_DA_PALETA}"
    )
