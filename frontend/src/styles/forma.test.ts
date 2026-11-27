// @vitest-environment node
/**
 * R-01 / ADR 0023 — os tokens de forma do redesign B.
 *
 * Lê `tokens.css` e `tailwind.config.ts` como texto: é estático e corre em
 * milissegundos. Fixa os raios novos, o contorno médio e a lista exata de
 * nomes de `borderRadius`, para que nenhum raio entre ou saia sem teste.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(__dirname, "tokens.css"), "utf8");
const config = readFileSync(resolve(__dirname, "../../tailwind.config.ts"), "utf8");

function declaracao(nome: string): string | null {
  const m = new RegExp(`${nome}:\\s*([^;]+);`).exec(tokens);
  return m?.[1]?.trim() ?? null;
}

function bloco(chave: string): string {
  const m = new RegExp(`${chave}:\\s*\\{([^}]*)\\}`).exec(config);
  if (!m) throw new Error(`Não encontrei o bloco ${chave} em tailwind.config.ts`);
  return m[1] ?? "";
}

describe("tokens de forma", () => {
  it.each([
    ["--raio-pequeno", "10px"],
    ["--raio-campo", "12px"],
    ["--raio-botao", "14px"],
    ["--raio-cartao", "18px"],
    ["--raio-grande", "24px"],
    ["--raio-barra", "22px"],
    ["--contorno-medio", "1.5px"],
  ])("%s vale %s", (nome, valor) => {
    expect(declaracao(nome)).toBe(valor);
  });

  it("borderRadius tem exatamente os oito nomes", () => {
    const nomes = [...bloco("borderRadius").matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(nomes).toEqual([
      "nenhum",
      "pequeno",
      "campo",
      "botao",
      "cartao",
      "grande",
      "barra",
      "cheio",
    ]);
  });

  it("borderWidth.medio aponta para o contorno médio", () => {
    expect(bloco("borderWidth")).toMatch(/medio:\s*"var\(--contorno-medio\)"/);
  });
});
