import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SETE_FOTOS, TEXTOS_DA_GALERIA, UMA_FOTO } from "../src/testes/galeria";
import {
  botaoDeEnviarFoto,
  botaoEnviarUmaFoto,
  campoDeFoto,
  dialogoAberto,
  extrairParteDoMultipart,
  fingirAGaleria,
  fingirOEnvioDeFotos,
  fotosDaGrelha,
  gerarImagemNaPagina,
  heicMinimo,
  jpegComOrientacao6,
  lerDimensoesDoJpeg,
  seccaoDaGaleria,
} from "./apoio/galeria";

/**
 * F3-05, secção 16.5 — o que só um browser a sério prova.
 *
 * **O "Feito quando" da tarefa, ao vivo**: enviar uma foto e ver "A tua
 * foto aparece depois de aprovada." As duas rotas (`GET /api/galeria`,
 * `POST /api/fotos`) estão sempre fingidas com `page.route` — o que se
 * prova aqui é o que o **browser** faz antes do pedido sair: a redução de
 * imagem a sério (`createImageBitmap`, `<canvas>`), a fronteira do
 * multipart que só ele sabe escrever, e o gesto de deslizar do
 * Visualizador.
 *
 * **Deixa passar:** o backend a sério (nunca é tocado); a decodificação
 * real de HEIC fora do WebKit — o CI corre em Chromium e Firefox também,
 * e o ponto 2 só é determinístico se o decodificador escolhido pela
 * implementação funcionar nesses dois motores (é uma condição a confirmar
 * quando a implementação escolher a biblioteca de conversão, F3-05, 16.5).
 */

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

test.describe("o caminho que o Feito quando pede", () => {
  test("escolher uma foto, preencher legenda e nome, e ver a frase-promessa antes e depois", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await expect(seccaoDaGaleria(page)).toBeVisible();
    await botaoEnviarUmaFoto(page).click();

    const folha = dialogoAberto(page);
    await expect(folha).toBeVisible();
    await expect(
      folha.getByText(TEXTOS_DA_GALERIA.promessa),
      "a promessa tem de estar visível ANTES de qualquer campo preenchido (6.2)",
    ).toBeVisible();

    const imagem = await gerarImagemNaPagina(page, { largura: 3000, altura: 2000 });
    await campoDeFoto(page).setInputFiles({
      name: "foto-grande.jpg",
      mimeType: "image/jpeg",
      buffer: imagem,
    });

    // A pré-visualização chega antes da redução acabar (6.4) — esperamos
    // é que "Enviar foto" fique disponível, que é o sinal de que a
    // redução (fingida como `reduzir()`, aqui a sério num browser) acabou.
    await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });

    await folha
      .getByLabel(TEXTOS_DA_GALERIA.campoLegenda, { exact: false })
      .fill("Uma noite cheia.");
    await folha.getByLabel(TEXTOS_DA_GALERIA.campoNome, { exact: false }).fill("Cliente de teste");

    await botaoDeEnviarFoto(page).click();

    await expect(folha.getByText(TEXTOS_DA_GALERIA.sucessoTitulo)).toBeVisible();
    await expect(
      folha.getByText(TEXTOS_DA_GALERIA.promessa),
      "a mesma frase continua visível depois do envio — não muda, não desaparece (6.2)",
    ).toBeVisible();

    expect(pedidos, "guarda: o pedido tem de ter mesmo partido").toHaveLength(1);
  });
});

