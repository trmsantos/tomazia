"""Os modelos do Bar da Tomazia, um módulo por agregado.

Importar este pacote põe as oito tabelas em `Base.metadata` (sete da
especificação original mais `tentativas_de_envio`, acrescentada na F2-06
para sustentar o limite de 5 fotos por hora por IP). É dele que
`migrations/env.py` importa o `Base`, e não de `app.db`: assim as duas
coisas — a metadata e os modelos que a preenchem — não se separam por
distração. Um `Base` vindo de `app.db` sem os modelos importados tem a
metadata vazia, e o `autogenerate` propõe largar a base de dados inteira.
"""

from __future__ import annotations

from app.db import Base
from app.models.admins import Admin
from app.models.clientes import Cliente
from app.models.definicoes import Definicao
from app.models.ementa import Categoria, Produto
from app.models.eventos import Evento
from app.models.fotos import EstadoFoto, Foto
from app.models.limites import TentativaDeEnvio
from app.models.tipos import DataHoraUTC, agora_utc

__all__ = [
    "Admin",
    "Base",
    "Categoria",
    "Cliente",
    "DataHoraUTC",
    "Definicao",
    "EstadoFoto",
    "Evento",
    "Foto",
    "Produto",
    "TentativaDeEnvio",
    "agora_utc",
]
