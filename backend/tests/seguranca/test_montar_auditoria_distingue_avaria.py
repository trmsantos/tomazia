"""A auditoria final de `deploy/montar.sh` aborta quando não consegue procurar (regra 10, ronda de segurança da F1-04).

## O achado

A auditoria final do pacote — a rede de segurança que relê a árvore já
montada à procura de caminhos proibidos pelo S-10/S-12 — estava escrita
assim:

    proibidos_remanescentes="$(
      {
        find "$saida" -depth -type d \\( ... \\)
        find "$saida" -type f \\( ... \\)
      }
    )"

Num grupo `{ ...; }`, o estado de saída é o do ÚLTIMO comando. Se a
procura de diretorias falhasse a meio — uma subpasta sem permissão de
leitura, um sistema de ficheiros com um erro — o seu estado desaparecia:
o `find` dos ficheiros corria a seguir, saía 0, e a substituição inteira
saía 0 com uma lista vazia. `montar.sh` concluía "não há nada proibido" e
saía 0 sobre um pacote que nunca chegou a ser revistado por inteiro. É
exatamente o que a regra 10 do `CLAUDE.md` proíbe: "não encontrei" e "não
consegui procurar" a darem o mesmo resultado.

A correção manda cada `find` escrever para um ficheiro e verifica o estado
de cada um à parte (`|| auditoria_falhou=1`), com o `stderr` guardado para
ser mostrado a quem investiga. O mesmo padrão já usado em
`.github/scripts/verificar-ficheiros-proibidos.sh`.

## Como se provoca a avaria

Não se usa uma pasta sem permissões: `cp -a` precisa de ler o que copia,
por isso um pacote com uma subpasta ilegível nunca chega a ser montado —
`montar.sh` morreria antes, na cópia, por outra razão, e o teste estaria a
provar outra coisa. Em vez disso injeta-se a falha onde ela existe no
mundo real: um `find` que falha a percorrer a árvore. Um `find` de teste,
posto à frente no `PATH`, reconhece pelos argumentos qual das procuras
está a correr, falha a que o teste mandar falhar (código 1, "Permission
denied" em stderr, nada em stdout — tal como um `find` que não conseguiu
ler uma subpasta) e delega todas as outras no `find` real. É o mesmo
princípio dos stubs de `pip` e `alembic` em `test_deploy_sh.py`.

O teste de controlo — sem avaria nenhuma injetada — é o que impede este
ficheiro de ser decorativo: afirma que o `find` de teste foi mesmo usado,
e que as TRÊS procuras da auditoria (diretorias, ficheiros, `.htaccess`)
correram, uma vez cada. Sem ele, um `find` de teste que nunca fosse
chamado faria os testes abaixo passar pela razão errada.

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
DEPLOY_REAL = RAIZ_REPO / "deploy"

SHA_VALIDO = hashlib.sha1(
    b"commit de teste do test_montar_auditoria_distingue_avaria.py, nunca real"
).hexdigest()
assert len(SHA_VALIDO) == 40

#: As três procuras da auditoria final, pela ordem em que `montar.sh` as
#: corre. Reconhecidas pelos argumentos, nunca por um contador de
#: invocações: as procuras da EXCLUSÃO (mais acima no script) usam os
#: mesmos nomes mas levam `-exec` ou `-delete`, e são essas que as
#: distinguem.
PROCURAS_DA_AUDITORIA = [
    "auditoria-dirs",
    "auditoria-ficheiros",
    "auditoria-htaccess",
]

STUB_FIND = """\
#!/usr/bin/env bash
set -u

tem_depth=0
tem_exec=0
tem_delete=0
tem_claude_md=0
tem_htaccess=0
for argumento in "$@"; do
  case "$argumento" in
    -depth) tem_depth=1 ;;
    -exec) tem_exec=1 ;;
    -delete) tem_delete=1 ;;
    claude.md) tem_claude_md=1 ;;
    .htaccess) tem_htaccess=1 ;;
  esac
done

# As procuras da auditoria são as que só LEEM: as da exclusão apagam o que
# encontram (-exec rm / -delete).
classe="outra"
if [ "$tem_exec" -eq 0 ] && [ "$tem_delete" -eq 0 ]; then
  if [ "$tem_depth" -eq 1 ]; then
    classe="auditoria-dirs"
  elif [ "$tem_claude_md" -eq 1 ]; then
    classe="auditoria-ficheiros"
  elif [ "$tem_htaccess" -eq 1 ]; then
    classe="auditoria-htaccess"
  fi
fi

printf '%s\\n' "$classe" >>"${TOMAZIA_TESTE_FIND_REGISTO}"

if [ "$classe" = "${TOMAZIA_TESTE_FIND_AVARIADO}" ]; then
  # Um find que não conseguiu percorrer tudo: nada em stdout, a razão em
  # stderr, estado 1. Exatamente o que uma subpasta ilegível provoca.
  echo "find: '${1}/uma-subpasta-ilegivel': Permission denied" >&2
  exit 1
fi

