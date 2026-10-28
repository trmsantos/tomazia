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
    server: {
      proxy: {
        // F2-09: em desenvolvimento, `/api/…` vai para o uvicorn da porta
        // 8070 (a que o `CLAUDE.md` da raiz documenta).
        //
        // O `rewrite` não é cosmético: o backend declara as rotas **sem**
        // `/api` (`app/routers/publico.py`), porque em produção é o
        // Passenger que o acrescenta via `SCRIPT_NAME`. Sem tirar o prefixo
        // aqui, o uvicorn via `GET /api/ementa` e respondia 404 a tudo — e o
        // cliente, que tem de usar uma base relativa por causa da CSP
        // `connect-src 'self'` (ADR 0008), não tem como contornar isso.
        //
        // `127.0.0.1` e não `localhost`: num sistema com IPv6, `localhost`
        // resolve primeiro para `::1`, onde o uvicorn (que escuta em
        // 127.0.0.1) não está.
        //
        // A chave é `"^/api/"` e não `"/api"` porque o Vite compara uma
        // chave normal com `url.startsWith(chave)` — não é um limite de
        // segmento. Com `"/api"`, um `GET /apidocs` entrava no proxy e o
        // `rewrite` entregava `/docs` ao uvicorn. Uma chave começada por
        // `^` é tratada como expressão regular, e aí `/api/` exige mesmo a
        // barra. Só em desenvolvimento e sem ganho de privilégio nenhum,
        // mas o emparelhamento tem de dizer o que parece dizer.
        "^/api/": {
          target: "http://127.0.0.1:8070",
          changeOrigin: false,
          rewrite: (caminho) => caminho.replace(/^\/api/, ""),
        },
      },
    },
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
