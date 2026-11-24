import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { TEXTOS as T } from "../src/pages/gestao/galeria/textos";
import { AGORA } from "../src/testes/eventos";
import { TEXTOS_DA_EMENTA_GESTAO as E, TEXTOS_DA_GESTAO as G } from "../src/testes/gestao";
import { focarPorTeclado } from "./apoio/foco";
import { gerarImagemNaPagina, seccaoDaGaleria } from "./apoio/galeria";
import { fingirApiDeSessao } from "./apoio/gestao";
import {
  LEGENDA_DA_101,
  LEGENDA_DA_102,
  estadoDe,
  fingirApiDasFotos,
  fingirSitePublico,
  fotosDoE2E,
  jaChegouAModeracao,
  pedidosDe,
  type Falha,
  type FotoDoServidor,
  type ServidorDeFotos,
} from "./apoio/gestao-fotos";
import type { FotoPendente } from "../src/testes/gestao";

/**
 * F4-04 — a moderação de fotos no browser, a 390 × 844 com toque (e a 1024 × 768 para o rato).
 * API fingida com **estado partilhado** entre `/api/gestao/fotos…`, o `POST /api/fotos` público e
 * `/api/galeria` (`apoio/gestao-fotos.ts`). O relógio está preso em `AGORA` (segunda-feira,
 * 2/11/2026, 10:00 em Lisboa; o tempo continua a correr: os 700 ms contra o duplo toque e o aviso
 * de 3 s são reais).
 *
 * **O Playwright trata `aria-disabled="true"` como desativado** e espera que o botão fique ativo
 * antes de tocar. Isso serve os testes (um `tap()` já «espera os 700 ms»); para provar que um toque
 * **durante** o intervalo não faz nada usa-se `tap({ force: true })`, que salta essa espera.
 *
 * Os critérios do «Feito quando»: (1) aprovar mostra «Foto aprovada» e passa à seguinte; (2) fila
 * vazia mostra o estado vazio. Mais: a regra 10 (sem resposta, a imagem, o 409), o envio próprio
 * pelo `POST /fotos` público, o duplo toque, o pré-carregamento (um pedido por foto), os botões
 * que não mudam de sítio, os 56 px, o axe e o `style`.
 */

async function semViolacoesGraves(pagina: Page, ecra: string): Promise<void> {
  await pagina.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const resultado = await new AxeBuilder({ page: pagina }).analyze();
  const graves = resultado.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    graves.map((v) => `[${ecra}] ${v.id}: ${v.help}`),
    "o axe achou violações sérias ou críticas (Q-03)",
  ).toEqual([]);
}

type Opcoes = {
  inicial?: ReadonlyArray<FotoPendente | FotoDoServidor>;
  falhas?: Falha[];
  atrasoMs?: number;
  caminho?: string;
  /** Esperar pela região da fila (por omissão sim). */
  esperarFila?: boolean;
};

async function abrir(
  page: Page,
  opcoes: Opcoes = {},
): Promise<{ servidor: ServidorDeFotos; sessao: Awaited<ReturnType<typeof fingirApiDeSessao>> }> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDasFotos(page, { ...opcoes, sessao });
  await fingirSitePublico(page);
  await page.clock.install({ time: AGORA });
  await page.goto(opcoes.caminho ?? "/gestao/galeria");
  if ((opcoes.caminho ?? "/gestao/galeria") === "/gestao/galeria") {
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    if (opcoes.esperarFila !== false) {
      await expect(
        page.getByRole("region", { name: new RegExp(`^${T.fotosAEspera}`) }),
      ).toBeVisible();
    }
  } else {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  return { servidor, sessao };
}

