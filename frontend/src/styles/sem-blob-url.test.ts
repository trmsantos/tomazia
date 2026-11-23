// @vitest-environment node
/**
 * Nenhum `URL.createObjectURL` em código de produção.
 *
 * `deploy/htaccess.exemplo` serve `img-src 'self' data:` (ADR 0008): um
 * `blob:` em `<img src>` é bloqueado em produção, e o servidor de
 * desenvolvimento e o jsdom não aplicam CSP, por isso nada falha enquanto
 * se escreve. As prévias de ficheiros fazem-se com `data:` (FileReader).
 * O `e2e/csp-producao.spec.ts` vê o resultado; esta varredura apanha a forma.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "../testes/percorrer-arvore";

/**
 * O detetor, isolado. Caso marginal conhecido: uma linha de código que
 * comece por `*` (continuação de uma multiplicação partida em linhas) é
 * tomada por comentário e escapa; é raro e aceite.
 */
function chamaCreateObjectUrl(linha: string): boolean {
  const codigo = linha.trim();
  if (/^(\/\/|\/\*|\*)/.test(codigo)) return false;
  return /\bcreateObjectURL\b/.test(codigo);
}

describe("o detetor", () => {
  it("apanha uma chamada e ignora comentários", () => {
    expect(chamaCreateObjectUrl("const u = URL.createObjectURL(x);")).toBe(true);
    expect(chamaCreateObjectUrl("  // URL.createObjectURL(x)")).toBe(false);
    expect(chamaCreateObjectUrl(" * usa createObjectURL")).toBe(false);
  });
});

describe("varredura em disco: sem URLs blob: em produção", () => {
  it("nenhum ficheiro de produção chama createObjectURL", () => {
    const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, "src"), {
      extensoes: [".ts", ".tsx"],
    }).filter((ficheiro) => {
      const relativo = caminhoRelativo(ficheiro);
      return (
        !relativo.startsWith("src/lib/api/gerado/") &&
        !relativo.endsWith("sem-blob-url.test.ts") &&
        !/\.test\.tsx?$/.test(relativo)
      );
    });

    exigirSentinelas(
      ficheiros,
      ["src/App.tsx", "src/pages/publico/FolhaEnviarFoto.tsx", "src/lib/imagens/reduzir.ts"],
      "createObjectURL",
    );

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      lerTexto(ficheiro, relativo)
        .split("\n")
        .forEach((linha, indice) => {
          if (chamaCreateObjectUrl(linha)) violacoes.push(`${relativo}:${indice + 1}`);
        });
    }

    expect(
      violacoes,
      "A CSP `img-src 'self' data:` bloqueia blob: em produção. Usa FileReader.readAsDataURL.",
    ).toEqual([]);
  });
});
