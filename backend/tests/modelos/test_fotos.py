"""Fotos: estados, ficheiro único e a data que a base de dados põe (F2-01).

`docs/ESPECIFICACAO.md` fixa `estado` em (pendente, aprovada, rejeitada) e
`moderada_em` como opcional — uma foto por moderar ainda não tem data de
moderação, e isso não é um valor em falta, é o estado normal da fila.

O último teste é o que apanha a armadilha: o `criada_em` que a **base de
dados** põe tem de se reler como uma data válida em UTC. O `scripts/
importar_bd_antiga.py` (F2-08) e o `scripts/backup.py` (F2-02) escrevem por
SQL, sem ORM; se o valor por omissão vier num formato que o tipo de coluna
não sabe ler, a galeria rebenta ao ler a própria fila.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.modelos.apoio import IP_HASH_FALSO, nova_foto

ESTADOS_VALIDOS = ("pendente", "aprovada", "rejeitada")


def test_os_tres_estados_validos_sao_aceites(sessao: Session) -> None:
    """O guarda do teste seguinte testado contra o seu próprio sucesso falso."""
    for indice, estado in enumerate(ESTADOS_VALIDOS):
        sessao.add(
            nova_foto(
                ficheiro=f"00000000-0000-4000-8000-00000000000{indice}.webp",
                estado=estado,
            )
        )
    sessao.commit()

    quantas = sessao.execute(text("SELECT COUNT(*) FROM fotos")).scalar_one()
    assert quantas == len(ESTADOS_VALIDOS)


def test_estado_invalido_e_rejeitado(sessao: Session) -> None:
    """Escrito em SQL cru: é por aí que os scripts da F2-02 e da F2-08 escrevem.

    Um `Enum` do SQLAlchemy sem `create_constraint=True` não deixa `CHECK`
    nenhum no SQLite: valida só do lado do Python e a base de dados aceita
    `'banana'` sem pestanejar. Por isso o `INSERT` aqui não passa pelo ORM.
    """
    with pytest.raises(IntegrityError) as informacao:
        sessao.execute(
            text(
                "INSERT INTO fotos (ficheiro, estado, ip_hash) "
                "VALUES ('estado-invalido-de-exemplo.webp', 'banana', :ip)"
            ),
            {"ip": IP_HASH_FALSO},
        )
        sessao.commit()
    sessao.rollback()

    assert "check" in str(informacao.value).lower(), (
        "o estado 'banana' entrou (ou foi recusado por outro motivo): o "
        f"CHECK dos estados não existe na base de dados:\n{informacao.value}"
    )


def test_ficheiro_duplicado_e_rejeitado(sessao: Session) -> None:
    """Dois registos com o mesmo nome de ficheiro apontariam para a mesma imagem.

    Aprovar um e rejeitar o outro deixava um ficheiro em `MEDIA_DIR` com um
    registo a dizer que foi rejeitado.
    """
    sessao.add(nova_foto(ficheiro="repetida-de-exemplo.webp"))
    sessao.commit()

    sessao.add(nova_foto(ficheiro="repetida-de-exemplo.webp", estado="aprovada"))
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert "ficheiro" in str(informacao.value).lower(), (
        f"a restrição que disparou não foi a do ficheiro:\n{informacao.value}"
    )


def test_ip_hash_e_obrigatorio(sessao: Session) -> None:
    """Sem `ip_hash` não há limite de 5 envios por hora por IP (F2-06).

    Uma linha sem `ip_hash` é um envio que não conta para o limite — e um
    atacante que conseguisse gravar uma assim ficava sem limite nenhum.
    """
    with pytest.raises(IntegrityError) as informacao:
        sessao.execute(
            text(
                "INSERT INTO fotos (ficheiro, estado) "
                "VALUES ('sem-ip-de-exemplo.webp', 'pendente')"
            )
        )
        sessao.commit()
    sessao.rollback()

    assert "not null" in str(informacao.value).lower(), (
        f"`fotos.ip_hash` aceita NULL:\n{informacao.value}"
    )


def test_moderada_em_nasce_vazia(sessao: Session) -> None:
    """Uma foto por moderar não tem data de moderação, e isso é o estado normal."""
    foto = nova_foto()
    sessao.add(foto)
    sessao.commit()

    guardado = sessao.execute(text("SELECT moderada_em FROM fotos")).scalar_one()
    assert guardado is None


def test_insert_cru_sem_criada_em_rele_se_como_data_valida(sessao: Session) -> None:
    """Um `INSERT` sem `criada_em` tem de deixar lá uma data que se consegue reler.

    Duas coisas de uma vez, e a segunda é a armadilha:

    1. `criada_em` tem um valor por omissão **do lado da base de dados** —
       um `INSERT` em SQL cru, sem ORM, não a deixa a NULL.
    2. O formato que o SQLite escreve nesse valor por omissão
       (`CURRENT_TIMESTAMP` dá `2026-10-27 12:34:56`, sem fuso e sem frações
       de segundo) tem de ser legível pelo tipo da coluna, que devolve
       sempre instantes com fuso em UTC. Um `DataHoraUTC` que só saiba ler
       o que ele próprio escreveu rebenta aqui, e só aqui.
    """
    from app.models.fotos import Foto

    antes = datetime.now(UTC)
    sessao.execute(
        text(
            "INSERT INTO fotos (ficheiro, estado, ip_hash) "
            "VALUES ('sem-criada-em-de-exemplo.webp', 'pendente', :ip)"
        ),
        {"ip": IP_HASH_FALSO},
    )
    sessao.commit()
    sessao.expire_all()

    foto = sessao.execute(select(Foto)).scalar_one()

    assert foto.criada_em is not None, (
        "`fotos.criada_em` ficou a NULL num INSERT que não a passou: falta "
        "um valor por omissão do lado da base de dados (`server_default`). "
        "Um `default=` só do lado do Python não corre em SQL cru"
    )
    assert foto.criada_em.tzinfo is not None, (
        f"`criada_em` releu-se sem fuso: {foto.criada_em!r}"
    )
    assert foto.criada_em.utcoffset() == timedelta(0), (
        f"`criada_em` releu-se fora de UTC: {foto.criada_em!r}"
    )

    depois = datetime.now(UTC)
    # Margem generosa (um minuto para trás) porque o relógio do SQLite e o
    # do Python podem arredondar o segundo de forma diferente; o que se
    # quer apanhar é um valor absurdo (1970, 2000-01-01, o ano errado),
    # não uma diferença de milissegundos.
    assert (
        antes - timedelta(minutes=1) <= foto.criada_em <= depois + timedelta(minutes=1)
    ), (
        f"`criada_em` releu-se como {foto.criada_em!r}, fora do intervalo "
        f"[{antes}, {depois}] em que o INSERT correu"
    )


#: Nomes de ficheiro que não são nomes de ficheiro: trazem um separador de
#: caminho ou um `..`. Quem lê `fotos.ficheiro` junta-o a
#: `DATA_DIR/pendentes` ou a `public_html/media`; um destes valores faz essa
#: junção sair da pasta.
FICHEIROS_COM_CAMINHO = (
    "../fora-de-exemplo.webp",
    "pasta/dentro-de-exemplo.webp",
    "pasta\\dentro-de-exemplo.webp",
    "/absoluto-de-exemplo.webp",
    # Sem separador nenhum: apanha uma implementação que só procure `/` e
    # `\` e deixe passar o `..`, que basta para subir uma pasta quando o
    # nome é concatenado sem normalização.
    "..oculto-de-exemplo.webp",
)

RESTRICAO_FICHEIRO = "ck_fotos_ficheiro_sem_caminho"


@pytest.mark.parametrize("ficheiro", FICHEIROS_COM_CAMINHO)
def test_ficheiro_com_caminho_e_rejeitado(sessao: Session, ficheiro: str) -> None:
    """A base de dados recusa um `ficheiro` que não seja só um nome.

    A defesa principal é da fronteira — a F2-06 ignora o nome que o cliente
    manda e gera um nome aleatório. Mas um `CHECK` não se acrescenta a uma
    tabela que já existe sem a reconstruir (regra 7), e a F2-08 escreve
    direto, sem passar pela API.

    Exige o nome da restrição na mensagem: é isso que prova que foi a base
    de dados a recusar, e não um validador do lado do Python que um script
    contornaria por escrever em SQL cru.
    """
    sessao.add(nova_foto(ficheiro=ficheiro))
    with pytest.raises(IntegrityError) as informacao:
        sessao.commit()
    sessao.rollback()

    assert RESTRICAO_FICHEIRO in str(informacao.value), (
        f"{ficheiro!r} foi recusado, mas não por {RESTRICAO_FICHEIRO}:"
        f"\n{informacao.value}"
    )


def test_ficheiro_sem_caminho_e_aceite(sessao: Session) -> None:
    """O guarda de cima testado contra o seu próprio sucesso falso.

    Um `CHECK` com a condição ao contrário recusava **todos** os nomes e
    deixava os testes acima verdes, com a galeria impossível de usar. Um
    `uuid.webp`, que é o que a F2-06 gera, tem de entrar.
    """
    sessao.add(nova_foto(ficheiro="00000000-0000-4000-8000-00000000000a.webp"))
    sessao.commit()

    quantas = sessao.execute(text("SELECT COUNT(*) FROM fotos")).scalar_one()
    assert quantas == 1
