import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { arredondar, contrasteDeCores, lerCor, sobrepor } from "../src/testes/contraste";
import { EMENTA_VAZIA } from "../src/testes/ementa";
import {
  EMENTA_DE_TESTE,
  ID_DA_BARRA,
  TEXTOS_DA_EMENTA,
  abrirAEmenta,
  campoDePesquisa,
  cartoes,
  chips,
  fingirAEmenta,
  fingirEmentaFixa,
  lupa,
} from "./apoio/ementa";
import { percorrerComTab } from "./apoio/foco";
import { SELETOR_INTERATIVO } from "./apoio/pagina";
import { instalarPintura } from "./apoio/pintura";

/**
 * F3-02, 12.8 — Q-03 e Q-04 nesta página, reaproveitando `e2e/apoio/`.
 *
 * **O que este ficheiro prova:** axe sem violações sérias nem críticas nos
 * ecrãs desta página (pronta, a carregar, vazia, erro e pesquisa aberta);
 * 44 px em todos os controlos; anel visível em todos; a ordem de tabulação
 * a seguir a ordem visual.
 *
 * **O que deixa passar — e é a lacuna nova desta página:** um controlo
 * focado **por baixo da barra fixa**. Os ajudantes da F3-01 medem se o anel
 * existe e se contrasta, não se o elemento está **visível**. Numa página
 * com um elemento colado ao topo, isso passa a ser a falha provável, e não
 * aparece a quem usa rato. Daí o último `describe`: para cada elemento que
 * recebe foco, a caixa dele fica dentro da janela e com o topo **abaixo**
 * do fundo da barra. É o `scroll-padding-top` da secção 11 que faz isto
 * passar; sem ele, passa a revisão inteira sem ninguém reparar.
 *
 * O axe, por si, também deixa passar: a ordem de leitura, se a contagem é
 * anunciada, e se a barra é operável com o teclado quando está deslizada na
 * horizontal. Zero violações numa página cujo conteúdo está todo escondido.
 *
 * **Porque é que o `exigirVarrimentoCompleto` da F3-01 não serve aqui:** o
 * guarda dele exige mais de 20 paragens de `Tab`, que é a medida da página
 * de demonstração (mais de noventa controlos). Esta página tem doze de
 * propósito — onze chips e a lupa —, porque nada na ementa é clicável
 * (secção 1). O guarda equivalente está escrito em baixo, com o número
 * desta página e derivado do DOM.
 */

/** Onze chips e a lupa. Menos do que isto quer dizer que não verifiquei nada. */
const PARAGENS_MINIMAS = 12;

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

test.beforeEach(async ({ page }) => {
  await instalarPintura(page);
});

test.describe("Q-03: o axe nos ecrãs desta página", () => {
  test("a ementa pronta", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(cartoes(page)).not.toHaveCount(0);

    await semViolacoesGraves(page, "pronta");
  });

  test("a carregar", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "ementa", corpo: EMENTA_DE_TESTE, atrasoMs: 4000 }));
    await page.goto("/");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);

    await semViolacoesGraves(page, "a carregar");
  });

  test("vazia", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "ementa", corpo: EMENTA_VAZIA }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.vaziaTitulo)).toBeVisible();

    await semViolacoesGraves(page, "vazia");
  });

  test("erro", async ({ page }) => {
    await fingirAEmenta(page, () => ({ tipo: "falha" }));
    await abrirAEmenta(page);
    await expect(page.getByText(TEXTOS_DA_EMENTA.erroTitulo)).toBeVisible();

    await semViolacoesGraves(page, "erro");
  });

  test("com a pesquisa aberta", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await lupa(page).click();
    await expect(campoDePesquisa(page)).toBeFocused();

    await semViolacoesGraves(page, "pesquisa aberta");
  });

  test("o campo de pesquisa tem nome acessível sem ser pelo exemplo", async ({ page }) => {
    // Exceção escrita a 7.2 da F3-01: esta caixa não usa o componente
    // `Campo` e não tem `<label>` visível. O que a torna compreensível é a
    // lupa ao lado, o exemplo lá dentro e o nome acessível — e é o nome
    // acessível que se verifica (4.1).
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await lupa(page).click();

    const campo = campoDePesquisa(page);
    await expect(campo).toHaveAttribute("aria-label", TEXTOS_DA_EMENTA.campoDePesquisa);
    await expect(campo).toHaveAttribute("type", "search");
    await expect(campo).toHaveAttribute("placeholder", TEXTOS_DA_EMENTA.exemploDePesquisa);
  });
});

