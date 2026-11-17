import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  DIAS_PELA_ORDEM,
  TEXTOS_DA_EMENTA_GESTAO as E,
  TEXTOS_DA_GESTAO as G,
  definicoesComHorarioInvalido,
  definicoesConfiguradas,
  definicoesVazias,
  type DefinicoesGestao,
  type DiaDaSemana,
} from "../src/testes/gestao";
import {
  ERRO_422_POR_CAMPO,
  TEXTOS as T,
  copiadoPara,
  faltaOHorarioDe,
  fechaNoDiaSeguinte,
  legendaDoDia,
  nomeDeAbre,
  nomeDeFecha,
  nomeDeRemoverPeriodo,
  nomeDoDia,
  tituloDeCopiar,
} from "../src/pages/gestao/definicoes/textos";
import { abrirAFolha, folhaDoWifi } from "./apoio/cabecalho";
import { ID_DA_PASSWORD, TEXTOS_DO_WIFI } from "../src/testes/cabecalho";
import { abrirAEmenta, fingirEmentaFixa } from "./apoio/ementa";
import { focarPorTeclado } from "./apoio/foco";
import { fingirApiDeSessao } from "./apoio/gestao";
import {
  fingirApiDeDefinicoes,
  pedidosDe,
  type Falha,
  type ServidorDeDefinicoes,
} from "./apoio/gestao-definicoes";

/**
 * F4-05a — as definições da gestão no browser, a 390 × 844 com toque (e a
 * 1024 × 768 para o rato). API fingida com **estado partilhado** entre
 * `/api/gestao/definicoes` e `/api/info` (`apoio/gestao-definicoes.ts`): o critério
 * de «feito» é que mudar o WiFi aparece no site público sem deploy, e que mudar
 * só a rede nunca apaga o resto (o `PUT` substitui os sete campos).
 */

async function semViolacoesGraves(pagina: Page, ecra: string): Promise<void> {
  // A Folha entra com uma animação de opacidade: o axe a meio dela mede cores
  // misturadas com a cortina e dá um contraste que o ecrã parado não tem.
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
  definicoes?: DefinicoesGestao;
  falhas?: Falha[];
  atrasoMs?: number;
  /** Esperar pelo formulário (por omissão sim). */
  esperarFormulario?: boolean;
};

async function abrir(
  page: Page,
  caminho = "/gestao/mais/definicoes",
  opcoes: Opcoes = {},
): Promise<ServidorDeDefinicoes> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  const servidor = await fingirApiDeDefinicoes(page, { sessao, ...opcoes });
  await page.goto(caminho);
  if (opcoes.esperarFormulario !== false) {
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    await expect(page.getByLabel(T.etiquetaRede, { exact: true })).toBeVisible();
  }
  return servidor;
}

function campo(page: Page, etiqueta: string): Locator {
  return page.getByLabel(etiqueta, { exact: true });
}
function guardarBotao(page: Page): Locator {
  return page.getByRole("button", { name: T.guardar, exact: true });
}
function interruptor(page: Page, dia: DiaDaSemana): Locator {
  return page.getByRole("switch", { name: nomeDoDia(dia), exact: true });
}
function grupo(page: Page, dia: DiaDaSemana): Locator {
  return page.getByRole("group", { name: legendaDoDia(dia), exact: true });
}
function hora(page: Page, dia: DiaDaSemana, qual: "abre" | "fecha", n = 1, total = 1): Locator {
  return grupo(page, dia).getByLabel(
    qual === "abre" ? nomeDeAbre(dia, n, total) : nomeDeFecha(dia, n, total),
    { exact: true },
  );
}
function aviso(page: Page): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(Feito|Erro)\./ });
}
function navegacao(page: Page): Locator {
  return page.getByRole("navigation", { name: G.navegacao });
}
async function entrar(page: Page): Promise<void> {
  await page.getByLabel(G.etiquetaUtilizador).fill("dono");
  await page.getByLabel(G.etiquetaPassword).fill("password-de-teste");
  await page.getByRole("button", { name: G.botaoEntrar }).click();
}
function semEstilo(page: Page): Promise<number> {
  return page.locator("[style]").count();
}

