import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { contagemDeResultados } from "../src/testes/ementa";
import {
  EMENTA_DE_TESTE,
  TEXTOS_DA_EMENTA,
  abrirAEmenta,
  barra,
  campoDePesquisa,
  cartoes,
  chips,
  esperarQueAPaginaPare,
  fingirEmentaFixa,
  lupa,
  noFimDaPagina,
} from "./apoio/ementa";

/**
 * F3-02, 12.5 e 12.11 — **o teste que amarra a tarefa toda**.
 *
 * O enunciado da tarefa pede uma coisa: pesquisar um produto e saltar para
 * uma categoria. É isto, e é aqui que se vê se as cinco funções puras,
 * a máquina de estados e o CSS da âncora estão todos ligados uns aos
 * outros. Cada uma delas tem o seu teste em Vitest; nenhum deles vê a
 * ligação.
 *
 * **O que este ficheiro prova:**
 *
 *  1. a pesquisa, de ponta a ponta: abrir, filtrar, ler a contagem, limpar,
 *     ver a ementa inteira e os chips de volta;
 *  2. o salto, em **cada** categoria (todas, não uma): o fragmento muda, o
 *     título fica visível e **não tapado pela barra**, e aquele chip fica
 *     com `aria-current="true"` depois de a posição estabilizar;
 *  3. o mesmo salto com `prefers-reduced-motion: reduce` — sem isso, o
 *     caminho do salto instantâneo nunca é percorrido, e é o caminho que
 *     uma parte dos utilizadores tem;
 *  4. a altura da barra, medida, igual ao token, com e sem pesquisa aberta.
 *
 * **O que deixa passar:** a rede a sério (o `route` nunca toca no backend;
 * quem prende a forma é o tipo da fixtura e o trabalho de contrato da
 * F2-09); o comportamento com os 140 produtos reais; e o caso em que o
 * salto funciona mas o scroll-spy fica um chip atrás — por isso a asserção
 * do `aria-current` é parte do mesmo teste, e não de outro.
 */

/** O produto da fixtura que a pesquisa vai procurar, e quantas linhas dá. */
const TERMO = "galao";
const PRODUTO = "Galão";
const RESULTADOS = 1;

async function abrirComAFixtura(pagina: Page): Promise<void> {
  await fingirEmentaFixa(pagina);
  await abrirAEmenta(pagina);
  await expect(cartoes(pagina)).toHaveCount(
    EMENTA_DE_TESTE.categorias.filter((categoria) => categoria.produtos.length > 0).length,
  );
}

