import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * A marca que diz ao `tailwind.config.ts` que o CSS a ser gerado é o do
 * pacote público — e que, portanto, a página de demonstração fica de fora do
 * `content` dele. O nome está escrito nos dois ficheiros, e cada um aponta
 * para o outro; se divergirem, as classes da demonstração voltam ao CSS
 * público e `src/build-de-producao.test.ts` falha a dizê-lo.
 *
 * Porquê uma variável nossa e não o `NODE_ENV`: o Vite respeita um `NODE_ENV`
 * que já venha do processo que o lançou, e o `src/build-de-producao.test.ts`
 * lança o build de dentro do Vitest, onde ele vale "test". Com o `NODE_ENV`
 * como sinal, a folha de estilos construída passava a depender de quem
 * carregou no botão: o build do CI podia não ser o build da máquina de quem
 * desenvolve, e isso não aparecia em lado nenhum. O `command` do Vite não se
 * herda de ninguém.
 */
const MARCA_DE_BUILD_PUBLICO = "TOMAZIA_PACOTE_PUBLICO";

export default defineConfig(({ command }) => {
  if (command === "build") {
    process.env[MARCA_DE_BUILD_PUBLICO] = "1";
  }

  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      // Os testes de `e2e/` são do Playwright, não do Vitest, mas o padrão
      // por omissão do Vitest (`**/*.{test,spec}.*`) também apanha um
      // `*.spec.ts`. Sem esta exclusão, `npm test` tentava correr os testes
      // ponta a ponta num ambiente sem browser e falhava a importar
      // `@playwright/test`.
      exclude: [...configDefaults.exclude, "e2e/**"],
      // `environmentMatchGlobs` saiu do Vitest 5 (ver changelog da major).
      // O S-13 (`src/lib/seguranca/s13.test.ts`) continua a precisar do
      // ambiente `node`, não `jsdom`, porque chama `node:url`/ESLint e o
      // `new URL("../../..", import.meta.url)` falha sob jsdom com "The URL
      // must be of scheme file". Em vez de um mapeamento global aqui, esse
      // ficheiro declara o ambiente com o docblock `// @vitest-environment
      // node` no seu próprio topo — mais local e visível a quem o editar.
      setupFiles: ["./src/configuracao-testes.ts"],
    },
  };
});
