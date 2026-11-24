// @vitest-environment node
/**
 * F4-04b, spec 12 (a tabela de textos validada pelo dominio-bar) e critério 12 (Q-05): cada frase
 * visível da secção «Fotos no site» e da folha de eliminar está **por extenso** em
 * `src/pages/gestao/galeria/textos.ts` (ou nos componentes novos), e nenhuma diz «apagar»,
 * «remover» ou «deletar» ao dono: é **Eliminar**, **eliminada**.
 *
 * Não impõe os nomes das chaves (são do implementador): lê o texto do ficheiro e procura a frase.
 * Frases com `{n}`, `{quando}`, `{nome}` são testadas pelos pedaços fixos. As frases compostas
 * (`Aprovada {quando}`) comprovam-se por comportamento em `GaleriaGestao.aprovadas.test.tsx`.
 *
 * Regra 10: se o ficheiro de textos não se conseguir ler, o teste **falha** (não passa por «não
 * encontrei a frase a mais»); `exigirSentinelas` do guarda de Q-05 vê os ficheiros novos.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TEXTOS_APROVADAS as A } from "../../../testes/fotos-gestao-textos";
import { RAIZ_FRONTEND, lerTexto } from "../../../testes/percorrer-arvore";

const PASTA = join(RAIZ_FRONTEND, "src", "pages", "gestao", "galeria");
const NOVOS = ["FotosAprovadas.tsx", "FolhaEliminarFoto.tsx"] as const;

function fonteDosTextos(): string {
  const ficheiros = ["textos.ts", ...NOVOS].map((nome) => join(PASTA, nome));
  for (const f of ficheiros) {
    if (!existsSync(f)) throw new Error(`o ficheiro ${f} devia existir e não existe`);
  }
  return ficheiros.map((f) => lerTexto(f, "um ficheiro de textos da F4-04b")).join("\n");
}

const FRASES_FIXAS: ReadonlyArray<string> = [
  A.titulo,
  A.eliminar,
  A.aEliminar,
  A.cancelar,
  A.semImagem,
  A.vazioTitulo,
  A.vazioLinha,
  A.carregarTitulo,
  A.carregarSemResposta,
  A.carregarServidor,
  A.mostrarMais,
  A.tituloDaFolha,
  A.avisoDaFolha,
  A.naoSeMostra,
  A.erroNaFolha,
  A.avisoEliminada,
  A.jaNaoExistia,
  A.jaNaoEstaNoSite,
  A.aVerificar,
  A.continuaSemResposta,
  A.semConfirmar,
  A.verificarOutraVez,
  A.desatualizada,
  "Eliminar foto aprovada",
  "A mostrar",
  "Aprovada ",
  "Enviada por ",
];

describe("os textos da F4-04b estão por extenso nos ficheiros da secção (spec 12)", () => {
  it("os ficheiros novos existem", () => {
    expect(readdirSync(PASTA)).toEqual(expect.arrayContaining([...NOVOS]));
  });

  it.each(FRASES_FIXAS)("«%s»", (frase) => {
    expect(fonteDosTextos()).toContain(frase);
  });

  it("nunca «apagar», «remover», «deletar» no texto novo (ficheiros novos e chaves novas de textos.ts; o «apagada» do rejeitar da F4-04 está validado)", () => {
    const texto = (f: string): string => lerTexto(join(PASTA, f), "um ficheiro da F4-04b");
    const inicio = texto("textos.ts").indexOf("export const TEXTOS_APROVADAS");
    // Regra 10: «não encontrei a região» não pode passar por «não há palavras proibidas».
    expect(inicio, "a região TEXTOS_APROVADAS de textos.ts foi encontrada").toBeGreaterThanOrEqual(
      0,
    );
    const regiao = texto("textos.ts").slice(inicio);
    expect(regiao).toContain("quandoFoiAprovada");
    expect(regiao).toContain("nomeDoBotaoEliminar");
    for (const fonte of [regiao, ...NOVOS.map(texto)]) {
      expect(fonte.length).toBeGreaterThan(200);
      const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(semComentarios).not.toMatch(/["'`][^"'`\n]*\b(apag|remov|delet)\w*[^"'`\n]*["'`]/i);
    }
  });
});
