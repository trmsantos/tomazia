"""`deploy/deploy.sh` sincroniza sem `rsync`, com a semântica que os três `rsync` tinham (F1-05).

## O achado

O primeiro deploy real morreu assim, no servidor da dominios.pt
(CloudLinux, CageFS), depois de o pip ter corrido bem:

    deploy/deploy.sh: line 235: rsync: command not found
    deploy.sh: falhou no passo 'a sincronizar o código (api/app/, api/migrations/)' (código 127).

Nenhum teste o apanhou porque todos corriam com `/usr/bin` no `PATH`, onde
a máquina de desenvolvimento e o runner do CI têm `rsync`. O `deploy.sh`
passou a sincronizar com uma função própria (`sincronizar`), só com `cp`,
`mv`, `rm`, `mkdir`, `rmdir` e `find`, e a usá-la SEMPRE — nunca "o `rsync`
se existir, a alternativa se não" (dois caminhos, e o dos testes não era o
do servidor).

## O que este ficheiro prova

1. O `deploy.sh` corre de ponta a ponta com um `PATH` que comprovadamente
   não tem `rsync` — só com as ferramentas listadas em
   `FERRAMENTAS_DO_SERVIDOR`. Essa lista é, por isso, a lista das
   dependências do script: uma ferramenta nova no `deploy.sh` que não
   esteja nela derruba o primeiro teste.
2. A semântica dos três modos, caso a caso, contra o que o `rsync` fazia:
   - `api/app/` e `api/migrations/` (`rsync -a --delete`): o destino fica
     igual à origem;
   - `api/scripts/` (`rsync -a`): copia, não apaga;
   - o frontend (`rsync -a --safe-links --delete --exclude='/media'
     --exclude='.htaccess' --exclude='/.well-known'`): o `.htaccess` fica
     protegido a qualquer profundidade (`WEB/api/.htaccess`, com o bloco do
     Passenger, é o caso real), `media/` e `.well-known/` só na raiz, e o
     resto que já não está na origem desaparece.
3. O que o `rsync` fazia sem ninguém pensar nisso e que uma reimplementação
   ingénua perdia: ligações simbólicas no DESTINO nunca são seguidas (um
   `cp` para `WEB/assets/x` com `WEB/assets` a ser uma ligação escrevia
   fora do site), e trocas de tipo (pasta onde havia ficheiro e vice-versa)
   resolvem-se.

As ligações simbólicas na ORIGEM têm o seu próprio ficheiro,
`test_deploy_sh_nao_sincroniza_ligacoes_para_fora_do_pacote.py`; os
`.htaccess` do pacote, `test_deploy_sh_exclui_htaccess_em_profundidade.py`.

## O que NÃO prova

Que o comportamento é idêntico ao do `rsync` byte a byte em todos os
casos: não há aqui um teste diferencial contra o `rsync` real (o macOS
traz o `openrsync`, que não é o `rsync` do servidor). As diferenças
conhecidas estão escritas no comentário da função `sincronizar`: o modo e
as datas das PASTAS não são copiados, e os ficheiros copiam-se sempre,
mesmo iguais.

Nunca se contacta o cPanel nem se lê a BD antiga (regras 1 e 3 do
`CLAUDE.md`): `HOME` falso em `tmp_path`, `pip` e `alembic` como stubs. Vive
em `tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.seguranca.test_deploy_sh import (
    CAMINHO_SCRIPT,
    MARCADOR_NOVO,
    MARCADOR_VELHO,
    Instalacao,
    _correr_deploy,
    _preparar_instalacao_valida,
)

#: Tudo o que o `deploy.sh` (e os stubs do teste) chamam pelo `PATH`. Os
#: comandos internos do bash (`kill`, `printf`, `cd`, `[`) não contam.
#: `python3` e `dirname` são dos stubs (`_STUB_REGISTADOR` e o `activate`
#: falso), não do script.
FERRAMENTAS_DO_SERVIDOR = [
    "bash",
    "cat",
    "cp",
    "find",
    "mkdir",
    "mv",
    "realpath",
    "rm",
    "rmdir",
    "sed",
    "tail",
    "touch",
    # Dos stubs:
    "dirname",
    "python3",
]

CONTEUDO_PASSENGER = (
    "# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN\n"
    'PassengerAppRoot "/home/exemplo/tomazia_api"\n'
    'PassengerBaseURI "/api"\n'
    "# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION END\n"
)


def _mensagem(resultado: subprocess.CompletedProcess[str]) -> str:
    return resultado.stdout + resultado.stderr


def _deploy_com_sucesso(instalacao: Instalacao) -> None:
    resultado = _correr_deploy(instalacao)
    assert resultado.returncode == 0, _mensagem(resultado)


def _instantaneo(pasta: Path) -> dict[str, bytes | str]:
    """Árvore inteira, com ligações (sem as seguir) e pastas, para comparar."""
    resultado: dict[str, bytes | str] = {}
    for raiz, pastas, ficheiros in os.walk(pasta):
        for nome in [*pastas, *ficheiros]:
            caminho = Path(raiz) / nome
            relativo = caminho.relative_to(pasta).as_posix()
            if caminho.is_symlink():
                resultado[relativo] = f"-> {os.readlink(caminho)}"
            elif caminho.is_file():
                resultado[relativo] = caminho.read_bytes()
            else:
                resultado[relativo] = "<pasta>"
    return resultado


def _escrever(caminho: Path, texto: str) -> Path:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(texto, encoding="utf-8")
    return caminho


# --- Sem rsync no PATH -------------------------------------------------------


def _path_sem_rsync(tmp_path: Path) -> str:
    """Uma pasta só com as ferramentas de `FERRAMENTAS_DO_SERVIDOR`, por ligação."""
    pasta = tmp_path / "bin-do-servidor"
    pasta.mkdir()
    for nome in FERRAMENTAS_DO_SERVIDOR:
        real = shutil.which(nome, path="/usr/bin:/bin:/usr/local/bin") or shutil.which(
            nome
        )
        assert real is not None, f"premissa: {nome} tem de existir nesta máquina"
        (pasta / nome).symlink_to(real)
    return str(pasta)


def test_deploy_completo_com_um_path_sem_rsync(tmp_path: Path) -> None:
    """O caso exato do achado: no CageFS não há `rsync`, e o deploy tem de correr na mesma."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    caminho = _path_sem_rsync(tmp_path)
    instalacao.ambiente["PATH"] = caminho

    assert shutil.which("rsync", path=caminho) is None, (
        "premissa do teste: o PATH dado ao deploy.sh não pode ter rsync"
    )

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode == 0, (
        "O deploy.sh falhou sem rsync no PATH — no servidor da dominios.pt "
        "não há rsync. Se falhou por 'command not found' noutra ferramenta, "
        "ou o script passou a depender dela (e é preciso confirmar que o "
        "CageFS a tem), ou falta acrescentá-la a FERRAMENTAS_DO_SERVIDOR.\n"
        f"{_mensagem(resultado)}"
    )
    assert "command not found" not in _mensagem(resultado), _mensagem(resultado)
    assert (instalacao.web / "index.html").read_text(encoding="utf-8") == (
        "<html>novo</html>\n"
    )
    assert (instalacao.web / "assets" / "novo-cd34.js").is_file()
    assert not (instalacao.web / "assets" / "velho-ab12.js").exists()
    assert (instalacao.api / "app" / MARCADOR_NOVO).is_file()
    assert not (instalacao.api / "app" / MARCADOR_VELHO).exists()
    assert (instalacao.api / "tmp" / "restart.txt").is_file()


