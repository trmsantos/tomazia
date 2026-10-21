"""`.github/scripts/auditar-npm.sh`: a auditoria de dependências do frontend nunca pode dizer "limpo" sem ter auditado nada.

Sem número S-NN: não há um critério na especificação
(`docs/ESPECIFICACAO.md`) para a auditoria de dependências em si — é
higiene de CI, não um requisito do produto. Por isso este ficheiro não
segue a convenção `test_sNN_<descricao>.py` dos outros testes desta
pasta, mas vive aqui porque é exatamente o mesmo género de guarda: um
script que o CI corre e que tem de falhar quando diz que falha.

O `.github/scripts/auditar-npm.sh` deriva `FRONTEND_DIR` e `ALLOWLIST` a
partir do seu PRÓPRIO caminho (`${SCRIPT_DIR}/../..`), não de argumentos
nem de variáveis de ambiente — por isso estes testes nunca invocam o
script real no sítio onde ele vive. Em vez disso, cada teste monta uma
raiz de repositório falsa, completa, dentro de `tmp_path`
(`.github/scripts/auditar-npm.sh` copiado do script real,
`.github/auditoria-npm-permitidas.json` com o conteúdo que o teste
quiser, `frontend/` vazia) e corre a cópia a partir daí. Nada disto toca
no repositório real, e a allowlist real (`braces`/Tailwind) nunca entra
em jogo.

Sem rede nenhuma: um `npm` falso (um script de shell que imprime o JSON
escolhido e sai com o código escolhido) é posto à frente no `PATH` do
subprocesso. É isso que dá controlo total sobre os três relatórios
deformados que motivam este ficheiro — um `npm audit` real não os
produz em condições normais, só quando o registo está em baixo, o
relatório vem de uma versão futura do npm, ou alguém o reproduziu à mão
para o revisor-seguranca, como aqui.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

RAIZ_REPO = Path(__file__).resolve().parents[3]
SCRIPT_REAL = RAIZ_REPO / ".github" / "scripts" / "auditar-npm.sh"

CONTEUDO_FICHEIRO_FALSO = "conteudo falso, nunca dados reais\n"


def _preparar_raiz_falsa(tmp_path: Path, allowlist: list[dict[str, str]]) -> Path:
    """Monta uma raiz de repositório falsa, com a mesma forma relativa que o script espera.

    O script calcula `RAIZ_REPO`/`FRONTEND_DIR`/`ALLOWLIST` a partir do
    seu próprio caminho (`${SCRIPT_DIR}/../..`); a única forma de o
    controlar nos testes é dar-lhe uma cópia de si mesmo dentro de uma
    árvore `.github/scripts/...` falsa, nunca a do repositório real.
    """
    raiz = tmp_path / "raiz-falsa"
    (raiz / ".github" / "scripts").mkdir(parents=True)
    (raiz / "frontend").mkdir(parents=True)

    script_copiado = raiz / ".github" / "scripts" / "auditar-npm.sh"
    shutil.copy2(SCRIPT_REAL, script_copiado)
    script_copiado.chmod(0o755)

    allowlist_ficheiro = raiz / ".github" / "auditoria-npm-permitidas.json"
    allowlist_ficheiro.write_text(
        json.dumps(allowlist, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return raiz


def _instalar_npm_falso(tmp_path: Path, saida_json: str, estado_npm: int) -> Path:
    """Escreve um `npm` falso numa pasta de `tmp_path`, a pôr à frente no `PATH`.

    Ignora os argumentos (`audit --json --audit-level=high`): imprime
    sempre o JSON dado e sai sempre com o estado dado. É o único ponto
    de controlo sobre o que o script vê como "relatório do npm audit".
    """
    bin_falso = tmp_path / "bin-falso"
    bin_falso.mkdir(exist_ok=True)
    npm_falso = bin_falso / "npm"
    npm_falso.write_text(
        "#!/usr/bin/env bash\n"
        "cat <<'EOF_NPM_FALSO'\n"
        f"{saida_json}\n"
        "EOF_NPM_FALSO\n"
        f"exit {estado_npm}\n",
        encoding="utf-8",
    )
    npm_falso.chmod(0o755)
    return bin_falso


def _correr(raiz: Path, bin_falso: Path) -> subprocess.CompletedProcess[str]:
    """Invoca a cópia do script por subprocesso, com o `npm` falso à frente no `PATH`."""
    script = raiz / ".github" / "scripts" / "auditar-npm.sh"
    ambiente = os.environ.copy()
    ambiente["PATH"] = f"{bin_falso}{os.pathsep}{ambiente.get('PATH', '')}"
    # Nunca escrever no resumo real do GitHub Actions de quem corre os
    # testes, mesmo que estes corram dentro de um workflow de verdade.
    ambiente.pop("GITHUB_STEP_SUMMARY", None)
    ambiente.pop("GITHUB_ACTIONS", None)
    return subprocess.run(
        [str(script)],
        cwd=raiz,
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=15,
    )


def _preparar_cenario(
    tmp_path: Path,
    *,
    allowlist: list[dict[str, str]],
    saida_json: str,
    estado_npm: int,
) -> subprocess.CompletedProcess[str]:
    raiz = _preparar_raiz_falsa(tmp_path, allowlist)
    bin_falso = _instalar_npm_falso(tmp_path, saida_json, estado_npm)
    return _correr(raiz, bin_falso)


def _relatorio_com_advisory_alto(ghsa_id: str) -> str:
    """Relatório mínimo, na forma real do `npm audit --json`, com um único advisory 'high'."""
    return json.dumps(
        {
            "vulnerabilities": {
                "pacote-x": {
                    "name": "pacote-x",
                    "severity": "high",
                    "via": [
                        {
                            "source": 12345,
                            "name": "pacote-x",
                            "dependency": "pacote-x",
                            "title": "Vulnerabilidade falsa, só para teste",
                            "url": f"https://github.com/advisories/{ghsa_id}",
                            "severity": "high",
                            "range": "<9.9.9",
                        }
                    ],
                    "effects": [],
                    "range": "<9.9.9",
                    "nodes": ["node_modules/pacote-x"],
                    "fixAvailable": False,
                }
            },
            "metadata": {
                "vulnerabilities": {
                    "info": 0,
                    "low": 0,
                    "moderate": 0,
                    "high": 1,
                    "critical": 0,
                    "total": 1,
                }
            },
        }
    )


# --- Caminho feliz: confirma que o arnês em si funciona ---


def test_relatorio_limpo_sem_allowlist_sai_0(tmp_path: Path) -> None:
    saida_json = json.dumps(
        {
            "vulnerabilities": {},
            "metadata": {
                "vulnerabilities": {
                    "info": 0,
                    "low": 0,
                    "moderate": 0,
                    "high": 0,
                    "critical": 0,
                    "total": 0,
                }
            },
        }
    )
    resultado = _preparar_cenario(
        tmp_path, allowlist=[], saida_json=saida_json, estado_npm=0
    )

    assert resultado.returncode == 0, resultado.stdout + resultado.stderr


# --- Três formas de o relatório dizer "auditei zero" sem ter auditado nada ---


def test_erro_de_rede_no_relatorio_nao_pode_sair_0(tmp_path: Path) -> None:
    """`npm audit --json` falhou a aceder ao registo: `{"error": {...}}`, JSON válido, mas não é um relatório.

    Sem este guarda, o filtro de advisories não encontra `.vulnerabilities`
    nenhuma (não existe), e o script concluiria "nenhum advisory fora da
    allowlist" quando a auditoria, de facto, nunca correu.
    """
    saida_json = json.dumps(
        {
            "error": {
                "code": "ENETUNREACH",
                "summary": "network timeout at: https://registry.npmjs.org/",
            }
        }
    )
    resultado = _preparar_cenario(
        tmp_path, allowlist=[], saida_json=saida_json, estado_npm=1
    )

    assert resultado.returncode != 0, resultado.stdout + resultado.stderr


def test_advisory_critico_sem_url_nao_pode_sair_0(tmp_path: Path) -> None:
    """Um nó `via` crítico sem `.url` faz o `jq` abortar a extrair advisories; esse aborto não pode virar "zero".

    `(.url | sub(".*/advisories/"; ""))` sobre um `.url` em falta (`null`)
    é um erro de tipo no `jq`, não um valor vazio — sem verificar o
    estado dessa chamada, o advisory crítico desapareceria em silêncio.
    """
    saida_json = json.dumps(
        {
            "vulnerabilities": {
                "pacote-sem-url": {
                    "name": "pacote-sem-url",
                    "severity": "critical",
                    "via": [
                        {
                            "source": 99999,
                            "name": "pacote-sem-url",
                            "dependency": "pacote-sem-url",
                            "title": "Advisory falso sem url, para teste",
                            "severity": "critical",
                            "range": "<1.0.0",
                        }
                    ],
                    "effects": [],
                    "range": "<1.0.0",
                    "nodes": ["node_modules/pacote-sem-url"],
                    "fixAvailable": False,
                }
            },
            "metadata": {
                "vulnerabilities": {
                    "info": 0,
                    "low": 0,
                    "moderate": 0,
                    "high": 0,
                    "critical": 1,
                    "total": 1,
                }
            },
        }
    )
    resultado = _preparar_cenario(
        tmp_path, allowlist=[], saida_json=saida_json, estado_npm=1
    )

    assert resultado.returncode != 0, resultado.stdout + resultado.stderr


def test_relatorio_sem_metadata_nao_pode_sair_0(tmp_path: Path) -> None:
    """Um relatório de forma diferente (`{}`, ou uma versão futura do `auditReportVersion`) lê zero advisories — tem de falhar, não de passar.

    `.metadata.vulnerabilities.total` existe em todo o relatório real do
    `npm audit --json`, mesmo com zero vulnerabilidades; a falta dele é o
    sinal de que o formato mudou, não de que está tudo limpo.
    """
    saida_json = json.dumps({})
    resultado = _preparar_cenario(
        tmp_path, allowlist=[], saida_json=saida_json, estado_npm=0
    )

    assert resultado.returncode != 0, resultado.stdout + resultado.stderr


# --- O processo nem sequer correu: nenhum relatório, nenhum estado conhecido ---


def test_npm_morto_sem_relatorio_nenhum_nao_pode_sair_0(tmp_path: Path) -> None:
    """Um `npm` que morre (ou nem existe) sai com um estado fora de `{0, 1}` e não imprime relatório nenhum.

    Cenário realista de um binário em falta no runner ou de um processo
    morto a meio — nunca "sem vulnerabilidades". Só 0 (limpo) e 1
    (vulnerabilidades encontradas) são estados conhecidos do `npm
    audit`; 127 é o que a shell devolve para "comando não encontrado".
    """
    resultado = _preparar_cenario(tmp_path, allowlist=[], saida_json="", estado_npm=127)

    assert resultado.returncode != 0, resultado.stdout + resultado.stderr


# --- Comportamento normal da allowlist: advisory, validade, entrada órfã ---


def test_advisory_alto_fora_da_allowlist_sai_1(tmp_path: Path) -> None:
    saida_json = _relatorio_com_advisory_alto("GHSA-aaaa-bbbb-cccc")

    resultado = _preparar_cenario(
        tmp_path, allowlist=[], saida_json=saida_json, estado_npm=1
    )

    assert resultado.returncode == 1, resultado.stdout + resultado.stderr
    assert "GHSA-aaaa-bbbb-cccc" in resultado.stdout + resultado.stderr


def test_advisory_alto_coberto_pela_allowlist_sai_0(tmp_path: Path) -> None:
    saida_json = _relatorio_com_advisory_alto("GHSA-aaaa-bbbb-cccc")
    allowlist = [
        {
            "id": "GHSA-aaaa-bbbb-cccc",
            "pacote": "pacote-x",
            "severidade": "high",
            "razao": "Falso, só para teste: simula uma vulnerabilidade sem correção disponível.",
            "validade": "2099-12-31",
            "sai-quando": "Nunca sai: entrada falsa de teste.",
        }
    ]

    resultado = _preparar_cenario(
        tmp_path, allowlist=allowlist, saida_json=saida_json, estado_npm=1
    )

    assert resultado.returncode == 0, resultado.stdout + resultado.stderr


def test_entrada_allowlist_expirada_sai_1_mesmo_cobrindo_o_advisory_certo(
    tmp_path: Path,
) -> None:
    """Uma entrada com `validade` no passado sai `1`, mesmo que cubra exatamente o advisory encontrado.

    A validade é o travão contra uma isenção que apodrece para sempre: o
    advisory estar coberto não chega, a cobertura tem de estar em dia.
    """
    saida_json = _relatorio_com_advisory_alto("GHSA-aaaa-bbbb-cccc")
    allowlist = [
        {
            "id": "GHSA-aaaa-bbbb-cccc",
            "pacote": "pacote-x",
            "severidade": "high",
            "razao": "Falso, só para teste.",
            "validade": "2000-01-01",
            "sai-quando": "Nunca sai: entrada falsa de teste, propositadamente expirada.",
        }
    ]

    resultado = _preparar_cenario(
        tmp_path, allowlist=allowlist, saida_json=saida_json, estado_npm=1
    )

    assert resultado.returncode == 1, resultado.stdout + resultado.stderr


def test_entrada_allowlist_orfa_avisa_mas_sai_0(tmp_path: Path) -> None:
    """Uma entrada da allowlist que já não corresponde a advisory nenhum avisa, mas não pode ficar vermelha.

    Comportamento deliberado, aprovado pelo arquiteto e pelo
    revisor-seguranca: um PR do Dependabot que resolva a vulnerabilidade
    não pode ficar vermelho só por sobrar uma linha na allowlist — é o
    par exato do teste da validade expirada, acima: a validade é o
    travão que impede esta linha de sobrar para sempre sem revisão.
    Não "corrijas" este sair-0 sem perceberes os dois testes juntos.
    """
    saida_json = json.dumps(
        {
            "vulnerabilities": {},
            "metadata": {
                "vulnerabilities": {
                    "info": 0,
                    "low": 0,
                    "moderate": 0,
                    "high": 0,
                    "critical": 0,
                    "total": 0,
                }
            },
        }
    )
    allowlist = [
        {
            "id": "GHSA-zzzz-zzzz-zzzz",
            "pacote": "pacote-ja-corrigido",
            "severidade": "high",
            "razao": "Falso, só para teste: simula uma entrada que sobrou depois de o Dependabot corrigir a vulnerabilidade.",
            "validade": "2099-12-31",
            "sai-quando": "Já saiu: esta entrada devia ser removida da allowlist.",
        }
    ]

    resultado = _preparar_cenario(
        tmp_path, allowlist=allowlist, saida_json=saida_json, estado_npm=0
    )

    assert resultado.returncode == 0, resultado.stdout + resultado.stderr
    assert "GHSA-zzzz-zzzz-zzzz" in resultado.stdout + resultado.stderr
    assert "::warning" in resultado.stdout + resultado.stderr