test.describe("a pesquisa", () => {
  test("escrever um produto deixa só as linhas que condizem, e limpar devolve tudo", async ({
    page,
  }) => {
    await abrirComAFixtura(page);
    const quantosCartoes = await cartoes(page).count();
    const quantosChips = await chips(page).count();

    expect(quantosChips, "guarda: um chip por cartão, antes de mexer em seja o que for (5.2)").toBe(
      quantosCartoes,
    );
    expect(quantosCartoes, "guarda: a fixtura tem de dar barra que deslize").toBeGreaterThanOrEqual(
      11,
    );

    await lupa(page).click();

    const campo = campoDePesquisa(page);
    await expect(campo).toBeFocused();
    await expect(campo).toHaveAttribute("placeholder", TEXTOS_DA_EMENTA.exemploDePesquisa);
    await expect(chips(page), "aberta, a barra é a caixa de pesquisa (4.2)").toHaveCount(0);

    await campo.fill(TERMO);

    await expect(cartoes(page)).toHaveCount(1);
    await expect(page.getByText(PRODUTO, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("status"),
      "o texto da contagem actualiza-se 500 ms depois da última tecla (4.5)",
    ).toHaveText(contagemDeResultados(RESULTADOS));

    await page.getByRole("button", { name: TEXTOS_DA_EMENTA.fecharPesquisa }).click();

    await expect(cartoes(page)).toHaveCount(quantosCartoes);
    await expect(chips(page)).toHaveCount(quantosChips);
  });

  test("«galao» encontra «Galão» num browser a sério, com a fonte carregada", async ({ page }) => {
    // O `pesquisa.test.ts` prova isto sobre dados. Aqui prova-se que o que
    // chega ao campo passa mesmo pela normalização — uma ligação ao
    // `value` atrasada uma tecla passava lá e falha aqui.
    await abrirComAFixtura(page);
    await lupa(page).click();
    await campoDePesquisa(page).fill("galao");

    await expect(page.getByText("Galão", { exact: true })).toBeVisible();
  });

  test("`Esc` fecha a partir do campo e a partir do botão de fechar", async ({ page }) => {
    // A 4.1 diz «`Esc` fecha», sem qualificar. Com o manipulador no campo,
    // e só no campo, a segunda metade deste teste falhava — e é a metade de
    // quem navega por teclado, que chega ao botão por tabulação.
    await abrirComAFixtura(page);

    await lupa(page).click();
    await expect(campoDePesquisa(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(chips(page)).not.toHaveCount(0);

    await lupa(page).click();
    const fechar = page.getByRole("button", { name: TEXTOS_DA_EMENTA.fecharPesquisa });
    await fechar.focus();
    await expect(fechar, "guarda: o foco tem mesmo de estar no botão").toBeFocused();
    await page.keyboard.press("Escape");

    await expect(chips(page)).not.toHaveCount(0);
    await expect(campoDePesquisa(page)).toHaveCount(0);
  });

  test("a lista não se mexe quando a contagem aparece", async ({ page }) => {
    // Medido antes da reserva existir: a linha entrava no fluxo 500 ms
    // depois da última tecla e empurrava o primeiro cartão de 224,5 para
    // 256,1 px — 31,6 px de salto com a pessoa já a ler os resultados. A
    // asserção é sobre o número e não sobre a classe, porque é o número que
    // a pessoa vê (4.5, e o critério da secção 13).
    await abrirComAFixtura(page);
    await lupa(page).click();
    await campoDePesquisa(page).fill("a");
    await expect(cartoes(page)).not.toHaveCount(0);

    const contagem = page.getByRole("status");
    expect(
      (await contagem.textContent())?.trim(),
      "guarda: cheguei tarde de mais — a contagem já tinha aparecido, e medir " +
        "a posição agora não prova nada sobre o salto",
    ).toBe("");

    const antes = await cartoes(page).first().boundingBox();
    await expect(contagem).toHaveText(/produtos? encontrados?\./);
    const depois = await cartoes(page).first().boundingBox();

    expect(antes, "não consegui medir o primeiro cartão antes da contagem").not.toBeNull();
    expect(depois, "não consegui medir o primeiro cartão depois da contagem").not.toBeNull();

    const salto = Math.abs((depois?.y ?? 0) - (antes?.y ?? 0));
    expect(
      salto,
      `o primeiro cartão desceu ${salto.toFixed(1)} px quando a contagem chegou. O ` +
        "lugar dela reserva-se à abertura da pesquisa (`h-contagem`), não quando o " +
        "texto aparece.",
    ).toBeLessThanOrEqual(1);
  });

  test("sem resultados aparece o estado vazio com o botão de limpar", async ({ page }) => {
    await abrirComAFixtura(page);
    await lupa(page).click();
    await campoDePesquisa(page).fill("xkcd");

    await expect(page.getByText(TEXTOS_DA_EMENTA.semResultadosLinha)).toBeVisible();
    await expect(cartoes(page)).toHaveCount(0);

    await page.getByRole("button", { name: TEXTOS_DA_EMENTA.limparPesquisa }).click();
    await expect(cartoes(page)).toHaveCount(await chips(page).count());
  });
});

/**
 * Carregar em **cada** chip e confirmar as três coisas de 12.5.
 *
 * Em função própria porque corre duas vezes: uma com movimento normal e
 * outra com movimento reduzido.
 */
async function provarOSalto(pagina: Page): Promise<void> {
  const total = await chips(pagina).count();

  expect(total, "guarda: sem chips não há salto nenhum para provar").toBeGreaterThanOrEqual(11);

  const falhas: string[] = [];

  for (let indice = 0; indice < total; indice += 1) {
    const chip = chips(pagina).nth(indice);
    const href = (await chip.getAttribute("href")) ?? "";
    const nome = (await chip.textContent())?.trim() ?? `chip ${String(indice)}`;

    await chip.click();
    await esperarQueAPaginaPare(pagina);

    const fragmento = await pagina.evaluate(() => window.location.hash);
    if (fragmento !== href) {
      falhas.push(`${nome}: o fragmento ficou «${fragmento}» e o href era «${href}»`);
      continue;
    }

    const cartao = pagina.locator(`section[id="${href.slice(1)}"]`);
    const titulo = cartao.getByRole("heading", { level: 3 });
    await expect(titulo, `${nome}: o título do cartão devia estar visível`).toBeVisible();

    const caixaDoTitulo = await titulo.boundingBox();
    const caixaDaBarra = await barra(pagina).boundingBox();

    if (caixaDoTitulo === null || caixaDaBarra === null) {
      falhas.push(`${nome}: não consegui medir o título ou a barra — não verifiquei nada`);
      continue;
    }

    // Ou o título está abaixo da barra, ou a página está no seu máximo de
    // deslocamento. O segundo ramo é o caso da última categoria com um
    // cartão curto: nesta tarefa a ementa é a última coisa da página e não
    // há conteúdo por baixo para a empurrar. **Não se resolve com um
    // preenchimento falso no fim da página**; resolve-se sozinho na F3-06,
    // quando houver rodapé. Fica como nota para a F3-07 reconfirmar.
    const tapado = caixaDoTitulo.y < caixaDaBarra.y + caixaDaBarra.height - 1;
    if (tapado && !(await noFimDaPagina(pagina))) {
      falhas.push(
        `${nome}: o título ficou em y=${caixaDoTitulo.y.toFixed(1)}, tapado pela barra ` +
          `que acaba em ${(caixaDaBarra.y + caixaDaBarra.height).toFixed(1)}, e a página ` +
          "não está no fim. É o `scroll-padding-top` de 11 que faz isto passar.",
      );
    }

    const ativos = pagina.locator('[aria-current="true"]');
    const quantosAtivos = await ativos.count();
    if (quantosAtivos !== 1) {
      falhas.push(`${nome}: há ${String(quantosAtivos)} chips ativos, e tem de haver um`);
      continue;
    }

    const ativo = await ativos.first().getAttribute("href");
    if (ativo === href) continue;

    // A mesma alternativa escrita da asserção do "tapado", e pela mesma
    // razão: com a página no seu máximo de deslocamento, o guarda 2 de 3.3
    // manda ativar a **última** categoria, e nenhum salto a pode
    // contrariar. Nesta tarefa a ementa é a última coisa da página; com o
    // rodapé da F3-06 estes casos deixam de existir.
    const ultimo = await chips(pagina).last().getAttribute("href");
    if ((await noFimDaPagina(pagina)) && ativo === ultimo) continue;

    falhas.push(
      `${nome}: carreguei no chip «${href}», o ativo ficou «${String(ativo)}» e a ` +
        "página não está no fim — é o «mais um píxel» da linha de leitura (3.3) a " +
        "faltar, ou a linha está a ser comparada com o topo do título em vez do " +
        "topo da secção, que é o que o `scroll-padding-top` alinha.",
    );
  }

  expect(falhas).toEqual([]);
}

test.describe("o salto para uma categoria", () => {
  test("cada chip leva ao seu cartão, sem o tapar, e fica ativo", async ({ page }) => {
    test.setTimeout(90_000);
    await abrirComAFixtura(page);
    await provarOSalto(page);
  });

  test("há sempre exactamente um chip ativo, também no topo e no fim da página", async ({
    page,
  }) => {
    await abrirComAFixtura(page);

    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(
      page.locator('[aria-current="true"]'),
      "no topo da página, a primeira categoria (guarda 1 de 3.3)",
    ).toHaveAttribute("href", (await chips(page).first().getAttribute("href")) ?? "");

    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(
      page.locator('[aria-current="true"]'),
      "no fim da página, a última categoria (guarda 2 de 3.3)",
    ).toHaveAttribute("href", (await chips(page).last().getAttribute("href")) ?? "");
  });

  test("a lupa continua alcançável com a barra deslizada até ao fim", async ({ page }) => {
    await abrirComAFixtura(page);

    await barra(page).evaluate((elemento) => {
      const lista = elemento.querySelector("ul");
      lista?.scrollTo({ left: lista.scrollWidth, behavior: "instant" });
    });

    await expect(
      lupa(page),
      "dentro da `<ul>`, a lupa deslizava para fora do ecrã exactamente quando " +
        "mais se precisa dela — no fim de uma lista longa (3.2)",
    ).toBeInViewport();
  });
});

test.describe("com movimento reduzido", () => {
  test.use({ reducedMotion: "reduce" });

  test("o salto é instantâneo e o destino é o mesmo", async ({ page }) => {
    test.setTimeout(90_000);
    await abrirComAFixtura(page);
    await provarOSalto(page);
  });
});

test.describe("12.11: a barra mede o que o token diz", () => {
  /**
   * **Prova:** a altura medida da barra é igual ao valor computado de
   * `--altura-barra-chips`, com e sem a pesquisa aberta.
   *
   * Parece uma asserção tola e é a que tem melhor relação entre uma linha e
   * um defeito: se alguém acrescentar folga à barra, **todos** os saltos de
   * categoria passam a parar fora do sítio e o chip em que se carregou
   * deixa de ficar ativo. O sintoma aparece longe da causa.
   */
  test("fechada e aberta, a barra tem a altura do token", async ({ page }) => {
    await abrirComAFixtura(page);

    const doToken = await page.evaluate(() => {
      const bruto = getComputedStyle(document.documentElement)
        .getPropertyValue("--altura-barra-chips")
        .trim();
      const medida = document.createElement("div");
      medida.style.height = bruto;
      medida.style.position = "absolute";
      document.body.append(medida);
      const altura = medida.getBoundingClientRect().height;
      medida.remove();
      return { bruto, altura };
    });

    expect(
      doToken.altura,
      `não consegui resolver --altura-barra-chips (veio «${doToken.bruto}»). ` +
        "Isto é uma falha de leitura do token, não uma barra do tamanho errado.",
    ).toBeGreaterThan(0);

    const fechada = await barra(page).boundingBox();
    expect(fechada?.height).toBeCloseTo(doToken.altura, 0);

    await lupa(page).click();
    await expect(campoDePesquisa(page)).toBeFocused();

    const aberta = await barra(page).boundingBox();
    expect(
      aberta?.height,
      "uma barra que mudasse de altura ao abrir a pesquisa desalinhava todos os " +
        "saltos ao mesmo tempo, e ninguém ligaria uma coisa à outra (3.1, 4.1)",
    ).toBeCloseTo(doToken.altura, 0);
  });
});
