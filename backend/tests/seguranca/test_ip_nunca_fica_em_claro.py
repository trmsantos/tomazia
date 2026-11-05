"""O IP de quem envia uma foto nunca aparece em claro na base de dados.

`fotos.ip_hash` existe desde a F2-01 precisamente para isto: o que fica
escrito é um resumo, nunca o IP (`docs/ESPECIFICACAO.md`: "Fotos: [...]
ignora nome e `Content-Type` do cliente [...] 5 por hora por IP"; o `hash`
no nome da coluna é a promessa).

Este teste lê os **bytes crus** do ficheiro da base de dados — não uma
consulta pelo ORM, que só provaria que a coluna se chama `ip_hash`, não
que o valor lá dentro não é o IP em claro. SQLite em modo WAL
(`backend/CLAUDE.md`) pode manter uma escrita recente só no ficheiro
`-wal`, sem nunca a levar ao ficheiro principal durante o teste — por isso
os dois sidecars (`-wal`, `-shm`) entram na procura também.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import make_url, select

from tests import apoio_fotos

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

IP_DE_EXEMPLO = "198.51.100.7"


def _ficheiros_da_base_de_dados() -> list[Path]:
    from app.config import obter_definicoes

    url = make_url(obter_definicoes().base_dados_url)
    assert url.database is not None
    base = Path(url.database)
    candidatos = [
        base,
        base.with_name(base.name + "-wal"),
        base.with_name(base.name + "-shm"),
    ]
    return [caminho for caminho in candidatos if caminho.exists()]


def test_o_ip_nunca_aparece_em_claro_nos_ficheiros_da_bd(sessao: Session) -> None:
    from app.models.fotos import Foto

    cliente = apoio_fotos.cliente_com_ip(IP_DE_EXEMPLO)
    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text

    linha = sessao.scalars(select(Foto)).one()
    assert linha.ip_hash != IP_DE_EXEMPLO, "o `ip_hash` não pode ser o próprio IP"

    procurado = IP_DE_EXEMPLO.encode("ascii")
    ficheiros = _ficheiros_da_base_de_dados()
    assert ficheiros, "não encontrei nenhum ficheiro da base de dados para verificar"
    for caminho in ficheiros:
        conteudo = caminho.read_bytes()
        assert procurado not in conteudo, (
            f"{caminho} contém o IP {IP_DE_EXEMPLO!r} em claro"
        )
