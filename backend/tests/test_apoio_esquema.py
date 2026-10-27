"""O apoio de `tests/apoio_esquema.py` testado contra si próprio.

Duas das peças que fecham o buraco estrutural da F2-01 vivem lá e não têm
teste de comportamento nenhum a exercitá-las por acidente:

- `exigir_destino_sem_vestigios`, a sonda que impede a cópia da base de
  dados-modelo de ser feita por cima de sidecars de outra base de dados. É
  um guarda que, com o projeto no estado de hoje, **nunca dispara** — e um
  guarda que nunca dispara é indistinguível de um `pass` até alguém o
  forçar. É o que estes testes fazem.
- `indices`, que passou a comparar colunas e unicidade depois de se medir
  que comparar só `(nome, tabela)` deixava passar um índice com a coluna
  trocada e tornado `UNIQUE`.
"""

from __future__ import annotations

import sqlite3
import stat
from pathlib import Path

import pytest

from tests import apoio_esquema


def _bd_vazia(caminho: Path) -> Path:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    ligacao = sqlite3.connect(caminho)
    try:
        ligacao.execute("CREATE TABLE produtos (id INTEGER PRIMARY KEY, a INT, b INT)")
        ligacao.commit()
    finally:
        ligacao.close()
    return caminho


class TestExigirDestinoSemVestigios:
    def test_aceita_um_caminho_livre(self, tmp_path: Path) -> None:
        """O controlo de sucesso falso: sem nada lá, não se queixa.

        Sem isto, um `exigir_destino_sem_vestigios` que rebentasse sempre
        deixava os testes de baixo verdes e tornava a fixture `motor`
        impossível de usar.
        """
        apoio_esquema.exigir_destino_sem_vestigios(tmp_path / "livre.db")

    def test_rebenta_com_o_ficheiro_principal_ja_la(self, tmp_path: Path) -> None:
        destino = _bd_vazia(tmp_path / "ocupado.db")

        with pytest.raises(RuntimeError) as informacao:
            apoio_esquema.exigir_destino_sem_vestigios(destino)

        assert "ocupado.db" in str(informacao.value)

    @pytest.mark.parametrize("sufixo", apoio_esquema.SUFIXOS_SIDECAR)
    def test_rebenta_com_um_sidecar_la_sem_o_ficheiro_principal(
        self, tmp_path: Path, sufixo: str
    ) -> None:
        """O caso que importa, e o que o `copyfile` **não** corrige.

        O ficheiro principal não existe — a cópia ia escrevê-lo de raiz e
        parecia tudo bem. O que sobrevive é o sidecar: um `-wal` de outra
        base de dados em cima do mesmo caminho faz o SQLite ler um estado
        que não é o do ficheiro acabado de escrever, e dados de um teste
        aparecem no seguinte sem nada no caminho a dizê-lo.
        """
        destino = tmp_path / "sem-principal.db"
        sidecar = destino.with_name(destino.name + sufixo)
        sidecar.write_bytes(b"restos de outra base de dados")

        assert not destino.exists()

        with pytest.raises(RuntimeError) as informacao:
            apoio_esquema.exigir_destino_sem_vestigios(destino)

        assert sufixo in str(informacao.value), (
            f"a mensagem não nomeia o sidecar {sufixo}:\n{informacao.value}"
        )


