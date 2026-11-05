"""Critério S-03: o URL de uma foto pendente é 404 — por três afirmações juntas.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-03 | URL de uma foto pendente | 404 |

`docs/ESPECIFICACAO.md`, linha 79. O "URL" de uma foto pendente é o nome
de ficheiro que a galeria serviria se a foto estivesse aprovada —
`MEDIA_DIR/<ficheiro>`, pelo Apache em produção (ou pelo
`servirMediaEmDesenvolvimento` em desenvolvimento). O critério fica
cumprido pelas três afirmações que **juntas** o compõem, nenhuma sozinha:

(a) o ficheiro de uma foto pendente não está em `MEDIA_DIR` — é por isso
    que um pedido por ele dá 404, sem a API ter de fazer nada de especial;
(b) `GET /galeria` não a lista, logo ninguém sequer fica a saber o nome
    do ficheiro para o pedir;
(c) a única rota que serve os bytes de uma pendente,
    `GET /gestao/fotos/{id}/imagem`, é de admins: 401 sem cookie, 200
    `image/webp` com sessão.

E, depois de aprovar: o ficheiro muda de pasta — passa a estar em
`MEDIA_DIR` e deixa de estar em `pendentes/`. Um "aprovar" que copiasse em
vez de mover deixaria a imagem pendente ainda servível por
`GET /gestao/fotos/{id}/imagem` depois de já estar pública, o que não é o
que a rota de admin existe para fazer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from tests import apoio_fotos
from tests.apoio_auth import CABECALHO_MUTACAO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def _enviar_e_obter_id(cliente: TestClient, sessao: Session) -> int:
    from app.models.fotos import Foto

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text
    linha = sessao.scalars(select(Foto)).one()
    return linha.id


def test_nao_esta_no_media_dir_enquanto_pendente(
    cliente: TestClient, sessao: Session
) -> None:
    """(a): o ficheiro vive só em `pendentes/`, nunca em `MEDIA_DIR`, antes de aprovar."""
    from app.config import obter_definicoes
    from app.models.fotos import Foto

    id_foto = _enviar_e_obter_id(cliente, sessao)
    linha = sessao.get(Foto, id_foto)
    assert linha is not None

    definicoes = obter_definicoes()
    assert not (definicoes.media_dir / linha.ficheiro).exists(), (
        "uma foto pendente não pode estar na pasta que o Apache serve"
    )
    assert (definicoes.pendentes_dir / linha.ficheiro).exists()


def test_galeria_nao_lista_a_pendente(cliente: TestClient, sessao: Session) -> None:
    """(b): `GET /galeria` não anuncia o id nem o nome do ficheiro pendente."""
    id_foto = _enviar_e_obter_id(cliente, sessao)

    resposta = cliente.get("/galeria")
    assert resposta.status_code == 200
    ids = {foto["id"] for foto in resposta.json()["fotos"]}
    assert id_foto not in ids


class TestImagemDeAdmin:
    """(c): a única rota que serve os bytes de uma pendente é de admins."""

    def test_sem_cookie_e_401(self, cliente: TestClient, sessao: Session) -> None:
        id_foto = _enviar_e_obter_id(cliente, sessao)
        resposta = cliente.get(f"/gestao/fotos/{id_foto}/imagem")
        assert resposta.status_code == 401

    def test_com_sessao_e_200_image_webp(
        self, cliente: TestClient, sessao: Session, sessao_de_admin: TestClient
    ) -> None:
        id_foto = _enviar_e_obter_id(cliente, sessao)

        resposta = sessao_de_admin.get(f"/gestao/fotos/{id_foto}/imagem")

        assert resposta.status_code == 200, resposta.text
        assert resposta.headers["content-type"] == "image/webp"
        assert resposta.content[:4] == b"RIFF"
        assert resposta.content[8:12] == b"WEBP"


class TestAprovar:
    def test_move_de_pendentes_para_media(
        self,
        cliente: TestClient,
        sessao: Session,
        sessao_de_admin: TestClient,
    ) -> None:
        """Depois de aprovar: no `MEDIA_DIR`, e fora de `pendentes/` — um `move`, não um `copy`."""
        from app.config import obter_definicoes
        from app.models.fotos import Foto

        id_foto = _enviar_e_obter_id(cliente, sessao)
        linha = sessao.get(Foto, id_foto)
        assert linha is not None
        nome_ficheiro = linha.ficheiro

        resposta = sessao_de_admin.post(
            f"/gestao/fotos/{id_foto}/aprovar", headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, resposta.text

        definicoes = obter_definicoes()
        assert (definicoes.media_dir / nome_ficheiro).exists()
        assert not (definicoes.pendentes_dir / nome_ficheiro).exists(), (
            "aprovar move o ficheiro; se ainda está em pendentes/, foi copiado"
        )

    def test_depois_de_aprovada_a_galeria_passa_a_listar(
        self,
        cliente: TestClient,
        sessao: Session,
        sessao_de_admin: TestClient,
    ) -> None:
        id_foto = _enviar_e_obter_id(cliente, sessao)

        sessao_de_admin.post(
            f"/gestao/fotos/{id_foto}/aprovar", headers=CABECALHO_MUTACAO
        )

        resposta = cliente.get("/galeria")
        ids = {foto["id"] for foto in resposta.json()["fotos"]}
        assert id_foto in ids
