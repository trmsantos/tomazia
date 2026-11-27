import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { TEXTOS_DO_WIFI } from "../src/testes/cabecalho";
import { lerCor } from "../src/testes/contraste";
import type { Rgb } from "../src/testes/contraste";
import {
  COM_E_SEM_CARTAZ,
  DIAS_ESPERADOS,
  EVENTO_DE_AMANHA,
  EVENTO_DE_HOJE,
  EVENTO_DE_HOJE_JA_COMECADO,
  MESES_ESPERADOS,
  QUATRO_EVENTOS,
  SAMBA_A_TRES_DIAS,
  SEM_EVENTOS,
  TEXTOS_DOS_EVENTOS,
  TRES_EVENTOS,
  UM_EVENTO,
  aPartirDas,
  comMaiuscula,
  comecouAs,
  dataPorExtenso,
  diaEHora,
  resposta,
} from "../src/testes/eventos";
import { TEXTOS_DA_GALERIA } from "../src/testes/galeria";
import { botaoDoWifi, fingirInfoFixo } from "./apoio/cabecalho";
import { SELETOR_DOS_CARTOES, SELETOR_DOS_CHIPS, fingirEmentaFixa } from "./apoio/ementa";
import { fingirAGaleria } from "./apoio/galeria";
import {
  ROTA_DOS_EVENTOS,
  ROTA_DO_CARTAZ,
  abrirComEventos,
  botaoDeTentarOutraVez,
  caixasDoCartaz,
  cartoesDeEvento,
  fingirEventosFixos,
  fingirOCartaz,
  fingirOsEventos,
  prenderORelogio,
  seccaoDosEventos,
  tituloDosEventos,
} from "./apoio/eventos";

/**
 * F3-04, 12.3 — o que só o browser prova.
 *
 * **O que este ficheiro prova:**
 *
 *  1. a secção está **depois** da ementa, medido em píxeis e não por ordem
 *     no DOM;
 *  2. a secção não acrescenta uma única paragem de `Tab` ao caminho normal,
 *     e acrescenta exactamente uma no erro;
 *  3. a caixa do cartaz tem lugar **antes** de a imagem chegar: o que está
 *     por baixo não se mexe quando ela chega (6.2);
 *  4. com `/media/` a devolver 404, a caixa sai do cartão e ele fica mais
 *     baixo do que o mesmo cartão com imagem (6.3);
 *  5. a meia-noite e a hora de início recontam-se no regresso à página
 *     (5.6), com relógio falso;
 *  6. a secção some sem eventos e **aparece** com o pedido falhado — a
 *     regra 10 no ecrã, e não só no DOM de um jsdom;
 *  7. o axe, nos dois ecrãs que esta tarefa acrescenta.
 *
 * **O que deixa passar:** a rede a sério — o `route` nunca toca no backend,
 * e quem prende a forma da resposta é o tipo da fixtura; os cartazes
 * verdadeiros do bar (a caixa 3:2 corta, e quanto corta decide-se numa
 * captura com um cartaz real à frente, 14); e as cadeias de caracteres da
 * data, que se provam em `src/lib/formato/data-do-evento.test.ts`. Aqui
 * compara-se **o que mudou**, não a palavra certa.
 */

/** 2 px de folga: é o que os arredondamentos de layout do Chromium pedem. */
const PIXEL = 2;

async function abrirComFixtura(pagina: Page, corpo = TRES_EVENTOS): Promise<void> {
  await prenderORelogio(pagina);
  await fingirInfoFixo(pagina);
  await fingirEmentaFixa(pagina);
  await fingirEventosFixos(pagina, corpo);
  await fingirOCartaz(pagina, { tipo: "chega" });
  await abrirComEventos(pagina, corpo);
}

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

/**
 * Onde é que o `Tab` pára, e quais dessas paragens caem dentro dos eventos.
 *
 * O guarda é a regra 10: um varrimento que não chega a controlo nenhum
 * responde "nenhuma paragem nos eventos" com a mesma cara de um que
 * percorreu a página toda. Por isso devolvem-se **os dois números**, e quem
 * chama afirma os dois.
 */
async function paragensDeTab(pagina: Page): Promise<{ todas: string[]; nosEventos: string[] }> {
  const todas: string[] = [];
  const nosEventos: string[] = [];

  await pagina.evaluate(() => {
    document.body.focus();
  });

  for (let passo = 0; passo < 40; passo += 1) {
    await pagina.keyboard.press("Tab");
    const onde = await pagina.evaluate(() => {
      const ativo = document.activeElement;
      if (ativo === null || ativo === document.body) return null;
      const texto = (ativo.textContent ?? "").trim().slice(0, 40);
      return {
        descricao: `${ativo.tagName.toLowerCase()}:${texto}`,
        nosEventos: ativo.closest("#eventos") !== null,
      };
    });

    if (onde === null) break;
    todas.push(onde.descricao);
    if (onde.nosEventos) nosEventos.push(onde.descricao);
  }

  return { todas, nosEventos };
}

/**
 * Medir, ou falhar a dizer que não mediu.
 *
 * `boundingBox()` devolve `null` para um elemento que não está lá, e um
 * `null` que se arrasta por três contas acaba numa mensagem sobre a conta e
 * não sobre o elemento em falta. É a regra 10 na forma mais barata que ela
 * tem neste ficheiro.
 */
async function caixaDe(alvo: Locator, nome: string): Promise<BoundingBox> {
  const medida = await alvo.boundingBox();

  expect(medida, `não consegui medir ${nome}. Sem a medida não verifiquei nada.`).not.toBeNull();
  if (medida === null) throw new Error(`não consegui medir ${nome}`);

  return medida;
}

type BoundingBox = { x: number; y: number; width: number; height: number };

/** O que o browser recebeu de `/media/`, por ordem de chegada. */
type RespostaDeMedia = { estado: number; tipo: string };

function observarOMedia(pagina: Page): RespostaDeMedia[] {
  const vistas: RespostaDeMedia[] = [];

  pagina.on("response", (resposta) => {
    if (!resposta.url().includes("/media/")) return;
    vistas.push({ estado: resposta.status(), tipo: resposta.headers()["content-type"] ?? "" });
  });

  return vistas;
}

/**
 * O guarda do `/media/`, e é o que me apanhou a mim a escrever isto.
 *
 * Em desenvolvimento quem serve `/media/` é um middleware do
 * `vite.config.ts`. Quando ele **recusa** um ficheiro, o Vite não devolve
 * 404: cai no `index.html` e devolve **200**. O estado não distingue
 * "serviu" de "recusou" — quem distingue é o tipo de conteúdo. E se o
 * padrão do `page.route` deixasse de condizer, era por aí que estes testes
 * passavam a correr: o caminho feliz ficava a medir uma caixa com HTML lá
 * dentro, e o caminho do 404 passava na mesma, porque o `<img>` dispara
 * `error` com uma página de HTML tal como dispara com um 404.
 */
