"""C3: o `UPDATE` de aprovar/rejeitar é condicional (`AND estado = 'pendente'`).

Medido (achado de revisão da F2-06): nenhum teste exercitava o caminho em
que o `UPDATE` **perde** a corrida — `tests/fotos/test_moderacao.py`
prova o 409 da segunda chamada **sequencial**, mas isso já é apanhado pelo
`if foto.estado != EstadoFoto.PENDENTE` anterior ao `UPDATE`, sem precisar
da condição `AND estado = 'pendente'` no próprio `UPDATE`. O `os.replace`
de volta, no ramo que trata a corrida perdida em `aprovar`, não corria em
teste nenhum.

Este ficheiro simula a corrida a sério: entre o pré-exame
(`foto.estado != PENDENTE`) e o `UPDATE` da própria chamada, outra
"moderação" (uma instrução SQL à parte, na mesma sessão — o equivalente a
outra chamada que ganhasse a corrida) muda a linha para `aprovada`. O
`UPDATE` da chamada em curso já não pode apanhar a linha.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select, update

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def _enviar_e_obter_id_e_nome(cliente: TestClient, sessao: Session) -> tuple[int, str]:
    from app.models.fotos import Foto

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text
    linha = sessao.scalars(select(Foto)).one()
    return linha.id, linha.ficheiro


def test_aprovar_perde_a_corrida_e_devolve_409_e_poe_o_ficheiro_de_volta(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient, sessao: Session
) -> None:
    from app.erros import ErroDaApi
    from app.models.fotos import EstadoFoto, Foto
    from app.services import fotos as servico

    id_foto, nome_ficheiro = _enviar_e_obter_id_e_nome(cliente, sessao)

    original_replace = servico.os.replace

    def replace_com_corrida(origem: object, destino: object) -> None:
        # O ficheiro move-se normalmente...
        original_replace(origem, destino)
        # ...e, antes de o `UPDATE` desta chamada correr, outra moderação
        # "ganha a corrida" e já aprovou a mesma foto.
        sessao.execute(
            update(Foto)
            .where(Foto.id == id_foto)
            .values(estado=EstadoFoto.APROVADA, moderada_em=datetime.now(UTC))
        )
        sessao.commit()

    monkeypatch.setattr(servico.os, "replace", replace_com_corrida)

    with pytest.raises(ErroDaApi) as excinfo:
        servico.aprovar(sessao, id_foto)
    assert excinfo.value.estado == 409, (
        "sem o `AND estado = 'pendente'` no `UPDATE`, esta chamada também "
        "aprovaria a foto — a corrida ganhava-se duas vezes"
    )

    from app.config import obter_definicoes

    definicoes = obter_definicoes()
    assert (definicoes.pendentes_dir / nome_ficheiro).exists(), (
        "perdida a corrida, o ficheiro tinha de voltar para `pendentes/`"
    )
    assert not (definicoes.media_dir / nome_ficheiro).exists()


def test_rejeitar_perde_a_corrida_e_devolve_409_sem_apagar_bytes(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient, sessao: Session
) -> None:
    """Isola a condição do `UPDATE`, não o pré-exame anterior a ele.

    `rejeitar` também tem um pré-exame (`foto.estado != PENDENTE`) antes
    do `UPDATE` — é o que `test_rejeitar_duas_vezes_e_409_na_segunda` de
    `tests/fotos/test_moderacao.py` já prende, numa segunda chamada
    **sequencial**. Para provar a condição do `UPDATE` em si, a "corrida"
    tem de acontecer **depois** de o pré-exame desta chamada já ter visto
    `pendente` — por isso o gancho é `_rowcount_do_update`, chamado
    exatamente a seguir ao pré-exame.
    """
    from app.erros import ErroDaApi
    from app.models.fotos import EstadoFoto, Foto
    from app.services import fotos as servico

    id_foto, nome_ficheiro = _enviar_e_obter_id_e_nome(cliente, sessao)

    original_rowcount = servico._rowcount_do_update

    def rowcount_com_corrida(sessao_: Session, instrucao: object) -> int:
        # Esta chamada já passou o pré-exame (`foto.estado == PENDENTE`).
        # Antes do seu próprio `UPDATE`, outra moderação ganha a corrida.
        sessao_.execute(
            update(Foto)
            .where(Foto.id == id_foto)
            .values(estado=EstadoFoto.APROVADA, moderada_em=datetime.now(UTC))
        )
        sessao_.commit()
        return original_rowcount(sessao_, instrucao)  # type: ignore[arg-type]

    monkeypatch.setattr(servico, "_rowcount_do_update", rowcount_com_corrida)

    with pytest.raises(ErroDaApi) as excinfo:
        servico.rejeitar(sessao, id_foto)
    assert excinfo.value.estado == 409, (
        "sem o `AND estado = 'pendente'` no `UPDATE`, esta chamada também "
        "rejeitaria a foto já aprovada pela outra — a corrida ganhava-se "
        "duas vezes"
    )

    from app.config import obter_definicoes

    definicoes = obter_definicoes()
    # A "outra moderação" simulada só mudou a linha, nunca tocou em
    # ficheiro nenhum — por isso os bytes continuam onde estavam. O que
    # este `assert` prende é que **esta** chamada, ao perder a corrida,
    # não os apagou.
    assert (definicoes.pendentes_dir / nome_ficheiro).exists(), (
        "uma foto que o `UPDATE` não apanhou (porque outra moderação já a "
        "tinha mudado) não pode ter os bytes apagados por este `rejeitar`"
    )
