import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { contraste } from "../src/testes/contraste";
import {
  ID_DA_PASSWORD,
  ID_DO_DESTINO_DO_SALTO,
  INFO_COM_WIFI,
  INFO_SEM_REDE,
  PASSWORD_DE_TESTE,
  TEXTOS_DO_WIFI,
  abrirAFolha,
  abrirAPaginaPublica,
  botaoDeCopiar,
  botaoDoWifi,
  cabecalho,
  fingirOInfo,
  folhaDoWifi,
  ligacaoDeSalto,
  medirToken,
  recusarACopia,
  retangulosDourados,
  tituloDaEmenta,
} from "./apoio/cabecalho";
import {
  SELETOR_DOS_CHIPS,
  barra,
  chips,
  esperarQueAPaginaPare,
  noFimDaPagina,
} from "./apoio/ementa";

/**
 * F3-03, 13.4 — as duas camadas no topo, medidas num browser a sério.
 *
 * **Cada asserção é escrita pelo resultado**, nunca pela peça. Um mecanismo
 * presente não prova o resultado, e uma lista que se pode percorrer inteira
 * com o defeito lá dentro não é uma lista de verificação (14).
 *
 * **O que este ficheiro prova:** que a altura desenhada do cabeçalho é a do
 * token; que na primeira pintura, sem deslizar nada, o `<h2> Ementa` se vê
 * inteiro (é a única prova do `pt-cabecalho` e tem de ser feita antes de
 * qualquer deslize, senão prova-se a si própria); que a aresta de cima da
 * barra de chips assenta na de baixo do cabeçalho; que depois de um salto o
 * título fica abaixo das duas camadas e o chip certo fica ativo; que há
 * sempre exactamente um chip ativo; que a primeira paragem de `Tab` é a
 * ligação de salto e que segui-la não leva a um chip; que **a abrir a Folha
 * nada no cabeçalho se mexe para o lado**; e que no ecrã há no máximo um
 * retângulo dourado utilizável.
 *
 * **O que deixa passar:** a rede a sério (o `route` nunca toca no backend); o
 * que um leitor de ecrã anuncia; e a plataforma. A asserção do
 * `scrollbar-gutter` é a mais importante das que **não** se consegue medir
 * aqui: no macOS as barras de deslocamento são sobrepostas e os quatro
 * cenários dão 0 px de deslocamento, por isso ela fica verde neste Mac sem
 * mentir e acusa no CI em Linux, onde o deslocamento existe (4.4).
 */

/** Tolerância em píxeis: o zoom do browser arredonda de um lado e do outro. */
const PIXEL = 1.1;

/**
 * A caixa de um elemento, com o guarda da regra 10 à frente: "não consegui
 * medir" e "mediu e está fora do sítio" não podem dar o mesmo resultado.
 */
async function caixa(alvo: Locator) {
  // Com prazo curto e de propósito: um elemento que não existe tem de dar
  // uma falha depressa e com o nome dele, não um teste pendurado 30 s a
  // acabar em «Test timeout exceeded».
  const medida = await alvo.boundingBox({ timeout: 5_000 });
  expect(medida, "não consegui medir — isto é falha de medição, não de desenho").not.toBeNull();
  return medida as NonNullable<typeof medida>;
}

/** A largura da janela, com o guarda que impede um zero a passar por medida. */
function larguraDaJanela(pagina: Page): number {
  const janela = pagina.viewportSize()?.width ?? 0;
  expect(janela, "guarda: sem viewport não meço nada").toBeGreaterThan(0);
  return janela;
}

