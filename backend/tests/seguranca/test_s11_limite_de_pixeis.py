"""Critério S-11: imagem acima do limite de píxeis é 400, sem esgotar memória.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-11 | Imagem acima do limite de píxeis | 400 sem esgotar memória |

`docs/ESPECIFICACAO.md`, linha 87. Limite: **30 MP** (decisão do Tomás, 5
de novembro de 2026).

Medido em Pillow 13.0.0 (ver o plano desta tarefa, não redescobrir): o
`Image.MAX_IMAGE_PIXELS` sozinho **não** cumpre isto — só dispara
`DecompressionBombError` acima do **dobro** do limite; entre o limite e o
dobro só avisa (`DecompressionBombWarning`, engolido por omissão — o
`filterwarnings` só chega na F3-07) e deixa o Pillow `load()`ar a imagem
inteira na mesma. Quem decide o critério tem de ser uma comparação
explícita sobre `im.size`, logo depois de `Image.open()` — que só lê o
cabeçalho — e antes de qualquer `.load()`/`.resize()`/`.save()`.

Por isso há dois PNGs-bomba, e os dois têm de dar 400:

- `png_bomba_de_pixels()`: 30000×30000, muito acima do limite — mesmo um
  `Image.open()` ingénuo já rebenta sozinho aqui (o próprio guarda do
  Pillow apanha-o), o que não prova nada sobre a comparação explícita;
- `png_bomba_na_zona_cinzenta()`: entre o limite e o dobro — é esta que
  passa incólume por uma implementação que confie só no aviso do Pillow.

Os dois pesam ~65 bytes em disco: a "bomba" está só no cabeçalho `IHDR`,
o `IDAT` é lixo comprimido vazio. "Sem esgotar memória" é uma asserção,
não uma alegação: `tracemalloc` à volta do pedido, com um teto de 50 MiB.

Acompanham: um GIF válido (fora da lista branca JPEG/PNG/WebP) e um JPEG
truncado — os dois também 400, e os dois também nada escrito.
"""

from __future__ import annotations

import tracemalloc
from typing import TYPE_CHECKING

from tests import apoio_fotos

if TYPE_CHECKING:
    import httpx
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

TETO_DE_MEMORIA_MIB = 50


def _enviar_com_teto_de_memoria(
    cliente: TestClient, conteudo: bytes, *, nome_ficheiro: str, tipo_mime: str
) -> httpx.Response:
    tracemalloc.start()
    try:
        resposta = apoio_fotos.enviar_foto(
            cliente, conteudo, nome_ficheiro=nome_ficheiro, tipo_mime=tipo_mime
        )
        _atual, pico = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    pico_mib = pico / (1024 * 1024)
    assert pico_mib <= TETO_DE_MEMORIA_MIB, (
        f"o pedido traçou um pico de {pico_mib:.1f} MiB (teto: "
        f"{TETO_DE_MEMORIA_MIB} MiB) — uma imagem-bomba não pode fazer o "
        "processo alocar memória proporcional às dimensões que ela declara"
    )
    return resposta


class TestPngBomba:
    def test_muito_acima_do_limite_e_400_sem_nada_escrito(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        resposta = _enviar_com_teto_de_memoria(
            cliente,
            apoio_fotos.png_bomba_de_pixels(),
            nome_ficheiro="enorme.png",
            tipo_mime="image/png",
        )
        assert resposta.status_code == 400, resposta.text
        # O código, não só o estado. Sem esta linha, o teste dava o
        # mesmo resultado a "recusada pela razão certa" e a "recusada
        # por outra razão qualquer que também dá 400" — e foi assim
        # que uma mutação que desligava a comparação explícita sobre
        # `im.size` deixou os quatro testes deste ficheiro verdes.
        assert resposta.json()["erro"] == "imagem_demasiado_grande", (
            f"a bomba de 900 MP devia ser recusada por `imagem_demasiado_grande`, "
            f"veio {resposta.json()['erro']!r}"
        )
        apoio_fotos.exigir_nada_escrito(sessao)

    def test_na_zona_cinzenta_e_400_sem_nada_escrito(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """A que prende a comparação explícita, não o aviso do Pillow.

        Entre 30 MP e o dobro, o `Image.MAX_IMAGE_PIXELS` do Pillow só
        avisa — e o aviso é engolido por omissão. Uma implementação que
        confie só nisso aceitaria esta imagem; só uma comparação explícita
        sobre `im.size` a recusa.
        """
        resposta = _enviar_com_teto_de_memoria(
            cliente,
            apoio_fotos.png_bomba_na_zona_cinzenta(),
            nome_ficheiro="zona-cinzenta.png",
            tipo_mime="image/png",
        )
        assert resposta.status_code == 400, resposta.text
        # O código, não só o estado. Sem esta linha, o teste dava o
        # mesmo resultado a "recusada pela razão certa" e a "recusada
        # por outra razão qualquer que também dá 400" — e foi assim
        # que uma mutação que desligava a comparação explícita sobre
        # `im.size` deixou os quatro testes deste ficheiro verdes.
        assert resposta.json()["erro"] == "imagem_demasiado_grande", (
            f"a imagem na zona cinzenta devia ser recusada por `imagem_demasiado_grande`, "
            f"veio {resposta.json()['erro']!r}"
        )
        apoio_fotos.exigir_nada_escrito(sessao)


class TestCompanheiros:
    def test_gif_valido_e_400_fora_da_lista_branca(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """A lista branca é JPEG/PNG/WebP — um GIF genuíno não entra, apesar de válido."""
        resposta = apoio_fotos.enviar_foto(
            cliente,
            apoio_fotos.gif_valido(),
            nome_ficheiro="animado.gif",
            tipo_mime="image/gif",
        )
        assert resposta.status_code == 400, resposta.text
        # O código, não só o estado. Sem esta linha, o teste dava o
        # mesmo resultado a "recusada pela razão certa" e a "recusada
        # por outra razão qualquer que também dá 400" — e foi assim
        # que uma mutação que desligava a comparação explícita sobre
        # `im.size` deixou os quatro testes deste ficheiro verdes.
        assert resposta.json()["erro"] == "imagem_invalida", (
            f"o GIF fora da lista branca devia ser recusada por `imagem_invalida`, "
            f"veio {resposta.json()['erro']!r}"
        )
        apoio_fotos.exigir_nada_escrito(sessao)

    def test_jpeg_truncado_e_400_sem_nada_escrito(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        resposta = apoio_fotos.enviar_foto(
            cliente,
            apoio_fotos.jpeg_truncado(),
            nome_ficheiro="cortada.jpg",
            tipo_mime="image/jpeg",
        )
        assert resposta.status_code == 400, resposta.text
        # O código, não só o estado. Sem esta linha, o teste dava o
        # mesmo resultado a "recusada pela razão certa" e a "recusada
        # por outra razão qualquer que também dá 400" — e foi assim
        # que uma mutação que desligava a comparação explícita sobre
        # `im.size` deixou os quatro testes deste ficheiro verdes.
        assert resposta.json()["erro"] == "imagem_invalida", (
            f"o JPEG truncado devia ser recusada por `imagem_invalida`, "
            f"veio {resposta.json()['erro']!r}"
        )
        apoio_fotos.exigir_nada_escrito(sessao)
