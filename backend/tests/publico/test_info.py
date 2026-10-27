"""`GET /info`: WiFi, morada, contactos e horário.

Forma do horário: ADR 0011. Escalares `string | null`, com `""` e só
espaços a normalizar para `null` — "ainda não há password de WiFi" diz-se
com `null`, não com uma string vazia que o frontend mostrava como um campo
em branco.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_publico import (
    CHAVES_DIA_DO_HORARIO,
    CHAVES_INFO,
    CHAVES_PERIODO,
    CHAVES_WIFI,
    DEFINICOES_FALSAS,
    DIAS_DA_SEMANA,
    ESCALARES_DE_INFO,
    HORARIO_ESPERADO_DO_INCOMPLETO,
    HORARIO_GUARDADO_INCOMPLETO,
    HORARIO_SETE_DIAS_FECHADO,
    HORARIOS_INVALIDOS,
)


def _obter_info(cliente: TestClient) -> dict[str, Any]:
    return apoio_publico.obter_json(cliente, "/info")


@pytest.fixture
def info(cliente: TestClient, sessao: Session) -> dict[str, Any]:
    """O cenário armadilhado semeado e a resposta de `GET /info` já lida."""
    apoio_publico.semear_cenario(sessao)
    return _obter_info(cliente)


class TestForma:
    def test_o_topo_tem_exatamente_as_chaves_do_contrato(
        self, info: dict[str, Any]
    ) -> None:
        """Seis chaves. O cenário tem uma sétima linha em `definicoes`.

        `definicoes` é uma tabela chave/valor: devolver tudo o que lá está
        seria publicar qualquer definição futura no momento em que ela é
        escrita, sem ninguém decidir nada. Esta asserção é a decisão.

        Deixa passar: os tipos dos valores.
        """
        assert set(info.keys()) == set(CHAVES_INFO)

    def test_o_wifi_e_um_objeto_com_rede_e_password(self, info: dict[str, Any]) -> None:
        """Aninhado, porque a folha do WiFi mostra os dois juntos.

        Deixa passar: nada sobre os valores.
        """
        assert set(info["wifi"].keys()) == set(CHAVES_WIFI)

    def test_os_valores_guardados_saem_tal_e_qual(self, info: dict[str, Any]) -> None:
        """Deixa passar: a normalização de espaços (testes a seguir)."""
        assert info["wifi"]["rede"] == DEFINICOES_FALSAS["wifi_rede"]
        assert info["wifi"]["password"] == DEFINICOES_FALSAS["wifi_password"]
        assert info["morada"] == DEFINICOES_FALSAS["morada"]
        assert info["telefone"] == DEFINICOES_FALSAS["telefone"]
        assert info["instagram"] == DEFINICOES_FALSAS["instagram"]
        assert info["maps_url"] == DEFINICOES_FALSAS["maps_url"]

    def test_a_password_do_wifi_sai_em_texto_e_isso_e_deliberado(
        self, info: dict[str, Any]
    ) -> None:
        """Não é descuido: está decidido no ADR 0011 e confirmado pelo Tomás.

        A password do WiFi sai em texto, no mesmo `GET /info`, para
        qualquer pessoa na internet. Vem da especificação (é o ecrã do QR
        code na mesa) e o Tomás confirmou-o depois de lhe ser dito que fica
        legível por quem nunca entrou no bar e indexável por motores de
        busca.

        Este teste existe para que ninguém, mais tarde, tome isto por um
        defeito e o "corrija" sem uma decisão com data. Se mudar de ideias,
        o que muda é o ADR — e este teste fica vermelho a dizer onde.

        Deixa passar: tudo o resto sobre a password (comprimento,
        conteúdo). Só prende que ela sai.
        """
        assert info["wifi"]["password"] == DEFINICOES_FALSAS["wifi_password"]


class TestSemDefinicoes:
    def test_com_a_tabela_vazia_tudo_sai_a_null_com_200(
        self, cliente: TestClient
    ) -> None:
        """Uma instalação acabada de criar não é um erro.

        `wifi` continua a ser um objeto com as duas chaves: um `wifi: null`
        obrigava o frontend a um caminho alternativo só para este caso.

        Deixa passar: nada sobre o cabeçalho de cache.
        """
        info = _obter_info(cliente)

        assert info == {
            "wifi": {"rede": None, "password": None},
            "morada": None,
            "telefone": None,
            "instagram": None,
            "maps_url": None,
            "horario": None,
        }

    @pytest.mark.parametrize("vazio", ["", "   ", "\t", "\n  \n"])
    def test_valor_vazio_ou_so_com_espacos_sai_a_null(
        self, cliente: TestClient, sessao: Session, vazio: str
    ) -> None:
        """`definicoes.valor` é `NOT NULL`: a ausência diz-se com `""`.

        A F2-05 guarda `""` quando o dono apaga um campo no formulário, e a
        F2-08 importa campos vazios do site antigo. Se `""` chegasse ao
        frontend, o ecrã "Visita-nos" mostrava um telefone em branco com
        ícone e tudo.

        Deixa passar: **não diz se um valor não-vazio com espaços nas
        pontas é aparado**. `" Rua de Exemplo "` pode sair com ou sem os
        espaços — fica por decidir até alguém ter uma razão.
        """
        apoio_publico.semear_definicoes(sessao, dict.fromkeys(DEFINICOES_FALSAS, vazio))

        info = _obter_info(cliente)

        assert info["wifi"] == {"rede": None, "password": None}
        for campo in ESCALARES_DE_INFO:
            assert info[campo] is None, campo
        assert info["horario"] is None


class TestHorario:
    def test_normaliza_para_sete_dias_pela_ordem_da_semana(
        self, info: dict[str, Any]
    ) -> None:
        """O guardado vem incompleto e desordenado; a resposta vem arrumada.

        O cenário guarda três dias, começados na terça. A resposta tem de
        trazer os sete, de segunda a domingo, com os que faltam a
        `periodos: []`.

        Cobre de uma vez: a ordem, os dias em falta, dois períodos no
        mesmo dia (domingo) e `fecha < abre` (terça, 17:00–02:00), que é o
        caso normal deste bar.

        Deixa passar: dias repetidos no valor guardado — o ADR 0011 não diz
        o que fazer com eles e este teste não inventa.
        """
        assert info["horario"] == HORARIO_ESPERADO_DO_INCOMPLETO

    def test_cada_dia_e_cada_periodo_tem_exatamente_as_chaves_do_contrato(
        self, info: dict[str, Any]
    ) -> None:
        """`{dia, periodos}` e `{abre, fecha}`. Nunca um `fechado: true`.

        "Fechado" diz-se com `periodos: []` (ADR 0011): um campo `fechado`
        a par de uma lista de períodos dá duas fontes de verdade para a
        mesma pergunta.

        Deixa passar: os valores — `"abre": "banana"` passava aqui.
        """
        assert [dia["dia"] for dia in info["horario"]] == list(DIAS_DA_SEMANA)
        for dia in info["horario"]:
            assert set(dia.keys()) == set(CHAVES_DIA_DO_HORARIO), dia
            for periodo in dia["periodos"]:
                assert set(periodo.keys()) == set(CHAVES_PERIODO), periodo

    def test_sete_dias_fechados_nao_e_a_mesma_coisa_que_nao_configurado(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Uma semana inteira fechada é uma afirmação sobre o bar.

        Só o dono a pode fazer. `null` é "nunca foi configurado", e a F3-06
        esconde o bloco do horário; sete dias com `periodos: []` é
        "configurado e fechado toda a semana", e a F3-06 mostra-o. Devolver
        o segundo quando o que se passa é o primeiro seria inventar um
        facto sobre o bar.

        Deixa passar: o que a F3-06 faz com cada um dos dois.
        """
        apoio_publico.semear_definicoes(
            sessao,
            {"horario": json.dumps(HORARIO_SETE_DIAS_FECHADO, ensure_ascii=False)},
        )

        info = _obter_info(cliente)

        assert info["horario"] == HORARIO_SETE_DIAS_FECHADO
        assert info["horario"] is not None

    def test_sem_a_chave_horario_a_resposta_traz_null_e_nao_regista_erro(
        self, cliente: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Não configurado e inválido dão a mesma resposta e logs diferentes.

        O ADR 0011 assume essa exceção à regra 10 de propósito — a
        alternativa era expor ao público o estado interno de uma definição.
        O que não pode acontecer é um horário que nunca foi configurado
        encher o log de erros todos os dias, até ninguém reparar no que
        importa.

        Deixa passar: avisos (`WARNING`) — só olha para `ERROR` e acima.
        """
        with caplog.at_level(logging.ERROR):
            info = _obter_info(cliente)

        assert info["horario"] is None
        assert [registo.getMessage() for registo in caplog.records] == []

    @pytest.mark.parametrize("rotulo", sorted(HORARIOS_INVALIDOS))
    def test_um_horario_invalido_da_null_sem_levar_o_resto_atras(
        self,
        cliente: TestClient,
        sessao: Session,
        caplog: pytest.LogCaptureFixture,
        rotulo: str,
    ) -> None:
        """Um horário mal escrito não pode levar atrás o WiFi e a morada.

        Estão todos no mesmo ecrã. O endpoint devolve 200, `horario: null`,
        os restantes campos servidos, e **regista um erro no log com o nome
        da chave** — é o único sítio onde a diferença entre "não
        configurado" e "inválido" fica registada.

        Os seis valores inválidos cobrem: JSON partido, objeto em vez de
        lista, dia que não existe, hora impossível, período incompleto e
        lista de strings.

        Deixa passar: o nome do logger, o texto exato da mensagem e o
        `exc_info`. Só se exige o nível e o nome da chave.
        """
        apoio_publico.semear_definicoes(
            sessao,
            {
                "wifi_rede": DEFINICOES_FALSAS["wifi_rede"],
                "morada": DEFINICOES_FALSAS["morada"],
                "horario": HORARIOS_INVALIDOS[rotulo],
            },
        )

        with caplog.at_level(logging.ERROR):
            info = _obter_info(cliente)

        assert info["horario"] is None
        assert info["wifi"]["rede"] == DEFINICOES_FALSAS["wifi_rede"]
        assert info["morada"] == DEFINICOES_FALSAS["morada"]
        mensagens = [registo.getMessage() for registo in caplog.records]
        assert any("horario" in mensagem for mensagem in mensagens), (
            "um horário inválido tem de deixar rasto no log com o nome da "
            f"chave; registos vistos: {mensagens}"
        )

    def test_um_horario_valido_sobrevive_a_ida_e_volta_pelo_json(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """O que `GET /info` publica é exatamente o que `definicoes` guarda.

        É o que faz do ADR 0011 um contrato só: o mesmo modelo Pydantic lê
        aqui e valida na escrita da F2-05. Se a leitura reescrevesse a
        forma, a escrita validaria uma coisa e a leitura publicaria outra.

        Deixa passar: a validação na escrita (F2-05) — aqui só se lê.
        """
        apoio_publico.semear_definicoes(
            sessao, {"horario": HORARIO_GUARDADO_INCOMPLETO}
        )

        info = _obter_info(cliente)

        guardado = json.loads(HORARIO_GUARDADO_INCOMPLETO)
        por_dia = {dia["dia"]: dia["periodos"] for dia in info["horario"]}
        for dia in guardado:
            assert por_dia[dia["dia"]] == dia["periodos"], dia["dia"]
