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

Os testes 2, 3, 5 e 6 correm em subprocesso (ver `tests/apoio_subprocesso.py`):
importar `passenger_wsgi` dentro do processo de testes mudaria a pasta de
trabalho do processo de testes e importaria `app.main` sob produção,
contaminando tudo o que viesse a seguir.
"""

from __future__ import annotations

import ast
import secrets
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
        (pasta_a / ".env").write_text(
            "DATA_DIR=" + str(pasta_a / "dados-de-a") + "\n", encoding="utf-8"
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

        A docstring antiga de `_caminho_ficheiro_de_ambiente` dizia "nunca
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

        from app.config import _caminho_ficheiro_de_ambiente

        resolvido = _caminho_ficheiro_de_ambiente()

        assert resolvido.is_absolute()
        assert resolvido == (tmp_path / "caminho/relativo/.env").resolve()


class TestArranqueRecusaSeFicheiroDeAmbienteNaoForRegularLegivel:
    """Achado [alta]: um ficheiro de ambiente que não exista é o caso mais provável de todos.

    Reproduzido tal e qual pelo Tomás: `TOMAZIA_ENV_FILE=/tmp/nao-existe.env`
    (ou, equivalente, nenhum ficheiro nenhum no caminho por omissão) faz o
    `pydantic-settings` ignorar o ficheiro em silêncio, `ambiente` cai no
    valor por omissão `"desenvolvimento"`, a guarda de produção nunca corre,
    e a app arranca a servir produção com o segredo de desenvolvimento
    publicado no repositório e a documentação toda aberta. É o cenário do
    primeiro deploy, antes de o `.env` ser colocado no servidor.

    As três variantes a seguir arrancam **hoje** (o processo sai com código
    0): é a razão de serem testes que falham agora — só passam quando
    `passenger_wsgi.py` ganhar a guarda que recusa arrancar sempre que o
    ficheiro de ambiente resolvido não for um ficheiro regular legível.
    Nenhuma depende de `AMBIENTE`/`SEGREDO_SESSAO` estarem definidos em lado
    nenhum: a guarda tem de disparar só por o ficheiro não prestar, antes de
    sequer chegar a essa validação.
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

    def test_ficheiro_de_ambiente_a_apontar_para_uma_diretoria_rebenta(
        self, tmp_path: Path
    ) -> None:
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        pasta_que_finge_ser_env = tmp_path / "isto-e-uma-pasta.env"
        pasta_que_finge_ser_env.mkdir()
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        ambiente = dict(apoio_subprocesso.AMBIENTE_MINIMO)
        ambiente["TOMAZIA_ENV_FILE"] = str(pasta_que_finge_ser_env)

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=ambiente,
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0

    def test_ficheiro_de_ambiente_a_apontar_para_dev_null_rebenta(
        self, tmp_path: Path
    ) -> None:
        """`/dev/null` existe e é "legível" (lê-se vazio) mas não é um ficheiro regular.

        Um simples `os.path.exists()`/`open(...).read()` não apanhava isto —
        é por isto que a guarda tem de confirmar explicitamente que é um
        ficheiro regular (`Path.is_file()`), não só que existe ou abre.
        """
        pasta_tomazia_api = apoio_subprocesso.copiar_tomazia_api_falso(
            tmp_path / "tomazia_api"
        )
        outra_pasta = tmp_path / "pasta-de-trabalho-diferente"
        outra_pasta.mkdir()

        ambiente = dict(apoio_subprocesso.AMBIENTE_MINIMO)
        ambiente["TOMAZIA_ENV_FILE"] = "/dev/null"

        resultado = apoio_subprocesso.correr_passenger_wsgi_isolado(
            pasta_tomazia_api=pasta_tomazia_api,
            cwd=outra_pasta,
            ambiente=ambiente,
            codigo_depois_de_importar="print('nunca devia chegar aqui')\n",
        )

        assert resultado.returncode != 0


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
