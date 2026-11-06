"""`POST /fotos`: o envio público de uma foto para moderação.

Só esta rota. As de moderação (`/gestao/fotos*`) vivem em
`app/routers/gestao.py`, dentro do router que já traz `exigir_admin` nas
suas `dependencies` — criar aqui um router à parte para elas seria o modo
de falha que esse desenho existe para impedir.

## Porque é que este router nunca declara `ficheiro: UploadFile = File(...)`

Medido (FastAPI 0.162.0, Starlette 1.9.0): quando o endpoint declara um
parâmetro de corpo (`File`/`Form`), o FastAPI lê o corpo inteiro —
`await request.form()` — **antes** de resolver qualquer `Depends`, dentro
de `get_request_handler`. Um `Depends` que recuse o pedido (o teto de
`Content-Length`, o limite de 5 por hora por IP) deixaria de evitar o
custo do envio: o multipart já tinha sido interpretado e escrito num
ficheiro temporário antes de a recusa correr.

Por isso este endpoint recebe o `Request` em bruto e só lê o corpo (
`await request.form(...)`) **dentro do seu próprio código**, depois de o
único `Depends` (`_exigir_limite_de_envios`, que chama
`_verificar_content_length` como primeiro passo) já ter corrido — é isto,
e não a ordem dos parâmetros, que faz o `429` não pagar o envio.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, NoReturn

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.dependencias import SessaoDaBD
from app.erros import MENSAGEM_CORPO_INVALIDO, ErroDaApi
from app.models.admins import Admin
from app.models.tipos import agora_utc
from app.rede import ip_do_cliente
from app.schemas.fotos import RespostaEnvioFoto
from app.services import auth as auth_servico
from app.services import fotos as servico
from app.services.limites import (
    LIMITE_POR_HORA,
    envios_na_ultima_hora,
    hash_do_ip,
    registar_tentativa,
    segundos_ate_haver_vaga,
)

#: O nome dos campos do formulário multipart. Não fixado em
#: `docs/ESPECIFICACAO.md` — só que o nome e o `Content-Type` do cliente
#: são ignorados por completo.
CAMPO_FICHEIRO = "ficheiro"
CAMPO_DESCRICAO = "descricao"
CAMPO_ENVIADA_POR = "enviada_por"
#: O campo escondido contra bots: um formulário normal deixa-o vazio.
CAMPO_ISCO = "website"

#: 8 MiB (o teto autoritário sobre o ficheiro, `services/fotos.py`) + 64
#: KiB de margem para o resto do corpo multipart — fronteira, cabeçalhos
#: dos campos, o próprio nome do ficheiro. Dois números de propósito: o
#: corpo multipart é sempre maior do que o ficheiro que leva lá dentro, e
#: um teto de exatamente 8 MiB sobre o `Content-Length` rejeitaria um
#: ficheiro de exatamente 8 MiB.
MARGEM_MULTIPART_BYTES = 64 * 1024
LIMITE_CONTENT_LENGTH = servico.LIMITE_DE_BYTES_DO_FICHEIRO + MARGEM_MULTIPART_BYTES

MENSAGEM_FICHEIRO_GRANDE_DEMAIS = servico.MENSAGEM_FICHEIRO_GRANDE_DEMAIS
#: Texto do dominio-bar: "demasiadas fotos" acusava de excesso quem teve
#: entusiasmo — cinco fotos numa noite de samba é a noite a correr bem.
MENSAGEM_LIMITE_DE_ENVIOS = (
    "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco."
)
#: Medido: o `max_part_size` do Starlette só limita campos de texto — o
#: código em `starlette/formparsers.py::MultiPartParser.on_part_data` só
#: compara contra o teto quando `self._current_part.file is None`, ou
#: seja, nunca para a parte que é mesmo o ficheiro. Sem `Content-Length`
#: (`Transfer-Encoding: chunked`), nada limitava o corpo de um ficheiro
#: antes de ele estar todo em memória — medido, `+194 MB` de RSS com 64
#: MiB em troços. Por isso um `Content-Length` ausente ou não numérico é
#: uma recusa, não um "deixa passar".
MENSAGEM_TAMANHO_EM_FALTA = (
    "Não consegui perceber o tamanho deste envio. Tenta enviar a foto outra vez."
)

#: Nunca em cache: é uma mutação, não uma leitura.
SEM_CACHE = "no-store"

router = APIRouter(tags=["fotos"])


def _verificar_content_length(request: Request) -> None:
    """`411` sem `Content-Length` (ou não numérico); `413` acima do teto.

    Corre antes de o FastAPI sequer começar a interpretar o multipart — e
    é por isso que tem de ser **recusa**, não "deixa passar", quando o
    cabeçalho falta: um corpo em troços (`Transfer-Encoding: chunked`,
    sem `Content-Length`) não tem outro teto nenhum a protegê-lo — ver o
    docstring de `MENSAGEM_TAMANHO_EM_FALTA`.
    """
    bruto = request.headers.get("content-length")
    if bruto is None:
        raise ErroDaApi(411, "tamanho_do_pedido_em_falta", MENSAGEM_TAMANHO_EM_FALTA)
    try:
        tamanho = int(bruto)
    except ValueError as erro:
        raise ErroDaApi(
            411, "tamanho_do_pedido_em_falta", MENSAGEM_TAMANHO_EM_FALTA
        ) from erro
    if tamanho > LIMITE_CONTENT_LENGTH:
        raise ErroDaApi(413, "ficheiro_grande_demais", MENSAGEM_FICHEIRO_GRANDE_DEMAIS)


def _admin_da_sessao(request: Request, sessao: Session) -> Admin | None:
    """O admin da sessão do pedido, ou `None` — ao contrário de `exigir_admin`, nunca levanta.

    Lê o cookie do `Request` e entrega a verificação a
    `app.services.auth.admin_da_sessao`, a mesma que `exigir_admin` usa —
    nunca uma cópia à parte: aqui a ausência de cookie é o caso normal de
    um envio público, nunca um `401`, mas a decisão de *quem* é um admin
    válido tem de vir sempre do mesmo sítio. Serve só para decidir se o
    dono salta o limite de envios (decisão do Tomás, 5 de novembro de
    2026) — a proteção das rotas de gestão continua a ser, só e sempre,
    `exigir_admin`.
    """
    valor = request.cookies.get(auth_servico.NOME_DO_COOKIE)
    return auth_servico.admin_da_sessao(sessao, valor)


def _recusar_por_limite(sessao: Session, ip_hash: str, agora: datetime) -> NoReturn:
    """Levanta o `429` do limite de envios, com `Retry-After` e `segundos_em_falta`."""
    segundos = segundos_ate_haver_vaga(sessao, ip_hash, agora)
    raise ErroDaApi(
        429,
        "limite_de_envios_excedido",
        MENSAGEM_LIMITE_DE_ENVIOS,
        extra={"segundos_em_falta": segundos},
        cabecalhos={"Retry-After": str(segundos)},
    )


def _exigir_limite_de_envios(request: Request, sessao: SessaoDaBD) -> str:
    """O `ip_hash` do pedido, depois de registar a tentativa e aplicar o limite (salvo para admins).

    Corre como `Depends`, antes de este router ler o corpo do pedido (ver
    o docstring do módulo) — e é por isso que é **aqui**, não em
    `app.services.fotos.registar_envio`, que a tentativa fica registada
    (achado em revisão da F2-06, substituindo a primeira versão desta
    correção): qualquer pedido que chegue até aqui com um IP não-admin
    conta, **mesmo que** o campo `ficheiro` falte ou o campo-isco esteja
    preenchido — os dois caminhos que, antes, pagavam o `request.form()`
    inteiro (até 8 MiB) sem nunca gastar balde nenhum, porque a tentativa
    só era registada depois de o corpo já estar interpretado.

    **A ordem fecha também a corrida.** O `INSERT` autoritativo é sempre
    seguido de uma recontagem comparada com `LIMITE_POR_HORA` por `>`, não
    `>=`: o `INSERT` serializa no SQLite (um escritor de cada vez, mesmo em
    WAL), por isso a contagem feita a seguir ao próprio `INSERT` já reflete
    todas as tentativas de outros pedidos que tenham commitado primeiro.
    Contar antes de gravar, sem mais nada (uma versão anterior desta
    correção), deixava N pedidos verdadeiramente simultâneos lerem todos o
    mesmo valor antigo antes de qualquer um escrever — medido, 12 pedidos
    simultâneos do mesmo IP a dar `[400]×12`, zero `429`.

    **Mas gravar sempre, mesmo quando o balde já está provadamente cheio,
    trocou um defeito por outro** (achado de uma revisão posterior,
    medido): 20 pedidos do mesmo IP já bloqueado davam `[202×5, 429×15]` —
    e **20 linhas** em `tentativas_de_envio`, um `INSERT`+`commit`
    (`fsync` do WAL) **permanente**, por pedido, numa rota pública sem
    autenticação, sem rota nem script que alguma vez as apague. Um corpo
    de 10 bytes compra uma escrita durável. Por isso há uma contagem
    **barata** primeiro: se já há `LIMITE_POR_HORA` tentativas na janela
    **sem contar esta**, `429` sem escrever nada. Só os pedidos que ainda
    cabiam na janela no momento da leitura chegam ao `INSERT`+recontagem
    — que continua a ser o caminho autoritativo, para a corrida dos 12
    simultâneos continuar fechada (a leitura barata não garante nada
    sozinha sob concorrência a sério: vários pedidos podem lê-la ainda
    livre ao mesmo tempo, e é o `INSERT` a seguir que decide de verdade).
    As escritas ficam limitadas a, no máximo, `LIMITE_POR_HORA` mais a
    concorrência real por IP e por hora — não mais uma por pedido
    recusado.
    """
    _verificar_content_length(request)

    ip = ip_do_cliente(request)
    # `""` quando não há par TCP (`ip_do_cliente` devolve `None`, nunca
    # inventa um IP nem rebenta — ver ADR 0017). Todos os pedidos sem par
    # TCP partilham, por isso, o mesmo balde — é a escolha conservadora:
    # mais seguro um balde partilhado do que um `500` ou um limite que
    # nunca se enche. Documentado e testado em
    # `tests/seguranca/test_sem_ip_partilha_balde.py`.
    ip_hash = hash_do_ip(ip if ip is not None else "")

    if _admin_da_sessao(request, sessao) is not None:
        # O dono salta o limite por inteiro — nem conta, nem regista
        # tentativa nenhuma. Sem isto, as próprias fotos do dono gastavam
        # o balde do IP do bar (ADR 0017/0018), e o cliente seguinte no
        # mesmo WiFi via 429 por fotos que nunca enviou.
        return ip_hash

    # `agora_utc()` chamado aqui, pelo nome do módulo — nunca
    # `datetime.now(UTC)` inline, e nunca dentro de `app/services/limites.py`
    # (ver o docstring desse módulo): é este módulo, `app.routers.fotos`,
    # que `tests/apoio_fotos.py::fixar_relogio_fotos` sabe congelar.
    agora = agora_utc()

    # Leitura barata, antes de qualquer escrita: se o balde já está
    # provadamente cheio (sem contar esta tentativa), recusa sem gravar
    # nada. Não fecha a corrida sozinha — vários pedidos concorrentes
    # podem passar por aqui ao mesmo tempo, todos a ver o balde com
    # espaço — é só o que evita um `INSERT` permanente por cada pedido
    # recusado numa sequência (não concorrente) contra um balde já cheio.
    if envios_na_ultima_hora(sessao, ip_hash, agora) >= LIMITE_POR_HORA:
        _recusar_por_limite(sessao, ip_hash, agora)

    registar_tentativa(sessao, ip_hash, agora)
    if envios_na_ultima_hora(sessao, ip_hash, agora) > LIMITE_POR_HORA:
        _recusar_por_limite(sessao, ip_hash, agora)
    return ip_hash


IpHashDoPedido = Annotated[str, Depends(_exigir_limite_de_envios)]


def _texto_ou_nulo(valor: object) -> str | None:
    """`None`, uma string vazia, ou um campo que não é texto (um ficheiro) dão `None`."""
    if not isinstance(valor, str) or valor == "":
        return None
    return valor


#: O corpo multipart, descrito à mão para o OpenAPI: este router nunca
#: declara `ficheiro: UploadFile = File(...)` (ver o docstring do módulo),
#: por isso o FastAPI não tem como adivinhar os campos sozinho — sem isto,
#: o esquema gerado saía com `requestBody` em falta, o TypeScript gerado
#: não sabia os nomes dos campos (`ficheiro`, `descricao`, `enviada_por`,
#: `website`), e o ecrã da F3-05 tinha de os copiar à mão das constantes
#: do backend, sem nada a apanhar uma renomeação futura.
_ESQUEMA_DO_CORPO = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "properties": {
                        CAMPO_FICHEIRO: {"type": "string", "format": "binary"},
                        CAMPO_DESCRICAO: {"type": "string"},
                        CAMPO_ENVIADA_POR: {"type": "string"},
                        # Campo-isco contra bots: um formulário normal
                        # deixa-o vazio; não documentado como obrigatório.
                        CAMPO_ISCO: {"type": "string"},
                    },
                    "required": [CAMPO_FICHEIRO],
                }
            }
        },
    }
}


#: Documenta, para o OpenAPI, os erros que o docstring da rota promete —
#: sem isto, `openapi_extra` descrevia o corpo do pedido mas não os
#: códigos de erro possíveis, e o esquema gerado prometia só o `202`.
_RESPOSTAS_DE_ERRO: dict[int | str, dict[str, Any]] = {
    400: {
        "description": (
            "A imagem é inválida (formato fora de JPEG/PNG/WebP, dados "
            "corrompidos) ou tem mais píxeis do que o limite."
        )
    },
    411: {"description": "Falta o `Content-Length`, ou não é um número."},
    413: {"description": "O ficheiro, ou o corpo do pedido, é maior do que o limite."},
    422: {
        "description": (
            "Falta o campo `ficheiro`, ou `descricao`/`enviada_por` é demasiado longo."
        )
    },
    429: {"description": "Mais de 5 envios na última hora para este IP."},
}


@router.post(
    "/fotos",
    status_code=202,
    response_model=RespostaEnvioFoto,
    openapi_extra=_ESQUEMA_DO_CORPO,
    responses=_RESPOSTAS_DE_ERRO,
)
async def enviar_foto(
    request: Request,
    resposta: Response,
    sessao: SessaoDaBD,
    ip_hash: IpHashDoPedido,
) -> RespostaEnvioFoto:
    """Envia uma foto para moderação.

    Ignora o nome e o `Content-Type` do cliente por completo — é o Pillow
    (`app/services/imagens.py`) quem decide se é uma imagem válida.

    `422` sem o campo `ficheiro`. `413` acima de 8 MB. `400
    {"erro": "imagem_invalida"}` se o Pillow não conseguir abrir, ou se o
    formato não for JPEG/PNG/WebP. `400 {"erro":
    "imagem_demasiado_grande"}` acima do limite de píxeis (S-11). `429`
    com `Retry-After` e `segundos_em_falta` acima de 5 envios na última
    hora para o mesmo IP, salvo com sessão de admin válida.

    O campo escondido `website`, se preenchido, devolve exatamente a mesma
    resposta do caminho feliz sem escrever nada: um robô que o preencha
    não tem como distinguir os dois casos.
    """
    resposta.headers["Cache-Control"] = SEM_CACHE

    # `async with`, não só `await`: `request.form()` devolve um
    # `AwaitableOrContextManagerWrapper`, que aceita os dois. Como gestor
    # de contexto fecha o `SpooledTemporaryFile` do `UploadFile` de forma
    # determinística à saída (sucesso ou exceção), em vez de depender do
    # coletor de lixo.
    async with request.form(max_part_size=LIMITE_CONTENT_LENGTH) as formulario:
        ficheiro = formulario.get(CAMPO_FICHEIRO)
        # `starlette.datastructures.UploadFile`, não `fastapi.UploadFile`:
        # medido, a segunda é uma **subclasse** da primeira, e
        # `request.form()` (o método do Starlette, chamado aqui à mão, ver
        # o docstring do módulo) só cria instâncias da base — um
        # `isinstance` contra a subclasse do FastAPI seria sempre `False`,
        # e todo o caminho feliz sairia em `422`.
        if not isinstance(ficheiro, UploadFile):
            raise ErroDaApi(422, "dados_invalidos", MENSAGEM_CORPO_INVALIDO)

        if _texto_ou_nulo(formulario.get(CAMPO_ISCO)) is not None:
            # Campo-isco preenchido: resposta idêntica à do caminho feliz,
            # sem ler o ficheiro, sem tocar na base de dados nem no disco.
            return RespostaEnvioFoto()

        conteudo = await ficheiro.read()
        descricao = _texto_ou_nulo(formulario.get(CAMPO_DESCRICAO))
        enviada_por = _texto_ou_nulo(formulario.get(CAMPO_ENVIADA_POR))

    servico.registar_envio(
        sessao,
        conteudo=conteudo,
        ip_hash=ip_hash,
        descricao=descricao,
        enviada_por=enviada_por,
    )
    return RespostaEnvioFoto()
