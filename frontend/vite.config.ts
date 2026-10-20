import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // `environmentMatchGlobs` saiu do Vitest 5 (ver changelog da major).
    // O S-13 (`src/lib/seguranca/s13.test.ts`) continua a precisar do
    // ambiente `node`, não `jsdom`, porque chama `node:url`/ESLint e o
    // `new URL("../../..", import.meta.url)` falha sob jsdom com "The URL
    // must be of scheme file". Em vez de um mapeamento global aqui, esse
    // ficheiro declara o ambiente com o docblock `// @vitest-environment
    // node` no seu próprio topo — mais local e visível a quem o editar.
    setupFiles: ["./src/configuracao-testes.ts"],
  },
});
