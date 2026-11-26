// @vitest-environment node
/**
 * F3-08, secção 3: o script `ferramentas/gerar-marca.py` é reprodutível e os
 * ficheiros versionados em `public/` são exatamente o que ele gera.
 *
 * **Como:** corre o script duas vezes para duas pastas em `tmpdir()` (o script
 * aceita a pasta de saída como argumento; sem argumento escreve em
 * `public/`, como o PR o documenta) e compara os SHA-256 dos sete ficheiros:
 * 1.ª corrida == 2.ª corrida (bytes), e a 1.ª == o que está versionado em
 * `public/` **pelos píxeis descodificados**, não pelos bytes.
 *
 * Porque os bytes não servem para comparar com `public/`: os PNG (e o `.ico`,
 * que leva PNG lá dentro) saem com bytes diferentes conforme a plataforma, por
 * causa do zlib (medido: o `apple-touch-icon.png` e o `favicon.ico` gerados no
 * Linux do CI não têm o SHA-256 dos gerados no macOS, e os três WebP, o
 * `favicon-32.png` e o JPEG coincidem). Os píxeis é que são o desenho. A
 * comparação é feita pelo próprio script (`--comparar <a> <b>`, com o Pillow),
 * que descodifica cada ficheiro e cada imagem do `.ico` e sai com 1 e a lista
 * do que difere. Duas corridas na mesma máquina continuam a dar bytes iguais.
 * **Nunca escreve em `public/`**: outros testes leem-no e fazem `vite build`
 * (que o copia) em paralelo, e reescrevê-lo daqui dava leituras truncadas.
 *
 * **Regra 10:** falta do `uv`, script em falta ou saída diferente de 0 dão
 * mensagens próprias — nunca passam por "iguais". **CI:** o job `frontend`
 * precisa do passo `astral-sh/setup-uv`; sem ele este teste falha, e deve
 * falhar: não se salta em silêncio.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function correrScript(argumentos: string[]): { estado: number | null; saida: string } {
  const resultado = spawnSync(
    "uv",
    ["run", "--project", "../backend", "python", "ferramentas/gerar-marca.py", ...argumentos],
    { cwd: RAIZ_FRONTEND, encoding: "utf-8", timeout: 120_000 },
  );
  expect(
    resultado.error?.message ?? "",
    "não consegui lançar o `uv` (não está no PATH?): é falha de ambiente, não do script",
  ).toBe("");
  return { estado: resultado.status, saida: `${resultado.stdout}\n${resultado.stderr}` };
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

    const comparacao = correrScript(["--comparar", primeiraPasta, join(RAIZ_FRONTEND, "public")]);
    expect(
      comparacao.estado,
      "os píxeis de public/ não são o que o script gera agora: alguém os editou à mão " +
        `ou esqueceu-se de os voltar a gerar:\n${comparacao.saida}`,
    ).toBe(0);
  }, 300_000);

  it("o comparador de píxeis vê uma diferença (senão o «igual» não prova nada)", () => {
    const pasta = mkdtempSync(join(tmpdir(), "tomazia-marca-3-"));
    pastas.push(pasta);
    correrPara(pasta);
    // Um logótipo trocado por outro tamanho de pixéis, e um ficheiro em falta.
    copyFileSync(join(pasta, "marca", "logo-88.webp"), join(pasta, "marca", "logo-44.webp"));
    rmSync(join(pasta, "og-image.jpg"));

    const comparacao = correrScript(["--comparar", pasta, join(RAIZ_FRONTEND, "public")]);
    expect(comparacao.estado).toBe(1);
    expect(comparacao.saida).toContain("logo-44.webp");
    expect(comparacao.saida).toContain("og-image.jpg");
  }, 300_000);
});
