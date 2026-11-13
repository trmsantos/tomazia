"""Linha de comandos em português de Portugal, para os `scripts/`.

O `argparse` traz "usage:", "options:" e mensagens de erro em inglês. Os
scripts correm-se por SSH e quem os lê é o dono do bar ou o Tomás: tudo o
que sai em ecrã está em português (regra 6 do `CLAUDE.md`).
"""

from __future__ import annotations

import argparse
import re
import sys
from typing import Any, NoReturn

from pydantic import ValidationError

# (padrão da mensagem original do argparse, frase em português)
_TRADUCOES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"^the following arguments are required: (?P<a>.+)$"),
        "falta o argumento obrigatório {a}.",
    ),
    (
        re.compile(
            r"^argument (?P<a>.+): not allowed with argument (?P<b>.+)$",
        ),
        "{b} e {a} não podem ser usados em conjunto.",
    ),
    (
        re.compile(r"^argument (?P<a>.+): expected one argument$"),
        "o argumento {a} precisa de um valor.",
    ),
    (
        re.compile(r"^unrecognized arguments: (?P<a>.+)$"),
        "argumentos não reconhecidos: {a}.",
    ),
)


class FormatadorEmPortugues(argparse.RawDescriptionHelpFormatter):
    def add_usage(
        self, usage: Any, actions: Any, groups: Any, prefix: str | None = None
    ) -> None:
        super().add_usage(usage, actions, groups, "uso: " if prefix is None else prefix)


class AnalisadorEmPortugues(argparse.ArgumentParser):
    """`ArgumentParser` com o `-h`, os títulos e os erros em português."""

    def __init__(self, **opcoes: Any) -> None:
        opcoes["add_help"] = False
        opcoes["formatter_class"] = FormatadorEmPortugues
        super().__init__(**opcoes)
        self._positionals.title = "argumentos"
        self._optionals.title = "opções"
        self.add_argument(
            "-h", "--help", action="help", help="mostra esta ajuda e sai."
        )

    def error(self, message: str) -> NoReturn:
        for padrao, frase in _TRADUCOES:
            encontrado = padrao.match(message)
            if encontrado:
                message = frase.format(**encontrado.groupdict())
                break
        self.print_usage(sys.stderr)
        self.exit(2, f"Erro: {message}\n")


def descrever_erro_de_configuracao(erro: ValidationError) -> str:
    """As falhas de um `ValidationError` do pydantic: o campo e o texto, **sem o valor**.

    Imprimir o erro inteiro traz `input_value={...}` com o `SEGREDO_SESSAO`
    lá dentro (medido na revisão da F2-02). `errors(include_input=False)` deixa
    só o texto de cada falha; o nome do campo (`loc`) não é segredo, e
    `pydantic-settings` lê o campo `ambiente` da variável `AMBIENTE`, por
    isso o nome da variável é o do campo em maiúsculas.
    """
    partes: list[str] = []
    for e in erro.errors(include_input=False, include_url=False):
        texto = str(e["msg"]).removeprefix("Value error, ").rstrip(". ")
        if e["loc"]:
            texto = f"{str(e['loc'][-1]).upper()}: {texto}"
        partes.append(texto)
    return (
        f"Não consegui ler a configuração: {'; '.join(partes)}. Confirma as "
        "variáveis de ambiente (o AMBIENTE é obrigatório e não tem valor por "
        "omissão)."
    )
