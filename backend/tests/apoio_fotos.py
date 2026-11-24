"""Fábricas de imagens falsas e apoio HTTP para a bateria de fotos (F2-06).

Não é um ficheiro de testes (não começa por `test_`), pela mesma razão que
`tests/apoio_auth.py` e `tests/apoio_publico.py` não são: é importado
diretamente pelos ficheiros de `tests/seguranca/` e `tests/fotos/` que
precisam destas fábricas. Ao contrário de `apoio_auth.py`/`apoio_http.py`,
nada aqui é uma `@pytest.fixture` — são funções simples, chamadas dentro
dos testes — por isso não há nenhum `conftest.py` a registar nada vindo
deste módulo.

Todos os valores são claramente falsos: os IPs vêm de `203.0.113.0/24`,
`198.51.100.0/24` e `192.0.2.0/24` (TEST-NET-1/2/3, reservados pela RFC
5737, nunca roteáveis), as credenciais são as de `tests/apoio_auth.py`.
Nenhuma imagem aqui é uma fotografia do Bar da Tomazia.

## Dois pontos de extensão que este ficheiro pressupõe

1. **O nome do campo do multipart.** `docs/ESPECIFICACAO.md` fixa que o
   nome e o `Content-Type` do cliente são ignorados por completo, mas não
   fixa o nome do *campo* do formulário. Escolhido aqui (`CAMPO_FICHEIRO`,
   `CAMPO_DESCRICAO`, `CAMPO_ENVIADA_POR`) para os dois lados nunca
   divergirem; `CAMPO_ISCO` (`"website"`) é o único fixado pelo enunciado
   da tarefa, não uma escolha deste ficheiro.
2. **O relógio do envio/moderação de fotos é `agora_utc`, chamado pelo
   nome do módulo** (`from app.models.tipos import agora_utc`), no mesmo
   padrão de `tests/apoio_auth.py::fixar_relogio_auth` e
   `tests/apoio_publico.py::fixar_relogio`. Qual módulo o importa ainda
   não está decidido por nenhum plano lido por este ficheiro — por isso
   `fixar_relogio_fotos` varre uma lista generosa de candidatos
   (`MODULOS_COM_RELOGIO_FOTOS`) e rebenta em voz alta se nenhum tiver o
   nome, em vez de assumir silenciosamente qual é.

## As imagens-bomba

`png_bomba_de_pixels` e `png_bomba_na_zona_cinzenta` não nascem do Pillow:
são construídas byte a byte (`IHDR` com as dimensões mentirosas, `IDAT`
com um `zlib.compress(b"")` que não decodifica nada a sério, `IEND`) para
pesarem ~65 bytes em disco. `Image.open()` lê o `IHDR` e fica a saber o
tamanho sem nunca ter de decodificar o `IDAT` — é o que permite recusar a
bomba antes de alocar o bitmap (medido em Pillow 13.0.0; ver o plano desta
tarefa). `load()` é que descomprime, e é isso que um guarda tem de evitar.
"""

from __future__ import annotations

import io
import struct
import zlib
from typing import TYPE_CHECKING

from PIL import Image

from tests.apoio_publico import RelogioFixo

if TYPE_CHECKING:  # pragma: no cover - só para anotações
    from datetime import datetime

    import httpx
    import pytest
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

# --------------------------------------------------------------------------
# O contrato de `POST /fotos`, assumido por esta bateria.
# --------------------------------------------------------------------------

#: O nome do campo do multipart que leva os bytes da foto. Não fixado em
#: `docs/ESPECIFICACAO.md` — só que o nome e o `Content-Type` do cliente
#: são ignorados. Escolhido aqui para os dois lados nunca divergirem.
CAMPO_FICHEIRO = "ficheiro"
CAMPO_DESCRICAO = "descricao"
CAMPO_ENVIADA_POR = "enviada_por"

#: Fixado pelo enunciado da tarefa (não uma escolha deste ficheiro): o
#: campo escondido contra bots. Um formulário normal deixa-o vazio.
CAMPO_ISCO = "website"

#: Conteúdo de um ficheiro que nunca é uma imagem, para o S-01 e para os
#: testes de "nome/Content-Type ignorados" do contrato geral.
CARGA_PHP = b"<?php system($_GET['cmd']); ?>\n"

