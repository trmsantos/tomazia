import { defineConfig } from "@playwright/test";

/**
 * Playwright para a F3-01.
 *
 * Chega nesta tarefa, e não na F3-07 como estava planeado, porque o
 * critério "Q-03 e Q-04 nos componentes" **não é cumprível em jsdom**: não
 * há layout, por isso `boundingBox()` não existe e os 44 px não se medem; e
 * o axe desliga a regra de contraste quando não consegue pintar nada. Ver
 * `docs/ecras/F3-01.md`, secção 9.4 e Pergunta 5.
 *
 * Fica **de fora do `ci.yml`** nesta tarefa, como combinado: a ligação ao
 * CI (com `playwright install --with-deps chromium`) entra na F3-07, junto
 * com o Lighthouse. Por enquanto corre localmente e no `/verificar`.
 *
 * Uma só configuração de browser: 390 × 844, que é o telemóvel para que
 * este site é desenhado. As capturas a 1024 × 768 pedem o seu viewport com
 * `test.use` dentro do próprio ficheiro.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  // Uma pasta **só** para os artefactos do Playwright (traces, erros), e
  // não `test-results/` inteira. As capturas do `capturas.spec.ts` vão
  // para `test-results/capturas/`, e enquanto as duas coisas partilhavam a
  // mesma raiz a corrida falhava uma vez em cada três com
  // `ENOENT … .playwright-artifacts-N/traces/…recording.trace` ao fechar o
  // contexto — um teste que tinha passado a ser dado como falhado, sem
  // nenhuma asserção a falhar. Medido: 1 em 3 com a raiz partilhada, 0 em
  // 6 com as pastas separadas, com o `trace` ligado nas duas.
  //
  // As duas continuam dentro de `test-results/`, que o `.gitignore` da
  // raiz já ignora — não é preciso ignorar nada de novo.
  outputDir: "./test-results/artefactos",
  use: {
    baseURL: "http://localhost:8075",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
  },
  webServer: {
    // A página de demonstração só existe em desenvolvimento — é esse o
    // ponto dela (ver `src/build-de-producao.test.ts`). Por isso estes
    // testes correm contra o servidor do Vite e não contra `dist/`.
    //
    // Porta própria, `--strictPort` e `reuseExistingServer: false`, os três
    // pela mesma razão, que já aconteceu a escrever estes testes: a 5173
    // (a de omissão do Vite) tinha outra coisa qualquer a correr nesta
    // máquina, o Playwright reutilizou-a por ser "um servidor que
    // responde", e todos os testes falharam com 404 em
    // `/demonstracao.html` — um 404 que não queria dizer "a página não
    // existe", queria dizer "estou a falar com o servidor errado". Com
    // `--strictPort`, o Vite recusa arrancar numa porta ocupada em vez de
    // saltar em silêncio para a seguinte; sem reutilização, o servidor é
    // sempre o nosso e conhece sempre os ficheiros que existem agora.
    //
    // A porta é a 8075, e não uma 517x, por isso mesmo: as 5173, 5174,
    // 5175 e 5190 desta máquina estavam todas ocupadas por outros
    // projetos com Vite. A 8075 fica ao lado da 8070 do backend (ver
    // `CLAUDE.md`), onde é improvável haver outra coisa deste feitio.
    command: "npm run dev -- --port 8075 --strictPort",
    url: "http://localhost:8075/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
