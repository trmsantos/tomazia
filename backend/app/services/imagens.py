"""O pipeline de imagens: abrir, validar, limitar píxeis, recodificar sem EXIF.

Sem HTTP — `app/routers/fotos.py` traduz as exceções daqui para códigos de
estado. Medido em Pillow 13.0.0 (`docs/TAREFAS.md`, F2-06; não
redescobrir):

- **o `Image.MAX_IMAGE_PIXELS` sozinho não cumpre o S-11.** Com o máximo a
  8000 e uma imagem de 9600 píxeis, o Pillow abre na mesma e só emite um
  `DecompressionBombWarning`, engolido por omissão (o `filterwarnings` é
  item da F3-07). Só **acima do dobro** do máximo é que `Image.open()`
  levanta `DecompressionBombError` sozinho. Por isso há uma comparação
  explícita sobre `im.size`, logo depois de `Image.open()` (que só lê o
  cabeçalho, sem descomprimir) e antes de qualquer `.load()`;
- **o EXIF sobrevive a um `resize()`**: `im.info["exif"]` continua lá
  depois dele. Confiar em `resize()` + `save()` faria a remoção do EXIF
  depender do plugin WebP continuar a ignorar o que lhe passam — e isso
  muda com uma versão nova do Pillow que o Dependabot sobe sozinho. Só
  `Image.frombytes(im.mode, im.size, im.tobytes())`, sobre os píxeis nus,
  esvazia o `info` por completo (e com ele o `xmp`, o `icc_profile` e o
  `comment`, que também vivem lá).

`Image.MAX_IMAGE_PIXELS` fica fixado ao `LIMITE_DE_PIXEIS` à importação
deste módulo — como segunda camada, não a única: quem decide é mesmo a
comparação explícita.
"""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

#: Decisão do Tomás, 5 de novembro de 2026.
LIMITE_DE_PIXEIS = 30_000_000

#: Segunda camada, fixada ao mesmo número: o Pillow só a usa para o seu
#: próprio aviso/erro de "decompression bomb" — quem decide o critério é a
#: comparação explícita sobre `im.size`, mais abaixo.
Image.MAX_IMAGE_PIXELS = LIMITE_DE_PIXEIS

#: `docs/ESPECIFICACAO.md`: "Pillow abre e valida (JPEG, PNG, WebP)". O
#: Pillow abre muito mais do que isto (um GIF abre e diz `format ==
#: "GIF"`); um GIF animado também não sobrevive à recodificação para uma
#: única imagem WebP.
FORMATOS_ACEITES = frozenset({"JPEG", "PNG", "WEBP"})

#: O lado maior da imagem recodificada, em píxeis. O frontend já reduz
#: para 2000 px antes de enviar (`docs/ESPECIFICACAO.md`); isto é a
#: garantia do lado do servidor, para um cliente que não seja o nosso
#: frontend.
LADO_MAIOR_MAXIMO = 2000

QUALIDADE_WEBP = 82


class ImagemInvalida(Exception):
    """O Pillow não reconheceu isto como imagem, ou o formato não está na lista branca."""


class ImagemComDemasiadosPixeis(Exception):
    """Acima do limite de píxeis (S-11), apanhado antes de qualquer descompressão."""


def recodificar(origem: bytes) -> bytes:
    """Abre, valida e devolve um WebP novo, sem metadados, pronto a guardar.

    **Nunca copia um byte de `origem`**: a imagem que sai nasce de
    `Image.frombytes`, sobre os píxeis nus, nunca de uma gravação por cima
    do ficheiro aberto — é isso que mata um `<?php ... ?>` colado depois
    do fim de um JPEG válido (S-02): o que viaja é a matriz de píxeis, e o
    PHP nunca é píxel nenhum.

    Levanta `ImagemInvalida` (formato não reconhecido, fora da lista
    branca, ou dados truncados/corrompidos) e `ImagemComDemasiadosPixeis`
    (acima de `LIMITE_DE_PIXEIS`). Nunca escreve nada em disco.
    """
    try:
        imagem = Image.open(io.BytesIO(origem))
    except UnidentifiedImageError as erro:
        raise ImagemInvalida("o Pillow não reconhece isto como uma imagem") from erro
    except Image.DecompressionBombError as erro:
        # O próprio guarda do Pillow (acima do dobro do limite) já apanha
        # isto dentro de `Image.open()`, antes de a imagem sequer existir
        # como objeto — a comparação explícita abaixo só é precisa para a
        # zona entre o limite e o dobro, onde o Pillow apenas avisa.
        raise ImagemComDemasiadosPixeis(str(erro)) from erro

    if imagem.format not in FORMATOS_ACEITES:
        raise ImagemInvalida(f"formato não aceite: {imagem.format!r}")

    largura, altura = imagem.size
    if largura * altura > LIMITE_DE_PIXEIS:
        raise ImagemComDemasiadosPixeis(
            f"{largura}x{altura} = {largura * altura} píxeis acima do limite "
            f"de {LIMITE_DE_PIXEIS}"
        )

    try:
        # Descomprime. `ImageFile.LOAD_TRUNCATED_IMAGES` fica no valor por
        # omissão do Pillow (`False`): falha fechada perante dados
        # cortados a meio, em vez de servir uma imagem incompleta.
        imagem.load()
    except OSError as erro:
        raise ImagemInvalida("a imagem está truncada ou corrompida") from erro

    # `convert("RGB")` antes do `frombytes`: uma imagem `P` (paleta, comum
    # em PNG) só faz sentido lida através da sua paleta — tirar os bytes
    # nus do modo `P` sem converter primeiro trocava as cores por índices
    # de paleta perdidos. A conversão corre sobre `imagem` (que ainda tem
    # metadados); é o `frombytes` a seguir que os descarta.
    convertida = imagem.convert("RGB")
    sem_metadados = Image.frombytes(
        convertida.mode, convertida.size, convertida.tobytes()
    )
    sem_metadados.thumbnail((LADO_MAIOR_MAXIMO, LADO_MAIOR_MAXIMO))

    buffer = io.BytesIO()
    sem_metadados.save(buffer, format="WEBP", quality=QUALIDADE_WEBP)
    return buffer.getvalue()
