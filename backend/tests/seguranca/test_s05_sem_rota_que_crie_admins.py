"""Critério S-05: não existe rota nenhuma que crie admins.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-05 | Rota que crie admins | Não existe |

## Um critério pela negativa

S-05 não descreve um pedido para fazer e uma resposta para verificar — só
a ausência de alguma coisa. Um critério assim fica verde **sem verificar
nada** se não se tomar conta: zero rotas de gestão de admins porque
ninguém as escreveu é a mesma afirmação que zero rotas porque a travessia
que as devia enumerar partiu. É o mesmo problema que
`tests/seguranca/test_s04_gestao_exige_sessao.py` resolveu com quatro
camadas, e este ficheiro segue o molde:

1. **Controlo da travessia** — a app real continua a ter rotas nalgum
   lado, e `tests/apoio_rotas.py` continua a vê-las. Sem isto, as outras
   três passam numa app que a travessia deixou de conseguir ler — a
   armadilha do `_IncludedRouter` que `tests/apoio_rotas.py` já documenta
   (e que já foi apanhada duas vezes, na F2-04 e no upgrade do FastAPI).
2. **Estática** — lê os `app/routers/*.py` do disco e procura, em cada
   um, uma chamada a `registar_admin` ou a construção de um `Admin(...)`.
   Rebenta se a pasta não existir ou vier vazia, em vez de dar o critério
   por cumprido sobre zero ficheiros lidos.
3. **OpenAPI** — o conjunto de caminhos cujo corpo de pedido tem um campo
   `password` é exatamente `{"/auth/login"}`, e `hash_password` não
   aparece em esquema nenhum (nem de pedido, nem de resposta).
4. **Comportamental** — para cada rota × método da lista gerada por
   `tests/apoio_rotas.py`, um pedido sem sessão não muda
   `SELECT COUNT(*) FROM admins`. É a única camada que não depende de
   nomes de função nem de campos de esquema — lê só o efeito.

## O que a Camada 2 **não** verifica, e porquê

A instrução original pedia também "nenhum importa `app.models.admins`".
Medido no código já fundido: `app/routers/auth.py` importa `Admin` para
anotar o tipo de `GET /auth/eu`
(`Annotated[Admin, Depends(servico.exigir_admin)]`), e
`app/routers/fotos.py` importa-o para `_admin_da_sessao(...) -> Admin |
None` (o atalho do limite de envios para quem já tem sessão de admin,
F2-06). As duas são leituras, nunca escritas, e já estavam fundidas antes
desta tarefa — um `grep` ao import, sem mais nada, marcaria as duas como
violações do S-05 e ficaria vermelho por uma razão que não tem nada a ver
com o critério: exatamente o "não consegui procurar bem" a disfarçar-se
de "encontrei um problema" que a regra 10 do `CLAUDE.md` proíbe. A
Camada 2 fica só com as duas verificações que o import sozinho não
consegue fingir: uma chamada a `registar_admin` e uma construção de
`Admin(`.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

from tests.apoio_rotas import exigir_cobertura_do_openapi, rotas_declaradas

RAIZ_BACKEND = Path(__file__).resolve().parent.parent.parent
PASTA_ROUTERS = RAIZ_BACKEND / "app" / "routers"

CABECALHO_MUTACAO = {"X-Tomazia": "1"}


class TestCamada1ControloDaTravessia:
    def test_a_travessia_continua_a_ver_rotas_na_app_real(self) -> None:
        """Sucesso falso: sem isto, nenhuma rota de S-05 provava coisa nenhuma.

        Deixa passar: nada sobre criar admins — só que a travessia em si
        continua a saber ler esta versão do FastAPI.
        """
        from app.main import criar_app

        aplicacao = criar_app()
        exigir_cobertura_do_openapi(aplicacao)
        assert rotas_declaradas(aplicacao), (
            "a travessia não encontrou rota nenhuma na app real — a app não "
            "tem rotas (improvável) ou a travessia partiu. Nos dois casos, "
            "a Camada 4 abaixo não provaria nada"
        )


# --- Camada 2: estática -----------------------------------------------------


def _contem_chamada_a_registar_admin(arvore: ast.AST) -> bool:
    for no in ast.walk(arvore):
        if isinstance(no, ast.Name) and no.id == "registar_admin":
            return True
        if isinstance(no, ast.Attribute) and no.attr == "registar_admin":
            return True
        if isinstance(no, ast.alias) and no.name == "registar_admin":
            return True
    return False


def _contem_construcao_de_admin(arvore: ast.AST) -> bool:
    for no in ast.walk(arvore):
        if not isinstance(no, ast.Call):
            continue
        alvo = no.func
        nome = (
            alvo.id
            if isinstance(alvo, ast.Name)
            else alvo.attr
            if isinstance(alvo, ast.Attribute)
            else None
        )
        if nome == "Admin":
            return True
    return False


class TestCamada2Estatica:
    def test_os_routers_existem_e_nao_estao_vazios(self) -> None:
        """O guarda de regra 10 desta camada: zero ficheiros não é "cumprido".

        Sem isto, uma pasta `app/routers/` ausente ou esvaziada por engano
        faria os dois testes a seguir passar vacuamente, por não terem
        lido ficheiro nenhum — "não encontrei nada de errado" a confundir-se
        com "não consegui procurar".
        """
        assert PASTA_ROUTERS.is_dir(), f"{PASTA_ROUTERS} não existe"
        ficheiros = sorted(PASTA_ROUTERS.glob("*.py"))
        assert ficheiros, f"{PASTA_ROUTERS} não tem ficheiros .py nenhuns"

    def test_nenhum_router_chama_registar_admin(self) -> None:
        """`registar_admin` é só para `scripts/criar_admin.py` chamar (F2-02).

        Uma rota HTTP que a chamasse seria exatamente a rota que o S-05
        proíbe — só que por um caminho indireto em vez de um
        `Admin(...)` à mão.
        """
        violacoes = []
        for ficheiro in sorted(PASTA_ROUTERS.glob("*.py")):
            arvore = ast.parse(
                ficheiro.read_text(encoding="utf-8"), filename=str(ficheiro)
            )
            if _contem_chamada_a_registar_admin(arvore):
                violacoes.append(ficheiro.name)
        assert violacoes == [], (
            f"{violacoes} referem `registar_admin` — só "
            "`scripts/criar_admin.py` pode chamar isto (S-05)"
        )

    def test_nenhum_router_constroi_admin(self) -> None:
        """Nenhuma rota HTTP escreve uma linha nova em `admins` à mão."""
        violacoes = []
        for ficheiro in sorted(PASTA_ROUTERS.glob("*.py")):
            arvore = ast.parse(
                ficheiro.read_text(encoding="utf-8"), filename=str(ficheiro)
            )
            if _contem_construcao_de_admin(arvore):
                violacoes.append(ficheiro.name)
        assert violacoes == [], (
            f"{violacoes} constroem `Admin(...)` — isso é criar uma conta "
            "de admin a partir de uma rota HTTP, exatamente o que o S-05 proíbe"
        )


# --- Camada 3: OpenAPI -------------------------------------------------------


def _resolver(esquema: dict[str, Any], componentes: dict[str, Any]) -> dict[str, Any]:
    ref = esquema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        nome = ref.rsplit("/", 1)[-1]
        return componentes.get(nome, {})  # type: ignore[no-any-return]
    return esquema


def _nomes_de_propriedades(
    esquema: dict[str, Any], componentes: dict[str, Any], vistos: set[int] | None = None
) -> set[str]:
    """Todos os nomes de `properties`, descendo por `$ref`/`allOf`/`anyOf`/`oneOf`.

    `vistos` guarda os `id()` dos dicionários já percorridos, para um
    esquema recursivo (um `$ref` que aponte, direta ou indiretamente, para
    si próprio) não entrar em ciclo infinito.
    """
    if vistos is None:
        vistos = set()
    esquema = _resolver(esquema, componentes)
    if id(esquema) in vistos:
        return set()
    vistos = vistos | {id(esquema)}

    nomes: set[str] = set()
    propriedades = esquema.get("properties")
    if isinstance(propriedades, dict):
        nomes |= set(propriedades)
        for sub in propriedades.values():
            if isinstance(sub, dict):
                nomes |= _nomes_de_propriedades(sub, componentes, vistos)
    for chave in ("allOf", "anyOf", "oneOf"):
        for sub in esquema.get(chave, []) or []:
            if isinstance(sub, dict):
                nomes |= _nomes_de_propriedades(sub, componentes, vistos)
    itens = esquema.get("items")
    if isinstance(itens, dict):
        nomes |= _nomes_de_propriedades(itens, componentes, vistos)
    return nomes


class TestCamada3OpenAPI:
    def test_so_o_login_tem_propriedades_com_password_no_corpo_do_pedido(
        self,
    ) -> None:
        """Mapa exato, por caminho, de todas as propriedades cujo nome **contém** "password".

        Antes comparava-se `"password" in nomes`, e um `nova_password` ou
        `password_nova` (da mudança de password da F2-05c) passava a
        olhar-se como "não é password". Agora: contém, e por caminho.
        """
        from app.main import criar_app

        esquema = criar_app().openapi()
        componentes = esquema.get("components", {}).get("schemas", {})

        encontrados: dict[str, set[str]] = {}
        for caminho, item in esquema.get("paths", {}).items():
            for operacao in item.values():
                if not isinstance(operacao, dict):
                    continue
                corpo = operacao.get("requestBody")
                if not isinstance(corpo, dict):
                    continue
                for conteudo in corpo.get("content", {}).values():
                    sub_esquema = conteudo.get("schema")
                    if not isinstance(sub_esquema, dict):
                        continue
                    nomes = {
                        nome
                        for nome in _nomes_de_propriedades(sub_esquema, componentes)
                        if "password" in nome.lower()
                    }
                    if nomes:
                        encontrados.setdefault(caminho, set()).update(nomes)

        # F2-05c: a mudança de password (`/gestao/conta/password`, exige a
        # atual, nunca recebe um `utilizador`) e o WiFi (`wifi_password`,
        # que não é a password de nenhum admin).
        assert encontrados == {
            "/auth/login": {"password"},
            "/gestao/conta/password": {"password_atual", "password_nova"},
            "/gestao/definicoes": {"wifi_password"},
        }, f"propriedades com `password` por caminho: {encontrados}"

    def test_hash_password_nunca_aparece_num_esquema(self) -> None:
        """Nem à entrada nem à saída: `hash_password` não é um campo de API."""
        from app.main import criar_app

        esquema = criar_app().openapi()
        componentes = esquema.get("components", {}).get("schemas", {})

        todos_os_nomes: set[str] = set()
        for definicao in componentes.values():
            todos_os_nomes |= _nomes_de_propriedades(definicao, componentes)

        assert "hash_password" not in todos_os_nomes, (
            "`hash_password` aparece nalgum esquema do OpenAPI — isso é "
            "publicar (ou aceitar) um hash de password por HTTP"
        )


# --- Camada 4: comportamental ------------------------------------------------


def _para_cada_rota_e_metodo(aplicacao: Any) -> list[tuple[str, str]]:
    import re

    casos = []
    for caminho, metodos in sorted(rotas_declaradas(aplicacao).items()):
        caminho_concreto = re.sub(r"\{[^}]+\}", "1", caminho)
        for metodo in sorted(metodos):
            casos.append((caminho_concreto, metodo))
    return casos


class TestCamada4Comportamental:
    def test_nenhum_pedido_sem_sessao_cria_um_admin(
        self, cliente: Any, sessao: Any
    ) -> None:
        """A única camada que não depende de nomes: lê só o efeito na BD.

        Para cada rota declarada × cada método, um pedido sem cookie de
        sessão — `X-Tomazia` incluído, para as mutações não ficarem
        presas no 403 do guarda em vez de chegarem à lógica da rota — e a
        contagem de `admins` tem de ser a mesma no fim de todos.
        """
        from sqlalchemy import text

        from app.main import criar_app

        antes = sessao.execute(text("SELECT COUNT(*) FROM admins")).scalar_one()

        for caminho, metodo in _para_cada_rota_e_metodo(criar_app()):
            cabecalhos = CABECALHO_MUTACAO if metodo != "GET" else {}
            resposta = getattr(cliente, metodo.lower())(caminho, headers=cabecalhos)
            depois = sessao.execute(text("SELECT COUNT(*) FROM admins")).scalar_one()
            assert depois == antes, (
                f"{metodo} {caminho} (sem sessão, estado {resposta.status_code}) "
                f"mudou `admins`: {antes} -> {depois}"
            )