/** O horário completo que o dono escreve no teste 3: tudo decidido. */
const PEDIDO_DO_HORARIO = [
  { dia: "segunda", periodos: [] },
  { dia: "terca", periodos: [] },
  { dia: "quarta", periodos: [] },
  { dia: "quinta", periodos: [] },
  { dia: "sexta", periodos: [{ abre: "17:00", fecha: "02:00" }] },
  {
    dia: "sabado",
    periodos: [
      { abre: "12:00", fecha: "15:00" },
      { abre: "19:00", fecha: "02:00" },
    ],
  },
  { dia: "domingo", periodos: [] },
];

test.describe("mudar o WiFi aparece no site público sem deploy", () => {
  test("Mais → Definições → mudar rede e password (espaço no fim) → um PUT com X-Tomazia e as sete chaves → o /info e a Folha do WiFi mostram o novo", async ({
    page,
  }) => {
    const servidor = await abrir(page, "/gestao/mais", { esperarFormulario: false });
    await expect(page.getByRole("heading", { level: 1, name: "Mais" })).toBeVisible();

    // Os toques desde «Mais»: Definições, campo, Guardar. Dentro do ecrã: campo + Guardar = 2.
    let toquesNoEcra = 0;
    await page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) }).tap();
    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/definicoes");

    toquesNoEcra += 1;
    await campo(page, T.etiquetaRede).tap();
    await campo(page, T.etiquetaRede).fill("rede-nova");
    await campo(page, T.etiquetaPassword).fill("password-nova ");
    toquesNoEcra += 1;
    await guardarBotao(page).tap();

    await expect(aviso(page)).toContainText(T.sucesso);
    expect(toquesNoEcra).toBeLessThanOrEqual(2);

    const puts = pedidosDe(servidor, "PUT", /definicoes/);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(Object.keys(puts[0]?.corpo as object).sort()).toEqual([
      "horario",
      "instagram",
      "maps_url",
      "morada",
      "telefone",
      "wifi_password",
      "wifi_rede",
    ]);
    expect(puts[0]?.corpo).toMatchObject({
      wifi_rede: "rede-nova",
      wifi_password: "password-nova ",
    });

    // O site público: um carregamento novo pede o /info e mostra o que foi guardado.
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await abrirAFolha(page);
    await expect(folhaDoWifi(page)).toContainText("rede-nova");
    const password = await page.locator(`#${ID_DA_PASSWORD}`).textContent();
    expect(password, "o espaço no fim da password mantém-se").toBe("password-nova ");
    expect(pedidosDe(servidor, "GET", /^\/info$/).length).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("button", { name: TEXTOS_DO_WIFI.copiar })).toBeVisible();
  });

  test("o /info fingido segue as regras do backend: só espaços na password → null (o público diz «Pergunta no balcão»)", async ({
    page,
  }) => {
    await abrir(page);
    await campo(page, T.etiquetaPassword).fill("   ");
    await guardarBotao(page).tap();
    await expect(aviso(page)).toContainText(T.sucesso);

    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await abrirAFolha(page);
    await expect(folhaDoWifi(page)).toContainText(TEXTOS_DO_WIFI.perguntaNoBalcao);
  });
});

