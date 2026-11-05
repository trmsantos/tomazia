"""O router da área de gestão: protegido por construção, não rota a rota.

`dependencies=[Depends(exigir_admin)]` no **router**, não em cada rota: uma
rota nova da F2-05 ou da F2-06 que esqueça `Depends(exigir_admin)` à mão
fica protegida na mesma, porque a proteção não depende de ninguém se
lembrar de a repetir. `tests/seguranca/test_s04_gestao_exige_sessao.py`
(Camada 4) lê exatamente isto.

Zero rotas até à F2-05: esta tarefa só constrói o guarda.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.services.auth import exigir_admin

router = APIRouter(dependencies=[Depends(exigir_admin)])
