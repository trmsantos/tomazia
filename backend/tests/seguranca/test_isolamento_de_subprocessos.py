"""Nenhum subprocesso da suite resolve o ficheiro de ambiente para dentro do `backend/` real.

Achado [média] da ronda de correções da F1-02: `tests/test_openapi_export.py`
lançava subprocessos com `PYTHONPATH` a apontar para o `backend/` real (é
preciso, para `import app` funcionar) sem nunca definir `TOMAZIA_ENV_FILE`.
`app.config.caminho_ficheiro_de_ambiente()` resolvia, por omissão, para
`RAIZ_APP / ".env"` — ou seja, `backend/.env` a sério, se algum dia vier a
existir (p. ex. para testes manuais de alguém, nunca por este repositório:
ver a regra 1 do `CLAUDE.md`, nunca se cria nem altera um `.env` aqui). O
revisor reproduziu plantando um `.env` com `AMBIENTE=producao` ali e os três
testes de export ficaram vermelhos, com o traceback do pydantic a imprimir
as definições no log de CI.

Dois testes, duas camadas:

1. `test_ambiente_isolado_nunca_aponta_tomazia_env_file_para_dentro_do_backend_real`
   prende o dicionário em si — não precisa de correr nenhum subprocesso.
2. `test_subprocesso_de_export_ignora_env_de_producao_plantado_numa_copia_do_backend`
   reproduz o cenário do revisor a sério, de ponta a ponta, mas sempre numa
   cópia de `app/` dentro de `tmp_path` — nunca no `backend/` real.

A construção do ambiente isolado (`construir_ambiente_isolado_para_openapi`)
vive em `tests.apoio_subprocesso`, não em `tests/test_openapi_export.py`: um
`tests/seguranca/` nunca deve depender de um privado de um ficheiro
`test_*.py` fora de si (`uv run pytest tests/seguranca` tem de continuar
autónomo), só de um módulo de apoio partilhado, sem `test_` no nome.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from tests.apoio_subprocesso import (
    RAIZ_BACKEND,
    construir_ambiente_isolado_para_openapi,
)


def test_ambiente_isolado_nunca_aponta_tomazia_env_file_para_dentro_do_backend_real(
    tmp_path: Path,
) -> None:
    destino = tmp_path / "esquema.json"

    ambiente = construir_ambiente_isolado_para_openapi(destino)

    assert "TOMAZIA_ENV_FILE" in ambiente, (
        "sem TOMAZIA_ENV_FILE explícito, o subprocesso de export resolveria "
        "o ficheiro de ambiente por omissão — o backend/.env real, se "
        "algum dia vier a existir"
    )
    caminho_tomazia_env_file = Path(ambiente["TOMAZIA_ENV_FILE"]).resolve()
    assert RAIZ_BACKEND.resolve() not in caminho_tomazia_env_file.parents, (
        "TOMAZIA_ENV_FILE não pode resolver para dentro do backend/ real: "
        f"{caminho_tomazia_env_file}"
    )
    assert not caminho_tomazia_env_file.exists()


def test_subprocesso_de_export_ignora_env_de_producao_plantado_numa_copia_do_backend(
    tmp_path: Path,
) -> None:
    """Reproduz o achado do revisor: planta `AMBIENTE=producao` numa cópia, nunca no `backend/` real."""
    copia_do_backend = tmp_path / "copia-do-backend"
    shutil.copytree(
        RAIZ_BACKEND / "app",
        copia_do_backend / "app",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    (copia_do_backend / ".env").write_text("AMBIENTE=producao\n", encoding="utf-8")

    destino = tmp_path / "esquema.json"
    outra_pasta = tmp_path / "outra-pasta-de-trabalho"
    outra_pasta.mkdir()

    ambiente = construir_ambiente_isolado_para_openapi(destino)
    ambiente["PYTHONPATH"] = str(copia_do_backend)

    resultado = subprocess.run(
        [sys.executable, "-m", "app.openapi", str(destino)],
        cwd=outra_pasta,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert resultado.returncode == 0, resultado.stderr
    assert destino.exists()
