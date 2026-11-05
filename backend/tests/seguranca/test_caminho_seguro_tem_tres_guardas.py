"""E1: as três guardas de `app.services.fotos._caminho_seguro`, sem rede até aqui.

Medido em revisão (mutação uma guarda de cada vez, apagando `is_symlink()`,
`is_relative_to` e a comparação final de nome): **as três sobreviviam**,
porque hoje `fotos.ficheiro` vem sempre de `uuid4().hex` e o `CHECK` da
F2-01 recusa `/`, `\\` e `..` — não há ataque nenhum a exercitar estas
guardas por cima da API pública. São defesa em profundidade para a F2-08,
que escreve nesta tabela por SQL cru, sem passar pela API — por isso estes
testes chamam `_caminho_seguro` diretamente, com um `nome` que a API nunca
deixaria passar.

A guarda de maiúsculas é a única das três que um sistema de ficheiros
sensível a maiúsculas (Linux, o CI) não exercitaria sozinho — por isso o
teste simula, com um `Path.resolve` substituído, o que um sistema de
ficheiros insensível a maiúsculas (macOS, Windows) faria sozinho.

**Repetida a mutação do `is_relative_to`, isoladamente, para este
ficheiro: não há `nome` nenhum que a isole das outras duas.** Qualquer
`nome` com `/` ou `..` já é recusado pela comparação final de nome (um
nome resolvido nunca tem barras, por isso nunca pode ser igual a um
`nome` que as tenha); qualquer fuga por ligação simbólica já é recusada
pelo `is_symlink()`, incondicional e anterior ao `resolve()`. Confirmado
empiricamente (as duas versões, com e sem `is_relative_to`, dão o mesmo
resultado para `"../fora.webp"`, `".."`, `"."`, nomes simples e
compostos) — ver o docstring de `test_nome_que_tenta_fugir_da_pasta_e_recusado`,
abaixo. Fica como defesa em profundidade (a ordem das outras duas guardas
podia mudar no futuro), mas não como algo que este ficheiro consiga provar
necessário hoje — sinalizado em vez de forçado um teste que fingisse que
sim.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest


def test_symlink_e_recusado_mesmo_apontando_para_dentro_da_pasta(
    tmp_path: Path,
) -> None:
    """Isola a guarda `is_symlink()` das outras duas.

    Uma ligação `pasta/nome` a apontar para `pasta/outro-nome` já seria
    recusada pela comparação final de nome, sozinha (o nome resolvido,
    `outro-nome`, diferia do pedido, `nome`) — não provava nada sobre o
    `is_symlink()` em si. Para isolar: a ligação chama-se `cartaz.webp` e
    aponta para `subpasta/cartaz.webp` — **mesmo nome**, e **dentro** da
    árvore de `pasta` (a sub-pasta também é "lá dentro"). Sem o
    `is_symlink()`, as outras duas guardas deixavam isto passar.
    """
    from app.services.fotos import _caminho_seguro

    pasta = tmp_path / "pendentes"
    pasta.mkdir()
    subpasta = pasta / "subpasta"
    subpasta.mkdir()
    real = subpasta / "cartaz.webp"
    real.write_bytes(b"conteudo-verdadeiro")
    ligacao = pasta / "cartaz.webp"
    ligacao.symlink_to(real)

    assert _caminho_seguro(pasta, "cartaz.webp") is None, (
        "uma ligação simbólica nunca pode ser servida, mesmo apontando "
        "para um ficheiro de igual nome dentro da própria árvore de pastas"
    )
    # Controlo: o ficheiro real (não a ligação), pedido pelo caminho que
    # `_caminho_seguro` serviria se não fosse uma ligação, continua a
    # servir — prova que a recusa de cima é mesmo do `is_symlink()`, não
    # de as outras duas guardas também recusarem este caminho.
    assert _caminho_seguro(subpasta, "cartaz.webp") == real


def test_nome_que_tenta_fugir_da_pasta_e_recusado(tmp_path: Path) -> None:
    """Um nome com `..` é recusado.

    **Nota, para quem reveja isto:** medido (e reproduzido fora deste
    ficheiro, com as duas versões lado a lado para vários `nome`), quem
    apanha isto hoje é a comparação final de nome
    (`candidato.name != nome`), não o `is_relative_to`: qualquer `nome`
    com `/` ou `..` nunca pode ser igual ao nome **resolvido** (que é
    sempre um nome de ficheiro nu, sem barras). Tirar o `is_relative_to`
    sozinho não muda o resultado de nenhum `nome` que só manipule a
    string — só mudaria para uma fuga por **ligação simbólica**, que o
    `is_symlink()` já recusa primeiro, incondicionalmente, antes de o
    `resolve()` sequer correr. Isto não foi encontrado por acaso — é um
    achado desta própria bateria: uma mutação a apagar só o
    `is_relative_to` não derruba teste nenhum (confirmado, não assumido).
    Fica como defesa em profundidade mesmo assim — se a ordem das três
    guardas alguma vez mudar, deixa de ser redundante — mas hoje não há
    `nome` nenhum que o isole das outras duas.
    """
    from app.services.fotos import _caminho_seguro

    pasta = tmp_path / "pendentes"
    pasta.mkdir()
    fora = tmp_path / "segredo.webp"
    fora.write_bytes(b"conteudo-secreto")

    assert _caminho_seguro(pasta, "../segredo.webp") is None, (
        "um nome que resolva para fora da pasta não pode ser servido — o "
        "`CHECK` da F2-01 devia impedir isto de chegar à base de dados, "
        "mas esta função é a última linha, não a única"
    )


def test_nome_resolvido_diferente_do_pedido_e_recusado(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A comparação final de nome, exata — a guarda de maiúsculas.

    Simulado, não medido num sistema de ficheiros real: o CI corre em
    Linux, sensível a maiúsculas, onde pedir `CARTAZ.webp` já falhava mais
    cedo (`is_file()`), sem nunca chegar à comparação que este teste quer
    prender. `Path.resolve` é substituído para se comportar como um
    sistema de ficheiros que ignora maiúsculas (macOS, Windows) se
    comportaria sozinho.
    """
    from app.services.fotos import _caminho_seguro

    pasta = tmp_path / "pendentes"
    pasta.mkdir()
    (pasta / "cartaz.webp").write_bytes(b"conteudo")

    resolve_original = Path.resolve

    def resolve_que_ignora_maiusculas(
        self: Path, *args: object, **kwargs: object
    ) -> Path:
        resultado = resolve_original(self, *args, **kwargs)
        if resultado.name == "CARTAZ.webp":
            return resultado.with_name("cartaz.webp")
        return resultado

    monkeypatch.setattr(Path, "resolve", resolve_que_ignora_maiusculas)

    assert _caminho_seguro(pasta, "CARTAZ.webp") is None, (
        "o nome resolvido (`cartaz.webp`) é diferente do pedido "
        "(`CARTAZ.webp`) — sem a comparação exata, isto serviria o "
        "ficheiro guardado com outro nome"
    )
