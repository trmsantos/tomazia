// @vitest-environment node
/**
 * F3-01 — as promessas do `src/styles/global.css` (secção 5 de
 * `docs/ecras/F3-01.md`).
 *
 * Duas delas são a rede por baixo de toda a tarefa:
 *
 *  - **`:focus-visible` global.** Nenhum componente tem de se lembrar do
 *    anel de foco, porque a camada base já o desenha. É o que faz o Q-04
 *    («foco visível em todos os controlos») ser verdade por omissão em vez
 *    de ser verdade sete vezes seguidas por acaso. Usa `outline` e não o
 *    `ring-*` do Tailwind: acompanha o `border-radius`, não precisa das
 *    variáveis `--tw-ring-*` e não traz um `#fff` por omissão.
 *  - **`color-scheme: dark`.** Sem isto o Chrome pinta o preenchimento
 *    automático com a caixa azul-clara por cima do bordô, e no
 *    `/gestao/entrar` o texto da password deixa de se ler. É um defeito que
 *    só aparece a quem tem a password guardada — provavelmente só o dono.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "../testes/percorrer-arvore";
import { blocosDosTokens } from "../testes/tokens";

function global(): string {
  return lerTexto(
    join(RAIZ_FRONTEND, "src", "styles", "global.css"),
    "src/styles/global.css",
  ).replace(/\s+/g, " ");
}

describe("src/styles/global.css", () => {
  it("importa os tokens e as fontes antes do Tailwind", () => {
    const texto = lerTexto(join(RAIZ_FRONTEND, "src", "styles", "global.css"), "global.css");

    expect(texto).toMatch(/tokens\.css/);
    expect(texto).toMatch(/fontes\.css/);
    expect(texto).toMatch(/@tailwind base/);
  });

  it("desenha o anel de foco uma vez, para todos os controlos", () => {
    const texto = global();

    expect(texto).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*var\(--espessura-foco\)/);
    expect(texto).toMatch(/:focus-visible\s*\{[^}]*var\(--cor-foco\)/);
    expect(texto).toMatch(/outline-offset:\s*var\(--afastamento-foco\)/);
  });

  it("não há nenhum outline: none em lado nenhum", () => {
    // `outline: none` sem substituição é a forma clássica de apagar o foco
    // sem dar por isso.
    expect(global()).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("põe o esquema escuro e a cor de realce, para o autofill não ficar ilegível", () => {
    const texto = global();

    expect(texto).toMatch(/color-scheme:\s*dark/);
    expect(texto).toMatch(/accent-color:\s*var\(--cor-creme-papel\)/);
  });

  it("respeita prefers-reduced-motion", () => {
    expect(global()).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("define as três classes de superfície, e só elas pintam o fundo", () => {
    const texto = global();

    for (const classe of [".superficie-escura", ".superficie-painel", ".superficie-creme"]) {
      expect(texto, `falta ${classe}`).toContain(classe);
    }
    expect(texto).toMatch(/background-color:\s*var\(--cor-fundo-local\)/);
  });

  it("o corpo usa os tokens de tipografia, não valores escritos à mão", () => {
    const texto = global();

    expect(texto).toMatch(/var\(--fonte-corpo\)/);
    expect(texto).toMatch(/var\(--cor-texto\)/);
  });
});

/**
 * F3-02, secção 11 — a linha de `global.css` que faz os saltos pararem no
 * sítio, e a que faz o deslize existir.
 *
 * **Prova:** que o `html` tem `scroll-padding-top: var(--ancora-ementa)` e
 * que o `scroll-behavior: smooth` está escrito na **forma positiva**,
 * dentro de `prefers-reduced-motion: no-preference`.
 *
 * Porque é que a forma importa: o bloco de `prefers-reduced-motion: reduce`
 * que já existe neste ficheiro **não cobre este caso** — ele zera durações
 * de animação e de transição, e `scroll-behavior` não é nem uma coisa nem
 * outra. Um `html { scroll-behavior: smooth }` solto continua a deslizar
 * para quem pediu que não deslizasse.
 *
 * **Deixa passar:** que o valor de `--ancora-ementa` esteja errado (isso é o
 * teste dos tokens, aqui em baixo, e a asserção do "título tapado" em
 * `e2e/ementa.spec.ts`); e um `overflow-x: hidden` num antepassado, que mata
 * o `position: sticky` dos descendentes sem erro nenhum e não se vê em
 * texto de CSS.
 */
describe("o deslize e a âncora da ementa", () => {
  it("o `html` desconta a barra fixa em `scroll-padding-top`", () => {
    // Substitui um `scroll-margin-top` em cada secção, e é melhor do que
    // ele por duas razões: é um número em vez de N, e aplica-se tanto ao
    // salto por âncora como ao deslocamento que o browser faz quando o
    // `Tab` leva o foco para um controlo escondido por baixo da barra.
    expect(global()).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*var\(--ancora-ementa\)/);
  });

  it("o `scroll-behavior: smooth` está dentro de `no-preference`", () => {
    const texto = global();

    expect(
      texto,
      "tem de ser a forma positiva: o bloco de `reduce` que já existe zera " +
        "durações, e `scroll-behavior` não é uma duração",
    ).toMatch(/prefers-reduced-motion:\s*no-preference[^@]*scroll-behavior:\s*smooth/);
  });

  it("não há `scroll-behavior: smooth` fora de uma consulta de media", () => {
    const texto = global();
    const foraDeMedia = texto
      .split("@media")
      .slice(0, 1)
      .join("")
      .match(/scroll-behavior:\s*smooth/);

    expect(
      foraDeMedia,
      "um `scroll-behavior: smooth` solto continua a deslizar para quem pediu " +
        "que não deslizasse (F3-02, 3.5)",
    ).toBeNull();
  });
});

