import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

import { resolverUrlPublica } from "./url-publica";

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

/**
 * A pasta onde o backend guarda as imagens, vista do `frontend/`.
 *
 * É o valor por omissão de `media_dir` em `backend/app/config.py`
 * (`./var/media`, relativo a `backend/`). Está escrito nos dois sítios e
 * não há como o derivar daqui: o `config.py` é Python e lê-se em runtime.
 */
const MEDIA_EM_DESENVOLVIMENTO = resolve(__dirname, "..", "backend", "var", "media");

/** Os tipos que a lista branca do importador deixa entrar no `media/`. */
const TIPOS_DE_IMAGEM: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Serve `/media/<ficheiro>` a partir do `MEDIA_DIR` do backend, **só em
 * desenvolvimento**.
 *
 * Em produção quem serve esta pasta é o Apache, a partir de
 * `public_html/media` — o backend não tem rota nenhuma para ela, e por isso
 * não há para onde apontar um `proxy`. Sem isto, qualquer cartaz de evento
 * (F3-04) ou foto da galeria (F3-05) dá 404 na máquina de quem desenvolve, e
 * o único estado que se consegue ver é o de erro.
 *
 * Um endereço absoluto para outro servidor **não** é alternativa: a CSP de
 * produção é `connect-src 'self'` e `img-src 'self'` (ADR 0008), e o que
 * funcionasse aqui partia lá.
 *
 * Três guardas, e nenhum é cerimónia:
 *
 *  - **só um segmento**: o que vem depois de `/media/` não pode ter `/`,
 *    `\` nem `..`. É a mesma regra que a base de dados impõe por `CHECK`
 *    (`ck_fotos_ficheiro_sem_caminho`) e que o importador da F2-08 aplica ao
 *    reduzir nomes;
 *  - **extensão na lista branca**, a mesma do importador. O `media/` real é
 *    servido pelo Apache com `AllowOverride All`, e servir aqui o que lá não
 *    pode entrar ensinaria a trabalhar contra um ambiente que não existe;
 *  - **o caminho resolvido tem de ficar dentro da pasta**, verificado depois
 *    de resolver e não antes. Os dois primeiros já o garantem; este é o que
 *    continua a garanti-lo se alguém mexer nos outros.
 */
function servirMediaEmDesenvolvimento(): Plugin {
  return {
    name: "tomazia-media-em-desenvolvimento",
    apply: "serve",
    configureServer(servidor) {
      servidor.middlewares.use((pedido, resposta, seguinte) => {
        const url = pedido.url ?? "";
        if (!url.startsWith("/media/")) return seguinte();

        // O `decodeURIComponent` **lança** num pedido a `/media/%` ou
        // `/media/%zz.png`. Sem este `try`, o connect apanhava o `URIError` e
        // respondia **500 com overlay de erro** — ou seja, "não consegui ler
        // o nome" saía diferente de "não há ficheiro", e saía como avaria
        // nossa. É a regra 10 do `CLAUDE.md`: as duas recusas têm de dar a
        // mesma resposta, que é 404 pela mão do `seguinte()`.
        let nome: string;
        try {
          nome = decodeURIComponent(url.slice("/media/".length).split("?")[0] ?? "");
        } catch {
          return seguinte();
        }

        if (nome === "" || nome.includes("/") || nome.includes("\\") || nome.includes("..")) {
          return seguinte();
        }

        const tipo = TIPOS_DE_IMAGEM[extname(nome).toLowerCase()];
        if (tipo === undefined) return seguinte();

        const caminho = resolve(join(MEDIA_EM_DESENVOLVIMENTO, nome));
        if (!caminho.startsWith(MEDIA_EM_DESENVOLVIMENTO + sep)) return seguinte();
        if (!existsSync(caminho) || !statSync(caminho).isFile()) return seguinte();

        // O `resolve()` **não** resolve ligações simbólicas: uma ligação
        // dentro da pasta era servida com os bytes do alvo, medido. O
        // `realpathSync` fecha isso por construção — e fecha de caminho um
        // segundo problema, que é só de desenvolvimento e por isso o pior
        // género: no macOS o sistema de ficheiros ignora maiúsculas, por
        // isso `/media/CARTAZ.PNG` servia aqui e dava 404 no Apache.
        //
        // O `realpathSync` fecha a ligação simbólica mas **não** normaliza
        // as maiúsculas — medido: com ele sozinho, o `CARTAZ.PNG` continuava
        // a ser servido. Quem sabe o nome verdadeiro é a listagem da pasta,
        // e é a ela que se pergunta. Custa uma leitura de diretório por
        // pedido, o que num servidor de desenvolvimento com uma mão-cheia de
        // ficheiros não é nada — e o preço de não o fazer é a máquina de
        // quem desenvolve a comportar-se de maneira diferente do servidor,
        // que é a classe de defeito que só aparece em produção.
        let real: string;
        try {
          real = realpathSync(caminho);
        } catch {
          return seguinte();
        }
        if (!real.startsWith(MEDIA_EM_DESENVOLVIMENTO + sep)) return seguinte();
        if (basename(real) !== nome) return seguinte();
        try {
          if (!readdirSync(MEDIA_EM_DESENVOLVIMENTO).includes(nome)) return seguinte();
        } catch {
          return seguinte();
        }

        resposta.setHeader("Content-Type", tipo);
        // O mesmo cabeçalho que o `deploy/htaccess.exemplo` serve em
        // produção. Sem ele, um ficheiro mal tipado comportava-se de uma
        // maneira aqui e de outra no servidor.
        resposta.setHeader("X-Content-Type-Options", "nosniff");
        // O `pipe` instala tratador de erro no **destino**, nunca na origem:
        // um ficheiro que o `statSync` diz existir mas que não abre (modo
        // 000, ou apagado no instante entre as duas linhas) emitia um
        // `error` sem tratador e **matava o processo do `vite dev`**.
        createReadStream(caminho)
          .on("error", () => seguinte())
          .pipe(resposta);
      });
    },
  };
}

function urlPublicaNoIndex(command: "build" | "serve"): Plugin {
  const url = resolverUrlPublica(command);
  return {
    name: "tomazia-url-publica-no-index",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replaceAll("%URL_PUBLICA%", url),
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === "build") {
    process.env[MARCA_DE_BUILD_PUBLICO] = "1";
  }

  return {
    plugins: [react(), urlPublicaNoIndex(command), servirMediaEmDesenvolvimento()],
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
