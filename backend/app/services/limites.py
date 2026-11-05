"""O limite de 5 envios de fotos por hora por IP (`docs/TAREFAS.md`, F2-06).

Decisão do Tomás, 5 de novembro de 2026: conta **linhas de `fotos`**, nunca
um contador à parte — `COUNT(*) FROM fotos WHERE ip_hash = ? AND criada_em
> agora - 1h`. Sem tabela nova, sem migração: `ip_hash` e `criada_em`
existem desde a F2-01, postas lá para isto. **Uma linha de `fotos` nunca se
apaga** (rejeitar muda o estado, não apaga a linha): rejeitar as cinco
fotos de um IP não liberta o balde.

O relógio é injetado: as duas funções que precisam de "agora" recebem-no
como argumento (`agora: datetime`), em vez de chamarem `agora_utc()` cá
dentro. Não é só estilo — `tests/apoio_fotos.py::fixar_relogio_fotos`
substitui o nome `agora_utc` só nos módulos de
`MODULOS_COM_RELOGIO_FOTOS`, e este módulo não está nessa lista; quem
chama `agora_utc()` pelo nome, e por isso fica congelável nos testes, é
`app/routers/fotos.py`, que passa o valor para cá. Uma primeira versão
deste limite em memória (em vez de na base de dados) teria o mesmo defeito
que a F2-04 já pagou uma vez (ver `app.services.auth`, a revogação de
sessão): passava nos testes e não sobrevivia a um reinício do processo nem
aos vários processos do Passenger.

## O `ip_hash`

`hmac-sha256(chave, ip)`, em hexadecimal (64 carateres, exatamente o
`String(64)` da coluna). A chave deriva-se do `segredo_sessao` de
`app/config.py` com uma etiqueta própria (`ETIQUETA_DO_SEGREDO`), no mesmo
padrão do `ETIQUETA_DO_SEGREDO` de `app/services/auth.py`. Um `sha256` sem
chave não serviria: o espaço IPv4 inteiro são 2³² hashes, percorríveis em
minutos — seria o IP em claro com passos a mais (ADR 0017). Consequência a
saber: mudar o `SEGREDO_SESSAO` zera todos os baldes.
"""

from __future__ import annotations

import hashlib
import hmac
import math
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import obter_definicoes
from app.models.fotos import Foto

#: Decisão do Tomás, 5 de novembro de 2026.
LIMITE_POR_HORA = 5

JANELA = timedelta(hours=1)

#: O `salt` da derivação da chave — nunca o `segredo_sessao` a assinar o IP
#: diretamente. Ver `app.services.auth.ETIQUETA_DO_SEGREDO`.
ETIQUETA_DO_SEGREDO = b"ip.v1"


def _chave_derivada() -> bytes:
    segredo = obter_definicoes().segredo_sessao.encode("utf-8")
    return hmac.new(segredo, ETIQUETA_DO_SEGREDO, hashlib.sha256).digest()


def hash_do_ip(ip: str) -> str:
    """`hmac-sha256` de `ip`, com uma chave derivada do `segredo_sessao`.

    Nunca o IP em claro: é o que vai para `fotos.ip_hash`.
    """
    return hmac.new(_chave_derivada(), ip.encode("utf-8"), hashlib.sha256).hexdigest()


def envios_na_ultima_hora(sessao: Session, ip_hash: str, agora: datetime) -> int:
    """Quantas linhas de `fotos` este `ip_hash` tem na última hora, a contar de `agora`.

    Conta **envios aceites**, não tentativas: uma foto recusada pelo
    Pillow nunca chega a gerar uma linha, e uma foto rejeitada pelo dono
    continua a contar — a linha fica, só o estado muda.
    """
    limite = agora - JANELA
    total = sessao.scalar(
        select(func.count())
        .select_from(Foto)
        .where(Foto.ip_hash == ip_hash, Foto.criada_em > limite)
    )
    return total or 0


def segundos_ate_haver_vaga(sessao: Session, ip_hash: str, agora: datetime) -> int:
    """Segundos até a linha mais antiga, dentro da janela, sair dela.

    A vaga abre quando a mais antiga das linhas contadas deixa de estar a
    menos de uma hora de distância — `criada_em + 1h`. `0` se o balde não
    estiver cheio (não devia ser chamada nesse caso, mas devolver "sem
    espera nenhuma" é mais seguro do que rebentar).
    """
    limite = agora - JANELA
    mais_antiga = sessao.scalar(
        select(func.min(Foto.criada_em)).where(
            Foto.ip_hash == ip_hash, Foto.criada_em > limite
        )
    )
    if mais_antiga is None:
        return 0
    livre_em = mais_antiga + JANELA
    return max(1, math.ceil((livre_em - agora).total_seconds()))
