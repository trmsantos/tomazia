import { fileURLToPath } from "node:url";

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

const CAMINHO_DO_ORIGINAL = fileURLToPath(
  new URL("../../docs/marca/tomazia-original.png", import.meta.url),
);

type MapaDaFaixa = {
  vazios: number;
  cremeEmVazios: number;
  tinta: number;
  cremeEmTinta: number;
};

/**
 * Compara, pixel a pixel, a faixa do ficheiro gerado com a do original.
 *
 * No anel de raios 78 a 93,5 (em px do original, centro 111,5 × 114) só 61,9%
 * dos pixéis do original são transparentes; o resto é o arco dourado, que a
 * especificação manda não mexer. Por isso a pergunta não é "que fração da
 * faixa é creme", é: (a) dos pixéis que eram **transparentes** no original,
 * quantos são creme agora (tem de ser quase todos) e (b) dos que eram **tinta**
 * (o arco), quantos continuam a não ser creme (tem de ser quase todos).
 *
 * Cada pixel do ficheiro mapeia-se para o original pela escala e pelo centro
 * do círculo (`escala` = px do ficheiro por px do original; `cx`,`cy` = centro
 * do círculo no ficheiro). Só entram pixéis cuja vizinhança de 2 px do original
 * é toda transparente ou toda opaca: nas fronteiras o reamostrar mistura, e aí
 * não há "resposta certa" por pixel.
 */
async function compararAFaixa(
  pagina: Page,
  caminho: string,
  escala: number,
  cx: number,
  cy: number,
  tolerancia: number,
): Promise<MapaDaFaixa> {
  await pagina.route("**/__original.png", (rota) =>
    rota.fulfill({ path: CAMINHO_DO_ORIGINAL, contentType: "image/png" }),
  );
  // Só o guarda do tipo de conteúdo: os pixéis lêem-se dentro do browser, sem
  // atravessar 3 milhões de números para o Node (a og-image tem 756 mil px).
  const resposta = await pagina.request.get(caminho);
  expect(
    resposta.ok() && (resposta.headers()["content-type"] ?? "").startsWith("image/"),
    `${caminho}: o ficheiro não existe`,
  ).toBe(true);
  return pagina.evaluate(
    async ({ caminho, escala, cx, cy, tolerancia, creme }) => {
      const original = new Image();
      original.src = "/__original.png";
      await original.decode();
      const tela = document.createElement("canvas");
      tela.width = original.naturalWidth;
      tela.height = original.naturalHeight;
      const contexto = tela.getContext("2d");
      if (contexto === null) throw new Error("sem contexto 2d");
      contexto.drawImage(original, 0, 0);
      const o = contexto.getImageData(0, 0, tela.width, tela.height);

      const gerado = new Image();
      gerado.src = caminho;
      await gerado.decode();
      const telaG = document.createElement("canvas");
      telaG.width = gerado.naturalWidth;
      telaG.height = gerado.naturalHeight;
      const contextoG = telaG.getContext("2d");
      if (contextoG === null) throw new Error("sem contexto 2d");
      contextoG.drawImage(gerado, 0, 0);
      const alvo = {
        largura: telaG.width,
        altura: telaG.height,
        dados: contextoG.getImageData(0, 0, telaG.width, telaG.height).data,
      };
      const alcance = Math.ceil(93.5 * escala) + 1;
      const alfaOriginal = (x: number, y: number): number =>
        x < 0 || y < 0 || x >= o.width || y >= o.height
          ? 0
          : (o.data[(y * o.width + x) * 4 + 3] ?? 0);

      let vazios = 0;
      let cremeEmVazios = 0;
      let tinta = 0;
      let cremeEmTinta = 0;
      for (
        let y = Math.max(0, Math.floor(cy - alcance));
        y < Math.min(alvo.altura, cy + alcance);
        y += 1
      ) {
        for (
          let x = Math.max(0, Math.floor(cx - alcance));
          x < Math.min(alvo.largura, cx + alcance);
          x += 1
        ) {
          const dx = (x + 0.5 - cx) / escala;
          const dy = (y + 0.5 - cy) / escala;
          const r = Math.hypot(dx, dy);
          if (r < 78 + 3 || r > 93.5 - 3) continue;
          const ox = Math.floor(111.5 + dx);
          const oy = Math.floor(114 + dy);
          let minimo = 255;
          let maximo = 0;
          for (let vy = -2; vy <= 2; vy += 1) {
            for (let vx = -2; vx <= 2; vx += 1) {
              const a = alfaOriginal(ox + vx, oy + vy);
              minimo = Math.min(minimo, a);
              maximo = Math.max(maximo, a);
            }
          }
          const i = (y * alvo.largura + x) * 4;
          const d = alvo.dados;
          const eCreme =
            (d[i + 3] ?? 0) >= 250 &&
            [0, 1, 2].every((k) => Math.abs((d[i + k] ?? 999) - (creme[k] ?? -999)) <= tolerancia);
          if (maximo < 10) {
            vazios += 1;
            if (eCreme) cremeEmVazios += 1;
          } else if (minimo >= 250) {
            tinta += 1;
            if (eCreme) cremeEmTinta += 1;
          }
        }
      }
      return { vazios, cremeEmVazios, tinta, cremeEmTinta };
    },
    { caminho, escala, cx, cy, tolerancia, creme: [...CREME_PAPEL] },
  );
}

function exigirFaixaCreme(mapa: MapaDaFaixa, onde: string): void {
  expect(
    mapa.vazios,
    `${onde}: guarda, a amostra da faixa vazia tem de ter pixéis`,
  ).toBeGreaterThan(20);
  expect(
    mapa.cremeEmVazios / mapa.vazios,
    `${onde}: os pixéis que eram transparentes no original, na faixa, têm de ser creme #f5e6d3`,
  ).toBeGreaterThan(0.8);
  expect(mapa.tinta, `${onde}: guarda, a amostra do arco tem de ter pixéis`).toBeGreaterThan(5);
  expect(
    mapa.cremeEmTinta / mapa.tinta,
    `${onde}: o arco dourado (tinta do original) não pode ter sido pintado de creme`,
  ).toBeLessThan(0.2);
}

test.beforeEach(async ({ page }) => {
  // Qualquer página da mesma origem serve de base para os `fetch`. Sem
  // `/api` a responder, o importante é só estar na origem certa.
  await page.goto("/demonstracao.html");
});

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
    expect(px(p, Math.floor(centro), Math.floor(centro))[3], "o centro é opaco").toBe(255);

    exigirFaixaCreme(
      await compararAFaixa(
        page,
        `/marca/logo-${String(lado)}.webp`,
        lado / 215,
        centro,
        centro,
        lado === 44 ? 20 : 12,
      ),
      `logo-${String(lado)}`,
    );
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
  exigirFaixaCreme(
    await compararAFaixa(page, "/apple-touch-icon.png", 144 / 215, 90, 90, 14),
    "apple-touch-icon",
  );
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
  exigirFaixaCreme(
    await compararAFaixa(page, "/og-image.jpg", 420 / 215, 600, 315, 24),
    "og-image",
  );
});

test("favicon-32.png: círculo com fora transparente", async ({ page }) => {
  const p = await ler(page, "/favicon-32.png");
  expect([p.largura, p.altura]).toEqual([32, 32]);
  expect(px(p, 0, 0)[3]).toBeLessThan(8);
  expect(px(p, 31, 31)[3]).toBeLessThan(8);
  expect(px(p, 16, 16)[3]).toBe(255);
});
