import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { COM_E_SEM_CARTAZ, QUATRO_EVENTOS } from "../src/testes/eventos";
import { guardar } from "./apoio/capturas";
import { fingirInfoFixo } from "./apoio/cabecalho";
import { SELETOR_DOS_CARTOES, fingirEmentaFixa } from "./apoio/ementa";
import {
  abrirComEventos,
  botaoDeTentarOutraVez,
  cartoesDeEvento,
  fingirEventosFixos,
  fingirOCartaz,
  fingirOsEventos,
  prenderORelogio,
  seccaoDosEventos,
  tituloDosEventos,
} from "./apoio/eventos";
import type { Eventos } from "../src/lib/api/publico";

/**
 * F3-04, 12.4 — as cinco capturas que a revisão ui-ux abre.
 *
 * Não comparam com imagem de referência: servem a revisão e o PR, que o
 * `CLAUDE.md` obriga a levar capturas a 390 × 844 para qualquer alteração
 * visual. O que cada uma tem de mostrar está na tabela de 12.4, e três
 * delas existem para itens que **só** se decidem a olhar:
 *
 *  - `390-eventos.png` — os cinco números de contraste previstos em 13, e
 *    a altura de três cartões com cartaz (1409 px, 1,7 ecrãs). Se parecer
 *    de mais, o que cede é a proporção do cartaz e não o tamanho da data
 *    (14, "por confirmar em cima de píxeis").
 *  - `390-evento-sem-cartaz.png` — a prova de 6.1: um cartão com cartaz e
 *    um sem, um por baixo do outro, e **nenhum com um buraco**.
 *  - `390-eventos-erro.png` — a prova visual da regra 10: o título
 *    presente, com o erro por baixo. É também onde se mede o contraste
 *    mais apertado da secção (o título do erro, previsto 5,51).
 *
 * **O que estas capturas deixam passar:** tudo o que é movimento, estado e
 * fuso. Uma imagem não mostra que a data se recalcula à meia-noite nem que
 * a caixa do cartaz tinha lugar antes de a imagem chegar — isso é
 * `eventos.spec.ts`.
 */

async function abrir(pagina: Page, corpo: Eventos): Promise<void> {
  await prenderORelogio(pagina);
  await fingirInfoFixo(pagina);
  await fingirEmentaFixa(pagina);
  await fingirEventosFixos(pagina, corpo);
  await fingirOCartaz(pagina, { tipo: "chega" });
  await abrirComEventos(pagina, corpo);
  await cartoesDeEvento(pagina).first().scrollIntoViewIfNeeded();
  // As imagens são `lazy`: sem esperar por elas, a captura mostra caixas
  // vazias e a revisão decide sobre um ecrã que ninguém vê.
  await pagina.waitForLoadState("networkidle");
}

test.describe("telemóvel, 390 × 844", () => {
  /**
   * O deslize não é cosmético: a captura é de elemento, e com a página no
   * topo o cabeçalho **fixo** e a ligação de salto ficam desenhados por cima
   * do primeiro cartão. A imagem continuava a sair, continuava a parecer
   * uma captura da secção, e mostrava um cartão com um cabeçalho atravessado
   * a meio — ou seja, passava por prova de uma coisa que não mostrava.
   *
   * É o mesmo defeito que a F3-02 apanhou duas vezes (uma captura disparada
   * antes de a linha de contagem existir, e o "Oferta" num cartão cujo
   * título preparava a leitura).
   *
   * **Deslizar não chega**, e foi medido: a secção é mais alta do que os
   * 844 px, por isso o Playwright compõe a captura às fatias e o cabeçalho
   * fixo é pintado em cada uma. O que resolve é dar-lhe um ecrã onde a
   * secção **caiba de uma vez** — aí a captura de elemento recorta a caixa
   * dela e o cabeçalho fica de fora, porque está acima dela na página.
   *
   * A largura continua nos 390: é ela que decide o que se está a rever. A
   * altura não muda nada do que se vê — não há nada responsivo à altura
   * neste ecrã —, e a junção com a ementa, que é onde a altura do ecrã
   * importa, tem captura própria (`390-ementa-para-eventos`).
   */
  test("a secção inteira, com três cartazes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1600 });
    await abrir(page, QUATRO_EVENTOS);

    await guardar("390-eventos", (caminho) => seccaoDosEventos(page).screenshot({ path: caminho }));
  });

  test("um cartão com cartaz e um sem, para se ver que nenhum tem buraco", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1600 });
    await abrir(page, COM_E_SEM_CARTAZ);

    await guardar("390-evento-sem-cartaz", (caminho) =>
      seccaoDosEventos(page).screenshot({ path: caminho }),
    );
  });

  test("o erro, com o título presente por cima", async ({ page }) => {
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOsEventos(page, () => ({ tipo: "falha" }));
    await page.goto("/");
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();
    await seccaoDosEventos(page).scrollIntoViewIfNeeded();

    await guardar("390-eventos-erro", (caminho) =>
      seccaoDosEventos(page).screenshot({ path: caminho }),
    );
  });

  test("a junção das duas secções: os 64 px, e a barra de chips fora do ecrã", async ({ page }) => {
    // O enquadramento é o que interessa aqui: o fim da ementa e o princípio
    // dos eventos na mesma imagem. Alinhado pelo título dos eventos, com a
    // altura de um ecrã, para a revisão ver o respiro em proporção.
    await abrir(page, QUATRO_EVENTOS);

    const caixaDoTitulo = await tituloDosEventos(page).boundingBox();
    const ultimoCartao = await page.locator(SELETOR_DOS_CARTOES).last().boundingBox();
    expect(caixaDoTitulo, "não consegui medir o título dos eventos").not.toBeNull();
    expect(ultimoCartao, "não consegui medir o último cartão da ementa").not.toBeNull();
    if (caixaDoTitulo === null || ultimoCartao === null) return;

    await page.evaluate((y) => {
      window.scrollTo(0, window.scrollY + y - 200);
    }, ultimoCartao.y);
    await page.waitForTimeout(400);

    await guardar("390-ementa-para-eventos", (caminho) => page.screenshot({ path: caminho }));
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("a coluna de 640 centrada, com o cartaz a 574 × 383", async ({ page }) => {
    await abrir(page, QUATRO_EVENTOS);

    await guardar("1024-eventos", (caminho) =>
      seccaoDosEventos(page).screenshot({ path: caminho }),
    );
  });
});
