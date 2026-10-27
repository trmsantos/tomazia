import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { arredondar, contraste, contrasteDeCores, lerCor, sobrepor } from "../src/testes/contraste";
import { blocosDosTokens, resolver } from "../src/testes/tokens";
import { exigirVarrimentoCompleto, percorrerComTab, tabulacoesAte } from "./apoio/foco";
import type { ElementoFocado } from "./apoio/foco";
import { instalarPintura } from "./apoio/pintura";
import {
  CAMINHO_DA_DEMONSTRACAO,
  CONTROLOS,
  SECCOES,
  SELETOR_INTERATIVO,
  TITULO_DA_DEMONSTRACAO,
} from "./apoio/pagina";

/**
 * F3-01 — Q-03 (axe) e Q-04 (44 px e foco visível) nos componentes, num
 * Chromium a sério, a 390 × 844.
 *
 * Porque é que isto não podia ficar em jsdom: não há layout, por isso
 * `boundingBox()` não existe e os 44 px não se medem; e o axe desliga a
 * regra de contraste sem um motor de pintura. São precisamente os dois
 * critérios que a tarefa manda cumprir.
 *
 * O teste que importa mais está no fim deste ficheiro: **o anel de foco
 * dentro do cartão creme**. O dourado dá 1,72 contra o creme. Um anel a
 * 1,72 não se vê, e só não se vê a quem navega por teclado — que é quem
 * mais precisa dele. Não aparece numa captura de ecrã nem a usar o rato, e
 * o axe não mede contraste de `outline`. A conta é feita aqui, sobre as
 * cores que o browser calculou mesmo.
 */

