"""A migração inicial do Alembic (F2-01).

Critério literal da tarefa: `alembic upgrade head` cria a base de dados do
zero. Isso não se prova dentro do processo de testes — prova-se a correr o
comando, num subprocesso, contra um ficheiro que ainda não existe. É o
mesmo comando que o `deploy/deploy.sh` corre no servidor, e no servidor não
há nenhum `Base.metadata.create_all` a tapar buracos.

Nos testes que correm o Alembic, a regra 10 do `CLAUDE.md` aplica-se com
força: o código de saída verifica-se à mão e o `stdout`/`stderr` entra na
mensagem da asserção. Sem isso, "o alembic rebentou a importar `app.models`"
e "o alembic correu e o esquema está errado" dariam a mesma linha vermelha.

## As três redes deste ficheiro, e porque são três

O `alembic check` sozinho **não** chega, e isso foi medido: com o
`CHECK (preco_cent >= 0)` apagado da migração, ele sai com 0. O
`compare_metadata` que ele usa vê uma `UNIQUE` em falta e um `ondelete`
trocado, mas não vê `CHECK` constraints nem `server_default`.

1. `test_modelos_e_migracao_nao_divergem` — o `alembic check`. Apanha
   colunas e tabelas.
2. `test_o_esquema_da_migracao_e_o_dos_modelos_sao_o_mesmo` — compara os
   dois esquemas construídos a sério, campo a campo. Apanha o que o
   `alembic check` não vê, incluindo tipos e nulidades que nenhum teste de
   comportamento toca.
3. `test_as_restricoes_da_bd_sao_exatamente_estas` e
   `test_os_valores_por_omissao_da_bd_sao_exatamente_estes` — conjuntos
   literais. São a rede que apanha uma remoção feita **dos dois lados** ao
   mesmo tempo, que é o único caso que a segunda rede deixaria passar.

E, por fim, a bateria de comportamento de `tests/modelos/` corre contra os
dois esquemas (ver `tests/modelos/conftest.py`).
"""

from __future__ import annotations

import ast
import sqlite3
from pathlib import Path

from tests import apoio_esquema
from tests.apoio_esquema import RAIZ_BACKEND, correr_alembic, relatorio

#: As sete tabelas da secção "Modelo de dados" de `docs/ESPECIFICACAO.md`,
#: mais `tentativas_de_envio` (F2-06: sustenta o limite de 5 fotos por
#: hora por IP, contando tentativas — ver `app/models/limites.py`).
TABELAS_ESPERADAS = frozenset(
    {
        "categorias",
        "produtos",
        "eventos",
        "fotos",
        "clientes",
        "admins",
        "definicoes",
        "tentativas_de_envio",
    }
)

#: Prefixos da convenção de nomes de `Base.metadata`.
PREFIXOS_DA_CONVENCAO = ("pk_", "fk_", "uq_", "ck_", "ix_")

#: Nome fixado pelo ADR 0009, citado lá textualmente.
RESTRICAO_PUBLICADO_EXIGE_INICIO = "ck_eventos_publicado_exige_inicio"

#: **O conjunto exato** de restrições nomeadas que a base de dados tem de
#: ter. Exato, e não "todas seguem a convenção": um teste que só verifique
#: os prefixos aprova uma base de dados a que alguém tirou um `CHECK`
#: inteiro, porque o que sobra continua a seguir a convenção. Apanha a
#: remoção, não só a renomeação.
#:
#: Pela regra 7 do `CLAUDE.md`, acrescentar ou tirar uma restrição a uma
#: tabela que já existe obriga a reconstruí-la. Quem mexer nesta lista está
#: a mexer na única coisa que não se corrige num deploy a seguir — e tem de
#: trazer um ADR, como o 0009 trouxe.
RESTRICOES_ESPERADAS = frozenset(
    {
        # chaves primárias, uma por tabela
        "pk_admins",
        "pk_categorias",
        "pk_clientes",
        "pk_definicoes",
        "pk_eventos",
        "pk_fotos",
        "pk_produtos",
        "pk_tentativas_de_envio",
        # unicidades
        "uq_admins_utilizador",
        "uq_categorias_slug",
        "uq_clientes_email",
        "uq_clientes_token_cancelar",
        "uq_fotos_ficheiro",
        # chave estrangeira
        "fk_produtos_categoria_id_categorias",
        # restrições de valor
        "ck_clientes_token_cancelar_tamanho_minimo",
        "ck_eventos_imagem_sem_caminho",
        RESTRICAO_PUBLICADO_EXIGE_INICIO,
        "ck_fotos_estadofoto",
        "ck_fotos_ficheiro_sem_caminho",
        "ck_produtos_preco_cent_nao_negativo",
    }
)

