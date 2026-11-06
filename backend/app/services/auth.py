"""Autenticação de administradores: hashes, sessão assinada e bloqueio.

Sem HTTP, no padrão de `app/services/publico.py`: `app/routers/auth.py` só
lê a sessão da base de dados, decide o cookie e entrega o trabalho de
verdade a este módulo.

O relógio entra por `agora_utc`, importado pelo nome do módulo (`from
app.models.tipos import agora_utc`, chamado como `agora_utc()`), nunca
`datetime.now(UTC)` inline: é o único jeito de `tests/apoio_auth.py::
fixar_relogio_auth` conseguir congelar a validade da sessão e a duração do
bloqueio sem `sleep` nenhum.

## A assinatura do cookie

Decisão do Tomás, 4 de novembro de 2026: `itsdangerous`, não `hmac` à mão.
Mas o `TimestampSigner` da biblioteca verifica a validade contra
`time.time()`, que este módulo não controla — por isso a validade de 12
horas não usa esse mecanismo. Em vez disso, o próprio instante da emissão
(lido de `agora_utc()`) viaja **dentro** do valor assinado, e é contra
`agora_utc()` que `ler_sessao` o compara: a parte criptográfica
(`itsdangerous.Signer`) garante que ninguém forja ou altera o valor; a
validade no tempo é decidida aqui, com o relógio injetável.

A chave de assinatura deriva-se do `segredo_sessao` de `app/config.py`
com um `salt` fixo (`ETIQUETA_DO_SEGREDO`), para o mesmo segredo poder
servir outro fim no futuro (por exemplo, a rota de mudar password da
F2-09) sem os dois valores colidirem.

## A revogação ao logout

Decisão do Tomás, 4 de novembro de 2026, substituindo uma primeira versão
desta tarefa que guardava os cookies revogados num `set` em memória: essa
abordagem passava nos testes e falhava em produção — não sobrevive a um
reinício do processo, não atravessa os vários processos do Passenger no
cPanel (um logout num processo não invalidaria a sessão nos outros) e
cresce sem limite. Dava a aparência de revogação sem a entregar.

Em vez disso, `admins.sessao_versao` (coluna da F2-04, migração
`0a3dd504b341`) é um contador que o cookie leva consigo: `assinar_sessao`
grava a versão de quando foi emitido, e `exigir_admin` — não `ler_sessao`,
que fica sem tocar na base de dados — recusa um cookie cuja versão não
bata com a da linha. `POST /auth/logout` incrementa o contador, o que
invalida de um golpe **todas** as sessões daquele admin, não só a do
browser que pediu o logout; com um admin só, isso não custa nada. O mesmo
mecanismo chega, sem coluna nova nenhuma, à rota de mudar password que
falta à especificação (ver `docs/TAREFAS.md`, F2-05): bastaria incrementar
`sessao_versao` ao mudar a password, pelo mesmo caminho — não
implementado aqui.

**Achado em revisão, corrigido na mesma ronda:** uma primeira versão deste
mecanismo incrementava `sessao_versao` sem verificar se o cookie recebido
no logout ainda era a versão *atual* da conta. Isso abre um replay: guarda
um cookie já revogado por um logout anterior e reenvia-o a
`POST /auth/logout` outra vez — o incremento repete-se e mata qualquer
sessão mais recente da mesma conta, incluindo uma legítima aberta depois
do primeiro logout. `terminar_sessoes` por isso leva a versão que o
cookie tinha e só incrementa **atomicamente**, com essa versão no `WHERE`
do próprio `UPDATE` — não com um `SELECT` seguido de um `UPDATE`, que
deixaria uma janela entre os dois para duas chamadas simultâneas lerem o
mesmo valor antigo e incrementarem a partir dele duas vezes. Ver
`tests/seguranca/test_logout_nao_aceita_cookie_revogado.py`.
"""

from __future__ import annotations

import base64
import binascii
import math
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Annotated, NamedTuple

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError
from fastapi import Cookie, HTTPException
from itsdangerous import BadSignature, Signer
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import obter_definicoes
from app.dependencias import SessaoDaBD
from app.erros import ErroDaApi
from app.models.admins import Admin
from app.models.tipos import agora_utc

#: `docs/ESPECIFICACAO.md`: "cookie de sessão assinado [...] 12 horas".
VALIDADE_DA_SESSAO = timedelta(hours=12)

#: `docs/ESPECIFICACAO.md`: "bloqueio de 15 minutos após 5 falhas".
DURACAO_DO_BLOQUEIO = timedelta(minutes=15)

#: A quinta falha ainda responde 400; só a sexta vê o bloqueio (decisão do
#: Tomás, leitura literal do S-07).
LIMITE_DE_TENTATIVAS = 5

