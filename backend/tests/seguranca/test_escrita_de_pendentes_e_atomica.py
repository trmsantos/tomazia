"""C3: a escrita em `pendentes/` é atómica — temporário + `os.replace`, nunca direta.

Medido (achado de revisão da F2-06): mutar
`app.services.fotos._escrever_em_pendentes` para escrever direto no nome
final (`destino.write_bytes(conteudo)`, sem passar por um `.tmp-<uuid>` e
um `os.replace`) deixava os 400 testes de fotos verdes na mesma — nenhum
observava **como** o ficheiro chegava ao disco, só que lá chegava. Sem a
troca atómica, um processo interrompido a meio da escrita (falha de
energia, `kill -9`, disco cheio a meio) deixava um ficheiro corrompido com
o nome definitivo — o mesmo que `fotos.ficheiro` aponta — servível a
qualquer pedido que chegasse entretanto.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from tests import apoio_fotos

if TYPE_CHECKING:
    import pytest
    from fastapi.testclient import TestClient

#: `.tmp-<uuid4().hex>`: o nome temporário que `_escrever_em_pendentes` usa.
PADRAO_TEMPORARIO = re.compile(r"^\.tmp-[0-9a-f]{32}$")
#: `<uuid4().hex>.webp`: o nome definitivo.
PADRAO_DEFINITIVO = re.compile(r"^[0-9a-f]{32}\.webp$")


def test_o_ficheiro_chega_ao_disco_por_os_replace_de_um_temporario(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient
) -> None:
    from app.services import fotos as servico

    chamadas: list[tuple[str, str]] = []
    original = servico.os.replace

    def espia(origem: object, destino: object) -> None:
        nome_origem = getattr(origem, "name", str(origem))
        nome_destino = getattr(destino, "name", str(destino))
        # No instante da chamada, o nome definitivo ainda não pode existir
        # — é o `os.replace` que o vai criar, atomicamente, a partir do
        # temporário.
        destino_path = destino if hasattr(destino, "exists") else None
        if destino_path is not None:
            assert not destino_path.exists(), (
                f"{nome_destino!r} já existia antes do `os.replace` — a "
                "escrita não está a passar por um temporário"
            )
        chamadas.append((nome_origem, nome_destino))
        original(origem, destino)

    monkeypatch.setattr(servico.os, "replace", espia)

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text

    assert len(chamadas) == 1, f"esperava um só `os.replace`, houve {chamadas}"
    nome_origem, nome_destino = chamadas[0]
    assert PADRAO_TEMPORARIO.match(nome_origem), (
        f"{nome_origem!r} não tem a forma de um nome temporário "
        f"(`{PADRAO_TEMPORARIO.pattern}`) — a escrita pode estar a ir "
        "direta para o nome definitivo"
    )
    assert PADRAO_DEFINITIVO.match(nome_destino), (
        f"{nome_destino!r} não tem a forma <uuid4().hex>.webp"
    )