async function abrirDemonstracao(pagina: Page): Promise<void> {
  const resposta = await pagina.goto(CAMINHO_DA_DEMONSTRACAO);

  expect(
    resposta?.status(),
    `Não consegui abrir ${CAMINHO_DA_DEMONSTRACAO}. A página de demonstração ` +
      "ainda não existe (ou o servidor do Vite não a está a servir) — e sem ela " +
      "estes testes não verificam nada.",
  ).toBe(200);

  await expect(
    pagina.getByRole("heading", { name: TITULO_DA_DEMONSTRACAO, level: 1 }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Antes do `goto`: o `addInitScript` corre a cada navegação, e é isso que
  // o faz sobreviver ao `reload` e à re-navegação dos testes de CSP.
  await instalarPintura(page);
  await abrirDemonstracao(page);
});

test.describe("Q-03: acessibilidade", () => {
  test("o axe não encontra violações sérias nem críticas", async ({ page }) => {
    const resultado = await new AxeBuilder({ page }).analyze();

    const graves = resultado.violations.filter(
      (violacao) => violacao.impact === "serious" || violacao.impact === "critical",
    );

    expect(
      graves.map(
        (violacao) =>
          `${violacao.id} (${violacao.impact ?? "sem impacto"}): ${violacao.help} ` +
          `em ${violacao.nodes.map((no) => no.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  });

  test("a página tem as onze secções da especificação, cada uma com o seu título", async ({
    page,
  }) => {
    // Guarda da regra 10 para todo o resto deste ficheiro: numa página
    // meia feita, as varreduras abaixo encontrariam poucos elementos e
    // passariam a dizer pouco — sem nunca falhar.
    for (const id of Object.values(SECCOES)) {
      await expect(page.locator(`#${id}`), `falta a secção #${id}`).toHaveCount(1);
    }
  });
});

test.describe("Q-04: alvos de toque", () => {
  test("todo o controlo visível tem pelo menos 44 × 44, contando a etiqueta clicável", async ({
    page,
  }) => {
    const medidas = await page.evaluate((seletor) => {
      const visivel = (elemento: Element): boolean => {
        const caixa = elemento.getBoundingClientRect();
        return caixa.width > 0 && caixa.height > 0;
      };

      return [...document.querySelectorAll(seletor)].filter(visivel).map((elemento) => {
        const caixa = elemento.getBoundingClientRect();
        let esquerda = caixa.left;
        let direita = caixa.right;
        let topo = caixa.top;
        let fundo = caixa.bottom;

        // Quando há uma `<label>` associada, clicar nela ativa o controlo:
        // o alvo é a união dos dois. É assim que o Interruptor cumpre os
        // 44 px com um carril de 28 — a linha inteira é clicável. Se a
        // linha for uma `<div>` em vez de uma `<label>`, isto falha, e
        // deve falhar: aí o alvo é mesmo só o carril.
        const identificador = elemento.getAttribute("id");
        const etiqueta =
          elemento.closest("label") ??
          (identificador === null
            ? null
            : document.querySelector(`label[for="${CSS.escape(identificador)}"]`));
        if (etiqueta !== null) {
          const caixaDaEtiqueta = etiqueta.getBoundingClientRect();
          esquerda = Math.min(esquerda, caixaDaEtiqueta.left);
          direita = Math.max(direita, caixaDaEtiqueta.right);
          topo = Math.min(topo, caixaDaEtiqueta.top);
          fundo = Math.max(fundo, caixaDaEtiqueta.bottom);
        }

        const nome = (elemento.getAttribute("aria-label") ?? elemento.textContent ?? "")
          .trim()
          .slice(0, 48);

        return {
          descricao: `${elemento.tagName.toLowerCase()} «${nome}» (secção ${
            elemento.closest("section")?.id ?? "?"
          })`,
          largura: Math.round(direita - esquerda),
          altura: Math.round(fundo - topo),
        };
      });
    }, SELETOR_INTERATIVO);

    expect(
      medidas.length,
      "guarda: não encontrei controlos nenhuns na página de demonstração",
    ).toBeGreaterThan(20);

    const pequenos = medidas
      .filter((medida) => medida.largura < 44 || medida.altura < 44)
      .map((medida) => `${medida.descricao}: ${medida.largura} × ${medida.altura}`);

    expect(pequenos).toEqual([]);
  });
});

/**
 * Os anéis que não chegam aos 3:1 da 1.4.11, **com a opacidade aplicada**.
 *
 * A opacidade é a parte que faltava e que a revisão encontrou. O estado
 * desativado viaja na `opacity`, a `opacity` apaga o anel junto com tudo o
 * resto, e o `outlineColor` computado devolve a cor cheia. Medido sem ela,
 * o anel de um botão desativado dava 7,73 no escuro e 9,95 no creme;
 * medido como se vê, dá 3,22 e 3,08. Passavam os dois — um por 0,08.
 */
function aneisInvisiveis(visitados: ElementoFocado[]): string[] {
  const falhas: string[] = [];

  for (const visitado of visitados) {
    const corDoAnel = lerCor(visitado.corDoContorno);
    const fundoEfetivo = visitado.fundoEfetivo;
    const fundo = fundoEfetivo === null ? null : lerCor(fundoEfetivo);

    if (corDoAnel === null || fundo === null) {
      falhas.push(
        `${visitado.descricao}: não consegui ler as cores ` +
          `(${visitado.corDoContorno} sobre ${fundoEfetivo ?? "fundo nenhum"}) — ` +
          "falha de leitura, não de contraste",
      );
      continue;
    }

    const opacidade = visitado.opacidadeEfetiva;
    const comoSeVe = sobrepor(corDoAnel, fundo, opacidade);
    const racio = arredondar(contrasteDeCores(comoSeVe, fundo));
    if (racio >= 3) continue;

    const semOpacidade = arredondar(contrasteDeCores(corDoAnel, fundo));
    falhas.push(
      `${visitado.descricao}: anel ${visitado.corDoContorno} sobre ${fundoEfetivo}, ` +
        `apagado a ${opacidade}, dá ${racio} — e o mínimo de 1.4.11 é 3. ` +
        (opacidade < 1
          ? `Sem a opacidade a conta dava ${semOpacidade}, que é o número que ninguém vê.`
          : ""),
    );
  }

  return falhas;
}

test.describe("Q-04: foco visível", () => {
  test("todo o elemento que recebe Tab mostra um anel", async ({ page }) => {
    const varrimento = await percorrerComTab(page);
    exigirVarrimentoCompleto(varrimento);
    const { visitados } = varrimento;

    const semAnel = visitados
      .filter((visitado) => visitado.estiloDoContorno === "none" || visitado.espessura < 2)
      .map(
        (visitado) =>
          `${visitado.descricao}: outline-style ${visitado.estiloDoContorno}, ` +
          `${visitado.espessura}px`,
      );

    expect(semAnel).toEqual([]);
  });

  test("o anel de foco vê-se contra o fundo onde está — incluindo dentro do cartão creme", async ({
    page,
  }) => {
    // A armadilha da secção 6 da especificação, medida onde ela acontece.
    const varrimento = await percorrerComTab(page);
    exigirVarrimentoCompleto(varrimento);
    const { visitados } = varrimento;
    const noCreme = visitados.filter((visitado) => visitado.noCreme);

    expect(
      noCreme.length,
      "guarda: nenhum controlo dentro de `.superficie-creme` recebeu foco. " +
        "A secção «Sobre creme» da demonstração é a mais importante da página — " +
        "é lá que se vê se algum dourado escapou para cima do creme.",
    ).toBeGreaterThan(2);

    expect(aneisInvisiveis(visitados)).toEqual([]);
  });

  test("autoteste: a medição atravessa um véu translúcido e multiplica as opacidades", async ({
    page,
  }) => {
    // As duas metades do medidor, afirmadas sobre uma montagem feita para
    // isso. Nenhuma delas se consegue provar contra a página de
    // demonstração: ela não tem, hoje, um fundo translúcido no caminho de
    // nenhum controlo focável. Sem este teste, a correção do `opaca`
    // (`=== 1` em vez de `> 0`) ficava sem nada a prendê-la, e o erro podia
    // voltar sem se notar — que é exactamente como ele chegou aqui.
    //
    // Os `style` inline são de fixture e vivem dentro deste `evaluate`; o
    // que a CSP proíbe é código **nosso** a pô-los, e disso trata o bloco
    // "CSP: nenhum estilo inline" mais abaixo.
    const medida = await page.evaluate(() => {
      const opaco = document.createElement("div");
      opaco.setAttribute("style", "background-color: rgb(10, 20, 30)");
      const veu = document.createElement("div");
      veu.setAttribute("style", "background-color: rgba(255, 255, 255, 0.5); opacity: 0.5");
      const alvo = document.createElement("button");
      alvo.setAttribute("style", "opacity: 0.4");

      veu.append(alvo);
      opaco.append(veu);
      document.body.append(opaco);
      const resultado = window.__pintura.medir(alvo);
      opaco.remove();
      return resultado;
    });

    expect(
      medida.fundo,
      "a subida parou num fundo translúcido e entregou-o como se fosse opaco: " +
        "o contraste ia ser calculado contra uma cor que não é a que se vê",
    ).toBe("rgb(10, 20, 30)");

    expect(
      medida.opacidade,
      "a opacidade do elemento tem de ser multiplicada pela dos antepassados até ao fundo",
    ).toBeCloseTo(0.4 * 0.5, 5);
  });

  test("o anel de um controlo desativado continua a ver-se depois de a opacidade o apagar", async ({
    page,
  }) => {
    // O chão do `--opacidade-desativado`, medido onde ele acontece. O
    // 0,55 escolhido deixa o anel a 3,22 no escuro e a 3,08 no creme: está
    // certo, e está certo por 0,08. Abaixo de cerca de 0,53 deixa de estar,
    // e sem este teste nada daria por isso — o `outlineColor` computado
    // continua a devolver a cor cheia, apagada ou não.
    const varrimento = await percorrerComTab(page);
    exigirVarrimentoCompleto(varrimento);

    const apagados = varrimento.visitados.filter((visitado) => visitado.opacidadeEfetiva < 1);

    expect(
      apagados.length,
      "guarda: não encontrei um único controlo focável com opacidade reduzida. " +
        "A demonstração tem botões desativados no escuro e no creme — se nenhum " +
        "chegou aqui, este teste não mediu o que existe para medir.",
    ).toBeGreaterThan(4);

    expect(aneisInvisiveis(apagados)).toEqual([]);
  });
});

/**
 * Q-04: a ordem de tabulação.
 *
 * Os testes de foco acima medem o **mecanismo** — o anel existe, o anel
 * vê-se. Este bloco mede o **resultado**: a pessoa que navega por teclado
 * chega onde precisa, pela ordem que vê, e a tempo.
 *
 * É a distinção que falhou na revisão desta tarefa. Havia um teste a dizer
 * que o contador do Aviso pára com o rato por cima (mecanismo, verde) e o
 * "Desfazer" estava a quarenta e tal tabulações do botão que o originou
 * (resultado, invisível). Quem navega por teclado nunca lá chegava dentro
 * dos cinco segundos, e como o Aviso substitui as confirmações neste
 * projeto, isso é uma acção destrutiva sem volta.
 */
test.describe("Q-04: a ordem de tabulação", () => {
  test("o varrimento com Tab chega ao fim da página, em vez de esgotar os passos", async ({
    page,
  }) => {
    // O guarda da regra 10, isolado num teste próprio para a falha ter nome.
    // Enquanto o número de passos era uma constante (80) numa página com
    // mais de noventa controlos, todos os testes de foco diziam "não
    // encontrei nada" sobre meia página — e ninguém sabia.
    const varrimento = await percorrerComTab(page);

    exigirVarrimentoCompleto(varrimento);

    expect(
      varrimento.passosDisponiveis,
      "o limite de passos tem de derivar do número de controlos do DOM, não de uma constante",
    ).toBeGreaterThan(varrimento.focaveisNoDom);
  });

  test("cada controlo focado está igual ou mais abaixo do que o anterior, e à sua direita na mesma faixa", async ({
    page,
  }) => {
    const varrimento = await percorrerComTab(page);
    exigirVarrimentoCompleto(varrimento);

    const alturaDeLinha = varrimento.alturaDeLinha;
    expect(
      alturaDeLinha,
      "não consegui ler a altura de linha do corpo — sem ela não há tolerância, " +
        "e um teste sem tolerância não é um teste estrito, é um teste aleatório",
    ).not.toBeNull();
    // A tolerância vertical é a altura de uma linha: dois controlos lado a
    // lado (a grelha de dois do Botão) não começam exactamente no mesmo
    // pixel, e isso não é um defeito.
    const tolerancia = alturaDeLinha ?? 0;

    const foraDeOrdem: string[] = [];

    for (let indice = 1; indice < varrimento.visitados.length; indice += 1) {
      const anterior = varrimento.visitados[indice - 1];
      const atual = varrimento.visitados[indice];
      if (anterior === undefined || atual === undefined) continue;

      // Uma camada fixa (o Aviso) não tem lugar na ordem vertical do
      // documento. Salta-se aqui; o que importa sobre ela é o teste
      // seguinte, que mede a distância até lá.
      if (anterior.caixa.fixo || atual.caixa.fixo) continue;

      const descida = atual.caixa.topo - anterior.caixa.topo;

      // As paragens numeram-se a partir de 1 para a mensagem de falha
      // poder ser seguida com o Tab na mão.
      const deOndeVem = `${indice}.ª paragem, ${anterior.descricao}`;
      const paraOndeVai = `${indice + 1}.ª paragem, ${atual.descricao}`;

      if (descida < -tolerancia) {
        foraDeOrdem.push(`a ${paraOndeVai} está ${Math.round(-descida)} px ACIMA da ${deOndeVem}`);
        continue;
      }

      const mesmaFaixa = Math.abs(descida) <= tolerancia;
      const recuou = atual.caixa.esquerda - anterior.caixa.esquerda;
      if (mesmaFaixa && recuou < -1) {
        foraDeOrdem.push(
          `na mesma faixa horizontal, a ${paraOndeVai} está ${Math.round(-recuou)} px à ` +
            `ESQUERDA da ${deOndeVem}`,
        );
      }
    }

    // A 390 px o desenho é de coluna única, por isso a ordem visual e a do
    // DOM coincidem — e é por coincidirem que vale a pena afirmá-lo. O dia
    // em que deixarem, é um `order` ou um `position` que alguém acrescentou
    // sem olhar para o teclado.
    expect(foraDeOrdem).toEqual([]);
  });

  /**
   * O limite. O número exacto importa menos do que haver um: cinco
   * tabulações é o que uma pessoa percorre sem desistir, e cinco segundos
   * é o que o Aviso dura.
   */
  const TABULACOES_ATE_A_ACAO_TEMPORARIA = 5;

  test("o «Desfazer» de um Aviso está a poucas tabulações do botão que o originou", async ({
    page,
  }) => {
    const gatilho = page.getByRole("button", { name: CONTROLOS.avisoComDesfazer, exact: true });

    // Disparar por teclado, e não com `click()`, por duas razões: é o que
    // faz quem navega por teclado, e deixa o foco onde ele fica de facto
    // depois da acção — no gatilho. É daí que a distância se mede.
    await gatilho.focus();
    await page.keyboard.press("Enter");

    const aviso = page.getByRole("status");
    await expect(aviso).toBeVisible();

    // Parar o relógio **antes** de medir. Este teste mede a distância, não
    // o tempo: se o aviso se fosse embora a meio da contagem, a falha dizia
    // "desapareceu" e escondia o número, que é o que interessa saber. Que
    // cinco segundos não cheguem para percorrer esta distância é a
    // conclusão, e tira-se do número.
    await aviso.hover();

    const desfazer = aviso.getByRole("button", { name: "Desfazer", exact: true });
    await expect(desfazer).toBeVisible();

    // O limite de busca é generoso de propósito: queremos que a falha diga
    // "44", e não "mais de 5".
    const limite = await page.evaluate(
      (seletor) => document.querySelectorAll(seletor).length + 25,
      SELETOR_INTERATIVO,
    );
    const percurso = await tabulacoesAte(page, desfazer, limite);

    expect(
      percurso.passos,
      `o Tab não chegou ao «Desfazer» em ${percurso.limite} tabulações a partir do ` +
        `gatilho. Percurso: ${percurso.paragens.join(" → ")}`,
    ).not.toBeNull();

    expect(
      percurso.passos ?? Number.POSITIVE_INFINITY,
      `o «Desfazer» está a ${percurso.passos ?? "mais de " + percurso.limite} tabulações do ` +
        `botão que o originou. O aviso dura cinco segundos e o contador só pára quando o ` +
        `foco já está lá dentro: quem navega por teclado não chega a tempo, e o «Desfazer» ` +
        `é o que está no lugar das confirmações. A especificação (7.5) manda inserir o aviso ` +
        `no DOM logo a seguir ao controlo que o originou.`,
    ).toBeLessThanOrEqual(TABULACOES_ATE_A_ACAO_TEMPORARIA);
  });

  test("autoteste: a mesma medida acusa uma distância grande quando ela existe", async ({
    page,
  }) => {
    // Sem isto, «duas tabulações» passaria também se o contador estivesse
    // partido e devolvesse sempre um número pequeno — e o teste de cima
    // ficava verde para sempre, independentemente de onde o Aviso
    // estivesse. É a armadilha do grep da regra 10, outra vez: um medidor
    // que não mede diz o mesmo que uma distância curta.
    //
    // O par escolhido é deliberadamente distante: o primeiro chip da barra
    // pública e um controlo lá em baixo, dentro do cartão creme. Era desta
    // ordem de grandeza (quarenta e tal) a distância entre o gatilho do
    // Aviso e o seu «Desfazer» quando o Aviso vivia no fim do `<main>`.
    const partida = page.locator(`#${SECCOES.chip}`).getByRole("link").first();
    const chegada = page
      .locator(`#${SECCOES.sobreCreme} .superficie-creme`)
      .getByRole("button")
      .last();
    await expect(partida).toBeVisible();
    await expect(chegada).toBeVisible();

    await partida.focus();

    const limite = await page.evaluate(
      (seletor) => document.querySelectorAll(seletor).length + 25,
      SELETOR_INTERATIVO,
    );
    const percurso = await tabulacoesAte(page, chegada, limite);

    expect(percurso.passos, "o medidor não chegou a um alvo que está mesmo lá").not.toBeNull();
    expect(
      percurso.passos ?? 0,
      "o medidor devolveu um número pequeno para um percurso longo: não está a contar",
    ).toBeGreaterThan(20);
  });

  test("com o foco a caminho do aviso, o «Desfazer» ainda lá está quando se chega", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    // O mesmo invariante sem rede nenhuma: nem rato, nem relógio parado.
    // Carrega-se no gatilho por teclado e tabula-se o orçamento permitido,
    // ao ritmo de quem lê o que vai focando. Se o aviso se for embora pelo
    // caminho, é esta a prova de que a distância e os cinco segundos não
    // cabem um no outro.
    const gatilho = page.getByRole("button", { name: CONTROLOS.avisoComDesfazer, exact: true });
    await gatilho.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toBeVisible();

    let dentroDoAviso = false;
    for (let passo = 0; passo < TABULACOES_ATE_A_ACAO_TEMPORARIA && !dentroDoAviso; passo += 1) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(400);
      // Verifica-se a **cada** passo, e não só no fim: com a verificação
      // só no fim, passar ao lado do aviso lia-se igual a nunca lá chegar,
      // e um aviso bem colocado podia dar falha.
      dentroDoAviso = await page.evaluate(() => {
        const focado = document.activeElement;
        return focado !== null && focado.closest('[role="status"], [role="alert"]') !== null;
      });
    }

    expect(
      dentroDoAviso,
      `ao fim de ${TABULACOES_ATE_A_ACAO_TEMPORARIA} tabulações a partir do gatilho, o foco ` +
        "ainda não estava dentro do aviso — e o contador dos cinco segundos só pára quando " +
        "lá chega (WCAG 2.2.1).",
    ).toBe(true);

    await expect(
      page.getByRole("status").getByRole("button", { name: "Desfazer", exact: true }),
      "o aviso desapareceu antes de o foco lá chegar: o «Desfazer» é inalcançável por teclado",
    ).toBeVisible();
  });
});

