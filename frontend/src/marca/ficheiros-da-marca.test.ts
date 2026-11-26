// @vitest-environment node
/**
 * F3-08, secção 3 e secção 8 (pesos, dimensões, canal alfa): os ficheiros
 * versionados em `frontend/public/`, lidos pelos cabeçalhos.
 *
 * Todos falham hoje porque os ficheiros não existem. Cada falha diz "não
 * consegui ler", que é a causa verdadeira, e não uma comparação de zeros.
 *
 * O que **não** se prova aqui: que o desenho está certo (o círculo, o creme,
 * o aro). Isso decide-se com pixéis, num browser: `e2e/logotipo-pixeis.spec.ts`.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lerBytes, lerIco, lerJpeg, lerPng, lerWebp } from "../testes/imagens";
import { LOGOTIPOS, OUTROS_ICONES, TETO_DA_SOMA_DOS_LOGOTIPOS } from "../testes/marca";
import { RAIZ_FRONTEND } from "../testes/percorrer-arvore";

const PUBLICO = join(RAIZ_FRONTEND, "public");

function peso(relativo: string): number {
  try {
    return statSync(join(PUBLICO, relativo)).size;
  } catch (erro) {
    throw new Error(
      `não consegui medir public/${relativo}: ${String(erro)}. O ficheiro não existe ainda; ` +
        "não é um ficheiro pesado de mais.",
    );
  }
}

describe("os logótipos do cabeçalho", () => {
  it.each(LOGOTIPOS)("$ficheiro é um WebP $lado×$lado com alfa", ({ ficheiro, lado }) => {
    const info = lerWebp(lerBytes(join(PUBLICO, ficheiro), `public/${ficheiro}`), ficheiro);
    expect({ largura: info.largura, altura: info.altura }).toEqual({ largura: lado, altura: lado });
    expect(info.temAlfa, "fora do círculo é transparente (secção 3)").toBe(true);
  });

  it.each(LOGOTIPOS)(
    "$ficheiro pesa menos do que o teto da especificação",
    ({ ficheiro, teto }) => {
      expect(peso(ficheiro)).toBeLessThanOrEqual(teto);
    },
  );

  it("a soma dos três pesa menos de 24 KB", () => {
    const soma = LOGOTIPOS.reduce((total, { ficheiro }) => total + peso(ficheiro), 0);
    expect(soma).toBeLessThanOrEqual(TETO_DA_SOMA_DOS_LOGOTIPOS);
  });
});

describe("o favicon e o apple-touch-icon", () => {
  it("favicon.ico abre e tem entradas de 16, 32 e 48", () => {
    const entradas = lerIco(lerBytes(join(PUBLICO, "favicon.ico"), "favicon.ico"), "favicon.ico");
    const lados = entradas.map((e) => `${String(e.largura)}x${String(e.altura)}`).sort();
    expect(lados).toEqual(["16x16", "32x32", "48x48"]);
  });

  it("favicon-32.png é um PNG 32×32", () => {
    const png = lerPng(
      lerBytes(join(PUBLICO, "favicon-32.png"), "favicon-32.png"),
      "favicon-32.png",
    );
    expect({ largura: png.largura, altura: png.altura }).toEqual({ largura: 32, altura: 32 });
  });

  it("apple-touch-icon.png é 180×180, RGB sem alfa e sem tRNS", () => {
    const png = lerPng(
      lerBytes(join(PUBLICO, "apple-touch-icon.png"), "apple-touch-icon.png"),
      "apple-touch-icon.png",
    );
    expect({ largura: png.largura, altura: png.altura }).toEqual({ largura: 180, altura: 180 });
    expect(
      png.tipoDeCor,
      "o iOS põe preto onde há transparência: tem de ser opaco, tipo de cor 2 (RGB), nem 4 nem 6",
    ).toBe(2);
    expect(png.temTrns, "sem chunk tRNS").toBe(false);
  });

  it("og-image.jpg é um JPEG 1200×630", () => {
    const jpeg = lerJpeg(lerBytes(join(PUBLICO, "og-image.jpg"), "og-image.jpg"), "og-image.jpg");
    expect(jpeg).toEqual({ largura: 1200, altura: 630 });
  });
});

describe("os pesos dos restantes ícones (Q-02)", () => {
  it.each(Object.entries(OUTROS_ICONES))("%s pesa menos de %d bytes", (ficheiro, teto) => {
    expect(peso(ficheiro)).toBeLessThanOrEqual(teto);
  });
});
