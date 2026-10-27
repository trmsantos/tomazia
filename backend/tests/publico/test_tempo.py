"""`app.tempo.inicio_do_dia_do_bar`: o corte do dia, sem HTTP e sem relógio.

Testes de unidade da função pura do ADR 0010. Não são parametrizados pela
origem do esquema porque não tocam na base de dados: o que aqui se prova é
aritmética de calendário, e a parametrização só serviria para duplicar o
tempo de execução.

A ligação ao endpoint — que `GET /eventos` usa mesmo este corte — está em
`tests/publico/test_eventos.py`, com o relógio injetado. Os dois são
precisos: esta bateria prova que o corte está certo, aquela prova que o
corte é usado.
"""

from __future__ import annotations

import tomllib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

LISBOA = ZoneInfo("Europe/Lisbon")

RAIZ_BACKEND = Path(__file__).resolve().parent.parent.parent


def _corte(agora: datetime) -> datetime:
    from app.tempo import inicio_do_dia_do_bar

    return inicio_do_dia_do_bar(agora)


class TestCanarioDoFuso:
    """O `Europe/Lisbon` tem de resolver na máquina que servir a app.

    O ADR 0010 fez do nome `Europe/Lisbon` uma dependência de produção. O
    `zoneinfo` lê-o da base de dados de fusos do sistema
    (`/usr/share/zoneinfo`), que no cPanel partilhado não é nossa e não
    está garantida: em falta, `ZoneInfo("Europe/Lisbon")` levanta
    `ZoneInfoNotFoundError` e o endpoint devolve 500.
    """

    def test_o_fuso_de_lisboa_resolve(self) -> None:
        """Deixa passar: que resolva **aqui** não prova que resolve no cPanel.

        É o teste seguinte, o do `tzdata`, que trata disso. Este só apanha
        um ambiente de desenvolvimento sem base de dados de fusos nenhuma.
        """
        fuso = ZoneInfo("Europe/Lisbon")

        assert fuso.utcoffset(datetime(2026, 7, 15, 12, 0)) == timedelta(hours=1)
        assert fuso.utcoffset(datetime(2026, 1, 15, 12, 0)) == timedelta(0)

    def test_tzdata_esta_declarado_como_dependencia_do_backend(self) -> None:
        """O `tzdata` entra como dependência (ADR 0010), não como sorte.

        Em macOS e na maioria dos Linux o `zoneinfo` encontra os fusos no
        sistema e o teste de cima fica verde sem o pacote. Num cPanel
        partilhado sem `/usr/share/zoneinfo` não encontra, e aí só o
        `tzdata` instalado salva o endpoint.

        Deixa passar: que o `tzdata` esteja em `pyproject.toml` não prova
        que está no `requirements.txt` com hash (isso é o passo de deriva
        do CI), nem que o servidor já o instalou.
        """
        pyproject = tomllib.loads(
            (RAIZ_BACKEND / "pyproject.toml").read_text(encoding="utf-8")
        )
        dependencias = pyproject["project"]["dependencies"]
        nomes = {
            dependencia.split(">")[0].split("=")[0].split("[")[0].strip().lower()
            for dependencia in dependencias
        }

        assert "tzdata" in nomes, (
            "o ADR 0010 põe o `tzdata` nas dependências do backend: o "
            "`zoneinfo` lê os fusos da base de dados do sistema, que no "
            "cPanel partilhado não é nossa e pode não existir. "
            f"Dependências declaradas: {sorted(nomes)}"
        )


