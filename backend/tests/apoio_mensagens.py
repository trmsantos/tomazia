"""Apoio para afirmar mensagens de erro nossas, em PT-PT, dentro de exceções.

Não é um ficheiro de testes (não começa por `test_`): é usado por
`tests/test_db_pragmas.py` e `tests/modelos/test_datas_utc.py`, os dois
sítios da F2-01 onde o que se prova é que **a nossa** mensagem chegou ao
utilizador, e não a do SQLAlchemy ou a do `sqlite3`.

Duas coisas tornam isto menos trivial do que parece:

1. O SQLAlchemy embrulha o que acontece nos eventos de ligação e na
   conversão de tipos. `str(excecao)` pode mostrar só o embrulho, com a
   nossa mensagem escondida em `__cause__` ou `__context__`. Por isso
   `texto_de_toda_a_cadeia` percorre a cadeia inteira — e tem um teste
   próprio em `tests/test_apoio_mensagens.py`, porque um apoio de asserções
   que nunca se testa contra o seu próprio sucesso falso é o sítio onde as
   falhas se escondem.
2. "Mensagem em PT-PT" não se afirma com uma frase literal sem transformar
   o teste num ditado de redação. `MARCAS_PT_PT` é um conjunto de pedaços
   que qualquer frase portuguesa natural sobre uma recusa contém pelo menos
   um: o teste exige **uma** delas, e exige à parte os factos técnicos que
   a mensagem tem mesmo de nomear (o modo pedido, o valor obtido).
"""

from __future__ import annotations

#: Pedaços de texto que marcam uma frase como portuguesa. O teste exige um
#: (não todos): a lista existe para distinguir uma mensagem nossa de um
#: "database is locked" ou "can't compare offset-naive and offset-aware
#: datetimes" vindo da biblioteca, não para impor uma redação.
#:
#: Nenhuma delas pode ser um prefixo de uma palavra inglesa comum nestas
#: mensagens: `"data"`, por exemplo, esteve aqui e aceitava "database is
#: locked" como português.
MARCAS_PT_PT: tuple[str, ...] = (
    "não",
    "tem de",
    "base de dados",
    "ficheiro",
    "em memória",
    "fuso horário",
    "obrigatóri",
)


def texto_de_toda_a_cadeia(erro: BaseException, limite: int = 20) -> str:
    """Junta o texto de `erro` e de toda a sua cadeia de causas e contextos.

    `limite` existe só para travar cadeias circulares; nenhum caso real do
    projeto chega perto dele.
    """
    partes: list[str] = []
    vistos: set[int] = set()
    por_visitar: list[BaseException | None] = [erro]

    while por_visitar and len(partes) < limite:
        atual = por_visitar.pop(0)
        if atual is None or id(atual) in vistos:
            continue
        vistos.add(id(atual))
        partes.append(f"{type(atual).__name__}: {atual}")
        por_visitar.append(atual.__cause__)
        # `raise ... from None` põe `__suppress_context__` a True sem
        # limpar `__context__`: quem escreveu isso disse explicitamente que
        # a exceção anterior não interessa, e seguir por lá na mesma faria
        # este apoio encontrar mensagens que ninguém quis mostrar.
        if not atual.__suppress_context__:
            por_visitar.append(atual.__context__)

    return "\n".join(partes)


def contem_marca_pt_pt(texto: str) -> bool:
    """Diz se `texto` contém pelo menos uma das `MARCAS_PT_PT`."""
    em_minusculas = texto.lower()
    return any(marca in em_minusculas for marca in MARCAS_PT_PT)