test.describe("Q-04: alvos de toque", () => {
  test("chips, lupa e fechar têm 44 px; as linhas de produto não são alvos", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(chips(page)).not.toHaveCount(0);

    const medidas = await page.evaluate((seletor) => {
      return [...document.querySelectorAll(seletor)]
        .map((elemento) => {
          const caixa = elemento.getBoundingClientRect();
          const nome = (elemento.getAttribute("aria-label") ?? elemento.textContent ?? "")
            .trim()
            .slice(0, 32);
          return {
            descricao: `${elemento.tagName.toLowerCase()} «${nome}»`,
            largura: caixa.width,
            altura: caixa.height,
          };
        })
        .filter((medida) => medida.largura > 0 && medida.altura > 0);
    }, SELETOR_INTERATIVO);

    expect(
      medidas.length,
      "guarda: não encontrei controlo nenhum — não medi nada",
    ).toBeGreaterThanOrEqual(PARAGENS_MINIMAS);

    const pequenos = medidas
      .filter((medida) => medida.largura < 44 || medida.altura < 44)
      .map(
        (medida) =>
          `${medida.descricao}: ${medida.largura.toFixed(1)} × ${medida.altura.toFixed(1)}`,
      );

    expect(pequenos).toEqual([]);
  });

  test("nada dentro de um cartão creme é focável", async ({ page }) => {
    // Secção 1: 140 produtos clicáveis seriam 140 paragens de `Tab` antes
    // da secção seguinte. E é também o que faz o risco do anel dourado
    // dentro do creme ser zero nesta tarefa — volta inteiro na F4-02.
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const focaveisNoCreme = await page.evaluate(
      (seletor) =>
        // `:is(…)` e não uma interpolação directa: o `SELETOR_INTERATIVO` é
        // uma **lista** de seletores, e num `.superficie-creme a, button,
        // input…` o descendente só se aplica ao primeiro item — os outros
        // passam a apanhar a página inteira. Escrito à mão, este teste
        // contava os botões todos do ecrã e dizia que estavam dentro do
        // creme.
        document.querySelectorAll(`.superficie-creme :is(${seletor})`).length,
      SELETOR_INTERATIVO,
    );

    expect(focaveisNoCreme).toBe(0);
  });
});

test.describe("Q-04: foco visível", () => {
  test("todo o elemento que recebe Tab mostra um anel que se vê", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(chips(page)).not.toHaveCount(0);

    const varrimento = await percorrerComTab(page);

    expect(
      varrimento.visitados.length,
      `guarda: o Tab parou em ${String(varrimento.visitados.length)} controlos e esta ` +
        `página tem ${String(varrimento.focaveisVisiveis)} visíveis. Tudo o que este ` +
        "teste dissesse a seguir seria sobre meia página.",
    ).toBeGreaterThanOrEqual(Math.min(PARAGENS_MINIMAS, varrimento.focaveisVisiveis));
    expect(
      varrimento.saiuDaPagina,
      "guarda: o varrimento esgotou os passos sem o Tab sair da página",
    ).toBe(true);

    const semAnel = varrimento.visitados
      .filter((visitado) => visitado.estiloDoContorno === "none" || visitado.espessura < 2)
      .map(
        (visitado) =>
          `${visitado.descricao}: outline-style ${visitado.estiloDoContorno}, ` +
          `${String(visitado.espessura)}px`,
      );
    expect(semAnel).toEqual([]);

    const fracos: string[] = [];
    for (const visitado of varrimento.visitados) {
      const corDoAnel = lerCor(visitado.corDoContorno);
      const fundo = visitado.fundoEfetivo === null ? null : lerCor(visitado.fundoEfetivo);

      if (corDoAnel === null || fundo === null) {
        fracos.push(
          `${visitado.descricao}: não consegui ler as cores — falha de leitura, ` +
            "não de contraste",
        );
        continue;
      }

      const comoSeVe = sobrepor(corDoAnel, fundo, visitado.opacidadeEfetiva);
      const racio = arredondar(contrasteDeCores(comoSeVe, fundo));
      if (racio < 3) {
        fracos.push(`${visitado.descricao}: anel a ${String(racio)}, e o mínimo da 1.4.11 é 3`);
      }
    }
    expect(fracos).toEqual([]);
  });

  test("a ordem de tabulação segue a ordem visual", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const varrimento = await percorrerComTab(page);
    const tolerancia = varrimento.alturaDeLinha;

    expect(
      tolerancia,
      "guarda: não consegui ler a altura de linha do corpo — sem ela não há " +
        "tolerância para controlos lado a lado, e este teste não compara nada",
    ).not.toBeNull();

    const foraDeOrdem: string[] = [];
    const noFluxo = varrimento.visitados.filter(
      (visitado) => !visitado.caixa.fixo && !visitado.caixa.colado,
    );

    noFluxo.forEach((visitado, indice) => {
      const anterior = noFluxo[indice - 1];
      if (anterior === undefined) return;
      if (visitado.caixa.topo < anterior.caixa.topo - (tolerancia ?? 0)) {
        foraDeOrdem.push(`${anterior.descricao} → ${visitado.descricao} sobe na página`);
      }
    });

    expect(foraDeOrdem).toEqual([]);
  });
});