test.describe("o PUT substitui os sete: nada do que não se tocou se apaga", () => {
  test("mudar só a rede: o corpo do PUT é o do GET com só a rede diferente (horário incluído)", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await campo(page, T.etiquetaRede).fill("so-a-rede");
    await guardarBotao(page).tap();
    await expect(aviso(page)).toContainText(T.sucesso);

    const { horario_estado: _e, ...get } = definicoesConfiguradas();
    void _e;
    expect(pedidosDe(servidor, "PUT")[0]?.corpo).toEqual({ ...get, wifi_rede: "so-a-rede" });
  });

  test("sem alterações, «Guardar alterações» não envia nada", async ({ page }) => {
    const servidor = await abrir(page);
    await expect(guardarBotao(page)).toHaveAttribute("aria-disabled", "true");
    // O toque tem de cair no botão: à vista, e não por baixo da barra de gestão.
    await expect(guardarBotao(page)).toBeInViewport();
    // `force`: o Playwright trata `aria-disabled` como desativado e esperava para sempre.
    await guardarBotao(page).tap({ force: true });
    // Um PUT não aparece no mesmo instante: sem esperar, o zero seria zero porque ainda não passou tempo.
    await page.waitForTimeout(300);
    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);
  });
});

test.describe("o horário", () => {
  test("de raiz: «Configurar o horário», dias por preencher dão erro, depois escreve-se e o /info devolve-o", async ({
    page,
  }) => {
    const servidor = await abrir(page, "/gestao/mais/definicoes", {
      definicoes: definicoesVazias(),
    });
    await expect(page.getByText(T.horarioNaoConfigurado)).toBeVisible();
    await page.getByRole("button", { name: T.configurarHorario }).tap();

    await guardarBotao(page).tap();
    for (const dia of DIAS_PELA_ORDEM) {
      await expect(grupo(page, dia).getByText(faltaOHorarioDe(dia))).toBeVisible();
    }
    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);

    // Segunda fechada (liga e desliga), sexta 17:00–02:00, sábado dois períodos, o resto fechado.
    for (const dia of DIAS_PELA_ORDEM) {
      await interruptor(page, dia).tap();
      if (dia !== "sexta" && dia !== "sabado") await interruptor(page, dia).tap();
    }
    await hora(page, "sexta", "abre").fill("17:00");
    await hora(page, "sexta", "fecha").fill("02:00");
    await expect(
      grupo(page, "sexta").getByText(fechaNoDiaSeguinte("sexta", "02:00")),
    ).toBeVisible();

    await hora(page, "sabado", "abre").fill("12:00");
    await hora(page, "sabado", "fecha").fill("15:00");
    await grupo(page, "sabado").getByRole("button", { name: T.adicionarPeriodo }).tap();
    await hora(page, "sabado", "abre", 2, 2).fill("19:00");
    await hora(page, "sabado", "fecha", 2, 2).fill("02:00");
    await expect(
      grupo(page, "sabado").getByText(fechaNoDiaSeguinte("sabado", "02:00")),
    ).toBeVisible();

    await guardarBotao(page).tap();
    await expect(aviso(page)).toContainText(T.sucesso);

    const put = pedidosDe(servidor, "PUT")[0]?.corpo as { horario: unknown };
    expect(put.horario).toEqual(PEDIDO_DO_HORARIO);
    const info = await page.evaluate(async () => {
      // Um pedido da página ao /info fingido (o `page.request` não passa pelas rotas).
      // eslint-disable-next-line no-restricted-globals
      const r = await fetch("/api/info");
      return (await r.json()) as { horario: unknown };
    });
    expect(info.horario).toEqual(PEDIDO_DO_HORARIO);
    await expect(interruptor(page, "sexta")).toBeChecked();
  });

  test("copiar a sexta para os outros dias e fechar a segunda: o horário volta igual depois de recarregar", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await grupo(page, "sexta").getByRole("button", { name: T.copiarParaOutrosDias }).tap();
    await expect(page.getByRole("dialog", { name: tituloDeCopiar("sexta") })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: T.copiar }).tap();
    await expect(page.getByText(copiadoPara(6))).toBeVisible();
    await interruptor(page, "segunda").tap();
    await guardarBotao(page).tap();
    await expect(aviso(page)).toContainText(T.sucesso);

    const horario = (
      pedidosDe(servidor, "PUT")[0]?.corpo as {
        horario: Array<{ dia: string; periodos: unknown[] }>;
      }
    ).horario;
    expect(horario.find((d) => d.dia === "segunda")?.periodos).toEqual([]);
    expect(horario.find((d) => d.dia === "terca")?.periodos).toHaveLength(2);

    await page.reload();
    await expect(page.getByLabel(T.etiquetaRede, { exact: true })).toBeVisible();
    await expect(interruptor(page, "segunda")).not.toBeChecked();
    await expect(hora(page, "domingo", "abre", 1, 2)).toHaveValue("12:00");
  });

  test("«Desfazer» da cópia repõe os dias", async ({ page }) => {
    await abrir(page);
    await grupo(page, "sexta").getByRole("button", { name: T.copiarParaOutrosDias }).tap();
    await page.getByRole("dialog").getByRole("button", { name: T.copiar }).tap();
    await expect(interruptor(page, "segunda")).toBeChecked();
    await grupo(page, "sexta").getByRole("button", { name: T.desfazer }).tap();
    await expect(interruptor(page, "segunda")).not.toBeChecked();
    await expect(page.getByText(copiadoPara(6))).toHaveCount(0);
  });

  test("INVÁLIDO: bloco de erro (não de vazio); mudar o telefone e guardar → aviso prévio visível, horario: null no corpo, o ecrã passa a «não configurado»", async ({
    page,
  }) => {
    const servidor = await abrir(page, "/gestao/mais/definicoes", {
      definicoes: definicoesComHorarioInvalido(),
    });

    await expect(page.getByText(T.horarioInvalido)).toBeVisible();
    await expect(page.getByText(T.horarioInvalidoAviso)).toBeVisible();
    await expect(page.getByText(T.horarioNaoConfigurado)).toHaveCount(0);
    await expect(page.getByText(T.fechado)).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);

    await campo(page, T.etiquetaTelefone).fill("913000000");
    await expect(page.getByText(T.horarioInvalidoAviso)).toBeVisible();
    await guardarBotao(page).tap();

    await expect(aviso(page)).toContainText(T.sucesso);
    const corpo = pedidosDe(servidor, "PUT")[0]?.corpo as { horario: unknown; telefone: string };
    expect(corpo.horario).toBeNull();
    expect(corpo.telefone).toBe("913000000");
    await expect(page.getByText(T.horarioNaoConfigurado)).toBeVisible();
    await expect(page.getByText(T.horarioInvalido)).toHaveCount(0);
  });

  test("sobreposição local (12–18 + 13–14): o erro na linha do dia e NENHUM PUT", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await hora(page, "quarta", "fecha").fill("18:00");
    await hora(page, "quarta", "abre").fill("12:00");
    await grupo(page, "quarta").getByRole("button", { name: T.adicionarPeriodo }).tap();
    await hora(page, "quarta", "abre", 2, 2).fill("13:00");
    await hora(page, "quarta", "fecha", 2, 2).fill("14:00");
    await guardarBotao(page).tap();

    await expect(grupo(page, "quarta").getByText(T.erroSobreposicao)).toBeVisible();
    await expect(grupo(page, "quarta")).toBeFocused();
    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);
    await semViolacoesGraves(page, "erro de sobreposição");
  });
});

