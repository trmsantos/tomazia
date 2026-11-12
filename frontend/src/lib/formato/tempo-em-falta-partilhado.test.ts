// @vitest-environment node
/**
 * F4-01, secção 3.6 — há **uma** `tempoComposto`, e os dois ecrãs importam-na.
 *
 * A F3-05 já teve de corrigir duas cópias que divergiam na fronteira dos
 * 60–119 s. Este teste fecha o caminho de uma terceira cópia: a função vive em
 * `src/lib/formato/tempo-em-falta.ts`, e nenhum outro ficheiro de `src/` (fora
 * dos testes) a define de novo.
 *
 * **O que deixa passar:** uma cópia com outro nome. A regra da casa é a de
 * sempre — a revisão olha para isso; aqui só se apanha a duplicação literal.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  lerTexto,
  listarFicheiros,
} from "../../testes/percorrer-arvore";

const DEFINE_A_FUNCAO = /\bfunction\s+tempoComposto\b|\bconst\s+tempoComposto\s*=/;

describe("tempoComposto é uma só", () => {
  it("o módulo partilhado existe e exporta a função", () => {
    const fonte = lerTexto(
      join(RAIZ_FRONTEND, "src/lib/formato/tempo-em-falta.ts"),
      "src/lib/formato/tempo-em-falta.ts",
    );
    expect(fonte).toMatch(/export\s+(?:function|const)\s+tempoComposto\b/);
  });

  it("só o módulo partilhado a define", () => {
    const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, "src"), {
      extensoes: [".ts", ".tsx"],
    }).filter((ficheiro) => !/\.(test|spec)\.tsx?$/.test(ficheiro));

    expect(
      ficheiros.length,
      "a varredura devolveu zero ficheiros: isto é «não procurei», não «está limpo»",
    ).toBeGreaterThan(0);

    const definem = ficheiros
      .filter((ficheiro) => DEFINE_A_FUNCAO.test(lerTexto(ficheiro, ficheiro)))
      .map((ficheiro) => caminhoRelativo(ficheiro));

    expect(definem).toEqual(["src/lib/formato/tempo-em-falta.ts"]);
  });

  it.each(["src/pages/publico/FolhaEnviarFoto.tsx", "src/pages/gestao/Entrar.tsx"])(
    "%s importa-a do módulo partilhado",
    (relativo) => {
      const fonte = lerTexto(join(RAIZ_FRONTEND, relativo), relativo);
      expect(fonte).toMatch(
        /import\s*\{[^}]*\btempoComposto\b[^}]*\}\s*from\s*["'][^"']*lib\/formato\/tempo-em-falta["']/,
      );
    },
  );
});
