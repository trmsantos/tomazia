"""Uma foto legítima, perto do limite de píxeis, não pode esgotar memória.

Medido (achado de revisão da F2-06, consequência direta do `exif_transpose`
que o S-02/EXIF removido tinha acrescentado): um JPEG de 458 KB a declarar
5460×5460 (29,81 MP, **abaixo** do limite de 30 MP — uma foto legítima, não
uma bomba) levava o processo a **614 MB de RSS** num só pedido:

```
open             137 MB
load             139
exif_transpose   251     (+112 MB — `in_place=False` copia sempre,
                           mesmo sem etiqueta de orientação nenhuma)
convert RGB      253
tobytes          445
frombytes        555
thumbnail        610
```

Cinco bitmaps do tamanho inteiro vivos ao mesmo tempo, por um ficheiro de
saída de 7 KB. **Um só pedido** chega para o limite de memória da conta
matar o worker do Passenger — o limite de tentativas (ADR 0018) não ajuda,
porque não é uma repetição.

A diferença com o S-11 (`tests/seguranca/test_s11_limite_de_pixeis.py`): lá
a imagem é recusada **antes** de qualquer descompressão. Aqui a imagem é
**legítima** e tem de ser aceite — o teto de memória tem de valer também
para o caminho de sucesso, não só para o de recusa.

Corrigido invertendo a ordem em `app/services/imagens.py::recodificar`:
`draft()` antes do `load()`, `thumbnail()` logo a seguir — ver o docstring
desse módulo. Este teste usa o mesmo padrão do S-11: `tracemalloc` à volta
do pedido, com o mesmo teto de 50 MiB.
"""

from __future__ import annotations

import io
import tracemalloc
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

TETO_DE_MEMORIA_MIB = 50

#: Mesmo cenário medido em revisão: abaixo do limite de 30 MP de
#: `app/services/imagens.py::LIMITE_DE_PIXEIS`, mas perto dele.
LARGURA_E_ALTURA = 5460


def _jpeg_legitimo_perto_do_limite() -> bytes:
    """Um JPEG real de ~29,81 MP — não uma bomba, uma foto grande a sério.

    Um gradiente, não uma cor sólida: uma cor sólida comprime de forma
    otimista a mais e não exercita o decodificador da mesma maneira que
    uma fotografia real, com textura.
    """
    assert LARGURA_E_ALTURA * LARGURA_E_ALTURA < 30_000_000, (
        "o cenário depende de ficar abaixo do limite de píxeis — é uma "
        "foto legítima, não uma bomba"
    )
    gradiente = Image.linear_gradient("L").resize((LARGURA_E_ALTURA, LARGURA_E_ALTURA))
    imagem = Image.merge("RGB", (gradiente, gradiente.rotate(90), gradiente))
    buffer = io.BytesIO()
    imagem.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def test_uma_foto_legitima_perto_do_limite_nao_esgota_memoria(
    cliente: TestClient, sessao: Session
) -> None:
    conteudo = _jpeg_legitimo_perto_do_limite()

    tracemalloc.start()
    try:
        resposta = apoio_fotos.enviar_foto(
            cliente, conteudo, nome_ficheiro="grande.jpg", tipo_mime="image/jpeg"
        )
        _atual, pico = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert resposta.status_code == 202, resposta.text

    pico_mib = pico / (1024 * 1024)
    assert pico_mib <= TETO_DE_MEMORIA_MIB, (
        f"o pedido traçou um pico de {pico_mib:.1f} MiB (teto: "
        f"{TETO_DE_MEMORIA_MIB} MiB) — uma foto legítima perto do limite "
        "de píxeis não pode fazer o processo alocar memória proporcional "
        "ao tamanho declarado"
    )
