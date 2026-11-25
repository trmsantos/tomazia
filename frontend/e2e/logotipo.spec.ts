import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { NOME_ACESSIVEL_DO_LOGOTIPO } from "../src/testes/marca";
import {
  TEXTOS_DO_WIFI,
  abrirAPaginaPublica,
  botaoDoWifi,
  cabecalho,
  medirToken,
} from "./apoio/cabecalho";
import { chips, esperarQueAPaginaPare } from "./apoio/ementa";

/**
 * F3-08, secção 8 ("Testes de componente e e2e"): o logótipo no cabeçalho,
 * medido no browser a 360, 390 e 1024 px.
 *
 * Os que **já passam hoje** são guardas de regressão pedidos pela
 * especificação ("o cabeçalho continua com 61 px", "--ancora-ementa vale o
 * mesmo", "o botão WiFi continua"): estão assinalados com «GUARDA». Todos os
 * outros falham hoje porque não há `<img>` no `<h1>`, e dizem-no por essa
 * razão (o guarda `logotipo()` espera o elemento e falha com mensagem sobre
 * ele, não com um timeout genérico).
 *
 * Assume: o `<img>` está dentro do `<h1>` dentro do `<header>`; o dev server
 * (porta 8075 do `playwright.config.ts`) serve `public/` na raiz.
 */

const PIXEL = 1.1;

/** O logótipo: o único `<img>` do `<h1>`. */
function logotipo(pagina: Page): Locator {
  return pagina.locator("header h1 img");
}

async function caixa(alvo: Locator, quem: string) {
  await expect(
    alvo,
    `não encontrei ${quem}: falta o elemento, não é um tamanho errado`,
  ).toHaveCount(1, {
    timeout: 5_000,
  });
  const medida = await alvo.boundingBox({ timeout: 5_000 });
  expect(medida, `não consegui medir ${quem}`).not.toBeNull();
  return medida as NonNullable<typeof medida>;
}

/** O `<img>` carregou de verdade (não é o `alt` a fazer de texto). */
async function carregado(alvo: Locator): Promise<{ atual: string; natural: number }> {
  await expect(
    alvo,
    "não encontrei o <img> do logótipo: falta o elemento, não é um ficheiro",
  ).toHaveCount(1, {
    timeout: 5_000,
  });
  await expect
    .poll(() => alvo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
      message: "o logótipo não carregou (404 ou ficheiro inválido): era o `alt` que aparecia",
      timeout: 10_000,
    })
    .toBe(true);
  return alvo.evaluate((img: HTMLImageElement) => ({
    atual: img.currentSrc,
    natural: img.naturalWidth,
  }));
}

