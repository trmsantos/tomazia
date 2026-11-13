"""`GET /gestao/clientes` e `DELETE /gestao/clientes/{id}` (F2-05c).

`{clientes: list[ClienteGestao]}`, do mais recente para o mais antigo
(`criado_em` descendente, desempate por `id` descendente);
`ClienteGestao {id, nome, email, telemovel, consentimento_em, versao_termos,
criado_em}` e **nunca** o `token_cancelar`.

O `DELETE` apaga **mesmo** (eliminação a pedido, RGPD): 204, e o registo
desaparece da base de dados e da lista; um id que não existe é 404
`cliente_inexistente`. A inscrição pública é da F2-07: aqui os clientes
semeiam-se à mão.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CAMPOS_DO_CLIENTE,
    CRIADO_EM_DA_ANA,
    CRIADO_EM_DO_RUI,
    ID_CLI_ANA,
    ID_CLI_RUI,
    exigir_erro,
    fotografia,
    semear_cliente_com,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session


def _lista(cliente: TestClient) -> list[dict[str, Any]]:
    resposta = cliente.get("/gestao/clientes")
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert set(corpo) == {"clientes"}
    lista: list[dict[str, Any]] = corpo["clientes"]
    return lista


def _instante(texto: str) -> datetime:
    valor = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    assert valor.tzinfo is not None, f"{texto!r} sem fuso"
    return valor


class TestLista:
    def test_sem_clientes_e_uma_lista_vazia(self, sessao_de_admin: TestClient) -> None:
        assert _lista(sessao_de_admin) == []

    def test_cada_cliente_tem_exatamente_os_campos_do_esquema(
        self, gestao: TestClient
    ) -> None:
        clientes = _lista(gestao)
        assert len(clientes) == 2
        for cliente in clientes:
            assert set(cliente) == CAMPOS_DO_CLIENTE

    def test_os_valores_saem_tal_e_qual_e_o_telemovel_ausente_e_null(
        self, gestao: TestClient
    ) -> None:
        por_id = {c["id"]: c for c in _lista(gestao)}
        ana, rui = por_id[ID_CLI_ANA], por_id[ID_CLI_RUI]
        assert (ana["nome"], ana["email"], ana["telemovel"]) == (
            "Ana Exemplo",
            "ana@exemplo.test",
            "912345678",
        )
        assert ana["versao_termos"] == "1"
        assert _instante(ana["criado_em"]) == CRIADO_EM_DA_ANA
        assert _instante(ana["consentimento_em"]) == CRIADO_EM_DA_ANA
        assert rui["telemovel"] is None
        assert _instante(rui["criado_em"]) == CRIADO_EM_DO_RUI

    def test_ordem_por_criado_em_descendente_e_depois_id_descendente(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        base = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
        # Ids que não condizem com a ordem do tempo, e um empate.
        semear_cliente_com(sessao, 5, criado_em=base)
        semear_cliente_com(sessao, 9, criado_em=base - timedelta(days=3))
        semear_cliente_com(sessao, 2, criado_em=base + timedelta(days=1))
        semear_cliente_com(sessao, 7, criado_em=base)
        assert [c["id"] for c in _lista(sessao_de_admin)] == [2, 7, 5, 9]

    def test_a_lista_inclui_todos_sem_paginacao(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        for i in range(1, 121):
            semear_cliente_com(
                sessao, i, criado_em=CRIADO_EM_DA_ANA + timedelta(hours=i)
            )
        assert len(_lista(sessao_de_admin)) == 120


class TestEliminar:
    def test_apaga_mesmo_204_e_o_registo_desaparece(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        resposta = gestao.delete(
            f"/gestao/clientes/{ID_CLI_ANA}", headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 204, resposta.text
        assert resposta.content == b""
        assert [c["id"] for c in _lista(gestao)] == [ID_CLI_RUI]
        with motor.connect() as ligacao:
            restantes = ligacao.execute(text("SELECT id FROM clientes")).scalars().all()
        assert list(restantes) == [ID_CLI_RUI], "RGPD: a linha apaga-se, não se marca"

    def test_so_apaga_o_pedido_e_nada_mais(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        gestao.delete(f"/gestao/clientes/{ID_CLI_ANA}", headers=CABECALHO_MUTACAO)
        depois = fotografia(motor)
        assert depois["clientes"] == [
            linha for linha in antes["clientes"] if linha[0] != ID_CLI_ANA
        ]
        for tabela in ("categorias", "produtos", "eventos", "definicoes"):
            assert depois[tabela] == antes[tabela]

    def test_inexistente_e_404_cliente_inexistente(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = gestao.delete("/gestao/clientes/999", headers=CABECALHO_MUTACAO)
        exigir_erro(resposta, 404, "cliente_inexistente")
        assert fotografia(motor) == antes

    def test_apagar_duas_vezes_a_segunda_e_404(self, gestao: TestClient) -> None:
        url = f"/gestao/clientes/{ID_CLI_RUI}"
        assert gestao.delete(url, headers=CABECALHO_MUTACAO).status_code == 204
        exigir_erro(
            gestao.delete(url, headers=CABECALHO_MUTACAO), 404, "cliente_inexistente"
        )

    def test_id_que_nao_e_inteiro_e_422(self, gestao: TestClient) -> None:
        resposta = gestao.delete("/gestao/clientes/abc", headers=CABECALHO_MUTACAO)
        exigir_erro(resposta, 422, "dados_invalidos")

    def test_o_email_apagado_pode_voltar_a_inscrever_se_na_bd(
        self, gestao: TestClient, sessao: Session
    ) -> None:
        """A unicidade do email acabou com a linha: nada de resíduo."""
        apagado = gestao.delete(
            f"/gestao/clientes/{ID_CLI_ANA}", headers=CABECALHO_MUTACAO
        )
        assert apagado.status_code == 204, apagado.text
        semear_cliente_com(
            sessao, 77, email="ana@exemplo.test", criado_em=CRIADO_EM_DA_ANA
        )
        assert 77 in [c["id"] for c in _lista(gestao)]
