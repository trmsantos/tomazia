"""`deploy/montar.sh` recusa o pacote inteiro se houver um `.htaccess` lá dentro (ronda de segurança da F1-04).

## O achado

O `.htaccess` real do site é mantido à mão, no servidor, fora deste
repositório (`docs/ESPECIFICACAO.md`, secção Servidor; o modelo versionado
é `deploy/htaccess.exemplo`). O deploy nunca lhe toca.

Um `.htaccess` que entrasse no pacote — por exemplo
`frontend/dist/assets/.htaccess`, vindo de uma dependência de build ou de
um erro — seria sincronizado para `WEB` por `deploy.sh` e honrado pelo
Apache (o cPanel deixa `AllowOverride All`), sobrepondo-se à configuração
real do servidor. Isso é uma reconfiguração do site a partir de um
ficheiro que ninguém reviu.

A correção tem duas camadas, e esta é a primeira: `montar.sh` procura
`.htaccess` a QUALQUER profundidade no pacote já montado e, se encontrar
algum, recusa-se — `exit 1`, em voz alta. Nunca uma exclusão em silêncio,
ao contrário do que faz com o S-10/S-12 (um `docs/` apanhado na cópia não
é uma falha de ninguém; um `.htaccess` é sempre um sinal de que algo
inesperado se meteu no build e tem de ser visto por uma pessoa). A segunda
camada é o `--exclude='.htaccess'` sem âncora de `deploy.sh`, prendida em
`test_deploy_sh_exclui_htaccess_em_profundidade.py`.

## Porque a asserção "o ficheiro continua lá" importa

Um `montar.sh` que apagasse o `.htaccess` e saísse 0 passaria num teste que
só olhasse para o conteúdo do pacote. Seria exatamente o comportamento que
esta correção recusa: o pacote sairia "limpo" e ninguém ficaria a saber que
um `.htaccess` apareceu no build. Por isso cada teste abaixo afirma as duas
coisas — código de saída diferente de zero E o ficheiro intocado.

Não está ligado a nenhum critério S-NN de `docs/ESPECIFICACAO.md`: vive em
`tests/seguranca/` pela regra 5 do `CLAUDE.md` da raiz.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
DEPLOY_REAL = RAIZ_REPO / "deploy"

#: 40 hexadecimais, como um SHA de commit — calculado a partir de texto
#: claramente falso, nunca o SHA de um commit real.
SHA_VALIDO = hashlib.sha1(
    b"commit de teste do test_montar_recusa_htaccess.py, nunca real"
).hexdigest()
assert len(SHA_VALIDO) == 40

CONTEUDO_HTACCESS_INTRUSO = (
    "# .htaccess que nunca devia ter entrado no build\n"
    "SetHandler application/x-httpd-php\n"
)

#: Onde se planta o intruso, relativo à raiz da árvore de trabalho. Cobre a
#: raiz do build, uma subpasta, uma subpasta funda, e o lado do backend —
#: "a qualquer profundidade" tem de querer dizer mesmo isso.
LOCAIS_DO_INTRUSO = [
    "frontend/dist/.htaccess",
    "frontend/dist/assets/.htaccess",
    "frontend/dist/assets/fundo/mais-fundo/.htaccess",
    "backend/app/.htaccess",
]


def _construir_arvore_minima(tmp_path: Path) -> Path:
    """Árvore de trabalho pequena e inteiramente fabricada, com o `deploy/` real copiado (é de lá que vem o `montar.sh` sob teste e o `.cpanel.yml`)."""
    raiz = tmp_path / "trabalho"
    (raiz / "backend" / "app").mkdir(parents=True)
    (raiz / "backend" / "app" / "__init__.py").write_text("", encoding="utf-8")
    (raiz / "backend" / "app" / "main.py").write_text(
        "# aplicacao falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "migrations").mkdir(parents=True)
    (raiz / "backend" / "migrations" / "env.py").write_text(
        "# migracao falsa\n", encoding="utf-8"
    )
    (raiz / "backend" / "alembic.ini").write_text(
        "[alembic]\nscript_location = migrations\n", encoding="utf-8"
    )
    (raiz / "backend" / "passenger_wsgi.py").write_text(
        "# passenger_wsgi falso\n", encoding="utf-8"
    )
    (raiz / "backend" / "requirements.txt").write_text("fastapi\n", encoding="utf-8")

    dist = raiz / "frontend" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><body>pacote de teste</body></html>\n", encoding="utf-8"
    )
    (dist / "assets" / "app.js").write_text(
        "// ficheiro fabricado, nunca um build a sério\n", encoding="utf-8"
    )

    shutil.copytree(DEPLOY_REAL, raiz / "deploy")
    return raiz


def _correr_montar(
    raiz_trabalho: Path, *, saida: Path, timeout: float = 60
) -> subprocess.CompletedProcess[str]:
    """Invoca `<raiz_trabalho>/deploy/montar.sh` por subprocesso. Nunca o importa."""
    script = raiz_trabalho / "deploy" / "montar.sh"
    if not script.is_file():
        pytest.fail(f"{script} não existe na árvore de trabalho do teste.")
    return subprocess.run(
        [str(script), "--sha", SHA_VALIDO, "--saida", str(saida)],
        cwd=raiz_trabalho,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def test_arvore_sem_htaccess_monta_sem_problemas(tmp_path: Path) -> None:
    """Controlo: sem intruso nenhum, esta árvore fabricada monta e sai 0 — sem isto, os testes abaixo podiam estar a passar por outra razão qualquer."""
    raiz = _construir_arvore_minima(tmp_path)
    saida = tmp_path / "pacote"

    resultado = _correr_montar(raiz, saida=saida)

    assert resultado.returncode == 0, (
        f"montar.sh recusou uma árvore limpa.\nstderr:\n{resultado.stderr}"
    )
    assert (saida / "frontend" / "dist" / "index.html").is_file()


@pytest.mark.parametrize("local", LOCAIS_DO_INTRUSO)
def test_htaccess_a_qualquer_profundidade_faz_montar_recusar_o_pacote(
    tmp_path: Path, local: str
) -> None:
    """`exit` diferente de zero, com o caminho do intruso em stderr — nunca um pacote "limpo" com o problema apagado às escondidas."""
    raiz = _construir_arvore_minima(tmp_path)
    intruso = raiz / local
    intruso.parent.mkdir(parents=True, exist_ok=True)
    intruso.write_text(CONTEUDO_HTACCESS_INTRUSO, encoding="utf-8")

    saida = tmp_path / "pacote"
    resultado = _correr_montar(raiz, saida=saida)

    assert resultado.returncode != 0, (
        f"montar.sh montou o pacote com um '.htaccess' em {local!r} e saiu 0. "
        "Tem de recusar o pacote inteiro — o Apache honra um .htaccess a "
        "qualquer profundidade e ele sobrepõe-se à configuração real do "
        f"servidor.\nstdout:\n{resultado.stdout}"
    )
    assert ".htaccess" in resultado.stderr, (
        "A recusa tem de dizer, em stderr, que o problema é um '.htaccess' "
        f"— stderr foi: {resultado.stderr!r}"
    )


@pytest.mark.parametrize("local", ["frontend/dist/assets/.htaccess"])
def test_a_recusa_nunca_e_uma_exclusao_em_silencio(tmp_path: Path, local: str) -> None:
    """O intruso continua no pacote depois da recusa: apagá-lo e sair 0 seria esconder que algo inesperado entrou no build."""
    raiz = _construir_arvore_minima(tmp_path)
    intruso = raiz / local
    intruso.parent.mkdir(parents=True, exist_ok=True)
    intruso.write_text(CONTEUDO_HTACCESS_INTRUSO, encoding="utf-8")

    saida = tmp_path / "pacote"
    resultado = _correr_montar(raiz, saida=saida)

    assert resultado.returncode != 0
    copia_no_pacote = saida / "frontend" / "dist" / "assets" / ".htaccess"
    assert copia_no_pacote.is_file(), (
        "O '.htaccess' intruso foi apagado do pacote. A decisão tomada na "
        "ronda de segurança da F1-04 é o contrário: recusar em voz alta e "
        "deixar o pacote como está, para quem investiga ver o que lá estava. "
        "Uma exclusão em silêncio aqui é indistinguível de um build limpo."
    )
    assert copia_no_pacote.read_text(encoding="utf-8") == CONTEUDO_HTACCESS_INTRUSO
