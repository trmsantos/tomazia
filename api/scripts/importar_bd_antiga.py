"""Importa a ementa e os eventos do site PHP antigo para a base de dados nova.

Corre-se assim, com o destino a vir da `BASE_DADOS_URL` como no `alembic`:

    AMBIENTE=producao python scripts/importar_bd_antiga.py \
        --origem /caminho/para/uma/copia.db \
        --imagens /caminho/para/img/uploads \
        --aplicar

O runbook de quem o corre a sério — o que fazer antes, o que ler no
relatório, como voltar atrás — é `docs/legado/importacao.md`.

Estado de saída `0` quando a importação se fez (ou quando não havia nada
para fazer), diferente de zero quando o script **recusou**. O relatório
sai todo em `stdout` — nada em `stderr`, de propósito: quem lê o
relatório lê a **última linha não vazia** como conclusão, e uma linha de
`stderr` a aparecer depois dela tornava a conclusão a frase errada. A
única exceção é um defeito do script: aí sai a conclusão «Rebentei a
meio» em `stdout` e o `traceback` em `stderr`, por esta ordem, e o
relatório diz nas palavras dele que não é uma recusa.

## As decisões que este ficheiro aplica, e onde estão escritas

- **A chave é o id do site antigo** (ADR 0014): `produtos.id` recebe o
  `produtos.id_produto` antigo, `eventos.id` recebe o `eventos.id`, e as
  categorias — que não têm identidade na origem — são reconhecidas pelo
  `slug` normalizado do `tipo`. **Só inserção**: ausente insere; presente
  e igual não toca; presente e **diferente** não toca, lista, e o script
  sai com estado diferente de zero. Tudo numa transação.
- **O `slug` nasce do `tipo` antigo, não do nome novo.** `portos` dá o
  slug `portos` e o nome "Vinhos do Porto". Se nascesse do nome, renomear
  uma categoria na gestão partia as âncoras `#ementa-<slug>` da F3-02.
- **"Bebidas" e "bebidas" juntam-se pela normalização do slug**, não por
  um caso especial: um caso especial resolve um par e deixa o próximo por
  resolver.
- **Os onze pares (nome, ordem)** foram decididos pelo Tomás em
  2026-10-29 (`docs/TAREFAS.md`, entrada F2-08). Um `tipo` fora dos doze
  documentados **recusa**: não tem nome nem ordem decididos, e
  inventar-lhos era inventar factos sobre o bar.
- **As categorias criam-se a pedido**, só quando há um produto novo para
  lhes pendurar (ADR 0014).
- **O script simula por omissão** e só escreve com `--aplicar`, com o
  caminho do destino na primeira linha do relatório. Enquanto a F2-02 não
  aterrar não há `scripts/backup.py` para desfazer, e a importação a
  sério corre no servidor.

## Três coisas que este ficheiro faz de uma maneira e não de outra

1. **Pergunta-se `typeof(preco)` antes de converter.** Medido: com um
   `blob` que não é UTF-8, o próprio `SELECT CAST(preco AS TEXT)` levanta
   `OperationalError` no driver do `sqlite3` — a recusa saía como
   traceback em vez de mensagem. O `CASE` de `_expressao_de_texto` dá
   `NULL` ao `blob` e o `typeof` ao lado diz que foi isso que aconteceu.
2. **O preço passa por `Decimal`, nunca por `float`.** Medido:
   `CAST(2.30 AS TEXT)` dá `'2.3'` e daí saem 230 cêntimos, enquanto
   `int(2.30 * 100)` dá **229**. E a afinidade `NUMERIC` da coluna faz
   com que `2.0` e `4.0` cheguem como `integer`, não como `real`: o
   caminho é sempre o texto, não o tipo.
3. **O destino escreve-se pelo ORM**, apesar de a F2-01 prever SQL cru.
   A razão é o `DataHoraUTC`: pelo ORM um `datetime` ingénuo é
   **recusado**, enquanto em SQL cru é **rotulado** UTC sem conversão — e
   uma data de evento ficava uma hora errada metade do ano sem um erro
   pelo caminho. A conversão Lisboa->UTC é a de `app.tempo` (ADR 0010),
   não uma cópia dela.

## O que se compara para decidir que uma linha "diverge"

Só as colunas que carregam conteúdo do site antigo: o `nome`, o
`preco_cent` e a categoria do produto; o `nome` e a `ordem` da categoria;
o `titulo`, o `inicio`, a `descricao` e a `imagem` do evento.

**Fora ficam os interruptores do dia-a-dia do dono** — `produtos.ordem`,
`produtos.disponivel`, `categorias.visivel` e `eventos.publicado`. O dono
publica um rascunho na gestão no dia a seguir à primeira importação; se
isso contasse como divergência, a segunda corrida recusava-se a fazer
seja o que for e o importador ficava inútil a partir do segundo dia.
"""

from __future__ import annotations

import argparse
import filecmp
import os
import re
import shutil
import sqlite3
import sys
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from pathlib import Path

# O `sys.path` antes de qualquer coisa que toque no pacote `app`, pela
# mesma razão que em `passenger_wsgi.py`: corrido como
# `python scripts/importar_bd_antiga.py`, o `sys.path[0]` é a pasta
# `scripts/`, e `import app` não encontrava nada.
RAIZ_INSTALACAO = Path(__file__).resolve().parent.parent
if str(RAIZ_INSTALACAO) not in sys.path:
    sys.path.insert(0, str(RAIZ_INSTALACAO))

from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from pydantic import ValidationError  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import Definicoes, obter_definicoes  # noqa: E402
from app.db import criar_engine  # noqa: E402
from app.models import Categoria, Evento, Produto  # noqa: E402
from app.tempo import FUSO_DO_BAR, inicio_do_dia_do_bar  # noqa: E402

# --- As onze categorias, decididas pelo Tomás em 2026-10-29 --------------

#: `slug` (a normalização do `tipo` antigo) -> (nome que o cliente lê,
#: ordem na ementa). Doze `tipo` dão onze categorias porque `Bebidas` e
#: `bebidas` normalizam para o mesmo slug.
CATEGORIAS: dict[str, tuple[str, int]] = {
    "cafetaria": ("Cafetaria", 1),
    "comidas": ("Comidas", 2),
    "bebidas": ("Bebidas", 3),
    "aguardentes": ("Aguardentes", 4),
    "portos": ("Vinhos do Porto", 5),
    "licores": ("Licores", 6),
    "martinis": ("Martinis", 7),
    "brandy": ("Brandy", 8),
    "whiskys": ("Whisky", 9),
    "gin": ("Gin", 10),
    "espirituosas": ("Espirituosas", 11),
}

# --- O descodificador de texto -------------------------------------------

#: As entidades que o `htmlspecialchars` do PHP produz, mais as três
#: formas do apóstrofo que aparecem em texto colado de outro sítio.
#: **Sempre com ponto e vírgula.** `html.unescape` não serve: está medido
#: que transforma `Gin &copy tonico` em `Gin © tonico` — sem ponto e
#: vírgula e com uma entidade que o `htmlspecialchars` nunca produz —, e
#: numa carta de bar isso corrompe texto que ninguém escapou.
ENTIDADES: dict[str, str] = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#039;": "'",
    "&#39;": "'",
    "&apos;": "'",
}

#: As mais compridas primeiro. Hoje nenhuma é prefixo de outra — nem
#: `&#39;` de `&#039;`, que diferem no terceiro carácter —, por isso a
#: ordem não decide nada; ordena-se à mesma para o padrão não passar a
#: depender da ordem do dicionário no dia em que entrar uma que seja.
PADRAO_ENTIDADE = re.compile(
    "|".join(
        re.escape(entidade) for entidade in sorted(ENTIDADES, key=len, reverse=True)
    )
)

# --- Limites que o destino impõe e que o SQLite não verifica -------------
#
# Medido: o SQLite guarda 300 caracteres num `VARCHAR(120)` sem um aviso.
# O produto entra, e só não se deixa gravar muito mais tarde, na gestão,
# com um erro que ninguém liga a esta importação.

COMPRIMENTO_NOME_PRODUTO = 120
COMPRIMENTO_TITULO_EVENTO = 120
COMPRIMENTO_IMAGEM = 64

#: O maior número de cêntimos que o destino aguenta. O SQLite guarda
#: inteiros com sinal em 64 bits, e acima disto é o próprio driver que
#: recusa o `INSERT` com `OverflowError` — a meio da escrita, sem dizer
#: que linha é e com um traceback em vez de uma frase.
MAXIMO_CENTIMOS = 2**63 - 1

#: O formato de `eventos.data_evento` que o esquema documentado descreve
#: (`DATE`). Qualquer outra coisa recusa, em vez de ser adivinhada: uma
#: data mal lida é um evento com a noite errada no site.
PADRAO_DATA = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

#: Um dia em AAAA-MM-DD **seguido de mais alguma coisa** — quase sempre uma
#: hora. Tem ramo próprio porque a mensagem genérica («a data não está em
#: AAAA-MM-DD») é falsa a olhar para `2026-07-01 21:00`: o dia está ali,
#: legível, e só a hora é que sobra. Ver `data_do_evento`.
PADRAO_DATA_COM_HORA = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]")

#: As extensões que podem aterrar no `MEDIA_DIR`. **Não é zelo de tipos de
#: ficheiro**: o `MEDIA_DIR` fica dentro do `public_html`, servido pelo
#: Apache do cPanel com `AllowOverride All`, e é a única pasta do site
#: escrita a partir de dados que vieram de fora. Um `.htaccess` ali repõe
#: a execução de PHP exatamente onde ela não pode haver, um `.php` é código
#: que o servidor corre, e um `.svg` ou um `.html` são JavaScript no
#: domínio do site. A lista é branca de propósito: uma lista negra deixa
#: passar a extensão que ninguém se lembrou de lá pôr.
#:
#: E é branca **a sério**: o `nome_de_ficheiro` exige que o nome tenha uma
#: extensão e uma só, porque o `mod_mime` do Apache despacha pela lista de
#: extensões do nome e não pela última. Ancorada no último sufixo, esta
#: lista branca recusava `cartaz.jpg.php` e deixava passar
#: `shell.php.jpg` — ou seja, era uma lista negra com outro nome.
EXTENSOES_DE_IMAGEM = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})

#: A palavra que `--imagens` aceita em vez de uma pasta.
IGNORAR = "ignorar"

