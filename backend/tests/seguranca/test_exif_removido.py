"""EXIF removido, testado com uma imagem com GPS (`docs/TAREFAS.md`, F2-06).

Quatro asserções, e a primeira é a que torna o teste honesto: que a
**origem** tem mesmo GPS. Sem ela, uma imagem sem GPS nenhum passava este
teste na mesma — a rede não prendia nada, só provava que um JPEG qualquer
vira WebP.

Medido em Pillow 13.0.0 (ver o plano desta tarefa): o EXIF **sobrevive** a
um `resize()` — `im.info["exif"]` continua lá depois dele. Confiar em
`resize()` + `save()` faria a remoção do EXIF depender do plugin WebP
continuar a ignorar o que lhe passam, e isso muda com uma versão nova do
Pillow sem ninguém pedir (o Dependabot sobe o Pillow sozinho). A única
forma medida que esvazia o `info` por completo é reconstruir a imagem a
partir dos píxeis nus: `Image.frombytes(im.mode, im.size, im.tobytes())`.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

from PIL import Image

from tests import apoio_fotos

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

#: Chaves de `Image.info` que um ficheiro recodificado não pode trazer.
CHAVES_DE_METADADOS = ("exif", "xmp", "icc_profile", "comment")

#: O endereço de GPS do fabrico de `jpeg_com_gps` (ver a receita lá).
ID_GPS_IFD = 0x8825


def test_a_origem_tem_gps_de_verdade() -> None:
    """O guarda deste próprio ficheiro: sem GPS na origem, nada abaixo provaria nada.

    Deixa passar: nada sobre a aplicação — isto só examina a fábrica de
    `tests.apoio_fotos`.
    """
    origem = apoio_fotos.jpeg_com_gps()

    assert b"Exif" in origem, "a fábrica não produziu um JPEG com EXIF nenhum"

    with Image.open(io.BytesIO(origem)) as imagem:
        gps = imagem.getexif().get_ifd(ID_GPS_IFD)
        assert dict(gps), (
            "a imagem de origem não tem um IFD de GPS — o cenário não arma nada"
        )


def test_o_ficheiro_guardado_nao_tem_exif_nem_gps(
    cliente: TestClient, sessao: Session
) -> None:
    """Deixa passar: a redução de tamanho e a qualidade da recodificação."""
    resposta = apoio_fotos.enviar_foto(
        cliente,
        apoio_fotos.jpeg_com_gps(),
        nome_ficheiro="selfie-com-gps.jpg",
        tipo_mime="image/jpeg",
    )
    assert resposta.status_code == 202, resposta.text

    from app.config import obter_definicoes

    pendentes = list(obter_definicoes().pendentes_dir.iterdir())
    assert len(pendentes) == 1, (
        f"esperava um ficheiro em pendentes/, encontrei {pendentes}"
    )
    guardado = pendentes[0]
    bytes_guardados = guardado.read_bytes()

    assert b"Exif" not in bytes_guardados, (
        "os bytes de EXIF sobreviveram à recodificação"
    )

    with Image.open(guardado) as imagem:
        for chave in CHAVES_DE_METADADOS:
            assert chave not in imagem.info, f"{chave!r} sobreviveu em `info`"

        gps_guardado = imagem.getexif().get_ifd(ID_GPS_IFD)
        assert not dict(imagem.getexif()), (
            "o `getexif()` da imagem guardada não está vazio"
        )
        assert not dict(gps_guardado), "o IFD de GPS sobreviveu à recodificação"


def test_a_imagem_entregue_ao_save_ja_vem_sem_metadados() -> None:
    """O que prende o **nosso** mecanismo, e não a boa vontade do plugin WebP.

    **O que os outros testes deste ficheiro deixam passar, medido:** com o
    `Image.frombytes` removido de `app/services/imagens.py` — ou seja,
    confiando só no `convert()` + `thumbnail()` + `save()` — eles **passam
    todos na mesma**. Não porque o nosso código limpe o EXIF, mas porque o
    plugin WebP desta versão do Pillow acaba por não escrever o que lhe
    passam no `info`.

    Isso faz da remoção do EXIF uma propriedade da versão instalada, não
    do nosso código. E o Dependabot sobe o Pillow sozinho: no dia em que o
    plugin mudar de ideias, passamos a publicar as coordenadas GPS da casa
    de quem enviou a foto, com a suite inteira a verde.

    Este teste olha para o outro lado da fronteira: intercepta o `save` e
    afirma que a imagem **entregue** ao codificador já não tem metadados
    nenhuns. Assim, quem decide deixa de ser o plugin.
    """
    from app.services import imagens

    entregues: list[dict[str, object]] = []
    save_original = Image.Image.save

    def save_espiao(self: Image.Image, *args: object, **kwargs: object) -> object:
        entregues.append(dict(self.info))
        return save_original(self, *args, **kwargs)  # type: ignore[arg-type]

    Image.Image.save = save_espiao  # type: ignore[method-assign]
    try:
        imagens.recodificar(apoio_fotos.jpeg_com_gps())
    finally:
        Image.Image.save = save_original  # type: ignore[method-assign]

    assert entregues, (
        "o `save` nunca foi chamado — ou a recodificação mudou de caminho, "
        "ou este espião deixou de o apanhar. Nos dois casos, este teste "
        "deixou de verificar aquilo que diz verificar"
    )
    assert entregues[-1] == {}, (
        "a imagem entregue ao codificador ainda traz metadados: "
        f"{sorted(entregues[-1])}. A limpeza tem de acontecer no nosso "
        "código (`Image.frombytes` sobre os píxeis nus), não ficar à espera "
        "de que o plugin WebP os ignore"
    )
