"""Os casos de uso de `POST /fotos` e da moderação — sem HTTP.

No padrão de `app/services/publico.py` e `app/services/auth.py`: nenhum
`Request` aqui dentro. `app/routers/fotos.py` e as rotas de `/gestao/fotos`
em `app/routers/gestao.py` leem a sessão, decidem o `ip_hash` e entregam o
trabalho a este módulo.

## A ordem de escrita

**Ao criar:** o ficheiro primeiro, a linha depois. Se o `INSERT` rebentar,
apaga-se o ficheiro — ao contrário, ficava uma linha a apontar para nada e
a fila de moderação mostrava uma imagem partida.

**Ao aprovar:** move-se o ficheiro de `pendentes/` para `MEDIA_DIR`
primeiro, só depois o `UPDATE`. O `UPDATE` é condicional
(`WHERE id = :id AND estado = 'pendente'`, a ler o `rowcount`) — o mesmo
padrão de `app.services.auth.terminar_sessoes`, e pelo mesmo motivo: um
`SELECT` seguido de um `UPDATE` deixa uma janela entre os dois, e um duplo
clique no botão de aprovar é exatamente esse caso. Se o `UPDATE` não
apanhar a linha (perdeu a corrida contra outra moderação da mesma foto), o
ficheiro volta para trás.

**Ao rejeitar:** o `UPDATE` primeiro, os bytes depois — decisão do Tomás,
5 de novembro de 2026: **rejeitar apaga os bytes do disco**, porque é a
foto de um terceiro que o dono decidiu não publicar. A linha de `fotos`
continua a não se apagar, mas já não é por sustentar o limite de envios
por IP — isso passou para `tentativas_de_envio` (ADR 0018) — é só por não
haver razão nenhuma para a apagar. Se o `UPDATE` não apanhar a linha, não
se toca em ficheiro nenhum.

**Ao eliminar uma aprovada** (ADR 0022): o `DELETE` condicional da linha
primeiro, com a transação aberta; depois o `unlink` em `MEDIA_DIR`; só então
o `commit`. Se o `unlink` falhar (a não ser por já não existir), faz-se
`rollback` e a linha fica. Se o `commit` falhar, o ficheiro já não existe e
a linha continua: repetir o pedido resolve. Por isso "a linha de `fotos`
nunca se apaga" só vale para as rejeitadas.
"""

from __future__ import annotations

import contextlib
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, cast

from sqlalchemy import CursorResult, Delete, Update, delete, select, update
from sqlalchemy.orm import Session

from app.config import obter_definicoes
from app.erros import ErroDaApi
from app.models.fotos import EstadoFoto, Foto
from app.models.tipos import agora_utc
from app.schemas.fotos import (
    FotoAprovada,
    FotoPendente,
    RespostaFilaDeModeracao,
    RespostaFotosAprovadas,
)
from app.services import imagens

#: `docs/ESPECIFICACAO.md`: "8 MB". A verificação autoritária sobre os
#: bytes do ficheiro — não confundir com o teto de `Content-Length` de
#: `app/routers/fotos.py`, que é maior de propósito (o corpo multipart
#: inteiro é maior do que o ficheiro que leva lá dentro).
LIMITE_DE_BYTES_DO_FICHEIRO = 8 * 1024 * 1024

#: `fotos.descricao` e `fotos.enviada_por` (`app/models/fotos.py`): o
#: SQLite não impõe o `String(255)`/`String(60)` do modelo — guarda
#: qualquer tamanho, sem se queixar — por isso a fronteira tem de recusar
#: antes de o texto chegar à base de dados.
LIMITE_DESCRICAO = 255
LIMITE_ENVIADA_POR = 60

