"""O `slug` de uma categoria: minúsculas, sem acentos, com hífenes.

Partilhado pelo importador da base de dados antiga e pela gestão da ementa,
para os dois darem sempre o mesmo slug ao mesmo nome.
"""

from __future__ import annotations

import re
import unicodedata


def normalizar_slug(valor: str) -> str:
    """O `slug` de um nome: minúsculas, sem acentos, com hífenes.

    É isto — e não um caso especial `{"Bebidas": "bebidas"}` — que junta
    `Bebidas` e `bebidas` na mesma categoria, e que junta o `Gin` que o
    dono escreva com maiúscula ao `gin` que lá está. Um nome sem letras nem
    algarismos dá `""`: quem chama decide o que fazer com isso.
    """
    decomposto = unicodedata.normalize("NFKD", valor)
    sem_acentos = "".join(c for c in decomposto if not unicodedata.combining(c))
    return "-".join(re.findall(r"[a-z0-9]+", sem_acentos.lower()))
