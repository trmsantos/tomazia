import { describe, expect, it } from "vitest";

import { avisoDePrecoQueFicou } from "./textos";

describe("avisoDePrecoQueFicou", () => {
  it("com um preço a continuar, diz qual", () => {
    expect(avisoDePrecoQueFicou(650)).toMatch(
      /^Não consegui desfazer\. O preço continua 6,50\s€\.$/,
    );
  });

  it("com 0 diz que continua como oferta, nunca «0,00 €»", () => {
    expect(avisoDePrecoQueFicou(0)).toBe(
      "Não consegui desfazer. Este produto continua como oferta.",
    );
  });
});
