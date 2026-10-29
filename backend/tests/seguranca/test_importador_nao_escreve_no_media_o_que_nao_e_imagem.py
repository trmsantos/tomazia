"""O importador da F2-08 não põe no `MEDIA_DIR` nada que não seja uma imagem.

Regra 5 do `CLAUDE.md`. São duas falhas, as duas medidas com sonda sobre o
script tal como estava, e o que lhes dá gravidade é onde o `MEDIA_DIR`
fica: o Tomás decidiu correr a importação **por SSH, no servidor**, e lá o
`MEDIA_DIR` é `public_html/media` — dentro do `public_html`, servido pelo
Apache do cPanel com `AllowOverride All`. É a única pasta do site escrita
a partir de dados que vieram de fora.

**1. Qualquer ficheiro passava.** A redução de `img/uploads/fados.jpg` a
`fados.jpg` faz o que lhe compete — tira `/`, `\\` e `..`, que é o que o
`CHECK ck_eventos_imagem_sem_caminho` exige — e não diz **nada** sobre que
tipo de ficheiro é. Medido no `nome_de_ficheiro` de então:

    'img/uploads/.htaccess'  ->  '.htaccess'
    'shell.php'              ->  'shell.php'
    '../../../.env'          ->  '.env'
    'evil.svg'               ->  'evil.svg'
    'evil.html'              ->  'evil.html'

Um `.htaccess` ali repõe a execução de PHP exatamente onde não pode haver.

**1b. E a lista branca, numa primeira versão, era uma lista negra.** Olhava
para `Path(nome).suffix` — a última extensão — e o `mod_mime` do Apache
despacha pela lista **toda** de extensões do nome. Medido:

    'cartaz.jpg.php'  ->  RECUSA     (só porque a última é .php)
    'shell.php.jpg'   ->  passava
    'foto.PhP.gif'    ->  passava
    'a.cgi.jpeg'      ->  passava
    'b.sh.png'        ->  passava
    'x.html.webp'     ->  passava

É a mesma armadilha que o `deploy/htaccess.exemplo` documenta em vinte
linhas, e a razão de o `FilesMatch` de lá acabar em `(\\.|$)` e não em `$`.
A regra passou a ser **uma extensão e só uma**, com o custo assumido de
recusar um `cartaz.2026.jpg` legítimo: adivinhar que extensões o Apache
deste cPanel reconhece como handler seria a lista negra outra vez.

**2. As ligações simbólicas eram seguidas.** Não havia uma única
verificação de ligação no ficheiro, e os `resolve()` que lá estavam
resolviam as **pastas**, não cada imagem — o `Path.is_file()` segue
ligações por omissão e o `shutil.copyfile` lê e escreve através delas.
Medido: uma ligação em `img/uploads/cartaz.jpg` a apontar para o `.env` da
instalação chegava ao `media/` com os bytes do segredo lá dentro, servido
por HTTP com um nome de cartaz. E do outro lado é pior: uma ligação já no
`MEDIA_DIR`, apontada para um caminho que ainda não existe, fazia a cópia
**criar** o ficheiro fora do `MEDIA_DIR`.

A base de dados real do site antigo nunca entra no repositório e nunca é
lida: isto corre tudo sobre a base de dados falsa de
`tests/apoio_legado.py`, em `tmp_path`.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.apoio_legado import (
    BYTES_DO_SEGREDO,
    EVENTOS,
    IMAGEM_DE_INVERNO,
    IMAGEM_DE_VERAO,
    CenarioDeRecusa,
    EventoAntigo,
    RecusaCorrida,
    correr_cenario_de_recusa,
    ficheiros_em,
)

#: O id e o título do evento que, em cada caso, traz o ficheiro proibido.
#: Distintivos de propósito: um `2` sozinho aparece por acaso em quase
#: qualquer linha de um relatório, e o que se quer provar é que a recusa
#: **nomeia o evento** a quem tem de a ir corrigir à origem.
ID_DO_EVENTO = 77
TITULO_DO_EVENTO = "Festa com ficheiro a mais"

#: O nome que os dois casos de ligação simbólica usam. **Diferente** dos
#: das imagens verdadeiras de propósito: o script pára no primeiro
#: problema de imagens, e com o mesmo nome era o evento 1 a ser nomeado na
#: recusa — o teste ficava verde por outra razão que não a que quer provar.
NOME_DA_LIGACAO = "cartaz.jpg"


def _evento_com_imagem(referencia: str) -> tuple[EventoAntigo, ...]:
    """Os eventos da base de dados falsa mais um que refere `referencia`."""
    return (
        *EVENTOS,
        EventoAntigo(ID_DO_EVENTO, TITULO_DO_EVENTO, "2026-07-01", None, referencia, 1),
    )


CENARIOS: tuple[CenarioDeRecusa, ...] = (
    CenarioDeRecusa(
        chave="htaccess",
        porque=(
            "`img/uploads/.htaccess` reduz-se a `.htaccess` limpinho — sem "
            "`/`, sem `..`, dentro dos 64 caracteres. No `public_html` do "
            "cPanel, com `AllowOverride All`, um `.htaccess` repõe a "
            "execução de PHP na única pasta do site escrita por terceiros."
        ),
        pistas=(str(ID_DO_EVENTO), ".htaccess"),
        eventos=_evento_com_imagem("img/uploads/.htaccess"),
        imagens_presentes=(IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO, ".htaccess"),
    ),
    CenarioDeRecusa(
        chave="php",
        porque=(
            "Um `.php` no `MEDIA_DIR` é código que o servidor corre, com o "
            "endereço do bar à frente."
        ),
        pistas=(str(ID_DO_EVENTO), "shell.php"),
        eventos=_evento_com_imagem("shell.php"),
        imagens_presentes=(IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO, "shell.php"),
    ),
    CenarioDeRecusa(
        chave="extensao-dupla",
        porque=(
            "A lista branca olhava para `Path(nome).suffix` — a **última** "
            "extensão — e o `mod_mime` do Apache olha para **todas**. "
            "Medido: `cartaz.jpg.php` recusava e `shell.php.jpg`, "
            "`foto.PhP.gif`, `a.cgi.jpeg`, `b.sh.png` e `x.html.webp` "
            "passavam todos. Ou seja: ancorada no último sufixo, a lista "
            "branca comporta-se como lista **negra** para todas as "
            "extensões menos a última — exatamente o que ela existe para "
            "não ser. O `deploy/htaccess.exemplo` já tem vinte linhas sobre "
            "esta armadilha, e é por ela que o `FilesMatch` de lá acaba em "
            "`(\\.|$)` e não em `$`.\n"
            "Este caso sozinho **não** prende o guarda da contagem, e isso "
            "é a razão de haver o `extensao-dupla-invertida` a seguir: ver "
            "o `porque` dele."
        ),
        pistas=(str(ID_DO_EVENTO), "shell.php.jpg"),
        eventos=_evento_com_imagem("img/uploads/shell.php.jpg"),
        imagens_presentes=(IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO, "shell.php.jpg"),
    ),
    CenarioDeRecusa(
        chave="extensao-dupla-invertida",
        porque=(
            "O caso que **prende** o guarda da contagem, e nasceu de uma "
            "mutação que sobreviveu.\n"
            "Há dois guardas: um conta as extensões, o outro verifica que a "
            "primeira está na lista branca. O `shell.php.jpg` do cenário "
            "acima é apanhado pelo **segundo** (`sufixos[0] == '.php'`), "
            "por isso sobrevive a desligar o primeiro — medido: com o "
            "`if len(sufixos) > 1` desligado, a bateria inteira fica verde. "
            "Quem depende do primeiro é este, o simétrico: `cartaz.jpg.php` "
            "tem a primeira extensão na lista branca, e sem a contagem "
            "aterra em `public_html/media` com o script a sair com **0**.\n"
            "A instrução que escolheu o caso anterior dizia que este «já "
            "recusava antes da correção e não provava nada». Era verdade "
            "sobre o código velho, e a correção inverteu o eixo: o caso que "
            "não provava nada passou a ser o único que prova. Um teste de "
            "segurança não serve para re-provar o defeito que houve — "
            "serve para impedir que o guarda desapareça."
        ),
        pistas=(str(ID_DO_EVENTO), "cartaz.jpg.php"),
        eventos=_evento_com_imagem("img/uploads/cartaz.jpg.php"),
        imagens_presentes=(IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO, "cartaz.jpg.php"),
    ),
    CenarioDeRecusa(
        chave="sem-extensao-nenhuma",
        porque=(
            "O outro lado da regra «uma extensão, e só uma»: zero também "
            "não serve. Um ficheiro sem extensão no `MEDIA_DIR` não é "
            "despachado como script — o risco é menor do que o do "
            "`shell.php.jpg` —, mas a lista branca diz que só lá entram "
            "cinco tipos de ficheiro, e «nenhum» não é um deles. Sem este "
            "caso, trocar o `not sufixos or` por um `sufixos and` deixava "
            "entrar qualquer coisa chamada `cartaz`, e nada caía."
        ),
        pistas=(str(ID_DO_EVENTO), "cartaz-sem-extensao"),
        eventos=_evento_com_imagem("img/uploads/cartaz-sem-extensao"),
        imagens_presentes=(
            IMAGEM_DE_VERAO,
            IMAGEM_DE_INVERNO,
            "cartaz-sem-extensao",
        ),
    ),
    CenarioDeRecusa(
        chave="ligacao-nas-imagens",
        porque=(
            "A ligação está do lado da **origem** das imagens, que no "
            "servidor é a pasta de uploads do site antigo: o que lá está "
            "veio de fora. O `copyfile` lê através dela e os bytes do outro "
            "lado aterram no `MEDIA_DIR` com um nome de cartaz."
        ),
        pistas=(str(ID_DO_EVENTO), NOME_DA_LIGACAO),
        eventos=_evento_com_imagem(f"img/uploads/{NOME_DA_LIGACAO}"),
        # As imagens verdadeiras ficam lá, para os eventos 1 e 2 passarem;
        # o `cartaz.jpg` do evento 77 é que, em vez de um ficheiro, é uma
        # ligação para fora da pasta.
        ligacoes_nas_imagens=(NOME_DA_LIGACAO,),
    ),
    CenarioDeRecusa(
        chave="ligacao-no-media",
        porque=(
            "A ligação está do lado do **destino**, e aponta para um "
            "caminho que ainda não existe. O `is_file()` diz «não está cá», "
            "o script copia, e o `copyfile` **cria** o ficheiro do outro "
            "lado — uma escrita fora do `MEDIA_DIR` que não deixa vestígio "
            "nenhum dentro dele."
        ),
        pistas=(str(ID_DO_EVENTO), NOME_DA_LIGACAO),
        eventos=_evento_com_imagem(f"img/uploads/{NOME_DA_LIGACAO}"),
        # O ficheiro de origem é verdadeiro e está onde deve: o que está
        # errado é o que já lá está do lado do destino.
        imagens_presentes=(IMAGEM_DE_VERAO, IMAGEM_DE_INVERNO, NOME_DA_LIGACAO),
        ligacoes_no_media=(NOME_DA_LIGACAO,),
    ),
)


@pytest.fixture(scope="module")
def recusas_do_media(
    tmp_path_factory: pytest.TempPathFactory, _destino_modelo_em_head: Path
) -> dict[str, RecusaCorrida]:
    """Os seis casos, corridos uma vez cada."""
    raiz = tmp_path_factory.mktemp("media-f2-08")
    return {
        cenario.chave: correr_cenario_de_recusa(
            cenario, _destino_modelo_em_head, raiz / cenario.chave
        )
        for cenario in CENARIOS
    }


@pytest.mark.parametrize("cenario", CENARIOS, ids=lambda c: c.chave)
def test_o_importador_recusa_e_o_media_dir_fica_byte_a_byte_como_estava(
    cenario: CenarioDeRecusa, recusas_do_media: dict[str, RecusaCorrida]
) -> None:
    """Estado diferente de zero, `MEDIA_DIR` intacto, e o evento nomeado.

    As três afirmações são precisas as três e nenhuma substitui as outras:

    - **estado diferente de zero**, porque sair com zero é o dono fechar o
      terminal e ir ver o site;
    - **`MEDIA_DIR` byte a byte igual ao de antes**, porque é o resultado
      que interessa. Um script que recusasse *depois* de copiar deixava o
      ficheiro lá, e o relatório dizia que não tinha feito nada;
    - **o evento nomeado**, porque isto corrige-se na origem, e com 140
      produtos e uma data de eventos à frente «há um ficheiro errado» não
      diz a ninguém qual é a linha.

    **Deixa passar:** a redação da recusa, e o facto de o ficheiro ser
    recusado pelo nome e não pelo conteúdo. Uma imagem verdadeira chamada
    `cartaz.jpg` com um PHP lá dentro continua a entrar — e é inofensiva
    enquanto o Apache não a servir como PHP, que é precisamente o que o
    `.htaccess` recusado aqui lhe faria. A lista branca de extensões é o
    que fecha a porta; abrir cada ficheiro com Pillow fechava-a mais um
    bocado e é outra tarefa (ver o relatório da F2-08).
    """
    corrida = recusas_do_media[cenario.chave]

    assert corrida.resultado.estado != 0, (
        f"{cenario.chave}: {cenario.porque}\n{corrida.resultado.relatorio()}"
    )
    assert ficheiros_em(corrida.media) == corrida.media_antes, (
        f"{cenario.chave}: o MEDIA_DIR mudou. É uma pasta servida pela web, "
        "e o que lá aterra fica a ser servido pelo endereço do bar\n"
        f"{corrida.resultado.relatorio()}"
    )
    for pista in cenario.pistas:
        assert pista in corrida.resultado.tudo, (
            f"{cenario.chave}: a recusa não nomeia «{pista}», e isto "
            "corrige-se na origem — sem o evento nomeado não há por onde "
            f"começar\n{corrida.resultado.relatorio()}"
        )


@pytest.mark.parametrize(
    "chave", ["ligacao-nas-imagens", "ligacao-no-media"], ids=lambda c: c
)
def test_o_ficheiro_do_outro_lado_da_ligacao_fica_como_estava(
    chave: str, recusas_do_media: dict[str, RecusaCorrida]
) -> None:
    """O segredo fora das duas pastas não é lido nem escrito.

    O `MEDIA_DIR` intacto não chega para as ligações, e são dois buracos
    diferentes: do lado da origem o problema é **ler** o ficheiro de lá e
    pôr os bytes dele num sítio servido pela web; do lado do destino o
    problema é **escrever** para fora do `MEDIA_DIR`, onde nem sequer se
    vê que aconteceu. Por isso se verifica também o outro lado: que o
    segredo continua com os bytes que tinha, e que a ligação pendurada não
    chegou a criar nada.

    **Deixa passar:** uma leitura que não deixe rasto — o script podia ter
    aberto o ficheiro, lido o segredo e não ter escrito nada em lado
    nenhum. O que fecha isso é o `MEDIA_DIR` intacto do teste de cima e o
    relatório não trazer o conteúdo.
    """
    corrida = recusas_do_media[chave]
    assert corrida.segredo is not None, "o cenário tinha de ter montado o segredo"

    assert corrida.segredo.read_bytes() == BYTES_DO_SEGREDO, (
        f"{chave}: o ficheiro fora das pastas foi escrito por cima através "
        f"da ligação simbólica\n{corrida.resultado.relatorio()}"
    )
    criados = sorted(
        caminho.name
        for caminho in corrida.segredo.parent.iterdir()
        if caminho.name != corrida.segredo.name
    )
    assert criados == [], (
        f"{chave}: apareceram ficheiros fora do MEDIA_DIR ({criados}). A "
        "cópia escreveu através de uma ligação simbólica, no sítio para "
        f"onde ela apontava\n{corrida.resultado.relatorio()}"
    )

    assert BYTES_DO_SEGREDO.decode("utf-8") not in corrida.resultado.tudo, (
        f"{chave}: o conteúdo do ficheiro do outro lado da ligação apareceu "
        f"no relatório\n{corrida.resultado.relatorio()}"
    )