function exigirCartazServido(vistas: RespostaDeMedia[]): void {
  expect(
    vistas.length,
    "guarda: o browser não pediu `/media/` nenhuma vez. O cartão ou não tem " +
      "cartaz, ou o endereço não é o do contrato (6).",
  ).toBeGreaterThan(0);

  expect(
    vistas.filter((vista) => vista.estado === 200 && vista.tipo.startsWith("image/")).length,
    `guarda: nenhuma resposta de /media/ foi uma imagem. Vieram ${JSON.stringify(vistas)} — ` +
      "um 200 em `text/html` é o `index.html` do Vite, e quer dizer que a rota " +
      "do teste não condiz com o endereço que o componente pediu.",
  ).toBeGreaterThan(0);
}

/** O mesmo guarda, do outro lado: o 404 tem de ser um 404 nosso. */
function exigirCartazRecusado(vistas: RespostaDeMedia[]): void {
  expect(
    vistas.length,
    "guarda: o browser não pediu `/media/` nenhuma vez — não houve 404 nenhum a provar.",
  ).toBeGreaterThan(0);

  expect(
    vistas.filter((vista) => vista.estado !== 404),
    "alguma resposta de /media/ não foi 404. Se for um 200 em `text/html`, é o " +
      "`index.html` do Vite a fazer de cartaz: o teste estaria a ver a caixa sair " +
      "do cartão pela razão errada.",
  ).toEqual([]);
}

/** As três linhas do `<h3>` de um cartão, com o tamanho e a família de cada. */
function lerOCabecalhoDoCartao(
  cartao: Locator,
): Promise<{ texto: string; tamanho: number; familia: string }[] | null> {
  return cartao.evaluate((elemento) => {
    const titulo = elemento.querySelector("h3");
    if (titulo === null) return null;
    return [...titulo.children].map((linha) => {
      const estilo = getComputedStyle(linha);
      return {
        texto: (linha.textContent ?? "").trim(),
        tamanho: Number.parseFloat(estilo.fontSize),
        familia: estilo.fontFamily,
      };
    });
  });
}