test.describe("o Enter dentro de 'O teu nome' submete o <form> a sério (6.3)", () => {
  // Só um browser a sério prova isto: o jsdom não implementa a submissão
  // implícita do HTML (o `Enter` num campo de texto a disparar `submit`
  // sozinho) — um `fireEvent.keyDown` em Vitest não a exercita. É também
  // aqui, e só aqui, que se prova que "Enviar foto" tem de verdade um
  // botão de submissão: sem ele, a implicit submission mechanism da
  // especificação do HTML não tem para onde ir, e o `Enter` não faz nada.
  // Correção ui-ux, 6 de novembro de 2026 (docs/ecras/F3-05.md, 6.4/6.5):
  // sem ficheiro escolhido, "Enviar foto" já não fica `aria-disabled` — é
  // o único dos quatro estados sem explicação nenhuma já visível no ecrã.
  // Os dois testes a seguir provam, num Chromium a sério, que os dois
  // caminhos (clique directo, e o `Enter` que dispara a submissão
  // implícita do HTML) chegam agora a "Escolhe uma foto para enviar.".
  test("sem ficheiro escolhido: um clique directo mostra 'Escolhe uma foto para enviar.'", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const folha = dialogoAberto(page);

    await expect(
      botaoDeEnviarFoto(page),
      "nenhum ficheiro escolhido ainda: o botão tem de ficar utilizável",
    ).not.toHaveAttribute("aria-disabled", "true");

    await botaoDeEnviarFoto(page).click();

    await expect(folha.getByText(TEXTOS_DA_GALERIA.semEscolha)).toBeVisible();
    await page.waitForTimeout(200);
    expect(pedidos, "sem ficheiro pronto, nenhum pedido pode partir").toHaveLength(0);
  });

  test("sem ficheiro escolhido: o Enter dentro de 'O teu nome' também mostra a frase", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const folha = dialogoAberto(page);
    await folha.getByLabel(TEXTOS_DA_GALERIA.campoNome, { exact: false }).fill("Alguém");
    await folha.getByLabel(TEXTOS_DA_GALERIA.campoNome, { exact: false }).press("Enter");

    await expect(folha.getByText(TEXTOS_DA_GALERIA.semEscolha)).toBeVisible();
    await page.waitForTimeout(200);
    expect(pedidos, "sem ficheiro pronto, nenhum pedido pode partir, nem por Enter").toHaveLength(
      0,
    );
  });

  test("com uma foto pronta: envia sem carregar em «Enviar foto»", async ({ page }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const folha = dialogoAberto(page);

    const imagem = await gerarImagemNaPagina(page, { largura: 800, altura: 600 });
    await campoDeFoto(page).setInputFiles({
      name: "foto.jpg",
      mimeType: "image/jpeg",
      buffer: imagem,
    });
    await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });

    const campoNome = folha.getByLabel(TEXTOS_DA_GALERIA.campoNome, { exact: false });
    await campoNome.fill("Cliente de teste");
    await campoNome.press("Enter");

    await expect(folha.getByText(TEXTOS_DA_GALERIA.sucessoTitulo)).toBeVisible();
    expect(
      pedidos,
      "o Enter tem de ter disparado o mesmo pedido que o clique dispararia",
    ).toHaveLength(1);
  });

  test("o campo-isco está mesmo escondido visualmente (display:none, onde o Tailwind está aplicado)", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const folha = dialogoAberto(page);
    const campoIsco = folha.locator('input[name="website"]');

    await expect(
      campoIsco,
      "o Vitest/jsdom prende a classe `hidden`; só um browser a sério prova que ela " +
        "pinta mesmo `display:none`",
    ).toBeHidden();
  });
});

test.describe("o pedido ao servidor: só se prova num browser a sério", () => {
  test("method POST, X-Tomazia: 1, e Content-Type com a fronteira do multipart", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const imagem = await gerarImagemNaPagina(page, { largura: 800, altura: 600 });
    await campoDeFoto(page).setInputFiles({
      name: "foto.jpg",
      mimeType: "image/jpeg",
      buffer: imagem,
    });
    await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });

    const [pedido] = await Promise.all([
      page.waitForRequest((requisicao) => requisicao.url().includes("/api/fotos")),
      botaoDeEnviarFoto(page).click(),
    ]);

    expect(pedido.method()).toBe("POST");
    expect(pedido.headers()["x-tomazia"]).toBe("1");
    expect(
      pedido.headers()["content-type"],
      "a fronteira só o browser sabe escrever — isto só se prova aqui, nunca com um fetch fingido",
    ).toMatch(/^multipart\/form-data; boundary=.+/);

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.metodo).toBe("POST");
  });
});