def test_o_deploy_sh_nao_chama_rsync() -> None:
    """Rede estática: nenhuma linha de código (comentários à parte) do `deploy.sh` invoca o `rsync`."""
    linhas_de_codigo = [
        (numero, linha)
        for numero, linha in enumerate(
            CAMINHO_SCRIPT.read_text(encoding="utf-8").splitlines(), start=1
        )
        if not linha.lstrip().startswith("#")
    ]
    assert linhas_de_codigo, "premissa: o deploy.sh tem código"
    com_rsync = [
        f"{numero}: {linha}"
        for numero, linha in linhas_de_codigo
        if re.search(r"\brsync\b", linha)
    ]
    assert com_rsync == [], (
        "O deploy.sh voltou a chamar o rsync, que o CageFS do cPanel não "
        f"tem:\n{chr(10).join(com_rsync)}"
    )


# --- Modo site: o frontend sobre o WEB ----------------------------------------


def test_web_api_htaccess_do_passenger_sobrevive_e_a_pasta_fica(
    tmp_path: Path,
) -> None:
    """O caso real: o cPanel escreve o bloco do Passenger em `WEB/api/.htaccess`, e `api/` não está no build."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    passenger = _escrever(instalacao.web / "api" / ".htaccess", CONTEUDO_PASSENGER)
    resto = _escrever(instalacao.web / "api" / "resto-antigo.txt", "velho\n")

    _deploy_com_sucesso(instalacao)

    assert (instalacao.web / "api").is_dir() and not (
        instalacao.web / "api"
    ).is_symlink(), "A pasta WEB/api desapareceu — e com ela o Passenger."
    assert passenger.read_text(encoding="utf-8") == CONTEUDO_PASSENGER, (
        "WEB/api/.htaccess mudou. É onde o cPanel escreve o bloco do "
        "Passenger, e o deploy nunca lhe pode tocar."
    )
    assert not resto.exists(), (
        "Um ficheiro em WEB/api que não é o .htaccess e não está no build "
        "tem de desaparecer, como fazia o rsync --delete (só o .htaccess "
        "estava excluído)."
    )


def test_htaccess_no_destino_sobrevive_a_qualquer_profundidade(
    tmp_path: Path,
) -> None:
    """A exclusão sem âncora vale do lado do destino: um `.htaccess` no `WEB` nunca é apagado, mesmo numa pasta que já não está no build."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    em_assets = _escrever(instalacao.web / "assets" / ".htaccess", "# assets\n")
    fundo = _escrever(
        instalacao.web / "pasta-antiga" / "sub" / ".htaccess", "# fundo\n"
    )
    _escrever(instalacao.web / "pasta-antiga" / "sub" / "lixo.js", "x\n")
    _escrever(instalacao.web / "pasta-antiga" / "outra" / "lixo.js", "x\n")

    _deploy_com_sucesso(instalacao)

    assert em_assets.read_text(encoding="utf-8") == "# assets\n"
    assert fundo.read_text(encoding="utf-8") == "# fundo\n"
    assert not (instalacao.web / "pasta-antiga" / "sub" / "lixo.js").exists()
    assert not (instalacao.web / "pasta-antiga" / "outra").exists(), (
        "Uma pasta antiga sem nada protegido lá dentro tem de desaparecer."
    )
    assert (instalacao.web / ".htaccess").read_text(encoding="utf-8") == (
        "# diretivas reais do servidor\n"
    )


