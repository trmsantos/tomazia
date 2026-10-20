"""Testes de `python -m app.openapi` (F1-02).

Corre sempre em subprocesso, nunca chamando `app.openapi.main()` dentro do
processo de testes: é a única forma de provar que o script funciona como vai
ser mesmo invocado (`python -m app.openapi [destino]`), com `cwd` numa pasta
qualquer — nunca escrevendo, por acidente, em `frontend/openapi.json` do
repositório real.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
RAIZ_REPOSITORIO = RAIZ_BACKEND.parent

# Ambiente mínimo: só o necessário para o Python do `.venv` arrancar e
# encontrar o pacote `app` (via `PYTHONPATH`, nunca via `cwd`).
_AMBIENTE_BASE = {
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONPATH": str(RAIZ_BACKEND),
}


def _correr_export(
    destino: Path, cwd: Path, variaveis_extra: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    ambiente = dict(_AMBIENTE_BASE)
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
    """Só a asserção sobre a constante — nunca se chama `main()` sem argumentos, para não escrever lá."""
    from app.openapi import RAIZ_APP

    destino_esperado = RAIZ_APP.parent / "frontend" / "openapi.json"
    assert destino_esperado == RAIZ_REPOSITORIO / "frontend" / "openapi.json"
