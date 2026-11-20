import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { TEXTOS as T } from "../src/pages/gestao/galeria/textos";
import { AGORA } from "../src/testes/eventos";
import { gerarImagemNaPagina } from "./apoio/galeria";
import { fingirApiDeSessao } from "./apoio/gestao";
import { fingirApiDasFotos, imagemDaFoto } from "./apoio/gestao-fotos";
import { construirEServir, cspDeProducao, type ServidorComCsp } from "./apoio/servir-com-csp";

/**
 * F4-04, decisão D6 e spec 7.3 — **a pré-visualização da folha «Enviar foto» vê-se com a CSP de
 * produção**.
 *
 * A CSP de produção (`deploy/htaccess.exemplo`) é `img-src 'self' data:`: **`blob:` está
 * bloqueado**. Uma prévia feita com `URL.createObjectURL` vê-se no servidor de desenvolvimento e
 * nos testes (que não aplicam a CSP) e **não se vê em produção**: foi o defeito da
 * `FolhaEnviarFoto` pública (corrigido à parte, `tarefa/F3-05b-previa-sem-blob`). A da gestão tem de
 * ser um `data:` URL do ficheiro já reduzido.
 *
 * Aqui compila-se o frontend e serve-se **o build** com **o cabeçalho exato** do
 * `deploy/htaccess.exemplo` (`apoio/servir-com-csp.ts`). A API continua fingida com `page.route`.
 *
 * **Os dois autotestes** (sem eles, «a prévia aparece» passava também se a CSP não estivesse a ser
 * aplicada — «não estive a ver» a passar por «está certo», a regra 10):
 *  1. um `blob:` posto de propósito **é bloqueado** (e fica registada a violação de `img-src`);
 *  2. um `data:` posto de propósito **carrega**.
 *
 * E a página inteira arranca sem **nenhuma** violação (nem `script-src` nem `style-src`): é também
 * a rede contra um `style` inline ou um script inline que o servidor de desenvolvimento deixa passar.
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
  });
}
function violacoes(page: Page): Promise<Violacao[]> {
  return page.evaluate(() =>
    (window as unknown as { __violacoes: Violacao[] }).__violacoes.slice(),
  );
}
async function limparViolacoes(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __violacoes: Violacao[] }).__violacoes.length = 0;
  });
}

async function abrirComCsp(page: Page): Promise<void> {
  await escutarViolacoes(page);
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  await fingirApiDasFotos(page, { inicial: [], sessao });
  await page.clock.install({ time: AGORA });
  if (servidor === undefined) throw new Error("o servidor com a CSP de produção não arrancou");
  const resposta = await page.goto(`${servidor.origem}/gestao/galeria`);
  expect(
    resposta?.headers()["content-security-policy"],
    "o servidor tem de servir a CSP de produção, tal como está no htaccess.exemplo",
  ).toBe(cspDeProducao());
  await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
  await expect(page.getByText(T.vazioTitulo)).toBeVisible();
}

test.describe("a CSP de produção está mesmo a ser aplicada (autotestes)", () => {
  test("a CSP lida do htaccess é a esperada: `img-src 'self' data:` e `style-src 'self'`", () => {
    const csp = cspDeProducao();
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/blob:|unsafe-inline|unsafe-eval/);
  });

  test("um `blob:` é BLOQUEADO e um `data:` carrega (senão a prova da prévia não prova nada)", async ({
    page,
  }) => {
    await abrirComCsp(page);
    await limparViolacoes(page);
    const png = imagemDaFoto(1).toString("base64");

    const resultado = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const carregar = (src: string): Promise<string> =>
        new Promise((resolver) => {
          const img = new Image();
          img.onload = () => {
            resolver("carregou");
          };
          img.onerror = () => {
            resolver("bloqueada");
          };
          img.src = src;
        });
      const blob = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      return {
        blob: await carregar(blob),
        data: await carregar(`data:image/png;base64,${base64}`),
      };
    }, png);

    expect(resultado.blob, "o blob: tem de ser bloqueado pela CSP de produção").toBe("bloqueada");
    expect(resultado.data, "o data: tem de carregar").toBe("carregou");
    const registadas = await violacoes(page);
    expect(registadas.map((v) => v.diretiva)).toContain("img-src");
    // O Chromium reduz o `blockedURI` de um `blob:`/`data:` ao esquema (`"blob"`, `"data"`).
    expect(registadas.some((v) => /^blob/.test(v.bloqueado))).toBe(true);
    expect(registadas.some((v) => /^data/.test(v.bloqueado))).toBe(false);
  });
});

test("a gestão arranca com a CSP de produção sem nenhuma violação (nem script, nem estilo inline)", async ({
  page,
}) => {
  await abrirComCsp(page);
  await page.getByRole("button", { name: T.enviarFoto, exact: true }).tap();
  await expect(page.getByRole("dialog", { name: T.tituloEnviar })).toBeVisible();

  expect(await violacoes(page), "nenhuma violação da CSP").toEqual([]);
});

test("a pré-visualização da folha «Enviar foto» APARECE com a CSP de produção: é um `data:` URL e descodificou", async ({
  page,
}) => {
  await abrirComCsp(page);
  await limparViolacoes(page);
  const jpeg = await gerarImagemNaPagina(page, { largura: 800, altura: 600 });
  await page.getByRole("button", { name: T.enviarFoto, exact: true }).tap();
  const folha = page.getByRole("dialog", { name: T.tituloEnviar });

  await folha
    .getByLabel(/^Foto/)
    .setInputFiles({ name: "jantar.jpg", mimeType: "image/jpeg", buffer: jpeg });

  const previa = folha.locator("img");
  await expect(previa).toBeVisible();
  await expect(previa).toHaveAttribute("src", /^data:image\//);
  expect(await previa.getAttribute("src")).not.toMatch(/^blob:/);
  await expect
    .poll(() => previa.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
      message: "a imagem da prévia tem de descodificar (não ser o ícone de imagem partida)",
    })
    .toBe(true);
  const caixa = await previa.boundingBox();
  expect(caixa?.width ?? 0, "a prévia ocupa lugar no ecrã").toBeGreaterThan(40);
  expect(caixa?.height ?? 0).toBeGreaterThan(40);

  expect(await violacoes(page), "a prévia não gerou nenhuma violação de img-src").toEqual([]);
});

test("com a CSP de produção o envio inteiro corre: prévia, legenda, enviar, aviso", async ({
  page,
}) => {
  await abrirComCsp(page);
  const jpeg = await gerarImagemNaPagina(page, { largura: 400, altura: 300 });
  await limparViolacoes(page);
  await page.getByRole("button", { name: T.enviarFoto, exact: true }).tap();
  const folha = page.getByRole("dialog", { name: T.tituloEnviar });
  await folha
    .getByLabel(/^Foto/)
    .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(folha.locator("img")).toBeVisible();
  await folha.getByLabel(T.etiquetaLegenda, { exact: true }).fill("Noite de samba");

  await folha.getByRole("button", { name: T.enviar, exact: true }).tap();

  await expect(page.locator('[role="status"]').filter({ hasText: T.fotoEnviada })).toBeVisible();
  expect(await violacoes(page)).toEqual([]);
});
