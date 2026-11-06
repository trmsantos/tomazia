"""E4: o `thumbnail()` reduz o lado maior a 2000 px — sem teste até aqui.

Medido em revisão: apagar o `imagem.thumbnail((LADO_MAIOR_MAXIMO,
LADO_MAIOR_MAXIMO))` de `app.services.imagens.recodificar` não faz falhar
nada. É o teto do lado do servidor para quem não usa o nosso frontend (que
já reduz para 2000 px antes de enviar, `docs/ESPECIFICACAO.md`).
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

LADO_MAIOR_MAXIMO = 2000

#: Abaixo do limite de píxeis (30 MP: 2400×2400 = 5,76 MP), mas acima do
#: lado máximo de 2000 px — o cenário que só o `thumbnail()` cobre.
LARGURA = 2400
ALTURA = 1200


def _jpeg_grande() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (LARGURA, ALTURA), (10, 20, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_a_origem_e_mesmo_maior_que_o_teto() -> None:
    assert LARGURA > LADO_MAIOR_MAXIMO


def test_o_ficheiro_guardado_tem_o_lado_maior_reduzido(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente, _jpeg_grande(), nome_ficheiro="grande.jpg", tipo_mime="image/jpeg"
    )
    assert resposta.status_code == 202, resposta.text

    from app.config import obter_definicoes

    pendentes = list(obter_definicoes().pendentes_dir.iterdir())
    assert len(pendentes) == 1

    with Image.open(pendentes[0]) as guardada:
        largura, altura = guardada.size

    assert max(largura, altura) <= LADO_MAIOR_MAXIMO, (
        f"a imagem guardada tem {guardada.size}, o lado maior devia estar "
        f"reduzido a {LADO_MAIOR_MAXIMO} px"
    )
    # A proporção mantém-se (2:1): nem tudo encolhido para um quadrado.
    assert largura > altura
