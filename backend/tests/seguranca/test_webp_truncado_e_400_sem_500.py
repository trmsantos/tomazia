"""D: um WebP cortado a meio é `400`, nunca `500` em inglês fora do envelope.

Medido (achado de revisão da F2-06): `Image.open()` sobre um WebP cortado
levanta `OSError: could not create decoder object` — não
`UnidentifiedImageError`, e o Pillow não converte um no outro. O `try` à
volta de `Image.open()` em `app/services/imagens.py::recodificar` só
apanhava `UnidentifiedImageError` e `Image.DecompressionBombError`; um
`OSError` genérico subia por `app.services.fotos` e por
`app.routers.fotos` sem tratador nenhum, e a rota (pública) respondia
`500 Internal Server Error` em `text/plain`, fora do envelope
`{"erro", "mensagem"}`, com traceback no log a cada pedido.

Reproduzido a 50%, 80% e 95% do ficheiro — os três têm de dar 400.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def _webp_truncado(fracao: float) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (200, 200), (10, 20, 30)).save(buffer, format="WEBP")
    completo = buffer.getvalue()
    return completo[: int(len(completo) * fracao)]


def test_a_fracao_cortada_e_mesmo_mais_curta_que_o_ficheiro_completo() -> None:
    """O guarda deste próprio ficheiro."""
    buffer = io.BytesIO()
    Image.new("RGB", (200, 200), (10, 20, 30)).save(buffer, format="WEBP")
    completo = len(buffer.getvalue())
    for fracao in (0.5, 0.8, 0.95):
        assert len(_webp_truncado(fracao)) < completo


class TestWebpTruncado:
    def test_50_por_cento_e_400_sem_nada_escrito(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        resposta = apoio_fotos.enviar_foto(
            cliente,
            _webp_truncado(0.5),
            nome_ficheiro="cortado.webp",
            tipo_mime="image/webp",
        )
        assert resposta.status_code == 400, resposta.text
        assert resposta.json()["erro"] == "imagem_invalida"
        apoio_fotos.exigir_nada_escrito(sessao)

    def test_80_por_cento_e_400_sem_nada_escrito(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        resposta = apoio_fotos.enviar_foto(
            cliente,
            _webp_truncado(0.8),
            nome_ficheiro="cortado.webp",
            tipo_mime="image/webp",
        )
        assert resposta.status_code == 400, resposta.text
        assert resposta.json()["erro"] == "imagem_invalida"
        apoio_fotos.exigir_nada_escrito(sessao)

    def test_95_por_cento_e_400_sem_nada_escrito(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        resposta = apoio_fotos.enviar_foto(
            cliente,
            _webp_truncado(0.95),
            nome_ficheiro="cortado.webp",
            tipo_mime="image/webp",
        )
        assert resposta.status_code == 400, resposta.text
        assert resposta.json()["erro"] == "imagem_invalida"
        apoio_fotos.exigir_nada_escrito(sessao)
