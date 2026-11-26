import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { csvBinario, csvDeTeste } from "../src/testes/clientes-dados";
import { TEXTOS_CLIENTES as T } from "../src/testes/clientes-gestao-textos";
import { AGORA } from "../src/testes/eventos";
import { fingirApiDeClientes } from "./apoio/gestao-clientes";
import { fingirApiDeSessao } from "./apoio/gestao";
import { construirEServir, cspDeProducao, type ServidorComCsp } from "./apoio/servir-com-csp";

/**
 * F4-05b, spec 6.1 e critério 12 — **o CSV descarrega-se com a CSP de produção, e o ficheiro que o
 * dono recebe tem exatamente os bytes que o servidor enviou, BOM incluída**.
 *
 * A CSP de produção (`deploy/htaccess.exemplo`) proíbe `blob:`: um link `blob:` feito com
 * `URL.createObjectURL` vê-se no servidor de desenvolvimento e nos testes (que não aplicam a CSP) e
 * pode não funcionar em produção. O ecrã descarrega por um link `data:` com `download`. Aqui
 * compila-se o frontend e serve-se **o build** com **o cabeçalho exato** do `htaccess.exemplo`
 * (`apoio/servir-com-csp.ts`, como em `gestao-fotos-csp.spec.ts`). A API continua fingida com
 * `page.route`.
 *
 * **Os autotestes** (sem eles, «o ficheiro descarrega» passava também se a CSP não estivesse a ser
 * aplicada — «não estive a ver» a passar por «está certo», a regra 10):
 *  1. a CSP lida do `htaccess.exemplo` é a esperada e o servidor serve-a (cabeçalho da resposta);
 *  2. um `blob:` posto de propósito **é bloqueado** como imagem (e fica registada a violação).
 *
 * O que se prova depois: o evento `download` dispara, com o nome do `Content-Disposition`; o
 * ficheiro descarregado **começa por `EF BB BF`** e tem **exatamente** os bytes do mock (um CSV com
 * acentos e outro com os 256 valores de byte, que um `text()` estragaria); o link usado é
 * `data:text/csv…` (nunca `blob:`), e a página inteira arranca e descarrega **sem nenhuma violação**
 * da CSP.
 */
test.describe.configure({ mode: "serial" });

let servidor: ServidorComCsp | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  servidor = await construirEServir();
});

test.afterAll(async () => {
  // Se o `beforeAll` falhou (não compilou, não leu a CSP) não há nada a fechar: o erro que conta é o dele.
  await servidor?.fechar();
});

type Violacao = { diretiva: string; bloqueado: string };

async function escutarViolacoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const lista: Array<{ diretiva: string; bloqueado: string }> = [];
    (window as unknown as { __violacoes: typeof lista }).__violacoes = lista;
    document.addEventListener("securitypolicyviolation", (evento) => {
      lista.push({ diretiva: evento.violatedDirective, bloqueado: evento.blockedURI });
    });
    // Regista o endereço de cada link clicado por código (o que o ecrã faz para descarregar).
    const cliques: Array<{ href: string; download: string | null }> = [];
    (window as unknown as { __cliques: typeof cliques }).__cliques = cliques;
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      cliques.push({
        href: this.getAttribute("href") ?? "",
        download: this.getAttribute("download"),
      });
      original.call(this);
    };
  });
}
function violacoes(page: Page): Promise<Violacao[]> {
  return page.evaluate(() =>
    (window as unknown as { __violacoes: Violacao[] }).__violacoes.slice(),
  );
}
function cliques(page: Page): Promise<Array<{ href: string; download: string | null }>> {
  return page.evaluate(() =>
    (
      window as unknown as { __cliques: Array<{ href: string; download: string | null }> }
    ).__cliques.slice(),
  );
}

async function abrirComCsp(
  page: Page,
  csv: Uint8Array = csvDeTeste(),
  /** Só os autotestes da CSP usam `false`: não dependem do ecrã dos Clientes existir. */
  comEcra = true,
): Promise<void> {
  await escutarViolacoes(page);
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  await fingirApiDeClientes(page, { sessao, csv });
  await page.clock.install({ time: AGORA });
  if (servidor === undefined) throw new Error("o servidor com a CSP de produção não arrancou");
  const resposta = await page.goto(
    `${servidor.origem}/gestao/${comEcra ? "mais/clientes" : "mais"}`,
  );
  expect(
    resposta?.headers()["content-security-policy"],
    "o servidor tem de servir a CSP de produção, tal como está no htaccess.exemplo",
  ).toBe(cspDeProducao());
  if (!comEcra) {
    await expect(page.getByRole("heading", { level: 1, name: "Mais" })).toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: T.h2N(4) })).toBeVisible();
}

async function exportar(page: Page): Promise<{ bytes: Buffer; nome: string }> {
  const [descarga] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: T.exportar, exact: true }).tap(),
  ]);
  const falha = await descarga.failure();
  expect(falha, "a descarga não falhou").toBeNull();
  const caminho = await descarga.path();
  expect(caminho, "o ficheiro descarregado existe").not.toBeNull();
  return { bytes: readFileSync(caminho), nome: descarga.suggestedFilename() };
}