test.describe("as duas camadas, a 390", () => {
  /**
   * **Prova:** que a altura desenhada do cabeçalho é o valor computado de
   * `--altura-cabecalho`.
   *
   * Parece uma asserção tola e é a que tem melhor relação entre uma linha e
   * um defeito: se alguém lhe acrescentar folga, as onze âncoras das
   * categorias passam a parar fora do sítio e o sintoma aparece longe da
   * causa (14).
   */
  test("a altura medida do cabeçalho é a do token", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const token = await medirToken(page, "--altura-cabecalho");
    expect(
      token.altura,
      `não consegui resolver --altura-cabecalho (veio «${token.bruto}»). Isto é uma ` +
        "falha de leitura do token, não um cabeçalho do tamanho errado.",
    ).toBeGreaterThan(0);

    const medida = await caixa(cabecalho(page));
    expect(medida.height).toBeCloseTo(token.altura, 0);
  });

  /**
   * **Prova:** o `pt-cabecalho` do `<main>`, e só esta asserção o prova.
   *
   * Um elemento fixo sai do fluxo e não ocupa lugar nenhum; sem a folga, o
   * `<h2> Ementa` nasce por baixo do cabeçalho. **Nenhum teste de âncoras
   * apanha isto**, porque todos eles deslizam a página antes de medir seja o
   * que for. O sintoma é a primeira pintura, e é só lá que se vê (2, 4.4).
   */
  test("na primeira pintura, sem deslizar nada, o `<h2> Ementa` vê-se inteiro", async ({
    page,
  }) => {
    await abrirAPaginaPublica(page);

    const posicao = await page.evaluate(() => window.scrollY);
    expect(posicao, "guarda: esta asserção só vale com a página por deslizar").toBe(0);

    const topo = await caixa(cabecalho(page));
    const titulo = await caixa(tituloDaEmenta(page));

    expect(
      titulo.y,
      "o `<h2> Ementa` nasceu por baixo do cabeçalho: falta o `pt-cabecalho` no " +
        "`<main>` (secção 2). Todos os testes de âncora deslizam antes de medir e " +
        "nenhum deles vê isto.",
    ).toBeGreaterThanOrEqual(topo.y + topo.height - PIXEL);
    await expect(tituloDaEmenta(page)).toBeInViewport({ ratio: 1 });
  });

  /**
   * **Prova:** que a barra de chips começa exactamente onde o cabeçalho
   * acaba — sem buraco e sem sobreposição.
   *
   * O sintoma de um `top-0` distraído na barra é os chips deslizarem por
   * baixo do cabeçalho e o chip ativo ficar invisível (4.4).
   */
  test("a aresta de cima da barra assenta na de baixo do cabeçalho", async ({ page }) => {
    await abrirAPaginaPublica(page);

    await page.evaluate(() => {
      window.scrollTo({ top: 600, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);

    const topo = await caixa(cabecalho(page));
    const chipsBarra = await caixa(barra(page));

    expect(
      chipsBarra.y - (topo.y + topo.height),
      "sem buraco e sem sobreposição: a barra cola-se em `var(--altura-cabecalho)`, " +
        "que é o mesmo sítio de onde sai a âncora das categorias (4.2)",
    ).toBeLessThanOrEqual(PIXEL);
    expect(chipsBarra.y - (topo.y + topo.height)).toBeGreaterThanOrEqual(-PIXEL);
  });

  /**
   * **Prova:** que o cabeçalho se distingue do que passa por baixo — e que
   * quem faz a separação é o **fio**, não o fundo.
   *
   * Bordô-vinho sobre bordô-noite é 1,13: um critério que se contentasse com
   * "o cabeçalho tem fundo próprio" marcava-se de boa fé com a separação
   * invisível (14).
   */
  test("o fio separa mais do que o fundo", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const cores = await cabecalho(page).evaluate((elemento) => {
      const estilo = getComputedStyle(elemento);
      return {
        fio: estilo.borderBottomColor,
        espessura: Number.parseFloat(estilo.borderBottomWidth),
        fundoDoCabecalho: estilo.backgroundColor,
        fundoDaPagina: getComputedStyle(document.body).backgroundColor,
      };
    });

    expect(cores.espessura, "sem fio não há separação nenhuma").toBeGreaterThan(0);

    const doFio = contraste(cores.fio, cores.fundoDoCabecalho);
    const doFundo = contraste(cores.fundoDoCabecalho, cores.fundoDaPagina);

    expect(
      doFio,
      `o fio dá ${doFio.toFixed(2)} contra o painel e o fundo do cabeçalho dá ` +
        `${doFundo.toFixed(2)} contra a página. O fundo sozinho não chega — quem faz ` +
        "a separação é o fio (14).",
    ).toBeGreaterThan(doFundo);
  });

  /**
   * **Prova:** que depois de um salto o título da categoria fica **abaixo
   * das duas camadas**, e que é esse chip o ativo.
   *
   * Com a âncora a 138 px em vez de 77, um `scroll-padding-top` que tivesse
   * ficado para trás põe o título por baixo do cabeçalho — e o chip em que
   * se carregou deixa de ser o ativo.
   */
  test("depois de um salto, o título fica abaixo das duas camadas e o chip fica ativo", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await abrirAPaginaPublica(page);

    const quantos = await chips(page).count();
    expect(quantos, "guarda: a fixtura tem de dar barra que deslize").toBeGreaterThanOrEqual(11);

    const falhas: string[] = [];

    for (const indice of [0, Math.floor(quantos / 2), quantos - 1]) {
      const chip = chips(page).nth(indice);
      const href = (await chip.getAttribute("href")) ?? "";
      const nome = (await chip.textContent())?.trim() ?? `chip ${String(indice)}`;

      await chip.click();
      await esperarQueAPaginaPare(page);

      const titulo = page.locator(`section[id="${href.slice(1)}"]`).getByRole("heading", {
        level: 3,
      });
      const caixaDoTitulo = await titulo.boundingBox();
      const caixaDaBarra = await barra(page).boundingBox();
      const caixaDoTopo = await cabecalho(page).boundingBox();

      if (caixaDoTitulo === null || caixaDaBarra === null || caixaDoTopo === null) {
        falhas.push(`${nome}: não consegui medir — não verifiquei nada`);
        continue;
      }

      const fundoDasCamadas = Math.max(
        caixaDaBarra.y + caixaDaBarra.height,
        caixaDoTopo.y + caixaDoTopo.height,
      );
      if (caixaDoTitulo.y < fundoDasCamadas - PIXEL && !(await noFimDaPagina(page))) {
        falhas.push(
          `${nome}: o título ficou em y=${caixaDoTitulo.y.toFixed(1)}, tapado pelas duas ` +
            `camadas que acabam em ${fundoDasCamadas.toFixed(1)}, e a ementa ainda ` +
            "podia subir",
        );
      }

      const ativos = page.locator('[aria-current="true"]');
      if ((await ativos.count()) !== 1) {
        falhas.push(`${nome}: há ${String(await ativos.count())} chips ativos, e tem de haver um`);
        continue;
      }

      const ativo = await ativos.first().getAttribute("href");
      if (ativo === href) continue;
      const ultimo = await chips(page).last().getAttribute("href");
      if ((await noFimDaPagina(page)) && ativo === ultimo) continue;

      falhas.push(
        `${nome}: carreguei no chip «${href}» e o ativo ficou «${String(ativo)}». A linha ` +
          "de leitura passou de 78 para 139 px com o cabeçalho (4.3) — é o «mais um " +
          "píxel» a faltar, ou a âncora que não acompanhou.",
      );
    }

    expect(falhas).toEqual([]);
  });

  /**
   * **Prova:** os três guardas da F3-02, agora com a âncora a 138 px.
   *
   * O guarda do fundo passou a disparar **menos**: num ecrã de 390 × 844
   * precisa de 705 px de conteúdo abaixo do último título em vez de 766. Uma
   * âncora mais funda exige menos conteúdo, não mais (4.3) — e é a coisa que
   * se ia assumir ao contrário.
   */
  test("há sempre exactamente um chip ativo: no topo, no meio e no fim", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const posicoes: { nome: string; ir: () => Promise<void> }[] = [
      {
        nome: "no topo",
        ir: () =>
          page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: "instant" });
          }),
      },
      {
        nome: "no meio",
        ir: () =>
          page.evaluate(() => {
            window.scrollTo({
              top: document.documentElement.scrollHeight / 2,
              behavior: "instant",
            });
          }),
      },
      {
        nome: "no fim",
        ir: () =>
          page.evaluate(() => {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
          }),
      },
    ];

    for (const posicao of posicoes) {
      await posicao.ir();
      await esperarQueAPaginaPare(page);
      await expect(
        page.locator('[aria-current="true"]'),
        `${posicao.nome}: um chip ativo, sempre (F3-02, 3.3)`,
      ).toHaveCount(1);
    }
  });

  /**
   * **Prova:** que o cabeçalho continua no topo depois de a página descer.
   *
   * `fixed` e não `sticky`: o `sticky` pára no fim do seu bloco contentor, e
   * é exactamente isso que o cabeçalho **não** pode fazer — ele tem de ficar
   * por cima dos eventos, da galeria e do rodapé (secção 2).
   */
  test("o cabeçalho continua no topo com a página no fim", async ({ page }) => {
    await abrirAPaginaPublica(page);

    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);

    const medida = await caixa(cabecalho(page));
    expect(
      Math.abs(medida.y),
      "`fixed` e não `sticky`: o `sticky` pára no fim do seu bloco contentor, e aí o " +
        "cabeçalho ia-se embora por cima (secção 2)",
    ).toBeLessThanOrEqual(PIXEL);
    await expect(botaoDoWifi(page), "o WiFi pede-se a qualquer momento (4.1)").toBeInViewport();
  });
});

