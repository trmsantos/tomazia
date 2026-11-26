import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { LINHAS_DO_MOMENTO } from "../src/testes/visita-nos";
import {
  INSTAGRAM_DE_TESTE,
  MAPS_DE_TESTE,
  infoCom,
  infoCompleta,
  infoVazia,
} from "../src/testes/visita-nos";
import { focarPorTeclado } from "./apoio/foco";
import {
  MOMENTOS,
  TEXTOS_DO_VISITA_NOS as T,
  aMesmaCor,
  abrirComVisitaNos,
  botaoDeTentarOutraVez,
  botaoDoMaps,
  caixaDe,
  corDoToken,
  ligacaoDoInstagram,
  ligacaoDoTelefone,
  linhaDeHoje,
  linhaDoMomento,
  seccaoDaVisita,
  tituloDaVisita,
} from "./apoio/visita-nos";

/**
 * F3-06a, 11 — o que só o browser prova.
 *
 * **O que este ficheiro prova:**
 *
 *  1. a secção está **depois** da galeria, medido em píxeis e não pela ordem
 *     no DOM;
 *  2. os alvos de 44 px (Maps, telefone, Instagram, «Tentar outra vez»), a
 *     ordem de `Tab` e o anel de foco dourado em cada um;
 *  3. nenhum dourado na secção fora do anel, e o destaque do dia a ser **peso**
 *     (600 contra 400);
 *  4. sem scroll horizontal a 360 e 390 px, com o texto aumentado, e a mesma
 *     coluna a 1024 px;
 *  5. o relógio: a linha muda sem interação (`page.clock`), e recalcula ao voltar
 *     ao ecrã;
 *  6. o axe, nos quatro estados;
 *  7. no pacote de produção, um só pedido ao `/info`.
 *
 * **O que deixa passar:** a rede a sério (o `route` nunca toca no backend) e a
 * CSP de produção a bloquear um `frame-src` — não há `<iframe>` na secção, e
 * isso prova-se no DOM (`VisitaNos.test.tsx`).
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

test.describe("onde a secção vive (2.1)", () => {
  test("o título está abaixo da galeria, medido", async ({ page }) => {
    await abrirComVisitaNos(page);
    await expect(tituloDaVisita(page)).toBeVisible();

    const galeria = await caixaDe(page.locator("section#galeria"), "a secção da galeria");
    const titulo = await caixaDe(tituloDaVisita(page), "o título «Visita-nos»");

    expect(
      titulo.y,
      "o título «Visita-nos» devia estar por baixo da galeria: um `order` ou um `position` " +
        "punha-o no sítio certo do HTML e no errado do ecrã",
    ).toBeGreaterThanOrEqual(galeria.y + galeria.height - 2);
  });

  test("a linha do momento é a primeira coisa do cartão: aparece antes da tabela", async ({
    page,
  }) => {
    await abrirComVisitaNos(page, undefined, MOMENTOS.ter23h00);
    await expect(linhaDoMomento(page)).toHaveText(LINHAS_DO_MOMENTO.ateAsDuas);

    const linha = await caixaDe(linhaDoMomento(page), "a linha do momento");
    const tabela = await caixaDe(
      seccaoDaVisita(page).getByRole("table", { name: T.legendaDaTabela }),
      "a tabela",
    );

    expect(linha.y).toBeLessThan(tabela.y);
  });
});

test.describe("alvos, ordem de Tab e foco (critério 8)", () => {
  test("as três ligações têm pelo menos 44 px de altura (Q-04)", async ({ page }) => {
    await abrirComVisitaNos(page);

    for (const [nome, alvo] of [
      ["Abrir no Google Maps", botaoDoMaps(page)],
      ["o telefone", ligacaoDoTelefone(page)],
      ["o Instagram", ligacaoDoInstagram(page)],
    ] as const) {
      await expect(alvo, `${nome} tem de existir com esta fixtura`).toHaveCount(1);
      const caixa = await caixaDe(alvo, nome);
      expect(caixa.height, `${nome}: altura`).toBeGreaterThanOrEqual(44);
    }

    // O botão do Maps é um botão: 44 px também de largura.
    expect((await caixaDe(botaoDoMaps(page), "o botão do Maps")).width).toBeGreaterThanOrEqual(44);
  });

  test("«Tentar outra vez» tem 44 × 44 px", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "estado", estado: 500 });
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();

    const caixa = await caixaDe(botaoDeTentarOutraVez(page), "«Tentar outra vez»");
    expect(caixa.height).toBeGreaterThanOrEqual(44);
    expect(caixa.width).toBeGreaterThanOrEqual(44);
  });

  test("Tab percorre Maps, telefone, Instagram e sai; Shift+Tab volta pela ordem inversa", async ({
    page,
  }) => {
    await abrirComVisitaNos(page);
    await expect(botaoDoMaps(page)).toBeVisible();

    await focarPorTeclado(page, botaoDoMaps(page));
    const ondeEstou = () =>
      page.evaluate(() => {
        const ativo = document.activeElement;
        return {
          href: ativo?.getAttribute("href") ?? null,
          naSeccao: ativo?.closest("#visita-nos") !== null && ativo !== document.body,
        };
      });

    expect((await ondeEstou()).href, "guarda: o foco devia estar no Maps").toBe(MAPS_DE_TESTE);

    await page.keyboard.press("Tab");
    expect((await ondeEstou()).href).toBe("tel:912345678");

    await page.keyboard.press("Tab");
    expect((await ondeEstou()).href).toBe(INSTAGRAM_DE_TESTE);

    await page.keyboard.press("Tab");
    expect((await ondeEstou()).naSeccao, "depois do Instagram o foco sai da secção").toBe(false);

    await page.keyboard.press("Shift+Tab");
    expect((await ondeEstou()).href).toBe(INSTAGRAM_DE_TESTE);
    await page.keyboard.press("Shift+Tab");
    expect((await ondeEstou()).href).toBe("tel:912345678");
  });

  test("a tabela não tem nada focável", async ({ page }) => {
    await abrirComVisitaNos(page);
    await expect(linhaDoMomento(page)).toBeVisible();

    await expect(
      seccaoDaVisita(page).locator("table a, table button, table [tabindex]"),
    ).toHaveCount(0);
  });

  test("cada controlo mostra o anel de foco dourado de 2 px, só por teclado", async ({ page }) => {
    await abrirComVisitaNos(page);
    await expect(botaoDoMaps(page)).toBeVisible();
    const foco = await corDoToken(page, "--cor-foco");

    for (const [nome, alvo] of [
      ["Abrir no Google Maps", botaoDoMaps(page)],
      ["o telefone", ligacaoDoTelefone(page)],
      ["o Instagram", ligacaoDoInstagram(page)],
    ] as const) {
      await focarPorTeclado(page, alvo);
      const anel = await alvo.evaluate((el) => {
        const estilo = getComputedStyle(el);
        return {
          estilo: estilo.outlineStyle,
          espessura: Number.parseFloat(estilo.outlineWidth),
          cor: estilo.outlineColor,
        };
      });

      expect(anel.estilo, `${nome}: sem anel`).not.toBe("none");
      expect(anel.espessura, `${nome}: espessura do anel`).toBeGreaterThanOrEqual(2);
      expect(
        aMesmaCor(anel.cor, foco),
        `${nome}: o anel devia ser a cor de foco, é ${anel.cor}`,
      ).toBe(true);
    }
  });

  test("nenhuma ligação abre noutro separador", async ({ page }) => {
    await abrirComVisitaNos(page);
    await expect(botaoDoMaps(page)).toBeVisible();

    await expect(seccaoDaVisita(page).locator("a[target]")).toHaveCount(0);
    expect(await seccaoDaVisita(page).locator("a").count(), "guarda: nenhuma ligação medida").toBe(
      3,
    );
  });
});

test.describe("cor (critério 9)", () => {
  test("nenhum elemento da secção é dourado: nem texto, nem fundo, nem contorno", async ({
    page,
  }) => {
    await abrirComVisitaNos(page);
    await expect(botaoDoMaps(page)).toBeVisible();
    const dourado = await corDoToken(page, "--cor-dourado-latao");

    const cores = await seccaoDaVisita(page).evaluate((raiz) => {
      const todas: { onde: string; cor: string }[] = [];
      for (const el of [raiz, ...raiz.querySelectorAll("*")]) {
        const estilo = getComputedStyle(el);
        const onde = `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")}`;
        for (const propriedade of [
          estilo.color,
          estilo.backgroundColor,
          estilo.borderTopColor,
          estilo.borderBottomColor,
          estilo.borderLeftColor,
          estilo.borderRightColor,
        ]) {
          todas.push({ onde, cor: propriedade });
        }
      }
      return todas;
    });

    expect(cores.length, "guarda: não li cor nenhuma").toBeGreaterThan(20);
    expect(cores.filter((c) => aMesmaCor(c.cor, dourado)).map((c) => c.onde)).toEqual([]);
  });

  test("o botão do Maps é secundário: sem preenchimento, com contorno", async ({ page }) => {
    await abrirComVisitaNos(page);
    await expect(botaoDoMaps(page)).toBeVisible();
    const estilo = await botaoDoMaps(page).evaluate((el) => {
      const e = getComputedStyle(el);
      return { fundo: e.backgroundColor, contorno: Number.parseFloat(e.borderTopWidth) };
    });

    expect(estilo.fundo, "o secundário não tem preenchimento").toMatch(
      /rgba\(0, 0, 0, 0\)|transparent/,
    );
    expect(estilo.contorno).toBeGreaterThanOrEqual(1);
  });

  test("o dia de hoje destaca-se pelo peso: 600 contra 400, e só um", async ({ page }) => {
    await abrirComVisitaNos(page, undefined, MOMENTOS.qui17h00);
    await expect(linhaDeHoje(page)).toHaveText("Quinta-feira");

    const pesos = await seccaoDaVisita(page)
      .locator("table tr")
      .evaluateAll((linhas) =>
        linhas.map((linha) => ({
          dia: linha.querySelector("th")?.textContent ?? "",
          atual: linha.getAttribute("aria-current") === "date",
          pesoTh: Number(getComputedStyle(linha.querySelector("th") as Element).fontWeight),
          pesoTd: Number(getComputedStyle(linha.querySelector("td") as Element).fontWeight),
        })),
      );

    expect(pesos).toHaveLength(7);
    expect(pesos.filter((p) => p.atual)).toHaveLength(1);
    for (const p of pesos) {
      const esperado = p.atual ? 600 : 400;
      expect(p.pesoTh, `${p.dia} (th)`).toBe(esperado);
      expect(p.pesoTd, `${p.dia} (td)`).toBe(esperado);
    }
  });
});

test.describe("larguras (7)", () => {
  for (const largura of [360, 390]) {
    test(`a ${String(largura)} px não há scroll horizontal, nem com o texto aumentado`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await abrirComVisitaNos(page, undefined, MOMENTOS.seg12h00);
      await expect(botaoDoMaps(page)).toBeVisible();

      const medir = () =>
        page.evaluate(() => ({
          documento: document.documentElement.scrollWidth,
          janela: document.documentElement.clientWidth,
          seccao: document.querySelector("#visita-nos")?.getBoundingClientRect().right ?? -1,
        }));

      const normal = await medir();
      expect(normal.seccao, "guarda: não medi a secção").toBeGreaterThan(0);
      expect(normal.documento).toBeLessThanOrEqual(normal.janela);

      // O texto do sistema no dobro: tudo tem de quebrar para a linha de baixo, nada encolhe.
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      const aumentado = await medir();
      expect(aumentado.documento, "scroll horizontal com o texto aumentado").toBeLessThanOrEqual(
        aumentado.janela,
      );
      expect(aumentado.seccao).toBeLessThanOrEqual(aumentado.janela);
    });
  }

  test.describe("1024 × 768", () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test("a mesma coluna de 640 px, centrada, com os dois cartões empilhados", async ({ page }) => {
      await abrirComVisitaNos(page);
      await expect(botaoDoMaps(page)).toBeVisible();

      const cartoes = seccaoDaVisita(page).locator(".superficie-painel");
      await expect(cartoes).toHaveCount(2);
      const primeiro = await caixaDe(cartoes.nth(0), "o cartão do horário");
      const segundo = await caixaDe(cartoes.nth(1), "o cartão dos contactos");

      expect(segundo.y, "o segundo cartão está por baixo do primeiro").toBeGreaterThanOrEqual(
        primeiro.y + primeiro.height - 2,
      );
      expect(Math.abs(segundo.x - primeiro.x), "mesma coluna").toBeLessThanOrEqual(2);
      expect(primeiro.width).toBeLessThanOrEqual(642);
      // Centrada: as folgas dos dois lados são iguais.
      expect(Math.abs(primeiro.x - (1024 - (primeiro.x + primeiro.width)))).toBeLessThanOrEqual(24);
      // O botão tem largura natural, não a do cartão, e fica à esquerda.
      const botao = await caixaDe(botaoDoMaps(page), "o botão do Maps");
      expect(botao.width).toBeLessThan(segundo.width / 2);
    });
  });
});

test.describe("o relógio no browser (5.3)", () => {
  test("às 01:59:30 está aberto; ao passar a hora de fecho muda sem ninguém tocar", async ({
    page,
  }) => {
    await abrirComVisitaNos(page, undefined, "2026-07-09T00:59:30Z"); // quinta 01:59:30
    await expect(linhaDoMomento(page)).toHaveText(LINHAS_DO_MOMENTO.ateAsDuas);
    await expect(linhaDeHoje(page)).toHaveText("Quarta-feira");

    await page.clock.runFor(60_000);

    await expect(linhaDoMomento(page)).toHaveText(LINHAS_DO_MOMENTO.fechadoAbreHoje);
    await expect(linhaDeHoje(page)).toHaveText("Quinta-feira");
  });

  test("ao voltar ao ecrã (visibilitychange) recalcula, mesmo com os temporizadores parados", async ({
    page,
  }) => {
    await abrirComVisitaNos(page, undefined, "2026-07-09T00:59:30Z");
    await expect(linhaDoMomento(page)).toHaveText(LINHAS_DO_MOMENTO.ateAsDuas);

    // O telemóvel esteve bloqueado: o relógio andou, os temporizadores não correram.
    await page.clock.setSystemTime(new Date("2026-07-09T01:10:00Z"));
    await expect(linhaDoMomento(page), "guarda: nada mudou só por o relógio ter andado").toHaveText(
      LINHAS_DO_MOMENTO.ateAsDuas,
    );

    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(linhaDoMomento(page)).toHaveText(LINHAS_DO_MOMENTO.fechadoAbreHoje);
  });
});

test.describe("axe, nos quatro estados (critério 8)", () => {
  test("pronto, aberto", async ({ page }) => {
    await abrirComVisitaNos(page, undefined, MOMENTOS.ter23h00);
    await expect(linhaDoMomento(page)).toBeVisible();

    await semViolacoesGraves(page, "visita-nos pronto aberto");
  });

  test("pronto, fechado e só com o telefone", async ({ page }) => {
    await abrirComVisitaNos(
      page,
      { tipo: "info", corpo: infoCom({ telefone: "912 345 678" }) },
      MOMENTOS.seg12h00,
    );
    await expect(ligacaoDoTelefone(page)).toBeVisible();

    await semViolacoesGraves(page, "visita-nos parcial");
  });

  test("falhou", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "estado", estado: 500 });
    await expect(botaoDeTentarOutraVez(page)).toBeVisible();

    await semViolacoesGraves(page, "visita-nos falhou");
  });

  test("a carregar", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "info", corpo: infoCompleta(), atrasoMs: 8_000 });
    await expect(tituloDaVisita(page)).toBeVisible();
    await expect(seccaoDaVisita(page)).toHaveAttribute("aria-busy", "true");

    await semViolacoesGraves(page, "visita-nos a carregar");
  });
});

test.describe("os estados no browser (regra 10)", () => {
  test("por configurar: a secção não existe, e não há a palavra «Fechado» na página", async ({
    page,
  }) => {
    await abrirComVisitaNos(page, { tipo: "info", corpo: infoVazia() });
    await expect(page.getByRole("heading", { name: "Galeria", level: 2 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    await expect(seccaoDaVisita(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: T.titulo })).toHaveCount(0);
  });

  test("falhou: o título fica, e «Tentar outra vez» recupera a secção sem a esconder", async ({
    page,
  }) => {
    // Falha **até** o teste a mandar parar, e não «no pedido número 1»: o servidor de
    // desenvolvimento corre em StrictMode e faz dois pedidos ao arrancar (o primeiro
    // abortado), por isso contar pedidos deixava o erro nunca aparecer.
    let aFalhar = true;
    const contador = await abrirComVisitaNos(page, () =>
      aFalhar ? { tipo: "falha" } : { tipo: "info", corpo: infoCompleta(), atrasoMs: 300 },
    );
    await expect(tituloDaVisita(page)).toBeVisible();
    await expect(seccaoDaVisita(page).getByText(T.erroSemResposta)).toBeVisible();
    const antes = contador.total;
    aFalhar = false;

    await botaoDeTentarOutraVez(page).click();

    // Enquanto tenta: o ecrã de erro (nunca o esqueleto) e o botão ocupado.
    await expect(seccaoDaVisita(page).getByRole("button", { name: T.aTentar })).toBeVisible();
    await expect(seccaoDaVisita(page)).not.toHaveAttribute("aria-busy", "true");

    await expect(
      seccaoDaVisita(page).getByRole("heading", { name: T.tituloDoHorario, level: 3 }),
    ).toBeVisible();
    expect(contador.total - antes, "um só pedido por tentativa").toBe(1);
  });

  test("o servidor respondeu e o servidor falhou: duas frases diferentes", async ({ page }) => {
    await abrirComVisitaNos(page, { tipo: "estado", estado: 500 });

    await expect(seccaoDaVisita(page).getByText(T.erroComResposta)).toBeVisible();
    await expect(seccaoDaVisita(page).getByText(T.erroSemResposta)).toHaveCount(0);
  });

  test("a carregar: sem texto nenhum e sem «Fechado»; ao responder, aparece o cartão", async ({
    page,
  }) => {
    await abrirComVisitaNos(page, { tipo: "info", corpo: infoCompleta(), atrasoMs: 1_500 });
    await expect(seccaoDaVisita(page)).toHaveAttribute("aria-busy", "true");

    expect((await seccaoDaVisita(page).innerText()).trim()).toBe(T.titulo);

    await expect(
      seccaoDaVisita(page).getByRole("heading", { name: T.tituloDoHorario, level: 3 }),
    ).toBeVisible();
  });
});

test.describe("no pacote de produção (porta 8076)", () => {
  test.use({ baseURL: "http://localhost:8076" });

  test("um só pedido ao /info serve o cabeçalho e a secção", async ({ page }) => {
    const contador = await abrirComVisitaNos(page);
    await expect(botaoDoMaps(page)).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(
      contador.total,
      "o `/info` é `no-store` e vai por dados móveis: dois pedidos são um defeito",
    ).toBe(1);
    await expect(seccaoDaVisita(page).locator("iframe")).toHaveCount(0);
  });
});