test.describe("a CSP de produção está mesmo a ser aplicada (autotestes)", () => {
  test("a CSP lida do htaccess é a esperada: `img-src 'self' data:`, sem `blob:` e sem inline", () => {
    const csp = cspDeProducao();
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/blob:|unsafe-inline|unsafe-eval/);
  });

  test("um `blob:` é BLOQUEADO como imagem (senão a prova do `data:` não prova nada)", async ({
    page,
  }) => {
    await abrirComCsp(page, csvDeTeste(), false);
    const resultado = await page.evaluate(
      () =>
        new Promise<string>((resolver) => {
          const img = new Image();
          img.onload = () => {
            resolver("carregou");
          };
          img.onerror = () => {
            resolver("bloqueada");
          };
          img.src = URL.createObjectURL(new Blob(["x"], { type: "image/png" }));
        }),
    );
    expect(resultado).toBe("bloqueada");
    expect((await violacoes(page)).map((v) => v.diretiva)).toContain("img-src");
  });
});

test.describe("o CSV com a CSP de produção", () => {
  test("a gestão arranca com a CSP de produção sem nenhuma violação (nem script, nem estilo inline)", async ({
    page,
  }) => {
    await abrirComCsp(page);
    expect(await violacoes(page), "nenhuma violação da CSP").toEqual([]);
  });

  test("«Exportar CSV» descarrega: o evento `download` dispara, com o nome do servidor, e o ficheiro começa pela BOM e tem EXATAMENTE os bytes do mock", async ({
    page,
  }) => {
    const original = csvDeTeste();
    await abrirComCsp(page, original);

    const { bytes, nome } = await exportar(page);

    expect(nome).toBe("clientes-2026-11-02.csv");
    expect(Array.from(bytes.subarray(0, 3)), "o ficheiro começa por EF BB BF").toEqual([
      0xef, 0xbb, 0xbf,
    ]);
    expect(Buffer.compare(bytes, Buffer.from(original)), "byte a byte igual ao do servidor").toBe(
      0,
    );
    expect(bytes.subarray(3).toString("utf-8")).toContain("José Ânimo");
    expect(bytes.toString("utf-8")).toContain("\r\n");
    await expect(page.locator('[role="status"]').filter({ hasText: T.csvPreparado })).toBeVisible();
  });

  test("os 256 valores de byte (UTF-8 inválido incluído) chegam intactos: nada é «descodificado» pelo caminho", async ({
    page,
  }) => {
    const original = csvBinario();
    await abrirComCsp(page, original);

    const { bytes } = await exportar(page);

    expect(Buffer.compare(bytes, Buffer.from(original))).toBe(0);
    expect(bytes.length).toBe(original.length);
  });

  test("o link é `data:text/csv…` com `download` e nunca `blob:`; sai do DOM; e nenhuma violação da CSP", async ({
    page,
  }) => {
    await abrirComCsp(page);
    await exportar(page);

    const usados = await cliques(page);
    expect(usados).toHaveLength(1);
    expect(usados[0]?.href.startsWith("data:text/csv")).toBe(true);
    expect(usados[0]?.href).not.toMatch(/^blob:/);
    expect(usados[0]?.download).toBe("clientes-2026-11-02.csv");
    await expect(page.locator("a[download]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: T.exportar, exact: true })).toBeFocused();
    expect(await violacoes(page), "a descarga não gerou nenhuma violação da CSP").toEqual([]);
  });

  test("um nome do servidor fora do padrão (../x.csv) nunca vira o nome do ficheiro: sai o de reserva, com a data de hoje", async ({
    page,
  }) => {
    await escutarViolacoes(page);
    const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
    await fingirApiDeClientes(page, {
      sessao,
      csvDisposicao: 'attachment; filename="../../etc/passwd.csv"',
    });
    await page.clock.install({ time: AGORA });
    if (servidor === undefined) throw new Error("o servidor com a CSP de produção não arrancou");
    await page.goto(`${servidor.origem}/gestao/mais/clientes`);
    await expect(page.getByRole("heading", { level: 2, name: T.h2N(4) })).toBeVisible();

    const { nome } = await exportar(page);

    expect(nome).toBe("clientes-2026-11-02.csv");
  });

  test("uma resposta que não é CSV (página de erro em HTML) NÃO descarrega: a linha de erro e o botão ativo", async ({
    page,
  }) => {
    await escutarViolacoes(page);
    const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
    await fingirApiDeClientes(page, { sessao, csvTipo: "text/html; charset=utf-8" });
    await page.clock.install({ time: AGORA });
    if (servidor === undefined) throw new Error("o servidor com a CSP de produção não arrancou");
    await page.goto(`${servidor.origem}/gestao/mais/clientes`);
    await expect(page.getByRole("heading", { level: 2, name: T.h2N(4) })).toBeVisible();

    await page.getByRole("button", { name: T.exportar, exact: true }).tap();

    await expect(page.locator('[role="status"]').filter({ hasText: T.csvServidor })).toBeVisible();
    expect(await cliques(page), "nada foi descarregado").toHaveLength(0);
    await expect(page.getByRole("button", { name: T.exportar, exact: true })).toBeEnabled();
  });
});
