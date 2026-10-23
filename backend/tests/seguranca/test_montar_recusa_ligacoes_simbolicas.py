"""`deploy/montar.sh` recusa o pacote inteiro se houver uma ligação simbólica lá dentro (terceira ronda da F1-04).

## O achado

`deploy.sh` sincroniza o pacote com `rsync -a`, que preserva ligações
simbólicas tal e qual, e o Apache do cPanel segue-as
(`SymLinksIfOwnerMatch`). Uma ligação como

    frontend/dist/logo.svg -> ../tomazia_api/.env

chegava ao `WEB` como ligação e era servida por HTTP com o conteúdo do
ficheiro para onde aponta — um ficheiro que nunca esteve no pacote e que
nenhum guarda viu passar.

Nenhuma das redes anteriores a apanhava, e vale a pena ser exato sobre o
porquê:

- O S-10/S-12 (em `montar.sh` e em
  `.github/scripts/verificar-ficheiros-proibidos.sh`) olha para NOMES de
  caminho. `logo.svg` é um nome inocente; o nome proibido está só do
  outro lado da ligação, que é texto dentro do inode, nunca um caminho da
  árvore. E as procuras desses guardas são `-type f`: uma ligação
  simbólica não é um ficheiro regular, por isso nem sequer lhes aparece.
- O guarda de `publicar-branch.sh` (a árvore publicada tem de ser, caminho
  a caminho, o pacote auditado) também não: o git guarda a ligação como
  uma entrada normal da árvore, com o modo `120000`, e os dois lados da
  comparação batem certo. Uma ligação é publicada sem drama nenhum.

Hoje nada consegue pôr uma ligação no pacote — o `upload-artifact`
dereferencia-as ao empacotar, e o resto do pacote sai de um `cp -a` de um
checkout limpo. Mas essa é uma garantia de terceiros, não nossa, e não
estava escrita em lado nenhum. Por isso há duas camadas: esta, no
`montar.sh` (recusa o pacote em voz alta), e o `--safe-links` do `rsync`
do frontend em `deploy.sh`, o último sítio antes do site, prendido em
`test_deploy_sh_nao_sincroniza_ligacoes_para_fora_do_pacote.py`.

## Porque se recusam TODAS as ligações, e não só as que saem do pacote

O guarda é `find "$saida" -type l`: qualquer ligação, aponte para onde
apontar. Uma ligação para dentro do próprio pacote não é perigosa para o
`rsync` (o `--safe-links` deixá-la-ia passar, e com razão), mas no pacote
deste projeto ela também não tem explicação nenhuma: tudo o que lá está
veio de um `cp -a` de ficheiros regulares do checkout e de um build do
Vite. Uma ligação significa que algo inesperado aconteceu, e isso é para
ser visto por uma pessoa — não para ser classificado em "aceitável" e
"não aceitável" por um script. O teste do caso inofensivo está aqui para
que essa escolha fique escrita: se um dia alguém precisar mesmo de
ligações no pacote, derruba este teste de propósito e decide outra vez.

## Porque a asserção "a ligação continua lá" importa

Um `montar.sh` que apagasse a ligação e saísse 0 passaria num teste que só
olhasse para o conteúdo do pacote — e seria o pior dos dois mundos: o
pacote sairia "limpo" e ninguém ficaria a saber que uma ligação apareceu
no build. Tal como no `.htaccess` (ver `test_montar_recusa_htaccess.py`),
a decisão é recusar em voz alta e deixar o pacote como está.

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
    b"commit de teste do test_montar_recusa_ligacoes_simbolicas.py, nunca real"
).hexdigest()
assert len(SHA_VALIDO) == 40

#: O conteúdo do ficheiro para onde as ligações perigosas apontam: fica
#: FORA da árvore de trabalho, como um `.env` do servidor fica fora do
#: pacote. Claramente falso (regra 1 do `CLAUDE.md`).
CONTEUDO_SEGREDO_FALSO = "SEGREDO_SESSAO=segredo-de-teste-nunca-usado-em-producao\n"

#: Onde se planta a ligação e para onde ela aponta, relativo ao sítio da
#: própria ligação. Cobre o build (raiz e fundo) e o lado do backend, e os
#: dois tipos de alvo: fora da árvore (perigoso) e dentro do pacote
#: (inofensivo, recusado na mesma — ver o docstring).
LIGACOES = {
    "dist_raiz_para_fora": ("frontend/dist/logo.svg", "../../fora-da-arvore/segredo"),
    "dist_fundo_para_fora": (
        "frontend/dist/assets/fundo/icone.svg",
        "../../../../fora-da-arvore/segredo",
    ),
    "backend_para_fora": ("backend/app/atalho.py", "../../../fora-da-arvore/segredo"),
    "dist_para_dentro_do_pacote": ("frontend/dist/copia.html", "index.html"),
}


def _construir_arvore_minima(tmp_path: Path) -> Path:
    """Árvore de trabalho fabricada, com o `deploy/` real copiado (é de lá que vem o `montar.sh` sob teste e o `.cpanel.yml`)."""
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
    (dist / "assets" / "fundo").mkdir(parents=True)
    (dist / "index.html").write_text(
        "<!doctype html><html><body>pacote de teste</body></html>\n", encoding="utf-8"
    )
    (dist / "assets" / "app.js").write_text(
        "// ficheiro fabricado, nunca um build a sério\n", encoding="utf-8"
    )

    shutil.copytree(DEPLOY_REAL, raiz / "deploy")

    # O alvo das ligações perigosas: fora da árvore de trabalho, como o
    # `.env` do servidor está fora do pacote.
    fora = tmp_path / "fora-da-arvore"
    fora.mkdir()
    (fora / "segredo").write_text(CONTEUDO_SEGREDO_FALSO, encoding="utf-8")

    return raiz


def _plantar_ligacao(raiz: Path, caso: str) -> Path:
    relativo, alvo = LIGACOES[caso]
    ligacao = raiz / relativo
    ligacao.parent.mkdir(parents=True, exist_ok=True)
    ligacao.symlink_to(alvo)
    assert ligacao.is_symlink(), "premissa do teste: foi criada mesmo uma ligação"
    return ligacao


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


def test_arvore_sem_ligacoes_monta_sem_problemas(tmp_path: Path) -> None:
    """Controlo: sem ligação nenhuma, esta árvore fabricada monta e sai 0 — sem isto, os testes abaixo podiam estar a passar por outra razão qualquer."""
    raiz = _construir_arvore_minima(tmp_path)
    saida = tmp_path / "pacote"

    resultado = _correr_montar(raiz, saida=saida)

    assert resultado.returncode == 0, (
        f"montar.sh recusou uma árvore limpa.\nstderr:\n{resultado.stderr}"
    )
    assert (saida / "frontend" / "dist" / "index.html").is_file()


@pytest.mark.parametrize("caso", sorted(LIGACOES), ids=sorted(LIGACOES))
def test_ligacao_simbolica_no_pacote_faz_montar_recusar(
    tmp_path: Path, caso: str
) -> None:
    """`exit` diferente de zero, com o caminho da ligação em stderr."""
    raiz = _construir_arvore_minima(tmp_path)
    _plantar_ligacao(raiz, caso)

    saida = tmp_path / "pacote"
    resultado = _correr_montar(raiz, saida=saida)

    relativo = LIGACOES[caso][0]
    assert resultado.returncode != 0, (
        f"montar.sh montou o pacote com uma ligação simbólica em {relativo!r} "
        "e saiu 0. O `rsync -a` do deploy.sh copia-a tal e qual e o Apache "
        "segue-a: o site passaria a servir o conteúdo do outro lado da "
        f"ligação.\nstdout:\n{resultado.stdout}"
    )
    assert "ligaç" in resultado.stderr.lower(), (
        "A recusa tem de dizer, em stderr, que o problema é uma ligação "
        f"simbólica — senão é indistinguível de outra avaria qualquer do "
        f"script. stderr foi: {resultado.stderr!r}"
    )
    assert Path(relativo).name in resultado.stderr, (
        "A recusa tem de dizer QUAL é a ligação encontrada (o caminho dela "
        f"no pacote) — stderr foi: {resultado.stderr!r}"
    )


def test_o_conteudo_do_alvo_nunca_entra_no_pacote(tmp_path: Path) -> None:
    """A ligação é copiada como ligação (`cp -a`), nunca dereferenciada: o segredo não está no pacote, está do outro lado."""
    raiz = _construir_arvore_minima(tmp_path)
    _plantar_ligacao(raiz, "dist_raiz_para_fora")

    saida = tmp_path / "pacote"
    resultado = _correr_montar(raiz, saida=saida)

    assert resultado.returncode != 0
    ligacao_no_pacote = saida / "frontend" / "dist" / "logo.svg"
    assert ligacao_no_pacote.is_symlink(), (
        "A ligação tinha de chegar ao pacote como ligação — é esse o ponto "
        "do achado. Se o `cp -a` a tivesse dereferenciado, o pacote levava "
        "uma CÓPIA do segredo, que é um problema diferente (e que o S-10 "
        "também não apanharia, porque o nome continua a ser 'logo.svg')."
    )
    conteudos = [
        caminho.read_text(encoding="utf-8", errors="replace")
        for caminho in saida.rglob("*")
        if caminho.is_file() and not caminho.is_symlink()
    ]
    assert CONTEUDO_SEGREDO_FALSO not in conteudos, (
        "O conteúdo do alvo foi copiado para dentro do pacote."
    )


def test_a_recusa_nunca_e_uma_exclusao_em_silencio(tmp_path: Path) -> None:
    """A ligação continua no pacote depois da recusa: apagá-la e sair 0 seria esconder que algo inesperado entrou no build."""
    raiz = _construir_arvore_minima(tmp_path)
    _plantar_ligacao(raiz, "dist_fundo_para_fora")

    saida = tmp_path / "pacote"
    resultado = _correr_montar(raiz, saida=saida)

    assert resultado.returncode != 0
    ligacao_no_pacote = saida / "frontend" / "dist" / "assets" / "fundo" / "icone.svg"
    assert ligacao_no_pacote.is_symlink(), (
        "A ligação intrusa foi apagada do pacote. A decisão é a mesma do "
        "'.htaccess': recusar em voz alta e deixar o pacote como está, para "
        "quem investiga ver o que lá estava. Uma exclusão em silêncio aqui é "
        "indistinguível de um build limpo."
    )