type ParagemDeFoco = {
  descricao: string;
  topo: number;
  fundo: number;
  alturaDaJanela: number;
  naBarra: boolean;
  fundoDaBarra: number;
};

const MENSAGEM_DO_TAPADO =
  "focado mas tapado pela barra colada. É o `scroll-padding-top: var(--ancora-ementa)` " +
  "da secção 11 que faz isto passar — e com o rato nunca acontece, por isso nenhuma " +
  "captura e nenhuma revisão visual o apanham.";

/** Foca cada controlo visível, por ordem, e mede onde ele ficou. */
async function focarCadaControlo(pagina: Page): Promise<ParagemDeFoco[]> {
  return pagina.evaluate(
    async ({ seletor, idDaBarra }) => {
      const resultados: ParagemDeFoco[] = [];

      const alcancaveis = [...document.querySelectorAll(seletor)].filter((elemento) => {
        const caixa = elemento.getBoundingClientRect();
        return caixa.width > 0 && caixa.height > 0;
      });

      for (const elemento of alcancaveis) {
        if (!(elemento instanceof HTMLElement)) continue;
        elemento.focus();
        // Deixar o browser fazer o deslocamento que faz quando o `Tab` leva
        // o foco para um controlo escondido. É esse deslocamento que o
        // `scroll-padding-top` corrige.
        await new Promise((continuar) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(continuar);
          });
        });

        const caixa = elemento.getBoundingClientRect();
        const barraFixa = document.getElementById(idDaBarra);
        const caixaDaBarra = barraFixa?.getBoundingClientRect();
        const nome = (elemento.getAttribute("aria-label") ?? elemento.textContent ?? "")
          .trim()
          .slice(0, 32);

        resultados.push({
          descricao: `${elemento.tagName.toLowerCase()} «${nome}»`,
          topo: caixa.top,
          fundo: caixa.bottom,
          alturaDaJanela: window.innerHeight,
          naBarra: barraFixa !== null && barraFixa.contains(elemento),
          fundoDaBarra: caixaDaBarra === undefined ? Number.NaN : caixaDaBarra.bottom,
        });
      }

      return resultados;
    },
    { seletor: SELETOR_INTERATIVO, idDaBarra: ID_DA_BARRA },
  ) as Promise<ParagemDeFoco[]>;
}

function exigirMedicaoDaBarra(paragens: ParagemDeFoco[]): void {
  expect(
    paragens.filter((paragem) => Number.isNaN(paragem.fundoDaBarra)).map((p) => p.descricao),
    `não encontrei a barra (#${ID_DA_BARRA}) ao medir — falha de medição, não de layout`,
  ).toEqual([]);
}

function foraDaJanela(paragens: ParagemDeFoco[]): string[] {
  return paragens
    .filter((paragem) => paragem.topo < 0 || paragem.fundo > paragem.alturaDaJanela)
    .map(
      (paragem) =>
        `${paragem.descricao}: topo ${paragem.topo.toFixed(1)}, fundo ` +
        `${paragem.fundo.toFixed(1)}, janela ${paragem.alturaDaJanela.toFixed(0)}`,
    );
}

function tapadosPelaBarra(paragens: ParagemDeFoco[]): string[] {
  return paragens
    .filter((paragem) => !paragem.naBarra && paragem.topo < paragem.fundoDaBarra - 1)
    .map(
      (paragem) =>
        `${paragem.descricao}: topo ${paragem.topo.toFixed(1)}, e a barra acaba em ` +
        `${paragem.fundoDaBarra.toFixed(1)}`,
    );
}

