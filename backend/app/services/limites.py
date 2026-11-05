"""O limite de 5 envios de fotos por hora por IP (`docs/TAREFAS.md`, F2-06).

Decisão do Tomás, substituindo a primeira versão desta tarefa: conta
**tentativas** (`tentativas_de_envio`, migração `949af696a406`), não
envios aceites. Medido: um PNG de 58 bytes que declara 5400×5400 (29,16 MP,
mesmo abaixo do limite de píxeis) passa a comparação explícita sobre
`im.size` — o cabeçalho é que mente, ainda não há nada descomprimido — e só
falha no `Image.load()` a seguir, já depois de o Pillow tentar alocar o
bitmap inteiro (`+113 MB` de RSS em três pedidos). Essa recusa é um `400`
sem linha nenhuma em `fotos`; contar só envios aceites deixava esse balde
por encher para sempre, e o mesmo ficheiro de 58 bytes repete-se sem fim,
anónimo. `registar_tentativa` grava a linha **antes** de o ficheiro ser
entregue ao Pillow (`app.services.fotos.registar_envio` chama-a antes de
`app.services.imagens.recodificar`), para a tentativa ficar registada
mesmo quando a imagem rebenta a seguir.

**Uma linha de `tentativas_de_envio` nunca se apaga** — pela mesma razão
de `fotos`: apagar devolvia quota a quem a gastou, em silêncio. Não há
rota nem script que o faça.

O relógio é injetado: as funções que precisam de "agora" recebem-no como
argumento (`agora: datetime`), em vez de chamarem `agora_utc()` cá dentro.
Não é só estilo: as contagens e o registo da tentativa do mesmo pedido têm
de concordar no mesmo instante — duas chamadas a `agora_utc()` dentro deste
módulo não o garantiriam — e é `app/routers/fotos.py` quem chama
`agora_utc()` pelo nome do módulo e passa o valor para cá, porque é esse o
módulo que `tests/apoio_fotos.py::fixar_relogio_fotos` sabe congelar
(`MODULOS_COM_RELOGIO_FOTOS`; este módulo não está nessa lista). Uma
primeira versão deste limite em memória (em vez de na base de dados) teria
o mesmo defeito que a F2-04 já pagou uma vez (ver `app.services.auth`, a
revogação de sessão): passava nos testes e não sobrevivia a um reinício do
processo nem aos vários processos do Passenger.

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
from app.models.limites import TentativaDeEnvio

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

    Nunca o IP em claro: é o que vai para `fotos.ip_hash` e para
    `tentativas_de_envio.ip_hash`.
    """
    return hmac.new(_chave_derivada(), ip.encode("utf-8"), hashlib.sha256).hexdigest()


def registar_tentativa(sessao: Session, ip_hash: str, agora: datetime) -> None:
    """Grava uma tentativa de envio, com `criada_em=agora`.

    Chamada **antes** de o ficheiro ser entregue ao Pillow — é isto que
    fecha o buraco de um ficheiro pequeno a declarar dimensões grandes
    (medido: `+113 MB` de RSS por pedido recusado, sem o gasto ficar
    registado em lado nenhum). O seu próprio `commit`: a tentativa fica
    registada mesmo que o resto do pedido rebente a seguir.
    """
    sessao.add(TentativaDeEnvio(ip_hash=ip_hash, criada_em=agora))
    sessao.commit()


def envios_na_ultima_hora(sessao: Session, ip_hash: str, agora: datetime) -> int:
    """Quantas tentativas este `ip_hash` fez na última hora, a contar de `agora`."""
    limite = agora - JANELA
    total = sessao.scalar(
        select(func.count())
        .select_from(TentativaDeEnvio)
        .where(TentativaDeEnvio.ip_hash == ip_hash, TentativaDeEnvio.criada_em > limite)
    )
    return total or 0


def segundos_ate_haver_vaga(sessao: Session, ip_hash: str, agora: datetime) -> int:
    """Segundos até a tentativa mais antiga, dentro da janela, sair dela.

    A vaga abre quando a mais antiga das tentativas contadas deixa de
    estar a menos de uma hora de distância — `criada_em + 1h`. `0` se o
    balde não estiver cheio (não devia ser chamada nesse caso, mas devolver
    "sem espera nenhuma" é mais seguro do que rebentar).
    """
    limite = agora - JANELA
    mais_antiga = sessao.scalar(
        select(func.min(TentativaDeEnvio.criada_em)).where(
            TentativaDeEnvio.ip_hash == ip_hash, TentativaDeEnvio.criada_em > limite
        )
    )
    if mais_antiga is None:
        return 0
    livre_em = mais_antiga + JANELA
    return max(1, math.ceil((livre_em - agora).total_seconds()))