#: **O conjunto exato** de valores por omissão do DDL, por `tabela.coluna`.
#: O `compare_metadata` do `alembic check` não compara `server_default`
#: nenhum; sem esta lista, um `server_default` desaparecido da migração só
#: se notava quando o `importar_bd_antiga.py` da F2-08 rebentasse no
#: servidor com `NOT NULL constraint failed`.
#:
#: Lidos de `PRAGMA table_info`, que normaliza o `DEFAULT (CURRENT_TIMESTAMP)`
#: do Alembic e o `DEFAULT CURRENT_TIMESTAMP` do `create_all` para o mesmo
#: texto.
OMISSOES_ESPERADAS = {
    "admins.criado_em": "CURRENT_TIMESTAMP",
    "admins.sessao_versao": "0",
    "admins.tentativas_falhadas": "0",
    "categorias.ordem": "0",
    "categorias.visivel": "1",
    "clientes.criado_em": "CURRENT_TIMESTAMP",
    "eventos.publicado": "0",
    "fotos.criada_em": "CURRENT_TIMESTAMP",
    "produtos.disponivel": "1",
    "produtos.ordem": "0",
    "tentativas_de_envio.criada_em": "CURRENT_TIMESTAMP",
}


def _caminho_de_bd_inexistente(tmp_path: Path, nome: str = "tomazia.db") -> Path:
    pasta = tmp_path / "dados-do-servidor"
    pasta.mkdir(parents=True, exist_ok=True)
    base_dados = pasta / nome
    assert not base_dados.exists()
    return base_dados


def test_upgrade_head_cria_a_bd_do_zero(tmp_path: Path) -> None:
    """T5, o critério literal da tarefa: ficheiro inexistente → as tabelas esperadas."""
    base_dados = _caminho_de_bd_inexistente(tmp_path)

    resultado = correr_alembic("upgrade", "head", base_dados=base_dados)

    assert resultado.returncode == 0, relatorio("alembic upgrade head", resultado)
    assert base_dados.exists(), relatorio(
        "alembic upgrade head saiu com 0 mas não deixou ficheiro nenhum",
        resultado,
    )

    tabelas = apoio_esquema.tabelas_de_negocio(base_dados)

    assert tabelas == set(TABELAS_ESPERADAS), (
        f"tabelas criadas: {sorted(tabelas)}\n"
        f"esperadas: {sorted(TABELAS_ESPERADAS)}\n"
        f"a faltar: {sorted(TABELAS_ESPERADAS - tabelas)}\n"
        f"a mais: {sorted(tabelas - TABELAS_ESPERADAS)}"
    )


