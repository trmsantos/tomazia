/**
 * F3-08, secção 8 (componente): o logótipo no `<h1>` do cabeçalho, em jsdom.
 *
 * É a versão barata dos testes de `e2e/logotipo.spec.ts`: o que se pode
 * provar sem layout (atributos, estrutura, ausência de ligação e de
 * `tabindex`). Tamanhos reais, `srcset` escolhido e círculo desenhado são do
 * browser.
 *
 * Falha hoje porque o `<h1>` tem o texto "Bar da Tomazia" e nenhum `<img>`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { INFO_SEM_REDE } from "../../testes/cabecalho";
import { NOME_ACESSIVEL_DO_LOGOTIPO } from "../../testes/marca";
import { Cabecalho } from "./Cabecalho";

function logotipo(): HTMLImageElement {
  const titulo = screen.getByRole("heading", { level: 1, name: NOME_ACESSIVEL_DO_LOGOTIPO });
  const img = titulo.querySelector("img");
  expect(img, "o <h1> não tem <img>: o logótipo ainda não substituiu o texto").not.toBeNull();
  return img as HTMLImageElement;
}

describe("o logótipo no <h1>", () => {
  it("é um <img> com o alt «Bar da Tomazia», 44×44, sem lazy e com srcset 1x/2x/3x", () => {
    render(<Cabecalho info={{ estado: "pronto", info: INFO_SEM_REDE }} />);
    const img = logotipo();

    expect(img.getAttribute("alt")).toBe("Bar da Tomazia");
    expect(img.getAttribute("width")).toBe("44");
    expect(img.getAttribute("height")).toBe("44");
    expect(img.getAttribute("src")).toBe("/marca/logo-88.webp");
    expect(img.getAttribute("srcset")).toBe(
      "/marca/logo-44.webp 1x, /marca/logo-88.webp 2x, /marca/logo-132.webp 3x",
    );
    expect(img.getAttribute("loading")).not.toBe("lazy");
    expect(img.getAttribute("style"), "sem style inline (CSP, ADR 0008)").toBeNull();
  });

  it("o <h1> não tem texto próprio nem aria-label: o nome é o alt", () => {
    render(<Cabecalho info={{ estado: "a-carregar" }} />);
    const titulo = screen.getByRole("heading", { level: 1 });

    expect(titulo.textContent?.trim()).toBe("");
    expect(titulo.hasAttribute("aria-label")).toBe(false);
    expect(titulo.hasAttribute("aria-labelledby")).toBe(false);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("não é uma ligação, não é focável, e o botão «WiFi» continua", () => {
    render(<Cabecalho info={{ estado: "falhou" }} />);
    const img = logotipo();

    expect(img.closest("a, button")).toBeNull();
    expect(img.hasAttribute("tabindex")).toBe(false);
    expect(img.closest("h1")?.hasAttribute("tabindex")).toBe(false);
    expect(screen.getByRole("button", { name: "WiFi" })).toBeInTheDocument();
  });
});
