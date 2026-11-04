"""`POST /auth/login`: caminho feliz, corpo inválido e as três falhas indistinguíveis.

| ID | Teste | Esperado |
| --- | --- | --- |
| S-07 | Sexta tentativa de login falhada | 429 com tempo de espera |

(O bloqueio em si, com a máquina de estados completa, vive em
`tests/seguranca/test_s07_bloqueio_apos_cinco_falhas.py`. Este ficheiro
cobre só o que acontece **antes** de se chegar lá: o próprio login.)

Decisão do Tomás, lida à letra do S-07: a 1.ª à 5.ª falha respondem sempre
400 — "credenciais inválidas", igual para todas —, e só a 6.ª vê o
bloqueio. Por isso as três últimas situações abaixo (credenciais erradas,
utilizador inexistente, utilizador existente com password errada) têm de
devolver **exatamente a mesma resposta**: código, estado e frase. Uma
diferença entre elas é uma forma de um atacante distinguir "este
utilizador existe" de "este utilizador não existe" (enumeração de contas)
sem gastar uma tentativa visível de mais.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.apoio_auth import (
    CABECALHO_MUTACAO,
    CREDENCIAIS_FALSAS,
    PASSWORD_ERRADA_DE_EXEMPLO,
    UTILIZADOR_FALSO,
)

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from app.models.admins import Admin


def test_login_com_credenciais_corretas_devolve_200_e_cookie(
    cliente_seguro: TestClient, admin: Admin
) -> None:
    """O caminho feliz: 200, um `Set-Cookie`, e o hash nunca sai na resposta.

    Deixa passar: nada sobre os atributos do cookie — isso é de
    `tests/auth/test_cookie.py`.
    """
    resposta = cliente_seguro.post(
        "/auth/login", json=CREDENCIAIS_FALSAS, headers=CABECALHO_MUTACAO
    )

    assert resposta.status_code == 200, resposta.text
    assert "set-cookie" in resposta.headers
    assert admin.hash_password not in resposta.text, (
        "o hash da password apareceu na resposta do login — nunca deve "
        "sair, nem por acidente num `model_dump()` de mais"
    )


class TestCorpoInvalido:
    """422 no envelope `{"erro", "mensagem"}`, nunca o `{"detail": [...]}` por omissão."""

    @pytest.mark.parametrize(
        "corpo",
        [
            pytest.param({"utilizador": UTILIZADOR_FALSO}, id="sem_password"),
            pytest.param(
                {"password": "qualquer-coisa-de-exemplo"}, id="sem_utilizador"
            ),
            pytest.param({}, id="corpo_vazio"),
            pytest.param({"utilizador": 123, "password": True}, id="tipos_errados"),
        ],
    )
    def test_corpo_invalido_devolve_422_no_envelope(
        self, cliente_seguro: TestClient, corpo: dict[str, object]
    ) -> None:
        resposta = cliente_seguro.post(
            "/auth/login", json=corpo, headers=CABECALHO_MUTACAO
        )

        assert resposta.status_code == 422
        corpo_da_resposta = resposta.json()
        assert set(corpo_da_resposta) == {"erro", "mensagem"}, (
            f"o corpo de um 422 tem de ser o envelope `{{'erro', 'mensagem'}}` "
            f"de `docs/ESPECIFICACAO.md`, não {corpo_da_resposta!r} — o "
            "`{'detail': [...]}` por omissão do FastAPI tem de ser "
            "substituído por um `exception_handler` para `RequestValidationError`"
        )
        assert isinstance(corpo_da_resposta["erro"], str) and corpo_da_resposta["erro"]
        assert (
            isinstance(corpo_da_resposta["mensagem"], str)
            and corpo_da_resposta["mensagem"]
        )


#: As três formas de falhar um login, que a especificação exige
#: indistinguíveis entre si. Módulo, não método: um `@staticmethod` lido
#: dentro do próprio `@pytest.mark.parametrize` da classe (`_cenarios.
#: __func__()`) funciona, mas só por reflexão sobre o descritor — menos
#: direto do que uma constante, para nenhum ganho.
CENARIOS_DE_FALHA: dict[str, dict[str, str]] = {
    "credenciais_totalmente_erradas": {
        "utilizador": "fantasma-um-de-exemplo",
        "password": "password-qualquer-de-exemplo",
    },
    "utilizador_inexistente_com_a_password_certa_de_outra_conta": {
        "utilizador": "fantasma-dois-de-exemplo",
        # A password **certa** do `admin` de apoio: nem acertar a password
        # de outra conta pode distinguir "existe" de "não existe".
        "password": CREDENCIAIS_FALSAS["password"],
    },
    "utilizador_existente_com_password_errada": {
        "utilizador": CREDENCIAIS_FALSAS["utilizador"],
        "password": PASSWORD_ERRADA_DE_EXEMPLO,
    },
}


@pytest.mark.usefixtures("admin")
class TestRespostaIndistinguivelAsFalhas:
    """As três formas de falhar o login não podem dar pistas diferentes."""

    @pytest.mark.parametrize("nome_do_cenario", list(CENARIOS_DE_FALHA))
    def test_cada_falha_devolve_400(
        self, cliente_seguro: TestClient, nome_do_cenario: str
    ) -> None:
        corpo = CENARIOS_DE_FALHA[nome_do_cenario]
        resposta = cliente_seguro.post(
            "/auth/login", json=corpo, headers=CABECALHO_MUTACAO
        )
        assert resposta.status_code == 400

    def test_as_tres_falhas_dao_exatamente_a_mesma_resposta(
        self, cliente_seguro: TestClient
    ) -> None:
        respostas = {
            nome: cliente_seguro.post(
                "/auth/login", json=corpo, headers=CABECALHO_MUTACAO
            )
            for nome, corpo in CENARIOS_DE_FALHA.items()
        }

        codigos = {nome: r.status_code for nome, r in respostas.items()}
        corpos = {nome: r.json() for nome, r in respostas.items()}

        assert set(codigos.values()) == {400}, codigos
        valores_unicos = {tuple(sorted(c.items())) for c in corpos.values()}
        assert len(valores_unicos) == 1, (
            "as três respostas deviam ser idênticas (código e corpo); "
            f"vieram diferentes: {corpos}. Uma diferença aqui é uma forma "
            "de um atacante distinguir 'o utilizador existe' de 'o "
            "utilizador não existe' sem gastar uma tentativa visível a mais"
        )