def test_media_e_well_known_nunca_sao_tocados(tmp_path: Path) -> None:
    """`media/` e `.well-known/` do servidor ficam byte a byte; os do build nunca são copiados para lá."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    _escrever(instalacao.web / "media" / "2026" / "11" / "foto.webp", "foto\n")
    _escrever(instalacao.web / ".well-known" / "acme-challenge" / "token", "token\n")
    dist = instalacao.origem / "frontend" / "dist"
    _escrever(dist / "media" / "intruso.txt", "do build\n")
    _escrever(dist / ".well-known" / "intruso.txt", "do build\n")

    media_antes = _instantaneo(instalacao.web / "media")
    well_known_antes = _instantaneo(instalacao.web / ".well-known")

    _deploy_com_sucesso(instalacao)

    assert _instantaneo(instalacao.web / "media") == media_antes
    assert _instantaneo(instalacao.web / ".well-known") == well_known_antes


def test_media_e_well_known_so_sao_protegidos_na_raiz(tmp_path: Path) -> None:
    """Eram exclusões ancoradas (`/media`, `/.well-known`): uma pasta com o mesmo nome mais abaixo é uma pasta qualquer."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    _escrever(instalacao.web / "assets" / "media" / "velho.txt", "velho\n")
    _escrever(instalacao.web / "assets" / ".well-known" / "velho.txt", "velho\n")
    dist = instalacao.origem / "frontend" / "dist"
    _escrever(dist / "assets" / "media" / "novo.txt", "novo\n")

    _deploy_com_sucesso(instalacao)

    assert not (instalacao.web / "assets" / "media" / "velho.txt").exists()
    assert not (instalacao.web / "assets" / ".well-known").exists()
    assert (instalacao.web / "assets" / "media" / "novo.txt").read_text(
        encoding="utf-8"
    ) == "novo\n"