#: Texto do dominio-bar: fala com quem está de pé, no bar, com barulho —
#: nunca com as siglas do nosso pipeline (o visitante não escolheu WebP,
#: é o formato em que a foto *sai*) nem com uma instrução técnica
#: ("reduz o tamanho") a quem só tem uma mão livre.
MENSAGEM_FICHEIRO_GRANDE_DEMAIS = (
    "O ficheiro é demasiado grande. O limite é de 8 MB. Tenta outra foto."
)
MENSAGEM_IMAGEM_INVALIDA = (
    "Não consegui usar esta fotografia. Tenta enviá-la outra vez ou escolhe outra foto."
)
MENSAGEM_IMAGEM_DEMASIADO_GRANDE = (
    "Esta foto é demasiado grande para o site. Tenta outra foto."
)
MENSAGEM_DESCRICAO_GRANDE_DEMAIS = (
    f"Essa legenda é demasiado longa (até {LIMITE_DESCRICAO} carateres). "
    "Tenta encurtá-la."
)
MENSAGEM_ENVIADA_POR_GRANDE_DEMAIS = (
    f"Esse nome é demasiado longo (até {LIMITE_ENVIADA_POR} carateres). "
    "Tenta encurtá-lo."
)
MENSAGEM_FOTO_NAO_ENCONTRADA = "Esta foto não existe."
MENSAGEM_FOTO_JA_MODERADA = "Esta foto já foi moderada."
MENSAGEM_FOTO_NAO_APROVADA = "Só se pode eliminar uma foto que já está na galeria."
MENSAGEM_FOTO_NAO_ELIMINADA = (
    "Não consegui eliminar a foto. Tenta outra vez daqui a pouco."
)

registo = logging.getLogger(__name__)


def _escrever_em_pendentes(conteudo: bytes) -> str:
    """Escreve `conteudo` (já em WebP) em `DATA_DIR/pendentes`, com nome aleatório.

    Escreve para um ficheiro temporário **na mesma pasta** e troca pelo
    nome final com `os.replace`: nunca existe um ficheiro meio escrito com
    o nome definitivo, o mesmo que vai para `fotos.ficheiro`. Cria a pasta
    se não existir — o SQLite não a cria sozinho, e esta também não.
    """
    definicoes = obter_definicoes()
    pasta = definicoes.pendentes_dir
    pasta.mkdir(parents=True, exist_ok=True)
    nome = f"{uuid.uuid4().hex}.webp"
    destino = pasta / nome
    temporario = pasta / f".tmp-{uuid.uuid4().hex}"
    temporario.write_bytes(conteudo)
    os.replace(temporario, destino)
    return nome


def registar_envio(
    sessao: Session,
    *,
    conteudo: bytes,
    ip_hash: str,
    descricao: str | None,
    enviada_por: str | None,
) -> None:
    """O caso de uso de `POST /fotos`: valida, recodifica, guarda e regista.

    Levanta `ErroDaApi` em qualquer recusa, sem escrever nada em disco nem
    na base de dados nesses casos. **Não regista a tentativa** — isso já
    aconteceu em `app.routers.fotos._exigir_limite_de_envios`, antes de o
    corpo do pedido sequer ser lido (achado em revisão da F2-06: uma
    primeira versão registava a tentativa aqui, e dois caminhos nunca
    chegavam a esta função — o campo-isco preenchido e um pedido sem
    `ficheiro` — por isso nunca contavam, apesar de pagarem o
    `request.form()` inteiro).
    """
    if descricao is not None and len(descricao) > LIMITE_DESCRICAO:
        raise ErroDaApi(
            422, "descricao_grande_demais", MENSAGEM_DESCRICAO_GRANDE_DEMAIS
        )
    if enviada_por is not None and len(enviada_por) > LIMITE_ENVIADA_POR:
        raise ErroDaApi(
            422, "enviada_por_grande_demais", MENSAGEM_ENVIADA_POR_GRANDE_DEMAIS
        )

    if len(conteudo) > LIMITE_DE_BYTES_DO_FICHEIRO:
        raise ErroDaApi(413, "ficheiro_grande_demais", MENSAGEM_FICHEIRO_GRANDE_DEMAIS)

    try:
        recodificada = imagens.recodificar(conteudo)
    except imagens.ImagemComDemasiadosPixeis as erro:
        raise ErroDaApi(
            400, "imagem_demasiado_grande", MENSAGEM_IMAGEM_DEMASIADO_GRANDE
        ) from erro
    except imagens.ImagemInvalida as erro:
        raise ErroDaApi(400, "imagem_invalida", MENSAGEM_IMAGEM_INVALIDA) from erro

    nome_ficheiro = _escrever_em_pendentes(recodificada)
    try:
        sessao.add(
            Foto(
                ficheiro=nome_ficheiro,
                estado=EstadoFoto.PENDENTE,
                descricao=descricao,
                enviada_por=enviada_por,
                ip_hash=ip_hash,
                # Explícito, e não o `default=agora_utc` da coluna
                # (`app/models/fotos.py`): aquele import é de um módulo
                # fora de `MODULOS_COM_RELOGIO_FOTOS`
                # (`tests/apoio_fotos.py`), por isso nunca fica congelado
                # nos testes — o limite por IP compara `criada_em` contra
                # um "agora" que só este módulo sabe congelar.
                criada_em=agora_utc(),
            )
        )
        sessao.commit()
    except Exception:
        sessao.rollback()
        (obter_definicoes().pendentes_dir / nome_ficheiro).unlink(missing_ok=True)
        raise