test.describe("o <h1> é o logótipo", () => {
  test("um só <h1>, com o nome acessível «Bar da Tomazia» (Q-03)", async ({ page }) => {
    await abrirAPaginaPublica(page);

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 1, name: NOME_ACESSIVEL_DO_LOGOTIPO, exact: true }),
    ).toHaveCount(1);
  });

  test("o <h1> não tem texto, nem aria-label: o nome é o alt da imagem", async ({ page }) => {
    await abrirAPaginaPublica(page);
    const titulo = page.locator("header h1");

    expect(((await titulo.textContent()) ?? "").trim(), "sem texto escondido").toBe("");
    expect(await titulo.getAttribute("aria-label")).toBeNull();
    expect(await titulo.getAttribute("aria-labelledby")).toBeNull();
  });

  test("o <img> tem alt, 44×44, srcset 1x/2x/3x, sem lazy e sem style inline", async ({ page }) => {
    await abrirAPaginaPublica(page);
    const img = logotipo(page);
    await caixa(img, "o <img> do logótipo");

    expect(await img.getAttribute("alt")).toBe("Bar da Tomazia");
    expect(await img.getAttribute("width")).toBe("44");
    expect(await img.getAttribute("height")).toBe("44");
    expect(await img.getAttribute("src")).toBe("/marca/logo-88.webp");
    expect(await img.getAttribute("loading"), "acima da dobra: nunca lazy").not.toBe("lazy");
    expect(await img.getAttribute("fetchpriority")).toBeNull();
    expect(await img.getAttribute("style"), "CSP e ADR 0008: sem style inline").toBeNull();

    const srcset = ((await img.getAttribute("srcset")) ?? "").split(",").map((p) => p.trim());
    expect(srcset).toEqual([
      "/marca/logo-44.webp 1x",
      "/marca/logo-88.webp 2x",
      "/marca/logo-132.webp 3x",
    ]);
  });

  test("não é uma ligação nem um botão, e não é focável", async ({ page }) => {
    await abrirAPaginaPublica(page);
    const img = logotipo(page);
    await caixa(img, "o <img> do logótipo");

    const estado = await img.evaluate((el) => ({
      dentroDeLigacao: el.closest("a, button, [role=button], [role=link]") !== null,
      tabindex: el.getAttribute("tabindex"),
      tituloTabindex: el.closest("h1")?.getAttribute("tabindex") ?? null,
      cursor: getComputedStyle(el).cursor,
    }));
    expect(estado.dentroDeLigacao).toBe(false);
    expect(estado.tabindex).toBeNull();
    expect(estado.tituloTabindex).toBeNull();
    expect(estado.cursor, "sem hover nem ar de clicável").not.toBe("pointer");
  });

  test("a ordem de tabulação continua: Saltar para a ementa, WiFi, chips (Q-04)", async ({
    page,
  }) => {
    await abrirAPaginaPublica(page);
    await caixa(
      logotipo(page),
      "o <img> do logótipo (sem ele a ordem não mudou, mas nada foi provado)",
    );

    const nomes: string[] = [];
    await page.locator("body").press("Tab");
    for (let i = 0; i < 3; i += 1) {
      nomes.push(
        await page.evaluate(() => {
          const ativo = document.activeElement;
          if (ativo === null || ativo === document.body) return "(corpo)";
          const dentroDaBarra = ativo.closest("[id*=barra], nav") !== null;
          return `${ativo.tagName.toLowerCase()}|${(ativo.textContent ?? "").trim()}|${String(dentroDaBarra)}`;
        }),
      );
      // Só avança entre leituras: o `Tab` depois da última deixava o foco na 4.ª paragem.
      if (i < 2) await page.keyboard.press("Tab");
    }
    expect(nomes[0]).toBe(`a|${TEXTOS_DO_WIFI.saltar}|false`);
    expect(nomes[1]).toBe(`button|${TEXTOS_DO_WIFI.wifi}|false`);
    expect(nomes[2], "a terceira paragem é um chip, não o logótipo").not.toMatch(/^img\|/);
    await expect(chips(page).first()).toBeFocused();
  });

  test("o botão «WiFi» continua no cabeçalho, à direita do logótipo (GUARDA)", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await expect(botaoDoWifi(page)).toBeVisible();
    await expect(cabecalho(page).getByRole("button", { name: "WiFi", exact: true })).toHaveCount(1);
  });
});

test.describe("o srcset serve o ficheiro certo para cada densidade", () => {
  for (const [densidade, ficheiro, lado] of [
    [1, "logo-44.webp", 44],
    [2, "logo-88.webp", 88],
    [3, "logo-132.webp", 132],
  ] as const) {
    test.describe(`${String(densidade)}x`, () => {
      test.use({ deviceScaleFactor: densidade });

      test(`escolhe ${ficheiro} (${String(lado)} px naturais)`, async ({ page }) => {
        await abrirAPaginaPublica(page);
        const lido = await carregado(logotipo(page));
        expect(lido.atual.endsWith(`/marca/${ficheiro}`)).toBe(true);
        // Com descritor de densidade, `naturalWidth` é a largura real a dividir
        // pela densidade (88 px a 2x dá 44): o que se verifica é o produto.
        expect(lido.natural * densidade).toBe(lado);
      });
    });
  }
});

