"""O limite conta tentativas, não só envios aceites (achado em revisão da F2-06).

Decisão do Tomás, substituindo a primeira versão desta tarefa: medido, um
PNG de ~65 bytes que declara 5400×5400 (29,16 MP, mesmo abaixo do limite
de píxeis de 30 MP) passa a comparação explícita sobre `im.size` — ainda
não há nada descomprimido, o cabeçalho é que mente. Nessa altura, a
recusa só acontecia no `Image.load()` a seguir, já depois de o Pillow
tentar alocar o bitmap inteiro para o descomprimir — um `400
imagem_invalida` **sem nenhuma linha em `fotos`**: um balde que só
contasse envios aceites nunca via este ficheiro, e o mesmo PNG de 65
bytes repetia-se sem fim, cada repetição a custar dezenas de MB de RSS,
sem o limite de 5 por hora nunca intervir.

`tentativas_de_envio` fecha isto: cada `POST /fotos` que chega a ler o
ficheiro conta, aceite ou não. Este teste prende exatamente o caso que
motivou a mudança — cinco destes PNGs mentirosos esgotam o balde, e o
sexto pedido nunca chega a `imagens.recodificar`.

**O código de erro mudou numa correção posterior** (o orçamento de bytes
do item A, `ORCAMENTO_DE_BYTES_SEM_DRAFT`): um PNG nunca encolhe no
`draft()`, por isso este ficheiro passa agora a ser recusado **antes**
do `load()`, como `400 imagem_demasiado_grande` — mais cedo e mais barato
do que antes, nunca chegando a tentar alocar bitmap nenhum. O que este
teste prende continua de pé: `recodificar` é chamado uma vez por
tentativa aceite pelo limite, nunca mais.
"""

from __future__ import annotations

import struct
import zlib
from typing import TYPE_CHECKING

from tests import apoio_fotos

if TYPE_CHECKING:
    import pytest
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: Decisão do Tomás, 5 de novembro de 2026 (`app/services/imagens.py`).
LIMITE_DE_PIXEIS = 30_000_000


def _chunk_png(tipo: bytes, dados: bytes) -> bytes:
    return (
        struct.pack(">I", len(dados))
        + tipo
        + dados
        + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)
    )


def _png_mentiroso(largura: int = 5400, altura: int = 5400) -> bytes:
    """Um PNG de ~65 bytes cujo `IHDR` declara `largura`×`altura`, com `IDAT` vazio.

    Igual na técnica a `tests.apoio_fotos.png_bomba_na_zona_cinzenta`, mas
    com as dimensões **abaixo** do limite de píxeis (`5400×5400 =
    29_160_000 < 30_000_000`) — não é o S-11 que isto prende, é o caso em
    que a comparação explícita sobre `im.size` deixa passar e só o
    `Image.load()`, a seguir, é que descobre que os dados não existem.
    """
    pixeis = largura * altura
    assert pixeis < LIMITE_DE_PIXEIS, (
        f"{largura}x{altura} = {pixeis} não está abaixo do limite de "
        f"{LIMITE_DE_PIXEIS} — este teste depende de a comparação "
        "explícita deixar passar e só o `load()` falhar"
    )
    assinatura = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", largura, altura, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"", 9)
    return (
        assinatura
        + _chunk_png(b"IHDR", ihdr)
        + _chunk_png(b"IDAT", idat)
        + _chunk_png(b"IEND", b"")
    )


def test_a_origem_e_mesmo_minuscula_e_abaixo_do_limite_de_pixeis() -> None:
    """O guarda deste próprio ficheiro: sem isto, nada abaixo provaria nada."""
    conteudo = _png_mentiroso()
    assert len(conteudo) < 100, "o cenário depende de o ficheiro ser minúsculo"


def test_cinco_png_mentirosos_esgotam_o_balde_e_recodificar_nunca_corre_no_sexto(
    monkeypatch: pytest.MonkeyPatch, sessao: Session
) -> None:
    """Cinco tentativas recusadas esgotam o balde; a sexta nem chega ao Pillow."""
    from app.services import imagens

    chamadas: list[int] = []
    original = imagens.recodificar

    def espia(origem: bytes) -> bytes:
        chamadas.append(len(origem))
        return original(origem)

    monkeypatch.setattr(imagens, "recodificar", espia)

    cliente: TestClient = apoio_fotos.cliente_com_ip("203.0.113.70")

    for numero in range(1, 6):
        resposta = apoio_fotos.enviar_foto(
            cliente,
            _png_mentiroso(),
            nome_ficheiro="mentiroso.png",
            tipo_mime="image/png",
        )
        assert resposta.status_code == 400, (
            f"a tentativa {numero} devolveu {resposta.status_code}, não 400: "
            f"{resposta.text}"
        )
        # `imagem_demasiado_grande`, não `imagem_invalida`: o orçamento de
        # bytes do item A (`ORCAMENTO_DE_BYTES_SEM_DRAFT`) recusa este PNG
        # antes do `load()`, mais cedo do que o `OSError` de antes — ver o
        # docstring do módulo.
        assert resposta.json()["erro"] == "imagem_demasiado_grande"

    assert len(chamadas) == 5, (
        "esperava `imagens.recodificar` chamado 5 vezes (uma por tentativa "
        f"aceite pelo limite), foi chamado {len(chamadas)}"
    )

    sexta = apoio_fotos.enviar_foto(
        cliente, _png_mentiroso(), nome_ficheiro="mentiroso.png", tipo_mime="image/png"
    )
    assert sexta.status_code == 429, (
        f"a sexta tentativa, com o balde cheio, tinha de ser 429: {sexta.text}"
    )
    assert len(chamadas) == 5, (
        "o sexto pedido foi recusado pelo limite antes de chegar ao corpo "
        "do pedido — `imagens.recodificar` não podia ter corrido mais uma "
        f"vez, mas correu {len(chamadas)} vezes no total"
    )
