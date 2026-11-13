"""Segunda camada do teto do corpo: `LimitRequestBody` para `/api` no Apache.

A primeira é `app.limite_do_corpo.LimiteDoCorpo` (64 KiB, upload de fotos
isento). Esta pára os pedidos enormes **antes** de chegarem ao Passenger, e o
valor tem de ser o do maior corpo legítimo: o upload de fotos
(`LIMITE_CONTENT_LENGTH` de `app/routers/fotos.py`). Mais baixo partia o
upload; muito mais alto não limitava nada.

É lint de texto, como `test_htaccess_exemplo.py`: nenhum Apache o interpreta.
"""

from __future__ import annotations

import re
from pathlib import Path

CAMINHO = Path(__file__).resolve().parents[3] / "deploy" / "htaccess.exemplo"


def test_limit_request_body_so_para_a_api_e_igual_ao_teto_do_upload() -> None:
    from app.routers.fotos import LIMITE_CONTENT_LENGTH

    texto = CAMINHO.read_text(encoding="utf-8")
    achado = re.search(
        r'<If\s+"[^"]*/api[^"]*">\s*LimitRequestBody\s+(\d+)\s*</If>',
        texto,
        re.IGNORECASE,
    )
    assert achado is not None, (
        "falta, em deploy/htaccess.exemplo, um `<If ...api...>` com "
        "`LimitRequestBody`: sem ele o Apache entrega à API corpos de "
        "qualquer tamanho"
    )
    assert int(achado.group(1)) == LIMITE_CONTENT_LENGTH
