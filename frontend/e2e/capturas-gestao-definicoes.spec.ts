import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  TEXTOS as T,
  copiadoPara,
  legendaDoDia,
  nomeDoDia,
} from "../src/pages/gestao/definicoes/textos";
import {
  definicoesComHorarioInvalido,
  definicoesConfiguradas,
  definicoesVazias,
  type DefinicoesGestao,
} from "../src/testes/gestao";
import { guardar } from "./apoio/capturas";
import { fingirApiDeSessao } from "./apoio/gestao";
import { fingirApiDeDefinicoes, type Falha } from "./apoio/gestao-definicoes";

/**
 * F4-05a — as capturas que a revisão ui-ux e o PR abrem (390 × 844 e 1024 × 768).
 * Não comparam com imagem de referência. Vão para `test-results/capturas/`.
 */
async function abrir(
  page: Page,
  caminho = "/gestao/mais/definicoes",
  opcoes: { definicoes?: DefinicoesGestao; falhas?: Falha[]; formulario?: boolean } = {},
): Promise<void> {
  const sessao = await fingirApiDeSessao(page, { sessaoAberta: true });
  await fingirApiDeDefinicoes(page, { sessao, ...opcoes });
  await page.goto(caminho);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (opcoes.formulario !== false) {
    await expect(page.getByLabel(T.etiquetaRede, { exact: true })).toBeVisible();
  }
}

/**
 * `inteira`: a página toda, para o que interessa (um erro, um aviso) não ficar
 * fora da janela. Sem ela, a captura é a janela onde a página está.
 */
async function tirar(
  page: Page,
  nome: string,
  tamanho: "390" | "1024",
  inteira = false,
): Promise<void> {
  if (inteira) await page.evaluate(() => window.scrollTo(0, 0));
  await guardar(`gestao-definicoes-${tamanho}-${nome}`, (caminho) =>
    page.screenshot({ path: caminho, fullPage: inteira }),
  );
}

/** A fixture com a password sem espaço, para a captura não mostrar o aviso dos espaços. */
function semEspacoNaPassword(definicoes: DefinicoesGestao): DefinicoesGestao {
  return { ...definicoes, wifi_password: definicoes.wifi_password.trim() };
}

