"""Gera os ficheiros da marca em `frontend/public/` a partir do original.

GERADO: os ficheiros de `public/` que este script escreve não se editam à mão.
Corre-se, a partir de `frontend/`, com:

    uv run --project ../backend python ferramentas/gerar-marca.py

(o Pillow já é dependência do backend; nenhuma dependência nova). É
determinístico: parâmetros fixos e nenhum metadado com data, por isso duas
corridas dão os mesmos bytes (`src/marca/gerar-marca.test.ts`).

Especificação: `docs/ecras/F3-08.md`, secções 1 e 3. A faixa transparente entre
o aro e o disco interior enche-se de creme (`creme-papel`), e o logótipo
recorta-se em círculo de raio 105,5 (um pixel por dentro do aro).

Com um argumento escreve nessa pasta (os testes usam-no, para nunca
reescreverem `public/` enquanto outros testes o leem).

Para trocar por um vetorial (secção 7), muda-se só `ORIGINAL` e `abrir()`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

FRONTEND = Path(__file__).resolve().parent.parent
ORIGINAL = FRONTEND.parent / "docs" / "marca" / "tomazia-original.png"
PUBLIC = FRONTEND / "public"

CREME_PAPEL = (0xF5, 0xE6, 0xD3)
BORDO_NOITE = (0x3D, 0x0F, 0x24)

# Geometria medida do original (224x225): centro e raio do círculo exterior.
CENTRO_X = 111.5
CENTRO_Y = 114.0
RAIO = 105.5
MARGEM = 1  # px de margem em volta do círculo, na caixa de recorte (215 px)
SUPER = 4  # sobreamostragem para o anti-aliasing
LADO_BASE = (round(RAIO * 2) + 2 * MARGEM + 2) * SUPER  # 860 px


def logotipo_base() -> Image.Image:
    """O logótipo em RGBA a 4x: disco creme por baixo do original, recortado."""
    original = Image.open(ORIGINAL).convert("RGBA")
    grande = original.resize(
        (original.width * SUPER, original.height * SUPER), Image.Resampling.LANCZOS
    )

    lado = LADO_BASE
    centro = lado / 2
    tela = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))

    disco = Image.new("L", (lado, lado), 0)
    r = RAIO * SUPER
    ImageDraw.Draw(disco).ellipse((centro - r, centro - r, centro + r, centro + r), fill=255)

    creme = Image.new("RGBA", (lado, lado), (*CREME_PAPEL, 255))
    tela.paste(creme, (0, 0), disco)

    deslocamento = (round(centro - CENTRO_X * SUPER), round(centro - CENTRO_Y * SUPER))
    camada = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    camada.paste(grande, deslocamento)
    tela = Image.alpha_composite(tela, camada)

    # Recorte final: nada fora do círculo (franja do aro do original incluída).
    alfa = Image.composite(tela.getchannel("A"), Image.new("L", (lado, lado), 0), disco)
    tela.putalpha(alfa)
    return tela


def reduzir(base: Image.Image, lado: int) -> Image.Image:
    return base.resize((lado, lado), Image.Resampling.LANCZOS)


def sobre_bordo(logo: Image.Image, tamanho: tuple[int, int], diametro: int) -> Image.Image:
    fundo = Image.new("RGB", tamanho, BORDO_NOITE)
    pequeno = logo if logo.width == diametro else reduzir(logo, diametro)
    posicao = ((tamanho[0] - diametro) // 2, (tamanho[1] - diametro) // 2)
    fundo.paste(pequeno, posicao, pequeno.getchannel("A"))
    return fundo


def main(saida: Path) -> None:
    if not ORIGINAL.is_file():
        raise SystemExit(f"não encontrei o original: {ORIGINAL}")

    base = logotipo_base()
    (saida / "marca").mkdir(parents=True, exist_ok=True)

    for lado in (44, 88, 132):
        reduzir(base, lado).save(
            saida / "marca" / f"logo-{lado}.webp", "WEBP", quality=82, method=6
        )

    icone48 = reduzir(base, 48)
    icone48.save(
        saida / "favicon.ico",
        "ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[reduzir(base, 16), reduzir(base, 32)],
    )
    reduzir(base, 32).save(saida / "favicon-32.png", "PNG", optimize=True)

    # RGB (tipo 2, sem alfa) mas com 64 cores: com todas as nuances do
    # anti-aliasing o PNG pesa ~29,7 KB, acima do teto de 25 KB da secção 3.
    # `quantize` seguido de `convert("RGB")` mantém o tipo de cor e poupa ~5 KB.
    apple = sobre_bordo(base, (180, 180), 144)
    apple = apple.quantize(64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    apple.convert("RGB").save(saida / "apple-touch-icon.png", "PNG", optimize=True)
    sobre_bordo(base, (1200, 630), 420).save(
        saida / "og-image.jpg", "JPEG", quality=85, optimize=True, progressive=False
    )


if __name__ == "__main__":
    # Sem argumentos escreve em `frontend/public/`; com um, na pasta dada.
    if len(sys.argv) > 2:
        raise SystemExit("uso: gerar-marca.py [pasta-de-saida]")
    main(Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else PUBLIC)