def test_o_que_ja_nao_esta_no_build_desaparece_incluindo_escondidos(
    tmp_path: Path,
) -> None:
    """O antigo `--delete`: ficheiros, pastas inteiras e ficheiros escondidos que não estão no build saem do `WEB`.

    Inclui o caso que aconteceu na F1-05: um ficheiro de ambiente deixado
    por engano na raiz do site. Não é a proteção contra ele (essa é o
    `htaccess.exemplo`, que recusa servir ficheiros começados por ponto),
    mas o deploy seguinte também o limpa.
    """
    instalacao = _preparar_instalacao_valida(tmp_path)
    _escrever(instalacao.web / ".env", "SEGREDO=falso-de-teste\n")
    _escrever(instalacao.web / ".escondido-antigo", "x\n")
    _escrever(instalacao.web / "pasta-velha" / "a" / "b" / "c.txt", "x\n")
    _escrever(instalacao.web / "pasta-velha" / ".escondido", "x\n")

    _deploy_com_sucesso(instalacao)

    assert not os.path.lexists(instalacao.web / ".env")
    assert not os.path.lexists(instalacao.web / ".escondido-antigo")
    assert not os.path.lexists(instalacao.web / "pasta-velha")


def test_ficheiros_escondidos_do_build_sao_copiados(tmp_path: Path) -> None:
    """O `rsync -a` copiava os ficheiros começados por ponto; um `glob` sem `dotglob` não."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    dist = instalacao.origem / "frontend" / "dist"
    _escrever(dist / ".nojekyll", "\n")
    _escrever(dist / "assets" / ".manifesto", "m\n")

    _deploy_com_sucesso(instalacao)

    assert (instalacao.web / ".nojekyll").is_file()
    assert (instalacao.web / "assets" / ".manifesto").is_file()


def test_trocas_de_tipo_entre_ficheiro_e_pasta(tmp_path: Path) -> None:
    """Uma pasta no `WEB` onde o build tem um ficheiro, e vice-versa: fica o que está no build."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    dist = instalacao.origem / "frontend" / "dist"
    _escrever(dist / "era-pasta", "agora sou ficheiro\n")
    _escrever(dist / "era-ficheiro" / "dentro.txt", "agora sou pasta\n")
    _escrever(instalacao.web / "era-pasta" / "velho.txt", "velho\n")
    _escrever(instalacao.web / "era-ficheiro", "velho\n")

    _deploy_com_sucesso(instalacao)

    assert (instalacao.web / "era-pasta").read_text(encoding="utf-8") == (
        "agora sou ficheiro\n"
    )
    assert (instalacao.web / "era-ficheiro" / "dentro.txt").read_text(
        encoding="utf-8"
    ) == "agora sou pasta\n"


def test_ligacoes_no_destino_nunca_sao_seguidas(tmp_path: Path) -> None:
    """O `rsync` substituía uma ligação no destino; um `cp` ingénuo escrevia ATRAVÉS dela, para fora do site."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    fora = instalacao.home / "fora-do-site"
    _escrever(fora / "pasta" / "intocavel.txt", "intocável\n")
    ficheiro_fora = _escrever(fora / "index-de-fora.html", "intocável\n")
    _escrever(fora / "solto.txt", "intocável\n")

    shutil.rmtree(instalacao.web / "assets")
    (instalacao.web / "assets").symlink_to(fora / "pasta")
    (instalacao.web / "index.html").symlink_to(ficheiro_fora)
    (instalacao.web / "ligacao-velha").symlink_to(fora / "solto.txt")

    fora_antes = _instantaneo(fora)

    _deploy_com_sucesso(instalacao)

    assert _instantaneo(fora) == fora_antes, (
        "O deploy escreveu ou apagou fora do site, através de uma ligação "
        "simbólica que estava no WEB."
    )
    assert not (instalacao.web / "assets").is_symlink()
    assert (instalacao.web / "assets" / "novo-cd34.js").is_file()
    assert not (instalacao.web / "index.html").is_symlink()
    assert (instalacao.web / "index.html").read_text(encoding="utf-8") == (
        "<html>novo</html>\n"
    )
    assert not os.path.lexists(instalacao.web / "ligacao-velha"), (
        "Uma ligação antiga que não está no build sai — a ligação, nunca o "
        "ficheiro para onde aponta."
    )


# --- Modos espelho e acrescenta: a API ---------------------------------------


def test_app_e_migrations_ficam_iguais_a_origem(tmp_path: Path) -> None:
    """`api/app/` e `api/migrations/`: o antigo `rsync -a --delete`."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    _escrever(instalacao.api / "app" / "modulo_antigo" / "x.py", "velho\n")
    _escrever(instalacao.api / "app" / ".escondido_antigo", "velho\n")
    _escrever(instalacao.api / "migrations" / "versions" / "0000_velha.py", "x\n")
    _escrever(instalacao.origem / "api" / "app" / "routers" / "ementa.py", "# novo\n")
    _escrever(
        instalacao.origem / "api" / "migrations" / "versions" / "0001_nova.py",
        "# nova\n",
    )

    _deploy_com_sucesso(instalacao)

    for nome in ("app", "migrations"):
        assert _instantaneo(instalacao.api / nome) == _instantaneo(
            instalacao.origem / "api" / nome
        ), f"$API/{nome} não ficou igual à origem."


