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
    // Várias barras finais também saem todas, e o que fica é válido.
    expect(resolverUrlPublica("build", com("https://a.pt//"))).toBe("https://a.pt");
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
  ])("em build recusa %j, e a mensagem nomeia a variável", (valor) => {
    expect(() => resolverUrlPublica("build", com(valor))).toThrow(/VITE_URL_PUBLICA/);
  });

  it("em desenvolvimento não a exige", () => {
    expect(resolverUrlPublica("serve", com(undefined))).toBe("http://localhost:5173");
  });
});
