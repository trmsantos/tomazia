"""C3: `hash_do_ip` usa uma chave derivada do `segredo_sessao`, não um `sha256` nu.

Medido (achado de revisão da F2-06): mutar `hash_do_ip` para
`hashlib.sha256(ip.encode()).hexdigest()` (sem chave) deixava
`tests/seguranca/test_ip_nunca_fica_em_claro.py` verde na mesma — esse
teste só verifica que o IP não aparece **em claro**, nunca que o hash é
**imprevisível**. Um `sha256` sem chave não cumpre isso: o espaço IPv4
inteiro são 2³² hashes, percorríveis em minutos (ADR 0017) — seria o IP
em claro com passos a mais.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

IP_DE_EXEMPLO = "198.51.100.42"


def test_o_hash_nao_e_um_sha256_nu_do_ip() -> None:
    from app.services import limites

    sha256_nu = hashlib.sha256(IP_DE_EXEMPLO.encode("utf-8")).hexdigest()
    assert limites.hash_do_ip(IP_DE_EXEMPLO) != sha256_nu, (
        "`hash_do_ip` não pode coincidir com um `sha256` sem chave — "
        "um atacante percorre o espaço IPv4 inteiro em minutos e descobre "
        "a que IP cada hash corresponde"
    )


def test_mudar_o_segredo_da_sessao_muda_o_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Consequência do ADR 0017: `hash_do_ip` depende do `SEGREDO_SESSAO`."""
    from app.config import obter_definicoes
    from app.services import limites

    primeiro = limites.hash_do_ip(IP_DE_EXEMPLO)

    monkeypatch.setenv(
        "SEGREDO_SESSAO", "outro-segredo-de-exemplo-bem-diferente-0000000000"
    )
    obter_definicoes.cache_clear()
    try:
        segundo = limites.hash_do_ip(IP_DE_EXEMPLO)
    finally:
        obter_definicoes.cache_clear()

    assert primeiro != segundo, (
        "o hash do mesmo IP tinha de mudar com o `SEGREDO_SESSAO` — se não "
        "muda, a chave não está a entrar na derivação"
    )


def test_o_hash_e_deterministico_para_o_mesmo_ip_e_segredo() -> None:
    from app.services import limites

    assert limites.hash_do_ip(IP_DE_EXEMPLO) == limites.hash_do_ip(IP_DE_EXEMPLO)
