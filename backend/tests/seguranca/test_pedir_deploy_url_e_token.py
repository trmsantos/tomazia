"""`deploy/pedir-deploy.sh`: só https, e o token nunca na linha de comandos (ronda de segurança da F1-04).

Dois achados da mesma ronda, prendidos no mesmo ficheiro porque precisam
exatamente do mesmo aparelho: um `curl` de teste, posto à frente no `PATH`,
que regista o seu próprio `argv` e o seu próprio `stdin` e devolve uma
resposta fixa — sem nunca abrir uma ligação de rede (regra 3 do
`CLAUDE.md`: os agentes vivem só no repositório).

## Achado 1 — `TOMAZIA_CPANEL_BASE_URL` tem de ser `https://`

O cabeçalho `Authorization: cpanel <utilizador>:<token>` dá acesso à conta
cPanel inteira. Com a base gravada em `http://`, esse cabeçalho viajava em
claro e quem estivesse na rota ficava com o token todo. `pedir-deploy.sh`
passou a recusar qualquer base que não comece por `https://`, com UMA
exceção documentada — `http://127.0.0.1`, com ou sem porta e com ou sem
caminho — porque é o que os testes deste script usam (um `http.server`
local, ver `test_pedir_deploy.py`).

A parte que mais facilmente estaria mal é a largura da exceção. Um
`case` escrito com um `http://127.0.0.1*` descuidado aceitaria
`http://127.0.0.1.atacante.com` — um nome DNS que o atacante controla,
que nada tem de local, e que reabre o achado por inteiro. Por isso os
casos recusados abaixo não são decorativos: são a fronteira da exceção,
um a um.

Em cada recusa afirma-se também que o `curl` nunca chegou a ser invocado.
Um guarda que recusasse DEPOIS de fazer o pedido não valia nada — o
cabeçalho já tinha viajado.

## Achado 2 — o `Authorization` fora do `argv`

`-H "Authorization: cpanel ${UTILIZADOR}:${TOKEN}"` punha o token na linha
de comandos do processo `curl`, visível a qualquer coisa capaz de listar
processos na mesma máquina (`ps aux`, `/proc/<pid>/cmdline`) enquanto o
pedido estivesse em curso. Num runner do GitHub Actions isso é qualquer
passo do job e qualquer coisa que o `npm` tenha deixado a correr. Passou a
entrar por `--config -`, escrito por um `printf` (builtin do bash, nunca
um processo próprio) para o stdin do `curl`, nunca para disco.

O teste correspondente afirma as duas metades: o token não está no `argv`
**e** está no que o `curl` recebeu pelo stdin. Sem a segunda metade, um
`pedir-deploy.sh` que simplesmente deixasse de enviar o cabeçalho passaria
— e um teste que passa quando a autenticação desapareceu não prende nada.

Não estão ligados a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vivem
em `tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
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

#: `curl` de teste: regista `argv` (uma linha por argumento) e `stdin`,
#: escreve um corpo de sucesso no ficheiro de `-o` e imprime o código HTTP
#: que o `-w '%{http_code}'` do script espera. Nunca abre rede nenhuma.
STUB_CURL = """\
#!/usr/bin/env bash
set -u

: >"${TOMAZIA_TESTE_CURL_ARGV}"
for argumento in "$@"; do
  printf '%s\\n' "$argumento" >>"${TOMAZIA_TESTE_CURL_ARGV}"
done

cat >"${TOMAZIA_TESTE_CURL_STDIN}"

destino=""
anterior=""
for argumento in "$@"; do
  if [ "$anterior" = "-o" ]; then
    destino="$argumento"
  fi
  anterior="$argumento"
done
if [ -n "$destino" ]; then
  printf '%s' '{"status":1,"data":{}}' >"$destino"
fi

