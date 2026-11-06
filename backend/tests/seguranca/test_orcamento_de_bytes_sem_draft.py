"""A: orçamento de bytes para formatos sem `draft()` (PNG, WebP).

Decisão do Tomás, 6 de novembro de 2026: o limite de 30 MP (S-11) não
chega sozinho. Medido com a função de produção, para a mesma imagem de
5460×5460 (29,81 MP, abaixo do limite): JPEG (com `draft()`) custava
+25 MB reais; PNG (sem `draft()`) +72 MB; WebP (sem `draft()`, e o
descodificador do Pillow materializa a frame duas vezes) +269 MB — um só
pedido chega para matar um worker do Passenger no cPanel.

`ORCAMENTO_DE_BYTES_SEM_DRAFT` (`app/services/imagens.py`) recusa, antes
do `load()`, qualquer imagem cujo `draft()` não tenha encolhido e cujo
`largura × altura × len(mode)` ultrapasse o orçamento. O ganho principal é
de testabilidade: a defesa passa a ser prendível **por comportamento** (o
pedido é recusado) em vez de por medição de memória — que é precisamente o
que `tracemalloc` não consegue fazer para os bitmaps do Pillow (ver
`tests/seguranca/test_pico_de_memoria_de_foto_legitima.py`).

O JPEG do mesmo tamanho tem de continuar aceite — senão este teste não
distingue o orçamento novo do limite de píxeis antigo, que já os recusaria
a todos por igual se fossem maiores do que 30 MP.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: Abaixo do limite de píxeis (30 MP), mas grande o suficiente para o
#: `draft()` do JPEG encolher (potências de 1/2 a partir de ~4000 px) e
#: para PNG/WebP (que nunca encolhem) ultrapassarem o orçamento de bytes.
LARGURA_E_ALTURA = 5460


def _imagem_com_textura(formato: str) -> bytes:
    """Um gradiente, não uma cor sólida — para não comprimir de forma otimista a mais."""
    base = Image.linear_gradient("L").resize((LARGURA_E_ALTURA, LARGURA_E_ALTURA))
    imagem = Image.merge("RGB", (base, base.rotate(90), base))
    buffer = io.BytesIO()
    if formato == "JPEG":
        imagem.save(buffer, format=formato, quality=85)
    else:
        imagem.save(buffer, format=formato)
    return buffer.getvalue()


def test_a_origem_esta_mesmo_abaixo_do_limite_de_pixeis() -> None:
    assert LARGURA_E_ALTURA * LARGURA_E_ALTURA < 30_000_000


def test_png_grande_e_recusado_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        _imagem_com_textura("PNG"),
        nome_ficheiro="grande.png",
        tipo_mime="image/png",
    )
    assert resposta.status_code == 400, resposta.text
    assert resposta.json()["erro"] == "imagem_demasiado_grande"
    apoio_fotos.exigir_nada_escrito(sessao)


def test_webp_grande_e_recusado_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        _imagem_com_textura("WEBP"),
        nome_ficheiro="grande.webp",
        tipo_mime="image/webp",
    )
    assert resposta.status_code == 400, resposta.text
    assert resposta.json()["erro"] == "imagem_demasiado_grande"
    apoio_fotos.exigir_nada_escrito(sessao)


def test_jpeg_do_mesmo_tamanho_e_aceite(cliente: TestClient, sessao: Session) -> None:
    """Controlo: sem isto, nada distinguia o orçamento novo do limite de píxeis antigo."""
    resposta = apoio_fotos.enviar_foto(
        cliente,
        _imagem_com_textura("JPEG"),
        nome_ficheiro="grande.jpg",
        tipo_mime="image/jpeg",
    )
    assert resposta.status_code == 202, resposta.text
