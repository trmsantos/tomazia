// @vitest-environment node
/**
 * F3-02, 9 — cada frase do ecrã está na tabela da especificação.
 *
 * **Porque é que isto existe.** Os textos da ementa vivem em dois sítios: o
 * `TEXTOS` da página e o `TEXTOS_DA_EMENTA` das fixturas. Os testes do ecrã
 * prendem os dois um ao outro — mudar um só deixa a bateria vermelha —, mas
 * não prendem nenhum deles às **palavras**: quem mudasse os dois na mesma
 * passagem ficava verde. E a varredura do Q-05 (`src/textos-pt-pt.test.ts`)
 * também não chega aqui: ela apanha "cardápio", o gerúndio e as reticências
 * de três pontos, não apanha uma frase inteira a dizer outra coisa.
 *
 * Foi por essa fresta que passaram duas frases que afirmavam factos sobre o
 * bar que ninguém verificou — "o que há hoje" (não há pratos do dia) e "o
 * servidor do bar" (o bar não tem servidor nenhum). A regra 1 do `CLAUDE.md`
 * proíbe exactamente isso, e nenhum teste ficou vermelho: foi o dominio-bar
 * a lê-las.
 *
 * Por isso a tabela da secção 9 de `docs/ecras/F3-02.md` passa a ser a fonte
 * de verdade **executável** do texto deste ecrã. Mudar uma frase é mudá-la lá
 * e aqui, que é a altura em que o dominio-bar a vê.
 *
 * Mesma forma do que `src/styles/cores-so-nos-tokens.test.ts` já faz com a
 * tabela Design de `docs/ESPECIFICACAO.md`, e pela mesma razão.
 *
 * **O que deixa passar:** uma frase que esteja na tabela e no código e esteja
 * errada nas duas. Isso é revisão humana, e é para isso que a secção 9 está
 * escrita de maneira a ser lida de uma vez.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NOME_DO_BAR, TEXTOS_DA_EMENTA, contagemDeResultados } from "../../testes/ementa";
import { RAIZ_REPOSITORIO, lerTexto } from "../../testes/percorrer-arvore";

const ESPECIFICACAO = "docs/ecras/F3-02.md";

/**
 * Quantas linhas de texto a tabela tem de ter, no mínimo.
 *
 * O guarda da regra 10: uma expressão regular que deixe de condizer — porque
 * o título da secção mudou, porque a tabela ganhou outra forma — devolve zero
 * frases, encontra zero divergências e **passa**. A contagem mínima é o que
 * distingue "não encontrei nada fora da tabela" de "não consegui ler a
 * tabela". Está abaixo do número real de propósito: é um piso, não um
 * espelho, senão acrescentar uma linha à especificação partia isto.
 */
const MINIMO_DE_FRASES = 15;

/**
 * Todas as frases que a secção 9 declara, uma a uma.
 *
 * A tabela tem células com mais do que uma frase: o estado vazio escreve
 * `**Título.** / Linha de apoio. / \`Botão\``, e o preço escreve
 * `6,50 € · Oferta`. Por isso as células partem-se nos dois separadores, e o
 * destaque (`**`) e as plicas invertidas caem — são marcação do documento e
 * não texto do ecrã.
 */
function frasesDaEspecificacao(): Set<string> {
  const caminho = join(RAIZ_REPOSITORIO, ESPECIFICACAO);
  const texto = lerTexto(caminho, `a especificação do ecrã (${ESPECIFICACAO})`);

  const seccao = /\n## 9\. Texto visível, todo ele\n([\s\S]*?)(?:\n## |$)/.exec(texto);
  if (seccao?.[1] === undefined) {
    throw new Error(
      `Não consegui ler ${ESPECIFICACAO}: não encontrei a secção «## 9. Texto ` +
        "visível, todo ele». Isto é uma falha de leitura, não um texto que não " +
        "corresponde — nada do que este ficheiro dissesse a seguir valeria nada.",
    );
  }

  const frases = new Set<string>();
  for (const linha of seccao[1].split("\n")) {
    if (!linha.trimStart().startsWith("|")) continue;

    const celulas = linha.split("|").slice(2, -1);
    for (const celula of celulas) {
      const limpa = celula.replaceAll("**", "").replaceAll("`", "");
      for (const pedaco of limpa.split(/ \/ | · /)) {
        const frase = pedaco.trim();
        if (frase !== "" && frase !== "---" && frase !== "—") frases.add(frase);
      }
    }
  }

  return frases;
}

describe(`o texto do ecrã é o da tabela de ${ESPECIFICACAO}`, () => {
  const frases = frasesDaEspecificacao();

  it("a tabela foi mesmo lida", () => {
    expect(
      frases.size,
      `li ${String(frases.size)} frases na secção 9 de ${ESPECIFICACAO} e esperava ` +
        `pelo menos ${String(MINIMO_DE_FRASES)}. A tabela mudou de forma e a ` +
        "expressão regular deixou de a apanhar: isto é «não consegui procurar», " +
        "não é «está tudo a condizer».",
    ).toBeGreaterThanOrEqual(MINIMO_DE_FRASES);
  });

  it.each(Object.entries(TEXTOS_DA_EMENTA))(
    "«%s» está na tabela, palavra por palavra",
    (chave, valor) => {
      expect(
        frases.has(valor),
        `o texto «${chave}» do ecrã é «${valor}» e essa frase não está na secção 9 ` +
          `de ${ESPECIFICACAO}. Ou a frase mudou no código sem passar pela ` +
          "especificação — e então o dominio-bar não a viu —, ou mudou na " +
          "especificação e falta mudá-la em `src/pages/publico/Ementa.tsx` e em " +
          "`src/testes/ementa.ts`, que são os dois sítios onde ela está escrita.",
      ).toBe(true);
    },
  );

  it("o `<h1>` provisório também", () => {
    expect(frases.has(NOME_DO_BAR)).toBe(true);
  });

  it("a contagem de resultados, que é a frase que a varredura do Q-05 não vê", () => {
    // 12.10: frases construídas por concatenação passam ao lado da varredura
    // de texto. O singular está na tabela tal e qual; o plural está com o
    // número por preencher, que é como a especificação o escreve.
    expect(frases.has(contagemDeResultados(1))).toBe(true);
    expect(frases.has(contagemDeResultados(7).replace("7", "{n}"))).toBe(true);
  });
});