printf '%s' '200'
exit 0
"""


@dataclass
class Execucao:
    processo: subprocess.CompletedProcess[str]
    ficheiro_argv: Path
    ficheiro_stdin: Path

    @property
    def curl_foi_invocado(self) -> bool:
        return self.ficheiro_argv.is_file()

    @property
    def argv_do_curl(self) -> list[str]:
        assert self.curl_foi_invocado, "O curl não chegou a ser invocado."
        return self.ficheiro_argv.read_text(encoding="utf-8").splitlines()

    @property
    def stdin_do_curl(self) -> str:
        assert self.curl_foi_invocado, "O curl não chegou a ser invocado."
        return self.ficheiro_stdin.read_text(encoding="utf-8")


def _correr(
    tmp_path: Path,
    base_url: str,
    *,
    token: str = TOKEN_SENTINELA,
    utilizador: str = UTILIZADOR_FALSO,
) -> Execucao:
    """Corre o `pedir-deploy.sh` REAL por subprocesso, com o `curl` de teste à frente no PATH."""
    if not CAMINHO_SCRIPT.is_file():
        pytest.fail(f"{CAMINHO_SCRIPT} não existe.")

    pasta_stub = tmp_path / "bin-de-teste"
    pasta_stub.mkdir(parents=True, exist_ok=True)
    stub = pasta_stub / "curl"
    stub.write_text(STUB_CURL, encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    ficheiro_argv = tmp_path / "curl-argv.txt"
    ficheiro_stdin = tmp_path / "curl-stdin.txt"

    ambiente = dict(os.environ)
    ambiente["PATH"] = f"{pasta_stub}{os.pathsep}{ambiente.get('PATH', '')}"
    ambiente["TOMAZIA_CPANEL_BASE_URL"] = base_url
    ambiente["TOMAZIA_CPANEL_USER"] = utilizador
    ambiente["TOMAZIA_CPANEL_TOKEN"] = token
    ambiente["TOMAZIA_TESTE_CURL_ARGV"] = str(ficheiro_argv)
    ambiente["TOMAZIA_TESTE_CURL_STDIN"] = str(ficheiro_stdin)

    processo = subprocess.run(
        ["bash", str(CAMINHO_SCRIPT)],
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return Execucao(
        processo=processo, ficheiro_argv=ficheiro_argv, ficheiro_stdin=ficheiro_stdin
    )


def _assert_token_nao_vaza(execucao: Execucao) -> None:
    assert TOKEN_SENTINELA not in execucao.processo.stdout
    assert TOKEN_SENTINELA not in execucao.processo.stderr


# --- Achado 1: só https (e a exceção não pode ser larga demais) ------------


#: Bases que têm de ser RECUSADAS. As quatro primeiras são a fronteira da
#: exceção documentada: todas começam pelos mesmos carateres que
#: `http://127.0.0.1`, e nenhuma é a máquina local.
BASES_RECUSADAS = [
    "http://127.0.0.1.atacante.com",
    "http://127.0.0.1.atacante.com:2083",
    "http://127.0.0.1.atacante.com/execute",
    "http://127.0.0.10:2083",
    "http://127.0.0.1@atacante.test",
    "http://localhost:2083",
    "http://exemplo.test:2083",
    "http://192.168.1.10:2083",
    "ftp://exemplo.test",
    "exemplo.test:2083",
    "//exemplo.test",
    "file:///etc/passwd",
]


@pytest.mark.parametrize("base_url", BASES_RECUSADAS)
def test_base_sem_https_e_recusada_antes_de_qualquer_pedido(
    tmp_path: Path, base_url: str
) -> None:
    """Recusa em voz alta, e antes de o `curl` ser sequer invocado — depois do pedido, o cabeçalho já tinha viajado em claro."""
    execucao = _correr(tmp_path, base_url)

    assert execucao.processo.returncode != 0, (
        f"pedir-deploy.sh aceitou {base_url!r}. O cabeçalho Authorization dá "
        "acesso à conta cPanel inteira: fora de https:// (e da exceção "
        "documentada http://127.0.0.1) viaja em claro."
    )
    assert "https" in execucao.processo.stderr, (
        "A recusa tem de explicar, em stderr, que a base tem de ser https:// "
        f"— stderr foi: {execucao.processo.stderr!r}"
    )
    assert not execucao.curl_foi_invocado, (
        f"pedir-deploy.sh recusou {base_url!r} mas só DEPOIS de chamar o "
        "curl. A recusa tem de vir antes do pedido."
    )
    _assert_token_nao_vaza(execucao)


@pytest.mark.parametrize(
    "base_url",
    [
        "https://servidor.exemplo.test:2083",
        "https://servidor.exemplo.test",
        "https://servidor.exemplo.test:2083/",
    ],
)
def test_base_https_e_aceite(tmp_path: Path, base_url: str) -> None:
    execucao = _correr(tmp_path, base_url)

    assert execucao.processo.returncode == 0, (
        f"pedir-deploy.sh recusou uma base https ({base_url!r}).\n"
        f"stderr:\n{execucao.processo.stderr}"
    )
    assert execucao.curl_foi_invocado
    _assert_token_nao_vaza(execucao)


@pytest.mark.parametrize(
    "base_url",
    ["http://127.0.0.1", "http://127.0.0.1:2083", "http://127.0.0.1/sub/caminho"],
)
def test_excecao_documentada_do_127_0_0_1_continua_a_ser_aceite(
    tmp_path: Path, base_url: str
) -> None:
    """A exceção existe por uma razão concreta: é com ela que `test_pedir_deploy.py` corre o script contra um `http.server` local."""
    execucao = _correr(tmp_path, base_url)

    assert execucao.processo.returncode == 0, (
        f"pedir-deploy.sh recusou {base_url!r}, que é a exceção documentada "
        "para os testes locais.\n"
        f"stderr:\n{execucao.processo.stderr}"
    )
    assert execucao.curl_foi_invocado
    _assert_token_nao_vaza(execucao)


@pytest.mark.parametrize(
    ("base_url", "proto_esperado"),
    [
        ("https://servidor.exemplo.test:2083", "=https"),
        ("http://127.0.0.1:2083", "=http"),
    ],
)
def test_curl_fica_preso_ao_esquema_permitido(
    tmp_path: Path, base_url: str, proto_esperado: str
) -> None:
    """`--proto` é a mesma regra outra vez, ao nível do pedido: nunca se confia só na verificação de string sobre a variável de ambiente (p.ex. um redirecionamento de https para http)."""
    execucao = _correr(tmp_path, base_url)

    argv = execucao.argv_do_curl
    assert "--proto" in argv, (
        "O curl tem de ser invocado com --proto, para o protocolo ficar "
        f"restringido também ao nível do pedido. argv: {argv!r}"
    )
    assert argv[argv.index("--proto") + 1] == proto_esperado, (
        f"Esperava --proto {proto_esperado!r} para a base {base_url!r}, "
        f"vi {argv[argv.index('--proto') + 1]!r}."
    )


# --- Achado 2: o cabeçalho Authorization fora do argv ---------------------


def test_token_nunca_entra_na_linha_de_comandos_do_curl(tmp_path: Path) -> None:
    """O argv de um processo é legível por quem conseguir listar processos na mesma máquina, enquanto o pedido está em curso."""
    execucao = _correr(tmp_path, "https://servidor.exemplo.test:2083")

    assert execucao.processo.returncode == 0, execucao.processo.stderr
    argv = execucao.argv_do_curl

    argumentos_com_token = [arg for arg in argv if TOKEN_SENTINELA in arg]
    assert argumentos_com_token == [], (
        "O token do cPanel apareceu na linha de comandos do curl "
        f"({argumentos_com_token!r}). Qualquer coisa capaz de listar "
        "processos nesta máquina (ps aux, /proc/<pid>/cmdline) o leria "
        "enquanto o pedido estivesse em curso. Tem de entrar por "
        "'--config -' (stdin), nunca por '-H'."
    )
    argumentos_com_cabecalho = [
        arg for arg in argv if arg.lower().startswith("authorization")
    ]
    assert argumentos_com_cabecalho == [], (
        f"O cabeçalho Authorization está no argv do curl: {argumentos_com_cabecalho!r}."
    )

    assert "--config" in argv, f"Esperava '--config' no argv do curl, vi {argv!r}."
    assert argv[argv.index("--config") + 1] == "-", (
        "O '--config' tem de ler do stdin ('-'): um ficheiro de configuração "
        "em disco poria o token num ficheiro, que é o problema a seguir ao "
        f"argv. Vi {argv[argv.index('--config') + 1]!r}."
    )

    _assert_token_nao_vaza(execucao)


def test_o_cabecalho_authorization_vai_mesmo_no_pedido_pelo_stdin(
    tmp_path: Path,
) -> None:
    """A outra metade do teste acima: sem isto, um script que deixasse de autenticar passaria no teste do argv sem esforço nenhum."""
    execucao = _correr(tmp_path, "https://servidor.exemplo.test:2083")

    assert execucao.processo.returncode == 0, execucao.processo.stderr
    entrada = execucao.stdin_do_curl

    assert "Authorization" in entrada, (
        "O curl não recebeu nenhum cabeçalho Authorization pelo stdin. Tirar "
        "o token do argv não pode querer dizer deixar de o enviar.\n"
        f"stdin recebido: {entrada!r}"
    )
    assert TOKEN_SENTINELA in entrada, (
        f"O cabeçalho que o curl recebeu não leva o token. stdin recebido: {entrada!r}"
    )
    assert UTILIZADOR_FALSO in entrada, (
        "O cabeçalho que o curl recebeu não leva o utilizador do cPanel. "
        f"stdin recebido: {entrada!r}"
    )
