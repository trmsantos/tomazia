"""B2: `descricao` e `enviada_por` têm um limite, aplicado na fronteira.

Medido (achado de revisão da F2-06): o SQLite **não impõe** o
`String(255)`/`String(60)` do modelo (`app/models/fotos.py`) — guarda
qualquer tamanho, sem se queixar. Uma `descricao` de 2 MB e um
`enviada_por` de 5000 carateres eram aceites, e `GET /gestao/fotos`
devolvia isso tudo ao dono. A validação tem de estar em
`app.services.fotos.registar_envio`, antes de a linha chegar à base de
dados.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: `app/services/fotos.py`: os mesmos números do `String(255)` e do
#: `String(60)` de `app/models/fotos.py`.
LIMITE_DESCRICAO = 255
LIMITE_ENVIADA_POR = 60


def test_descricao_ate_ao_limite_e_aceite(cliente: TestClient, sessao: Session) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_valido(),
        campos={apoio_fotos.CAMPO_DESCRICAO: "a" * LIMITE_DESCRICAO},
    )
    assert resposta.status_code == 202, resposta.text


def test_descricao_acima_do_limite_e_422_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_valido(),
        campos={apoio_fotos.CAMPO_DESCRICAO: "a" * (LIMITE_DESCRICAO + 1)},
    )
    assert resposta.status_code == 422, resposta.text
    assert resposta.json()["erro"] == "descricao_grande_demais"
    apoio_fotos.exigir_nada_escrito(sessao)


def test_descricao_de_2_mb_e_422_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    """O cenário medido em revisão: 2 MB, não só "um carácter a mais"."""
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_valido(),
        campos={apoio_fotos.CAMPO_DESCRICAO: "a" * (2 * 1024 * 1024)},
    )
    assert resposta.status_code == 422, resposta.text
    apoio_fotos.exigir_nada_escrito(sessao)


def test_enviada_por_ate_ao_limite_e_aceite(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_valido(),
        campos={apoio_fotos.CAMPO_ENVIADA_POR: "a" * LIMITE_ENVIADA_POR},
    )
    assert resposta.status_code == 202, resposta.text


def test_enviada_por_acima_do_limite_e_422_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_valido(),
        campos={apoio_fotos.CAMPO_ENVIADA_POR: "a" * (LIMITE_ENVIADA_POR + 1)},
    )
    assert resposta.status_code == 422, resposta.text
    assert resposta.json()["erro"] == "enviada_por_grande_demais"
    apoio_fotos.exigir_nada_escrito(sessao)


def test_enviada_por_de_5000_carateres_e_422_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    """O cenário medido em revisão: 5000 carateres."""
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_valido(),
        campos={apoio_fotos.CAMPO_ENVIADA_POR: "a" * 5000},
    )
    assert resposta.status_code == 422, resposta.text
    apoio_fotos.exigir_nada_escrito(sessao)
