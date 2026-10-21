"""Testes de segurança do arranque sob o Passenger (F1-02).

Falhas que falham em silêncio — nenhuma delas rebenta de forma óbvia se o
bloqueante estiver presente, por isso cada uma é pareada com um teste que
prova o oposto, para que nenhum destes testes passe só porque o cenário
nunca chegou a ser exercitado a sério:

1. Teste estático (AST): nenhum import de `app` nem chamada a
   `obter_definicoes()` pode aparecer, em `passenger_wsgi.py`, antes do
   `os.chdir(BASE_DIR)` ao nível do módulo — e só `os.chdir(BASE_DIR)`
   conta, não qualquer `os.chdir(...)` (ver `test_helper_...` mais abaixo).
2. Prova comportamental: produção insegura tem de rebentar, mencionando
   `SEGREDO_SESSAO`, mesmo com `cwd` fora de `tomazia_api/` e com o
   ambiente do processo de testes completamente limpo.
3. Contrapositivo, obrigatório: o mesmo cenário, com um segredo forte,
   arranca, responde 200, e corre com `os.getcwd()` igual a `tomazia_api/`
   — sem isto, o teste 2 passaria trivialmente mesmo que ninguém alguma vez
   lesse o ficheiro de ambiente, e a remoção do `os.chdir(BASE_DIR)`
   passaria despercebida (ver o docstring de cada teste para o porquê).
4. `TOMAZIA_ENV_FILE`: `obter_definicoes()` lê o ficheiro apontado por essa
   variável, nunca um `.env` que esteja por acaso na pasta de trabalho, e
   fica sempre resolvido para um caminho absoluto mesmo que a variável
   tenha um valor relativo.
5. O ficheiro de ambiente resolvido tem de ser um ficheiro regular legível:
   se não existir, se for uma diretoria, ou se for algo como `/dev/null`,
   `passenger_wsgi.py` recusa-se a arrancar — nunca serve produção em
   silêncio com o segredo de desenvolvimento e a documentação aberta só
   porque o ficheiro esperado não estava lá (o cenário mais provável de
   todos: o primeiro deploy, antes de o `.env` ser colocado no servidor).
6. Um `TOMAZIA_ENV_FILE` fora de `tomazia_api/` é recusado, mesmo que o
   ficheiro em si seja válido e tenha um segredo forte: é exatamente a
   primitiva de escrita (`SetEnv` num `.htaccess` honrado pelo Apache) que
   permitiria a alguém de fora escolher a configuração de produção inteira,
   incluindo o `SEGREDO_SESSAO`.
7. `ambiente` é obrigatório, sem valor por omissão: um ficheiro de ambiente
   regular, legível e dentro da instalação (passa as guardas 5 e 6) mas que
   não diz nada de útil sobre `AMBIENTE` — vazio, só com comentários, sem a
   linha `AMBIENTE`, ou com a chave mal escrita (`AMBIENTE_=...`, engolida
   em silêncio por `extra="ignore"`) — tem de rebentar, nunca cair no valor
   de omissão "desenvolvimento" e arrancar a servir produção com o segredo
   publicado no repositório.
8. A correção do achado 7 vive em `app/config.py` (`Definicoes`), nunca só
   em `passenger_wsgi.py`: quem importa `app.config` diretamente, sem
   passar pelo ponto de entrada do Passenger (p. ex. um script correido à
   mão, `scripts/criar_admin.py`), numa instalação sem ficheiro de ambiente
   nenhum, também tem de rebentar.
9. O canário de `passenger_wsgi.py` (`app.config`/`app.main` já em
   `sys.modules` antes do `chdir`/`sys.path`) dispara a sério, não só
   quando o bloco existe no código-fonte: substituí-lo por `if False:`
   tem de fazer um teste falhar.

Os testes 2, 3, 5, 6, 7, 8 e 9 correm em subprocesso (ver
`tests/apoio_subprocesso.py`): importar `passenger_wsgi` dentro do processo
de testes mudaria a pasta de trabalho do processo de testes e importaria
`app.main` sob produção, contaminando tudo o que viesse a seguir.
"""

from __future__ import annotations

import ast
import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest

from tests import apoio_subprocesso

RAIZ_BACKEND = Path(__file__).resolve().parent.parent.parent


def _contem_import_de_app(no: ast.AST) -> bool:
    for sub in ast.walk(no):
        if isinstance(sub, ast.Import) and any(
            alias.name == "app" or alias.name.startswith("app.") for alias in sub.names
        ):
            return True
        if (
            isinstance(sub, ast.ImportFrom)
            and sub.module
            and (sub.module == "app" or sub.module.startswith("app."))
        ):
            return True
    return False