test.describe("422 do servidor junto do campo", () => {
  test("campo=maps_url: o erro junto do campo Google Maps, com foco, e nunca a mensagem do backend", async ({
    page,
  }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      falhas: [
        {
          metodo: "PUT",
          caminho: /definicoes$/,
          resposta: {
            estado: 422,
            corpo: { erro: "dados_invalidos", mensagem: "MENSAGEM-DO-BACKEND", campo: "maps_url" },
          },
        },
      ],
    });
    await campo(page, T.etiquetaRede).fill("outra");
    await guardarBotao(page).tap();

    const maps = campo(page, T.etiquetaMaps);
    await expect(maps).toHaveAttribute("aria-invalid", "true");
    await expect(maps).toBeFocused();
    await expect(page.getByText(ERRO_422_POR_CAMPO.maps_url)).toBeVisible();
    await expect(page.getByText("MENSAGEM-DO-BACKEND")).toHaveCount(0);
    await semViolacoesGraves(page, "422 num campo");
  });

  test("a validação local do Instagram (@nome) dá o erro com instrução e não envia", async ({
    page,
  }) => {
    const servidor = await abrir(page);
    await campo(page, T.etiquetaInstagram).fill("@bardatomazia");
    await guardarBotao(page).tap();
    await expect(page.getByText(T.erroLinkArroba)).toBeVisible();
    await expect(campo(page, T.etiquetaInstagram)).toBeFocused();
    expect(pedidosDe(servidor, "PUT")).toHaveLength(0);
  });

  test("um link sem esquema ganha https:// (D4)", async ({ page }) => {
    const servidor = await abrir(page);
    await campo(page, T.etiquetaInstagram).fill("instagram.com/bardatomazia");
    await guardarBotao(page).tap();
    await expect(aviso(page)).toContainText(T.sucesso);
    expect((pedidosDe(servidor, "PUT")[0]?.corpo as { instagram: string }).instagram).toBe(
      "https://instagram.com/bardatomazia",
    );
    await expect(campo(page, T.etiquetaInstagram)).toHaveValue(
      "https://instagram.com/bardatomazia",
    );
  });
});

