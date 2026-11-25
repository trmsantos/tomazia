import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { BORDO_NOITE, CREME_PAPEL } from "../src/testes/marca";

/**
 * F3-08, secção 1: o desenho dos ficheiros, lido em pixéis por um canvas do
 * browser (o Vitest em Node não descodifica WebP, e não se acrescentam
 * dependências).
 *
 * Prova as três decisões da secção 1: (a) a faixa entre o aro e o disco está
 * **cheia de creme `#f5e6d3`**, (b) fora do círculo é transparente, (c) o
 * apple-touch-icon e a og-image assentam em `bordo-noite` `#3d0f24`.
 *
 * Geometria do original (medida): o círculo tem raio 105,5 numa caixa de
 * 215 px; a faixa transparente vai dos raios 78 a 93,5. Os raios de amostra
 * deixam 3 px de margem de cada lado para o anti-aliasing e o JPEG.
 *
 * **O que não prova:** que o aro e o texto sejam fiéis ao original, nem que
 * o círculo "se distingue" do cabeçalho (é para os olhos, nas capturas).
 *
 * O tipo de conteúdo de cada ficheiro é verificado antes de o descodificar (ver `ler`).
 */

type Pixeis = {
  largura: number;
  altura: number;
  dados: number[];
};

async function ler(pagina: Page, caminho: string): Promise<Pixeis> {
  // O pedido é feito do lado do Node (sem `fetch` no código do browser): o
  // servidor de desenvolvimento responde ao que não existe com o `index.html`
  // e estado 200, e sem este guarda "não existe" passava por "não descodifica".
  const resposta = await pagina.request.get(caminho);
  const tipo = resposta.headers()["content-type"] ?? "";
  expect(
    resposta.ok() && tipo.startsWith("image/"),
    `${caminho}: estado ${String(resposta.status())}, tipo «${tipo}» — o ficheiro não existe`,
  ).toBe(true);

  return pagina.evaluate(async (alvo) => {
    const imagem = new Image();
    imagem.src = alvo;
    await imagem.decode();
    const tela = document.createElement("canvas");
    tela.width = imagem.naturalWidth;
    tela.height = imagem.naturalHeight;
    const contexto = tela.getContext("2d");
    if (contexto === null) throw new Error("sem contexto 2d");
    contexto.drawImage(imagem, 0, 0);
    const lido = contexto.getImageData(0, 0, tela.width, tela.height);
    return { largura: tela.width, altura: tela.height, dados: [...lido.data] };
  }, caminho);
}

function px(p: Pixeis, x: number, y: number): [number, number, number, number] {
  const i = (y * p.largura + x) * 4;
  return [p.dados[i] ?? -1, p.dados[i + 1] ?? -1, p.dados[i + 2] ?? -1, p.dados[i + 3] ?? -1];
}

function perto(a: readonly number[], b: readonly number[], tolerancia: number): boolean {
  return [0, 1, 2].every((k) => Math.abs((a[k] ?? 999) - (b[k] ?? -999)) <= tolerancia);
}

/**
 * A fração de pixéis, no anel de raios [r0, r1] à volta de (cx, cy), que
 * são opacos e creme.
 */
function fracaoDeCreme(
  p: Pixeis,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  tolerancia: number,
): number {
  let total = 0;
  let creme = 0;
  for (let y = 0; y < p.altura; y += 1) {
    for (let x = 0; x < p.largura; x += 1) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (r < r0 || r > r1) continue;
      total += 1;
      const [R, G, B, A] = px(p, x, y);
      if (A >= 250 && perto([R, G, B], CREME_PAPEL, tolerancia)) creme += 1;
    }
  }
  expect(total, "guarda: o anel de amostra tem de ter pixéis").toBeGreaterThan(50);
  return creme / total;
}

test.beforeEach(async ({ page }) => {
  // Qualquer página da mesma origem serve de base para os `fetch`. Sem
  // `/api` a responder, o importante é só estar na origem certa.
  await page.goto("/demonstracao.html");
});