test.describe("a ligação de salto, com teclado", () => {
  /**
   * **Prova:** que a primeira paragem de `Tab` é a ligação de salto e que
   * ela **se vê** quando tem foco — com o alvo de toque inteiro.
   *
   * Sem foco não ocupa lugar nenhum e não se pinta; `display: none` e
   * `hidden` estão os dois fora de questão, porque tiram-na da ordem de
   * tabulação e tornam-na inútil (5.3).
   */
  test("a primeira paragem de `Tab` é a ligação de salto, e vê-se", async ({ page }) => {
    await abrirAPaginaPublica(page);

    await page.locator("body").press("Tab");

    const primeiro = await page.evaluate(() => {
      const elemento = document.activeElement;
      if (elemento === null) return null;
      return {
        etiqueta: elemento.tagName.toLowerCase(),
        texto: (elemento.textContent ?? "").trim().slice(0, 40),
      };
    });

    expect(primeiro, "o `Tab` não parou em lado nenhum — não verifiquei nada").not.toBeNull();
    expect(
      primeiro?.texto,
      "treze controlos à frente de zero controlos é o retrato de uma página que " +
        "precisa de uma ligação de salto (5.1)",
    ).toBe(TEXTOS_DO_WIFI.saltar);

    await expect(ligacaoDeSalto(page)).toBeFocused();
    await expect(ligacaoDeSalto(page)).toBeInViewport({ ratio: 1 });

    const medida = await caixa(ligacaoDeSalto(page));
    expect(medida.height, "44 px de alvo, como todos os controlos (Q-04)").toBeGreaterThanOrEqual(
      44 - PIXEL,
    );

    const anel = await ligacaoDeSalto(page).evaluate((elemento) => {
      const estilo = getComputedStyle(elemento);
      return { estilo: estilo.outlineStyle, espessura: Number.parseFloat(estilo.outlineWidth) };
    });
    expect(anel.estilo, "com foco, o anel dourado da camada base").not.toBe("none");
    expect(anel.espessura).toBeGreaterThan(0);
  });

  /**
   * **Prova:** que o destino existe e que segui-lo **não** leva a um chip.
   *
   * Saltar para a ementa é saltar para a leitura, não para um controlo: a
   * ementa não tem nenhum, por decisão da F3-02. A paragem seguinte é o
   * primeiro controlo *depois* dela — hoje, o próprio browser (5.4).
   */
  test("seguir a ligação põe a leitura na ementa, e o `Tab` seguinte não é um chip", async ({
    page,
  }) => {
    await abrirAPaginaPublica(page);

    await expect(
      page.locator(`#${ID_DO_DESTINO_DO_SALTO}`),
      "um fragmento que não existe não faz nada, em silêncio (5.2)",
    ).toHaveCount(1);

    await page.locator("body").press("Tab");
    await expect(ligacaoDeSalto(page)).toBeFocused();
    await ligacaoDeSalto(page).press("Enter");
    await esperarQueAPaginaPare(page);

    expect(await page.evaluate(() => window.location.hash)).toBe(`#${ID_DO_DESTINO_DO_SALTO}`);

    await page.keyboard.press("Tab");
    const seguinte = await page.evaluate((seletor) => {
      const elemento = document.activeElement;
      if (elemento === null || elemento === document.body) return "(o Tab saiu da página)";
      return elemento.matches(seletor)
        ? `um chip: ${(elemento.textContent ?? "").trim()}`
        : `${elemento.tagName.toLowerCase()} «${(elemento.textContent ?? "").trim().slice(0, 30)}»`;
    }, SELETOR_DOS_CHIPS);

    expect(
      seguinte,
      "uma ligação de salto que salta por cima de uma paragem é decoração: o destino " +
        "tem de estar **depois** da barra de chips (5.2)",
    ).not.toContain("um chip:");
  });

  /**
   * **Prova:** que nada tapa a ligação quando ela aparece.
   *
   * Ela tapa o logótipo, e é o custo certo — é lá que o olho está. O que não
   * pode é o contrário (5.3).
   */
  test("com foco, a ligação fica por cima do cabeçalho", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await page.locator("body").press("Tab");

    const medida = await caixa(ligacaoDeSalto(page));
    const noPonto = await page.evaluate(
      ({ x, y }) => {
        const elemento = document.elementFromPoint(x, y);
        return elemento === null ? null : elemento.tagName.toLowerCase();
      },
      { x: medida.x + medida.width / 2, y: medida.y + medida.height / 2 },
    );

    expect(noPonto, "a ligação tem de estar por cima, não por baixo").toBe("a");
  });

  /**
   * **Prova:** que sem foco a ligação não se pinta — nem uma tira dela.
   *
   * Parece óbvio e não é: ela esconde-se com `-translate-y-full`, que sobe
   * **a altura dela** e mais nada. A partir de `top-0` a conta fecha (vai de
   * −44 a 0); a partir de um `top-2`, que é onde ela assenta com foco,
   * sobrariam 8 px dentro da janela — uma tira de painel pintada por cima do
   * cabeçalho, em `z-30`, sem ninguém lhe ter tocado. É por isso que o desvio
   * dos 8 px é feito no `translate` e não no `top`, e é isto que o prende.
   *
   * **Deixa passar:** uma ligação escondida com `display: none`, que não
   * pintaria nada e seria pior — essa é `Cabecalho.test.tsx`.
   */
  test("sem foco não se pinta: nem uma tira dela entra na janela", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const medida = await ligacaoDeSalto(page).boundingBox();
    expect(medida, "não consegui medir a ligação — falha de medição").not.toBeNull();
    if (medida === null) return;

    expect(
      medida.y + medida.height,
      "a aresta de baixo da ligação tem de ficar em cima do topo da janela",
    ).toBeLessThanOrEqual(PIXEL);
  });

  /**
   * **Prova:** que o anel de foco aparece **inteiro, pelos quatro lados**.
   *
   * Não é a mesma asserção do teste de cima, nem a do "mostra anel" da F3-02,
   * e é essa a razão de existir: o `outline` desenha-se **para fora** da caixa
   * — a espessura mais o afastamento — e no canto a 0,0 esses píxeis caem fora
   * da janela. O anel fica de dois lados, o teste do `outlineStyle` continua
   * verde, e o controlo é a **primeira paragem de `Tab` do site**.
   *
   * Não chumba nenhum critério de AA. É exactamente por isso que precisa de
   * teste: uma lista de verificação percorre-se inteira, de boa fé, com este
   * defeito lá dentro.
   *
   * **Deixa passar:** o contraste do anel e a sua cor. Isso é `tokens.css` e
   * o `papeis-por-ambito.test.ts`.
   */
  test("o anel de foco aparece inteiro, pelos quatro lados", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await page.locator("body").press("Tab");
    await expect(ligacaoDeSalto(page)).toBeFocused();

    const medido = await ligacaoDeSalto(page).evaluate((elemento) => {
      const estilo = getComputedStyle(elemento);
      const caixa = elemento.getBoundingClientRect();
      return {
        espessura: Number.parseFloat(estilo.outlineWidth),
        afastamento: Number.parseFloat(estilo.outlineOffset),
        esquerda: caixa.left,
        topo: caixa.top,
        direita: caixa.right,
        fundo: caixa.bottom,
      };
    });

    expect(
      medido.espessura,
      "não li espessura nenhuma de anel — isto é falha de medição, não um anel " +
        "cortado. Sem anel, o resto deste teste não quer dizer nada.",
    ).toBeGreaterThan(0);

    // O anel vive a esta distância para fora da caixa, dos quatro lados.
    const paraFora = medido.espessura + Math.max(medido.afastamento, 0);
    const janela = page.viewportSize();
    expect(janela, "guarda: sem viewport não meço nada").not.toBeNull();
    if (janela === null) return;

    const cortados = [
      { lado: "esquerdo", folga: medido.esquerda - paraFora },
      { lado: "de cima", folga: medido.topo - paraFora },
      { lado: "direito", folga: janela.width - (medido.direita + paraFora) },
      { lado: "de baixo", folga: janela.height - (medido.fundo + paraFora) },
    ].filter((aresta) => aresta.folga < -PIXEL);

    expect(
      cortados.map((aresta) => `${aresta.lado}: falta ${(-aresta.folga).toFixed(1)}px`),
      `o anel sai ${paraFora.toFixed(1)}px para fora da caixa e não cabe na janela. ` +
        "É a primeira paragem de `Tab` do site, e um anel de dois lados passa em " +
        "tudo o que mede «mostra anel» (5.3)",
    ).toEqual([]);
  });

  /**
   * **Prova:** que a ligação com foco assenta onde o nome do bar começa, e
   * que o tapa por inteiro.
   *
   * São as duas razões do `left-4` e do `px-6`, e as duas são visíveis: uma
   * ligação desalinhada da coluna lê-se como coisa colada por cima, e uma
   * ligação mais estreita do que o nome deixa a cauda dele a espreitar por
   * trás.
   */
  test("com foco, alinha com o nome do bar e tapa-o todo", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await page.locator("body").press("Tab");

    const ligacao = await caixa(ligacaoDeSalto(page));
    const nome = await caixa(page.getByRole("heading", { level: 1 }));

    expect(
      ligacao.x,
      "alinha com o «B» de «Bar da Tomazia», que é o `px-4` da coluna (5.3)",
    ).toBeCloseTo(nome.x, 0);

    // A tinta do nome, e não a caixa do `<h1>`: ele é um item de flex e a
    // caixa dele é maior do que as letras. O que tem de ficar tapado são as
    // letras.
    const tinta = await page.getByRole("heading", { level: 1 }).evaluate((elemento) => {
      const intervalo = document.createRange();
      intervalo.selectNodeContents(elemento);
      return intervalo.getBoundingClientRect().right;
    });

    expect(
      ligacao.x + ligacao.width,
      "com `px-4` a cauda do nome espreitava por trás da ligação (5.3)",
    ).toBeGreaterThanOrEqual(tinta - PIXEL);
  });
});