#: «de duas maneiras» e «os produtos dos dois»: a frase da junção de tipos
#: usa os dois géneros. Só até cinco porque mais do que cinco formas de
#: escrever o mesmo `tipo` não é um caso que exista — e se existir, o
#: algarismo lê-se à mesma.
QUANTOS_FEMININO: dict[int, str] = {2: "duas", 3: "três", 4: "quatro", 5: "cinco"}
QUANTOS_MASCULINO: dict[int, str] = {2: "dois", 3: "três", 4: "quatro", 5: "cinco"}


class ConversaoFalhada(Exception):
    """Uma linha da origem que não se converte. A mensagem diz porquê."""


class Recusa(Exception):
    """O script não pode sequer começar. A mensagem diz porquê."""


# --- Texto ----------------------------------------------------------------


def enumerar(itens: Sequence[str]) -> str:
    """`['a', 'b', 'c']` -> `a, b e c`. Nunca um `repr` de lista.

    Existe porque o `repr` de uma lista escapou por três sítios deste
    ficheiro — `['eventos', 'produtos']` a aparecer num relatório que é
    para uma pessoa ler. O `_valor` foi escrito de propósito para não
    deixar sair `repr` e estes três sítios não passavam por lá.
    """
    if not itens:
        return ""
    if len(itens) == 1:
        return itens[0]
    return f"{', '.join(itens[:-1])} e {itens[-1]}"


def quantos(numero: int, tabela: dict[int, str]) -> str:
    """«duas», «dois», ou o algarismo quando o número sai da tabela."""
    return tabela.get(numero, str(numero))


def descodificar(texto: str) -> str:
    """Desfaz o `htmlspecialchars` do site antigo, **numa passagem só**.

    Uma passagem, e não "repetir até estabilizar": repetir resolvia o
    texto duplamente codificado e apagava a prova de que ele existe — e
    transformava um `&amp;` que o dono escreveu de propósito num `&`.
    O resíduo procura-se a seguir, com `residuo_de_entidade`, e lista-se.
    """
    return PADRAO_ENTIDADE.sub(lambda achado: ENTIDADES[achado.group(0)], texto)


def residuo_de_entidade(texto: str) -> str | None:
    """A primeira entidade que sobrou depois de uma passagem, ou `None`."""
    achado = PADRAO_ENTIDADE.search(texto)
    return achado.group(0) if achado else None


def normalizar_slug(valor: str) -> str:
    """O `slug` de um `tipo` antigo: minúsculas, sem acentos, com hífenes.

    É isto — e não um caso especial `{"Bebidas": "bebidas"}` — que junta
    `Bebidas` e `bebidas` na mesma categoria, e que junta o `Gin` que o
    dono escreva com maiúscula ao `gin` que lá está.
    """
    decomposto = unicodedata.normalize("NFKD", valor)
    sem_acentos = "".join(c for c in decomposto if not unicodedata.combining(c))
    return "-".join(re.findall(r"[a-z0-9]+", sem_acentos.lower()))


def texto_limpo(rotulo: str, bruto: str) -> str:
    """O texto da origem descodificado, ou uma recusa se sobrar entidade."""
    limpo = descodificar(bruto)
    resto = residuo_de_entidade(limpo)
    if resto is not None:
        # A segunda passagem é **só para mostrar** como o texto devia
        # ler-se. Nunca se grava: é exatamente a passagem que
        # transformaria num «&» um «&amp;» que o dono tenha escrito de
        # propósito.
        raise ConversaoFalhada(
            f"{rotulo} ainda tem «{resto}» depois de eu desfazer uma camada "
            f"de escape — ficou «{limpo}», e pelos vistos devia ler-se "
            f"«{descodificar(limpo)}». Na origem o texto foi escapado duas "
            "vezes. Não desfaço a segunda camada: isso transformava também "
            "num «&» qualquer «&amp;» que o dono tenha escrito de propósito. "
            "Corrige-se na origem."
        )
    return limpo


# --- Preços ---------------------------------------------------------------


def preco_em_centimos(bruto: str) -> int:
    """Converte o preço em euros do site antigo para cêntimos.

    `CAST(preco AS TEXT)` -> `Decimal` -> `x 100` -> `int`. Nunca
    `float`, em passo nenhum: `int(2.30 * 100)` dá **229**.

    O `int` no fim, e não um `quantize(ROUND_HALF_UP)`: a linha acima já
    recusou tudo o que não seja integral, por isso não havia nada para
    arredondar — e o `quantize` levantava `InvalidOperation` acima dos 28
    dígitos significativos do contexto, **sem ninguém a apanhá-la**. Está
    medido: a coluna `preco` tem afinidade `NUMERIC`, guarda `'1e30'` como
    `real`, o `CAST` dá `'1.0e+30'`, e a recusa saía como traceback em vez
    de frase. O `int` é total; quem trata do número grande de mais é o
    guarda do `MAXIMO_CENTIMOS`, com uma frase sua.
    """
    texto = bruto.strip().replace(",", ".")
    if not texto:
        raise ConversaoFalhada(
            "o preço está em branco na origem; em branco não é zero, e "
            "zero é um preço que alguém decidiu."
        )
    try:
        euros = Decimal(texto)
    except InvalidOperation:
        raise ConversaoFalhada(
            f"o preço «{bruto}» não é um número. Se o produto é mesmo de "
            "oferta, o preço na origem é 0."
        ) from None
    if not euros.is_finite():
        raise ConversaoFalhada(f"o preço «{bruto}» não é um número finito.")

    centimos = euros * 100
    if centimos != centimos.to_integral_value():
        raise ConversaoFalhada(
            f"o preço «{bruto}» tem mais de duas casas decimais e não cabe "
            "em cêntimos; arredondá-lo era decidir, pelo dono, o preço de "
            "um produto."
        )
    if euros < 0:
        raise ConversaoFalhada(
            f"o preço «{bruto}» é negativo, e uma ementa não tem preços negativos."
        )
    if centimos > MAXIMO_CENTIMOS:
        raise ConversaoFalhada(
            f"o preço «{bruto}» é grande de mais para caber no inteiro onde "
            "o destino guarda os cêntimos. Confirma-o na origem: um número "
            "destes é quase sempre uma gralha."
        )
    return int(centimos)


# --- Datas ----------------------------------------------------------------


def meia_noite_em_utc(dia: date) -> datetime:
    """A meia-noite de `dia` em Lisboa, em UTC (ADR 0010).

    Delega em `app.tempo.inicio_do_dia_do_bar` em vez de repetir a
    conversão: é a mesma função que decide o corte de `GET /eventos`, e
    duas conversões escritas em sítios diferentes desalinham-se na
    primeira vez que uma delas for corrigida. Passa-se o meio-dia de
    Lisboa como instante representativo — qualquer instante dentro do dia
    serve, e o meio-dia está longe de qualquer mudança de hora.
    """
    return inicio_do_dia_do_bar(datetime.combine(dia, time(12), tzinfo=FUSO_DO_BAR))


def data_do_evento(bruto: str) -> date:
    """A `data_evento` do site antigo, ou uma recusa que nomeia o valor."""
    arrumada = bruto.strip()
    achado = PADRAO_DATA.match(arrumada)
    if achado is None:
        # Ramo próprio para o dia legível com hora atrás. Sem ele, um
        # `2026-07-01 21:00` caía no ramo de baixo e o relatório dizia «a
        # data não está em AAAA-MM-DD» a quem está a olhar para o
        # `2026-07-01`, que está — a frase parece um defeito do script no
        # momento em que ele mais precisa de ser acreditado. E «lê-la à
        # sorte» seria falso: o dia está ali.
        if PADRAO_DATA_COM_HORA.match(arrumada):
            raise ConversaoFalhada(
                f"a data «{bruto}» traz uma hora, e não só o dia. Todos os "
                "outros eventos entram à meia-noite do dia em Lisboa: ficar "
                "com a meia-noite deitava fora as horas que alguém escreveu "
                "na origem, e ficar com as horas dava a este evento um "
                "começo que nenhum outro tem. Escolher por ti era decidir a "
                "que horas abre a noite. Corrige a origem — só o dia, em "
                "AAAA-MM-DD — e corre outra vez."
            )
        raise ConversaoFalhada(
            f"a data «{bruto}» não está em AAAA-MM-DD, que é o formato que "
            "o esquema documentado descreve; lê-la à sorte punha o evento "
            "noutra noite. Escreve-a em AAAA-MM-DD na origem; se ainda não "
            "há data marcada, deixa a coluna vazia e o evento entra por "
            "publicar."
        )
    ano, mes, dia = (int(parte) for parte in achado.groups())
    try:
        return date(ano, mes, dia)
    except ValueError:
        raise ConversaoFalhada(
            f"a data «{bruto}» tem a forma AAAA-MM-DD mas não é um dia que "
            "exista no calendário."
        ) from None


# --- Ler a origem ---------------------------------------------------------


def _expressao_de_texto(coluna: str) -> str:
    """`typeof(coluna)` e o valor em texto, com o `blob` a dar `NULL`.

    O `CASE` não é zelo: medido, `SELECT CAST(preco AS TEXT)` sobre um
    `blob` que não é UTF-8 levanta `OperationalError` **no próprio
    SELECT**, e a recusa saía como traceback. O nome da coluna é sempre
    uma constante deste ficheiro, nunca um valor da base de dados.
    """
    return (
        f"typeof({coluna}), "
        f"CASE WHEN typeof({coluna}) <> 'blob' THEN CAST({coluna} AS TEXT) END"
    )


def _exigir_texto(rotulo: str, tipo: str, valor: str | None) -> str | None:
    """O valor em texto, ou uma recusa quando a origem lá tem bytes."""
    if tipo == "blob":
        raise ConversaoFalhada(
            f"{rotulo} está guardado como dados binários (blob) na origem, "
            "e não como texto nem como número."
        )
    return valor


@dataclass(frozen=True)
class ProdutoPlaneado:
    """Um produto do site antigo, já convertido para o que o destino quer."""

    id: int
    nome: str
    preco_cent: int
    slug: str
    #: O `tipo` tal como está escrito na origem. Guarda-se para o relatório
    #: poder dizer que «Bebidas» e «bebidas» são o mesmo — sem isso, quem
    #: contar onze categorias sabendo que a origem tem doze `tipo` fica a
    #: achar que se perdeu uma.
    tipo: str
    #: O nome tal como está na origem, **só quando** desfazer o escape o
    #: mudou. `None` quer dizer «entrou como lá estava».
    nome_na_origem: str | None = None


@dataclass(frozen=True)
class EventoPlaneado:
    """Um evento do site antigo, já convertido para o que o destino quer."""

    id: int
    titulo: str
    inicio: datetime | None
    descricao: str | None
    imagem: str | None
    referencia_da_imagem: str | None
    publicado: bool
    #: Como em `ProdutoPlaneado`: o texto da origem quando desfazer o
    #: escape o mudou, `None` quando não mudou.
    titulo_na_origem: str | None = None
    descricao_na_origem: str | None = None