/** A faixa vai de 78/105,5 a 93,5/105,5 do raio do círculo. */
const FAIXA = { de: 78 / 105.5, ate: 93.5 / 105.5 };
const MARGEM = 3;

for (const lado of [44, 88, 132]) {
  test(`logo-${String(lado)}.webp: círculo transparente por fora, faixa de creme por dentro`, async ({
    page,
  }) => {
    const p = await ler(page, `/marca/logo-${String(lado)}.webp`);
    expect([p.largura, p.altura]).toEqual([lado, lado]);

    for (const [x, y] of [
      [0, 0],
      [lado - 1, 0],
      [0, lado - 1],
      [lado - 1, lado - 1],
    ] as const) {
      expect(px(p, x, y)[3], `canto (${String(x)}, ${String(y)}) transparente`).toBeLessThan(8);
    }

    const centro = lado / 2;
    const raio = (lado / 2) * (105.5 / 107.5);
    expect(px(p, Math.floor(centro), Math.floor(centro))[3], "o centro é opaco").toBe(255);

    const margem = (MARGEM * lado) / 132;
    const fracao = fracaoDeCreme(
      p,
      centro,
      centro,
      raio * FAIXA.de + margem,
      raio * FAIXA.ate - margem,
      lado === 44 ? 20 : 12,
    );
    expect(
      fracao,
      "a faixa entre o aro e o disco tem de estar cheia de creme #f5e6d3 (o arco dourado " +
        "toca a faixa, daí não ser 100%)",
    ).toBeGreaterThan(0.8);
  });
}

test("apple-touch-icon: opaco, bordo-noite nos cantos, logótipo de 144 px ao centro", async ({
  page,
}) => {
  const p = await ler(page, "/apple-touch-icon.png");
  expect([p.largura, p.altura]).toEqual([180, 180]);
  for (const [x, y] of [
    [0, 0],
    [179, 0],
    [0, 179],
    [179, 179],
  ] as const) {
    const pixel = px(p, x, y);
    expect(pixel[3]).toBe(255);
    expect(perto(pixel, BORDO_NOITE, 2), `canto (${String(x)}, ${String(y)}) = bordo-noite`).toBe(
      true,
    );
  }
  const raio = (144 / 2) * (105.5 / 107.5);
  const fracao = fracaoDeCreme(p, 90, 90, raio * FAIXA.de + 2, raio * FAIXA.ate - 2, 14);
  expect(fracao, "a faixa de creme está lá, à escala de 144 px").toBeGreaterThan(0.8);
  expect(
    perto(px(p, 90, 5), BORDO_NOITE, 2),
    "margem de 18 px acima do logótipo: ainda bordo-noite",
  ).toBe(true);
});

test("og-image: bordo-noite liso, logótipo de 420 px centrado", async ({ page }) => {
  const p = await ler(page, "/og-image.jpg");
  expect([p.largura, p.altura]).toEqual([1200, 630]);
  for (const [x, y] of [
    [2, 2],
    [1197, 2],
    [2, 627],
    [1197, 627],
    [150, 315],
    [1050, 315],
  ] as const) {
    expect(
      perto(px(p, x, y), BORDO_NOITE, 8),
      `(${String(x)}, ${String(y)}) é bordo-noite (JPEG, tolerância 8)`,
    ).toBe(true);
  }
  const raio = (420 / 2) * (105.5 / 107.5);
  const fracao = fracaoDeCreme(p, 600, 315, raio * FAIXA.de + 4, raio * FAIXA.ate - 4, 24);
  expect(fracao, "a faixa de creme está lá, à escala de 420 px").toBeGreaterThan(0.8);
});

test("favicon-32.png: círculo com fora transparente", async ({ page }) => {
  const p = await ler(page, "/favicon-32.png");
  expect([p.largura, p.altura]).toEqual([32, 32]);
  expect(px(p, 0, 0)[3]).toBeLessThan(8);
  expect(px(p, 31, 31)[3]).toBeLessThan(8);
  expect(px(p, 16, 16)[3]).toBe(255);
});