function h2(page: Page): Locator {
  return page.getByRole("heading", { level: 2 }).first();
}
function botao(page: Page, nome: string): Locator {
  return page.getByRole("button", { name: nome, exact: true });
}
/** O botão da página (o primeiro no DOM; com uma folha aberta há outro com o mesmo nome, dentro dela). */
function daPagina(page: Page, nome: string): Locator {
  return botao(page, nome).first();
}
function aprovar(page: Page): Locator {
  return daPagina(page, T.aprovar);
}
function rejeitar(page: Page): Locator {
  return daPagina(page, T.rejeitar);
}
function enviarFoto(page: Page): Locator {
  return daPagina(page, T.enviarFoto);
}
function aviso(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(Feito|Erro)\./ });
}
function folha(page: Page, nome: string): Locator {
  return page.getByRole("dialog", { name: nome, exact: true });
}
function imagemAtual(page: Page): Locator {
  return page.locator("img:not([hidden])[src*='/gestao/fotos/']").first();
}
function navegacao(page: Page): Locator {
  return page.getByRole("navigation", { name: G.navegacao });
}
function semEstilo(page: Page): Promise<number> {
  return page.locator("[style]").count();
}
async function entrar(page: Page): Promise<void> {
  await page.getByLabel(G.etiquetaUtilizador).fill("dono");
  await page.getByLabel(G.etiquetaPassword).fill("password-de-teste");
  await page.getByRole("button", { name: G.botaoEntrar }).click();
}
/** O botão está ativo (o Playwright também espera por isto antes de tocar). */
async function esperarAtivo(alvo: Locator): Promise<void> {
  await expect(alvo).not.toHaveAttribute("aria-disabled", "true");
}
/** A foto `id` está à vista e a imagem dela já carregou (foi descodificada). */
async function fotoAVista(page: Page, id: number): Promise<void> {
  await expect(
    page.locator(`img:not([hidden])[src$='/gestao/fotos/${String(id)}/imagem']`),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(`img:not([hidden])[src$='/gestao/fotos/${String(id)}/imagem']`)
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
}
function sobrepoem(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe("Feito quando 1: aprovar mostra «Foto aprovada» e passa à seguinte", () => {
  test("três pendentes → Aprovar → aviso → a segunda com a legenda dela → o título diz 2 → o site tem a primeira", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(3));
    await fotoAVista(page, 101);
    await expect(page.getByText(LEGENDA_DA_101)).toBeVisible();
    await expect(
      page.getByText(`${T.enviadaEm("ontem, às 23:40")}${T.porNome("Rita")}`),
    ).toBeVisible();

    await aprovar(page).tap();

    await expect(aviso(page)).toContainText(T.avisoAprovada);
    await expect(aviso(page)).toContainText("Feito.");
    await expect(page.getByText(LEGENDA_DA_102)).toBeVisible();
    await expect(page.getByText(LEGENDA_DA_101)).toHaveCount(0);
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(2));
    expect(pedidosDe(servidor, "POST", /\/gestao\/fotos\/101\/aprovar$/)).toHaveLength(1);
    expect(estadoDe(servidor, 101)).toBe("aprovada");
    expect(estadoDe(servidor, 102)).toBe("pendente");
    await expect(page.getByRole("button", { name: /desfazer/i })).toHaveCount(0);

    await page.goto("/");
    const fotoDoSite = seccaoDaGaleria(page).locator('img[src="/media/foto-101.webp"]').first();
    await expect(fotoDoSite).toBeAttached();
    await expect(fotoDoSite).toHaveAttribute("alt", LEGENDA_DA_101);
    await expect(seccaoDaGaleria(page).locator('img[src="/media/foto-102.webp"]')).toHaveCount(0);
  });

  test("depois de aprovar, o foco está no título da fila (nunca num botão de moderar) e o aviso é uma região viva", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    await aprovar(page).tap();

    await expect(h2(page)).toBeFocused();
    await expect(aprovar(page)).not.toBeFocused();
    await expect(rejeitar(page)).not.toBeFocused();
    await expect(page.locator('[role="status"]').filter({ hasText: T.avisoAprovada })).toHaveCount(
      1,
    );
  });
});

test.describe("Feito quando 2: a fila vazia mostra o estado vazio", () => {
  test("aprovar uma e rejeitar outra (com confirmação) → «Não há fotos à espera.»", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, { inicial: fotosDoE2E().slice(0, 2) });
    await aprovar(page).tap();
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(1));

    await rejeitar(page).tap();
    await folha(page, T.tituloRejeitar)
      .getByRole("button", { name: T.rejeitar, exact: true })
      .tap();

    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await expect(page.getByText(T.vazioLinha)).toBeVisible();
    await expect(aviso(page)).toContainText(T.avisoRejeitada);
    await expect(h2(page)).toHaveText(T.fotosAEspera);
    expect(estadoDe(servidor, 101)).toBe("aprovada");
    expect(estadoDe(servidor, 102)).toBe("rejeitada");
    await expect(botao(page, T.aprovar)).toHaveCount(0);
    await expect(enviarFoto(page)).toBeVisible();
  });

  test("com 0 pendentes ao início, o mesmo vazio", async ({ page }) => {
    await abrir(page, { inicial: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    await expect(page.getByText(T.vazioLinha)).toBeVisible();
    await expect(botao(page, T.aprovar)).toHaveCount(0);
  });

  test("com o GET abortado NÃO aparece o vazio: aparece «Não consegui carregar as fotos.»; «Tentar outra vez» traz a fila", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      esperarFila: false,
      falhas: [{ metodo: "GET", caminho: /\/gestao\/fotos$/, resposta: "abortar" }],
    });

    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await expect(page.getByText(T.carregarSemResposta)).toBeVisible();
    await expect(page.getByText(T.vazioTitulo)).toHaveCount(0);
    await expect(botao(page, T.aprovar)).toHaveCount(0);
    await expect(page.locator("img[src*='/gestao/fotos/']")).toHaveCount(0);
    await expect(enviarFoto(page)).toBeVisible();

    servidor.falhas.length = 0;
    await botao(page, T.tentarOutraVez).tap();
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(3));
    await expect(page.getByText(T.carregarTitulo)).toHaveCount(0);
  });

  test("um 500 ao carregar: a frase do servidor, nunca o vazio", async ({ page }) => {
    await abrir(page, {
      esperarFila: false,
      falhas: [
        {
          metodo: "GET",
          caminho: /\/gestao\/fotos$/,
          resposta: { estado: 500, corpo: { erro: "x" } },
        },
      ],
    });
    await expect(page.getByText(T.carregarServidor)).toBeVisible();
    await expect(page.getByText(T.vazioTitulo)).toHaveCount(0);
  });
});