test.describe("a redução no browser: um HEIC nunca chega ao servidor como HEIC (7.1)", () => {
  /**
   * A regra que interessa garantir é **"um HEIC nunca chega ao servidor
   * como HEIC"** — e há dois desfechos correctos para a cumprir, não um:
   *
   *  - **no WebKit/Safari**, `createImageBitmap` descodifica o HEIC a
   *    sério, a redução converte-o, e o pedido parte com a parte do
   *    ficheiro em JPEG (7.1: "é o mesmo passo que faz o HEIC de um
   *    iPhone chegar ao backend como algo que o Pillow consegue abrir");
   *  - **no Chromium** (e, hoje, no Firefox), `createImageBitmap` não
   *    decodifica HEIC de todo — e é aí que entra a decisão do Tomás de 6
   *    de novembro de 2026 (ADR 0018): a foto é recusada **localmente**,
   *    pelos bytes que `reduzir()` já examinou, **sem pedido nenhum**,
   *    precisamente para não gastar uma das cinco tentativas do balde
   *    contra um ficheiro que nunca teve hipótese de ser aceite.
   *
   * Os dois são comportamento desenhado, não um teste a passar por sorte
   * num motor e a falhar no outro. Um teste que só aceitasse o primeiro
   * desfecho ficaria vermelho, permanentemente, em qualquer motor que
   * cumprisse a segunda metade da regra — que é precisamente o que esta
   * tarefa decidiu fazer, e o que o CI (F3-07) vai correr em Chromium.
   *
   * Por isso este teste não escolhe um dos dois caminhos a priori: espera
   * por **qualquer um dos dois sinais que vier primeiro** — o botão a
   * ficar pronto (o caminho da conversão), ou a frase de falha local a
   * aparecer (o caminho da recusa, nunca com um pedido a sair) — com um
   * prazo curto, porque os dois desfechos são rápidos de propósito: a
   * decodificação de um HEIC mínimo no WebKit não demora, e a recusa local
   * no Chromium é uma rejeição síncrona de `createImageBitmap`, não uma
   * espera por rede nenhuma.
   */
  test("escolher um ficheiro .heic: ou converte e envia como JPEG, ou recusa localmente sem pedido", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const folha = dialogoAberto(page);
    await campoDeFoto(page).setInputFiles({
      name: "foto-do-iphone.heic",
      mimeType: "image/heic",
      buffer: heicMinimo(),
    });

    const PRAZO_MS = 5_000;
    const desfecho = await Promise.race([
      expect(botaoDeEnviarFoto(page))
        .not.toHaveAttribute("aria-disabled", "true", { timeout: PRAZO_MS })
        .then(() => "convertido" as const)
        .catch(() => null),
      folha
        .getByText(TEXTOS_DA_GALERIA.falhaAPreparar)
        .waitFor({ state: "visible", timeout: PRAZO_MS })
        .then(() => "recusado" as const)
        .catch(() => null),
    ]);

    if (desfecho === "convertido") {
      await botaoDeEnviarFoto(page).click();
      await expect.poll(() => pedidos.length, { timeout: 15_000 }).toBeGreaterThan(0);

      const pedido = pedidos[0];
      expect(pedido, "guarda: o envio tem de ter partido").toBeDefined();
      if (pedido === undefined) return;

      const parte = extrairParteDoMultipart(pedido.corpo, pedido.contentType, "ficheiro");
      expect(parte, "guarda: não encontrei a parte «ficheiro» no multipart").not.toBeNull();
      if (parte === null) return;

      expect(
        parte.cabecalho.toLowerCase(),
        "um HEIC em bruto não é um dos três formatos que o backend aceita — se isto ainda " +
          "disser image/heic, a conversão não aconteceu e o Pillow recusaria com 400",
      ).not.toContain("image/heic");
      expect(
        [parte.dados[0], parte.dados[1]],
        "a saída de reduzir() é sempre JPEG (FF D8 no início) — nunca o HEIC original",
      ).toEqual([0xff, 0xd8]);
      return;
    }

    if (desfecho === "recusado") {
      await expect(folha.getByText(TEXTOS_DA_GALERIA.falhaAPreparar)).toBeVisible();
      expect(
        pedidos,
        "a recusa local existe precisamente para não gastar uma tentativa (ADR 0018) — " +
          "nenhum pedido pode ter partido",
      ).toHaveLength(0);
      return;
    }

    throw new Error(
      "Nem o botão ficou pronto nem a Folha mostrou a frase de falha local dentro do prazo " +
        "— isto não é nenhum dos dois desfechos correctos que esta tarefa prevê. Parar e " +
        "investigar, não assumir nenhum dos dois.",
    );
  });
});