def ligar_so_leitura(caminho: Path) -> sqlite3.Connection:
    """Abre `caminho` em modo `ro`. A origem é a única cópia que existe."""
    return sqlite3.connect(f"{caminho.as_uri()}?mode=ro", uri=True)


def tabelas_de(ligacao: sqlite3.Connection) -> set[str]:
    return {
        nome
        for (nome,) in ligacao.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def nome_de_ficheiro(referencia: str) -> str:
    """`img/uploads/fados.jpg` -> `fados.jpg`, e só se for mesmo uma imagem.

    Duas coisas diferentes, e as duas são precisas.

    A **redução** é o que o `CHECK ck_eventos_imagem_sem_caminho` exige:
    a base de dados recusa `/`, `\\` e `..`, e deixar o `CHECK` rebentar
    seria um `IntegrityError` a meio, com parte do trabalho feito e sem
    dizer que linha é.

    A **lista branca de extensões** é outra coisa, e aplica-se ao nome já
    reduzido. A redução diz onde o ficheiro vai parar; não diz nada sobre
    *que tipo de ficheiro* é. E o sítio onde ele vai parar é o `MEDIA_DIR`,
    que fica dentro do `public_html` e é servido pelo Apache do cPanel com
    `AllowOverride All`: `img/uploads/.htaccess` reduz-se a `.htaccess`
    limpinho, e um `.htaccess` ali repõe a execução de PHP exatamente onde
    não pode haver. Os nomes começados por `.` recusam-se todos, pela
    mesma razão — e `../../../.env` reduz-se precisamente a `.env`.

    **A lista branca olha para as extensões todas, não para a última.** É
    a armadilha que o `deploy/htaccess.exemplo` já tem vinte linhas a
    explicar, e é a razão de o `FilesMatch` de lá acabar em `(\\.|$)` e não
    em `$`: o `mod_mime` do Apache despacha um ficheiro pela **lista** de
    extensões do nome, não pela última. Uma lista branca ancorada no
    último sufixo recusa `cartaz.jpg.php` e deixa passar `shell.php.jpg`,
    `a.cgi.jpeg`, `b.sh.png`, `x.html.webp` — ou seja, comporta-se como
    lista negra para tudo menos a última extensão, que é exatamente o que
    ela existe para não ser.

    Daí a regra ser **uma extensão, e só uma**. Custa um `cartaz.2026.jpg`
    legítimo, que é um nome plausível numa pasta de uploads, e a escolha é
    essa de propósito: a alternativa era adivinhar que extensões é que o
    Apache deste cPanel reconhece como handler, e isso é a lista negra
    outra vez, pela porta do lado. A recusa é alta, nomeia o ficheiro, e a
    correção é renomear na origem.
    """
    nome = referencia.replace("\\", "/").strip().rsplit("/", 1)[-1]
    if not nome:
        raise ConversaoFalhada(
            f"a imagem «{referencia}» não tem nome de ficheiro nenhum "
            "depois de lhe tirar o caminho."
        )
    if ".." in nome:
        raise ConversaoFalhada(
            f"o nome de ficheiro da imagem «{referencia}» tem «..», e a "
            "base de dados recusa-o (ck_eventos_imagem_sem_caminho)."
        )
    if len(nome) > COMPRIMENTO_IMAGEM:
        raise ConversaoFalhada(
            f"o nome de ficheiro da imagem tem {len(nome)} caracteres e no "
            f"destino só cabem {COMPRIMENTO_IMAGEM}. Dá-lhe um nome mais "
            "curto na pasta das imagens e na origem."
        )
    if nome.startswith("."):
        raise ConversaoFalhada(
            f"a imagem «{referencia}» fica reduzida a «{nome}», que começa "
            "por um ponto. O MEDIA_DIR é servido pela web, e um ficheiro "
            "escondido lá dentro — um .htaccess, um .env — não é um cartaz "
            "de evento. Corrige a coluna na origem."
        )
    sufixos = Path(nome).suffixes
    if len(sufixos) > 1:
        raise ConversaoFalhada(
            f"a imagem «{referencia}» fica reduzida a «{nome}», que tem mais "
            f"do que uma extensão ({enumerar(sufixos)}). O Apache despacha "
            "um ficheiro pelas extensões todas do nome, não só pela última: "
            "no MEDIA_DIR, que é servido pela web, um «shell.php.jpg» seria "
            "corrido como PHP apesar de acabar em .jpg. Por isso só aceito "
            "nomes com uma extensão — e sim, isso recusa também um "
            "«cartaz.2026.jpg», que não tem mal nenhum. Dá-lhe um nome com "
            "uma extensão só, na pasta das imagens e na origem."
        )
    if not sufixos or sufixos[0].lower() not in EXTENSOES_DE_IMAGEM:
        permitidas = enumerar(sorted(EXTENSOES_DE_IMAGEM))
        raise ConversaoFalhada(
            f"a imagem «{referencia}» fica reduzida a «{nome}», e isso não é "
            f"um ficheiro de imagem: só copio {permitidas}. O MEDIA_DIR fica "
            "dentro do site e é servido pela web — um .php ali é código que "
            "o servidor corre, e um .html ou um .svg é JavaScript no "
            "domínio do bar. Corrige a coluna na origem."
        )
    return nome


def planear_produto(linha: tuple[object, ...]) -> ProdutoPlaneado:
    """Converte uma linha de `produtos` ou recusa, dizendo o que lhe falta."""
    id_, tipo_nome, nome_bruto, tipo_preco, preco_bruto, tipo_tipo, tipo_bruto = linha

    nome_cru = _exigir_texto("o nome", str(tipo_nome), _como_texto(nome_bruto))
    if nome_cru is None:
        raise ConversaoFalhada(
            "não tem nome na origem (está a NULL), e um produto sem nome "
            "não se põe numa ementa."
        )
    # O `strip()` é a única transformação que este script faz ao texto
    # para lá de desfazer o `htmlspecialchars`, e é de propósito: um
    # espaço no fim de «Café » não é o nome do produto, mas chega para
    # o pôr a parecer outro produto na ementa e para o deixar de fora
    # de uma pesquisa. O resto do texto vai como está
    # (`backend/CLAUDE.md`: guarda-se tal como foi escrito).
    nome_descodificado = texto_limpo("o nome", nome_cru)
    nome = nome_descodificado.strip()
    if not nome:
        raise ConversaoFalhada("o nome está em branco na origem.")
    if len(nome) > COMPRIMENTO_NOME_PRODUTO:
        raise ConversaoFalhada(
            f"o nome tem {len(nome)} caracteres e no destino só cabem "
            f"{COMPRIMENTO_NOME_PRODUTO}. Encurta-o na origem: um nome assim "
            "também não cabia na linha de um cartão da ementa."
        )

    preco_cru = _exigir_texto("o preço", str(tipo_preco), _como_texto(preco_bruto))
    if preco_cru is None:
        raise ConversaoFalhada(
            "não tem preço nenhum na origem: a coluna preco está a NULL, e "
            "no destino todo o produto tem de ter preço. Escreve-lhe o preço "
            "na origem e corre outra vez."
        )
    preco_cent = preco_em_centimos(preco_cru)

    tipo_cru = _exigir_texto("o tipo", str(tipo_tipo), _como_texto(tipo_bruto))
    if tipo_cru is None:
        raise ConversaoFalhada(
            "não tem tipo na origem (está a NULL), e sem tipo não há "
            "categoria onde o pendurar."
        )
    slug = normalizar_slug(tipo_cru)
    if not slug:
        raise ConversaoFalhada(
            "o tipo está em branco na origem, e uma categoria sem nome não se inventa."
        )
    if slug not in CATEGORIAS:
        raise ConversaoFalhada(
            f"o tipo «{tipo_cru}» não é nenhum dos doze que a carta antiga "
            f"tem ({', '.join(CATEGORIAS)} — e «bebidas» tanto faz com "
            "maiúscula como sem ela). Ou é gralha e corrige-se na origem, ou "
            "é categoria nova — e aí o nome que o cliente lê e o lugar dela "
            "na ementa decide-os o dono, não este script."
        )

    return ProdutoPlaneado(
        id=_como_inteiro(id_),
        nome=nome,
        preco_cent=preco_cent,
        slug=slug,
        tipo=tipo_cru,
        nome_na_origem=None if nome_descodificado == nome_cru else nome_cru,
    )


def planear_evento(
    linha: tuple[object, ...], *, ignorar_imagens: bool
) -> EventoPlaneado:
    """Converte uma linha de `eventos` ou recusa, dizendo o que lhe falta."""
    (
        id_,
        tipo_titulo,
        titulo_bruto,
        tipo_data,
        data_bruta,
        tipo_descricao,
        descricao_bruta,
        tipo_imagem,
        imagem_bruta,
        visivel,
    ) = linha

    titulo_cru = _exigir_texto("o título", str(tipo_titulo), _como_texto(titulo_bruto))
    if titulo_cru is None:
        raise ConversaoFalhada("não tem título na origem (está a NULL).")
    titulo_descodificado = texto_limpo("o título", titulo_cru)
    titulo = titulo_descodificado.strip()
    if not titulo:
        raise ConversaoFalhada("o título está em branco na origem.")
    if len(titulo) > COMPRIMENTO_TITULO_EVENTO:
        raise ConversaoFalhada(
            f"o título tem {len(titulo)} caracteres e no destino só cabem "
            f"{COMPRIMENTO_TITULO_EVENTO}. Encurta-o na origem."
        )

    data_crua = _exigir_texto("a data", str(tipo_data), _como_texto(data_bruta))
    inicio: datetime | None = None
    if data_crua is not None and data_crua.strip():
        inicio = meia_noite_em_utc(data_do_evento(data_crua))

    descricao_crua = _exigir_texto(
        "a descrição", str(tipo_descricao), _como_texto(descricao_bruta)
    )
    # **A descrição não leva `strip()`, e o nome e o título levam.** A
    # assimetria é de propósito e é esta a única folha onde está escrita:
    # o nome de um produto e o título de um evento são rótulos de uma
    # linha, onde um espaço no fim não é parte do nome e chega para o pôr
    # a parecer outro produto na ementa; a descrição é prosa, pode ter
    # mais do que uma linha, e as pontas dela — uma linha em branco antes
    # de uma assinatura, um avanço — são escolhas de quem escreveu. Cortar
    # as pontas da prosa é reescrever o texto do dono, e `backend/CLAUDE.md`
    # diz que o texto se guarda tal como foi escrito.
    descricao = (
        None if descricao_crua is None else texto_limpo("a descrição", descricao_crua)
    )

    referencia = _exigir_texto("a imagem", str(tipo_imagem), _como_texto(imagem_bruta))
    if referencia is not None and not referencia.strip():
        referencia = None
    imagem = (
        None if referencia is None or ignorar_imagens else nome_de_ficheiro(referencia)
    )

    return EventoPlaneado(
        id=_como_inteiro(id_),
        titulo=titulo,
        inicio=inicio,
        descricao=descricao,
        imagem=imagem,
        referencia_da_imagem=referencia,
        # `publicado = visivel`, mas um evento sem data entra sempre como
        # rascunho: é o `CHECK ck_eventos_publicado_exige_inicio` (ADR
        # 0009), e deixá-lo rebentar seria um IntegrityError a meio.
        publicado=bool(visivel) and inicio is not None,
        titulo_na_origem=None if titulo_descodificado == titulo_cru else titulo_cru,
        descricao_na_origem=(
            None
            if descricao_crua is None or descricao == descricao_crua
            else descricao_crua
        ),
    )


def _como_texto(valor: object) -> str | None:
    """O valor de uma coluna de texto, que o `CASE` já garantiu ser texto."""
    return None if valor is None else str(valor)


def _como_inteiro(valor: object) -> int:
    """O `id` de uma linha. É `INTEGER PRIMARY KEY`, logo nunca é nulo."""
    if not isinstance(valor, int):
        raise ConversaoFalhada(f"o identificador «{valor}» não é um inteiro.")
    return valor


def ler_produtos_da_origem(
    ligacao: sqlite3.Connection,
) -> tuple[list[ProdutoPlaneado], list[str]]:
    """Todos os produtos da origem, ou a lista dos que não se convertem.

    Converte **todos** e junta os problemas em vez de parar no primeiro:
    quem for corrigir a origem tem 140 produtos à frente, e uma viagem ao
    servidor por cada linha má é uma tarde inteira.
    """
    instrucao = (
        "SELECT id_produto, "
        + ", ".join(
            _expressao_de_texto(coluna) for coluna in ("nome_prod", "preco", "tipo")
        )
        + " FROM produtos ORDER BY id_produto"
    )
    planeados: list[ProdutoPlaneado] = []
    problemas: list[str] = []
    for linha in ligacao.execute(instrucao):
        try:
            planeados.append(planear_produto(linha))
        except ConversaoFalhada as erro:
            problemas.append(f"Produto {linha[0]}: {erro}")
    return planeados, problemas


def ler_eventos_da_origem(
    ligacao: sqlite3.Connection, *, ignorar_imagens: bool
) -> tuple[list[EventoPlaneado], list[str], list[str]]:
    """Os eventos da origem, os problemas e as notas sobre o que foi decidido."""
    instrucao = (
        "SELECT id, "
        + ", ".join(
            _expressao_de_texto(coluna)
            for coluna in ("nome_evento", "data_evento", "descricao", "imagem_url")
        )
        + ", visivel FROM eventos ORDER BY id"
    )
    planeados: list[EventoPlaneado] = []
    problemas: list[str] = []
    notas: list[str] = []
    for linha in ligacao.execute(instrucao):
        if linha[-1] is None:
            # `eventos.visivel` tem `DEFAULT 1` na origem, por isso um NULL
            # lá dentro foi escrito de propósito por alguém e não se sabe o
            # que queria dizer. Entra por publicar, que é o lado que o dono
            # pode desfazer na gestão — mas diz-se, em vez de se decidir em
            # silêncio.
            notas.append(
                f"Evento {linha[0]}: a coluna visivel da origem está a NULL; "
                "entra por publicar, e é na gestão que se publica."
            )
        try:
            planeados.append(planear_evento(linha, ignorar_imagens=ignorar_imagens))
        except ConversaoFalhada as erro:
            problemas.append(f"Evento {linha[0]}: {erro}")
    return planeados, problemas, notas


# --- O destino ------------------------------------------------------------


def caminho_do_destino(definicoes: Definicoes) -> Path:
    """O ficheiro SQLite para onde a `BASE_DADOS_URL` aponta."""
    url = make_url(definicoes.base_dados_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        # `render_as_string(hide_password=True)` e **nunca** a cadeia
        # original. Esta recusa só dispara para URLs que não são SQLite —
        # ou seja, precisamente as que trazem `utilizador:password@servidor`
        # lá dentro — e o relatório é texto que se copia e se cola num
        # pedido de ajuda.
        raise Recusa(
            "a BASE_DADOS_URL não aponta para um ficheiro SQLite "
            f"(«{url.render_as_string(hide_password=True)}»), e este script "
            "só sabe escrever num."
        )
    return Path(url.database).resolve()


def versao_em_head() -> str:
    """O `revision` de `head` das migrações desta instalação.

    O `script_location` é forçado para um caminho absoluto: o do
    `alembic.ini` é `migrations`, relativo à pasta de trabalho, e este
    script corre-se por SSH de onde calhar.
    """
    configuracao = Config(str(RAIZ_INSTALACAO / "alembic.ini"))
    configuracao.set_main_option("script_location", str(RAIZ_INSTALACAO / "migrations"))
    cabecas = ScriptDirectory.from_config(configuracao).get_heads()
    if len(cabecas) != 1:
        raise Recusa(
            f"as migrações desta instalação têm {len(cabecas)} cabeças "
            f"({enumerar(sorted(cabecas))}), e não uma só; não sei qual é o "
            "esquema que o destino devia ter."
        )
    return cabecas[0]


def problema_de_escrita_no_destino(destino: Path) -> str | None:
    """Dá para escrever no destino? `None` se dá; a frase, se não dá.

    **Verifica sem escrever nada e sem criar ficheiro nenhum ao lado.** O
    ficheiro abre-se em `r+b` e fecha-se logo: está medido que isso não
    muda o conteúdo, não muda a `mtime` e não deixa vizinhos na pasta — a
    mesma propriedade que `tests/seguranca/` já exige da origem. Um
    ficheiro temporário ao lado do destino seria uma escrita a sério, e
    numa pasta que pode ser a de produção.

    São **duas** perguntas e não uma, porque são dois problemas com a
    mesma correção mas em sítios diferentes:

    1. o ficheiro da base de dados aceita escrita;
    2. a **pasta** aceita escrita. Não chega a base de dados ser
       escrevível: em WAL — que é o modo que `app/db.py` impõe a cada
       ligação — o SQLite escreve `destino-wal` e `destino-shm` **ao
       lado**, e com a pasta em só-leitura a transação rebenta na mesma.

    Porquê um ramo próprio, e não deixar o `OperationalError` subir: um
    destino sem permissão de escrita é uma condição previsível, nomeável,
    e com uma correção de uma linha. Vale mais do que isso: o runbook
    (`docs/legado/importacao.md`, passo 2.3) manda copiar a base de dados
    de destino **à mão** antes de aplicar, porque a F2-02 ainda não
    trouxe o `scripts/backup.py` — uma cópia à mão com as permissões
    erradas é um resultado plausível de seguir as nossas próprias
    instruções. Sem este guarda, a mensagem que isso dava era «Rebentei a
    meio», que manda a pessoa abrir uma tarefa em vez de fazer `chmod`.
    """
    pasta = destino.parent
    if not os.access(pasta, os.W_OK | os.X_OK):
        return (
            f"A pasta {pasta}, onde o destino está, não me deixa escrever. "
            "Não chega a base de dados aceitar escrita: em modo WAL o "
            "SQLite escreve os ficheiros -wal e -shm ao lado dela, e para "
            "isso precisa da pasta. Isto são permissões, não é coisa que se "
            "corrija no script — dá-lhe escrita (`chmod u+w` na pasta) e "
            "corre outra vez."
        )
    try:
        with destino.open("r+b"):
            pass
    except PermissionError:
        return (
            f"O destino {destino} está em só-leitura: não consigo abri-lo "
            "para escrita. Isto são permissões, não é um defeito deste "
            "script nem coisa que ele resolva. Acontece a uma cópia feita à "
            "mão que ficou com as permissões do original — dá ao ficheiro "
            "permissão de escrita (`chmod u+w`) e corre outra vez."
        )
    except OSError as erro:
        # Regra 10: «não me deixam escrever» e «não consegui sequer
        # perguntar» não podem dar a mesma frase. O ramo de cima é a
        # permissão negada, que se resolve com um `chmod`; este é tudo o
        # resto — um sistema de ficheiros montado em só-leitura, um
        # ficheiro em uso exclusivo — e aí o que ajuda é o erro do
        # sistema, tal como ele saiu.
        return (
            f"Não consegui abrir o destino {destino} para escrita: {erro} "
            f"({type(erro).__name__}). Não é uma recusa por permissões do "
            "ficheiro — é o sistema a dizer outra coisa, e é por aí que se "
            "começa."
        )
    return None


def problemas_do_destino(destino: Path) -> list[str]:
    """O destino está em `head` e dá para lá escrever? Se não, diz o quê.

    Verifica-se **antes** de abrir o destino para escrita, e com uma
    ligação só de leitura: um ficheiro sem tabelas nenhumas dava
    «no such table: produtos» a meio, com parte do trabalho feito.

    As permissões verificam-se **antes** do esquema, de propósito: com os
    dois errados ao mesmo tempo, a correção do esquema é
    `alembic upgrade head` — que precisa de escrita e falhava na mesma,
    com um erro do alembic a dizer outra coisa qualquer. O `chmod` tem de
    vir primeiro porque é o que destranca o resto.
    """
    if not destino.is_file():
        return [
            f"O destino {destino} não existe. A base de dados da aplicação "
            "cria-se com `alembic upgrade head`, não com este script."
        ]

    problema_de_escrita = problema_de_escrita_no_destino(destino)
    if problema_de_escrita is not None:
        return [problema_de_escrita]

    ligacao = ligar_so_leitura(destino)
    try:
        if "alembic_version" not in tabelas_de(ligacao):
            return [
                f"O destino {destino} não tem a tabela alembic_version: "
                "nunca lhe correu migração nenhuma. Corre "
                "`alembic upgrade head` antes de importar."
            ]
        versoes = [
            versao
            for (versao,) in ligacao.execute("SELECT version_num FROM alembic_version")
        ]
    finally:
        ligacao.close()

    head = versao_em_head()
    if versoes != [head]:
        return [
            f"O destino {destino} {_em_que_versao(versoes)} e esta "
            f"instalação está na versão «{head}». O esquema que lá está não "
            "é o que este script conhece; uma coluna a mais ou a menos e o "
            "INSERT escreve nos sítios errados. Corre `alembic upgrade head`."
        ]
    return []


def _em_que_versao(versoes: Sequence[str]) -> str:
    """«está na versão «x»», «não tem versão nenhuma lá dentro», «tem 2…».

    Não o `repr` da lista. `['0000naoexiste']` com os parênteses retos e as
    plicas à vista é código a aparecer num relatório que é para uma pessoa
    ler, e `[]` — que é o que uma `alembic_version` vazia dá — não quer
    dizer nada a ninguém.
    """
    if not versoes:
        return "não tem versão nenhuma lá dentro"
    if len(versoes) == 1:
        return f"está na versão «{versoes[0]}»"
    return (
        f"tem {len(versoes)} versões lá dentro "
        f"({enumerar([f'«{versao}»' for versao in versoes])})"
    )


# --- As imagens -----------------------------------------------------------


@dataclass(frozen=True)
class PlanoDasImagens:
    """O que fazer aos ficheiros das imagens dos eventos."""

    #: `nome no MEDIA_DIR` -> ficheiro de origem a copiar.
    a_copiar: dict[str, Path]
    #: Quantas já estavam no `MEDIA_DIR`, iguais byte a byte.
    ja_la_estavam: int
    problemas: list[str]


def problema_de_escrita_no_media(media: Path, quantas: int) -> str | None:
    """Dá para copiar `quantas` imagens para o `MEDIA_DIR`? A frase, se não dá.

    O par do `problema_de_escrita_no_destino`, e pela mesma razão — mas a
    consequência de o não ter era pior. A cópia das imagens corre
    **dentro** da transação, antes do `commit`, e um `PermissionError` do
    `copyfile` a meio levava o script inteiro ao «Rebentei a meio»: a base
    de dados safava-se (o `with Session(...)` desfaz tudo, e o `commit` só
    vem depois das cópias), mas as imagens já copiadas ficavam lá, e a
    mensagem mandava abrir uma tarefa em vez de fazer `chmod`.

    **Corre na simulação também**, e é aí que ele vale mais: quem simula
    está a perguntar se o `--aplicar` vai correr bem. Uma simulação verde
    seguida de um `--aplicar` que rebenta é o pior dos resultados — a
    rede que a simulação existe para dar, desperdiçada.

    Só se pergunta quando há mesmo imagens para copiar. Com zero —
    segunda corrida, tudo já lá — um `MEDIA_DIR` em só-leitura não impede
    nada, e recusar seria recusar uma corrida que funcionava.

    A pasta pode ainda não existir: o script cria-a com
    `mkdir(parents=True)`. Nesse caso a pergunta faz-se ao antepassado
    mais próximo que exista, que é quem tem de aceitar a criação.
    """
    if quantas == 0:
        return None
    existente = media
    while not existente.exists() and existente != existente.parent:
        existente = existente.parent
    if not existente.is_dir():
        return (
            f"O MEDIA_DIR aponta para {media}, e {existente} existe mas não "
            "é uma pasta. É para aí que as imagens dos eventos têm de ser "
            "copiadas, e não há como criar uma pasta por cima de um "
            "ficheiro. Corrige o MEDIA_DIR no ficheiro de ambiente."
        )
    if not os.access(existente, os.W_OK | os.X_OK):
        imagens = contagem(quantas, "imagem", "imagens")
        # O segundo caminho só se diz quando é mesmo outro: com o
        # `MEDIA_DIR` já criado, a pasta sem escrita **é** o `MEDIA_DIR`, e
        # repetir o caminho na mesma frase faz quem lê procurar uma
        # diferença que não existe.
        onde = f" ({media})" if existente != media else ""
        return (
            f"A pasta {existente}{onde} não me deixa escrever, e há "
            f"{imagens} de eventos para copiar para o MEDIA_DIR. Isto são "
            "permissões, não é coisa que se corrija no script — dá-lhe "
            "escrita (`chmod u+w`) e corre outra vez, ou corre com "
            f"--imagens {IGNORAR} e os eventos entram sem cartaz."
        )
    return None


def _ligacao_para_fora(caminho: Path, pasta: Path) -> Path | None:
    """Para onde `caminho` aponta, se não for um ficheiro mesmo dentro de `pasta`.

    `None` quer dizer «não é ligação nenhuma e está onde diz que está».

    Duas verificações, e são diferentes uma da outra. O `is_symlink()` é a
    que tem dentes: é a única que não segue a ligação, e o `is_file()` e o
    `shutil.copyfile` seguem-nas os dois. A comparação do `resolve().parent`
    com a pasta é a que continua certa se a primeira deixar de chegar — uma
    pasta trocada por uma ligação entre o momento em que isto corre e o da
    cópia, por exemplo. Honestamente: hoje, com a `pasta` já resolvida e o
    nome do ficheiro sem `/` nenhum, a segunda nunca dispara sozinha, e
    nenhum teste a prende. Fica escrita na mesma, porque o que ela diz é a
    regra — o ficheiro tem de estar **naquela** pasta — e a primeira é só a
    maneira de hoje de lá chegar.
    """
    if caminho.is_symlink():
        return caminho.resolve()
    if caminho.exists() and caminho.resolve().parent != pasta:
        return caminho.resolve()
    return None


def planear_imagens(
    eventos: Sequence[EventoPlaneado], *, pasta: Path, media: Path
) -> PlanoDasImagens:
    """Verifica cada imagem e decide o que copiar. Pára no primeiro problema.

    Parar, e não continuar a juntar problemas como nos produtos: aqui o
    que vem a seguir são **ficheiros**, e metade das imagens copiadas é um
    estado que já não se desfaz com um `ROLLBACK`.

    **As ligações simbólicas recusam-se dos dois lados.** O `is_file()`
    segue-as por omissão e o `shutil.copyfile` lê e escreve através delas,
    por isso sem estes guardas uma ligação em `img/uploads/cartaz.jpg` a
    apontar para `~/tomazia_api/.env` punha os bytes do segredo no
    `MEDIA_DIR` com um nome de cartaz, servido por HTTP; e uma ligação já
    no `MEDIA_DIR` fazia a cópia **escrever para fora dele**, no sítio para
    onde a ligação aponta. O `img/uploads/` do site antigo é pasta de
    uploads: o que lá está veio de fora.
    """
    pasta = pasta.resolve()
    media = media.resolve()
    a_copiar: dict[str, Path] = {}
    ja_la_estavam = 0
    for evento in eventos:
        if evento.imagem is None:
            continue
        origem = pasta / evento.imagem
        quem = f"Evento {evento.id} «{evento.titulo}»"
        fora_da_pasta = _ligacao_para_fora(origem, pasta)
        if fora_da_pasta is not None:
            return PlanoDasImagens(
                a_copiar={},
                ja_la_estavam=0,
                problemas=[
                    f"{quem}: a imagem «{evento.imagem}» em {pasta} é uma "
                    f"ligação simbólica para {fora_da_pasta}, e não um "
                    "ficheiro. Copiá-la punha no MEDIA_DIR — que é servido "
                    "pela web — os bytes do que estiver do outro lado. Não "
                    "sigo ligações: põe lá o ficheiro de imagem mesmo."
                ],
            )
        if not origem.is_file():
            return PlanoDasImagens(
                a_copiar={},
                ja_la_estavam=0,
                problemas=[
                    f"{quem}: a imagem «{evento.referencia_da_imagem}» não "
                    f"está em {pasta}. Parei aqui e não copiei nada: metade "
                    "dos cartazes no sítio é pior do que nenhum, porque não "
                    f"se vê quais faltam. Põe o ficheiro em {pasta}, ou corre "
                    f"com --imagens {IGNORAR} e os eventos entram sem cartaz."
                ],
            )

        ja_no_media = media / evento.imagem
        destino_para_fora = _ligacao_para_fora(ja_no_media, media)
        if destino_para_fora is not None:
            return PlanoDasImagens(
                a_copiar={},
                ja_la_estavam=0,
                problemas=[
                    f"{quem}: já existe «{evento.imagem}» em {media}, e é uma "
                    f"ligação simbólica para {destino_para_fora}. Escrever "
                    "por cima dela era escrever para fora do MEDIA_DIR, no "
                    "sítio para onde ela aponta. Tira-a de lá à mão e corre "
                    "outra vez."
                ],
            )
        if ja_no_media.is_file():
            if filecmp.cmp(origem, ja_no_media, shallow=False):
                ja_la_estavam += 1
                continue
            return PlanoDasImagens(
                a_copiar={},
                ja_la_estavam=0,
                problemas=[
                    f"{quem}: já existe um ficheiro «{evento.imagem}» em "
                    f"{media} com outro conteúdo. Não sobreponho — um "
                    "ficheiro sobreposto não se recupera como uma linha de "
                    "base de dados —, e parei aqui. Vê qual das duas é a boa, "
                    f"trata disso à mão em {media}, e corre outra vez."
                ],
            )

        anterior = a_copiar.get(evento.imagem)
        if anterior is not None and not filecmp.cmp(anterior, origem, shallow=False):
            return PlanoDasImagens(
                a_copiar={},
                ja_la_estavam=0,
                problemas=[
                    f"{quem}: dois eventos referem ficheiros diferentes que "
                    f"dão o mesmo nome «{evento.imagem}» depois de reduzido "
                    f"({anterior} e {origem}). Um deles ficaria por cima do "
                    "outro, e parei aqui."
                ],
            )
        a_copiar[evento.imagem] = origem

    return PlanoDasImagens(a_copiar=a_copiar, ja_la_estavam=ja_la_estavam, problemas=[])


# --- Comparar com o que já lá está ---------------------------------------


@dataclass
class Plano:
    """O que falta escrever no destino, e o que lá está diferente."""

    categorias_a_criar: list[str]
    produtos_a_inserir: list[ProdutoPlaneado]
    eventos_a_inserir: list[EventoPlaneado]
    categorias_ja_la: int
    produtos_ja_la: int
    eventos_ja_la: int
    divergencias: list[str]


def _valor(valor: object) -> str:
    """Um valor do destino ou da origem, legível num relatório.

    Não é `repr`: o `repr` de um instante é
    `datetime.datetime(2026, 6, 30, 23, 0, tzinfo=...)`, e quem lê isto
    quer ver uma data. As cadeias vão entre aspas angulares para se ver
    onde começam e acabam — um espaço a mais no fim de um nome é uma
    divergência verdadeira e invisível sem elas.
    """
    if valor is None:
        # «(sem valor)» e não «nada» nem «nulo»: a frase que o envolve é
        # «... é {valor} ...», e nem «nada» nem «nulo» concordam em género
        # com todos os campos («a imagem», «o início»).
        return "(sem valor)"
    if isinstance(valor, datetime):
        return valor.isoformat()
    if isinstance(valor, str):
        return f"«{valor}»"
    return str(valor)


def _preco(centimos: int, *, com_unidade: bool = False) -> str:
    """`999` -> `9,99 € (999 cêntimos)`, ou `9,99 € (999)` do segundo lado.

    Os euros à frente porque quem lê isto é uma pessoa deste bar e o preço
    dela tem vírgula e um símbolo; os cêntimos ao lado porque é o que está
    escrito na coluna, e é com esse número que se faz o `UPDATE` que
    resolve a divergência. A palavra «cêntimos» diz-se uma vez só, do lado
    do destino: repeti-la no segundo não acrescenta nada à frase.
    """
    euros = f"{centimos // 100},{centimos % 100:02d} €"
    return f"{euros} ({centimos} cêntimos)" if com_unidade else f"{euros} ({centimos})"


def _divergencia_formatada(
    quem: str, campo: str, no_destino: str, na_origem: str
) -> str:
    return (
        f"{quem}: no destino {campo} é {no_destino} e a origem diz "
        f"{na_origem}. Não toquei em nada (ADR 0014: só se insere); "
        "quem decide qual dos dois vale é uma pessoa."
    )


def _divergencia(quem: str, campo: str, no_destino: object, na_origem: object) -> str:
    return _divergencia_formatada(quem, campo, _valor(no_destino), _valor(na_origem))


def slugs_pedidos_pela_origem(produtos: Sequence[ProdutoPlaneado]) -> list[str]:
    """Os `slug` que a origem pede, por ordem na ementa e sem repetições.

    Função à parte porque serve dois sítios: a comparação com o destino e
    o guarda do `--esperar-categorias`, que corre **antes** de o destino
    ser sequer aberto. Onze é o número que o Tomás confirma, e ele sai
    daqui — não do que já lá estava.
    """
    return sorted(
        {produto.slug for produto in produtos}, key=lambda slug: CATEGORIAS[slug][1]
    )


def comparar_com_o_destino(
    sessao: Session,
    produtos: Sequence[ProdutoPlaneado],
    eventos: Sequence[EventoPlaneado],
) -> Plano:
    """Separa o que falta inserir do que já lá está, e lista as divergências."""
    categorias_no_destino = {
        categoria.slug: categoria for categoria in sessao.scalars(select(Categoria))
    }
    por_id = {categoria.id: categoria for categoria in categorias_no_destino.values()}
    produtos_no_destino = {
        produto.id: produto for produto in sessao.scalars(select(Produto))
    }
    eventos_no_destino = {
        evento.id: evento for evento in sessao.scalars(select(Evento))
    }

    divergencias: list[str] = []

    # As categorias que a origem pede, por ordem na ementa.
    slugs_pedidos = slugs_pedidos_pela_origem(produtos)
    categorias_ja_la = 0
    for slug in slugs_pedidos:
        nome, ordem = CATEGORIAS[slug]
        existente = categorias_no_destino.get(slug)
        if existente is None:
            continue
        categorias_ja_la += 1
        quem = f"Categoria «{slug}»"
        if existente.nome != nome:
            divergencias.append(_divergencia(quem, "o nome", existente.nome, nome))
        if existente.ordem != ordem:
            divergencias.append(_divergencia(quem, "a ordem", existente.ordem, ordem))

    produtos_a_inserir: list[ProdutoPlaneado] = []
    produtos_ja_la = 0
    for produto in produtos:
        existente_p = produtos_no_destino.get(produto.id)
        if existente_p is None:
            produtos_a_inserir.append(produto)
            continue
        produtos_ja_la += 1
        quem = f"Produto {produto.id} «{produto.nome}»"
        if existente_p.nome != produto.nome:
            divergencias.append(
                _divergencia(quem, "o nome", existente_p.nome, produto.nome)
            )
        if existente_p.preco_cent != produto.preco_cent:
            divergencias.append(
                _divergencia_formatada(
                    quem,
                    "o preço",
                    _preco(existente_p.preco_cent, com_unidade=True),
                    _preco(produto.preco_cent),
                )
            )
        categoria_atual = por_id.get(existente_p.categoria_id)
        slug_atual = None if categoria_atual is None else categoria_atual.slug
        if slug_atual != produto.slug:
            divergencias.append(
                _divergencia(quem, "a categoria", slug_atual, produto.slug)
            )

    eventos_a_inserir: list[EventoPlaneado] = []
    eventos_ja_la = 0
    for evento in eventos:
        existente_e = eventos_no_destino.get(evento.id)
        if existente_e is None:
            eventos_a_inserir.append(evento)
            continue
        eventos_ja_la += 1
        quem = f"Evento {evento.id} «{evento.titulo}»"
        if existente_e.titulo != evento.titulo:
            divergencias.append(
                _divergencia(quem, "o título", existente_e.titulo, evento.titulo)
            )
        if existente_e.inicio != evento.inicio:
            divergencias.append(
                _divergencia(quem, "o início", existente_e.inicio, evento.inicio)
            )
        if existente_e.descricao != evento.descricao:
            divergencias.append(
                _divergencia(
                    quem, "a descrição", existente_e.descricao, evento.descricao
                )
            )
        if existente_e.imagem != evento.imagem:
            divergencias.append(
                _divergencia(quem, "a imagem", existente_e.imagem, evento.imagem)
            )

    # As categorias criam-se **a pedido** (ADR 0014): só quando há um
    # produto novo para lhes pendurar. Sem isto, a segunda corrida depois
    # de o dono mexer na gestão criava categorias vazias, que o JOIN
    # interno da F2-03 esconde do site — e por isso também de quem as
    # tivesse de corrigir.
    #
    # Honestamente: hoje a segunda metade da condição não chega a decidir
    # nada, e nenhum teste a prende (medido, tirando-a a bateria fica
    # verde). É que um `slug` só falta no destino se nenhuma linha de
    # `produtos` lá apontar, e qualquer produto da origem que já lá
    # estivesse noutra categoria sai acima como divergência, antes de se
    # chegar aqui. Fica escrita na mesma, porque é a regra do ADR e porque
    # é a condição que continua certa se as regras de divergência mudarem.
    pedidos_por_produto_novo = {produto.slug for produto in produtos_a_inserir}
    categorias_a_criar = [
        slug
        for slug in slugs_pedidos
        if slug not in categorias_no_destino and slug in pedidos_por_produto_novo
    ]

    return Plano(
        categorias_a_criar=categorias_a_criar,
        produtos_a_inserir=produtos_a_inserir,
        eventos_a_inserir=eventos_a_inserir,
        categorias_ja_la=categorias_ja_la,
        produtos_ja_la=produtos_ja_la,
        eventos_ja_la=eventos_ja_la,
        divergencias=divergencias,
    )


def escrever(sessao: Session, plano: Plano) -> None:
    """Põe na sessão tudo o que falta. Não consolida: quem o faz é quem chama."""
    criadas: dict[str, Categoria] = {}
    for slug in plano.categorias_a_criar:
        nome, ordem = CATEGORIAS[slug]
        categoria = Categoria(nome=nome, slug=slug, ordem=ordem)
        sessao.add(categoria)
        criadas[slug] = categoria
    sessao.flush()

    por_slug = {
        categoria.slug: categoria for categoria in sessao.scalars(select(Categoria))
    }
    por_slug.update(criadas)

    for produto in plano.produtos_a_inserir:
        sessao.add(
            Produto(
                id=produto.id,
                categoria_id=por_slug[produto.slug].id,
                nome=produto.nome,
                preco_cent=produto.preco_cent,
                # Escritos à mão, e não deixados ao `server_default`: o
                # `server_default` existe para um INSERT em SQL cru não
                # rebentar, não para decidir o conteúdo da ementa.
                disponivel=True,
                ordem=0,
            )
        )
    for evento in plano.eventos_a_inserir:
        sessao.add(
            Evento(
                id=evento.id,
                titulo=evento.titulo,
                inicio=evento.inicio,
                descricao=evento.descricao,
                imagem=evento.imagem,
                publicado=evento.publicado,
            )
        )
    sessao.flush()


# --- O relatório ----------------------------------------------------------


def conclusao_da_recusa(quantos: int) -> str:
    """A conclusão de "não consegui fazer".

    **A primeira palavra arruma o resultado**, e é por isso que as três
    conclusões começam cada uma com a sua: «Importação», «Já» e «Recusei».
    O estado de saída é o que o terminal vê, não o que a pessoa lê, e as
    duas que mais interessa distinguir — «não havia nada» e «não consegui»
    — eram, antes, as duas que mais se pareciam: mesma palavra inicial,
    mesma negação, mesmo verbo.

    «Recusei» e não «Não importei» porque diz que a coisa não se fez **de
    propósito**, em vez de ter rebentado — e é o verbo que o resto do
    ficheiro já usa.
    """
    problema = "problema" if quantos == 1 else "problemas"
    return (
        f"Recusei importar: há {quantos} {problema} por resolver acima, "
        "e o destino ficou exatamente como estava."
    )


def conclusao_do_rebentamento(erro: BaseException) -> str:
    """A **quarta** conclusão: um defeito do script, não uma recusa.

    Sem ela, um `IntegrityError` do `flush` ou um `OSError` do `copyfile`
    saíam em `stderr`, com estado diferente de zero e sem linha nenhuma de
    conclusão — um quarto resultado sem frase, encostado às três que têm
    uma. Diz-se que não é recusa porque a diferença decide o que se faz a
    seguir: uma recusa corrige-se na origem, isto abre uma tarefa.

    **Uma linha, sempre.** A mensagem da exceção fica na linha de cima,
    tal como o sistema a escreveu — a de um `IntegrityError` do SQLAlchemy
    traz o SQL e os parâmetros, em várias linhas, e metê-la aqui dentro
    partia a conclusão ao meio. Quem lê o relatório lê a **última linha
    não vazia** como conclusão; uma conclusão de cinco linhas faz com que
    a última seja um pedaço de um URL.
    """
    return (
        f"Rebentei a meio, com um {type(erro).__name__} — o detalhe está "
        "acima e o traceback vai a seguir, em stderr. Isto não é uma recusa: "
        "uma recusa corrige-se na origem ou nas permissões, e isto abre uma "
        "tarefa. A base de dados não leva nada que não tenha passado por um "
        "commit. Guarda o relatório inteiro."
    )


def recusar(problemas: Sequence[str]) -> int:
    """Escreve os problemas e a conclusão, e devolve o estado de saída."""
    for problema in problemas:
        print(problema)
    print(conclusao_da_recusa(len(problemas)))
    return 1


def contagem(quantos: int, singular: str, plural: str) -> str:
    return f"{quantos} {singular if quantos == 1 else plural}"


def por_fazer(quantos: int, singular: str, plural: str, verbo: str) -> str:
    """«3 novos» quando se escreve, «3 por inserir» quando só se simula.

    O tempo verbal é do modo, não do campo: numa simulação nada é «novo»
    no destino, porque lá não ficou nada.
    """
    if verbo:
        return f"{quantos} por {verbo}"
    return contagem(quantos, singular, plural)


def resumo_do_plano(plano: Plano, *, aplicar: bool) -> list[str]:
    """As três linhas de contagens, no tempo verbal do modo em que se corre."""
    criar = "" if aplicar else "criar"
    inserir = "" if aplicar else "inserir"
    return [
        f"Categorias: "
        f"{por_fazer(len(plano.categorias_a_criar), 'nova', 'novas', criar)}, "
        f"{plano.categorias_ja_la} já lá estavam.",
        f"Produtos: "
        f"{por_fazer(len(plano.produtos_a_inserir), 'novo', 'novos', inserir)}, "
        f"{plano.produtos_ja_la} já lá estavam.",
        f"Eventos: "
        f"{por_fazer(len(plano.eventos_a_inserir), 'novo', 'novos', inserir)}, "
        f"{plano.eventos_ja_la} já lá estavam.",
    ]


def linhas_das_categorias(produtos: Sequence[ProdutoPlaneado]) -> list[str]:
    """As categorias com nome, as que se juntaram e as que mudam de nome.

    Três números sem nomes não deixam ninguém confirmar o «Feito quando»
    da F2-08. Estas linhas nomeiam o que os números contam, e cada uma
    responde a uma pergunta que alguém faria a olhar para o relatório:
    *quais* são as onze e por que ordem aparecem; porque é que são onze se
    a origem tem doze `tipo`; e quais os nomes que o site novo escreve de
    outra maneira.
    """
    pedidos = slugs_pedidos_pela_origem(produtos)
    if not pedidos:
        return []

    linhas = [
        "Categorias, por esta ordem na ementa: "
        + ", ".join(CATEGORIAS[slug][0] for slug in pedidos)
        + "."
    ]

    # A junção é **genérica**, sobre qualquer par que normalize para o
    # mesmo slug, e não um caso especial com «Bebidas» escrito à mão: um
    # caso especial resolve um par e deixa o próximo por resolver. E só se
    # diz quando as duas formas aparecem mesmo na origem — anunciar uma
    # junção que não aconteceu é ruído.
    formas: dict[str, list[str]] = {}
    for produto in produtos:
        vistas = formas.setdefault(produto.slug, [])
        if produto.tipo not in vistas:
            vistas.append(produto.tipo)
    for slug in pedidos:
        vistas = formas[slug]
        if len(vistas) < 2:
            continue
        linhas.append(
            f"Os tipos {enumerar([f'«{forma}»' for forma in sorted(vistas)])} são "
            f"o mesmo escrito de {quantos(len(vistas), QUANTOS_FEMININO)} "
            # «ficam» e não «ficaram»: estas linhas saem iguais na
            # simulação e na corrida a sério, e numa simulação nada ficou
            # em sítio nenhum. O tempo verbal do modo é das três linhas de
            # contagens (ver `por_fazer`), que é onde a diferença conta.
            f"maneiras: os produtos dos {quantos(len(vistas), QUANTOS_MASCULINO)} "
            f"ficam todos em «{CATEGORIAS[slug][0]}»."
        )

    # Os nomes que mudam. «espirituosas» -> «Espirituosas» não conta: é só
    # a maiúscula, e o `normalizar_slug` do nome novo dá o mesmo slug.
    mudados = [
        f"«{slug}» passa a «{CATEGORIAS[slug][0]}»"
        for slug in pedidos
        if normalizar_slug(CATEGORIAS[slug][0]) != slug
    ]
    if mudados:
        linhas.append(
            f"{quantos(len(mudados), QUANTOS_MASCULINO).capitalize()} tipos "
            f"mudam de nome no site novo: {enumerar(mudados)}."
            if len(mudados) > 1
            else f"Um tipo muda de nome no site novo: {mudados[0]}."
        )
    return linhas


def linhas_das_descodificacoes(
    produtos: Sequence[ProdutoPlaneado], eventos: Sequence[EventoPlaneado]
) -> list[str]:
    """O que o script reescreveu ao desfazer o `htmlspecialchars`, nomeado.

    São nomes da carta do dono a serem mudados por um script, e a
    contagem sozinha não deixa ninguém confirmar que mudaram para o que
    deviam. Lista-se o antes e o depois, um por linha, como se faz com as
    imagens que ficam de fora com `--imagens ignorar`.

    **Os nomes e os títulos listam-se; as descrições só se contam.** Não é
    descuido: um nome de produto é uma linha, e uma descrição de evento
    pode ter parágrafos — enfiada numa linha de relatório, parte-a ao meio
    e o relatório deixa de se ler. Quem quiser ver uma descrição vê-a na
    gestão, que é onde ela se corrige.
    """
    nomes: list[tuple[str, str, str]] = [
        (f"Produto {produto.id}", produto.nome_na_origem, produto.nome)
        for produto in produtos
        if produto.nome_na_origem is not None
    ]
    titulos: list[tuple[str, str, str]] = [
        (f"Evento {evento.id}", evento.titulo_na_origem, evento.titulo)
        for evento in eventos
        if evento.titulo_na_origem is not None
    ]
    descricoes = sum(1 for evento in eventos if evento.descricao_na_origem is not None)

    partes = []
    if nomes:
        partes.append(contagem(len(nomes), "nome de produto", "nomes de produto"))
    if titulos:
        partes.append(contagem(len(titulos), "título de evento", "títulos de evento"))
    if descricoes:
        partes.append(
            contagem(descricoes, "descrição de evento", "descrições de evento")
        )
    if not partes:
        return []
    return [
        f"Textos descodificados: {enumerar(partes)} tinham entidades HTML na "
        "origem e entram como se escrevem.",
        *(
            f"  {quem}: «{antes}» -> «{depois}»"
            for quem, antes, depois in [*nomes, *titulos]
        ),
    ]


def conclusao_do_plano(plano: Plano, *, aplicar: bool) -> str:
    """A conclusão de "importei isto" ou de "não havia nada para fazer"."""
    quantas = len(plano.categorias_a_criar)
    quantos_produtos = len(plano.produtos_a_inserir)
    quantos_eventos = len(plano.eventos_a_inserir)
    nada = quantas == 0 and quantos_produtos == 0 and quantos_eventos == 0
    linhas = (
        f"{contagem(quantas, 'categoria', 'categorias')}, "
        f"{contagem(quantos_produtos, 'produto', 'produtos')} e "
        f"{contagem(quantos_eventos, 'evento', 'eventos')}"
    )
    if not aplicar:
        if nada:
            return (
                "Simulei e não escrevi nada — e com --aplicar também não "
                "entrava nada: o destino já tem tudo o que a origem diz."
            )
        return f"Simulei e não escrevi nada: com --aplicar entravam {linhas}."
    if nada:
        return (
            "Já lá estava tudo: o destino tem tudo o que a origem diz, e não "
            "houve nada a escrever."
        )
    return f"Importação feita: entraram {linhas}."


# --- O trabalho todo ------------------------------------------------------


def aplicar_no_destino(
    definicoes: Definicoes,
    produtos: Sequence[ProdutoPlaneado],
    eventos: Sequence[EventoPlaneado],
    imagens: PlanoDasImagens,
    media: Path,
    *,
    aplicar: bool,
) -> tuple[Plano, int]:
    """Escreve (ou simula) numa transação só, e devolve o plano e as cópias.

    Simular não é não abrir a base de dados: é não lhe deixar lá nada. A
    transação corre na mesma — é o que faz um `CHECK` ou um `NOT NULL`
    aparecer na simulação e não só no dia em que se aplica —, e desfaz-se
    no fim.
    """
    motor = criar_engine(definicoes.base_dados_url)
    copiadas = 0
    try:
        with Session(motor) as sessao:
            plano = comparar_com_o_destino(sessao, produtos, eventos)
            if plano.divergencias:
                sessao.rollback()
                return plano, 0

            escrever(sessao, plano)

            # Os ficheiros primeiro, a consolidação depois. Pela ordem
            # contrária, uma cópia falhada deixava linhas a apontar para
            # imagens que o site não serve; assim, o pior que acontece é um
            # ficheiro a mais no MEDIA_DIR e uma segunda corrida a dizer
            # "já lá estava".
            if aplicar and imagens.a_copiar:
                media.mkdir(parents=True, exist_ok=True)
                for nome, ficheiro in imagens.a_copiar.items():
                    shutil.copyfile(ficheiro, media / nome)
                    copiadas += 1

            if aplicar:
                sessao.commit()
            else:
                sessao.rollback()
            return plano, copiadas
    finally:
        motor.dispose()


def listar_imagens_ignoradas(eventos: Sequence[EventoPlaneado]) -> None:
    """Diz **quais** as imagens que ficaram de fora com `--imagens ignorar`.

    Sem esta lista, "este evento não tem imagem" e "ninguém me disse o que
    fazer às imagens" acabam os dois em `NULL` na base de dados, e não há
    mais nada no caminho a dizer qual é qual.
    """
    de_fora = [
        f"  Evento {evento.id} «{evento.titulo}»: {evento.referencia_da_imagem}"
        for evento in eventos
        if evento.referencia_da_imagem is not None
    ]
    if not de_fora:
        return
    print(
        f"Imagens: ficaram de fora, por --imagens {IGNORAR}; estes eventos "
        "entram sem imagem:"
    )
    for linha in de_fora:
        print(linha)


def ler_a_origem(
    origem: Path, *, ignorar_imagens: bool
) -> tuple[list[ProdutoPlaneado], list[EventoPlaneado], list[str], list[str]]:
    """Lê a origem inteira. Devolve produtos, eventos, problemas e notas.

    Levanta `Recusa` quando não consegue **ler**, que é coisa diferente de
    não encontrar nada lá dentro (regra 10 do `CLAUDE.md`).
    """
    try:
        ligacao = ligar_so_leitura(origem)
    except sqlite3.Error as erro:
        raise Recusa(
            f"Não consegui abrir a origem {origem} para leitura: {erro} "
            f"({type(erro).__name__})."
        ) from erro
    try:
        em_falta = sorted({"produtos", "eventos"} - tabelas_de(ligacao))
        if em_falta:
            tabela = "a tabela" if len(em_falta) == 1 else "as tabelas"
            raise Recusa(
                f"A origem {origem} não tem {tabela} {enumerar(em_falta)}. "
                "Isto não parece a base de dados do site antigo; confirma "
                "que é a cópia certa."
            )
        produtos, problemas_dos_produtos = ler_produtos_da_origem(ligacao)
        eventos, problemas_dos_eventos, notas = ler_eventos_da_origem(
            ligacao, ignorar_imagens=ignorar_imagens
        )
    except sqlite3.Error as erro:
        raise Recusa(
            f"Não consegui ler a origem {origem}: {erro} ({type(erro).__name__})."
        ) from erro
    finally:
        ligacao.close()
    return produtos, eventos, [*problemas_dos_produtos, *problemas_dos_eventos], notas


def problemas_das_contagens_esperadas(
    produtos: Sequence[ProdutoPlaneado], opcoes: argparse.Namespace
) -> list[str]:
    """Confere o que a origem traz contra o `--esperar-*`, se ele foi passado.

    O «Feito quando» da F2-08 é «o Tomás confirma 140 produtos e 11
    categorias», e as contagens do relatório não o deixam confirmar: ler
    um número e concordar com ele é o mesmo gesto. Com estas duas
    bandeiras o número vai **antes**, na linha de comandos, e é a máquina
    que o confere — na máquina dele, sem nós vermos um único dado do bar.

    Confere-se contra a **origem**, e não contra o que ficou no destino: é
    da origem que os dois números são, e assim a resposta é a mesma na
    simulação, na corrida a sério e na segunda corrida, em que já não
    entra nada.

    Corre antes de o destino ser aberto para escrita e antes de qualquer
    imagem ser copiada: um número que não bate quer dizer que a cópia não
    é a que se pensa, e aí não se escreve coisa nenhuma.
    """
    problemas: list[str] = []
    esperados = (
        (opcoes.esperar_produtos, len(produtos), "produtos", "--esperar-produtos"),
        (
            opcoes.esperar_categorias,
            len(slugs_pedidos_pela_origem(produtos)),
            "categorias",
            "--esperar-categorias",
        ),
    )
    for esperado, encontrado, o_que, bandeira in esperados:
        if esperado is None or esperado == encontrado:
            continue
        problemas.append(
            f"Esperava {esperado} {o_que} e a origem dá {encontrado}. Ou a "
            "cópia que passaste não é a que pensas, ou o número que puseste "
            f"em {bandeira} já não é o de hoje. Não escrevi nada."
        )
    return problemas


def importar(opcoes: argparse.Namespace) -> int:
    """Faz a importação (ou simula-a) e devolve o estado de saída."""
    try:
        definicoes = obter_definicoes()
    except ValidationError as erro:
        return recusar(
            [
                "Não consegui ler a configuração. Um script corrido por SSH "
                "precisa da variável AMBIENTE, que não tem valor por "
                f"omissão.\n{erro}"
            ]
        )

    try:
        destino = caminho_do_destino(definicoes)
    except Recusa as recusa:
        return recusar([str(recusa)])

    origem = Path(opcoes.origem).resolve()
    media = Path(definicoes.media_dir).resolve()
    aplicar = bool(opcoes.aplicar)
    ignorar_imagens = str(opcoes.imagens) == IGNORAR
    pasta_das_imagens = None if ignorar_imagens else Path(opcoes.imagens).resolve()

    # A primeira linha do relatório é o destino, sempre: quem corre isto
    # por SSH tem de ver em que base de dados vai mexer antes de ver o
    # resto.
    print(f"Destino: {destino}")
    print(f"Origem: {origem}")
    print(
        "Modo: a aplicar — o que faltar é escrito no destino."
        if aplicar
        else "Modo: simulação — não escrevo nada. Acrescenta --aplicar para "
        "escrever mesmo."
    )

    if not origem.is_file():
        return recusar(
            [
                f"A origem {origem} não existe, ou não é um ficheiro. É "
                "suposto ser uma cópia da base de dados do site antigo, "
                "nunca a original."
            ]
        )
    if pasta_das_imagens is not None and not pasta_das_imagens.is_dir():
        return recusar(
            [
                f"A pasta das imagens {pasta_das_imagens} não existe. Passa "
                "a pasta onde estão os ficheiros do site antigo, ou "
                f"--imagens {IGNORAR} para os eventos entrarem sem imagem."
            ]
        )

    try:
        problemas_do_esquema = problemas_do_destino(destino)
    except Recusa as recusa:
        return recusar([str(recusa)])
    if problemas_do_esquema:
        return recusar(problemas_do_esquema)

    try:
        produtos, eventos, problemas, notas = ler_a_origem(
            origem, ignorar_imagens=ignorar_imagens
        )
    except Recusa as recusa:
        return recusar([str(recusa)])

    for nota in notas:
        print(nota)

    if not produtos and not problemas:
        return recusar(
            [
                "A tabela produtos da origem não tem uma única linha. A carta "
                "do bar tem cerca de 140 produtos: um ficheiro vazio é quase "
                "sempre a cópia errada, e não uma carta que ficou sem nada. "
                "Confirma o ficheiro que passaste em --origem."
            ]
        )
    if problemas:
        return recusar(problemas)

    problemas_de_contagem = problemas_das_contagens_esperadas(produtos, opcoes)
    if problemas_de_contagem:
        return recusar(problemas_de_contagem)

    if pasta_das_imagens is None:
        listar_imagens_ignoradas(eventos)
        plano_das_imagens = PlanoDasImagens(a_copiar={}, ja_la_estavam=0, problemas=[])
    else:
        plano_das_imagens = planear_imagens(
            eventos, pasta=pasta_das_imagens, media=media
        )
        if plano_das_imagens.problemas:
            return recusar(plano_das_imagens.problemas)
        problema_do_media = problema_de_escrita_no_media(
            media, len(plano_das_imagens.a_copiar)
        )
        if problema_do_media is not None:
            return recusar([problema_do_media])

    plano, copiadas = aplicar_no_destino(
        definicoes, produtos, eventos, plano_das_imagens, media, aplicar=aplicar
    )
    if plano.divergencias:
        return recusar(plano.divergencias)

    for linha in resumo_do_plano(plano, aplicar=aplicar):
        print(linha)
    for linha in linhas_das_categorias(produtos):
        print(linha)
    for linha in linhas_das_descodificacoes(produtos, eventos):
        print(linha)
    if pasta_das_imagens is not None:
        print(
            f"Imagens: {copiadas if aplicar else len(plano_das_imagens.a_copiar)} "
            f"{'copiadas' if aplicar else 'por copiar'} para {media}, "
            f"{plano_das_imagens.ja_la_estavam} já lá estavam."
        )
    print(conclusao_do_plano(plano, aplicar=aplicar))
    return 0


def construir_analisador() -> argparse.ArgumentParser:
    """A linha de comandos, com o texto todo em português."""
    analisador = argparse.ArgumentParser(
        prog="importar_bd_antiga.py",
        description=(
            "Importa a ementa e os eventos da base de dados do site PHP "
            "antigo para a base de dados da aplicação. A origem é aberta só "
            "para leitura, o destino nunca é atualizado nem apagado (só se "
            "insere), e sem --aplicar o script limita-se a simular."
        ),
        epilog=(
            "O destino e o MEDIA_DIR vêm da configuração (BASE_DADOS_URL e "
            "MEDIA_DIR), como no alembic, e a variável AMBIENTE é "
            "obrigatória. Exemplo:\n"
            "  AMBIENTE=producao python scripts/importar_bd_antiga.py \\\n"
            "      --origem copia-da-bd-antiga.db \\\n"
            "      --imagens img/uploads --aplicar"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        # O `-h` escreve-se à mão só para a descrição dele sair em
        # português; os flags são os do costume. O que sobra em inglês
        # («usage:», «options:») vem do `argparse` e não se muda sem lhe
        # reescrever o formatador.
        add_help=False,
    )
    analisador.add_argument(
        "-h",
        "--help",
        action="help",
        help="mostra esta ajuda e sai.",
    )
    analisador.add_argument(
        "--origem",
        required=True,
        metavar="FICHEIRO",
        help=(
            "a cópia da base de dados do site antigo. Aberta só para "
            "leitura: esse ficheiro é a única cópia que existe."
        ),
    )
    analisador.add_argument(
        "--imagens",
        required=True,
        metavar=f"PASTA|{IGNORAR}",
        help=(
            "a pasta com as imagens dos eventos do site antigo, que são "
            f"copiadas para o MEDIA_DIR; ou a palavra «{IGNORAR}», e então "
            "os eventos entram sem imagem e o relatório lista as que "
            "ficaram de fora. Não tem valor por omissão, de propósito."
        ),
    )
    analisador.add_argument(
        "--aplicar",
        action="store_true",
        help=(
            "escreve mesmo no destino. Sem esta opção o script simula: lê "
            "tudo, diz o que faria, e não deixa nada escrito."
        ),
    )
    analisador.add_argument(
        "--esperar-produtos",
        type=int,
        default=None,
        metavar="N",
        help=(
            "recusa se a origem não trouxer exatamente N produtos. É assim "
            "que se confirma o número da carta sem ter de concordar com o "
            "número que o próprio relatório escreve."
        ),
    )
    analisador.add_argument(
        "--esperar-categorias",
        type=int,
        default=None,
        metavar="N",
        help=(
            "o mesmo para as categorias que a origem pede. São onze, a "
            "partir de doze «tipo» — «Bebidas» e «bebidas» são o mesmo."
        ),
    )
    return analisador


def main(argumentos: Sequence[str] | None = None) -> int:
    opcoes = construir_analisador().parse_args(argumentos)
    try:
        return importar(opcoes)
    except Exception as erro:
        # Um `IntegrityError` do `flush` ou um `OSError` do `copyfile`
        # saíam daqui como traceback em `stderr`, com estado diferente de
        # zero e **sem linha de conclusão nenhuma** — um quarto resultado
        # sem frase, exatamente aquilo que as três outras foram escritas
        # para evitar. A conclusão vai para `stdout`, onde está o resto do
        # relatório, e a exceção segue viagem logo a seguir: o traceback é
        # a única coisa que diz onde rebentou, e engoli-lo era trocar um
        # defeito visível por um silencioso.
        #
        # O detalhe do erro sai **antes** da conclusão e em linha própria:
        # a mensagem de um `IntegrityError` do SQLAlchemy traz o SQL e os
        # parâmetros, em várias linhas, e dentro da conclusão fazia da
        # última linha do relatório um pedaço de um URL.
        print(f"O erro foi: {type(erro).__name__}: {erro}")
        print(conclusao_do_rebentamento(erro))
        raise


if __name__ == "__main__":
    raise SystemExit(main())