def test_scripts_acrescenta_sem_apagar(tmp_path: Path) -> None:
    """`api/scripts/`: o antigo `rsync -a`, sem `--delete` — um script apagado do repositório sobrevive."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    antigo = _escrever(instalacao.api / "scripts" / "script_antigo.py", "velho\n")

    _deploy_com_sucesso(instalacao)

    assert antigo.read_text(encoding="utf-8") == "velho\n"
    assert (instalacao.api / "scripts" / "backup.py").read_text(
        encoding="utf-8"
    ) == "# script falso\n"


def test_o_resto_de_tomazia_api_nunca_e_tocado(tmp_path: Path) -> None:
    """O modo espelho vale só em `app/` e `migrations/`, nunca na raiz de `tomazia_api/`."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    env_antes = (instalacao.api / ".env").read_bytes()
    outro = _escrever(instalacao.api / "tomazia_data" / "tomazia.db", "bd falsa\n")

    _deploy_com_sucesso(instalacao)

    assert (instalacao.api / ".env").read_bytes() == env_antes
    assert outro.read_text(encoding="utf-8") == "bd falsa\n"


# --- O que o `-a` preservava ---------------------------------------------------


def test_modo_e_data_dos_ficheiros_sao_preservados(tmp_path: Path) -> None:
    """`rsync -a` preservava o modo e a data; o `cp -p` também tem de o fazer."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    script = _escrever(instalacao.origem / "api" / "scripts" / "executavel.py", "#\n")
    script.chmod(0o750)
    os.utime(script, (1_700_000_000, 1_700_000_000))

    _deploy_com_sucesso(instalacao)

    copiado = instalacao.api / "scripts" / "executavel.py"
    assert copiado.stat().st_mode & 0o777 == 0o750
    assert int(copiado.stat().st_mtime) == 1_700_000_000


def test_nao_ficam_temporarios_e_a_segunda_corrida_da_o_mesmo(tmp_path: Path) -> None:
    """A cópia passa por um temporário na mesma pasta; nenhum pode sobrar, e repetir o deploy não muda nada."""
    instalacao = _preparar_instalacao_valida(tmp_path)

    _deploy_com_sucesso(instalacao)
    web_1 = _instantaneo(instalacao.web)
    app_1 = _instantaneo(instalacao.api / "app")

    _deploy_com_sucesso(instalacao)

    assert _instantaneo(instalacao.web) == web_1
    assert _instantaneo(instalacao.api / "app") == app_1
    sobras = [
        caminho
        for raiz in (instalacao.web, instalacao.api)
        for caminho in raiz.rglob("*")
        if ".tomazia-sinc." in caminho.name
    ]
    assert sobras == [], f"Ficaram temporários da sincronização: {sobras!r}"


@pytest.mark.parametrize("destino_relativo", ["app", "migrations"])
def test_destino_da_api_que_e_uma_ligacao_e_recusado(
    tmp_path: Path, destino_relativo: str
) -> None:
    """`$API/app` como ligação: o modo espelho apagaria o que está do outro lado. Recusa-se, nunca se escreve através dela."""
    instalacao = _preparar_instalacao_valida(tmp_path)
    fora = instalacao.home / "outro-sitio"
    intocavel = _escrever(fora / "intocavel.py", "não apagar\n")
    alvo = instalacao.api / destino_relativo
    if alvo.exists():
        shutil.rmtree(alvo)
    alvo.symlink_to(fora)

    resultado = _correr_deploy(instalacao)

    assert resultado.returncode != 0, _mensagem(resultado)
    assert "ligação simbólica" in _mensagem(resultado), _mensagem(resultado)
    assert intocavel.read_text(encoding="utf-8") == "não apagar\n"
    assert not (instalacao.api / "tmp" / "restart.txt").exists()
