"""F4-04b: retirar uma foto aprovada é eliminá-la, e cada falha diz a verdade (ADR 0022).

`DELETE /gestao/fotos/{id}` apaga o ficheiro de `MEDIA_DIR` e a linha, por
esta ordem fixada pelo ADR 0022: `DELETE` condicional da linha (a ler o
`rowcount`) -> `unlink` com a transação ainda aberta -> `commit`.

Duas famílias de teste:

1. **Fronteira.** Sem sessão 401 nas duas rotas novas; sem `X-Tomazia` 403 e
   nada muda (nem a linha nem o ficheiro); depois do 204 o ficheiro deixou de
   existir em `MEDIA_DIR` e a foto saiu do `GET /galeria`; `ip_hash` nunca
   sai na lista. (Não há rota `/media/...` na app: quem serve `media/` é o
   Apache; "deixa de servir" prova-se por o ficheiro deixar de existir.)
2. **Regra 10** (`CLAUDE.md`): "o ficheiro já não estava lá" e "não consegui
   apagá-lo" nunca podem dar o mesmo resultado. Cada ramo tem um teste que
   falha se for trocado pelo outro:

   | situação                              | resposta                  | linha        |
   | ------------------------------------- | ------------------------- | ------------ |
   | ficheiro ausente (`FileNotFoundError`) | 204                       | eliminada    |
   | `PermissionError` no `unlink`         | 500 `foto_nao_eliminada`  | fica aprovada|
   | nome fora de `PADRAO_NOME_DE_FICHEIRO`| 500 `foto_nao_eliminada`  | fica aprovada|
   | `commit` a falhar                     | o erro sobe               | fica; 2º DELETE dá 204 |

**Pontos de extensão que estes testes pressupõem** (o implementador não
precisa de mais nenhum):

- o `unlink` passa por `os.unlink`, `os.remove` ou `Path.unlink` (os três são
  interceptados aqui, só para o ficheiro da foto);
- o `commit` é o de `sqlalchemy.orm.Session` (interceptado na classe);
- a lista é `GET /gestao/fotos/aprovadas` com `{"fotos": [...]}`.
"""

from __future__ import annotations

import os
import pathlib
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from tests.apoio_auth import CABECALHO_MUTACAO
from tests.apoio_fotos import semear_foto

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine
    from sqlalchemy.orm import Session

ID = 4001
OUTRO_ID = 4002


def _estado_na_bd(motor: Engine, id_foto: int) -> str | None:
    """O `estado` lido por uma ligação nova (a `sessao` de semear não veria a escrita da app)."""
    with motor.connect() as ligacao:
        linha = ligacao.execute(
            text("SELECT estado FROM fotos WHERE id = :i"), {"i": id_foto}
        ).first()
    return None if linha is None else str(linha[0])


def _em_media(nome: str) -> pathlib.Path:
    from app.config import obter_definicoes

    return obter_definicoes().media_dir / nome


def _apagar(cliente: TestClient, id_foto: int, **extra: Any) -> Any:
    return cliente.delete(
        f"/gestao/fotos/{id_foto}", headers=CABECALHO_MUTACAO, **extra
    )


def _falhar_o_unlink_de(
    monkeypatch: pytest.MonkeyPatch,
    nome: str,
    erro: Callable[[], OSError],
    *,
    ao_chamar: Callable[[], None] | None = None,
) -> list[str]:
    """Faz `os.unlink`, `os.remove` e `Path.unlink` falharem só para o ficheiro `nome`.

    Qualquer outro caminho (as limpezas de teste, a BD) segue para o original.
    Devolve a lista dos caminhos pedidos a `nome`, para provar que houve (ou
    não) tentativa.
    """
    chamadas: list[str] = []
    original_unlink = os.unlink
    original_remove = os.remove
    original_path_unlink = pathlib.Path.unlink

    def alvo(caminho: Any) -> bool:
        return bool(os.path.basename(os.fspath(caminho)) == nome)

    def falso_unlink(caminho: Any, *args: Any, **kwargs: Any) -> None:
        if alvo(caminho):
            chamadas.append(os.fspath(caminho))
            if ao_chamar is not None:
                ao_chamar()
            raise erro()
        original_unlink(caminho, *args, **kwargs)

    def falso_remove(caminho: Any, *args: Any, **kwargs: Any) -> None:
        if alvo(caminho):
            chamadas.append(os.fspath(caminho))
            if ao_chamar is not None:
                ao_chamar()
            raise erro()
        original_remove(caminho, *args, **kwargs)

    def falso_path_unlink(self: pathlib.Path, *args: Any, **kwargs: Any) -> None:
        if alvo(self):
            chamadas.append(os.fspath(self))
            if ao_chamar is not None:
                ao_chamar()
            raise erro()
        original_path_unlink(self, *args, **kwargs)

    monkeypatch.setattr(os, "unlink", falso_unlink)
    monkeypatch.setattr(os, "remove", falso_remove)
    monkeypatch.setattr(pathlib.Path, "unlink", falso_path_unlink)
    return chamadas


