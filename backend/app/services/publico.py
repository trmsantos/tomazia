"""As quatro leituras públicas: o que a base de dados devolve, e porquê.

Três opções atravessam o ficheiro inteiro:

- **colunas explícitas, nunca entidades.** `select(Produto.id, ...)` e
  não `select(Produto)`: o que não está na lista não pode sair numa
  resposta, nem hoje nem no dia em que alguém acrescentar uma coluna à
  tabela. Um `select(Foto)` traria `ip_hash` e `enviada_por` para a mão
  de quem serializa, e a defesa passava a ser só o `response_model`.
- **nenhum `relationship()`.** A ementa junta-se em SQL, aqui, à vista.
  Um `relationship` com o filtro de `disponivel` no carregador punha a
  regra num sítio que quem escrevesse `categoria.produtos` noutra tarefa
  não veria — e sem filtro nenhum dava um N+1 silencioso numa página
  servida por um SQLite num cPanel partilhado.
- **uma consulta por pedido**, com a ordem e o teto feitos em SQL. Ordenar
  ou cortar em Python devolve a mesma contagem com as linhas erradas.

O relógio entra por `agora_utc`, importado como nome deste módulo e
chamado dentro da função. Não é estilo: é o que permite a um teste fixar
o dia (`monkeypatch.setattr`) sem mexer no relógio da máquina. Um
`datetime.now(UTC)` escrito aqui dentro não se consegue fixar.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence

from pydantic import ValidationError
from sqlalchemy import Row, select
from sqlalchemy.orm import Session

from app.models.definicoes import Definicao
from app.models.ementa import Categoria, Produto
from app.models.eventos import Evento
from app.models.fotos import EstadoFoto, Foto
from app.models.tipos import agora_utc
from app.schemas.publico import (
    CategoriaPublica,
    DiaDoHorario,
    EventoPublico,
    FotoPublica,
    ProdutoPublico,
    RespostaEmenta,
    RespostaEventos,
    RespostaGaleria,
    RespostaInfo,
    WifiPublico,
    interpretar_horario,
)
from app.tempo import inicio_do_dia_do_bar

registo = logging.getLogger(__name__)

#: Quantas fotos aprovadas a galeria pública devolve, no máximo. Tem nome
#: porque vai ser mudado: a F3-03 mostra seis no ecrã inicial e abre a
#: grelha completa a partir daí. Um número escrito a meio de uma
#: expressão é um número que ninguém encontra quando quer mexer nele.
MAXIMO_FOTOS_NA_GALERIA = 24

#: As chaves de `definicoes` que `GET /info` publica, e só estas.
#: `definicoes` é uma tabela chave/valor: devolver tudo o que lá está
#: seria publicar qualquer definição futura no momento em que ela fosse
#: escrita, sem ninguém decidir nada.
CHAVE_WIFI_REDE = "wifi_rede"
CHAVE_WIFI_PASSWORD = "wifi_password"
CHAVE_MORADA = "morada"
CHAVE_TELEFONE = "telefone"
CHAVE_INSTAGRAM = "instagram"
CHAVE_MAPS_URL = "maps_url"
CHAVE_HORARIO = "horario"

#: Uma linha do `JOIN` da ementa: as três colunas da categoria e as
#: quatro do produto, por esta ordem. Escrito por extenso para o mypy
#: ver os tipos que a consulta promete, em vez de um `Any` que aceitaria
#: qualquer coisa.
LinhaDaEmenta = Row[int, str, str, int, str, str | None, int]

CHAVES_PUBLICAS_DE_DEFINICOES: tuple[str, ...] = (
    CHAVE_WIFI_REDE,
    CHAVE_WIFI_PASSWORD,
    CHAVE_MORADA,
    CHAVE_TELEFONE,
    CHAVE_INSTAGRAM,
    CHAVE_MAPS_URL,
    CHAVE_HORARIO,
)


def obter_ementa(sessao: Session) -> RespostaEmenta:
    """Categorias visíveis com os produtos disponíveis, por ordem.

    Uma consulta só, com um `JOIN` interno. O `JOIN` interno não é
    detalhe: é ele que faz uma categoria visível **sem nenhum produto
    disponível** não aparecer — não aparece "vazia", não aparece de todo.
    A garrafeira só com indisponíveis e a categoria sem produtos
    nenhuns saem pela mesma porta.

    A ordem é `ordem` ascendente com desempate por `id`, nos dois níveis.
    O desempate é explícito porque `ordem` tem omissão 0 e empates são o
    caso normal; que o SQLite devolvesse os empates por `rowid` é um
    detalhe de implementação, não uma promessa.
    """
    linhas = sessao.execute(
        select(
            Categoria.id.label("categoria_id"),
            Categoria.nome.label("categoria_nome"),
            Categoria.slug.label("categoria_slug"),
            Produto.id.label("produto_id"),
            Produto.nome.label("produto_nome"),
            Produto.descricao.label("produto_descricao"),
            Produto.preco_cent.label("produto_preco_cent"),
        )
        .join(Produto, Produto.categoria_id == Categoria.id)
        .where(Categoria.visivel.is_(True), Produto.disponivel.is_(True))
        .order_by(Categoria.ordem, Categoria.id, Produto.ordem, Produto.id)
    ).all()

    return RespostaEmenta(categorias=_agrupar_por_categoria(linhas))


def _agrupar_por_categoria(linhas: Sequence[LinhaDaEmenta]) -> list[CategoriaPublica]:
    """Junta as linhas do `JOIN` em categorias, sem perder a ordem.

    As linhas já vêm ordenadas da base de dados; este passo só as
    arruma. Guardar as categorias num dicionário por `id` é também o que
    impede uma categoria repetida na resposta se a consulta algum dia
    devolver a mesma categoria em blocos separados.
    """
    categorias: dict[int, CategoriaPublica] = {}
    for linha in linhas:
        categoria = categorias.get(linha.categoria_id)
        if categoria is None:
            categoria = CategoriaPublica(
                id=linha.categoria_id,
                nome=linha.categoria_nome,
                slug=linha.categoria_slug,
                produtos=[],
            )
            categorias[linha.categoria_id] = categoria
        categoria.produtos.append(
            ProdutoPublico(
                id=linha.produto_id,
                nome=linha.produto_nome,
                descricao=linha.produto_descricao,
                preco_cent=linha.produto_preco_cent,
            )
        )
    return list(categorias.values())


def obter_eventos(sessao: Session) -> RespostaEventos:
    """Os eventos publicados a partir de hoje, hoje em Lisboa (ADR 0010).

    O corte é a meia-noite do dia corrente em `Europe/Lisbon`, convertida
    para UTC, e a fronteira é fechada à esquerda (`inicio >= corte`):
    meia-noite em ponto é um evento de hoje.

    Com o corte em UTC, um evento que começa às 00:30 de Lisboa
    desaparecia do site à 01:00 da manhã — enquanto está a acontecer — e
    já não voltava. É o horário em que este bar vive: fecha às 02:00.

    Sem limite, de propósito: a secção "Esta semana" mostra três, mas
    isso é do frontend (F3-04), e a página de eventos e o "Arquivo" da
    F4-03 contam com a lista inteira.
    """
    corte = inicio_do_dia_do_bar(agora_utc())

    linhas = sessao.execute(
        select(
            Evento.id,
            Evento.titulo,
            Evento.inicio,
            Evento.descricao,
            Evento.imagem,
        )
        .where(Evento.publicado.is_(True), Evento.inicio >= corte)
        .order_by(Evento.inicio, Evento.id)
    ).all()

    return RespostaEventos(
        eventos=[
            EventoPublico(
                id=linha.id,
                titulo=linha.titulo,
                # Nunca `None` aqui: `inicio >= corte` é nulo para uma
                # linha sem data, e nulo não passa no `WHERE`.
                inicio=linha.inicio,
                descricao=linha.descricao,
                imagem=linha.imagem,
            )
            for linha in linhas
        ]
    )


def obter_galeria(sessao: Session) -> RespostaGaleria:
    """As fotos aprovadas, as mais recentes primeiro, até ao teto.

    O desempate por `id` descendente é o único dos três endpoints que
    discrimina: `fotos.criada_em` vem do `CURRENT_TIMESTAMP`, com
    resolução de um segundo, e duas fotos enviadas seguidas empatam. Sem
    desempate, o SQLite devolve-as por `rowid` **ascendente** dentro do
    empate — a ordem contrária à pedida.

    A ordem e o teto são os dois em SQL. Um `LIMIT` sobre uma consulta
    sem `ORDER BY`, ou uma ordenação feita em Python depois de cortar,
    devolve o número certo de fotos e as fotos erradas.
    """
    linhas = sessao.execute(
        select(Foto.id, Foto.ficheiro, Foto.descricao)
        .where(Foto.estado == EstadoFoto.APROVADA)
        .order_by(Foto.criada_em.desc(), Foto.id.desc())
        .limit(MAXIMO_FOTOS_NA_GALERIA)
    ).all()

    return RespostaGaleria(
        fotos=[
            FotoPublica(id=linha.id, ficheiro=linha.ficheiro, descricao=linha.descricao)
            for linha in linhas
        ]
    )


def obter_info(sessao: Session) -> RespostaInfo:
    """WiFi, morada, contactos e horário, das sete chaves publicadas.

    Uma consulta só, com as chaves do contrato no `WHERE`: o que não
    estiver nessa lista não sai, mesmo que esteja na tabela.

    Uma instalação acabada de criar não é um erro — sem nenhuma chave,
    tudo sai a `null` com 200.
    """
    linhas = sessao.execute(
        select(Definicao.chave, Definicao.valor).where(
            Definicao.chave.in_(CHAVES_PUBLICAS_DE_DEFINICOES)
        )
    ).all()
    valores: dict[str, str] = {linha.chave: linha.valor for linha in linhas}

    return RespostaInfo(
        wifi=WifiPublico(
            rede=_texto_ou_nulo(valores.get(CHAVE_WIFI_REDE)),
            password=_texto_ou_nulo(valores.get(CHAVE_WIFI_PASSWORD)),
        ),
        morada=_texto_ou_nulo(valores.get(CHAVE_MORADA)),
        telefone=_texto_ou_nulo(valores.get(CHAVE_TELEFONE)),
        instagram=_texto_ou_nulo(valores.get(CHAVE_INSTAGRAM)),
        maps_url=_texto_ou_nulo(valores.get(CHAVE_MAPS_URL)),
        horario=_ler_horario(valores.get(CHAVE_HORARIO)),
    )


def _texto_ou_nulo(valor: str | None) -> str | None:
    """`""` e só espaços saem a `null`; o resto sai tal como está guardado.

    `definicoes.valor` é `NOT NULL`, por isso a ausência de um campo
    diz-se com `""` — é o que a F2-05 guarda quando o dono apaga um campo
    e o que a F2-08 importa do site antigo. Um `""` que chegasse ao
    frontend aparecia como um telefone em branco, com ícone e tudo.

    O valor não vazio **não** é aparado: o texto é devolvido tal como foi
    escrito (critério S-09).
    """
    if valor is None or not valor.strip():
        return None
    return valor


def _ler_horario(valor: str | None) -> list[DiaDoHorario] | None:
    """O horário do ADR 0011, ou `null` — e a diferença fica no log.

    `null` sem registo nenhum quer dizer **não configurado**: é o estado
    de uma instalação nova, e enchê-lo de erros todos os dias era garantir
    que ninguém repara no dia em que o erro é a sério.

    `null` com um `ERROR` que nomeia a chave quer dizer **mal
    configurado**. O endpoint não devolve 500: um horário mal escrito não
    pode levar atrás o WiFi, a morada e o telefone, que estão no mesmo
    ecrã. É uma exceção consciente à regra 10 do `CLAUDE.md`, escrita no
    ADR 0011 — a alternativa era expor ao público o estado interno de uma
    definição.
    """
    if valor is None or not valor.strip():
        return None
    try:
        return interpretar_horario(valor)
    except (json.JSONDecodeError, ValidationError):
        registo.error(
            "A definição `horario` está guardada numa forma que não é a do "
            "ADR 0011 (lista de dias com `abre`/`fecha` em HH:MM). "
            "`GET /info` devolve `horario: null` e serve o resto; corrige "
            "a chave `horario` em `definicoes`.",
            exc_info=True,
        )
        return None
