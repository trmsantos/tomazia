"""Os corpos das quatro respostas públicas de leitura.

São o contrato: a F2-09 gera TypeScript a partir deles, e a partir daí
mudar um nome de campo mexe em todos os ecrãs. Daí três opções que não
são arrumação:

- **envelope nomeado** (`{"categorias": [...]}`), nunca um array no topo:
  um array no topo não se consegue estender sem partir o que está
  gerado;
- **a ementa vem aninhada**, com os produtos dentro da categoria, porque
  é assim que o ecrã a mostra — um cartão por categoria;
- **sai o que o público vê, e mais nada**. `ordem` não é campo (a ordem
  está na posição), `publicado` não é campo (quem vê a lista já sabe), e
  `ip_hash`, `enviada_por`, `estado`, `criada_em` e `moderada_em` de uma
  foto ficam de fora: o `ip_hash` é o que limita cinco envios por hora
  por IP (F2-06) e publicá-lo entregava a lista de hashes a comparar.

O horário segue a forma do ADR 0011, e os modelos que o descrevem são
**os mesmos** que a F2-05 vai usar para o validar na escrita: um só
validador, para a escrita não aceitar uma forma que a leitura publica
de outra maneira.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

# --------------------------------------------------------------------------
# Ementa
# --------------------------------------------------------------------------


class ProdutoPublico(BaseModel):
    """Uma linha da ementa. Preço em cêntimos (`int`), nunca em euros."""

    id: int
    nome: str
    #: Opcional: sai `null`, nunca `""` e nunca a chave em falta.
    descricao: str | None
    #: Zero é um preço legítimo (a água de cortesia), por isso nada neste
    #: caminho pode tratar o 0 como "sem preço".
    preco_cent: int


class CategoriaPublica(BaseModel):
    """Um cartão da ementa, com os produtos disponíveis lá dentro."""

    id: int
    nome: str
    slug: str
    produtos: list[ProdutoPublico]


class RespostaEmenta(BaseModel):
    """Corpo de `GET /ementa`."""

    categorias: list[CategoriaPublica]


# --------------------------------------------------------------------------
# Eventos
# --------------------------------------------------------------------------


class EventoPublico(BaseModel):
    """Um evento publicado, a partir de hoje.

    `inicio` é **não anulável**, ao contrário da coluna: um rascunho pode
    não ter data (ADR 0009), mas um evento sem data nunca está publicado
    — o `CHECK` da F2-01 garante-o — e esta lista só traz publicados. É o
    que poupa ao frontend um `if (evento.inicio)` em cada ecrã.

    O instante sai em UTC, com fuso explícito, tal como está guardado. A
    conversão para hora de Lisboa é da apresentação (F3-04).
    """

    id: int
    titulo: str
    inicio: datetime
    descricao: str | None
    #: Nome de ficheiro, nunca um caminho: quem o lê é que decide a pasta.
    imagem: str | None


class RespostaEventos(BaseModel):
    """Corpo de `GET /eventos`."""

    eventos: list[EventoPublico]


# --------------------------------------------------------------------------
# Galeria
# --------------------------------------------------------------------------


class FotoPublica(BaseModel):
    """Uma foto aprovada: o ficheiro e a legenda, e mais nada."""

    id: int
    #: Nome de ficheiro, nunca um caminho (`CHECK` da F2-01).
    ficheiro: str
    descricao: str | None


class RespostaGaleria(BaseModel):
    """Corpo de `GET /galeria`."""

    fotos: list[FotoPublica]


# --------------------------------------------------------------------------
# Informações do bar (ADR 0011)
# --------------------------------------------------------------------------

#: Os sete dias, por esta ordem, sem acentos: são identificadores, não
#: rótulos. O texto visível ("Terça-feira") é do frontend.
DiaDaSemana = Literal[
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
    "domingo",
]

#: Derivado do `Literal`, nunca escrito a par dele: a ordem da semana e o
#: conjunto de dias aceites são a mesma decisão (ADR 0011), e duas listas
#: escritas à mão divergiam no dia em que alguém mexesse só numa.
DIAS_DA_SEMANA: tuple[DiaDaSemana, ...] = get_args(DiaDaSemana)

#: `HH:MM` em 24 horas. Recusa `25:00` e `7:30`, que não são horas de
#: relógio escritas como as do resto do ficheiro.
PADRAO_HORA = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"

HoraDeRelogio = Annotated[str, Field(pattern=PADRAO_HORA)]


class PeriodoDoHorario(BaseModel):
    """Um intervalo de um dia, em hora de relógio de `Europe/Lisbon`.

    Nunca instantes e nunca UTC: um horário é hora de parede — "fecha às
    02:00" continua a ser 02:00 na semana a seguir à mudança da hora.

    `fecha < abre` quer dizer que fecha no dia seguinte (`17:00`–`02:00`
    é a noite inteira), e é o caso normal deste bar.
    """

    model_config = ConfigDict(extra="forbid")

    abre: HoraDeRelogio
    fecha: HoraDeRelogio

    @model_validator(mode="after")
    def _recusar_periodo_de_duracao_nula(self) -> PeriodoDoHorario:
        if self.abre == self.fecha:
            raise ValueError(
                "Um período não pode abrir e fechar à mesma hora: "
                f"{self.abre} não diz se o bar está aberto zero minutos "
                "ou vinte e quatro horas."
            )
        return self


class DiaDoHorario(BaseModel):
    """Um dia da semana e os seus períodos.

    **Lista vazia de períodos = fechado nesse dia.** Não há campo
    `fechado`: duas fontes de verdade para a mesma pergunta acabam
    sempre por discordar.
    """

    model_config = ConfigDict(extra="forbid")

    dia: DiaDaSemana
    periodos: list[PeriodoDoHorario]


#: O validador do horário inteiro. É este adaptador que a F2-05 reusa na
#: escrita de `PUT /gestao/definicoes`.
ADAPTADOR_DO_HORARIO: TypeAdapter[list[DiaDoHorario]] = TypeAdapter(list[DiaDoHorario])


def interpretar_horario(valor: str) -> list[DiaDoHorario]:
    """Lê o JSON guardado em `definicoes.horario` e devolve os sete dias.

    Normaliza, como manda o ADR 0011: a lista sai sempre com os sete
    dias, de segunda a domingo, e os que faltarem no valor guardado saem
    com `periodos: []`.

    Levanta `json.JSONDecodeError` se o valor não for JSON e
    `pydantic.ValidationError` se for JSON mas não for esta forma. Quem
    chama é que decide o que fazer com isso — em `GET /info` é um
    `horario: null` com um erro no log, porque um horário mal escrito
    não pode levar atrás o WiFi e a morada, que estão no mesmo ecrã.

    Dias repetidos no valor guardado ficam pelo último: o ADR 0011 não
    diz o que fazer com eles, e inventar aqui uma regra que ninguém
    decidiu era pior do que ser previsível.
    """
    dias = ADAPTADOR_DO_HORARIO.validate_python(json.loads(valor))
    por_dia = {dia.dia: dia for dia in dias}
    return [
        por_dia.get(nome, DiaDoHorario(dia=nome, periodos=[]))
        for nome in DIAS_DA_SEMANA
    ]


class WifiPublico(BaseModel):
    """Rede e password do WiFi, as duas juntas porque a folha as mostra juntas.

    **A password sai em texto para qualquer pessoa na internet.** Vem da
    especificação (é o ecrã do QR code na mesa) e está decidida no ADR
    0011, depois de ao Tomás ser dito que fica legível por quem nunca
    entrou no bar e indexável por motores de busca. Não é descuido: se
    mudar, muda o ADR.
    """

    rede: str | None
    password: str | None


class RespostaInfo(BaseModel):
    """Corpo de `GET /info`.

    Os escalares são `string | null`: `""` e só espaços saem a `null`,
    porque `definicoes.valor` é `NOT NULL` e é com `""` que a ausência se
    diz na base de dados — mas um `""` que chegasse ao frontend dava um
    telefone em branco, com ícone e tudo, no ecrã "Visita-nos".

    `wifi` é sempre um objeto, mesmo numa instalação acabada de criar: um
    `wifi: null` obrigava o frontend a um caminho alternativo só para
    esse caso.

    `horario` a `null` quer dizer **nunca configurado** — não quer dizer
    fechado. Sete dias com `periodos: []` é "configurado e fechado toda a
    semana", uma afirmação sobre o bar que só o dono pode fazer.
    """

    wifi: WifiPublico
    morada: str | None
    telefone: str | None
    instagram: str | None
    maps_url: str | None
    horario: list[DiaDoHorario] | None
