"""Contas de administração da área de gestão."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.tipos import DataHoraUTC, agora_utc


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Único: é por ele que o `POST /auth/login` procura a conta e é nele
    # que o bloqueio após 5 falhas se guarda. Duas linhas com o mesmo
    # utilizador davam ao atacante duas contas para gastar tentativas.
    utilizador: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    hash_password: Mapped[str] = mapped_column(String(255), nullable=False)
    # `NOT NULL` com omissão 0: em SQL, `NULL + 1` é NULL, e uma conta com
    # este campo a NULL nunca chegava às 5 falhas nem bloqueava. O
    # `server_default` leva o mesmo raciocínio até ao DDL: o
    # `criar_admin.py` da F2-02 pode escrever por SQL cru, onde o
    # `default=` do lado do Python não corre.
    tentativas_falhadas: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    bloqueado_ate: Mapped[datetime | None] = mapped_column(DataHoraUTC, nullable=True)
    # F2-04, decisão do Tomás de 4 de novembro de 2026: a revogação de
    # sessão vive aqui, não numa lista em memória. Um `POST /auth/logout`
    # incrementa este número; o valor assinado no cookie leva a versão que
    # tinha quando foi emitido, e `exigir_admin` compara as duas — se não
    # baterem certo, a sessão não serve, mesmo com assinatura e validade
    # boas. Ao contrário de um conjunto em memória, isto sobrevive a um
    # reinício do processo e é a mesma linha para todos os processos do
    # Passenger que partilhem a base de dados.
    #
    # **O que isto garante, e o que não garante:** o logout termina
    # *todas* as sessões daquele admin, não só a do browser que carregou
    # no botão — com um admin só, por agora, isso não custa nada. O mesmo
    # mecanismo serve, sem coluna nova nenhuma, para a rota de mudar
    # password que falta à especificação (ver `docs/TAREFAS.md`, F2-05):
    # bastaria incrementar `sessao_versao` ao mudar a password, para matar
    # as sessões antigas pela mesma via — não implementado aqui, é da
    # F2-05.
    sessao_versao: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    # `server_default` pela mesma razão que a coluna acima, e não só por
    # simetria: sem ele, o `criar_admin.py` da F2-02 a escrever em SQL
    # cru rebentava aqui — `NOT NULL constraint failed: admins.criado_em`
    # — duas linhas depois de o comentário de cima dizer que esse caminho
    # tem de funcionar.
    criado_em: Mapped[datetime] = mapped_column(
        DataHoraUTC,
        nullable=False,
        default=agora_utc,
        server_default=func.current_timestamp(),
    )
