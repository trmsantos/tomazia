/**
 * A página pública, de cima para baixo (F3-02, secção 2).
 *
 * Era o teste de fumo da F1-01 — "o `App` arranca e mostra o nome do bar" —
 * e passa a ser também o teste da **árvore** da página, que é a única coisa
 * que nenhum dos testes de componente pode afirmar: a hierarquia de títulos
 * `h1` → `h2` → `h3`, sem saltos e com um só `h1`.
 *
 * **O que este ficheiro prova:** que o `<h1>` existe e é único; que a
 * ementa é desenhada dentro de um `<main>`, sem nenhum toque; e que a
 * hierarquia de títulos não salta um nível.
 *
 * **O que deixa passar:** tudo o que é do ecrã da ementa —
 * `src/pages/publico/Ementa.test.tsx` trata disso. E a ordem visual, que em
 * jsdom não existe.
 *
 * O `<h1>` vive aqui até a F3-03 o levar para o cabeçalho. Sem ele o axe
 * acusa e a página fica sem nome.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import { EMENTA_DE_TESTE, ID_DA_SECCAO, NOME_DO_BAR, TEXTOS_DA_EMENTA } from "./testes/ementa";
import { instalarDeslocamento, instalarMatchMedia } from "./testes/jsdom-da-ementa";
import { obterEmenta } from "./lib/api/publico";

vi.mock("./lib/api/publico", () => ({ obterEmenta: vi.fn() }));

async function desenhar() {
  const deslocamento = instalarDeslocamento();
  const media = instalarMatchMedia();
  vi.mocked(obterEmenta).mockResolvedValue(EMENTA_DE_TESTE);

  const resultado = render(<App />);
  await screen.findByRole("navigation", { name: TEXTOS_DA_EMENTA.nomeDaBarra });

  return {
    ...resultado,
    limpar() {
      deslocamento.restaurar();
      media.restaurar();
    },
  };
}

describe("a página pública", () => {
  it("mostra o nome do bar, uma vez só", async () => {
    const { limpar } = await desenhar();

    expect(screen.getByRole("heading", { name: NOME_DO_BAR, level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    limpar();
  });

  it("a ementa aparece sem nenhum toque, dentro do `main`", async () => {
    const { container, limpar } = await desenhar();

    const principal = container.querySelector("main");
    expect(principal, "a ementa é o conteúdo principal da página").not.toBeNull();
    expect(principal?.querySelector(`#${ID_DA_SECCAO}`)).not.toBeNull();
    expect(screen.getByText("Galão")).toBeInTheDocument();

    limpar();
  });

  it("os títulos vão de 1 a 3 sem saltar um nível", async () => {
    const { container, limpar } = await desenhar();

    const niveis = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((titulo) =>
      Number(titulo.tagName.slice(1)),
    );

    expect(niveis[0], "a página começa no h1").toBe(1);

    const saltos: string[] = [];
    niveis.forEach((nivel, indice) => {
      const anterior = niveis[indice - 1];
      if (anterior !== undefined && nivel > anterior + 1) {
        saltos.push(`h${String(anterior)} seguido de h${String(nivel)}`);
      }
    });

    expect(saltos, "sem saltos: h1 → h2 → h3 (F3-02, secção 2)").toEqual([]);

    limpar();
  });
});