test.describe("a lacuna nova: focado mas tapado pela barra", () => {
  /**
   * **Prova:** que o mecanismo que impede o foco de aterrar por baixo da
   * barra está instalado, e que nenhum controlo focável desta página fica
   * tapado por ela.
   *
   * Isto não é o mesmo que "o anel existe" nem que "o anel contrasta". Um
   * chip pode ter um anel dourado impecável a 9,95 e estar inteiro por
   * baixo da barra — e com o rato nunca acontece, por isso passa a revisão
   * sem ninguém reparar.
   *
   * **Honestidade sobre o alcance, escrita para não ficar por dizer:** na
   * F3-02 quase todos os focáveis vivem **dentro** da barra (onze chips e a
   * lupa), e um controlo que vive na camada colada não pode ser tapado por
   * ela. Por isso a varredura sozinha, nesta tarefa, quase não tem o que
   * acusar — medido: tirar o `scroll-padding-top` do `global.css` não a põe
   * vermelha. Quem carrega o peso hoje é a primeira asserção, sobre o valor
   * computado; a varredura fica escrita e passa a morder sozinha na F3-03
   * (cabeçalho fixo) e na F4-02 (preço editável dentro do cartão).
   *
   * **Deixa passar:** um elemento tapado por outra coisa que não a barra
   * (uma cortina, um cartão com `z-index`). Hoje não há nenhum nesta
   * página; se houver, esta medida tem de crescer.
   */
  test("o `html` desconta a barra no `scroll-padding-top`", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const medidas = await page.evaluate(() => {
      const raiz = document.documentElement;
      const regua = document.createElement("div");
      regua.style.position = "absolute";
      regua.style.height = getComputedStyle(raiz).getPropertyValue("--ancora-ementa").trim();
      document.body.append(regua);
      const ancora = regua.getBoundingClientRect().height;
      regua.remove();

      return { preenchimento: getComputedStyle(raiz).scrollPaddingTop, ancora };
    });

    expect(
      medidas.ancora,
      "não consegui resolver --ancora-ementa — falha de leitura do token, não de layout",
    ).toBeGreaterThan(0);

    expect(
      Number.parseFloat(medidas.preenchimento),
      `o \`html\` tem scroll-padding-top «${medidas.preenchimento}» e a âncora vale ` +
        `${medidas.ancora.toFixed(1)}px. É esta declaração que faz duas coisas ao ` +
        "mesmo tempo: o salto por âncora parar com o título à vista, e o " +
        "deslocamento que o browser faz quando o Tab leva o foco para um controlo " +
        "escondido por baixo da barra. Sem ela, quem navega por teclado aterra " +
        "debaixo da barra — e com o rato nunca acontece (F3-02, secção 11).",
    ).toBeCloseTo(medidas.ancora, 0);
  });

  test("na ementa pronta, cada paragem de Tab fica visível e abaixo da barra", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(chips(page)).not.toHaveCount(0);

    const paragens = await focarCadaControlo(page);

    expect(
      paragens.length,
      "guarda: não focei controlo nenhum — não verifiquei nada",
    ).toBeGreaterThanOrEqual(PARAGENS_MINIMAS);

    exigirMedicaoDaBarra(paragens);
    expect(foraDaJanela(paragens), "um controlo focado fora da janela não se vê").toEqual([]);
    expect(tapadosPelaBarra(paragens), MENSAGEM_DO_TAPADO).toEqual([]);
  });

  test("com a pesquisa sem resultados, o botão que vive fora da barra também", async ({ page }) => {
    // Esta é a única situação desta tarefa com um focável **fora** da
    // camada colada. Sem ela, a varredura acima não tem um único candidato
    // e a asserção do tapado é uma frase sem sujeito.
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await lupa(page).click();
    await campoDePesquisa(page).fill("xkcd");
    await expect(page.getByRole("button", { name: TEXTOS_DA_EMENTA.limparPesquisa })).toBeVisible();

    const paragens = await focarCadaControlo(page);
    const foraDaBarra = paragens.filter((paragem) => !paragem.naBarra);

    expect(
      foraDaBarra.map((paragem) => paragem.descricao),
      "guarda: nenhum controlo desta página vive fora da barra colada, por isso a " +
        "asserção seguinte não teria o que medir. Isto não quer dizer que nada " +
        "está tapado — quer dizer que não procurei.",
    ).not.toEqual([]);

    exigirMedicaoDaBarra(paragens);
    expect(foraDaJanela(paragens)).toEqual([]);
    expect(tapadosPelaBarra(paragens), MENSAGEM_DO_TAPADO).toEqual([]);
  });
});
