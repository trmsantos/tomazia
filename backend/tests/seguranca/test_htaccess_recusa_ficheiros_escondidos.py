"""`deploy/htaccess.exemplo` recusa ficheiros e pastas começados por ponto, menos `/.well-known/` (F1-05).

## O achado

No primeiro deploy foi parar por engano um ficheiro de ambiente (`.env`,
com o segredo de sessão) à raiz do site. O `htaccess.exemplo` não tinha
nada que o impedisse de ser descarregado: o Apache só protege `.ht*` por
omissão. Passou a ter um `<If>` com `Require all denied` para qualquer
segmento do caminho começado por ponto, com a exceção de `/.well-known/`
na raiz, de que o AutoSSL do cPanel precisa para validar o certificado.

## O que isto prova, e o que não

É lint de texto, no estilo de `test_htaccess_exemplo_extensao_dupla.py`:
extrai-se a expressão do `<If>`, cada `m#...#` é compilado com o `re` do
Python (fiel ao PCRE do Apache para esta construção: alternativa, âncoras e
lookahead negativo) e combinado com `||`, como o `ap_expr` faz. Que o
Apache aplique de facto o `Require all denied` é verificação para a F5-01,
com um Apache a sério.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

CAMINHO_HTACCESS = Path(__file__).resolve().parents[3] / "deploy" / "htaccess.exemplo"

_BLOCO_IF = re.compile(r'<If\s+"([^"]+)"\s*>(.*?)</If>', re.DOTALL)
_TERMO = re.compile(r"%\{REQUEST_URI\}\s*=~\s*m#([^#]+)#")


def _sem_comentarios(texto: str) -> str:
    return "\n".join(
        linha for linha in texto.splitlines() if not linha.lstrip().startswith("#")
    )


def _expressoes_do_bloco() -> list[re.Pattern[str]]:
    """As expressões do único `<If>` que recusa caminhos escondidos (o que tem `\\.` e `Require all denied`)."""
    if not CAMINHO_HTACCESS.is_file():
        pytest.fail(f"{CAMINHO_HTACCESS} não existe.")
    texto = _sem_comentarios(CAMINHO_HTACCESS.read_text(encoding="utf-8"))
    candidatos = [
        (expressao, corpo)
        for expressao, corpo in _BLOCO_IF.findall(texto)
        if re.search(r"Require\s+all\s+denied", corpo) and "well-known" in expressao
    ]
    assert len(candidatos) == 1, (
        "Esperava exatamente um <If ...well-known...> com 'Require all denied' "
        f"em htaccess.exemplo; encontrei {len(candidatos)}. Sem ele, um "
        "ficheiro escondido na raiz do site (um .env esquecido) é servido."
    )
    expressao, _ = candidatos[0]
    termos = _TERMO.findall(expressao)
    assert termos, f"Não encontrei nenhum '%{{REQUEST_URI}} =~ m#...#' em {expressao!r}"
    resto = _TERMO.sub("", expressao)
    assert re.fullmatch(r"(\s*\|\|\s*)*\s*", resto), (
        "A expressão só pode ter termos `%{REQUEST_URI} =~ m#...#` unidos por "
        f"`||` — este teste avalia-a como um OU. Sobrou: {resto!r}"
    )
    return [re.compile(termo) for termo in termos]


def _recusado(caminho: str) -> bool:
    return any(padrao.search(caminho) for padrao in _expressoes_do_bloco())


@pytest.mark.parametrize(
    "caminho",
    [
        "/.env",
        "/.env.bak",
        "/.git/config",
        "/.git/",
        "/.git",
        "/.htpasswd",
        "/.DS_Store",
        "/assets/.env",
        "/media/.htaccess",
        "/media/2026/.escondido/foto.webp",
        "/api/.env",
        "/api/.htaccess",
        "/.tomazia-sinc.123.index.html",
        # As armadilhas da exceção:
        "/.well-known/.env",
        "/.well-known/acme-challenge/.git/config",
        "/assets/.well-known/acme-challenge/x",
        "/.well-knownx",
        "/.well-known-falso/x",
    ],
)
def test_caminho_escondido_e_recusado(caminho: str) -> None:
    assert _recusado(caminho), (
        f"{caminho!r} não é recusado pelo htaccess.exemplo. Um segmento do "
        "caminho começado por ponto (ficheiro ou pasta, a qualquer "
        "profundidade) tem de dar 'Require all denied', com a única exceção "
        "de /.well-known/ na raiz."
    )


@pytest.mark.parametrize(
    "caminho",
    [
        "/.well-known/acme-challenge/AbC-123_xyz",
        "/.well-known/pki-validation/ABCDEF.txt",
        "/.well-known/",
        "/.well-known",
        # O site normal não pode levar com um 403:
        "/",
        "/index.html",
        "/assets/app-a1b2c3.js",
        "/media/foto.webp",
        "/ementa",
        "/gestao/eventos",
        "/api/health",
        "/a.b/c.d",
        "/foto..jpg",
    ],
)
def test_caminho_permitido_nao_e_recusado(caminho: str) -> None:
    assert not _recusado(caminho), (
        f"{caminho!r} é recusado e não devia: ou partia a validação do "
        "certificado SSL (/.well-known/), ou dava 403 em conteúdo legítimo."
    )