test.describe("a imagem da seguinte vem pré-carregada: um pedido por foto", () => {
  test("a atual e a seguinte pedem-se logo, a terceira só quando passa a seguinte; nunca duas vezes a mesma", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);

    await expect
      .poll(() => servidor.imagens[102] ?? 0, { message: "a seguinte pré-carrega" })
      .toBe(1);
    expect(servidor.imagens[101]).toBe(1);
    expect(servidor.imagens[103] ?? 0, "a terceira não se pede: nunca a fila inteira").toBe(0);

    await aprovar(page).tap();
    await fotoAVista(page, 102);

    expect(servidor.imagens[102], "ao chegar à segunda, ZERO pedidos novos à imagem dela").toBe(1);
    await expect.poll(() => servidor.imagens[103] ?? 0).toBe(1);

    await aprovar(page).tap();
    await fotoAVista(page, 103);
    expect(servidor.imagens, "um só pedido por foto em toda a sessão").toEqual({
      101: 1,
      102: 1,
      103: 1,
    });
  });
});

test.describe("o duplo toque aprova uma só foto", () => {
  test("toques seguidos em Aprovar (o segundo já cai na foto nova, ainda inerte) → um POST e só a primeira aprovada", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));

    await aprovar(page).tap();
    await aprovar(page).tap({ force: true });
    await aprovar(page).tap({ force: true });
    await expect(aviso(page)).toContainText(T.avisoAprovada);

    expect(pedidosDe(servidor, "POST", /aprovar$/)).toHaveLength(1);
    expect(estadoDe(servidor, 101)).toBe("aprovada");
    expect(estadoDe(servidor, 102)).toBe("pendente");
    expect(estadoDe(servidor, 103)).toBe("pendente");
  });

  test("com a rede lenta, um duplo clique no mesmo botão → um POST", async ({ page }) => {
    const { servidor } = await abrir(page, { atrasoMs: 300 });
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));

    await aprovar(page).dblclick();

    await expect(aviso(page)).toContainText(T.avisoAprovada);
    expect(pedidosDe(servidor, "POST", /aprovar$/)).toHaveLength(1);
    expect(estadoDe(servidor, 102)).toBe("pendente");
  });

  test("a foto nova começa inerte e só fica ativa passado o intervalo (a imagem dela já carregou)", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    await aprovar(page).tap();
    await expect(aprovar(page)).toHaveAttribute("aria-disabled", "true");
    await expect(rejeitar(page)).toHaveAttribute("aria-disabled", "true");

    await esperarAtivo(aprovar(page));
    await esperarAtivo(rejeitar(page));
  });
});

test.describe("rejeitar: a folha «Tem a certeza?»", () => {
  test("Cancelar não faz pedido e devolve o foco ao botão; confirmar faz um POST; a imagem dessa foto passa a 404", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);

    await rejeitar(page).tap();
    const f = folha(page, T.tituloRejeitar);
    await expect(f).toBeVisible();
    await expect(f.getByRole("button", { name: T.cancelar, exact: true })).toBeFocused();
    await expect(f).toContainText(T.rejeitarAviso);
    await expect(f.locator("img")).toHaveCount(1);
    expect(pedidosDe(servidor, "POST", /rejeitar$/), "abrir a folha não faz pedido").toHaveLength(
      0,
    );

    await f.getByRole("button", { name: T.cancelar, exact: true }).tap();
    await expect(f).toBeHidden();
    expect(pedidosDe(servidor, "POST", /rejeitar$/)).toHaveLength(0);
    await expect(rejeitar(page)).toBeFocused();

    await rejeitar(page).tap();
    await f.getByRole("button", { name: T.rejeitar, exact: true }).tap();

    await expect(aviso(page)).toContainText(T.avisoRejeitada);
    expect(pedidosDe(servidor, "POST", /\/gestao\/fotos\/101\/rejeitar$/)).toHaveLength(1);
    expect(estadoDe(servidor, 101)).toBe("rejeitada");
    // Pelo `<img>`, como o ecrã a pede (o `fetch` à mão é proibido fora de `src/lib/api`).
    const estadoDaImagem = await page.evaluate(
      () =>
        new Promise<"carregou" | "404">((resolver) => {
          const img = new Image();
          img.onload = () => {
            resolver("carregou");
          };
          img.onerror = () => {
            resolver("404");
          };
          img.src = "/api/gestao/fotos/101/imagem?depois-de-rejeitar";
        }),
    );
    expect(estadoDaImagem, "rejeitar apaga os bytes: a imagem passa a 404").toBe("404");
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(2));
    await fotoAVista(page, 102);
    expect(
      servidor.imagens[101],
      "a miniatura da folha custa um pedido a mais (spec 6)",
    ).toBeLessThanOrEqual(2);
  });

  test("`Esc` fecha a folha sem pedido", async ({ page }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);
    await rejeitar(page).tap();
    await expect(folha(page, T.tituloRejeitar)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(folha(page, T.tituloRejeitar)).toBeHidden();
    expect(pedidosDe(servidor, "POST", /rejeitar$/)).toHaveLength(0);
  });

  test("com a rede lenta, um segundo toque em «A rejeitar…» não faz outro pedido e a folha não fecha a meio", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, { atrasoMs: 400 });
    await fotoAVista(page, 101);
    await rejeitar(page).tap();
    const f = folha(page, T.tituloRejeitar);
    await f.getByRole("button", { name: T.rejeitar, exact: true }).tap();

    await expect(f.getByRole("button", { name: T.aRejeitar, exact: true })).toBeVisible();
    await f.getByRole("button", { name: T.aRejeitar, exact: true }).tap({ force: true });
    await expect(f).toBeVisible();

    await expect(aviso(page)).toContainText(T.avisoRejeitada);
    expect(pedidosDe(servidor, "POST", /rejeitar$/)).toHaveLength(1);
  });
});