def _contem_chamada_a_obter_definicoes(no: ast.AST) -> bool:
    for sub in ast.walk(no):
        if isinstance(sub, ast.Call):
            alvo = sub.func
            nome = (
                alvo.id
                if isinstance(alvo, ast.Name)
                else alvo.attr
                if isinstance(alvo, ast.Attribute)
                else None
            )
            if nome == "obter_definicoes":
                return True
    return False


def _contem_chamada_a_os_chdir_com_base_dir(no: ast.AST) -> bool:
    """Só `os.chdir(BASE_DIR)` conta — não qualquer `os.chdir(...)`.

    Aperta o teste anterior, que se contentava com qualquer `os.chdir(...)`
    ao nível do módulo, incluindo um `os.chdir(".")` sem efeito nenhum (muda
    para a pasta onde já se está, nunca prendendo nada à pasta de
    instalação). Só a chamada com o argumento literal `BASE_DIR` — a
    variável que `passenger_wsgi.py` deriva de
    `Path(__file__).resolve().parent` — prende de verdade a pasta de
    trabalho à pasta `tomazia_api/`. Se `BASE_DIR` for um dia renomeada,
    este teste tem de ser atualizado a par: é intencional, o nome por
    omissão não deve, sozinho, continuar a passar.
    """
    for sub in ast.walk(no):
        if (
            isinstance(sub, ast.Call)
            and isinstance(sub.func, ast.Attribute)
            and sub.func.attr == "chdir"
            and isinstance(sub.func.value, ast.Name)
            and sub.func.value.id == "os"
            and len(sub.args) == 1
            and isinstance(sub.args[0], ast.Name)
            and sub.args[0].id == "BASE_DIR"
        ):
            return True
    return False


def test_helper_so_aceita_os_chdir_com_base_dir_literal_nunca_qualquer_chdir() -> None:
    """Prova, sozinho, que o aperto acima é real: `os.chdir(".")` não basta.

    Sem este teste, bastaria a função aceitar qualquer `os.chdir(...)` (como
    acontecia antes desta ronda de correções) para o teste seguinte
    continuar a passar com `passenger_wsgi.py` mutado para `os.chdir(".")`
    — um no-op que nunca prende os valores por omissão relativos
    (`data_dir`, `base_dados_url`) à pasta `tomazia_api/`.
    """
    chamada_boa = ast.parse("os.chdir(BASE_DIR)\n").body[0]
    chamada_no_op = ast.parse('os.chdir(".")\n').body[0]

    assert _contem_chamada_a_os_chdir_com_base_dir(chamada_boa)
    assert not _contem_chamada_a_os_chdir_com_base_dir(chamada_no_op)


def test_import_de_app_e_obter_definicoes_nunca_antes_do_os_chdir() -> None:
    """O único teste que apanha um `from app... import ...` acrescentado ao cabeçalho do ficheiro.

    `obter_definicoes()` tem `lru_cache`: se alguma coisa importar `app.config`
    (ou qualquer outro submódulo de `app`, direta ou indiretamente, incluindo
    através de uma chamada a `obter_definicoes()`) antes de `os.chdir(BASE_DIR)`
    e de `sys.path.insert(0, str(BASE_DIR))` correrem, o valor validado por
    `Definicoes` fica fixado para o processo inteiro — e a guarda de produção
    (que rejeita um `SEGREDO_SESSAO` inseguro) nunca mais dispara, porque a
    `Definicoes` real já foi construída, em cache, antes de o ambiente da
    aplicação (incluindo `TOMAZIA_ENV_FILE`, resolvido relativo a `BASE_DIR`)
    estar completo.
    """
    caminho = RAIZ_BACKEND / "passenger_wsgi.py"
    codigo_fonte = caminho.read_text(encoding="utf-8")
    arvore = ast.parse(codigo_fonte, filename=str(caminho))

    indice_chdir = next(
        (
            indice
            for indice, instrucao in enumerate(arvore.body)
            if _contem_chamada_a_os_chdir_com_base_dir(instrucao)
        ),
        None,
    )
    assert indice_chdir is not None, (
        "passenger_wsgi.py tem de chamar os.chdir(BASE_DIR) ao nível do "
        "módulo — um os.chdir(...) com outro argumento (p. ex. "
        'os.chdir(".")) não conta'
    )

    for instrucao in arvore.body[:indice_chdir]:
        assert not _contem_import_de_app(instrucao), (
            "um import de `app` aparece antes do os.chdir(...) em "
            "passenger_wsgi.py — isto fixa a `Definicoes` em cache antes de "
            "o ambiente estar completo"
        )
        assert not _contem_chamada_a_obter_definicoes(instrucao), (
            "uma chamada a obter_definicoes() aparece antes do os.chdir(...) "
            "em passenger_wsgi.py — pelo mesmo motivo"
        )