test.describe("a Folha do WiFi", () => {
  /**
   * **A asserção mais difícil deste ficheiro, e a razão está em 4.4.**
   *
   * **Prova:** que a abrir a Folha nada no cabeçalho se mexe para o lado. O
   * travão do fundo é `.sem-deslizar { overflow: hidden }` no `<body>`, e
   * numa plataforma com barras de deslocamento clássicas esconder o
   * transbordo alarga a janela de layout pela largura da barra — **tudo o
   * que é `position: fixed` salta para a direita** nesse instante. Até hoje
   * o defeito existia e não se via: nada estava fixo no topo.
   *
   * **Escrita sobre a aresta e não sobre a declaração de propósito:** o
   * `scrollbar-gutter: stable` pode lá estar e o cabeçalho saltar na mesma
   * (basta alguém pôr o travão noutro elemento), e pode não lá estar e o
   * teste passar — que é precisamente o que acontece no macOS, onde as
   * barras são sobrepostas e o deslocamento medido foi 0 px nos quatro
   * cenários. Assim é verde no Mac sem mentir, e acusa no CI em Linux.
   */
  test("a abrir a Folha, a aresta direita do cabeçalho não se mexe", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const fechada = await caixa(cabecalho(page));
    await abrirAFolha(page);
    const aberta = await caixa(cabecalho(page));

    expect(
      aberta.x + aberta.width,
      `a aresta direita do cabeçalho passou de ${(fechada.x + fechada.width).toFixed(1)} ` +
        `para ${(aberta.x + aberta.width).toFixed(1)} ao abrir a Folha. É o travão do ` +
        "fundo a alargar a janela de layout: falta `html { scrollbar-gutter: stable }` " +
        "(4.4). No macOS este número é 0 de qualquer maneira.",
    ).toBeCloseTo(fechada.x + fechada.width, 0);
    expect(aberta.x).toBeCloseTo(fechada.x, 0);
  });

  /**
   * **Prova:** que há no máximo **um** retângulo dourado utilizável, com e
   * sem a Folha aberta — contando píxeis pintados, não classes.
   *
   * A palavra que carrega a regra é *utilizável*: com a Folha aberta, o
   * "WiFi" está por baixo de uma cortina a 88%, a 1,35 de contraste e fora
   * do alcance do foco. Não é um dourado concorrente; é um botão que naquele
   * momento não existe para ninguém (7.5).
   */
  test("um retângulo dourado utilizável de cada vez", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const naPagina = await retangulosDourados(page);
    expect(
      naPagina.length,
      "guarda: não encontrei dourado nenhum no ecrã — o botão «WiFi» é o único " +
        "retângulo dourado cheio da página pública (6.1), por isso zero quer dizer " +
        "que não medi nada",
    ).toBeGreaterThan(0);
    expect(naPagina.filter((um) => um.alcancavel).map((um) => um.descricao)).toHaveLength(1);

    await abrirAFolha(page);

    const comAFolha = await retangulosDourados(page);
    expect(
      comAFolha.filter((um) => um.alcancavel).map((um) => um.descricao),
      "com a Folha aberta o dourado utilizável é o «Copiar password», e o «WiFi» está " +
        "por baixo da cortina (7.5)",
    ).toHaveLength(1);
  });

  /**
   * **Prova:** que a password se lê à distância de um braço, que se
   * seleciona inteira com um toque e que parte onde calha.
   *
   * Uma password não tem fronteiras de palavra: sem `overflow-wrap:
   * anywhere`, uma password de 24 caracteres empurra o painel para fora do
   * ecrã. E o caminho manual tem de ser fácil, porque é o caminho que existe
   * quando copiar falha (7.2).
   */
  test("a password é grande, selecionável e parte onde calha", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);

    const password = page.locator(`#${ID_DA_PASSWORD}`);
    await expect(password).toBeVisible();

    const estilo = await password.evaluate((elemento) => {
      const lido = getComputedStyle(elemento);
      return {
        tamanho: Number.parseFloat(lido.fontSize),
        selecao: lido.userSelect,
        quebra: lido.overflowWrap,
        texto: elemento.textContent ?? "",
      };
    });

    expect(estilo.tamanho, "`--texto-destaque`, 34 px (7.1)").toBeGreaterThanOrEqual(33);
    expect(estilo.selecao, "um toque longo apanha-a inteira, sem pegas para acertar").toBe("all");
    expect(estilo.quebra).toBe("anywhere");
    expect(estilo.texto, "sai da API tal como está guardada, sem aparar (S-09)").toBe(
      PASSWORD_DE_TESTE,
    );

    const caixaDaPassword = await caixa(password);
    expect(
      caixaDaPassword.x + caixaDaPassword.width,
      "uma password de 24 caracteres sem `overflow-wrap: anywhere` empurra o painel " +
        "para fora do ecrã (7.2)",
    ).toBeLessThanOrEqual(larguraDaJanela(page) + PIXEL);
  });

  /**
   * **Prova:** que o lugar da linha viva está **reservado** — a mensagem que
   * chega não empurra o botão para cima do polegar que ainda lá está.
   *
   * É a mesma lição, com o mesmo token, que a F3-02 aprendeu a medir na
   * contagem da pesquisa: 31,6 px de salto, medidos (8.2).
   *
   * E prova, de caminho, o segundo caminho de 8.1 num browser a sério: a API
   * existe, recusa, e o que a pessoa fica a saber é onde está a password.
   */
  test("a mensagem de falha não empurra o botão", async ({ page }) => {
    await recusarACopia(page);
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);

    const antes = await caixa(botaoDeCopiar(page));
    await botaoDeCopiar(page).click();
    await expect(folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.naoCopiou)).toBeVisible();
    const depois = await caixa(botaoDeCopiar(page));

    expect(
      depois.y,
      "a confirmação não pode empurrar o botão para cima do polegar que ainda lá " +
        "está: o lugar reserva-se com `min-h-contagem` à abertura (8.2)",
    ).toBeCloseTo(antes.y, 0);

    await expect(
      folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.naoCopiou),
      "e a frase tem de se ver por cima da cortina, que é o que 13.3 deixa passar",
    ).toBeInViewport({ ratio: 1 });
    await expect(botaoDeCopiar(page), "pronto para outra tentativa").toBeEnabled();
  });

  /**
   * **Prova:** que com o WiFi por configurar — que é o estado de hoje em
   * desenvolvimento — tocar em "WiFi" dá uma resposta.
   *
   * O cabeçalho é o mesmo de sempre; o que muda é o que a Folha diz (6.2).
   */
  test("com o WiFi por configurar, a Folha responde «Pergunta no balcão.»", async ({ page }) => {
    await abrirAPaginaPublica(page, INFO_SEM_REDE);
    await abrirAFolha(page);

    await expect(folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.perguntaNoBalcao)).toBeVisible();
    await expect(botaoDeCopiar(page)).toHaveCount(0);
  });

  /**
   * **Prova:** que o `/info` é pedido **uma vez** por visita.
   *
   * É uma entrega escrita (15) que até aqui não tinha asserção nenhuma — e o
   * `fingirOInfo` já devolvia o contador para isto, sem ninguém o ler. Um
   * contador sem leitor é aparato, não rede.
   *
   * A razão de importar: o `/info` é servido com `no-store` de propósito (a
   * password do WiFi muda, e um minuto de cache é um minuto a mostrar o que
   * já não é verdade), por isso **cada consumidor é uma ida à rede a sério**.
   * A F3-06 vai precisar do mesmo payload para o horário e a morada; se o
   * cabeçalho pedisse por dentro em vez de o receber por propriedade, seriam
   * dois pedidos para o mesmo objeto numa rede de dados móveis dentro de um
   * bar.
   *
   * **Mede o consumidor, não a ida à rede**, e a diferença é o
   * `React.StrictMode`: em desenvolvimento ele corre cada efeito duas vezes,
   * o primeiro pedido é cancelado pelo `AbortController` mas sai à mesma, e
   * um `toBe(1)` aqui chumbava por uma razão que nada tem a ver com o
   * desenho (medido: dá 2). O que a entrega promete não é "uma chamada de
   * rede" — é que **abrir a Folha não acrescenta nenhuma**.
   *
   * **Deixa passar:** o número absoluto de pedidos no arranque. Esse é do
   * `main.tsx` e do modo de compilação, não desta tarefa.
   */
  test("abrir a Folha não pede o `/info` outra vez", async ({ page }) => {
    // `fingirOInfo` e **não** `abrirAPaginaPublica`: o segundo instala o seu
    // próprio interceptor, que no Playwright ganha ao registado antes — o
    // contador ficava a zero e o teste comparava nada com nada. Foi o guarda
    // abaixo que o apanhou, e é por isso que ele existe.
    const contador = await fingirOInfo(page, () => ({
      tipo: "info" as const,
      corpo: INFO_COM_WIFI,
    }));
    await page.goto("/");
    await expect(botaoDoWifi(page)).toBeVisible();
    const noArranque = contador.total;

    expect(noArranque, "guarda: se ninguém pediu o `/info`, não há nada a medir").toBeGreaterThan(
      0,
    );

    await abrirAFolha(page);

    expect(
      contador.total,
      "o `/info` é `no-store`: cada pedido é uma ida à rede a sério. O `App.tsx` " +
        "pede-o ao montar e desce-o por propriedade — se a Folha acrescentar um " +
        "pedido, alguém a pôs a pedir por dentro, e a F3-06 vai duplicar o erro " +
        "para o horário e a morada (15)",
    ).toBe(noArranque);
  });

  /**
   * **Prova:** que o corpo cru de um `/info` recusado não chega ao ecrã.
   *
   * O `App.tsx` deita o erro inteiro fora (`catch { setInfo({ estado:
   * "falhou" }) }`), por isso hoje isto é impossível de violar — e é por
   * isso que o teste existe: a invariante só se mantém enquanto ninguém
   * decidir que "seria útil mostrar o detalhe". A ementa já tem a mesma
   * asserção (`e2e/ementa-estados.spec.ts`); o cabeçalho não tinha, e foi
   * a revisão de segurança que notou a assimetria.
   *
   * O `{ tipo: "estado" }` do apoio devolve de propósito um envelope com
   * `mensagem: "detalhe cru do servidor"` — texto escrito para quem chama
   * a API, nunca para quem está sentado à mesa (F3-02, 5.3).
   *
   * **Deixa passar:** o detalhe a sair por um caminho que não seja o texto
   * visível da Folha — um atributo, um `title`, a consola. A varredura de
   * `src/` e a revisão de segurança cobrem esse lado.
   */
  test("o detalhe cru de um erro do servidor não aparece na Folha", async ({ page }) => {
    await fingirOInfo(page, () => ({ tipo: "estado", estado: 500 }));
    await page.goto("/");
    await abrirAFolha(page);

    await expect(
      folhaDoWifi(page).getByText(TEXTOS_DO_WIFI.perguntaNoBalcao),
      "falhar o pedido e nunca ter sido configurado dão a mesma Folha de " +
        "propósito: o passo seguinte da pessoa é o mesmo nos dois (6.5)",
    ).toBeVisible();

    await expect(
      folhaDoWifi(page),
      "o corpo do erro é escrito para quem chama a API, não para quem está " +
        "sentado à mesa — e o `App.tsx` deita-o fora antes de alguém o poder mostrar",
    ).not.toContainText("detalhe cru do servidor");
  });

  /**
   * **Prova:** que os três alvos desta tarefa têm 44 px (Q-04).
   *
   * O que cede a 360 px com o tamanho de letra do sistema no dobro é o nome
   * do bar, nunca a ação nem o alvo de toque (11).
   */
  test("o botão «WiFi» e o «Copiar password» têm 44 px", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const wifi = await caixa(botaoDoWifi(page));
    expect(wifi.height).toBeGreaterThanOrEqual(44 - PIXEL);

    await abrirAFolha(page);
    const copiar = await caixa(botaoDeCopiar(page));
    expect(copiar.height).toBeGreaterThanOrEqual(44 - PIXEL);

    expect(
      copiar.width,
      "«Copiar password» é de largura total dentro da Folha: um alvo de 312 × 44 onde " +
        "o polegar já está (11)",
    ).toBeGreaterThan(larguraDaJanela(page) * 0.6);
  });
});