def test_a_bd_criada_pelo_alembic_fica_em_wal(tmp_path: Path) -> None:
    """T6: o ficheiro criado pelo Alembic já está em WAL.

    Lido com o `sqlite3` puro, sem SQLAlchemy nenhum pelo meio: se a leitura
    passasse por `criar_engine`, seria a própria leitura a pôr a base de
    dados em WAL e o teste provaria apenas que sabe ligar o modo.

    É a prova para o `alembic upgrade head` do `deploy/deploy.sh`, que é
    quem cria a base de dados no servidor. Se `migrations/env.py` abrir o
    motor por fora da fábrica de `app/db.py` (ver o teste seguinte), a base
    de dados nasce em `delete` e só um reinício com a aplicação a abri-la
    pela fábrica a corrigiria — se alguém reparasse.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)

    resultado = correr_alembic("upgrade", "head", base_dados=base_dados)
    assert resultado.returncode == 0, relatorio("alembic upgrade head", resultado)

    ligacao = sqlite3.connect(base_dados)
    try:
        modo = ligacao.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        ligacao.close()

    assert modo == "wal", (
        f"a base de dados criada pelo Alembic ficou em journal_mode="
        f"'{modo}'. É o estado em que o servidor ficaria depois de um "
        "deploy que corre `alembic upgrade head` numa base de dados nova"
    )


def _nomes_chamados(arvore: ast.AST) -> set[str]:
    """Nomes de tudo o que é chamado na árvore, incluindo chamadas a atributos."""
    nomes: set[str] = set()
    for no in ast.walk(arvore):
        if not isinstance(no, ast.Call):
            continue
        alvo = no.func
        if isinstance(alvo, ast.Name):
            nomes.add(alvo.id)
        elif isinstance(alvo, ast.Attribute):
            nomes.add(alvo.attr)
    return nomes


def _nomes_importados(arvore: ast.AST) -> set[str]:
    nomes: set[str] = set()
    for no in ast.walk(arvore):
        if isinstance(no, ast.Import | ast.ImportFrom):
            nomes.update(alias.asname or alias.name for alias in no.names)
    return nomes


def test_helper_distingue_as_duas_fabricas_de_motor() -> None:
    """Prova, sozinho, que o guarda sintático abaixo tem conteúdo.

    Um `_nomes_chamados` que devolvesse sempre `set()` deixaria o teste
    seguinte verde com qualquer `env.py` — o guarda passaria a aprovar tudo
    em silêncio. Estes três casos fixam que o helper vê as duas fábricas e
    não as confunde uma com a outra.
    """
    assert _nomes_chamados(ast.parse("engine_from_config(seccao)")) == {
        "engine_from_config"
    }
    assert _nomes_chamados(ast.parse("criar_engine(url)")) == {"criar_engine"}
    assert _nomes_chamados(ast.parse("app.db.criar_engine(url)")) == {"criar_engine"}
    assert "criar_engine" not in _nomes_chamados(ast.parse("engine_from_config(x)"))
    assert _nomes_importados(
        ast.parse("from sqlalchemy import engine_from_config")
    ) == {"engine_from_config"}


def test_env_py_nao_constroi_motores_fora_da_fabrica() -> None:
    """T7: `migrations/env.py` usa `criar_engine`, nunca `engine_from_config`.

    Guarda sintático, pela mesma técnica de
    `tests/seguranca/test_arranque_passenger.py`: percorre a árvore do
    ficheiro em vez de o importar (importar `env.py` corre migrações).

    O motivo é o teste anterior. Os PRAGMAs vivem todos no evento `connect`
    da fábrica de `app/db.py`; um motor construído pelo Alembic com
    `engine_from_config` nunca passa por lá, e a base de dados que o
    servidor cria no deploy nasce sem WAL e com as chaves estrangeiras
    desligadas — incluindo durante as próprias migrações de dados.
    """
    caminho = RAIZ_BACKEND / "migrations" / "env.py"
    arvore = ast.parse(caminho.read_text(encoding="utf-8"), filename=str(caminho))

    chamadas = _nomes_chamados(arvore)
    importados = _nomes_importados(arvore)

    assert "criar_engine" in chamadas, (
        "migrations/env.py tem de construir o motor com `criar_engine` de "
        "`app.db`: é o único sítio onde os três PRAGMAs são aplicados"
    )
    assert "engine_from_config" not in chamadas, (
        "migrations/env.py chama `engine_from_config`: esse motor não passa "
        "pelo evento `connect` de `app/db.py` e abre a base de dados sem "
        "WAL e sem `foreign_keys`"
    )
    assert "engine_from_config" not in importados, (
        "migrations/env.py ainda importa `engine_from_config`; mesmo sem o "
        "chamar hoje, deixa a porta aberta para o próximo a reintroduzir"
    )
    assert "create_engine" not in chamadas, (
        "migrations/env.py chama `create_engine` diretamente, contornando "
        "a fábrica de `app/db.py` pelo mesmo efeito"
    )


def test_modelos_e_migracao_nao_divergem(tmp_path: Path) -> None:
    """T8: `alembic check` não encontra operações pendentes.

    Prende as duas metades uma à outra: a migração escrita à mão e os
    modelos de `app/models/`. Sem isto, um `Column` acrescentado a um modelo
    e esquecido na migração passa despercebido até ao servidor — onde só a
    migração corre.

    **Não chega sozinho**, e o limite está medido: o `compare_metadata` que
    este comando usa não compara `CHECK` constraints nem `server_default`.
    Com o `CHECK (preco_cent >= 0)` apagado da migração, este teste fica
    verde. Quem fecha esse buraco é
    `test_o_esquema_da_migracao_e_o_dos_modelos_sao_o_mesmo`, os dois
    conjuntos literais abaixo, e a parametrização de `tests/modelos/`.

    A verificação das tabelas esperadas antes do `alembic check` não é
    redundante com o T5: é o que impede este teste de passar por vazio.
    Sem nenhuma migração e sem nenhum modelo, `Base.metadata` e a base de
    dados também "não divergem", e o `alembic check` sai com 0 — que foi
    exatamente o que se mediu com o repositório no estado em que a F2-01
    começou.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)

    subida = correr_alembic("upgrade", "head", base_dados=base_dados)
    assert subida.returncode == 0, relatorio("alembic upgrade head", subida)

    tabelas = apoio_esquema.tabelas_de_negocio(base_dados)
    assert tabelas == set(TABELAS_ESPERADAS), (
        "não há nada para comparar: a base de dados em head tem "
        f"{sorted(tabelas)} em vez das {len(TABELAS_ESPERADAS)} tabelas "
        "esperadas. Um `alembic check` sobre um esquema vazio passa sempre"
    )

    verificacao = correr_alembic("check", base_dados=base_dados)

    assert verificacao.returncode == 0, relatorio("alembic check", verificacao)