/**
 * 1.4.11 para o que não é texto: as linhas de 1 px dentro do cartão creme.
 *
 * Isto não existe em lado nenhum senão aqui. **O axe não mede contraste de
 * elementos não textuais** — mede texto, e uma divisória não é texto. Uma
 * linha a 1,39 passa pelo axe, passa por qualquer teste de classes, e
 * desaparece no telemóvel.
 *
 * O teste é escrito como regra geral e não como nome de classe de
 * propósito. Prender `divide-fio-interno` prendia uma implementação e
 * deixava passar a próxima linha que alguém acrescentasse com outro token.
 * O invariante é o que interessa: **dentro do creme, qualquer contorno de
 * 1 px tem de ter pelo menos 3:1 contra o fundo em que assenta.**
 */
test.describe("1.4.11: as linhas de 1 px dentro do creme", () => {
  test("qualquer contorno ou divisória dentro de .superficie-creme vê-se contra o seu fundo", async ({
    page,
  }) => {
    const linhas = await page.evaluate(() => {
      // O fundo em que a linha assenta é o da superfície **por trás** dela,
      // e por isso o `medir` de `apoio/pintura.ts` começa no pai e não no
      // próprio elemento. Um cartão com preenchimento próprio tem a sua
      // aresta a delimitá-lo contra o que está à volta: medir contra o seu
      // próprio preenchimento dava 1,39 à aresta do cartão creme, que é a
      // única linha do desenho que está certa a creme-sombra.
      const { opaca, medir } = window.__pintura;

      const LADOS = ["top", "right", "bottom", "left"];
      const achados: {
        descricao: string;
        lado: string;
        espessura: number;
        cor: string;
        fundo: string | null;
      }[] = [];

      // A própria superfície entra: a aresta do cartão creme assenta no
      // bordô de fora, e é lá que ela tem de se ver.
      for (const elemento of document.querySelectorAll(".superficie-creme, .superficie-creme *")) {
        const caixa = elemento.getBoundingClientRect();
        if (caixa.width === 0 || caixa.height === 0) continue;

        const estilo = getComputedStyle(elemento);
        for (const lado of LADOS) {
          const espessura = Number.parseFloat(estilo.getPropertyValue(`border-${lado}-width`));
          const desenho = estilo.getPropertyValue(`border-${lado}-style`);
          const cor = estilo.getPropertyValue(`border-${lado}-color`);

          if (!Number.isFinite(espessura) || espessura <= 0) continue;
          if (desenho === "none" || desenho === "hidden") continue;
          // `border-transparent` é uma ausência de linha escrita de outra
          // maneira — o campo só de leitura usa-a de propósito.
          if (!opaca(cor)) continue;

          const nome = (elemento.getAttribute("aria-label") ?? elemento.textContent ?? "")
            .trim()
            .slice(0, 40);
          achados.push({
            descricao: `${elemento.tagName.toLowerCase()}.${elemento.className
              .toString()
              .split(/\s+/)
              .filter((classe) => /contorno|fio|border/.test(classe))
              .join(".")} «${nome}»`,
            lado,
            espessura,
            cor,
            fundo: medir(elemento).fundo,
          });
        }
      }

      return achados;
    });

    expect(
      linhas.length,
      "guarda: não encontrei linha nenhuma dentro do creme — não verifiquei nada. " +
        "A secção «Sobre creme» é a que tem a lista de interruptores, os campos e os chips.",
    ).toBeGreaterThan(5);

    const fracas: string[] = [];
    for (const linha of linhas) {
      if (linha.fundo === null || lerCor(linha.cor) === null || lerCor(linha.fundo) === null) {
        fracas.push(
          `${linha.descricao}, lado ${linha.lado}: não consegui ler as cores ` +
            `(${linha.cor} sobre ${linha.fundo ?? "fundo nenhum"}) — falha de leitura, ` +
            "não de contraste",
        );
        continue;
      }

      const racio = arredondar(contraste(linha.cor, linha.fundo));
      if (racio < 3) {
        fracas.push(
          `${linha.descricao}, lado ${linha.lado} (${linha.espessura}px): ${linha.cor} sobre ` +
            `${linha.fundo} dá ${racio}, e o mínimo de 1.4.11 é 3`,
        );
      }
    }

    expect(fracas).toEqual([]);
  });

  test("o título do estado de erro não tem a mesma cor do título do estado vazio", async ({
    page,
  }) => {
    // O resultado, não o mecanismo. O defeito original era uma classe de
    // embrulho sobreposta e morta: o `text-erro` estava escrito e não
    // pintava nada, e o ecrã de erro saía igual ao de vazio. Só a cor que o
    // browser calculou o diz.
    const seccao = page.locator(`#${SECCOES.estadoVazio}`);
    const vazio = seccao.getByRole("heading", { name: "Ainda não há fotos." });
    const erro = seccao.getByRole("heading", { name: "Não consegui carregar a ementa." });
    await expect(vazio).toBeVisible();
    await expect(erro).toBeVisible();

    const corDoVazio = await vazio.evaluate((elemento) => getComputedStyle(elemento).color);
    const corDoErro = await erro.evaluate((elemento) => getComputedStyle(elemento).color);

    expect(
      corDoErro,
      "o título do erro saiu com a mesma cor do título do vazio: os dois ecrãs têm a mesma " +
        "forma, e se a cor também for a mesma só se distinguem a ler as palavras",
    ).not.toBe(corDoVazio);

    const fundo = await erro.evaluate((elemento) => window.__pintura.medir(elemento).fundo);

    expect(fundo, "não consegui ler o fundo por trás do título de erro").not.toBeNull();
    expect(
      arredondar(contraste(corDoErro, fundo ?? "")),
      "o título de erro é texto grande, mas continua a precisar dos 4,5 da 1.4.3",
    ).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("o dourado nunca sobre o creme", () => {
  test("nenhum elemento dentro de .superficie-creme usa o dourado", async ({ page }) => {
    const dourado = resolver(blocosDosTokens(), ":root", "--cor-dourado-latao");
    const corDoDourado = dourado === null ? null : lerCor(dourado);
    expect(corDoDourado, "não consegui ler --cor-dourado-latao do tokens.css").not.toBeNull();

    const achados = await page.evaluate(
      ({ vermelho, verde, azul }) => {
        const igual = (cor: string): boolean => {
          const numeros = cor.match(/\d+(?:\.\d+)?/g);
          if (numeros === null || numeros.length < 3) return false;
          return (
            Math.round(Number(numeros[0])) === vermelho &&
            Math.round(Number(numeros[1])) === verde &&
            Math.round(Number(numeros[2])) === azul
          );
        };

        const dentroDoCreme = [...document.querySelectorAll(".superficie-creme *")];
        return {
          total: dentroDoCreme.length,
          comDourado: dentroDoCreme
            .filter((elemento) => {
              const estilo = getComputedStyle(elemento);
              return [
                estilo.color,
                estilo.backgroundColor,
                estilo.borderTopColor,
                estilo.borderBottomColor,
                estilo.borderLeftColor,
                estilo.borderRightColor,
                estilo.outlineColor,
              ].some(igual);
            })
            .map((elemento) => {
              const nome = (elemento.textContent ?? "").trim().slice(0, 40);
              return `${elemento.tagName.toLowerCase()} «${nome}»`;
            })
            .slice(0, 20),
        };
      },
      corDoDourado ?? { vermelho: -1, verde: -1, azul: -1 },
    );

    expect(
      achados.total,
      "guarda: a secção creme da demonstração está vazia, não verifiquei nada",
    ).toBeGreaterThan(10);
    expect(achados.comDourado).toEqual([]);
  });
});

test.describe("Folha: o que só o browser faz", () => {
  test("abre, prende o foco, fecha com Esc e devolve o foco ao botão que a abriu", async ({
    page,
  }) => {
    const gatilho = page.getByRole("button", { name: CONTROLOS.abrirFolhaWifi });
    await gatilho.click();

    const folha = page.getByRole("dialog");
    await expect(folha).toBeVisible();

    // `document.activeElement?.closest(…) !== null` dava `true` também
    // quando não havia foco nenhum (`undefined !== null`): "não há foco"
    // passava por "o foco está na Folha". Regra 10 do `CLAUDE.md`.
    const focoDentro = await page.evaluate(() => {
      const focado = document.activeElement;
      return focado !== null && focado.closest("dialog") !== null;
    });
    expect(focoDentro, "ao abrir, o foco entra na Folha (é o showModal que o faz)").toBe(true);

    await page.keyboard.press("Escape");
    await expect(folha).toBeHidden();

    const voltouAoGatilho = await page.evaluate(
      (nome) => document.activeElement?.textContent?.includes(nome) === true,
      CONTROLOS.abrirFolhaWifi,
    );
    expect(voltouAoGatilho, "ao fechar, o foco volta ao controlo que a abriu").toBe(true);
  });

  test("com prefers-reduced-motion, a Folha aparece sem translação", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();

    await page.getByRole("button", { name: CONTROLOS.abrirFolhaWifi }).click();

    const duracao = await page.evaluate(() => {
      const folha = document.querySelector("dialog[open]");
      if (folha === null) return null;
      return getComputedStyle(folha).transitionDuration;
    });

    expect(duracao, "não encontrei a Folha aberta").not.toBeNull();
    expect(Number.parseFloat(duracao ?? "1")).toBeLessThanOrEqual(0.01);
  });
});

test.describe("Aviso temporário: o tempo pára mesmo", () => {
  test("com o rato por cima, o aviso não foge ao fim dos cinco segundos", async ({ page }) => {
    test.setTimeout(30_000);

    await page.getByRole("button", { name: CONTROLOS.avisoComDesfazer }).click();

    const aviso = page.getByRole("status");
    await expect(aviso).toBeVisible();
    await aviso.hover();

    await page.waitForTimeout(6000);

    await expect(
      aviso,
      "WCAG 2.2.1: com o rato por cima o contador pára, senão ninguém chega ao «Desfazer»",
    ).toBeVisible();
    // `exact: true` não é zelo: o `name` do Playwright casa por SUBCADEIA, e
    // o gatilho desta secção chama-se "Aviso com Desfazer" (ver
    // `e2e/apoio/pagina.ts`). Sem o `exact`, o localizador apanha os dois
    // botões e o teste falha por ambiguidade — nunca por o aviso ter
    // desaparecido, que é o que ele existe para provar.
    await expect(page.getByRole("button", { name: "Desfazer", exact: true })).toBeVisible();
  });
});

/**
 * CSP: a rede independente contra estilos inline.
 *
 * A CSP de produção (`deploy/htaccess.exemplo`) é
 * `default-src 'none'; … style-src 'self'`. Aqui injeta-se uma política
 * **só com a parte que interessa apertada** — `style-src-attr 'self'`, que
 * bloqueia atributos `style=` — e tudo o resto permissivo. A razão é que
 * estes testes correm contra o servidor de desenvolvimento do Vite, que
 * injeta o CSS por `<style>` criados em JavaScript e um script inline do
 * React Refresh: com a política de produção inteira, o ruído do Vite
 * afogava o sinal. `style-src-attr` isola exactamente o defeito que
 * queremos apanhar — um `style=` vindo do nosso código ou de uma
 * biblioteca, que é o que o ADR 0008 diz que parte em produção.
 */
const POLITICA_DE_TESTE =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:; style-src-attr 'self'";

/**
 * Monta a política e a escuta das violações. **Não devolve as violações**: a
 * lista vive na página, e quem a quer vai buscá-la com o `page.evaluate` que
 * está em cada teste. Devolver um `string[]` daqui — vazio, porque nesta
 * altura ainda não houve interação nenhuma — dava um `await` que se lia como
 * "não há violações" e que nunca poderia dizer outra coisa.
 */
async function comCspApertada(pagina: Page): Promise<void> {
  await pagina.route(`**${CAMINHO_DA_DEMONSTRACAO}`, async (rota) => {
    const resposta = await rota.fetch();
    await rota.fulfill({
      response: resposta,
      headers: {
        ...resposta.headers(),
        "content-security-policy": POLITICA_DE_TESTE,
      },
    });
  });

  await pagina.addInitScript(() => {
    const violacoes: string[] = [];
    (window as unknown as { __violacoes: string[] }).__violacoes = violacoes;
    document.addEventListener("securitypolicyviolation", (evento) => {
      violacoes.push(`${evento.violatedDirective} em ${evento.sourceFile ?? "?"}`);
    });
  });

  await abrirDemonstracao(pagina);
}

test.describe("CSP: nenhum estilo inline", () => {
  test("abrir tudo o que a página abre não gera uma violação de style-src-attr", async ({
    page,
  }) => {
    await comCspApertada(page);

    // Exercita os estados que só existem depois de uma interação, que é
    // onde um `style=` costuma aparecer (uma folha a animar, uma barra de
    // contagem a encher).
    await page.getByRole("button", { name: CONTROLOS.abrirFolhaWifi }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: CONTROLOS.avisoDeSucesso }).click();
    await page.waitForTimeout(500);

    const violacoes = await page.evaluate(
      () => (window as unknown as { __violacoes: string[] }).__violacoes,
    );

    expect(violacoes).toEqual([]);
  });

  test("autoteste: a mesma montagem apanha um style inline posto de propósito", async ({
    page,
  }) => {
    // Sem isto, o teste de cima passaria também se a política não estivesse
    // a ser aplicada — e «não houve violações» passaria por «não estive a
    // ver». É a mesma armadilha do grep da regra 10, noutra roupagem.
    await comCspApertada(page);

    await page.evaluate(() => {
      const intruso = document.createElement("div");
      intruso.setAttribute("style", "padding:1px");
      document.body.append(intruso);
    });
    await page.waitForTimeout(200);

    const violacoes = await page.evaluate(
      () => (window as unknown as { __violacoes: string[] }).__violacoes,
    );

    expect(
      violacoes.join(" "),
      "a política de teste não está a ser aplicada: um style= inline tinha de dar violação",
    ).toMatch(/style-src/);
  });
});