def _preparar_cenario(tmp_path: Path, conteudo_env: str) -> tuple[Path, Path]:
    """Copia `tomazia_api/` falso para `tmp_path`, com um `.env` próprio, e uma `cwd` diferente."""
    pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
        tmp_path / "tomazia_api"
    )
    (pasta_tomazia_api / ".env").write_text(conteudo_env, encoding="utf-8")

    outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
    outra_pasta.mkdir()

    return pasta_tomazia_api, outra_pasta


def test_producao_com_segredo_inseguro_rebenta_e_stderr_menciona_segredo_sessao(
    tmp_path: Path,
) -> None:
    """Prova comportamental: produção insegura tem de rebentar, mencionando o `SEGREDO_SESSAO`.

    O que este teste apanha: se `sys.path.insert(0, str(BASE_DIR))`
    desaparecer de `passenger_wsgi.py` (o `app` deixa de ser importável —
    `AMBIENTE_MINIMO` inclui `PYTHONSAFEPATH=1` precisamente para que isto
    seja mesmo verdade, ver `tests/apoio_subprocesso.py` — e o erro em
    `stderr` passa a ser `ModuleNotFoundError`, nunca a validação do
    `SEGREDO_SESSAO`), ou se um import de `app` subir para o cabeçalho
    (nesse caso o teste AST já falha primeiro, mas aqui confirma-se que o
    comportamento também muda).

    O que este teste **não** apanha, de propósito, para não enganar quem o
    lê: a remoção isolada do `os.chdir(BASE_DIR)`. A leitura do `.env` de
    `pasta_tomazia_api/` resolve-se sempre a partir de `RAIZ_APP` (derivada
    de `Path(__file__).resolve().parent.parent` dentro do próprio
    `app.caminhos`, nunca da pasta de trabalho do processo), por isso
    continua a encontrar o `.env` certo mesmo sem `chdir` nenhum — só
    `os.getcwd()` fica errado depois. É o par
    `test_producao_com_segredo_forte_arranca_e_health_responde_200`, a
    seguir, que afirma `os.getcwd()` e apanha essa remoção. Também não
    apanha uma regressão em `app/config.py` que volte a resolver
    `TOMAZIA_ENV_FILE` relativo à pasta de trabalho em vez de a
    `.resolve()`-vido: nesse cenário `os.chdir(BASE_DIR)` já correu antes de
    `Definicoes` ser construída, por isso a pasta de trabalho já é
    `pasta_tomazia_api/` e o `.env` continua a ser encontrado — é
    `TestTomaziaEnvFile`, mais abaixo, que isola isso de `os.chdir` e
    apanha a regressão a sério.
    """
    pasta_tomazia_api, outra_pasta = _preparar_cenario(
        tmp_path, "AMBIENTE=producao\nSEGREDO_SESSAO=curto-demais\n"
    )

    resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
        pasta_tomazia_api=pasta_tomazia_api,
        cwd=outra_pasta,
        ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
        codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
    )

    assert resultado.returncode != 0
    assert "SEGREDO_SESSAO" in resultado.stderr


