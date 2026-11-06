"""Critério S-02: JPEG válido com PHP colado no fim é aceite como WebP novo.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-02 | JPEG válido com PHP colado no fim | Aceite; ficheiro guardado é WebP novo sem `<?php` |

`docs/ESPECIFICACAO.md`, linha 78. O ficheiro continua a ser um JPEG
perfeitamente válido para o Pillow — o `<?php ... ?>` colado depois do
marcador EOI é lixo que o descodificador de JPEG ignora, exatamente como
um `.php` escondido depois de uma imagem verdadeira que um upload ingénuo
deixaria passar para o disco tal e qual. A defesa não é recusar o
ficheiro: é nunca guardar os bytes originais — o que sai para o disco é
sempre uma recodificação nascida de `Image.save(..., "WEBP")`, nunca uma
cópia.

Dois detalhes do contrato que o plano fixou: o corpo de sucesso é
`{"estado": "pendente"}`, sem `id`; e o ficheiro guardado é
`<uuid4().hex>.webp` — nunca o nome que o cliente mandou.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from PIL import Image
from sqlalchemy import select

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: `<uuid4().hex>.webp`: 32 carateres hexadecimais em minúsculas.
PADRAO_NOME_ALEATORIO = re.compile(r"^[0-9a-f]{32}\.webp$")


def test_aceite_e_o_ficheiro_guardado_e_webp_novo_sem_php(
    cliente: TestClient, sessao: Session
) -> None:
    """Deixa passar: o conteúdo visual da imagem — só a forma do ficheiro guardado."""
    conteudo = apoio_fotos.jpeg_com_php_colado()
    assert b"<?php" in conteudo, "o cenário tem de levar mesmo o PHP colado"

    resposta = apoio_fotos.enviar_foto(
        cliente, conteudo, nome_ficheiro="ferias.jpg.php", tipo_mime="image/jpeg"
    )

    assert resposta.status_code == 202, resposta.text
    assert resposta.json() == {"estado": "pendente"}

    from app.config import obter_definicoes

    pendentes = list(obter_definicoes().pendentes_dir.iterdir())
    assert len(pendentes) == 1, (
        f"esperava um ficheiro em pendentes/, encontrei {pendentes}"
    )
    guardado = pendentes[0]

    assert PADRAO_NOME_ALEATORIO.match(guardado.name), (
        f"{guardado.name!r} não tem a forma <uuid4().hex>.webp"
    )

    bytes_guardados = guardado.read_bytes()
    assert bytes_guardados[:4] == b"RIFF", "um WebP começa por RIFF"
    assert bytes_guardados[8:12] == b"WEBP"
    assert b"<?php" not in bytes_guardados, (
        "os bytes originais não podiam ter sobrevivido"
    )

    with Image.open(guardado) as imagem:
        assert imagem.format == "WEBP"

    from app.models.fotos import EstadoFoto, Foto

    linha = sessao.scalars(select(Foto)).one()
    assert linha.ficheiro == guardado.name
    assert linha.estado == EstadoFoto.PENDENTE