#: O nome do cookie de sessão. Não está fixado em `docs/ESPECIFICACAO.md`.
#: O prefixo `__Host-` (revisão da F2-04) é uma instrução ao **browser**,
#: não ao servidor: só aceita gravar o cookie se vier com `Secure`,
#: `Path=/` e sem `Domain` — os três já eram verdade aqui. Sem o prefixo,
#: quem controle um subdomínio do domínio de produção pode escrever um
#: `sessao_tomazia` com `Domain=` do domínio-pai e ensombrar o verdadeiro,
#: deixando o dono aparentemente sem sessão até limpar os cookies. Sem
#: clientes em produção ainda, muda-se agora por uma linha; depois seria
#: uma migração de verdade.
NOME_DO_COOKIE = "__Host-sessao_tomazia"

#: O `salt` do `itsdangerous.Signer`: deriva uma chave própria para a
#: sessão a partir do `segredo_sessao` único de `app/config.py`, para o
#: mesmo segredo poder assinar outra coisa no futuro sem colidir.
ETIQUETA_DO_SEGREDO = b"sessao.v1"

#: Separador entre o `id` do admin, a versão da sessão e o instante de
#: emissão, dentro do valor assinado. Não pode aparecer em nenhum dos três:
#: um `int` nunca o contém, e `datetime.isoformat()` também não (usa `-`,
#: `:`, `.`, `+`).
SEPARADOR_DO_VALOR = "|"

#: Texto do ui-ux, revisto em revisão da F2-04.
MENSAGEM_CREDENCIAIS_INVALIDAS = (
    "Utilizador ou password inválidos. Confirma os dois e tenta novamente."
)
MENSAGEM_CONTA_BLOQUEADA = (
    "Conta bloqueada durante 15 minutos, depois de várias tentativas falhadas. "
    "Tenta novamente depois desse tempo."
)
MENSAGEM_SESSAO_EM_FALTA = "Sessão inexistente ou expirada. Inicia sessão novamente."

#: `GET /auth/eu` e os `401` de sessão nunca podem ficar em cache — nem no
#: browser, nem num proxy partilhado.
CABECALHOS_SEM_CACHE = {"Cache-Control": "no-store"}


# --------------------------------------------------------------------------
# Hashes de password
# --------------------------------------------------------------------------

_hasher = PasswordHasher()


def criar_hash(password: str) -> str:
    """O hash argon2id de `password`, para guardar em `admins.hash_password`."""
    return _hasher.hash(password)


def verificar_password(hash_password: str, password: str) -> bool:
    """Se `password` corresponde a `hash_password`. Nunca levanta."""
    try:
        return _hasher.verify(hash_password, password)
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False


@lru_cache
def _hash_isco() -> str:
    """Um hash argon2id válido, sem conta nenhuma correspondente.

    Calculado **uma vez por processo** (`lru_cache` sem argumentos): quando
    o utilizador não existe, `autenticar` verifica a password contra este
    hash antes de responder — senão o tempo de resposta de "utilizador não
    existe" (sem argon2 nenhum) seria mensurávelmente mais curto do que o
    de "existe, password errada" (um argon2 completo), e a mensagem
    idêntica deixaria de ser a única coisa que um atacante consegue ler.
    """
    return criar_hash("isco-sem-conta-correspondente-de-exemplo-0000")


def registar_admin(sessao: Session, utilizador: str, password: str) -> Admin:
    """Cria e guarda um `Admin`, com o hash de `password`.

    Não é uma rota (S-05 proíbe uma rota que crie admins): é o que
    `scripts/criar_admin.py` chama, por fora de HTTP.
    """
    admin = Admin(utilizador=utilizador, hash_password=criar_hash(password))
    sessao.add(admin)
    sessao.commit()
    sessao.refresh(admin)
    return admin


# --------------------------------------------------------------------------
# A sessão assinada
# --------------------------------------------------------------------------


def _assinador() -> Signer:
    """Um `Signer` novo a cada chamada: `obter_definicoes()` tem a sua
    própria `lru_cache`, e construir o `Signer` aqui (em vez de o guardar
    num `lru_cache` próprio) é o que permite aos testes trocar
    `SEGREDO_SESSAO` a meio do processo (via `monkeypatch.setenv` +
    `obter_definicoes.cache_clear()`) e ver o cookie deixar de servir.
    """
    return Signer(obter_definicoes().segredo_sessao, salt=ETIQUETA_DO_SEGREDO)


class SessaoAssinada(NamedTuple):
    """O conteúdo de um cookie de sessão, já verificado e decodificado."""

    admin_id: int
    versao: int


