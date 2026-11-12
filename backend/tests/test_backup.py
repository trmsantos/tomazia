"""`scripts/backup.py` (F2-02): a API de backup do SQLite, e os últimos 30.

Molde de `tests/test_importar_bd_antiga.py`: cada teste corre através de
`tests.apoio_scripts_de_admin.correr_backup`, que chama
`exigir_backup()` antes de lançar nada — por isso toda a bateria falha
com `MENSAGEM_BACKUP_EM_FALTA` enquanto o script não existir.

O critério (`docs/TAREFAS.md`, F2-02): "testado numa BD temporária,
incluindo quando a BD ainda não existe" — e a medição que o acompanha:
`sqlite3.connect()` num caminho inexistente **cria um ficheiro de 0
bytes, sem erro nenhum**. A verificação tem de ser `Path.is_file()`
**antes** de qualquer `connect`; sem isso, o script enche as 30 ranhuras
com cópias de nada.

O contrato do nome dos ficheiros (`tomazia-AAAAMMDDTHHMMSSZ.db`) e o ponto
de extensão do relógio (`TOMAZIA_AGORA_UTC`) estão documentados em
`tests/apoio_scripts_de_admin.py` — lê o cabeçalho de lá antes deste
ficheiro, se faltar contexto.
"""

from __future__ import annotations

import os
import sqlite3
import stat
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from tests.apoio_esquema import tabelas_de_negocio
from tests.apoio_scripts_de_admin import (
    RAIZ_BACKEND,
    ambiente_backup,
    carregar_script,
    correr_backup,
    correr_com_stdin_devnull,
    e_nome_de_backup,
    exigir_backup,
    ficheiros_parciais,
    nome_de_backup,
)

#: O instante "agora" fixo destes testes — nunca o relógio de parede. Longe
#: de qualquer DST português (ver `app/tempo.py`/ADR 0010): não é isso que
#: aqui se testa.
AGORA_DE_TESTE = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)


def _ligar_so_leitura(caminho: Path) -> object:
    import sqlite3

    return sqlite3.connect(f"file:{caminho}?mode=ro", uri=True)


def _integrity_check_ok(caminho: Path) -> bool:
    ligacao = _ligar_so_leitura(caminho)
    try:
        (resultado,) = ligacao.execute("PRAGMA integrity_check").fetchone()  # type: ignore[attr-defined]
        return str(resultado).lower() == "ok"
    finally:
        ligacao.close()  # type: ignore[attr-defined]


def _um_ficheiro_de_backup(pasta: Path) -> Path:
    candidatos = [f for f in pasta.iterdir() if e_nome_de_backup(f.name)]
    assert len(candidatos) == 1, (
        f"esperava exatamente um ficheiro de backup em {pasta}, encontrei "
        f"{[c.name for c in candidatos]}"
    )
    return candidatos[0]


# --- O caminho feliz: uma BD em `head` --------------------------------------


def test_bd_em_head_copia_integra_com_as_mesmas_tabelas(
    bd_em_head: Path, tmp_path: Path
) -> None:
    """`PRAGMA integrity_check` dá `ok`, **e** o mesmo conjunto de tabelas.

    O `integrity_check` sozinho não chega — uma base de dados vazia também
    passa. E compara **conjuntos** de nomes de tabela, não uma contagem
    fixa: a próxima migração que acrescente uma tabela não pode partir
    este teste.
    """
    pasta_de_backups = tmp_path / "dados" / "backups"
    resultado = correr_backup(
        origem_bd=bd_em_head, data_dir=tmp_path / "dados", agora_utc=AGORA_DE_TESTE
    )
    assert resultado.estado == 0, resultado.relatorio()

    copia = _um_ficheiro_de_backup(pasta_de_backups)
    assert _integrity_check_ok(copia), resultado.relatorio()
    assert tabelas_de_negocio(copia) == tabelas_de_negocio(bd_em_head), (
        resultado.relatorio()
    )


# --- A BD de origem não existe, ou não é utilizável -------------------------


