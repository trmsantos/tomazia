"""Apoio para construir e inspecionar o esquema da base de dados nos testes.

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_subprocesso.py` não é. É usado por
`tests/test_migracao_inicial.py` e por `tests/modelos/conftest.py`.

Existe por causa de um buraco estrutural medido na bateria da F2-01: os
testes de comportamento construíam o esquema a partir dos **modelos**
(`Base.metadata.create_all`) e o servidor constrói-o a partir da
**migração** (`alembic upgrade head`, no `deploy/deploy.sh`). O
`alembic check` não fecha esse buraco — o `compare_metadata` que ele usa
**não compara `CHECK` constraints nem `server_default`**. Medido: com o
`CHECK (preco_cent >= 0)` apagado da migração, a bateria inteira (incluindo
o `alembic check`) ficava verde, e a base de dados de produção passava a
aceitar `preco_cent = -1` escrito em SQL cru pelo `importar_bd_antiga.py`
da F2-08.

E a regra 7 do `CLAUDE.md` faz da migração o único ficheiro que não se
corrige depois: um `CHECK` em falta só se acrescenta reconstruindo a tabela.

Daqui saem as duas peças que fecham o buraco:

- `construir_bd_com_alembic`, para a bateria de comportamento correr também
  contra o esquema que o servidor tem mesmo;
- `esquema_normalizado`, para comparar os dois esquemas campo a campo sem
  depender da ordem em que o SQLite escreveu o DDL.
"""

from __future__ import annotations

import re
import sqlite3
import subprocess
import sys
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent

#: Tabelas que não são nossas e não entram em comparação nenhuma.
TABELAS_INTERNAS = frozenset({"alembic_version"})

#: Os ficheiros que o SQLite põe ao lado da base de dados. `-wal` e `-shm`
#: em modo WAL, `-journal` no modo `delete`. Importam por duas razões: um
#: `-wal` por consolidar guarda transações que o ficheiro principal ainda
#: não tem, e um `-shm`/`-wal` deixado por **outra** base de dados em cima
#: do mesmo caminho faz o SQLite ler um estado que não é o do ficheiro que
#: lá está.
SUFIXOS_SIDECAR = ("-wal", "-shm", "-journal")


def sidecars_de(base_dados: Path) -> list[Path]:
    """Os caminhos dos sidecars de `base_dados` que existem neste momento."""
    return [
        caminho
        for caminho in (
            base_dados.with_name(base_dados.name + sufixo) for sufixo in SUFIXOS_SIDECAR
        )
        if caminho.exists()
    ]


def exigir_destino_sem_vestigios(destino: Path) -> None:
    """Rebenta se `destino` ou algum sidecar dele já existir.

    Chamado antes de copiar a base de dados-modelo para o caminho do teste.
    O `shutil.copyfile` substitui **só** o ficheiro principal: um `-wal` ou
    um `-shm` deixado lá por outra base de dados sobrevive à cópia, e o
    SQLite passa a ler um estado que não é o do ficheiro que acabámos de
    escrever — dados de um teste a aparecer no seguinte, sem nada no
    caminho a dizê-lo.

    Hoje nenhum caminho do projeto chega aqui com o destino ocupado (o
    `tmp_path` é novo por teste). Isto é a sonda que o diz em voz alta
    quando deixar de ser verdade: uma fixture futura que abra a base de
    dados **antes** da `motor`, por exemplo.
    """
    vestigios = ([destino] if destino.exists() else []) + sidecars_de(destino)
    if vestigios:
        raise RuntimeError(
            "o destino da cópia da base de dados-modelo já está ocupado: "
            f"{[str(caminho) for caminho in vestigios]}. O `copyfile` só "
            "substitui o ficheiro principal; um `-wal` ou `-shm` de outra "
            "base de dados sobrevive-lhe e passa estado de um teste para o "
            "seguinte. Quem abriu esta base de dados antes da fixture "
            "`motor`?"
        )


def ambiente_do_alembic(base_dados: Path) -> dict[str, str]:
    """Ambiente mínimo para o subprocesso, isolado do `backend/.env` real.

    Nunca se herda o ambiente de quem corre os testes: a `BASE_DADOS_URL`
    tem de ser a do teste, e o ficheiro de ambiente tem de apontar para um
    caminho inexistente, senão o do repositório decide qual é a base de
    dados que o Alembic abre.
    """
    return {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "PYTHONPATH": str(RAIZ_BACKEND),
        "AMBIENTE": "desenvolvimento",
        "BASE_DADOS_URL": f"sqlite:///{base_dados}",
        "TOMAZIA_ENV_FILE": str(
            base_dados.parent / "isolamento-de-testes-nao-existe" / ".env"
        ),
    }