def listar_pendentes(sessao: Session) -> RespostaFilaDeModeracao:
    """A fila de moderação: só as pendentes, da mais antiga para a mais recente.

    Colunas explícitas, nunca a entidade `Foto` inteira — `ip_hash` não
    pode sair daqui nem por acidente.
    """
    linhas = sessao.execute(
        select(Foto.id, Foto.ficheiro, Foto.descricao, Foto.enviada_por, Foto.criada_em)
        .where(Foto.estado == EstadoFoto.PENDENTE)
        .order_by(Foto.criada_em, Foto.id)
    ).all()
    return RespostaFilaDeModeracao(
        fotos=[
            FotoPendente(
                id=linha.id,
                ficheiro=linha.ficheiro,
                descricao=linha.descricao,
                enviada_por=linha.enviada_por,
                criada_em=linha.criada_em,
            )
            for linha in linhas
        ]
    )


def listar_aprovadas(sessao: Session) -> RespostaFotosAprovadas:
    """As fotos na galeria, da mais recentemente aprovada para a mais antiga.

    Sem `moderada_em` (linhas semeadas sem data) vão para o fim; o desempate
    é `id` decrescente. Colunas explícitas, nunca `ip_hash`.
    """
    linhas = sessao.execute(
        select(
            Foto.id,
            Foto.ficheiro,
            Foto.descricao,
            Foto.enviada_por,
            Foto.criada_em,
            Foto.moderada_em,
        )
        .where(Foto.estado == EstadoFoto.APROVADA)
        .order_by(Foto.moderada_em.is_(None), Foto.moderada_em.desc(), Foto.id.desc())
    ).all()
    return RespostaFotosAprovadas(
        fotos=[
            FotoAprovada(
                id=linha.id,
                ficheiro=linha.ficheiro,
                descricao=linha.descricao,
                enviada_por=linha.enviada_por,
                criada_em=linha.criada_em,
                moderada_em=linha.moderada_em,
            )
            for linha in linhas
        ]
    )


def _foto_ou_404(sessao: Session, id_foto: int) -> Foto:
    foto = sessao.get(Foto, id_foto)
    if foto is None:
        raise ErroDaApi(404, "foto_nao_encontrada", MENSAGEM_FOTO_NAO_ENCONTRADA)
    return foto


#: A forma exata que `fotos.ficheiro` sempre tem — `uuid4().hex` (32
#: carateres hexadecimais em minúsculas) + `.webp`, escrito em
#: `_escrever_em_pendentes`. Decisão do Tomás, 6 de novembro de 2026: ver
#: o docstring de `_caminho_seguro` para o porquê de isto existir.
PADRAO_NOME_DE_FICHEIRO = re.compile(r"^[0-9a-f]{32}\.webp$")


def _caminho_seguro(pasta: Path, nome: str) -> Path | None:
    """O caminho de `nome` dentro de `pasta`, só se for mesmo e só lá dentro.

    Defesa em profundidade para a F2-08, que escreve na tabela `fotos` por
    SQL cru, sem passar pela API — esta função passa a ser a última linha,
    não a primeira. Hoje `nome` vem sempre de `uuid4().hex` e o `CHECK` da
    F2-01 recusa `/`, `\\` e `..` em `fotos.ficheiro`; não há ataque nenhum
    a escrever aqui através da API pública.

    Quatro guardas, por esta ordem — e a ordem importa para o que cada uma
    prova:

    1. **A lista branca de forma** (`PADRAO_NOME_DE_FICHEIRO`): recusa
       qualquer `nome` que não seja exatamente `<32 hex minúsculos>.webp`,
       antes de tocar no sistema de ficheiros. Decisão do Tomás, 6 de
       novembro de 2026, depois de medido que a guarda de maiúsculas
       (nº 4, abaixo) **não funciona no macOS**: `Path.resolve()` não
       canoniza a caixa aqui — `candidato.name` continua a ser o que foi
       pedido, não o que está no disco, por isso `CARTAZ.webp` passava
       pelas quatro guardas antigas e era servido como se fosse
       `cartaz.webp`. A lista branca não depende de nenhum sistema de
       ficheiros: um nome com maiúsculas, barras ou `..` nunca bate
       com o padrão, sempre, em qualquer SO.
    2. `is_symlink()` recusa qualquer ligação, mesmo uma que aponte para
       dentro da própria pasta — nunca servir uma ligação, só o ficheiro.
       Continua a ser a única guarda que apanha isto: a lista branca não
       olha para o que `nome` *é* no disco, só para a forma da *string*.
    3. e 4. `is_relative_to` (o resolvido continua dentro de `pasta`) e a
       comparação final de nome — com a lista branca já a recusar barras,
       `..` e maiúsculas antes de chegar aqui, estas duas ficam **sem
       nenhum caso conhecido que as precise**: medido, para qualquer
       `nome` que passe a guarda 1, as duas sempre concordam com o que o
       `is_file()` já diria sozinho. Ficam por defesa em profundidade,
       não porque algum teste as consiga isolar.
    """
    if not PADRAO_NOME_DE_FICHEIRO.match(nome):
        return None
    candidato = pasta / nome
    if candidato.is_symlink():
        return None
    candidato = candidato.resolve()
    if not candidato.is_relative_to(pasta.resolve()):
        return None
    if not candidato.is_file():
        return None
    if candidato.name != nome:
        return None
    return candidato