test.describe("a redução no browser: o lado maior nunca ultrapassa 2000 px (7.1)", () => {
  test("uma foto de 3000x2000 chega ao servidor com o lado maior em 2000", async ({ page }) => {
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const imagemGrande = await gerarImagemNaPagina(page, { largura: 3000, altura: 2000 });
    await campoDeFoto(page).setInputFiles({
      name: "foto-grande.jpg",
      mimeType: "image/jpeg",
      buffer: imagemGrande,
    });
    await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });

    await botaoDeEnviarFoto(page).click();
    await expect.poll(() => pedidos.length, { timeout: 15_000 }).toBeGreaterThan(0);

    const pedido = pedidos[0];
    expect(pedido).toBeDefined();
    if (pedido === undefined) return;

    const parte = extrairParteDoMultipart(pedido.corpo, pedido.contentType, "ficheiro");
    expect(parte).not.toBeNull();
    if (parte === null) return;

    const dimensoes = lerDimensoesDoJpeg(parte.dados);
    expect(
      dimensoes,
      "guarda: não consegui ler as dimensões do ficheiro enviado — se a implementação " +
        "codificar para WebP ou PNG em vez de JPEG, este leitor de marcadores SOF tem de mudar",
    ).not.toBeNull();
    if (dimensoes === null) return;

    expect(
      Math.max(dimensoes.largura, dimensoes.altura),
      `o ficheiro enviado mediu ${String(dimensoes.largura)}×${String(dimensoes.altura)}`,
    ).toBeLessThanOrEqual(2000);
  });
});

test.describe("a redução no browser: a orientação EXIF é aplicada aos píxeis (7.1)", () => {
  test("uma foto com Orientation=6 chega ao servidor em retrato, não em paisagem", async ({
    page,
  }) => {
    // A fixtura: fisicamente 2024×1012 (paisagem), com a etiqueta EXIF
    // Orientation=6. O <canvas> deita o EXIF fora; se `reduzir()` não
    // chamar `createImageBitmap` com `{ imageOrientation: "from-image" }`,
    // a foto chega ao servidor deitada — e o backend já não tem etiqueta
    // nenhuma para a corrigir (nenhum PNG sintético prova isto, só um
    // JPEG real com EXIF a sério).
    await fingirAGaleria(page, UMA_FOTO);
    const pedidos = await fingirOEnvioDeFotos(page);
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    await campoDeFoto(page).setInputFiles({
      name: "retrato-rodado.jpg",
      mimeType: "image/jpeg",
      buffer: jpegComOrientacao6(),
    });
    await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });

    await botaoDeEnviarFoto(page).click();
    await expect.poll(() => pedidos.length, { timeout: 15_000 }).toBeGreaterThan(0);

    const pedido = pedidos[0];
    expect(pedido).toBeDefined();
    if (pedido === undefined) return;

    const parte = extrairParteDoMultipart(pedido.corpo, pedido.contentType, "ficheiro");
    expect(parte).not.toBeNull();
    if (parte === null) return;

    const dimensoes = lerDimensoesDoJpeg(parte.dados);
    expect(dimensoes, "guarda: não consegui ler as dimensões do ficheiro enviado").not.toBeNull();
    if (dimensoes === null) return;

    expect(
      dimensoes.altura,
      `o ficheiro enviado mediu ${String(dimensoes.largura)}×${String(dimensoes.altura)} — ` +
        "a fixtura é fisicamente paisagem (2024×1012) com Orientation=6; se a saída continuar " +
        "em paisagem, o EXIF não foi aplicado antes de desenhar no <canvas>",
    ).toBeGreaterThan(dimensoes.largura);
  });
});

