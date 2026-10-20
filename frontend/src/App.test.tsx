/**
 * Teste de fumo do esqueleto do frontend.
 *
 * Garante que o `App` arranca e mostra o nome do bar. Serve também para
 * que `vitest --run` não saia com o código 1 por não encontrar nenhum
 * ficheiro de teste nesta tarefa (F1-01), antes de existirem páginas e
 * componentes reais.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("mostra o nome do bar", () => {
    render(<App />);

    expect(screen.getByText(/Bar da Tomazia/i)).toBeInTheDocument();
  });
});
