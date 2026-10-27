import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { focarPorTeclado } from "./apoio/foco";
import {
  CAMINHO_DA_DEMONSTRACAO,
  CONTROLOS,
  SECCOES,
  TITULO_DA_DEMONSTRACAO,
} from "./apoio/pagina";

/**
 * F3-01 — capturas da página de demonstração.
 *
 * Servem duas coisas: a revisão da ui-ux (que olha para os estados lado a
 * lado, sobretudo a secção creme) e o PR, onde o `CLAUDE.md` pede capturas
 * a 390 × 844 para qualquer alteração visual.
 *
 * Não são comparações com imagem de referência. Comparar pixels numa
 * tarefa que ainda está a desenhar os componentes só daria falhas por
 * alterações intencionais; as referências entram na F3-07, se entrarem.
 * Aqui o teste serve de gerador — e falha, isso sim, se a página não
 * abrir ou se uma secção faltar.
 *
 * As imagens vão para `frontend/test-results/capturas/`, que o `.gitignore`
 * da raiz já ignora: não se versionam, anexam-se ao PR. O caminho é
 * absoluto e ancorado neste ficheiro — ver a nota do `PASTA`.
 *
 * **Duas delas são de foco e não são opcionais.** "Foco visível" é critério
 * Q-04, e até aqui nenhuma das nove capturas mostrava um anel: a revisora
 * teve de as gerar à mão para poder avaliar. Uma revisão que depende de
 * alguém se lembrar de ir carregar no `Tab` não é uma revisão.
 */

/**
 * Ancorado na pasta deste ficheiro, e não no `process.cwd()`.
 *
 * Um caminho relativo num `screenshot({ path })` resolve-se a partir de
 * onde o processo foi lançado; o `outputDir` do `playwright.config.ts`
 * resolve-se a partir da pasta do ficheiro de configuração. Lançado de
 * `frontend/` os dois coincidem — lançado da raiz do repositório, que é o
 * que um `/verificar` no topo faz, separam-se: os artefactos vão para
 * `frontend/test-results/` e as capturas para `test-results/` na raiz.
 *
 * Não suja o git (as duas pastas estão ignoradas), e é pior do que isso:
 * quem for ver as capturas abre a pasta do costume e encontra lá as da
 * corrida **anterior**, sem nada a dizer que são velhas. Uma captura velha
 * a passar por captura nova é a mesma família de defeito que o resto deste
 * ficheiro existe para apanhar.
 */
const PASTA = fileURLToPath(new URL("../test-results/capturas", import.meta.url));

/**
 * O instante em que este ficheiro foi carregado. Serve de corte para
 * distinguir uma captura desta corrida de uma que ficou da anterior.
 */
const CORRIDA_COMECOU_EM = Date.now();

/**
 * Guardar uma captura e **confirmar que ela ficou escrita agora**.
 *
 * Sem esta confirmação, uma captura que fosse parar a outro sítio passava
 * em silêncio: o teste passava, a pasta do costume continuava a ter os
 * ficheiros da corrida anterior e a revisão avaliava imagens velhas sem
 * nada a dizer que o eram. É o mesmo defeito de família que o resto deste
 * ficheiro existe para apanhar, virado para dentro.
 */
async function guardar(nome: string, escrever: (caminho: string) => Promise<unknown>) {
  expect(
    isAbsolute(PASTA),
    "o caminho das capturas tem de ser absoluto e ancorado neste ficheiro. Um caminho " +
      "relativo resolve-se a partir de onde o processo foi lançado, e o `outputDir` do " +
      "`playwright.config.ts` resolve-se a partir da pasta do config: lançados da raiz do " +
      "repositório, os dois separam-se.",
  ).toBe(true);

  const caminho = `${PASTA}/${nome}.png`;
  await escrever(caminho);

  let escritaEm: number;
  try {
    escritaEm = statSync(caminho).mtimeMs;
  } catch {
    throw new Error(
      `A captura ${nome} não ficou em ${caminho}. Foi escrita noutro sítio — ` +
        "provavelmente a partir do `process.cwd()`.",
    );
  }

  // Um segundo de folga para relógios de sistema de ficheiros com pouca
  // resolução; é folga que chega e não chega para uma corrida anterior.
  expect(
    escritaEm,
    `a captura ${nome} em ${caminho} é de antes desta corrida: é uma imagem velha a ` +
      "passar por nova, e é sobre ela que a revisão ia decidir.",
  ).toBeGreaterThanOrEqual(CORRIDA_COMECOU_EM - 1000);
}

async function abrir(pagina: Page): Promise<void> {
  const resposta = await pagina.goto(CAMINHO_DA_DEMONSTRACAO);
  expect(
    resposta?.status(),
    `Não consegui abrir ${CAMINHO_DA_DEMONSTRACAO}: a página de demonstração ainda não existe.`,
  ).toBe(200);
  await expect(
    pagina.getByRole("heading", { name: TITULO_DA_DEMONSTRACAO, level: 1 }),
  ).toBeVisible();
}