test.describe("409: outro aparelho moderou-a (informação, sem vermelho)", () => {
  test("pedi aprovar e outro aparelho já a tinha rejeitado → «A foto anterior já tinha sido rejeitada noutro aparelho.», avança, sem erro", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));
    (servidor.fotos.find((f) => f.id === 101) as FotoDoServidor).estado = "rejeitada";

    await aprovar(page).tap();

    const linha = page.getByText(T.outroAparelhoRejeitada);
    await expect(linha).toBeVisible();
    await expect(linha).not.toHaveClass(/text-erro/);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(aviso(page)).toHaveCount(0);
    await fotoAVista(page, 102);
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(2));
    expect(pedidosDe(servidor, "POST", /101\/aprovar$/)).toHaveLength(1);
  });

  test("pedi aprovar e outro aparelho já a tinha aprovado → o aviso «Foto aprovada. Já aparece no site.» (é verdade)", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));
    (servidor.fotos.find((f) => f.id === 101) as FotoDoServidor).estado = "aprovada";

    await aprovar(page).tap();

    await expect(aviso(page)).toContainText(T.avisoAprovada);
    await expect(page.getByText(T.outroAparelhoRejeitada)).toHaveCount(0);
    await fotoAVista(page, 102);
  });

  test("pedi rejeitar e outro aparelho já a tinha aprovado → «A foto anterior já tinha sido aprovada noutro aparelho.»", async ({
    page,
  }) => {
    const { servidor } = await abrir(page);
    await fotoAVista(page, 101);
    await esperarAtivo(rejeitar(page));
    (servidor.fotos.find((f) => f.id === 101) as FotoDoServidor).estado = "aprovada";

    await rejeitar(page).tap();
    await folha(page, T.tituloRejeitar)
      .getByRole("button", { name: T.rejeitar, exact: true })
      .tap();

    await expect(page.getByText(T.outroAparelhoAprovada)).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(folha(page, T.tituloRejeitar)).toBeHidden();
    await fotoAVista(page, 102);
  });
});

test.describe("sem resposta ao aprovar (regra 10): o ecrã não sabe, verifica, nunca reenvia", () => {
  test("o pedido chegou mas a resposta perdeu-se → um só POST; depois da verificação diz «Foto aprovada.»", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      falhas: [{ metodo: "POST", caminho: /101\/aprovar$/, resposta: "aplicar-e-abortar" }],
    });
    await fotoAVista(page, 101);

    await aprovar(page).tap();

    await expect(aviso(page)).toContainText(T.avisoAprovada);
    expect(pedidosDe(servidor, "POST", /aprovar$/), "nunca reenvia").toHaveLength(1);
    expect(estadoDe(servidor, 101)).toBe("aprovada");
    expect(pedidosDe(servidor, "GET", /^\/galeria$/).length).toBeGreaterThanOrEqual(1);
    await fotoAVista(page, 102);
  });

  test("o pedido não chegou → a foto fica, «Não consegui aprovar. Verifica a ligação…» e os botões voltam; tocar de novo funciona", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      falhas: [{ metodo: "POST", caminho: /101\/aprovar$/, ordem: 1, resposta: "abortar" }],
    });
    await fotoAVista(page, 101);

    await aprovar(page).tap();

    await expect(page.getByText(T.continuaAprovar)).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));
    expect(pedidosDe(servidor, "POST", /aprovar$/)).toHaveLength(1);
    expect(estadoDe(servidor, 101)).toBe("pendente");

    await aprovar(page).tap();
    await expect(aviso(page)).toContainText(T.avisoAprovada);
    expect(pedidosDe(servidor, "POST", /101\/aprovar$/)).toHaveLength(2);
  });

  test("a verificação também falha → «Verificar outra vez» repete só a verificação, nunca o POST", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      falhas: [
        { metodo: "POST", caminho: /101\/aprovar$/, resposta: "aplicar-e-abortar" },
        {
          metodo: "GET",
          caminho: /^\/gestao\/fotos$/,
          quando: jaChegouAModeracao,
          vezes: 1,
          resposta: "abortar",
        },
      ],
    });
    await fotoAVista(page, 101);

    await aprovar(page).tap();

    await expect(page.getByText(T.semConfirmarAprovada)).toBeVisible();
    await expect(botao(page, T.verificarOutraVez)).toBeVisible();
    await expect(aprovar(page)).toHaveAttribute("aria-disabled", "true");

    await botao(page, T.verificarOutraVez).tap();

    await expect(aviso(page)).toContainText(T.avisoAprovada);
    expect(pedidosDe(servidor, "POST", /aprovar$/)).toHaveLength(1);
  });
});