# --------------------------------------------------------------------------
# IPs claramente falsos (RFC 5737): nunca roteáveis, nunca reais.
# --------------------------------------------------------------------------

IP_TEST_NET_1 = "192.0.2.0"
IP_TEST_NET_2 = "198.51.100.0"
IP_TEST_NET_3 = "203.0.113.0"


# --------------------------------------------------------------------------
# Fábricas de imagens.
# --------------------------------------------------------------------------


def jpeg_valido(
    largura: int = 40, altura: int = 30, cor: tuple[int, int, int] = (200, 50, 50)
) -> bytes:
    """Um JPEG pequeno e genuíno, sem EXIF nenhum."""
    buffer = io.BytesIO()
    Image.new("RGB", (largura, altura), cor).save(buffer, format="JPEG")
    return buffer.getvalue()


def png_valido(
    largura: int = 40, altura: int = 30, cor: tuple[int, int, int] = (30, 60, 90)
) -> bytes:
    """Um PNG pequeno e genuíno."""
    buffer = io.BytesIO()
    Image.new("RGB", (largura, altura), cor).save(buffer, format="PNG")
    return buffer.getvalue()


def webp_valido(
    largura: int = 40, altura: int = 30, cor: tuple[int, int, int] = (90, 30, 60)
) -> bytes:
    """Um WebP pequeno e genuíno."""
    buffer = io.BytesIO()
    Image.new("RGB", (largura, altura), cor).save(buffer, format="WEBP")
    return buffer.getvalue()


def gif_valido(largura: int = 10, altura: int = 10) -> bytes:
    """Um GIF pequeno e genuíno — fora da lista branca (JPEG/PNG/WebP)."""
    buffer = io.BytesIO()
    Image.new("P", (largura, altura)).save(buffer, format="GIF")
    return buffer.getvalue()


def jpeg_com_php_colado(base: bytes | None = None, carga: bytes = CARGA_PHP) -> bytes:
    """Um JPEG válido com `<?php ... ?>` colado depois do marcador EOI.

    Medido: o Pillow abre e descodifica isto sem se queixar — o lixo
    depois do fim da imagem é exatamente isso, lixo, para o descodificador
    de JPEG. É o cenário do S-02: a defesa não pode ser "recusar o
    ficheiro", porque ele é uma imagem válida; tem de ser "nunca escrever
    os bytes originais".
    """
    return (base if base is not None else jpeg_valido()) + carga


def jpeg_com_gps(
    largura: int = 40,
    altura: int = 30,
    *,
    fabricante: str = "TomazaPhone",
    latitude: tuple[float, float, float] = (40.0, 38.0, 0.0),
    longitude: tuple[float, float, float] = (8.0, 34.0, 0.0),
) -> bytes:
    """Um JPEG com EXIF de verdade, incluindo um IFD de GPS.

    A receita exata que funciona (medida em Pillow 13.0.0): os valores de
    GPS entram como `float` dentro do tuplo, nunca como tuplos de
    racionais (`((40, 1), (38, 1), (0, 1))` rebenta com `TypeError: bad
    operand type for abs()` em `TiffImagePlugin._limit_rational`).
    """
    origem = Image.new("RGB", (largura, altura), (10, 20, 30))
    exif = Image.Exif()
    exif[0x010F] = fabricante  # Make
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = latitude
    gps[3] = "W"
    gps[4] = longitude
    buffer = io.BytesIO()
    origem.save(buffer, "JPEG", exif=exif)
    return buffer.getvalue()