for (const largura of [360, 390]) {
  test.describe(`${String(largura)} px`, () => {
    test.use({ viewport: { width: largura, height: largura === 360 ? 800 : 844 } });

    test("nada transborda, o logótipo mede 44×44 e o WiFi fica a 16 px do bordo", async ({
      page,
    }) => {
      await abrirAPaginaPublica(page);
      const logo = await caixa(logotipo(page), "o logótipo");
      const wifi = await caixa(botaoDoWifi(page), "o botão WiFi");

      const doc = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        cliente: document.documentElement.clientWidth,
      }));
      expect(doc.scroll, "scrollWidth == clientWidth: sem deslize para o lado").toBe(doc.cliente);

      expect(logo.width).toBeCloseTo(44, 0);
      expect(logo.height).toBeCloseTo(44, 0);
      expect(logo.x, "o logótipo começa na margem da coluna").toBeCloseTo(16, 0);

      expect(wifi.width).toBeGreaterThanOrEqual(79 - PIXEL);
      expect(wifi.height).toBeGreaterThanOrEqual(44 - PIXEL);
      expect(largura - (wifi.x + wifi.width), "aresta direita a 16 px").toBeCloseTo(16, 0);

      expect(logo.x + logo.width, "não se sobrepõem").toBeLessThanOrEqual(wifi.x - PIXEL);
      expect(logo.y, "dentro do cabeçalho").toBeGreaterThanOrEqual(0);
      expect(logo.y + logo.height).toBeLessThanOrEqual(61 + PIXEL);
    });

    test("GUARDA: o cabeçalho tem 61 px e --ancora-ementa vale 138 px", async ({ page }) => {
      await abrirAPaginaPublica(page);
      const cab = await caixa(cabecalho(page), "o cabeçalho");
      expect(cab.height).toBeCloseTo(61, 0);

      const ancora = await medirToken(page, "--ancora-ementa");
      expect(
        ancora.altura,
        `não consegui resolver --ancora-ementa («${ancora.bruto}»)`,
      ).toBeGreaterThan(0);
      expect(ancora.altura).toBeCloseTo(138, 0);
      const altura = await medirToken(page, "--altura-cabecalho");
      expect(altura.altura).toBeCloseTo(61, 0);
    });

    test("o círculo vê-se inteiro: o <img> não é esmagado nem cortado", async ({ page }) => {
      await abrirAPaginaPublica(page);
      await carregado(logotipo(page));
      const logo = await caixa(logotipo(page), "o logótipo");
      expect(logo.width).toBeCloseTo(logo.height, 0);
      const estilo = await logotipo(page).evaluate((el) => {
        const e = getComputedStyle(el);
        return { display: e.display, flexShrink: e.flexShrink };
      });
      expect(estilo.display, "`block` (secção 2)").toBe("block");
      expect(estilo.flexShrink, "`shrink-0` (secção 2)").toBe("0");
    });
  });
}

test.describe("1024 px", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("o logótipo não cresce e alinha com a coluna", async ({ page }) => {
    await abrirAPaginaPublica(page);
    const logo = await caixa(logotipo(page), "o logótipo");
    const cartao = await caixa(page.locator('section[id^="ementa-"]').first(), "o primeiro cartão");

    expect(logo.width).toBeCloseTo(44, 0);
    expect(logo.height).toBeCloseTo(44, 0);
    expect(logo.x, "alinha com a coluna dos cartões").toBeCloseTo(cartao.x, 0);

    const doc = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(doc[0]).toBe(doc[1]);
  });

  test("GUARDA: o cabeçalho continua a 61 px", async ({ page }) => {
    await abrirAPaginaPublica(page);
    expect((await caixa(cabecalho(page), "o cabeçalho")).height).toBeCloseTo(61, 0);
  });
});

test.describe("scroll, Q-03", () => {
  test("ao deslizar até ao rodapé o logótipo fica visível e no mesmo sítio", async ({ page }) => {
    await abrirAPaginaPublica(page);
    const antes = await caixa(logotipo(page), "o logótipo");

    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);

    expect(await page.evaluate(() => window.scrollY), "guarda: a página deslizou").toBeGreaterThan(
      500,
    );
    await expect(logotipo(page)).toBeInViewport({ ratio: 1 });
    const depois = await caixa(logotipo(page), "o logótipo depois do scroll");
    expect(depois).toEqual(antes);
  });

  test("axe sem violações graves na página com o logótipo", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await carregado(logotipo(page));

    const resultado = await new AxeBuilder({ page }).analyze();
    const graves = resultado.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(graves.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(
      resultado.violations.filter((v) => v.id === "image-alt" || v.id === "page-has-heading-one"),
    ).toEqual([]);
  });
});
