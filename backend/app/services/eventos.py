"""A gestão dos eventos e o resumo do início da gestão.

- As três listas (`proximos`, `rascunhos`, `arquivo`) usam o corte do dia
  do bar, `inicio_do_dia_do_bar(agora_utc())` (ADR 0010), o mesmo de
  `app/services/publico.py`.
- Publicar exige data (ADR 0009). A fronteira verifica-o e devolve
  `422 evento_sem_data`; se mesmo assim o `CHECK
  ck_eventos_publicado_exige_inicio` rebentar (uma corrida entre o pedido e
  o `UPDATE`), o `IntegrityError` é mapeado pelo **nome** do constraint para
  o mesmo `422`, nunca um 500.
- O relógio lê-se sempre por `agora_utc()` aqui dentro, para os testes o
  poderem fixar.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Select, delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.erros import ErroDaApi
from app.models.clientes import Cliente
from app.models.eventos import Evento
from app.models.fotos import EstadoFoto, Foto
from app.models.tipos import agora_utc
from app.schemas.gestao import (
    EventoGestao,
    PedidoAlterarEvento,
    PedidoCriarEvento,
    RespostaEventosGestao,
    RespostaResumo,
)
from app.services.sql import id_inserido, linhas_afetadas
from app.tempo import FUSO_DO_BAR, inicio_do_dia_do_bar

MENSAGEM_EVENTO_INEXISTENTE = (
    "Este evento já não existe. Recarrega a página e tenta novamente."
)
MENSAGEM_EVENTO_SEM_DATA = "Para publicar um evento, escolhe primeiro a data e a hora."
MENSAGEM_DATA_FORA_DO_INTERVALO = "Esta data é demasiado distante para se duplicar."

#: O nome real do `CHECK` (convenção `ck_%(table_name)s_%(constraint_name)s`
#: aplicada a `publicado_exige_inicio`); o teste confere-o no DDL.
NOME_DO_CHECK = "ck_eventos_publicado_exige_inicio"

PROXIMOS_NO_RESUMO = 3
DIAS_DOS_NOVOS_REGISTOS = 7
UMA_SEMANA = timedelta(days=7)

_COLUNAS = (
    Evento.id,
    Evento.titulo,
    Evento.inicio,
    Evento.descricao,
    Evento.imagem,
    Evento.publicado,
)


_Consulta = Select[int, str, datetime | None, str | None, str | None, bool]


def _evento_inexistente() -> ErroDaApi:
    return ErroDaApi(404, "evento_inexistente", MENSAGEM_EVENTO_INEXISTENTE)


def _evento_sem_data() -> ErroDaApi:
    return ErroDaApi(422, "evento_sem_data", MENSAGEM_EVENTO_SEM_DATA, campo="inicio")


def _evento(linha: Any) -> EventoGestao:
    return EventoGestao(
        id=linha.id,
        titulo=linha.titulo,
        inicio=linha.inicio,
        descricao=linha.descricao,
        imagem=linha.imagem,
        publicado=linha.publicado,
    )


def _ler(sessao: Session, consulta: _Consulta) -> list[EventoGestao]:
    return [_evento(linha) for linha in sessao.execute(consulta).all()]


def _proximos(
    sessao: Session, corte: datetime, limite: int | None = None
) -> list[EventoGestao]:
    consulta = (
        select(*_COLUNAS)
        .where(Evento.publicado.is_(True), Evento.inicio >= corte)
        .order_by(Evento.inicio, Evento.id)
    )
    if limite is not None:
        consulta = consulta.limit(limite)
    return _ler(sessao, consulta)


# --------------------------------------------------------------------------
# Ler
# --------------------------------------------------------------------------


def obter_eventos(sessao: Session) -> RespostaEventosGestao:
    corte = inicio_do_dia_do_bar(agora_utc())
    return RespostaEventosGestao(
        proximos=_proximos(sessao, corte),
        rascunhos=_ler(
            sessao,
            select(*_COLUNAS)
            .where(Evento.publicado.is_(False))
            # `IS NULL` primeiro: os sem data vão para o fim.
            .order_by(Evento.inicio.is_(None), Evento.inicio, Evento.id),
        ),
        arquivo=_ler(
            sessao,
            select(*_COLUNAS)
            .where(Evento.publicado.is_(True), Evento.inicio < corte)
            .order_by(Evento.inicio.desc(), Evento.id),
        ),
    )


def obter_resumo(sessao: Session) -> RespostaResumo:
    agora = agora_utc()
    corte = inicio_do_dia_do_bar(agora)
    pendentes = sessao.execute(
        select(func.count()).select_from(Foto).where(Foto.estado == EstadoFoto.PENDENTE)
    ).scalar_one()
    novos = sessao.execute(
        select(func.count())
        .select_from(Cliente)
        .where(Cliente.criado_em >= agora - timedelta(days=DIAS_DOS_NOVOS_REGISTOS))
    ).scalar_one()
    return RespostaResumo(
        fotos_pendentes=pendentes,
        proximos_eventos=_proximos(sessao, corte, PROXIMOS_NO_RESUMO),
        novos_registos=novos,
    )


# --------------------------------------------------------------------------
# Escrever
# --------------------------------------------------------------------------


def _por_id(sessao: Session, id_evento: int) -> Any:
    linha = sessao.execute(select(*_COLUNAS).where(Evento.id == id_evento)).first()
    if linha is None:
        raise _evento_inexistente()
    return linha


def criar_evento(sessao: Session, pedido: PedidoCriarEvento) -> EventoGestao:
    novo_id = id_inserido(
        sessao.execute(
            insert(Evento).values(
                titulo=pedido.titulo,
                inicio=pedido.inicio,
                descricao=pedido.descricao,
                publicado=pedido.publicado,
            )
        )
    )
    sessao.commit()
    return _evento(_por_id(sessao, novo_id))


def alterar_evento(
    sessao: Session, id_evento: int, pedido: PedidoAlterarEvento
) -> EventoGestao:
    atual = _por_id(sessao, id_evento)
    valores: dict[str, Any] = {
        campo: getattr(pedido, campo)
        for campo in ("titulo", "inicio", "descricao", "publicado")
        if campo in pedido.model_fields_set
    }
    if not valores:
        return _evento(atual)

    publicado = valores.get("publicado", atual.publicado)
    inicio = valores.get("inicio", atual.inicio)
    if publicado and inicio is None:
        raise _evento_sem_data()

    try:
        # A validação "publicar exige data" lê fora desta transação: numa
        # corrida é o `CHECK`, mapeado abaixo, que a apanha. É o caminho
        # esperado, não uma falha.
        alterados = linhas_afetadas(
            sessao.execute(
                update(Evento).where(Evento.id == id_evento).values(**valores)
            )
        )
        if alterados == 0:
            sessao.rollback()
            raise _evento_inexistente()
        sessao.commit()
    except IntegrityError as erro:
        sessao.rollback()
        # Pelo nome do constraint: qualquer outra restrição é um erro nosso.
        if NOME_DO_CHECK in str(erro.orig):
            raise _evento_sem_data() from erro
        raise
    return _evento(_por_id(sessao, id_evento))


def eliminar_evento(sessao: Session, id_evento: int) -> None:
    apagados = linhas_afetadas(
        sessao.execute(delete(Evento).where(Evento.id == id_evento))
    )
    if apagados == 0:
        sessao.rollback()
        raise _evento_inexistente()
    sessao.commit()


def proxima_semana(original: datetime, agora: datetime) -> datetime:
    """O primeiro `original + 7k dias` (k >= 1) estritamente depois de `agora`.

    Soma-se na **hora de parede de Lisboa** e converte-se depois para UTC:
    somar 7 x 24 h em UTC erra uma hora na semana da mudança da hora
    (quinta 22:00 de Lisboa tem de continuar a ser as 22:00).

    - **Comparação com o instante atual**, não com o corte do dia do bar:
      uma cópia para as 22:00 de hoje, pedida às 23:30, já passou, e um
      rascunho para uma hora que já foi não serve ao dono. É estrita:
      um candidato igual a `agora` salta mais uma semana.
    - **Hora inexistente** (o salto da primavera) ou **ambígua** (o recuo do
      outono): `fold=0`, a regra por omissão do PEP 495. Inexistente: lê-se
      com o deslocamento de antes do salto, o que dá a hora pedida mais uma
      hora (01:30 passa a 02:30); ambígua: a primeira das duas ocorrências.
    - Cada candidato parte da hora de parede **original** (+7k dias), nunca
      do candidato anterior já convertido, para uma hora inexistente numa
      semana não alterar as seguintes.
    """
    parede = original.astimezone(FUSO_DO_BAR).replace(tzinfo=None)
    semanas = 1
    while True:
        candidato = (parede + semanas * UMA_SEMANA).replace(tzinfo=FUSO_DO_BAR, fold=0)
        em_utc = candidato.astimezone(UTC)
        if em_utc > agora:
            return em_utc
        semanas += 1


def duplicar_evento(sessao: Session, id_evento: int) -> EventoGestao:
    """Um rascunho com o mesmo título, descrição e imagem, na próxima semana livre.

    Sem data no original, a cópia fica sem data e o relógio nem se lê.
    """
    original = _por_id(sessao, id_evento)
    inicio: datetime | None = None
    if original.inicio is not None:
        try:
            inicio = proxima_semana(original.inicio, agora_utc())
        except OverflowError as erro:
            raise ErroDaApi(
                422, "dados_invalidos", MENSAGEM_DATA_FORA_DO_INTERVALO
            ) from erro
    novo_id = id_inserido(
        sessao.execute(
            insert(Evento).values(
                titulo=original.titulo,
                inicio=inicio,
                descricao=original.descricao,
                imagem=original.imagem,
                publicado=False,
            )
        )
    )
    sessao.commit()
    return _evento(_por_id(sessao, novo_id))
