import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { TEXTOS as T } from "../src/pages/gestao/eventos/textos";
import { AGORA, TEXTOS_DOS_EVENTOS } from "../src/testes/eventos";
import {
  TEXTOS_DA_EMENTA_GESTAO as E,
  TEXTOS_DA_GESTAO as G,
  eventoDeTeste,
  eventosDeGestaoVazios,
  type EventoGestao,
  type RespostaEventosGestao,
} from "../src/testes/gestao";
import { fingirInfoFixo } from "./apoio/cabecalho";
import { fingirEmentaFixa } from "./apoio/ementa";
import { focarPorTeclado } from "./apoio/foco";
import { fingirApiDeSessao } from "./apoio/gestao";
import {
  fingirApiDeEventos,
  pedidosDe,
  type Falha,
  type ServidorDeEventos,
} from "./apoio/gestao-eventos";

/**
 * F4-03 — os eventos da gestão no browser, a 390 × 844 com toque (e a 1024 × 768 para o rato).
 * API fingida com **estado partilhado** entre `/api/gestao/eventos…` e `/api/eventos`
 * (`apoio/gestao-eventos.ts`): os três critérios do «Feito quando» são (1) duplicar um evento
 * semanal cria um rascunho na data escolhida, à mesma hora de Lisboa; (2) editar um evento
 * publicado muda o site sem deploy; (3) eliminar pede confirmação numa folha e o evento sai da
 * lista e do site. O relógio está preso em `AGORA` (segunda-feira, 2/11/2026, 10:00 em Lisboa).
 *
 * Nota: o `page.route` desliga a cache HTTP, por isso aqui não se vê o `max-age=60` do
 * `/api/eventos` (os avisos dizem «pode levar um minuto»).
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
  inicial?: RespostaEventosGestao | EventoGestao[];
  falhas?: Falha[];
  atrasoMs?: number;
  caminho?: string;
  /** Esperar pela lista (por omissão sim). */
  esperarLista?: boolean;
};

async function abrir(page: Page, opcoes: Opcoes = {}): Promise<ServidorDeEventos> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDeEventos(page, { ...opcoes, sessao, agora: AGORA });
  await fingirInfoFixo(page);
  await fingirEmentaFixa(page);
  await page.clock.install({ time: AGORA });
  await page.goto(opcoes.caminho ?? "/gestao/eventos");
  // Noutro destino (o «Início», para chegar aos Eventos pela barra) o título e a lista não são
  // estes: esperar por eles aqui nunca passava.
  if ((opcoes.caminho ?? "/gestao/eventos") === "/gestao/eventos") {
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    if (opcoes.esperarLista !== false) {
      await expect(page.getByRole("region", { name: T.proximos })).toBeVisible();
    }
  } else {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  return servidor;
}