/** O texto de cada cartão, numa linha só, para comparar frases inteiras. */
function lerOsCartoes(pagina: Page): Promise<string[]> {
  return cartoesDeEvento(pagina).evaluateAll((cartoes) =>
    cartoes.map((cartao) => (cartao.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
}

/** Duas cores são a mesma? «Não consegui ler» nunca pode valer «sim». */
function aMesmaCor(bruta: string, alvo: Rgb): boolean {
  const lida = lerCor(bruta);
  if (lida === null) return false;
  return lida.vermelho === alvo.vermelho && lida.verde === alvo.verde && lida.azul === alvo.azul;
}

/** Um token de cor da raiz, já lido e com o guarda de «não existe». */
async function corDoToken(pagina: Page, nome: string): Promise<Rgb> {
  const bruto = await pagina.evaluate(
    (chave) => getComputedStyle(document.documentElement).getPropertyValue(chave).trim(),
    nome,
  );

  expect(
    bruto,
    `guarda: o token «${nome}» não existe. Um token em falta lê-se como uma string vazia, que não é uma cor.`,
  ).not.toBe("");

  const lida = lerCor(bruto);
  expect(lida, `guarda: não soube ler «${bruto}» como cor do token «${nome}»`).not.toBeNull();
  if (lida === null) throw new Error(`não soube ler o token «${nome}»`);

  return lida;
}

test.describe("onde a secção vive (2.1)", () => {
  test("o título dos eventos está abaixo do último cartão da ementa", async ({ page }) => {
    // Medido, e não pela ordem no DOM: um `order` do flexbox ou um
    // `position: absolute` punham a secção no sítio certo do HTML e no
    // sítio errado do ecrã. É isto que faz o salto da F3-03 continuar a
    // acabar na ementa (2.1).
    //
    // Deixa passar: os 64 px exactos entre as duas secções. Isso é a
    // captura `390-ementa-para-eventos.png`.
    await abrirComFixtura(page);

    const ultimoCartao = page.locator(SELETOR_DOS_CARTOES).last();
    await ultimoCartao.scrollIntoViewIfNeeded();
    const caixaDaEmenta = await ultimoCartao.boundingBox();
    const caixaDoTitulo = await tituloDosEventos(page).boundingBox();

    expect(caixaDaEmenta, "não consegui medir o último cartão da ementa").not.toBeNull();
    expect(caixaDoTitulo, "não consegui medir o título dos eventos").not.toBeNull();
    if (caixaDaEmenta === null || caixaDoTitulo === null) return;

    expect(caixaDoTitulo.y).toBeGreaterThanOrEqual(caixaDaEmenta.y + caixaDaEmenta.height - PIXEL);
  });

  test("a chegada dos eventos não mexe com quem está a ler a ementa (13)", async ({ page }) => {
    // Os eventos chegam **depois** da ementa, e a secção nasce abaixo dela.
    // Se nascesse acima, ou se empurrasse seja o que for, a página saltava
    // por baixo do polegar de quem está a ler — e o sintoma só existe com
    // as duas respostas a chegarem em tempos diferentes.
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOsEventos(page, () => ({ tipo: "eventos", corpo: TRES_EVENTOS, atrasoMs: 3000 }));
    await fingirOCartaz(page, { tipo: "chega" });
    await page.goto("/");

    const primeiroCartao = page.locator(SELETOR_DOS_CARTOES).first();
    await expect(primeiroCartao).toBeVisible();
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);

    const antes = await primeiroCartao.boundingBox();
    const posicaoAntes = await page.evaluate(() => Math.round(window.scrollY));

    await expect(tituloDosEventos(page)).toBeAttached({ timeout: 10_000 });

    const depois = await primeiroCartao.boundingBox();
    const posicaoDepois = await page.evaluate(() => Math.round(window.scrollY));

    expect(
      antes,
      "guarda: não consegui medir o cartão antes de os eventos chegarem",
    ).not.toBeNull();
    expect(depois).not.toBeNull();
    if (antes === null || depois === null) return;

    expect(Math.abs(depois.y - antes.y), "o cartão da ementa mexeu-se").toBeLessThanOrEqual(PIXEL);
    expect(posicaoDepois).toBe(posicaoAntes);
  });
});

test.describe("teclado (2.2)", () => {
  test("com cartões o `Tab` não pára na secção, e com erro pára uma vez", async ({ page }) => {
    // O critério da F3-03 continua de pé: seguir "Saltar para a ementa" e
    // tabular não põe ninguém dentro de um cartão de evento.
    //
    // Os dois lados medem-se na mesma corrida porque zero é o resultado de
    // "não acrescenta paragens" **e** de "o varrimento não andou".
    await abrirComFixtura(page, QUATRO_EVENTOS);

    const normal = await paragensDeTab(page);

    expect(
      normal.todas.length,
      "guarda: o Tab não chegou a controlo nenhum — não verifiquei nada",
    ).toBeGreaterThan(2);
    expect(
      normal.todas.some((paragem) => paragem.includes(TEXTOS_DO_WIFI.saltar)),
      `guarda: o varrimento devia passar por «${TEXTOS_DO_WIFI.saltar}». Parou em ` +
        `${JSON.stringify(normal.todas)}`,
    ).toBe(true);
    expect(normal.nosEventos, "a secção não acrescenta paragens ao caminho normal").toEqual([]);

    await fingirOsEventos(page, () => ({ tipo: "falha" }));
    await page.goto("/");
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();

    const comErro = await paragensDeTab(page);

    expect(comErro.nosEventos, "no erro há exatamente uma paragem, e é o botão").toHaveLength(1);
    expect(comErro.nosEventos[0]).toContain(TEXTOS_DOS_EVENTOS.tentarOutraVez);
  });
});

test.describe("o cartaz, no browser (6.2, 6.3)", () => {
  test("a caixa tem lugar antes de a imagem chegar, e nada se mexe quando ela chega", async ({
    page,
  }) => {
    // É isto que a proporção fixa compra, e é invisível num teste de
    // unidade: sem caixa reservada, a página salta por baixo de quem está a
    // ler quando o primeiro byte do cartaz chega.
    //
    // Mede-se o **fundo do cartão** e não a caixa: uma caixa que exista com
    // zero de altura passa uma asserção sobre a sua presença e falha esta.
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirEventosFixos(page, UM_EVENTO);
    await fingirOCartaz(page, { tipo: "chega", atrasoMs: 3000 });
    await page.goto("/");

    const cartao = cartoesDeEvento(page).first();
    await expect(cartao).toBeVisible();
    await cartao.scrollIntoViewIfNeeded();

    await expect(caixasDoCartaz(page), "a caixa tem de estar lá antes da imagem").toHaveCount(1);
    const antes = await cartao.boundingBox();

    const imagem = cartao.getByRole("img");
    await expect(imagem).toHaveJSProperty("complete", true, { timeout: 10_000 });

    const depois = await cartao.boundingBox();

    expect(antes, "não consegui medir o cartão antes de a imagem chegar").not.toBeNull();
    expect(depois).not.toBeNull();
    if (antes === null || depois === null) return;

    expect(
      Math.abs(depois.height - antes.height),
      "o cartão mudou de altura quando a imagem chegou: a caixa não tinha lugar reservado",
    ).toBeLessThanOrEqual(PIXEL);
  });

  test("a caixa é 3:2, medida", async ({ page }) => {
    // A proporção é um token (`--cartaz-proporcao`) e uma classe
    // (`aspect-cartaz`). Nenhuma das duas coisas prova que o browser a
    // aplicou: um `aspect-ratio` dentro de um contentor com altura fixa é
    // ignorado em silêncio.
    await abrirComFixtura(page);

    const caixa = await caixasDoCartaz(page).first().boundingBox();
    expect(caixa, "não consegui medir a caixa do cartaz").not.toBeNull();
    if (caixa === null) return;

    expect(
      caixa.width / caixa.height,
      `a caixa mediu ${caixa.width} × ${caixa.height}`,
    ).toBeCloseTo(3 / 2, 1);
  });

  test("com 404 em `/media/`, a caixa sai do cartão e ele fica mais baixo", async ({ page }) => {
    // Um 404 é um caso normal: a F2-08 importou nomes de ficheiro da base
    // de dados antiga e esses ficheiros podem nunca ter chegado ao
    // servidor. O 404 encaminha-se pela rota do Playwright — um teste que
    // dependesse de um ficheiro em falta a sério passava no dia em que
    // alguém o criasse.
    //
    // As duas asserções são precisas as duas: "a caixa desapareceu" sozinha
    // passaria num componente que nunca desenha caixa nenhuma.
    const servidas = observarOMedia(page);

    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirEventosFixos(page, UM_EVENTO);
    await fingirOCartaz(page, { tipo: "chega" });
    await abrirComEventos(page, UM_EVENTO);
    await expect(seccaoDosEventos(page).getByRole("img")).toHaveJSProperty("complete", true, {
      timeout: 10_000,
    });
    exigirCartazServido(servidas);

    const comImagem = await cartoesDeEvento(page).first().boundingBox();
    expect(comImagem, "guarda: não consegui medir o cartão com cartaz").not.toBeNull();

    // `unroute` e não uma segunda rota por cima: a ordem por que o
    // Playwright resolve duas rotas com o mesmo padrão é um detalhe dele, e
    // um teste que dependa dela falha no dia em que ele mude de ideias.
    servidas.length = 0;
    await page.unroute(ROTA_DO_CARTAZ);
    await fingirOCartaz(page, { tipo: "nao-existe" });
    await page.goto("/");
    await expect(cartoesDeEvento(page)).toHaveCount(1);
    // A caixa só sai do cartão depois de o `error` disparar, e a imagem é
    // `loading="lazy"`: o pedido sai uns instantes depois do cartão existir.
    // Sem esta espera o guarda corre antes do pedido e falha de forma
    // intermitente — passava na corrida completa e falhava isolado.
    await expect(caixasDoCartaz(page)).toHaveCount(0);
    exigirCartazRecusado(servidas);

    const semImagem = await cartoesDeEvento(page).first().boundingBox();
    expect(semImagem).not.toBeNull();
    if (comImagem === null || semImagem === null) return;

    await expect(
      caixasDoCartaz(page),
      "a caixa vazia era um buraco permanente no cartão (6.3)",
    ).toHaveCount(0);
    expect(
      semImagem.height,
      `com cartaz o cartão mediu ${comImagem.height} e sem cartaz ${semImagem.height}`,
    ).toBeLessThan(comImagem.height);
  });

  test("um cartão com cartaz e um sem, um por baixo do outro, não têm buracos", async ({
    page,
  }) => {
    // O par de 6.1. No browser porque o que se mede é a **altura**: em
    // jsdom os dois cartões medem zero e um buraco de 216 px passa.
    await abrirComFixtura(page, COM_E_SEM_CARTAZ);

    const comCartaz = await cartoesDeEvento(page).nth(0).boundingBox();
    const semCartaz = await cartoesDeEvento(page).nth(1).boundingBox();
    expect(comCartaz).not.toBeNull();
    expect(semCartaz).not.toBeNull();
    if (comCartaz === null || semCartaz === null) return;

    await expect(caixasDoCartaz(page), "só um dos dois tem caixa").toHaveCount(1);
    expect(
      semCartaz.y,
      "o segundo cartão tem de começar onde o primeiro acaba, sem espaço morto",
    ).toBeGreaterThan(comCartaz.y);
  });
});

test.describe("o relógio, no regresso à página (5.6)", () => {
  test("atravessar a meia-noite troca «Amanhã» por «Hoje»", async ({ page }) => {
    // O telemóvel vai para o bolso às 23:50 e volta às 00:10. Sem a
    // recontagem, a página aberta continua a dizer "Amanhã" sobre um
    // evento que é hoje — e esta é a metade do defeito do cache de 60 s
    // que vive do nosso lado.
    //
    // Deixa passar: o `setInterval` que 5.6 recusa. Um relógio a bater
    // passava este teste e gastava bateria a noite toda; quem o apanha é a
    // revisão de código.
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirEventosFixos(page, resposta([EVENTO_DE_AMANHA]));
    await fingirOCartaz(page, { tipo: "chega" });
    await abrirComEventos(page, resposta([EVENTO_DE_AMANHA]));

    const cartao = cartoesDeEvento(page).first();
    await expect(cartao).toContainText(TEXTOS_DOS_EVENTOS.amanha);

    // 3 de novembro, 01:00 em Lisboa: o evento das 00:30 é de hoje e já
    // começou. O relógio anda **com a página escondida**, que é o caso
    // real — e é também o que prova que a recontagem é no regresso.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.setSystemTime(new Date("2026-11-03T01:00:00Z"));
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(cartao).toContainText(TEXTOS_DOS_EVENTOS.hoje);
    await expect(cartao, "e já começou, por isso não é «A partir das»").toContainText("Começou às");
    await expect(cartao).not.toContainText(TEXTOS_DOS_EVENTOS.amanha);
  });
});

test.describe("os estados, no ecrã (8, 13)", () => {
  /*
   * Até à F3-05 este teste dizia-se "sem eventos não há nada entre a
   * ementa e o fim da página", e media até ao fim do documento. Isso
   * deixou de ser verdade de propósito (correção do Tomás, 6 de novembro
   * de 2026): a galeria entrou a seguir aos eventos e **nunca** desaparece
   * (F3-05, secção 2.1), mesmo vazia — ao contrário da secção de eventos,
   * que some de vez quando não há nada marcado. Sem eventos, o que se
   * segue à ementa deixou de ser "nada" e passou a ser a galeria; o que
   * continua a valer, e é o que importa medir, é que a secção de eventos
   * não deixa um respiro a mais onde esteve — a galeria herda a mesma
   * folga de 64 px que já separava a ementa dos eventos.
   */
  test("sem eventos, a galeria segue-se à ementa sem um respiro a mais", async ({ page }) => {
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirEventosFixos(page, SEM_EVENTOS);
    await fingirAGaleria(page);
    await page.goto("/");

    const ultimoCartao = page.locator(SELETOR_DOS_CARTOES).last();
    await expect(ultimoCartao).toBeVisible();
    await ultimoCartao.scrollIntoViewIfNeeded();

    await expect(seccaoDosEventos(page)).toHaveCount(0);
    await expect(tituloDosEventos(page)).toHaveCount(0);

    const tituloDaGaleria = page.getByRole("heading", { name: TEXTOS_DA_GALERIA.titulo });
    await expect(
      tituloDaGaleria,
      "sem a secção de eventos, a galeria é o que se segue à ementa — e nunca desaparece",
    ).toBeVisible();

    const caixaDoCartao = await ultimoCartao.boundingBox();
    const caixaDaGaleria = await tituloDaGaleria.boundingBox();
    expect(caixaDoCartao, "guarda: não consegui medir o último cartão da ementa").not.toBeNull();
    expect(caixaDaGaleria, "guarda: não consegui medir o título da galeria").not.toBeNull();
    if (caixaDoCartao === null || caixaDaGaleria === null) return;

    expect(
      caixaDaGaleria.y - (caixaDoCartao.y + caixaDoCartao.height),
      "sobrou altura entre a ementa e a galeria: a secção de eventos sumiu mas deixou um " +
        "respiro a mais onde esteve",
    ).toBeLessThan(96);
  });

  test("com o pedido falhado a secção aparece, com título e com saída", async ({ page }) => {
    // A prova visual da regra 10, e a mesma afirmação que o teste de
    // unidade faz — repetida aqui porque o que a revisão vai ver é isto:
    // o ecrã, com as duas coisas visíveis ao mesmo tempo.
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOsEventos(page, () => ({ tipo: "falha" }));
    await page.goto("/");

    await expect(tituloDosEventos(page)).toBeVisible();
    await expect(page.getByText(TEXTOS_DOS_EVENTOS.erroTitulo)).toBeVisible();
    await expect(page.getByText(TEXTOS_DOS_EVENTOS.erroSemResposta)).toBeVisible();
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();
  });

  test("«Tentar outra vez» pede outra vez, e os cartões aparecem", async ({ page }) => {
    // O caminho inteiro, de ponta a ponta: falha, botão, resposta boa,
    // cartões. Nenhum teste de unidade vê esta ligação.
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOCartaz(page, { tipo: "chega" });

    let aFalhar = true;
    const contador = await fingirOsEventos(page, () =>
      aFalhar ? { tipo: "falha" } : { tipo: "eventos", corpo: TRES_EVENTOS },
    );

    await page.goto("/");
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();

    const pedidosAteAqui = contador.total;
    aFalhar = false;
    await botaoDeTentarOutraVez(page).click();

    await expect(cartoesDeEvento(page)).toHaveCount(3);
    expect(
      contador.total,
      "o botão tem de fazer um pedido novo. O total não se compara com um número " +
        "escrito à mão: em desenvolvimento o `StrictMode` monta duas vezes",
    ).toBeGreaterThan(pedidosAteAqui);
  });

  test("o botão tem 44 px de alvo (13)", async ({ page }) => {
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOsEventos(page, () => ({ tipo: "falha" }));
    await page.goto("/");

    const caixa = await botaoDeTentarOutraVez(page).boundingBox();
    expect(caixa, "não consegui medir o botão").not.toBeNull();
    if (caixa === null) return;

    expect(caixa.height).toBeGreaterThanOrEqual(44 - PIXEL);
    expect(caixa.width).toBeGreaterThanOrEqual(44 - PIXEL);
  });
});

test.describe("calma (13)", () => {
  test("nada se mexe ao passar o rato por cima de um cartão", async ({ page }) => {
    // Um cartão que reage ao rato promete que há alguma coisa para
    // carregar lá dentro, e não há. Compara-se a imagem do cartão antes e
    // depois: uma mudança de fundo, um contorno novo ou uma subida de
    // 2 px dão buffers diferentes, e nenhuma delas se apanha medindo a
    // caixa.
    await abrirComFixtura(page);

    const cartao = cartoesDeEvento(page).first();
    await cartao.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const antes = await cartao.screenshot();

    await cartao.hover();
    await page.waitForTimeout(300);
    const depois = await cartao.screenshot();

    expect(
      Buffer.compare(antes, depois),
      "o cartão mudou de aspeto com o rato por cima (13: nada se mexe ao passar o rato)",
    ).toBe(0);
  });

  test("no fundo da página a barra de chips já não está no ecrã", async ({ page }) => {
    // **A premissa da entrega ao qa sobre o `noFundo`** (2.3), medida.
    //
    // A barra é `sticky` dentro da secção da ementa e desaparece com ela.
    // Com os eventos por baixo, o fim da página deixa de ser o fim da
    // ementa: o guarda 2 do `categoriaAtiva` passa a decidir qual é o chip
    // ativo num sítio onde não há barra nenhuma para o mostrar. Este teste
    // não julga o guarda — fixa o facto em que a decisão assenta, para que
    // ela não se tome de memória na F3-02.
    await abrirComFixtura(page, QUATRO_EVENTOS);

    await page.evaluate(() => {
      // `behavior: "instant"` e não o suave: o `global.css` liga
      // `scroll-behavior: smooth` dentro de `prefers-reduced-motion:
      // no-preference`, e com o relógio preso pelo `page.clock` a animação
      // congela a meio — medido, parava nos 2230 de 2772. O `apoio/ementa.ts`
      // já desliza assim pela mesma razão.
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    });
    await page.waitForTimeout(400);

    const barraDeChips = page.locator(SELETOR_DOS_CHIPS).first();
    const caixa = await barraDeChips.boundingBox();
    const altura = await page.evaluate(() => window.innerHeight);

    expect(
      caixa === null || caixa.y + caixa.height <= 0 || caixa.y >= altura,
      `no fundo da página a barra de chips estava em ${JSON.stringify(caixa)}, ` +
        `com o ecrã a medir ${String(altura)} px`,
    ).toBe(true);
  });
});

test.describe("1024 px (10)", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("a coluna continua nos 640, centrada, e os cartões não vão a duas", async ({ page }) => {
    // São no máximo três e a leitura é de cima para baixo, pela data. Duas
    // colunas partiam a ordem — e com três cartões sobrava sempre um
    // sozinho na segunda linha.
    await abrirComFixtura(page);

    const caixas = await cartoesDeEvento(page).evaluateAll((cartoes) =>
      cartoes
        .map((cartao) => cartao.getBoundingClientRect())
        .map((caixa) => ({
          x: caixa.x,
          y: caixa.y,
          largura: caixa.width,
        })),
    );

    expect(caixas.length, "guarda: tem de haver três cartões para se olhar para eles").toBe(3);
    expect(new Set(caixas.map((caixa) => Math.round(caixa.x))).size, "todos na mesma coluna").toBe(
      1,
    );
    expect(new Set(caixas.map((caixa) => Math.round(caixa.y))).size, "e um por linha").toBe(3);

    // A coluna mede-se contra o **token** e não contra um 640 escrito à
    // mão: a ementa e os eventos têm de assentar na mesma coluna, e se
    // `--coluna-publica` mudar tem de mudar num sítio só (3).
    const coluna = await page.evaluate(() => {
      const bruto = getComputedStyle(document.documentElement)
        .getPropertyValue("--coluna-publica")
        .trim();
      if (bruto === "") return null;
      const regua = document.createElement("div");
      regua.style.width = bruto;
      regua.style.position = "absolute";
      document.body.append(regua);
      const largura = regua.getBoundingClientRect().width;
      regua.remove();
      return largura;
    });
    expect(coluna, "guarda: o token `--coluna-publica` não existe").not.toBeNull();

    const lista = await caixaDe(seccaoDosEventos(page).getByRole("list"), "a lista dos eventos");
    expect(
      Math.abs(lista.width - (coluna ?? 0)),
      `a lista mediu ${String(Math.round(lista.width))} px e a coluna pública ` +
        `${String(coluna)} px`,
    ).toBeLessThanOrEqual(PIXEL);

    // E a caixa do cartaz passa a 574 × 383 (10): 640 menos os dois `px-4` da
    // lista, os dois `p-4` do cartão e o fio de 1 px de cada lado.
    const cartaz = await caixaDe(caixasDoCartaz(page).first(), "a caixa do cartaz a 1024 px");
    expect(Math.round(cartaz.width), "a 1024 px o interior do cartão são 574 (10)").toBe(574);
    expect(Math.round(cartaz.height), "574 a 3:2 são 383 (10)").toBe(383);
  });
});

test.describe("Q-03: o axe nos ecrãs desta tarefa", () => {
  test("a secção pronta, com três cartões", async ({ page }) => {
    await abrirComFixtura(page);
    await semViolacoesGraves(page, "eventos prontos");
  });

  test("a secção em erro", async ({ page }) => {
    // O axe deixa passar quase tudo o que esta tarefa decide — mas o
    // contraste do título a `--cor-erro` e o nome acessível do botão são
    // dele, e são os dois que mudam neste ecrã.
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOsEventos(page, () => ({ tipo: "falha" }));
    await page.goto("/");
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();

    await semViolacoesGraves(page, "eventos em erro");
  });
});

test.describe("as cinco formas da data, desenhadas (5.2)", () => {
  /**
   * Hoje por começar, hoje já começado e amanhã, no mesmo ecrã.
   *
   * **Prova:** que as formas de 5.2 chegam ao ecrã, e não só ao valor de
   * retorno da função pura. O que se compara constrói-se com os ajudantes
   * da tabela de 9 (`comecouAs`, `aPartirDas`) — nenhuma destas frases está
   * escrita à mão aqui, porque uma frase escrita à mão neste ficheiro é uma
   * terceira cópia a divergir das outras duas.
   *
   * **O que deixa passar:** as fronteiras. O segundo exacto em que
   * "A partir das" vira "Começou às", os dois lados do `d = 7` e os dois
   * dias de mudança de hora provam-se em
   * `src/lib/formato/data-do-evento.test.ts`, com relógio fixo e sem
   * browser. Aqui prova-se que o resultado foi **desenhado**, e desenhado
   * na linha certa do cartão.
   */
  test("«Hoje», «Começou às 00:30» e «Amanhã»", async ({ page }) => {
    const hojeEAmanha = resposta([EVENTO_DE_HOJE_JA_COMECADO, EVENTO_DE_HOJE, EVENTO_DE_AMANHA]);
    await abrirComFixtura(page, hojeEAmanha);

    const cartoes = await lerOsCartoes(page);
    expect(cartoes, "guarda: a fixtura tem três eventos e nenhum deles é cortado").toHaveLength(3);

    expect(cartoes[0]).toContain(TEXTOS_DOS_EVENTOS.hoje);
    expect(
      cartoes[0],
      "um evento que já começou não se lê como coisa por acontecer (5.3)",
    ).toContain(comecouAs("00:30"));

    expect(cartoes[1]).toContain(TEXTOS_DOS_EVENTOS.hoje);
    expect(cartoes[1]).toContain(aPartirDas("22:00"));
    expect(cartoes[1], "o que ainda não começou não pode dizer que começou").not.toContain(
      comecouAs("22:00"),
    );

    expect(cartoes[2]).toContain(TEXTOS_DOS_EVENTOS.amanha);
    expect(cartoes[2]).toContain(aPartirDas("00:30"));
  });

  /**
   * O nome do dia, a data por extenso e o dia da semana recuperado em baixo.
   *
   * **Prova:** as três formas distantes, e a regra que as atravessa — a
   * linha de baixo recupera o dia da semana **exactamente** quando a de
   * cima o perde (5.2). Daí as duas asserções negativas: o cartão a três
   * dias não pode trazer a data por extenso, e não pode trazer o dia da
   * semana duas vezes.
   *
   * **O que deixa passar:** o ano. A sexta forma (`1 de janeiro de 2027`)
   * é a do quarto evento da fixtura, que é precisamente o que o corte dos
   * três deixa de fora — está em 12.1 e em 12.2, onde se consegue mostrar
   * sozinha.
   */
  test("«Quinta-feira», «19 de novembro» e «Quinta-feira, a partir das 22:00»", async ({
    page,
  }) => {
    await abrirComFixtura(page, TRES_EVENTOS);

    const cartoes = await lerOsCartoes(page);
    expect(cartoes, "guarda: três cartões").toHaveLength(3);

    const quinta = comMaiuscula(DIAS_ESPERADOS[4]);

    expect(cartoes[0], "a 3 dias, o nome do dia sozinho").toContain(quinta);
    expect(cartoes[0]).toContain(aPartirDas("22:00"));
    expect(
      cartoes[0],
      "dentro dos 7 dias o nome do dia chega: a data por extenso é ruído",
    ).not.toContain(` de ${MESES_ESPERADOS[10]}`);

    expect(cartoes[1], "a 17 dias, a data por extenso e sem ano").toContain(
      dataPorExtenso(19, MESES_ESPERADOS[10]),
    );
    expect(cartoes[1], "e a linha de baixo recupera o dia da semana (5.2)").toContain(
      diaEHora(DIAS_ESPERADOS[4], "22:00"),
    );

    expect(cartoes[2]).toContain(dataPorExtenso(17, MESES_ESPERADOS[11]));
    expect(cartoes[2]).toContain(diaEHora(DIAS_ESPERADOS[4], "22:00"));
  });

  /**
   * **Prova:** dois cartões nunca mostram a mesma data grande (13).
   *
   * A fixtura é o caso real do bar: a mesma noite de samba em três datas,
   * com o **mesmo título** nos três cartões (7.3). Se a data grande se
   * repetisse, os três cartões passavam a ser indistinguíveis — e o olho
   * procura a diferença exactamente onde ela deixou de estar.
   *
   * **O que deixa passar:** se a data está **certa**. Três datas erradas e
   * diferentes passam aqui; quem as lê palavra a palavra é o teste de
   * cima.
   */
  test("três cartões com o mesmo nome trazem três datas grandes diferentes", async ({ page }) => {
    await abrirComFixtura(page, TRES_EVENTOS);

    const quantos = await cartoesDeEvento(page).count();
    expect(quantos, "guarda: sem cartões não há datas para comparar").toBe(3);

    const grandes: string[] = [];
    for (let indice = 0; indice < quantos; indice += 1) {
      const linhas = await lerOCabecalhoDoCartao(cartoesDeEvento(page).nth(indice));
      expect(linhas, `guarda: o cartão ${String(indice)} não tem <h3> nenhum (4.3)`).not.toBeNull();
      const primeira = linhas?.[0];
      expect(primeira, `guarda: o <h3> do cartão ${String(indice)} está vazio`).toBeDefined();
      grandes.push(primeira?.texto ?? "");
    }

    expect(
      new Set(grandes).size,
      `as datas grandes foram ${JSON.stringify(grandes)} — duas iguais tornam dois ` +
        "cartões da mesma noite indistinguíveis (7.3)",
    ).toBe(grandes.length);
  });

  /**
   * **Prova:** a escada tipográfica de 4.2, no browser e em píxeis.
   *
   * A data é a coisa maior do cartão, maior do que o nome do evento — é o
   * que responde à única pergunta que se faz a uma lista de eventos num bar
   * (1, ponto 2). E o nome **não** é Bricolage: dois títulos na mesma letra
   * a 13 px de distância competem um com o outro (4.2). R-01 / ADR 0023: a
   * Playfair saiu, e a letra dos títulos passou a ser a Bricolage Grotesque.
   *
   * As três linhas vivem dentro do mesmo `<h3>` (4.3), e isso também se
   * afirma aqui: com o `<h3>` a conter só o nome, quem salta de cabeçalho
   * em cabeçalho ouvia "Noite de samba" e não ouvia a data.
   *
   * **O que deixa passar:** os números exactos da tabela de 4.2 (34, 14 e
   * 21 px) e os contrastes. Os primeiros são a escala do Tailwind e têm o
   * seu teste; os segundos medem-se nas capturas de 12.4.
   */
  test("dentro do `<h3>`: a data é maior do que o nome, e o nome não é Bricolage", async ({
    page,
  }) => {
    await abrirComFixtura(page, TRES_EVENTOS);

    const linhas = await lerOCabecalhoDoCartao(cartoesDeEvento(page).first());
    expect(linhas, "guarda: não encontrei o <h3> do primeiro cartão").not.toBeNull();
    expect(
      linhas?.length,
      "o cabeçalho do cartão tem três linhas: a data, o dia e a hora, e o nome (4.3)",
    ).toBe(3);

    const data = linhas?.[0];
    const hora = linhas?.[1];
    const nome = linhas?.[2];
    expect(data, "guarda: a linha da data").toBeDefined();
    expect(hora, "guarda: a linha da hora").toBeDefined();
    expect(nome, "guarda: a linha do nome").toBeDefined();
    if (data === undefined || hora === undefined || nome === undefined) return;

    expect(nome.texto, "a terceira linha do cabeçalho é o nome do evento").toBe(
      SAMBA_A_TRES_DIAS.titulo,
    );

    expect(
      data.tamanho,
      `a data mediu ${String(data.tamanho)} px e o nome ${String(nome.tamanho)} px: a data ` +
        "tem de ser a coisa maior do cartão (4.2)",
    ).toBeGreaterThan(nome.tamanho);
    expect(
      nome.tamanho,
      "o nome do evento é maior do que a linha do dia e da hora (4.2)",
    ).toBeGreaterThan(hora.tamanho);

    // R-01 / ADR 0023: a letra dos títulos passou da Playfair para a
    // Bricolage Grotesque. A data é título (`font-titulo`); o nome é texto.
    expect(
      data.familia,
      `a data saiu em «${data.familia}»: é a letra dos títulos, como o \`<h2>\` da ` +
        "secção, e tem de ser a Bricolage Grotesque",
    ).toMatch(/bricolage/i);
    expect(
      nome.familia,
      `a data e o nome saíram os dois em «${nome.familia}»: duas Bricolages no mesmo ` +
        "cartão competem (4.2)",
    ).not.toMatch(/bricolage/i);
  });
});

test.describe("o cartaz: o que se serve e o que se lê (6.2, 6.4)", () => {
  /**
   * **Prova:** a caixa de 324 × 216, a imagem a preenchê-la, e o `alt`.
   *
   * O `alt` é o **título do evento** e não "Cartaz de …": "cartaz" nomeia o
   * objeto em vez de nomear a coisa, e quem o ouve fica a saber que há uma
   * imagem e continua sem saber de quê (6.4).
   *
   * Os números medem-se com o guarda do `/media/` ligado. Em
   * desenvolvimento quem serve essa pasta é um middleware do
   * `vite.config.ts`, e quando ele recusa um ficheiro o Vite **não**
   * devolve 404: devolve o `index.html` com 200. Sem olhar para o tipo de
   * conteúdo, este teste media uma caixa com uma página de HTML lá dentro e
   * dava-a por boa.
   *
   * **O que deixa passar:** o que o `cover` corta de um cartaz a sério. A
   * caixa é 3:2 porque os cartazes do bar são **horizontais** — o Tomás
   * respondeu-o a 2026-11-02 e é o que `--cartaz-proporcao` cita —, por
   * isso o corte é de margem e pouco mais; quanto exactamente, mede-se numa
   * captura com um cartaz do bar à frente, e não aqui.
   */
  test("o `alt` é o título do evento, e a caixa mede 324 × 216 a 390 px", async ({ page }) => {
    const servidas = observarOMedia(page);
    await abrirComFixtura(page, UM_EVENTO);

    const imagem = seccaoDosEventos(page).getByRole("img");
    await expect(imagem, "o evento da fixtura tem cartaz").toHaveCount(1);
    await expect(imagem).toHaveJSProperty("complete", true, { timeout: 10_000 });
    exigirCartazServido(servidas);

    await expect(
      imagem,
      "o `alt` nomeia a coisa e não o objeto: é o título do evento (6.4)",
    ).toHaveAttribute("alt", SAMBA_A_TRES_DIAS.titulo);
    await expect(
      imagem,
      "três imagens que não se pedem são três pedidos que não se fazem numa ligação " +
        "de dados móveis (6.2)",
    ).toHaveAttribute("loading", "lazy");

    const caixa = await caixaDe(caixasDoCartaz(page).first(), "a caixa do cartaz");
    expect(Math.round(caixa.width), "a 390 px o interior do cartão são 324 (10)").toBe(324);
    expect(Math.round(caixa.height), "324 px a 3:2 são 216 (6.2)").toBe(216);

    /*
     * **A imagem mede dois píxeis menos do que a caixa, em cada eixo** — e
     * isso é a medida certa, não uma folga.
     *
     * Os 324 × 216 são a **caixa**, que é o que a `aspect-ratio` mede
     * (`border-box`). A caixa tem o fio de 1 px de cada lado, por isso o
     * `<img>` lá dentro fica em 322 × 214 e a proporção dele é 1,5047 e não
     * 1,5. Escrito com a subtração à vista para a próxima correção não ser
     * outra vez de dois píxeis: quem mudar a espessura do fio vê aqui o
     * número que tem de mudar.
     */
    const FIO = 1;
    const dentro = await caixaDe(imagem, "a imagem dentro da caixa");
    expect(
      Math.abs(dentro.width - (caixa.width - 2 * FIO)),
      `a imagem mediu ${String(Math.round(dentro.width))} px dentro de uma caixa de ` +
        `${String(Math.round(caixa.width))}: tem de preencher o interior todo (\`cover\`, 6.2)`,
    ).toBeLessThanOrEqual(PIXEL);
    expect(
      Math.abs(dentro.height - (caixa.height - 2 * FIO)),
      `a imagem mediu ${String(Math.round(dentro.height))} px de altura dentro de uma ` +
        `caixa de ${String(Math.round(caixa.height))}`,
    ).toBeLessThanOrEqual(PIXEL);
  });
});

test.describe("a linha dos excedentes (7.2)", () => {
  /**
   * **Prova:** a linha aparece **só** quando a resposta traz mais de três.
   *
   * As duas metades na mesma corrida, e é essa a razão de ser do teste: uma
   * linha que apareça sempre passa na metade de cima e mente com exactamente
   * três cartões; uma linha que nunca apareça passa na de baixo e esconde
   * que o site cortou alguma coisa que acabou de receber.
   *
   * Afirma-se também que a frase **não é uma ligação nem um botão**: não há
   * ecrã público de eventos neste projeto e não há para onde mandar
   * ninguém (7.2). É a mesma asserção que mantém a secção com zero paragens
   * de `Tab` no caminho normal (2.2).
   *
   * **O que deixa passar:** quantos eventos ficaram de fora. A frase não
   * conta — de propósito — e por isso não há aqui número nenhum para
   * comparar.
   */
  test("com três não aparece; com quatro aparece, por baixo da lista", async ({ page }) => {
    await abrirComFixtura(page, TRES_EVENTOS);

    await expect(cartoesDeEvento(page), "guarda: exactamente três cartões").toHaveCount(3);
    await expect(
      seccaoDosEventos(page).getByText(TEXTOS_DOS_EVENTOS.maisEventos),
      "com exactamente três não há nada a mais para anunciar (7.2)",
    ).toHaveCount(0);

    await page.unroute(ROTA_DOS_EVENTOS);
    await fingirEventosFixos(page, QUATRO_EVENTOS);
    await page.goto("/");

    await expect(cartoesDeEvento(page), "o corte é nos três mais próximos (7.1)").toHaveCount(3);

    const linha = seccaoDosEventos(page).getByText(TEXTOS_DOS_EVENTOS.maisEventos);
    await expect(linha, "com quatro, quem lê fica a saber que há mais (13)").toBeVisible();

    const medidaDaLinha = await caixaDe(linha, "a linha dos excedentes");
    const ultimoCartao = await caixaDe(cartoesDeEvento(page).last(), "o último cartão");
    expect(
      medidaDaLinha.y,
      "a linha vem por baixo da lista, não no meio dela (3)",
    ).toBeGreaterThanOrEqual(ultimoCartao.y + ultimoCartao.height - PIXEL);

    await expect(
      seccaoDosEventos(page).getByRole("link"),
      "não é uma ligação: não há ecrã público de eventos para onde mandar ninguém (7.2)",
    ).toHaveCount(0);
    await expect(
      seccaoDosEventos(page).getByRole("button"),
      "e não é um botão. Nada nesta secção é tocável no caminho normal (1, ponto 4)",
    ).toHaveCount(0);
  });
});

test.describe("o tom do erro e o dourado (8.2, 13)", () => {
  /**
   * **Prova:** o erro está pintado com `--cor-erro`, e **nenhuma** cor
   * desta secção é o dourado.
   *
   * São as duas metades de uma decisão só. O `EstadoVazio` em `tom="erro"`
   * distingue-se do neutro por uma coisa: o título a `--cor-erro`. E o
   * "Tentar outra vez" é **secundário** porque o dourado da página pública
   * está gasto no "WiFi" do cabeçalho (F3-03, 6.1) e esta não é a ação
   * principal de ecrã nenhum — um segundo botão dourado na mesma página
   * punha dois primeiros lugares à vista ao mesmo tempo.
   *
   * O terceiro bloco é o guarda, e sem ele o segundo não prova nada: se o
   * token tivesse deixado de ser dourado, "não há dourado nos eventos" era
   * verdade por uma razão que não tem nada a ver com esta secção. Por isso
   * exige-se que o dourado **exista** nesta página, e que esteja no WiFi.
   *
   * **O que deixa passar:** o anel de foco, que é dourado e é o único que
   * aqui pode ser (13) — não entra na varredura porque esta não lê
   * `outline`, e porque nada está focado quando ela corre.
   */
  test("o erro é `--cor-erro` e o dourado desta página fica todo no WiFi", async ({ page }) => {
    await prenderORelogio(page);
    await fingirInfoFixo(page);
    await fingirEmentaFixa(page);
    await fingirOsEventos(page, () => ({ tipo: "falha" }));
    await page.goto("/");
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();

    const corDeErro = await corDoToken(page, "--cor-erro");
    const corDeAcao = await corDoToken(page, "--cor-acao");

    const noTitulo = await seccaoDosEventos(page)
      .getByText(TEXTOS_DOS_EVENTOS.erroTitulo)
      .evaluate((elemento) => getComputedStyle(elemento).color);
    expect(
      aMesmaCor(noTitulo, corDeErro),
      `o título do erro ficou pintado a «${noTitulo}», e não a «--cor-erro». Sem o ` +
        "tom de erro, «não há eventos» e «não consegui perguntar» voltam a " +
        "desenhar-se igual (8.2).",
    ).toBe(true);

    const cores = await seccaoDosEventos(page)
      .locator("*")
      .evaluateAll((elementos) =>
        elementos.flatMap((elemento) => {
          const estilo = getComputedStyle(elemento);
          const lidas = [estilo.color, estilo.backgroundColor];
          for (const lado of ["top", "right", "bottom", "left"]) {
            const largura = Number.parseFloat(estilo.getPropertyValue(`border-${lado}-width`));
            // Só as arestas que existem: um `border-style: none` continua a
            // ter uma cor computada, e contá-la era acusar uma peça que
            // ninguém vê.
            if (Number.isFinite(largura) && largura > 0) {
              lidas.push(estilo.getPropertyValue(`border-${lado}-color`));
            }
          }
          return lidas;
        }),
      );

    expect(
      cores.length,
      "guarda: não li cor nenhuma dentro da secção dos eventos — a varredura não " +
        "andou, e «não encontrei dourado» não pode querer dizer «não procurei»",
    ).toBeGreaterThan(0);
    expect(
      cores.filter((cor) => aMesmaCor(cor, corDeAcao)),
      "o dourado da página pública está gasto no «WiFi» (F3-03, 6.1); aqui o único " +
        "dourado que pode haver é o anel de foco (13)",
    ).toEqual([]);

    const noWifi = await botaoDoWifi(page).evaluate(
      (elemento) => getComputedStyle(elemento).backgroundColor,
    );
    expect(
      aMesmaCor(noWifi, corDeAcao),
      `guarda: o botão «${TEXTOS_DO_WIFI.wifi}» ficou a «${noWifi}» e não a ` +
        "`--cor-acao`. Sem isto, a asserção de cima passava com o token a apontar " +
        "para outra cor qualquer e não provava nada sobre esta secção.",
    ).toBe(true);
  });
});

/**
 * Os dias e os meses em inglês, que é o que um ICU reduzido escreve.
 *
 * Escritos aqui e não derivados do `Intl`: derivá-los do `Intl` do Node era
 * pedir a lista a quem a tem completa, e o defeito que isto procura é
 * precisamente o de um aparelho que a tem a meio.
 */
const EM_INGLES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test.describe("a tabela dos dias e dos meses é nossa (5.4)", () => {
  test("nenhuma data aparece em inglês, e a secção foi mesmo lida", async ({ page }) => {
    // **O defeito que nem o CI nem o `textos-pt-pt.test.ts` apanham**: um
    // aparelho com ICU reduzido devolve "Thursday" no meio de uma página em
    // português, e a palavra inglesa não está escrita em ficheiro nenhum
    // nosso (5.4). O Node e o Chromium do CI têm ICU completo, por isso o
    // que este teste prende é o **mecanismo**: a tabela tem de ser nossa.
    //
    // O guarda é a outra metade: se a secção estivesse vazia, "não há
    // inglês" era verdade e não queria dizer nada.
    await abrirComFixtura(page, TRES_EVENTOS);

    const texto = (await seccaoDosEventos(page).textContent()) ?? "";

    const portuguesas = [...DIAS_ESPERADOS, ...MESES_ESPERADOS].filter((palavra) =>
      texto.toLowerCase().includes(palavra),
    );
    expect(
      portuguesas.length,
      "guarda: não encontrei um único nome de dia ou de mês em português na secção. " +
        "Sem isso, «não encontrei inglês» é uma frase sobre um ecrã vazio.",
    ).toBeGreaterThan(0);

    expect(
      EM_INGLES.filter((palavra) => texto.includes(palavra)),
      "há nomes de dia ou de mês em inglês no ecrã: a tabela de 5.4 não está a ser " +
        "usada, e o browser está a formatar a data por conta própria",
    ).toEqual([]);
  });
});

test.describe("cor: o cartão não é creme e o dourado está gasto (4.1, 13)", () => {
  test("nada na secção é dourado nem creme, e a medição sabe reconhecer os dois", async ({
    page,
  }) => {
    // Dois critérios de 13 numa corrida, porque partilham a medição:
    //
    //  - "a ementa continua a ser o objeto mais forte da página": os
    //    cartões de evento não são creme, senão competem com a carta (4.1);
    //  - "o único dourado desta secção é o anel de foco": o dourado da
    //    página pública está gasto no WiFi do cabeçalho (F3-03, 6.1).
    //
    // **O guarda é o botão do WiFi.** Sem ele, uma comparação de cores que
    // deixasse de condizer — um `rgb()` que virasse `color(srgb …)`, um
    // token renomeado — devolvia zero ocorrências de dourado e passava a
    // dizer que a secção está limpa. "Não consegui comparar" não pode valer
    // "não encontrei".
    await abrirComFixtura(page, TRES_EVENTOS);

    const dourado = await corDoToken(page, "--cor-acao");
    const creme = await corDoToken(page, "--cor-creme-papel");

    const fundoDoWifi = await botaoDoWifi(page).evaluate(
      (elemento) => getComputedStyle(elemento).backgroundColor,
    );
    expect(
      aMesmaCor(fundoDoWifi, dourado),
      `guarda: o botão do WiFi devia ser dourado e mediu «${fundoDoWifi}». Se não ` +
        "reconheço o dourado onde ele está, não posso afirmar que não está nos eventos.",
    ).toBe(true);

    const pintados = await seccaoDosEventos(page).evaluate((seccao) =>
      [seccao, ...seccao.querySelectorAll("*")].map((elemento) => {
        const estilo = getComputedStyle(elemento);
        return {
          marca: `${elemento.tagName.toLowerCase()}.${elemento.getAttribute("class") ?? ""}`,
          fundo: estilo.backgroundColor,
          texto: estilo.color,
          fio: estilo.borderTopColor,
        };
      }),
    );

    expect(pintados.length, "guarda: a secção não tinha elementos para medir").toBeGreaterThan(3);

    expect(
      pintados
        .filter(
          (pintado) =>
            aMesmaCor(pintado.fundo, dourado) ||
            aMesmaCor(pintado.texto, dourado) ||
            aMesmaCor(pintado.fio, dourado),
        )
        .map((pintado) => pintado.marca),
      "o dourado desta secção é só o anel de foco, que é `outline` e não entra aqui. " +
        "Um fio dourado, uma data dourada ou um botão principal são a ação principal " +
        "de um ecrã a ser prometida onde não há ação nenhuma (13)",
    ).toEqual([]);

    expect(
      pintados.filter((pintado) => aMesmaCor(pintado.fundo, creme)).map((pintado) => pintado.marca),
      "nenhum cartão de evento é creme: o creme é da carta, e dois objetos creme na " +
        "mesma página são dois objetos a disputar a mesma atenção (4.1)",
    ).toEqual([]);
  });
});
