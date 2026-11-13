"""`maps_url` e `instagram` só aceitam `https://` (F2-05c).

O F3-06 põe estes dois valores num `href` **público**. O React escapa o
texto, mas **não** bloqueia `javascript:` num `href`: um endereço
`javascript:...` guardado aqui seria um XSS no site do bar, executado no
browser de cada cliente que tocasse na ligação. A defesa é recusar tudo o
que não seja `https://` **na escrita**, porque a leitura pública devolve o
texto tal como está (S-09).

Regras prendidas (decisão do Tomás: o Instagram guarda-se como endereço
completo, só `https://`):

- ambos: `https://` ou vazio (vazio = "não há"); o esquema compara-se sem
  distinguir maiúsculas, mas o valor guardado tem de **começar** por ele:
  qualquer coisa à frente (espaço, tabulação, quebra de linha) é 422;
- `instagram`: **além disso**, o anfitrião é `instagram.com` ou
  `www.instagram.com` (escolha desta bateria, o plano deixava a margem: é
  um link público no site do bar, e um `https://` para um sítio qualquer
  continuava a ser um desvio);
- `maps_url`: qualquer anfitrião `https` (o Google Maps tem vários).

Sempre 422 `dados_invalidos` com `campo` igual ao campo errado, e **nada
muda** na base de dados.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from tests.apoio_gestao import (
    CABECALHO_MUTACAO,
    CORPOS_VALIDOS,
    definicoes_na_bd,
    exigir_erro,
    fotografia,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

BASE: dict[str, Any] = CORPOS_VALIDOS[("PUT", "/gestao/definicoes")]

PERIGOSOS = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "JAVASCRIPT:alert(1)",
    "  javascript:alert(1)",
    "\tjavascript:alert(1)",
    "\njavascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://exemplo.test/x",
    "http://www.instagram.com/exemplo",
    "HTTP://maps.example.test/x",
    "//maps.example.test/x",
    "/place/tomazia",
    "www.instagram.com/exemplo",
    "https:maps.example.test",
    "https://",
    "https:///caminho",
    " https://maps.example.test/x",
    "\thttps://maps.example.test/x",
    "\nhttps://maps.example.test/x",
    " https://maps.example.test/x",
]


def _pedir(cliente: TestClient, campo: str, valor: str) -> Any:
    return cliente.put(
        "/gestao/definicoes", json={**BASE, campo: valor}, headers=CABECALHO_MUTACAO
    )


@pytest.mark.parametrize("campo", ["maps_url", "instagram"])
@pytest.mark.parametrize("valor", PERIGOSOS, ids=[repr(v)[:40] for v in PERIGOSOS])
def test_um_valor_que_nao_e_https_e_422_e_nada_muda(
    gestao: TestClient, motor: Engine, campo: str, valor: str
) -> None:
    antes = fotografia(motor)
    resposta = _pedir(gestao, campo, valor)
    exigir_erro(resposta, 422, "dados_invalidos", campo=campo)
    assert fotografia(motor) == antes
    assert definicoes_na_bd(motor) == {}


@pytest.mark.parametrize("campo", ["maps_url", "instagram"])
def test_o_valor_recusado_nunca_volta_na_resposta(
    gestao: TestClient, campo: str
) -> None:
    resposta = _pedir(gestao, campo, "javascript:MARCADOR_DE_TESTE")
    assert resposta.status_code == 422
    assert "MARCADOR_DE_TESTE" not in resposta.text


@pytest.mark.parametrize("campo", ["maps_url", "instagram"])
def test_controlo_https_e_aceite_e_guardado_tal_e_qual(
    gestao: TestClient, motor: Engine, campo: str
) -> None:
    """Sem isto, os 422 acima podiam ser de um corpo que nunca foi válido."""
    valor = BASE[campo]
    resposta = _pedir(gestao, campo, valor)
    assert resposta.status_code == 200, resposta.text
    assert resposta.json()[campo] == valor
    assert definicoes_na_bd(motor)[campo] == valor


@pytest.mark.parametrize("campo", ["maps_url", "instagram"])
@pytest.mark.parametrize("valor", ["HTTPS://www.instagram.com/exemplo", ""])
def test_o_esquema_em_maiusculas_e_o_vazio_sao_aceites(
    gestao: TestClient, campo: str, valor: str
) -> None:
    resposta = _pedir(gestao, campo, valor)
    assert resposta.status_code == 200, resposta.text
    assert resposta.json()[campo] == valor


@pytest.mark.parametrize(
    "valor",
    [
        "https://www.instagram.com/tomazia.bar",
        "https://instagram.com/tomazia.bar",
    ],
)
def test_instagram_aceita_os_dois_anfitrioes_do_instagram(
    gestao: TestClient, valor: str
) -> None:
    resposta = _pedir(gestao, "instagram", valor)
    assert resposta.status_code == 200, resposta.text
    assert resposta.json()["instagram"] == valor


@pytest.mark.parametrize(
    "valor",
    [
        "https://evil.example.test/tomazia",
        "https://instagram.com.evil.example.test/tomazia",
        "https://evilinstagram.com/tomazia",
        "https://www.instagram.com@evil.example.test/tomazia",
        "https://instagram.com:pass@evil.example.test/",
        "https://evil.example.test/www.instagram.com",
        "https://evil.example.test/?u=https://www.instagram.com/x",
    ],
)
def test_instagram_recusa_outros_anfitrioes_mesmo_com_https(
    gestao: TestClient, motor: Engine, valor: str
) -> None:
    antes = fotografia(motor)
    resposta = _pedir(gestao, "instagram", valor)
    exigir_erro(resposta, 422, "dados_invalidos", campo="instagram")
    assert fotografia(motor) == antes


def test_maps_url_aceita_outros_anfitrioes_https(gestao: TestClient) -> None:
    for valor in (
        "https://maps.app.goo.gl/exemplo123",
        "https://www.google.com/maps/place/Estarreja",
    ):
        resposta = _pedir(gestao, "maps_url", valor)
        assert resposta.status_code == 200, resposta.text