/**
 * Folga à volta do controlo focado, em px. O anel tem 2 px de espessura e
 * 2 px de afastamento, por isso sai para fora da caixa do elemento: uma
 * captura do próprio elemento (`locator.screenshot()`) corta-o. Daí o
 * recorte da página com margem.
 */
const FOLGA_A_VOLTA_DO_ANEL = 24;

/**
 * Captura de um controlo **focado por teclado**, com o fundo à volta.
 *
 * O fundo é metade do assunto: o anel do Botão principal é dourado sobre
 * preenchimento dourado (1,0) e só se lê por causa dos 2 px de folga em
 * bordô; dentro do cartão creme o anel tem de ser bordô-tomazia, porque
 * dourado sobre creme dá 1,72. Nenhuma das duas coisas se vê numa captura
 * da página em repouso — e "foco visível" é critério Q-04.
 */
async function capturarComAnel(pagina: Page, alvo: Locator, nome: string): Promise<void> {
  await alvo.scrollIntoViewIfNeeded();
  await focarPorTeclado(pagina, alvo);

  const caixa = await alvo.boundingBox();
  expect(caixa, `não consegui medir o controlo da captura ${nome}`).not.toBeNull();
  const viewport = pagina.viewportSize();
  expect(viewport, "não consegui ler o tamanho do viewport").not.toBeNull();
  if (caixa === null || viewport === null) return;

  const x = Math.max(0, caixa.x - FOLGA_A_VOLTA_DO_ANEL);
  const y = Math.max(0, caixa.y - FOLGA_A_VOLTA_DO_ANEL);

  await guardar(nome, (caminho) =>
    pagina.screenshot({
      path: caminho,
      clip: {
        x,
        y,
        width: Math.min(caixa.width + 2 * FOLGA_A_VOLTA_DO_ANEL, viewport.width - x),
        height: Math.min(caixa.height + 2 * FOLGA_A_VOLTA_DO_ANEL, viewport.height - y),
      },
    }),
  );
}

test.describe("telemóvel, 390 × 844", () => {
  test("a página inteira e as secções que a revisão olha primeiro", async ({ page }) => {
    await abrir(page);

    await guardar("390-pagina-inteira", (caminho) =>
      page.screenshot({ path: caminho, fullPage: true }),
    );

    for (const seccao of [SECCOES.botao, SECCOES.campo, SECCOES.chip, SECCOES.sobreCreme]) {
      const alvo = page.locator(`#${seccao}`);
      await expect(alvo, `falta a secção #${seccao}`).toHaveCount(1);
      await guardar(`390-${seccao}`, (caminho) => alvo.screenshot({ path: caminho }));
    }
  });

  test("a Folha aberta, que é o estado que não se vê numa captura da página", async ({ page }) => {
    await abrir(page);

    await page.getByRole("button", { name: CONTROLOS.abrirFolhaWifi }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await guardar("390-folha-aberta", (caminho) => page.screenshot({ path: caminho }));
  });

  test("o Aviso temporário visível, com o «Desfazer»", async ({ page }) => {
    await abrir(page);

    await page.getByRole("button", { name: CONTROLOS.avisoComDesfazer }).click();
    const aviso = page.getByRole("status");
    await expect(aviso).toBeVisible();
    await aviso.hover(); // o contador pára, senão a captura sai vazia

    await guardar("390-aviso", (caminho) => page.screenshot({ path: caminho }));
  });

  test("o anel de foco, que nenhuma das outras capturas mostra", async ({ page }) => {
    await abrir(page);

    // Sobre o escuro: anel dourado assente na folga de 2 px em bordô, à
    // volta de um preenchimento que é da mesma cor do anel.
    const noEscuro = page
      .locator(`#${SECCOES.botao}`)
      .getByRole("button", { name: "Guardar alterações" })
      .first();
    await expect(noEscuro, "não encontrei um Botão principal na secção do Botão").toBeVisible();
    await capturarComAnel(page, noEscuro, "390-foco-botao");

    // Sobre o creme: o anel tem de ser bordô-tomazia. É a falha mais fácil
    // de deixar passar, porque só aparece a quem navega por teclado — e
    // até agora não aparecia em captura nenhuma.
    // Dentro da secção «Sobre creme», e não o primeiro `.superficie-creme`
    // da página: esse é uma amostra de cor da secção «Cores», que não tem
    // controlo nenhum lá dentro.
    const noCreme = page
      .locator(`#${SECCOES.sobreCreme} .superficie-creme`)
      .first()
      .getByRole("button")
      .first();
    await expect(noCreme, "não encontrei um controlo dentro do cartão creme").toBeVisible();
    await capturarComAnel(page, noCreme, "390-foco-creme");
  });
});

test.describe("1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("a mesma página em duas colunas, com a Folha centrada", async ({ page }) => {
    await abrir(page);

    await guardar("1024-pagina-inteira", (caminho) =>
      page.screenshot({ path: caminho, fullPage: true }),
    );

    await page.getByRole("button", { name: CONTROLOS.abrirFolhaWifi }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await guardar("1024-folha-centrada", (caminho) => page.screenshot({ path: caminho }));
  });
});
