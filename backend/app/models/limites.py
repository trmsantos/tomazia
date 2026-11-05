"""Tentativas de envio de fotos — o que sustenta o limite de 5 por hora por IP.

Decisão do Tomás, substituindo a primeira versão da F2-06 (contar só
**envios aceites**, as linhas de `fotos`): medido, um PNG de 58 bytes que
declara 5400×5400 (29,16 MP, mesmo abaixo do limite de 30) passa a
comparação explícita sobre `im.size` — ainda não é descomprimido, o
cabeçalho é que mente — e só falha no `Image.load()` a seguir, quando o
Pillow já tentou alocar o bitmap inteiro para o descomprimir (`+113 MB` de
RSS em três pedidos, medido). Essa recusa é um `400` sem linha nenhuma em
`fotos`; um balde que conta só envios aceites nunca a vê, e o mesmo
ficheiro de 58 bytes repete-se sem fim, anónimo.

`tentativas_de_envio` conta o **pedido** em si — antes de o corpo sequer
ser lido, não só antes de o Pillow tocar no ficheiro. É
`app.routers.fotos._exigir_limite_de_envios` quem grava a linha, como
`Depends`, antes de `await request.form(...)` correr — achado em revisão:
uma primeira versão gravava dentro de
`app.services.fotos.registar_envio`, e dois caminhos nunca chegavam lá (o
campo-isco contra bots preenchido, e um pedido sem o campo `ficheiro`),
por isso pagavam o corpo inteiro (até 8 MiB) sem nunca contar para o
balde. Uma sessão de admin válida continua a saltar o limite por
inteiro: não lhe conta tentativa nenhuma — achado também em revisão, a
primeira versão desta correção gravava a tentativa sempre, e as fotos do
próprio dono gastavam o balde do IP do bar.

Nunca se apaga nenhuma (pelo mesmo motivo de `fotos`: apagar devolvia
quota a quem a gastou, em silêncio) — não há rota nem script que o faça; a
tabela cresce e uma tarefa futura de limpeza é um problema à parte, para
quando o volume justificar.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC, agora_utc


class TentativaDeEnvio(Base):
    __tablename__ = "tentativas_de_envio"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Indexado: é exatamente `WHERE ip_hash = ? AND criada_em > ...` que
    # `app.services.limites.envios_na_ultima_hora` corre a cada `POST
    # /fotos` — a rota pública mais exposta do projeto.
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    criada_em: Mapped[datetime] = mapped_column(
        DataHoraUTC,
        nullable=False,
        default=agora_utc,
        server_default=func.current_timestamp(),
    )
