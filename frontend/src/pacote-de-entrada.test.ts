// @vitest-environment node
/**
 * F4-01, Q-02 — `ferramentas/pacote-de-entrada.mjs`: o que o browser carrega
 * para **ver a página pública**, lido do `index.html` construído.
 *
 * Contrato (módulo novo, ESM puro, sem dependências):
 *
 * ```js
 * export function pacoteDeEntrada(pastaDoBuild) // -> string[]
 * ```
 *
 * Devolve os caminhos **absolutos** dos `.js` que o `index.html` da pasta carrega:
 * o `<script type="module" src>` e cada `<link rel="modulepreload" href>`, por
 * esta ordem, sem repetições. Os `href`/`src` começam por `/` e resolvem-se contra
 * a pasta do build (`/assets/x.js` -> `<pasta>/assets/x.js`). Ignora o CSS e
 * qualquer `<link>` que não seja `modulepreload`.
 *
 * **Falha alto** (regra 10: «não consegui ler» nunca dá lista vazia) se:
 *  - o `index.html` não existe;
 *  - não há nenhum `<script type="module" src>`;
 *  - um caminho referido não existe no disco.
 *
 * Porque não o manifest do Vite: iria parar a `dist/`, e o `deploy/montar.sh`
 * copia o `dist` inteiro. É o mesmo módulo que o `.size-limit.js` usa para
 * calcular o `path` — e daí a necessidade de rebentar em vez de devolver `[]`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RAIZ_FRONTEND } from "./testes/percorrer-arvore";

type PacoteDeEntrada = (pasta: string) => string[];

async function carregar(): Promise<PacoteDeEntrada> {
  const caminho = join(RAIZ_FRONTEND, "ferramentas", "pacote-de-entrada.mjs");
  const modulo = (await import(/* @vite-ignore */ pathToFileURL(caminho).href)) as {
    pacoteDeEntrada?: PacoteDeEntrada;
  };
  if (typeof modulo.pacoteDeEntrada !== "function") {
    throw new Error("ferramentas/pacote-de-entrada.mjs não exporta `pacoteDeEntrada`");
  }
  return modulo.pacoteDeEntrada;
}

let pasta = "";

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "tomazia-pacote-"));
  mkdirSync(join(pasta, "assets"));
});

afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
});

function ficheiro(relativo: string, conteudo = "//"): void {
  writeFileSync(join(pasta, relativo), conteudo);
}
function indice(corpo: string): void {
  ficheiro("index.html", `<!doctype html><html><head>${corpo}</head><body></body></html>`);
}

describe("pacoteDeEntrada", () => {
  it("devolve o script de entrada e os modulepreload, absolutos, por esta ordem", async () => {
    ficheiro("assets/index-a1.js");
    ficheiro("assets/vendor-b2.js");
    ficheiro("assets/outro-c3.js");
    ficheiro("assets/index-d4.css", "/**/");
    indice(
      '<script type="module" crossorigin src="/assets/index-a1.js"></script>' +
        '<link rel="modulepreload" crossorigin href="/assets/vendor-b2.js">' +
        '<link rel="modulepreload" href="/assets/outro-c3.js">' +
        '<link rel="stylesheet" crossorigin href="/assets/index-d4.css">',
    );

    const pacote = (await carregar())(pasta);

    expect(pacote).toEqual([
      join(pasta, "assets/index-a1.js"),
      join(pasta, "assets/vendor-b2.js"),
      join(pasta, "assets/outro-c3.js"),
    ]);
  });

  it("não repete um ficheiro referido duas vezes", async () => {
    ficheiro("assets/index-a1.js");
    indice(
      '<script type="module" src="/assets/index-a1.js"></script>' +
        '<link rel="modulepreload" href="/assets/index-a1.js">',
    );

    expect((await carregar())(pasta)).toEqual([join(pasta, "assets/index-a1.js")]);
  });

  it("um ficheiro que existe em assets/ mas o index.html não refere fica de fora", async () => {
    ficheiro("assets/index-a1.js");
    ficheiro("assets/gestao-z9.js");
    indice('<script type="module" src="/assets/index-a1.js"></script>');

    expect((await carregar())(pasta)).toEqual([join(pasta, "assets/index-a1.js")]);
  });

  it("falha alto sem index.html (nunca uma lista vazia)", async () => {
    const pacote = await carregar();
    expect(() => pacote(pasta)).toThrow();
  });

  it("falha alto se o index.html não tem nenhum <script type=module src>", async () => {
    ficheiro("assets/index-a1.js");
    indice('<link rel="modulepreload" href="/assets/index-a1.js">');

    const pacote = await carregar();
    expect(() => pacote(pasta)).toThrow();
  });

  it("falha alto se um caminho referido não existe no disco", async () => {
    ficheiro("assets/index-a1.js");
    indice(
      '<script type="module" src="/assets/index-a1.js"></script>' +
        '<link rel="modulepreload" href="/assets/desaparecido-q7.js">',
    );

    const pacote = await carregar();
    expect(() => pacote(pasta)).toThrow(/desaparecido-q7/);
  });

  it("falha alto se o script de entrada não existe no disco", async () => {
    indice('<script type="module" src="/assets/index-a1.js"></script>');

    const pacote = await carregar();
    expect(() => pacote(pasta)).toThrow(/index-a1/);
  });
});
