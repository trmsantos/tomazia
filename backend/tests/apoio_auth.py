"""Fixtures e apoio da bateria de autenticação (F2-04).

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_http.py` e `tests/apoio_publico.py` não são: é importado pelos
`conftest.py` que precisam destas fixtures (`tests/auth/`,
`tests/seguranca/`), para as duas pastas nunca divergirem.

Os imports de `app.*` são deliberadamente **dentro** das funções e dos
corpos das fixtures, nunca ao nível do módulo: `app.routers.auth` e
`app.services.auth` ainda não existem enquanto a F2-04 não aterrar, e um
import ao nível do módulo rebentaria **a recolha** do pytest — todos os
testes desta bateria apareceriam como um erro sem nome, em vez de
falharem um a um a dizer exatamente o que falta (o mesmo raciocínio de
`tests/modelos/apoio.py`).

## Os dois pontos de extensão que este ficheiro pressupõe

1. **`app.services.auth.exigir_admin`** — a dependência que o router de
   `/gestao` declara nas suas `dependencies` (ver
   `tests/seguranca/test_s04_gestao_exige_sessao.py`, camada 4). O sítio
   exato (`services`, não `routers`) é uma escolha desta bateria, não da
   especificação: documentada aqui para o implementador a seguir, não para
   a reabrir sem motivo.
2. **O relógio do servidor é `agora_utc`, chamado pelo nome do módulo**
   (`app.services.auth.agora_utc` e/ou `app.routers.auth.agora_utc`,
   importados com `from app.models.tipos import agora_utc`), nunca
   `datetime.now(UTC)` escrito inline. É o que permite a `fixar_relogio_auth`
   congelar o tempo sem tocar no relógio do sistema — o mesmo padrão que
   `tests/apoio_publico.py::fixar_relogio` já usa para `app.services.publico`.
   Sem isto não há como testar a validade de 12 horas da sessão nem o
   bloqueio de 15 minutos do S-07 sem `sleep`.

## Porque é que as credenciais erradas não forjam cookies à mão

As respostas negativas de `tests/auth/test_cookie.py` e de
`tests/seguranca/test_s04_gestao_exige_sessao.py` ("cookie adulterado",
"assinado com outro segredo") não usam `itsdangerous` neste ficheiro —
mesmo sendo essa a biblioteca de assinatura decidida (`docs/ESPECIFICACAO.md`
e o plano da F2-04). Em vez disso:

- um cookie **adulterado** nasce de um cookie genuíno, obtido por um login
  real, com um caráter trocado;
- um cookie **assinado com outro segredo** nasce de um segundo login real,
  contra uma segunda app construída com `SEGREDO_SESSAO` diferente (a
  mesma base de dados, porque `app.db.obter_engine()` está em cache por
  processo e não depende do segredo), cujo valor é depois reenviado à
  primeira app.

As duas formas provam o comportamento observável (o cookie deixa de servir)
sem o teste ter de saber nada sobre o formato interno da assinatura — e sem
`itsdangerous` ter de ser uma dependência dos testes, só da aplicação.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from http.cookies import SimpleCookie
from typing import TYPE_CHECKING

import pytest

from tests.apoio_publico import RelogioFixo

if TYPE_CHECKING:  # pragma: no cover - só para anotações
    import httpx
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

    from app.models.admins import Admin

#: O mesmo valor por omissão de `tests.modelos.apoio.novo_admin`, para o
#: `admin` desta bateria e o dos testes de modelos nunca ficarem
#: dessincronizados sem razão.
UTILIZADOR_FALSO = "dono-de-exemplo"

#: Claramente falsa e nunca usada em mais lado nenhum: não é o padrão de
#: nenhuma password real, e o "de-exemplo" di-lo também a quem só veja a
#: string num log.
PASSWORD_FALSA = "palavra-passe-de-exemplo-0001"

#: Password diferente de `PASSWORD_FALSA`, para os testes de login e de
#: bloqueio que precisam de uma tentativa **errada** contra uma conta que
#: existe.
PASSWORD_ERRADA_DE_EXEMPLO = "palavra-passe-errada-de-exemplo-9999"

#: O corpo de `POST /auth/login` que autentica `admin` com sucesso.
#:
#: **Assunção desta bateria, não da especificação:** os nomes dos campos
#: (`utilizador`, `password`) não estão fixados em `docs/ESPECIFICACAO.md`
#: — só o nome da coluna da BD está. Escolhidos aqui por serem os mesmos
#: nos dois lados; se o backend decidir outros nomes, é aqui que se muda.
CREDENCIAIS_FALSAS: dict[str, str] = {
    "utilizador": UTILIZADOR_FALSO,
    "password": PASSWORD_FALSA,
}

#: O cabeçalho que o S-06 exige em qualquer mutação, `/auth/login` e
#: `/auth/logout` incluídos. Os testes de autenticação que não são sobre o
#: S-06 incluem-no sempre, para nunca confundirem "o login falhou" com "o
#: guarda do X-Tomazia bloqueou antes de chegar ao login".
CABECALHO_MUTACAO: dict[str, str] = {"X-Tomazia": "1"}


def registar_admin(
    sessao: Session,
    *,
    utilizador: str = UTILIZADOR_FALSO,
    password: str = PASSWORD_FALSA,
    **campos: object,
) -> Admin:
    """Cria e guarda um `Admin` com um hash argon2id **verdadeiro** de `password`.

    Não é o `scripts/criar_admin.py` da F2-02 (que não depende desta
    tarefa e pode nem existir ainda): é a forma destes testes semearem uma
    conta, já que S-05 proíbe uma rota que crie admins. O hash é real
    (`argon2.PasswordHasher().hash`, não o texto fixo de
    `tests.modelos.apoio.novo_admin`) porque o caminho feliz do login
    precisa de uma verificação argon2id que passe de verdade.
    """
    from argon2 import PasswordHasher

    from tests.modelos.apoio import novo_admin

    hash_password = PasswordHasher().hash(password)
    admin = novo_admin(utilizador=utilizador, hash_password=hash_password, **campos)
    sessao.add(admin)
    sessao.commit()
    sessao.refresh(admin)
    return admin


@pytest.fixture
def cliente_seguro(motor: Engine) -> Iterator[TestClient]:
    """Um `TestClient` em `https://testserver`, para sessões com cookie `Secure`.

    **Armadilha medida (não a redescubras).** A base do `TestClient` por
    omissão é `http://testserver`. `Secure` é uma instrução para o
    *cliente* HTTP, não para o servidor: medido com o `httpx` que o
    `TestClient` usa por baixo (0.162.0 do FastAPI / Starlette atual) —

    ```
    cliente_http = TestClient(app)                              # http://testserver
    cliente_https = TestClient(app, base_url="https://testserver")

    resposta = cliente_http.post("/login")   # Set-Cookie: ...; Secure   (está lá!)
    cliente_http.get("/eu")                  # {"cookie": None}          (nunca volta)

    resposta = cliente_https.post("/login")  # Set-Cookie: ...; Secure
    cliente_https.get("/eu")                 # {"cookie": "abc"}         (volta)
    ```

    O cookie **fica guardado no jar do cliente das duas formas** — o
    `Secure` não impede a escrita — mas só é reenviado pelo cliente HTTPS.
    Quem escrever o primeiro teste de sessão com a fixture `cliente` normal
    (de `tests/apoio_http.py`) vai ver `401` onde esperava `200`, depois de
    o login já ter devolvido `200` e um `Set-Cookie` com `Secure` lá
    escrito — e a correção óbvia, mas errada, é tirar o `Secure` da
    resposta, que é precisamente o critério de segurança desta tarefa
    (`HttpOnly`, `Secure`, `SameSite=Strict`). Isto já custou uma hora a
    quem não soubesse; não voltes a pagá-la.

    Por isso:

    - qualquer teste que precise de ida e volta de sessão (login e depois
      um pedido que use o cookie) usa esta fixture, nunca a `cliente`
      normal;
    - o próprio atributo `Secure` prova-se **a ler o cabeçalho
      `Set-Cookie`** da resposta do login (`resposta.headers["set-cookie"]`),
      nunca fazendo um pedido a seguir e vendo se o cookie "pegou" — sem
      esta fixture, "pegou" e "não pegou porque alguém tirou o `Secure`"
      dão exatamente o mesmo resultado (regra 10 do `CLAUDE.md`).
    """
    from fastapi.testclient import TestClient

    from app.main import criar_app

    with TestClient(criar_app(), base_url="https://testserver") as cliente_de_teste:
        yield cliente_de_teste


@pytest.fixture
def admin(sessao: Session) -> Admin:
    """Uma conta de admin com dados falsos, criada pela `registar_admin`.

    O par utilizador/password é exatamente `CREDENCIAIS_FALSAS`: os testes
    de login e de bloqueio não repetem os valores à mão, importam a
    constante — é o que garante que `admin` e `CREDENCIAIS_FALSAS` nunca
    divergem.
    """
    return registar_admin(sessao, **CREDENCIAIS_FALSAS)


@pytest.fixture
def sessao_de_admin(cliente_seguro: TestClient, admin: Admin) -> TestClient:
    """`cliente_seguro`, já com uma sessão válida de `admin` (via `POST /auth/login`).

    Depende de `admin`: sem a conta, o login falhava com "credenciais
    inválidas" e o teste que pedisse esta fixture via um erro sobre o
    login de apoio, não sobre o que queria mesmo verificar — daí o
    `assert` explícito abaixo, com uma mensagem que distingue as duas
    coisas.
    """
    resposta = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )
    assert resposta.status_code == 200, (
        "o login de apoio da fixture `sessao_de_admin` falhou "
        f"({resposta.status_code}): {resposta.text}. Os testes que pedem "
        "`sessao_de_admin` pressupõem que o login funciona; se é este "
        "`assert` que está a falhar, o problema é no login, não no teste "
        "que o pediu."
    )
    return cliente_seguro


def nome_e_valor_do_cookie(resposta: httpx.Response) -> tuple[str, str]:
    """O nome e o valor do único cookie de um `Set-Cookie`, via `SimpleCookie`.

    Usa o parser da biblioteca padrão em vez de recortar a string à mão: um
    valor de cookie assinado pode conter `;` codificado e outros carateres
    que uma divisão ingénua por `;` ou `=` parte ao meio. Não assume o
    *nome* do cookie — a especificação não o fixa — por isso devolve-o em
    vez de o impor.
    """
    cabecalho = resposta.headers.get("set-cookie")
    assert cabecalho, (
        f"a resposta a {resposta.request.method} {resposta.request.url} não "
        "trouxe nenhum `Set-Cookie`"
    )
    bolacha: SimpleCookie[str] = SimpleCookie()
    bolacha.load(cabecalho)
    itens = list(bolacha.items())
    assert len(itens) == 1, (
        f"esperava um só cookie no `Set-Cookie`, vieram {len(itens)}: "
        f"{[nome for nome, _ in itens]}"
    )
    (nome, morsel) = itens[0]
    return nome, morsel.value


# --------------------------------------------------------------------------
# O relógio, injetado — mesmo padrão de `tests/apoio_publico.py::fixar_relogio`.
# --------------------------------------------------------------------------

#: Os módulos onde o serviço de autenticação pode ter o nome `agora_utc`
#: ligado. Ver o ponto de extensão nº 2 no cabeçalho deste ficheiro.
MODULOS_COM_RELOGIO_AUTH = ("app.services.auth", "app.routers.auth")


def fixar_relogio_auth(
    monkeypatch: pytest.MonkeyPatch, instante: datetime
) -> RelogioFixo:
    """Substitui `agora_utc` nos módulos de autenticação e devolve o relógio.

    **Ponto de extensão, para quem implementar:** a validade de 12 horas da
    sessão e o bloqueio de 15 minutos do S-07 têm de ser calculados a
    partir de um `agora_utc()` chamado pelo nome do módulo (`from
    app.models.tipos import agora_utc`, depois `agora_utc()`), nunca com
    `datetime.now(UTC)` escrito à mão — é o que permite a estes testes
    avançar o relógio sem `sleep` nenhum.

    Rebenta se **nenhum** dos módulos de `MODULOS_COM_RELOGIO_AUTH` tiver o
    nome: "não consegui injetar o relógio" não pode dar o mesmo resultado
    que "injetei e a verificação de validade ignorou-o" (regra 10 do
    `CLAUDE.md`) — um teste de expiração que não conseguisse mesmo congelar
    o tempo ficaria verde por não ter avançado nada, não por a expiração
    estar correta.
    """
    import importlib

    relogio = RelogioFixo(instante)
    encontrados: list[str] = []
    for nome in MODULOS_COM_RELOGIO_AUTH:
        try:
            modulo = importlib.import_module(nome)
        except ModuleNotFoundError:
            continue
        if hasattr(modulo, "agora_utc"):
            monkeypatch.setattr(modulo, "agora_utc", relogio)
            encontrados.append(nome)
    if not encontrados:
        raise AssertionError(
            f"nenhum de {list(MODULOS_COM_RELOGIO_AUTH)} tem o nome "
            "`agora_utc` para substituir (ou os módulos ainda não existem, "
            "ou existem mas não importam `agora_utc` pelo nome). Sem um "
            "relógio injetável não dá para distinguir uma validade de "
            "sessão ou um bloqueio mal calculados de uma verificação que "
            "nunca chegou a ser exercitada: o serviço tem de chamar "
            "`agora_utc()` pelo nome do módulo, nunca `datetime.now(UTC)` "
            "inline."
        )
    return relogio
