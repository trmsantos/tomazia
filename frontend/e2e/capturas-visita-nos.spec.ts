import { expect, test } from "@playwright/test";

import { infoCom, infoCompleta, TELEFONE_DE_TESTE } from "../src/testes/visita-nos";
import { guardar } from "./apoio/capturas";
import {
  MOMENTOS,
  TEXTOS_DO_VISITA_NOS as T,
  abrirComVisitaNos,
  botaoDeTentarOutraVez,
  linhaDoMomento,
  seccaoDaVisita,
} from "./apoio/visita-nos";

/**
 * F3-06a, 11.1 — as capturas que a revisão ui-ux abre.
 *
 * No padrão do `capturas-galeria.spec.ts`: não comparam com imagem de
 * referência, servem a revisão e o PR (o `CLAUDE.md` obriga a capturas a
 * 390 × 844 para qualquer alteração visual). O relógio está preso: terça às
 * 23:00 de Lisboa para o «Aberto até às 02:00», segunda ao meio-dia para o
 * «Fechado · Abre amanhã às 17:00».
 *
 * O revisor verifica nelas: a linha do momento é a coisa que o olho encontra
 * primeiro; o dia destacado é legível sem cor; o botão do Maps tem aspeto
 * secundário; não há dourado fora do foco.
 *
 * **O que deixam passar:** tudo o que é gesto e estado dinâmico — isso é
 * `e2e/visita-nos.spec.ts`.
 */

test.describe("390 × 844", () => {
  test("tudo preenchido, dois períodos num dia, o dia de hoje destacado", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "info", corpo: infoCompleta() }, MOMENTOS.ter23h00);
    await expect(linhaDoMomento(page)).toHaveText("Aberto até às 02:00");
    await seccaoDaVisita(page).scrollIntoViewIfNeeded();

    await guardar("390-visita-nos", (caminho) =>
      seccaoDaVisita(page).screenshot({ path: caminho }),
    );
  });

  test("fechado: «Fechado · Abre amanhã às 17:00»", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "info", corpo: infoCompleta() }, MOMENTOS.seg12h00);
    await expect(linhaDoMomento(page)).toHaveText("Fechado · Abre amanhã às 17:00");
    await seccaoDaVisita(page).scrollIntoViewIfNeeded();

    await guardar("390-visita-nos-fechado", (caminho) =>
      seccaoDaVisita(page).screenshot({ path: caminho }),
    );
  });

  test("parcial: só o telefone, sem cartão de horário e sem «Fechado»", async ({ page }) => {
    await abrirComVisitaNos(
      page,
      { tipo: "info", corpo: infoCom({ telefone: TELEFONE_DE_TESTE }) },
      MOMENTOS.ter23h00,
    );
    await expect(seccaoDaVisita(page).getByText(TELEFONE_DE_TESTE)).toBeVisible();
    await expect(seccaoDaVisita(page).getByText("Fechado")).toHaveCount(0);
    await seccaoDaVisita(page).scrollIntoViewIfNeeded();

    await guardar("390-visita-nos-parcial", (caminho) =>
      seccaoDaVisita(page).screenshot({ path: caminho }),
    );
  });

  test("a carregar: o esqueleto", async ({ page }) => {
    await abrirComVisitaNos(
      page,
      { tipo: "info", corpo: infoCompleta(), atrasoMs: 8_000 },
      MOMENTOS.ter23h00,
    );
    await expect(seccaoDaVisita(page)).toHaveAttribute("aria-busy", "true");
    await seccaoDaVisita(page).scrollIntoViewIfNeeded();

    await guardar("390-visita-nos-a-carregar", (caminho) =>
      seccaoDaVisita(page).screenshot({ path: caminho }),
    );
  });

  test("falhou, com «Tentar outra vez»", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "falha" }, MOMENTOS.ter23h00);
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();
    await expect(seccaoDaVisita(page).getByText(T.erroSemResposta)).toBeVisible();
    await seccaoDaVisita(page).scrollIntoViewIfNeeded();

    await guardar("390-visita-nos-erro", (caminho) =>
      seccaoDaVisita(page).screenshot({ path: caminho }),
    );
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("tudo preenchido, a mesma coluna de 640 px", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "info", corpo: infoCompleta() }, MOMENTOS.ter23h00);
    await expect(linhaDoMomento(page)).toHaveText("Aberto até às 02:00");
    await seccaoDaVisita(page).scrollIntoViewIfNeeded();

    await guardar("1024-visita-nos", (caminho) =>
      seccaoDaVisita(page).screenshot({ path: caminho }),
    );
  });
});
