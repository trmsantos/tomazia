"""Lint de texto sobre `deploy/htaccess.exemplo` (F1-04, agente infra).

Importante (tem de ir na docstring do módulo, foi pedido explicitamente):
**isto não é uma verificação a sério do Apache.** Não há Apache nem Docker
neste conjunto de testes — só análise de texto sobre o ficheiro-modelo. A
verificação com um Apache real, em contentor, interpretando as diretivas de
facto, fica para a F5-01 (`docs/TAREFAS.md`). Um ficheiro pode passar em
todos os testes daqui e ainda assim ter uma diretiva com sintaxe inválida,
uma secção `<Directory>` mal fechada, ou um `RewriteCond` que não faz o que
o nome promete sob um Apache real — nenhum desses erros está ao alcance de
uma regex. O que fica preso aqui é mais barato e mais estreito: as
diretivas certas existem, em texto, e nenhum valor óbvio e perigoso
(`unsafe-eval`, `*` na CSP) ou real (domínio, utilizador) se infiltrou no
modelo que o Tomás vai copiar à mão para o servidor.

`htaccess.exemplo` nunca é o `.htaccess` real do servidor (esse é mantido à
mão, fora do repositório — ver `docs/ESPECIFICACAO.md`, secção Servidor).
É só o modelo versionado, para o Tomás copiar e adaptar.

Este ficheiro ainda não existe: o infra escreve-o em paralelo. Os testes
aqui falham agora com "ficheiro não encontrado", não com um erro de
sintaxe no teste.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[2]
CAMINHO_HTACCESS = RAIZ_REPO / "deploy" / "htaccess.exemplo"


def _ler_texto() -> str:
    if not CAMINHO_HTACCESS.is_file():
        pytest.fail(
            f"{CAMINHO_HTACCESS} ainda não existe (é o infra que o escreve, "
            "na F1-04). Este teste tem de falhar por isto, não por outra razão."
        )
    return CAMINHO_HTACCESS.read_text(encoding="utf-8")


def _extrair_valor_csp(texto: str) -> str:
    """Devolve o valor completo da diretiva `Content-Security-Policy`.

    Apache permite continuar um `Header set` em várias linhas com `\\` no
    fim de cada uma; por isso juntamos as continuações antes de procurar a
    diretiva, em vez de olhar só para a primeira linha física.
    """
    sem_continuacoes = re.sub(r"\\\s*\n\s*", " ", texto)
    # O valor da CSP contém aspas simples por dentro (`'self'`,
    # `'unsafe-inline'`): o grupo de captura tem de parar só na aspa do
    # MESMO tipo que abriu o valor (referência `\1`), nunca excluir as
    # aspas simples da captura — isso cortaria o valor na primeira
    # ocorrência de `'self'` e mascarava qualquer teste sobre o resto da
    # diretiva (ex.: `script-src`, mais adiante no valor).
    padrao = re.compile(
        r'Content-Security-Policy["\']?\s+(["\'])(.*?)\1',
        re.IGNORECASE | re.DOTALL,
    )
    correspondencia = padrao.search(sem_continuacoes)
    assert correspondencia is not None, (
        "Não encontrei um valor entre aspas para Content-Security-Policy "
        "em deploy/htaccess.exemplo."
    )
    return correspondencia.group(2)


def test_ficheiro_existe() -> None:
    assert CAMINHO_HTACCESS.is_file()


@pytest.mark.parametrize(
    "diretiva",
    [
        "Content-Security-Policy",
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "PassengerFriendlyErrorPages",
    ],
)
def test_diretivas_obrigatorias_presentes(diretiva: str) -> None:
    texto = _ler_texto()
    assert diretiva in texto, f"Falta a diretiva {diretiva!r} em htaccess.exemplo."


def test_nosniff_no_valor_de_x_content_type_options() -> None:
    texto = _ler_texto()
    assert re.search(r"X-Content-Type-Options[^\n]*nosniff", texto, re.IGNORECASE), (
        "X-Content-Type-Options tem de valer 'nosniff'."
    )


def test_passenger_friendly_error_pages_off() -> None:
    """`PassengerFriendlyErrorPages Off`: ligado, um erro de configuração mostra caminhos do servidor no browser (docs/TAREFAS.md, F1-04)."""
    texto = _ler_texto()
    assert re.search(r"PassengerFriendlyErrorPages\s+Off", texto), (
        "PassengerFriendlyErrorPages tem de ser 'Off', explicitamente."
    )


def test_fallback_do_spa_presente() -> None:
    """Existe uma regra de reescrita que devolve o SPA (index.html) para rotas desconhecidas."""
    texto = _ler_texto()
    assert re.search(r"RewriteRule\s+.*index\.html", texto), (
        "Não encontrei o RewriteRule de fallback do SPA para index.html."
    )


def test_fallback_do_spa_exclui_api() -> None:
    """O RewriteCond do fallback exclui `/api` — senão o fallback engolia a API (devolvia sempre index.html)."""
    texto = _ler_texto()
    assert re.search(
        r"RewriteCond\s+%\{REQUEST_URI\}\s+!.*api", texto, re.IGNORECASE
    ), (
        "Não encontrei um RewriteCond que exclua /api antes do fallback do SPA "
        "(ex.: RewriteCond %{REQUEST_URI} !^/api)."
    )


def test_bloqueio_de_scripts_em_media() -> None:
    """`media/` tem de recusar execução de scripts: é onde ficam as fotos enviadas por qualquer visitante (S-01, S-02)."""
    texto = _ler_texto()
    tem_bloco_media = re.search(r'["\']?media/?["\']?', texto, re.IGNORECASE)
    assert tem_bloco_media, "Não encontrei nenhuma referência à pasta media/."
    tem_bloqueio = re.search(
        r"(RemoveHandler|SetHandler|php_flag\s+engine\s+off|Deny from all|"
        r"Require all denied|AllowOverride\s+None)",
        texto,
    )
    assert tem_bloqueio, (
        "Não encontrei nenhuma diretiva que bloqueie execução de scripts em "
        "media/ (RemoveHandler, SetHandler default, Require all denied ou "
        "AllowOverride None)."
    )


def test_allow_override_none_em_media() -> None:
    """`AllowOverride None` em media/ não é higiene, é requisito: um .htaccess honrado nessa pasta repunha a configuração inteira com um SetEnv (docs/TAREFAS.md, F1-04)."""
    texto = _ler_texto()
    bloco_media = re.search(
        r"<Directory[^>]*media[^>]*>(.*?)</Directory>", texto, re.IGNORECASE | re.DOTALL
    )
    assert bloco_media is not None, (
        "Não encontrei um bloco <Directory ...media...> em htaccess.exemplo. "
        "Se a estrutura escolhida for outra (ex.: um .htaccess próprio dentro "
        "de media/), este teste tem de ser adaptado — avisa o Tomás."
    )
    assert re.search(r"AllowOverride\s+None", bloco_media.group(1)), (
        "O bloco <Directory ...media...> não tem AllowOverride None."
    )


def test_csp_sem_unsafe_eval() -> None:
    valor_csp = _extrair_valor_csp(_ler_texto())
    assert "unsafe-eval" not in valor_csp


def test_csp_sem_asterisco_global() -> None:
    valor_csp = _extrair_valor_csp(_ler_texto())
    assert "*" not in valor_csp, (
        "A CSP não pode conter '*' em nenhuma diretiva (fonte aberta a "
        "qualquer origem)."
    )


def test_csp_script_src_sem_unsafe_inline() -> None:
    valor_csp = _extrair_valor_csp(_ler_texto())
    diretivas = [parte.strip() for parte in valor_csp.split(";") if parte.strip()]
    script_src = next(
        (d for d in diretivas if d.lower().startswith("script-src")), None
    )
    assert script_src is not None, "A CSP não tem diretiva script-src."
    assert "unsafe-inline" not in script_src, (
        f"script-src não pode conter 'unsafe-inline': {script_src!r}"
    )


@pytest.mark.parametrize("marcador_proibido", ["dominios.pt", "/home/"])
def test_sem_dominio_ou_caminho_de_utilizador_reais(marcador_proibido: str) -> None:
    """Nenhum domínio real nem caminho de utilizador do cPanel: isto é um modelo, não a configuração do servidor."""
    texto = _ler_texto()
    assert marcador_proibido not in texto, (
        f"Encontrei {marcador_proibido!r} em htaccess.exemplo — isto é um "
        "modelo público, não pode ter dados reais do servidor."
    )


def test_sem_email_aparente() -> None:
    texto = _ler_texto()
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", texto), (
        "Encontrei algo parecido com um email em htaccess.exemplo."
    )
