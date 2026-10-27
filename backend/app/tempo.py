"""Fronteiras de dia civil, sempre em `Europe/Lisbon` (ADR 0010).

`backend/CLAUDE.md` diz "datas em UTC na BD; `Europe/Lisbon` só na
apresentação". O ADR 0010 escreve-lhe a exceção: **a fronteira de um dia
civil é sempre a de Lisboa**, venha ela servir um ecrã ou um filtro. Um
dia não é um instante — só existe dentro de um fuso —, e com o corte em
UTC um evento que começa às 00:30 de Lisboa desaparece do site à 01:00
da manhã, enquanto está a acontecer, num bar que fecha às 02:00.

O fuso resolve-se uma vez, à importação. O `zoneinfo` lê-o da base de
dados de fusos do sistema (`/usr/share/zoneinfo`), que no cPanel
partilhado não é nossa e pode não existir: é por isso que o `tzdata`
entra nas dependências do backend, e é por isso que a falha, a
acontecer, acontece em voz alta no arranque e não a meio de um pedido.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

#: O fuso do bar. Estarreja muda de sítio menos vezes do que a base de
#: dados muda de esquema, por isso é uma constante e não uma definição
#: (ADR 0010, alternativas consideradas).
FUSO_DO_BAR = ZoneInfo("Europe/Lisbon")

MENSAGEM_SEM_FUSO = (
    "O instante não traz fuso horário. Um `datetime` ingénuo não diz a "
    "que dia civil pertence, e o `astimezone()` do Python não dá erro "
    "com ele — assume o fuso da máquina —, pelo que o corte do dia "
    "passaria a depender de onde a app corre, sem nada no caminho a "
    "dizê-lo. Passa um instante com `tzinfo` (por exemplo, "
    "`agora_utc()`)."
)


def inicio_do_dia_do_bar(agora: datetime) -> datetime:
    """A meia-noite, em Lisboa, do dia a que `agora` pertence, em UTC.

    Função **pura**: recebe o instante em vez de ler o relógio. É o que
    permite aos testes fixarem o dia sem mexerem no relógio do sistema, e
    o que torna o corte reproduzível.

    `agora` pode vir em qualquer fuso; é convertido para Lisboa **antes**
    de se lhe perguntar que dia é. Um `datetime` ingénuo é recusado, pela
    mesma razão que `DataHoraUTC` o recusa.

    Meia-noite em Lisboa nunca é ambígua nem inexistente — as mudanças de
    hora dão-se às 01:00 e às 02:00 locais —, por isso o resultado é
    sempre um instante único e não é preciso resolver nenhum `fold`.
    """
    if agora.tzinfo is None or agora.tzinfo.utcoffset(agora) is None:
        raise ValueError(MENSAGEM_SEM_FUSO)

    hoje_em_lisboa = agora.astimezone(FUSO_DO_BAR).date()
    meia_noite = datetime.combine(hoje_em_lisboa, time.min, tzinfo=FUSO_DO_BAR)
    return meia_noite.astimezone(UTC)
