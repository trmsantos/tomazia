import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { focarPorTeclado } from "./foco";

/**
 * Guardar uma captura e **confirmar que ela ficou escrita agora**.
 *
 * Três ficheiros de capturas usam isto — a F3-01, a F3-02 e a F3-03 — e até
 * à F3-03 cada um tinha a sua cópia. Duas cópias já tinham divergido (uma
 * delas não distinguia "não ficou escrita" de "ficou escrita noutro sítio"),
 * e uma terceira fazia disto uma regra a manter em três sítios. Está aqui
 * porque o que ela protege é o mesmo nos três.
 */

/**
 * Ancorado na pasta deste ficheiro, e não no `process.cwd()`.
 *
 * Um caminho relativo num `screenshot({ path })` resolve-se a partir de onde
 * o processo foi lançado; o `outputDir` do `playwright.config.ts` resolve-se
 * a partir da pasta do ficheiro de configuração. Lançado de `frontend/` os
 * dois coincidem — lançado da raiz do repositório, que é o que um
 * `/verificar` no topo faz, separam-se.
 *
 * Não suja o git (as duas pastas estão ignoradas), e é pior do que isso: quem
 * for ver as capturas abre a pasta do costume e encontra lá as da corrida
 * **anterior**, sem nada a dizer que são velhas.
 */
export const PASTA = fileURLToPath(new URL("../../test-results/capturas", import.meta.url));

/**
 * O instante em que este módulo foi carregado. Serve de corte para distinguir
 * uma captura desta corrida de uma que ficou da anterior.
 */
const CORRIDA_COMECOU_EM = Date.now();

export async function guardar(
  nome: string,
  escrever: (caminho: string) => Promise<unknown>,
): Promise<void> {
  expect(
    isAbsolute(PASTA),
    "o caminho das capturas tem de ser absoluto e ancorado neste ficheiro. Um caminho " +
      "relativo resolve-se a partir de onde o processo foi lançado, e o `outputDir` do " +
      "`playwright.config.ts` resolve-se a partir da pasta do config: lançados da raiz do " +
      "repositório, os dois separam-se.",
  ).toBe(true);

  const caminho = `${PASTA}/${nome}.png`;
  await escrever(caminho);

  /*
   * "Não ficou escrita" e "ficou escrita noutro sítio" são defeitos
   * diferentes e têm de se ler diferentes (regra 10): o primeiro lança com o
   * caminho onde ela devia estar, o segundo é a asserção da data.
   */
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

/**
 * A página inteira com um controlo **focado por teclado**.
 *
 * Por teclado e não por `focus()`: senão o Chromium não acende o
 * `:focus-visible` e a imagem passava por prova de que o anel não existe.
 */
export async function capturarComAnel(pagina: Page, alvo: Locator, nome: string): Promise<void> {
  await focarPorTeclado(pagina, alvo);
  await guardar(nome, (caminho) => pagina.screenshot({ path: caminho }));
}