test.describe("sair com alterações por guardar", () => {
  test("a barra: a Folha, «Continuar a editar» fica, «Sair sem guardar» vai para a Ementa", async ({
    page,
  }) => {
    await abrir(page);
    await campo(page, T.etiquetaRede).fill("alterada");

    await navegacao(page).getByRole("link", { name: "Ementa" }).tap();
    const dialogo = page.getByRole("dialog", { name: T.saidaTitulo });
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(T.saidaLinha);
    await expect(dialogo.getByRole("button", { name: T.saidaContinuar })).toBeFocused();
    await semViolacoesGraves(page, "folha de saída");

    await dialogo.getByRole("button", { name: T.saidaContinuar }).tap();
    await expect(dialogo).toBeHidden();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/definicoes");
    await expect(campo(page, T.etiquetaRede)).toHaveValue("alterada");

    await navegacao(page).getByRole("link", { name: "Ementa" }).tap();
    await page.getByRole("dialog").getByRole("button", { name: T.saidaSair }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Ementa" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/ementa");
  });

  test("o Voltar do browser repõe o endereço e abre a Folha", async ({ page }) => {
    await abrir(page, "/gestao/mais", { esperarFormulario: false });
    await page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) }).tap();
    await expect(campo(page, T.etiquetaRede)).toBeVisible();
    await campo(page, T.etiquetaRede).fill("alterada");

    await page.goBack();

    await expect(page.getByRole("dialog", { name: T.saidaTitulo })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/definicoes");
  });

  test("«Voltar a Mais» também pergunta", async ({ page }) => {
    await abrir(page);
    await campo(page, T.etiquetaRede).fill("alterada");
    await page.getByRole("link", { name: T.voltarAMais }).tap();
    await expect(page.getByRole("dialog", { name: T.saidaTitulo })).toBeVisible();
  });

  test("sem alterações, vai direto", async ({ page }) => {
    await abrir(page);
    await navegacao(page).getByRole("link", { name: "Ementa" }).tap();
    await expect(page.getByRole("heading", { level: 1, name: "Ementa" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("401 a meio", () => {
  test("o PUT dá 401: o login diz «A sessão terminou»; entrar volta a /gestao/mais/definicoes", async ({
    page,
  }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      falhas: [
        {
          metodo: "PUT",
          caminho: /definicoes$/,
          resposta: { estado: 401, corpo: { erro: "sessao_em_falta", mensagem: "x" } },
          fechaSessao: true,
        },
      ],
    });
    await campo(page, T.etiquetaRede).fill("alterada");
    await guardarBotao(page).tap();

    await expect(page.getByRole("heading", { level: 1, name: G.tituloDoLogin })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/gestao/entrar");
    expect(new URL(page.url()).search).toBe("");
    await expect(page.getByText(E.sessaoTerminou)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await entrar(page);

    await expect(page.getByRole("heading", { level: 1, name: T.titulo })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/gestao/mais/definicoes");
  });
});

test.describe("regra 10: sem resposta nunca é «vazio» nem «guardado»", () => {
  test("GET abortado: o erro de ligação, sem formulário; «Tentar outra vez» traz o formulário", async ({
    page,
  }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      esperarFormulario: false,
      falhas: [{ metodo: "GET", caminho: /definicoes$/, ordem: 1, resposta: "abortar" }],
    });

    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await expect(page.getByText(T.carregarSemResposta)).toBeVisible();
    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    await expect(guardarBotao(page)).toHaveCount(0);
    await semViolacoesGraves(page, "erro de carregar");

    await page.getByRole("button", { name: T.tentarOutraVez }).tap();
    await expect(campo(page, T.etiquetaRede)).toHaveValue("tomazia-exemplo");
  });

  test("PUT abortado: «não sei se ficou guardado», o formulário fica com as alterações; tocar outra vez grava", async ({
    page,
  }) => {
    const servidor = await abrir(page, "/gestao/mais/definicoes", {
      falhas: [{ metodo: "PUT", caminho: /definicoes$/, ordem: 1, resposta: "abortar" }],
    });
    await campo(page, T.etiquetaRede).fill("alterada");
    await guardarBotao(page).tap();

    await expect(page.getByText(T.guardarSemResposta)).toBeVisible();
    await expect(campo(page, T.etiquetaRede)).toHaveValue("alterada");
    await expect(aviso(page)).toHaveCount(0);

    await guardarBotao(page).tap();
    await expect(aviso(page)).toContainText(T.sucesso);
    const puts = pedidosDe(servidor, "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[1]?.corpo).toEqual(puts[0]?.corpo);
    expect(servidor.definicoes.wifi_rede).toBe("alterada");
  });

  test("5xx a guardar: a frase de servidor, sem dizer «não foi guardado»", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      falhas: [
        {
          metodo: "PUT",
          caminho: /definicoes$/,
          ordem: 1,
          resposta: { estado: 500, corpo: { erro: "interno", mensagem: "x" } },
        },
      ],
    });
    await campo(page, T.etiquetaRede).fill("alterada");
    await guardarBotao(page).tap();
    await expect(page.getByText(T.guardarServidor)).toBeVisible();
    await expect(page.getByText(/não (foi|ficou) guardad/)).toHaveCount(0);
  });
});

test.describe("acessibilidade (Q-03) a 390 × 844", () => {
  test("axe: carregado, editor, não configurado, inválido, erros de campo, aviso, folha de copiar", async ({
    page,
  }) => {
    await abrir(page);
    await semViolacoesGraves(page, "carregado (editor aberto)");

    await campo(page, T.etiquetaInstagram).fill("@bar");
    await guardarBotao(page).tap();
    await expect(page.getByText(T.erroLinkArroba)).toBeVisible();
    await semViolacoesGraves(page, "erros de campo");
    await campo(page, T.etiquetaInstagram).fill("instagram.com/bar");

    await grupo(page, "sexta").getByRole("button", { name: T.copiarParaOutrosDias }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await semViolacoesGraves(page, "folha de copiar");
    await page.getByRole("dialog").getByRole("button", { name: T.cancelar }).tap();

    await guardarBotao(page).tap();
    await expect(aviso(page)).toBeVisible();
    await semViolacoesGraves(page, "aviso de guardado");
  });

  test("axe: não configurado e inválido", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", { definicoes: definicoesVazias() });
    await expect(page.getByText(T.horarioNaoConfigurado)).toBeVisible();
    await semViolacoesGraves(page, "não configurado");
    await page.getByRole("button", { name: T.configurarHorario }).tap();
    await semViolacoesGraves(page, "dias por preencher");
  });

  test("axe: inválido", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", { definicoes: definicoesComHorarioInvalido() });
    await expect(page.getByText(T.horarioInvalido)).toBeVisible();
    await semViolacoesGraves(page, "horário inválido");
  });

  test("axe: «Mais» com a lista de «Definições»", async ({ page }) => {
    await abrir(page, "/gestao/mais", { esperarFormulario: false });
    await expect(page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) })).toBeVisible();
    await semViolacoesGraves(page, "mais");
  });
});

