"""`GET` e `PUT /gestao/definicoes` (F2-05c).

`DefinicoesGestao {wifi_rede, wifi_password, morada, telefone, instagram,
maps_url, horario, horario_estado}`; o `PUT` leva as mesmas sete primeiras,
**todas obrigatórias** (substitui o conjunto), numa só transação.

- `horario_estado` cumpre o ADR 0011: `nao_configurado` (chave ausente),
  `invalido` (existe mas não valida) e `configurado`. O `/info` público dá
  `null` aos dois primeiros; a gestão **distingue-os** (regra 10).
- Na gestão, texto vazio vai como `""`; o público vê `null`.
- `horario: null` no `PUT` = "não configurado" e **apaga a chave**.
- Escrita mais estrita que a leitura: os sete dias, cada um uma vez; dia
  repetido e períodos sobrepostos no mesmo dia são 422. Aceita os dias por
  qualquer ordem e a leitura devolve-os de segunda a domingo.
- Comprimentos (escolha desta bateria; o plano deu 200 e "ex. 500"): 200 nos
  campos de uma linha, 500 nos dois endereços; um dia aceita 3 períodos e
  recusa 24 (o teto exato fica entre os dois).
- `PUT` seguido de `GET /info`: o WiFi novo aparece (critério do lado do
  backend da F4-05).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CAMPOS_DAS_DEFINICOES,
    CORPOS_VALIDOS,
    DIAS_DA_SEMANA,
    definicoes_na_bd,
    exigir_erro,
    fotografia,
    semana,
    semear_definicoes,
)
from tests.apoio_publico import TEXTO_PERIGOSO

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

ROTA = "/gestao/definicoes"
VALIDO: dict[str, Any] = CORPOS_VALIDOS[("PUT", ROTA)]
CAMPOS_DE_TEXTO = ("wifi_rede", "wifi_password", "morada", "telefone")
CAMPOS_DE_ENDERECO = ("instagram", "maps_url")


def _put(cliente: TestClient, corpo: dict[str, Any]) -> Any:
    return cliente.put(ROTA, json=corpo, headers=CABECALHO_MUTACAO)


def _get(cliente: TestClient) -> dict[str, Any]:
    resposta = cliente.get(ROTA)
    assert resposta.status_code == 200, resposta.text
    corpo: dict[str, Any] = resposta.json()
    return corpo


class TestLeitura:
    def test_sem_nada_guardado_os_textos_sao_vazios_e_o_horario_nao_esta_configurado(
        self, sessao_de_admin: TestClient
    ) -> None:
        corpo = _get(sessao_de_admin)
        assert set(corpo) == CAMPOS_DAS_DEFINICOES
        for campo in (*CAMPOS_DE_TEXTO, *CAMPOS_DE_ENDERECO):
            assert corpo[campo] == "", f'{campo}: a gestão mostra `""`, não null'
        assert corpo["horario"] is None
        assert corpo["horario_estado"] == "nao_configurado"

    def test_os_valores_guardados_saem_tal_e_qual(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_definicoes(
            sessao,
            {
                "wifi_rede": "Rede de Teste",
                "wifi_password": "senha-de-teste-123",
                "morada": "Rua A, 1",
                "telefone": "234111222",
                "instagram": "https://www.instagram.com/x",
                "maps_url": "https://maps.example.test/x",
                "horario": json.dumps(VALIDO["horario"]),
            },
        )
        corpo = _get(sessao_de_admin)
        assert corpo["wifi_rede"] == "Rede de Teste"
        assert corpo["wifi_password"] == "senha-de-teste-123", "o dono vê-a"
        assert corpo["morada"] == "Rua A, 1"
        assert corpo["telefone"] == "234111222"
        assert corpo["instagram"] == "https://www.instagram.com/x"
        assert corpo["maps_url"] == "https://maps.example.test/x"
        assert corpo["horario"] == VALIDO["horario"]
        assert corpo["horario_estado"] == "configurado"

    def test_um_valor_vazio_guardado_sai_como_string_vazia(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_definicoes(sessao, {"telefone": "", "morada": "Rua A"})
        corpo = _get(sessao_de_admin)
        assert corpo["telefone"] == ""
        assert corpo["morada"] == "Rua A"

    def test_chaves_que_nao_sao_as_sete_nao_saem(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_definicoes(sessao, {"chave_interna": "MARCADOR-INTERNO"})
        resposta = sessao_de_admin.get(ROTA)
        assert resposta.status_code == 200
        assert "MARCADOR-INTERNO" not in resposta.text
        assert set(resposta.json()) == CAMPOS_DAS_DEFINICOES

    def test_o_horario_incompleto_sai_normalizado_com_os_sete_dias(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        """ADR 0011: o que faltar sai com `periodos: []`; o estado é `configurado`."""
        semear_definicoes(
            sessao,
            {
                "horario": json.dumps(
                    [
                        {
                            "dia": "sexta",
                            "periodos": [{"abre": "17:00", "fecha": "02:00"}],
                        }
                    ]
                )
            },
        )
        corpo = _get(sessao_de_admin)
        assert corpo["horario_estado"] == "configurado"
        assert corpo["horario"] == semana(sexta=[("17:00", "02:00")])


INVALIDOS_GUARDADOS = [
    "isto não é json",
    "{}",
    '{"dia": "segunda"}',
    '[{"dia": "segunda", "periodos": [{"abre": "25:00", "fecha": "02:00"}]}]',
    '[{"dia": "segunda", "periodos": [{"abre": "17:00", "fecha": "17:00"}]}]',
    '[{"dia": "feriado", "periodos": []}]',
    "[" * 20000,
]


class TestEstadoDoHorario:
    @pytest.mark.parametrize(
        "valor", INVALIDOS_GUARDADOS, ids=[v[:25] for v in INVALIDOS_GUARDADOS]
    )
    def test_um_horario_que_nao_valida_e_invalido_e_nao_um_500(
        self, gestao_sem_excecoes: TestClient, sessao: Session, valor: str
    ) -> None:
        semear_definicoes(sessao, {"horario": valor, "morada": "Rua A"})
        resposta = gestao_sem_excecoes.get(ROTA)
        assert resposta.status_code == 200, resposta.text
        corpo = resposta.json()
        assert corpo["horario"] is None
        assert corpo["horario_estado"] == "invalido"
        assert corpo["morada"] == "Rua A", "um horário mau não leva o resto atrás"

    def test_o_publico_nao_distingue_a_gestao_distingue(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        """A exceção consciente do ADR 0011, vista dos dois lados."""
        assert _get(sessao_de_admin)["horario_estado"] == "nao_configurado"
        assert sessao_de_admin.get("/info").json()["horario"] is None

        semear_definicoes(sessao, {"horario": "isto não é json"})
        assert _get(sessao_de_admin)["horario_estado"] == "invalido"
        assert sessao_de_admin.get("/info").json()["horario"] is None

    def test_um_put_corrige_um_horario_invalido(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_definicoes(sessao, {"horario": "isto não é json"})
        assert _put(sessao_de_admin, VALIDO).status_code == 200
        corpo = _get(sessao_de_admin)
        assert corpo["horario_estado"] == "configurado"
        assert corpo["horario"] == VALIDO["horario"]


class TestEscrita:
    def test_a_resposta_do_put_e_a_do_get_e_traz_o_estado(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _put(sessao_de_admin, VALIDO)
        assert resposta.status_code == 200, resposta.text
        corpo = resposta.json()
        assert set(corpo) == CAMPOS_DAS_DEFINICOES
        for campo in (*CAMPOS_DE_TEXTO, *CAMPOS_DE_ENDERECO, "horario"):
            assert corpo[campo] == VALIDO[campo]
        assert corpo["horario_estado"] == "configurado"
        assert _get(sessao_de_admin) == corpo

    def test_guarda_as_sete_chaves_e_o_horario_como_json_do_adr_0011(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        assert _put(sessao_de_admin, VALIDO).status_code == 200
        guardado = definicoes_na_bd(motor)
        assert set(guardado) == set(VALIDO)
        for campo in (*CAMPOS_DE_TEXTO, *CAMPOS_DE_ENDERECO):
            assert guardado[campo] == VALIDO[campo]
        assert json.loads(guardado["horario"]) == VALIDO["horario"]

    def test_substitui_o_que_la_estava_e_e_idempotente(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        semear_definicoes(
            sessao,
            {
                "wifi_rede": "Antiga",
                "wifi_password": "antiga",
                "morada": "Antiga",
                "telefone": "1",
                "instagram": "https://instagram.com/antiga",
                "maps_url": "https://maps.example.test/antiga",
                "horario": json.dumps(semana(segunda=[("10:00", "12:00")])),
            },
        )
        primeira = _put(sessao_de_admin, VALIDO)
        antes = definicoes_na_bd(motor)
        segunda = _put(sessao_de_admin, VALIDO)
        assert primeira.status_code == segunda.status_code == 200
        assert primeira.json() == segunda.json()
        assert definicoes_na_bd(motor) == antes
        assert antes["wifi_rede"] == VALIDO["wifi_rede"]
        assert json.loads(antes["horario"]) == VALIDO["horario"]

    def test_nao_toca_nas_outras_linhas_da_tabela(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        semear_definicoes(sessao, {"chave_interna": "ficou"})
        assert _put(sessao_de_admin, VALIDO).status_code == 200
        assert definicoes_na_bd(motor)["chave_interna"] == "ficou"

    def test_o_wifi_novo_aparece_no_info_publico(
        self, sessao_de_admin: TestClient
    ) -> None:
        """O critério do lado do backend da F4-05."""
        corpo = {**VALIDO, "wifi_rede": "Rede-Nova", "wifi_password": "senha-nova-7"}
        assert _put(sessao_de_admin, corpo).status_code == 200
        info = sessao_de_admin.get("/info").json()
        assert info["wifi"] == {"rede": "Rede-Nova", "password": "senha-nova-7"}
        assert info["morada"] == VALIDO["morada"]
        assert info["telefone"] == VALIDO["telefone"]
        assert info["instagram"] == VALIDO["instagram"]
        assert info["maps_url"] == VALIDO["maps_url"]
        assert info["horario"] == VALIDO["horario"]

    def test_vazio_na_gestao_e_null_no_publico(
        self, sessao_de_admin: TestClient
    ) -> None:
        corpo = {
            **VALIDO,
            "telefone": "",
            "instagram": "",
            "maps_url": "",
            "morada": "",
        }
        resposta = _put(sessao_de_admin, corpo)
        assert resposta.status_code == 200, resposta.text
        gestao = _get(sessao_de_admin)
        for campo in ("telefone", "instagram", "maps_url", "morada"):
            assert gestao[campo] == ""
        info = sessao_de_admin.get("/info").json()
        for campo in ("telefone", "instagram", "maps_url", "morada"):
            assert info[campo] is None

    def test_todos_os_textos_vazios_sao_aceites(
        self, sessao_de_admin: TestClient
    ) -> None:
        corpo: dict[str, Any] = dict.fromkeys(
            (*CAMPOS_DE_TEXTO, *CAMPOS_DE_ENDERECO), ""
        )
        corpo["horario"] = None
        resposta = _put(sessao_de_admin, corpo)
        assert resposta.status_code == 200, resposta.text

    def test_o_texto_com_aspas_e_script_guarda_se_e_sai_tal_e_qual(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        """S-09: o servidor nunca faz escape ao guardar."""
        corpo = {**VALIDO, "morada": TEXTO_PERIGOSO, "wifi_rede": TEXTO_PERIGOSO}
        resposta = _put(sessao_de_admin, corpo)
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["morada"] == TEXTO_PERIGOSO
        assert definicoes_na_bd(motor)["morada"] == TEXTO_PERIGOSO
        assert _get(sessao_de_admin)["wifi_rede"] == TEXTO_PERIGOSO
        assert sessao_de_admin.get("/info").json()["morada"] == TEXTO_PERIGOSO

    def test_horario_null_apaga_a_chave_e_volta_a_nao_configurado(
        self, sessao_de_admin: TestClient, motor: Engine
    ) -> None:
        assert _put(sessao_de_admin, VALIDO).status_code == 200
        assert "horario" in definicoes_na_bd(motor)

        resposta = _put(sessao_de_admin, {**VALIDO, "horario": None, "morada": "Nova"})

        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["horario"] is None
        assert resposta.json()["horario_estado"] == "nao_configurado"
        guardado = definicoes_na_bd(motor)
        assert "horario" not in guardado, "`null` apaga a chave, não guarda 'null'"
        assert guardado["morada"] == "Nova"
        assert sessao_de_admin.get("/info").json()["horario"] is None

    def test_todos_os_dias_fechados_e_uma_afirmacao_e_fica_configurado(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _put(sessao_de_admin, {**VALIDO, "horario": semana()})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["horario_estado"] == "configurado"
        assert resposta.json()["horario"] == semana()

    def test_aceita_os_dias_por_qualquer_ordem_e_devolve_os_de_segunda_a_domingo(
        self, sessao_de_admin: TestClient
    ) -> None:
        baralhado = list(reversed(VALIDO["horario"]))
        resposta = _put(sessao_de_admin, {**VALIDO, "horario": baralhado})
        assert resposta.status_code == 200, resposta.text
        assert [d["dia"] for d in _get(sessao_de_admin)["horario"]] == list(
            DIAS_DA_SEMANA
        )
        assert _get(sessao_de_admin)["horario"] == VALIDO["horario"]

    def test_um_dia_com_almoco_e_noite_e_aceite(
        self, sessao_de_admin: TestClient
    ) -> None:
        horario = semana(sexta=[("12:00", "15:00"), ("19:00", "02:00")])
        resposta = _put(sessao_de_admin, {**VALIDO, "horario": horario})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()["horario"] == horario

    def test_tres_periodos_num_dia_passam(self, sessao_de_admin: TestClient) -> None:
        horario = semana(
            sabado=[("08:00", "10:00"), ("12:00", "15:00"), ("19:00", "02:00")]
        )
        assert _put(sessao_de_admin, {**VALIDO, "horario": horario}).status_code == 200


def _dia_repetido() -> list[dict[str, Any]]:
    horario = semana()
    horario[6] = {"dia": "segunda", "periodos": []}
    return horario


def _periodos_demais() -> list[dict[str, Any]]:
    horario = semana()
    horario[0]["periodos"] = [
        {"abre": f"{hora:02d}:00", "fecha": f"{hora:02d}:30"} for hora in range(24)
    ]
    return horario


HORARIOS_RECUSADOS: dict[str, Any] = {
    "seis-dias": semana()[:6],
    "lista-vazia": [],
    "oito-dias": [*semana(), {"dia": "segunda", "periodos": []}],
    "dia-repetido": _dia_repetido(),
    "dia-desconhecido": [*semana()[:6], {"dia": "feriado", "periodos": []}],
    "dia-com-acento": [*semana()[:1], {"dia": "terça", "periodos": []}, *semana()[2:]],
    "abre-igual-a-fecha": semana(terca=[("17:00", "17:00")]),
    "hora-invalida": semana(terca=[("25:00", "02:00")]),
    "hora-sem-zero": semana(terca=[("7:30", "02:00")]),
    "hora-com-segundos": semana(terca=[("17:00:00", "02:00")]),
    "sobrepostos": semana(quarta=[("12:00", "15:00"), ("14:00", "18:00")]),
    "sobrepostos-iguais": semana(quarta=[("12:00", "15:00"), ("12:00", "15:00")]),
    "contido-noutro": semana(quarta=[("12:00", "18:00"), ("13:00", "14:00")]),
    "sobrepoe-a-noite": semana(sexta=[("17:00", "02:00"), ("20:00", "23:00")]),
    "periodos-demais": _periodos_demais(),
    "periodo-com-chave-a-mais": [
        {
            "dia": "segunda",
            "periodos": [{"abre": "17:00", "fecha": "02:00", "fechado": False}],
        },
        *semana()[1:],
    ],
    "dia-com-chave-a-mais": [
        {"dia": "segunda", "periodos": [], "fechado": True},
        *semana()[1:],
    ],
    "dia-sem-periodos": [{"dia": "segunda"}, *semana()[1:]],
    "periodos-nao-e-lista": [
        {"dia": "segunda", "periodos": "17:00-02:00"},
        *semana()[1:],
    ],
    "horario-nao-e-lista": {"segunda": []},
    "horario-e-texto": "17:00-02:00",
}


class TestEscritaRecusada:
    @pytest.mark.parametrize(
        "horario", list(HORARIOS_RECUSADOS.values()), ids=list(HORARIOS_RECUSADOS)
    )
    def test_horario_invalido_e_422_com_o_campo_e_nada_muda(
        self, gestao: TestClient, sessao: Session, motor: Engine, horario: Any
    ) -> None:
        semear_definicoes(sessao, {"wifi_rede": "Antiga"})
        antes = fotografia(motor)
        resposta = _put(gestao, {**VALIDO, "horario": horario})
        exigir_erro(resposta, 422, "dados_invalidos", campo="horario")
        assert fotografia(motor) == antes, "a transação é uma só: nem o WiFi mudou"

    @pytest.mark.parametrize("campo", [*CAMPOS_DE_TEXTO, *CAMPOS_DE_ENDERECO])
    @pytest.mark.parametrize("valor", [None, 123, ["a"], {"a": 1}], ids=repr)
    def test_campo_que_nao_e_texto_e_422(
        self, gestao: TestClient, motor: Engine, campo: str, valor: Any
    ) -> None:
        antes = fotografia(motor)
        exigir_erro(
            _put(gestao, {**VALIDO, campo: valor}), 422, "dados_invalidos", campo=campo
        )
        assert fotografia(motor) == antes

    @pytest.mark.parametrize(
        "campo", sorted(CAMPOS_DAS_DEFINICOES - {"horario_estado"})
    )
    def test_campo_em_falta_e_422_porque_o_put_substitui_o_conjunto(
        self, gestao: TestClient, motor: Engine, campo: str
    ) -> None:
        antes = fotografia(motor)
        corpo = {k: v for k, v in VALIDO.items() if k != campo}
        exigir_erro(_put(gestao, corpo), 422, "dados_invalidos", campo=campo)
        assert fotografia(motor) == antes

    def test_horario_estado_nao_se_escreve(
        self, gestao: TestClient, motor: Engine
    ) -> None:
        antes = fotografia(motor)
        corpo = {**VALIDO, "horario_estado": "configurado"}
        exigir_erro(_put(gestao, corpo), 422, "dados_invalidos", campo="horario_estado")
        assert fotografia(motor) == antes

    def test_um_erro_a_meio_nao_deixa_metade_escrita(
        self, gestao: TestClient, sessao: Session, motor: Engine
    ) -> None:
        semear_definicoes(sessao, {"wifi_rede": "Antiga", "wifi_password": "antiga"})
        antes = fotografia(motor)
        corpo = {**VALIDO, "wifi_rede": "Nova", "maps_url": "javascript:alert(1)"}
        exigir_erro(_put(gestao, corpo), 422, "dados_invalidos", campo="maps_url")
        assert fotografia(motor) == antes


class TestComprimentos:
    @pytest.mark.parametrize("campo", CAMPOS_DE_TEXTO)
    def test_200_carateres_passam_e_201_nao(
        self, gestao: TestClient, motor: Engine, campo: str
    ) -> None:
        assert _put(gestao, {**VALIDO, campo: "a" * 200}).status_code == 200
        antes = fotografia(motor)
        resposta = _put(gestao, {**VALIDO, campo: "a" * 201})
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
        assert fotografia(motor) == antes

    @pytest.mark.parametrize(
        "campo,prefixo",
        [
            ("instagram", "https://www.instagram.com/"),
            ("maps_url", "https://maps.example.test/"),
        ],
    )
    def test_os_enderecos_aceitam_500_e_recusam_501(
        self, gestao: TestClient, motor: Engine, campo: str, prefixo: str
    ) -> None:
        assert (
            _put(
                gestao, {**VALIDO, campo: prefixo + "a" * (500 - len(prefixo))}
            ).status_code
            == 200
        )
        antes = fotografia(motor)
        resposta = _put(gestao, {**VALIDO, campo: prefixo + "a" * (501 - len(prefixo))})
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
        assert fotografia(motor) == antes


class TestTextosDeUmaLinha:
    """Não levam quebras de linha (iam parar ao `/info` público) nem se aparam.

    Não se apara: um nome de rede ou uma password de WiFi pode ter espaços nas
    pontas, e aparar guardava uma password que já não condiz com a rede.
    """

    @pytest.mark.parametrize("campo", CAMPOS_DE_TEXTO)
    @pytest.mark.parametrize("quebra", ["\n", "\r", "\r\n"], ids=repr)
    @pytest.mark.parametrize("posicao", ["meio", "fim"])
    def test_quebra_de_linha_e_422_com_o_campo_e_nada_muda(
        self, gestao: TestClient, motor: Engine, campo: str, quebra: str, posicao: str
    ) -> None:
        antes = fotografia(motor)
        valor = f"a{quebra}b" if posicao == "meio" else f"ab{quebra}"
        resposta = _put(gestao, {**VALIDO, campo: valor})
        exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
        assert fotografia(motor) == antes

    @pytest.mark.parametrize("campo", CAMPOS_DE_TEXTO)
    def test_os_espacos_das_pontas_guardam_se_tal_e_qual(
        self, gestao: TestClient, motor: Engine, campo: str
    ) -> None:
        resposta = _put(gestao, {**VALIDO, campo: " a b "})
        assert resposta.status_code == 200, resposta.text
        assert resposta.json()[campo] == " a b "
        assert definicoes_na_bd(motor)[campo] == " a b "