def test_o_esquema_da_migracao_e_o_dos_modelos_sao_o_mesmo(tmp_path: Path) -> None:
    """Os dois esquemas, construídos a sério, comparados campo a campo.

    Esta é a rede que o `alembic check` não é. Constrói uma base de dados
    com `alembic upgrade head` e outra com `Base.metadata.create_all`, e
    compara colunas (tipo, nulidade, omissão, chave primária), restrições
    nomeadas, chaves estrangeiras com o `ON DELETE` e índices. Apanha o que
    o `compare_metadata` não olha — `CHECK`, `server_default` — e também
    aquilo para que nunca vai haver um teste de comportamento, como um
    `telemovel` que ficasse `NOT NULL` só de um dos lados.

    A comparação é entre conjuntos e dicionários, nunca entre texto: o
    Alembic escreve as restrições por ordem alfabética do nome e o
    `create_all` escreve-as pela ordem de declaração no modelo. A ordem não
    é contrato nenhum.
    """
    from app.db import Base, criar_engine
    from app.models import (  # noqa: F401 - o import é o efeito que queremos
        admins,
        clientes,
        definicoes,
        ementa,
        eventos,
        fotos,
        limites,
    )

    pela_migracao = _caminho_de_bd_inexistente(tmp_path, "pela-migracao.db")
    apoio_esquema.construir_bd_com_alembic(pela_migracao)

    pelos_modelos = _caminho_de_bd_inexistente(tmp_path, "pelos-modelos.db")
    motor = criar_engine(f"sqlite:///{pelos_modelos}")
    try:
        Base.metadata.create_all(motor)
    finally:
        motor.dispose()

    esquema_migracao = apoio_esquema.esquema_normalizado(pela_migracao)
    esquema_modelos = apoio_esquema.esquema_normalizado(pelos_modelos)

    # Chave a chave, para a mensagem de falha dizer *o quê* divergiu em vez
    # de despejar os dois esquemas inteiros lado a lado.
    for aspeto in esquema_migracao:
        assert esquema_migracao[aspeto] == esquema_modelos[aspeto], (
            f"o esquema da migração e o dos modelos divergem em {aspeto!r}.\n"
            f"pela migração: {esquema_migracao[aspeto]!r}\n"
            f"pelos modelos: {esquema_modelos[aspeto]!r}\n"
            "O `alembic check` não apanha isto: o compare_metadata não "
            "compara CHECK constraints nem server_default."
        )


