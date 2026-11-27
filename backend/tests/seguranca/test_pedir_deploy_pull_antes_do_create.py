"""`deploy/pedir-deploy.sh` puxa a branch `deploy` antes de pedir a implantação (F1-05).

`VersionControlDeployment::create` implanta o HEAD que JÁ está no clone do
servidor: não faz pull do GitHub. Quem faz o pull é `VersionControl::update`
com `repository_root` e `branch`. Sem esse passo, a UAPI respondia
`status=1` e no servidor não corria nada de novo. Estes testes fixam:

- a ordem update -> create;
- que um update recusado (status 0) ou com falha de rede NUNCA é seguido de
  um create, e que as duas falhas têm mensagens diferentes;
- que `repository_root` e `branch=deploy` seguem no pedido do update;
- que o token nunca está no argv de nenhum dos dois `curl`.

Usa o script REAL, com um `curl` de teste à frente no `PATH` que regista cada
chamada (argv + stdin) e responde conforme o endpoint. Nunca abre rede.
"""

from __future__ import annotations

import os
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
CAMINHO_SCRIPT = RAIZ_REPO / "deploy" / "pedir-deploy.sh"

TOKEN_SENTINELA = "cpanel-token-sentinela-NUNCA-DEVE-APARECER-f7a93c21"
UTILIZADOR_FALSO = "utilizador-exemplo-test"
BASE = "https://servidor.exemplo.test:2083"

#: Cada chamada acrescenta a `$LOG` uma linha `CALL <url>` e depois um
#: argumento por linha, terminando em `END`. O comportamento depende do
#: endpoint: `TOMAZIA_TESTE_UPDATE` / `TOMAZIA_TESTE_CREATE` valem `ok`,
#: `status0` ou `falha` (curl sai com 7, como numa ligação recusada).
STUB_CURL = """\
#!/usr/bin/env bash
set -u
url=""
destino=""
anterior=""
for argumento in "$@"; do
  if [ "$anterior" = "-o" ]; then destino="$argumento"; fi
  anterior="$argumento"
  url="$argumento"
done
{
  printf 'CALL %s\\n' "$url"
  for argumento in "$@"; do printf '%s\\n' "$argumento"; done
  printf 'STDIN-INICIO\\n'
} >>"${TOMAZIA_TESTE_LOG}"
cat >>"${TOMAZIA_TESTE_LOG}"
printf 'END\\n' >>"${TOMAZIA_TESTE_LOG}"

case "$url" in
  */VersionControl/update) modo="${TOMAZIA_TESTE_UPDATE}" ;;
  */VersionControlDeployment/create) modo="${TOMAZIA_TESTE_CREATE}" ;;
  *) modo="falha" ;;
esac

case "$modo" in
  falha) exit 7 ;;
  status0) printf '%s' '{"status":0,"errors":["ramo recusado pelo servidor"]}' >"$destino" ;;
  *) printf '%s' '{"status":1,"data":{}}' >"$destino" ;;
esac
printf '%s' '200'
exit 0
"""


@dataclass
class Execucao:
    processo: subprocess.CompletedProcess[str]
    chamadas: list[list[str]]  # cada chamada: [url, argv..., ] (sem stdin)
    stdins: list[str]

    @property
    def urls(self) -> list[str]:
        return [c[0] for c in self.chamadas]


def _ler_log(texto: str) -> tuple[list[list[str]], list[str]]:
    chamadas: list[list[str]] = []
    stdins: list[str] = []
    atual: list[str] | None = None
    stdin: list[str] = []
    em_stdin = False
    for linha in texto.splitlines():
        if linha.startswith("CALL ") and not em_stdin:
            atual = [linha[len("CALL ") :]]
            stdin = []
        elif linha == "STDIN-INICIO" and not em_stdin:
            em_stdin = True
        elif linha == "END" and em_stdin:
            assert atual is not None
            chamadas.append(atual)
            stdins.append("\n".join(stdin))
            atual, em_stdin = None, False
        elif em_stdin:
            stdin.append(linha)
        elif atual is not None:
            atual.append(linha)
    return chamadas, stdins


