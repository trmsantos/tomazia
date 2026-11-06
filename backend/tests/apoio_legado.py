"""Apoio da F2-08: a base de dados antiga **falsa** e o lançador do importador.

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_esquema.py` e `tests/apoio_subprocesso.py` não são. É usado
por `tests/test_importar_bd_antiga.py` e por
`tests/seguranca/test_importador_nao_le_dados_pessoais.py`.

## A regra que manda em tudo

**A base de dados real do site antigo nunca entra no repositório e nunca é
lida.** Nem por um teste, nem por um comando, nem por acidente. Há um hook
do projeto (`.claude/hooks/proteger.sh`) que bloqueia qualquer comando que
lhe mencione o nome. O que estes testes usam é uma base de dados **falsa**,
construída aqui, em `tmp_path`, com um nome que não se parece nada com o da
real (`legado-falso-f2-08.db`).

## O esquema vem do disco, nunca de DDL copiado para dentro do teste

`construir_bd_antiga_falsa` lê `docs/legado/esquema-bd-antiga.sql` do disco
e passa-o a `sqlite3.executescript()`. Não há uma única linha de DDL neste
módulo, e `tests/test_importar_bd_antiga.py` tem um teste que o verifica no
próprio código-fonte deste ficheiro.

A razão é a ordem em que as coisas se partem. Com o DDL copiado para dentro
do teste, uma correção ao esquema documentado — uma coluna que afinal
existe, um `NOT NULL` que afinal não existe — deixava a bateria verde e
partia a importação no dia do deploy, em cima da base de dados real do
dono, que é a única cópia que existe. A ler do disco, parte-se o teste
primeiro.

## O contrato do script, que estes testes fixam

O script é `backend/scripts/importar_bd_antiga.py` (a
`docs/ESPECIFICACAO.md`, linha 47, chama-lhe `scripts/importar_bd_antiga.py`
— os `scripts/` do backend, por `backend/CLAUDE.md`). Corre-se assim:

```bash
AMBIENTE=... python scripts/importar_bd_antiga.py \
    --origem /caminho/para/a/copia/da/bd/antiga.db \
    --imagens /caminho/para/a/pasta/das/imagens \
    --aplicar                                    # ou: --imagens ignorar
```

- **`--origem` (obrigatório)**: a base de dados antiga. Aberta **só para
  leitura** — e isso prova-se, não se promete: ver
  `tests/seguranca/test_importador_nao_le_dados_pessoais.py`.
- **`--imagens` (obrigatório, sem omissão)**: ou uma pasta, ou a palavra
  `ignorar`. Não há omissão de propósito: "este evento não tem imagem" e
  "ninguém me disse o que fazer às imagens" não podem acabar os dois em
  `NULL` sem nada no caminho a dizer qual é qual.

  Com **uma pasta**, cada imagem referida é procurada lá e **copiada para
  o `MEDIA_DIR`**, com o nome de ficheiro já reduzido. Verificar que
  existe não chega: um evento com `imagem = "x.jpg"` que o `media/` não
  serve é uma imagem partida no site, e o Tomás escolheu "quero as
  imagens". Três regras:

  1. pára no primeiro que falte na pasta de origem, com o evento nomeado;
  2. o nome de destino é o mesmo nome reduzido (o que já passa o
     `ck_eventos_imagem_sem_caminho`);
  3. se já existir um ficheiro com esse nome no `MEDIA_DIR`: **iguais byte
     a byte** → não copia e conta como "já lá estava"; **diferentes** →
     pára. Nunca sobrepõe. É o ADR 0014 aplicado aos ficheiros — só
     insere — e um ficheiro sobreposto não se recupera como uma linha de
     base de dados.

  Com **`ignorar`**, `eventos.imagem` fica a `NULL`, nada se copia, e o
  relatório **lista** as que ficaram de fora.
- **O destino vem da configuração** (`BASE_DADOS_URL`), como no `alembic`
  — ver `tests/apoio_esquema.ambiente_do_alembic`. O `MEDIA_DIR` e o
  `DATA_DIR` vêm da mesma configuração, e nos testes apontam também para
  dentro de `tmp_path`: os valores por omissão de `app/config.py` são
  relativos à pasta de trabalho, que neste subprocesso é `backend/` — sem
  os definir, um script que copiasse imagens escrevia-as dentro do
  repositório. `AMBIENTE` não tem omissão (`backend/CLAUDE.md`), e os
  `scripts/` corridos por SSH são precisamente o caso que essa
  obrigatoriedade existe para apanhar.
- **`--aplicar` (opcional, e é ele que escreve)**: sem ele o script
  **simula** — lê tudo, diz o que faria, e não deixa nada escrito nem na
  base de dados nem no `MEDIA_DIR`. É a decisão do Tomás na entrada da
  F2-08, e tem data: a importação a sério corre por SSH, em produção, e a
  F2-02 (que traz o `scripts/backup.py` para desfazer) ainda não está
  fundida. A outra metade da mesma decisão é o **caminho do destino na
  primeira linha do relatório**, para quem corre isto ver em que base de
  dados vai mexer antes de ver o resto.

  Por isso `correr_importador` passa `--aplicar` por omissão: a esmagadora
  maioria destes testes afirma o que ficou **escrito**, e sem a opção não
  ficava lá nada. Quem quiser exercitar a simulação passa
  `aplicar=False` — é o que faz
  `test_sem_aplicar_o_script_simula_e_nao_escreve_nada`.
- **Estado de saída**: `0` quando a importação se fez (ou quando não havia
  nada para fazer), diferente de zero quando o script **recusou**. Nunca
  `0` com problemas por resolver.
- **Relatório**: em `stdout` (os problemas podem ir para `stderr`). A
  **última linha não vazia** é a conclusão — é por aí que
  `ResultadoDaImportacao.conclusao` a lê, e é a conclusão que tem de
  distinguir, em palavras diferentes, "importei isto", "não havia nada para
  fazer" e "não consegui fazer".

Se o implementador precisar de mudar esta forma, muda-se aqui e nos testes
que a usam — mas muda-se de propósito, não por distração.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import NamedTuple

import pytest

from tests import apoio_esquema

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
RAIZ_REPO = RAIZ_BACKEND.parent

#: O esquema documentado do site antigo. Lido do disco, sempre.
CAMINHO_ESQUEMA_LEGADO = RAIZ_REPO / "docs" / "legado" / "esquema-bd-antiga.sql"

#: O script que a F2-08 tem de escrever. Ainda não existe: é por isso que
#: estes testes nascem vermelhos.
CAMINHO_SCRIPT = RAIZ_BACKEND / "scripts" / "importar_bd_antiga.py"

#: Nome do ficheiro da base de dados falsa. Nada parecido com o da real, de
#: propósito: quem vir este nome num `ls` sabe imediatamente que está a
#: olhar para dados inventados.
NOME_DA_BD_FALSA = "legado-falso-f2-08.db"

#: Nome do ficheiro de destino nos testes. Distintivo para as mensagens de
#: recusa o poderem nomear sem ambiguidade.
NOME_DO_DESTINO = "destino-de-teste-f2-08.db"

MENSAGEM_SCRIPT_EM_FALTA = (
    f"{CAMINHO_SCRIPT.relative_to(RAIZ_REPO)} ainda não existe. É o script "
    "da F2-08, e é isto que estes testes existem para pedir: enquanto ele "
    "não aterrar, toda a bateria do importador falha aqui, nesta mensagem, "
    "e não num `ImportError` nem num caminho mal escrito."
)

# --- Os marcadores de dados pessoais -------------------------------------
#
# Cadeias únicas e improváveis. Se alguma delas aparecer num byte da base
# de dados de destino ou numa linha do relatório, o importador leu (e
# escreveu, ou imprimiu) dados que a especificação diz que não importa.
# Ver `tests/seguranca/test_importador_nao_le_dados_pessoais.py`.

MARCADOR_PASSWORD_ADMIN = "psw-marcador-4f8b2a1c9d7e-nao-pode-sair-da-origem"
MARCADOR_EMAIL_CLIENTE = "marcador-6e1d9b3a7c5f@exemplo.test"


# --- As linhas da base de dados antiga ------------------------------------


class ProdutoAntigo(NamedTuple):
    """Uma linha de `produtos` do site antigo."""

    id_produto: int
    nome_prod: str | None
    preco: object
    tipo: str | None


class EventoAntigo(NamedTuple):
    """Uma linha de `eventos` do site antigo."""

    id: int
    nome_evento: str
    data_evento: str
    descricao: str | None
    imagem_url: str | None
    visivel: int


# Os doze valores de `produtos.tipo` que `docs/legado/esquema-bd-antiga.sql`
# documenta. A lista está escrita aqui **e** lá; o teste
# `test_os_doze_tipos_da_bd_falsa_sao_os_que_o_esquema_documenta` prende as
# duas uma à outra, para esta não envelhecer em silêncio.
TIPOS_ANTIGOS = (
    "Bebidas",
    "bebidas",
    "aguardentes",
    "brandy",
    "cafetaria",
    "comidas",
    "espirituosas",
    "gin",
    "licores",
    "martinis",
    "portos",
    "whiskys",
)


class CategoriaEsperada(NamedTuple):
    """Uma categoria do site novo: o `slug`, o nome que o cliente lê, a ordem."""

    slug: str
    nome: str
    ordem: int


#: As onze categorias decididas pelo Tomás em 2026-10-29
#: (`docs/TAREFAS.md`, entrada F2-08): nome que o cliente lê e ordem na
#: ementa. Três mudam de forma face ao `tipo` antigo — `portos` dá "Vinhos
#: do Porto", `whiskys` dá "Whisky", `espirituosas` fica na forma curta —,
#: por isso **não** é a primeira letra em maiúscula: é um mapeamento
#: explícito.
#:
#: **O `slug` vem do `tipo` antigo normalizado, não do nome novo**, e isso
#: não é estética. A âncora da ementa é `#ementa-<slug>` (secção 2 da
#: `docs/ecras/F3-02.md`): com o `slug` a sair do nome visível, o dono a
#: renomear uma categoria na gestão partia as ligações que alguém tivesse
#: guardado. É também o que o ADR 0014 fixa — a chave das categorias é o
#: `slug` normalizado do `tipo`, e é a normalização que junta `Bebidas` e
#: `bebidas`. Daí `portos` com o nome "Vinhos do Porto" e `whiskys` com o
#: nome "Whisky".
CATEGORIAS_ESPERADAS: tuple[CategoriaEsperada, ...] = (
    CategoriaEsperada("cafetaria", "Cafetaria", 1),
    CategoriaEsperada("comidas", "Comidas", 2),
    CategoriaEsperada("bebidas", "Bebidas", 3),
    CategoriaEsperada("aguardentes", "Aguardentes", 4),
    CategoriaEsperada("portos", "Vinhos do Porto", 5),
    CategoriaEsperada("licores", "Licores", 6),
    CategoriaEsperada("martinis", "Martinis", 7),
    CategoriaEsperada("brandy", "Brandy", 8),
    CategoriaEsperada("whiskys", "Whisky", 9),
    CategoriaEsperada("gin", "Gin", 10),
    CategoriaEsperada("espirituosas", "Espirituosas", 11),
)

#: `tipo` antigo -> nome da categoria nova. `Bebidas` e `bebidas` apontam
#: para a mesma: são doze chaves e onze valores distintos.
CATEGORIA_DO_TIPO: dict[str, str] = {
    "cafetaria": "Cafetaria",
    "comidas": "Comidas",
    "Bebidas": "Bebidas",
    "bebidas": "Bebidas",
    "aguardentes": "Aguardentes",
    "portos": "Vinhos do Porto",
    "licores": "Licores",
    "martinis": "Martinis",
    "brandy": "Brandy",
    "whiskys": "Whisky",
    "gin": "Gin",
    "espirituosas": "Espirituosas",
}


class ProdutoEsperado(NamedTuple):
    """O que uma linha de `PRODUTOS` tem de dar no destino."""

    id: int
    nome: str
    preco_cent: int
    categoria: str


# --- Os produtos da base de dados falsa -----------------------------------
#
# As armadilhas estão semeadas de propósito e cada uma tem um comentário a
# dizer qual é. Os `id_produto` saltam no fim (57) para que "o id do site
# antigo é a chave" seja uma afirmação com conteúdo: uma importação que
# renumerasse as linhas passaria despercebida com ids 1..22 seguidos.

PRODUTOS: tuple[ProdutoAntigo, ...] = (
    # `real` -> CAST(0.80 AS TEXT) dá '0.8'. E com um espaço no fim do
    # nome, de propósito: é a única fixtura que exercita o `strip()` do
    # importador. Sem ela, tirar o `strip()` do script deixava a bateria
    # verde — e «Café » é um produto a mais na ementa e um produto a menos
    # numa pesquisa por «Café».
    ProdutoAntigo(1, "Café ", 0.80, "cafetaria"),
    # `text` com vírgula decimal, como o site antigo às vezes guardava.
    ProdutoAntigo(2, "Galão", "1,20", "cafetaria"),
    # O caso que denuncia o defeito clássico: `int(2.30 * 100)` dá **229**.
    ProdutoAntigo(3, "Tosta mista", 2.30, "comidas"),
    # `integer`: quatro euros certos.
    ProdutoAntigo(4, "Bifana", 4, "comidas"),
    # Zero é um preço legítimo (o `CHECK` do modelo é `>= 0`, não `> 0`).
    ProdutoAntigo(5, "Água de cortesia", 0, "Bebidas"),
    # Um `&` **literal**, que não é entidade nenhuma: tem de ficar tal e
    # qual. O site antigo é inconsistente a aplicar `htmlspecialchars`.
    ProdutoAntigo(6, "Cerveja & tremoços", 1.80, "Bebidas"),
    ProdutoAntigo(7, "Ginger ale", "2,50", "bebidas"),
    # `&lt;` e `&gt;`, as outras duas entidades do `htmlspecialchars`.
    ProdutoAntigo(8, "Tónica &lt;sem açúcar&gt;", 2.10, "bebidas"),
    ProdutoAntigo(9, "Aguardente velha", 3.50, "aguardentes"),
    ProdutoAntigo(10, "Porto Tawny", 2.80, "portos"),
    ProdutoAntigo(11, "Ginjinha", 1.50, "licores"),
    # `&apos;`, que o `htmlspecialchars` não produz mas que aparece em
    # texto colado de outro sítio.
    ProdutoAntigo(12, "Amarguinha &apos;mini&apos;", 1.90, "licores"),
    ProdutoAntigo(13, "Martini Bianco", 2.70, "martinis"),
    ProdutoAntigo(14, "Brandy Macieira", 2.20, "brandy"),
    # As quatro da F3-02: `&`, apóstrofo e algarismos em nomes de marca.
    ProdutoAntigo(15, "J&amp;B", 3.10, "whiskys"),
    ProdutoAntigo(16, "Ballantine&#039;s", 3.20, "whiskys"),
    ProdutoAntigo(17, "Chivas 12 anos", 4.50, "whiskys"),
    ProdutoAntigo(18, "Four Roses", 4.60, "whiskys"),
    # `&#39;`, a variante sem o zero à esquerda.
    ProdutoAntigo(19, "Jack Daniel&#39;s", 4.80, "whiskys"),
    ProdutoAntigo(20, "Gin Beefeater", 5.40, "gin"),
    # `&quot;`.
    ProdutoAntigo(21, "Vodka &quot;da casa&quot;", 3.30, "espirituosas"),
    # A armadilha medida do `html.unescape`: ele é generoso de mais e
    # transforma `Gin &copy tonico` em `Gin © tonico` — sem ponto e
    # vírgula, e `copy` nem sequer está na lista do `htmlspecialchars`. O
    # descodificador restrito tem de deixar isto exatamente como está.
    ProdutoAntigo(57, "Gin &copy tonico", 5.20, "gin"),
)

PRODUTOS_ESPERADOS: tuple[ProdutoEsperado, ...] = (
    ProdutoEsperado(1, "Café", 80, "Cafetaria"),
    ProdutoEsperado(2, "Galão", 120, "Cafetaria"),
    ProdutoEsperado(3, "Tosta mista", 230, "Comidas"),
    ProdutoEsperado(4, "Bifana", 400, "Comidas"),
    ProdutoEsperado(5, "Água de cortesia", 0, "Bebidas"),
    ProdutoEsperado(6, "Cerveja & tremoços", 180, "Bebidas"),
    ProdutoEsperado(7, "Ginger ale", 250, "Bebidas"),
    ProdutoEsperado(8, "Tónica <sem açúcar>", 210, "Bebidas"),
    ProdutoEsperado(9, "Aguardente velha", 350, "Aguardentes"),
    ProdutoEsperado(10, "Porto Tawny", 280, "Vinhos do Porto"),
    ProdutoEsperado(11, "Ginjinha", 150, "Licores"),
    ProdutoEsperado(12, "Amarguinha 'mini'", 190, "Licores"),
    ProdutoEsperado(13, "Martini Bianco", 270, "Martinis"),
    ProdutoEsperado(14, "Brandy Macieira", 220, "Brandy"),
    ProdutoEsperado(15, "J&B", 310, "Whisky"),
    ProdutoEsperado(16, "Ballantine's", 320, "Whisky"),
    ProdutoEsperado(17, "Chivas 12 anos", 450, "Whisky"),
    ProdutoEsperado(18, "Four Roses", 460, "Whisky"),
    ProdutoEsperado(19, "Jack Daniel's", 480, "Whisky"),
    ProdutoEsperado(20, "Gin Beefeater", 540, "Gin"),
    ProdutoEsperado(21, 'Vodka "da casa"', 330, "Espirituosas"),
    ProdutoEsperado(57, "Gin &copy tonico", 520, "Gin"),
)


# --- Os eventos da base de dados falsa ------------------------------------

#: O nome do ficheiro da imagem do evento de verão, já reduzido.
IMAGEM_DE_VERAO = "fados.jpg"
#: O nome do ficheiro da imagem do evento de inverno, já reduzido.
IMAGEM_DE_INVERNO = "natal.jpg"
#: Um nome de ficheiro acima dos 64 caracteres de `eventos.imagem`.
NOME_DE_IMAGEM_COMPRIDO = "a" * 70 + ".jpg"

EVENTOS: tuple[EventoAntigo, ...] = (
    # Verão: é **esta** que distingue a implementação certa da errada.
    # Meia-noite de 1 de julho em Lisboa é 2026-06-30T23:00:00Z.
    # A descrição acaba em mudança de linha de propósito, e é o par
    # negativo do «Café »: o nome e o título **levam** `strip()`, a
    # descrição **não**. A assimetria é defensável — a descrição é prosa,
    # e as pontas dela são escolhas de quem escreveu — mas tem de estar
    # presa por uma fixtura, senão alguém "arruma" o script um dia e
    # ninguém dá por isso.
    EventoAntigo(
        1,
        "Noite de fados",
        "2026-07-01",
        "Fado &amp; petiscos\n",
        f"img/uploads/{IMAGEM_DE_VERAO}",
        1,
    ),
    # Inverno: em Lisboa coincide com UTC. Sozinha, deixava passar o
    # defeito; está aqui para provar que o caso fácil também continua certo.
    # `visivel = 0` de propósito: é o único evento com data que não é para
    # publicar, e é por ele que se prova que `publicado` segue o `visivel`
    # do site antigo.
    # O espaço no fim do título é o par do «Café » dos produtos: prende o
    # `strip()` do título do evento, que de outra forma não tinha fixtura
    # nenhuma a exercitá-lo.
    EventoAntigo(
        2,
        "Jantar de Natal ",
        "2026-12-20",
        None,
        f"img/uploads/{IMAGEM_DE_INVERNO}",
        0,
    ),
    # Os dois dias de mudança de hora de 2026 (ADR 0010, consequências). A
    # meia-noite destes dias Lisboa ainda está no fuso **anterior**, por
    # isso os cortes são 2026-03-29T00:00:00Z e 2026-10-24T23:00:00Z. Uma
    # implementação com "+1h no verão" escrita à mão acerta no primeiro e
    # falha no segundo; só com os dois é que os quatro casos de conversão
    # ficam cobertos.
    EventoAntigo(3, "Jantar de primavera", "2026-03-29", None, None, 1),
    EventoAntigo(4, "Jantar de outono", "2026-10-25", None, None, 1),
    # `data_evento` a `''` apesar do `NOT NULL` — o contorno do site PHP.
    # `visivel = 1` de propósito: a regra da data ganha ao `visivel`, e sem
    # este 1 não haveria nada a prová-lo. Sem imagem nenhuma, que é o que
    # separa "este evento não tem imagem" de "ninguém me disse o que fazer
    # às imagens".
    EventoAntigo(9, "Karaoke", "", None, None, 1),
)


class EventoEsperado(NamedTuple):
    """O que uma linha de `EVENTOS` tem de dar no destino.

    `imagem` é o que se espera com `--imagens <pasta>`; com
    `--imagens ignorar` é `None` para todos.
    """

    id: int
    titulo: str
    inicio: str | None
    imagem: str | None
    publicado: bool


#: O instante esperado para o evento de verão, em UTC (ADR 0010).
INICIO_DE_VERAO_UTC = "2026-06-30T23:00:00+00:00"
#: O instante esperado para o evento de inverno, em UTC.
INICIO_DE_INVERNO_UTC = "2026-12-20T00:00:00+00:00"
#: 29 de março de 2026: o relógio adianta-se à 01:00 local, por isso a
#: meia-noite desse dia ainda é WET (UTC+0).
INICIO_DA_MUDANCA_DE_MARCO_UTC = "2026-03-29T00:00:00+00:00"
#: 25 de outubro de 2026: o relógio atrasa-se às 02:00 local, por isso a
#: meia-noite desse dia ainda é WEST (UTC+1).
INICIO_DA_MUDANCA_DE_OUTUBRO_UTC = "2026-10-24T23:00:00+00:00"

EVENTOS_ESPERADOS: tuple[EventoEsperado, ...] = (
    EventoEsperado(1, "Noite de fados", INICIO_DE_VERAO_UTC, IMAGEM_DE_VERAO, True),
    EventoEsperado(
        2, "Jantar de Natal", INICIO_DE_INVERNO_UTC, IMAGEM_DE_INVERNO, False
    ),
    EventoEsperado(
        3, "Jantar de primavera", INICIO_DA_MUDANCA_DE_MARCO_UTC, None, True
    ),
    EventoEsperado(4, "Jantar de outono", INICIO_DA_MUDANCA_DE_OUTUBRO_UTC, None, True),
    EventoEsperado(9, "Karaoke", None, None, False),
)


# --- Fotos, clientes e admins: o que **não** se importa --------------------

FOTOS: tuple[tuple[object, ...], ...] = (
    (
        1,
        "foto de teste",
        "img/uploads/teste-do-site-antigo.jpg",
        "A foto de teste que o site antigo tem",
        "2024-01-01 10:00:00",
        1,
        "aprovada",
        "alguem",
        1,
    ),
)

ADMINS: tuple[tuple[object, ...], ...] = ((1, "tomazia", MARCADOR_PASSWORD_ADMIN),)

CLIENTES: tuple[tuple[object, ...], ...] = (
    (
        1,
        1,
        "Cliente de Exemplo",
        MARCADOR_EMAIL_CLIENTE,
        "912345678",
        "2024-02-02 11:00:00",
    ),
)


# --- Construir a base de dados antiga falsa -------------------------------


def ler_esquema_legado() -> str:
    """O texto de `docs/legado/esquema-bd-antiga.sql`, lido do disco.

    Rebenta em voz alta se o ficheiro não existir: um esquema em falta tem
    de ser um erro com nome, não uma base de dados falsa vazia a fazer
    falhar vinte testes por razões que não dizem nada.
    """
    if not CAMINHO_ESQUEMA_LEGADO.is_file():
        raise RuntimeError(
            f"não encontrei {CAMINHO_ESQUEMA_LEGADO}. É o esquema documentado "
            "do site antigo, e é dele que a base de dados falsa nasce — "
            "nunca de DDL copiado para dentro dos testes."
        )
    return CAMINHO_ESQUEMA_LEGADO.read_text(encoding="utf-8")


def tipos_documentados_no_esquema() -> tuple[str, ...]:
    """Os valores de `produtos.tipo` que o comentário do esquema enumera.

    O comentário parte-se por duas linhas, por isso junta-se o que vem a
    seguir ao marcador até ao primeiro ponto final. Se esse comentário
    mudar de forma, isto rebenta — e é suposto: é a ligação entre a lista
    de `TIPOS_ANTIGOS` e o documento que a sustenta.
    """
    marcador = "Valores de produtos.tipo encontrados:"
    linhas = ler_esquema_legado().splitlines()
    indice = next(
        (i for i, linha in enumerate(linhas) if marcador in linha),
        None,
    )
    if indice is None:
        raise RuntimeError(
            f"não encontrei «{marcador}» em {CAMINHO_ESQUEMA_LEGADO.name}. "
            "É daí que sai a lista dos doze `tipo` do site antigo."
        )

    recolhido = linhas[indice].split(marcador, 1)[1]
    seguinte = indice + 1
    while "." not in recolhido and seguinte < len(linhas):
        if not linhas[seguinte].startswith("--"):
            break
        recolhido += " " + linhas[seguinte].lstrip("-").strip()
        seguinte += 1

    if "." not in recolhido:
        raise RuntimeError(
            "a enumeração dos `tipo` no esquema documentado não termina em "
            f"ponto final; li «{recolhido.strip()}»"
        )
    return tuple(
        parte.strip()
        for parte in recolhido.split(".", 1)[0].split(",")
        if parte.strip()
    )


def construir_bd_antiga_falsa(
    pasta: Path,
    *,
    produtos: Sequence[ProdutoAntigo] = PRODUTOS,
    eventos: Sequence[EventoAntigo] = EVENTOS,
    fotos: Sequence[Sequence[object]] = FOTOS,
    admins: Sequence[Sequence[object]] = ADMINS,
    clientes: Sequence[Sequence[object]] = CLIENTES,
    nome: str = NOME_DA_BD_FALSA,
) -> Path:
    """Cria a base de dados antiga **falsa** em `pasta` e devolve o caminho.

    O esquema vem de `docs/legado/esquema-bd-antiga.sql`, lido do disco e
    passado a `sqlite3.executescript()`. Os dados são todos inventados e
    estão em `PRODUTOS`, `EVENTOS`, `FOTOS`, `ADMINS` e `CLIENTES`, com
    marcadores em `admin_users.psw` e em `tomazia_clientes.email`.
    """
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / nome
    if caminho.exists():
        raise RuntimeError(
            f"{caminho} já existe. A base de dados falsa constrói-se uma vez "
            "por teste, num `tmp_path` novo; reescrever por cima deixaria "
            "linhas de um teste a aparecer no seguinte."
        )

    ligacao = sqlite3.connect(caminho)
    try:
        ligacao.executescript(ler_esquema_legado())
        ligacao.executemany(
            "INSERT INTO produtos (id_produto, nome_prod, preco, tipo) "
            "VALUES (?, ?, ?, ?)",
            [tuple(linha) for linha in produtos],
        )
        ligacao.executemany(
            "INSERT INTO eventos "
            "(id, nome_evento, data_evento, descricao, imagem_url, visivel) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [tuple(linha) for linha in eventos],
        )
        ligacao.executemany(
            "INSERT INTO fotos (id, nome_foto, caminho, descricao, data_upload, "
            "visivel, status, uploaded_by, is_admin_upload) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [tuple(linha) for linha in fotos],
        )
        ligacao.executemany(
            "INSERT INTO admin_users (id, username, psw) VALUES (?, ?, ?)",
            [tuple(linha) for linha in admins],
        )
        ligacao.executemany(
            "INSERT INTO tomazia_clientes "
            "(id, user_id, nome, email, telemovel, data_registro) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [tuple(linha) for linha in clientes],
        )
        ligacao.commit()
    finally:
        ligacao.close()
    return caminho


#: O conteúdo de cada ficheiro de imagem falso. Texto, não um JPEG: o
#: `--imagens <pasta>` verifica que o ficheiro **existe** e copia-o; não
#: abre nem recodifica (isso é o caminho dos uploads, F2-06). Se um dia
#: passar a abrir as imagens com Pillow, é aqui que isto muda — e o teste
#: que o pedir tem de o dizer no nome.
BYTES_DA_IMAGEM_FALSA = b"nao e uma imagem a serio, e uma fixtura"

#: O ficheiro que fica **fora** da pasta das imagens e fora do `MEDIA_DIR`,
#: e que uma ligação simbólica tentaria alcançar. O conteúdo imita o que
#: está do outro lado no caso real medido pelo revisor: o `.env` da
#: instalação, com o segredo da sessão lá dentro.
NOME_DO_SEGREDO = "fora-das-pastas.env"
BYTES_DO_SEGREDO = b"SEGREDO_SESSAO=marcador-9a2c7f-nao-pode-sair-daqui\n"


def criar_pasta_de_imagens(
    pasta: Path, *, nomes: Sequence[str] = (IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO)
) -> Path:
    """Uma pasta com os ficheiros de imagem que os eventos referem."""
    pasta.mkdir(parents=True, exist_ok=True)
    for nome in nomes:
        (pasta / nome).write_bytes(BYTES_DA_IMAGEM_FALSA)
    return pasta


def criar_segredo_fora_das_pastas(raiz: Path) -> Path:
    """O ficheiro que nenhuma ligação simbólica pode conseguir alcançar.

    Fica numa pasta irmã da das imagens e da do `MEDIA_DIR` — nunca dentro
    de nenhuma delas —, para que "chegou ao `MEDIA_DIR`" e "foi escrito
    por cima" sejam afirmações que se verificam a olhar para um sítio só.
    """
    pasta = raiz / "fora"
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / NOME_DO_SEGREDO
    caminho.write_bytes(BYTES_DO_SEGREDO)
    return caminho


def criar_ligacao(pasta: Path, nome: str, alvo: Path) -> Path:
    """Uma ligação simbólica `pasta/nome` -> `alvo`, criada mesmo.

    Criada e não simulada: o que está em causa é o `Path.is_file()` e o
    `shutil.copyfile` seguirem-nas, e isso só se prova com uma ligação
    verdadeira no sistema de ficheiros. `alvo` pode nem existir — uma
    ligação pendurada é o caso que faz o `copyfile` **criar** o ficheiro
    do outro lado.
    """
    pasta.mkdir(parents=True, exist_ok=True)
    ligacao = pasta / nome
    ligacao.symlink_to(alvo)
    return ligacao


# --- Correr o importador --------------------------------------------------


@dataclass(frozen=True)
class ResultadoDaImportacao:
    """O que o subprocesso do importador disse."""

    estado: int
    stdout: str
    stderr: str
    comando: tuple[str, ...]

    @property
    def tudo(self) -> str:
        """`stdout` e `stderr` juntos, que é onde o relatório pode estar."""
        return self.stdout + self.stderr

    @property
    def conclusao(self) -> str:
        """A última linha não vazia do relatório.

        Contrato deste módulo (ver o docstring do topo): é esta linha que
        tem de distinguir, em palavras diferentes, "importei isto", "não
        havia nada para fazer" e "não consegui fazer".
        """
        linhas = [linha.strip() for linha in self.tudo.splitlines() if linha.strip()]
        return linhas[-1] if linhas else ""

    def relatorio(self, rotulo: str = "importar_bd_antiga.py") -> str:
        """Tudo o que o subprocesso disse, para a mensagem de asserção.

        Regra 10 do `CLAUDE.md`: um estado de saída diferente de zero tanto
        quer dizer "recusei, com uma mensagem" como "rebentei a importar".
        A mensagem traz `stdout` e `stderr` para que a diferença se veja
        sem reproduzir nada à mão.
        """
        return (
            f"{rotulo} {' '.join(self.comando)}\n"
            f"terminou com estado {self.estado}\n"
            f"--- stdout ---\n{self.stdout}\n"
            f"--- stderr ---\n{self.stderr}"
        )


def exigir_script() -> Path:
    """O caminho do importador, ou um erro que diz que ele ainda não existe.

    Chamado antes de cada corrida. É o que faz toda a bateria da F2-08
    falhar com uma frase que nomeia a tarefa em falta, em vez de um
    `FileNotFoundError` do `subprocess` ou — pior — de um `ImportError` a
    meio da recolha dos testes, que não distingue "o script não existe" de
    "o teste está mal escrito".
    """
    if not CAMINHO_SCRIPT.is_file():
        raise RuntimeError(MENSAGEM_SCRIPT_EM_FALTA)
    return CAMINHO_SCRIPT


def ambiente_do_importador(destino: Path, media: Path) -> dict[str, str]:
    """Ambiente mínimo do subprocesso, isolado do `backend/.env` real.

    Nunca se herda o ambiente de quem corre os testes, pela mesma razão que
    `apoio_esquema.ambiente_do_alembic` não o herda: a `BASE_DADOS_URL` tem
    de ser a do teste, e o ficheiro de ambiente tem de apontar para um
    caminho inexistente — senão é o `.env` do repositório a decidir qual é
    a base de dados que o script abre, e aqui o script **escreve**.

    `MEDIA_DIR` e `DATA_DIR` vão aqui pela mesma razão, e a segunda é a que
    tem dentes: os valores por omissão de `app/config.py` são `./var` e
    `./var/media`, **relativos à pasta de trabalho**, e a pasta de trabalho
    deste subprocesso é `backend/`. Sem estas duas linhas, um script que
    copiasse imagens escrevia-as dentro do repositório, na pasta `var/` de
    desenvolvimento de quem corre os testes.
    """
    return {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "PYTHONPATH": str(RAIZ_BACKEND),
        "AMBIENTE": "desenvolvimento",
        "BASE_DADOS_URL": f"sqlite:///{destino}",
        "DATA_DIR": str(media.parent / "dados"),
        "MEDIA_DIR": str(media),
        "TOMAZIA_ENV_FILE": str(
            destino.parent / "isolamento-de-testes-nao-existe" / ".env"
        ),
    }


def correr_importador(
    *,
    origem: Path,
    destino: Path,
    imagens: Path | str | None,
    media: Path,
    aplicar: bool = True,
    argumentos_extra: Sequence[str] = (),
    ambiente_extra: Mapping[str, str] | None = None,
    timeout: float = 180,
) -> ResultadoDaImportacao:
    """Corre o importador num subprocesso e devolve o que ele disse.

    `imagens=None` **omite** o `--imagens` de propósito: é assim que se
    exercita "ninguém me disse o que fazer às imagens". `media` é o
    `MEDIA_DIR` para onde as imagens dos eventos têm de ser copiadas.

    `aplicar=True` por omissão, e não porque `--aplicar` seja o modo
    normal do script — não é, ele simula por omissão (ver o contrato no
    topo). É porque quase todos estes testes afirmam o que ficou
    **escrito** no destino, e um `correr_importador` que simulasse
    deixava-os todos a olhar para uma base de dados vazia. Quem quiser a
    simulação pede-a com `aplicar=False`.

    `ambiente_extra` **sobrepõe-se** ao ambiente mínimo, e serve para os
    poucos testes em que a configuração é o que está a ser exercitado: uma
    `BASE_DADOS_URL` que não é SQLite, um `MEDIA_DIR` que não dá para
    criar. Fora desses, não se usa — o ambiente mínimo é o que mantém o
    `.env` do repositório fora disto.
    """
    script = exigir_script()
    comando = [sys.executable, str(script), "--origem", str(origem)]
    if imagens is not None:
        comando += ["--imagens", str(imagens)]
    if aplicar:
        comando.append("--aplicar")
    comando += list(argumentos_extra)

    ambiente = ambiente_do_importador(destino, media)
    ambiente.update(ambiente_extra or {})

    concluido = subprocess.run(
        comando,
        cwd=RAIZ_BACKEND,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return ResultadoDaImportacao(
        estado=concluido.returncode,
        stdout=concluido.stdout,
        stderr=concluido.stderr,
        comando=tuple(comando),
    )


# --- Ler o destino --------------------------------------------------------


def _ligar_so_leitura(destino: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{destino}?mode=ro", uri=True)


def ler_categorias(destino: Path) -> list[CategoriaEsperada]:
    """`(slug, nome, ordem)` de cada categoria, por ordem crescente de `ordem`."""
    ligacao = _ligar_so_leitura(destino)
    try:
        return [
            CategoriaEsperada(slug, nome, ordem)
            for slug, nome, ordem in ligacao.execute(
                "SELECT slug, nome, ordem FROM categorias ORDER BY ordem, slug"
            )
        ]
    finally:
        ligacao.close()


def ler_ordem_e_disponivel(destino: Path) -> dict[int, tuple[int, int]]:
    """Por id de produto, o `(ordem, disponivel)` com que ficou no destino."""
    ligacao = _ligar_so_leitura(destino)
    try:
        return {
            id_: (ordem, disponivel)
            for id_, ordem, disponivel in ligacao.execute(
                "SELECT id, ordem, disponivel FROM produtos"
            )
        }
    finally:
        ligacao.close()


def ler_produtos(destino: Path) -> list[ProdutoEsperado]:
    """`(id, nome, preco_cent, nome da categoria)` de cada produto, por id."""
    ligacao = _ligar_so_leitura(destino)
    try:
        return [
            ProdutoEsperado(id_, nome, preco_cent, categoria)
            for id_, nome, preco_cent, categoria in ligacao.execute(
                "SELECT p.id, p.nome, p.preco_cent, c.nome "
                "FROM produtos p JOIN categorias c ON c.id = p.categoria_id "
                "ORDER BY p.id"
            )
        ]
    finally:
        ligacao.close()


class EventoImportado(NamedTuple):
    """Um evento, lido do destino **pelos modelos da app**."""

    id: int
    titulo: str
    inicio: str | None
    descricao: str | None
    imagem: str | None
    publicado: bool


def ler_eventos(destino: Path) -> list[EventoImportado]:
    """Os eventos do destino, lidos pelo ORM e com o `inicio` em ISO/UTC.

    Pelo ORM de propósito, e não por `sqlite3` cru: é a coluna
    `DataHoraUTC` que diz se o que o script escreveu se relê como um
    instante em UTC. Um `INSERT` em SQL cru com hora local é **rotulado**
    UTC sem ser convertido (ver `app/models/tipos.py`), e é exatamente esse
    o defeito que a F2-01 deixou avisado para a F2-08.
    """
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from app.models import Evento

    motor = create_engine(f"sqlite:///{destino}")
    try:
        with Session(motor) as sessao:
            return [
                EventoImportado(
                    id=evento.id,
                    titulo=evento.titulo,
                    inicio=None if evento.inicio is None else evento.inicio.isoformat(),
                    descricao=evento.descricao,
                    imagem=evento.imagem,
                    publicado=bool(evento.publicado),
                )
                for evento in sessao.scalars(select(Evento).order_by(Evento.id))
            ]
    finally:
        motor.dispose()


def ler_eventos_como_esperados(destino: Path) -> list[EventoEsperado]:
    """Os eventos do destino na forma de `EVENTOS_ESPERADOS`, sem a descrição."""
    return [
        EventoEsperado(
            id=evento.id,
            titulo=evento.titulo,
            inicio=evento.inicio,
            imagem=evento.imagem,
            publicado=evento.publicado,
        )
        for evento in ler_eventos(destino)
    ]


def ficheiros_em(pasta: Path) -> dict[str, bytes]:
    """Nome -> conteúdo de cada ficheiro de `pasta`, sem descer a subpastas.

    Uma pasta que não existe conta como vazia, de propósito: "o script não
    copiou nada" e "o script nem chegou a criar a pasta" são a mesma
    afirmação para quem está a ver se as imagens aterraram.
    """
    if not pasta.is_dir():
        return {}
    return {
        caminho.name: caminho.read_bytes()
        for caminho in sorted(pasta.iterdir())
        if caminho.is_file()
    }


def contar(destino: Path, tabela: str) -> int:
    """Quantas linhas tem `tabela` no destino."""
    ligacao = _ligar_so_leitura(destino)
    try:
        (quantas,) = ligacao.execute(f"SELECT count(*) FROM {tabela}").fetchone()
        return int(quantas)
    finally:
        ligacao.close()


def contagens(destino: Path) -> dict[str, int]:
    """As linhas de cada uma das tabelas de negócio que a importação preenche.

    Não é "todas as tabelas do esquema" — de propósito: `tentativas_de_envio`
    (F2-06) não é tocada pelo `importar_bd_antiga.py`, e entrar aqui
    partiria todas as comparações por dicionário literal que este módulo
    sustenta.
    """
    return {
        tabela: contar(destino, tabela)
        for tabela in (
            "categorias",
            "produtos",
            "eventos",
            "fotos",
            "clientes",
            "admins",
            "definicoes",
        )
    }


def despejo(destino: Path) -> str:
    """O despejo SQL completo do destino, para comparação byte a byte.

    `iterdump` e não os bytes do ficheiro: as páginas do SQLite mudam de
    conteúdo por razões que não são dados (o diário, o `freelist`, o
    contador de alterações), e comparar o ficheiro daria falhas que não
    dizem nada. O despejo compara o que lá está.
    """
    ligacao = _ligar_so_leitura(destino)
    try:
        return "\n".join(ligacao.iterdump())
    finally:
        ligacao.close()


def impressao_digital(caminho: Path) -> tuple[str, int]:
    """`(sha256, mtime em nanossegundos)` de um ficheiro.

    O `mtime` em nanossegundos, e não em segundos: uma escrita e uma
    reescrita dentro do mesmo segundo dão o mesmo `st_mtime`, e o teste de
    "só leitura" ficaria verde contra um script que abrisse a origem para
    escrita e lá escrevesse os mesmos bytes.
    """
    digestao = hashlib.sha256(caminho.read_bytes()).hexdigest()
    return digestao, caminho.stat().st_mtime_ns


def bytes_do_destino(destino: Path) -> bytes:
    """Todos os bytes do destino **e dos seus sidecars**.

    Os `-wal` e `-shm` entram de propósito: uma transação por consolidar
    guarda dados que o ficheiro principal ainda não tem, e uma procura só
    no principal diria "não está lá" sobre dados que estão lá ao lado.
    """
    conteudo = destino.read_bytes()
    for sidecar in apoio_esquema.sidecars_de(destino):
        conteudo += sidecar.read_bytes()
    return conteudo


def mensagem_sem_dados(linha: str, pistas: Sequence[str]) -> str:
    """A linha de uma recusa com os dados do caso trocados por marcas.

    Serve para comparar **palavras** entre recusas diferentes: tira as
    pistas (o id, o valor), os caminhos e os números, e o que sobra é a
    frase. Duas recusas com a mesma frase dizem à pessoa que aconteceu a
    mesma coisa quando não aconteceu — é a regra 10 aplicada a texto.

    Os caminhos saem porque cada cenário corre no seu próprio `tmp_path`,
    e o nome do cenário está lá dentro: sem isto, qualquer linha que
    ecoasse o caminho da origem ficava diferente das outras por razões que
    não são a redação da mensagem, e o teste ficava verde sozinho.
    """
    sobra = linha
    for pista in sorted(pistas, key=len, reverse=True):
        sobra = sobra.replace(pista, "§")
    sobra = re.sub(r"/\S+", "/…", sobra)
    return re.sub(r"\d+", "#", sobra).strip()


def frase_da_recusa(
    resultado: ResultadoDaImportacao, cenario: CenarioDeRecusa
) -> frozenset[str]:
    """As linhas do relatório que mencionam a âncora do cenário, sem os dados.

    Conjunto e não lista: a ordem em que o script escreve as linhas não é
    contrato nenhum; a redação é.
    """
    return frozenset(
        mensagem_sem_dados(linha, cenario.pistas)
        for linha in resultado.tudo.splitlines()
        if linha.strip() and cenario.ancora in linha
    )


# --- Fixtures -------------------------------------------------------------
#
# Vivem aqui, e não num `conftest.py`, pela mesma razão que as de
# `tests/apoio_http.py` vivem lá: `tests/seguranca/` precisa exatamente das
# mesmas e duplicá-las era garantir que as duas cópias divergiam. Quem as
# quiser importa-as.


@pytest.fixture(scope="session")
def _destino_modelo_em_head(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    """Um destino em `head`, construído uma vez por sessão de testes.

    Cópia deliberada da fixture homónima de `tests/apoio_http.py`,
    incluindo o `chmod` da pasta: este caminho é devolvido a todos os
    testes da sessão, e qualquer escrita nele contaminaria todas as cópias
    seguintes.
    """
    pasta = tmp_path_factory.mktemp("destino-em-head-para-importador")
    modelo = apoio_esquema.construir_bd_com_alembic(pasta / "modelo.db")
    pasta.chmod(0o555)
    try:
        yield modelo
    finally:
        pasta.chmod(0o755)


def copiar_destino_em_head(modelo: Path, pasta: Path) -> Path:
    """Uma cópia escrevível do destino em `head`, dentro de `pasta`."""
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / NOME_DO_DESTINO
    apoio_esquema.exigir_destino_sem_vestigios(destino)
    shutil.copyfile(modelo, destino)
    destino.chmod(0o644)
    return destino


@pytest.fixture
def destino_em_head(tmp_path: Path, _destino_modelo_em_head: Path) -> Path:
    """O destino deste teste: a base de dados da app, vazia e em `head`."""
    return copiar_destino_em_head(_destino_modelo_em_head, tmp_path / "destino")


@pytest.fixture
def origem_falsa(tmp_path: Path) -> Path:
    """A base de dados antiga falsa deste teste, com todas as armadilhas."""
    return construir_bd_antiga_falsa(tmp_path / "origem")


@pytest.fixture
def pasta_de_imagens(tmp_path: Path) -> Path:
    """A pasta com as imagens que os eventos da origem falsa referem."""
    return criar_pasta_de_imagens(tmp_path / "imagens")


@pytest.fixture
def media_dir(tmp_path: Path) -> Path:
    """O `MEDIA_DIR` deste teste: para onde as imagens têm de ser copiadas.

    Criada vazia. A pasta existir à partida não é o caso de produção (no
    cPanel é `public_html/media` e já lá está), mas é o que separa "o
    script não copiou nada" de "o script não conseguiu criar a pasta" —
    duas coisas diferentes que o teste não tem de confundir.
    """
    pasta = tmp_path / "media"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


@dataclass(frozen=True)
class CenarioImportado:
    """Uma corrida do importador já feita, com os caminhos que usou."""

    origem: Path
    destino: Path
    imagens: Path
    media: Path
    resultado: ResultadoDaImportacao


@pytest.fixture(scope="module")
def cenario_feliz(
    tmp_path_factory: pytest.TempPathFactory, _destino_modelo_em_head: Path
) -> CenarioImportado:
    """Uma corrida completa e bem sucedida, partilhada pelo módulo.

    Âmbito de módulo porque o subprocesso é caro e **nenhum** dos testes
    que a usam escreve no destino nem no `MEDIA_DIR`. Quem precisar de
    mexer neles (idempotência, edição por cima, imagem já lá) monta o seu
    próprio cenário com `origem_falsa`/`destino_em_head`/`media_dir`, que
    são por teste.
    """
    pasta = tmp_path_factory.mktemp("cenario-feliz-f2-08")
    origem = construir_bd_antiga_falsa(pasta / "origem")
    destino = copiar_destino_em_head(_destino_modelo_em_head, pasta / "destino")
    imagens = criar_pasta_de_imagens(pasta / "imagens")
    media = pasta / "media"
    media.mkdir(parents=True, exist_ok=True)
    resultado = correr_importador(
        origem=origem, destino=destino, imagens=imagens, media=media
    )
    return CenarioImportado(
        origem=origem,
        destino=destino,
        imagens=imagens,
        media=media,
        resultado=resultado,
    )


# --- Os pontos onde o script tem de falhar alto ---------------------------


@dataclass(frozen=True)
class CenarioDeRecusa:
    """Um caso em que o importador tem de recusar, e o que a mensagem diz.

    `pistas` são as cadeias que a mensagem tem de conter: o id da linha
    problemática e, quando é legível, o valor. "Falhar alto" sem dizer
    **qual** é a linha deixa o dono com 140 produtos e nenhum sítio por
    onde começar.
    """

    chave: str
    porque: str
    pistas: tuple[str, ...]
    produtos: tuple[ProdutoAntigo, ...] = PRODUTOS
    eventos: tuple[EventoAntigo, ...] = EVENTOS
    #: `"head"`, `"sem_migracao"` ou `"fora_de_head"`.
    destino: str = "head"
    #: Que imagens existem na pasta passada ao `--imagens`.
    imagens_presentes: tuple[str, ...] = (IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO)
    #: Ficheiros já dentro do `MEDIA_DIR` antes da corrida, `nome -> bytes`.
    media_ja_la: tuple[tuple[str, bytes], ...] = ()
    #: Permissões a pôr no **ficheiro** do destino antes da corrida. As
    #: originais repõem-se logo a seguir, senão o `tmp_path` do pytest não
    #: se limpa sozinho e os testes que leem o destino a seguir falhavam
    #: por outra razão que não a que estão a provar.
    modo_do_destino: int | None = None
    #: O mesmo para a **pasta** do destino. É um problema diferente do de
    #: cima: em WAL o SQLite escreve `-wal` e `-shm` ao lado da base de
    #: dados, por isso a pasta também tem de aceitar escrita.
    modo_da_pasta_do_destino: int | None = None
    #: E o mesmo para o `MEDIA_DIR`, para onde as imagens são copiadas.
    modo_do_media: int | None = None
    #: Nomes a criar na pasta das imagens como **ligação simbólica** para o
    #: ficheiro de segredo que está fora das duas pastas.
    ligacoes_nas_imagens: tuple[str, ...] = ()
    #: O mesmo dentro do `MEDIA_DIR`. A ligação aponta para um caminho que
    #: **não existe** de propósito: é aí que o `copyfile` deixa de ser
    #: "escrever por cima de uma ligação" e passa a **criar** o ficheiro do
    #: outro lado, fora do `MEDIA_DIR`.
    ligacoes_no_media: tuple[str, ...] = ()
    #: A cadeia por onde se localizam, no relatório, as linhas que falam
    #: deste problema. Por omissão é a primeira pista (quase sempre o id
    #: da linha); os cenários que não têm linha nenhuma dizem a sua.
    ancora_propria: str | None = None
    #: O cenário depende de as permissões do sistema de ficheiros serem
    #: respeitadas, e a correr como `root` não são. Quem o usa salta-o com
    #: um `skip` **visível**, em vez de o deixar cair fora da lista em
    #: silêncio: «não corri» e «passou» não são a mesma coisa (regra 10).
    exige_permissoes: bool = False

    @property
    def ancora(self) -> str:
        if self.ancora_propria is not None:
            return self.ancora_propria
        if not self.pistas:
            raise RuntimeError(
                f"o cenário {self.chave} não tem pistas nem âncora própria; "
                "não há por onde encontrar a mensagem dele no relatório"
            )
        return self.pistas[0]


#: A versão que o teste do destino fora de `head` escreve em
#: `alembic_version`. Não é um `revision` nosso, nem pode vir a ser.
VERSAO_INVENTADA = "0000naoexiste"

#: A correr como `root`, as permissões de ficheiros não bloqueiam nada: um
#: `0444` abre-se para escrita na mesma. Os cenários que dependem delas
#: saltam-se, **visivelmente**, em vez de falharem ou de desaparecerem da
#: lista. Mesma convenção de `tests/seguranca/test_s10_ficheiros_proibidos.py`.
A_CORRER_COMO_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def _com_produto_extra(produto: ProdutoAntigo) -> tuple[ProdutoAntigo, ...]:
    return (*PRODUTOS, produto)


CENARIOS_DE_RECUSA: tuple[CenarioDeRecusa, ...] = (
    CenarioDeRecusa(
        chave="origem-sem-produtos",
        porque=(
            "A regra 10 em forma de dados. «Importei zero produtos» e «abri a "
            "cópia errada» não podem dar o mesmo relatório verde: a segunda é "
            "muito mais provável do que a primeira, e é a única que dá para "
            "corrigir."
        ),
        pistas=("produtos",),
        produtos=(),
    ),
    CenarioDeRecusa(
        chave="preco-que-nao-converte",
        porque="O preço é texto que não é número nenhum.",
        pistas=("90", "grátis"),
        produtos=_com_produto_extra(ProdutoAntigo(90, "Misto", "grátis", "comidas")),
    ),
    CenarioDeRecusa(
        chave="preco-nulo",
        porque="O preço é `NULL`. A coluna `preco_cent` do destino é `NOT NULL`.",
        pistas=("91",),
        produtos=_com_produto_extra(ProdutoAntigo(91, "Sem preço", None, "comidas")),
    ),
    CenarioDeRecusa(
        chave="preco-vazio",
        porque=(
            "O preço é a string vazia. Não é o mesmo que `NULL` e não pode "
            "dar a mesma mensagem — nem virar `0`, que seria inventar uma "
            "oferta que ninguém decidiu."
        ),
        pistas=("92",),
        produtos=_com_produto_extra(
            ProdutoAntigo(92, "Preço em branco", "", "comidas")
        ),
    ),
    CenarioDeRecusa(
        chave="preco-com-tres-casas",
        porque=(
            "Três casas decimais não cabem em cêntimos. Arredondar em "
            "silêncio é decidir, pelo dono, o preço de um produto."
        ),
        pistas=("93", "2.345"),
        produtos=_com_produto_extra(ProdutoAntigo(93, "Fração", "2.345", "comidas")),
    ),
    CenarioDeRecusa(
        chave="preco-negativo",
        porque=(
            "O destino tem `CHECK (preco_cent >= 0)`. Deixar o `CHECK` "
            "rebentar daria um `IntegrityError` sem dizer que linha é — e o "
            "`CHECK` é a última defesa, não a primeira."
        ),
        pistas=("94", "-1.5"),
        produtos=_com_produto_extra(ProdutoAntigo(94, "Negativo", -1.5, "comidas")),
    ),
    CenarioDeRecusa(
        chave="preco-blob",
        porque=(
            "Medido: com um `blob` que não é UTF-8, o próprio "
            "`SELECT CAST(preco AS TEXT)` levanta `OperationalError` no "
            "driver do `sqlite3`. O script tem de perguntar o `typeof` antes "
            "de converter, e recusar com uma frase sua — não com um traceback."
        ),
        pistas=("95",),
        produtos=_com_produto_extra(
            ProdutoAntigo(95, "Binário", b"\x00\xff", "comidas")
        ),
    ),
    CenarioDeRecusa(
        chave="nome-acima-do-comprimento",
        porque=(
            "Medido: o SQLite guarda 300 caracteres num `VARCHAR(120)` sem um "
            "aviso. O produto entra, e só não se deixa gravar muito mais "
            "tarde, na gestão, com um erro que ninguém liga a esta "
            "importação. O script é o único guarda que existe."
        ),
        pistas=("96", "120"),
        produtos=_com_produto_extra(ProdutoAntigo(96, "A" * 300, 1.0, "comidas")),
    ),
    CenarioDeRecusa(
        chave="texto-duplamente-codificado",
        porque=(
            "`&amp;amp;` passou duas vezes pelo `htmlspecialchars`. O "
            "descodificador faz **uma** passagem — descodificar até parar "
            "transformaria um `&amp;` legítimo escrito pelo dono em `&`. "
            "Sobra resíduo, e o resíduo lista-se."
        ),
        pistas=("97", "&amp;"),
        produtos=_com_produto_extra(
            ProdutoAntigo(97, "Vinho &amp;amp; Companhia", 2.0, "bebidas")
        ),
    ),
    CenarioDeRecusa(
        chave="tipo-nulo",
        porque=(
            "Sem `tipo` não há categoria. Não existe «Sem categoria» na "
            "ementa e não se inventa uma."
        ),
        pistas=("98",),
        produtos=_com_produto_extra(ProdutoAntigo(98, "Órfão", 1.0, None)),
    ),
    CenarioDeRecusa(
        chave="tipo-vazio",
        porque=(
            "A string vazia não é `NULL` e não pode dar a mesma mensagem: "
            "uma é «a coluna está vazia», a outra é «a coluna não tem nada "
            "lá dentro», e quem vai corrigir à mão precisa de saber qual."
        ),
        pistas=("99",),
        produtos=_com_produto_extra(ProdutoAntigo(99, "Órfão vazio", 1.0, "")),
    ),
    CenarioDeRecusa(
        chave="tipo-desconhecido",
        porque=(
            "Um `tipo` que não está nos doze documentados não tem nome nem "
            "ordem decididos pelo Tomás. Inventar-lhe um é inventar factos "
            "sobre o bar; deitá-lo fora é perder produtos."
        ),
        pistas=("89", "cocktails"),
        produtos=_com_produto_extra(ProdutoAntigo(89, "Mojito", 6.0, "cocktails")),
    ),
    CenarioDeRecusa(
        chave="preco-grande-de-mais",
        porque=(
            "Medido: a coluna `preco` tem afinidade `NUMERIC`, guarda "
            "`'1e30'` como `real`, e o `CAST` dá `'1.0e+30'`. Daí saem 1e+32 "
            "cêntimos — mais do que os 28 dígitos do contexto do `Decimal` e "
            "mais do que o inteiro de 64 bits do SQLite. Sem um guarda, a "
            "recusa saía como `InvalidOperation` ou como `OverflowError`, em "
            "traceback e sem dizer que linha é."
        ),
        pistas=("83", "1.0e+30"),
        produtos=_com_produto_extra(
            ProdutoAntigo(83, "Astronómico", "1e30", "comidas")
        ),
    ),
    CenarioDeRecusa(
        chave="titulo-de-evento-acima-do-comprimento",
        porque=(
            "O par do `nome-acima-do-comprimento`, do lado dos eventos. "
            "`eventos.titulo` é `VARCHAR(120)` e o SQLite guarda lá 300 "
            "caracteres sem um aviso: o guarda do script era o único que "
            "existia e não tinha cenário nenhum a prendê-lo."
        ),
        pistas=("85", "120"),
        eventos=(*EVENTOS, EventoAntigo(85, "T" * 300, "2026-07-01", None, None, 1)),
    ),
    CenarioDeRecusa(
        chave="imagem-com-pontos-duplos",
        porque=(
            "`eventos.imagem` tem `CHECK ck_eventos_imagem_sem_caminho`, que "
            "recusa `..`. O guarda do script existia e não tinha cenário: "
            "sem ele, a recusa era um `IntegrityError` a meio da escrita, "
            "sem dizer que linha é."
        ),
        pistas=("87", "fados..jpg"),
        eventos=(
            *EVENTOS,
            EventoAntigo(
                87, "Festa com caminho", "2026-07-01", None, "img/uploads/fados..jpg", 1
            ),
        ),
    ),
    CenarioDeRecusa(
        chave="imagem-com-nome-comprido",
        porque=(
            "`eventos.imagem` é `VARCHAR(64)`. Mesma história do nome do "
            "produto: o SQLite guarda mais sem se queixar, e o erro só "
            "aparecia muito mais tarde."
        ),
        pistas=("86", "64"),
        eventos=(
            *EVENTOS,
            EventoAntigo(
                86,
                "Festa com nome comprido",
                "2026-07-01",
                None,
                f"img/uploads/{NOME_DE_IMAGEM_COMPRIDO}",
                1,
            ),
        ),
        # O ficheiro **existe** na pasta, de propósito. Sem ele, tirar o
        # guarda do comprimento ao script dava na mesma uma recusa — a de
        # «a imagem não está em» — e o cenário ficava verde sem prender
        # nada. Com ele, tirar o guarda faz a importação correr até ao
        # fim: o SQLite guarda 74 caracteres num `VARCHAR(64)` sem um
        # aviso, e o cenário passa a cair, que é o que se quer.
        imagens_presentes=(IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO, NOME_DE_IMAGEM_COMPRIDO),
    ),
    CenarioDeRecusa(
        chave="data-de-evento-com-hora",
        porque=(
            "O dia **está** legível e em AAAA-MM-DD; o que sobra é a hora. "
            "Dizer «a data não está em AAAA-MM-DD» a quem está a olhar para "
            "o 2026-07-01 faz o script parecer avariado no momento em que "
            "mais precisa de ser acreditado — e escolher entre a meia-noite "
            "e a hora escrita era decidir a que horas abre a noite."
        ),
        pistas=("82", "2026-07-01 21:00"),
        eventos=(
            *EVENTOS,
            EventoAntigo(82, "Festa com hora", "2026-07-01 21:00", None, None, 1),
        ),
    ),
    CenarioDeRecusa(
        chave="data-de-evento-ilegivel",
        porque=(
            "`data_evento` não vazia que não bate com nenhum formato "
            "conhecido. Cair em `NULL` transformaria «não consegui ler a "
            "data» em «não tinha data» — e o evento ia para rascunho como se "
            "estivesse tudo bem."
        ),
        pistas=("88", "proximo sabado"),
        eventos=(
            *EVENTOS,
            EventoAntigo(88, "Festa por marcar", "proximo sabado", None, None, 1),
        ),
    ),
    CenarioDeRecusa(
        chave="imagem-em-falta",
        porque=(
            "O Tomás decidiu que quer as imagens, e com `--imagens <pasta>` "
            "elas copiam-se para o `MEDIA_DIR`. Importar metade e continuar "
            "deixava o dono com eventos sem cartaz, sem saber quais, e com a "
            "base de dados já escrita — logo sem poder voltar a correr do "
            "princípio. Pára no primeiro que falte."
        ),
        # O título do evento, e não o id: "falta a imagem do evento 2" não
        # nomeia nada a quem está a ler o relatório, e um "2" sozinho
        # aparece por acaso em quase qualquer linha.
        pistas=(IMAGEM_DE_INVERNO, "Jantar de Natal"),
        imagens_presentes=(IMAGEM_DE_VERAO,),
    ),
    CenarioDeRecusa(
        chave="imagem-diferente-no-media",
        porque=(
            "Já há um ficheiro com esse nome no `MEDIA_DIR` e os bytes não "
            "são os mesmos. É o ADR 0014 aplicado aos ficheiros: só insere. "
            "Sobrepor seria apagar, sem aviso, uma imagem que a gestão pode "
            "ter posto lá — e um ficheiro sobreposto não se recupera como "
            "uma linha de base de dados."
        ),
        pistas=(IMAGEM_DE_VERAO,),
        media_ja_la=((IMAGEM_DE_VERAO, b"outra imagem qualquer, com outros bytes"),),
    ),
    CenarioDeRecusa(
        chave="destino-so-leitura",
        porque=(
            "Encontrado por acidente, a ensaiar o runbook: um destino a "
            "`0444` dava «Rebentei a meio: OperationalError: attempt to "
            "write a readonly database». Não é defeito nenhum — é uma "
            "condição previsível, nomeável, e com uma correção de uma "
            "linha. E o próprio runbook (passo 2.3) manda copiar a base de "
            "dados de destino **à mão** antes de aplicar, porque a F2-02 "
            "ainda não trouxe o `scripts/backup.py`: uma cópia à mão com as "
            "permissões do original é um resultado plausível de seguir as "
            "nossas instruções. O procedimento produz a condição, e a "
            "mensagem mandava abrir uma tarefa em vez de fazer `chmod`."
        ),
        pistas=(NOME_DO_DESTINO, "chmod u+w"),
        modo_do_destino=0o444,
        exige_permissoes=True,
    ),
    CenarioDeRecusa(
        chave="pasta-do-destino-so-leitura",
        porque=(
            "Problema diferente do de cima, com a mesma correção noutro "
            "sítio: em WAL — e `app/db.py` impõe WAL em cada ligação — o "
            "SQLite escreve `-wal` e `-shm` **ao lado** da base de dados. "
            "Com a base de dados escrevível e a pasta não, a transação "
            "rebentava na mesma, e uma mensagem sobre o ficheiro mandava "
            "quem lê olhar para o sítio errado."
        ),
        pistas=("chmod u+w",),
        ancora_propria="onde o destino está",
        modo_da_pasta_do_destino=0o555,
        exige_permissoes=True,
    ),
    CenarioDeRecusa(
        chave="media-so-leitura",
        porque=(
            "O par do destino, do lado dos ficheiros, e com consequência "
            "pior: a cópia das imagens corre **dentro** da transação, antes "
            "do `commit`. A base de dados safava-se, mas as imagens já "
            "copiadas ficavam no `MEDIA_DIR` e a conclusão era «Rebentei a "
            "meio». E tem de recusar **também na simulação**: quem simula "
            "está a perguntar se o `--aplicar` vai correr bem, e uma "
            "simulação verde seguida de um `--aplicar` que rebenta é o pior "
            "dos resultados."
        ),
        pistas=("chmod u+w", "--imagens ignorar"),
        ancora_propria="não me deixa escrever, e há",
        modo_do_media=0o555,
        exige_permissoes=True,
    ),
    CenarioDeRecusa(
        chave="destino-sem-migracao",
        porque=(
            "Um ficheiro sem tabelas nenhumas. Escrever aqui daria «no such "
            "table: produtos» a meio, com parte do trabalho feito."
        ),
        pistas=(NOME_DO_DESTINO,),
        destino="sem_migracao",
    ),
    CenarioDeRecusa(
        chave="destino-fora-de-head",
        porque=(
            "`alembic_version` diferente de `head`: o esquema que lá está "
            "não é o que o script conhece. Uma coluna a mais ou a menos e o "
            "`INSERT` escreve nos sítios errados."
        ),
        pistas=(NOME_DO_DESTINO, VERSAO_INVENTADA),
        destino="fora_de_head",
    ),
)


def preparar_destino(cenario: CenarioDeRecusa, modelo: Path, pasta: Path) -> Path:
    """O destino que `cenario` pede: em `head`, sem migração, ou fora de `head`."""
    if cenario.destino == "head":
        return copiar_destino_em_head(modelo, pasta)
    if cenario.destino == "sem_migracao":
        pasta.mkdir(parents=True, exist_ok=True)
        destino = pasta / NOME_DO_DESTINO
        sqlite3.connect(destino).close()
        return destino
    if cenario.destino == "fora_de_head":
        destino = copiar_destino_em_head(modelo, pasta)
        ligacao = sqlite3.connect(destino)
        try:
            ligacao.execute(
                "UPDATE alembic_version SET version_num = ?", (VERSAO_INVENTADA,)
            )
            ligacao.commit()
        finally:
            ligacao.close()
        return destino
    raise RuntimeError(
        f"destino «{cenario.destino}» desconhecido no cenário {cenario.chave}"
    )


@dataclass(frozen=True)
class RecusaCorrida:
    """Um cenário de recusa já corrido, com os sítios onde ele podia ter escrito."""

    destino: Path
    media: Path
    media_antes: dict[str, bytes]
    resultado: ResultadoDaImportacao
    #: O ficheiro fora das duas pastas para onde as ligações apontam, e os
    #: bytes que ele tinha antes da corrida. `None` quando o cenário não
    #: tem ligação nenhuma.
    segredo: Path | None = None
    segredo_antes: bytes | None = None


def correr_cenario_de_recusa(
    cenario: CenarioDeRecusa, modelo: Path, pasta: Path
) -> RecusaCorrida:
    """Monta e corre `cenario`, e devolve o que ele deixou para trás."""
    origem = construir_bd_antiga_falsa(
        pasta / "origem", produtos=cenario.produtos, eventos=cenario.eventos
    )
    destino = preparar_destino(cenario, modelo, pasta / "destino")
    imagens = criar_pasta_de_imagens(pasta / "imagens", nomes=cenario.imagens_presentes)
    media = pasta / "media"
    media.mkdir(parents=True, exist_ok=True)
    for nome, conteudo in cenario.media_ja_la:
        (media / nome).write_bytes(conteudo)

    segredo: Path | None = None
    if cenario.ligacoes_nas_imagens or cenario.ligacoes_no_media:
        segredo = criar_segredo_fora_das_pastas(pasta)
        for nome in cenario.ligacoes_nas_imagens:
            criar_ligacao(imagens, nome, segredo)
        for nome in cenario.ligacoes_no_media:
            # Para um caminho que não existe: é o caso em que o
            # `copyfile` não sobrepõe nada, **cria** um ficheiro novo onde
            # a ligação aponta — fora do `MEDIA_DIR` e sem deixar vestígio
            # dentro dele.
            criar_ligacao(media, nome, segredo.parent / "ainda-nao-existe.env")

    media_antes = ficheiros_em(media)

    # As permissões põem-se à última hora e repõem-se logo a seguir, num
    # `finally`: uma pasta ou um ficheiro que fiquem sem escrita deixam o
    # `tmp_path` do pytest sem se conseguir limpar, e os testes que leem o
    # destino **depois** desta corrida passariam a falhar por não lhe
    # conseguirem tocar — por outra razão que não a que querem provar.
    modos_originais = [
        (caminho, caminho.stat().st_mode, modo)
        for caminho, modo in (
            (destino, cenario.modo_do_destino),
            (destino.parent, cenario.modo_da_pasta_do_destino),
            (media, cenario.modo_do_media),
        )
        if modo is not None
    ]
    for caminho, _, modo in modos_originais:
        caminho.chmod(modo)
    try:
        resultado = correr_importador(
            origem=origem, destino=destino, imagens=imagens, media=media
        )
    finally:
        for caminho, original, _ in reversed(modos_originais):
            caminho.chmod(original)
    return RecusaCorrida(
        destino=destino,
        media=media,
        media_antes=media_antes,
        resultado=resultado,
        segredo=segredo,
        segredo_antes=None if segredo is None else BYTES_DO_SEGREDO,
    )


def cenario_por_chave(chave: str) -> CenarioDeRecusa:
    """O cenário de recusa com esta chave, ou um erro que diz que não existe."""
    for cenario in CENARIOS_DE_RECUSA:
        if cenario.chave == chave:
            return cenario
    raise RuntimeError(
        f"não há cenário de recusa com a chave «{chave}». Há: "
        f"{[c.chave for c in CENARIOS_DE_RECUSA]}"
    )


def sem_pistas(cenario: CenarioDeRecusa) -> CenarioDeRecusa:
    """O mesmo cenário sem pistas — para quem só quer a recusa, não a frase."""
    return replace(cenario, pistas=())
