// @vitest-environment node
/**
 * F3-08, secção 3: o script `ferramentas/gerar-marca.py` é reprodutível e os
 * ficheiros versionados em `public/` são exatamente o que ele gera.
 *
 * **Como:** corre o script duas vezes para duas pastas em `tmpdir()` (o script
 * aceita a pasta de saída como argumento; sem argumento escreve em
 * `public/`, como o PR o documenta) e compara os SHA-256 dos sete ficheiros:
 * 1.ª corrida == 2.ª corrida, e ambas == o que está versionado em `public/`.
 * **Nunca escreve em `public/`**: outros testes leem-no e fazem `vite build`
 * (que o copia) em paralelo, e reescrevê-lo daqui dava leituras truncadas.
 *
 * **Regra 10:** falta do `uv`, script em falta ou saída diferente de 0 dão
 * mensagens próprias — nunca passam por "iguais". **CI:** o job `frontend`
 * precisa do passo `astral-sh/setup-uv`; sem ele este teste falha, e deve
 * falhar: não se salta em silêncio.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { FICHEIROS_GERADOS } from "../testes/marca";
import { RAIZ_FRONTEND, RAIZ_REPOSITORIO } from "../testes/percorrer-arvore";

const SCRIPT = join(RAIZ_FRONTEND, "ferramentas", "gerar-marca.py");
const ORIGINAL = join(RAIZ_REPOSITORIO, "docs", "marca", "tomazia-original.png");

const pastas: string[] = [];

afterAll(() => {
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
});

function impressoes(pastaBase: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const ficheiro of FICHEIROS_GERADOS) {
    const caminho = join(pastaBase, ficheiro);
    resultado[ficheiro] = existsSync(caminho)
      ? createHash("sha256").update(readFileSync(caminho)).digest("hex")
      : "EM FALTA";
  }
  return resultado;
}

function correrPara(pasta: string): void {
  const resultado = spawnSync(
    "uv",
    ["run", "--project", "../backend", "python", "ferramentas/gerar-marca.py", pasta],
    { cwd: RAIZ_FRONTEND, encoding: "utf-8", timeout: 120_000 },
  );
  expect(
    resultado.error?.message ?? "",
    "não consegui lançar o `uv` (não está no PATH?): é falha de ambiente, não do script",
  ).toBe("");
  expect(
    resultado.status,
    `o script terminou com ${String(resultado.status)}:\n${resultado.stdout}\n${resultado.stderr}`,
  ).toBe(0);
}

describe("ferramentas/gerar-marca.py", () => {
  it("existe, e o original de que parte também (sem isto, o resto não prova nada)", () => {
    expect(existsSync(ORIGINAL), "docs/marca/tomazia-original.png").toBe(true);
    expect(existsSync(SCRIPT), "frontend/ferramentas/gerar-marca.py").toBe(true);
  });

  it("gera os sete ficheiros com os mesmos bytes que estão versionados, duas vezes seguidas", () => {
    expect(existsSync(SCRIPT), "o script não existe: não há nada para correr").toBe(true);

    const versionado = impressoes(join(RAIZ_FRONTEND, "public"));
    const primeiraPasta = mkdtempSync(join(tmpdir(), "tomazia-marca-1-"));
    const segundaPasta = mkdtempSync(join(tmpdir(), "tomazia-marca-2-"));
    pastas.push(primeiraPasta, segundaPasta);

    correrPara(primeiraPasta);
    correrPara(segundaPasta);
    const primeira = impressoes(primeiraPasta);
    const segunda = impressoes(segundaPasta);

    expect(Object.values(primeira), "o script não escreveu todos os ficheiros").not.toContain(
      "EM FALTA",
    );
    expect(segunda, "duas corridas deram bytes diferentes: o script não é reprodutível").toEqual(
      primeira,
    );
    expect(
      primeira,
      "os ficheiros de public/ não são o que o script gera agora: alguém os editou à mão " +
        "ou esqueceu-se de os voltar a gerar",
    ).toEqual(versionado);
  }, 300_000);
});