def _correr(tmp_path: Path, *, update: str = "ok", create: str = "ok") -> Execucao:
    pasta = tmp_path / "bin-de-teste"
    pasta.mkdir(parents=True, exist_ok=True)
    stub = pasta / "curl"
    stub.write_text(STUB_CURL, encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    log = tmp_path / "curl-log.txt"
    log.write_text("", encoding="utf-8")

    ambiente = dict(os.environ)
    ambiente["PATH"] = f"{pasta}{os.pathsep}{ambiente.get('PATH', '')}"
    ambiente["TOMAZIA_CPANEL_BASE_URL"] = BASE
    ambiente["TOMAZIA_CPANEL_USER"] = UTILIZADOR_FALSO
    ambiente["TOMAZIA_CPANEL_TOKEN"] = TOKEN_SENTINELA
    ambiente["TOMAZIA_TESTE_LOG"] = str(log)
    ambiente["TOMAZIA_TESTE_UPDATE"] = update
    ambiente["TOMAZIA_TESTE_CREATE"] = create

    processo = subprocess.run(
        ["bash", str(CAMINHO_SCRIPT)],
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=30,
    )
    chamadas, stdins = _ler_log(log.read_text(encoding="utf-8"))
    return Execucao(processo=processo, chamadas=chamadas, stdins=stdins)


def test_update_vem_antes_do_create(tmp_path: Path) -> None:
    ex = _correr(tmp_path)
    assert ex.processo.returncode == 0, ex.processo.stderr
    assert ex.urls == [
        f"{BASE}/execute/VersionControl/update",
        f"{BASE}/execute/VersionControlDeployment/create",
    ]


def test_update_envia_repository_root_e_branch_deploy(tmp_path: Path) -> None:
    ex = _correr(tmp_path)
    argv_update = ex.chamadas[0]
    repo = f"repository_root=/home/{UTILIZADOR_FALSO}/repositories/tomazia"
    assert repo in argv_update, argv_update
    assert "branch=deploy" in argv_update, argv_update
    # E o create continua a receber o repository_root.
    assert repo in ex.chamadas[1], ex.chamadas[1]


def test_update_recusado_com_status_0_nunca_chama_o_create(tmp_path: Path) -> None:
    ex = _correr(tmp_path, update="status0")
    assert ex.processo.returncode != 0
    assert ex.urls == [f"{BASE}/execute/VersionControl/update"], ex.urls
    assert "recusou o pull" in ex.processo.stderr, ex.processo.stderr
    assert "ramo recusado pelo servidor" in ex.processo.stderr
    assert "erro de rede" not in ex.processo.stderr


def test_update_com_falha_de_curl_diz_erro_de_rede_e_nunca_chama_o_create(
    tmp_path: Path,
) -> None:
    ex = _correr(tmp_path, update="falha")
    assert ex.processo.returncode != 0
    assert ex.urls == [f"{BASE}/execute/VersionControl/update"], ex.urls
    assert "erro de rede" in ex.processo.stderr, ex.processo.stderr
    assert "recusou o pull" not in ex.processo.stderr


def test_create_recusado_depois_de_update_ok_continua_a_falhar(tmp_path: Path) -> None:
    ex = _correr(tmp_path, create="status0")
    assert ex.processo.returncode != 0
    assert len(ex.urls) == 2
    assert "pedido de deploy recusado" in ex.processo.stderr


def test_token_nunca_no_argv_de_nenhum_dos_dois_curl(tmp_path: Path) -> None:
    ex = _correr(tmp_path)
    assert len(ex.chamadas) == 2
    for chamada in ex.chamadas:
        assert not [a for a in chamada if TOKEN_SENTINELA in a], chamada
        assert not [a for a in chamada if a.lower().startswith("authorization")]
        assert "--config" in chamada
    # O cabeçalho foi mesmo enviado, pelo stdin, nos dois pedidos.
    for stdin in ex.stdins:
        assert TOKEN_SENTINELA in stdin
    assert TOKEN_SENTINELA not in ex.processo.stdout
    assert TOKEN_SENTINELA not in ex.processo.stderr


@pytest.mark.parametrize("update", ["status0", "falha"])
def test_token_nao_vaza_nas_falhas_do_update(tmp_path: Path, update: str) -> None:
    ex = _correr(tmp_path, update=update)
    assert TOKEN_SENTINELA not in ex.processo.stdout
    assert TOKEN_SENTINELA not in ex.processo.stderr
