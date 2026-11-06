"""O router da área de gestão: protegido por construção, não rota a rota.

`dependencies=[Depends(exigir_admin)]` no **router**, não em cada rota: uma
rota nova da F2-05 ou da F2-06 que esqueça `Depends(exigir_admin)` à mão
fica protegida na mesma, porque a proteção não depende de ninguém se
lembrar de a repetir. `tests/seguranca/test_s04_gestao_exige_sessao.py`
(Camada 4) lê exatamente isto.

**A F2-06 é quem estreia as rotas** (moderação de fotos): a fila
(`GET /fotos`), a imagem de uma pendente (`GET /fotos/{id}/imagem`) e
aprovar/rejeitar. Sem lógica aqui — o trabalho é todo de
`app/services/fotos.py`, no mesmo padrão de `app/routers/publico.py` com
`app/services/publico.py`.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Response

from app.dependencias import SessaoDaBD
from app.schemas.fotos import RespostaFilaDeModeracao, RespostaModeracao
from app.services import fotos as servico
from app.services.auth import exigir_admin

#: Nunca em cache: a foto que o dono acabou de rejeitar não pode continuar
#: a aparecer a partir da cache do browser dele.
SEM_CACHE = "no-store"

#: `alias="id"`: o parâmetro do URL continua a chamar-se `id` (é o que
#: `tests/seguranca/test_s04_gestao_exige_sessao.py` tem fixado, por
#: string literal, como a lista de rotas de gestão) — só o nome da
#: variável Python muda, para não tapar o `id` nativo da linguagem dentro
#: da função. O serviço (`app/services/fotos.py`) já usa `id_foto`.
IdDaFoto = Annotated[int, Path(alias="id")]

#: Para o OpenAPI: `GET /fotos/{id}/imagem` devolve bytes de imagem, nunca
#: JSON — sem isto, o esquema gerado prometia `application/json` (o
#: omisso do FastAPI) e o TypeScript gerado tratava a resposta como se
#: fosse um objeto. Mesma família de achado da herança da F2-04.
_RESPOSTA_IMAGEM: dict[int | str, dict[str, Any]] = {
    200: {"content": {"image/webp": {}}}
}

router = APIRouter(dependencies=[Depends(exigir_admin)])


@router.get("/fotos", response_model=RespostaFilaDeModeracao)
def listar_fotos_pendentes(sessao: SessaoDaBD) -> RespostaFilaDeModeracao:
    """A fila de moderação, da foto mais antiga para a mais recente."""
    return servico.listar_pendentes(sessao)


@router.get("/fotos/{id}/imagem", responses=_RESPOSTA_IMAGEM)
def obter_imagem_pendente(id_foto: IdDaFoto, sessao: SessaoDaBD) -> Response:
    """Os bytes de uma foto, pendente ou já aprovada. `404` sem ela (S-03)."""
    conteudo = servico.obter_bytes_da_imagem(sessao, id_foto)
    return Response(
        content=conteudo,
        media_type="image/webp",
        headers={"Cache-Control": SEM_CACHE},
    )


@router.post("/fotos/{id}/aprovar", response_model=RespostaModeracao)
def aprovar_foto(id_foto: IdDaFoto, sessao: SessaoDaBD) -> RespostaModeracao:
    """Move a foto para `MEDIA_DIR` e marca-a aprovada. `409` se já moderada."""
    foto = servico.aprovar(sessao, id_foto)
    return RespostaModeracao(id=foto.id, estado=foto.estado)


@router.post("/fotos/{id}/rejeitar", response_model=RespostaModeracao)
def rejeitar_foto(id_foto: IdDaFoto, sessao: SessaoDaBD) -> RespostaModeracao:
    """Marca a foto rejeitada e apaga os bytes. A linha nunca se apaga."""
    foto = servico.rejeitar(sessao, id_foto)
    return RespostaModeracao(id=foto.id, estado=foto.estado)
