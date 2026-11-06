"""`GET /gestao/fotos`, aprovar e rejeitar: a fila de moderação.

Fora do que já está nos critérios de segurança (S-03 prende a imagem de
uma pendente a admins; S-04 prende as rotas de gestão a uma sessão; o
limite por IP tem o seu próprio ficheiro): a ordem da fila, o conflito de
aprovar duas vezes, o 404 de um id que não existe, e que `ip_hash` nunca
sai no corpo da lista — publicá-lo dava a qualquer admin a lista de
hashes de IP para comparar contra os seus próprios registos, o que não é
o que a moderação precisa para decidir.

**Suposições desta bateria, não da especificação:**

- o corpo de `GET /gestao/fotos` é um envelope nomeado, `{"fotos": [...]}`
  — o mesmo padrão do `GET /galeria` público;
- a fila vem por ordem de chegada — `criada_em` ascendente, desempatado
  por `id` ascendente, a mais antiga pendente primeiro — como qualquer
  fila FIFO de moderação.

Se o backend decidir outra forma, é aqui que se muda.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

from tests import apoio_fotos
from tests.apoio_auth import CABECALHO_MUTACAO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)


def _semear_pendente(sessao: Session, *, id_foto: int, criada_em: datetime) -> None:
    """Semeia uma linha `pendente` **e** o ficheiro falso que lhe corresponde.

    Achado em revisão: uma primeira versão só semeava a linha, sem bytes
    nenhuns em `pendentes/`. Isso moldava `app.services.fotos.aprovar` a
    ter de tolerar um `os.replace` sobre um ficheiro inexistente — o
    molde certo é o oposto: um envio real tem sempre ficheiro, e é isso
    que esta fixture passa a garantir. `app.services.fotos.aprovar`
    continua a distinguir "não havia nada para mover" (`FileNotFoundError`)
    de qualquer outro `OSError`, mas nenhum teste desta bateria precisa já
    de exercitar esse caminho através de uma linha sem ficheiro.
    """
    from app.config import obter_definicoes
    from app.models.fotos import EstadoFoto, Foto

    ficheiro = f"00000000-0000-4000-8000-{id_foto:012d}.webp"
    sessao.add(
        Foto(
            id=id_foto,
            ficheiro=ficheiro,
            estado=EstadoFoto.PENDENTE,
            descricao=None,
            enviada_por=None,
            ip_hash=f"hash-falso-de-ip-{id_foto:016d}",
            criada_em=criada_em,
            moderada_em=None,
        )
    )
    sessao.commit()

    definicoes = obter_definicoes()
    definicoes.pendentes_dir.mkdir(parents=True, exist_ok=True)
    (definicoes.pendentes_dir / ficheiro).write_bytes(b"bytes-falsos-de-uma-foto")


class TestListaDeModeracao:
    def test_ip_hash_nunca_sai_no_corpo(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        """Deixa passar: as outras chaves que o corpo trouxer."""
        _semear_pendente(sessao, id_foto=1001, criada_em=BASE)

        resposta = sessao_de_admin.get("/gestao/fotos")
        assert resposta.status_code == 200, resposta.text

        corpo_bruto = resposta.text
        assert "ip_hash" not in corpo_bruto
        assert "hash-falso-de-ip" not in corpo_bruto

    def test_lista_vazia_sem_pendentes(self, sessao_de_admin: TestClient) -> None:
        resposta = sessao_de_admin.get("/gestao/fotos")
        assert resposta.status_code == 200
        assert resposta.json() == {"fotos": []}

    def test_so_as_pendentes_aparecem_nao_aprovadas_nem_rejeitadas(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        from app.models.fotos import EstadoFoto, Foto

        _semear_pendente(sessao, id_foto=1001, criada_em=BASE)
        sessao.add(
            Foto(
                id=2002,
                ficheiro="00000000-0000-4000-8000-000000002002.webp",
                estado=EstadoFoto.APROVADA,
                descricao=None,
                enviada_por=None,
                ip_hash="hash-falso-de-ip-0000000000002002",
                criada_em=BASE,
                moderada_em=BASE,
            )
        )
        sessao.add(
            Foto(
                id=3003,
                ficheiro="00000000-0000-4000-8000-000000003003.webp",
                estado=EstadoFoto.REJEITADA,
                descricao=None,
                enviada_por=None,
                ip_hash="hash-falso-de-ip-0000000000003003",
                criada_em=BASE,
                moderada_em=BASE,
            )
        )
        sessao.commit()

        resposta = sessao_de_admin.get("/gestao/fotos")
        ids = {item["id"] for item in resposta.json()["fotos"]}

        assert ids == {1001}

    def test_ordem_e_a_de_chegada_com_empate_por_id(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        _semear_pendente(sessao, id_foto=2002, criada_em=BASE + timedelta(hours=1))
        _semear_pendente(sessao, id_foto=1001, criada_em=BASE)
        # empate: mesmo instante do 1001, id maior.
        _semear_pendente(sessao, id_foto=1002, criada_em=BASE)

        resposta = sessao_de_admin.get("/gestao/fotos")
        assert resposta.status_code == 200, resposta.text
        ids = [item["id"] for item in resposta.json()["fotos"]]

        assert ids == [1001, 1002, 2002]


class TestAprovarERejeitar:
    def test_aprovar_duas_vezes_e_409_na_segunda(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        _semear_pendente(sessao, id_foto=4004, criada_em=BASE)

        primeira = sessao_de_admin.post(
            "/gestao/fotos/4004/aprovar", headers=CABECALHO_MUTACAO
        )
        assert primeira.status_code == 200, primeira.text

        segunda = sessao_de_admin.post(
            "/gestao/fotos/4004/aprovar", headers=CABECALHO_MUTACAO
        )
        assert segunda.status_code == 409, segunda.text

    def test_rejeitar_duas_vezes_e_409_na_segunda(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        _semear_pendente(sessao, id_foto=5005, criada_em=BASE)

        primeira = sessao_de_admin.post(
            "/gestao/fotos/5005/rejeitar", headers=CABECALHO_MUTACAO
        )
        assert primeira.status_code == 200, primeira.text

        segunda = sessao_de_admin.post(
            "/gestao/fotos/5005/rejeitar", headers=CABECALHO_MUTACAO
        )
        assert segunda.status_code == 409, segunda.text

    def test_id_inexistente_e_404_para_aprovar_e_rejeitar(
        self, sessao_de_admin: TestClient
    ) -> None:
        """Um 404 de "não há foto com este id", não o 404 genérico de "a rota não existe".

        A guarda em `GET /gestao/fotos` primeiro é o que distingue os dois:
        sem ela, enquanto a rota de aprovar/rejeitar não estiver sequer
        registada, o 404 do Starlette (rota nenhuma corresponde) dava este
        teste por passado sem ter provado nada sobre o id.
        """
        guarda = sessao_de_admin.get("/gestao/fotos")
        assert guarda.status_code == 200, (
            f"a lista de moderação ainda não responde: {guarda.text}"
        )

        for acao in ("aprovar", "rejeitar"):
            resposta = sessao_de_admin.post(
                f"/gestao/fotos/999999/{acao}", headers=CABECALHO_MUTACAO
            )
            assert resposta.status_code == 404, f"{acao}: {resposta.text}"

    def test_imagem_de_id_inexistente_e_404(self, sessao_de_admin: TestClient) -> None:
        guarda = sessao_de_admin.get("/gestao/fotos")
        assert guarda.status_code == 200, (
            f"a lista de moderação ainda não responde: {guarda.text}"
        )

        resposta = sessao_de_admin.get("/gestao/fotos/999999/imagem")
        assert resposta.status_code == 404

    def test_rejeitar_apaga_os_bytes_mas_a_linha_fica(
        self, sessao_de_admin: TestClient, sessao: Session, cliente: TestClient
    ) -> None:
        """Decisão do Tomás, 5 de novembro de 2026: rejeitar apaga os bytes; a linha fica."""
        from app.config import obter_definicoes
        from app.models.fotos import EstadoFoto, Foto

        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
        assert resposta.status_code == 202, resposta.text
        linha = sessao.scalars(select(Foto)).one()
        id_foto, nome_ficheiro = linha.id, linha.ficheiro

        resposta_rejeitar = sessao_de_admin.post(
            f"/gestao/fotos/{id_foto}/rejeitar", headers=CABECALHO_MUTACAO
        )
        assert resposta_rejeitar.status_code == 200, resposta_rejeitar.text

        definicoes = obter_definicoes()
        assert not (definicoes.pendentes_dir / nome_ficheiro).exists()
        assert not (definicoes.media_dir / nome_ficheiro).exists()

        sessao.expire_all()
        linha_depois = sessao.get(Foto, id_foto)
        assert linha_depois is not None, "rejeitar não pode apagar a linha de `fotos`"
        assert linha_depois.estado == EstadoFoto.REJEITADA