test.describe("a imagem que não se mostra (D3)", () => {
  const SEM_IMAGEM_DA_101: Falha = {
    metodo: "GET",
    caminho: /\/gestao\/fotos\/101\/imagem$/,
    resposta: { estado: 404, corpo: { erro: "foto_nao_encontrada", mensagem: "x" } },
  };

  test("404 com a foto ainda pendente → «Esta foto não se consegue mostrar.»; Aprovar inerte, Rejeitar funciona", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, { falhas: [SEM_IMAGEM_DA_101] });

    await expect(page.getByText(T.fotoNaoSeMostra)).toBeVisible();
    await expect(page.locator("img[src$='/gestao/fotos/101/imagem']:not([hidden])")).toHaveCount(0);
    await expect(aprovar(page)).toHaveAttribute("aria-disabled", "true");
    await expect(rejeitar(page)).not.toHaveAttribute("aria-disabled", "true");
    await aprovar(page).tap({ force: true });
    expect(
      pedidosDe(servidor, "POST", /aprovar$/),
      "nunca se aprova o que não se viu",
    ).toHaveLength(0);

    await rejeitar(page).tap();
    const f = folha(page, T.tituloRejeitar);
    await expect(f).toContainText(T.fotoNaoSeMostraNaFolha);
    await expect(f.locator("img")).toHaveCount(0);
    await f.getByRole("button", { name: T.rejeitar, exact: true }).tap();

    await expect(aviso(page)).toContainText(T.avisoRejeitada);
    expect(estadoDe(servidor, 101)).toBe("rejeitada");
    await fotoAVista(page, 102);
  });

  test("a imagem falha por rede (a verificação também): «Não consegui mostrar esta foto. Verifica a ligação.» e «Tentar outra vez»", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      falhas: [
        { metodo: "GET", caminho: /\/gestao\/fotos\/101\/imagem$/, ordem: 1, resposta: "abortar" },
        {
          // A verificação da fila que o erro da imagem dispara: só depois de a imagem ter sido pedida
          // (e não pela ordem, que o `StrictMode` do servidor de desenvolvimento muda ao carregar).
          metodo: "GET",
          caminho: /^\/gestao\/fotos$/,
          quando: (servidor) => (servidor.imagens[101] ?? 0) >= 1,
          vezes: 1,
          resposta: "abortar",
        },
      ],
    });

    await expect(page.getByText(T.fotoSemLigacao)).toBeVisible();
    await expect(aprovar(page)).toHaveAttribute("aria-disabled", "true");

    await botao(page, T.tentarOutraVez).tap();
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));
    expect(pedidosDe(servidor, "POST", /aprovar$/)).toHaveLength(0);
  });
});

test.describe("enviar uma foto do bar (D1): entra na fila e aprova-se como as outras", () => {
  test("Enviar foto → JPEG → legenda → Enviar foto → um POST /api/fotos multipart → aviso → a foto na fila → Aprovar → está no site (três toques)", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, { inicial: [] });
    await expect(page.getByText(T.vazioTitulo)).toBeVisible();
    const jpeg = await gerarImagemNaPagina(page, { largura: 800, altura: 600 });
    let toques = 0;
    const tocar = async (alvo: Locator): Promise<void> => {
      toques += 1;
      await alvo.tap();
    };

    await tocar(enviarFoto(page));
    const f = folha(page, T.tituloEnviar);
    await expect(f).toContainText(T.promessaEnviar);
    await f
      .getByLabel(/^Foto/)
      .setInputFiles({ name: "jantar.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await expect(f.locator("img")).toBeVisible();
    await f.getByLabel(T.etiquetaLegenda, { exact: true }).fill("Jantar de aniversário");
    await tocar(f.getByRole("button", { name: T.enviar, exact: true }));

    await expect(aviso(page)).toContainText(T.fotoEnviada);
    await expect(f).toBeHidden();
    expect(servidor.envios).toHaveLength(1);
    const envio = servidor.envios[0];
    expect(envio?.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(envio?.cabecalhos["x-tomazia"]).toBe("1");
    expect(envio?.campos, "só o ficheiro e a legenda: sem `website` nem `enviada_por`").toEqual([
      "ficheiro",
      "descricao",
    ]);
    expect(envio?.descricao).toBe("Jantar de aniversário");

    await expect(h2(page)).toHaveText(T.fotosAEsperaN(1));
    await expect(h2(page)).toBeFocused();
    await expect(page.getByText("Jantar de aniversário")).toBeVisible();
    await expect(page.getByText(T.vazioTitulo)).toHaveCount(0);
    await fotoAVista(page, 1000);
    await esperarAtivo(aprovar(page));
    await tocar(aprovar(page));

    await expect(aviso(page)).toContainText(T.avisoAprovada);
    expect(toques, "Enviar foto, Enviar foto na folha, Aprovar").toBe(3);
    await page.goto("/");
    await expect(
      seccaoDaGaleria(page).locator('img[src="/media/foto-1000.webp"]').first(),
    ).toBeAttached();
  });

  test("a foto do dono vai para o FIM de uma fila que já tem fotos de clientes; o dono continua na que tinha", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    const jpeg = await gerarImagemNaPagina(page, { largura: 400, altura: 300 });

    await enviarFoto(page).tap();
    const f = folha(page, T.tituloEnviar);
    await f
      .getByLabel(/^Foto/)
      .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await expect(f.locator("img")).toBeVisible();
    await f.getByRole("button", { name: T.enviar, exact: true }).tap();

    await expect(aviso(page)).toContainText(T.fotoEnviada);
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(4));
    await fotoAVista(page, 101);
  });

  test("sem resposta ao enviar: um só POST, o aviso «Não sei se a foto foi enviada…» e a fila recarrega", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      inicial: [],
      falhas: [{ metodo: "POST", caminho: /^\/fotos$/, resposta: "aplicar-e-abortar" }],
    });
    const jpeg = await gerarImagemNaPagina(page, { largura: 400, altura: 300 });
    await enviarFoto(page).tap();
    const f = folha(page, T.tituloEnviar);
    await f
      .getByLabel(/^Foto/)
      .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await expect(f.locator("img")).toBeVisible();

    await f.getByRole("button", { name: T.enviar, exact: true }).tap();

    await expect(aviso(page)).toContainText(T.envioSemSaber);
    await expect(aviso(page)).toContainText("Erro.");
    expect(pedidosDe(servidor, "POST", /^\/fotos$/), "nunca reenvia").toHaveLength(1);
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(1));
  });
});

