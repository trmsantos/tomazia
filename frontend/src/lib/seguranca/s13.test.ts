// @vitest-environment node
/**
 * Prova do critério de segurança S-13: `dangerouslySetInnerHTML` tem de
 * fazer o ESLint falhar — não uma config qualquer, a config **real** do
 * projeto, `frontend/eslint.config.js`.
 *
 * Por isso este teste não passa `overrideConfigFile`/`overrideConfig`: cria
 * o `ESLint` com `cwd` na raiz do `frontend/` (derivada de
 * `import.meta.url`, sem caminhos absolutos escritos à mão) e deixa o
 * próprio ESLint resolver o `eslint.config.js` do projeto. Se alguém
 * apagar as regras do S-13 desse ficheiro, este teste fica vermelho.
 *
 * O código a lintar vai numa string, com um `filePath` virtual dentro do
 * projeto (`src/exemplo-s13(...).tsx`/`.ts`) que não existe no disco — só
 * para a config se aplicar (padrões de `files`) e o ficheiro não cair nos
 * `ignores`. Não há nenhum ficheiro-fixture no repositório.
 *
 * Isto só funciona porque a decisão D-8 do arquiteto fixa que o
 * `eslint.config.js` desta tarefa usa `typescript-eslint` em
 * `recommended`, **sem** type-aware linting (sem `parserOptions.project`
 * nem `projectService`): regras type-aware exigem resolver um
 * `tsconfig.json` real a partir do `filePath`, e isso rebentaria com um
 * caminho virtual que não existe. Quem tornar a config type-aware mais
 * tarde tem de converter este teste para um ficheiro-fixture real em
 * disco (e já não pode usar `lintText` com um `filePath` virtual).
 *
 * A D-8 manda o S-13 ter dois mecanismos no `eslint.config.js`, e este
 * ficheiro prende os dois com casos separados, para que apagar qualquer
 * um deles, sozinho, faça um teste falhar:
 *   1. `react/no-danger` — apanha o atributo JSX `dangerouslySetInnerHTML`.
 *   2. `no-restricted-syntax` com os seletores
 *      `JSXAttribute[name.name='dangerouslySetInnerHTML']` e
 *      `Property[key.name='dangerouslySetInnerHTML']` — apanha tanto o
 *      atributo JSX como a chave de objeto fora de JSX.
 *
 * Duas notas de ambiente que este ficheiro exige e que não se devem
 * desfazer sem perceber porquê:
 *   - O docblock `@vitest-environment node` no topo deste ficheiro (acima
 *     deste comentário) manda correr em ambiente `node`, não `jsdom`: o
 *     `new URL("../../..", import.meta.url)` abaixo precisa do `URL`
 *     nativo do Node; o polyfill de `URL` do jsdom rejeita esta resolução
 *     relativa de `file:`. O Vitest 5 removeu `environmentMatchGlobs` do
 *     `vite.config.ts` (mecanismo global antigo); este docblock por
 *     ficheiro é o substituto oficial, e fica mais visível aqui do que
 *     numa lista central em `vite.config.ts`.
 *   - `src/configuracao-testes.ts` importa
 *     `@testing-library/jest-dom/vitest` (não a entrada simples) porque
 *     este ficheiro importa `expect` de `"vitest"` em vez de usar globais.
 */
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const RAIZ_FRONTEND = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * `ESLint.lintText` devolve `ESLint.LintResult[]`, não um tuplo — com
 * `noUncheckedIndexedAccess` (fixado no `tsconfig.json`), desestruturar o
 * primeiro elemento dá um tipo `LintResult | undefined`. Em vez de calar o
 * compilador com `!`, afirma-se explicitamente que há exatamente um
 * resultado (um ficheiro lintado): se `lintText` alguma vez devolver um
 * array vazio, isto rebenta com uma mensagem legível, não um `TypeError`
 * obscuro mais abaixo.
 */
