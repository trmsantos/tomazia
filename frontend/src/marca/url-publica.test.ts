// @vitest-environment node
/** F3-08, secção 5: a forma do endereço público, com a regra 10 nos dois sentidos. */
import { describe, expect, it } from "vitest";

import { resolverUrlPublica } from "../../url-publica";

const com = (v: string | undefined): Record<string, string | undefined> => ({
  VITE_URL_PUBLICA: v,
});

describe("resolverUrlPublica", () => {
  it("em build aceita https://anfitrião e tira a barra final", () => {
    expect(resolverUrlPublica("build", com("https://bardatomazia.pt"))).toBe(
      "https://bardatomazia.pt",
    );
    expect(resolverUrlPublica("build", com("https://novo.bardatomazia.pt/"))).toBe(
      "https://novo.bardatomazia.pt",
    );
  });

  it.each([
    undefined,
    "",
    "   ",
    "http://bardatomazia.pt",
    "bardatomazia.pt",
    "https://",
    "https://a.pt/caminho",
    "https://a b.pt",
    'https://a.pt"x',
    "https://a.pt//",
  ])("em build recusa %j, e a mensagem nomeia a variável", (valor) => {
    // `https://a.pt//` perde as barras finais e é válido: o caso fica de fora.
    if (valor === "https://a.pt//") {
      expect(resolverUrlPublica("build", com(valor))).toBe("https://a.pt");
      return;
    }
    expect(() => resolverUrlPublica("build", com(valor))).toThrow(/VITE_URL_PUBLICA/);
  });

  it("em desenvolvimento não a exige", () => {
    expect(resolverUrlPublica("serve", com(undefined))).toBe("http://localhost:5173");
  });
});
