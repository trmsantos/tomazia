"""`criar_admin.py` e `backup.py` nunca imprimem o `SEGREDO_SESSAO` (F2-02).

Medido na revisão: com `AMBIENTE=producao` e um segredo curto, os dois
scripts imprimiam o `ValidationError` do pydantic inteiro, que traz
`input_value={... 'segredo_sessao': '<o valor>' ...}`. O relatório destes
scripts sai em `stdout` e copia-se para pedir ajuda: o segredo que assina
as sessões não pode ir lá. A frase também não pode afirmar que falta o
`AMBIENTE` quando o problema é outro (regra 10 do `CLAUDE.md`).
"""

from __future__ import annotations

from pathlib import Path

from tests.apoio_scripts_de_admin import (
    RAIZ_BACKEND,
    UTILIZADOR_DE_EXEMPLO,
    ambiente_backup,
    ambiente_criar_admin,
    correr_com_stdin_devnull,
    exigir_backup,
    exigir_criar_admin,
)

#: Curto de propósito (recusado em produção) e reconhecível.
SEGREDO_CURTO = "SEGREDO-CURTO-XYZ"


def test_criar_admin_nao_mostra_o_segredo_da_sessao(bd_em_head: Path) -> None:
    ambiente = ambiente_criar_admin(
        bd_em_head,
        ambiente_extra={"AMBIENTE": "producao", "SEGREDO_SESSAO": SEGREDO_CURTO},
    )
    resultado = correr_com_stdin_devnull(
        exigir_criar_admin(),
        ["--utilizador", UTILIZADOR_DE_EXEMPLO],
        cwd=RAIZ_BACKEND,
        ambiente=ambiente,
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert SEGREDO_CURTO not in resultado.tudo, resultado.relatorio()
    assert "Traceback" not in resultado.tudo, resultado.relatorio()


def test_backup_nao_mostra_o_segredo_da_sessao(
    bd_em_head: Path, tmp_path: Path
) -> None:
    ambiente = ambiente_backup(
        bd_em_head,
        data_dir=tmp_path / "dados",
        ambiente_extra={"AMBIENTE": "producao", "SEGREDO_SESSAO": SEGREDO_CURTO},
    )
    resultado = correr_com_stdin_devnull(
        exigir_backup(), [], cwd=RAIZ_BACKEND, ambiente=ambiente
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert SEGREDO_CURTO not in resultado.tudo, resultado.relatorio()
    assert "Traceback" not in resultado.tudo, resultado.relatorio()