function obterUnicoResultado(resultados: ESLint.LintResult[]): ESLint.LintResult {
  const resultado = resultados[0];
  if (resultado === undefined) {
    throw new Error(
      "eslint.lintText devolveu um array vazio; esperava-se exatamente um resultado (um ficheiro lintado).",
    );
  }
  return resultado;
}

const CODIGO_JSX_COM_ATRIBUTO = `
import React from "react";

export function ExemploInseguro({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
`;

const CODIGO_PROPRIEDADE_FORA_DE_JSX = `
export function construirPropriedadesInseguras(html: string) {
  const propriedades = { dangerouslySetInnerHTML: { __html: html } };
  return propriedades;
}
`;

// Mesma chave, mas escrita como literal de string em vez de identificador.
// Semanticamente é a mesma propriedade (`objeto.dangerouslySetInnerHTML`
// continua a funcionar), mas no AST o `key` passa a ser um `Literal` (com
// `.value`) em vez de um `Identifier` (com `.name`).
const CODIGO_PROPRIEDADE_COM_CHAVE_LITERAL = `
export function construirPropriedadesInseguras(html: string) {
  const propriedades = { "dangerouslySetInnerHTML": { __html: html } };
  return propriedades;
}
`;

// Mesmo código que `CODIGO_PROPRIEDADE_FORA_DE_JSX`, sem anotação de tipos:
// `.js`/`.jsx` não aceitam a sintaxe TypeScript `html: string`.
const CODIGO_PROPRIEDADE_SEM_TIPOS = `
export function construirPropriedadesInseguras(html) {
  const propriedades = { dangerouslySetInnerHTML: { __html: html } };
  return propriedades;
}
`;

describe("S-13: dangerouslySetInnerHTML é proibido", () => {
  it("atributo JSX: apanhado por react/no-danger e por no-restricted-syntax", async () => {
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_JSX_COM_ATRIBUTO, {
      filePath: "src/exemplo-s13-jsx.tsx",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("react/no-danger");
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });

  it("propriedade de objeto fora de JSX: apanhada por no-restricted-syntax", async () => {
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_PROPRIEDADE_FORA_DE_JSX, {
      filePath: "src/exemplo-s13-objeto.ts",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    // Sem JSX nenhum, react/no-danger não tem nada para analisar: só o
    // no-restricted-syntax (seletor `Property`) apanha este caso. Prender
    // a ausência do react/no-danger aqui garante que os dois mecanismos
    // são testados separadamente, não só em conjunto.
    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
    expect(idsDasRegrasComMensagem).not.toContain("react/no-danger");
  });

  it("chave de objeto como literal de string: apanhada por no-restricted-syntax", async () => {
    // Furo encontrado na revisão de código: o seletor
    // `Property[key.name='dangerouslySetInnerHTML']` só apanha chaves
    // identificador. Uma chave escrita como literal de string
    // (`{ "dangerouslySetInnerHTML": ... }`) é um `Literal` no AST, com
    // `.value` em vez de `.name` — esse seletor passa ao lado, e isto dava
    // 0 erros antes da correção.
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_PROPRIEDADE_COM_CHAVE_LITERAL, {
      filePath: "src/exemplo-s13-chave-literal.ts",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });

  it("propriedade de objeto num ficheiro .js: apanhada por no-restricted-syntax", async () => {
    // Furo encontrado na revisão de segurança: o bloco de regras do S-13
    // tem `files: ["**/*.{ts,tsx}"]`, por isso um `.js` com esta
    // propriedade era lintado (pelas regras base, sem o S-13) e dava 0
    // erros — passava.
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_PROPRIEDADE_SEM_TIPOS, {
      filePath: "src/exemplo-s13-objeto.js",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });

  it("propriedade de objeto num ficheiro .jsx: apanhada por no-restricted-syntax", async () => {
    // Mesmo furo que o `.js`, mas pior: um `.jsx` nem chegava a ser
    // lintado ("File ignored because no matching configuration was
    // supplied."), em vez de só passar sem a regra do S-13.
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_PROPRIEDADE_SEM_TIPOS, {
      filePath: "src/exemplo-s13-objeto.jsx",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });
});