# --------------------------------------------------------------------------
# Fronteira
# --------------------------------------------------------------------------


class TestFronteira:
    def test_sem_sessao_as_duas_rotas_dao_401_e_nada_muda(
        self, cliente: TestClient, sessao: Session, motor: Engine
    ) -> None:
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")

        lista = cliente.get("/gestao/fotos/aprovadas")
        assert lista.status_code == 401, lista.text
        apagar = _apagar(cliente, ID)
        assert apagar.status_code == 401, apagar.text

        assert _estado_na_bd(motor, ID) == "aprovada"
        assert _em_media(nome).is_file()

    def test_sem_x_tomazia_e_403_e_linha_e_ficheiro_ficam(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")

        resposta = sessao_de_admin.delete(f"/gestao/fotos/{ID}")

        assert resposta.status_code == 403, resposta.text
        assert resposta.json()["erro"] == "cabecalho_x_tomazia_em_falta"
        assert _estado_na_bd(motor, ID) == "aprovada"
        assert _em_media(nome).is_file()

    def test_204_apaga_o_ficheiro_a_linha_e_a_foto_sai_da_galeria(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")
        outro = semear_foto(sessao, id_foto=OUTRO_ID, estado="aprovada")
        assert {f["id"] for f in sessao_de_admin.get("/galeria").json()["fotos"]} == {
            ID,
            OUTRO_ID,
        }

        resposta = _apagar(sessao_de_admin, ID)

        assert resposta.status_code == 204, resposta.text
        assert resposta.content == b""
        assert not _em_media(nome).exists(), "o ficheiro tem de deixar de existir"
        assert _estado_na_bd(motor, ID) is None
        galeria = sessao_de_admin.get("/galeria").json()["fotos"]
        assert [f["id"] for f in galeria] == [OUTRO_ID]
        assert _estado_na_bd(motor, OUTRO_ID) == "aprovada"
        assert _em_media(outro).is_file(), "só o ficheiro pedido pode ir embora"

    def test_a_lista_nunca_traz_ip_hash(
        self, sessao_de_admin: TestClient, sessao: Session
    ) -> None:
        semear_foto(sessao, id_foto=ID, estado="aprovada", descricao="Noite")

        resposta = sessao_de_admin.get("/gestao/fotos/aprovadas")

        assert resposta.status_code == 200, resposta.text
        assert len(resposta.json()["fotos"]) == 1, "o teste não provava nada sem fotos"
        assert "ip_hash" not in resposta.text
        assert "hash-falso-de-ip" not in resposta.text


# --------------------------------------------------------------------------
# Regra 10: "já não estava lá" != "não consegui apagar"
# --------------------------------------------------------------------------


class TestRegra10:
    def test_ficheiro_ja_ausente_da_204_e_a_linha_sai(
        self, sessao_de_admin: TestClient, sessao: Session, motor: Engine
    ) -> None:
        """Se o ramo `FileNotFoundError` passasse a erro, isto ficava 500."""
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada", com_ficheiro=False)
        assert not _em_media(nome).exists()

        resposta = _apagar(sessao_de_admin, ID)

        assert resposta.status_code == 204, resposta.text
        assert _estado_na_bd(motor, ID) is None
        assert [f["id"] for f in sessao_de_admin.get("/galeria").json()["fotos"]] == []

    def test_permissionerror_no_unlink_da_500_e_a_linha_fica(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao_de_admin: TestClient,
        sessao: Session,
        motor: Engine,
    ) -> None:
        """Se o ramo "qualquer outro OSError" fosse tratado como ausente, a linha ia embora."""
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")
        chamadas = _falhar_o_unlink_de(
            monkeypatch, nome, lambda: PermissionError("simulado: sem permissões")
        )

        resposta = _apagar(sessao_de_admin, ID)

        assert chamadas, (
            "o `unlink` do ficheiro nunca foi tentado: o teste não prova nada"
        )
        assert resposta.status_code == 500, resposta.text
        corpo = resposta.json()
        assert corpo["erro"] == "foto_nao_eliminada"
        assert isinstance(corpo["mensagem"], str)
        assert corpo["mensagem"].strip()
        assert _estado_na_bd(motor, ID) == "aprovada", (
            "o ficheiro não se apagou: a linha tem de ficar para o dono tentar outra vez"
        )
        assert [f["id"] for f in sessao_de_admin.get("/galeria").json()["fotos"]] == [
            ID
        ]

    def test_filenotfound_no_unlink_continua_a_ser_204(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao_de_admin: TestClient,
        sessao: Session,
        motor: Engine,
    ) -> None:
        """O ficheiro desaparece entre ver e apagar: é o mesmo que ausente, não erro."""
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")
        chamadas = _falhar_o_unlink_de(
            monkeypatch, nome, lambda: FileNotFoundError("simulado: já não está lá")
        )

        resposta = _apagar(sessao_de_admin, ID)

        assert chamadas, (
            "o `unlink` do ficheiro nunca foi tentado: o teste não prova nada"
        )
        assert resposta.status_code == 204, resposta.text
        assert _estado_na_bd(motor, ID) is None

    @pytest.mark.parametrize(
        "nome",
        [
            "00000000-0000-4000-8000-000000004001.webp",
            "A" * 32 + ".webp",
            "a" * 31 + ".webp",
            "a" * 32 + ".jpg",
        ],
        ids=["uuid-com-tracos", "maiusculas", "curto", "extensao"],
    )
    def test_nome_fora_do_padrao_da_500_e_nada_muda(
        self,
        sessao_de_admin: TestClient,
        sessao: Session,
        motor: Engine,
        nome: str,
    ) -> None:
        """Um nome que não bate com o padrão nunca chega ao disco, e não é "ausente"."""
        semear_foto(sessao, id_foto=ID, estado="aprovada", ficheiro=nome)
        assert _em_media(nome).is_file()

        resposta = _apagar(sessao_de_admin, ID)

        assert resposta.status_code == 500, resposta.text
        assert resposta.json()["erro"] == "foto_nao_eliminada"
        assert _estado_na_bd(motor, ID) == "aprovada"
        assert _em_media(nome).is_file(), "um nome estranho nunca se apaga"

    def test_nome_fora_do_padrao_nem_tenta_o_unlink(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao_de_admin: TestClient,
        sessao: Session,
    ) -> None:
        nome = "00000000-0000-4000-8000-000000004001.webp"
        semear_foto(sessao, id_foto=ID, estado="aprovada", ficheiro=nome)
        chamadas = _falhar_o_unlink_de(
            monkeypatch, nome, lambda: PermissionError("não devia chegar aqui")
        )

        resposta = _apagar(sessao_de_admin, ID)

        assert resposta.status_code == 500, resposta.text
        assert chamadas == [], "o nome fora do padrão chegou ao `unlink`"

    def test_o_unlink_corre_com_a_transacao_aberta(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao_de_admin: TestClient,
        sessao: Session,
        motor: Engine,
    ) -> None:
        """ADR 0022: o `commit` é depois do `unlink`.

        No instante do `unlink`, uma ligação nova ainda vê a linha (nada foi
        confirmado). Numa ordem "commit primeiro" já a veria apagada.
        """
        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")
        vistos: list[str | None] = []

        def espreitar() -> None:
            vistos.append(_estado_na_bd(motor, ID))

        # O `unlink` simulado falha, mas aqui só interessa quando é chamado;
        # um segundo pedido, sem falha, prova que o fluxo normal continua.
        chamadas = _falhar_o_unlink_de(
            monkeypatch,
            nome,
            lambda: PermissionError("simulado"),
            ao_chamar=espreitar,
        )

        resposta = _apagar(sessao_de_admin, ID)

        assert resposta.status_code == 500, resposta.text
        assert chamadas, "o `unlink` nunca foi tentado"
        assert vistos == ["aprovada"], (
            "no instante do `unlink` a linha já não estava visível para outra ligação: "
            "o `commit` correu antes do `unlink`"
        )

    def test_commit_a_falhar_deixa_a_linha_e_o_segundo_delete_da_204(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao_de_admin: TestClient,
        sessao: Session,
        motor: Engine,
    ) -> None:
        """ADR 0022, ponto 3: o ficheiro já se foi, a linha fica, repetir resolve."""
        from sqlalchemy.orm import Session as SessaoOrm

        nome = semear_foto(sessao, id_foto=ID, estado="aprovada")
        original_commit = SessaoOrm.commit

        def commit_a_falhar(self: Any) -> None:
            raise OperationalError("COMMIT", {}, Exception("database is locked"))

        with monkeypatch.context() as parcial:
            parcial.setattr(SessaoOrm, "commit", commit_a_falhar)
            with pytest.raises(OperationalError):
                _apagar(sessao_de_admin, ID)

        assert SessaoOrm.commit is original_commit
        assert not _em_media(nome).exists(), "o `unlink` corre antes do `commit`"
        assert _estado_na_bd(motor, ID) == "aprovada", (
            "o `commit` falhou: a linha não pode ter ido embora"
        )

        segunda = _apagar(sessao_de_admin, ID)

        assert segunda.status_code == 204, segunda.text
        assert _estado_na_bd(motor, ID) is None

    def test_pendente_nunca_chega_ao_unlink(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sessao_de_admin: TestClient,
        sessao: Session,
        motor: Engine,
    ) -> None:
        """Sem linha apanhada pelo `DELETE` condicional, nenhum ficheiro é tocado."""
        nome = semear_foto(sessao, id_foto=ID, estado="pendente")
        chamadas = _falhar_o_unlink_de(
            monkeypatch, nome, lambda: PermissionError("não devia chegar aqui")
        )

        resposta = _apagar(sessao_de_admin, ID)

        assert resposta.status_code == 409, resposta.text
        assert chamadas == []
        assert _estado_na_bd(motor, ID) == "pendente"
