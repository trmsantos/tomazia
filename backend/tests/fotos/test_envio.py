"""`POST /fotos`: contrato, códigos e o campo-isco contra bots.

Decisões do plano, fixadas aqui para os dois lados nunca divergirem:

- sucesso é sempre `202 {"estado": "pendente"}`, sem `id` — é o que torna
  o corpo do caminho feliz **byte a byte igual** ao do campo-isco
  preenchido, sem inventar um id falso para um envio que nunca aconteceu;
- o nome do ficheiro e o `Content-Type` do cliente são ignorados por
  completo: o que decide se a imagem é aceite é o Pillow, nunca a
  extensão nem o cabeçalho HTTP.

O campo escondido contra bots é `website` (fixado pelo enunciado desta
tarefa, não uma escolha deste ficheiro): um formulário normal deixa-o
vazio; só um robô que preencha todos os campos de um formulário o põe a
algo.

Os critérios de segurança (S-01, S-02, S-03, S-11, EXIF, limite por IP)
vivem em `tests/seguranca/`; este ficheiro é o contrato geral do envio.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image
from sqlalchemy import text

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


class TestCaminhoFeliz:
    def test_jpeg_valido_e_202_com_o_corpo_exato_do_contrato(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())

        assert resposta.status_code == 202, resposta.text
        corpo = resposta.json()
        assert corpo == {"estado": "pendente"}
        assert set(corpo) == {"estado"}, (
            "o corpo não pode trazer `id`: é o que o torna igual ao do "
            "campo-isco, byte a byte"
        )

    def test_png_e_webp_tambem_sao_aceites(self, sessao: Session) -> None:
        """A lista branca é JPEG/PNG/WebP, não só JPEG."""
        resposta_png = apoio_fotos.enviar_foto(
            apoio_fotos.cliente_com_ip("192.0.2.21"),
            apoio_fotos.png_valido(),
            nome_ficheiro="a.png",
            tipo_mime="image/png",
        )
        resposta_webp = apoio_fotos.enviar_foto(
            apoio_fotos.cliente_com_ip("192.0.2.22"),
            apoio_fotos.webp_valido(),
            nome_ficheiro="a.webp",
            tipo_mime="image/webp",
        )

        assert resposta_png.status_code == 202, resposta_png.text
        assert resposta_webp.status_code == 202, resposta_webp.text

    def test_nome_e_content_type_do_cliente_sao_ignorados(
        self, cliente: TestClient, sessao: Session
    ) -> None:
        """Um `.php` no nome e um `Content-Type` qualquer, com bytes de JPEG válido: aceite."""
        resposta = apoio_fotos.enviar_foto(
            cliente,
            apoio_fotos.jpeg_valido(),
            nome_ficheiro="nada-a-ver.php",
            tipo_mime="text/plain",
        )
        assert resposta.status_code == 202, resposta.text


class TestCodigos:
    def test_sem_ficheiro_nenhum_e_422(self, cliente: TestClient) -> None:
        """Um campo obrigatório em falta é validação do pedido (422), não 400 do Pillow.

        `422`, não um intervalo largo de "qualquer 4xx": um `404` (rota
        que não existe) também cairia num intervalo largo e deixava este
        teste verde sem a rota ter sido sequer registada.
        """
        from tests.apoio_auth import CABECALHO_MUTACAO

        resposta = cliente.post("/fotos", data={}, headers=CABECALHO_MUTACAO)
        assert resposta.status_code == 422, resposta.text

    def test_sem_x_tomazia_e_403(self, cliente: TestClient) -> None:
        """O guarda estrutural do S-06 aplica-se a `/fotos`: é uma mutação como outra qualquer."""
        resposta = cliente.post(
            "/fotos",
            files={
                apoio_fotos.CAMPO_FICHEIRO: (
                    "foto.jpg",
                    apoio_fotos.jpeg_valido(),
                    "image/jpeg",
                )
            },
        )
        assert resposta.status_code == 403


class TestCampoIsco:
    def test_preenchido_da_202_identico_ao_caminho_feliz_sem_linhas_nem_ficheiros(
        self, sessao: Session
    ) -> None:
        """IPs diferentes para os dois envios: o teste é sobre o isco, não sobre o limite por IP."""
        caminho_feliz = apoio_fotos.enviar_foto(
            apoio_fotos.cliente_com_ip("192.0.2.31"), apoio_fotos.jpeg_valido()
        )
        isco = apoio_fotos.enviar_foto(
            apoio_fotos.cliente_com_ip("192.0.2.32"),
            apoio_fotos.jpeg_valido(),
            campos={apoio_fotos.CAMPO_ISCO: "https://spam.exemplo.test"},
        )

        assert caminho_feliz.status_code == isco.status_code == 202
        assert isco.text == caminho_feliz.text, (
            "o corpo do campo-isco tem de ser byte a byte igual ao do "
            f"caminho feliz: {isco.text!r} != {caminho_feliz.text!r}"
        )

        quantas = sessao.execute(text("SELECT COUNT(*) FROM fotos")).scalar_one()
        assert quantas == 1, (
            f"só o envio genuíno pode ter criado uma linha; havia {quantas}"
        )

        from app.config import obter_definicoes

        pendentes = list(obter_definicoes().pendentes_dir.iterdir())
        assert len(pendentes) == 1, (
            f"só o envio genuíno pode ter escrito um ficheiro; havia {pendentes}"
        )


def test_jpeg_com_qualidade_reduzida_continua_a_abrir_como_webp(
    sessao: Session,
) -> None:
    """Controlo de sanidade da fábrica: uma imagem maior também passa pelo caminho normal."""
    buffer = io.BytesIO()
    Image.new("RGB", (400, 300), (12, 34, 56)).save(buffer, format="JPEG", quality=85)

    resposta = apoio_fotos.enviar_foto(
        apoio_fotos.cliente_com_ip("192.0.2.33"), buffer.getvalue()
    )

    assert resposta.status_code == 202, resposta.text
