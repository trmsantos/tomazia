import { expect, test } from "@playwright/test";

import { capturarComAnel, guardar } from "./apoio/capturas";
import {
  INFO_SEM_REDE,
  TEXTOS_DO_WIFI,
  abrirAFolha,
  abrirAPaginaPublica,
  botaoDeCopiar,
  cabecalho,
  folhaDoWifi,
  ligacaoDeSalto,
  recusarACopia,
} from "./apoio/cabecalho";

/**
 * F3-03, 13.5 — as capturas que a revisão da ui-ux abre.
 *
 * Sete, a somar às da F3-01 e da F3-02. E as nove da F3-02 voltam a ser
 * tiradas na mesma corrida, porque **todas elas passaram a ter 122 px de
 * mobiliário fixo em cima** — não é formalidade: o item obrigatório de 14,
 * as duas linhas de letra de título a 27 px a 46,8 px uma da outra, só se responde
 * ali.
 *
 * **Deixou de haver `390-cabecalho-sem-wifi`.** Com o botão sempre presente
 * (6.2, decisão do Tomás), o cabeçalho sem WiFi configurado é píxel a píxel o
 * mesmo que o `390-cabecalho`, e uma captura que não pode diferir de outra
 * não é uma captura, é uma cópia. O estado mudou de sítio e passou a ser
 * `390-folha-wifi-sem-rede` — que é o ecrã que hoje, em desenvolvimento, toda
 * a gente vê.
 *
 * Vale a regra da F3-02: uma captura de um ecrã com uma temporização lá
 * dentro **espera pelo estado final**, ou não é a captura daquele ecrã. A
 * `390-folha-wifi-copiada` espera pelo texto da confirmação, e a
 * `390-folha-wifi-sem-copiar` pelo da falha.
 */

test.describe("390 × 844", () => {
  test("o cabeçalho por cima da ementa, no primeiro ecrã", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await expect(cabecalho(page)).toBeVisible();

    /*
     * Sem `fullPage`, e é o ponto: o que esta captura tem de mostrar é o
     * **primeiro ecrã** — as duas camadas fixas em cima e o que sobra por
     * baixo delas. Uma captura da página inteira estica o viewport e desfaz
     * exactamente a pergunta de 14.
     */
    await guardar("390-cabecalho", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a ligação de salto com foco, que de outro modo não se vê", async ({ page }) => {
    await abrirAPaginaPublica(page);

    // Por teclado, senão o Chromium não acende o `:focus-visible` e a imagem
    // passava por prova de que o anel não existe.
    await capturarComAnel(page, ligacaoDeSalto(page), "390-cabecalho-salto-focado");
  });

  test("a Folha com a rede e a password", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);

    await guardar("390-folha-wifi", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a Folha com o WiFi por configurar, que é o estado de hoje", async ({ page }) => {
    await abrirAPaginaPublica(page, INFO_SEM_REDE);
    await abrirAFolha(page);
    await expect(folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.perguntaNoBalcao)).toBeVisible();

    await guardar("390-folha-wifi-sem-rede", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a Folha depois de copiar", async ({ page }) => {
    // Sem a permissão, o Chromium recusa o `writeText` e a captura saía com a
    // frase de falha — ou seja, era a captura do ecrã ao lado.
    await page.context().grantPermissions(["clipboard-write"]);
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);
    await botaoDeCopiar(page).click();

    // Esperar pelo texto, e não pelo clique: uma captura tirada entre os dois
    // é a do ecrã de antes, com o botão já carregado e a linha ainda vazia.
    await expect(folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.copiou)).toBeVisible();

    await guardar("390-folha-wifi-copiada", (caminho) => page.screenshot({ path: caminho }));
  });

  test("a Folha quando a cópia foi recusada", async ({ page }) => {
    await recusarACopia(page);
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);
    await botaoDeCopiar(page).click();
    await expect(folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.naoCopiou)).toBeVisible();

    await guardar("390-folha-wifi-sem-copiar", (caminho) => page.screenshot({ path: caminho }));
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("o cabeçalho de ponta a ponta, com o conteúdo na coluna", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await expect(cabecalho(page)).toBeVisible();

    await guardar("1024-cabecalho", (caminho) => page.screenshot({ path: caminho }));
  });

  /**
   * A Folha deixa de subir e passa a painel centrado de 480 px (F3-01).
   *
   * É a única disposição desta tarefa que mais nenhuma captura mostra, e não
   * é a mesma imagem mais larga: a password a 34 px tem agora **432 px úteis**
   * em vez de 312, e a quebra do texto comporta-se de outra maneira.
   */
  test("a Folha centrada, com a password nos 480 px", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);

    await guardar("1024-folha-wifi", (caminho) => page.screenshot({ path: caminho }));
  });
});