def obter_bytes_da_imagem(sessao: Session, id_foto: int) -> bytes:
    """Os bytes do ficheiro de `id_foto`, de `pendentes/` ou de `MEDIA_DIR`.

    `404` se a foto não existir, ou se existir mas não tiver bytes nenhuns
    — o caso de uma foto rejeitada, cujos bytes a decisão do Tomás manda
    apagar.
    """
    foto = _foto_ou_404(sessao, id_foto)
    definicoes = obter_definicoes()
    for pasta in (definicoes.pendentes_dir, definicoes.media_dir):
        caminho = _caminho_seguro(pasta, foto.ficheiro)
        if caminho is not None:
            return caminho.read_bytes()
    raise ErroDaApi(404, "foto_nao_encontrada", MENSAGEM_FOTO_NAO_ENCONTRADA)


def _rowcount_de(sessao: Session, instrucao: Update | Delete) -> int:
    """Executa um `UPDATE` ou `DELETE` e devolve o `rowcount`.

    `Session.execute()` tipa-se para `Result[...]`, que não tem
    `rowcount` — só `CursorResult` tem. O SQLAlchemy devolve sempre um
    `CursorResult` para um `UPDATE` (é o Core por baixo do ORM); o `cast`
    é só para o mypy, nunca uma verificação em runtime.
    """
    resultado = cast("CursorResult[Any]", sessao.execute(instrucao))
    return resultado.rowcount


def aprovar(sessao: Session, id_foto: int) -> Foto:
    """Move de `pendentes/` para `MEDIA_DIR` e marca `aprovada`."""
    foto = _foto_ou_404(sessao, id_foto)
    if foto.estado != EstadoFoto.PENDENTE:
        raise ErroDaApi(409, "foto_ja_moderada", MENSAGEM_FOTO_JA_MODERADA)

    definicoes = obter_definicoes()
    origem = definicoes.pendentes_dir / foto.ficheiro
    destino = definicoes.media_dir / foto.ficheiro
    definicoes.media_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.replace(origem, destino)
        moveu_o_ficheiro = True
    except FileNotFoundError:
        # Sem bytes em `pendentes/`: uma linha semeada diretamente na base
        # de dados (sem ficheiro nenhum, como fazem alguns testes de
        # transição de estado), não um envio real — a garantia desta
        # função é sobre a linha, o ficheiro é um extra quando existe.
        # **Só este erro** conta como "não havia nada para mover":
        # `Path.exists()` devolvia `False` tanto para "não está lá" como
        # para "não consegui procurar" (um `OSError` de permissões, por
        # exemplo), e tratar os dois da mesma forma aprovaria uma foto
        # cujos bytes podem muito bem existir sem ter sido possível
        # movê-los — por isso qualquer outro `OSError` sobe.
        moveu_o_ficheiro = False

    def _desfazer_o_movimento() -> None:
        sessao.rollback()
        if not moveu_o_ficheiro:
            return
        # `contextlib.suppress`, não um `except` mudo: não deixa uma falha
        # a devolver o ficheiro mascarar a causa original (o `409` da
        # corrida perdida, ou o que quer que tenha feito o
        # `UPDATE`/`commit` rebentar) — essa causa é sempre a que sai,
        # mesmo que o ficheiro fique em `MEDIA_DIR` com a linha por
        # aprovar.
        with contextlib.suppress(OSError):
            os.replace(destino, origem)

    try:
        linhas = _rowcount_de(
            sessao,
            update(Foto)
            .where(Foto.id == id_foto, Foto.estado == EstadoFoto.PENDENTE)
            .values(estado=EstadoFoto.APROVADA, moderada_em=agora_utc()),
        )
    except Exception:
        # O `UPDATE` em si rebentou (por exemplo, "database is locked"
        # depois do `busy_timeout` — vários processos do Passenger, um
        # `commit` por envio, não é hipotético). O ficheiro já tinha sido
        # movido; sem isto, ficava em `MEDIA_DIR` — a pasta que o Apache
        # serve — com a linha ainda `pendente`, a invariante que o S-03
        # afirma, partida.
        _desfazer_o_movimento()
        raise

    if linhas == 0:
        # Perdeu a corrida contra outra moderação da mesma foto (um duplo
        # clique): o ficheiro volta para onde estava.
        _desfazer_o_movimento()
        raise ErroDaApi(409, "foto_ja_moderada", MENSAGEM_FOTO_JA_MODERADA)

    try:
        sessao.commit()
    except Exception:
        _desfazer_o_movimento()
        raise
    sessao.refresh(foto)
    return foto