def jpeg_truncado(largura: int = 200, altura: int = 200) -> bytes:
    """Um JPEG cujo cabeçalho é válido mas cujos dados de imagem estão cortados a meio.

    `Image.open()` continua a conseguir ler o tamanho (só lê o cabeçalho);
    é só ao `load()` (ou a uma operação que o force, como `save()`) que a
    falta de dados aparece, com `OSError: image file is truncated`.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (largura, altura), (1, 2, 3)).save(
        buffer, format="JPEG", quality=90
    )
    completo = buffer.getvalue()
    return completo[: len(completo) // 2]


def _chunk_png(tipo: bytes, dados: bytes) -> bytes:
    return (
        struct.pack(">I", len(dados))
        + tipo
        + dados
        + struct.pack(">I", zlib.crc32(tipo + dados) & 0xFFFFFFFF)
    )


def _png_minimo(largura: int, altura: int) -> bytes:
    """Um PNG de ~65 bytes cujo `IHDR` declara `largura`×`altura`, com `IDAT` vazio.

    `Image.open()` lê o `IHDR` e fica a saber o tamanho sem nunca ter
    descomprimido o `IDAT`. Não é um PNG que se consiga `load()`ar com
    sucesso — o `IDAT` não tem dados nenhuns de verdade —, e não precisa
    de conseguir: o critério é recusar **antes** de tentar.
    """
    assinatura = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", largura, altura, 8, 2, 0, 0, 0)  # RGB, 8 bits
    idat = zlib.compress(b"", 9)
    return (
        assinatura
        + _chunk_png(b"IHDR", ihdr)
        + _chunk_png(b"IDAT", idat)
        + _chunk_png(b"IEND", b"")
    )


#: Decisão do Tomás, 5 de novembro de 2026: 30 MP.
LIMITE_DE_PIXEIS = 30_000_000


def png_bomba_de_pixels(largura: int = 30000, altura: int = 30000) -> bytes:
    """Muito acima do limite — o próprio guarda do Pillow já apanha isto sozinho.

    900 milhões de píxeis é mais do que o dobro de qualquer
    `MAX_IMAGE_PIXELS` razoável: um `Image.open()` ingénuo já rebenta aqui
    com `DecompressionBombError`. Não prova, sozinha, que existe uma
    comparação explícita sobre `im.size` — é `png_bomba_na_zona_cinzenta`
    que prova isso.
    """
    assert largura * altura > 2 * LIMITE_DE_PIXEIS
    return _png_minimo(largura, altura)


def png_bomba_na_zona_cinzenta(largura: int = 6000, altura: int = 7000) -> bytes:
    """Acima do limite de 30 MP, abaixo do dobro — a que prende a comparação explícita.

    Medido em Pillow 13.0.0: nesta zona, o `Image.MAX_IMAGE_PIXELS`
    sozinho só emite um `DecompressionBombWarning` (engolido por omissão)
    e deixa o `Image.open()` (e um `load()` a seguir) completarem-se sem
    exceção nenhuma. Só uma comparação explícita sobre `im.size`, feita
    pelo código da aplicação, recusa isto.
    """
    pixeis = largura * altura
    assert LIMITE_DE_PIXEIS < pixeis < 2 * LIMITE_DE_PIXEIS, (
        f"{largura}x{altura} = {pixeis} píxeis não está entre o limite "
        f"({LIMITE_DE_PIXEIS}) e o dobro ({2 * LIMITE_DE_PIXEIS}) — ajusta "
        "as dimensões para a imagem continuar a prender o caso certo"
    )
    return _png_minimo(largura, altura)


# --------------------------------------------------------------------------
# HTTP: enviar uma foto, com ou sem IP escolhido.
# --------------------------------------------------------------------------


def enviar_foto(
    cliente: TestClient,
    conteudo: bytes,
    *,
    nome_ficheiro: str = "foto.jpg",
    tipo_mime: str = "image/jpeg",
    campos: dict[str, str] | None = None,
    cabecalhos_extra: dict[str, str] | None = None,
) -> httpx.Response:
    """`POST /fotos`, com o `X-Tomazia` que o S-06 exige em qualquer mutação.

    O nome e o `Content-Type` passados aqui são precisamente o que o
    contrato promete ignorar — os testes que querem provar isso passam-nos
    deliberadamente errados.
    """
    from tests.apoio_auth import CABECALHO_MUTACAO

    cabecalhos = {**CABECALHO_MUTACAO, **(cabecalhos_extra or {})}
    return cliente.post(
        "/fotos",
        files={CAMPO_FICHEIRO: (nome_ficheiro, conteudo, tipo_mime)},
        data=campos or {},
        headers=cabecalhos,
    )


def cliente_com_ip(ip: str, porta: int = 54321) -> TestClient:
    """Um `TestClient` sobre a app real, visto pelo servidor como vindo de `ip`.

    O Starlette aceita `client=(host, port)` no `TestClient` para
    preencher `request.client` — é isso que uma consulta
    `ip_hash = hash(request.client.host)` vê, independentemente de
    qualquer `X-Forwarded-For` que o próprio pedido traga (não há proxy de
    confiança configurado nestes testes; um `X-Forwarded-For` forjado não
    pode comprar um balde novo).

    `base_url="https://testserver"`: o mesmo cuidado de
    `tests.apoio_auth.cliente_seguro`, para um cookie `Secure` (admin,
    `__Host-...`) continuar a viajar se este cliente vier a receber um.
    """
    from fastapi.testclient import TestClient

    from app.main import criar_app

    return TestClient(criar_app(), base_url="https://testserver", client=(ip, porta))


def cookie_de_login_valido() -> tuple[str, str]:
    """Faz login na app real com `CREDENCIAIS_FALSAS` e devolve `(nome, valor)` do cookie.

    Mesmo padrão de
    `tests.seguranca.test_s04_gestao_exige_sessao::_cookie_de_login_valido`:
    um `TestClient` à parte, para o cookie poder ser transplantado para um
    cliente com um `client=` (IP) diferente. Pressupõe que a conta
    `tests.apoio_auth.admin` já existe na base de dados.
    """
    from fastapi.testclient import TestClient

    from app.main import criar_app
    from tests.apoio_auth import (
        CABECALHO_MUTACAO,
        CREDENCIAIS_FALSAS,
        nome_e_valor_do_cookie,
    )

    with TestClient(criar_app(), base_url="https://testserver") as cliente:
        resposta = cliente.post(
            "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 200, (
            f"o login de apoio falhou ({resposta.status_code}): {resposta.text}"
        )
        return nome_e_valor_do_cookie(resposta)


def cliente_admin_com_ip(ip: str, porta: int = 54321) -> TestClient:
    """Um `cliente_com_ip` já com uma sessão de admin válida.

    Para provar que "o dono salta o limite" mesmo quando o balde do
    próprio IP já está cheio (decisão do Tomás, 5 de novembro de 2026):
    o cliente nasce com o `client=` fixo no IP que o teste quer simular, e
    só depois recebe o cookie de uma sessão iniciada à parte.
    """
    nome, valor = cookie_de_login_valido()
    cliente = cliente_com_ip(ip, porta)
    cliente.cookies.set(nome, valor)
    return cliente


# --------------------------------------------------------------------------
# O relógio, injetado (mesmo padrão de `tests.apoio_auth.fixar_relogio_auth`).
# --------------------------------------------------------------------------

#: Candidatos a ter `agora_utc` importado pelo nome, para o balde de 5 por
#: hora e o `criada_em` que ele conta poderem ser congelados sem `sleep`.
#: Nenhum plano lido por este ficheiro fixa qual módulo vai ser — por
#: isso a lista é generosa, e `fixar_relogio_fotos` rebenta em voz alta se
#: nenhum tiver o nome, em vez de assumir silenciosamente qual é.
MODULOS_COM_RELOGIO_FOTOS = (
    "app.routers.fotos",
    "app.services.fotos",
)


def fixar_relogio_fotos(
    monkeypatch: pytest.MonkeyPatch, instante: datetime
) -> RelogioFixo:
    """Substitui `agora_utc` nos módulos candidatos de fotos e devolve o relógio.

    Ver `tests.apoio_auth.fixar_relogio_auth`: mesmo padrão, mesma razão —
    "não consegui injetar" não pode dar o mesmo resultado que "injetei e o
    balde ignorou-o" (regra 10 do `CLAUDE.md`).
    """
    import importlib

    relogio = RelogioFixo(instante)
    encontrados: list[str] = []
    for nome in MODULOS_COM_RELOGIO_FOTOS:
        try:
            modulo = importlib.import_module(nome)
        except ModuleNotFoundError:
            continue
        if hasattr(modulo, "agora_utc"):
            monkeypatch.setattr(modulo, "agora_utc", relogio)
            encontrados.append(nome)
    if not encontrados:
        raise AssertionError(
            f"nenhum de {list(MODULOS_COM_RELOGIO_FOTOS)} tem o nome "
            "`agora_utc` para substituir (ou os módulos ainda não existem, "
            "ou existem mas não importam `agora_utc` pelo nome). Sem um "
            "relógio injetável não dá para congelar a janela de uma hora "
            "do limite por IP: o serviço tem de chamar `agora_utc()` pelo "
            "nome do módulo, nunca `datetime.now(UTC)` inline — e, se o "
            "módulo certo não está nesta lista, acrescenta-o a "
            "`MODULOS_COM_RELOGIO_FOTOS`."
        )
    return relogio


# --------------------------------------------------------------------------
# Verificações partilhadas.
# --------------------------------------------------------------------------


def contar_fotos(sessao: Session) -> int:
    from sqlalchemy import text

    return sessao.execute(text("SELECT COUNT(*) FROM fotos")).scalar_one()


def exigir_nada_escrito(sessao: Session) -> None:
    """Rebenta se houver algo em `DATA_DIR/pendentes`, em `MEDIA_DIR`, ou uma linha em `fotos`.

    As três, sempre: um upload recusado que tenha escrito num dos dois
    sítios, ou criado uma linha, não cumpriu "nada escrito em disco" só
    porque um dos três ficou limpo. O `SpooledTemporaryFile` que o
    Starlette usa para receber o corpo do pedido (em `/tmp`, fora de
    `DATA_DIR` e de `MEDIA_DIR`) não conta: é temporário da framework.
    """
    from app.config import obter_definicoes

    definicoes = obter_definicoes()
    for pasta, nome in (
        (definicoes.pendentes_dir, "pendentes"),
        (definicoes.media_dir, "media"),
    ):
        if pasta.exists():
            ficheiros = sorted(caminho.name for caminho in pasta.iterdir())
            assert ficheiros == [], (
                f"a pasta {nome} ({pasta}) tem ficheiros que não devia: {ficheiros}"
            )

    quantas = contar_fotos(sessao)
    assert quantas == 0, f"a tabela `fotos` tem {quantas} linha(s) que não devia"


def nome_de_ficheiro_no_padrao(id_foto: int) -> str:
    """Um nome que bate com `PADRAO_NOME_DE_FICHEIRO`: 32 hex minúsculos + `.webp`."""
    return f"{id_foto:032x}.webp"


def semear_foto(
    sessao: Session,
    *,
    id_foto: int,
    estado: str,
    ficheiro: str | None = None,
    com_ficheiro: bool = True,
    criada_em: datetime | None = None,
    moderada_em: datetime | None = None,
    descricao: str | None = None,
    enviada_por: str | None = None,
) -> str:
    """Semeia uma linha de `fotos` (F4-04b) e, se `com_ficheiro`, os bytes falsos.

    `aprovada` escreve em `MEDIA_DIR`, `pendente` em `pendentes/`, `rejeitada`
    em lado nenhum (a rejeição apaga os bytes). Devolve o nome do ficheiro.
    O `ip_hash` leva sempre um valor reconhecível, para os testes provarem
    que nunca sai.
    """
    from datetime import UTC
    from datetime import datetime as datahora

    from app.config import obter_definicoes
    from app.models.fotos import EstadoFoto, Foto

    nome = ficheiro if ficheiro is not None else nome_de_ficheiro_no_padrao(id_foto)
    base = datahora(2026, 6, 20, 10, 0, tzinfo=UTC)
    sessao.add(
        Foto(
            id=id_foto,
            ficheiro=nome,
            estado=EstadoFoto(estado),
            descricao=descricao,
            enviada_por=enviada_por,
            ip_hash=f"hash-falso-de-ip-{id_foto:016d}",
            criada_em=criada_em or base,
            moderada_em=moderada_em,
        )
    )
    sessao.commit()

    definicoes = obter_definicoes()
    pasta = {
        "aprovada": definicoes.media_dir,
        "pendente": definicoes.pendentes_dir,
    }.get(estado)
    if com_ficheiro and pasta is not None:
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / nome).write_bytes(b"bytes-falsos-de-uma-foto")
    return nome
