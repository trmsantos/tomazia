// @vitest-environment node
/**
 * F3-06a, 11 (critério 10) — cada frase do ecrã está na tabela da secção 9.
 *
 * Mesma forma de `textos-dos-eventos.test.ts`, pela mesma razão: a varredura do
 * Q-05 apanha «cardápio», o gerúndio e as reticências de três pontos, **não**
 * apanha uma frase inteira a dizer outra coisa — e foi por essa fresta que
 * passaram duas afirmações falsas sobre o bar na F3-02. Aqui a frase mais
 * perigosa é a que afirma «Fechado»: só o dono o pode dizer.
 *
 * `src/pages/publico/textos-do-visita-nos.ts` tem de ter cada texto fixo do
 * ecrã, palavra por palavra, e `src/testes/visita-nos.ts` é a cópia que os
 * outros testes usam. O ficheiro de produção é lido **como texto**, para a
 * tabela e o código não poderem divergir sem este teste cair.
 *
 * **O que deixa passar:** uma frase que esteja na tabela e no código e esteja
 * errada nas duas. Isso é revisão humana (o dominio-bar), e é para isso que a
 * secção 9 está escrita de maneira a ser lida de uma vez.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, RAIZ_REPOSITORIO, lerTexto } from "../../testes/percorrer-arvore";
import {
  LINHAS_DO_MOMENTO,
  NOMES_DOS_DIAS_NA_TABELA,
  TEXTOS_DO_VISITA_NOS,
} from "../../testes/visita-nos";

const ESPECIFICACAO = "docs/ecras/F3-06a.md";

/** O piso de contagem, o guarda da regra 10: uma regex que deixe de condizer dá zero frases. */
const MINIMO_DE_CELULAS = 15;

function seccaoNove(): string {
  const texto = lerTexto(
    join(RAIZ_REPOSITORIO, ESPECIFICACAO),
    `a especificação do ecrã (${ESPECIFICACAO})`,
  );
  const seccao = /\n## 9\. Texto visível, todo ele[^\n]*\n([\s\S]*?)(?:\n## |$)/.exec(texto);
  if (seccao?.[1] === undefined) {
    throw new Error(
      `Não consegui ler ${ESPECIFICACAO}: não encontrei a secção «## 9. Texto visível, todo ele». ` +
        "Isto é uma falha de leitura, não um texto que não corresponde.",
    );
  }
  return seccao[1];
}

/** Todas as células da tabela, sem marcação, e cada uma também partida em « · » e « / » e sem as notas entre parênteses. */
function celulasDaTabela(): Set<string> {
  const celulas = new Set<string>();

  for (const linha of seccaoNove().split("\n")) {
    if (!linha.trimStart().startsWith("|")) continue;
    for (const celula of linha.split("|").slice(1, -1)) {
      const limpa = celula.replaceAll("**", "").replaceAll("`", "").trim();
      if (limpa === "" || /^-+$/.test(limpa)) continue;
      celulas.add(limpa);
      for (const pedaco of limpa.split(/ [·/] /)) {
        celulas.add(pedaco.trim());
        // «Localização (só com Maps sem morada)»: a nota entre parênteses é do documento.
        celulas.add(pedaco.replace(/\s*\([^)]*\)/g, "").trim());
      }
    }
  }

  return celulas;
}

describe(`o texto do ecrã é o da tabela de ${ESPECIFICACAO}`, () => {
  const celulas = celulasDaTabela();
  const seccao = seccaoNove();

  it("a tabela foi mesmo lida", () => {
    expect(
      celulas.size,
      `li ${String(celulas.size)} células na secção 9 e esperava pelo menos ` +
        `${String(MINIMO_DE_CELULAS)}: «não consegui procurar» não é «está tudo a condizer».`,
    ).toBeGreaterThanOrEqual(MINIMO_DE_CELULAS);
  });

  it.each(Object.entries(TEXTOS_DO_VISITA_NOS))(
    "«%s» está na tabela, palavra por palavra",
    (chave, valor) => {
      expect(
        celulas.has(valor),
        `o texto «${chave}» é «${valor}» e essa frase não está numa célula da secção 9 de ` +
          `${ESPECIFICACAO}: ou mudou no código sem passar pelo dominio-bar, ou mudou na ` +
          "especificação e falta mudá-la em `src/testes/visita-nos.ts`.",
      ).toBe(true);
    },
  );

  it.each(Object.entries(LINHAS_DO_MOMENTO))(
    "a linha do momento «%s» está na tabela",
    (chave, valor) => {
      expect(seccao.includes(valor), `«${valor}» (${chave}) não está na secção 9`).toBe(true);
    },
  );

  it.each(NOMES_DOS_DIAS_NA_TABELA)("o dia «%s» está na linha «Dias»", (dia) => {
    const linhaDosDias = seccao.split("\n").find((linha) => linha.includes("| Dias |"));

    expect(linhaDosDias, "não encontrei a linha «Dias» da secção 9").toBeDefined();
    expect(linhaDosDias).toContain(dia);
  });

  it("nenhuma frase do ecrã leva seta, emoji, reticências de três pontos ou etiqueta em maiúsculas", () => {
    const todas = [...Object.values(TEXTOS_DO_VISITA_NOS), ...Object.values(LINHAS_DO_MOMENTO)];

    for (const frase of todas) {
      expect(frase, `«${frase}»`).not.toMatch(/→|—|\.\.\.|\p{Extended_Pictographic}/u);
      expect(frase, `«${frase}» tem uma etiqueta em maiúsculas`).not.toMatch(
        /\b[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ]{3,}\b/,
      );
    }
  });

  it("as palavras da regra 6 não aparecem", () => {
    const todas = [
      ...Object.values(TEXTOS_DO_VISITA_NOS),
      ...Object.values(LINHAS_DO_MOMENTO),
    ].join("\n");

    expect(todas).not.toMatch(/cardápio|arquivo|deletar|carregando|tentando/i);
  });
});

describe("o ficheiro de produção tem os mesmos textos", () => {
  const origem = lerTexto(
    join(RAIZ_FRONTEND, "src/pages/publico/textos-do-visita-nos.ts"),
    "os textos da secção Visita-nos (textos-do-visita-nos.ts)",
  );

  it.each(Object.entries(TEXTOS_DO_VISITA_NOS))(
    "«%s» está escrito em textos-do-visita-nos.ts",
    (chave, valor) => {
      expect(
        origem.includes(valor),
        `«${valor}» (${chave}) não está em textos-do-visita-nos.ts`,
      ).toBe(true);
    },
  );
});