async function sequencia(page: Page, tamanho: "390" | "1024"): Promise<void> {
  const tocar = (l: ReturnType<Page["locator"]>) => (tamanho === "390" ? l.tap() : l.click());

  await abrir(page, "/gestao/mais/definicoes", {
    definicoes: semEspacoNaPassword(definicoesConfiguradas()),
  });
  await tirar(page, "configurado", tamanho);

  // Editor com dois períodos e meia-noite.
  await page.getByRole("group", { name: legendaDoDia("sexta") }).scrollIntoViewIfNeeded();
  await tirar(page, "editor-sexta", tamanho);

  await page
    .getByRole("group", { name: legendaDoDia("terca") })
    .getByRole("button", { name: T.copiarParaOutrosDias })
    .scrollIntoViewIfNeeded();
  await tocar(
    page
      .getByRole("group", { name: legendaDoDia("terca") })
      .getByRole("button", { name: T.copiarParaOutrosDias }),
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await tirar(page, "folha-copiar", tamanho);
  await tocar(page.getByRole("dialog").getByRole("button", { name: T.copiar }));
  await expect(page.getByText(copiadoPara(6))).toBeVisible();
  await tirar(page, "copiado", tamanho, true);

  // Erro de campo (validação local).
  await page.getByLabel(T.etiquetaInstagram, { exact: true }).fill("@bardatomazia");
  await tocar(page.getByRole("button", { name: T.guardar, exact: true }));
  await expect(page.getByText(T.erroLinkArroba)).toBeVisible();
  await tirar(page, "erro-de-campo", tamanho, true);

  // Folha de saída.
  await page
    .getByRole("navigation", { name: "Gestão" })
    .getByRole("link", { name: "Ementa" })
    .click();
  await expect(page.getByRole("dialog", { name: T.saidaTitulo })).toBeVisible();
  await tirar(page, "folha-sair", tamanho);
}

test.describe("telemóvel, 390 × 844", () => {
  test("configurado, editor, copiar, erro e folha de sair", async ({ page }) => {
    await sequencia(page, "390");
  });

  test("não configurado, com os dias por preencher, e inválido", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", { definicoes: definicoesVazias() });
    await expect(page.getByText(T.horarioNaoConfigurado)).toBeVisible();
    await tirar(page, "nao-configurado", "390");
    await page.getByRole("button", { name: T.configurarHorario }).tap();
    await page
      .getByRole("switch", { name: nomeDoDia("quarta"), exact: true })
      .scrollIntoViewIfNeeded();
    await tirar(page, "por-preencher", "390");
  });

  test("inválido, vazio (primeira vez) e «Mais»", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      definicoes: semEspacoNaPassword(definicoesComHorarioInvalido()),
    });
    await expect(page.getByText(T.horarioInvalido)).toBeVisible();
    await tirar(page, "horario-invalido", "390");
  });

  test("a primeira vez: tudo vazio", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", { definicoes: definicoesVazias() });
    await expect(page.getByText(T.primeiraVez)).toBeVisible();
    await tirar(page, "vazia", "390");
  });

  test("«Mais» com a lista", async ({ page }) => {
    await abrir(page, "/gestao/mais", { formulario: false });
    await expect(page.getByRole("link", { name: new RegExp(`^${T.ligacaoNoMais}`) })).toBeVisible();
    await tirar(page, "mais", "390");
  });

  test("erro de carregar, 422 e sem resposta ao guardar", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      formulario: false,
      falhas: [
        {
          metodo: "GET",
          caminho: /definicoes$/,
          resposta: { estado: 500, corpo: { erro: "x", mensagem: "x" } },
        },
      ],
    });
    await expect(page.getByText(T.carregarTitulo)).toBeVisible();
    await tirar(page, "erro-de-carregar", "390");
  });

  test("422 do servidor e sem resposta ao guardar", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      falhas: [
        {
          metodo: "PUT",
          caminho: /definicoes$/,
          ordem: 1,
          resposta: {
            estado: 422,
            corpo: { erro: "dados_invalidos", mensagem: "x", campo: "maps_url" },
          },
        },
        { metodo: "PUT", caminho: /definicoes$/, ordem: 2, resposta: "abortar" },
      ],
    });
    await page.getByLabel(T.etiquetaRede, { exact: true }).fill("x");
    await page.getByRole("button", { name: T.guardar, exact: true }).tap();
    await expect(page.getByLabel(T.etiquetaMaps, { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await tirar(page, "422", "390");

    await page.getByLabel(T.etiquetaMaps, { exact: true }).fill("https://maps.example.test/x");
    await page.getByRole("button", { name: T.guardar, exact: true }).tap();
    await expect(page.getByText(T.guardarSemResposta)).toBeVisible();
    await tirar(page, "sem-resposta", "390", true);
  });

  test("a guardar com sucesso (aviso)", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", { definicoes: definicoesConfiguradas() });
    await page.getByLabel(T.etiquetaRede, { exact: true }).fill("outra-rede");
    await page.getByRole("button", { name: T.guardar, exact: true }).tap();
    await expect(page.getByText(T.sucesso)).toBeVisible();
    await tirar(page, "aviso", "390");
  });
});

test.describe("rato, 1024 × 768", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test("configurado, editor, copiar, erro e folha de sair", async ({ page }) => {
    await sequencia(page, "1024");
  });

  test("inválido e não configurado", async ({ page }) => {
    await abrir(page, "/gestao/mais/definicoes", {
      definicoes: semEspacoNaPassword(definicoesComHorarioInvalido()),
    });
    await expect(page.getByText(T.horarioInvalido)).toBeVisible();
    await tirar(page, "horario-invalido", "1024");
  });
});
