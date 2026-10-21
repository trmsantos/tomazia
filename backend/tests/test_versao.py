"""Testes de `app.versao`.

Prendem o contrato de `obter_versao()` (F1-02): sem cache, caminho resolvido
a cada chamada, no máximo ~200 bytes lidos, só a primeira linha, saneada por
`^[A-Za-z0-9._-]{1,64}$`; qualquer erro de leitura ou valor fora desse
formato devolve `"dev"`, nunca propaga exceção. Os testes ao nível HTTP
(`GET /health`) estão em `test_health.py`; aqui só se chama `obter_versao`
diretamente.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


def test_caminho_version_e_relativo_ao_pacote_app_nao_a_pasta_de_trabalho(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`CAMINHO_VERSION` é `<raiz do backend>/VERSION`, sempre, mesmo se a pasta de trabalho mudar."""
    import sys

    import app

    monkeypatch.chdir(tmp_path)
    sys.modules.pop("app.versao", None)

    from app import versao

    esperado = Path(app.__file__).resolve().parent.parent / "VERSION"

    assert esperado == versao.CAMINHO_VERSION


def test_sem_ficheiro_version_devolve_dev(tmp_path: Path) -> None:
    from app.versao import obter_versao

    assert obter_versao(tmp_path / "VERSION-que-nao-existe") == "dev"


def test_sha_curto_com_newline_final_e_devolvido_sem_a_newline(tmp_path: Path) -> None:
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("9d6df5d\n", encoding="utf-8")

    assert obter_versao(caminho) == "9d6df5d"


def test_sha_com_quarenta_caracteres_hexadecimais_e_devolvido_tal_e_qual(
    tmp_path: Path,
) -> None:
    from app.versao import obter_versao

    sha_completo = "0123456789abcdef0123456789abcdef01234567"
    assert len(sha_completo) == 40
    caminho = tmp_path / "VERSION"
    caminho.write_text(sha_completo, encoding="utf-8")

    assert obter_versao(caminho) == sha_completo


def test_version_vazio_devolve_dev(tmp_path: Path) -> None:
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("", encoding="utf-8")

    assert obter_versao(caminho) == "dev"


def test_version_so_espacos_devolve_dev(tmp_path: Path) -> None:
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("   \t  \n", encoding="utf-8")

    assert obter_versao(caminho) == "dev"


def test_version_com_varias_linhas_usa_apenas_a_primeira(tmp_path: Path) -> None:
    """Demonstra, a favor: uma segunda linha de lixo não impede ler um SHA válido na primeira."""
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("9d6df5d\nisto nunca devia ser lido\n", encoding="utf-8")

    assert obter_versao(caminho) == "9d6df5d"


def test_version_com_varias_linhas_e_primeira_linha_invalida_devolve_dev(
    tmp_path: Path,
) -> None:
    """Mesmo contrato, ao contrário: só a primeira linha conta, e aqui é ela que é inválida.

    A segunda linha, sozinha, seria um SHA aceitável (`9d6df5d`) — se o
    saneamento considerasse qualquer linha do ficheiro (em vez de só a
    primeira), este caso devolveria esse SHA em vez de `"dev"`.
    """
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("sha inválido com espaços\n9d6df5d\n", encoding="utf-8")

    assert obter_versao(caminho) == "dev"


def test_version_com_cinco_kb_de_lixo_devolve_dev(tmp_path: Path) -> None:
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_bytes(b"x" * 5000)

    assert obter_versao(caminho) == "dev"


def test_version_com_caracteres_fora_do_conjunto_permitido_devolve_dev(
    tmp_path: Path,
) -> None:
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("sha/com/barras:e:dois:pontos", encoding="utf-8")

    assert obter_versao(caminho) == "dev"


def test_version_e_uma_pasta_devolve_dev_sem_rebentar(tmp_path: Path) -> None:
    """`IsADirectoryError`: uma pasta chamada `VERSION` não pode fazer `obter_versao` rebentar."""
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.mkdir()

    assert obter_versao(caminho) == "dev"


def test_version_com_bytes_invalidos_em_utf8_devolve_dev(tmp_path: Path) -> None:
    """`UnicodeDecodeError`: bytes que não são UTF-8 válido não podem fazer `obter_versao` rebentar."""
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_bytes(b"\xff\xfe\x00\x01-nao-e-utf8-valido")

    assert obter_versao(caminho) == "dev"


@pytest.mark.skipif(
    os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
    reason="raiz ou Windows ignoram/não suportam permissões POSIX de leitura",
)
def test_version_sem_permissao_de_leitura_devolve_dev(tmp_path: Path) -> None:
    """`PermissionError`: um `VERSION` ilegível não pode fazer `obter_versao` rebentar."""
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"
    caminho.write_text("9d6df5d", encoding="utf-8")
    caminho.chmod(0o000)
    try:
        assert obter_versao(caminho) == "dev"
    finally:
        caminho.chmod(0o644)


def test_obter_versao_nunca_tem_cache_entre_chamadas(tmp_path: Path) -> None:
    """Sem `VERSION`, depois com um SHA, depois com outro: três chamadas, três respostas.

    É este o comportamento de que o `esperar-versao.sh` da F1-04 precisa: se
    `obter_versao` tivesse cache, um processo Passenger que sobrevivesse ao
    deploy continuaria a reportar o SHA antigo para sempre.
    """
    from app.versao import obter_versao

    caminho = tmp_path / "VERSION"

    assert obter_versao(caminho) == "dev"

    caminho.write_text("9d6df5d", encoding="utf-8")
    assert obter_versao(caminho) == "9d6df5d"

    caminho.write_text("abcdef1", encoding="utf-8")
    assert obter_versao(caminho) == "abcdef1"


def test_obter_versao_sem_argumento_usa_caminho_version_do_modulo(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Chamada sem argumentos: usa o `CAMINHO_VERSION` do módulo nesse momento, não um valor fixado."""
    from app import versao

    caminho = tmp_path / "VERSION"
    monkeypatch.setattr(versao, "CAMINHO_VERSION", caminho)

    assert versao.obter_versao() == "dev"

    caminho.write_text("9d6df5d", encoding="utf-8")
    assert versao.obter_versao() == "9d6df5d"