def test_as_restricoes_da_bd_sao_exatamente_estas(tmp_path: Path) -> None:
    """O conjunto exato de restrições nomeadas, não só "seguem a convenção".

    Exigir só os prefixos aprovava uma base de dados a que alguém tivesse
    tirado um `CHECK` inteiro: o que sobra continua a seguir a convenção.
    Esta é a rede que apanha a **remoção**, e a única que continua a apanhá-la
    quando a restrição desaparece dos dois lados ao mesmo tempo — caso em
    que o `alembic check` e a comparação dos dois esquemas concordam os
    dois que está tudo bem.

    A convenção de nomes continua a ser verificada, porque o ADR 0009
    depende dela: o SQLite devolve o nome na mensagem de erro
    (`CHECK constraint failed: ck_eventos_publicado_exige_inicio`) e é ele
    que permite à F2-05 responder em PT-PT junto do campo certo.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)
    apoio_esquema.construir_bd_com_alembic(base_dados)

    nomes = apoio_esquema.nomes_de_restricoes(base_dados)

    assert nomes == set(RESTRICOES_ESPERADAS), (
        f"a faltar na base de dados: {sorted(RESTRICOES_ESPERADAS - nomes)}\n"
        f"a mais na base de dados: {sorted(nomes - RESTRICOES_ESPERADAS)}\n"
        "Tirar uma restrição a uma tabela que já existe obriga a "
        "reconstruí-la (regra 7): se é mesmo para mudar, traz um ADR."
    )

    fora_da_convencao = sorted(
        nome for nome in nomes if not nome.startswith(PREFIXOS_DA_CONVENCAO)
    )
    assert not fora_da_convencao, (
        f"restrições com nomes fora da convenção {PREFIXOS_DA_CONVENCAO}: "
        f"{fora_da_convencao}"
    )


def test_os_valores_por_omissao_da_bd_sao_exatamente_estes(tmp_path: Path) -> None:
    """O conjunto exato de `DEFAULT` no DDL, por `tabela.coluna`.

    O `compare_metadata` do `alembic check` não compara `server_default`
    nenhum (`compare_server_default` é `False` por omissão, e nem sequer é
    fiável em SQLite). Sem este teste, um `server_default` desaparecido da
    migração só se notava no servidor, quando o `importar_bd_antiga.py` da
    F2-08 — que escreve em SQL cru, sem ORM, e por isso não corre nenhum
    `default=` do lado do Python — rebentasse com
    `NOT NULL constraint failed`.

    Exato nos dois sentidos: também falha se aparecer um `DEFAULT` a mais.
    Um valor por omissão que ninguém decidiu é um valor que entra na base
    de dados sem ninguém o ter escrito.
    """
    base_dados = _caminho_de_bd_inexistente(tmp_path)
    apoio_esquema.construir_bd_com_alembic(base_dados)

    omissoes = apoio_esquema.valores_por_omissao(base_dados)

    assert omissoes == OMISSOES_ESPERADAS, (
        f"valores por omissão na base de dados: {omissoes}\n"
        f"esperados: {OMISSOES_ESPERADAS}"
    )
