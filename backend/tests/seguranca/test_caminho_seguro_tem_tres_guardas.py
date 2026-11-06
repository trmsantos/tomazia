"""`app.services.fotos._caminho_seguro`: a lista branca de forma, e as três guardas antigas.

Medido em revisão (mutação uma guarda de cada vez, apagando `is_symlink()`,
`is_relative_to` e a comparação final de nome): **as três sobreviviam**,
porque hoje `fotos.ficheiro` vem sempre de `uuid4().hex` e o `CHECK` da
F2-01 recusa `/`, `\\` e `..` — não há ataque nenhum a exercitar estas
guardas por cima da API pública. São defesa em profundidade para a F2-08,
que escreve nesta tabela por SQL cru, sem passar pela API — por isso estes
testes chamam `_caminho_seguro` diretamente, com um `nome` que a API nunca
deixaria passar.

**A guarda de maiúsculas não funcionava mesmo — achado de uma revisão
posterior.** A versão anterior deste ficheiro tinha um teste que
substituía `Path.resolve` por uma versão que canoniza a caixa, para
"provar" a guarda — mas **nenhum sistema de ficheiros real faz isso**: no
Linux (o CI), `CARTAZ.webp` falha mais cedo, no `is_file()`; no macOS
(medido, correndo a função de produção a sério, sem simular nada),
`Path.resolve()` **não** canoniza a caixa — `candidato.name` continua a
ser `"CARTAZ.webp"`, igual ao `nome` pedido, e a função **serve** o
ficheiro. Era exatamente o tipo de teste que este ficheiro já tinha
recusado escrever para o `is_relative_to` (abaixo) — e desta vez passou,
o que é pior: um teste verde a provar uma garantia que o código não dá.

A correção não é testar melhor a comparação de nome — é não depender dela
para isto. `PADRAO_NOME_DE_FICHEIRO` (a lista branca de forma, decisão do
Tomás de 6 de novembro de 2026) recusa qualquer `nome` que não seja
exatamente `<32 hex minúsculos>.webp`, só pela *string*, antes de tocar no
sistema de ficheiros — funciona em qualquer SO, porque não depende de
nenhum.

**A frase sobre a relação entre `is_relative_to` e a comparação de nome
também estava errada** (achado da mesma revisão): dizia que só a
comparação de nome apanhava `../segredo.webp`. Medido com as duas versões
lado a lado: tirar **só** a comparação de nome (mantendo `is_relative_to`)
também recusa `../segredo.webp` — as duas guardas cobrem-se mutuamente
para este caso, nenhuma delas é "a" que apanha, sozinha.
"""

from __future__ import annotations

from pathlib import Path


def test_symlink_e_recusado_mesmo_apontando_para_dentro_da_pasta(
    tmp_path: Path,
) -> None:
    """Isola a guarda `is_symlink()` das outras — continua a ser a única que apanha isto.

    Uma ligação `pasta/nome` a apontar para `pasta/outro-nome` já seria
    recusada pela comparação final de nome, sozinha (o nome resolvido,
    `outro-nome`, diferia do pedido, `nome`) — não provava nada sobre o
    `is_symlink()` em si. Para isolar: a ligação chama-se `cartaz.webp` e
    aponta para `subpasta/cartaz.webp` — **mesmo nome**, e **dentro** da
    árvore de `pasta` (a sub-pasta também é "lá dentro"). Sem o
    `is_symlink()`, as outras guardas deixavam isto passar.
    """
    from app.services.fotos import _caminho_seguro

    pasta = tmp_path / "pendentes"
    pasta.mkdir()
    subpasta = pasta / "subpasta"
    subpasta.mkdir()
    # Nomes válidos pela lista branca (32 hex + .webp), para a guarda 1
    # não recusar antes de chegar ao `is_symlink()` que este teste quer
    # isolar.
    nome = "a" * 32 + ".webp"
    real = subpasta / nome
    real.write_bytes(b"conteudo-verdadeiro")
    ligacao = pasta / nome
    ligacao.symlink_to(real)

    assert _caminho_seguro(pasta, nome) is None, (
        "uma ligação simbólica nunca pode ser servida, mesmo apontando "
        "para um ficheiro de igual nome dentro da própria árvore de pastas"
    )
    # Controlo: o ficheiro real (não a ligação), pedido pelo caminho que
    # `_caminho_seguro` serviria se não fosse uma ligação, continua a
    # servir — prova que a recusa de cima é mesmo do `is_symlink()`, não
    # de as outras guardas também recusarem este caminho.
    assert _caminho_seguro(subpasta, nome) == real


def test_nome_fora_da_forma_e_recusado_pela_lista_branca(tmp_path: Path) -> None:
    """A guarda nova: qualquer coisa que não seja `<32 hex minúsculos>.webp`."""
    from app.services.fotos import _caminho_seguro

    pasta = tmp_path / "pendentes"
    pasta.mkdir()

    casos = [
        "../segredo.webp",  # tentativa de fuga
        "a" * 32 + ".WEBP",  # extensão em maiúsculas
        "A" * 32 + ".webp",  # hex em maiúsculas — o caso real do macOS
        "a" * 31 + ".webp",  # tamanho errado
        "a" * 32 + ".png",  # extensão errada
        "",
    ]
    for nome in casos:
        assert _caminho_seguro(pasta, nome) is None, (
            f"{nome!r} não tem a forma de um nome de foto e tinha de ser "
            "recusado pela lista branca, antes de tocar no sistema de "
            "ficheiros"
        )


#: `is_relative_to` e a comparação final de nome (guardas 3 e 4) não têm
#: teste próprio neste ficheiro — nem um a isolar uma da outra. Medido:
#: qualquer `nome` que passe `PADRAO_NOME_DE_FICHEIRO` (sem barras, sem
#: `..`, sem maiúsculas) nunca resolve para fora de `pasta` a não ser por
#: ligação simbólica, e isso já é recusado por `is_symlink()` primeiro —
#: o mesmo achado que já tinha fechado o `is_relative_to` isolado numa
#: revisão anterior, agora também verdade para a comparação de nome,
#: porque a lista branca passou a fazer o trabalho que a comparação fazia
#: sozinha. Ficam como defesa em profundidade (a ordem das guardas podia
#: mudar), documentadas no docstring de `_caminho_seguro`, não escondidas
#: atrás de um teste que finja isolá-las.
