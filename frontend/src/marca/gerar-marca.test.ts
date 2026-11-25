// @vitest-environment node
/**
 * F3-08, secção 3: o script `ferramentas/gerar-marca.py` é reprodutível e os
 * ficheiros versionados em `public/` são exatamente o que ele gera.
 *
 * **Como:** corre o script (sem argumentos, como o PR o documenta:
 * `uv run --project ../backend python ferramentas/gerar-marca.py`) duas vezes
 * e compara os SHA-256 de cada um dos sete ficheiros: antes (o que está
 * versionado), depois da 1.ª corrida e depois da 2.ª. Os três têm de ser
 * iguais: "versionado == gerado" e "gerado == gerado".
 *
 * **Assume do implementador:** que o script escreve em `frontend/public/`
 * quando corrido sem argumentos e que é determinístico (Pillow com
 * parâmetros fixos, sem metadados com data). Não é preciso nenhum ponto de
 * extensão. Se o script estragar um ficheiro, o teste deixa-o alterado na
 * árvore; `git diff --stat frontend/public` mostra qual.
 *
 * **Regra 10:** falta do `uv`, script em falta ou saída diferente de 0 dão
 * mensagens próprias — nunca passam por "iguais". **CI:** o job `frontend`
 * não instala o uv hoje; o implementador/infra tem de acrescentar o passo
 * `astral-sh/setup-uv` a esse job (o backend já o usa), senão este teste
 * falha lá, e deve falhar: não se salta em silêncio.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { FICHEIROS_GERADOS } from "../testes/marca";
import { RAIZ_FRONTEND, RAIZ_REPOSITORIO } from "../testes/percorrer-arvore";

const SCRIPT = join(RAIZ_FRONTEND, "ferramentas", "gerar-marca.py");
const ORIGINAL = join(RAIZ_REPOSITORIO, "docs", "marca", "tomazia-original.png");

function impressoes(): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const ficheiro of FICHEIROS_GERADOS) {
    const caminho = join(RAIZ_FRONTEND, "public", ficheiro);
    resultado[ficheiro] = existsSync(caminho)
      ? createHash("sha256").update(readFileSync(caminho)).digest("hex")
      : "EM FALTA";
  }
  return resultado;
}

function correr(): void {
  const resultado = spawnSync(
    "uv",
    ["run", "--project", "../backend", "python", "ferramentas/gerar-marca.py"],
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

    const versionado = impressoes();
    correr();
    const primeira = impressoes();
    correr();
    const segunda = impressoes();

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
