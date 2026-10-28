"""Critério S-09: texto com aspas e `<script>` guardado e devolvido igual.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-09 | Texto com aspas e `<script>` | Guardado e devolvido igual; mostrado como texto |

O texto é guardado tal como foi escrito (`backend/CLAUDE.md`: "Nunca fazer
escape HTML ao guardar"). A defesa contra XSS é do React, que mostra
qualquer string como texto — e o S-13 prende isso pelo outro lado,
proibindo `dangerouslySetInnerHTML` no ESLint.

Escapar na API seria a forma errada de estar seguro: um nome de produto com
`&amp;` escrito na base de dados aparece com `&amp;` no cartaz impresso, no
CSV dos clientes e no título da página, e volta a ser escapado por cada
camada que o toque. O `&` do nome de um prato é um `&`.

## O que este teste **não** prova

- **Não prova que a escrita guarda sem escapar.** Semeia pelo ORM, não
  pelo `PUT /gestao/definicoes` nem pelo `POST /novidades`, que ainda não
  existem. Uma API de escrita que escape o texto antes de o guardar passa
  por aqui sem queixa: o que ficar na base de dados é o que sai. Esse lado
  é da F2-05 (gestão) e da F2-07 (novidades), e o S-09 tem de ganhar lá
  mais um teste.
- **Não prova que o browser mostra como texto.** Isso é da F3-02, com o
  mesmo texto a chegar a um componente React, e do S-13 no ESLint.
- **Não prova nada sobre HTML em ficheiros servidos pelo Apache** — o
  `.htaccess` e o `media/` não passam por aqui.

Cada teste corre duas vezes, `[modelos]` e `[migracao]`: é o esquema que o
servidor tem que serve o texto.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests import apoio_publico
from tests.apoio_publico import TEXTO_PERIGOSO


@pytest.fixture
def cenario_com_texto_perigoso(sessao: Session) -> None:
    """O cenário inteiro semeado com o texto do S-09 em todos os campos."""
    apoio_publico.semear_cenario(sessao, texto=TEXTO_PERIGOSO, com_definicoes=False)
    apoio_publico.semear_definicoes(
        sessao,
        {
            "wifi_rede": TEXTO_PERIGOSO,
            "wifi_password": TEXTO_PERIGOSO,
            "morada": TEXTO_PERIGOSO,
            "telefone": TEXTO_PERIGOSO,
            "instagram": TEXTO_PERIGOSO,
            "maps_url": TEXTO_PERIGOSO,
        },
    )


def _corpo(cliente: TestClient, caminho: str) -> dict[str, Any]:
    return apoio_publico.obter_json(cliente, caminho)


@pytest.mark.usefixtures("cenario_com_texto_perigoso")
class TestTextoDevolvidoIgual:
    def test_o_texto_e_mesmo_o_do_criterio(self) -> None:
        """Sonda do próprio teste: o texto tem aspas, `<script>` e `&`.

        Sem isto, uma edição distraída da constante (tirar as aspas para
        "arrumar" o ficheiro) esvaziava todos os testes de baixo sem nenhum
        ficar vermelho.

        Deixa passar: nada; é um guarda sobre a constante.
        """
        assert '"' in TEXTO_PERIGOSO
        assert "<script>" in TEXTO_PERIGOSO
        assert "&" in TEXTO_PERIGOSO
        assert "ç" in TEXTO_PERIGOSO

    def test_na_ementa_o_nome_e_a_descricao_voltam_identicos(
        self, cliente: TestClient
    ) -> None:
        """Categoria, nome de produto e descrição de produto.

        A comparação é com o valor **já descodificado do JSON**: é o que o
        `fetch` do frontend vai ter na mão. Comparar com o corpo em texto
        confundia o escape do JSON (`\\"`, legítimo e obrigatório) com o
        escape de HTML (`&quot;`, que é o defeito).

        Deixa passar: ver o cabeçalho do ficheiro.
        """
        corpo = _corpo(cliente, "/ementa")
        categorias = {c["id"]: c for c in corpo["categorias"]}
        produtos = {p["id"]: p for c in corpo["categorias"] for p in c["produtos"]}

        assert (
            categorias[apoio_publico.ID_CAT_PETISCOS]["nome"]
            == f"Petiscos {TEXTO_PERIGOSO}"
        )
        assert (
            produtos[apoio_publico.ID_PROD_VINHO]["nome"]
            == f"Vinho da casa {TEXTO_PERIGOSO}"
        )
        assert (
            produtos[apoio_publico.ID_PROD_VINHO]["descricao"]
            == f"Tinto {TEXTO_PERIGOSO}"
        )

    def test_nos_eventos_o_titulo_e_a_descricao_voltam_identicos(
        self, cliente: TestClient
    ) -> None:
        """Deixa passar: ver o cabeçalho do ficheiro."""
        corpo = _corpo(cliente, "/eventos")
        eventos = {evento["id"]: evento for evento in corpo["eventos"]}

        assert (
            eventos[apoio_publico.ID_EVT_FADOS]["titulo"]
            == f"Noite de fados {TEXTO_PERIGOSO}"
        )
        assert (
            eventos[apoio_publico.ID_EVT_FADOS]["descricao"]
            == f"Com entrada livre {TEXTO_PERIGOSO}"
        )

    def test_na_galeria_a_descricao_volta_identica(self, cliente: TestClient) -> None:
        """A legenda de uma foto é escrita por quem a envia (F2-06).

        É a única das quatro superfícies em que o texto vem de fora do bar,
        e por isso a que mais importa que seja guardada sem escapes e
        mostrada como texto.

        Deixa passar: ver o cabeçalho do ficheiro.
        """
        corpo = _corpo(cliente, "/galeria")
        fotos = {foto["id"]: foto for foto in corpo["fotos"]}

        assert (
            fotos[apoio_publico.ID_FOTO_RECENTE_B]["descricao"]
            == f"Mesa cheia {TEXTO_PERIGOSO}"
        )
        assert (
            fotos[apoio_publico.ID_FOTO_ANTIGA]["descricao"]
            == f"Esplanada {TEXTO_PERIGOSO}"
        )

    def test_na_info_todos_os_escalares_voltam_identicos(
        self, cliente: TestClient
    ) -> None:
        """Morada, telefone, Instagram, Maps e os dois campos do WiFi.

        A password do WiFi entra de propósito: é a que o dono copia com o
        botão "Copiar password", e um `&amp;` acrescentado pela API é uma
        password que não liga ao WiFi.

        Deixa passar: ver o cabeçalho do ficheiro.
        """
        corpo = _corpo(cliente, "/info")

        assert corpo["wifi"]["rede"] == TEXTO_PERIGOSO
        assert corpo["wifi"]["password"] == TEXTO_PERIGOSO
        for campo in apoio_publico.ESCALARES_DE_INFO:
            assert corpo[campo] == TEXTO_PERIGOSO, campo

    def test_o_que_esta_na_base_de_dados_e_o_que_sai_na_resposta(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Os dois lados do critério: "guardado e devolvido igual".

        Lê a linha pela base de dados e compara-a com o que saiu na
        resposta. Sem isto, uma camada que escapasse à escrita **e**
        desescapasse à leitura passava nos testes de cima — e o texto
        estaria errado para o `importar_bd_antiga.py`, para o CSV e para
        qualquer consulta à mão.

        Deixa passar: o caminho da escrita pela API (F2-05/F2-07).
        """
        from app.models.ementa import Produto

        corpo = _corpo(cliente, "/ementa")
        produtos = {p["id"]: p for c in corpo["categorias"] for p in c["produtos"]}
        na_base = sessao.get(Produto, apoio_publico.ID_PROD_VINHO)

        assert na_base is not None
        assert na_base.nome == f"Vinho da casa {TEXTO_PERIGOSO}"
        assert produtos[apoio_publico.ID_PROD_VINHO]["nome"] == na_base.nome