def test_producao_com_segredo_forte_arranca_e_health_responde_200(
    tmp_path: Path,
) -> None:
    """Contrapositivo, obrigatório: o mesmo cenário, com um segredo forte, tem de arrancar.

    Sem este teste, o anterior passaria trivialmente mesmo que o ficheiro de
    ambiente nunca fosse lido (bastaria `passenger_wsgi.py` rebentar sempre,
    por qualquer motivo). Os dois juntos é que provam alguma coisa: o
    `.env` de `tomazia_api/` é mesmo lido, e só o segredo é que decide se a
    produção arranca.

    A asserção sobre `os.getcwd()`, no código que corre depois do import, é
    a única coisa desta dupla de testes que apanha a remoção isolada do
    `os.chdir(BASE_DIR)` em `passenger_wsgi.py` (ver o docstring do teste
    irmão, acima, para o porquê de nem a importação nem a validação do
    segredo mudarem sem ele): sem `os.chdir`, a app continua a arrancar e a
    responder 200, mas `os.getcwd()` fica a `outra_pasta` (a pasta de
    trabalho onde o subprocesso arrancou), nunca `pasta_tomazia_api/` — e é
    esse o `chdir` que prende os valores por omissão relativos de
    `Definicoes` (`data_dir = ./var`, `base_dados_url =
    sqlite:///./var/dev.db`) à pasta de instalação. Sem o prender, uma
    instalação real ficaria com a pasta de trabalho do Passenger a decidir
    onde o SQLite nasce — se calhar a home ou o `public_html`, descarregável
    por URL.
    """
    segredo_forte = secrets.token_urlsafe(48)
    pasta_tomazia_api, outra_pasta = _preparar_cenario(
        tmp_path, f"AMBIENTE=producao\nSEGREDO_SESSAO={segredo_forte}\n"
    )

    codigo = "import os\nprint('CWD=' + os.getcwd())\n" + (
        apoio_subprocesso.codigo_chamar_wsgi(
            script_name="/api", path_info="/health", variavel_app="application"
        )
    )
    resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
        pasta_tomazia_api=pasta_tomazia_api,
        cwd=outra_pasta,
        ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
        codigo_depois_de_importar=codigo,
    )

    assert resultado.returncode == 0, resultado.stderr
    assert "STATUS=200" in resultado.stdout

    linha_cwd = next(
        linha for linha in resultado.stdout.splitlines() if linha.startswith("CWD=")
    )
    assert linha_cwd == f"CWD={pasta_tomazia_api.resolve()}", (
        "a pasta de trabalho, depois do import, tem de ser pasta_tomazia_api/ "
        "— só os.chdir(BASE_DIR) a prende lá"
    )


