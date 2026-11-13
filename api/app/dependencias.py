"""Dependências HTTP partilhadas por mais do que um router.

`SessaoDaBD` já existia, duplicado dentro de `app/routers/publico.py` desde
a F2-03. Esse ficheiro não se toca nesta tarefa (ver `backend/CLAUDE.md` e
as regras da F2-04): o alias de lá fica como está, e este módulo serve os
routers novos (`auth`, `gestao`) para não nascer um terceiro `Annotated[
Session, Depends(obter_sessao)]` escrito à mão.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Path
from sqlalchemy.orm import Session

from app.db import obter_sessao

#: A sessão da base de dados do pedido, fechada no fim por `obter_sessao`.
SessaoDaBD = Annotated[Session, Depends(obter_sessao)]

#: O maior inteiro que o SQLite guarda. Acima disto o driver levanta
#: `OverflowError`, que sem limite na fronteira dava 500.
MAIOR_INTEIRO_DO_SQLITE = 2**63 - 1

#: Um `{id}` de caminho: `1..2**63-1`, senão `422`. `alias="id"`: o
#: parâmetro do URL chama-se `id`; só a variável Python tem outro nome,
#: para não tapar o `id` nativo da linguagem.
IdDaBD = Annotated[int, Path(alias="id", ge=1, le=MAIOR_INTEIRO_DO_SQLITE)]
