// @vitest-environment node
/**
 * F3-01 — as promessas do `src/styles/global.css` (secção 5 de
 * `docs/ecras/F3-01.md`).
 *
 * Duas delas são a rede por baixo de toda a tarefa:
 *
 *  - **`:focus-visible` global.** Nenhum componente tem de se lembrar do
 *    anel de foco, porque a camada base já o desenha. É o que faz o Q-04
 *    («foco visível em todos os controlos») ser verdade por omissão em vez
 *    de ser verdade sete vezes seguidas por acaso. Usa `outline` e não o
 *    `ring-*` do Tailwind: acompanha o `border-radius`, não precisa das
 *    variáveis `--tw-ring-*` e não traz um `#fff` por omissão.
 *  - **`color-scheme: dark`.** Sem isto o Chrome pinta o preenchimento
 *    automático com a caixa azul-clara por cima do bordô, e no
 *    `/gestao/entrar` o texto da password deixa de se ler. É um defeito que
 *    só aparece a quem tem a password guardada — provavelmente só o dono.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "../testes/percorrer-arvore";

function global(): string {
  return lerTexto(
    join(RAIZ_FRONTEND, "src", "styles", "global.css"),
    "src/styles/global.css",
  ).replace(/\s+/g, " ");
}

describe("src/styles/global.css", () => {
  it("importa os tokens e as fontes antes do Tailwind", () => {
    const texto = lerTexto(join(RAIZ_FRONTEND, "src", "styles", "global.css"), "global.css");

    expect(texto).toMatch(/tokens\.css/);
    expect(texto).toMatch(/fontes\.css/);
    expect(texto).toMatch(/@tailwind base/);
  });

  it("desenha o anel de foco uma vez, para todos os controlos", () => {
    const texto = global();

    expect(texto).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--espessura-foco\)/);
    expect(texto).toMatch(/:focus-visible\s*\{[^}]*var\(--cor-foco\)/);
    expect(texto).toMatch(/outline-offset:\s*var\(--afastamento-foco\)/);
  });

  it("não há nenhum outline: none em lado nenhum", () => {
    // `outline: none` sem substituição é a forma clássica de apagar o foco
    // sem dar por isso.
    expect(global()).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("põe o esquema escuro e a cor de realce, para o autofill não ficar ilegível", () => {
    const texto = global();

    expect(texto).toMatch(/color-scheme:\s*dark/);
    expect(texto).toMatch(/accent-color:\s*var\(--cor-creme-papel\)/);
  });

  it("respeita prefers-reduced-motion", () => {
    expect(global()).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("define as três classes de superfície, e só elas pintam o fundo", () => {
    const texto = global();

    for (const classe of [".superficie-escura", ".superficie-painel", ".superficie-creme"]) {
      expect(texto, `falta ${classe}`).toContain(classe);
    }
    expect(texto).toMatch(/background-color:\s*var\(--cor-fundo-local\)/);
  });

  it("o corpo usa os tokens de tipografia, não valores escritos à mão", () => {
    const texto = global();

    expect(texto).toMatch(/var\(--fonte-corpo\)/);
    expect(texto).toMatch(/var\(--cor-texto\)/);
  });
});
