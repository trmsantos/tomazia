"""E2: `Cache-Control: no-store` em `POST /fotos` e em `GET /gestao/fotos/{id}/imagem`.

Medido em revisão: as duas mutações (apagar cada um dos dois cabeçalhos)
sobreviviam. `tests/apoio_publico.py::CONTRATO_PUBLICO` declara `"/fotos"`
com `cache="no-store"`, mas só entra na iteração de
`CAMINHOS_PUBLICOS_GET` (que só percorre respostas `GET` de leitura) —
`POST /fotos` nunca é verificado por ela. `GET /gestao/fotos/{id}/imagem`
nem está nessa tabela (é de admins, não pública). Os dois precisam de um
teste à parte.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from tests import apoio_fotos
from tests.apoio_auth import CABECALHO_MUTACAO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_post_fotos_responde_sem_cache(cliente: TestClient) -> None:
    resposta = cliente.post(
        "/fotos",
        files={"ficheiro": ("f.jpg", apoio_fotos.jpeg_valido(), "image/jpeg")},
        headers=CABECALHO_MUTACAO,
    )
    assert resposta.status_code == 202, resposta.text
    assert resposta.headers.get("cache-control") == "no-store"


def test_imagem_pendente_de_gestao_responde_sem_cache(
    cliente: TestClient, sessao: Session, sessao_de_admin: TestClient
) -> None:
    from app.models.fotos import Foto

    envio = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert envio.status_code == 202, envio.text
    id_foto = sessao.scalars(select(Foto)).one().id

    resposta = sessao_de_admin.get(f"/gestao/fotos/{id_foto}/imagem")
    assert resposta.status_code == 200, resposta.text
    assert resposta.headers.get("cache-control") == "no-store"