def correr_alembic(
    *argumentos: str, base_dados: Path
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *argumentos],
        cwd=RAIZ_BACKEND,
        env=ambiente_do_alembic(base_dados),
        capture_output=True,
        text=True,
        timeout=120,
    )


def relatorio(rotulo: str, resultado: subprocess.CompletedProcess[str]) -> str:
    """Mensagem com tudo o que o subprocesso disse.

    Regra 10: um código de saída não-zero do Alembic tanto quer dizer
    "detetei diferenças" como "rebentei a importar". A mensagem traz o
    `stdout` e o `stderr` para que a diferença se veja sem reproduzir nada
    à mão.
    """
    return (
        f"{rotulo} terminou com código {resultado.returncode}\n"
        f"--- stdout ---\n{resultado.stdout}\n"
        f"--- stderr ---\n{resultado.stderr}"
    )


def construir_bd_com_alembic(destino: Path) -> Path:
    """Corre `alembic upgrade head` contra `destino` e devolve o caminho.

    Rebenta com o relatório completo do subprocesso se o comando falhar: é
    uma fixture a chamar isto, e uma fixture que devolva um ficheiro
    inexistente faz a bateria toda falhar com erros que não dizem nada
    sobre o que correu mal.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    resultado = correr_alembic("upgrade", "head", base_dados=destino)
    if resultado.returncode != 0:
        raise RuntimeError(relatorio("alembic upgrade head", resultado))
    if not destino.exists():
        raise RuntimeError(
            relatorio(
                "alembic upgrade head saiu com 0 mas não deixou ficheiro nenhum",
                resultado,
            )
        )

    # Um sidecar por consolidar quer dizer que há transações só no diário:
    # copiar o ficheiro principal sozinho perderia parte do esquema, em
    # silêncio. O subprocesso já fechou a ligação (saiu), e nessa altura o
    # SQLite consolida e apaga o `-wal` — mas isso é comportamento dele,
    # não garantia nossa, por isso verifica-se.
    sobras = [caminho for caminho in sidecars_de(destino) if caminho.stat().st_size > 0]
    if sobras:
        raise RuntimeError(
            f"ficaram diários por consolidar em {[str(c) for c in sobras]}: "
            f"copiar {destino.name} sozinho perderia parte do esquema"
        )

    # Só leitura, a partir daqui. Esta base de dados existe para ser
    # **copiada**, nunca aberta: a fixture `_bd_construida_pelo_alembic`
    # devolve este caminho a todos os testes da sessão, e qualquer escrita
    # nele — ou qualquer `criar_engine`, que força o WAL e deixa sidecars —
    # contaminaria todas as cópias seguintes. Com 0444, essa escrita passa
    # a ser um `attempt to write a readonly database` em voz alta (medido)
    # em vez de contaminação silenciosa.
    #
    # Não parte a cópia: o `shutil.copyfile` só **lê** a fonte, e cria o
    # destino com permissões novas (0644, medido). E não parte a limpeza
    # do `tmp_path`: apagar um ficheiro depende das permissões da pasta,
    # não das do ficheiro.
    destino.chmod(0o444)
    return destino


def _ligar(base_dados: Path) -> sqlite3.Connection:
    """Ligação crua do `sqlite3`, sem SQLAlchemy nem PRAGMAs nossos pelo meio."""
    return sqlite3.connect(base_dados)


def tabelas_de_negocio(base_dados: Path) -> set[str]:
    """Tabelas em `sqlite_master`, sem as internas do SQLite nem a do Alembic."""
    ligacao = _ligar(base_dados)
    try:
        nomes = {
            linha[0]
            for linha in ligacao.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    finally:
        ligacao.close()
    return {
        nome
        for nome in nomes
        if not nome.startswith("sqlite_") and nome not in TABELAS_INTERNAS
    }


def ddl_das_tabelas(base_dados: Path) -> dict[str, str]:
    """O `CREATE TABLE` de cada tabela de negócio, tal como o SQLite o guardou."""
    ligacao = _ligar(base_dados)
    try:
        return {
            nome: ddl
            for nome, ddl in ligacao.execute(
                "SELECT name, sql FROM sqlite_master "
                "WHERE type = 'table' AND sql IS NOT NULL"
            )
            if not nome.startswith("sqlite_") and nome not in TABELAS_INTERNAS
        }
    finally:
        ligacao.close()


def _partes_do_corpo(ddl: str) -> list[str]:
    """Parte o corpo de um `CREATE TABLE` nos seus itens, respeitando parênteses.

    Um `split(",")` ingénuo partia a meio de
    `CHECK (instr(imagem, '/') = 0 ...)` — a vírgula lá dentro é argumento
    de uma função, não um separador de itens. Esta versão conta a
    profundidade dos parênteses e ignora o que está dentro de aspas.
    """
    inicio = ddl.index("(")
    fim = ddl.rindex(")")
    corpo = ddl[inicio + 1 : fim]

    partes: list[str] = []
    atual: list[str] = []
    profundidade = 0
    em_texto = False

    for caractere in corpo:
        if caractere == "'":
            em_texto = not em_texto
        elif not em_texto:
            if caractere == "(":
                profundidade += 1
            elif caractere == ")":
                profundidade -= 1
            elif caractere == "," and profundidade == 0:
                partes.append("".join(atual))
                atual = []
                continue
        atual.append(caractere)

    partes.append("".join(atual))
    return [re.sub(r"\s+", " ", parte).strip() for parte in partes if parte.strip()]


def restricoes_nomeadas(base_dados: Path) -> dict[str, frozenset[str]]:
    """Por tabela, o conjunto dos itens `CONSTRAINT ...` do `CREATE TABLE`.

    Conjunto e não lista de propósito: o Alembic escreve as restrições por
    ordem alfabética do nome e o `create_all` escreve-as pela ordem em que
    estão declaradas no modelo. A ordem não é contrato nenhum; o conteúdo é.
    """
    return {
        tabela: frozenset(
            parte for parte in _partes_do_corpo(ddl) if parte.startswith("CONSTRAINT ")
        )
        for tabela, ddl in ddl_das_tabelas(base_dados).items()
    }


def nomes_de_restricoes(base_dados: Path) -> set[str]:
    """Os nomes de todas as restrições nomeadas, em todas as tabelas de negócio."""
    nomes: set[str] = set()
    for restricoes in restricoes_nomeadas(base_dados).values():
        for parte in restricoes:
            correspondencia = re.match(r'CONSTRAINT\s+"?([A-Za-z0-9_]+)"?', parte)
            if correspondencia is not None:
                nomes.add(correspondencia.group(1))
    return nomes


def colunas(base_dados: Path) -> dict[str, tuple[str, int, str | None, int]]:
    """Por `tabela.coluna`, o tuplo `(tipo, not_null, default, pk)`.

    Vem de `PRAGMA table_info`, não do texto do DDL: o PRAGMA já normaliza
    o `DEFAULT (CURRENT_TIMESTAMP)` que o Alembic escreve e o
    `DEFAULT CURRENT_TIMESTAMP` que o `create_all` escreve para o mesmo
    `'CURRENT_TIMESTAMP'`, que é o que de facto interessa comparar.
    """
    ligacao = _ligar(base_dados)
    try:
        resultado: dict[str, tuple[str, int, str | None, int]] = {}
        for tabela in sorted(tabelas_de_negocio(base_dados)):
            for _, nome, tipo, nao_nulo, omissao, chave in ligacao.execute(
                f"PRAGMA table_info({tabela})"
            ):
                resultado[f"{tabela}.{nome}"] = (tipo, nao_nulo, omissao, chave)
        return resultado
    finally:
        ligacao.close()


def valores_por_omissao(base_dados: Path) -> dict[str, str]:
    """Por `tabela.coluna`, o `DEFAULT` do DDL — só as colunas que têm um."""
    return {
        nome: omissao
        for nome, (_, _, omissao, _) in colunas(base_dados).items()
        if omissao is not None
    }


def chaves_estrangeiras(base_dados: Path) -> set[tuple[str, str, str, str, str]]:
    """`(tabela, coluna, tabela_referida, coluna_referida, on_delete)` de cada FK.

    `PRAGMA foreign_key_list` devolve o `ON DELETE` já interpretado, que é o
    que apanha um `RESTRICT` trocado por `CASCADE` ou `SET NULL` na migração
    sem que nenhum teste de comportamento tenha de existir para essa tabela.
    """
    ligacao = _ligar(base_dados)
    try:
        resultado: set[tuple[str, str, str, str, str]] = set()
        for tabela in sorted(tabelas_de_negocio(base_dados)):
            for linha in ligacao.execute(f"PRAGMA foreign_key_list({tabela})"):
                _, _, referida, coluna, coluna_referida, _, ao_apagar, _ = linha
                resultado.add((tabela, coluna, referida, coluna_referida, ao_apagar))
        return resultado
    finally:
        ligacao.close()


#: Um índice comparável: `(nome, tabela, único, parcial, colunas por ordem)`.
DescricaoDeIndice = tuple[str, str, int, int, tuple[str, ...]]


def indices(base_dados: Path) -> set[DescricaoDeIndice]:
    """Os índices criados por nós, com as colunas, a unicidade e o `WHERE`.

    Comparar só `(nome, tabela)` não chegava, e isso foi medido: trocada a
    coluna de `ix_produtos_categoria_id` e tornado `UNIQUE`, mantendo o
    nome, a comparação de esquemas passava. Um índice é o que indexa, não
    como se chama — e a partir da F2-03 e da F2-05 aparecem índices em
    `eventos.inicio` e `fotos.estado`, e qualquer `UniqueConstraint` que
    passe a `UNIQUE INDEX` sai da comparação do DDL e entra aqui.

    Os `sqlite_autoindex_*` ficam de fora: o SQLite cria-os sozinho para
    cada `UNIQUE` e numera-os pela ordem em que aparecem no DDL, por isso o
    nome muda com a ordem das restrições sem nada ter mudado. O que eles
    representam já está comparado em `restricoes_nomeadas`.

    **O que isto ainda não compara: a collation.** Nem a do índice
    (`CREATE INDEX ... COLLATE NOCASE`) nem a da coluna
    (`CREATE TABLE ... COLLATE NOCASE`) — o `PRAGMA index_info` não a dá e
    o `PRAGMA table_info` também não. Hoje não há nenhuma no esquema, por
    isso não é um buraco aberto; passa a ser um quando a F2-07 acrescentar
    o índice `COLLATE NOCASE` do email dos clientes, e nessa altura a
    correção é trocar `index_info` por `index_xinfo`, que traz a collation
    numa coluna `coll`.

    Uma coluna a `None` quer dizer um índice sobre uma expressão, não sobre
    uma coluna; fica como `"<expressão>"` para a comparação não a confundir
    com uma coluna chamada "None".
    """
    ligacao = _ligar(base_dados)
    try:
        resultado: set[DescricaoDeIndice] = set()
        for tabela in sorted(tabelas_de_negocio(base_dados)):
            for _, nome, unico, _origem, parcial in ligacao.execute(
                f"PRAGMA index_list({tabela})"
            ):
                if nome.startswith("sqlite_autoindex_"):
                    continue
                colunas_do_indice = tuple(
                    coluna if coluna is not None else "<expressão>"
                    for _, _, coluna in ligacao.execute(f'PRAGMA index_info("{nome}")')
                )
                resultado.add((nome, tabela, unico, parcial, colunas_do_indice))
        return resultado
    finally:
        ligacao.close()


def esquema_normalizado(base_dados: Path) -> dict[str, object]:
    """Tudo o que se compara entre dois esquemas, numa estrutura comparável.

    Colunas (tipo, nulidade, omissão, chave primária), restrições nomeadas,
    chaves estrangeiras com o `ON DELETE`, e índices nossos (nome, tabela,
    unicidade, parcialidade e colunas por ordem). Tudo em conjuntos e
    dicionários, para a comparação não depender da ordem em que o DDL foi
    escrito.

    O que **não** entra aqui, escrito para não se descobrir por acidente: a
    collation, de coluna ou de índice (ver `indices`), e o `ON UPDATE` das
    chaves estrangeiras, que o projeto não usa em lado nenhum.
    """
    return {
        "tabelas": tabelas_de_negocio(base_dados),
        "colunas": colunas(base_dados),
        "restricoes": restricoes_nomeadas(base_dados),
        "chaves_estrangeiras": chaves_estrangeiras(base_dados),
        "indices": indices(base_dados),
    }
