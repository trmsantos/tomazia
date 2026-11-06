"""Critério S-01: `.php` declarado como `image/jpeg` é 400, nada escrito em disco.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-01 | `.php` declarado como `image/jpeg` | 400, nada escrito em disco |

`docs/ESPECIFICACAO.md`, linha 77. O plano desta tarefa é explícito: o
nome e o `Content-Type` do cliente são ignorados por completo — não é "a
extensão engana a validação", é o Pillow a tentar abrir bytes que não são
uma imagem nenhuma, goste a mentira do cabeçalho HTTP do que disser.

"Nada escrito em disco" tem três pernas, e as três se afirmam juntas
(`tests.apoio_fotos.exigir_nada_escrito`): a pasta de pendentes
(`DATA_DIR/pendentes`), a pasta pública (`MEDIA_DIR`) e a tabela `fotos`.
O `SpooledTemporaryFile` que o Starlette usa para receber o corpo do
pedido, em `/tmp`, não conta — é temporário da framework, fora das nossas
duas pastas.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_php_declarado_como_jpeg_e_400_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    """A mentira do `Content-Type` não engana o Pillow.

    Deixa passar: a mensagem exata do erro — só o estado 400, o envelope
    `{"erro", "mensagem"}` e os três sítios onde nada pode ter aterrado.
    """
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.CARGA_PHP,
        nome_ficheiro="shell.php",
        tipo_mime="image/jpeg",
    )

    assert resposta.status_code == 400, resposta.text
    corpo = resposta.json()
    assert "erro" in corpo and "mensagem" in corpo, corpo

    apoio_fotos.exigir_nada_escrito(sessao)


def test_lixo_qualquer_declarado_como_jpeg_e_400_sem_nada_escrito(
    cliente: TestClient, sessao: Session
) -> None:
    """O mesmo resultado para bytes que nunca foram sequer um ficheiro conhecido.

    Companheiro do teste de cima: prova que a recusa não depende de
    reconhecer PHP especificamente — é "o Pillow não conseguiu abrir
    isto", para qualquer coisa que não seja uma imagem.
    """
    resposta = apoio_fotos.enviar_foto(
        cliente,
        b"isto-nao-e-uma-imagem-nenhuma" * 10,
        nome_ficheiro="qualquer-coisa.jpg",
        tipo_mime="image/jpeg",
    )

    assert resposta.status_code == 400, resposta.text
    apoio_fotos.exigir_nada_escrito(sessao)
