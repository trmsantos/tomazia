// @vitest-environment node
/**
 * F4-04, decisão D5 e spec 12.1 — o token novo `--alvo-grande` (56 px) e o nome de Tailwind
 * `min-h-grande`.
 *
 * Aprovar e Rejeitar são o ecrã inteiro e um toque falhado aqui aprova a foto errada: 56 px, não
 * os 44 do `min-h-toque`. O token vive em `tokens.css` (a seguir a `--alvo-toque`, **em px de
 * propósito**, como ele: é uma constante ergonómica do polegar, não tipográfica) e o
 * `tailwind.config.ts` só tem o índice (`extend.minHeight.grande = "var(--alvo-grande)"`).
 *
 * Sem estes dois, a classe `min-h-grande` **desaparece em silêncio** (uma classe que o Tailwind não
 * conhece não dá erro: não é gerada) e os botões voltam à altura do conteúdo. O que isto prova é
 * que as duas linhas existem; os 56 px medidos no browser estão em `e2e/gestao-fotos.spec.ts`.
 *
 * **Deixa passar:** a classe ser mesmo usada nos dois botões (`GaleriaGestao.test.tsx` e e2e).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import configuracaoTailwind from "../../tailwind.config";
import { RAIZ_FRONTEND } from "../testes/percorrer-arvore";
import { blocosDosTokens } from "../testes/tokens";

describe("--alvo-grande (D5)", () => {
  it("existe em :root e vale 56px (em px, como o `--alvo-toque`)", () => {
    const raiz = blocosDosTokens().get(":root");
    expect(raiz, "o `:root` do tokens.css").toBeDefined();
    expect(raiz?.get("--alvo-toque")).toBe("44px");
    expect(raiz?.get("--alvo-grande")).toBe("56px");
  });

  it("vem logo a seguir a `--alvo-toque` no ficheiro (a spec 12.1 manda)", () => {
    const css = readFileSync(join(RAIZ_FRONTEND, "src/styles/tokens.css"), "utf-8");
    const linhas = css.split("\n");
    const i = linhas.findIndex((l) => /^\s*--alvo-toque:/.test(l));
    expect(i, "encontrei o --alvo-toque").toBeGreaterThanOrEqual(0);
    expect(linhas[i + 1] ?? "").toMatch(/^\s*--alvo-grande:\s*56px;/);
  });

  it("o Tailwind tem `minHeight.grande` a apontar para o token (e só isso)", () => {
    const minHeight = (
      configuracaoTailwind.theme as { extend?: { minHeight?: Record<string, string> } } | undefined
    )?.extend?.minHeight;
    expect(minHeight?.["grande"]).toBe("var(--alvo-grande)");
    expect(minHeight?.["toque"], "o de 44 px não muda").toBe("var(--alvo-toque)");
  });
});
