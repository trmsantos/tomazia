/**
 * O contrato entre estes testes e a página de demonstração.
 *
 * Os testes ponta a ponta precisam de conduzir a página: abrir a Folha,
 * disparar um Aviso, encontrar a secção creme. Para não dependerem do
 * texto exacto de cada rótulo (que muda em revisão de conteúdo), o que
 * precisam está escrito aqui, num sítio só, e a página de demonstração
 * cumpre-o. Se um nome mudar, muda numa linha.
 *
 * `docs/ecras/F3-01.md`, secção 8, descreve as onze secções da página; os
 * identificadores abaixo são os dessas secções. R-01 / ADR 0023: entram mais
 * duas, "Superfície papel" e "Superfície destaque", antes do "Foco" — treze.
 */
export const CAMINHO_DA_DEMONSTRACAO = "/demonstracao.html";

/** O `<h1>` da página. É também a marca que `dist/` nunca pode conter. */
export const TITULO_DA_DEMONSTRACAO = "Componentes do Bar da Tomazia";

/** `id` de cada secção, pela ordem da página. */
export const SECCOES = {
  tipografia: "tipografia",
  cores: "cores",
  botao: "botao",
  campo: "campo",
  chip: "chip",
  folha: "folha",
  aviso: "aviso",
  interruptor: "interruptor",
  estadoVazio: "estado-vazio",
  sobreCreme: "sobre-creme",
  sobrePapel: "sobre-papel",
  sobreDestaque: "sobre-destaque",
  foco: "foco",
} as const;

/**
 * Nomes acessíveis dos controlos que os testes têm de carregar. Em PT-PT,
 * maiúscula só no início.
 */
export const CONTROLOS = {
  abrirFolhaWifi: "WiFi",
  fecharFolha: "Fechar",
  avisoDeSucesso: "Aviso de sucesso",
  avisoComDesfazer: "Aviso com Desfazer",
  avisoDeErro: "Aviso de erro",
} as const;

/**
 * Seletor dos elementos que recebem foco e toque. É o mesmo nos dois
 * testes (alvo de 44 px e anel de foco), para não haver duas listas a
 * discordar.
 */
export const SELETOR_INTERATIVO =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * As cinco superfícies do redesign B (R-01 / ADR 0023, secção 5 de
 * `docs/ecras/R-01.md`). O corpo da página não leva classe nenhuma: é o
 * `:root`, que tem os papéis do escuro.
 */
export const SUPERFICIES = ["escura", "painel", "creme", "papel", "destaque"] as const;

export type Superficie = (typeof SUPERFICIES)[number];