def rejeitar(sessao: Session, id_foto: int) -> Foto:
    """Marca `rejeitada` e apaga os bytes. A linha de `fotos` nunca se apaga."""
    foto = _foto_ou_404(sessao, id_foto)
    if foto.estado != EstadoFoto.PENDENTE:
        raise ErroDaApi(409, "foto_ja_moderada", MENSAGEM_FOTO_JA_MODERADA)

    linhas = _rowcount_de(
        sessao,
        update(Foto)
        .where(Foto.id == id_foto, Foto.estado == EstadoFoto.PENDENTE)
        .values(estado=EstadoFoto.REJEITADA, moderada_em=agora_utc()),
    )
    if linhas == 0:
        sessao.rollback()
        raise ErroDaApi(409, "foto_ja_moderada", MENSAGEM_FOTO_JA_MODERADA)
    sessao.commit()

    definicoes = obter_definicoes()
    (definicoes.pendentes_dir / foto.ficheiro).unlink(missing_ok=True)
    (definicoes.media_dir / foto.ficheiro).unlink(missing_ok=True)
    sessao.refresh(foto)
    return foto


def eliminar_aprovada(sessao: Session, id_foto: int) -> None:
    """Elimina uma foto aprovada: a linha e o ficheiro de `MEDIA_DIR` (ADR 0022).

    Ordem: `DELETE` condicional, `unlink` com a transação aberta, `commit`.
    `_caminho_seguro` não decide nada aqui — devolve `None` para coisas
    diferentes (regra 10).
    """
    foto = _foto_ou_404(sessao, id_foto)
    if foto.estado != EstadoFoto.APROVADA:
        raise ErroDaApi(409, "foto_nao_aprovada", MENSAGEM_FOTO_NAO_APROVADA)
    nome = foto.ficheiro

    linhas = _rowcount_de(
        sessao,
        delete(Foto).where(Foto.id == id_foto, Foto.estado == EstadoFoto.APROVADA),
    )
    if linhas == 0:
        # Perdeu a corrida: alguém eliminou (ou mudou) a foto entretanto.
        sessao.rollback()
        sessao.expire_all()
        existente = sessao.get(Foto, id_foto)
        if existente is None:
            raise ErroDaApi(404, "foto_nao_encontrada", MENSAGEM_FOTO_NAO_ENCONTRADA)
        raise ErroDaApi(409, "foto_nao_aprovada", MENSAGEM_FOTO_NAO_APROVADA)

    if not PADRAO_NOME_DE_FICHEIRO.match(nome):
        sessao.rollback()
        registo.error("foto %s com nome de ficheiro fora do padrão", id_foto)
        raise ErroDaApi(500, "foto_nao_eliminada", MENSAGEM_FOTO_NAO_ELIMINADA)
    try:
        (obter_definicoes().media_dir / nome).unlink()
    except FileNotFoundError:
        pass  # Já não estava lá: a linha vai na mesma.
    except OSError as erro:
        sessao.rollback()
        registo.error("não consegui apagar o ficheiro da foto %s: %s", id_foto, erro)
        raise ErroDaApi(
            500, "foto_nao_eliminada", MENSAGEM_FOTO_NAO_ELIMINADA
        ) from erro

    try:
        sessao.commit()
    except Exception:
        sessao.rollback()
        raise
