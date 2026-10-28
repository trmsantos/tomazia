// @vitest-environment node
/**
 * F2-09 — o artefacto versionado: `src/lib/api/gerado/esquema.ts`.
 *
 * Este teste lê o ficheiro **do disco**, não o importa. É de propósito: um
 * `import type` não prova que o ficheiro existe com conteúdo (os tipos
 * desaparecem na compilação, e um ficheiro vazio importa-se na mesma sem
 * erro nenhum). Ler o ficheiro é também o que torna impossível voltar ao
 * `echo` que o `npm run gerar-api` era antes desta tarefa — um comando que
 * não escreve nada não deixa nada para ler aqui.
 *
 * Prende três coisas, e nenhuma delas é redundante com o
 * `gerador.test.ts` (que só olha para o comportamento da ferramenta, em
 * pastas temporárias):
 *
 *  1. **as cinco rotas e os quatro envelopes estão lá.** Apanha o ficheiro
 *     gerado a partir de um backend meio montado, ou um ficheiro
 *     desatualizado que alguém cometeu à mão.
 *  2. **o ficheiro não é o degenerado.** `paths = Record<string, never>` é
 *     o que sai de um OpenAPI vazio; o `tsc` aceita-o em silêncio.
 *  3. **o gerado não traz valores em tempo de execução.** É o critério
 *     Q-02 (JavaScript da área pública abaixo de 100 KB): tipos custam 0
 *     bytes, um `enum` ou um `export const` custam bytes a sério. O
 *     openapi-typescript tem opções (`--enum`, `--enum-values`) que os
 *     emitem; se alguém as ligar, isto fica vermelho.
 *
 * **O que deixa passar:** não compara o ficheiro com o OpenAPI do backend
 * de agora — não pode, porque `frontend/openapi.json` é um artefacto e nem
 * sequer está versionado. Quem apanha a deriva é o job de contrato do CI,
 * que regenera os dois e compara. Aqui prova-se que o que está versionado
 * é um esquema a sério, não um restinho.
 */
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "../../testes/percorrer-arvore";

const CAMINHO_DO_ESQUEMA = join(RAIZ_FRONTEND, "src", "lib", "api", "gerado", "esquema.ts");

/**
 * As cinco rotas públicas que o backend serve depois da F2-03. O `/health`
 * é uma delas: não tem função no cliente (ninguém no site pergunta pela
 * saúde do servidor), mas faz parte do contrato e a sua ausência aqui
 * quereria dizer que o esquema foi gerado de um `app/main.py` incompleto.
 */
const ROTAS = ["/ementa", "/eventos", "/galeria", "/health", "/info"];

/** Os quatro envelopes nomeados de `app/schemas/publico.py`. */
const ENVELOPES = ["RespostaEmenta", "RespostaEventos", "RespostaGaleria", "RespostaInfo"];

/**
 * Tira comentários de bloco e de linha. Sem isto, procurar `enum ` no
 * ficheiro acusava o `* @enum {string}` que o openapi-typescript escreve
 * no JSDoc de cada campo com `Literal` — uma anotação, não um valor.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("o esquema gerado está versionado e tem o contrato inteiro", () => {
  it("traz as cinco rotas públicas", () => {
    const fonte = lerTexto(CAMINHO_DO_ESQUEMA, "o esquema gerado (src/lib/api/gerado/esquema.ts)");

    expect(fonte.length, "o esquema gerado está vazio: corre `npm run gerar-api`").toBeGreaterThan(
      0,
    );

    const emFalta = ROTAS.filter((rota) => !fonte.includes(`"${rota}"`));
    expect(
      emFalta,
      "faltam rotas no esquema gerado. Regenera-o com `npm run gerar-api` depois de " +
        "`cd backend && AMBIENTE=desenvolvimento uv run python -m app.openapi`.",
    ).toEqual([]);
  });

  it("traz os quatro envelopes nomeados", () => {
    const fonte = lerTexto(CAMINHO_DO_ESQUEMA, "o esquema gerado (src/lib/api/gerado/esquema.ts)");

    const emFalta = ENVELOPES.filter((envelope) => !fonte.includes(envelope));
    expect(
      emFalta,
      "faltam envelopes no esquema gerado: o backend devolve `{categorias: …}`, " +
        "`{eventos: …}`, `{fotos: …}` e o corpo de `/info`, nunca arrays no topo.",
    ).toEqual([]);
  });

  it("não é o esquema degenerado que sai de um OpenAPI vazio", () => {
    const fonte = lerTexto(CAMINHO_DO_ESQUEMA, "o esquema gerado (src/lib/api/gerado/esquema.ts)");

    expect(
      fonte,
      "`paths = Record<string, never>` é o que o openapi-typescript escreve a " +
        "partir de um OpenAPI sem rotas — e o `npm run typecheck` aceita-o em silêncio.",
    ).not.toContain("export type paths = Record<string, never>");
    expect(fonte).toContain("export interface paths");
  });
});

describe("o esquema gerado custa 0 bytes em tempo de execução (Q-02)", () => {
  it("não declara valores: nada de export const, enum, function nem class", () => {
    const fonte = semComentarios(
      lerTexto(CAMINHO_DO_ESQUEMA, "o esquema gerado (src/lib/api/gerado/esquema.ts)"),
    );

    const proibidos = [
      { padrao: /\bexport\s+const\b/, nome: "export const" },
      { padrao: /\benum\s+\w/, nome: "enum " },
      { padrao: /\bfunction\s+\w/, nome: "function " },
      { padrao: /\bclass\s+\w/, nome: "class " },
    ];

    const encontrados = proibidos
      .filter(({ padrao }) => padrao.test(fonte))
      .map(({ nome }) => nome);

    expect(
      encontrados,
      "o esquema gerado só pode ter tipos. Se o `npm run gerar-api` ganhou `--enum` " +
        "ou `--enum-values`, tira-os: isso entra no pacote da área pública.",
    ).toEqual([]);
  });

  it("compilado para JavaScript, não sobra uma única instrução", () => {
    // A prova a sério, e não um padrão de texto: passa o ficheiro pelo
    // TypeScript e olha para o JavaScript que sai. Um ficheiro só de tipos
    // compila para comentários e um `export {}`; qualquer valor declarado
    // aparece aqui, por mais criativa que fosse a forma de o escrever.
    const fonte = lerTexto(CAMINHO_DO_ESQUEMA, "o esquema gerado (src/lib/api/gerado/esquema.ts)");

    const compilado = ts.transpileModule(fonte, {
      fileName: "esquema.ts",
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    const sobra = semComentarios(compilado)
      .replace(/export\s*\{\s*\}\s*;?/g, "")
      .trim();

    expect(
      sobra,
      "o esquema gerado emitiu JavaScript. Tipos são 0 bytes no pacote; valores não.",
    ).toBe("");
  });
});