class TestTomaziaEnvFile:
    def test_obter_definicoes_le_o_ficheiro_apontado_por_tomazia_env_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        pasta_a = tmp_path / "a"
        pasta_b = tmp_path / "b"
        pasta_a.mkdir()
        pasta_b.mkdir()
        pasta_dados = pasta_a / "dados-de-a"
        (pasta_a / ".env").write_text(f"DATA_DIR={pasta_dados}\n", encoding="utf-8")

        monkeypatch.chdir(pasta_b)
        monkeypatch.setenv("TOMAZIA_ENV_FILE", str(pasta_a / ".env"))
        monkeypatch.delenv("DATA_DIR", raising=False)

        from app.config import obter_definicoes

        obter_definicoes.cache_clear()
        definicoes = obter_definicoes()

        assert definicoes.data_dir == pasta_dados

    def test_ficheiro_de_ambiente_na_pasta_de_trabalho_e_ignorado(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """No mesmo cenário, um `.env` em `b/` (a pasta de trabalho) é ignorado."""
        pasta_a = tmp_path / "a"
        pasta_b = tmp_path / "b"
        pasta_a.mkdir()
        pasta_b.mkdir()
        # O AMBIENTE vive no ficheiro para onde o TOMAZIA_ENV_FILE aponta, não
        # no ambiente do processo: uma variável real ganharia a qualquer
        # ficheiro e o teste passaria sem provar nada. Assim, se o `.env` da
        # pasta de trabalho fosse lido, o ambiente seria "producao".
        (pasta_a / ".env").write_text(
            "AMBIENTE=desenvolvimento\nDATA_DIR=" + str(pasta_a / "dados-de-a") + "\n",
            encoding="utf-8",
        )
        (pasta_b / ".env").write_text("AMBIENTE=producao\n", encoding="utf-8")

        monkeypatch.chdir(pasta_b)
        monkeypatch.setenv("TOMAZIA_ENV_FILE", str(pasta_a / ".env"))
        monkeypatch.delenv("AMBIENTE", raising=False)

        from app.config import obter_definicoes

        obter_definicoes.cache_clear()
        definicoes = obter_definicoes()

        assert definicoes.ambiente == "desenvolvimento"

    def test_tomazia_env_file_relativo_fica_resolvido_para_absoluto(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """Achado do revisor-codigo: um valor relativo em `TOMAZIA_ENV_FILE` não pode escapar `.resolve()`.

        A docstring antiga de `caminho_ficheiro_de_ambiente` dizia "nunca
        relativo à pasta de trabalho" sem garantir isso quando a própria
        variável de ambiente tem um valor relativo: `Path(variavel)`, sem
        `.resolve()`, devolve um `Path` relativo, e quem o abre (o
        `pydantic-settings`) resolve-o contra a pasta de trabalho do
        processo nesse momento — exatamente o que a docstring prometia não
        acontecer. Isto importa para lá do rigor da documentação: é o que
        torna possível comparar este caminho com `RAIZ_APP`, mais abaixo
        (`TestTomaziaEnvFileForaDaInstalacao`), para a guarda que recusa um
        `TOMAZIA_ENV_FILE` fora de `tomazia_api/` — uma comparação que um
        caminho ainda relativo tornaria inútil.
        """
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("TOMAZIA_ENV_FILE", "caminho/relativo/.env")

        from app.config import caminho_ficheiro_de_ambiente

        resolvido = caminho_ficheiro_de_ambiente()

        assert resolvido.is_absolute()
        assert resolvido == (tmp_path / "caminho/relativo/.env").resolve()


_MENSAGEM_GUARDA_FICHEIRO_NAO_REGULAR = (
    "não existe ou não é um ficheiro regular legível"
)


class TestArranqueRecusaSeFicheiroDeAmbienteNaoForRegularLegivel:
    """Achado [alta]: um ficheiro de ambiente que não exista é o caso mais provável de todos.

    Reproduzido tal e qual pelo Tomás: `TOMAZIA_ENV_FILE=/tmp/nao-existe.env`
    (ou, equivalente, nenhum ficheiro nenhum no caminho por omissão) faz o
    `pydantic-settings` ignorar o ficheiro em silêncio, `ambiente` cai no
    valor por omissão `"desenvolvimento"`, a guarda de produção nunca corre,
    e a app arranca a servir produção com o segredo de desenvolvimento
    publicado no repositório e a documentação toda aberta. É o cenário do
    primeiro deploy, antes de o `.env` ser colocado no servidor.

    As quatro variantes a seguir arrancam **hoje** (o processo sai com
    código 0): é a razão de serem testes que falham agora — só passam
    quando `passenger_wsgi.py` ganhar a guarda que recusa arrancar sempre
    que o ficheiro de ambiente resolvido não for um ficheiro regular
    legível. Nenhuma depende de `AMBIENTE`/`SEGREDO_SESSAO` estarem
    definidos em lado nenhum: a guarda tem de disparar só por o ficheiro
    não prestar, antes de sequer chegar a essa validação.

    Nenhuma define `TOMAZIA_ENV_FILE`, de propósito: todas usam o caminho
    por omissão (`pasta_tomazia_api/.env`), que não passa por `.resolve()`
    em `caminho_ficheiro_de_ambiente()` (`RAIZ_APP / ".env"` já é
    absoluto). Apontar `TOMAZIA_ENV_FILE` para fora de `pasta_tomazia_api/`
    — como as versões antigas da diretoria e do `/dev/null` faziam —
    dispara a guarda de contenção
    (`TestTomaziaEnvFileForaDaInstalacao`), não esta: os dois testes
    passavam, mas pela guarda errada. Cada `assert resultado.returncode !=
    0` vem acompanhado de uma asserção sobre `resultado.stderr` que o
    confirma: sem ela, o teste do canário (ou qualquer outra falha de
    arranque) também os faria passar, por um motivo que não é o que o nome
    promete.
    """

    def test_sem_ficheiro_de_ambiente_nenhum_rebenta(self, tmp_path: Path) -> None:
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        # De propósito: nenhum `.env` em pasta_tomazia_api/. TOMAZIA_ENV_FILE
        # também não se define — o caminho por omissão
        # (pasta_tomazia_api/.env) é que fica inexistente.
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0, (
            "sem ficheiro de ambiente nenhum, a app arrancou e serviria "
            "produção com o segredo de desenvolvimento publicado e a "
            "documentação aberta"
        )
        assert _MENSAGEM_GUARDA_FICHEIRO_NAO_REGULAR in resultado.stderr

    def test_ficheiro_de_ambiente_e_uma_diretoria_dentro_da_instalacao_rebenta(
        self, tmp_path: Path
    ) -> None:
        """`pasta_tomazia_api/.env` é, ele próprio, uma diretoria — não um ficheiro fora da instalação.

        A versão antiga deste teste apontava `TOMAZIA_ENV_FILE` para uma
        diretoria irmã de `pasta_tomazia_api/` (fora da instalação): quem a
        rejeitava era a guarda de contenção
        (`TestTomaziaEnvFileForaDaInstalacao`), nunca a guarda do `is_file()`
        que o nome do teste promete — confirmado trocando `is_file()` por
        `exists()` em `passenger_wsgi.py`: a suite inteira continuava verde.
        Aqui a diretoria fica no caminho por omissão, dentro de
        `pasta_tomazia_api/`, para ser mesmo esta guarda a disparar.
        """
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        (pasta_tomazia_api / ".env").mkdir()
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0
        assert _MENSAGEM_GUARDA_FICHEIRO_NAO_REGULAR in resultado.stderr

    def test_ficheiro_de_ambiente_e_um_fifo_dentro_da_instalacao_rebenta(
        self, tmp_path: Path
    ) -> None:
        """Um FIFO (`os.mkfifo`) existe, abre, mas não é um ficheiro regular.

        `Path.is_file()` nunca o confunde com um ficheiro regular — e, como
        a guarda só faz `stat()` (nunca abre o ficheiro para ler), criar o
        FIFO aqui não arrisca bloquear o teste à espera de um leitor ou
        escritor do outro lado.
        """
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        os.mkfifo(pasta_tomazia_api / ".env")
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0
        assert _MENSAGEM_GUARDA_FICHEIRO_NAO_REGULAR in resultado.stderr

    def test_ficheiro_de_ambiente_e_um_symlink_para_dev_null_dentro_da_instalacao_rebenta(
        self, tmp_path: Path
    ) -> None:
        """O acidente mais realista: um `.env` que passou a ser `ln -sf /dev/null .env`.

        A versão antiga deste teste definia `TOMAZIA_ENV_FILE=/dev/null`
        diretamente — um caminho fora de `pasta_tomazia_api/` — por isso
        quem o rejeitava era a guarda de contenção, nunca a do `is_file()`
        que a docstring antiga afirmava (e que, confirmado trocando
        `is_file()` por `exists()`, não disparava mesmo). Aqui o symlink
        fica dentro da instalação, no caminho por omissão: `/dev/null`
        existe e "lê-se vazio" (daí `exists()` não bastar), mas é um
        dispositivo de caracteres, não um ficheiro regular — é
        `Path.is_file()`, que segue o symlink e confirma o tipo do alvo,
        que tem de apanhar isto.
        """
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        os.symlink("/dev/null", pasta_tomazia_api / ".env")
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0
        assert _MENSAGEM_GUARDA_FICHEIRO_NAO_REGULAR in resultado.stderr


class TestTomaziaEnvFileForaDaInstalacao:
    """Achado [média] do revisor-seguranca: `TOMAZIA_ENV_FILE` é uma variável de ambiente do processo.

    Em produção, é exatamente a primitiva que um `SetEnv TOMAZIA_ENV_FILE
    ...` num `.htaccess` honrado pelo Apache/Passenger escreveria — a mesma
    classe de escrita que o formulário de upload do site antigo oferecia.
    Um caminho fora de `tomazia_api/` tem de ser recusado, mesmo que aponte
    para um ficheiro de ambiente perfeitamente válido, com um segredo forte:
    nunca pode ser a via por onde alguém escolhe a configuração de produção
    (incluindo o `SEGREDO_SESSAO`) a partir de fora da instalação.
    """

    def test_ficheiro_de_ambiente_fora_de_tomazia_api_e_recusado(
        self, tmp_path: Path
    ) -> None:
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        segredo_forte = secrets.token_urlsafe(48)
        ficheiro_fora = tmp_path / "fora-de-tomazia-api.env"
        ficheiro_fora.write_text(
            f"AMBIENTE=producao\nSEGREDO_SESSAO={segredo_forte}\n", encoding="utf-8"
        )
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        ambiente = dict(apoio_subprocesso.AMBIENTE_MINIMO)
        ambiente["TOMAZIA_ENV_FILE"] = str(ficheiro_fora)

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=ambiente,
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0, (
            "um TOMAZIA_ENV_FILE fora de tomazia_api/ arrancou com sucesso — "
            "isto é o equivalente a um SetEnv num .htaccess escolher a "
            "configuração de produção inteira a partir de fora"
        )


class TestAmbienteObrigatorioSemValorPorOmissao:
    """A quarta falha da mesma família: a guarda do `is_file()` nunca verifica o *conteúdo*.

    Com `ambiente` a cair no valor por omissão `"desenvolvimento"` sempre
    que a chave `AMBIENTE` não aparece (ou aparece comentada, ou mal
    escrita) no ficheiro, qualquer ficheiro regular, legível e dentro da
    instalação passa as duas guardas de `passenger_wsgi.py` e arranca em
    desenvolvimento — com o segredo de desenvolvimento publicado no
    repositório e a documentação toda aberta, mesmo que o `.env` exista
    mesmo. A correção, decidida pelo Tomás: `ambiente` passa a ser
    obrigatório em `Definicoes` (`app/config.py`), sem valor por omissão —
    só assim nenhuma destas quatro variantes consegue arrancar.

    As quatro rebentam **hoje** com `returncode == 0`: falham agora porque
    o comportamento ainda não existe em `app/config.py`, não por erro de
    importação. Cada uma confirma, por `resultado.stderr`, que a razão é
    mesmo a falta de `ambiente`, não outra guarda qualquer.
    """

    def test_ficheiro_de_ambiente_vazio_rebenta(self, tmp_path: Path) -> None:
        pasta_tomazia_api, outra_pasta = _preparar_cenario(tmp_path, "")

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0, (
            "um .env vazio não diz nada sobre o ambiente, mas a app arrancou "
            "à mesma — ambiente caiu no valor por omissão 'desenvolvimento'"
        )
        assert "ambiente" in resultado.stderr.lower()

    def test_ficheiro_de_ambiente_so_com_comentarios_rebenta(
        self, tmp_path: Path
    ) -> None:
        """Copiou o `.env.example` e comentou tudo — nenhuma chave sobrevive."""
        conteudo_env = (
            "# AMBIENTE=producao\n"
            "# SEGREDO_SESSAO=<gera-um-segredo-com-o-comando-acima>\n"
            "# DATA_DIR=./var\n"
        )
        pasta_tomazia_api, outra_pasta = _preparar_cenario(tmp_path, conteudo_env)

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0, (
            "um .env só com comentários não diz nada sobre o ambiente, mas "
            "a app arrancou à mesma"
        )
        assert "ambiente" in resultado.stderr.lower()

    def test_ficheiro_completo_com_segredo_forte_mas_sem_a_linha_ambiente_rebenta(
        self, tmp_path: Path
    ) -> None:
        """Um `SEGREDO_SESSAO` forte não chega: sem `AMBIENTE=...`, não há produção nenhuma a validar."""
        segredo_forte = secrets.token_urlsafe(48)
        pasta_tomazia_api, outra_pasta = _preparar_cenario(
            tmp_path, f"SEGREDO_SESSAO={segredo_forte}\n"
        )

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0, (
            "um SEGREDO_SESSAO forte, sozinho, não basta — sem a linha "
            "AMBIENTE, a app arrancou em desenvolvimento à mesma"
        )
        assert "ambiente" in resultado.stderr.lower()

    def test_gralha_na_chave_ambiente_engolida_por_extra_ignore_rebenta(
        self, tmp_path: Path
    ) -> None:
        """`AMBIENTE_=producao` (sublinhado a mais) não é `AMBIENTE` — `extra="ignore"` engole-o em silêncio."""
        segredo_forte = secrets.token_urlsafe(48)
        pasta_tomazia_api, outra_pasta = _preparar_cenario(
            tmp_path, f"AMBIENTE_=producao\nSEGREDO_SESSAO={segredo_forte}\n"
        )

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0, (
            "AMBIENTE_ (gralha na chave) não é AMBIENTE — extra='ignore' "
            "engoliu-a em silêncio e a app arrancou em desenvolvimento"
        )
        assert "ambiente" in resultado.stderr.lower()


def test_importar_app_config_sem_passar_pelo_passenger_wsgi_sem_ficheiro_de_ambiente_rebenta(
    tmp_path: Path,
) -> None:
    """O que a colocação das guardas em `passenger_wsgi.py` deixa de fora.

    Medido pelo revisor: numa instalação sem ficheiro de ambiente, `python
    -c "from app.config import obter_definicoes; obter_definicoes()"`
    devolve `ambiente=desenvolvimento`, `segredo=desenvolvimento-sem-segredo`,
    `bd=sqlite:///./var/dev.db`, sem guarda nenhuma a disparar — as duas
    guardas (ficheiro regular legível; dentro da instalação) vivem em
    `passenger_wsgi.py`, de propósito (ver o cabeçalho deste ficheiro),
    nunca em `app/config.py`.

    O ataque: o dono corre `scripts/criar_admin.py` (F2-02) a partir da sua
    home, o script importa `app.config` diretamente — sem nunca passar pelo
    ponto de entrada do Passenger —, abre `./var/dev.db` relativo à shell em
    vez da base de dados real, e o dono fica convencido de que mudou a
    palavra-passe quando o site continua com a antiga.

    É este teste que prova que a correção (achado 7: `ambiente` obrigatório,
    sem valor por omissão, em `Definicoes`) fecha o que um
    `assert`/`SystemExit` só no ponto de entrada (`passenger_wsgi.py`) nunca
    fecharia: aqui não há `passenger_wsgi.py` nenhum no caminho, de
    propósito — só `python -c` a importar `app.config` a direito.
    """
    pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
        tmp_path / "tomazia_api"
    )
    # De propósito: nenhum `.env` em pasta_tomazia_api/, e nenhum
    # TOMAZIA_ENV_FILE definido — o caminho por omissão
    # (pasta_tomazia_api/.env) fica inexistente.
    pasta_tipo_home = tmp_path / "home-do-dono"
    pasta_tipo_home.mkdir()

    ambiente = dict(apoio_subprocesso.AMBIENTE_MINIMO)
    ambiente["PYTHONPATH"] = str(pasta_tomazia_api)

    resultado = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.config import obter_definicoes\n"
            "obter_definicoes()\n"
            "print('nunca devia chegar aqui')\n",
        ],
        cwd=pasta_tipo_home,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert resultado.returncode != 0, (
        "importar app.config sem passar por passenger_wsgi.py, numa "
        "instalação sem ficheiro de ambiente nenhum, arrancou com as "
        "definições de desenvolvimento — nenhuma guarda disparou"
    )
    assert "ambiente" in resultado.stderr.lower()


