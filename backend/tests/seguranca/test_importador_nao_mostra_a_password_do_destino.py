"""A recusa da `BASE_DADOS_URL` do importador não leva a password no meio.

Regra 5 do `CLAUDE.md`. O importador recusa quando a `BASE_DADOS_URL` não
aponta para um ficheiro SQLite, e a mensagem nomeava a URL **inteira**.
Repare-se em quando é que essa recusa dispara: só para URLs que **não** são
SQLite — ou seja, precisamente as que trazem `utilizador:password@servidor`
lá dentro. Uma URL de SQLite não tem password nenhuma para entornar.

E o relatório deste script é feito para ser copiado: corre-se por SSH, sai
todo em `stdout`, guarda-se num ficheiro e cola-se num pedido de ajuda. Era
a configuração do servidor a ir atrás.

O remédio é o `render_as_string(hide_password=True)` do SQLAlchemy, que
troca a password por `***` e deixa o resto legível — que é o que a
mensagem precisa de mostrar para alguém perceber o que configurou mal.
"""

from __future__ import annotations

from pathlib import Path

from tests.apoio_legado import contagens, correr_importador

#: A password que não pode sair. Cadeia única e improvável, como os
#: marcadores de `tests/apoio_legado.py`: se aparecer no relatório, foi o
#: script que a lá pôs.
PASSWORD = "psw-marcador-b7e41d2a-nao-pode-sair-da-configuracao"

URL_COM_PASSWORD = f"postgresql://tomazia:{PASSWORD}@servidor.exemplo.test:5432/bd"


def test_a_recusa_da_base_dados_url_nao_imprime_a_password(
    origem_falsa: Path,
    destino_em_head: Path,
    pasta_de_imagens: Path,
    media_dir: Path,
) -> None:
    """Recusa, diz que a URL não é SQLite, e não escreve a password em lado nenhum.

    As três coisas são precisas. Sem a recusa, o script seguia para uma
    base de dados que não sabe escrever; sem a URL mascarada no relatório,
    quem configurou mal não percebia o quê; e com a password à vista, o
    relatório passava a ser um segredo.

    **Deixa passar:** a password a aparecer noutro sítio que não este
    relatório — num `traceback` do SQLAlchemy, por exemplo, se alguma vez
    se chegasse a abrir a ligação. Não se chega: esta recusa é das
    primeiras coisas que o script faz, antes de tocar no destino.
    """
    resultado = correr_importador(
        origem=origem_falsa,
        destino=destino_em_head,
        imagens=pasta_de_imagens,
        media=media_dir,
        ambiente_extra={"BASE_DADOS_URL": URL_COM_PASSWORD},
    )

    assert resultado.estado != 0, (
        "uma BASE_DADOS_URL que não é SQLite tem de recusar: este script só "
        f"sabe escrever num ficheiro SQLite\n{resultado.relatorio()}"
    )
    assert PASSWORD not in resultado.tudo, (
        "a password da BASE_DADOS_URL apareceu no relatório. O relatório "
        "deste script é copiado e colado num pedido de ajuda, e esta recusa "
        "só dispara para as URLs que trazem uma password lá dentro\n"
        f"{resultado.relatorio()}"
    )
    assert "***" in resultado.tudo, (
        "a URL tem de aparecer mascarada, e não desaparecer: quem a "
        "configurou mal precisa de a ver para perceber o quê\n"
        f"{resultado.relatorio()}"
    )
    assert "servidor.exemplo.test" in resultado.tudo, (
        f"esconder a password não é esconder a URL toda\n{resultado.relatorio()}"
    )
    assert contagens(destino_em_head) == {
        "categorias": 0,
        "produtos": 0,
        "eventos": 0,
        "fotos": 0,
        "clientes": 0,
        "admins": 0,
        "definicoes": 0,
    }, resultado.relatorio()
