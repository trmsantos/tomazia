"""F2-08: o que `scripts/importar_bd_antiga.py` tem de fazer com a BD antiga.

A base de dados real do site antigo **nunca** entra neste repositório e
nunca é lida. O que estes testes usam é a base de dados falsa de
`tests/apoio_legado.py`, construída em `tmp_path` a partir do esquema
documentado em `docs/legado/esquema-bd-antiga.sql` — lido do disco, não
copiado para dentro do teste.

O contrato do script (argumentos, destino e `MEDIA_DIR` pela configuração,
estado de saída, forma do relatório) está escrito no docstring de
`tests/apoio_legado.py`. É de lá que estes testes o leem; é lá que se muda,
de propósito, se tiver de mudar. As decisões de fundo estão no ADR 0014 (a
chave é o id do site antigo, e a importação só insere), no ADR 0009 (data
obrigatória para publicar) e no ADR 0010 (o dia do bar é o dia de Lisboa).

O que **não** está aqui, e está noutro sítio:

- "a origem fica intacta" e "os dados pessoais não saem de lá" estão em
  `tests/seguranca/test_importador_nao_le_dados_pessoais.py` (regra 5 do
  `CLAUDE.md`);
- o esquema do destino (os `CHECK`, os `NOT NULL`, os `server_default` que
  um `INSERT` em SQL cru precisa) está em `tests/test_migracao_inicial.py`
  e em `tests/modelos/`.

Cada teste diz, no docstring, **o que deixa passar**. É requisito desta
casa, e tem razão de ser: um guarda que verifica o mecanismo e não o
resultado fica verde contra a implementação errada.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

import pytest

from tests.apoio_esquema import SUFIXOS_SIDECAR
from tests.apoio_legado import (
    A_CORRER_COMO_ROOT,
    BYTES_DA_IMAGEM_FALSA,
    CATEGORIAS_ESPERADAS,
    CENARIOS_DE_RECUSA,
    EVENTOS,
    EVENTOS_ESPERADOS,
    IMAGEM_DE_INVERNO,
    IMAGEM_DE_VERAO,
    INICIO_DA_MUDANCA_DE_MARCO_UTC,
    INICIO_DA_MUDANCA_DE_OUTUBRO_UTC,
    INICIO_DE_INVERNO_UTC,
    INICIO_DE_VERAO_UTC,
    PRODUTOS,
    PRODUTOS_ESPERADOS,
    TIPOS_ANTIGOS,
    VERSAO_INVENTADA,
    CenarioDeRecusa,
    CenarioImportado,
    EventoAntigo,
    EventoEsperado,
    ProdutoAntigo,
    ProdutoEsperado,
    RecusaCorrida,
    ResultadoDaImportacao,
    construir_bd_antiga_falsa,
    contagens,
    copiar_destino_em_head,
    correr_cenario_de_recusa,
    correr_importador,
    criar_pasta_de_imagens,
    despejo,
    ficheiros_em,
    frase_da_recusa,
    impressao_digital,
    ler_categorias,
    ler_esquema_legado,
    ler_eventos,
    ler_eventos_como_esperados,
    ler_ordem_e_disponivel,
    ler_produtos,
    tipos_documentados_no_esquema,
)

CAMINHO_DO_APOIO = Path(__file__).resolve().parent / "apoio_legado.py"

#: Um `CREATE` de tabela ou de índice, em qualquer caixa. A própria cadeia
#: deste padrão não se encontra a si mesma — `\s+` é um `\`, um `s` e um
#: `+`, não um espaço —, por isso procurar com ele no código-fonte deste
#: ficheiro ou do apoio não dá um falso positivo.
DDL = re.compile(r"CREATE\s+(TABLE|INDEX)", re.IGNORECASE)

TABELAS_DO_DESTINO_VAZIAS = {
    "categorias": 0,
    "produtos": 0,
    "eventos": 0,
    "fotos": 0,
    "clientes": 0,
    "admins": 0,
    "definicoes": 0,
}

#: O que o `MEDIA_DIR` tem de ter depois de uma corrida com imagens.
MEDIA_DEPOIS_DA_CORRIDA = {
    IMAGEM_DE_VERAO: BYTES_DA_IMAGEM_FALSA,
    IMAGEM_DE_INVERNO: BYTES_DA_IMAGEM_FALSA,
}


# =========================================================================
# A base de dados falsa está presa ao esquema documentado
# =========================================================================


def test_o_apoio_nao_tem_ddl_nenhum_e_le_o_esquema_do_disco() -> None:
    """A BD falsa nasce de `docs/legado/esquema-bd-antiga.sql`, lido do disco.

    Com o DDL copiado para dentro do apoio, uma correção ao esquema
    documentado — uma coluna que afinal existe, um `NOT NULL` que afinal
    não existe — deixava esta bateria verde e partia a importação no dia do
    deploy, em cima da única cópia que existe dos dados do dono. A ler do
    disco, parte-se o teste primeiro.

    **Deixa passar:** o apoio podia construir a base de dados falsa a
    partir de um *outro* ficheiro `.sql` qualquer; o que este teste prende
    é que não há DDL **no código** e que o caminho documentado se lê. Qual
    é o esquema que lá está é o teste seguinte que o diz.
    """
    fonte = CAMINHO_DO_APOIO.read_text(encoding="utf-8")
    encontrado = DDL.search(fonte)
    assert encontrado is None, (
        f"{CAMINHO_DO_APOIO.name} tem DDL copiado para dentro "
        f"({encontrado.group(0) if encontrado else ''}). O esquema da base de "
        "dados falsa lê-se de docs/legado/esquema-bd-antiga.sql, senão o "
        "esquema documentado pode mudar sem nada partir aqui."
    )

    esquema = ler_esquema_legado()
    assert DDL.search(esquema) is not None, (
        "docs/legado/esquema-bd-antiga.sql não tem DDL nenhum; não é dele "
        "que a base de dados falsa pode estar a nascer"
    )


def test_a_bd_falsa_tem_as_cinco_tabelas_do_site_antigo(origem_falsa: Path) -> None:
    """As cinco tabelas e as colunas que a importação lê estão lá.

    `sqlite_sequence` fica de fora: é do SQLite, por causa do
    `AUTOINCREMENT`, e não é tabela nossa nenhuma.

    **Deixa passar:** os tipos e as restrições das colunas. Uma coluna que
    mude de `TEXT` para `INTEGER` no esquema documentado não parte aqui —
    parte no teste do comportamento que a lê.
    """
    ligacao = sqlite3.connect(f"file:{origem_falsa}?mode=ro", uri=True)
    try:
        tabelas = {
            nome
            for (nome,) in ligacao.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
            if not nome.startswith("sqlite_")
        }
        colunas = {
            tabela: [
                linha[1] for linha in ligacao.execute(f"PRAGMA table_info({tabela})")
            ]
            for tabela in sorted(tabelas)
        }
    finally:
        ligacao.close()

    assert tabelas == {
        "produtos",
        "eventos",
        "fotos",
        "admin_users",
        "tomazia_clientes",
    }, f"as tabelas da base de dados falsa são {sorted(tabelas)}"

    assert colunas["produtos"] == ["id_produto", "nome_prod", "preco", "tipo"]
    assert colunas["eventos"] == [
        "id",
        "nome_evento",
        "data_evento",
        "descricao",
        "imagem_url",
        "visivel",
    ]
    assert "psw" in colunas["admin_users"]
    assert "email" in colunas["tomazia_clientes"]


def test_os_doze_tipos_da_bd_falsa_sao_os_que_o_esquema_documenta(
    origem_falsa: Path,
) -> None:
    """Os doze `tipo` semeados são os doze que o esquema documentado enumera.

    É a ligação entre `TIPOS_ANTIGOS` e o comentário de
    `docs/legado/esquema-bd-antiga.sql`. Se um dia aparecer um décimo
    terceiro `tipo` na base de dados real e alguém o acrescentar ao
    documento, este teste parte-se — que é o que tem de acontecer, porque
    as onze categorias do Tomás deixam de chegar.

    **Deixa passar:** um `tipo` que exista na base de dados real e que
    **não** esteja no documento. Nada aqui consegue ver a base de dados
    real; é por isso que o critério da F2-08 em `docs/TAREFAS.md` acaba com
    "o Tomás confirma localmente 140 produtos e 11 categorias".
    """
    documentados = tipos_documentados_no_esquema()
    assert sorted(documentados) == sorted(TIPOS_ANTIGOS), (
        "a lista de TIPOS_ANTIGOS em tests/apoio_legado.py e a do comentário "
        "de docs/legado/esquema-bd-antiga.sql divergiram: documento "
        f"{sorted(documentados)}, apoio {sorted(TIPOS_ANTIGOS)}"
    )
    assert len(set(documentados)) == 12, (
        f"o esquema documenta {len(set(documentados))} valores de "
        "produtos.tipo, e a F2-08 é «doze tipos, onze categorias»"
    )

    ligacao = sqlite3.connect(f"file:{origem_falsa}?mode=ro", uri=True)
    try:
        na_bd = {
            tipo for (tipo,) in ligacao.execute("SELECT DISTINCT tipo FROM produtos")
        }
    finally:
        ligacao.close()
    assert na_bd == set(TIPOS_ANTIGOS), (
        "a base de dados falsa não semeia os doze tipos documentados; "
        f"faltam {sorted(set(TIPOS_ANTIGOS) - na_bd)}"
    )


def test_a_bd_falsa_tem_as_tres_formas_de_guardar_um_preco(origem_falsa: Path) -> None:
    """`real`, `text` e `integer` na mesma coluna `preco`.

    É isto que torna o teste da conversão de preços uma prova e não uma
    coincidência: um script que faça `float(preco)` acerta nalgumas e falha
    noutras, e com uma só forma presente acertaria em todas.

    **Deixa passar:** `blob` e `null` não estão na base de dados falsa
    normal, de propósito — são cenários de recusa, e um deles tem de fazer
    o script parar, não importar.
    """
    ligacao = sqlite3.connect(f"file:{origem_falsa}?mode=ro", uri=True)
    try:
        formas = {
            forma for (forma,) in ligacao.execute("SELECT typeof(preco) FROM produtos")
        }
        cast_de_dois_e_trinta = ligacao.execute(
            "SELECT CAST(preco AS TEXT) FROM produtos WHERE id_produto = 3"
        ).fetchone()[0]
    finally:
        ligacao.close()

    assert formas == {"real", "text", "integer"}, (
        f"a coluna preco só tem as formas {sorted(formas)}; faltam as outras"
    )
    # O caminho que o script tem de usar: `CAST(preco AS TEXT)` dá '2.3' e
    # daí sai 230. `int(2.30 * 100)` dá 229 — medido.
    assert cast_de_dois_e_trinta == "2.3"
    assert int(2.30 * 100) == 229


# =========================================================================
# A corrida feliz
# =========================================================================


def test_a_corrida_feliz_sai_com_zero(cenario_feliz: CenarioImportado) -> None:
    """Com a origem toda certa e as imagens no sítio, o script importa e sai com 0.

    **Deixa passar:** o conteúdo do que foi escrito. Este teste só diz que
    o script correu até ao fim; são os seguintes que dizem o que lá ficou.
    """
    assert cenario_feliz.resultado.estado == 0, cenario_feliz.resultado.relatorio()


@pytest.mark.parametrize(
    "esperado", PRODUTOS_ESPERADOS, ids=lambda p: f"{p.id}-{p.nome}"
)
def test_cada_produto_entra_com_o_preco_em_centimos_e_o_texto_limpo(
    cenario_feliz: CenarioImportado, esperado: ProdutoEsperado
) -> None:
    """Cada produto do site antigo tem nome descodificado, preço em cêntimos e categoria.

    O caso que decide tudo é o `2.30 → 230`: está medido que
    `int(2.30 * 100)` dá **229**. O caminho é
    `CAST(preco AS TEXT)` → `Decimal` → `× 100` → `quantize`, nunca
    `float`. `'2,50' → 250` e `0 → 0` fecham as outras duas formas.

    **Deixa passar:** o modo de arredondamento. Com as três casas decimais
    a serem recusadas (ver os cenários de recusa), nenhum preço desta base
    de dados falsa chega a precisar de arredondar — por isso nada aqui
    distingue `ROUND_HALF_UP` de `ROUND_HALF_EVEN`.
    """
    produtos = {produto.id: produto for produto in ler_produtos(cenario_feliz.destino)}
    assert esperado.id in produtos, (
        f"não há produto com id {esperado.id} no destino; há "
        f"{sorted(produtos)}\n{cenario_feliz.resultado.relatorio()}"
    )
    assert produtos[esperado.id] == esperado, cenario_feliz.resultado.relatorio()


def test_o_id_do_site_antigo_e_a_chave_dos_produtos(
    cenario_feliz: CenarioImportado,
) -> None:
    """`produtos.id = produtos.id_produto`: a importação não renumera nada (ADR 0014).

    Há um salto de propósito na base de dados falsa (o último produto é o
    57, não o 22): com ids 1..22 seguidos, uma importação que renumerasse
    passava despercebida. E é o id que torna a segunda corrida idempotente.

    **Deixa passar:** a ordem de inserção. O que se afirma é o conjunto dos
    ids, não por que ordem lá chegaram.
    """
    ids = {produto.id for produto in ler_produtos(cenario_feliz.destino)}
    assert ids == {produto.id_produto for produto in PRODUTOS}, (
        cenario_feliz.resultado.relatorio()
    )


def test_a_ordem_e_a_disponibilidade_dos_produtos_ficam_a_zero_e_a_verdadeiro(
    cenario_feliz: CenarioImportado,
) -> None:
    """`ordem = 0` e `disponivel = true` em todos os produtos importados.

    A ordem dentro do cartão fica a do `id`, que é a do site antigo: o
    site PHP não tem nada que corresponda a uma ordem editorial, e inventar
    uma seria o script a decidir a carta pelo dono. O `disponivel` é
    verdadeiro porque tudo o que está na carta antiga se serve até alguém
    dizer o contrário na gestão.

    **Deixa passar:** a diferença entre "o script escreveu estes valores" e
    "o script deixou-os ao `server_default`". De fora, uma linha com
    `ordem = 0` escrita de propósito é igual a uma que herdou o `0` do DDL,
    e nenhuma consulta os distingue. Escrevem-se à mão na mesma, e a razão
    é esta: o `server_default` existe para o `INSERT` em SQL cru não
    rebentar, não para decidir o conteúdo — se um dia mudar, a importação
    mudava de resultado sem ninguém ter mexido nela.
    """
    valores = ler_ordem_e_disponivel(cenario_feliz.destino)
    assert set(valores) == {produto.id_produto for produto in PRODUTOS}, (
        cenario_feliz.resultado.relatorio()
    )
    errados = {id_: valor for id_, valor in valores.items() if valor != (0, 1)}
    assert not errados, (
        f"estes produtos não ficaram com (ordem, disponivel) = (0, 1): "
        f"{errados}\n{cenario_feliz.resultado.relatorio()}"
    )


def test_o_e_comercial_literal_e_o_que_nao_e_entidade_ficam_como_estao(
    cenario_feliz: CenarioImportado,
) -> None:
    """O descodificador é restrito: uma passagem, só as entidades do `htmlspecialchars`.

    Está medido que `html.unescape` é generoso de mais — transforma
    `Gin &copy tonico` em `Gin © tonico`, sem ponto e vírgula e com uma
    entidade que o `htmlspecialchars` nunca produz. Só entram
    `&amp; &lt; &gt; &quot; &#039; &#39; &apos;`, sempre com ponto e
    vírgula. Um `&` literal fica `&`.

    **Deixa passar:** entidades que o `htmlspecialchars` não produz mas que
    *têm* ponto e vírgula (`&copy;`, `&nbsp;`). Não há nenhuma na base de
    dados falsa; se aparecer uma na base de dados real, o nome fica com a
    entidade à vista no site e o dono corrige-a na gestão — preferível a
    descodificar o que não se sabe.
    """
    import html

    produtos = {
        produto.id: produto.nome for produto in ler_produtos(cenario_feliz.destino)
    }

    assert produtos[6] == "Cerveja & tremoços", cenario_feliz.resultado.relatorio()
    assert produtos[57] == "Gin &copy tonico", cenario_feliz.resultado.relatorio()
    # A medição que justifica o descodificador restrito, à vista de quem lê
    # este teste: o da biblioteca-padrão faria outra coisa.
    assert html.unescape("Gin &copy tonico") == "Gin © tonico"


# =========================================================================
# Categorias
# =========================================================================


def test_os_doze_tipos_dao_as_onze_categorias_com_o_slug_o_nome_e_a_ordem(
    cenario_feliz: CenarioImportado,
) -> None:
    """Onze categorias, com o `slug`, o nome e a ordem decididos pelo Tomás.

    Os nomes não são a primeira letra em maiúscula: `portos` dá "Vinhos do
    Porto", `whiskys` dá "Whisky", `espirituosas` fica na forma curta. A
    ordem é a forma de um dia — o que se pede de dia primeiro, a prateleira
    da noite depois.

    **O `slug` vem do `tipo` antigo normalizado, não do nome novo.** Daí
    `portos` com o nome "Vinhos do Porto" e `whiskys` com o nome "Whisky":
    são os pares que uma implementação que derivasse o `slug` do nome
    visível falharia. Não é estética — a âncora da ementa é
    `#ementa-<slug>` (secção 2 da `docs/ecras/F3-02.md`), e com o `slug` a
    sair do nome, o dono a renomear uma categoria na gestão partia as
    ligações que alguém tivesse guardado. É também o que o ADR 0014 fixa:
    a chave das categorias é o `slug` normalizado do `tipo`.

    **Deixa passar:** o `visivel` das categorias, que ninguém decidiu, e o
    `id` de cada uma, que é da base de dados e não da importação.
    """
    assert ler_categorias(cenario_feliz.destino) == list(CATEGORIAS_ESPERADAS), (
        cenario_feliz.resultado.relatorio()
    )


def test_bebidas_com_e_sem_maiuscula_caem_na_mesma_categoria(
    cenario_feliz: CenarioImportado,
) -> None:
    """Os produtos de `Bebidas` e os de `bebidas` ficam todos na categoria "Bebidas".

    **Deixa passar:** *como* é que a junção se faz. É o teste seguinte que
    exige que seja por normalização e não por um caso especial.
    """
    produtos = ler_produtos(cenario_feliz.destino)
    bebidas = {produto.id for produto in produtos if produto.categoria == "Bebidas"}
    # 5 e 6 vêm de `Bebidas`; 7 e 8 vêm de `bebidas`.
    assert bebidas == {5, 6, 7, 8}, cenario_feliz.resultado.relatorio()


def test_a_juncao_e_pela_normalizacao_do_slug_e_nao_um_caso_especial_para_bebidas(
    tmp_path: Path, _destino_modelo_em_head: Path, media_dir: Path
) -> None:
    """Um `Gin` com maiúscula junta-se ao `gin` sem ela, sem ninguém o ter previsto.

    Um caso especial `{"Bebidas": "bebidas"}` resolve o par que está na
    base de dados hoje e deixa o próximo por resolver — e o próximo aparece
    no dia em que o dono escrever uma categoria com maiúscula na gestão, ou
    no dia em que a base de dados real tiver um par que o documento não
    anotou. A junção tem de ser a normalização do `slug` (ADR 0014).

    **Deixa passar:** normalizações mais fracas do que a necessária. `Gin`
    e `gin` distinguem-se só pela caixa; um `Café`/`cafe` com acento, ou um
    `Vinhos do Porto`/`vinhos-do-porto` com espaços, não estão exercitados
    aqui — e é exatamente por isso que o cenário `tipo-desconhecido` existe
    do outro lado, a exigir que o que não normaliza para um dos onze seja
    recusado em vez de inventado.
    """
    origem = construir_bd_antiga_falsa(
        tmp_path / "origem",
        produtos=(*PRODUTOS, ProdutoAntigo(81, "Gin Tanqueray", 6.0, "Gin")),
    )
    destino = copiar_destino_em_head(_destino_modelo_em_head, tmp_path / "destino")
    imagens = criar_pasta_de_imagens(tmp_path / "imagens")

    resultado = correr_importador(
        origem=origem, destino=destino, imagens=imagens, media=media_dir
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert ler_categorias(destino) == list(CATEGORIAS_ESPERADAS), (
        "o `Gin` com maiúscula criou uma categoria nova em vez de se juntar "
        f"ao `gin`\n{resultado.relatorio()}"
    )
    produtos = {produto.id: produto.categoria for produto in ler_produtos(destino)}
    assert produtos[81] == "Gin", resultado.relatorio()


# =========================================================================
# Eventos, datas e o `visivel`
# =========================================================================


@pytest.mark.parametrize(
    "esperado", EVENTOS_ESPERADOS, ids=lambda e: f"{e.id}-{e.titulo}"
)
def test_cada_evento_entra_com_a_data_a_imagem_e_o_publicado_certos(
    cenario_feliz: CenarioImportado, esperado: EventoEsperado
) -> None:
    """A tabela toda dos eventos, lida pelo ORM: id, título, início, imagem, publicado.

    Pelo ORM de propósito: é a coluna `DataHoraUTC` que diz se o que o
    script escreveu se relê como um instante em UTC. Um `INSERT` em SQL
    cru com hora local é **rotulado** UTC sem ser convertido (ver
    `app/models/tipos.py`).

    **Deixa passar:** a descrição, que tem o seu próprio teste, e a ordem
    por que os eventos foram inseridos.
    """
    eventos = {
        evento.id: evento
        for evento in ler_eventos_como_esperados(cenario_feliz.destino)
    }
    assert esperado.id in eventos, (
        f"não há evento com id {esperado.id} no destino; há {sorted(eventos)}\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )
    assert eventos[esperado.id] == esperado, cenario_feliz.resultado.relatorio()


def test_o_evento_sem_data_entra_como_rascunho_mesmo_estando_visivel(
    cenario_feliz: CenarioImportado,
) -> None:
    """`data_evento` a `''` dá `inicio IS NULL` **e** `publicado = 0`, custe o que custar ao `visivel`.

    As duas metades contam. O `CHECK ck_eventos_publicado_exige_inicio`
    (ADR 0009) recusa publicado sem data, e o script escreve por SQL cru,
    sem passar pela API: sem o `publicado = 0` explícito, o que acontecia
    era um `IntegrityError` a meio da importação ou — pior, se o
    `server_default` mudasse — um evento publicado sem data no site.

    O evento 9 da base de dados falsa tem `visivel = 1` de propósito. É o
    que torna este teste uma afirmação e não uma coincidência: a regra da
    data **ganha** à regra do `visivel`, e com um `visivel = 0` as duas
    regras apontavam para o mesmo lado e nada se provava.

    **Deixa passar:** nada que me ocorra — este é o caso em que as duas
    regras se cruzam e a resposta está decidida nos dois sítios.
    """
    eventos = {evento.id: evento for evento in ler_eventos(cenario_feliz.destino)}
    karaoke = eventos[9]
    assert karaoke.inicio is None, cenario_feliz.resultado.relatorio()
    assert karaoke.publicado is False, (
        "o evento sem data entrou publicado; o CHECK ck_eventos_publicado_"
        f"exige_inicio existe para isto não poder acontecer\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )


def test_o_publicado_segue_o_visivel_do_site_antigo(
    cenario_feliz: CenarioImportado,
) -> None:
    """Nos eventos **com** data, `publicado = visivel`: fiel à intenção do dono.

    É inofensivo e é o mais fiel: a F2-03 filtra os eventos por data, por
    isso um evento passado não aparece no site mesmo publicado. O que se
    perderia com um `publicado = 0` para todos era a informação de que o
    dono tinha escondido aquele evento — e ele teria de voltar a escondê-lo
    um a um na gestão, sem saber quais.

    O evento 1 tem `visivel = 1` e o 2 tem `visivel = 0`. Com os dois a
    `1`, um script que pusesse tudo a publicado passava.

    **Deixa passar:** um `visivel` com um valor que não seja 0 nem 1 (a
    coluna antiga é `INTEGER` e aceita o que lá puserem) e um `visivel` a
    `NULL`. Não há nenhum na base de dados falsa, e não se sabe se há na
    real.
    """
    eventos = {evento.id: evento for evento in ler_eventos(cenario_feliz.destino)}
    assert eventos[1].publicado is True, (
        "o evento com data e `visivel = 1` tinha de entrar publicado\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )
    assert eventos[2].publicado is False, (
        "o evento com data e `visivel = 0` entrou publicado; o dono tinha-o "
        f"escondido no site antigo\n{cenario_feliz.resultado.relatorio()}"
    )


def test_a_data_de_verao_e_os_dois_dias_de_mudanca_de_hora(
    cenario_feliz: CenarioImportado,
) -> None:
    """As quatro conversões Lisboa→UTC que existem num ano, nas quatro datas que as separam.

    ADR 0010: a fronteira de um dia civil é sempre a de `Europe/Lisbon`.
    Quatro casos, e cada um mata uma implementação diferente:

    - `2026-07-01` → `2026-06-30T23:00:00Z`. Verão, UTC+1. Mata quem rotule
      a data como UTC sem converter — que é o que um `INSERT` em SQL cru
      faz (ver `app/models/tipos.py`).
    - `2026-12-20` → `2026-12-20T00:00:00Z`. Inverno, UTC+0. Sozinho,
      deixava passar o defeito de cima; está aqui para o caso fácil também
      ficar provado.
    - `2026-03-29` → `2026-03-29T00:00:00Z`. O dia em que o relógio se
      adianta — mas só à 01:00 local, por isso a meia-noite ainda é WET.
    - `2026-10-25` → `2026-10-24T23:00:00Z`. O dia em que o relógio se
      atrasa — às 02:00 local, por isso a meia-noite ainda é WEST.

    Os dois últimos são os que o ADR 0010 traz escritos nas consequências:
    "uma implementação com +1h no verão acerta no primeiro e falha no
    segundo". Com um `zoneinfo` a sério, os quatro saem de graça; é
    precisamente por isso que eles aqui não custam nada e valem a pena.

    **Deixa passar:** uma `data_evento` que traga **hora** (`2026-07-01
    21:00`). O site antigo guarda `DATE`, a base de dados falsa não tem
    nenhuma assim, e o ADR 0014 só fala de datas sem hora.
    """
    eventos = {evento.id: evento for evento in ler_eventos(cenario_feliz.destino)}
    conversoes = {
        1: INICIO_DE_VERAO_UTC,
        2: INICIO_DE_INVERNO_UTC,
        3: INICIO_DA_MUDANCA_DE_MARCO_UTC,
        4: INICIO_DA_MUDANCA_DE_OUTUBRO_UTC,
    }
    erradas = {
        id_: (eventos[id_].inicio, esperado)
        for id_, esperado in conversoes.items()
        if eventos[id_].inicio != esperado
    }
    assert not erradas, (
        "estas datas não foram convertidas de meia-noite em Lisboa para UTC "
        f"(id: obtido, esperado) {erradas}\n{cenario_feliz.resultado.relatorio()}"
    )


def test_o_texto_do_evento_tambem_perde_as_entidades(
    cenario_feliz: CenarioImportado,
) -> None:
    """A descrição do evento passa pelo mesmo descodificador que o nome do produto.

    E **não** passa pelo `strip()`, ao contrário do nome do produto e do
    título do evento: a mudança de linha no fim chega ao destino tal como
    estava na origem. A assimetria é de propósito — o nome e o título são
    rótulos de uma linha, a descrição é prosa, e as pontas da prosa são
    escolhas de quem a escreveu. Está escrita no script, ao lado da linha
    que a aplica, e é esta afirmação que a prende: pôr um `.strip()` na
    descrição, "para ficar igual às outras", parte aqui.

    **Deixa passar:** o título do evento com entidades — nenhum dos cinco
    eventos da base de dados falsa tem uma no `nome_evento`.
    """
    eventos = {evento.id: evento for evento in ler_eventos(cenario_feliz.destino)}
    assert eventos[1].descricao == "Fado & petiscos\n", (
        cenario_feliz.resultado.relatorio()
    )


# =========================================================================
# Imagens
# =========================================================================


def test_a_imagem_fica_reduzida_ao_nome_do_ficheiro(
    cenario_feliz: CenarioImportado,
) -> None:
    """`img/uploads/fados.jpg` entra como `fados.jpg`, e quem não tinha imagem não ganha uma.

    `eventos.imagem` tem `CHECK ck_eventos_imagem_sem_caminho`: a base de
    dados recusa `/`, `\\` e `..`. Deixar o `CHECK` rebentar seria um
    `IntegrityError` a meio, com parte do trabalho feito e sem dizer que
    linha é — é trabalho a prever, não a descobrir (F2-01, herança anotada
    na entrada da F2-08).

    **Deixa passar:** o que acontece aos bytes — isso é o teste a seguir.
    """
    eventos = {evento.id: evento for evento in ler_eventos(cenario_feliz.destino)}
    assert eventos[1].imagem == IMAGEM_DE_VERAO, cenario_feliz.resultado.relatorio()
    assert eventos[2].imagem == IMAGEM_DE_INVERNO, cenario_feliz.resultado.relatorio()
    assert eventos[9].imagem is None, (
        "o evento que não tinha imagem no site antigo não pode ganhar uma\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )


def test_as_imagens_sao_copiadas_para_o_media_dir(
    cenario_feliz: CenarioImportado,
) -> None:
    """Com `--imagens <pasta>`, os ficheiros aterram no `MEDIA_DIR`, com os mesmos bytes.

    Verificar que o ficheiro existe na pasta de origem não chega: um evento
    com `imagem = "fados.jpg"` que o `media/` não serve é uma imagem
    partida no site, e o Tomás escolheu "quero as imagens". O nome de
    destino é o nome já reduzido, o mesmo que ficou em `eventos.imagem` —
    senão a base de dados aponta para um sítio e o ficheiro está noutro.

    A comparação é do **conteúdo** e não só dos nomes: um script que
    criasse ficheiros vazios com os nomes certos passava um teste que só
    olhasse para a lista.

    **Deixa passar:** subpastas dentro do `MEDIA_DIR` (`ficheiros_em` não
    desce) e o que acontece a um ficheiro que já lá estivesse e não viesse
    da importação — isso são os dois testes a seguir e o cenário
    `imagem-diferente-no-media`.
    """
    assert ficheiros_em(cenario_feliz.media) == MEDIA_DEPOIS_DA_CORRIDA, (
        "o MEDIA_DIR não ficou com as duas imagens dos eventos\n"
        + cenario_feliz.resultado.relatorio()
    )


def test_uma_imagem_ja_no_media_dir_e_igual_byte_a_byte_nao_se_copia_outra_vez(
    origem_falsa: Path, destino_em_head: Path, pasta_de_imagens: Path, media_dir: Path
) -> None:
    """Já lá estava e é a mesma: não toca, e a corrida continua.

    É o ADR 0014 aplicado aos ficheiros — "presente e igual ao que
    escreveríamos, não toca e conta como «já lá estava»". É também o que
    torna a segunda corrida possível: sem isto, correr outra vez ou
    rebentava no ficheiro repetido, ou reescrevia-o.

    O `mtime` em nanossegundos é o que prova o "não toca": com o conteúdo
    igual, copiar por cima e não copiar dão o mesmo `sha256`, e só o
    `mtime` os separa.

    **Deixa passar:** o que o relatório diz sobre este caso. "Já lá estava"
    tem de aparecer em palavras nalgum sítio para o dono perceber porque é
    que as contagens não batem certo com o número de eventos, mas aqui só
    se afirma o estado zero e o ficheiro intacto.
    """
    (media_dir / IMAGEM_DE_VERAO).write_bytes(BYTES_DA_IMAGEM_FALSA)
    antes = impressao_digital(media_dir / IMAGEM_DE_VERAO)

    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert impressao_digital(media_dir / IMAGEM_DE_VERAO) == antes, (
        f"o script voltou a escrever {IMAGEM_DE_VERAO} por cima de um "
        "ficheiro que já era igual byte a byte; o ADR 0014 diz que nesse "
        f"caso não se toca\n{resultado.relatorio()}"
    )
    assert ficheiros_em(media_dir) == MEDIA_DEPOIS_DA_CORRIDA, (
        "a outra imagem tinha de ter sido copiada na mesma\n" + resultado.relatorio()
    )


def test_uma_imagem_ja_no_media_dir_e_diferente_para_a_corrida_e_nao_se_sobrepoe(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """Já lá estava e **não** é a mesma: pára, nomeia-a, e não lhe toca.

    Um ficheiro sobreposto não se recupera como uma linha de base de dados.
    A imagem que lá está pode ter sido posta pela gestão, ou ser de um
    evento diferente com um nome de ficheiro infeliz; nos dois casos quem
    decide é uma pessoa, não o script.

    O cenário está em `CENARIOS_DE_RECUSA` (`imagem-diferente-no-media`),
    por isso a mensagem dele entra também no teste das mensagens
    diferentes, e o "não escreveu nada na base de dados" vem do teste
    genérico das recusas. O que fica aqui é o que é só deste caso: os bytes
    do ficheiro que já lá estava.

    **Deixa passar:** o `mtime` do ficheiro que já lá estava, que não é
    comparado — se o script lhe escrever por cima exatamente os mesmos
    bytes que já tinha, isto não dá por ela. Mas os bytes que ele queria
    escrever são, por construção deste cenário, outros.
    """
    corrida = recusas["imagem-diferente-no-media"]
    assert corrida.resultado.estado != 0, corrida.resultado.relatorio()
    assert ficheiros_em(corrida.media) == corrida.media_antes, (
        "o MEDIA_DIR mudou: o script sobrepôs (ou acrescentou) ficheiros "
        "numa corrida que recusou. Nunca sobrepõe, e é tudo ou nada\n"
        + corrida.resultado.relatorio()
    )


def test_imagens_ignorar_poe_nulo_lista_o_que_ficou_de_fora_e_nao_copia_nada(
    origem_falsa: Path, destino_em_head: Path, media_dir: Path
) -> None:
    """`--imagens ignorar` deixa `imagem` a `NULL`, **diz quais** ficaram de fora, e não copia nada.

    Não pode haver omissão: "este evento não tem imagem" e "ninguém me
    disse o que fazer às imagens" acabam os dois em `NULL` na base de
    dados, e a única coisa que os separa é o relatório. Por isso a lista
    tem de nomear `fados.jpg` e `natal.jpg` — e não pode arrastar o evento
    que nunca teve imagem nenhuma para o meio delas.

    **Deixa passar:** a frase em que a lista vem. O que se afirma é quais
    são os nomes de ficheiro mencionados e que o evento sem imagem não
    aparece ao lado deles.
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens="ignorar",
        media=media_dir,
    )

    assert resultado.estado == 0, resultado.relatorio()

    eventos = {evento.id: evento for evento in ler_eventos(destino_em_head)}
    com_imagem = {id_: e.imagem for id_, e in eventos.items() if e.imagem is not None}
    assert not com_imagem, (
        f"com `--imagens ignorar` nenhum evento pode ficar com imagem, e "
        f"estes ficaram: {com_imagem}\n{resultado.relatorio()}"
    )
    assert ficheiros_em(media_dir) == {}, (
        "com `--imagens ignorar` não se copia nada para o MEDIA_DIR\n"
        + resultado.relatorio()
    )

    linhas_com_imagens = [
        linha for linha in resultado.tudo.splitlines() if ".jpg" in linha
    ]
    mencionados = {
        nome
        for linha in linhas_com_imagens
        for nome in re.findall(r"[\w.\-/]+\.jpg", linha)
    }
    assert {IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO} <= {
        Path(nome).name for nome in mencionados
    }, (
        "com `--imagens ignorar`, o relatório tem de listar as imagens que "
        f"ficaram de fora\n{resultado.relatorio()}"
    )
    assert all("Karaoke" not in linha for linha in linhas_com_imagens), (
        "o evento que nunca teve imagem apareceu na lista do que ficou de "
        f"fora; não ficou nada de fora dele\n{resultado.relatorio()}"
    )