def test_canario_dispara_quando_app_config_ja_esta_em_sys_modules_antes_do_chdir(
    tmp_path: Path,
) -> None:
    """O canário de `passenger_wsgi.py` tem de disparar a sério, não só existir no código-fonte.

    Reproduz o achado do revisor: substituir o bloco do canário por
    `if False:` deixava a suite inteira passar, porque nenhum teste punha
    `app.config`/`app.main` em `sys.modules` antes de `passenger_wsgi.py`
    correr — exatamente o estado de um segundo carregamento do Passenger no
    mesmo processo (um worker reciclado, por exemplo), onde um import
    anterior já fixaria `Definicoes` em cache (via `lru_cache`) antes de o
    ambiente estar completo, e a guarda de produção nunca mais dispararia.

    `codigo_antes_de_importar` importa o `app.config` a sério — nunca um
    módulo falso — antes de `importlib` sequer tocar em `passenger_wsgi.py`,
    para `sys.modules["app.config"]` ficar no estado que um segundo
    carregamento do Passenger deixaria. Um módulo falso (p. ex.
    `types.ModuleType("app.config")` vazio) falharia por uma razão errada:
    o `from app.config import caminho_ficheiro_de_ambiente` de
    `passenger_wsgi.py`, mais abaixo, daria `ImportError` mesmo com o
    canário desativado (`if False:`), porque o módulo falso não tem esse
    nome — o `returncode != 0` passaria pela mesma razão com ou sem
    canário, sem provar nada sobre ele. Importando o módulo a sério, sem o
    canário o arranque segue até ao fim com sucesso (o `.env` tem um
    segredo forte) e só a asserção sobre `resultado.stderr` (a mensagem do
    canário) distingue os dois casos — é essa mensagem, não o código de
    saída sozinho, que a mutação `if False:` apaga.

    `sys.path.insert(0, pasta_tomazia_api)` aqui é só para este import a
    sério ser possível antes de `passenger_wsgi.py` correr; o seu próprio
    `sys.path.insert(0, str(BASE_DIR))`, a seguir, não se importa de o
    caminho já lá estar. Tudo isto corre dentro do subprocesso isolado,
    nunca contaminando o processo de testes em si.
    """
    segredo_forte = secrets.token_urlsafe(48)
    pasta_tomazia_api, outra_pasta = _preparar_cenario(
        tmp_path, f"AMBIENTE=producao\nSEGREDO_SESSAO={segredo_forte}\n"
    )

    codigo_antes_de_importar = (
        "import sys\n"
        f"sys.path.insert(0, {str(pasta_tomazia_api)!r})\n"
        "import app.config\n"
    )

    resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
        pasta_tomazia_api=pasta_tomazia_api,
        cwd=outra_pasta,
        ambiente=dict(apoio_subprocesso.AMBIENTE_MINIMO),
        codigo_antes_de_importar=codigo_antes_de_importar,
        codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
    )

    assert resultado.returncode != 0, (
        "app.config já estava em sys.modules antes do chdir/sys.path, e "
        "passenger_wsgi.py arrancou à mesma — o canário não disparou"
    )
    assert "já estava importado" in resultado.stderr
