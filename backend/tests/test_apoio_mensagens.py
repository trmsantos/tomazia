"""O apoio de asserções de `tests/apoio_mensagens.py` testado contra si próprio.

Os testes da F2-01 que afirmam mensagens em PT-PT (o guarda do WAL em
`tests/test_db_pragmas.py`, a recusa de um `datetime` ingénuo em
`tests/modelos/test_datas_utc.py`) valem exatamente o que valer este apoio.
Se `texto_de_toda_a_cadeia` só olhasse para `str(erro)`, passariam a passar
com a nossa mensagem escondida dentro de um embrulho do SQLAlchemy — ou
seja, passariam sem o código que existem para prender. Daí estes testes.
"""

from __future__ import annotations

from tests.apoio_mensagens import contem_marca_pt_pt, texto_de_toda_a_cadeia


def test_percorre_a_cadeia_de_causas_e_nao_so_a_excecao_de_fora() -> None:
    """`raise ... from ...`: a causa tem de aparecer no texto, não só o embrulho."""
    try:
        try:
            raise ValueError("a causa original")
        except ValueError as causa:
            raise RuntimeError("o embrulho de fora") from causa
    except RuntimeError as erro:
        texto = texto_de_toda_a_cadeia(erro)

    assert "a causa original" in texto
    assert "o embrulho de fora" in texto


def test_percorre_tambem_o_contexto_implicito() -> None:
    """Sem `from`, a exceção anterior fica em `__context__` — conta na mesma.

    É este o caso real: o SQLAlchemy levanta as suas exceções dentro do
    `except` da nossa, sem `raise ... from`, e `__cause__` fica a `None`.
    """
    try:
        try:
            raise ValueError("a causa implícita")
        except ValueError:
            raise RuntimeError("o embrulho sem from") from None
    except RuntimeError as erro:
        texto_sem_contexto = texto_de_toda_a_cadeia(erro)

    # `from None` corta a cadeia de propósito: aqui a causa não deve aparecer.
    assert "a causa implícita" not in texto_sem_contexto

    try:
        try:
            raise ValueError("a causa implícita")
        except ValueError:
            raise RuntimeError("o embrulho sem from")  # noqa: B904
    except RuntimeError as erro:
        texto_com_contexto = texto_de_toda_a_cadeia(erro)

    assert "a causa implícita" in texto_com_contexto


def test_marca_pt_pt_distingue_uma_frase_nossa_de_uma_da_biblioteca() -> None:
    """O teste do próprio guarda: as mensagens de biblioteca não podem passar."""
    assert contem_marca_pt_pt(
        "A base de dados não ficou em modo WAL: journal_mode devolveu 'memory'."
    )
    assert contem_marca_pt_pt("O início do evento tem de trazer fuso horário.")

    assert not contem_marca_pt_pt("database is locked")
    assert not contem_marca_pt_pt(
        "can't compare offset-naive and offset-aware datetimes"
    )
    assert not contem_marca_pt_pt("UNIQUE constraint failed: categorias.slug")