class TestBaseDeDadosModelo:
    def test_fica_so_de_leitura_e_a_copia_continua_a_ser_escrevivel(
        self, tmp_path: Path
    ) -> None:
        """A BD-modelo é para copiar, nunca para abrir.

        A fixture `_bd_construida_pelo_alembic` devolve o mesmo caminho a
        todos os testes da sessão. Um teste futuro que lhe chame
        `criar_engine` — que força o WAL — escrevia-lhe no cabeçalho e
        deixava sidecars, e todas as cópias seguintes saíam contaminadas.
        Com `0444` isso passa a ser um erro em voz alta.

        As duas metades seguintes são o que torna a primeira segura de
        manter: o `copyfile` só lê a fonte, e o destino nasce com
        permissões próprias.
        """
        modelo = apoio_esquema.construir_bd_com_alembic(
            tmp_path / "modelo" / "esquema.db"
        )

        assert stat.S_IMODE(modelo.stat().st_mode) == 0o444

        ligacao = sqlite3.connect(modelo)
        try:
            # Ler continua a funcionar: é para isso que o ficheiro serve.
            assert apoio_esquema.tabelas_de_negocio(modelo)
            with pytest.raises(sqlite3.OperationalError) as informacao:
                ligacao.execute("CREATE TABLE intruso_de_exemplo (id INTEGER)")
                ligacao.commit()
        finally:
            ligacao.close()

        assert "readonly" in str(informacao.value).lower()

        copia = tmp_path / "copia.db"
        copia.write_bytes(modelo.read_bytes())
        ligacao_da_copia = sqlite3.connect(copia)
        try:
            ligacao_da_copia.execute(
                "INSERT INTO definicoes (chave, valor) "
                "VALUES ('wifi_rede', 'Rede de exemplo')"
            )
            ligacao_da_copia.commit()
        finally:
            ligacao_da_copia.close()

    def test_o_0444_no_ficheiro_nao_chega_contra_o_criar_engine(
        self, tmp_path: Path
    ) -> None:
        """Medido: com a pasta escrevível, `criar_engine` abre a BD-modelo e deixa sidecars.

        É o cenário que a fixture `_bd_construida_pelo_alembic` existe para
        fechar — um teste futuro que abra a base de dados-modelo em vez de
        a copiar. O `0444` que `construir_bd_com_alembic` põe no ficheiro
        impede escritas no ficheiro principal, mas **criar o `-wal` e o
        `-shm` depende das permissões da pasta**, não das do ficheiro.

        Este teste prende as duas metades da medição, porque é a diferença
        entre elas que justifica o `chmod(0o555)` na fixture. Sem ele, o
        `0444` sozinho parecia resolver o problema e não resolvia.
        """
        from app.db import criar_engine

        pasta = tmp_path / "modelo"
        modelo = apoio_esquema.construir_bd_com_alembic(pasta / "esquema.db")

        # Metade 1: pasta escrevível — abre à mesma e deixa sidecars.
        motor = criar_engine(f"sqlite:///{modelo}")
        try:
            with motor.connect() as ligacao:
                ligacao.exec_driver_sql("SELECT 1")
        finally:
            motor.dispose()

        assert apoio_esquema.sidecars_de(modelo), (
            "o `criar_engine` sobre a BD-modelo não deixou sidecars: se o "
            "SQLite mudou, o `chmod(0o555)` da fixture pode ter deixado de "
            "ser necessário — vale a pena reler a decisão antes de o tirar"
        )
        for sidecar in apoio_esquema.sidecars_de(modelo):
            sidecar.unlink()

        # Metade 2: pasta só de leitura — a mesma abertura rebenta.
        pasta.chmod(0o555)
        try:
            motor = criar_engine(f"sqlite:///{modelo}")
            erro: BaseException | None = None
            try:
                with motor.connect() as ligacao:
                    ligacao.exec_driver_sql("SELECT 1")
            except Exception as excecao:
                erro = excecao
            finally:
                motor.dispose()

            assert erro is not None, (
                "com a pasta a 0555, o `criar_engine` sobre a BD-modelo "
                "continuou a abrir: a proteção da fixture não vale nada"
            )
            assert "readonly" in str(erro).lower(), (
                f"rebentou, mas não por ser só de leitura:\n{erro}"
            )
            assert not apoio_esquema.sidecars_de(modelo)
        finally:
            # Reposto sempre, senão o `tmp_path` do pytest não se limpa.
            pasta.chmod(0o755)