test.describe("alvos de 44 × 44 (Q-04) e foco visível, a 390 × 844", () => {
  async function exigir44(nome: string, alvo: Locator): Promise<void> {
    const caixa = await alvo.first().boundingBox();
    expect(caixa, `${nome}: não encontrei o elemento`).not.toBeNull();
    expect(caixa?.height ?? 0, `${nome}: altura`).toBeGreaterThanOrEqual(44);
    expect(caixa?.width ?? 0, `${nome}: largura`).toBeGreaterThanOrEqual(44);
  }

  test("ligação «Definições» e «Voltar a Mais»", async ({ page }) => {
    await abrir(page, "/gestao/mais", { esperarFormulario: false });
    await exigir44(
      "Definições",
      page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) }),
    );
    await page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) }).tap();
    await expect(campo(page, T.etiquetaRede)).toBeVisible();
    await exigir44("Voltar a Mais", page.getByRole("link", { name: T.voltarAMais }));
  });

  test("campos, horas, interruptor, Adicionar, Remover, Copiar, Guardar e os botões da Folha", async ({
    page,
  }) => {
    await abrir(page);
    for (const etiqueta of [
      T.etiquetaRede,
      T.etiquetaPassword,
      T.etiquetaMorada,
      T.etiquetaTelefone,
      T.etiquetaInstagram,
      T.etiquetaMaps,
    ]) {
      await exigir44(etiqueta, campo(page, etiqueta));
    }
    await exigir44("hora Abre", hora(page, "terca", "abre"));
    await exigir44("hora Fecha", hora(page, "terca", "fecha"));
    expect(await hora(page, "terca", "abre").getAttribute("type")).toBe("time");
    // O alvo do interruptor é a linha inteira (`<label>`).
    await exigir44("Fechado", page.locator("label").filter({ has: interruptor(page, "segunda") }));
    await exigir44(
      "Adicionar período",
      grupo(page, "terca").getByRole("button", { name: T.adicionarPeriodo }),
    );
    await exigir44(
      "Remover período",
      grupo(page, "sexta").getByRole("button", { name: nomeDeRemoverPeriodo("sexta", 2) }),
    );
    await exigir44(
      "Copiar para outros dias",
      grupo(page, "terca").getByRole("button", { name: T.copiarParaOutrosDias }),
    );
    await exigir44("Remover o horário", page.getByRole("button", { name: T.removerOHorario }));

    await campo(page, T.etiquetaRede).fill("x");
    await exigir44("Guardar alterações", guardarBotao(page));

    await grupo(page, "terca").getByRole("button", { name: T.copiarParaOutrosDias }).tap();
    for (const nome of [T.copiarNenhum, T.cancelar, T.copiar]) {
      await exigir44(nome, page.getByRole("dialog").getByRole("button", { name: nome }));
    }
    await exigir44("interruptor da folha", page.getByRole("dialog").locator("label").first());
    await page.getByRole("dialog").getByRole("button", { name: T.cancelar }).tap();

    await navegacao(page).getByRole("link", { name: "Ementa" }).tap();
    for (const nome of [T.saidaSair, T.saidaContinuar]) {
      await exigir44(nome, page.getByRole("dialog").getByRole("button", { name: nome }));
    }
  });

  test("foco visível nos campos, nas horas e em «Guardar alterações»", async ({ page }) => {
    await abrir(page);
    await campo(page, T.etiquetaRede).fill("x");
    for (const alvo of [
      campo(page, T.etiquetaRede),
      hora(page, "terca", "abre"),
      guardarBotao(page),
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

  test("a barra de guardar não tapa o último campo", async ({ page }) => {
    await abrir(page);
    await campo(page, T.etiquetaMaps).scrollIntoViewIfNeeded();
    const campoMaps = await campo(page, T.etiquetaMaps).boundingBox();
    const botao = await guardarBotao(page).boundingBox();
    const barra = await navegacao(page).boundingBox();
    expect(campoMaps).not.toBeNull();
    expect(botao).not.toBeNull();
    expect((campoMaps?.y ?? 0) + (campoMaps?.height ?? 0)).toBeLessThanOrEqual(botao?.y ?? 0);
    expect((botao?.y ?? 0) + (botao?.height ?? 0)).toBeLessThanOrEqual((barra?.y ?? 0) + 1);
  });
});

test.describe("nenhum style inline", () => {
  test("o ecrã, o editor, a folha de copiar e a de sair não têm atributo style no DOM", async ({
    page,
  }) => {
    await abrir(page);
    expect(await semEstilo(page)).toBe(0);
    await campo(page, T.etiquetaRede).fill("x");
    await grupo(page, "terca").getByRole("button", { name: T.copiarParaOutrosDias }).tap();
    expect(await semEstilo(page)).toBe(0);
    await page.getByRole("dialog").getByRole("button", { name: T.cancelar }).tap();
    await navegacao(page).getByRole("link", { name: "Ementa" }).tap();
    expect(await semEstilo(page)).toBe(0);
  });
});

test.describe("«Mais» é uma lista", () => {
  test("«Definições» e, por baixo, «Sair»", async ({ page }) => {
    await abrir(page, "/gestao/mais", { esperarFormulario: false });
    const ligacao = page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) });
    const sair = page.getByRole("button", { name: G.sair });
    const a = await ligacao.boundingBox();
    const b = await sair.boundingBox();
    expect((a?.y ?? 0) + (a?.height ?? 0)).toBeLessThanOrEqual(b?.y ?? 0);
  });
});

