"""Dentro de `app/`, uma `HTTPException` nunca leva um `detail` em texto.

Achado na segunda volta de revisão da F2-04. O tratador de
`HTTPException` em `app/erros.py` usa um mapa de mensagens por estado e
**descarta** um `detail` em texto. Para os 404 e 405 que o Starlette
levanta sozinho é o que se quer: o `detail` deles vem em inglês ("Not
Found", "Method Not Allowed") e a regra 6 do `CLAUDE.md` exige PT-PT.

O custo é o outro lado. Na F2-05, um

    raise HTTPException(404, "Esta categoria não existe.")

responde "O endereço pedido não existe." — uma frase plausível, errada, e
**sem erro nem registo nenhum**. "Não trazia mensagem" e "trazia e foi
deitada fora" dão exatamente o mesmo resultado, que é a forma da regra 10
do `CLAUDE.md`.

A convenção da casa é o `ErroDaApi`, que leva o código e a mensagem e sai
no envelope tal e qual. Este teste prende essa convenção: dentro de
`app/`, uma `HTTPException` ou não traz `detail`, ou traz-lhe um
dicionário na forma `{"erro", "mensagem"}` — que é o caso do
`exigir_admin`, obrigado a isso por ter de funcionar também numa app sem
os nossos tratadores registados.

**O que este teste deixa passar**, e a primeira versão dizia menos do
que a verdade: passa um `detail` numa variável, um `HTTPException`
importado com outro nome (`from fastapi import HTTPException as HE`), e
um `detail` que entre por `**kwargs`. A f-string **era** o buraco que
importava — `f"Categoria {nome} não existe."` é um `ast.JoinedStr` e não
um `ast.Constant`, e é precisamente a forma mais provável do erro real,
porque a mensagem que alguém quer escrever é a que nomeia o recurso.
Apanhada em revisão e fechada: os dois nós são tratados igual.

A concatenação implícita de literais adjacentes é apanhada de graça — o
parser funde-as num só `Constant`.

Os três buracos que ficam **falham fechados**: o `detail` descartado vira
a frase genérica em PT-PT, nunca uma fuga.

A leitura é por AST e não por `grep`: um `grep` que não consiga procurar
e um `grep` que não encontre nada saem os dois com estado diferente de
zero, e tratá-los igual é o defeito que esta regra existe para impedir.
"""

from __future__ import annotations

import ast
from pathlib import Path

PASTA_DA_APP = Path(__file__).resolve().parent.parent / "app"


def _chamadas_a_http_exception(arvore: ast.AST) -> list[ast.Call]:
    return [
        no
        for no in ast.walk(arvore)
        if isinstance(no, ast.Call)
        and (
            (isinstance(no.func, ast.Name) and no.func.id == "HTTPException")
            or (isinstance(no.func, ast.Attribute) and no.func.attr == "HTTPException")
        )
    ]


def _detalhe_da_chamada(chamada: ast.Call) -> ast.expr | None:
    """O `detail`, venha por nome ou como segundo posicional."""
    for argumento in chamada.keywords:
        if argumento.arg == "detail":
            return argumento.value
    if len(chamada.args) >= 2:
        return chamada.args[1]
    return None


def _texto_do_detalhe(detalhe: ast.expr | None) -> str | None:
    """O `detail` quando é texto escrito à mão, senão `None`.

    Reconhece o literal (`ast.Constant`) **e** a f-string
    (`ast.JoinedStr`). A segunda é a que faz falta apanhar: quem escreve
    uma mensagem de erro quer nomear o recurso, logo escreve
    `f"Categoria {nome} não existe."` — e essa não é um `Constant`.
    """
    if isinstance(detalhe, ast.Constant) and isinstance(detalhe.value, str):
        return repr(detalhe.value)
    if isinstance(detalhe, ast.JoinedStr):
        return f"f-string em {ast.unparse(detalhe)[:60]!r}"
    return None


def test_nenhuma_http_exception_da_app_leva_um_detail_em_texto() -> None:
    ficheiros = sorted(PASTA_DA_APP.rglob("*.py"))

    # Regra 10: "não encontrei nenhum ficheiro" e "não consegui procurar"
    # não podem dar o mesmo resultado. Sem esta asserção, um `rglob` que
    # devolvesse uma lista vazia — pasta mudada de sítio, teste corrido de
    # outro directório — deixava este teste verde sem ter lido nada.
    assert len(ficheiros) >= 10, (
        f"esperava a app inteira em {PASTA_DA_APP}, encontrei "
        f"{len(ficheiros)} ficheiro(s). Um varrimento vazio passaria sem "
        "ter verificado nada"
    )

    faltas: list[str] = []
    for ficheiro in ficheiros:
        codigo = ficheiro.read_text(encoding="utf-8")
        # Um `SyntaxError` aqui tem de rebentar o teste, não ser saltado:
        # um ficheiro que não dá para ler é "não consegui procurar".
        arvore = ast.parse(codigo, filename=str(ficheiro))

        for chamada in _chamadas_a_http_exception(arvore):
            detalhe = _detalhe_da_chamada(chamada)
            texto = _texto_do_detalhe(detalhe)
            if texto is not None:
                faltas.append(
                    f"{ficheiro.relative_to(PASTA_DA_APP.parent)}:{chamada.lineno} "
                    f"-> detail={texto}"
                )

    assert not faltas, (
        "estas `HTTPException` levam um `detail` em texto, que o tratador "
        "de `app/erros.py` deita fora em silêncio — a resposta sairia com "
        "a frase genérica do estado, plausível e errada:\n  "
        + "\n  ".join(faltas)
        + "\n\nUsa `ErroDaApi(estado, codigo, mensagem)`, que é a convenção "
        "da casa, ou um `detail` no formato {'erro': ..., 'mensagem': ...} "
        "se a exceção tiver de funcionar numa app sem os nossos tratadores."
    )