test.describe("Q-03: o axe nas camadas novas", () => {
  async function semViolacoesGraves(pagina: Page, ecra: string): Promise<void> {
    const resultado = await new AxeBuilder({ page: pagina }).analyze();
    const graves = resultado.violations.filter(
      (violacao) => violacao.impact === "serious" || violacao.impact === "critical",
    );

    expect(
      graves.map(
        (violacao) =>
          `[${ecra}] ${violacao.id} (${violacao.impact ?? "sem impacto"}): ${violacao.help} ` +
          `em ${violacao.nodes.map((no) => no.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  }

  test("a página pública com o cabeçalho", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await semViolacoesGraves(page, "cabecalho");
  });

  test("a Folha do WiFi aberta", async ({ page }) => {
    await abrirAPaginaPublica(page);
    await abrirAFolha(page);
    await semViolacoesGraves(page, "folha do wifi");
  });

  test("a Folha sem rede configurada", async ({ page }) => {
    await abrirAPaginaPublica(page, INFO_SEM_REDE);
    await abrirAFolha(page);
    await semViolacoesGraves(page, "folha sem rede");
  });

  /**
   * **Prova:** um `h1` só, e continua a ser o nome do bar (14).
   *
   * Em jsdom isto já se prova (`App.test.tsx`); aqui prova-se no documento
   * que o browser montou, depois de o cabeçalho ter mudado de sítio.
   */
  test("um `h1` só, e é o nome do bar", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const titulos = await page.evaluate(() =>
      [...document.querySelectorAll("h1")].map((titulo) => (titulo.textContent ?? "").trim()),
    );

    expect(titulos).toEqual(["Bar da Tomazia"]);
  });
});

test.describe("a 1024 px", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  /**
   * **Prova:** que o cabeçalho é superfície de ponta a ponta com conteúdo
   * contido — o fundo e o fio atravessam a janela, o `<h1>` e o botão vivem
   * nos mesmos 640 px da coluna dos cartões.
   *
   * É esse alinhamento que faz as duas camadas lerem como uma peça só em vez
   * de duas barras empilhadas (11).
   */
  test("o cabeçalho atravessa a janela e o conteúdo fica na coluna", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const janela = larguraDaJanela(page);

    const medida = await caixa(cabecalho(page));
    expect(medida.width, "o fundo e o fio vão de ponta a ponta").toBeCloseTo(janela, 0);

    const nome = await caixa(page.getByRole("heading", { level: 1 }));
    const cartao = await caixa(page.locator('section[id^="ementa-"]').first());

    expect(nome.x, "o logótipo, os chips e os cartões alinham na mesma coluna (11)").toBeCloseTo(
      cartao.x,
      0,
    );

    const wifi = await caixa(botaoDoWifi(page));
    expect(wifi.x + wifi.width).toBeCloseTo(cartao.x + cartao.width, 0);
  });

  test("o cabeçalho continua fixo no topo a 1024", async ({ page }) => {
    await abrirAPaginaPublica(page);

    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    });
    await esperarQueAPaginaPare(page);

    const medida = await caixa(cabecalho(page));
    expect(Math.abs(medida.y), "continua no topo, com a página no fim").toBeLessThanOrEqual(PIXEL);
  });

  test("a abrir a Folha, a aresta direita do cabeçalho não se mexe", async ({ page }) => {
    await abrirAPaginaPublica(page);

    const fechada = await caixa(cabecalho(page));
    await abrirAFolha(page);
    const aberta = await caixa(cabecalho(page));

    expect(aberta.x + aberta.width).toBeCloseTo(fechada.x + fechada.width, 0);
  });
});