def assinar_sessao(admin_id: int, sessao_versao: int) -> str:
    """O valor do cookie de sessão de `admin_id`, assinado e pronto a enviar.

    `sessao_versao` é o `admins.sessao_versao` da conta **no momento do
    login** — não é relido depois: é contra o valor atual da linha que
    `exigir_admin` o compara, e um logout que incremente a coluna é o que
    faz essa comparação falhar para qualquer cookie emitido antes dele.
    """
    valor = (
        f"{admin_id}{SEPARADOR_DO_VALOR}{sessao_versao}"
        f"{SEPARADOR_DO_VALOR}{agora_utc().isoformat()}"
    )
    assinado = _assinador().sign(valor.encode("utf-8"))
    return base64.urlsafe_b64encode(assinado).decode("ascii")


def ler_sessao(valor: str) -> SessaoAssinada | None:
    """O conteúdo de um cookie de sessão assinado e ainda dentro da validade.

    `None` para qualquer forma de falha — cookie ausente, adulterado,
    assinado com outro segredo, expirado, ou sem a forma esperada — sem as
    distinguir: um `401` que dissesse qual delas ajudaria um atacante a
    perceber porque é que um cookie forjado não serviu.

    **Não toca na base de dados**: só decifra e valida o que está dentro do
    valor assinado (incluindo a validade de 12 horas, contra `agora_utc()`).
    A versão de sessão que vem aqui dentro ainda não foi comparada com a da
    conta — isso é `exigir_admin`, que é quem já tem o `Admin` carregado.
    """
    try:
        assinado = base64.urlsafe_b64decode(valor.encode("ascii"))
    except (ValueError, binascii.Error):
        return None

    try:
        payload = _assinador().unsign(assinado)
    except BadSignature:
        return None

    try:
        texto = payload.decode("utf-8")
        id_texto, versao_texto, instante_texto = texto.split(SEPARADOR_DO_VALOR, 2)
        admin_id = int(id_texto)
        sessao_versao = int(versao_texto)
        emitido_em = datetime.fromisoformat(instante_texto)
    except (UnicodeDecodeError, ValueError):
        return None

    if agora_utc() - emitido_em > VALIDADE_DA_SESSAO:
        return None
    return SessaoAssinada(admin_id=admin_id, versao=sessao_versao)


def admin_da_sessao(sessao: Session, valor_da_sessao: str | None) -> Admin | None:
    """O admin dono de `valor_da_sessao`, ou `None` — nunca levanta.

    Extraído de `exigir_admin` (achado em revisão da F2-06): havia uma
    cópia linha a linha deste corpo em `app.routers.fotos._admin_da_sessao`,
    usada só para decidir se uma sessão de admin válida salta o limite de
    envios de fotos. Duas cópias da mesma verificação divergem no dia em
    que uma delas ganhar mais uma condição — por exemplo, um campo
    `desativado` numa conta — e só uma das duas for atualizada; o atalho ao
    limite continuaria a confiar numa sessão que a gestão já recusa. Quem
    precisar de **exigir** uma sessão usa `exigir_admin`, que é esta função
    mais o `401`; quem só precisar de **saber se há uma**, sem tornar isso
    obrigatório, usa esta.
    """
    if not valor_da_sessao:
        return None
    lida = ler_sessao(valor_da_sessao)
    if lida is None:
        return None
    candidato = sessao.get(Admin, lida.admin_id)
    # A verificação da versão vive aqui, não em `ler_sessao`: é aqui que o
    # `Admin` já foi carregado, e é a linha da conta — não o cookie — que
    # diz qual é a versão válida agora.
    if candidato is not None and candidato.sessao_versao == lida.versao:
        return candidato
    return None


def exigir_admin(
    sessao: SessaoDaBD,
    valor_da_sessao: Annotated[str | None, Cookie(alias=NOME_DO_COOKIE)] = None,
) -> Admin:
    """A dependência das rotas de gestão (e de `GET /auth/eu`).

    `401 {"erro": "sessao_em_falta"}` sem distinguir cookie ausente,
    adulterado, expirado, assinado com outro segredo, de versão diferente
    da guardada na conta (ver `admins.sessao_versao`), ou cujo `admin_id`
    já não existe na base de dados — nenhum destes motivos dá uma resposta
    diferente dos outros.

    Levanta `fastapi.HTTPException`, não `ErroDaApi`: esta dependência tem
    de funcionar mesmo numa app que não tenha passado por `criar_app()` (é
    o que `tests/seguranca/test_s04_gestao_exige_sessao.py` faz, com uma
    app de sonda construída como `FastAPI()` simples, sem
    `registar_tratadores_de_erro`). O `HTTPException` tem tratador por
    omissão em **qualquer** `FastAPI()` — `ErroDaApi` só tem tratador na
    app que `app/erros.py` regista. `app/erros.py::_tratar_http_exception`
    lê o `detail` em forma de dicionário e produz o envelope `{"erro",
    "mensagem"}`; numa app sem esse tratador, o `detail` sai aninhado em
    `{"detail": {...}}` — o que nenhum teste de sessão em falta verifica,
    só o estado `401`.
    """
    admin = admin_da_sessao(sessao, valor_da_sessao)
    if admin is None:
        raise HTTPException(
            status_code=401,
            detail={"erro": "sessao_em_falta", "mensagem": MENSAGEM_SESSAO_EM_FALTA},
            headers=CABECALHOS_SEM_CACHE,
        )
    return admin


