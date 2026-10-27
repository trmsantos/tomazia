"""O cenário armadilhado dos endpoints públicos, e o contrato que eles têm.

Não é um ficheiro de testes (não começa por `test_`). É partilhado por
`tests/publico/` e por `tests/seguranca/test_s09_*.py`, que semeia o mesmo
mundo com outro texto.

Todos os valores são claramente falsos: `912345678`, `exemplo.test` (TLD
reservado pela RFC 2606, nunca resolve), "de exemplo" nos nomes. Nenhum
produto, categoria, evento ou contacto daqui corresponde ao Bar da
Tomazia — inventar factos sobre o bar é proibido pelo `CLAUDE.md`, e dados
falsos num teste são a forma de não o fazer por acidente.

## A MARCA

Tudo o que **não pode** sair nas respostas públicas leva `MARCA` no texto:
a categoria invisível, a categoria sem produtos disponíveis, o produto
indisponível, o evento rascunho, o evento passado, a foto pendente, a foto
rejeitada, e uma chave de `definicoes` que não é publicada.

A MARCA está também em `fotos.ip_hash` e `fotos.enviada_por` de uma foto
**aprovada** — uma linha que *tem* de sair na `/galeria`. É o que distingue
"a linha está escondida" de "o campo está escondido": sem ela, um
`SELECT *` por cima das linhas aprovadas passava no teste da marca.

`MARCA` é ASCII puro, sem `/`, `\\` nem `..`: tem de caber em
`fotos.ficheiro` e `eventos.imagem`, que a base de dados obriga a serem
nomes de ficheiro e não caminhos (CHECK da F2-01), e tem de aparecer tal e
qual no JSON, sem escapes, para `MARCA not in resposta.text` ser uma
asserção sobre o corpo e não sobre a codificação.

## Ids fora de ordem, de propósito

`categorias.ordem` e `produtos.ordem` têm omissão 0 e `fotos.criada_em` vem
do `CURRENT_TIMESTAMP`, com resolução de um segundo: empates são o caso
normal, não a exceção. Por isso os ids são atribuídos à mão e fora de
ordem, e há empates semeados em `ordem` e em `criada_em`.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - só para anotações
    import pytest
    from sqlalchemy.orm import Session

#: A marca que nenhuma resposta pública pode conter. Sem acentos, sem
#: caracteres que o JSON escape, sem `/` nem `..`.
MARCA = "NAO-DEVE-SAIR-7f3a"

#: O texto do critério S-09, tal como está em `docs/ESPECIFICACAO.md`:
#: aspas, `<script>`, `&` e um acento.
TEXTO_PERIGOSO = 'Café "especial" <script>alert(1)</script> & ação'

# --------------------------------------------------------------------------
# Ids do cenário. Fora de ordem de propósito (ver o docstring do módulo).
# --------------------------------------------------------------------------

ID_CAT_PETISCOS = 10  # visível, ordem 0, um produto disponível
ID_CAT_SOBREMESAS = 20  # visível, ordem 5 (sai em último, apesar do id baixo)
ID_CAT_BEBIDAS = 30  # visível, ordem 0, dois disponíveis e um indisponível
ID_CAT_SO_INDISPONIVEIS = 40  # visível, mas nada disponível -> fora
ID_CAT_INVISIVEL = 50  # invisível, com produtos disponíveis -> fora
ID_CAT_SEM_PRODUTOS = 60  # visível, sem produtos nenhuns -> fora

ID_PROD_TREMOCOS = 100  # cat 10, ordem 2, disponível, 0 cêntimos
ID_PROD_AGUA = 150  # cat 30, ordem 3, disponível (id baixo, ordem alta)
ID_PROD_VINHO = 200  # cat 30, ordem 0, disponível
ID_PROD_IMPERIAL = 300  # cat 30, ordem 0, disponível (empate com o vinho)
ID_PROD_LICOR = 400  # cat 30, indisponível -> fora
ID_PROD_TARTE = 500  # cat 20, ordem 0, disponível
ID_PROD_SO_IND_A = 600  # cat 40, indisponível -> fora
ID_PROD_SO_IND_B = 700  # cat 40, indisponível -> fora
ID_PROD_INVISIVEL_A = 800  # cat 50, disponível mas a categoria é invisível
ID_PROD_INVISIVEL_B = 900  # cat 50, disponível mas a categoria é invisível

ID_EVT_KARAOKE = 20  # futuro, empata no instante com o dos fados
ID_EVT_QUIZ = 50  # futuro, mais tarde
ID_EVT_FADOS = 70  # futuro, mesmo instante do karaoke (id maior)
ID_EVT_PASSADO = 80  # publicado, mas já aconteceu -> fora
ID_EVT_RASCUNHO = 90  # com data futura, mas não publicado -> fora
ID_EVT_SEM_DATA = 95  # rascunho sem data nenhuma -> fora

ID_FOTO_RECENTE_B = 300  # aprovada, instante recente (empate, id maior)
ID_FOTO_RECENTE_A = 100  # aprovada, mesmo instante (id menor)
ID_FOTO_ANTIGA = 200  # aprovada, mais antiga; leva a MARCA nos campos ocultos
ID_FOTO_PENDENTE = 400  # pendente -> fora
ID_FOTO_REJEITADA = 500  # rejeitada -> fora

#: O que `GET /ementa` tem de devolver, por esta ordem exata:
#: categorias por `ordem` e, em empate, por `id`; produtos idem.
EMENTA_ESPERADA: tuple[tuple[int, tuple[int, ...]], ...] = (
    (ID_CAT_PETISCOS, (ID_PROD_TREMOCOS,)),
    (ID_CAT_BEBIDAS, (ID_PROD_VINHO, ID_PROD_IMPERIAL, ID_PROD_AGUA)),
    (ID_CAT_SOBREMESAS, (ID_PROD_TARTE,)),
)

#: O que `GET /eventos` tem de devolver: `inicio` ascendente, empate por id.
EVENTOS_ESPERADOS: tuple[int, ...] = (ID_EVT_KARAOKE, ID_EVT_FADOS, ID_EVT_QUIZ)

#: O que `GET /galeria` tem de devolver: mais recentes primeiro, empate por
#: id descendente.
FOTOS_ESPERADAS: tuple[int, ...] = (
    ID_FOTO_RECENTE_B,
    ID_FOTO_RECENTE_A,
    ID_FOTO_ANTIGA,
)

#: Categorias e produtos que o cenário semeia mas que nenhuma resposta
#: pode mostrar. Usados nos testes de filtro, para a asserção dizer o nome
#: do que fugiu em vez de só "conjuntos diferentes".
IDS_DE_CATEGORIAS_ESCONDIDAS = (
    ID_CAT_SO_INDISPONIVEIS,
    ID_CAT_INVISIVEL,
    ID_CAT_SEM_PRODUTOS,
)
IDS_DE_PRODUTOS_ESCONDIDOS = (
    ID_PROD_LICOR,
    ID_PROD_SO_IND_A,
    ID_PROD_SO_IND_B,
    ID_PROD_INVISIVEL_A,
    ID_PROD_INVISIVEL_B,
)
IDS_DE_EVENTOS_ESCONDIDOS = (ID_EVT_PASSADO, ID_EVT_RASCUNHO, ID_EVT_SEM_DATA)
IDS_DE_FOTOS_ESCONDIDAS = (ID_FOTO_PENDENTE, ID_FOTO_REJEITADA)

# --------------------------------------------------------------------------
# As chaves exatas de cada item de cada resposta.
# --------------------------------------------------------------------------

CHAVES_EMENTA = frozenset({"categorias"})
CHAVES_CATEGORIA = frozenset({"id", "nome", "slug", "produtos"})
CHAVES_PRODUTO = frozenset({"id", "nome", "descricao", "preco_cent"})

CHAVES_EVENTOS = frozenset({"eventos"})
CHAVES_EVENTO = frozenset({"id", "titulo", "inicio", "descricao", "imagem"})

CHAVES_GALERIA = frozenset({"fotos"})
CHAVES_FOTO = frozenset({"id", "ficheiro", "descricao"})

CHAVES_INFO = frozenset(
    {"wifi", "morada", "telefone", "instagram", "maps_url", "horario"}
)
CHAVES_WIFI = frozenset({"rede", "password"})
CHAVES_DIA_DO_HORARIO = frozenset({"dia", "periodos"})
CHAVES_PERIODO = frozenset({"abre", "fecha"})

#: Os campos escalares de `/info` que são `string | null`.
ESCALARES_DE_INFO = ("morada", "telefone", "instagram", "maps_url")

# --------------------------------------------------------------------------
# O horário (ADR 0011).
# --------------------------------------------------------------------------

DIAS_DA_SEMANA = (
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
    "domingo",
)


def dia_fechado(dia: str) -> dict[str, Any]:
    return {"dia": dia, "periodos": []}


#: Guardado desordenado e incompleto de propósito: o ADR 0011 diz que
#: `GET /info` normaliza — sete dias, sempre por ordem, os que faltam com
#: `periodos: []`.
HORARIO_GUARDADO_INCOMPLETO = json.dumps(
    [
        {"dia": "terca", "periodos": [{"abre": "17:00", "fecha": "02:00"}]},
        {
            "dia": "domingo",
            "periodos": [
                {"abre": "12:00", "fecha": "15:00"},
                {"abre": "18:00", "fecha": "23:30"},
            ],
        },
        {"dia": "segunda", "periodos": []},
    ],
    ensure_ascii=False,
)

HORARIO_ESPERADO_DO_INCOMPLETO: list[dict[str, Any]] = [
    dia_fechado("segunda"),
    {"dia": "terca", "periodos": [{"abre": "17:00", "fecha": "02:00"}]},
    dia_fechado("quarta"),
    dia_fechado("quinta"),
    dia_fechado("sexta"),
    dia_fechado("sabado"),
    {
        "dia": "domingo",
        "periodos": [
            {"abre": "12:00", "fecha": "15:00"},
            {"abre": "18:00", "fecha": "23:30"},
        ],
    },
]

#: Sete dias, todos com `periodos: []`. **Não** é o mesmo que `null`: isto
#: é "configurado e fechado toda a semana", uma afirmação sobre o bar.
HORARIO_SETE_DIAS_FECHADO = [dia_fechado(dia) for dia in DIAS_DA_SEMANA]

#: Valores guardados que não passam na validação do ADR 0011. Todos têm de
#: dar `horario: null`, 200, e um erro no log com o nome da chave.
HORARIOS_INVALIDOS = {
    "nao-e-json": "{",
    "objeto-em-vez-de-lista": '{"segunda": []}',
    "dia-que-nao-existe": '[{"dia": "lunes", "periodos": []}]',
    "hora-impossivel": '[{"dia": "segunda", "periodos": [{"abre": "25:00", "fecha": "02:00"}]}]',
    "periodo-sem-fecha": '[{"dia": "segunda", "periodos": [{"abre": "17:00"}]}]',
    "lista-de-strings": '["segunda", "terca"]',
}

# --------------------------------------------------------------------------
# As definições publicadas por `GET /info`.
# --------------------------------------------------------------------------

DEFINICOES_FALSAS: dict[str, str] = {
    "wifi_rede": "Tomazia-Convidados-de-exemplo",
    "wifi_password": "palavra-passe-de-exemplo",
    "morada": "Rua de Exemplo, 1, Estarreja",
    "telefone": "912345678",
    "instagram": "https://instagram.exemplo.test/bar-de-exemplo",
    "maps_url": "https://maps.exemplo.test/bar-de-exemplo",
    "horario": HORARIO_GUARDADO_INCOMPLETO,
}

#: Uma chave que existe na tabela e que `GET /info` **não** publica. Leva a
#: MARCA: é a prova de que a resposta publica as sete chaves do contrato e
#: não tudo o que estiver em `definicoes`.
CHAVE_INTERNA_NAO_PUBLICADA = "nota_interna_de_exemplo"


def obter_json(cliente: Any, caminho: str) -> dict[str, Any]:
    """Faz o GET, exige 200 e devolve o corpo descodificado.

    A mensagem distingue os dois casos que de outra forma se confundiam
    (regra 10): um 404 quer dizer "a rota não existe", e é isso que se vê
    enquanto a F2-03 não aterrar; qualquer outro código é a rota a
    responder mal. Sem isto, uma fixture que rebentasse com
    `assert 404 == 200` deixava toda a bateria com erros que não dizem se
    o problema é da rota, do esquema ou do cenário.
    """
    resposta = cliente.get(caminho)
    if resposta.status_code == 404:
        raise AssertionError(
            f"{caminho} respondeu 404: a rota não está registada na app. "
            "Enquanto a F2-03 não aterrar, é esta a falha esperada."
        )
    assert resposta.status_code == 200, (
        f"{caminho} respondeu {resposta.status_code} em vez de 200. "
        f"Corpo: {resposta.text}"
    )
    corpo = resposta.json()
    assert isinstance(corpo, dict), (
        f"{caminho} devolveu {type(corpo).__name__} no topo, não um objeto. "
        "O contrato é um envelope nomeado: um array no topo não se consegue "
        "estender sem partir o que a F2-09 gera"
    )
    return corpo


# --------------------------------------------------------------------------
# O contrato das rotas públicas.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ContratoDeRota:
    """O que uma rota pública promete, numa linha só.

    `cache` é o valor exato do cabeçalho `Cache-Control`. `metodos` é o
    conjunto de métodos HTTP que a rota aceita (sem `HEAD`, que o Starlette
    acrescenta sozinho).
    """

    cache: str
    metodos: frozenset[str] = field(default_factory=lambda: frozenset({"GET"}))


#: A tabela que o teste de enumeração de rotas confronta com a app.
#: Uma rota pública nova fica **vermelha** até alguém a acrescentar aqui —
#: e acrescentá-la obriga a decidir o que ela expõe e se entra em cache.
CONTRATO_PUBLICO: dict[str, ContratoDeRota] = {
    # `/health` é pública e entra na tabela pela mesma razão que as outras:
    # a enumeração não tem exceções, senão deixa de provar o que promete.
    "/health": ContratoDeRota(cache="no-store"),
    "/ementa": ContratoDeRota(cache="max-age=60"),
    "/eventos": ContratoDeRota(cache="max-age=60"),
    # `no-store` e não `max-age=60`: a galeria muda quando o dono modera uma
    # foto e a `/info` quando ele muda a password do WiFi. São as duas
    # superfícies em que um minuto de cache é um minuto a mostrar o que já
    # não é verdade.
    "/galeria": ContratoDeRota(cache="no-store"),
    "/info": ContratoDeRota(cache="no-store"),
}

#: Os caminhos públicos que respondem a GET — os que os testes de cache e
#: de fuga de dados percorrem. Derivado da tabela, nunca escrito à mão: é o
#: que faz a enumeração de rotas provar alguma coisa.
CAMINHOS_PUBLICOS_GET: tuple[str, ...] = tuple(
    sorted(
        caminho
        for caminho, contrato in CONTRATO_PUBLICO.items()
        if "GET" in contrato.metodos
    )
)

#: Os quatro endpoints de leitura desta tarefa (sem o `/health`, que é da
#: F1-02 e não lê a base de dados).
CAMINHOS_DA_F2_03: tuple[str, ...] = ("/ementa", "/eventos", "/galeria", "/info")


# --------------------------------------------------------------------------
# O relógio, injetado (ADR 0010).
# --------------------------------------------------------------------------


class RelogioFixo:
    """Um `agora_utc` de mentira que conta quantas vezes foi lido.

    A contagem é o que separa, na regra 10, "o filtro está errado" de "o
    relógio nunca chegou a ser injetado": sem ela, um serviço que chamasse
    `datetime.now(UTC)` diretamente dava um teste vermelho com a mensagem
    errada.
    """

    def __init__(self, instante: datetime) -> None:
        if instante.tzinfo is None:
            raise ValueError("o relógio de teste tem de ter fuso horário")
        self.instante = instante.astimezone(UTC)
        self.chamadas = 0

    def __call__(self) -> datetime:
        self.chamadas += 1
        return self.instante


#: Os módulos onde a app pode ter o nome `agora_utc` ligado. `app.models.
#: tipos` fica de fora de propósito: tem-no sempre, e incluí-lo tornaria o
#: guarda de "não há onde injetar" impossível de disparar.
MODULOS_COM_RELOGIO = ("app.services.publico", "app.routers.publico", "app.tempo")


def fixar_relogio(monkeypatch: pytest.MonkeyPatch, instante: datetime) -> RelogioFixo:
    """Substitui `agora_utc` nos módulos públicos e devolve o relógio.

    **Ponto de extensão, para quem implementar:** o corte do dia tem de ser
    calculado a partir de um `agora_utc()` chamado como nome do módulo
    (`from app.models.tipos import agora_utc`, depois `agora_utc()`), e não
    com um `datetime.now(UTC)` escrito à mão lá dentro. É o que permite a
    um teste fixar o relógio sem mexer no relógio do sistema.

    Rebenta se **nenhum** dos módulos tiver o nome: "não consegui injetar"
    não pode dar o mesmo resultado que "injetei e o filtro ignorou-o"
    (regra 10 do `CLAUDE.md`).
    """
    relogio = RelogioFixo(instante)
    encontrados: list[str] = []
    for nome in MODULOS_COM_RELOGIO:
        try:
            modulo = importlib.import_module(nome)
        except ModuleNotFoundError:
            continue
        if hasattr(modulo, "agora_utc"):
            monkeypatch.setattr(modulo, "agora_utc", relogio)
            encontrados.append(nome)
    if not encontrados:
        raise AssertionError(
            "nenhum de "
            f"{list(MODULOS_COM_RELOGIO)} tem o nome `agora_utc` para "
            "substituir. Sem um relógio injetável não dá para distinguir "
            "um corte do dia errado de um corte do dia que nunca foi "
            "exercitado: o serviço tem de chamar `agora_utc()` pelo nome "
            "do módulo, nunca `datetime.now(UTC)` inline."
        )
    return relogio


def exigir_relogio_lido(relogio: RelogioFixo) -> None:
    """Rebenta se o relógio injetado nunca foi lido durante o pedido."""
    assert relogio.chamadas > 0, (
        "o relógio injetado nunca foi lido: a resposta não veio do "
        "instante que este teste fixou, veio do relógio do sistema. "
        "Enquanto isto for verdade, o resultado deste teste não diz nada "
        "sobre o corte do dia."
    )


# --------------------------------------------------------------------------
# O cenário.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Cenario:
    """Os instantes que o cenário usou, para os testes os poderem comparar."""

    agora: datetime
    instante_dos_eventos_empatados: datetime
    instante_do_evento_tardio: datetime
    instante_das_fotos_recentes: datetime
    instante_da_foto_antiga: datetime


def semear_cenario(
    sessao: Session,
    *,
    agora: datetime | None = None,
    texto: str = MARCA,
    com_definicoes: bool = True,
) -> Cenario:
    """Semeia o mundo armadilhado inteiro e devolve os instantes que usou.

    `texto` é o que marca tudo o que não pode sair. Por omissão é a
    `MARCA`; o teste do S-09 passa `TEXTO_PERIGOSO` para semear o mesmo
    mundo com aspas e `<script>` em todos os campos de texto.
    """
    from app.models.definicoes import Definicao
    from app.models.ementa import Categoria, Produto
    from app.models.eventos import Evento
    from app.models.fotos import EstadoFoto, Foto

    instante = (agora or datetime.now(UTC)).replace(microsecond=0)

    empatados = instante + timedelta(days=2)
    tardio = instante + timedelta(days=5)
    fotos_recentes = instante - timedelta(hours=1)
    foto_antiga = instante - timedelta(hours=2)

    categorias = [
        Categoria(
            id=ID_CAT_PETISCOS,
            nome=f"Petiscos {texto_de_item(texto, visivel=True)}",
            slug="petiscos-de-exemplo",
            ordem=0,
            visivel=True,
        ),
        Categoria(
            id=ID_CAT_SOBREMESAS,
            nome="Sobremesas de exemplo",
            slug="sobremesas-de-exemplo",
            ordem=5,
            visivel=True,
        ),
        Categoria(
            id=ID_CAT_BEBIDAS,
            nome="Bebidas de exemplo",
            slug="bebidas-de-exemplo",
            ordem=0,
            visivel=True,
        ),
        Categoria(
            id=ID_CAT_SO_INDISPONIVEIS,
            nome=f"Garrafeira {texto} de exemplo",
            slug="garrafeira-de-exemplo",
            ordem=0,
            visivel=True,
        ),
        Categoria(
            id=ID_CAT_INVISIVEL,
            nome=f"Secreta {texto} de exemplo",
            slug="secreta-de-exemplo",
            ordem=0,
            visivel=False,
        ),
        Categoria(
            id=ID_CAT_SEM_PRODUTOS,
            nome=f"Vazia {texto} de exemplo",
            slug="vazia-de-exemplo",
            ordem=0,
            visivel=True,
        ),
    ]
    sessao.add_all(categorias)
    sessao.flush()

    sessao.add_all(
        [
            Produto(
                id=ID_PROD_TREMOCOS,
                categoria_id=ID_CAT_PETISCOS,
                nome="Tremoços de exemplo",
                descricao=None,
                # Zero cêntimos é um preço legítimo (a F2-01 pôs o CHECK em
                # `>= 0` por causa da água de cortesia); aqui serve para
                # provar que o 0 sai como 0 e não some num `if preco:`.
                preco_cent=0,
                disponivel=True,
                ordem=2,
            ),
            Produto(
                id=ID_PROD_AGUA,
                categoria_id=ID_CAT_BEBIDAS,
                nome="Água de exemplo",
                descricao=None,
                preco_cent=80,
                disponivel=True,
                ordem=3,
            ),
            Produto(
                id=ID_PROD_VINHO,
                categoria_id=ID_CAT_BEBIDAS,
                nome=f"Vinho da casa {texto_de_item(texto, visivel=True)}",
                descricao=f"Tinto {texto_de_item(texto, visivel=True)}",
                preco_cent=250,
                disponivel=True,
                ordem=0,
            ),
            Produto(
                id=ID_PROD_IMPERIAL,
                categoria_id=ID_CAT_BEBIDAS,
                nome="Imperial de exemplo",
                descricao=None,
                preco_cent=150,
                disponivel=True,
                ordem=0,
            ),
            Produto(
                id=ID_PROD_LICOR,
                categoria_id=ID_CAT_BEBIDAS,
                nome=f"Licor {texto} de exemplo",
                descricao=f"Descrição {texto} de exemplo",
                preco_cent=400,
                disponivel=False,
                ordem=1,
            ),
            Produto(
                id=ID_PROD_TARTE,
                categoria_id=ID_CAT_SOBREMESAS,
                nome="Tarte de exemplo",
                descricao=None,
                preco_cent=320,
                disponivel=True,
                ordem=0,
            ),
            Produto(
                id=ID_PROD_SO_IND_A,
                categoria_id=ID_CAT_SO_INDISPONIVEIS,
                nome=f"Garrafa A {texto} de exemplo",
                descricao=None,
                preco_cent=1500,
                disponivel=False,
                ordem=0,
            ),
            Produto(
                id=ID_PROD_SO_IND_B,
                categoria_id=ID_CAT_SO_INDISPONIVEIS,
                nome=f"Garrafa B {texto} de exemplo",
                descricao=None,
                preco_cent=1800,
                disponivel=False,
                ordem=1,
            ),
            Produto(
                id=ID_PROD_INVISIVEL_A,
                categoria_id=ID_CAT_INVISIVEL,
                nome=f"Escondido A {texto} de exemplo",
                descricao=None,
                preco_cent=100,
                disponivel=True,
                ordem=0,
            ),
            Produto(
                id=ID_PROD_INVISIVEL_B,
                categoria_id=ID_CAT_INVISIVEL,
                nome=f"Escondido B {texto} de exemplo",
                descricao=None,
                preco_cent=200,
                disponivel=True,
                ordem=1,
            ),
        ]
    )

    sessao.add_all(
        [
            Evento(
                id=ID_EVT_KARAOKE,
                titulo="Karaoke de exemplo",
                inicio=empatados,
                descricao=None,
                imagem=None,
                publicado=True,
            ),
            Evento(
                id=ID_EVT_FADOS,
                titulo=f"Noite de fados {texto_de_item(texto, visivel=True)}",
                inicio=empatados,
                descricao=f"Com entrada livre {texto_de_item(texto, visivel=True)}",
                imagem="cartaz-de-exemplo.webp",
                publicado=True,
            ),
            Evento(
                id=ID_EVT_QUIZ,
                titulo="Quiz de exemplo",
                inicio=tardio,
                descricao=None,
                imagem=None,
                publicado=True,
            ),
            Evento(
                id=ID_EVT_PASSADO,
                titulo=f"Festa passada {texto} de exemplo",
                inicio=instante - timedelta(days=10),
                descricao=f"Descrição {texto} de exemplo",
                imagem=f"{MARCA}-passado.webp",
                publicado=True,
            ),
            Evento(
                id=ID_EVT_RASCUNHO,
                titulo=f"Rascunho {texto} de exemplo",
                inicio=instante + timedelta(days=3),
                descricao=f"Descrição {texto} de exemplo",
                imagem=f"{MARCA}-rascunho.webp",
                publicado=False,
            ),
            Evento(
                id=ID_EVT_SEM_DATA,
                titulo=f"Sem data {texto} de exemplo",
                inicio=None,
                descricao=f"Descrição {texto} de exemplo",
                imagem=None,
                publicado=False,
            ),
        ]
    )

    sessao.add_all(
        [
            Foto(
                id=ID_FOTO_RECENTE_B,
                ficheiro="00000000-0000-4000-8000-000000000300.webp",
                estado=EstadoFoto.APROVADA,
                descricao=f"Mesa cheia {texto_de_item(texto, visivel=True)}",
                enviada_por="Amiga de exemplo",
                ip_hash="hash-falso-de-ip-0000000000000003",
                criada_em=fotos_recentes,
                moderada_em=fotos_recentes,
            ),
            Foto(
                id=ID_FOTO_RECENTE_A,
                ficheiro="00000000-0000-4000-8000-000000000100.webp",
                estado=EstadoFoto.APROVADA,
                descricao=None,
                enviada_por=None,
                ip_hash="hash-falso-de-ip-0000000000000001",
                criada_em=fotos_recentes,
                moderada_em=fotos_recentes,
            ),
            Foto(
                id=ID_FOTO_ANTIGA,
                ficheiro="00000000-0000-4000-8000-000000000200.webp",
                estado=EstadoFoto.APROVADA,
                descricao=f"Esplanada {texto_de_item(texto, visivel=True)}",
                # A linha **sai** na galeria. A MARCA está aqui para provar
                # que o que está escondido é o campo, não a linha.
                enviada_por=f"Quem enviou {MARCA}",
                ip_hash=f"hash-{MARCA}",
                criada_em=foto_antiga,
                moderada_em=foto_antiga,
            ),
            Foto(
                id=ID_FOTO_PENDENTE,
                ficheiro=f"{MARCA}-pendente.webp",
                estado=EstadoFoto.PENDENTE,
                descricao=f"Pendente {texto} de exemplo",
                enviada_por=f"Quem enviou {texto}",
                ip_hash=f"hash-pendente-{MARCA}",
                criada_em=fotos_recentes,
                moderada_em=None,
            ),
            Foto(
                id=ID_FOTO_REJEITADA,
                ficheiro=f"{MARCA}-rejeitada.webp",
                estado=EstadoFoto.REJEITADA,
                descricao=f"Rejeitada {texto} de exemplo",
                enviada_por=f"Quem enviou {texto}",
                ip_hash=f"hash-rejeitada-{MARCA}",
                criada_em=fotos_recentes,
                moderada_em=fotos_recentes,
            ),
        ]
    )

    if com_definicoes:
        sessao.add_all(
            [
                Definicao(chave=chave, valor=valor)
                for chave, valor in DEFINICOES_FALSAS.items()
            ]
        )
        sessao.add(
            Definicao(
                chave=CHAVE_INTERNA_NAO_PUBLICADA,
                valor=f"nota interna {MARCA} de exemplo",
            )
        )

    sessao.commit()

    return Cenario(
        agora=instante,
        instante_dos_eventos_empatados=empatados,
        instante_do_evento_tardio=tardio,
        instante_das_fotos_recentes=fotos_recentes,
        instante_da_foto_antiga=foto_antiga,
    )


def texto_de_item(texto: str, *, visivel: bool) -> str:
    """O sufixo de um item que **aparece** nas respostas.

    Quando o cenário é semeado com a `MARCA`, os itens visíveis ficam só
    com "de exemplo" (a MARCA não pode entrar em lado nenhum que saia).
    Quando é semeado com o texto do S-09, os itens visíveis levam-no, que é
    precisamente o que esse teste quer ver sair igual.
    """
    return "de exemplo" if texto == MARCA else texto


def semear_definicoes(sessao: Session, valores: dict[str, str]) -> None:
    """Escreve só estas chaves em `definicoes`, e mais nada."""
    from app.models.definicoes import Definicao

    sessao.add_all(
        [Definicao(chave=chave, valor=valor) for chave, valor in valores.items()]
    )
    sessao.commit()
