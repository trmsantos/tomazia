"""`GET /gestao/clientes.csv` (F2-05c): abre bem no Excel em português.

O Excel em português lê `;` como separador e só reconhece UTF-8 se o
ficheiro começar pela BOM (`EF BB BF`). A linha `sep=;` **não** se usa: com
ela o Excel ignora a BOM e estraga os acentos.

- corpo = BOM (**uma só vez**, no início) + texto em UTF-8, `csv.writer` com
  `delimiter=";"` e `lineterminator="\\r\\n"`;
- cabeçalho `Nome;Email;Telemóvel;Data do consentimento;Versão dos termos;Data de inscrição`;
- datas `DD/MM/AAAA HH:MM` em `Europe/Lisbon` (não UTC);
- `Content-Type: text/csv; charset=utf-8`, `Cache-Control: no-store`,
  `Content-Disposition: attachment; filename="clientes-AAAA-MM-DD.csv"` com a
  data **de Lisboa** de hoje. O relógio é injetado: o serviço tem de chamar
  `agora_utc()` pelo nome do módulo (`tests/apoio_gestao.py::fixar_relogio_gestao`);
- a ordem é a da lista JSON (do mais recente para o mais antigo);
- o token de cancelamento não sai (`tests/seguranca/`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from tests.apoio_gestao import (
    CABECALHO_DO_CSV,
    CABECALHO_MUTACAO,
    ID_CLI_ANA,
    fixar_relogio_gestao,
    linhas_do_csv,
    semear_cliente_com,
)
from tests.apoio_publico import exigir_relogio_lido

if TYPE_CHECKING:
    import httpx
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

ROTA = "/gestao/clientes.csv"
BOM = b"\xef\xbb\xbf"


def _csv(cliente: TestClient) -> httpx.Response:
    resposta = cliente.get(ROTA)
    assert resposta.status_code == 200, resposta.text
    return resposta


class TestFormato:
    def test_os_bytes_comecam_pela_bom_uma_so_vez(self, gestao: TestClient) -> None:
        corpo = _csv(gestao).content
        assert corpo.startswith(BOM)
        assert BOM not in corpo[3:], "a BOM aparece uma vez, no início"

    def test_sem_a_linha_sep(self, gestao: TestClient) -> None:
        texto = _csv(gestao).content.decode("utf-8-sig")
        assert not texto.lower().startswith("sep=")
        assert "sep=;" not in texto

    def test_o_content_type_e_text_csv_utf_8(self, gestao: TestClient) -> None:
        tipo = _csv(gestao).headers["content-type"].lower().replace(" ", "")
        assert tipo == "text/csv;charset=utf-8"

    def test_sem_cache(self, gestao: TestClient) -> None:
        assert _csv(gestao).headers.get("cache-control") == "no-store"

    def test_o_cabecalho_e_a_primeira_linha(self, gestao: TestClient) -> None:
        assert linhas_do_csv(_csv(gestao))[0] == CABECALHO_DO_CSV
        texto = _csv(gestao).content.decode("utf-8-sig")
        assert texto.split("\r\n", 1)[0] == (
            "Nome;Email;Telemóvel;Data do consentimento;Versão dos termos;Data de inscrição"
        )

    def test_linhas_em_crlf_sem_lf_solto(self, gestao: TestClient) -> None:
        texto = _csv(gestao).content.decode("utf-8-sig")
        assert texto.endswith("\r\n")
        assert texto.count("\r\n") == 3, "cabeçalho + 2 clientes"
        assert "\n" not in texto.replace("\r\n", "")

    def test_um_cliente_por_linha_com_seis_colunas(self, gestao: TestClient) -> None:
        linhas = linhas_do_csv(_csv(gestao))
        assert len(linhas) == 3
        assert all(len(linha) == 6 for linha in linhas)

    def test_sem_clientes_so_o_cabecalho_com_a_bom(
        self, sessao_de_admin: TestClient
    ) -> None:
        resposta = _csv(sessao_de_admin)
        assert resposta.content.startswith(BOM)
        assert linhas_do_csv(resposta) == [CABECALHO_DO_CSV]


class TestConteudo:
    def test_os_acentos_chegam_intactos(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_cliente_com(
            sessao, 1, nome="João Conceição Ç", email="joao@exemplo.test"
        )
        resposta = _csv(sessao_de_admin)
        assert "João Conceição Ç".encode() in resposta.content
        assert linhas_do_csv(resposta)[1][0] == "João Conceição Ç"
        assert resposta.content.decode("utf-8-sig").count("Ã") == 0, "mojibake"

    def test_os_campos_de_cada_cliente(self, gestao: TestClient) -> None:
        linhas = {linha[1]: linha for linha in linhas_do_csv(_csv(gestao))[1:]}
        ana = linhas["ana@exemplo.test"]
        assert ana[0] == "Ana Exemplo"
        assert ana[2] == "912345678"
        assert ana[4] == "1"
        assert linhas["rui@exemplo.test"][2] == "", "sem telemóvel: célula vazia"

    def test_a_ordem_e_a_da_lista_json(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        base = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
        semear_cliente_com(sessao, 1, nome="Velho", criado_em=base.replace(year=2025))
        semear_cliente_com(sessao, 2, nome="Novo", criado_em=base)
        semear_cliente_com(sessao, 3, nome="Meio", criado_em=base.replace(month=1))
        nomes = [linha[0] for linha in linhas_do_csv(_csv(sessao_de_admin))[1:]]
        assert nomes == ["Novo", "Meio", "Velho"]
        em_json = [
            c["nome"]
            for c in sessao_de_admin.get("/gestao/clientes").json()["clientes"]
        ]
        assert nomes == em_json

    @pytest.mark.parametrize(
        "instante,esperado",
        [
            # Verão (WEST, UTC+1): 21:30Z são 22:30 em Lisboa.
            (datetime(2026, 7, 15, 21, 30, tzinfo=UTC), "15/07/2026 22:30"),
            # Inverno (WET, UTC+0).
            (datetime(2026, 1, 15, 21, 30, tzinfo=UTC), "15/01/2026 21:30"),
            # A hora de Lisboa já é o dia seguinte.
            (datetime(2026, 7, 15, 23, 30, tzinfo=UTC), "16/07/2026 00:30"),
            # Zeros à esquerda.
            (datetime(2026, 3, 5, 8, 5, tzinfo=UTC), "05/03/2026 08:05"),
        ],
    )
    def test_as_datas_estao_em_hora_de_lisboa(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        instante: datetime,
        esperado: str,
    ) -> None:
        semear_cliente_com(sessao, 1, consentimento_em=instante, criado_em=instante)
        linha = linhas_do_csv(_csv(sessao_de_admin))[1]
        assert linha[3] == esperado, "Data do consentimento"
        assert linha[5] == esperado, "Data de inscrição"

    def test_consentimento_e_inscricao_sao_colunas_distintas(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_cliente_com(
            sessao,
            1,
            consentimento_em=datetime(2026, 1, 15, 10, 0, tzinfo=UTC),
            criado_em=datetime(2026, 1, 16, 11, 45, tzinfo=UTC),
        )
        linha = linhas_do_csv(_csv(sessao_de_admin))[1]
        assert linha[3] == "15/01/2026 10:00"
        assert linha[5] == "16/01/2026 11:45"


class TestNomeDoFicheiro:
    @pytest.mark.parametrize(
        "agora,esperado",
        [
            (datetime(2026, 7, 15, 12, 0, tzinfo=UTC), "clientes-2026-07-15.csv"),
            # 23:30Z de verão já é dia 16 em Lisboa; em UTC ainda era dia 15.
            (datetime(2026, 7, 15, 23, 30, tzinfo=UTC), "clientes-2026-07-16.csv"),
            # No inverno Lisboa e UTC coincidem: continua dia 15.
            (datetime(2026, 1, 15, 23, 30, tzinfo=UTC), "clientes-2026-01-15.csv"),
        ],
    )
    def test_content_disposition_com_a_data_de_lisboa(
        self,
        monkeypatch: pytest.MonkeyPatch,
        gestao: TestClient,
        agora: datetime,
        esperado: str,
    ) -> None:
        relogio = fixar_relogio_gestao(monkeypatch, agora)
        resposta = _csv(gestao)
        exigir_relogio_lido(relogio)
        assert (
            resposta.headers["content-disposition"]
            == f'attachment; filename="{esperado}"'
        )


def test_so_se_aceita_get_do_csv(gestao: TestClient) -> None:
    for metodo in ("post", "put", "delete"):
        resposta = getattr(gestao, metodo)(ROTA, headers=CABECALHO_MUTACAO)
        assert resposta.status_code == 405, (metodo, resposta.text)


def test_o_csv_nao_se_confunde_com_um_id(gestao: TestClient) -> None:
    """`/gestao/clientes.csv` é a rota do ficheiro; `/gestao/clientes/401` apaga."""
    assert gestao.get(f"/gestao/clientes/{ID_CLI_ANA}").status_code == 405