def terminar_sessoes(sessao: Session, admin_id: int, sessao_versao: int) -> None:
    """Invalida todas as sessões de `admin_id`, incrementando `sessao_versao`.

    Chamada por `POST /auth/logout` com o `admin_id` e a `versao` que
    `ler_sessao` leu do cookie recebido — é o próprio router que valida a
    assinatura e a validade antes de chamar esta função.

    **`sessao_versao` entra na condição do `UPDATE`, não só no `admin_id`.**
    Um `UPDATE ... WHERE id = :id AND sessao_versao = :versao` só mexe na
    linha se o cookie ainda for a versão *atual* da conta — nem conta
    apagada (zero linhas), nem **cookie já revogado por um logout
    anterior** (a versão que ele leva já não bate com a da linha, zero
    linhas). Sem esta condição, repetir um `POST /auth/logout` com um
    cookie antigo incrementava o contador outra vez e matava qualquer
    sessão mais recente da mesma conta — um replay que torna o logout uma
    arma contra sessões legítimas, achado em revisão.

    É também o que torna isto seguro contra duas chamadas verdadeiramente
    simultâneas (um duplo-clique no botão de logout): um `UPDATE` só, com
    a condição e o incremento na mesma instrução SQL, não tem a janela
    entre "ler o valor" e "escrever o valor + 1" que um `SELECT` seguido
    de um `UPDATE` teria — a segunda chamada simultânea já não encontra a
    versão que leu, porque a primeira já a mudou, e não faz nada.
    """
    sessao.execute(
        update(Admin)
        .where(Admin.id == admin_id, Admin.sessao_versao == sessao_versao)
        .values(sessao_versao=Admin.sessao_versao + 1)
    )
    sessao.commit()


# --------------------------------------------------------------------------
# O login e a máquina de estados do bloqueio
# --------------------------------------------------------------------------


def autenticar(sessao: Session, utilizador: str, password: str) -> Admin:
    """Verifica `utilizador`/`password` e aplica o bloqueio de 15 minutos.

    Por ordem (decisão do Tomás, 4 de novembro de 2026):

    1. conta não existe → verifica contra o hash-isco, `400`;
    2. `bloqueado_ate` já passou → repõe o contador a zero **antes** de
       avaliar, para a conta não sair do bloqueio já com 5 tentativas
       gastas;
    3. `bloqueado_ate` no futuro → `429`, sem incrementar nem estender;
    4. password errada → incrementa; à quinta falha, bloqueia 15 minutos;
       resposta sempre `400`, a quinta falha incluída;
    5. password certa → limpa o contador e o bloqueio, devolve o admin.
    """
    admin = sessao.scalar(select(Admin).where(Admin.utilizador == utilizador))
    if admin is None:
        # Mesmo trabalho que uma conta real faria, para o tempo de
        # resposta não denunciar que o utilizador não existe.
        verificar_password(_hash_isco(), password)
        raise ErroDaApi(
            400,
            "credenciais_invalidas",
            MENSAGEM_CREDENCIAIS_INVALIDAS,
            cabecalhos=CABECALHOS_SEM_CACHE,
        )

    agora = agora_utc()

    if admin.bloqueado_ate is not None and admin.bloqueado_ate <= agora:
        admin.tentativas_falhadas = 0
        admin.bloqueado_ate = None
        sessao.commit()

    if admin.bloqueado_ate is not None and admin.bloqueado_ate > agora:
        segundos_em_falta = math.ceil((admin.bloqueado_ate - agora).total_seconds())
        raise ErroDaApi(
            429,
            "conta_bloqueada",
            MENSAGEM_CONTA_BLOQUEADA,
            extra={"segundos_em_falta": segundos_em_falta},
            cabecalhos={
                **CABECALHOS_SEM_CACHE,
                "Retry-After": str(segundos_em_falta),
            },
        )

    if not verificar_password(admin.hash_password, password):
        admin.tentativas_falhadas += 1
        if admin.tentativas_falhadas >= LIMITE_DE_TENTATIVAS:
            admin.bloqueado_ate = agora + DURACAO_DO_BLOQUEIO
        sessao.commit()
        raise ErroDaApi(
            400,
            "credenciais_invalidas",
            MENSAGEM_CREDENCIAIS_INVALIDAS,
            cabecalhos=CABECALHOS_SEM_CACHE,
        )

    admin.tentativas_falhadas = 0
    admin.bloqueado_ate = None
    sessao.commit()
    return admin
