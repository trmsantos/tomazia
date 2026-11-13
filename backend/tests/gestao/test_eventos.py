"""`GET/POST/PATCH/DELETE /gestao/eventos` (F2-05b).

Contrato fixado pelo plano e pelos ADR 0009, 0010 e 0015:

- `GET` devolve `{proximos, rascunhos, arquivo}`, calculadas no servidor com
  o corte `inicio_do_dia_do_bar(agora_utc())`;
- criar exige data **com fuso** (ADR 0009); sem fuso é 422 e nunca 500;
- publicar sem data é 422 `evento_sem_data` com `campo="inicio"`;
- um 404 é `evento_inexistente`.

O relógio fixa-se com `fixar_relogio_gestao` (ver `tests/apoio_gestao.py`),
no verão, de propósito: é a única altura em que o corte do dia do bar
(`23:00Z`) difere do corte em UTC (`00:00Z`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CAMPOS_DO_EVENTO,
    ID_EVT_PUBLICADO,
    ID_EVT_RASCUNHO_SEM_DATA,
    INICIO_DO_EVT_PUBLICADO,
    MAIOR_ID_DO_SQLITE,
    exigir_erro,
    fixar_relogio_gestao,
    fotografia,
    semear_evento,
)
from tests.apoio_publico import exigir_relogio_lido

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

LISBOA = ZoneInfo("Europe/Lisbon")
INICIO_VALIDO = "2099-07-02T21:00:00Z"


def _criar(cliente: TestClient, **campos: Any) -> Any:
    corpo: dict[str, Any] = {"titulo": "Noite de fados", "inicio": INICIO_VALIDO}
    corpo.update(campos)
    return cliente.post("/gestao/eventos", json=corpo, headers=CABECALHO_MUTACAO)


def _alterar(cliente: TestClient, identificador: int, corpo: dict[str, Any]) -> Any:
    return cliente.patch(
        f"/gestao/eventos/{identificador}", json=corpo, headers=CABECALHO_MUTACAO
    )


def _listas(cliente: TestClient) -> dict[str, list[dict[str, Any]]]:
    resposta = cliente.get("/gestao/eventos")
    assert resposta.status_code == 200, resposta.text
    corpo: dict[str, list[dict[str, Any]]] = resposta.json()
    return corpo


def _ids(lista: list[dict[str, Any]]) -> list[int]:
    return [evento["id"] for evento in lista]


def _instante(texto: str) -> datetime:
    return datetime.fromisoformat(texto)


class TestForma:
    def test_a_resposta_tem_as_tres_listas(self, gestao: TestClient) -> None:
        corpo = _listas(gestao)
        assert set(corpo) == {"proximos", "rascunhos", "arquivo"}

    def test_cada_evento_tem_exatamente_os_campos_do_esquema(
        self, gestao: TestClient
    ) -> None:
        corpo = _listas(gestao)
        for lista in corpo.values():
            for evento in lista:
                assert set(evento) == CAMPOS_DO_EVENTO

    def test_o_cenario_cai_nas_listas_certas(self, gestao: TestClient) -> None:
        corpo = _listas(gestao)
        assert _ids(corpo["proximos"]) == [ID_EVT_PUBLICADO]
        assert _ids(corpo["rascunhos"]) == [ID_EVT_RASCUNHO_SEM_DATA]
        assert corpo["arquivo"] == []
        publicado = corpo["proximos"][0]
        assert publicado["titulo"] == "Noite de jazz"
        assert publicado["descricao"] == "Entrada livre"
        assert publicado["imagem"] == "cartaz.webp"
        assert publicado["publicado"] is True
        assert _instante(publicado["inicio"]) == INICIO_DO_EVT_PUBLICADO
        sem_data = corpo["rascunhos"][0]
        assert sem_data["inicio"] is None
        assert sem_data["publicado"] is False

    def test_sem_eventos_as_tres_listas_vem_vazias(
        self, sessao_de_admin: TestClient
    ) -> None:
        assert _listas(sessao_de_admin) == {
            "proximos": [],
            "rascunhos": [],
            "arquivo": [],
        }


class TestDivisaoDasListasComRelogioFixo:
    """O corte do ADR 0010, calculado pelo servidor.

    Agora = 15/07/2026 09:00 de Lisboa. O corte é a meia-noite de Lisboa
    desse dia: `2026-07-14T23:00:00Z`. Os eventos às 23:59 e às 00:30 de
    Lisboa ficam de lados opostos da fronteira, e o das 00:00 em ponto fica
    do lado de dentro (`>=`).
    """

    AGORA = datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)

    @pytest.fixture
    def cenario(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> TestClient:
        def lisboa(
            mes: int, dia: int, hora: int, minuto: int = 0, segundo: int = 0
        ) -> datetime:
            return datetime(2026, mes, dia, hora, minuto, segundo, tzinfo=LISBOA)

        publicados = {
            # arquivo (antes do corte)
            401: lisboa(7, 14, 23, 59),
            407: lisboa(6, 1, 22),
            408: lisboa(6, 1, 22),  # empata com 407: desempata o id
            # próximos (a partir do corte, inclusive)
            402: lisboa(7, 15, 0, 30),
            403: lisboa(7, 15, 0, 0),
            405: lisboa(7, 20, 21),
            409: lisboa(7, 22, 21),
            410: lisboa(7, 22, 21),  # empata com 409
        }
        for identificador, inicio in publicados.items():
            semear_evento(sessao, identificador, inicio=inicio, publicado=True)
        # rascunhos: com ou sem data, passada ou futura; nunca em próximos/arquivo
        semear_evento(sessao, 420, inicio=lisboa(7, 1, 22), publicado=False)
        semear_evento(sessao, 421, inicio=lisboa(7, 30, 22), publicado=False)
        semear_evento(sessao, 422, inicio=None, publicado=False)
        semear_evento(sessao, 423, inicio=None, publicado=False)
        semear_evento(sessao, 424, inicio=lisboa(7, 30, 22), publicado=False)
        self.relogio = fixar_relogio_gestao(monkeypatch, self.AGORA)
        return sessao_de_admin

    def test_proximos_a_partir_do_corte_por_inicio_e_depois_id(
        self, cenario: TestClient
    ) -> None:
        corpo = _listas(cenario)
        exigir_relogio_lido(self.relogio)
        assert _ids(corpo["proximos"]) == [403, 402, 405, 409, 410]

    def test_o_evento_das_23_59_de_ontem_esta_no_arquivo(
        self, cenario: TestClient
    ) -> None:
        corpo = _listas(cenario)
        exigir_relogio_lido(self.relogio)
        assert 401 in _ids(corpo["arquivo"])
        assert 401 not in _ids(corpo["proximos"])

    def test_o_evento_das_00_30_de_hoje_nao_esta_no_arquivo(
        self, cenario: TestClient
    ) -> None:
        """Com o corte em UTC (`00:00Z`), este evento cairia no arquivo às 01:00."""
        corpo = _listas(cenario)
        exigir_relogio_lido(self.relogio)
        assert 402 in _ids(corpo["proximos"])
        assert 402 not in _ids(corpo["arquivo"])

    def test_arquivo_por_inicio_descendente_e_depois_id(
        self, cenario: TestClient
    ) -> None:
        corpo = _listas(cenario)
        exigir_relogio_lido(self.relogio)
        assert _ids(corpo["arquivo"]) == [401, 407, 408]

    def test_rascunhos_por_inicio_com_os_sem_data_no_fim_e_depois_id(
        self, cenario: TestClient
    ) -> None:
        corpo = _listas(cenario)
        exigir_relogio_lido(self.relogio)
        assert _ids(corpo["rascunhos"]) == [420, 421, 424, 422, 423]

    def test_cada_evento_esta_numa_so_lista(self, cenario: TestClient) -> None:
        corpo = _listas(cenario)
        todos = [i for lista in corpo.values() for i in _ids(lista)]
        assert len(todos) == len(set(todos)) == 8 + 5


class TestCriar:
    def test_cria_com_os_valores_por_omissao(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        resposta = _criar(sessao_de_admin)
        assert resposta.status_code == 201, resposta.text
        corpo = resposta.json()
        assert set(corpo) == CAMPOS_DO_EVENTO
        assert corpo["titulo"] == "Noite de fados"
        assert _instante(corpo["inicio"]) == datetime(2099, 7, 2, 21, 0, tzinfo=UTC)
        assert corpo["descricao"] is None
        assert corpo["imagem"] is None
        assert corpo["publicado"] is False
        assert isinstance(corpo["id"], int)
        with motor.connect() as ligacao:
            linhas = ligacao.execute(text("SELECT id, publicado FROM eventos")).all()
        assert [tuple(linha) for linha in linhas] == [(corpo["id"], 0)]

    def test_publicar_ao_criar_aparece_nos_proximos_e_no_site_publico(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _criar(sessao_de_admin, publicado=True)
        assert resposta.status_code == 201, resposta.text
        identificador = resposta.json()["id"]
        assert _ids(_listas(sessao_de_admin)["proximos"]) == [identificador]
        assert _ids(sessao_de_admin.get("/eventos").json()["eventos"]) == [
            identificador
        ]

    def test_o_rascunho_nao_aparece_no_site_publico(
        self, sessao_de_admin: TestClient
    ) -> None:
        assert _criar(sessao_de_admin).status_code == 201
        assert sessao_de_admin.get("/eventos").json()["eventos"] == []

    def test_a_data_com_deslocamento_guarda_o_mesmo_instante(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _criar(sessao_de_admin, inicio="2099-07-02T22:00:00+01:00")
        assert resposta.status_code == 201, resposta.text
        assert _instante(resposta.json()["inicio"]) == datetime(
            2099, 7, 2, 21, 0, tzinfo=UTC
        )

    def test_apara_o_titulo_e_a_descricao(self, sessao_de_admin: TestClient) -> None:
        resposta = _criar(sessao_de_admin, titulo="  Fados  ", descricao="  Ao vivo  ")
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["titulo"] == "Fados"
        assert resposta.json()["descricao"] == "Ao vivo"

    @pytest.mark.parametrize("vazia", ["", "   "])
    def test_descricao_vazia_passa_a_null(
        self, sessao_de_admin: TestClient, vazia: str
    ) -> None:
        resposta = _criar(sessao_de_admin, descricao=vazia)
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["descricao"] is None

    def test_os_limites_de_comprimento_passam(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _criar(sessao_de_admin, titulo="t" * 120, descricao="d" * 1000)
        assert resposta.status_code == 201, resposta.text

    def test_criar_sem_data_e_422(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        """ADR 0009: a data é obrigatória ao criar."""
        antes = fotografia(motor)
        resposta = sessao_de_admin.post(
            "/gestao/eventos", json={"titulo": "Sem data"}, headers=CABECALHO_MUTACAO
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo="inicio")
        assert fotografia(motor) == antes

    def test_criar_com_data_nula_e_422(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = _criar(sessao_de_admin, inicio=None)
        exigir_erro(resposta, 422, "dados_invalidos", campo="inicio")
        assert fotografia(motor) == antes

    @pytest.mark.parametrize(
        "inicio",
        ["2099-07-02T21:00:00", "2099-07-02", "2099-07-02 21:00:00", "amanhã", 0],
    )
    def test_data_sem_fuso_ou_mal_formada_e_422_e_nunca_500(
        self, gestao_sem_excecoes: TestClient, motor: Engine, inicio: Any
    ) -> None:
        """O `DataHoraUTC` recusa um `datetime` ingénuo na gravação: seria 500."""
        antes = fotografia(motor)
        resposta = _criar(gestao_sem_excecoes, inicio=inicio)
        exigir_erro(resposta, 422, "dados_invalidos", campo="inicio")
        assert fotografia(motor) == antes

    @pytest.mark.parametrize(
        "campo,valor",
        [
            ("titulo", ""),
            ("titulo", "   "),
            ("titulo", "t" * 121),
            ("titulo", None),
            ("titulo", 5),
            ("descricao", "d" * 1001),
            ("descricao", 5),
            ("publicado", "true"),
            ("publicado", 1),
            ("publicado", None),
        ],
    )
    def test_campo_invalido_e_422_com_o_nome_do_campo(
        self,
        sessao_de_admin: TestClient,
        motor: Engine,
        campo: str,
        valor: Any,
    ) -> None:
        antes = fotografia(motor)
        resposta = _criar(sessao_de_admin, **{campo: valor})
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
        assert fotografia(motor) == antes

    def test_sem_titulo_e_422(self, sessao_de_admin: TestClient) -> None:
        resposta = sessao_de_admin.post(
            "/gestao/eventos",
            json={"inicio": INICIO_VALIDO},
            headers=CABECALHO_MUTACAO,
        )
        exigir_erro(resposta, 422, "dados_invalidos", campo="titulo")

    def test_a_imagem_nao_se_aceita_no_post(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = _criar(sessao_de_admin, imagem="cartaz.webp")
        exigir_erro(resposta, 422, "dados_invalidos", campo="imagem")
        assert fotografia(motor) == antes


class TestAlterar:
    def test_muda_so_o_que_vem_no_corpo(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {"titulo": "  Jazz de quinta "})
        assert resposta.status_code == 200, resposta.text
        corpo = resposta.json()
        assert set(corpo) == CAMPOS_DO_EVENTO
        assert corpo["titulo"] == "Jazz de quinta"
        assert corpo["descricao"] == "Entrada livre"
        assert corpo["imagem"] == "cartaz.webp"
        assert corpo["publicado"] is True
        assert _instante(corpo["inicio"]) == INICIO_DO_EVT_PUBLICADO

    def test_patch_vazio_e_200_e_nao_muda_nada(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["id"] == ID_EVT_PUBLICADO
        assert fotografia(motor) == antes

    def test_altera_a_data_com_fuso(self, gestao: TestClient) -> None:
        resposta = _alterar(
            gestao, ID_EVT_PUBLICADO, {"inicio": "2099-08-01T23:30:00+01:00"}
        )
        assert resposta.status_code == 200, resposta.text
        assert _instante(resposta.json()["inicio"]) == datetime(
            2099, 8, 1, 22, 30, tzinfo=UTC
        )

    def test_descricao_null_apaga_a_descricao(self, gestao: TestClient) -> None:
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {"descricao": None})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["descricao"] is None

    def test_descricao_vazia_passa_a_null(self, gestao: TestClient) -> None:
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {"descricao": "  "})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["descricao"] is None

    def test_a_imagem_continua_igual_depois_de_alterar_outra_coisa(
        self, gestao: TestClient
    ) -> None:
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {"titulo": "Outro"})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["imagem"] == "cartaz.webp"

    def test_despublicar_e_possivel_e_tira_do_site_publico(
        self, gestao: TestClient
    ) -> None:
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {"publicado": False})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["publicado"] is False
        assert gestao.get("/eventos").json()["eventos"] == []
        assert _ids(_listas(gestao)["rascunhos"]) == [
            ID_EVT_PUBLICADO,
            ID_EVT_RASCUNHO_SEM_DATA,
        ]

    def test_um_rascunho_sem_data_edita_se_sem_lhe_por_data(
        self, gestao: TestClient
    ) -> None:
        """Um rascunho importado sem data não fica bloqueado."""
        resposta = _alterar(
            gestao,
            ID_EVT_RASCUNHO_SEM_DATA,
            {"titulo": "Já tem nome", "descricao": "x"},
        )
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["inicio"] is None
        assert resposta.json()["publicado"] is False

    def test_publicar_um_rascunho_com_data_e_200(
        self, gestao: TestClient, sessao: Session
    ) -> None:
        semear_evento(
            sessao,
            350,
            inicio=datetime(2099, 9, 1, 20, 0, tzinfo=UTC),
            publicado=False,
        )
        resposta = _alterar(gestao, 350, {"publicado": True})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["publicado"] is True

    def test_publicar_um_rascunho_sem_data_e_422_evento_sem_data(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        """ADR 0009, pelo caminho do `UPDATE`."""
        antes = fotografia(motor)
        resposta = _alterar(gestao, ID_EVT_RASCUNHO_SEM_DATA, {"publicado": True})
        exigir_erro(resposta, 422, "evento_sem_data", campo="inicio")
        assert fotografia(motor) == antes

    def test_publicar_e_dar_data_no_mesmo_pedido_e_200(
        self, gestao: TestClient
    ) -> None:
        resposta = _alterar(
            gestao,
            ID_EVT_RASCUNHO_SEM_DATA,
            {"publicado": True, "inicio": "2099-09-01T20:00:00Z"},
        )
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["publicado"] is True
        assert _instante(resposta.json()["inicio"]) == datetime(
            2099, 9, 1, 20, 0, tzinfo=UTC
        )

    def test_o_check_da_bd_nunca_chega_a_500(
        self, gestao_sem_excecoes: TestClient, motor: Engine
    ) -> None:
        """Se o `CHECK` rebentar (corrida entre o pedido e o `UPDATE`), é o mesmo 422.

        Um *trigger* simula a corrida: depois de qualquer `UPDATE` a `inicio`
        fica a `NULL` num evento publicado, e o `CHECK
        ck_eventos_publicado_exige_inicio` rebenta **dentro** do `UPDATE`,
        depois de a fronteira já ter deixado passar o pedido. O serviço tem
        de mapear o `IntegrityError` pelo **nome** do constraint (ADR 0009).
        """
        with motor.begin() as ligacao:
            ligacao.execute(
                text(
                    "CREATE TRIGGER simula_corrida AFTER UPDATE ON eventos "
                    "BEGIN UPDATE eventos SET inicio = NULL WHERE id = NEW.id; END"
                )
            )
        antes = fotografia(motor)
        resposta = _alterar(gestao_sem_excecoes, ID_EVT_PUBLICADO, {"titulo": "Outro"})
        exigir_erro(resposta, 422, "evento_sem_data", campo="inicio")
        assert fotografia(motor) == antes

    def test_o_constraint_chama_se_como_o_adr_0009_diz(self, motor: Engine) -> None:
        with motor.connect() as ligacao:
            ddl = ligacao.execute(
                text("SELECT sql FROM sqlite_master WHERE name = 'eventos'")
            ).scalar_one()
        assert "ck_eventos_publicado_exige_inicio" in ddl

    @pytest.mark.parametrize(
        "corpo,campo",
        [
            ({"inicio": None}, "inicio"),
            ({"titulo": None}, "titulo"),
            ({"publicado": None}, "publicado"),
            ({"titulo": ""}, "titulo"),
            ({"titulo": "t" * 121}, "titulo"),
            ({"descricao": "d" * 1001}, "descricao"),
            ({"inicio": "2099-07-02T21:00:00"}, "inicio"),
            ({"inicio": "2099-07-02"}, "inicio"),
            ({"publicado": "false"}, "publicado"),
            ({"imagem": "outra.webp"}, "imagem"),
        ],
    )
    def test_corpo_invalido_e_422_e_nada_muda(
        self,
        gestao_sem_excecoes: TestClient,
        motor: Engine,
        corpo: dict[str, Any],
        campo: str,
    ) -> None:
        """`inicio: null` explícito é 422: não se apaga uma data."""
        antes = fotografia(motor)
        resposta = _alterar(gestao_sem_excecoes, ID_EVT_PUBLICADO, corpo)
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
        assert fotografia(motor) == antes

    def test_evento_inexistente_e_404(self, gestao: TestClient, motor: Engine) -> None:
        antes = fotografia(motor)
        resposta = _alterar(gestao, 999, {"titulo": "X"})
        exigir_erro(resposta, 404, "evento_inexistente")
        assert fotografia(motor) == antes

    def test_o_maior_id_valido_e_404(self, gestao: TestClient) -> None:
        resposta = _alterar(gestao, MAIOR_ID_DO_SQLITE, {"titulo": "X"})
        exigir_erro(resposta, 404, "evento_inexistente")


class TestEliminar:
    def test_elimina_e_so_esse(self, gestao: TestClient, motor: Engine) -> None:
        resposta = gestao.delete(
            f"/gestao/eventos/{ID_EVT_PUBLICADO}", headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 204, resposta.text
        assert resposta.content == b""
        corpo = _listas(gestao)
        assert corpo["proximos"] == []
        assert _ids(corpo["rascunhos"]) == [ID_EVT_RASCUNHO_SEM_DATA]
        assert gestao.get("/eventos").json()["eventos"] == []

    def test_eliminar_duas_vezes_da_404(self, gestao: TestClient) -> None:
        url = f"/gestao/eventos/{ID_EVT_RASCUNHO_SEM_DATA}"
        assert gestao.delete(url, headers=CABECALHO_MUTACAO).status_code == 204
        exigir_erro(
            gestao.delete(url, headers=CABECALHO_MUTACAO), 404, "evento_inexistente"
        )

    def test_inexistente_e_404_e_nada_muda(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        resposta = gestao.delete("/gestao/eventos/999", headers=CABECALHO_MUTACAO)
        exigir_erro(resposta, 404, "evento_inexistente")
        assert fotografia(motor) == antes


class TestInicioSoAceitaIsoComFuso:
    """Texto só com algarismos seria lido pelo Pydantic como timestamp."""

    @pytest.mark.parametrize("texto", ["1700000000", "253402300800", "  123 ", "0"])
    def test_numero_em_texto_e_422_no_post(
        self, sessao_de_admin: TestClient, motor: Engine, texto: str
    ) -> None:
        antes = fotografia(motor)
        resposta = _criar(sessao_de_admin, inicio=texto)
        exigir_erro(resposta, 422, "dados_invalidos", campo="inicio")
        assert fotografia(motor) == antes

    @pytest.mark.parametrize("texto", ["1700000000", "253402300800", "  123 ", "0"])
    def test_numero_em_texto_e_422_no_patch(
        self, gestao: TestClient, motor: Engine, texto: str
    ) -> None:
        antes = fotografia(motor)
        resposta = _alterar(gestao, ID_EVT_PUBLICADO, {"inicio": texto})
        exigir_erro(resposta, 422, "dados_invalidos", campo="inicio")
        assert fotografia(motor) == antes

    @pytest.mark.parametrize(
        "texto",
        [
            "2099-07-02T21:00:00Z",
            "2099-07-02T21:00:00+01:00",
            "2099-07-02 21:00:00+00:00",
        ],
    )
    def test_iso_com_fuso_continua_a_passar(
        self, sessao_de_admin: TestClient, texto: str
    ) -> None:
        assert _criar(sessao_de_admin, inicio=texto).status_code == 201
