"""Factories de dados falsos para os testes dos modelos (F2-01).

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_subprocesso.py` não é.

Todos os valores são claramente falsos e nunca batem com nada do bar real:
`cliente@exemplo.test` (o TLD `.test` está reservado pela RFC 2606 e nunca
resolve), `912345678`, "de exemplo" nos nomes. Nenhum produto, categoria,
evento ou contacto daqui corresponde ao Bar da Tomazia — inventar factos
sobre o bar é proibido pelo `CLAUDE.md`, e dados falsos num teste são a
forma de não o fazer por acidente.

Os imports de `app.models` são deliberadamente **dentro** das funções: ao
nível do módulo, um `app/models/` que ainda não existe rebentaria na
recolha do pytest e os testes apareceriam como erro de recolha, sem nome,
em vez de falharem um a um a dizer o que falta.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - só para anotações
    from app.models.admins import Admin
    from app.models.clientes import Cliente
    from app.models.definicoes import Definicao
    from app.models.ementa import Categoria, Produto
    from app.models.eventos import Evento
    from app.models.fotos import Foto

EMAIL_FALSO = "cliente@exemplo.test"
TELEMOVEL_FALSO = "912345678"
IP_HASH_FALSO = "hash-falso-de-ip-0000000000000000"
TOKEN_CANCELAR_FALSO = "token-falso-de-cancelamento-0001"
VERSAO_TERMOS_FALSA = "2026-01-01"

#: Um instante fixo, com fuso, para nenhum teste depender do relógio.
#: 2026-06-20 às 11:00 UTC é 12:00 em Lisboa (WEST, UTC+1) — o mesmo caso
#: que `tests/modelos/test_datas_utc.py` mede pelos dois lados.
INSTANTE_FALSO = datetime(2026, 6, 20, 11, 0, tzinfo=UTC)


def nova_categoria(**campos: Any) -> Categoria:
    from app.models.ementa import Categoria

    valores: dict[str, Any] = {
        "nome": "Bebidas de exemplo",
        "slug": "bebidas-de-exemplo",
        "ordem": 1,
        "visivel": True,
    }
    valores.update(campos)
    return Categoria(**valores)


def novo_produto(categoria_id: int, **campos: Any) -> Produto:
    from app.models.ementa import Produto

    valores: dict[str, Any] = {
        "categoria_id": categoria_id,
        "nome": "Imperial de exemplo",
        "descricao": None,
        "preco_cent": 150,
        "disponivel": True,
        "ordem": 1,
    }
    valores.update(campos)
    return Produto(**valores)


def novo_evento(**campos: Any) -> Evento:
    from app.models.eventos import Evento

    valores: dict[str, Any] = {
        "titulo": "Noite de exemplo",
        "inicio": INSTANTE_FALSO,
        "descricao": None,
        "imagem": None,
        "publicado": False,
    }
    valores.update(campos)
    return Evento(**valores)


def nova_foto(**campos: Any) -> Foto:
    from app.models.fotos import Foto

    valores: dict[str, Any] = {
        "ficheiro": "00000000-0000-4000-8000-000000000001.webp",
        "estado": "pendente",
        "descricao": None,
        "enviada_por": None,
        "ip_hash": IP_HASH_FALSO,
    }
    valores.update(campos)
    return Foto(**valores)


def novo_cliente(**campos: Any) -> Cliente:
    from app.models.clientes import Cliente

    valores: dict[str, Any] = {
        "nome": "Cliente de Exemplo",
        "email": EMAIL_FALSO,
        "telemovel": TELEMOVEL_FALSO,
        "consentimento_em": INSTANTE_FALSO,
        "versao_termos": VERSAO_TERMOS_FALSA,
        "token_cancelar": TOKEN_CANCELAR_FALSO,
    }
    valores.update(campos)
    return Cliente(**valores)


def novo_admin(**campos: Any) -> Admin:
    from app.models.admins import Admin

    valores: dict[str, Any] = {
        "utilizador": "dono-de-exemplo",
        # Não é um hash argon2id verdadeiro de password nenhuma: é texto
        # fixo, para nenhum teste guardar uma credencial que se pareça com
        # uma real.
        "hash_password": "$argon2id$falso$so$para$testes",
    }
    valores.update(campos)
    return Admin(**valores)


def nova_definicao(chave: str, valor: str) -> Definicao:
    from app.models.definicoes import Definicao

    return Definicao(chave=chave, valor=valor)
