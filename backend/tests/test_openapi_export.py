"""Testes de `python -m app.openapi` (F1-02).

Corre sempre em subprocesso, nunca chamando `app.openapi.main()` dentro do
processo de testes: é a única forma de provar que o script funciona como vai
ser mesmo invocado (`python -m app.openapi [destino]`), com `cwd` numa pasta
qualquer — nunca escrevendo, por acidente, em `frontend/openapi.json` do
repositório real.

Achado [média] da ronda de correções da F1-02: `PYTHONPATH` aponta para o
`backend/` real (é preciso, para `import app` funcionar), mas sem
`TOMAZIA_ENV_FILE`, `app.config.caminho_ficheiro_de_ambiente()` resolvia,
por omissão, para `RAIZ_APP / ".env"` — ou seja, `backend/.env` a sério, se
algum dia vier a existir (p. ex. para testes manuais de alguém). O revisor
reproduziu plantando um `.env` com `AMBIENTE=producao` ali e os três testes
de export ficaram vermelhos, com o traceback do pydantic a imprimir as
definições no log de CI. Por isso `_correr_export` define sempre
`TOMAZIA_ENV_FILE` para um caminho inexistente dentro do `tmp_path` do
próprio teste, nunca dependente de `cwd` nem do `backend/` real — a
construção desse ambiente isolado vive agora em
`tests.apoio_subprocesso.construir_ambiente_isolado_para_openapi`, reusada
por `tests/seguranca/test_isolamento_de_subprocessos.py` sem este ficheiro
ter de expor um privado a um `tests/seguranca/` que não lhe pertence.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from tests.apoio_subprocesso import (
    RAIZ_BACKEND,
    construir_ambiente_isolado_para_openapi,
)

RAIZ_REPOSITORIO = RAIZ_BACKEND.parent


def _correr_export(
    destino: Path, cwd: Path, variaveis_extra: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    ambiente = construir_ambiente_isolado_para_openapi(destino)
    if variaveis_extra:
        ambiente.update(variaveis_extra)
    return subprocess.run(
        [sys.executable, "-m", "app.openapi", str(destino)],
        cwd=cwd,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_exporta_com_sucesso_em_cwd_diferente_do_backend(tmp_path: Path) -> None:
    destino = tmp_path / "esquema.json"
    outra_pasta = tmp_path / "outra-pasta-de-trabalho"
    outra_pasta.mkdir()

    resultado = _correr_export(destino, cwd=outra_pasta)

    assert resultado.returncode == 0, resultado.stderr
    assert destino.exists()
    json.loads(destino.read_text(encoding="utf-8"))  # não pode rebentar


def test_esquema_tem_barra_health_sem_prefixo_api(tmp_path: Path) -> None:
    """As rotas exportam-se sem `/api`: é o Passenger que o acrescenta via `SCRIPT_NAME`."""
    destino = tmp_path / "esquema.json"
    outra_pasta = tmp_path / "outra-pasta-de-trabalho"
    outra_pasta.mkdir()

    resultado = _correr_export(destino, cwd=outra_pasta)
    assert resultado.returncode == 0, resultado.stderr

    esquema = json.loads(destino.read_text(encoding="utf-8"))

    assert "/health" in esquema["paths"]
    assert "/api/health" not in esquema["paths"]


def test_correr_duas_vezes_produz_bytes_identicos_e_newline_final(
    tmp_path: Path,
) -> None:
    destino = tmp_path / "esquema.json"
    outra_pasta = tmp_path / "outra-pasta-de-trabalho"
    outra_pasta.mkdir()

    primeiro = _correr_export(destino, cwd=outra_pasta)
    assert primeiro.returncode == 0, primeiro.stderr
    conteudo_1 = destino.read_bytes()

    segundo = _correr_export(destino, cwd=outra_pasta)
    assert segundo.returncode == 0, segundo.stderr
    conteudo_2 = destino.read_bytes()

    assert conteudo_1 == conteudo_2
    assert conteudo_1.endswith(b"\n")
    assert not conteudo_1.endswith(b"\n\n")


def test_destino_por_omissao_e_frontend_openapi_json_na_raiz_do_repositorio() -> None:
    """Afirma diretamente sobre a constante do destino — o contrato a sério.

    `app.openapi` não precisa de reexportar `RAIZ_APP` (que vive em
    `app.caminhos`) só para este teste: a constante que importa aqui é
    `CAMINHO_OPENAPI_OMISSAO`, o destino por omissão em si, que é o que
    `main()` usa de verdade. Nunca se chama `main()` sem argumentos, para
    não escrever em `frontend/openapi.json` do repositório real.
    """
    from app.openapi import CAMINHO_OPENAPI_OMISSAO

    assert CAMINHO_OPENAPI_OMISSAO == RAIZ_REPOSITORIO / "frontend" / "openapi.json"