exec "${TOMAZIA_TESTE_FIND_REAL}" "$@"
"""


@dataclass
class Execucao:
    processo: subprocess.CompletedProcess[str]
    registo: Path

    @property
    def procuras_da_auditoria(self) -> list[str]:
        if not self.registo.is_file():
            return []
        return [
            linha
            for linha in self.registo.read_text(encoding="utf-8").splitlines()
            if linha != "outra"
        ]


def _construir_arvore_minima(tmp_path: Path) -> Path:
    """Árvore de trabalho fabricada e limpa: sem nada do S-10/S-12 e sem `.htaccess` nenhum."""
    raiz = tmp_path / "trabalho"
    (raiz / "backend" / "app").mkdir(parents=True)
    (raiz / "backend" / "app" / "__init__.py").write_text("", encoding="utf-8")
    (raiz / "backend" / "app" / "main.py").write_text(
        "# aplicacao falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "migrations").mkdir(parents=True)
    (raiz / "backend" / "migrations" / "env.py").write_text(
        "# migracao falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "alembic.ini").write_text(
        "[alembic]\nscript_location = migrations\n", encoding="utf-8"
    )
    (raiz / "backend" / "passenger_wsgi.py").write_text(
        "# passenger_wsgi falso\n", encoding="utf-8"
    )
    (raiz / "backend" / "requirements.txt").write_text("fastapi\n", encoding="utf-8")

    dist = raiz / "frontend" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><body>pacote de teste</body></html>\n", encoding="utf-8"
    )
    (dist / "assets" / "app.js").write_text("// fabricado\n", encoding="utf-8")

    shutil.copytree(DEPLOY_REAL, raiz / "deploy")
    return raiz


def _correr_montar_com_find_de_teste(
    tmp_path: Path, *, procura_avariada: str
) -> Execucao:
    """Corre o `montar.sh` REAL com um `find` de teste à frente no PATH."""
    find_real = shutil.which("find")
    assert find_real is not None, "Não há 'find' nesta máquina de testes."

    raiz = _construir_arvore_minima(tmp_path)
    script = raiz / "deploy" / "montar.sh"
    if not script.is_file():
        pytest.fail(f"{script} não existe na árvore de trabalho do teste.")

    pasta_stub = tmp_path / "bin-de-teste"
    pasta_stub.mkdir(parents=True, exist_ok=True)
    stub = pasta_stub / "find"
    stub.write_text(STUB_FIND, encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    registo = tmp_path / "find-registo.txt"

    ambiente = dict(os.environ)
    ambiente["PATH"] = f"{pasta_stub}{os.pathsep}{ambiente.get('PATH', '')}"
    ambiente["TOMAZIA_TESTE_FIND_REAL"] = find_real
    ambiente["TOMAZIA_TESTE_FIND_REGISTO"] = str(registo)
    ambiente["TOMAZIA_TESTE_FIND_AVARIADO"] = procura_avariada

    processo = subprocess.run(
        [str(script), "--sha", SHA_VALIDO, "--saida", str(tmp_path / "pacote")],
        cwd=raiz,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return Execucao(processo=processo, registo=registo)


def test_controlo_o_find_de_teste_e_mesmo_usado_e_a_auditoria_corre_inteira(
    tmp_path: Path,
) -> None:
    """Sem avaria nenhuma injetada: o pacote monta, e as três procuras da auditoria passaram pelo `find` de teste."""
    execucao = _correr_montar_com_find_de_teste(tmp_path, procura_avariada="nenhuma")

    assert execucao.processo.returncode == 0, (
        "montar.sh recusou uma árvore limpa com o find de teste no PATH.\n"
        f"stderr:\n{execucao.processo.stderr}"
    )
    assert execucao.procuras_da_auditoria == PROCURAS_DA_AUDITORIA, (
        "O find de teste tem de ver as três procuras da auditoria final "
        f"(por esta ordem): {PROCURAS_DA_AUDITORIA!r}. Viu "
        f"{execucao.procuras_da_auditoria!r}. Sem isto, os testes de avaria "
        "deste ficheiro passariam sem nunca terem avariado nada."
    )


@pytest.mark.parametrize("procura_avariada", PROCURAS_DA_AUDITORIA)
def test_find_que_falha_a_percorrer_o_pacote_aborta_o_montar(
    tmp_path: Path, procura_avariada: str
) -> None:
    """Regra 10: um `find` que não conseguiu procurar nunca pode dar o mesmo resultado que um `find` que não encontrou nada."""
    execucao = _correr_montar_com_find_de_teste(
        tmp_path, procura_avariada=procura_avariada
    )

    assert procura_avariada in execucao.procuras_da_auditoria, (
        f"A procura {procura_avariada!r} nem chegou a correr — o teste não "
        f"avariou nada. Procuras vistas: {execucao.procuras_da_auditoria!r}."
    )
    assert execucao.processo.returncode != 0, (
        f"A procura {procura_avariada!r} da auditoria final falhou a percorrer "
        "o pacote e montar.sh saiu 0 na mesma. Um pacote que nunca foi "
        "revistado por inteiro não pode ser dado por limpo: o estado de cada "
        "find tem de ser verificado à parte (regra 10).\n"
        f"stdout:\n{execucao.processo.stdout}"
    )
    assert "Permission denied" in execucao.processo.stderr, (
        "A razão da avaria (o stderr do próprio find) tem de chegar a quem "
        "corre o deploy — senão fica a saber que falhou, mas não porquê. "
        f"stderr foi:\n{execucao.processo.stderr}"
    )
