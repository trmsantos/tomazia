// @vitest-environment node
/**
 * F3-01 — o texto visível dos componentes é português de Portugal.
 *
 * Critério Q-05 da especificação e regra 6 do `CLAUDE.md`. É uma varredura
 * de texto, como a do S-13, e vale pela mesma razão: ninguém escreve
 * "cardápio" de propósito, escreve-o distraído, e numa revisão de 400
 * linhas a palavra passa.
 *
 * Âmbito: `src/components/**`, `src/demonstracao/**` e `src/pages/**`. A
 * pasta dos ecrãs entra na F3-02 (12.10), com o primeiro ecrã a sério — e as
 * sentinelas crescem com ela, senão a varredura de uma pasta que não existe
 * passa por "não encontrei nada".
 *
 * **O que esta varredura deixa passar:** texto vindo da API (um produto
 * chamado "Cardápio" é do dono, não nosso) e frases construídas por
 * concatenação. A contagem de resultados da ementa
 * (`{n} produtos encontrados.`) é concatenação, e por isso tem teste próprio
 * para o singular e para o plural em `src/pages/publico/Ementa.test.tsx`.
 *
 * O que cada regra apanha, e porquê:
 *  - **palavras de pt-BR**: a lista da regra 6. Uma delas é "arquivo": em
 *    PT-PT um ficheiro é um ficheiro. (Se um dia a gestão precisar de
 *    "Arquivo" como nome da secção dos eventos passados — F4-03 —, é outra
 *    palavra e discute-se então, fora desta varredura.)
 *  - **gerúndio brasileiro** ("Guardando", "Carregando"): o nosso é "A
 *    guardar…".
 *  - **reticências com três pontos**: `…` é um caractere (U+2026). Três
 *    pontos quebram a linha no sítio errado e lêem-se "ponto ponto ponto".
 *  - **etiquetas em maiúsculas**: a especificação proíbe-as — "Fica de
 *    fora: (…) etiquetas em maiúsculas".
 *  - **seta e emojis**: também na lista do que fica de fora.
 *  - **espaço antes do €**: tem de ser inquebrável (U+00A0). Com um espaço
 *    normal, "6,50 €" parte-se em duas linhas no fim de uma linha de
 *    ementa, e o preço aparece sozinho na linha seguinte.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMPONENTES_DA_F3_01 } from "./testes/componentes";
import { FICHEIROS_DA_F3_02, FICHEIROS_DA_F3_03 } from "./testes/ecras";
import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "./testes/percorrer-arvore";

const PALAVRAS_DE_OUTRO_PORTUGUES = [
  "cardápio",
  "arquivo",
  "deletar",
  "salvar",
  "usuário",
  "aplicativo",
  "tela",
  "você",
];

const SIGLAS_PERMITIDAS = new Set([
  "CSS",
  "HTML",
  "API",
  "URL",
  "CSP",
  "WCAG",
  "PT",
  "QR",
  "OFL",
  "ARIA",
  "DOM",
  "SVG",
]);

/**
 * O texto que chega ao ecrã: nós de texto do JSX e cadeias entre aspas com
 * um espaço lá dentro (etiquetas, rótulos, mensagens). Identificadores e
 * nomes de classes ficam de fora, que é o que evita falsos positivos em
 * constantes como `DURACAO_MS`.
 */
export function textoVisivel(fonte: string): { linha: number; texto: string }[] {
  const encontrados: { linha: number; texto: string }[] = [];
  fonte.split("\n").forEach((linha, indice) => {
    for (const no of linha.matchAll(/>([^<>{}]+)</g)) {
      const texto = (no[1] ?? "").trim();
      if (texto.length > 0) encontrados.push({ linha: indice + 1, texto });
    }
    for (const cadeia of linha.matchAll(/"([^"\n]* [^"\n]*)"/g)) {
      const texto = cadeia[1] ?? "";
      if (texto.trim().length > 0) encontrados.push({ linha: indice + 1, texto });
    }
  });
  return encontrados;
}

function ficheirosDaInterface(): string[] {
  return [
    ...listarFicheiros(join(RAIZ_FRONTEND, "src", "components"), { extensoes: [".ts", ".tsx"] }),
    ...listarFicheiros(join(RAIZ_FRONTEND, "src", "demonstracao"), { extensoes: [".ts", ".tsx"] }),
    ...listarFicheiros(join(RAIZ_FRONTEND, "src", "pages"), { extensoes: [".ts", ".tsx"] }),
  ].filter((ficheiro) => !/\.test\.tsx?$/.test(ficheiro));
}

