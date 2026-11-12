import { readdirSync } from "node:fs";
import { sep } from "node:path";

import type { Config } from "tailwindcss";

/**
 * Tailwind 3.4 (ADR 0007; nunca v4 — na v4 este ficheiro deixa de ser lido).
 *
 * Aqui não há um único hex, px ou rem: cada folha do `theme` é uma
 * referência a um token, e o valor vive em `src/styles/tokens.css`. Não há
 * duas listas para concordar — há uma lista e um índice.
 * `src/styles/cores-so-nos-tokens.test.ts` confirma as duas metades: que aqui
 * só há referências, e que cada uma aponta para um token que existe mesmo.
 *
 * As escalas são **substituídas** (`theme.x`) e não estendidas
 * (`theme.extend.x`): assim as cores, os tamanhos e os espaçamentos que o
 * Tailwind traz de origem (`text-base`, `p-5`, `shadow-lg` e as paletas que
 * ele inventa) deixam de existir, a classe não é gerada e o erro aparece no
 * ecrã, não numa revisão.
 *
 * A única categoria com literais é `screens`: `@media (min-width: var(--x))`
 * não é CSS válido. É por isso a única que nunca se duplica no `tokens.css`.
 */

/**
 * O que o Tailwind lê para decidir que classes gera.
 *
 * **A página de demonstração entra em desenvolvimento e sai no build**, e a
 * razão é que o Tailwind gera **uma** folha de estilos — a que o `index.html`
 * carrega. Que o Vite só construa o `index.html` tira a demonstração do
 * JavaScript e do HTML, mas não tira as classes que só ela usa: elas iam para
 * produção dentro do CSS público (2,4 kB em bruto, e um `.bg-dourado-latao`
 * que nenhum componente escreve). As três redes que existiam procuravam a
 * palavra "demonstracao" ou a marca do `<h1>`, e um nome de classe partilhado
 * não contém nenhuma das duas; o `size-limit` só mede o JavaScript.
 *
 * Nada se perde: a demonstração só é servida pelo `npm run dev`, e os testes
 * ponta a ponta correm contra esse servidor (`playwright.config.ts`).
 *
 * `src/build-de-producao.test.ts` prende isto pelo lado de lá — olha para o
 * que entrou em `dist/assets/*.css`, e não para o nome do ficheiro de onde
 * veio.
 */
const PASTA_DA_DEMONSTRACAO = "demonstracao";

/** Ficheiro que tem de estar na lista: é o guarda da regra 10 (ver abaixo). */
const SENTINELA = "./src/App.tsx";

/**
 * Os ficheiros do pacote público: o `index.html` e o que em `src/` pode
 * chegar ao browser de quem visita o site.
 *
 * Ficam de fora, por esta ordem de importância:
 *
 *  - **`src/demonstracao/`**, pela razão de cima;
 *  - **os testes e os auxiliares deles** (`*.test.*`, `*.spec.*` e
 *    `src/testes/`). Não é zelo: o `cores-so-nos-tokens.test.ts` tem a
 *    palavra `bg-dourado-latao` escrita num comentário, a explicar o que
 *    proíbe, e isso bastava para o Tailwind gerar a classe e mandá-la para
 *    produção. O extractor não distingue código de comentário.
 *
 * É uma lista de ficheiros e não de globos porque o Tailwind 3.4 não trata
 * globos negativos no `content` (um `"!./src/demonstracao/**"` é lido como um
 * caminho e ignorado em silêncio). Lê-se do disco e não se escreve à mão: o
 * modo de falha de uma lista escrita à mão seria uma pasta nova de `src/` a
 * ficar com as classes dela em desenvolvimento e sem elas em produção.
 *
 * Só se usa no build, que é um tiro único. Em desenvolvimento ficam os globos
 * em baixo, para um ficheiro criado com o servidor a correr ser visto na
 * mesma.
 */
function ficheirosPublicos(): string[] {
  const ficheiros = readdirSync("./src", { recursive: true, encoding: "utf-8" })
    .map((entrada) => entrada.split(sep).join("/"))
    .filter((caminho) => /\.tsx?$/.test(caminho))
    .filter((caminho) => !/\.(test|spec)\.tsx?$/.test(caminho))
    .filter((caminho) => !caminho.startsWith(`${PASTA_DA_DEMONSTRACAO}/`))
    .filter((caminho) => !caminho.startsWith("testes/"))
    .map((caminho) => `./src/${caminho}`);

  if (!ficheiros.includes(SENTINELA)) {
    // Guarda da regra 10. Uma leitura falhada (cwd errado, pasta movida) dava
    // uma folha de estilos quase vazia e o site aparecia sem desenho nenhum —
    // e "não li nada" não pode passar por "não havia nada para ler".
    throw new Error(
      `Não consegui listar os ficheiros de src/ para o \`content\` do Tailwind: ${SENTINELA} ` +
        `não apareceu (li ${ficheiros.length} ficheiros a partir de ${process.cwd()}). ` +
        "Isto é uma falha de leitura, não um projeto sem código.",
    );
  }

  return ["./index.html", ...ficheiros];
}