class TestCorteDoDia:
    def test_guarda_o_adr_0010_no_verao_o_corte_e_uma_hora_antes_da_meia_noite_utc(
        self,
    ) -> None:
        """**Este é o teste que guarda o ADR 0010.**

        Se cair num rebate de merge, o defeito volta sem ninguém dar por
        ele: com o corte em UTC, um evento que começa às 00:30 de Lisboa
        desaparece do site à 01:00 da manhã, enquanto está a acontecer.

        É o único teste do corte que **discrimina**: em julho, meia-noite
        em Lisboa é `23:00Z` do dia anterior e meia-noite em UTC é
        `00:00Z`. Uma implementação que "simplifique" para UTC devolve o
        segundo e fica vermelha aqui.

        Deixa passar: nada sobre `GET /eventos` — a função pode estar
        certa e o endpoint nunca a chamar. Ver
        `test_eventos.py::TestCorteDoDiaNoEndpoint`.
        """
        agora = datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA)

        assert _corte(agora) == datetime(2026, 7, 14, 23, 0, tzinfo=UTC)

    def test_no_inverno_o_corte_coincide_com_a_meia_noite_utc(self) -> None:
        """**Não discrimina**, e está aqui na mesma.

        Em janeiro Lisboa está em UTC+0: o corte certo e o corte errado
        (em UTC) são o mesmo valor, e uma implementação em UTC fica verde
        neste teste. Existe para prender o caso de inverno contra o defeito
        oposto — alguém a somar uma hora o ano inteiro.

        Deixa passar: exatamente o defeito que o ADR 0010 descreve.
        """
        agora = datetime(2026, 1, 15, 9, 0, tzinfo=LISBOA)

        assert _corte(agora) == datetime(2026, 1, 15, 0, 0, tzinfo=UTC)

    @pytest.mark.parametrize(
        ("agora", "esperado"),
        [
            pytest.param(
                datetime(2026, 3, 29, 12, 0, tzinfo=LISBOA),
                datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
                id="dia-em-que-o-relogio-adianta",
            ),
            pytest.param(
                datetime(2026, 10, 25, 12, 0, tzinfo=LISBOA),
                datetime(2026, 10, 24, 23, 0, tzinfo=UTC),
                id="dia-em-que-o-relogio-atrasa",
            ),
        ],
    )
    def test_nos_dias_de_mudanca_de_hora_vale_o_fuso_da_meia_noite(
        self, agora: datetime, esperado: datetime
    ) -> None:
        """Nos dois dias de 2026 em que a hora muda, a meia-noite é a antiga.

        As mudanças dão-se às 01:00 e às 02:00 locais: à meia-noite desses
        dias Lisboa ainda está no fuso anterior. Uma implementação com
        "+1 h de abril a outubro" acerta no primeiro e falha no segundo.

        Deixa passar: anos que não sejam 2026. As datas estão fixas, e uma
        implementação com a tabela de 2026 escrita à mão passava aqui.
        """
        assert _corte(agora) == esperado

    def test_o_dia_e_o_de_lisboa_mesmo_quando_o_instante_vem_noutro_fuso(
        self,
    ) -> None:
        """Converte para Lisboa **antes** de perguntar que dia é.

        `agora` às 02:00 de 15/07 num fuso UTC+13 é 13:00Z de **14**/07, ou
        seja, 14:00 em Lisboa, ainda dia 14. Uma implementação que faça
        `agora.date()` sem converter responde o dia 15 e fica vermelha.

        Deixa passar: a app nunca passa um instante neste fuso. É um teste
        sobre a função, não sobre o caminho real.
        """
        fuso_distante = ZoneInfo("Pacific/Auckland")
        agora = datetime(2026, 7, 15, 2, 0, tzinfo=fuso_distante)

        assert _corte(agora) == datetime(2026, 7, 13, 23, 0, tzinfo=UTC)

    def test_recusa_um_instante_sem_fuso(self) -> None:
        """Um `datetime` ingénuo não diz a que dia pertence.

        Pela mesma razão que `DataHoraUTC` o recusa (F2-01). E porque o
        `astimezone()` do Python **não** dá erro com um ingénuo: assume o
        fuso do sistema, e o corte passava a depender da máquina sem nada
        no caminho a dizê-lo.

        Deixa passar: o texto exato da mensagem. Só se exige que fale de
        fuso — é o que a torna acionável em PT-PT.
        """
        ingenuo = datetime(2026, 7, 15, 9, 0)

        with pytest.raises(ValueError) as informacao:
            _corte(ingenuo)

        assert "fuso" in str(informacao.value).lower()

    def test_devolve_sempre_um_instante_com_fuso_em_utc(self) -> None:
        """O corte é comparado com `eventos.inicio`, que vem em UTC.

        Deixa passar: um corte certo na hora e errado no dia — a asserção
        é só sobre o deslocamento.
        """
        resultado = _corte(datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA))

        assert resultado.tzinfo is not None
        assert resultado.utcoffset() == timedelta(0)

    def test_e_pura_o_resultado_vem_do_argumento_e_nao_do_relogio(self) -> None:
        """Duas chamadas com instantes de anos diferentes dão cortes diferentes.

        Prova que a função lê o argumento. Uma implementação que ignorasse
        `agora` e chamasse `datetime.now(UTC)` devolvia o mesmo valor nas
        duas — e ainda por cima um valor que muda à meia-noite, o que daria
        uma bateria que falha uma vez por dia.

        Deixa passar: uma implementação que leia o relógio **e** o
        argumento (por exemplo, para "corrigir" o resultado) continua
        verde. O que apanha isso é o contador de chamadas do relógio
        injetado, em `test_eventos.py`.
        """
        corte_de_2019 = _corte(datetime(2019, 2, 3, 14, 0, tzinfo=LISBOA))
        corte_de_2031 = _corte(datetime(2031, 8, 9, 14, 0, tzinfo=LISBOA))

        assert corte_de_2019 == datetime(2019, 2, 3, 0, 0, tzinfo=UTC)
        assert corte_de_2031 == datetime(2031, 8, 8, 23, 0, tzinfo=UTC)
        assert _corte(datetime(2019, 2, 3, 14, 0, tzinfo=LISBOA)) == corte_de_2019

    @pytest.mark.parametrize(
        "agora",
        [
            pytest.param(datetime(2026, 7, 15, 9, 0, tzinfo=LISBOA), id="verao"),
            pytest.param(datetime(2026, 1, 15, 9, 0, tzinfo=LISBOA), id="inverno"),
            pytest.param(datetime(2026, 10, 25, 9, 0, tzinfo=LISBOA), id="mudanca"),
        ],
    )
    def test_o_corte_de_um_corte_e_o_proprio_corte(self, agora: datetime) -> None:
        """O corte é um ponto fixo: aplicá-lo ao resultado devolve o resultado.

        Meia-noite em Lisboa nunca é ambígua nem inexistente (as mudanças
        de hora dão-se às 01:00 e às 02:00 locais), por isso isto tem de
        valer também nos dias de mudança. Um `fold` mal resolvido ou um
        arredondamento para a hora cheia partem-no.

        Deixa passar: um corte sistematicamente deslocado de 24 h
        continuaria a ser um ponto fixo.
        """
        primeiro = _corte(agora)

        assert _corte(primeiro) == primeiro