test.describe("o Visualizador, num browser a sério", () => {
  test("tocar numa foto abre o Visualizador, ArrowRight avança, Esc fecha e devolve o foco", async ({
    page,
  }) => {
    await fingirAGaleria(page, SETE_FOTOS);
    await page.goto("/");
    await expect(seccaoDaGaleria(page)).toBeVisible();

    const primeiraFoto = fotosDaGrelha(page).first().getByRole("button");
    await primeiraFoto.click();

    const visualizador = dialogoAberto(page);
    await expect(visualizador).toBeVisible();
    await expect(visualizador.getByRole("status")).toContainText("1");

    await page.keyboard.press("ArrowRight");
    await expect(visualizador.getByRole("status")).toContainText("2");

    await page.keyboard.press("Escape");
    await expect(visualizador).toBeHidden();

    await expect(
      primeiraFoto,
      "ao fechar, o foco volta ao botão da grelha que abriu o Visualizador (5.2)",
    ).toBeFocused();
  });

  test("um gesto de arrastar na foto também navega", async ({ page }) => {
    await fingirAGaleria(page, SETE_FOTOS);
    await page.goto("/");

    await fotosDaGrelha(page).first().getByRole("button").click();
    const visualizador = dialogoAberto(page);
    await expect(visualizador).toBeVisible();
    await expect(visualizador.getByRole("status")).toContainText("1");

    // A caixa é a da **foto em si**, não a do diálogo inteiro: num media
    // de teste que não exista a sério (as fixturas de `src/testes/galeria.ts`
    // não apontam para ficheiros reais em `media/`), a imagem partida pode
    // ocupar muito menos espaço do que o ecrã inteiro — e um gesto calculado
    // contra a caixa do diálogo cairia fora dela, em silêncio.
    const caixa = await visualizador.getByRole("img").boundingBox();
    expect(caixa, "não consegui medir a foto para o gesto de deslizar").not.toBeNull();
    if (caixa === null) return;

    const y = caixa.y + caixa.height / 2;
    // Com `isMobile`/`hasTouch` ligados (playwright.config.ts), o Chromium
    // traduz estes eventos de rato em eventos de toque — é a forma
    // recomendada de simular um deslize sem construir `TouchEvent` à mão.
    await page.mouse.move(caixa.x + caixa.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(caixa.x + caixa.width * 0.2, y, { steps: 10 });
    await page.mouse.up();

    await expect(visualizador.getByRole("status")).toContainText("2");
  });
});

test.describe("o 429", () => {
  test("segundos_em_falta e Retry-After: a frase composta, e o botão desactivado", async ({
    page,
  }) => {
    await fingirAGaleria(page, UMA_FOTO);
    await fingirOEnvioDeFotos(page, () => ({
      tipo: "erro",
      estado: 429,
      corpo: {
        erro: "limite_de_envios_excedido",
        mensagem: "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco.",
        segundos_em_falta: 125,
      },
      cabecalhos: { "Retry-After": "125" },
    }));
    await page.goto("/");

    await botaoEnviarUmaFoto(page).click();
    const imagem = await gerarImagemNaPagina(page, { largura: 400, altura: 300 });
    await campoDeFoto(page).setInputFiles({
      name: "foto.jpg",
      mimeType: "image/jpeg",
      buffer: imagem,
    });
    await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });

    await botaoDeEnviarFoto(page).click();

    await expect(
      dialogoAberto(page).getByText("Podes tentar outra vez daqui a 3 minutos."),
    ).toBeVisible();
    await expect(botaoDeEnviarFoto(page)).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("Q-03: o axe, nos três estados que o <dialog> fechado esconde", () => {
  test("a grelha (vazia)", async ({ page }) => {
    await fingirAGaleria(page, { fotos: [] });
    await page.goto("/");
    await expect(seccaoDaGaleria(page)).toBeVisible();

    await semViolacoesGraves(page, "galeria vazia");
  });

  test("o Visualizador aberto", async ({ page }) => {
    await fingirAGaleria(page, UMA_FOTO);
    await page.goto("/");
    await fotosDaGrelha(page).first().getByRole("button").click();
    await expect(dialogoAberto(page)).toBeVisible();

    await semViolacoesGraves(page, "Visualizador aberto");
  });

  test("a Folha de envio aberta", async ({ page }) => {
    await fingirAGaleria(page, UMA_FOTO);
    await page.goto("/");
    await botaoEnviarUmaFoto(page).click();
    await expect(dialogoAberto(page)).toBeVisible();

    await semViolacoesGraves(page, "Folha de envio aberta");
  });
});