/**
 * A marca que o `vite.config.ts` põe quando o `command` do Vite é `build`.
 * O nome está escrito nos dois ficheiros; a razão para não ser o `NODE_ENV`
 * está lá, e vale a pena lê-la antes de mexer nisto.
 */
const EM_PRODUCAO = process.env["TOMAZIA_PACOTE_PUBLICO"] === "1";

export default {
  content: EM_PRODUCAO
    ? ficheirosPublicos()
    : ["./index.html", "./demonstracao.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Um só breakpoint. 360 px é o mínimo suportado, não um breakpoint.
    screens: { lg: "1024px" },

    colors: {
      // Obrigatórios ao substituir a paleta: sem eles, `border-transparent`
      // e companhia desaparecem.
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",

      // A paleta, para a página de demonstração e para mais nada. Um
      // componente que escreva um destes nomes está a furar o mecanismo dos
      // papéis — e há um teste que o recusa.
      "bordo-noite": "var(--cor-bordo-noite)",
      "bordo-vinho": "var(--cor-bordo-vinho)",
      "bordo-tomazia": "var(--cor-bordo-tomazia)",
      "dourado-latao": "var(--cor-dourado-latao)",
      "creme-papel": "var(--cor-creme-papel)",
      "creme-sombra": "var(--cor-creme-sombra)",
      cortina: "var(--cor-cortina)",

      // Os papéis — é por estes que os componentes pegam.
      fundo: "var(--cor-fundo-local)",
      texto: "var(--cor-texto)",
      "texto-suave": "var(--cor-texto-suave)",
      "texto-marca": "var(--cor-texto-marca)",
      contorno: "var(--cor-contorno)",
      "contorno-superficie": "var(--cor-contorno-superficie)",
      // Três linhas e não duas: a aresta ENTRE superfícies, a fronteira de um
      // controlo, e a divisória DENTRO de uma superfície. No creme divergem as
      // três (ver o comentário de `.superficie-creme` em `tokens.css`).
      "fio-interno": "var(--cor-fio-interno)",
      foco: "var(--cor-foco)",
      acao: "var(--cor-acao)",
      "sobre-acao": "var(--cor-texto-sobre-acao)",
      perigo: "var(--cor-perigo)",
      "sobre-perigo": "var(--cor-texto-sobre-perigo)",
      sucesso: "var(--cor-sucesso)",
      erro: "var(--cor-erro)",
      pontilhado: "var(--cor-pontilhado)",
    },

    // `font-*` é o mesmo espaço de nomes para a família e para o peso, por
    // isso não há uma chave `titulo` nos dois: a família de título leva o seu
    // peso na camada base (ver `.font-titulo` em `global.css`).
    fontFamily: {
      titulo: "var(--fonte-titulo)",
      corpo: "var(--fonte-corpo)",
    },
    fontWeight: {
      normal: "var(--peso-normal)",
      forte: "var(--peso-forte)",
    },
    fontSize: {
      nota: ["var(--texto-nota)", { lineHeight: "var(--entrelinha-nota)" }],
      corpo: ["var(--texto-corpo)", { lineHeight: "var(--entrelinha-corpo)" }],
      seccao: ["var(--texto-seccao)", { lineHeight: "var(--entrelinha-seccao)" }],
      titulo: ["var(--texto-titulo)", { lineHeight: "var(--entrelinha-titulo)" }],
      destaque: ["var(--texto-destaque)", { lineHeight: "var(--entrelinha-destaque)" }],
    },

    // Os nomes do Tailwind mantêm-se (p-1 = 4 px, p-2 = 8, …) porque os sete
    // passos da especificação são um subconjunto exato dos dele. Ninguém
    // precisa de reaprender nada; só os passos de fora deixam de existir.
    spacing: {
      0: "0px",
      1: "var(--espaco-1)",
      2: "var(--espaco-2)",
      3: "var(--espaco-3)",
      4: "var(--espaco-4)",
      6: "var(--espaco-6)",
      8: "var(--espaco-8)",
      12: "var(--espaco-12)",
    },

    borderRadius: {
      nenhum: "0px",
      pequeno: "var(--raio-pequeno)",
      cartao: "var(--raio-cartao)",
      cheio: "var(--raio-cheio)",
    },
    borderWidth: {
      0: "0px",
      DEFAULT: "var(--contorno-fino)",
      // A barra do destino ativo na navegação da gestão (F4-01, 5.2).
      marca: "var(--espessura-marca-ativa)",
    },

    // A caixa do cartaz de um evento (F3-04, 6.2) e o quadrado de cada foto
    // da galeria (F3-05, 4.2). Substituída e não estendida, como as outras
    // escalas: `aspect-square` e `aspect-video` deixam de existir e estes
    // dois nomes passam a ser os únicos que há. O cartaz é 3:2 porque os
    // cartazes do bar são horizontais (confirmado); a galeria é quadrada
    // porque as fotos dos clientes não têm orientação prometida nenhuma.
    aspectRatio: { cartaz: "var(--cartaz-proporcao)", foto: "var(--foto-proporcao)" },

    // Existem para o caso de alguém precisar de afinar o anel num sítio; a
    // regra `:focus-visible` da camada base é que o desenha em todo o lado,
    // por isso estas utilidades não chegam a ser geradas.
    outlineWidth: { foco: "var(--espessura-foco)" },
    outlineOffset: { foco: "var(--afastamento-foco)" },

    // Sem sombras no escuro (a especificação proíbe-as): a escala é só
    // "nenhuma". As superfícies separam-se por um fio de 1 px.
    boxShadow: { nenhuma: "none" },

    // Uma só opacidade, e é a do estado desativado. Substituída e não
    // estendida, como as outras escalas: assim `opacity-50` não existe e
    // ninguém apaga nada "só um bocadinho" por gosto. A razão de a cor não
    // poder ser o sinal de desativado está em `tokens.css`, ao lado do valor.
    opacity: { desativado: "var(--opacidade-desativado)" },

    // Os dois valores que sobrevivem à substituição de `theme.colors`, porque
    // estão escritos como fallback dentro do Tailwind (um branco e um azul,
    // em corePlugins.js, para quando `ringColor.DEFAULT` e
    // `ringOffsetColor.DEFAULT` não existem). Nós usamos `outline` e não
    // `ring-*`, mas ficam substituídos na mesma, para a hipótese não existir.
    ringColor: { DEFAULT: "var(--cor-foco)" },
    ringOffsetColor: { DEFAULT: "var(--cor-fundo-local)" },

    extend: {
      minHeight: {
        toque: "var(--alvo-toque)",
        // O lugar da linha viva da Folha do WiFi (F3-03, 8.2). `min-h` e não
        // `h`: a reserva é de uma linha, mas com o tamanho de letra do sistema
        // no dobro a frase passa a duas e tem de poder crescer.
        contagem: "var(--altura-contagem)",
      },
      minWidth: {
        toque: "var(--alvo-toque)",
        // O pontilhado da Linha de produto nunca encolhe abaixo disto. Sem um
        // mínimo, um nome longo come-o todo e a linha deixa de se ler como uma
        // linha de ementa (F3-02, secção 6.3).
        fio: "var(--espaco-6)",
      },
      maxWidth: {
        coluna: "var(--coluna-publica)",
        folha: "var(--largura-folha)",
        vazio: "var(--largura-vazio)",
      },
      maxHeight: { folha: "var(--altura-folha)" },
      // A barra de chips: `h-barra` fixa-lhe a altura e `top-cabecalho` diz
      // onde ela pára quando cola. Os dois saem do mesmo sítio que a âncora
      // das categorias, para não haver duas contas a discordar.
      inset: { cabecalho: "var(--altura-cabecalho)" },
      // A folga do `<main>` por baixo do cabeçalho fixo (F3-03, secção 2). O
      // `inset` acima dá `top-cabecalho` e **não** dá `padding`: a escala de
      // espaçamento deste projeto é substituída, por isso um `pt-cabecalho`
      // sem esta entrada não gera classe nenhuma e falha em silêncio — com o
      // título da ementa a nascer por baixo do cabeçalho.
      padding: { cabecalho: "var(--altura-cabecalho)" },
      // O carril e o manípulo do Interruptor: 48 × 28 e 24 × 24 não são passos
      // da escala de espaçamento, por isso têm tokens próprios.
      width: {
        carril: "var(--carril-largura)",
        manipulo: "var(--manipulo)",
        // A coluna lateral da gestão (F4-01, 5.3).
        "menu-gestao": "var(--largura-menu-gestao)",
      },
      // As duas colunas da moldura da gestão a partir de 1024 px: o menu e o resto.
      gridTemplateColumns: { gestao: "var(--largura-menu-gestao) 1fr" },
      height: {
        carril: "var(--carril-altura)",
        manipulo: "var(--manipulo)",
        barra: "var(--altura-barra-chips)",
        // A barra inferior da gestão no telemóvel (F4-01, 5.2). O `<main>`
        // desconta-a com `.folga-da-barra-da-gestao`, do mesmo token.
        "barra-gestao": "var(--altura-barra-gestao)",
        // A altura do cabeçalho fixo, do mesmo sítio de onde sai a âncora das
        // categorias. 8 px a mais aqui desalinham os onze saltos de uma vez, e
        // o sintoma aparece longe da causa (F3-03, secção 3).
        cabecalho: "var(--altura-cabecalho)",
        // O lugar reservado à contagem da pesquisa. Ocupa-se à abertura, para
        // que o texto que chega 500 ms depois não empurre a lista para baixo
        // com a pessoa já a lê-la (F3-02, secção 4.5).
        contagem: "var(--altura-contagem)",
      },
      translate: {
        manipulo: "var(--manipulo-curso)",
        premido: "var(--descida-premido)",
      },
      transitionDuration: { curta: "var(--duracao-curta)", folha: "var(--duracao-folha)" },
      transitionTimingFunction: { curva: "var(--curva)" },
    },
  },
  plugins: [],
} satisfies Config;