class TestIndices:
    def _criar_indice(self, caminho: Path, instrucao: str) -> Path:
        _bd_vazia(caminho)
        ligacao = sqlite3.connect(caminho)
        try:
            ligacao.execute(instrucao)
            ligacao.commit()
        finally:
            ligacao.close()
        return caminho

    def test_distingue_a_coluna_indexada(self, tmp_path: Path) -> None:
        """Dois índices com o mesmo nome e colunas diferentes não são iguais.

        É a mutação que a versão anterior de `indices` deixava passar: a
        coluna trocada, o nome mantido, e `esquema_normalizado` a dizer que
        os dois esquemas eram o mesmo.
        """
        por_a = self._criar_indice(
            tmp_path / "a.db", "CREATE INDEX ix_produtos_x ON produtos (a)"
        )
        por_b = self._criar_indice(
            tmp_path / "b.db", "CREATE INDEX ix_produtos_x ON produtos (b)"
        )

        assert apoio_esquema.indices(por_a) != apoio_esquema.indices(por_b)
        assert apoio_esquema.indices(por_a) == {
            ("ix_produtos_x", "produtos", 0, 0, ("a",))
        }

    def test_distingue_a_unicidade(self, tmp_path: Path) -> None:
        """O mesmo nome e a mesma coluna, mas um é `UNIQUE`.

        A diferença entre "procura depressa" e "proíbe repetidos" é toda a
        diferença, e não se vê no nome.
        """
        simples = self._criar_indice(
            tmp_path / "simples.db", "CREATE INDEX ix_produtos_x ON produtos (a)"
        )
        unico = self._criar_indice(
            tmp_path / "unico.db", "CREATE UNIQUE INDEX ix_produtos_x ON produtos (a)"
        )

        assert apoio_esquema.indices(simples) != apoio_esquema.indices(unico)
        assert apoio_esquema.indices(unico) == {
            ("ix_produtos_x", "produtos", 1, 0, ("a",))
        }

    def test_distingue_a_ordem_das_colunas_e_o_where(self, tmp_path: Path) -> None:
        """Um índice composto por outra ordem serve outras consultas; um parcial cobre outras linhas."""
        ab = self._criar_indice(
            tmp_path / "ab.db", "CREATE INDEX ix_produtos_x ON produtos (a, b)"
        )
        ba = self._criar_indice(
            tmp_path / "ba.db", "CREATE INDEX ix_produtos_x ON produtos (b, a)"
        )
        parcial = self._criar_indice(
            tmp_path / "parcial.db",
            "CREATE INDEX ix_produtos_x ON produtos (a, b) WHERE b IS NOT NULL",
        )

        assert apoio_esquema.indices(ab) != apoio_esquema.indices(ba)
        assert apoio_esquema.indices(ab) != apoio_esquema.indices(parcial)
        assert apoio_esquema.indices(ab) == {
            ("ix_produtos_x", "produtos", 0, 0, ("a", "b"))
        }
        assert apoio_esquema.indices(parcial) == {
            ("ix_produtos_x", "produtos", 0, 1, ("a", "b"))
        }

    def test_ignora_os_autoindex_que_o_sqlite_cria_sozinho(
        self, tmp_path: Path
    ) -> None:
        """Os `sqlite_autoindex_*` não entram: o nome deles muda com a ordem do DDL.

        O que eles representam já está comparado em `restricoes_nomeadas`.
        Sem esta exclusão, trocar a ordem de duas `UniqueConstraint` no
        modelo — que não muda nada — deixava a comparação de esquemas
        vermelha.
        """
        caminho = tmp_path / "com-unique.db"
        caminho.parent.mkdir(parents=True, exist_ok=True)
        ligacao = sqlite3.connect(caminho)
        try:
            ligacao.execute(
                "CREATE TABLE produtos (id INTEGER PRIMARY KEY, a INT UNIQUE)"
            )
            ligacao.commit()
        finally:
            ligacao.close()

        assert apoio_esquema.indices(caminho) == set()