/**
 * As sentinelas das três tarefas juntas.
 *
 * Crescem com os ficheiros novos de propósito: sem a linha da F3-02, a
 * varredura de uma `src/pages/` vazia (ou inexistente) devolveria zero
 * ficheiros, encontraria zero violações e passaria. "Não consegui procurar"
 * a dar o mesmo resultado que "não encontrei" é a regra 10 do `CLAUDE.md`.
 *
 * A linha da F3-03 é mais estreita do que a da F3-02 e mais necessária: a
 * pasta `src/pages/publico/` **já existe**, por isso o guarda de "zero
 * ficheiros" nunca dispararia, e o cabeçalho e a Folha do WiFi podiam nascer
 * com texto por rever sem nenhuma varredura lhes tocar (F3-03, secção 10,
 * Q-05).
 */
const SENTINELAS = [...COMPONENTES_DA_F3_01, ...FICHEIROS_DA_F3_02, ...FICHEIROS_DA_F3_03];

describe("texto visível em português de Portugal", () => {
  it("nenhuma palavra de outro português, nem gerúndio brasileiro", () => {
    const ficheiros = ficheirosDaInterface();
    exigirSentinelas(ficheiros, SENTINELAS, "textos em PT-PT");

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      const fonte = lerTexto(ficheiro, relativo);

      fonte.split("\n").forEach((linha, indice) => {
        for (const palavra of PALAVRAS_DE_OUTRO_PORTUGUES) {
          if (new RegExp(`\\b${palavra}`, "i").test(linha)) {
            violacoes.push(`${relativo}:${indice + 1} usa «${palavra}»`);
          }
        }
      });

      for (const { linha, texto } of textoVisivel(fonte)) {
        if (/\b(?:guardando|carregando|enviando|salvando|aguardando)\b/i.test(texto)) {
          violacoes.push(`${relativo}:${linha} usa gerúndio brasileiro em «${texto}»`);
        }
      }
    }

    expect(violacoes).toEqual([]);
  });

  it("nada de emojis, setas, reticências em três pontos nem etiquetas em maiúsculas", () => {
    const ficheiros = ficheirosDaInterface();
    exigirSentinelas(ficheiros, SENTINELAS, "textos em PT-PT");

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      for (const { linha, texto } of textoVisivel(lerTexto(ficheiro, relativo))) {
        if (/\p{Extended_Pictographic}/u.test(texto)) {
          violacoes.push(`${relativo}:${linha} tem um emoji em «${texto}»`);
        }
        if (texto.includes("→") || texto.includes("->")) {
          violacoes.push(`${relativo}:${linha} tem uma seta em «${texto}»`);
        }
        if (texto.includes("...")) {
          violacoes.push(`${relativo}:${linha} usa três pontos em vez de «…» em «${texto}»`);
        }
        for (const palavra of texto.match(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,}\b/g) ?? []) {
          if (!SIGLAS_PERMITIDAS.has(palavra)) {
            violacoes.push(`${relativo}:${linha} tem «${palavra}» em maiúsculas`);
          }
        }
      }
    }

    expect(violacoes).toEqual([]);
  });

  it("o espaço antes do € é inquebrável", () => {
    const ficheiros = ficheirosDaInterface();
    exigirSentinelas(ficheiros, SENTINELAS, "textos em PT-PT");

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      for (const { linha, texto } of textoVisivel(lerTexto(ficheiro, relativo))) {
        if (/\d[ \t]€/.test(texto)) {
          violacoes.push(
            `${relativo}:${linha} tem um espaço normal antes do € em «${texto}» ` +
              "(usa U+00A0, o espaço inquebrável)",
          );
        }
      }
    }

    expect(violacoes).toEqual([]);
  });
});

describe("autoteste do leitor de texto visível", () => {
  it("vê o texto do JSX e as cadeias de atributos, e ignora identificadores", () => {
    const fonte = [
      "const DURACAO_PADRAO_MS = 5000;",
      '<button aria-label="Fechar aviso">Guardar alterações</button>',
      '<p className="text-nota text-texto-suave">Preço: 6,50 €</p>',
    ].join("\n");

    const visivel = textoVisivel(fonte).map((achado) => achado.texto);

    expect(visivel).toContain("Guardar alterações");
    expect(visivel).toContain("Fechar aviso");
    expect(visivel).toContain("Preço: 6,50 €");
    expect(visivel.join(" "), "constantes em maiúsculas não são texto de ecrã").not.toContain(
      "DURACAO_PADRAO_MS",
    );
  });
});