/**
 * F3-02, 4.1 — o «×» nativo da caixa de pesquisa.
 *
 * **Prova:** que a regra existe, que vive na camada base e que apaga o
 * pseudo-elemento do botão de limpar do WebKit/Blink.
 *
 * **Deixa passar** quase tudo o que interessa: que a regra chegue ao
 * browser (o Tailwind pode não emitir a camada), que o pseudo-elemento
 * desapareça mesmo, e o próprio motivo de isto existir — haver **um** «×» na
 * barra e não dois. Isso mede-se com o browser aberto, em
 * `e2e/ementa.spec.ts`. Este teste só impede que a regra seja apagada por
 * distração numa limpeza de CSS.
 */
describe("o «×» nativo da caixa de pesquisa", () => {
  it("o pseudo-elemento do botão de limpar é apagado", () => {
    const texto = global();

    expect(
      texto,
      "com texto escrito a barra mostrava dois «×» a 52 px um do outro a fazer " +
        "coisas diferentes. Quem sai é o nativo (4.1).",
    ).toMatch(/input\[type="search"\]::-webkit-search-cancel-button\s*\{[^}]*display:\s*none/);
  });

  it("não é o nosso glifo que sai: o `IconeDeFechar` continua lá", () => {
    // A saída não é apagar o nosso símbolo — `×` é o glifo de fechar deste
    // projeto, e está na Folha e no Aviso. Esta asserção vive aqui, ao lado
    // da regra que apaga o outro, para que apagar o nosso por engano
    // apareça como o que é: a correção pela ponta errada.
    //
    // O que se prende é que **há** um ícone de fechar e que ele é um SVG
    // decorativo. A **forma** do glifo não: redesenhar o mesmo «×» com
    // outro `viewBox` punha vermelho um teste de folha de estilos, com uma
    // mensagem sobre CSS, por uma mudança que nada tem a ver com ele. Quem
    // vê a forma é a captura `390-ementa-pesquisa.png`.
    const ementa = lerTexto(
      join(RAIZ_FRONTEND, "src", "pages", "publico", "Ementa.tsx"),
      "src/pages/publico/Ementa.tsx",
    );
    const icone = /function IconeDeFechar\(\)[\s\S]*?\n}/.exec(ementa)?.[0];

    expect(icone, "não encontrei o `IconeDeFechar` — isto é falha de leitura").toBeDefined();
    expect(icone, "o fechar da pesquisa continua a ter um ícone próprio").toContain("<svg");
    expect(
      icone,
      "e continua a ser decoração: quem lhe dá nome é o `aria-label` do botão",
    ).toContain('aria-hidden="true"');
  });
});

describe("os três tokens da barra fixa", () => {
  /**
   * **Prova:** que os tokens de 11 existem e que a conta deriva de um só
   * número. A F3-03 entra mudando `--altura-cabecalho`, e mais nada.
   *
   * **Deixa passar:** o valor computado. Que `--altura-barra-chips` dê
   * mesmo 61 px e que a barra desenhada tenha essa altura é 12.11, medido
   * num browser — e é a asserção com melhor relação entre uma linha e um
   * defeito, porque uma barra com 8 px a mais desalinha **todos** os saltos
   * de categoria e o sintoma aparece longe da causa.
   */
  it("`--altura-cabecalho` é `0px` e não `0`", () => {
    const tokens = blocosDosTokens();
    const altura = tokens.get(":root")?.get("--altura-cabecalho");

    expect(altura, "falta --altura-cabecalho em tokens.css").toBeDefined();
    expect(
      altura,
      "um `calc()` com um zero sem unidade é inválido e a declaração inteira cai " +
        "em silêncio — e com ela a âncora de todas as categorias",
    ).toBe("0px");
  });

  it("a âncora deriva da altura do cabeçalho e da altura da barra", () => {
    const tokens = blocosDosTokens();
    const ancora = tokens.get(":root")?.get("--ancora-ementa") ?? "";

    expect(ancora).toContain("--altura-cabecalho");
    expect(ancora).toContain("--altura-barra-chips");
  });

  it("a altura da barra é a conta do alvo de toque, da folga e do fio", () => {
    const tokens = blocosDosTokens();
    const barra = tokens.get(":root")?.get("--altura-barra-chips") ?? "";

    expect(barra, "escrita como a conta que é, para acompanhar o alvo de toque").toContain(
      "--alvo-toque",
    );
    expect(barra).toContain("--contorno-fino");
  });
});