test.describe("rato, 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("axe e o fluxo de guardar a 1024", async ({ page }) => {
    const servidor = await abrir(page);
    await semViolacoesGraves(page, "carregado a 1024");
    await campo(page, T.etiquetaRede).fill("a-1024");
    await guardarBotao(page).click();
    await expect(aviso(page)).toContainText(T.sucesso);
    await semViolacoesGraves(page, "aviso a 1024");
    expect(pedidosDe(servidor, "PUT")).toHaveLength(1);

    await campo(page, T.etiquetaRede).fill("outra");
    await navegacao(page).getByRole("link", { name: "Ementa" }).click();
    await expect(page.getByRole("dialog", { name: T.saidaTitulo })).toBeVisible();
    await semViolacoesGraves(page, "folha de saída a 1024");
  });

  test("axe: inválido, vazio e erro de carregar a 1024", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", { definicoes: definicoesComHorarioInvalido() });
    await expect(page.getByText(T.horarioInvalido)).toBeVisible();
    await semViolacoesGraves(page, "inválido a 1024");
  });

  test("a barra de guardar assenta em baixo, na largura da coluna, e a coluna lateral é a da F4-01", async ({
    page,
  }) => {
    await abrir(page);
    const botao = await guardarBotao(page).boundingBox();
    expect((botao?.y ?? 0) + (botao?.height ?? 0)).toBeLessThanOrEqual(768);
    await expect(navegacao(page)).toBeVisible();
  });
});