def test_sem_o_argumento_das_imagens_o_script_recusa_e_nao_escreve_nada(
    origem_falsa: Path, destino_em_head: Path, media_dir: Path
) -> None:
    """`--imagens` não tem omissão: sem ele, o script recusa antes de escrever.

    É a mesma regra 10 do `CLAUDE.md` aplicada a uma opção de linha de
    comando: uma omissão que caísse em `NULL` tornaria "não há imagem"
    indistinguível de "não me disseram o que fazer", e o dono só descobria
    no dia em que fosse procurar os cartazes dos eventos.

    **Deixa passar:** o estado de saída exato (o `argparse` sai com 2) e o
    sítio onde a mensagem aparece. O que se afirma é que a opção é nomeada
    e que o destino e o `MEDIA_DIR` ficam como estavam.
    """
    resultado = correr_importador(
        origem=origem_falsa, destino=destino_em_head, imagens=None, media=media_dir
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert "--imagens" in resultado.tudo, (
        "a recusa tem de nomear a opção que falta, senão quem a corre não "
        f"sabe o que acrescentar\n{resultado.relatorio()}"
    )
    assert contagens(destino_em_head) == TABELAS_DO_DESTINO_VAZIAS, (
        resultado.relatorio()
    )
    assert ficheiros_em(media_dir) == {}, resultado.relatorio()


def test_uma_imagem_em_falta_para_a_corrida_e_nao_copia_metade(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """Com `--imagens <pasta>`, falta um ficheiro: para, nomeia-o, e não copia nada.

    O Tomás decidiu que quer as imagens. Copiar metade e continuar deixava
    o dono com eventos sem cartaz e sem saber quais — e com a base de dados
    já escrita, por isso sem poder voltar a correr do princípio.

    O que é só deste caso e fica aqui: o `MEDIA_DIR` vazio. Repare-se que a
    imagem que **existe** (`fados.jpg`) também não entra: parar no primeiro
    que falta não vale de nada se o que já tinha sido copiado ficasse lá.

    **Deixa passar:** a ordem por que os ficheiros são verificados. Pede-se
    que a mensagem nomeie `natal.jpg`, que é o único que falta aqui; com
    dois a faltar, "parar no primeiro" e "parar no último" dariam os dois
    verde.
    """
    corrida = recusas["imagem-em-falta"]
    assert corrida.resultado.estado != 0, corrida.resultado.relatorio()
    assert ficheiros_em(corrida.media) == {}, (
        "o script copiou imagens antes de verificar que estavam todas lá; é "
        f"tudo ou não é nada\n{corrida.resultado.relatorio()}"
    )


# =========================================================================
# Simular por omissão, escrever só com `--aplicar`
# =========================================================================


def test_sem_aplicar_o_script_simula_e_nao_escreve_nada(
    origem_falsa: Path, destino_em_head: Path, pasta_de_imagens: Path, media_dir: Path
) -> None:
    """Sem `--aplicar`, o script lê tudo, diz o que faria, e não deixa nada escrito.

    É a decisão do Tomás na entrada da F2-08, e tem data: a importação a
    sério corre por SSH, em produção, e a F2-02 — que traz o
    `scripts/backup.py` para desfazer — ainda não está fundida. Até lá, a
    rede é esta: quem corre o comando vê o relatório inteiro antes de a
    base de dados do bar mudar.

    "Não escrevi nada" afirma-se nos **dois** sítios onde o script escreve
    — a base de dados e o `MEDIA_DIR` —, e o estado de saída é `0`: uma
    simulação que corre até ao fim não é um erro.

    E afirma-se também que ele **leu**: o relatório conta os 22 produtos
    que entrariam. Sem isso, um script que simulasse saindo logo na
    primeira linha passava este teste — e seria inútil, porque é
    precisamente o relatório da simulação que decide se se escreve ou não.

    **Deixa passar:** a redação. Pede-se o número e a palavra `--aplicar`,
    não uma frase em particular.
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        aplicar=False,
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert contagens(destino_em_head) == TABELAS_DO_DESTINO_VAZIAS, (
        "o script escreveu na base de dados sem `--aplicar`\n" + resultado.relatorio()
    )
    assert ficheiros_em(media_dir) == {}, (
        "o script copiou imagens para o MEDIA_DIR sem `--aplicar`\n"
        + resultado.relatorio()
    )
    assert "--aplicar" in resultado.tudo, (
        "a simulação tem de dizer como é que se escreve a sério, senão quem "
        f"a corre fica sem saber o que fazer a seguir\n{resultado.relatorio()}"
    )
    assert str(len(PRODUTOS)) in resultado.tudo, (
        f"a simulação não diz que entrariam {len(PRODUTOS)} produtos; um "
        "relatório que não conta nada não serve para decidir se se aplica\n"
        + resultado.relatorio()
    )


def test_depois_de_simular_a_corrida_a_serio_importa_tudo(
    origem_falsa: Path, destino_em_head: Path, pasta_de_imagens: Path, media_dir: Path
) -> None:
    """Simular e aplicar a seguir dá o mesmo que aplicar logo.

    É a sequência real: corre-se sem `--aplicar`, lê-se o relatório,
    corre-se outra vez com ele. Se a simulação deixasse metade do trabalho
    feito — ou pior, se consolidasse parte da transação —, a corrida a
    sério a seguir já não encontrava a base de dados que o relatório
    descreveu.

    **Deixa passar:** o conteúdo linha a linha, que os testes da corrida
    feliz já afirmam. Aqui só se conta.
    """
    simulacao = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        aplicar=False,
    )
    assert simulacao.estado == 0, simulacao.relatorio()

    a_serio = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert a_serio.estado == 0, a_serio.relatorio()
    assert contagens(destino_em_head) == {
        "categorias": 11,
        "produtos": len(PRODUTOS),
        "eventos": len(EVENTOS_ESPERADOS),
        "fotos": 0,
        "clientes": 0,
        "admins": 0,
        "definicoes": 0,
    }, a_serio.relatorio()
    assert ficheiros_em(media_dir) == MEDIA_DEPOIS_DA_CORRIDA, a_serio.relatorio()


@pytest.mark.parametrize("aplicar", [True, False], ids=["com-aplicar", "simulacao"])
def test_o_caminho_do_destino_e_a_primeira_linha_do_relatorio(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
    aplicar: bool,
) -> None:
    """A primeira linha diz em que base de dados é que isto vai mexer.

    A outra metade da decisão do Tomás sobre o `--aplicar`. O destino não
    vem da linha de comandos — vem da `BASE_DADOS_URL`, que em produção
    está num `.env` que ninguém tem à frente ao correr o comando. Pô-lo na
    **primeira** linha é o que permite a quem corre isto por SSH parar
    antes de escrever, e não depois.

    Nos dois modos: na simulação é onde a pessoa confirma o caminho, e na
    corrida a sério é o registo do que foi tocado.

    **Deixa passar:** o rótulo antes do caminho. Exige-se que o caminho
    absoluto do destino esteja na primeira linha não vazia do `stdout`,
    não que a linha diga "Destino:".
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        aplicar=aplicar,
    )

    assert resultado.estado == 0, resultado.relatorio()
    linhas = [linha for linha in resultado.stdout.splitlines() if linha.strip()]
    assert linhas, f"o relatório veio vazio\n{resultado.relatorio()}"
    assert str(destino_em_head.resolve()) in linhas[0], (
        "a primeira linha do relatório tem de trazer o caminho do destino; "
        f"veio «{linhas[0]}»\n{resultado.relatorio()}"
    )


# =========================================================================
# O que não se importa
# =========================================================================


def test_a_galeria_comeca_vazia_e_clientes_e_admins_nao_entram(
    cenario_feliz: CenarioImportado,
) -> None:
    """Decisão do Tomás: `fotos`, `clientes` e `admins` não se importam.

    A base de dados falsa tem uma linha em cada uma das três tabelas
    correspondentes do site antigo, por isso "zero" aqui é uma escolha do
    script e não a ausência de dados na origem.

    `definicoes` fica a zero porque não há nada na origem que lhe
    corresponda: o site PHP não tinha tabela de definições, e o WiFi, o
    horário e a morada enchem-se na gestão (F2-05).

    **Deixa passar:** nada de estrutural — as sete tabelas estão todas
    afirmadas.
    """
    assert contagens(cenario_feliz.destino) == {
        "categorias": 11,
        "produtos": len(PRODUTOS),
        "eventos": len(EVENTOS_ESPERADOS),
        "fotos": 0,
        "clientes": 0,
        "admins": 0,
        "definicoes": 0,
    }, cenario_feliz.resultado.relatorio()


# =========================================================================
# Idempotência (ADR 0014)
# =========================================================================


@dataclass(frozen=True)
class DuasCorridas:
    destino: Path
    media: Path
    primeira: ResultadoDaImportacao
    segunda: ResultadoDaImportacao
    despejo_depois_da_primeira: str
    despejo_depois_da_segunda: str
    contagens_depois_da_primeira: dict[str, int]
    contagens_depois_da_segunda: dict[str, int]
    media_depois_da_primeira: dict[str, bytes]
    media_depois_da_segunda: dict[str, bytes]


@pytest.fixture
def duas_corridas(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> DuasCorridas:
    """O mesmo comando, duas vezes seguidas, sobre o mesmo destino."""
    primeira = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    despejo_um = despejo(destino_em_head)
    contagens_um = contagens(destino_em_head)
    media_um = ficheiros_em(media_dir)
    segunda = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    return DuasCorridas(
        destino=destino_em_head,
        media=media_dir,
        primeira=primeira,
        segunda=segunda,
        despejo_depois_da_primeira=despejo_um,
        despejo_depois_da_segunda=despejo(destino_em_head),
        contagens_depois_da_primeira=contagens_um,
        contagens_depois_da_segunda=contagens(destino_em_head),
        media_depois_da_primeira=media_um,
        media_depois_da_segunda=ficheiros_em(media_dir),
    )


def test_a_segunda_corrida_escreve_zero_linhas(duas_corridas: DuasCorridas) -> None:
    """Correr outra vez não escreve nada: o despejo sai igual ao da primeira.

    É a garantia que o ADR 0014 manda prender. Só inserção, nunca
    atualização, nunca eliminação. A chave é o `id` do site antigo
    (`produtos.id`, `eventos.id`) e o `slug` das categorias.

    Comparar o despejo, e não só as contagens, é o que apanha uma segunda
    corrida que apague e volte a inserir com ids novos — as contagens
    ficavam iguais e a ementa do dono mudava de ligações por baixo. O
    `MEDIA_DIR` entra pela mesma razão: as imagens já lá estão e são
    iguais, por isso a segunda corrida não lhes toca.

    **Deixa passar:** uma segunda corrida que escreva e desfaça dentro da
    mesma transação. O despejo é igual; o ficheiro pode ter crescido.
    """
    assert duas_corridas.primeira.estado == 0, duas_corridas.primeira.relatorio()
    assert duas_corridas.segunda.estado == 0, duas_corridas.segunda.relatorio()
    assert (
        duas_corridas.contagens_depois_da_segunda
        == duas_corridas.contagens_depois_da_primeira
    ), duas_corridas.segunda.relatorio()
    assert (
        duas_corridas.despejo_depois_da_segunda
        == duas_corridas.despejo_depois_da_primeira
    ), (
        "o despejo do destino mudou entre a primeira e a segunda corrida\n"
        + duas_corridas.segunda.relatorio()
    )
    assert (
        duas_corridas.media_depois_da_segunda == duas_corridas.media_depois_da_primeira
    ), (
        "o MEDIA_DIR mudou entre a primeira e a segunda corrida\n"
        + duas_corridas.segunda.relatorio()
    )


class Edicao(NamedTuple):
    """Uma edição feita no destino entre duas corridas, e o que ela tem de dar.

    `ancora` é a cadeia por onde se encontra, no relatório, a linha que
    fala desta divergência. `no_destino` e `na_origem` são as duas pistas
    que **essa linha** tem de trazer.
    """

    sql: str
    ancora: str
    no_destino: str
    na_origem: str


#: Uma edição por cada comparação que `comparar_com_o_destino` faz. São
#: nove, e eram nove porque medido: mutando cada `if` para `if False and
#: ...`, só a do `produtos.preco_cent` fazia cair um teste. As outras oito
#: não tinham rede nenhuma — e o que isso deixa passar não é cosmético: a
#: linha já existe no destino, não entra nas listas de inserção, e sem a
#: comparação o script sai com **estado 0** e «Já lá estava tudo» sobre um
#: destino que contradiz a origem. É a regra 10 ao contrário — «não há
#: diferença» e «não procurei a diferença» a darem o mesmo verde — e é a
#: garantia central do ADR 0014.
EDICOES: tuple[Edicao, ...] = (
    Edicao(
        "UPDATE categorias SET nome = 'Pastelaria' WHERE slug = 'cafetaria'",
        "Categoria «cafetaria»",
        "Pastelaria",
        "Cafetaria",
    ),
    Edicao(
        "UPDATE categorias SET ordem = 77 WHERE slug = 'espirituosas'",
        "Categoria «espirituosas»",
        "77",
        "11",
    ),
    Edicao(
        "UPDATE produtos SET nome = 'Chá' WHERE id = 1",
        "Produto 1",
        "Chá",
        "Café",
    ),
    # O preço mostra-se em euros **e** em cêntimos: euros porque quem lê é
    # uma pessoa deste bar, cêntimos porque é o número que está na coluna
    # e é com ele que se faz o `UPDATE` que resolve a divergência.
    Edicao(
        "UPDATE produtos SET preco_cent = 999 WHERE id = 3",
        "Produto 3",
        "9,99 € (999 cêntimos)",
        "2,30 € (230)",
    ),
    Edicao(
        "UPDATE produtos SET categoria_id = "
        "(SELECT id FROM categorias WHERE slug = 'gin') WHERE id = 1",
        "Produto 1",
        "gin",
        "cafetaria",
    ),
    Edicao(
        "UPDATE eventos SET titulo = 'Serão de poesia' WHERE id = 1",
        "Evento 1",
        "Serão de poesia",
        "Noite de fados",
    ),
    Edicao(
        "UPDATE eventos SET inicio = '2030-01-01 00:00:00' WHERE id = 1",
        "Evento 1",
        "2030-01-01T00:00:00+00:00",
        INICIO_DE_VERAO_UTC,
    ),
    Edicao(
        "UPDATE eventos SET descricao = 'Outra coisa qualquer' WHERE id = 1",
        "Evento 1",
        "Outra coisa qualquer",
        "Fado & petiscos",
    ),
    Edicao(
        "UPDATE eventos SET imagem = 'outro-cartaz.jpg' WHERE id = 1",
        "Evento 1",
        "outro-cartaz.jpg",
        IMAGEM_DE_VERAO,
    ),
    # O décimo caso não é uma décima comparação: é a mesma da imagem, com
    # o lado do destino a `NULL`. Está aqui porque «(sem valor)» é a única
    # forma em que o `_valor` aparece sem aspas, e porque um `NULL` que se
    # lesse como "igual" era uma divergência a passar em silêncio.
    Edicao(
        "UPDATE eventos SET imagem = NULL WHERE id = 1",
        "Evento 1",
        "(sem valor)",
        IMAGEM_DE_VERAO,
    ),
)


def _linha_da_divergencia(resultado: ResultadoDaImportacao, ancora: str) -> str | None:
    """A primeira linha do relatório que fala da divergência de `ancora`."""
    for linha in resultado.tudo.splitlines():
        if ancora in linha and "a origem diz" in linha:
            return linha
    return None


@pytest.mark.parametrize("edicao", EDICOES, ids=lambda e: e.ancora + ": " + e.sql[:40])
def test_a_segunda_corrida_nao_esmaga_o_que_foi_editado_na_gestao(
    edicao: Edicao,
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Depois de o dono corrigir uma linha, correr outra vez não lha apaga.

    É o caso que importa mais do que parece, e é a troca que o ADR 0014
    escolheu: a importação não se corre uma vez só — corre-se, vê-se o
    site, corrige-se a origem, corre-se outra vez. Entre uma e outra, o
    dono já mexeu na gestão. Uma importação que "sincronize" desfaz-lhe o
    trabalho sem dizer nada; uma que ignore em silêncio deixa-o a achar que
    a origem está certa. Lista a divergência e sai com estado diferente de
    zero.

    **Um caso por comparação, e não só o preço.** Uma comparação que
    desapareça não dá erro nenhum: a linha já existe no destino, por isso
    não entra nas listas de inserção, e o script sai com **estado 0** e com
    «Já lá estava tudo» sobre um destino que contradiz a origem. Com oito
    das nove comparações sem rede, era o guarda central do ADR 0014 a
    poder cair sem a bateria dar por nada.

    As duas pistas são procuradas **na mesma linha**, a que traz a âncora:
    procurá-las no relatório inteiro deixava passar um valor ecoado noutro
    sítio qualquer — o nome «Cafetaria» aparece na linha das categorias,
    e o 11 aparece em qualquer contagem.

    **Deixa passar:** a redação da linha de divergência, e os campos que o
    script **não** compara de propósito (`produtos.ordem`,
    `produtos.disponivel`, `categorias.visivel`, `eventos.publicado`) —
    esses são os interruptores do dia-a-dia do dono, e se contassem como
    divergência a segunda corrida recusava tudo no dia a seguir.
    """
    primeira = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    assert primeira.estado == 0, primeira.relatorio()

    despejo_antes = despejo(destino_em_head)
    ligacao = sqlite3.connect(destino_em_head)
    try:
        ligacao.execute(edicao.sql)
        ligacao.commit()
    finally:
        ligacao.close()
    despejo_editado = despejo(destino_em_head)
    assert despejo_editado != despejo_antes, (
        f"o SQL do caso não mudou nada no destino: «{edicao.sql}». Um caso "
        "que não edita nada fica verde sem provar coisa nenhuma"
    )

    segunda = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert segunda.estado != 0, (
        "a segunda corrida passou por cima de uma edição do dono sem se "
        f"queixar\n{segunda.relatorio()}"
    )
    linha = _linha_da_divergencia(segunda, edicao.ancora)
    assert linha is not None, (
        f"não há no relatório uma linha de divergência sobre «{edicao.ancora}»"
        f"\n{segunda.relatorio()}"
    )
    for pista in (edicao.no_destino, edicao.na_origem):
        assert pista in linha, (
            "a divergência tem de nomear os dois valores — o que está no "
            f"destino e o que a origem diz —, e a linha «{linha}» não traz "
            f"«{pista}»\n{segunda.relatorio()}"
        )
    assert despejo(destino_em_head) == despejo_editado, (
        "a segunda corrida escreveu no destino em cima de uma divergência; "
        f"o ADR 0014 diz que não se toca em nada\n{segunda.relatorio()}"
    )


# =========================================================================
# Os pontos onde o script tem de falhar alto
# =========================================================================


@pytest.fixture(scope="module")
def recusas(
    tmp_path_factory: pytest.TempPathFactory, _destino_modelo_em_head: Path
) -> dict[str, RecusaCorrida]:
    """Todos os cenários de recusa, corridos uma vez cada.

    Âmbito de módulo para o teste caso a caso, o teste das mensagens
    diferentes e os testes de imagens partilharem as mesmas corridas: são
    tantos subprocessos quantos os cenários, não o triplo.

    Os cenários que dependem de permissões não se correm a partir de
    `root`, onde um `0444` se abre para escrita na mesma. Ficam **fora do
    dicionário**, e quem os pedir leva um `skip` com razão à vista — nunca
    um verde por não terem corrido.
    """
    raiz = tmp_path_factory.mktemp("recusas-f2-08")
    return {
        cenario.chave: correr_cenario_de_recusa(
            cenario, _destino_modelo_em_head, raiz / cenario.chave
        )
        for cenario in CENARIOS_DE_RECUSA
        if not (cenario.exige_permissoes and A_CORRER_COMO_ROOT)
    }


@pytest.mark.parametrize("cenario", CENARIOS_DE_RECUSA, ids=lambda c: c.chave)
def test_o_script_recusa_e_nomeia_a_linha_problematica(
    cenario: CenarioDeRecusa, recusas: dict[str, RecusaCorrida]
) -> None:
    """Falha alto, com uma mensagem que diz **qual** é a linha, e não escreve nada.

    O porquê de cada caso está no próprio cenário, em
    `tests/apoio_legado.CENARIOS_DE_RECUSA`. O que todos têm em comum: sair
    com zero com problemas por resolver é o pior resultado possível, porque
    o dono fecha o terminal e vai ver o site.

    O caso `origem-sem-produtos` é a regra 10 em forma de dados: "importei
    zero produtos" e "abri a cópia errada" não podem dar o mesmo relatório
    verde.

    **Deixa passar:** a redação da mensagem. Pede-se que contenha o id da
    linha e, quando é legível, o valor — não uma frase em particular. Que
    as mensagens sejam **diferentes umas das outras** é o teste a seguir.
    """
    if cenario.exige_permissoes and A_CORRER_COMO_ROOT:
        pytest.skip(
            f"{cenario.chave} depende das permissões do sistema de ficheiros, "
            "e a correr como root um 0444 abre-se para escrita na mesma"
        )
    corrida = recusas[cenario.chave]

    assert corrida.resultado.estado != 0, (
        f"{cenario.chave}: {cenario.porque}\n{corrida.resultado.relatorio()}"
    )
    for pista in cenario.pistas:
        assert pista in corrida.resultado.tudo, (
            f"{cenario.chave}: a mensagem não nomeia «{pista}», e sem isso "
            "quem for corrigir a origem tem 140 produtos e nenhum sítio por "
            f"onde começar\n{corrida.resultado.relatorio()}"
        )
    if cenario.destino == "head":
        assert contagens(corrida.destino) == TABELAS_DO_DESTINO_VAZIAS, (
            f"{cenario.chave}: o script recusou mas deixou linhas escritas; "
            f"é tudo numa transação ou não é nada\n"
            f"{corrida.resultado.relatorio()}"
        )
    assert ficheiros_em(corrida.media) == corrida.media_antes, (
        f"{cenario.chave}: o script recusou mas o MEDIA_DIR mudou. Uma "
        "imagem copiada numa corrida que não escreveu nada na base de dados "
        f"fica lá órfã para sempre\n{corrida.resultado.relatorio()}"
    )


def test_cada_recusa_tem_mensagem_propria(recusas: dict[str, RecusaCorrida]) -> None:
    """Nenhuma recusa diz o mesmo que outra, com os dados do caso postos de parte.

    É a regra 10 aplicada a texto, como na F2-10: duas mensagens iguais em
    ramos diferentes dizem à pessoa que aconteceu a mesma coisa quando não
    aconteceu, e uma cópia distraída não dá erro nenhum. "O preço é nulo" e
    "o preço está vazio" são problemas diferentes, com correções
    diferentes, e não podem partilhar a frase.

    A comparação é feita sobre o **conjunto** das linhas do relatório que
    mencionam a âncora do cenário, com o id, o valor, os caminhos e os
    números trocados por marcas: duas mensagens que só difiram no número da
    linha contam como iguais, que é o que se quer apanhar. Os caminhos saem
    porque cada cenário corre no seu `tmp_path`, com o nome do cenário lá
    dentro — sem isso, o teste ficava verde por causa da pasta.

    **Deixa passar:** mensagens diferentes mas igualmente inúteis. "Erro
    1", "Erro 2" passavam. O teste anterior é que exige que nomeiem a
    linha.

    **E deixa passar mais isto, que é honesto escrever:** as linhas
    escolhem-se por conterem a âncora do cenário, procurada no texto por
    **ler**, antes de os caminhos serem postos de parte. Se o número do
    `tmp_path` desta corrida contiver, por acaso, o id de um dos cenários
    (um `pytest-1391` e o cenário do preço nulo, que é o 91), uma linha que
    ecoe um caminho entra no conjunto desse cenário e não no dos outros, e
    o teste fica verde por causa da pasta. É improvável e o resultado é um
    falso verde, nunca um falso vermelho — e o teste de cima, que é o que
    exige a linha nomeada, não depende disto.
    """
    frases: dict[str, frozenset[str]] = {}
    for cenario in CENARIOS_DE_RECUSA:
        if cenario.chave not in recusas:
            # A correr como `root`: os cenários de permissões não correram
            # (ver a fixture). Saem da comparação em vez de contarem como
            # mensagens iguais — ou de rebentarem num `KeyError`.
            continue
        resultado = recusas[cenario.chave].resultado
        frase = frase_da_recusa(resultado, cenario)
        assert frase, (
            f"{cenario.chave}: não encontrei nenhuma linha do relatório que "
            f"mencione «{cenario.ancora}»\n{resultado.relatorio()}"
        )
        frases[cenario.chave] = frase

    repetidas: dict[frozenset[str], list[str]] = {}
    for chave, frase in frases.items():
        repetidas.setdefault(frase, []).append(chave)
    iguais = {
        tuple(sorted(frase)): chaves
        for frase, chaves in repetidas.items()
        if len(chaves) > 1
    }

    assert not iguais, (
        "estes cenários partilham a mesma mensagem, e são problemas "
        f"diferentes com correções diferentes: {iguais}"
    )


def test_o_relatorio_distingue_nao_havia_nada_de_nao_consegui(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
    recusas: dict[str, RecusaCorrida],
) -> None:
    """Três resultados, três frases: importei isto, não havia nada, não consegui.

    As duas primeiras saem com estado 0 e a terceira não — mas o estado de
    saída é o que o terminal vê, não o que o dono lê. Em palavras, as três
    conclusões têm de ser diferentes, e nenhuma pode ser um pedaço de
    outra: "Importação concluída." e "Importação concluída. 0 linhas." não
    distinguem nada para quem passa os olhos.

    **Deixa passar:** o que as frases dizem. Só se exige que sejam três, e
    que nenhuma esteja contida noutra.
    """
    primeira = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    assert primeira.estado == 0, primeira.relatorio()
    segunda = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    assert segunda.estado == 0, segunda.relatorio()
    recusada = recusas["origem-sem-produtos"].resultado
    assert recusada.estado != 0, recusada.relatorio()

    conclusoes = {
        "importou": primeira.conclusao,
        "nada para fazer": segunda.conclusao,
        "não consegui": recusada.conclusao,
    }
    for rotulo, frase in conclusoes.items():
        assert frase, f"o relatório de «{rotulo}» não tem conclusão nenhuma"

    for rotulo, frase in conclusoes.items():
        for outro_rotulo, outra in conclusoes.items():
            if rotulo == outro_rotulo:
                continue
            assert frase not in outra, (
                f"a conclusão de «{rotulo}» («{frase}») está contida na de "
                f"«{outro_rotulo}» («{outra}»). São três resultados "
                "diferentes e têm de se ler como três"
            )


# =========================================================================
# O relatório: o que lá está escrito, e como está escrito
# =========================================================================


def test_as_tres_conclusoes_comecam_por_palavras_diferentes(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
    recusas: dict[str, RecusaCorrida],
) -> None:
    """A **primeira palavra** de cada conclusão arruma o resultado.

    O teste de cima — nenhuma conclusão contida noutra — é o que uma
    máquina verifica; o olho não faz essa verificação. «Não havia nada por
    importar» e «Não importei nada» passavam nele e eram, de relance, a
    mesma frase: mesma palavra inicial, mesma negação, mesmo verbo. E são
    precisamente as duas que mais interessa distinguir, porque uma é
    sucesso e a outra não.

    **Deixa passar:** três primeiras palavras diferentes mas igualmente
    opacas. «Alfa», «Beta» e «Gama» passavam. O que as faz dizer alguma
    coisa é o olho de quem as escreveu — e o runbook, que as cita.
    """
    primeira = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    assert primeira.estado == 0, primeira.relatorio()
    segunda = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    assert segunda.estado == 0, segunda.relatorio()
    recusada = recusas["origem-sem-produtos"].resultado
    assert recusada.estado != 0, recusada.relatorio()

    conclusoes = {
        "importou": primeira.conclusao,
        "nada para fazer": segunda.conclusao,
        "não consegui": recusada.conclusao,
    }
    primeiras = {rotulo: frase.split()[0] for rotulo, frase in conclusoes.items()}
    assert len(set(primeiras.values())) == 3, (
        "duas das três conclusões começam pela mesma palavra, e a primeira "
        f"palavra é a que arruma o resultado de relance: {primeiras}"
    )


def test_nenhuma_recusa_imprime_uma_lista_do_python(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """Nenhuma mensagem traz um `repr` de lista: `['eventos', 'produtos']`.

    O `_valor` do script foi escrito de propósito para não deixar sair
    `repr` para o relatório, e havia três sítios que não passavam por lá:
    a versão do `alembic_version`, as tabelas em falta na origem e as
    cabeças das migrações. Parênteses retos com plicas lá dentro são
    código a aparecer num texto que é para uma pessoa ler — e `[]`, que é
    o que uma `alembic_version` vazia dava, não quer dizer nada a ninguém.

    **Deixa passar:** `repr` de outras coisas (um tuplo, um dicionário,
    um `datetime`), e uma lista impressa num relatório de sucesso. Os três
    sítios conhecidos são todos em recusas.
    """
    marca = re.compile(r"\['|'\]")
    com_repr = {
        chave: [
            linha
            for linha in corrida.resultado.tudo.splitlines()
            if marca.search(linha)
        ]
        for chave, corrida in recusas.items()
    }
    sujas = {chave: linhas for chave, linhas in com_repr.items() if linhas}
    assert not sujas, (
        "estas recusas trazem um `repr` de lista do Python para dentro do "
        f"relatório: {sujas}"
    )


def test_o_destino_fora_de_head_nomeia_a_versao_entre_aspas(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """«está na versão «0000naoexiste»», e não «está na versão ['0000naoexiste']».

    **Deixa passar:** as outras duas formas da mesma frase — a de zero
    versões e a de duas ou mais. A primeira não se consegue montar com um
    destino que o `alembic` criou, e a segunda exigia duas cabeças nas
    migrações desta instalação.
    """
    resultado = recusas["destino-fora-de-head"].resultado
    assert f"está na versão «{VERSAO_INVENTADA}»" in resultado.tudo, (
        "a recusa do destino fora de `head` tem de nomear a versão como um "
        f"valor, não como uma lista\n{resultado.relatorio()}"
    )


def test_uma_origem_sem_as_tabelas_nomeia_as_que_faltam(
    tmp_path: Path, destino_em_head: Path, pasta_de_imagens: Path, media_dir: Path
) -> None:
    """«não tem as tabelas eventos e produtos», e não «['eventos', 'produtos']».

    Um ficheiro SQLite vazio é o que se obtém ao copiar a base de dados
    errada, ou ao copiar um ficheiro a meio. A recusa tem de dizer **o que
    falta** numa frase que se leia.

    **Deixa passar:** o caso de faltar só uma tabela — a frase muda para o
    singular e isso não é exercitado aqui.
    """
    vazia = tmp_path / "origem-vazia" / "legado-falso-f2-08.db"
    vazia.parent.mkdir(parents=True, exist_ok=True)
    sqlite3.connect(vazia).close()

    resultado = correr_importador(
        origem=vazia,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert "não tem as tabelas eventos e produtos" in resultado.tudo, (
        "a recusa tem de nomear as tabelas em falta numa frase, não num "
        f"`repr` de lista\n{resultado.relatorio()}"
    )
    assert contagens(destino_em_head) == TABELAS_DO_DESTINO_VAZIAS, (
        resultado.relatorio()
    )


def test_a_recusa_de_tipo_desconhecido_nomeia_as_categorias_da_carta(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """A recusa mais provável na base de dados real diz **quais** são os tipos.

    «O tipo «cocktails» não é nenhum dos doze» obriga quem lê a ir
    procurar a lista a outro sítio — e a lista está num dicionário dentro
    do script. Com 140 produtos à frente, às três da manhã, a diferença
    entre uma gralha («whiskies») e uma categoria nova vê-se a olhar para
    a lista, não de cor.

    **Deixa passar:** a ordem em que os tipos aparecem na frase, e a nota
    sobre o «Bebidas» com maiúscula.
    """
    resultado = recusas["tipo-desconhecido"].resultado
    em_falta = [
        esperada.slug
        for esperada in CATEGORIAS_ESPERADAS
        if esperada.slug not in resultado.tudo
    ]
    assert not em_falta, (
        "a recusa de tipo desconhecido tem de enumerar os tipos da carta "
        f"antiga, e não nomeia {em_falta}\n{resultado.relatorio()}"
    )


def test_as_recusas_das_imagens_dizem_o_que_fazer_a_seguir(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """As duas recusas de imagens dizem o passo seguinte, não só o diagnóstico.

    São as duas que acontecem com o terminal aberto e a pasta à mão: uma
    tem porta de saída conhecida (`--imagens ignorar`, e os eventos entram
    sem cartaz), a outra resolve-se a mexer no `MEDIA_DIR`. Sem a frase,
    quem lê fica a saber o que correu mal e não o que fazer.

    **Deixa passar:** a redação. Exige-se que a porta de saída esteja
    nomeada, não como.
    """
    em_falta = recusas["imagem-em-falta"].resultado
    assert "--imagens ignorar" in em_falta.tudo, (
        "a recusa de imagem em falta tem de nomear a porta de saída\n"
        f"{em_falta.relatorio()}"
    )
    diferente = recusas["imagem-diferente-no-media"].resultado
    assert "outro conteúdo" in diferente.tudo, (
        "«outros bytes» é linguagem de quem escreveu o script; quem lê o "
        f"relatório tem um ficheiro à frente\n{diferente.relatorio()}"
    )
    assert str(recusas["imagem-diferente-no-media"].media) in diferente.tudo, (
        "a recusa tem de dizer em que pasta se trata do assunto\n"
        f"{diferente.relatorio()}"
    )


def test_o_relatorio_nomeia_as_categorias_a_juncao_e_os_nomes_mudados(
    cenario_feliz: CenarioImportado,
) -> None:
    """Três números sem nomes não deixam ninguém confirmar o «Feito quando».

    O critério da F2-08 é «o Tomás confirma 140 produtos e 11 categorias»,
    e cada uma destas linhas responde a uma pergunta que alguém faz a
    olhar para o relatório:

    - **quais** são as categorias e por que ordem aparecem na ementa;
    - **porque é que são onze** se a origem tem doze `tipo` — sem esta
      linha, quem conta onze sabendo que tinha doze pensa que se perdeu
      uma categoria pelo caminho;
    - **que nomes mudam** no site novo, porque `portos` sai como «Vinhos
      do Porto» e `whiskys` como «Whisky», e isso a olhar para a ementa
      parece um erro de importação.

    **Deixa passar:** a redação das três linhas, e o caso de três ou mais
    formas do mesmo `tipo` — a base de dados falsa só tem o par
    «Bebidas»/«bebidas». O que **não** deixa passar é a junção ser escrita
    à mão para o par das bebidas: a frase nomeia as duas formas tal como
    estão na origem, e um par novo na base de dados real sai nela sem
    ninguém mexer no script.
    """
    relatorio = cenario_feliz.resultado.tudo
    assert cenario_feliz.resultado.estado == 0, cenario_feliz.resultado.relatorio()

    esperada = "Categorias, por esta ordem na ementa: " + ", ".join(
        categoria.nome for categoria in CATEGORIAS_ESPERADAS
    )
    assert esperada in relatorio, (
        "falta a linha com as categorias nomeadas, por ordem na ementa\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )

    assert "Os tipos «Bebidas» e «bebidas» são o mesmo" in relatorio, (
        "falta a linha que explica porque é que doze `tipo` dão onze "
        f"categorias\n{cenario_feliz.resultado.relatorio()}"
    )
    assert "ficam todos em «Bebidas»" in relatorio, cenario_feliz.resultado.relatorio()

    for mudado in ("«portos» passa a «Vinhos do Porto»", "«whiskys» passa a «Whisky»"):
        assert mudado in relatorio, (
            f"falta «{mudado}» na linha dos nomes que mudam\n"
            f"{cenario_feliz.resultado.relatorio()}"
        )
    assert "espirituosas» passa a" not in relatorio, (
        "«espirituosas» -> «Espirituosas» é só a maiúscula e não conta como "
        f"mudança de nome\n{cenario_feliz.resultado.relatorio()}"
    )


def test_o_relatorio_lista_os_textos_que_descodificou(
    cenario_feliz: CenarioImportado,
) -> None:
    """Os nomes da carta que o script reescreveu dizem-se, um a um.

    São nomes do dono a serem mudados por um script. A contagem sozinha
    não deixa confirmar que mudaram para o que deviam: `J&amp;B` tanto
    pode dar `J&B` como `J&amp;B` outra vez, e a diferença vê-se no
    relatório ou não se vê em lado nenhum.

    **Deixa passar:** as descrições de evento, que só se contam — uma
    descrição pode ter parágrafos e parte a linha do relatório ao meio.
    """
    relatorio = cenario_feliz.resultado.tudo
    assert "Textos descodificados:" in relatorio, cenario_feliz.resultado.relatorio()
    assert "6 nomes de produto" in relatorio, (
        "a contagem dos nomes de produto descodificados está errada\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )
    assert "1 descrição de evento" in relatorio, (
        "a descrição do evento 1 também passou pelo descodificador\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )
    assert "Produto 15: «J&amp;B» -> «J&B»" in relatorio, (
        "o antes e o depois de cada nome têm de estar na mesma linha\n"
        f"{cenario_feliz.resultado.relatorio()}"
    )


# =========================================================================
# --esperar-produtos e --esperar-categorias
# =========================================================================

#: Quantos produtos e quantas categorias a base de dados falsa traz. São o
#: equivalente, em miniatura, dos 140 e dos 11 da base de dados real.
PRODUTOS_DA_BD_FALSA = len(PRODUTOS)
CATEGORIAS_DA_BD_FALSA = len(CATEGORIAS_ESPERADAS)


def test_com_os_numeros_certos_a_importacao_corre_na_mesma(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Os números a bater não mudam nada: importa e sai com zero.

    **Deixa passar:** um guarda que aceite tudo. É o teste a seguir que
    exige que ele recuse quando o número não bate.
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        argumentos_extra=(
            "--esperar-produtos",
            str(PRODUTOS_DA_BD_FALSA),
            "--esperar-categorias",
            str(CATEGORIAS_DA_BD_FALSA),
        ),
    )
    assert resultado.estado == 0, resultado.relatorio()
    assert len(ler_produtos(destino_em_head)) == PRODUTOS_DA_BD_FALSA, (
        resultado.relatorio()
    )
    assert len(ler_categorias(destino_em_head)) == CATEGORIAS_DA_BD_FALSA, (
        resultado.relatorio()
    )


@pytest.mark.parametrize(
    ("bandeira", "esperado", "encontrado"),
    [
        ("--esperar-produtos", "140", str(PRODUTOS_DA_BD_FALSA)),
        ("--esperar-categorias", "3", str(CATEGORIAS_DA_BD_FALSA)),
    ],
    ids=["produtos", "categorias"],
)
def test_um_numero_que_nao_bate_recusa_e_nao_escreve_nada(
    bandeira: str,
    esperado: str,
    encontrado: str,
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """É assim que o «Feito quando» da F2-08 se confirma na máquina do Tomás.

    O critério é «confirma 140 produtos e 11 categorias», e lê-lo no
    relatório não é confirmá-lo: ler um número e concordar com ele é o
    mesmo gesto. Com a bandeira, o número vai **antes**, na linha de
    comandos, e é a máquina que o confere — sem nós vermos um único dado
    do bar.

    A recusa acontece **antes** de qualquer escrita: um número que não
    bate quer dizer, quase sempre, que a cópia não é a que se pensa, e aí
    não se escreve nem uma linha nem um ficheiro.

    **Deixa passar:** números negativos ou absurdos passados à bandeira —
    nunca batem, e a recusa diz exatamente isso.
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        argumentos_extra=(bandeira, esperado),
    )

    assert resultado.estado != 0, (
        f"{bandeira} {esperado} não bate com o que a origem tem, e o script "
        f"importou na mesma\n{resultado.relatorio()}"
    )
    for pista in (esperado, encontrado, bandeira):
        assert pista in resultado.tudo, (
            f"a recusa tem de nomear «{pista}»\n{resultado.relatorio()}"
        )
    assert contagens(destino_em_head) == TABELAS_DO_DESTINO_VAZIAS, (
        "o guarda das contagens tem de recusar antes de escrever\n"
        f"{resultado.relatorio()}"
    )
    assert ficheiros_em(media_dir) == {}, (
        "o guarda das contagens tem de recusar antes de copiar imagens\n"
        f"{resultado.relatorio()}"
    )


# =========================================================================
# O quarto resultado: um defeito do script
# =========================================================================


def test_um_defeito_do_script_tem_conclusao_propria_e_nao_se_cala(
    tmp_path: Path,
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Uma exceção inesperada sai com conclusão em `stdout` e traceback em `stderr`.

    O gatilho é um **índice único que o esquema não tem**, posto à mão no
    destino sobre `produtos.categoria_id`: o segundo produto da mesma
    categoria faz o `flush` levantar `IntegrityError`. É literalmente a
    família que o `except Exception` do `main` existe para apanhar, e é de
    propósito que não há guarda nenhum a prevê-la: o `problemas_do_destino`
    confere a versão do `alembic_version`, não o esquema linha a linha, e
    um destino com qualquer coisa a mais lá dentro é exatamente o que
    **não se consegue** antecipar.

    (O gatilho já foi outro — um `MEDIA_DIR` a apontar para um ficheiro —
    e deixou de servir no dia em que isso passou a ter recusa própria. É a
    vida de um teste destes: à medida que as condições previsíveis ganham
    nome, o "imprevisto" tem de ser procurado mais fundo.)

    Sem o `except Exception` do `main`, isto saía em `stderr`, com estado
    diferente de zero e **sem linha nenhuma de conclusão**: um quarto
    resultado sem frase, encostado às três que têm uma, e o relatório a
    contradizer o próprio docstring do script.

    A exceção volta a ser levantada de propósito. O traceback é a única
    coisa que diz **onde** rebentou, e engoli-lo era trocar um defeito
    visível por um silencioso.

    **Deixa passar:** o que acontece a meio de uma cópia de imagens que
    falhe no terceiro ficheiro. Aqui rebenta antes da primeira cópia.
    """
    ligacao = sqlite3.connect(destino_em_head)
    try:
        ligacao.execute("CREATE UNIQUE INDEX ix_inesperado ON produtos (categoria_id)")
        ligacao.commit()
    finally:
        ligacao.close()

    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado != 0, resultado.relatorio()
    linhas = [linha for linha in resultado.stdout.splitlines() if linha.strip()]
    assert linhas, f"não saiu nada em stdout\n{resultado.relatorio()}"
    assert linhas[-1].startswith("Rebentei a meio"), (
        "a última linha do relatório tem de ser uma conclusão, e um defeito "
        "do script tem a sua — diferente das três de sempre\n"
        f"{resultado.relatorio()}"
    )
    assert "não é uma recusa" in linhas[-1], (
        "a conclusão tem de dizer que isto não é uma recusa: uma recusa "
        "corrige-se na origem, um defeito abre uma tarefa\n"
        f"{resultado.relatorio()}"
    )
    assert "O erro foi: IntegrityError" in resultado.stdout, (
        "o detalhe do erro tem de sair em linha própria, antes da conclusão: "
        "a mensagem de um IntegrityError traz o SQL e os parâmetros em "
        "várias linhas, e dentro da conclusão fazia da última linha do "
        f"relatório um pedaço de um URL\n{resultado.relatorio()}"
    )
    assert "Traceback (most recent call last)" in resultado.stderr, (
        "a exceção tem de ser re-levantada: o traceback é a única coisa que "
        f"diz onde rebentou\n{resultado.relatorio()}"
    )
    assert contagens(destino_em_head) == TABELAS_DO_DESTINO_VAZIAS, (
        "rebentou a meio e deixou linhas escritas; é tudo numa transação ou "
        f"não é nada\n{resultado.relatorio()}"
    )
    assert ficheiros_em(media_dir) == {}, (
        "rebentou antes do `commit`, e as imagens copiam-se antes dele: "
        f"nenhuma pode ter ficado no MEDIA_DIR\n{resultado.relatorio()}"
    )


def test_o_media_dir_a_apontar_para_um_ficheiro_recusa_com_frase_propria(
    tmp_path: Path,
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Um `MEDIA_DIR` que existe e não é pasta é configuração, não defeito.

    Não há como criar uma pasta por cima de um ficheiro, e o
    `mkdir(exist_ok=True)` da cópia das imagens levantava `FileExistsError`
    — um `OSError` a cair no balde do «Rebentei a meio», que manda abrir
    uma tarefa. A correção é uma linha no ficheiro de ambiente, e a
    mensagem tem de o dizer.

    **Deixa passar:** um `MEDIA_DIR` cujo **antepassado** seja um ficheiro
    com mais do que um nível de distância — a procura sobe até ao primeiro
    que exista, e o teste só exercita o caso direto.
    """
    ficheiro = tmp_path / "isto-nao-e-uma-pasta"
    ficheiro.write_text("o MEDIA_DIR aponta para aqui, e aqui é um ficheiro")

    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        ambiente_extra={"MEDIA_DIR": str(ficheiro)},
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert "não é uma pasta" in resultado.tudo, (
        "a recusa tem de dizer o que está errado com o MEDIA_DIR\n"
        f"{resultado.relatorio()}"
    )
    assert "MEDIA_DIR" in resultado.tudo and str(ficheiro) in resultado.tudo, (
        "a recusa tem de nomear a variável e o caminho que ela traz\n"
        f"{resultado.relatorio()}"
    )
    assert "Rebentei a meio" not in resultado.tudo, (
        "isto é uma condição previsível com correção de uma linha; não pode "
        f"sair como defeito do script\n{resultado.relatorio()}"
    )
    assert contagens(destino_em_head) == TABELAS_DO_DESTINO_VAZIAS, (
        resultado.relatorio()
    )


def test_a_recusa_do_nome_de_imagem_com_pontos_duplos_nomeia_o_check(
    recusas: dict[str, RecusaCorrida],
) -> None:
    """A recusa do `..` diz qual é o `CHECK` da base de dados que o proíbe.

    Sem isto o guarda não tinha rede nenhuma: tirado do script, a mesma
    linha recusava à mesma — mas por «a imagem não está na pasta», que é
    outro problema, com outra correção, e que manda quem lê procurar um
    ficheiro que não é suposto existir. É a regra 10: duas causas
    diferentes não podem dar a mesma mensagem.

    **Deixa passar:** a redação à volta. Exige-se o nome do `CHECK`, que
    é o que liga a recusa à regra que a obriga.
    """
    resultado = recusas["imagem-com-pontos-duplos"].resultado
    assert "ck_eventos_imagem_sem_caminho" in resultado.tudo, (
        "a recusa tem de nomear o CHECK que proíbe o «..»; sem ele, esta "
        "linha confunde-se com a de uma imagem que falta na pasta\n"
        f"{resultado.relatorio()}"
    )


def test_um_evento_com_visivel_a_nulo_entra_por_publicar_e_a_nota_diz_porque(
    tmp_path: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """`visivel` a `NULL` na origem não é «não publicar» nem «publicar»: diz-se.

    A coluna tem `DEFAULT 1` no esquema do site antigo, por isso um `NULL`
    lá dentro foi escrito por alguém de propósito e não se sabe o que
    queria dizer. O evento entra **por publicar** — que é o lado que o dono
    desfaz na gestão com um clique — e o relatório diz que foi isso que
    aconteceu, em vez de decidir em silêncio.

    E a nota escreve-se **sem plicas invertidas à volta do nome da
    coluna**: no terminal elas saem literais, e à volta de `visivel` são
    ruído. Nos comandos (`alembic upgrade head`) são convenção aceitável e
    ficam.

    **Deixa passar:** a redação da nota. Exige-se que nomeie o evento, a
    coluna e o que foi decidido.
    """
    origem = construir_bd_antiga_falsa(
        tmp_path / "origem",
        eventos=(
            *EVENTOS,
            EventoAntigo(81, "Festa sem visivel", "2026-07-01", None, None, None),
        ),
    )
    resultado = correr_importador(
        origem=origem,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert "Evento 81: a coluna visivel da origem está a NULL" in resultado.tudo, (
        "a nota tem de nomear o evento e a coluna, e sem plicas invertidas "
        f"à volta do nome da coluna\n{resultado.relatorio()}"
    )
    eventos = {evento.id: evento for evento in ler_eventos(destino_em_head)}
    assert eventos[81].publicado is False, (
        "um `visivel` a NULL entra por publicar: é o lado que se desfaz com "
        f"um clique na gestão\n{resultado.relatorio()}"
    )


# =========================================================================
# Permissões: o que a simulação tem de saber dizer antes do dia a sério
# =========================================================================


@pytest.mark.skipif(
    A_CORRER_COMO_ROOT,
    reason="a correr como root, um 0444 abre-se para escrita na mesma",
)
@pytest.mark.parametrize(
    ("o_que", "modo", "pista"),
    [
        ("destino", 0o444, "está em só-leitura"),
        ("pasta-do-destino", 0o555, "onde o destino está"),
        ("media", 0o555, "não me deixa escrever, e há"),
    ],
    ids=["destino", "pasta-do-destino", "media"],
)
def test_a_simulacao_recusa_as_permissoes_que_o_aplicar_ia_encontrar(
    o_que: str,
    modo: int,
    pista: str,
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Sem `--aplicar`, as três recusas de permissões acontecem à mesma.

    É o ponto todo da simulação: quem simula está a perguntar **se o
    `--aplicar` vai correr bem**. Uma simulação verde seguida de um
    `--aplicar` que rebenta é o pior dos resultados possíveis — é a rede
    que a simulação existe para dar, desperdiçada, e descoberta no dia em
    que já não há volta atrás barata.

    E não é hipotético: a simulação **também** abre o destino para escrita
    (corre a transação toda e desfá-la, que é o que faz um `CHECK`
    aparecer na simulação e não só no dia em que se aplica). Com o destino
    em só-leitura, era lá que ela rebentava.

    **Deixa passar:** a redação das três recusas — isso é o teste caso a
    caso dos cenários. Aqui só se exige que o modo de simulação não seja
    mais permissivo do que o de escrita.
    """
    alvos = {
        "destino": destino_em_head,
        "pasta-do-destino": destino_em_head.parent,
        "media": media_dir,
    }
    alvo = alvos[o_que]
    original = alvo.stat().st_mode
    alvo.chmod(modo)
    try:
        resultado = correr_importador(
            origem=origem_falsa,
            destino=destino_em_head,
            imagens=pasta_de_imagens,
            media=media_dir,
            aplicar=False,
        )
    finally:
        alvo.chmod(original)

    assert resultado.estado != 0, (
        f"a simulação passou com o {o_que} em só-leitura; o --aplicar ia "
        f"rebentar e ninguém ficou a saber\n{resultado.relatorio()}"
    )
    assert pista in resultado.tudo, (
        f"a simulação recusou mas não disse porquê: falta «{pista}»\n"
        f"{resultado.relatorio()}"
    )
    assert "Rebentei a meio" not in resultado.tudo, (
        "uma permissão errada é condição previsível com correção de uma "
        f"linha, não um defeito do script\n{resultado.relatorio()}"
    )


@pytest.mark.skipif(
    A_CORRER_COMO_ROOT,
    reason="a correr como root, um 0444 abre-se para escrita na mesma",
)
def test_a_verificacao_de_escrita_nao_escreve_nem_deixa_vizinhos(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Perguntar «dá para escrever?» não pode ser uma escrita.

    A verificação abre o destino em `r+b` e fecha-o. A mesma propriedade
    que `tests/seguranca/test_importador_nao_le_dados_pessoais.py` já
    exige da origem — `sha256` e `mtime` em nanossegundos iguais, e nada
    de ficheiros novos ao lado — passa a valer também para o destino
    numa corrida que **recusa**: um ficheiro temporário de teste ao lado
    da base de dados seria uma escrita a sério, numa pasta que em
    produção é a do dono.

    A corrida escolhida é a que recusa pelo **esquema** (destino fora de
    `head`), e não uma que recuse pelas permissões: assim a verificação de
    escrita corre com permissão para escrever, que é o caso em que ela
    poderia mesmo deixar alguma coisa para trás.

    Os sidecars do SQLite (`-wal`, `-shm`) são a exceção, e não é a
    verificação que os põe lá: o destino está em WAL, e é a ligação **só
    de leitura** que lê o `alembic_version` que precisa do índice do WAL
    para o conseguir ler. Já lá estavam antes desta correção, e saem da
    comparação pelo nome — o que não pode aparecer é um ficheiro de teste
    com outro nome qualquer.

    **Deixa passar:** uma escrita e uma reposição dos mesmos bytes dentro
    do mesmo nanossegundo. É o mesmo buraco que o teste da origem tem, e
    pela mesma razão: não há relógio mais fino à mão.
    """
    ligacao = sqlite3.connect(destino_em_head)
    try:
        ligacao.execute(
            "UPDATE alembic_version SET version_num = ?", (VERSAO_INVENTADA,)
        )
        ligacao.commit()
    finally:
        ligacao.close()

    pasta = destino_em_head.parent
    antes = impressao_digital(destino_em_head)
    vizinhos_antes = sorted(caminho.name for caminho in pasta.iterdir())

    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado != 0, resultado.relatorio()
    depois = impressao_digital(destino_em_head)
    assert depois[0] == antes[0], (
        f"o sha256 do destino mudou numa corrida que recusou\n{resultado.relatorio()}"
    )
    assert depois[1] == antes[1], (
        "o sha256 ficou igual e a mtime mudou: a verificação de escrita "
        f"escreveu e repôs\n{resultado.relatorio()}"
    )
    sidecars = {destino_em_head.name + sufixo for sufixo in SUFIXOS_SIDECAR}
    vizinhos_depois = sorted(
        caminho.name for caminho in pasta.iterdir() if caminho.name not in sidecars
    )
    assert vizinhos_depois == vizinhos_antes, (
        "apareceram ficheiros ao lado do destino "
        f"({sorted(set(vizinhos_depois) - set(vizinhos_antes))}). Perguntar "
        "«dá para escrever?» não pode deixar um ficheiro de teste para trás\n"
        f"{resultado.relatorio()}"
    )


@pytest.mark.skipif(
    A_CORRER_COMO_ROOT,
    reason="a correr como root, um 0555 deixa escrever na mesma",
)
def test_um_media_dir_sem_escrita_nao_recusa_quando_nao_ha_nada_para_copiar(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """O guarda do `MEDIA_DIR` cala-se quando não há imagens para lá pôr.

    É o outro lado do guarda, e tem de ser dito: na segunda corrida as
    imagens já lá estão, nada se copia, e um `MEDIA_DIR` em só-leitura não
    impede coisa nenhuma. Recusar aí era recusar uma corrida que
    funcionava — e, pior, era ensinar quem corre isto que o relatório se
    queixa de coisas que não interessam, que é como se começa a ignorar
    recusas a sério.

    **Deixa passar:** uma segunda corrida em que uma das imagens mudou na
    origem. Essa pára antes, no «já existe com outro conteúdo».
    """
    primeira = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )
    assert primeira.estado == 0, primeira.relatorio()
    assert ficheiros_em(media_dir) == MEDIA_DEPOIS_DA_CORRIDA, primeira.relatorio()

    original = media_dir.stat().st_mode
    media_dir.chmod(0o555)
    try:
        segunda = correr_importador(
            origem=origem_falsa,
            destino=destino_em_head,
            imagens=pasta_de_imagens,
            media=media_dir,
        )
    finally:
        media_dir.chmod(original)

    assert segunda.estado == 0, (
        "o MEDIA_DIR em só-leitura recusou uma corrida que não tinha nada "
        f"para lá copiar\n{segunda.relatorio()}"
    )
    assert "Já lá estava tudo" in segunda.tudo, segunda.relatorio()
