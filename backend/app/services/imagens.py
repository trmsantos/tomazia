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
  `comment`, que também vivem lá);
- **deitar fora o EXIF sem aplicar a orientação primeiro deixa a foto
  deitada.** Um telemóvel grava a imagem tal como o sensor a viu e guarda
  a rotação só na etiqueta `Orientation` — o caso **normal**, não a
  exceção. `ImageOps.exif_transpose(imagem)` lê essa etiqueta e roda os
  píxeis antes de o `frombytes` apagar o EXIF; sem isto, o `frombytes`
  livra-se da etiqueta mas nunca da rotação que ela descrevia, e a galeria
  do bar enchia-se de fotos de lado;
- **o `exif_transpose` acrescentado para o ponto anterior quase afundou um
  worker do Passenger.** Medido: um JPEG de 458 KB a declarar 5460×5460
  (29,81 MP, abaixo do limite de 30) levava o processo a **614 MB de RSS**
  num só pedido — `open` 137 MB, `load` 139, `exif_transpose` **251**
  (`+112 MB`, o preço de copiar, porque `in_place=False` devolve sempre um
  `image.copy()`, **mesmo sem etiqueta de orientação nenhuma**), `convert`
  253, `tobytes` 445, `frombytes` 555, `thumbnail` 610. Cinco cópias do
  bitmap inteiro vivas ao mesmo tempo, ~21 bytes de RSS por píxel
  declarado, por um ficheiro de saída de 7 KB. Um só pedido chega para o
  limite de memória da conta matar o worker — o limite de tentativas
  (ADR 0018) não ajuda, porque é **um** pedido, não uma repetição.
  Corrigido invertendo a ordem: `imagem.draft("RGB", (LADO_MAIOR_MAXIMO,
  LADO_MAIOR_MAXIMO))` **antes** do `load()` (só tem efeito em JPEG; deixa
  o libjpeg decodificar já à escala reduzida, em vez de descomprimir o
  tamanho inteiro para o encolher a seguir) e `imagem.thumbnail(...)`
  logo **a seguir** ao `load()`, antes do `exif_transpose`/`convert`/
  `frombytes` — essas três operações passam a correr sobre uma imagem já
  pequena. Medido: **188 MB em vez de 604**, com os bytes de saída
  idênticos aos de antes da correção.

`Image.MAX_IMAGE_PIXELS` fica fixado ao `LIMITE_DE_PIXEIS` à importação
deste módulo — como segunda camada, não a única: quem decide é mesmo a
comparação explícita.
"""

from __future__ import annotations

import io

from PIL import Image, ImageOps, UnidentifiedImageError

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
    except OSError as erro:
        # Medido: um WebP cortado a meio (50%, 80%, 95% do ficheiro) não
        # levanta `UnidentifiedImageError` — levanta `OSError: could not
        # create decoder object`, direto de `Image.open()`, antes mesmo de
        # chegar ao `load()` que já tinha o seu próprio `except OSError`
        # mais abaixo. Sem isto, a exceção subia por `app/services/fotos.py`
        # e por `app/routers/fotos.py` sem ninguém a apanhar: 500 em
        # inglês, fora do envelope, numa rota pública.
        raise ImagemInvalida("a imagem está truncada ou corrompida") from erro

    if imagem.format not in FORMATOS_ACEITES:
        raise ImagemInvalida(f"formato não aceite: {imagem.format!r}")

    largura, altura = imagem.size
    if largura * altura > LIMITE_DE_PIXEIS:
        raise ImagemComDemasiadosPixeis(
            f"{largura}x{altura} = {largura * altura} píxeis acima do limite "
            f"de {LIMITE_DE_PIXEIS}"
        )

    # `draft()` **antes** do `load()`: só tem efeito em JPEG (é um no-op
    # nos outros formatos), e é o que permite ao libjpeg descomprimir já à
    # escala reduzida — em vez de descomprimir o tamanho declarado inteiro
    # para o encolher a seguir. Medido: é esta linha, mais o `thumbnail()`
    # logo a seguir ao `load()`, que tira o pico de 614 MB (um JPEG de
    # 458 KB a declarar 29,81 MP, abaixo do limite de 30) para 188 MB — ver
    # o docstring do módulo. O argumento `"RGB"` é o modo pedido; o
    # resultado real pode diferir e é o `convert("RGB")`, mais abaixo, que
    # o garante de qualquer forma.
    imagem.draft("RGB", (LADO_MAIOR_MAXIMO, LADO_MAIOR_MAXIMO))

    try:
        # Descomprime. `ImageFile.LOAD_TRUNCATED_IMAGES` fica no valor por
        # omissão do Pillow (`False`): falha fechada perante dados
        # cortados a meio, em vez de servir uma imagem incompleta.
        imagem.load()
    except OSError as erro:
        raise ImagemInvalida("a imagem está truncada ou corrompida") from erro

    # Reduz **antes** de qualquer cópia: `exif_transpose`, `convert` e
    # `frombytes`, a seguir, criam cada um um bitmap novo do tamanho da
    # imagem em que correm. Com o `draft()` acima, isto já não é o
    # tamanho declarado original — mas reduzir de novo aqui apanha os
    # formatos sem `draft` (PNG, WebP) e qualquer JPEG em que o `draft`
    # tenha ficado acima de `LADO_MAIOR_MAXIMO` (ele escolhe só potências
    # de 1/2, 1/4, 1/8...).
    imagem.thumbnail((LADO_MAIOR_MAXIMO, LADO_MAIOR_MAXIMO))

    # Aplica a rotação da etiqueta EXIF `Orientation` aos píxeis **antes**
    # de o `frombytes`, mais abaixo, apagar essa etiqueta para sempre — o
    # caso normal de uma foto de telemóvel, não a exceção. Nome novo
    # (`endireitada`, não `imagem`): o mypy tinha `imagem` como
    # `ImageFile`, estreito demais para o que `exif_transpose` devolve.
    endireitada = ImageOps.exif_transpose(imagem)
    # `None` só é possível com `in_place=True` (não é o que usamos acima):
    # com o omisso `in_place=False`, a função devolve sempre uma imagem,
    # cópia ou transposta — mesmo sem etiqueta de orientação nenhuma, o
    # que é o motivo de ser cara e de ter de correr sobre a imagem já
    # pequena, não sobre o tamanho declarado original.
    assert endireitada is not None

    # `convert("RGB")` antes do `frombytes`: uma imagem `P` (paleta, comum
    # em PNG) só faz sentido lida através da sua paleta — tirar os bytes
    # nus do modo `P` sem converter primeiro trocava as cores por índices
    # de paleta perdidos. A conversão corre sobre `imagem` (que ainda tem
    # metadados); é o `frombytes` a seguir que os descarta.
    convertida = endireitada.convert("RGB")
    sem_metadados = Image.frombytes(
        convertida.mode, convertida.size, convertida.tobytes()
    )

    buffer = io.BytesIO()
    sem_metadados.save(buffer, format="WEBP", quality=QUALIDADE_WEBP)
    return buffer.getvalue()