test.describe("401 e a guarda de saída", () => {
  test("401 num Aprovar: o login diz «A sessão terminou.»; entrar volta a /gestao/galeria e nada se repete", async ({
    page,
  }) => {
    const { servidor } = await abrir(page, {
      falhas: [
        {
          metodo: "POST",
          caminho: /aprovar$/,
          resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
          fechaSessao: true,
        },
      ],
    });
    await fotoAVista(page, 101);

    await aprovar(page).tap();

    await expect(page.getByRole("heading", { level: 1, name: G.tituloDoLogin })).toBeVisible();
    await expect(page.getByText(E.sessaoTerminou)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/entrar");

    servidor.falhas.length = 0;
    await entrar(page);

    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/galeria");
    await expect(h2(page)).toHaveText(T.fotosAEsperaN(3));
    expect(pedidosDe(servidor, "POST", /aprovar$/), "nenhuma moderação se repete").toHaveLength(1);
    expect(estadoDe(servidor, 101)).toBe("pendente");
  });

  test("folha de enviar suja + Voltar: a pergunta; «Continuar» fica; «Sair sem enviar» sai", async ({
    page,
  }) => {
    await abrir(page, { caminho: "/gestao" });
    await navegacao(page).getByRole("link", { name: "Galeria" }).tap();
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    await enviarFoto(page).tap();
    await folha(page, T.tituloEnviar)
      .getByLabel(T.etiquetaLegenda, { exact: true })
      .fill("Noite de samba");

    await page.goBack();

    const pergunta = folha(page, T.saidaTitulo);
    await expect(pergunta).toBeVisible();
    await expect(pergunta).toContainText(T.saidaLinha);
    await expect(
      pergunta.getByRole("button", { name: T.saidaContinuar, exact: true }),
    ).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/galeria");

    await pergunta.getByRole("button", { name: T.saidaContinuar, exact: true }).tap();
    await expect(pergunta).toBeHidden();
    await expect(
      folha(page, T.tituloEnviar).getByLabel(T.etiquetaLegenda, { exact: true }),
    ).toHaveValue("Noite de samba");

    await page.goBack();
    await expect(folha(page, T.saidaTitulo)).toBeVisible();
    await folha(page, T.saidaTitulo).getByRole("button", { name: T.saidaSair, exact: true }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao");
  });

  test("folha de enviar sem nada escrito: Cancelar fecha logo, sem pergunta", async ({ page }) => {
    await abrir(page);
    await enviarFoto(page).tap();
    await folha(page, T.tituloEnviar).getByRole("button", { name: T.cancelar, exact: true }).tap();
    await expect(folha(page, T.tituloEnviar)).toBeHidden();
    await expect(folha(page, T.saidaTitulo)).toBeHidden();
    await expect(enviarFoto(page)).toBeFocused();
  });
});

test.describe("os botões nunca mudam de sítio, nem entre uma foto 3:4 e uma 16:9, com e sem legenda", () => {
  test("Aprovar e Rejeitar com a mesma caixa nas três fotos (101: vertical com legenda longa; 102: horizontal; 103: vertical sem legenda)", async ({
    page,
  }) => {
    await abrir(page);
    const caixas: Array<{ aprovar: unknown; rejeitar: unknown; imagem: unknown }> = [];
    for (const id of [101, 102, 103]) {
      await fotoAVista(page, id);
      await esperarAtivo(aprovar(page));
      const [a, r, i] = await Promise.all([
        aprovar(page).boundingBox(),
        rejeitar(page).boundingBox(),
        imagemAtual(page).boundingBox(),
      ]);
      caixas.push({ aprovar: a, rejeitar: r, imagem: i });
      if (id !== 103) await aprovar(page).tap();
    }

    const arred = (c: unknown): unknown => {
      const caixa = c as { x: number; y: number; width: number; height: number };
      return [caixa.x, caixa.y, caixa.width, caixa.height].map((n) => Math.round(n * 2) / 2);
    };
    for (const [i, c] of caixas.entries()) {
      expect(arred(c.aprovar), `Aprovar na foto ${String(i + 1)}`).toEqual(
        arred(caixas[0]?.aprovar),
      );
      expect(arred(c.rejeitar), `Rejeitar na foto ${String(i + 1)}`).toEqual(
        arred(caixas[0]?.rejeitar),
      );
      expect(arred(c.imagem), `a caixa da imagem na foto ${String(i + 1)}`).toEqual(
        arred(caixas[0]?.imagem),
      );
    }
  });

  test("a 390 × 844 Aprovar e Rejeitar estão inteiros no ecrã, sem rolar, com a legenda de duas linhas à vista acima da barra; o aviso não os cobre", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 390, height: 844 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const barra = await navegacao(page).boundingBox();
    const legenda = await page.getByText(LEGENDA_DA_101).boundingBox();
    for (const [nome, alvo] of [
      ["Aprovar", aprovar(page)],
      ["Rejeitar", rejeitar(page)],
    ] as const) {
      const c = await alvo.boundingBox();
      expect(c, nome).not.toBeNull();
      expect(c?.y ?? -1, `${nome}: o topo está no ecrã`).toBeGreaterThanOrEqual(0);
      expect((c?.y ?? 0) + (c?.height ?? 0), `${nome}: o fundo está no ecrã`).toBeLessThanOrEqual(
        844,
      );
    }
    expect(
      (legenda?.y ?? 0) + (legenda?.height ?? 0),
      "a legenda acaba acima da barra",
    ).toBeLessThanOrEqual(barra?.y ?? 0);

    await esperarAtivo(aprovar(page));
    await aprovar(page).tap();
    await expect(aviso(page)).toBeVisible();
    const caixaDoAviso = await aviso(page).boundingBox();
    for (const alvo of [aprovar(page), rejeitar(page)]) {
      const c = await alvo.boundingBox();
      expect(c && caixaDoAviso ? sobrepoem(c, caixaDoAviso) : true, "o aviso cobre um botão").toBe(
        false,
      );
    }
  });
});

for (const [largura, altura] of [
  [390, 844],
  [1024, 768],
] as const) {
  test.describe(`o axe em todos os estados, a ${String(largura)} × ${String(altura)}`, () => {
    test.use({ viewport: { width: largura, height: altura } });
    const tam = `${String(largura)}×${String(altura)}`;

    test("foto com legenda e nome; foto sem legenda nem nome; aviso", async ({ page }) => {
      await abrir(page);
      await fotoAVista(page, 101);
      await semViolacoesGraves(page, `foto com legenda ${tam}`);
      await esperarAtivo(aprovar(page));
      await aprovar(page).tap();
      await expect(aviso(page)).toBeVisible();
      await semViolacoesGraves(page, `aviso ${tam}`);
      await esperarAtivo(aprovar(page));
      await aprovar(page).tap();
      await fotoAVista(page, 103);
      await semViolacoesGraves(page, `foto sem legenda nem nome ${tam}`);
    });

    test("vazio e erro de carregar", async ({ page }) => {
      await abrir(page, { inicial: [] });
      await expect(page.getByText(T.vazioTitulo)).toBeVisible();
      await semViolacoesGraves(page, `vazio ${tam}`);
    });

    test("erro de carregar", async ({ page }) => {
      await abrir(page, {
        esperarFila: false,
        falhas: [{ metodo: "GET", caminho: /\/gestao\/fotos$/, resposta: "abortar" }],
      });
      await expect(page.getByText(T.carregarTitulo)).toBeVisible();
      await semViolacoesGraves(page, `erro ${tam}`);
    });

    test("imagem que não se mostra", async ({ page }) => {
      await abrir(page, {
        falhas: [
          {
            metodo: "GET",
            caminho: /\/gestao\/fotos\/101\/imagem$/,
            resposta: { estado: 404, corpo: { erro: "foto_nao_encontrada", mensagem: "x" } },
          },
        ],
      });
      await expect(page.getByText(T.fotoNaoSeMostra)).toBeVisible();
      await semViolacoesGraves(page, `imagem que não se mostra ${tam}`);
    });

    test("folha de rejeitar", async ({ page }) => {
      await abrir(page);
      await fotoAVista(page, 101);
      await rejeitar(page).tap();
      await expect(folha(page, T.tituloRejeitar)).toBeVisible();
      await semViolacoesGraves(page, `folha de rejeitar ${tam}`);
    });

    test("folha de enviar com erro", async ({ page }) => {
      await abrir(page, {
        falhas: [
          {
            metodo: "POST",
            caminho: /^\/fotos$/,
            resposta: {
              estado: 400,
              corpo: { erro: "imagem_invalida", mensagem: "A imagem não é válida (teste)." },
            },
          },
        ],
      });
      const jpeg = await gerarImagemNaPagina(page, { largura: 400, altura: 300 });
      await enviarFoto(page).tap();
      const f = folha(page, T.tituloEnviar);
      await f
        .getByLabel(/^Foto/)
        .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await expect(f.locator("img")).toBeVisible();
      await f.getByRole("button", { name: T.enviar, exact: true }).tap();
      await expect(f.getByText("A imagem não é válida (teste).")).toBeVisible();
      await semViolacoesGraves(page, `folha de enviar com erro ${tam}`);
    });

    test("folha de sair", async ({ page }) => {
      await abrir(page);
      await enviarFoto(page).tap();
      const f = folha(page, T.tituloEnviar);
      await f.getByLabel(T.etiquetaLegenda, { exact: true }).fill("x");
      await f.getByRole("button", { name: T.cancelar, exact: true }).tap();
      await expect(folha(page, T.saidaTitulo)).toBeVisible();
      await semViolacoesGraves(page, `folha de sair ${tam}`);
    });
  });
}

test.describe("alvos (Q-04) e foco visível, a 390 × 844", () => {
  async function exigir(nome: string, alvo: Locator, minimoAltura = 44): Promise<void> {
    await alvo.page().evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    const caixa = await alvo.first().boundingBox();
    expect(caixa, `${nome}: não encontrei o elemento`).not.toBeNull();
    expect(caixa?.height ?? 0, `${nome}: altura`).toBeGreaterThanOrEqual(minimoAltura);
    expect(caixa?.width ?? 0, `${nome}: largura`).toBeGreaterThanOrEqual(44);
  }
  async function anelVisivel(page: Page, alvo: Locator): Promise<boolean> {
    await focarPorTeclado(page, alvo);
    return alvo.evaluate((el) => {
      const e = getComputedStyle(el);
      return (
        (e.outlineStyle !== "none" && parseFloat(e.outlineWidth) > 0) || e.boxShadow !== "none"
      );
    });
  }

  test("Enviar foto a 44; Aprovar e Rejeitar a 56 px de altura (D5); botões e campos das três folhas a 44", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    await exigir("Enviar foto", enviarFoto(page));
    await exigir("Aprovar", aprovar(page), 56);
    await exigir("Rejeitar", rejeitar(page), 56);

    await rejeitar(page).tap();
    const fr = folha(page, T.tituloRejeitar);
    for (const nome of [T.rejeitar, T.cancelar])
      await exigir(`rejeitar: ${nome}`, fr.getByRole("button", { name: nome, exact: true }));
    await fr.getByRole("button", { name: T.cancelar, exact: true }).tap();

    await enviarFoto(page).tap();
    const fe = folha(page, T.tituloEnviar);
    await exigir("campo Foto", fe.getByLabel(/^Foto/));
    await exigir("campo Legenda", fe.getByLabel(T.etiquetaLegenda, { exact: true }));
    for (const nome of [T.enviar, T.cancelar])
      await exigir(`enviar: ${nome}`, fe.getByRole("button", { name: nome, exact: true }));
    await fe.getByLabel(T.etiquetaLegenda, { exact: true }).fill("x");
    await fe.getByRole("button", { name: T.cancelar, exact: true }).tap();
    for (const nome of [T.saidaSair, T.saidaContinuar]) {
      await exigir(
        `sair: ${nome}`,
        folha(page, T.saidaTitulo).getByRole("button", { name: nome, exact: true }),
      );
    }
  });

  test("«Tentar outra vez» (erro de carregar) e «Verificar outra vez» (verificação falhada) a 44", async ({
    page,
  }) => {
    await abrir(page, {
      esperarFila: false,
      falhas: [{ metodo: "GET", caminho: /\/gestao\/fotos$/, resposta: "abortar" }],
    });
    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await exigir("Tentar outra vez", botao(page, T.tentarOutraVez));
  });

  test("«Verificar outra vez» a 44", async ({ page }) => {
    await abrir(page, {
      falhas: [
        { metodo: "POST", caminho: /101\/aprovar$/, resposta: "aplicar-e-abortar" },
        {
          metodo: "GET",
          caminho: /^\/gestao\/fotos$/,
          quando: jaChegouAModeracao,
          vezes: 1,
          resposta: "abortar",
        },
      ],
    });
    await fotoAVista(page, 101);
    await aprovar(page).tap();
    await expect(botao(page, T.verificarOutraVez)).toBeVisible();
    await exigir("Verificar outra vez", botao(page, T.verificarOutraVez));
  });

  test("foco visível em Enviar foto, Rejeitar, Aprovar e nos botões da folha de rejeitar", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    await esperarAtivo(aprovar(page));
    for (const alvo of [enviarFoto(page), rejeitar(page), aprovar(page)]) {
      expect(await anelVisivel(page, alvo), "o anel de foco tem de se ver").toBe(true);
    }
    await rejeitar(page).tap();
    for (const nome of [T.rejeitar, T.cancelar]) {
      expect(
        await anelVisivel(
          page,
          folha(page, T.tituloRejeitar).getByRole("button", { name: nome, exact: true }),
        ),
      ).toBe(true);
    }
  });

  test("nenhum atributo `style` no DOM, nem com as folhas abertas nem com a prévia", async ({
    page,
  }) => {
    await abrir(page);
    await fotoAVista(page, 101);
    expect(await semEstilo(page)).toBe(0);
    await rejeitar(page).tap();
    expect(await semEstilo(page)).toBe(0);
    await folha(page, T.tituloRejeitar)
      .getByRole("button", { name: T.cancelar, exact: true })
      .tap();
    const jpeg = await gerarImagemNaPagina(page, { largura: 400, altura: 300 });
    await enviarFoto(page).tap();
    const f = folha(page, T.tituloEnviar);
    await f
      .getByLabel(/^Foto/)
      .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await expect(f.locator("img")).toBeVisible();
    expect(await semEstilo(page)).toBe(0);
  });
});
