"""O importador da F2-08 não leva dados pessoais da BD antiga para lado nenhum.

Regra 5 do `CLAUDE.md`. A `docs/ESPECIFICACAO.md`, linha 47, diz duas
coisas sobre `scripts/importar_bd_antiga.py` que são promessas de segurança
e não detalhes de implementação:

- **"só leitura"** — o ficheiro da base de dados antiga é a única cópia que
  existe dos dados do dono. Se o script lhe tocar e correr mal, não há
  segunda tentativa;
- **"não importa a foto de teste, os clientes nem os admins"** — a base de
  dados antiga tem emails, telemóveis e hashes de password de contas de
  administração do site PHP. Nada disso tem lugar na base de dados nova,
  nem num relatório que vai para o terminal (e daí, muitas vezes, para uma
  mensagem a pedir ajuda).

As duas provam-se com marcadores: cadeias únicas e improváveis postas em
`admin_users.psw` e em `tomazia_clientes.email` da base de dados falsa. Se
alguma aparecer num byte do destino ou numa linha do relatório, foi o
script que a levou lá.

A base de dados real do site antigo **nunca** entra no repositório e nunca
é lida. Isto corre tudo sobre a base de dados falsa de
`tests/apoio_legado.py`, em `tmp_path`.
"""

from __future__ import annotations

from pathlib import Path

from tests.apoio_legado import (
    MARCADOR_EMAIL_CLIENTE,
    MARCADOR_PASSWORD_ADMIN,
    bytes_do_destino,
    contagens,
    correr_importador,
    impressao_digital,
)

MARCADORES = (MARCADOR_PASSWORD_ADMIN, MARCADOR_EMAIL_CLIENTE)


def test_os_dados_pessoais_da_bd_antiga_nao_chegam_ao_destino_nem_ao_relatorio(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Nem um byte do destino, nem uma linha do relatório, tem o marcador.

    Procura-se nos bytes do ficheiro **e nos sidecars** (`-wal`, `-shm`):
    uma transação por consolidar guarda dados que o ficheiro principal
    ainda não tem, e procurar só no principal diria "não está lá" sobre
    dados que estão lá ao lado.

    O relatório conta tanto como a base de dados. Um script que recusasse
    uma linha de `tomazia_clientes` e imprimisse "não importei
    pessoa@exemplo.pt" não escrevia nada no destino e punha na mesma o
    email no terminal — e no ecrã de quem estiver a ver.

    E as três tabelas ficam vazias com a origem a ter uma linha em cada
    uma: "zero" aqui é uma decisão do script, não a ausência de dados na
    origem.

    **Deixa passar:** dados pessoais que o script copie **transformados**
    — um email em minúsculas, um hash do hash, as iniciais de um nome. O
    marcador é uma cadeia literal e só apanha a cópia literal. O que fecha
    esse buraco é a contagem a zero das três tabelas, que está aqui ao
    lado, e o facto de o destino não ter coluna nenhuma onde isso coubesse.
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado == 0, resultado.relatorio()

    conteudo = bytes_do_destino(destino_em_head)
    for marcador in MARCADORES:
        assert marcador.encode("utf-8") not in conteudo, (
            f"o marcador «{marcador}» apareceu nos bytes da base de dados de "
            "destino. Veio de admin_users.psw ou de tomazia_clientes.email "
            "da origem, e nenhuma das duas se importa "
            f"(docs/ESPECIFICACAO.md, linha 47)\n{resultado.relatorio()}"
        )
        assert marcador not in resultado.tudo, (
            f"o marcador «{marcador}» apareceu no relatório. O terminal é "
            "um sítio tão público como a base de dados: o relatório é "
            f"copiado e colado\n{resultado.relatorio()}"
        )

    linhas = contagens(destino_em_head)
    vazias = {tabela: linhas[tabela] for tabela in ("fotos", "clientes", "admins")}
    assert vazias == {"fotos": 0, "clientes": 0, "admins": 0}, (
        "a galeria começa vazia e os clientes e os admins não se importam "
        f"(decisão do Tomás na entrada da F2-08)\n{resultado.relatorio()}"
    )


def test_a_bd_antiga_fica_com_o_mesmo_sha256_e_a_mesma_mtime(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """A promessa de só leitura prova-se: a origem sai da corrida byte a byte igual.

    O `mtime` conta em **nanossegundos**: uma escrita e uma reescrita
    dentro do mesmo segundo dão o mesmo `st_mtime` inteiro, e o teste
    ficava verde contra um script que abrisse a origem para escrita e lá
    pusesse os mesmos bytes.

    A pasta da origem também não pode ganhar ficheiros. Um `-wal` ou um
    `-shm` ao lado da base de dados antiga é o SQLite a dizer que ela foi
    aberta para escrita: o `sha256` do ficheiro principal ficaria igual e a
    promessa estaria na mesma quebrada.

    **Deixa passar:** uma abertura em leitura-escrita que não chegue a
    escrever nada, nem a mudar o modo de diário. É pouco provável e é
    inofensiva — o que esta casa quer impedir é a origem ser **alterada**,
    não o modo como foi aberta. Quem quiser prender também o modo tem de ir
    ver a chamada, e isso é revisão de código, não um teste.
    """
    pasta_da_origem = origem_falsa.parent
    antes = impressao_digital(origem_falsa)
    ficheiros_antes = sorted(caminho.name for caminho in pasta_da_origem.iterdir())

    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
    )

    assert resultado.estado == 0, resultado.relatorio()

    depois = impressao_digital(origem_falsa)
    assert depois[0] == antes[0], (
        "o sha256 da base de dados antiga mudou. A especificação diz «só "
        "leitura», e aquele ficheiro é a única cópia que existe dos dados "
        f"do dono\n{resultado.relatorio()}"
    )
    assert depois[1] == antes[1], (
        "o sha256 ficou igual mas a mtime mudou: alguém abriu a origem para "
        "escrita e voltou a escrever o mesmo. É a mesma promessa quebrada, "
        f"só que sem se notar\n{resultado.relatorio()}"
    )

    ficheiros_depois = sorted(caminho.name for caminho in pasta_da_origem.iterdir())
    assert ficheiros_depois == ficheiros_antes, (
        "apareceram ficheiros ao lado da base de dados antiga "
        f"({sorted(set(ficheiros_depois) - set(ficheiros_antes))}). Um `-wal` "
        "ou um `-shm` é o SQLite a dizer que ela foi aberta para escrita\n"
        f"{resultado.relatorio()}"
    )
