"""C2: `app.services.fotos.aprovar` distingue "não havia ficheiro" de "não consegui movê-lo".

Medido (achado de revisão da F2-06): uma primeira versão usava
`origem.exists()` para decidir se havia um ficheiro para mover.
`Path.exists()` devolve `False` tanto para "não está lá" como para "não
consegui procurar" (um `OSError` de permissões, por exemplo) — exatamente
a regra 10 do `CLAUDE.md`. Em produção, aprovar uma foto cujos bytes não
puderam ser movidos por uma falha real (permissões, disco cheio) tratava
isso como "não havia nada para mover", respondia `200`, marcava `aprovada`
e a galeria passava a listar uma imagem partida, em silêncio.

A correção distingue pelo tipo da exceção: só `FileNotFoundError` conta
como "não havia nada para mover"; qualquer outro `OSError` sobe.

**Achado numa revisão posterior:** o teste que devia provar o ramo
`except FileNotFoundError` (`test_filenotfound_continua_a_tratar_se_como_nao_havia_nada_para_mover`,
abaixo) envia uma foto a sério, cujo ficheiro existe de verdade em
`pendentes/` — por isso o `os.replace` tem sempre sucesso, e o ramo
`except FileNotFoundError` nunca corre. Uma mutação `if True:`/`if False:`
nesse ramo deixava a bateria inteira verde. A causa é a própria correção
do C2: mandar `tests/fotos/test_moderacao.py::_semear_pendente` escrever
também o ficheiro falso (para não moldar o código de produção à forma de
uma fixture sem bytes nenhuns) tirou a única cobertura que este ramo
tinha. `test_sem_ficheiro_nenhum_o_filenotfound_e_tratado_como_nao_havia_nada`,
acrescentado aqui, semeia a linha **sem** o ficheiro — de propósito, só
neste ficheiro de segurança, nunca na fixture partilhada.

**Achado numa terceira revisão:** o `moveu_o_ficheiro = False` dentro do
`except FileNotFoundError` continuava sem rede — trocá-lo por `True` não
fazia nenhum teste falhar. A razão: esse booleano só é lido no ramo de
"desfazer o movimento" (`_desfazer_o_movimento`), que só corre quando o
`UPDATE` falha depois; e `test_sem_ficheiro_nenhum_...` (sem corrida
nenhuma) nunca chega lá — o `UPDATE` tem sucesso e a função devolve
antes. `test_sem_ficheiro_e_corrida_perdida_nao_tenta_mover_de_volta`,
acrescentado aqui, combina as duas condições: sem ficheiro **e** o
`UPDATE` perde a corrida — com um espião sobre `os.replace`, para provar
que o `moveu_o_ficheiro` incorreto não faz o desfazer tentar mover um
ficheiro que nunca existiu.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_um_oserror_que_nao_e_filenotfound_sobe_em_vez_de_ser_engolido(
    monkeypatch: pytest.MonkeyPatch, cliente: TestClient, sessao: Session
) -> None:
    from app.models.fotos import EstadoFoto, Foto
    from app.services import fotos as servico

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text
    linha = sessao.scalars(select(Foto)).one()
    id_foto = linha.id

    def replace_com_falha(
        origem: object, destino: object, *args: object, **kwargs: object
    ) -> None:
        raise PermissionError("simulado: sem permissões para mover o ficheiro")

    # `servico.os` é o módulo `os` verdadeiro (o mesmo objeto); o
    # `monkeypatch` desfaz isto sozinho no fim do teste.
    monkeypatch.setattr(servico.os, "replace", replace_com_falha)

    with pytest.raises(PermissionError):
        servico.aprovar(sessao, id_foto)

    sessao.expire_all()
    linha_depois = sessao.get(Foto, id_foto)
    assert linha_depois is not None
    assert linha_depois.estado == EstadoFoto.PENDENTE, (
        "um `OSError` real na tentativa de mover o ficheiro não pode deixar "
        "a foto marcada como aprovada"
    )


def test_filenotfound_continua_a_tratar_se_como_nao_havia_nada_para_mover(
    cliente: TestClient, sessao: Session
) -> None:
    """Controlo: o caso real (um envio genuíno, com ficheiro) continua a aprovar normalmente.

    **Não prende o ramo `except FileNotFoundError`** — o ficheiro existe
    de verdade, por isso `os.replace` nunca rebenta. Ver
    `test_sem_ficheiro_nenhum_o_filenotfound_e_tratado_como_nao_havia_nada`,
    abaixo, para esse ramo.
    """
    from app.models.fotos import EstadoFoto, Foto

    resposta = apoio_fotos.enviar_foto(cliente, apoio_fotos.jpeg_valido())
    assert resposta.status_code == 202, resposta.text
    linha = sessao.scalars(select(Foto)).one()

    from app.services import fotos as servico

    aprovada = servico.aprovar(sessao, linha.id)
    assert aprovada.estado == EstadoFoto.APROVADA


def test_sem_ficheiro_nenhum_o_filenotfound_e_tratado_como_nao_havia_nada(
    sessao: Session,
) -> None:
    """O ramo que o teste de cima não prende: uma linha sem ficheiro nenhum em `pendentes/`.

    Não é um envio real — é o cenário que a F2-08 pode produzir (uma linha
    escrita por SQL cru) e que alguns testes de transição de estado também
    semeiam diretamente. `aprovar` tem de aprovar na mesma, sem rebentar.
    """
    from app.config import obter_definicoes
    from app.models.fotos import EstadoFoto, Foto
    from app.services import fotos as servico

    nome_ficheiro = "00000000-0000-4000-8000-000000009009.webp"
    sessao.add(
        Foto(
            id=9009,
            ficheiro=nome_ficheiro,
            estado=EstadoFoto.PENDENTE,
            descricao=None,
            enviada_por=None,
            ip_hash="hash-falso-de-ip-sem-ficheiro",
        )
    )
    sessao.commit()

    definicoes = obter_definicoes()
    assert not (definicoes.pendentes_dir / nome_ficheiro).exists(), (
        "o cenário depende de não haver ficheiro nenhum — é isso que força "
        "o `FileNotFoundError` dentro de `aprovar`"
    )

    aprovada = servico.aprovar(sessao, 9009)

    assert aprovada.estado == EstadoFoto.APROVADA
    assert not (definicoes.media_dir / nome_ficheiro).exists(), (
        "sem ficheiro nenhum para mover, nada pode aparecer em MEDIA_DIR"
    )


def test_sem_ficheiro_e_corrida_perdida_nao_tenta_mover_de_volta(
    monkeypatch: pytest.MonkeyPatch, sessao: Session
) -> None:
    """Fecha o `moveu_o_ficheiro = False`: sem ficheiro **e** a corrida perdida.

    Sem combinar as duas condições, o booleano nunca é lido: com só "sem
    ficheiro" (o teste de cima), o `UPDATE` tem sucesso e a função nunca
    chega ao ramo que o lê; com só "corrida perdida"
    (`test_moderacao_e_atomica_sob_corrida.py`), há sempre um ficheiro a
    sério. Só a combinação exercita `_desfazer_o_movimento` com
    `moveu_o_ficheiro` a `False` — e só um espião sobre `os.replace`
    distingue "não tentou mover de volta" (correto) de "tentou e a
    exceção ficou silenciada por `contextlib.suppress`" (o que uma
    mutação para `True` causaria).
    """
    from app.config import obter_definicoes
    from app.erros import ErroDaApi
    from app.models.fotos import EstadoFoto, Foto
    from app.services import fotos as servico

    nome_ficheiro = "00000000-0000-4000-8000-000000009010.webp"
    sessao.add(
        Foto(
            id=9010,
            ficheiro=nome_ficheiro,
            estado=EstadoFoto.PENDENTE,
            descricao=None,
            enviada_por=None,
            ip_hash="hash-falso-de-ip-sem-ficheiro-2",
        )
    )
    sessao.commit()

    definicoes = obter_definicoes()
    assert not (definicoes.pendentes_dir / nome_ficheiro).exists()

    chamadas_replace: list[tuple[object, object]] = []
    original_replace = servico.os.replace

    def espia_replace(origem: object, destino: object) -> None:
        chamadas_replace.append((origem, destino))
        original_replace(origem, destino)

    monkeypatch.setattr(servico.os, "replace", espia_replace)
    monkeypatch.setattr(servico, "_rowcount_do_update", lambda sessao_, instrucao: 0)

    with pytest.raises(ErroDaApi) as excinfo:
        servico.aprovar(sessao, 9010)
    assert excinfo.value.estado == 409

    assert len(chamadas_replace) == 1, (
        "esperava uma só chamada a `os.replace` — a tentativa inicial, que "
        "falha com `FileNotFoundError` e é apanhada. Uma segunda chamada "
        "significaria que `_desfazer_o_movimento` tentou mover de volta um "
        "ficheiro que `moveu_o_ficheiro` devia saber que nunca existiu"
    )

    linha = sessao.get(Foto, 9010)
    assert linha is not None
    assert linha.estado == EstadoFoto.PENDENTE
