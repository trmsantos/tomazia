"""Os corpos da gestão da ementa (`/gestao/categorias`, `/gestao/produtos`).

- Os pedidos recusam campos desconhecidos (`extra="forbid"`): `id`, `ordem`
  ou `slug` no corpo são um `422`, nunca ignorados em silêncio.
- O texto guarda-se tal como foi escrito (nunca escape HTML); só se apara
  o espaço das pontas. Os comprimentos máximos são os das colunas, validados
  aqui porque o SQLite não impõe `String(n)`.
- Inteiros com limites: um número acima de `2**63-1` rebentava o driver.
- Nos `PATCH`, "ausente" e `null` são coisas diferentes (lê-se o
  `model_fields_set`). `null` só vale para a `descricao`; nos outros campos
  é um `422` com o nome do campo.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
)
from pydantic.json_schema import SkipJsonSchema

from app.dependencias import MAIOR_INTEIRO_DO_SQLITE
from app.schemas.publico import DIAS_DA_SEMANA, DiaDoHorario

NomeDaCategoria = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]
NomeDoProduto = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
DescricaoDoProduto = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=280)
]
IdNoCorpo = Annotated[int, Field(strict=True, ge=1, le=MAIOR_INTEIRO_DO_SQLITE)]
#: Cêntimos. O teto é o de um inteiro de 32 bits: muito acima de qualquer preço.
PrecoEmCentimos = Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]

#: O `UPDATE ... CASE` da reordenação liga 3 parâmetros por id (`WHEN`,
#: `THEN` e `IN`), mais um filtro nos produtos: 300 ids são 901, abaixo dos
#: 999 que o SQLite aceitava antes da 3.32 (a versão do servidor não é
#: conhecida). Mais do que isto numa lista de ordem não é uma ementa.
MAXIMO_DE_IDS_NA_ORDEM = 300


class _Corpo(BaseModel):
    model_config = ConfigDict(extra="forbid")


TituloDoEvento = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
DescricaoDoEvento = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=1000)
]

#: Margem para que o `inicio` caiba em UTC e para o duplicar somar semanas
#: sem sair do intervalo de um `datetime`.
ANO_MINIMO_DO_EVENTO = 1970
ANO_MAXIMO_DO_EVENTO = 9000


def _inicio_so_em_texto(valor: Any) -> Any:
    """Um `inicio` tem de ser texto ISO 8601, lido por `datetime.fromisoformat`.

    Nem um inteiro JSON nem um texto só com algarismos (`"1700000000"`,
    `"253402300800"`): o Pydantic leria ambos como timestamp, em segundos ou
    em milissegundos. O `fromisoformat` recusa-os; o fuso horário exige-o
    depois o `AwareDatetime`.
    """
    if not isinstance(valor, str):
        raise ValueError("a data tem de ser um texto ISO 8601 com fuso horário")
    try:
        return datetime.fromisoformat(valor)
    except ValueError as erro:
        raise ValueError(
            "a data tem de ser um texto ISO 8601 com fuso horário"
        ) from erro


def _inicio_dentro_dos_limites(valor: datetime) -> datetime:
    try:
        em_utc = valor.astimezone(UTC)
    except OverflowError as erro:
        raise ValueError("a data não cabe no intervalo suportado") from erro
    if not ANO_MINIMO_DO_EVENTO <= em_utc.year <= ANO_MAXIMO_DO_EVENTO:
        raise ValueError("a data está fora do intervalo suportado")
    return valor


def _descricao_vazia_e_nula(valor: str | None) -> str | None:
    return valor or None


# --------------------------------------------------------------------------
# Respostas
# --------------------------------------------------------------------------


class ProdutoGestao(BaseModel):
    id: int
    categoria_id: int
    nome: str
    descricao: str | None
    preco_cent: int
    disponivel: bool


class CategoriaGestao(BaseModel):
    id: int
    nome: str
    slug: str
    visivel: bool
    produtos: list[ProdutoGestao]


class RespostaEmentaGestao(BaseModel):
    """Corpo de `GET /gestao/categorias`: tudo, incluindo o que está escondido."""

    categorias: list[CategoriaGestao]


# --------------------------------------------------------------------------
# Pedidos
# --------------------------------------------------------------------------


class PedidoCriarCategoria(_Corpo):
    nome: NomeDaCategoria
    visivel: StrictBool = True


class PedidoAlterarCategoria(_Corpo):
    """Só se altera o que vem no corpo. O `slug` nunca muda."""

    nome: NomeDaCategoria | SkipJsonSchema[None] = None
    visivel: StrictBool | SkipJsonSchema[None] = None

    @field_validator("nome", "visivel", mode="before")
    @classmethod
    def _null_nao_e_ausente(cls, valor: Any) -> Any:
        if valor is None:
            raise ValueError("este campo não aceita null")
        return valor


class PedidoCriarProduto(_Corpo):
    categoria_id: IdNoCorpo
    nome: NomeDoProduto
    descricao: DescricaoDoProduto | None = None
    preco_cent: PrecoEmCentimos
    disponivel: StrictBool = True

    @field_validator("descricao")
    @classmethod
    def _descricao_vazia(cls, valor: str | None) -> str | None:
        return _descricao_vazia_e_nula(valor)


class PedidoAlterarProduto(_Corpo):
    """`PATCH` com valores absolutos: preço e disponibilidade nunca alternam."""

    # `SkipJsonSchema[None]`: o validador abaixo recusa `null`, e o esquema
    # não deve prometer o contrário. Só a `descricao` admite `null`.
    categoria_id: IdNoCorpo | SkipJsonSchema[None] = None
    nome: NomeDoProduto | SkipJsonSchema[None] = None
    descricao: DescricaoDoProduto | None = None
    preco_cent: PrecoEmCentimos | SkipJsonSchema[None] = None
    disponivel: StrictBool | SkipJsonSchema[None] = None

    @field_validator("categoria_id", "nome", "preco_cent", "disponivel", mode="before")
    @classmethod
    def _null_nao_e_ausente(cls, valor: Any) -> Any:
        if valor is None:
            raise ValueError("este campo não aceita null")
        return valor

    @field_validator("descricao")
    @classmethod
    def _descricao_vazia(cls, valor: str | None) -> str | None:
        return _descricao_vazia_e_nula(valor)


class PedidoOrdem(_Corpo):
    """A lista completa de ids, na ordem pretendida, sem repetidos."""

    ids: Annotated[list[IdNoCorpo], Field(max_length=MAXIMO_DE_IDS_NA_ORDEM)]

    @field_validator("ids")
    @classmethod
    def _sem_repetidos(cls, valor: list[int]) -> list[int]:
        if len(set(valor)) != len(valor):
            raise ValueError("há ids repetidos")
        return valor


# --------------------------------------------------------------------------
# Eventos
# --------------------------------------------------------------------------


class EventoGestao(BaseModel):
    id: int
    titulo: str
    #: `null` num rascunho importado sem data (ADR 0009).
    inicio: datetime | None
    descricao: str | None
    #: Só se lê: não há upload de imagens de eventos.
    imagem: str | None
    publicado: bool


class RespostaEventosGestao(BaseModel):
    """Corpo de `GET /gestao/eventos`.

    As três listas calculam-se no servidor com o corte do dia do bar
    (meia-noite de Lisboa, ADR 0010), o mesmo do `/eventos` público.
    """

    #: Publicados com `inicio` a partir do corte, do mais próximo ao mais longe.
    proximos: list[EventoGestao]
    #: Não publicados, com ou sem data; os sem data no fim.
    rascunhos: list[EventoGestao]
    #: Publicados antes do corte, do mais recente ao mais antigo.
    arquivo: list[EventoGestao]


class PedidoCriarEvento(_Corpo):
    titulo: TituloDoEvento
    #: Obrigatória (ADR 0009), com fuso horário.
    inicio: AwareDatetime
    descricao: DescricaoDoEvento | None = None
    publicado: StrictBool = False

    @field_validator("inicio", mode="before")
    @classmethod
    def _so_texto(cls, valor: Any) -> Any:
        return _inicio_so_em_texto(valor)

    @field_validator("inicio")
    @classmethod
    def _limites(cls, valor: datetime) -> datetime:
        return _inicio_dentro_dos_limites(valor)

    @field_validator("descricao")
    @classmethod
    def _descricao_vazia(cls, valor: str | None) -> str | None:
        return _descricao_vazia_e_nula(valor)


class PedidoDuplicarEvento(_Corpo):
    """`semanas = n` é a n-ésima data livre da série semanal do original.

    Num original sem data é validado e ignorado.
    """

    semanas: Annotated[StrictInt, Field(ge=1, le=4)] = 1


class PedidoAlterarEvento(_Corpo):
    """Só se altera o que vem no corpo. `null` só vale para a `descricao`.

    Não se apaga uma data: um `inicio: null` é um `422`. Publicar um evento
    sem data é um `422 evento_sem_data`.
    """

    titulo: TituloDoEvento | SkipJsonSchema[None] = None
    inicio: AwareDatetime | SkipJsonSchema[None] = None
    descricao: DescricaoDoEvento | None = None
    publicado: StrictBool | SkipJsonSchema[None] = None

    @field_validator("titulo", "inicio", "publicado", mode="before")
    @classmethod
    def _null_nao_e_ausente(cls, valor: Any) -> Any:
        if valor is None:
            raise ValueError("este campo não aceita null")
        return valor

    @field_validator("inicio", mode="before")
    @classmethod
    def _so_texto(cls, valor: Any) -> Any:
        return _inicio_so_em_texto(valor)

    @field_validator("inicio")
    @classmethod
    def _limites(cls, valor: datetime) -> datetime:
        return _inicio_dentro_dos_limites(valor)

    @field_validator("descricao")
    @classmethod
    def _descricao_vazia(cls, valor: str | None) -> str | None:
        return _descricao_vazia_e_nula(valor)


class RespostaResumo(BaseModel):
    """Corpo de `GET /gestao/resumo`: o ecrã de início da gestão."""

    #: As fotos no estado pendente: as mesmas de `GET /gestao/fotos`.
    fotos_pendentes: int
    #: Os três primeiros de `proximos` em `GET /gestao/eventos`.
    proximos_eventos: list[EventoGestao]
    novos_registos: int = Field(
        description=(
            "Clientes registados nos últimos 7 dias: `criado_em` a partir de "
            "agora menos 7 x 24 horas (janela deslizante, limite inclusivo)."
        )
    )


# --------------------------------------------------------------------------
# Definições do bar (ADR 0011)
# --------------------------------------------------------------------------

#: Texto de uma linha (a coluna `valor` é `Text`: o limite é da fronteira).
LIMITE_DO_TEXTO_DE_UMA_LINHA = 200
LIMITE_DO_ENDERECO = 500
MAXIMO_DE_PERIODOS_POR_DIA = 6

ANFITRIOES_DO_INSTAGRAM = frozenset({"instagram.com", "www.instagram.com"})

#: Valores que `GET /gestao/definicoes` dá ao horário (ADR 0011): a gestão
#: distingue o que o `/info` público junta em `null`.
EstadoDoHorario = Literal["configurado", "nao_configurado", "invalido"]


def _anfitriao_de_https(valor: str, so_estes: frozenset[str] | None) -> str:
    """`https://` ou vazio; nada à frente; sem caracteres de controlo.

    O F3-06 põe estes valores num `href` público, e o React **não** bloqueia
    `javascript:` num `href`: a defesa é recusar tudo o que não seja
    `https://` na escrita (a leitura devolve o texto tal como está, S-09).
    O esquema compara-se sem distinguir maiúsculas, mas o valor tem de
    **começar** por ele: um espaço ou uma tabulação à frente é recusado.
    """
    if valor == "":
        return valor
    if any(ord(c) <= 32 or ord(c) == 127 for c in valor):
        raise ValueError("o endereço não pode ter espaços nem caracteres de controlo")
    if not valor[:8].lower() == "https://":
        raise ValueError("o endereço tem de começar por https://")
    try:
        partes = urlsplit(valor)
        anfitriao = (partes.hostname or "").lower()
    except ValueError as erro:
        raise ValueError("o endereço não é válido") from erro
    if not anfitriao or "@" in partes.netloc:
        raise ValueError("o endereço tem de ter um anfitrião, sem utilizador")
    if so_estes is not None and partes.netloc.lower() not in so_estes:
        raise ValueError("o anfitrião não é um dos permitidos")
    return valor


def _maps_url(valor: str) -> str:
    return _anfitriao_de_https(valor, None)


def _instagram(valor: str) -> str:
    return _anfitriao_de_https(valor, ANFITRIOES_DO_INSTAGRAM)


def _sem_quebras_de_linha(valor: str) -> str:
    if "\r" in valor or "\n" in valor:
        raise ValueError("este campo é de uma só linha")
    return valor


#: Não se apara (ao contrário do `nome` ou do `titulo`): uma rede ou uma
#: password de WiFi pode ter espaços nas pontas, e aparar guardava uma
#: password que já não condiz com a rede.
TextoDeUmaLinha = Annotated[
    str,
    StringConstraints(max_length=LIMITE_DO_TEXTO_DE_UMA_LINHA),
    AfterValidator(_sem_quebras_de_linha),
]
EnderecoMaps = Annotated[
    str, StringConstraints(max_length=LIMITE_DO_ENDERECO), AfterValidator(_maps_url)
]
EnderecoInstagram = Annotated[
    str, StringConstraints(max_length=LIMITE_DO_ENDERECO), AfterValidator(_instagram)
]


def _minutos(hora: str) -> int:
    return int(hora[:2]) * 60 + int(hora[3:])


def _validar_horario_na_escrita(dias: list[DiaDoHorario]) -> list[DiaDoHorario]:
    """Mais estrito que a leitura: sete dias, uma vez cada, sem períodos sobrepostos.

    Reutiliza `DiaDoHorario` (ADR 0011: um só validador para o formato). Os
    períodos medem-se na linha do dia: `fecha < abre` soma 24 horas.
    """
    nomes = [d.dia for d in dias]
    if len(dias) != len(DIAS_DA_SEMANA) or set(nomes) != set(DIAS_DA_SEMANA):
        raise ValueError("o horário tem de ter os sete dias, cada um uma vez")
    for dia in dias:
        if len(dia.periodos) > MAXIMO_DE_PERIODOS_POR_DIA:
            raise ValueError("demasiados períodos num dia")
        intervalos = sorted(
            (
                _minutos(p.abre),
                _minutos(p.fecha)
                + (1440 if _minutos(p.fecha) < _minutos(p.abre) else 0),
            )
            for p in dia.periodos
        )
        for (_, fim), (inicio_seguinte, _) in zip(
            intervalos, intervalos[1:], strict=False
        ):
            if inicio_seguinte < fim:
                raise ValueError("há períodos sobrepostos no mesmo dia")
    return sorted(dias, key=lambda d: DIAS_DA_SEMANA.index(d.dia))


class DefinicoesGestao(BaseModel):
    """Corpo de `GET` e `PUT /gestao/definicoes`.

    Texto vazio sai como `""` (como a BD diz "não há"); o `/info` público
    dá-lhe `null`.
    """

    wifi_rede: str
    wifi_password: str
    morada: str
    telefone: str
    instagram: str
    maps_url: str
    horario: list[DiaDoHorario] | None
    horario_estado: EstadoDoHorario


class PedidoDefinicoes(_Corpo):
    """`PUT` substitui os sete campos numa só transação.

    `horario: null` = "não configurado" e apaga a chave. Os sete são
    obrigatórios: um campo em falta não pode apagar o que lá estava.
    """

    wifi_rede: TextoDeUmaLinha
    wifi_password: TextoDeUmaLinha
    morada: TextoDeUmaLinha
    telefone: TextoDeUmaLinha
    instagram: EnderecoInstagram
    maps_url: EnderecoMaps
    horario: list[DiaDoHorario] | None

    @field_validator("horario")
    @classmethod
    def _horario_completo(
        cls, valor: list[DiaDoHorario] | None
    ) -> list[DiaDoHorario] | None:
        if valor is None:
            return None
        return _validar_horario_na_escrita(valor)


# --------------------------------------------------------------------------
# Clientes
# --------------------------------------------------------------------------


class ClienteGestao(BaseModel):
    """Um cliente inscrito. **Nunca** o `token_cancelar`: é uma credencial."""

    id: int
    nome: str
    email: str
    telemovel: str | None
    consentimento_em: datetime
    versao_termos: str
    criado_em: datetime


class RespostaClientes(BaseModel):
    """Corpo de `GET /gestao/clientes`, do mais recente para o mais antigo."""

    clientes: list[ClienteGestao]


# --------------------------------------------------------------------------
# Mudar a password
# --------------------------------------------------------------------------

#: O teto limita o custo do argon2 que um pedido pode obrigar a pagar.
MAXIMO_DA_PASSWORD = 1024


class PedidoMudarPassword(_Corpo):
    """Muda a password de **quem tem a sessão**: nunca leva `utilizador`."""

    password_atual: Annotated[
        str, StringConstraints(min_length=1, max_length=MAXIMO_DA_PASSWORD)
    ]
    password_nova: Annotated[
        str, StringConstraints(min_length=1, max_length=MAXIMO_DA_PASSWORD)
    ]
