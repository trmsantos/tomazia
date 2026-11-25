"""F4-04b: `GET /gestao/fotos/aprovadas` e `DELETE /gestao/fotos/{id}` (a parte funcional).

O que é de segurança e de regra 10 (401, 403, ficheiro ausente, `unlink` a
falhar, `commit` a falhar) está em
`tests/seguranca/test_eliminar_foto_aprovada.py`. Aqui: os estados que não
se eliminam, o 404, a repetição, a ordem da lista e o OpenAPI.

**Decisões do Tomás (2026-11-24):** a lista traz as últimas aprovadas
primeiro (`moderada_em` descendente, `NULL` no fim, desempate por `id`
descendente); pendente e rejeitada dão `409 foto_nao_aprovada` (código
novo, não `foto_ja_moderada`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from tests.apoio_auth import CABECALHO_MUTACAO
from tests.apoio_fotos import semear_foto

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

BASE = datetime(2026, 6, 20, 10, 0, tzinfo=UTC)


def _apagar(cliente: TestClient, id_foto: int | str):  # type: ignore[no-untyped-def]
    return cliente.delete(f"/gestao/fotos/{id_foto}", headers=CABECALHO_MUTACAO)


def _ficheiros_de_disco() -> dict[str, list[str]]:
    from app.config import obter_definicoes

    definicoes = obter_definicoes()
    return {
        nome: sorted(p.name for p in pasta.iterdir()) if pasta.exists() else []
        for nome, pasta in (
            ("media", definicoes.media_dir),
            ("pendentes", definicoes.pendentes_dir),
        )
    }


def _linhas(motor: Engine) -> list[tuple[int, str]]:
    with motor.connect() as ligacao:
        return [
            (linha[0], str(linha[1]))
            for linha in ligacao.execute(
                text("SELECT id, estado FROM fotos ORDER BY id")
            ).all()
        ]


class TestEliminar:
    def test_pendente_da_409_e_nao_toca_em_ficheiros(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        semear_foto(sessao, id_foto=5001, estado="pendente")
        semear_foto(sessao, id_foto=5002, estado="aprovada")
        antes = _ficheiros_de_disco()
        assert antes["pendentes"], "o teste não provava nada sem o ficheiro pendente"

        resposta = _apagar(sessao_de_admin, 5001)

        assert resposta.status_code == 409, resposta.text
        corpo = resposta.json()
        assert corpo["erro"] == "foto_nao_aprovada"
        assert corpo["erro"] != "foto_ja_moderada"
        assert corpo["mensagem"].strip()
        assert _ficheiros_de_disco() == antes
        assert _linhas(motor) == [(5001, "pendente"), (5002, "aprovada")]

    def test_rejeitada_da_409_e_a_linha_fica(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        semear_foto(sessao, id_foto=5003, estado="rejeitada")
        semear_foto(sessao, id_foto=5004, estado="pendente")
        antes = _ficheiros_de_disco()

        resposta = _apagar(sessao_de_admin, 5003)

        assert resposta.status_code == 409, resposta.text
        assert resposta.json()["erro"] == "foto_nao_aprovada"
        assert _ficheiros_de_disco() == antes
        assert _linhas(motor) == [(5003, "rejeitada"), (5004, "pendente")]

    def test_id_inexistente_da_404(self, sessao_de_admin: TestClient) -> None:
        resposta = _apagar(sessao_de_admin, 987654)

        assert resposta.status_code == 404, resposta.text
        assert resposta.json()["erro"] == "foto_nao_encontrada"

    def test_id_que_nao_e_inteiro_da_422_com_o_envelope(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _apagar(sessao_de_admin, "abc")

        assert resposta.status_code == 422, resposta.text
        assert resposta.json()["erro"] == "dados_invalidos"

    def test_dois_delete_seguidos_dao_204_e_depois_404(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_foto(sessao, id_foto=5005, estado="aprovada")

        primeira = _apagar(sessao_de_admin, 5005)
        segunda = _apagar(sessao_de_admin, 5005)

        assert primeira.status_code == 204, primeira.text
        assert segunda.status_code == 404, segunda.text
        assert segunda.json()["erro"] == "foto_nao_encontrada"


class TestListaDeAprovadas:
    def test_sem_aprovadas_a_lista_e_vazia(self, sessao_de_admin: TestClient) -> None:
        resposta = sessao_de_admin.get("/gestao/fotos/aprovadas")

        assert resposta.status_code == 200, resposta.text
        assert resposta.json() == {"fotos": []}

    def test_so_aprovadas_e_com_os_campos_do_contrato(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_foto(sessao, id_foto=6001, estado="pendente")
        semear_foto(sessao, id_foto=6002, estado="rejeitada")
        semear_foto(
            sessao,
            id_foto=6003,
            estado="aprovada",
            descricao="Noite de samba",
            enviada_por="Ana",
            criada_em=BASE,
            moderada_em=BASE + timedelta(hours=1),
        )

        resposta = sessao_de_admin.get("/gestao/fotos/aprovadas")

        assert resposta.status_code == 200, resposta.text
        fotos = resposta.json()["fotos"]
        assert [f["id"] for f in fotos] == [6003]
        assert set(fotos[0]) == {
            "id",
            "ficheiro",
            "descricao",
            "enviada_por",
            "criada_em",
            "moderada_em",
        }
        assert fotos[0]["descricao"] == "Noite de samba"
        assert fotos[0]["enviada_por"] == "Ana"
        assert fotos[0]["ficheiro"] == f"{6003:032x}.webp"
        assert "ip_hash" not in resposta.text

    def test_ordem_moderada_em_desc_com_null_no_fim_e_empate_por_id_desc(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        # criada_em contrária de propósito: ordenar por ela daria outra ordem.
        semear_foto(
            sessao,
            id_foto=7001,
            estado="aprovada",
            criada_em=BASE + timedelta(days=9),
            moderada_em=BASE + timedelta(hours=1),
        )
        semear_foto(
            sessao,
            id_foto=7002,
            estado="aprovada",
            criada_em=BASE,
            moderada_em=BASE + timedelta(hours=3),
        )
        # empate com a 7002 no instante: o id maior vem primeiro.
        semear_foto(
            sessao,
            id_foto=7003,
            estado="aprovada",
            criada_em=BASE + timedelta(days=1),
            moderada_em=BASE + timedelta(hours=3),
        )
        # NULL no fim, mesmo com id maior; e entre NULL, id descendente.
        semear_foto(sessao, id_foto=7004, estado="aprovada", moderada_em=None)
        semear_foto(sessao, id_foto=7005, estado="aprovada", moderada_em=None)
        semear_foto(sessao, id_foto=7006, estado="pendente")

        resposta = sessao_de_admin.get("/gestao/fotos/aprovadas")

        assert resposta.status_code == 200, resposta.text
        assert [f["id"] for f in resposta.json()["fotos"]] == [
            7003,
            7002,
            7001,
            7005,
            7004,
        ]


class TestOpenApi:
    def _operacao(self, metodo: str, caminho: str) -> dict[str, Any]:
        from app.main import criar_app

        esquema = criar_app().openapi()
        assert caminho in esquema["paths"], f"{caminho} não está no OpenAPI"
        operacoes = esquema["paths"][caminho]
        assert metodo in operacoes, f"{metodo} {caminho} não está no OpenAPI"
        operacao: dict[str, Any] = operacoes[metodo]
        return operacao

    def test_delete_documenta_204_401_404_409_422_e_500(self) -> None:
        respostas = self._operacao("delete", "/gestao/fotos/{id}")["responses"]

        assert {"204", "401", "404", "409", "422", "500"} <= set(respostas)
        for codigo in ("401", "404", "409", "500"):
            ref = respostas[codigo]["content"]["application/json"]["schema"]["$ref"]
            assert ref.endswith("/RespostaDeErro"), (codigo, ref)

    def test_a_lista_documenta_200_e_401(self) -> None:
        respostas = self._operacao("get", "/gestao/fotos/aprovadas")["responses"]

        assert {"200", "401"} <= set(respostas)