function linha(page: Page, titulo: string, n = 0): Locator {
  return page
    .locator("li")
    .filter({ has: page.getByRole("button", { name: titulo, exact: true }) })
    .nth(n);
}
function titulo(page: Page, nome: string, n = 0): Locator {
  return page.getByRole("button", { name: nome, exact: true }).nth(n);
}
function aviso(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(Feito|Erro)\./ });
}
function folha(page: Page, nome: string): Locator {
  return page.getByRole("dialog", { name: nome, exact: true });
}
function botao(page: Page, nome: string): Locator {
  return page.getByRole("button", { name: nome, exact: true });
}
function campo(page: Page, etiqueta: string): Locator {
  return page.getByLabel(etiqueta, { exact: true });
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
async function preencher(
  page: Page,
  v: { titulo?: string; descricao?: string; data?: string; hora?: string },
): Promise<void> {
  if (v.titulo !== undefined) await campo(page, T.etiquetaTitulo).fill(v.titulo);
  if (v.descricao !== undefined) await campo(page, T.etiquetaDescricao).fill(v.descricao);
  if (v.data !== undefined) await campo(page, T.etiquetaData).fill(v.data);
  if (v.hora !== undefined) await campo(page, T.etiquetaHora).fill(v.hora);
}
/** Abre o site público (a mesma página, depois de gravar na gestão) e espera pela secção dos eventos. */
async function irParaOSite(page: Page): Promise<Locator> {
  await page.goto("/");
  const seccao = page.locator("#eventos");
  await expect(seccao).toBeVisible();
  return seccao;
}
function aoCorpo(pedido: { corpo: unknown } | undefined): unknown {
  return pedido?.corpo;
}

const QUINTAS = (id = 11): EventoGestao =>
  eventoDeTeste({ id, titulo: "Quintas de Samba", inicio: "2026-11-05T22:00:00Z" });

test.describe("Feito quando 1: duplicar um evento semanal (as Quintas de Samba)", () => {
  test("1.ª quinta (5/11) → opções 12/11, 19/11, 26/11 → escolher 19/11 manda {semanas: 2} e cria o rascunho da 3.ª quinta", async ({
    page,
  }) => {
    const servidor = await abrir(page, { inicial: [QUINTAS()] });

    await page.getByRole("button", { name: T.duplicarDe("Quintas de Samba") }).tap();
    const opcao = (n: number) => page.getByRole("button", { name: new RegExp(T.daquiASemanas(n)) });
    await expect(opcao(1)).toContainText(/12 de novembro/i);
    await expect(opcao(2)).toContainText(/19 de novembro/i);
    await expect(opcao(3)).toContainText(/26 de novembro/i);
    for (const n of [1, 2, 3]) await expect(opcao(n)).toContainText(T.comHora("22:00"));
    expect(pedidosDe(servidor, "POST", /duplicar/), "nada se cria antes de escolher").toHaveLength(
      0,
    );

    await opcao(2).tap();

    await expect(aviso(page)).toContainText(
      T.rascunhoCriadoPara(`quinta-feira, 19 de novembro, ${T.comHora("22:00")}`),
    );
    const posts = pedidosDe(servidor, "POST", /\/gestao\/eventos\/11\/duplicar$/);
    expect(posts).toHaveLength(1);
    expect(aoCorpo(posts[0])).toEqual({ semanas: 2 });
    const rascunhos = page.getByRole("region", { name: T.rascunhos });
    await expect(
      rascunhos.getByRole("button", { name: "Quintas de Samba", exact: true }),
    ).toBeVisible();
    await expect(rascunhos).toContainText(`Quinta-feira, 19 de novembro, ${T.comHora("22:00")}`);
    const copia = servidor.eventos.find((e) => !e.publicado);
    expect(copia?.inicio).toBe("2026-11-19T22:00:00Z");
    expect(copia?.publicado).toBe(false);
  });

  test("original no arquivo (15/10, hora de verão): 5/11, 12/11 e 19/11 às 22:00 de Lisboa; a 1.ª cria 5/11 às 22:00 (22:00Z)", async ({
    page,
  }) => {
    const servidor = await abrir(page, {
      inicial: [
        eventoDeTeste({ id: 61, titulo: "Quintas de Samba", inicio: "2026-10-15T21:00:00Z" }),
      ],
    });
    await botao(page, T.verOArquivo(1)).tap();

    await page.getByRole("button", { name: T.duplicarDe("Quintas de Samba") }).tap();
    const opcao = (n: number) => page.getByRole("button", { name: new RegExp(T.daquiASemanas(n)) });
    await expect(opcao(1)).toContainText(/5 de novembro/i);
    await expect(opcao(2)).toContainText(/12 de novembro/i);
    await expect(opcao(3)).toContainText(/19 de novembro/i);
    for (const n of [1, 2, 3]) {
      await expect(opcao(n)).toContainText(T.comHora("22:00"));
      await expect(opcao(n)).not.toContainText("21:00");
    }

    await opcao(1).tap();

    const posts = pedidosDe(servidor, "POST", /duplicar$/);
    expect(posts).toHaveLength(1);
    expect(aoCorpo(posts[0])).toEqual({ semanas: 1 });
    await expect(aviso(page)).toContainText(
      T.rascunhoCriadoPara(`quinta-feira, 5 de novembro, ${T.comHora("22:00")}`),
    );
    expect(servidor.eventos.find((e) => !e.publicado)?.inicio).toBe("2026-11-05T22:00:00Z");
  });

  test("a cópia publica-se com o interruptor e aparece no site; «Desfazer» da cópia apaga-a", async ({
    page,
  }) => {
    const servidor = await abrir(page, { inicial: [QUINTAS()] });
    await page.getByRole("button", { name: T.duplicarDe("Quintas de Samba") }).tap();
    await page.getByRole("button", { name: new RegExp(T.daquiASemanas(2)) }).tap();
    await expect(aviso(page)).toBeVisible();
    // O original (5/11) está nos Próximos e a cópia (19/11) nos Rascunhos, e os dois interruptores
    // têm o mesmo nome: o da cópia é o dos Rascunhos (o `.first()` era o do original, que o
    // despublicava).
    await page
      .getByRole("region", { name: T.rascunhos })
      .getByRole("switch", { name: T.publicadoDe("Quintas de Samba") })
      .tap();

    await expect(page.getByRole("region", { name: T.proximos })).toContainText("19 de novembro");
    expect(servidor.eventos.filter((e) => e.publicado)).toHaveLength(2);

    await page
      .getByRole("button", { name: T.duplicarDe("Quintas de Samba") })
      .first()
      .tap();
    await page.getByRole("button", { name: new RegExp(T.daquiASemanas(1)) }).tap();
    await aviso(page).getByRole("button", { name: T.desfazer }).tap();
    await expect.poll(() => pedidosDe(servidor, "DELETE").length).toBe(1);
    expect(servidor.eventos).toHaveLength(2);
  });

  test("depois de duplicar pela folha, o foco fica no título do rascunho novo (e não no body nem no «Saltar»)", async ({
    page,
  }) => {
    await abrir(page, { inicial: [QUINTAS()] });
    await page.getByRole("button", { name: T.duplicarDe("Quintas de Samba") }).tap();
    await page.getByRole("button", { name: new RegExp(T.daquiASemanas(2)) }).tap();
    await expect(aviso(page)).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: T.rascunhos })
        .getByRole("button", { name: "Quintas de Samba", exact: true }),
    ).toBeFocused();
    // E continua lá: nada (o `<dialog>` a fechar, o recarregamento) o rouba depois.
    await page.waitForTimeout(600);
    await expect(
      page
        .getByRole("region", { name: T.rascunhos })
        .getByRole("button", { name: "Quintas de Samba", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("link", { name: "Saltar para o conteúdo" })).not.toBeFocused();
  });

  test("um original sem data duplica com um toque, sem folha e sem corpo", async ({ page }) => {
    const servidor = await abrir(page);
    await page.getByRole("button", { name: T.duplicarDe("Rascunho importado") }).tap();

    await expect(aviso(page)).toContainText(T.rascunhoCriadoSemData);
    const posts = pedidosDe(servidor, "POST", /duplicar$/);
    expect(posts).toHaveLength(1);
    expect(aoCorpo(posts[0])).toBeUndefined();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("Feito quando 2: editar um evento publicado muda o site sem deploy", () => {
  test("mudar título e hora → um PATCH só com `titulo` e `inicio` (Z) → o site mostra o título e a hora novos", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await titulo(page, "Fado ao vivo").tap();
    await expect(folha(page, T.tituloEditar)).toBeVisible();
    await preencher(page, { titulo: "Fado renovado", hora: "23:00" });

    await botao(page, T.guardarAlteracoes).tap();

    const patches = pedidosDe(servidor, "PATCH");
    expect(patches).toHaveLength(1);
    expect(aoCorpo(patches[0])).toEqual({
      titulo: "Fado renovado",
      inicio: "2026-11-05T23:00:00Z",
    });
    await expect(aviso(page)).toContainText(T.eventoAtualizado);
    await expect(titulo(page, "Fado renovado")).toBeVisible();

    const site = await irParaOSite(page);
    await expect(site.getByRole("heading", { level: 3, name: /Fado renovado/ })).toBeVisible();
    await expect(site.getByRole("heading", { level: 3, name: /23:00/ })).toBeVisible();
    await expect(site.getByText("Fado ao vivo")).toHaveCount(0);
  });

  test("a descrição com quebras de linha aparece no site em linhas separadas (whitespace-pre-line)", async ({
    page,
  }) => {
    await abrir(page);
    await titulo(page, "Fado ao vivo").tap();
    await campo(page, T.etiquetaDescricao).fill("Primeira linha.\nSegunda linha.");
    await botao(page, T.guardarAlteracoes).tap();
    await expect(aviso(page)).toBeVisible();

    const site = await irParaOSite(page);
    const paragrafo = site.locator("p", { hasText: "Primeira linha." });
    await expect(paragrafo).toHaveCSS("white-space", "pre-line");
    const altura = await paragrafo.evaluate((p) => p.getBoundingClientRect().height);
    const linhaUnica = await paragrafo.evaluate((p) => parseFloat(getComputedStyle(p).lineHeight));
    expect(altura).toBeGreaterThanOrEqual(linhaUnica * 2 - 1);
  });
});

test.describe("Feito quando 3: eliminar pede confirmação numa folha e sai da lista e do site", () => {
  test("«Cancelar» não faz pedido; confirmar faz um DELETE; o evento sai da lista e do site", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await titulo(page, "Sessão de jazz").tap();
    await botao(page, T.eliminarEvento).tap();
    await expect(folha(page, T.tituloEliminar)).toBeVisible();
    await expect(folha(page, T.tituloEliminar)).toContainText(
      T.vaisEliminar("Sessão de jazz", `Quinta-feira, 12 de novembro, ${T.comHora("22:00")}`),
    );
    await expect(
      folha(page, T.tituloEliminar).getByRole("button", { name: T.cancelar }),
    ).toBeFocused();

    await folha(page, T.tituloEliminar).getByRole("button", { name: T.cancelar }).tap();
    expect(pedidosDe(servidor, "DELETE"), "cancelar não faz pedido").toHaveLength(0);
    await expect(folha(page, T.tituloEliminar)).toHaveCount(0);

    await botao(page, T.eliminarEvento).tap();
    await folha(page, T.tituloEliminar).getByRole("button", { name: T.eliminar }).tap();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(pedidosDe(servidor, "DELETE")).toHaveLength(1);
    await expect(titulo(page, "Sessão de jazz")).toHaveCount(0);
    await expect(aviso(page)).toContainText(T.eventoEliminadoNoSite);
    await expect(aviso(page).getByRole("button", { name: T.desfazer })).toHaveCount(0);

    const site = await irParaOSite(page);
    await expect(site.getByRole("heading", { level: 3, name: /Sessão de jazz/ })).toHaveCount(0);
    await expect(site.getByRole("heading", { level: 3, name: /Fado ao vivo/ })).toBeVisible();
  });
});

test.describe("criar e publicar", () => {
  test("guardar sem data: erro junto do campo e nenhum POST; com data é rascunho; o interruptor publica e o site mostra-o", async ({
    page,
  }) => {
    const servidor = await abrir(page, { inicial: eventosDeGestaoVazios() });
    await botao(page, T.novoEvento).tap();
    await preencher(page, { titulo: "Noite nova" });
    await botao(page, T.guardarRascunho).tap();

    await expect(campo(page, T.etiquetaData)).toHaveAttribute("aria-invalid", "true");
    await expect(folha(page, T.tituloCriar)).toContainText(T.erroDataVazia);
    expect(pedidosDe(servidor, "POST")).toHaveLength(0);

    await preencher(page, { data: "2026-11-20", hora: "22:00" });
    await botao(page, T.guardarRascunho).tap();
    await expect(aviso(page)).toContainText(T.rascunhoGuardado);
    const rascunhos = page.getByRole("region", { name: T.rascunhos });
    await expect(rascunhos.getByRole("button", { name: "Noite nova", exact: true })).toBeVisible();

    await page.getByRole("switch", { name: T.publicadoDe("Noite nova") }).tap();
    await expect(page.getByRole("region", { name: T.proximos })).toContainText("Noite nova");
    const site = await irParaOSite(page);
    await expect(site.getByRole("heading", { level: 3, name: /Noite nova/ })).toBeVisible();
  });

  test("«Publicar» num só passo vai para os próximos e para o site", async ({ page }) => {
    const servidor = await abrir(page, { inicial: eventosDeGestaoVazios() });
    await botao(page, T.novoEvento).tap();
    await preencher(page, { titulo: "Fado de sexta", data: "2026-11-06", hora: "22:00" });
    await botao(page, T.publicar).tap();

    expect(aoCorpo(pedidosDe(servidor, "POST")[0])).toEqual({
      titulo: "Fado de sexta",
      inicio: "2026-11-06T22:00:00Z",
      publicado: true,
    });
    await expect(aviso(page)).toContainText(T.eventoPublicadoNoSite);
    const site = await irParaOSite(page);
    await expect(site.getByRole("heading", { level: 3, name: /Fado de sexta/ })).toBeVisible();
  });

  test("rascunho sem data: o interruptor não faz pedido; a folha recusa «Publicar» sem data; com data, um PATCH {inicio, publicado: true}", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    const interruptor = page.getByRole("switch", { name: T.publicadoDe("Rascunho importado") });
    await expect(interruptor).toHaveAttribute("aria-disabled", "true");
    // O Playwright trata `aria-disabled` como «não está ativo» e esperava para sempre: o toque
    // tem de ser forçado para provar que o interruptor parado não faz pedido.
    await interruptor.tap({ force: true });
    expect(pedidosDe(servidor, "PATCH")).toHaveLength(0);

    await titulo(page, "Rascunho importado").tap();
    await botao(page, T.publicar).tap();
    await expect(folha(page, T.tituloEditar)).toContainText(T.erroPublicarSemData);
    await expect(campo(page, T.etiquetaData)).toBeFocused();
    expect(pedidosDe(servidor, "PATCH")).toHaveLength(0);

    await preencher(page, { data: "2026-11-20", hora: "22:00" });
    await botao(page, T.publicar).tap();
    const patches = pedidosDe(servidor, "PATCH");
    expect(patches).toHaveLength(1);
    expect(aoCorpo(patches[0])).toEqual({ inicio: "2026-11-20T22:00:00Z", publicado: true });
    await expect(page.getByRole("region", { name: T.proximos })).toContainText(
      "Rascunho importado",
    );
  });

  test("422 evento_sem_data injetado na folha: o erro na data com a frase própria, nunca a mensagem do backend", async ({
    page,
  }) => {
    await abrir(page, {
      falhas: [
        {
          metodo: "PATCH",
          caminho: /\/gestao\/eventos\/21$/,
          resposta: {
            estado: 422,
            corpo: {
              erro: "evento_sem_data",
              mensagem: "MENSAGEM-GENERICA-DO-BACKEND",
              campo: "inicio",
            },
          },
        },
      ],
    });
    await titulo(page, "Rascunho com data").tap();
    await botao(page, T.publicar).tap();

    await expect(folha(page, T.tituloEditar)).toContainText(T.erroPublicarSemData);
    await expect(page.locator("body")).not.toContainText("MENSAGEM-GENERICA-DO-BACKEND");
  });
});

test.describe("os três do site (a divisória)", () => {
  test("com quatro próximos a divisória está entre o 3.º e o 4.º; o site mostra os mesmos três", async ({
    page,
  }) => {
    await abrir(page);
    const itens = page.getByRole("region", { name: T.proximos }).getByRole("listitem");
    await expect(itens).toHaveCount(5);
    await expect(itens.nth(3)).toContainText(T.divisoria);
    await expect(itens.nth(2)).toContainText("Sessão de jazz");
    await expect(itens.nth(4)).toContainText("Concerto de teste");

    const site = await irParaOSite(page);
    await expect(site.getByRole("heading", { level: 3 })).toHaveCount(3);
    await expect(site.getByRole("heading", { level: 3, name: /Concerto de teste/ })).toHaveCount(0);
    await expect(site.getByText(TEXTOS_DOS_EVENTOS.maisEventos)).toBeVisible();
  });
});

for (const fuso of ["Asia/Tokyo", "America/Sao_Paulo"]) {
  test.describe(`o aparelho em ${fuso}: a hora escrita é a de Lisboa`, () => {
    test.use({ timezoneId: fuso });

    test("criar às 22:00 de 20/11 envia 22:00Z, a linha diz 22:00 e o aviso de fuso aparece", async ({
      page,
    }) => {
      const servidor = await abrir(page, { inicial: eventosDeGestaoVazios() });
      await botao(page, T.novoEvento).tap();
      await expect(folha(page, T.tituloCriar)).toContainText(T.avisoDeFuso);
      await preencher(page, { titulo: "Fado de Lisboa", data: "2026-11-20", hora: "22:00" });
      await botao(page, T.publicar).tap();

      expect(aoCorpo(pedidosDe(servidor, "POST")[0])).toMatchObject({
        inicio: "2026-11-20T22:00:00Z",
      });
      await expect(linha(page, "Fado de Lisboa")).toContainText(
        `Sexta-feira, 20 de novembro, ${T.comHora("22:00")}`,
      );
      await titulo(page, "Fado de Lisboa").tap();
      await expect(campo(page, T.etiquetaHora)).toHaveValue("22:00");
    });
  });
}

test.describe("404, regra 10 e 401", () => {
  test("404 num PATCH (interruptor): «já não existe» e recarga; 404 num DELETE: «Evento eliminado.»", async ({
    page,
  }) => {
    const servidor = await abrir(page, {
      falhas: [
        {
          metodo: "PATCH",
          caminho: /\/gestao\/eventos\/21$/,
          resposta: { estado: 404, corpo: { erro: "evento_inexistente", mensagem: "x" } },
        },
        {
          metodo: "DELETE",
          caminho: /\/gestao\/eventos\/11$/,
          resposta: { estado: 404, corpo: { erro: "evento_inexistente", mensagem: "x" } },
        },
      ],
    });
    const gets = () => pedidosDe(servidor, "GET", /\/gestao\/eventos$/).length;
    const antes = gets();
    await page.getByRole("switch", { name: T.publicadoDe("Rascunho com data") }).tap();
    await expect(aviso(page)).toContainText(T.jaNaoExiste);
    expect(gets()).toBeGreaterThan(antes);

    await titulo(page, "Fado ao vivo").tap();
    await botao(page, T.eliminarEvento).tap();
    await folha(page, T.tituloEliminar).getByRole("button", { name: T.eliminar }).tap();
    await expect(aviso(page)).toContainText(T.eventoEliminado);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("GET abortado: erro de ligação sem lista; «Tentar outra vez» traz a lista", async ({
    page,
  }) => {
    await abrir(page, {
      esperarLista: false,
      falhas: [{ metodo: "GET", caminho: /\/gestao\/eventos$/, ordem: 1, resposta: "abortar" }],
    });
    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await expect(page.getByText(T.carregarSemResposta)).toBeVisible();
    // Só no `<main>`: a barra de navegação da gestão também é uma lista (cinco `<li>`).
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);
    await expect(page.getByText(T.vazioTitulo)).toHaveCount(0);

    await botao(page, T.tentarOutraVez).tap();
    await expect(titulo(page, "Fado ao vivo")).toBeVisible();
  });

  test("POST abortado ao criar: um só pedido, a folha fica e diz que não encontrou o evento; nunca reenvia", async ({
    page,
  }) => {
    const servidor = await abrir(page, {
      inicial: eventosDeGestaoVazios(),
      falhas: [{ metodo: "POST", caminho: /\/gestao\/eventos$/, resposta: "abortar" }],
    });
    await botao(page, T.novoEvento).tap();
    await preencher(page, { titulo: "Noite incerta", data: "2026-11-20", hora: "22:00" });
    await botao(page, T.publicar).tap();

    await expect(folha(page, T.tituloCriar)).toContainText(T.criarNaoEncontrado);
    expect(pedidosDe(servidor, "POST")).toHaveLength(1);
    await expect(campo(page, T.etiquetaTitulo)).toHaveValue("Noite incerta");
  });

  test("DELETE abortado: recarrega e, como o evento continua lá, diz que não conseguiu eliminar", async ({
    page,
  }) => {
    const servidor = await abrir(page, {
      falhas: [{ metodo: "DELETE", caminho: /\/gestao\/eventos\/11$/, resposta: "abortar" }],
    });
    await titulo(page, "Fado ao vivo").tap();
    await botao(page, T.eliminarEvento).tap();
    await folha(page, T.tituloEliminar).getByRole("button", { name: T.eliminar }).tap();

    await expect(aviso(page)).toContainText(T.eliminarContinuaLa);
    expect(pedidosDe(servidor, "DELETE")).toHaveLength(1);
    await expect(titulo(page, "Fado ao vivo")).toBeVisible();
  });

  test("401 num PATCH: o login diz «A sessão terminou»; entrar volta a /gestao/eventos", async ({
    page,
  }) => {
    await abrir(page, {
      falhas: [
        {
          metodo: "PATCH",
          caminho: /\/gestao\/eventos\/21$/,
          resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
          fechaSessao: true,
        },
      ],
    });
    await page.getByRole("switch", { name: T.publicadoDe("Rascunho com data") }).tap();

    await expect(page.getByRole("heading", { level: 1, name: G.tituloDoLogin })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/entrar");
    await expect(page.getByText(E.sessaoTerminou)).toBeVisible();
    await entrar(page);
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/eventos");
  });
});

test.describe("sair da folha com alterações (a guarda)", () => {
  async function irParaEventos(page: Page): Promise<void> {
    await abrir(page, { caminho: "/gestao" });
    await navegacao(page).getByRole("link", { name: "Eventos" }).tap();
    await expect(page.getByRole("region", { name: T.proximos })).toBeVisible();
  }

  test("folha suja + Voltar: a pergunta; «Continuar a editar» fica; «Sair sem guardar» sai", async ({
    page,
  }) => {
    await irParaEventos(page);
    await titulo(page, "Fado ao vivo").tap();
    await campo(page, T.etiquetaTitulo).fill("Fado alterado");

    await page.goBack();
    await expect(folha(page, T.saidaTitulo)).toBeVisible();
    await expect(botao(page, T.saidaContinuar)).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/eventos");

    await botao(page, T.saidaContinuar).tap();
    await expect(folha(page, T.saidaTitulo)).toHaveCount(0);
    await expect(campo(page, T.etiquetaTitulo)).toHaveValue("Fado alterado");

    await page.goBack();
    await botao(page, T.saidaSair).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao");
  });

  test("folha limpa: o Voltar sai direto", async ({ page }) => {
    await irParaEventos(page);
    await titulo(page, "Fado ao vivo").tap();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

for (const [largura, altura] of [
  [390, 844],
  [1024, 768],
] as const) {
  test.describe(`o axe em todos os estados, a ${String(largura)} × ${String(altura)}`, () => {
    test.use({ viewport: { width: largura, height: altura } });
    const tocar = (l: Locator) => (largura === 390 ? l.tap() : l.click());

    test("lista com as três partes e o arquivo aberto; vazio; erro", async ({ page }) => {
      await abrir(page);
      await semViolacoesGraves(page, "lista");
      await tocar(botao(page, T.verOArquivo(2)));
      await semViolacoesGraves(page, "arquivo aberto");
    });

    test("vazio", async ({ page }) => {
      await abrir(page, { inicial: eventosDeGestaoVazios() });
      await expect(page.getByText(T.vazioTitulo)).toBeVisible();
      await semViolacoesGraves(page, "vazio");
    });

    test("erro de carregar", async ({ page }) => {
      await abrir(page, {
        esperarLista: false,
        falhas: [
          {
            metodo: "GET",
            caminho: /\/gestao\/eventos$/,
            resposta: { estado: 500, corpo: { erro: "x", mensagem: "x" } },
          },
        ],
      });
      await expect(page.getByText(T.carregarServidor)).toBeVisible();
      await semViolacoesGraves(page, "erro");
    });

    test("folha de criar com erros, folha de editar, duplicar, eliminar e aviso com «Desfazer»", async ({
      page,
    }) => {
      await abrir(page);
      await tocar(botao(page, T.novoEvento));
      await tocar(botao(page, T.publicar));
      await expect(folha(page, T.tituloCriar)).toContainText(T.erroTituloVazio);
      await semViolacoesGraves(page, "criar com erros");
      await tocar(botao(page, T.cancelar));

      await tocar(titulo(page, "Fado ao vivo"));
      await semViolacoesGraves(page, "editar");
      await tocar(botao(page, T.eliminarEvento));
      await semViolacoesGraves(page, "eliminar");
      await tocar(folha(page, T.tituloEliminar).getByRole("button", { name: T.cancelar }));
      await tocar(botao(page, T.cancelar));

      await tocar(page.getByRole("button", { name: T.duplicarDe("Fado ao vivo") }));
      await expect(folha(page, T.tituloDuplicar)).toBeVisible();
      await semViolacoesGraves(page, "duplicar");
      await tocar(page.getByRole("button", { name: new RegExp(T.daquiASemanas(1)) }));
      await expect(aviso(page).getByRole("button", { name: T.desfazer })).toBeVisible();
      await semViolacoesGraves(page, "aviso com desfazer");
    });
  });
}

test.describe("alvos de 44 × 44 (Q-04) e foco visível, a 390 × 844", () => {
  async function exigir44(nome: string, alvo: Locator): Promise<void> {
    // A folha sobe com uma animação: medir a meio dá ruído de vírgula flutuante (43,99994).
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
    expect(caixa?.height ?? 0, `${nome}: altura`).toBeGreaterThanOrEqual(44);
    expect(caixa?.width ?? 0, `${nome}: largura`).toBeGreaterThanOrEqual(44);
  }

  test("Novo evento, título, interruptor (a linha inteira), Duplicar, arquivo e os botões e campos das folhas", async ({
    page,
  }) => {
    await abrir(page);
    await exigir44("Novo evento", botao(page, T.novoEvento));
    await exigir44("título da linha", titulo(page, "Fado ao vivo"));
    await exigir44(
      "interruptor",
      page
        .locator("label")
        .filter({ has: page.getByRole("switch", { name: T.publicadoDe("Fado ao vivo") }) }),
    );
    await exigir44("Duplicar", page.getByRole("button", { name: T.duplicarDe("Fado ao vivo") }));
    await exigir44("Ver o arquivo", botao(page, T.verOArquivo(2)));

    await titulo(page, "Rascunho com data").tap();
    for (const etiqueta of [
      T.etiquetaTitulo,
      T.etiquetaDescricao,
      T.etiquetaData,
      T.etiquetaHora,
    ]) {
      await exigir44(etiqueta, campo(page, etiqueta));
    }
    for (const nome of [T.publicar, T.guardarRascunho, T.cancelar, T.eliminarEvento]) {
      await exigir44(nome, botao(page, nome));
    }
    await campo(page, T.etiquetaTitulo).fill("x");
    await botao(page, T.cancelar).tap();
    for (const nome of [T.saidaSair, T.saidaContinuar]) await exigir44(nome, botao(page, nome));
    await botao(page, T.saidaSair).tap();

    await page.getByRole("button", { name: T.duplicarDe("Fado ao vivo") }).tap();
    for (const n of [1, 2, 3]) {
      await exigir44(
        `opção ${String(n)}`,
        page.getByRole("button", { name: new RegExp(T.daquiASemanas(n)) }),
      );
    }
    await page.getByRole("button", { name: new RegExp(T.daquiASemanas(1)) }).tap();
    await exigir44("Desfazer", aviso(page).getByRole("button", { name: T.desfazer }));
  });

  test("foco visível nos campos e nos botões da folha", async ({ page }) => {
    await abrir(page);
    await titulo(page, "Rascunho com data").tap();
    for (const alvo of [
      campo(page, T.etiquetaTitulo),
      campo(page, T.etiquetaData),
      campo(page, T.etiquetaHora),
      botao(page, T.publicar),
    ]) {
      await focarPorTeclado(page, alvo);
      const visivel = await alvo.evaluate((el) => {
        const e = getComputedStyle(el);
        return (
          (e.outlineStyle !== "none" && parseFloat(e.outlineWidth) > 0) || e.boxShadow !== "none"
        );
      });
      expect(visivel, "o anel de foco tem de se ver").toBe(true);
    }
  });

  test("nenhum atributo `style` no DOM, nem com as folhas abertas", async ({ page }) => {
    await abrir(page);
    expect(await semEstilo(page)).toBe(0);
    await titulo(page, "Fado ao vivo").tap();
    expect(await semEstilo(page)).toBe(0);
    await botao(page, T.eliminarEvento).tap();
    expect(await semEstilo(page)).toBe(0);
  });
});
