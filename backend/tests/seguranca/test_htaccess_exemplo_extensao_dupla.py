"""O `<FilesMatch>` das extensões perigosas de `deploy/htaccess.exemplo` apanha extensões duplas (ronda de segurança da F1-04).

## O achado

O padrão era `"\\.(php|phtml|php[0-9]|phar|cgi|pl|py|sh|fcgi)$"` — ancorado
no fim do nome. `foto.php.jpg` não termina em `.php`, por isso esse regex
nunca lhe correspondia e o `Require all denied` não se aplicava. Mas o
`mod_mime` do Apache olha para TODAS as extensões de um nome, não só a
última: com um `AddHandler`/`SetHandler` de PHP ligado no vhost (fora do
alcance de qualquer `.htaccess`), `foto.php.jpg` continuava a ser tratado
como PHP. E `media/` é precisamente a pasta onde qualquer visitante do
site põe ficheiros (galeria, S-01/S-02). O padrão passou a terminar em
`(\\.|$)`: a extensão perigosa é reconhecida no fim do nome **ou** seguida
de outra extensão qualquer.

## Porque este ficheiro existe à parte de `tests/test_htaccess_exemplo.py`

Os 19 testes desse ficheiro passavam, antes e depois desta correção, sem
mudar uma linha: nenhum deles olha para o conteúdo do padrão do
`<FilesMatch>`. O mais próximo, `test_bloqueio_de_scripts_em_media`, só
confirma que existe ALGUMA diretiva de bloqueio no ficheiro — passaria com
o padrão antigo, com o novo, e com um padrão que não apanhasse nada. Por
isso esta correção precisava de testes novos, e eles vivem aqui, em
`tests/seguranca/`, pela regra 5 do `CLAUDE.md` da raiz.

## O que isto NÃO prova

O mesmo aviso de `tests/test_htaccess_exemplo.py`, que vale por inteiro:
não há Apache nenhum nestes testes. O padrão é extraído do ficheiro e
compilado com o módulo `re` do Python — uma aproximação ao PCRE do Apache
que é fiel para a construção usada aqui (alternativa, classe de carateres,
âncora de fim), e nada mais do que isso. Que o Apache aplique de facto o
`Require all denied` ao ficheiro correspondente é verificação para a F5-01,
com um Apache a sério em contentor.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

RAIZ_REPO = Path(__file__).resolve().parents[3]
CAMINHO_HTACCESS = RAIZ_REPO / "deploy" / "htaccess.exemplo"

_PADRAO_FILESMATCH = re.compile(r"<FilesMatch\s+\"([^\"]+)\"\s*>")


def _sem_comentarios(texto: str) -> str:
    """Tira as linhas de comentário (`#`, com ou sem indentação).

    Nada decorativo: o corpo deste `<FilesMatch>` tem um comentário que
    MENCIONA `Require all denied` para explicar porque é que o
    `SetHandler default-handler` não o substitui. Uma asserção sobre o
    texto cru passava com a diretiva apagada e só o comentário de pé — foi
    exatamente isso que a mutação de controlo apanhou neste ficheiro antes
    de ele ser dado por pronto. Um comentário não configura nada no Apache.
    """
    return "\n".join(
        linha for linha in texto.splitlines() if not linha.lstrip().startswith("#")
    )


def _bloco_das_extensoes_perigosas() -> tuple[str, str]:
    """Devolve (padrão, corpo sem comentários) do único `<FilesMatch>` que trata das extensões executáveis."""
    if not CAMINHO_HTACCESS.is_file():
        pytest.fail(f"{CAMINHO_HTACCESS} não existe.")
    texto = CAMINHO_HTACCESS.read_text(encoding="utf-8")

    candidatos = [
        padrao
        for padrao in _PADRAO_FILESMATCH.findall(_sem_comentarios(texto))
        if "php" in padrao
    ]
    assert len(candidatos) == 1, (
        "Esperava exatamente um <FilesMatch> sobre extensões executáveis "
        f"(com 'php' no padrão) em htaccess.exemplo, encontrei {candidatos!r}. "
        "Se a estrutura mudou, este teste tem de ser adaptado — avisa o Tomás."
    )
    padrao = candidatos[0]

    inicio = texto.index(f'<FilesMatch "{padrao}">')
    fim = texto.index("</FilesMatch>", inicio)
    return padrao, _sem_comentarios(texto[inicio:fim])


def _corresponde(nome_do_ficheiro: str) -> bool:
    padrao, _ = _bloco_das_extensoes_perigosas()
    return re.search(padrao, nome_do_ficheiro) is not None


@pytest.mark.parametrize(
    "nome",
    [
        "shell.php",
        "shell.phtml",
        "shell.php5",
        "backdoor.phar",
        "script.cgi",
        "script.pl",
        "script.py",
        "script.sh",
        "script.fcgi",
    ],
)
def test_extensao_perigosa_no_fim_do_nome_continua_apanhada(nome: str) -> None:
    """A correção alargou o padrão; não pode ter perdido o caso que já funcionava."""
    assert _corresponde(nome), (
        f"{nome!r} deixou de corresponder ao <FilesMatch> das extensões "
        "executáveis — a correção da extensão dupla não pode ter aberto o "
        "caso simples."
    )


@pytest.mark.parametrize(
    "nome",
    [
        "foto.php.jpg",
        "foto.php.png",
        "imagem.phtml.webp",
        "nota.py.txt",
        "copia.sh.bak",
        "carregamento.php5.jpeg",
        "duplo.php.jpg.webp",
    ],
)
def test_extensao_perigosa_seguida_de_outra_extensao_e_apanhada(nome: str) -> None:
    """O achado: o `mod_mime` lê TODAS as extensões do nome, não só a última — um padrão ancorado só em `$` deixava passar isto."""
    assert _corresponde(nome), (
        f"{nome!r} não corresponde ao <FilesMatch> das extensões executáveis. "
        "Um nome com extensão dupla continua a ser tratado como script pelo "
        "mod_mime se houver um AddHandler ligado no vhost, e media/ é escrita "
        "por qualquer visitante do site (S-01, S-02). O padrão tem de "
        "terminar em '(\\.|$)', nunca só em '$'."
    )


@pytest.mark.parametrize(
    "nome",
    [
        "backup.tar.gz",
        "phpmyadmin.txt",
        "foto.jpg",
        "index.html",
        "estilo.css",
        "notas.python",
        "manual.shtml",
        "README.md",
        "app-a1b2c3.js",
    ],
)
def test_nomes_inofensivos_nao_dao_falso_positivo(nome: str) -> None:
    """Alargar o padrão não pode ter passado a proibir ficheiros normais do site: um falso positivo aqui é um 403 em conteúdo legítimo."""
    assert not _corresponde(nome), (
        f"{nome!r} corresponde ao <FilesMatch> das extensões executáveis e "
        "não devia — isso daria 403 num ficheiro inofensivo."
    )


def test_o_bloco_perigoso_nega_o_acesso_e_forca_o_handler_estatico() -> None:
    """O padrão só serve para alguma coisa se o corpo do bloco recusar mesmo: `Require all denied` é a parte que fecha, `SetHandler default-handler` é a defesa a mais."""
    _, corpo = _bloco_das_extensoes_perigosas()
    assert re.search(r"Require\s+all\s+denied", corpo), (
        f"O <FilesMatch> das extensões executáveis não tem 'Require all denied':\n{corpo}"
    )
    assert re.search(r"SetHandler\s+default-handler", corpo), (
        "O <FilesMatch> das extensões executáveis não força "
        "'SetHandler default-handler' — sem isso, um handler herdado do "
        f"vhost continua a poder interpretar o ficheiro:\n{corpo}"
    )
