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
const global = readFileSync(resolve(__dirname, "global.css"), "utf8");
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

describe("círculo do Cartão de destaque", () => {
  it.each([
    ["--decoracao-destaque", "150px"],
    ["--decoracao-afastamento", "-40px"],
  ])("%s vale %s", (nome, valor) => {
    expect(declaracao(nome)).toBe(valor);
  });

  function regra(seletor: string): string {
    const semComentarios = global.replace(/\/\*[\s\S]*?\*\//g, "");
    const m = new RegExp(`${seletor.replace(/[.:]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(
      semComentarios,
    );
    if (!m) throw new Error(`Não encontrei a regra ${seletor} em global.css`);
    return m[1] ?? "";
  }

  it(".cartao-destaque isola o contexto de empilhamento", () => {
    expect(regra(".cartao-destaque")).toMatch(/isolation:\s*isolate/);
  });

  it("o ::after fica atrás do texto, não apanha toques e usa só tokens", () => {
    const corpo = regra(".cartao-destaque::after");
    expect(corpo).toMatch(/content:\s*""/);
    expect(corpo).toMatch(/position:\s*absolute/);
    expect(corpo).toMatch(/z-index:\s*-1/);
    expect(corpo).toMatch(/pointer-events:\s*none/);
    expect(corpo).toMatch(/top:\s*var\(--decoracao-afastamento\)/);
    expect(corpo).toMatch(/right:\s*var\(--decoracao-afastamento\)/);
    expect(corpo).toMatch(/width:\s*var\(--decoracao-destaque\)/);
    expect(corpo).toMatch(/height:\s*var\(--decoracao-destaque\)/);
    expect(corpo).toMatch(/border-radius:\s*var\(--raio-cheio\)/);
    expect(corpo).toMatch(/background:\s*var\(--cor-decoracao-destaque\)/);
  });
});
