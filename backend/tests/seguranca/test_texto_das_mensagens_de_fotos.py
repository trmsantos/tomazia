"""D: o texto das mensagens de erro de `POST /fotos`, revisto pelo dominio-bar.

As quatro frases comparam-se por **string literal**, nunca com a
constante importada do próprio código que as produz — o mesmo achado da
F2-04: um teste que compara a resposta com a constante que a gerou nunca
consegue falhar, porque as duas lêem sempre do mesmo sítio.

As razões do texto, para não se desfazerem sem querer numa limpeza
futura:

- nunca as siglas do nosso pipeline (`JPEG, PNG ou WebP`) — o visitante
  não escolheu WebP, é o formato em que a foto *sai*, e quem mandou um
  HEIC do iPhone só sabe que "a foto não foi";
- nunca uma instrução técnica ("reduz o tamanho") a quem está de pé, no
  bar, com uma mão ocupada;
- "já chegaste ao limite", nunca "demasiadas fotos": a segunda acusa de
  excesso quem teve entusiasmo — cinco fotos numa noite de samba é a
  noite a correr bem.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_mensagem_de_ficheiro_grande_demais(
    cliente: TestClient, sessao: Session
) -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, format="JPEG")
    conteudo = buffer.getvalue() + b"0" * (8 * 1024 * 1024 + 1)

    resposta = apoio_fotos.enviar_foto(cliente, conteudo)

    assert resposta.status_code == 413, resposta.text
    assert (
        resposta.json()["mensagem"]
        == "O ficheiro é demasiado grande. O limite é de 8 MB. Tenta outra foto."
    )


def test_mensagem_de_imagem_invalida(cliente: TestClient, sessao: Session) -> None:
    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.CARGA_PHP)

    assert resposta.status_code == 400, resposta.text
    assert resposta.json()["mensagem"] == (
        "Não consegui usar esta fotografia. Tenta enviá-la outra vez ou "
        "escolhe outra foto."
    )
    assert "WebP" not in resposta.text
    assert "JPEG" not in resposta.text


def test_mensagem_de_imagem_demasiado_grande(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.png_bomba_na_zona_cinzenta(),
        nome_ficheiro="grande.png",
        tipo_mime="image/png",
    )

    assert resposta.status_code == 400, resposta.text
    assert (
        resposta.json()["mensagem"]
        == "Esta foto é demasiado grande para o site. Tenta outra foto."
    )
    assert "reduz" not in resposta.text.lower()


def test_mensagem_de_limite_de_envios(sessao: Session) -> None:
    cliente = apoio_fotos.cliente_com_ip("203.0.113.90")
    for _ in range(5):
        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
        assert resposta.status_code == 202, resposta.text

    sexta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())

    assert sexta.status_code == 429, sexta.text
    assert sexta.json()["mensagem"] == (
        "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco."
    )
    assert "demasiadas" not in sexta.text.lower()
