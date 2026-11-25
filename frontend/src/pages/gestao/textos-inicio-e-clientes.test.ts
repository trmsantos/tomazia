// @vitest-environment node
/**
 * F4-05b, critério 15 (Q-05) — o vocabulário do Início e dos Clientes.
 *
 * A varredura geral (`src/textos-pt-pt.test.ts`) já cobre estes ficheiros (entraram em
 * `FICHEIROS_DA_F4_05B`) com a lista de pt-BR do projeto — mas essa lista **não** tem «apagar»,
 * «remover» nem «downloads», e a spec pede-os aqui: **Eliminar** / **eliminado**, nunca «apagar»,
 * «remover» ou «deletar»; **ficheiro** e **descargas**, nunca «arquivo» nem «downloads». Os dados
 * de terceiros (um cliente chamado «Remo») nunca estão no código, por isso a varredura é só ao
 * texto escrito no código.
 *
 * Falha com «não consegui procurar» se os ficheiros não existem (regra 10).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FICHEIROS_DA_F4_05B } from "./../../testes/ecras";
import { RAIZ_FRONTEND, lerTexto } from "../../testes/percorrer-arvore";

const PROIBIDAS =
  /\b(?:apag\w*|remov\w*|remo[çc]\w*|delet\w*|download\w*|arquiv\w*|cardápio|salvar|usuário|aplicativo)\b/i;

/** O texto que chega ao ecrã: nós de texto do JSX e cadeias entre aspas, com um espaço dentro. */
function textoEscrito(fonte: string): Array<{ linha: number; texto: string }> {
  const achados: Array<{ linha: number; texto: string }> = [];
  fonte.split("\n").forEach((linha, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(linha)) return;
    for (const no of linha.matchAll(/>([^<>{}]+)</g)) {
      const t = (no[1] ?? "").trim();
      if (t.length > 0) achados.push({ linha: i + 1, texto: t });
    }
    for (const c of linha.matchAll(/["`]([^"`\n]*[ A-Za-zÀ-ú][^"`\n]*)["`]/g)) {
      achados.push({ linha: i + 1, texto: c[1] ?? "" });
    }
  });
  return achados;
}

describe("o vocabulário do Início e dos Clientes (Q-05)", () => {
  it("os ficheiros existem (sem isto, «não encontrei nada» não prova nada)", () => {
    const emFalta = FICHEIROS_DA_F4_05B.filter((r) => !existsSync(join(RAIZ_FRONTEND, r)));
    expect(emFalta, "ficheiros em falta: a varredura não tem onde procurar").toEqual([]);
  });

  it("«eliminar», nunca «apagar», «remover», «deletar»; «ficheiro» e «descargas», nunca «arquivo» nem «downloads»", () => {
    const violacoes: string[] = [];
    for (const relativo of FICHEIROS_DA_F4_05B) {
      const fonte = lerTexto(join(RAIZ_FRONTEND, relativo), relativo);
      for (const { linha, texto } of textoEscrito(fonte)) {
        const m = PROIBIDAS.exec(texto);
        if (m !== null) violacoes.push(`${relativo}:${String(linha)} usa «${m[0]}» em «${texto}»`);
      }
    }
    expect(violacoes).toEqual([]);
  });

  it("o texto do CSV diz «ficheiro» e «descargas», e o do aviso nunca «descarregado» (o ecrã não sabe)", () => {
    const relativo = "src/pages/gestao/clientes/textos.ts";
    const fonte = lerTexto(join(RAIZ_FRONTEND, relativo), relativo);
    expect(fonte).toContain(
      "Ficheiro CSV preparado. Se não aparecer nas descargas, exporta outra vez.",
    );
    expect(fonte).toContain(
      "O ficheiro tem dados pessoais dos clientes. Guarda-o só onde precisares.",
    );
    expect(fonte).not.toMatch(/CSV descarregado|ficheiro descarregado/i);
  });
});