def test_bd_inexistente_recusa_e_a_origem_continua_a_nao_existir(
    tmp_path: Path,
) -> None:
    """O guarda do ficheiro de 0 bytes: a razão de o critério nomear este caso.

    `sqlite3.connect()` num caminho inexistente cria um ficheiro de 0
    bytes sem erro nenhum — e um `tomazia.db` de 0 bytes em produção abre
    lindamente e dá 500 em todas as rotas. A verificação de
    `Path.is_file()` tem de vir **antes** de qualquer `connect`.
    """
    origem = tmp_path / "origem" / "nao-existe.db"
    assert not origem.exists()
    pasta_de_backups = tmp_path / "dados" / "backups"

    resultado = correr_backup(
        origem_bd=origem, data_dir=tmp_path / "dados", agora_utc=AGORA_DE_TESTE
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert not origem.exists(), (
        "a origem passou a existir depois da corrida — é exatamente o "
        f"ficheiro de 0 bytes que o `sqlite3.connect()` cria sozinho\n"
        f"{resultado.relatorio()}"
    )
    assert not pasta_de_backups.exists() or not list(pasta_de_backups.iterdir()), (
        f"nada devia ter sido escrito: {resultado.relatorio()}"
    )


def test_bd_com_0_bytes_recusa_com_frase_propria(tmp_path: Path) -> None:
    """Existe, mas está vazia — uma recusa diferente da do ficheiro ausente."""
    origem = tmp_path / "origem" / "vazia.db"
    origem.parent.mkdir(parents=True, exist_ok=True)
    origem.touch()
    assert origem.stat().st_size == 0
    pasta_de_backups = tmp_path / "dados" / "backups"

    resultado = correr_backup(
        origem_bd=origem, data_dir=tmp_path / "dados", agora_utc=AGORA_DE_TESTE
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert not pasta_de_backups.exists() or not list(pasta_de_backups.iterdir()), (
        resultado.relatorio()
    )

    inexistente = correr_backup(
        origem_bd=tmp_path / "origem" / "mesmo-nao-existe.db",
        data_dir=tmp_path / "dados-b",
        agora_utc=AGORA_DE_TESTE,
    )
    assert resultado.tudo != inexistente.tudo, (
        "a recusa de uma BD com 0 bytes é igual à de uma BD ausente — as "
        f"duas têm de se distinguir\n{resultado.relatorio()}\n---\n"
        f"{inexistente.relatorio()}"
    )


def test_bd_que_nao_e_sqlite_recusa_com_outra_frase(tmp_path: Path) -> None:
    """Existe, tem bytes, mas não é SQLite nenhum — outra recusa ainda."""
    origem = tmp_path / "origem" / "nao-e-sqlite.db"
    origem.parent.mkdir(parents=True, exist_ok=True)
    origem.write_bytes(b"isto nao e uma base de dados SQLite\n" * 10)
    pasta_de_backups = tmp_path / "dados" / "backups"

    resultado = correr_backup(
        origem_bd=origem, data_dir=tmp_path / "dados", agora_utc=AGORA_DE_TESTE
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert (
        "Não parece uma base de dados SQLite. Confirma a BASE_DADOS_URL."
        in resultado.stdout
    ), resultado.relatorio()
    assert "eu saiba" not in resultado.stdout, resultado.relatorio()
    assert not pasta_de_backups.exists() or not list(pasta_de_backups.iterdir()), (
        resultado.relatorio()
    )


def test_pasta_de_backups_sem_permissao_de_escrita_recusa(tmp_path: Path) -> None:
    """A pasta existe mas não deixa escrever — recusa nomeada, sem traceback.

    Medido na revisão: o `sqlite3.OperationalError` do `connect(parcial)` não
    é um `OSError`, e o script saía por «Rebentei a meio», com traceback.
    """
    if os.geteuid() == 0:
        pytest.skip(
            "a correr como root as permissões de ficheiro não se aplicam — "
            "skip visível (regra 10): 'não corri' não é 'passou'"
        )

    data_dir = tmp_path / "dados"
    pasta_de_backups = data_dir / "backups"
    pasta_de_backups.mkdir(parents=True)
    pasta_de_backups.chmod(0o500)
    try:
        resultado = correr_backup(
            origem_bd=_construir_origem_minima(tmp_path / "origem.db"),
            data_dir=data_dir,
            agora_utc=AGORA_DE_TESTE,
        )
        assert resultado.estado != 0, resultado.relatorio()
        assert "Não escrevi backup nenhum." in resultado.stdout, resultado.relatorio()
        assert "permissão de escrita" in resultado.stdout, resultado.relatorio()
        assert "disco não está cheio" in resultado.stdout, resultado.relatorio()
        assert "Rebentei" not in resultado.tudo, resultado.relatorio()
        assert "Erro inesperado" not in resultado.tudo, resultado.relatorio()
        assert "Traceback" not in resultado.tudo, resultado.relatorio()
    finally:
        pasta_de_backups.chmod(0o755)
    assert ficheiros_parciais(pasta_de_backups) == []


def test_pasta_de_backups_que_nao_se_pode_criar_recusa(tmp_path: Path) -> None:
    """O `mkdir` também está dentro do bloco protegido."""
    if os.geteuid() == 0:
        pytest.skip("root ignora as permissões: skip visível (regra 10)")

    data_dir = tmp_path / "dados"
    data_dir.mkdir()
    data_dir.chmod(0o500)
    try:
        resultado = correr_backup(
            origem_bd=_construir_origem_minima(tmp_path / "origem.db"),
            data_dir=data_dir,
            agora_utc=AGORA_DE_TESTE,
        )
        assert resultado.estado != 0, resultado.relatorio()
        assert "Não escrevi backup nenhum." in resultado.stdout, resultado.relatorio()
        assert "Traceback" not in resultado.tudo, resultado.relatorio()
    finally:
        data_dir.chmod(0o755)


def test_origem_numa_pasta_ilegivel_nao_e_dada_como_inexistente(
    tmp_path: Path,
) -> None:
    """Regra 10: "não consegui ver" não é "não existe".

    Em Python 3.13+ o `Path.is_file()` engole o `PermissionError`; o script
    usa `stat()` para os dois casos terem frases diferentes em 3.11 a 3.14.
    """
    if os.geteuid() == 0:
        pytest.skip("root ignora as permissões: skip visível (regra 10)")

    origem = _construir_origem_minima(tmp_path / "origem" / "tomazia.db")
    pasta_mae = origem.parent
    pasta_mae.chmod(0o000)
    try:
        ilegivel = correr_backup(
            origem_bd=origem,
            data_dir=tmp_path / "dados",
            agora_utc=AGORA_DE_TESTE,
            isolamento=tmp_path,  # o `.env` inexistente fica fora da pasta trancada
        )
    finally:
        pasta_mae.chmod(0o755)
    ausente = correr_backup(
        origem_bd=tmp_path / "origem" / "nao-existe.db",
        data_dir=tmp_path / "dados-b",
        agora_utc=AGORA_DE_TESTE,
    )

    assert ilegivel.estado != 0, ilegivel.relatorio()
    assert "Traceback" not in ilegivel.tudo, ilegivel.relatorio()
    assert "Não consegui verificar" in ilegivel.stdout, ilegivel.relatorio()
    assert "não existe" not in ilegivel.stdout, ilegivel.relatorio()
    assert "não existe" in ausente.stdout, ausente.relatorio()


def _construir_origem_minima(caminho: Path) -> Path:
    import sqlite3

    caminho.parent.mkdir(parents=True, exist_ok=True)
    ligacao = sqlite3.connect(caminho)
    try:
        ligacao.execute("CREATE TABLE t (x INTEGER)")
        ligacao.commit()
    finally:
        ligacao.close()
    return caminho


# --- Dados só no `-wal`: a razão de não poder ser um `shutil.copyfile` -----


def test_dados_so_no_wal_entram_na_copia(tmp_path: Path) -> None:
    """Escreve e faz `commit` **sem checkpoint**; a cópia tem de trazer a linha.

    Um `shutil.copyfile` falha este teste: copia só o ficheiro principal, e
    com os dados ainda no `-wal` (a ligação que escreveu continua aberta,
    de propósito, até depois da corrida) o ficheiro principal, sozinho,
    não tem a tabela nem a linha nenhuma. É isto que impede alguém de
    "simplificar" a API de backup do SQLite para um `cp`.
    """
    import sqlite3

    origem = tmp_path / "origem" / "tomazia.db"
    origem.parent.mkdir(parents=True, exist_ok=True)
    ligacao = sqlite3.connect(origem)
    ligacao.execute("PRAGMA journal_mode=WAL")
    ligacao.execute("CREATE TABLE marcador (valor TEXT)")
    ligacao.execute("INSERT INTO marcador (valor) VALUES (?)", ("so-no-wal-f2-02",))
    ligacao.commit()
    # Sem fechar `ligacao`: fechar é o que deixaria o SQLite consolidar o
    # `-wal` sozinho, e o teste deixaria de provar nada.
    try:
        pasta_de_backups = tmp_path / "dados" / "backups"
        resultado = correr_backup(
            origem_bd=origem, data_dir=tmp_path / "dados", agora_utc=AGORA_DE_TESTE
        )
        assert resultado.estado == 0, resultado.relatorio()

        copia = _um_ficheiro_de_backup(pasta_de_backups)
        destino_leitura = sqlite3.connect(f"file:{copia}?mode=ro", uri=True)
        try:
            linhas = destino_leitura.execute("SELECT valor FROM marcador").fetchall()
        finally:
            destino_leitura.close()
        assert linhas == [("so-no-wal-f2-02",)], (
            f"os dados só no -wal não chegaram à cópia: {resultado.relatorio()}"
        )
    finally:
        ligacao.close()


# --- Rotação: 30 ficheiros, por nome ----------------------------------------


def test_rotacao_mantem_30_mais_recentes_por_nome_e_ignora_outros_ficheiros(
    tmp_path: Path,
) -> None:
    """35 backups falsos + uma corrida real → 30 exatos, os mais recentes por nome.

    Um `README.txt` e um `backup-manual.db` ficam — não são backups deste
    script, e contá-los (ou apagá-los) seria tratar qualquer ficheiro da
    pasta como seu.
    """
    data_dir = tmp_path / "dados"
    pasta_de_backups = data_dir / "backups"
    pasta_de_backups.mkdir(parents=True)

    base = datetime(2026, 1, 1, tzinfo=UTC)
    antigos = [nome_de_backup(base + timedelta(days=indice)) for indice in range(35)]
    for nome in antigos:
        (pasta_de_backups / nome).write_bytes(b"backup falso, nao e sqlite")

    (pasta_de_backups / "README.txt").write_text("não mexer\n")
    (pasta_de_backups / "backup-manual.db").write_bytes(b"copia manual do dono")

    origem = _construir_origem_minima(tmp_path / "origem.db")
    # Depois de todos os antigos por nome, para a corrida real ficar entre
    # os 30 mantidos.
    agora = base + timedelta(days=100)
    resultado = correr_backup(origem_bd=origem, data_dir=data_dir, agora_utc=agora)
    assert resultado.estado == 0, resultado.relatorio()

    ficheiros = sorted(f.name for f in pasta_de_backups.iterdir())
    backups_presentes = sorted(f for f in ficheiros if e_nome_de_backup(f))
    assert len(backups_presentes) == 30, (
        f"esperava 30 backups, ficaram {len(backups_presentes)}: "
        f"{backups_presentes}\n{resultado.relatorio()}"
    )

    nome_da_corrida_real = nome_de_backup(agora)
    assert nome_da_corrida_real in backups_presentes, (
        "a cópia desta corrida não está entre as mantidas — a rotação "
        f"descartou a mais recente de todas\n{resultado.relatorio()}"
    )

    esperados = sorted(antigos + [nome_da_corrida_real])[-30:]
    assert backups_presentes == esperados, (
        f"os 30 mantidos não são os 30 mais recentes por nome: "
        f"{backups_presentes}\n{resultado.relatorio()}"
    )

    assert "README.txt" in ficheiros, "um ficheiro que não é backup desapareceu"
    assert "backup-manual.db" in ficheiros, (
        "um backup manual (nome fora do padrão) desapareceu"
    )
    assert ficheiros_parciais(pasta_de_backups) == []


def test_nome_ja_existente_recusa_e_nao_sobrescreve(tmp_path: Path) -> None:
    """Duas corridas com o mesmo `TOMAZIA_AGORA_UTC` → a segunda recusa.

    Determinístico de propósito (ver o cabeçalho de
    `tests/apoio_scripts_de_admin.py`): sem o relógio injetável, isto só se
    testaria com uma corrida real a calhar no mesmo segundo que outra — uma
    corrida de facto, não um teste.
    """
    data_dir = tmp_path / "dados"
    origem = _construir_origem_minima(tmp_path / "origem.db")

    primeira = correr_backup(
        origem_bd=origem, data_dir=data_dir, agora_utc=AGORA_DE_TESTE
    )
    assert primeira.estado == 0, primeira.relatorio()

    pasta_de_backups = data_dir / "backups"
    nome = nome_de_backup(AGORA_DE_TESTE)
    conteudo_antes = (pasta_de_backups / nome).read_bytes()

    segunda = correr_backup(
        origem_bd=origem, data_dir=data_dir, agora_utc=AGORA_DE_TESTE
    )
    assert segunda.estado != 0, (
        f"a segunda corrida, com o mesmo instante, tinha de recusar: "
        f"{segunda.relatorio()}"
    )
    assert (
        f"Já existe um backup chamado {nome} em {pasta_de_backups}. Não o "
        "substituo. Espera um segundo e corre outra vez."
    ) in segunda.stdout, segunda.relatorio()
    assert "corridas" not in segunda.stdout, segunda.relatorio()
    assert (pasta_de_backups / nome).read_bytes() == conteudo_antes, (
        f"o backup existente foi sobrescrito: {segunda.relatorio()}"
    )
    assert ficheiros_parciais(pasta_de_backups) == []


def test_nenhum_ficheiro_parcial_sobra_em_caminho_nenhum(tmp_path: Path) -> None:
    """Nem no caminho feliz, nem numa recusa a meio, fica um `*.parcial`.

    Uma escrita atómica (criar à parte, `os.rename` no fim) é o que
    garante isto — e é o que protege a rotação de deixar a pasta de
    backups com um ficheiro a meio escrever se o processo for interrompido.
    """
    data_dir = tmp_path / "dados"
    origem = _construir_origem_minima(tmp_path / "origem.db")

    resultado = correr_backup(
        origem_bd=origem, data_dir=data_dir, agora_utc=AGORA_DE_TESTE
    )
    assert resultado.estado == 0, resultado.relatorio()
    assert ficheiros_parciais(data_dir / "backups") == []
    assert ficheiros_parciais(data_dir) == []

    recusa = correr_backup(
        origem_bd=tmp_path / "nao-existe.db",
        data_dir=tmp_path / "dados-recusa",
        agora_utc=AGORA_DE_TESTE,
    )
    assert recusa.estado != 0, recusa.relatorio()
    assert ficheiros_parciais(tmp_path / "dados-recusa" / "backups") == []


# --- O que as revisões da F2-02 acrescentaram -------------------------------


def test_sem_ambiente_recusa_e_nada_escreve(bd_em_head: Path, tmp_path: Path) -> None:
    """`AMBIENTE` é obrigatório — o script recusa antes de escrever seja o que for."""
    data_dir = tmp_path / "dados"
    ambiente = ambiente_backup(bd_em_head, data_dir=data_dir, agora_utc=AGORA_DE_TESTE)
    ambiente.pop("AMBIENTE")

    resultado = correr_com_stdin_devnull(
        exigir_backup(), [], cwd=RAIZ_BACKEND, ambiente=ambiente
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert "Não escrevi backup nenhum." in resultado.stdout, resultado.relatorio()
    assert "Traceback" not in resultado.tudo, resultado.relatorio()
    assert not data_dir.exists(), resultado.relatorio()


def test_pasta_e_ficheiros_so_para_o_dono(tmp_path: Path) -> None:
    """Os backups têm hashes: pasta a 0o700, ficheiros a 0o600 (item 8)."""
    data_dir = tmp_path / "dados"
    resultado = correr_backup(
        origem_bd=_construir_origem_minima(tmp_path / "origem.db"),
        data_dir=data_dir,
        agora_utc=AGORA_DE_TESTE,
    )
    assert resultado.estado == 0, resultado.relatorio()

    pasta = data_dir / "backups"
    assert stat.S_IMODE(pasta.stat().st_mode) == 0o700
    copia = _um_ficheiro_de_backup(pasta)
    assert stat.S_IMODE(copia.stat().st_mode) == 0o600


def test_pasta_ja_existente_com_modo_aberto_passa_a_0o700(tmp_path: Path) -> None:
    data_dir = tmp_path / "dados"
    pasta = data_dir / "backups"
    pasta.mkdir(parents=True)
    pasta.chmod(0o755)

    resultado = correr_backup(
        origem_bd=_construir_origem_minima(tmp_path / "origem.db"),
        data_dir=data_dir,
        agora_utc=AGORA_DE_TESTE,
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert stat.S_IMODE(pasta.stat().st_mode) == 0o700


def test_o_parcial_de_outra_execucao_nao_e_apagado(tmp_path: Path) -> None:
    """O nome do `.parcial` é único por execução (item 7).

    Com um nome só por segundo, duas execuções no mesmo segundo apagavam o
    `.parcial` uma da outra. Aqui um `.parcial` com o nome antigo (o de
    outra execução) tem de sobreviver a esta.
    """
    data_dir = tmp_path / "dados"
    pasta = data_dir / "backups"
    pasta.mkdir(parents=True)
    alheio = pasta / f"{nome_de_backup(AGORA_DE_TESTE)}.parcial"
    alheio.write_bytes(b"a meio, de outra execucao")

    resultado = correr_backup(
        origem_bd=_construir_origem_minima(tmp_path / "origem.db"),
        data_dir=data_dir,
        agora_utc=AGORA_DE_TESTE,
    )

    assert resultado.estado == 0, resultado.relatorio()
    assert alheio.read_bytes() == b"a meio, de outra execucao", resultado.relatorio()
    assert (pasta / nome_de_backup(AGORA_DE_TESTE)).is_file()


def test_origem_que_desaparece_nao_cria_ficheiro_nenhum(tmp_path: Path) -> None:
    """A origem abre-se só em leitura (item 5): nunca cria um ficheiro de 0 bytes."""
    modulo: Any = carregar_script(exigir_backup())
    origem = tmp_path / "desapareceu.db"
    parcial = tmp_path / "copia.parcial"

    with pytest.raises(sqlite3.Error):
        modulo.copiar_e_verificar(origem, parcial)

    assert not origem.exists(), "o `connect` criou a origem"
    assert not parcial.exists(), "o `connect` criou o parcial"

    with pytest.raises(sqlite3.Error):
        modulo._problema_da_copia(
            _construir_origem_minima(tmp_path / "outra.db"), origem
        )
    assert not origem.exists(), "a verificação criou a origem"


def test_tabelas_diferentes_listam_se_com_virgulas_e_sem_repr_de_python(
    tmp_path: Path,
) -> None:
    modulo: Any = carregar_script(exigir_backup())
    copia = _construir_origem_minima(tmp_path / "copia.db")  # tabela t
    origem = tmp_path / "origem.db"
    ligacao = sqlite3.connect(origem)
    ligacao.execute("CREATE TABLE a (x INTEGER)")
    ligacao.execute("CREATE TABLE b (x INTEGER)")
    ligacao.commit()
    ligacao.close()

    problema = modulo._problema_da_copia(copia, origem)

    assert problema is not None
    assert problema == (
        "A cópia não tem as mesmas tabelas que a base de dados original "
        "(cópia: t; original: a, b). Não a guardei. Corre o script outra vez."
    )


def test_relogio_invalido_diz_o_que_fazer(bd_em_head: Path, tmp_path: Path) -> None:
    resultado = correr_backup(
        origem_bd=bd_em_head,
        data_dir=tmp_path / "dados",
        ambiente_extra={"TOMAZIA_AGORA_UTC": "nao-e-uma-data"},
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert "unset TOMAZIA_AGORA_UTC" in resultado.stdout, resultado.relatorio()
    assert "Só os testes a usam" in resultado.stdout, resultado.relatorio()


def test_origem_inexistente_manda_confirmar_a_configuracao(tmp_path: Path) -> None:
    resultado = correr_backup(
        origem_bd=tmp_path / "nao-existe.db",
        data_dir=tmp_path / "dados",
        agora_utc=AGORA_DE_TESTE,
    )

    assert "não existe" in resultado.stdout, resultado.relatorio()
    assert "BASE_DADOS_URL" in resultado.stdout, resultado.relatorio()
    assert "AMBIENTE" in resultado.stdout, resultado.relatorio()
    assert "connect" not in resultado.stdout, resultado.relatorio()


def test_relatorio_final_e_a_poda_em_portugues(tmp_path: Path) -> None:
    data_dir = tmp_path / "dados"
    pasta = data_dir / "backups"
    pasta.mkdir(parents=True)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for indice in range(32):
        (pasta / nome_de_backup(base + timedelta(days=indice))).write_bytes(b"x")

    resultado = correr_backup(
        origem_bd=_construir_origem_minima(tmp_path / "origem.db"),
        data_dir=data_dir,
        agora_utc=base + timedelta(days=100),
    )

    assert resultado.estado == 0, resultado.relatorio()
    linhas = [linha for linha in resultado.stdout.splitlines() if linha.strip()]
    assert linhas[-2] == "Cópias antigas eliminadas: 3 (guardo as 30 mais recentes).", (
        resultado.relatorio()
    )
    assert linhas[-1].startswith("Backup feito: "), resultado.relatorio()
    copia = pasta / nome_de_backup(base + timedelta(days=100))
    assert resultado.stdout.count(str(copia)) == 1, resultado.relatorio()
    assert "apagad" not in resultado.stdout.lower(), resultado.relatorio()


def test_aviso_da_poda_diz_que_o_backup_foi_feito(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Se a poda falha, o backup já está feito: o aviso diz as duas coisas."""
    modulo: Any = carregar_script(exigir_backup())
    pasta = tmp_path / "dados" / "backups"
    pasta.mkdir(parents=True)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for indice in range(31):
        (pasta / nome_de_backup(base + timedelta(days=indice))).write_bytes(b"x")
    _construir_origem_minima(tmp_path / "origem.db")
    monkeypatch.setenv("BASE_DADOS_URL", f"sqlite:///{tmp_path / 'origem.db'}")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "dados"))
    monkeypatch.setenv("TOMAZIA_AGORA_UTC", (base + timedelta(days=100)).isoformat())

    def _nao_deixa(self: Path, *, missing_ok: bool = False) -> None:
        raise PermissionError(13, "Permission denied", str(self))

    monkeypatch.setattr(Path, "unlink", _nao_deixa)
    from app.config import obter_definicoes

    obter_definicoes.cache_clear()

    estado = modulo.fazer_backup()

    saida = capsys.readouterr().out
    assert estado == 0
    assert "Aviso: o backup foi feito, mas não consegui eliminar" in saida, saida
    assert "apagar" not in saida.lower(), saida


def test_erro_inesperado_diz_que_e_defeito_e_garante_as_copias_anteriores() -> None:
    modulo: Any = carregar_script(exigir_backup())

    frase = modulo.conclusao_do_rebentamento(ValueError("x"))

    assert frase.startswith(
        "Erro inesperado (ValueError): é um defeito do script, não uma recusa. "
        "O detalhe está acima e o traceback a seguir."
    ), frase
    assert "cópias anteriores ficam intactas" in frase, frase
    for jargao in ("Rebentei", "ranhuras", "stderr"):
        assert jargao not in frase, frase


def test_ajuda_e_erros_em_portugues(tmp_path: Path) -> None:
    ambiente = ambiente_backup(tmp_path / "x.db", data_dir=tmp_path / "dados")
    ajuda = correr_com_stdin_devnull(
        exigir_backup(), ["--help"], cwd=RAIZ_BACKEND, ambiente=ambiente
    )
    assert ajuda.estado == 0, ajuda.relatorio()
    assert "uso:" in ajuda.stdout, ajuda.relatorio()
    assert "usage:" not in ajuda.stdout, ajuda.relatorio()
    assert (
        "Faz uma cópia de segurança da base de dados (BASE_DADOS_URL) para "
        "DATA_DIR/backups e mantém as 30 mais recentes."
    ) in " ".join(ajuda.stdout.split()), ajuda.relatorio()

    errado = correr_com_stdin_devnull(
        exigir_backup(), ["--nada"], cwd=RAIZ_BACKEND, ambiente=ambiente
    )
    assert errado.estado == 2, errado.relatorio()
    assert errado.stderr.count("Erro: ") == 1, errado.relatorio()
    assert "unrecognized" not in errado.stderr, errado.relatorio()


def test_url_que_nao_e_sqlite_manda_confirmar_a_configuracao(
    bd_em_head: Path, tmp_path: Path
) -> None:
    resultado = correr_backup(
        origem_bd=bd_em_head,
        data_dir=tmp_path / "dados",
        ambiente_extra={
            "BASE_DADOS_URL": "postgresql://alguem:segredo-xyz@servidor/bd"
        },
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert resultado.stdout.startswith("A BASE_DADOS_URL não aponta"), (
        resultado.relatorio()
    )
    assert "Confirma a configuração (e o AMBIENTE)." in resultado.stdout
    assert "segredo-xyz" not in resultado.tudo, resultado.relatorio()


# --- Terceira volta -----------------------------------------------------------


def test_integridade_falhada_diz_so_o_que_o_dono_precisa(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    modulo: Any = carregar_script(exigir_backup())

    class _Ligacao:
        def execute(self, *_a: object) -> _Ligacao:
            return self

        def fetchone(self) -> tuple[str]:
            return ("pagina 2 corrompida",)

        def close(self) -> None:
            pass

    monkeypatch.setattr(sqlite3, "connect", lambda *_a, **_k: _Ligacao())

    problema = modulo._problema_da_copia(tmp_path / "x.parcial", tmp_path / "o.db")

    assert problema == (
        "A cópia falhou a verificação de integridade: pagina 2 corrompida. "
        "Não a guardei e a base de dados original não foi tocada. Corre o "
        "script outra vez."
    )


def test_o_que_sobra_da_limpeza_manda_eliminar_a_mao(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    modulo: Any = carregar_script(exigir_backup())

    def _nao_deixa(self: Path, *, missing_ok: bool = False) -> None:
        raise PermissionError(13, "Permission denied", str(self))

    monkeypatch.setattr(Path, "unlink", _nao_deixa)

    frase = modulo._limpar_parcial(tmp_path / "x.parcial")

    assert frase is not None
    assert frase.endswith(
        "Elimina esses ficheiros à mão na pasta de backups (não são cópias válidas)."
    ), frase


def test_falha_do_chmod_da_pasta_e_um_aviso_e_o_backup_continua(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    modulo: Any = carregar_script(exigir_backup())
    origem = _construir_origem_minima(tmp_path / "origem.db")
    dados = tmp_path / "dados"
    dados.mkdir()
    pasta = dados / "backups"

    def _nao_deixa(self: Path, mode: int) -> None:
        raise PermissionError(1, "Operation not permitted", str(self))

    monkeypatch.setattr(Path, "chmod", _nao_deixa)

    problema = modulo._escrever_backup(origem, pasta, "tomazia-20260301T120000Z.db")

    saida = capsys.readouterr().out
    assert problema is None, problema
    assert (pasta / "tomazia-20260301T120000Z.db").is_file()
    assert (
        f"Aviso: não consegui restringir as permissões de {pasta} (Errno 1"
    ) in saida.replace("[", "").replace("]", ""), saida
    assert saida.strip().endswith("o backup continua."), saida


def test_data_dir_em_falta_recusa_e_nao_o_cria(
    bd_em_head: Path, tmp_path: Path
) -> None:
    data_dir = tmp_path / "dados-que-nao-existem"

    resultado = correr_backup(
        origem_bd=bd_em_head,
        data_dir=data_dir,
        agora_utc=AGORA_DE_TESTE,
        criar_data_dir=False,
    )

    assert resultado.estado != 0, resultado.relatorio()
    assert (
        f"A pasta de dados {data_dir} não existe. Confirma o DATA_DIR e o AMBIENTE."
    ) in resultado.stdout, resultado.relatorio()
    assert resultado.stdout.rstrip().endswith("Não escrevi backup nenhum.")
    assert "Traceback" not in resultado.tudo, resultado.relatorio()
    assert not data_dir.exists(), resultado.relatorio()
