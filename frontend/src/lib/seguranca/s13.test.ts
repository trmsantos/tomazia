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
 *   2. `no-restricted-syntax` com seletores para cada forma de escrever a
 *      mesma chave fora do atributo JSX: `Property` com chave identificador
 *      ou literal de string (dentro de um objeto), e `MemberExpression` com
 *      ou sem acesso computado (`objeto.dangerouslySetInnerHTML = ...` e
 *      `objeto["dangerouslySetInnerHTML"] = ...`).
 *
 * Depois da revisão de segurança seguinte, este ficheiro ganhou um terceiro
 * `describe`, independente do ESLint: uma varredura do código-fonte em
 * disco, porque nenhuma regra de ESLint sobrevive a um `eslint-disable`
 * colocado de propósito por cima da linha perigosa — uma cadeia de texto
 * não lê diretivas de desativação. Ver o `describe` correspondente, mais
 * abaixo, para o detalhe.
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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

// Mesma chave, mas escrita como atribuição a uma propriedade existente, não
// dentro de um literal de objeto: `objeto.dangerouslySetInnerHTML = valor`.
// No AST isto é um `MemberExpression` (com `.property` um `Identifier`), não
// uma `Property` de `ObjectExpression` — os seletores `Property[...]` acima
// não têm nada para apanhar aqui.
const CODIGO_ATRIBUICAO_COM_PONTO = `
export function construirPropriedadesInseguras(html: string) {
  const propriedades: Record<string, unknown> = {};
  propriedades.dangerouslySetInnerHTML = { __html: html };
  return propriedades;
}
`;

// Mesma atribuição, mas por acesso computado com parênteses retos:
// `objeto["dangerouslySetInnerHTML"] = valor`. Continua a ser um
// `MemberExpression`, mas `computed: true` e `.property` passa a ser um
// `Literal` (com `.value`), não um `Identifier` (com `.name`) — precisa de
// um seletor à parte do da atribuição com ponto.
const CODIGO_ATRIBUICAO_COM_PARENTESIS_RETOS = `
export function construirPropriedadesInseguras(html: string) {
  const propriedades: Record<string, unknown> = {};
  propriedades["dangerouslySetInnerHTML"] = { __html: html };
  return propriedades;
}
`;

/**
 * Arrancar o ESLint em processo custa segundos, não milissegundos: ele lê a
 * flat config, resolve os plugins e constrói o Linter. O primeiro `it` de
 * cada bloco paga essa conta inteira e chega a levar sete segundos numa
 * máquina ocupada — acima dos 5 s por omissão do Vitest. Sem este limite, o
 * teste falhava a dizer "timed out" e não "a regra não acusou", que são
 * coisas opostas: a primeira é a máquina lenta, a segunda é o S-13 a cair.
 */
const ESPERA_PELO_ESLINT = { timeout: 30_000 };

describe("S-13: dangerouslySetInnerHTML é proibido", ESPERA_PELO_ESLINT, () => {
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

  it("propriedade de objeto num ficheiro .mts: apanhada por no-restricted-syntax", async () => {
    // Furo alargado pela ronda seguinte da revisão de segurança: o glob do
    // bloco S-13 cobria só `.js`, `.jsx`, `.ts` e `.tsx` — as extensões de
    // módulo explícitas (`.mts`, `.cts`, `.mjs`, `.cjs`), que o TypeScript
    // compila e o Vite consome na mesma, ficavam de fora, e um `.mts` com
    // esta propriedade passava sem ser lintado pela regra S-13. Este caso
    // prende só o `.mts` (o `eslint.config.js` tem de alargar o `files`
    // desse bloco às oito extensões); os outros três (`.cts`, `.mjs`,
    // `.cjs`) têm a mesma forma de furo, mas não precisam de um caso cada
    // um aqui só para provar o glob — a varredura em disco, mais abaixo,
    // continua a ser a rede que não depende de nenhum glob.
    //
    // Usa `CODIGO_PROPRIEDADE_SEM_TIPOS` (sem anotação de tipos), não
    // `CODIGO_PROPRIEDADE_FORA_DE_JSX`: o bloco principal da configuração
    // (que liga o parser `typescript-eslint`) só tem
    // `files: ["**/*.{ts,tsx}"]`, e não cobre `.mts` — por isso um `.mts`
    // é lido pelo parser por omissão (`espree`), que rebenta com um erro
    // fatal de análise perante sintaxe TypeScript (`html: string`),
    // mascarando o próprio teste do `no-restricted-syntax` com um erro de
    // parsing em vez de uma violação da regra.
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_PROPRIEDADE_SEM_TIPOS, {
      filePath: "src/exemplo-s13-objeto.mts",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });

  it("atribuição por acesso com ponto (MemberExpression): apanhada por no-restricted-syntax", async () => {
    // Furo encontrado na revisão de segurança: os seletores `Property[...]`
    // acima só olham para dentro de literais de objeto
    // (`ObjectExpression`). `propriedades.dangerouslySetInnerHTML = valor`
    // é uma atribuição a um `MemberExpression`, uma forma de AST diferente
    // — nenhum seletor anterior tinha nada para apanhar aqui, e isto dava
    // 0 erros antes da correção.
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_ATRIBUICAO_COM_PONTO, {
      filePath: "src/exemplo-s13-atribuicao-ponto.ts",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });

  it("atribuição por acesso com parênteses retos (MemberExpression computado): apanhada por no-restricted-syntax", async () => {
    // Mesmo furo que a atribuição com ponto, mas com acesso computado:
    // `propriedades["dangerouslySetInnerHTML"] = valor` também é um
    // `MemberExpression`, mas com `computed: true` e `.property` um
    // `Literal` (com `.value`) em vez de um `Identifier` (com `.name`) — um
    // seletor que só olhe para `.property.name` não apanha este caso.
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const resultados = await eslint.lintText(CODIGO_ATRIBUICAO_COM_PARENTESIS_RETOS, {
      filePath: "src/exemplo-s13-atribuicao-colchetes.ts",
    });
    const resultado = obterUnicoResultado(resultados);

    const idsDasRegrasComMensagem = resultado.messages.map((mensagem) => mensagem.ruleId);

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(idsDasRegrasComMensagem).toContain("no-restricted-syntax");
  });
});

/**
 * As oito extensões que o TypeScript compila e o Vite consome como
 * código-fonte: `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`, `.mts`,
 * `.tsx`. Mais `.json`: não é JavaScript/TypeScript, mas é texto puro, e um
 * `import dados from "./x.json"` espalhado diretamente num componente
 * (`<div {...dados} />`) pode trazer `dangerouslySetInnerHTML` escondido
 * dentro do próprio JSON, onde nenhum seletor de AST do ESLint o vai
 * procurar — só uma varredura de texto, como esta, o apanha. Custo zero
 * (o ficheiro já é lido como texto, nunca interpretado).
 *
 * Revisão de segurança seguinte: esta lista tinha só `.js`, `.jsx`, `.ts`
 * e `.tsx` (as mesmas quatro do glob antigo do bloco S-13 do
 * `eslint.config.js`) — faltavam as extensões de módulo explícitas
 * (`.cjs`, `.mjs`, `.cts`, `.mts`) e o `.json`.
 */
const EXTENSOES_DE_CODIGO_FONTE = [
  ".js",
  ".cjs",
  ".mjs",
  ".jsx",
  ".ts",
  ".cts",
  ".mts",
  ".tsx",
  ".json",
];

/**
 * Lista, recursivamente, todos os ficheiros de código-fonte (ver
 * `EXTENSOES_DE_CODIGO_FONTE`) dentro de `raiz`, por ordem alfabética a
 * cada nível (para a varredura ser determinística). Não filtra nenhuma
 * subpasta de propósito: `src/lib/api` está nos `ignores` do
 * `eslint.config.js` (fica fora do lint por completo), mas continua a ser
 * código-fonte real, e tem de entrar nesta varredura tal como qualquer
 * outra pasta.
 *
 * Dois furos fechados pela revisão de segurança seguinte, além da lista de
 * extensões acima:
 *
 *  1. **Maiúsculas.** `entrada.name.endsWith(extensao)` distinguia
 *     maiúsculas de minúsculas. Num sistema de ficheiros indiferente a
 *     maiúsculas (o macOS onde isto se desenvolve), um `import
 *     "./Ementa"` resolve para `Ementa.TSX` tal como para `Ementa.tsx` —
 *     por isso o nome é comparado em minúsculas
 *     (`entrada.name.toLowerCase().endsWith(extensao)`, com `extensao` já
 *     em minúsculas). Isto fecha uma coisa que o glob do ESLint, por si
 *     só, não consegue fechar: é mesmo trabalho desta varredura.
 *  2. **Pastas que sejam ligações simbólicas.** `entrada.isDirectory()` é
 *     `false` para uma ligação simbólica, mesmo que aponte para uma pasta
 *     — por isso `atalho-pasta/b.ts`, com `atalho-pasta` uma ligação
 *     simbólica, ficava invisível: nem entrava na recursão (não é pasta
 *     "a sério" aos olhos de `isDirectory()`), nem era contado como
 *     ficheiro (o nome da pasta não tem a extensão certa). Ficheiros que
 *     sejam ligação simbólica já eram vistos sem precisar de nada
 *     especial (o `readFileSync`, mais abaixo, segue a ligação sozinho,
 *     tal como `entrada.name.endsWith(...)` não distingue uma ligação de
 *     um ficheiro normal); só as pastas precisavam desta correção. O Vite
 *     segue ligações simbólicas a resolver módulos, por isso isto é
 *     código que corre a sério e tinha de ser varrido a sério.
 *     `statSync` (que segue a ligação, ao contrário de `lstatSync`) decide
 *     se a ligação aponta para uma pasta; `pastasVisitadas` guarda o
 *     `realpathSync` de cada pasta já percorrida, para uma ligação
 *     simbólica que aponte para um antepassado (um ciclo) não entrar em
 *     recursão infinita.
 */
function listarFicheirosDeCodigoFonte(
  raiz: string,
  pastasVisitadas: Set<string> = new Set(),
): string[] {
  const raizReal = realpathSync(raiz);
  if (pastasVisitadas.has(raizReal)) {
    return [];
  }
  pastasVisitadas.add(raizReal);

  const ficheiros: string[] = [];
  const entradas = [...readdirSync(raiz, { withFileTypes: true })].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entrada of entradas) {
    const caminho = join(raiz, entrada.name);

    if (entrada.isDirectory()) {
      ficheiros.push(...listarFicheirosDeCodigoFonte(caminho, pastasVisitadas));
      continue;
    }

    if (entrada.isSymbolicLink() && statSync(caminho).isDirectory()) {
      ficheiros.push(...listarFicheirosDeCodigoFonte(caminho, pastasVisitadas));
      continue;
    }

    if (
      EXTENSOES_DE_CODIGO_FONTE.some((extensao) => entrada.name.toLowerCase().endsWith(extensao))
    ) {
      ficheiros.push(caminho);
    }
  }

  return ficheiros;
}

/** Números de linha (1-indexados) onde `cadeia` aparece em `caminhoFicheiro`. */
function encontrarLinhasComCadeia(caminhoFicheiro: string, cadeia: string): number[] {
  const linhas = readFileSync(caminhoFicheiro, "utf-8").split("\n");
  const numerosDeLinha: number[] = [];
  linhas.forEach((linha, indice) => {
    if (linha.includes(cadeia)) {
      numerosDeLinha.push(indice + 1);
    }
  });
  return numerosDeLinha;
}

const CADEIA_PROIBIDA = "dangerouslySetInnerHTML";

/**
 * Varre `raiz` à procura de `CADEIA_PROIBIDA`, ignorando por completo
 * `ficheiroAIgnorar` (caminho absoluto), e devolve as violações como
 * `"caminho/relativo:linha"`, ordenadas alfabeticamente.
 *
 * Esta varredura é texto puro: não corre o parser do ESLint, por isso
 * nenhum comentário `eslint-disable` (de linha ou de ficheiro inteiro) a
 * afeta. É exactamente o mecanismo que faltava para fechar o furo do
 * `eslint-disable` provado pela revisão de segurança: os seis primeiros
 * testes deste ficheiro correm o ESLint a sério, e o ESLint respeita as
 * suas próprias diretivas de desativação — um `// eslint-disable-next-line
 * react/no-danger, no-restricted-syntax` (ou um `/* eslint-disable *\/` no
 * topo do ficheiro) por cima de um `dangerouslySetInnerHTML` dá 0 erros e
 * 0 avisos nesses testes, mesmo que o ESLint continue configurado
 * corretamente.
 *
 * Contrato (o que isto apanha e o que não apanha, de propósito):
 *
 *  - **Apanha**: a cadeia literal `dangerouslySetInnerHTML` escrita tal
 *    qual no código-fonte, por acidente (alguém escreveu a propriedade sem
 *    pensar no S-13) ou atrás de um `eslint-disable` posto de propósito
 *    para calar o ESLint. Nos dois casos o texto `dangerouslySetInnerHTML`
 *    continua, letra a letra, no ficheiro em disco — e é só isso que esta
 *    função procura.
 *  - **Não apanha, por desenho, ofuscação deliberada**: quem está
 *    ativamente a esconder o que o código faz pode construir a mesma
 *    chave sem a escrever literalmente, por exemplo
 *    `"dangerously" + "SetInnerHTML"` (concatenação de strings),
 *    `String.fromCharCode(...)` (a reconstruir a cadeia caráter a
 *    caráter), ou um nome de propriedade calculado em tempo de execução
 *    (`obj[algumaFuncao()] = valor`). Em nenhum destes casos o texto
 *    `dangerouslySetInnerHTML` aparece no ficheiro — nem esta varredura
 *    (texto puro) nem o ESLint (que também só reconhece a chave quando o
 *    AST a tem como identificador ou literal explícito) têm nada para
 *    comparar. Isto não é uma lacuna por esquecimento: contra quem
 *    ofusca ativamente, o controlo que vale é outro — a CSP do
 *    `htaccess.exemplo` (tarefa F1-04), que impede inline scripts e
 *    `eval` de correr independentemente de como a chave foi escrita, e,
 *    quando a F3 começar a mexer diretamente no DOM, um seletor dedicado
 *    para `innerHTML`/`insertAdjacentHTML` (o alvo final de qualquer
 *    destas formas de ofuscação, mesmo que a chave `dangerouslySetInnerHTML`
 *    nunca apareça).
 *
 * Nota de complementaridade (não redundância) entre os dois mecanismos:
 * `{ "dangerouslySetInnerHTML": ... }` escrito com escapes unicode (por
 * exemplo `{ "dangerouslySetInnerHTML": ... }`) **é** apanhado pelo
 * ESLint — o parser resolve o escape para a cadeia real antes de o
 * seletor do AST comparar `key.value` — mas **não** seria apanhado por
 * esta varredura, porque no disco o texto é literalmente outro (os
 * caracteres `dangerouslySetInnerHTML`, não
 * `dangerouslySetInnerHTML`). Os dois mecanismos apanham coisas
 * diferentes; nenhum dos dois é redundante com o outro.
 */
function procurarCadeiaProibida(raiz: string, ficheiroAIgnorar: string): string[] {
  const violacoes: string[] = [];
  for (const ficheiro of listarFicheirosDeCodigoFonte(raiz)) {
    if (ficheiro === ficheiroAIgnorar) continue;
    for (const linha of encontrarLinhasComCadeia(ficheiro, CADEIA_PROIBIDA)) {
      violacoes.push(`${relative(raiz, ficheiro)}:${linha}`);
    }
  }
  return violacoes.sort();
}

describe("S-13: dangerouslySetInnerHTML é proibido mesmo atrás de um eslint-disable", () => {
  it("a varredura deteta a cadeia proibida mesmo com eslint-disable, nalguma subpasta não lintada", () => {
    // Prova a própria varredura, isolada do estado real de `frontend/src`,
    // numa pasta temporária com ficheiros:
    //  - um com a cadeia proibida atrás de um `// eslint-disable-next-line`
    //    (o ataque descrito pela revisão: o ESLint fica calado, de
    //    propósito);
    //  - outro dentro de uma subpasta chamada `lib/api`, atrás de um
    //    `/* eslint-disable */` de ficheiro inteiro — a mesma forma da
    //    pasta real que o ESLint ignora por completo (`ignores` do
    //    `eslint.config.js`), para confirmar que a varredura não replica
    //    essa exclusão;
    //  - um terceiro limpo, para confirmar que não há falsos positivos;
    //  - um quarto, `.mts`, para prender a extensão de módulo que faltava
    //    em `EXTENSOES_DE_CODIGO_FONTE` antes desta revisão de segurança;
    //  - um quinto, `ComponenteMaiusculas.TSX` (extensão em maiúsculas),
    //    para prender a comparação sem distinguir maiúsculas de
    //    minúsculas — num sistema de ficheiros indiferente a maiúsculas
    //    (macOS), `.TSX` e `.tsx` resolvem para o mesmo ficheiro, mas só
    //    `.toLowerCase()` antes do `endsWith` os trata como iguais;
    //  - um sexto, `atalho-pasta/b.ts`, com `atalho-pasta` uma ligação
    //    simbólica para uma pasta fora desta árvore (`raizAlvoDoLink`),
    //    para prender a recursão em pastas que sejam ligação simbólica —
    //    `entrada.isDirectory()` é `false` para uma ligação, mesmo que
    //    aponte para uma pasta, por isso sem o `statSync` dedicado esta
    //    pasta inteira ficava invisível.
    const raizTemporaria = mkdtempSync(join(tmpdir(), "s13-varredura-"));
    const raizAlvoDoLink = mkdtempSync(join(tmpdir(), "s13-varredura-alvo-link-"));
    try {
      mkdirSync(join(raizTemporaria, "componentes"), { recursive: true });
      mkdirSync(join(raizTemporaria, "lib", "api"), { recursive: true });
      mkdirSync(join(raizTemporaria, "seguro"), { recursive: true });
      mkdirSync(join(raizTemporaria, "modulos"), { recursive: true });
      mkdirSync(join(raizTemporaria, "maiusculas"), { recursive: true });

      writeFileSync(
        join(raizTemporaria, "componentes", "ExemploComEslintDisable.tsx"),
        [
          "// eslint-disable-next-line react/no-danger, no-restricted-syntax",
          "export function ExemploInseguro({ texto }: { texto: string }) {",
          "  return <div dangerouslySetInnerHTML={{ __html: texto }} />;",
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(raizTemporaria, "lib", "api", "exemplo-gerado.ts"),
        [
          "/* eslint-disable */",
          "export const propriedades = { dangerouslySetInnerHTML: { __html: '' } };",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(raizTemporaria, "seguro", "ExemploSeguro.tsx"),
        [
          "export function ExemploSeguro({ texto }: { texto: string }) {",
          "  return <p>{texto}</p>;",
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(raizTemporaria, "modulos", "exemplo.mts"),
        ["export const propriedades = { dangerouslySetInnerHTML: { __html: '' } };", ""].join("\n"),
      );
      writeFileSync(
        join(raizTemporaria, "maiusculas", "ComponenteMaiusculas.TSX"),
        [
          "export function ComponenteMaiusculas({ texto }: { texto: string }) {",
          "  return <div dangerouslySetInnerHTML={{ __html: texto }} />;",
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(raizAlvoDoLink, "b.ts"),
        ["export const propriedades = { dangerouslySetInnerHTML: { __html: '' } };", ""].join("\n"),
      );
      symlinkSync(raizAlvoDoLink, join(raizTemporaria, "atalho-pasta"), "dir");

      const violacoes = procurarCadeiaProibida(raizTemporaria, join(raizTemporaria, "nada.ts"));

      expect(violacoes).toEqual(
        [
          "componentes/ExemploComEslintDisable.tsx:3",
          `${join("lib", "api", "exemplo-gerado.ts")}:2`,
          "modulos/exemplo.mts:1",
          `${join("maiusculas", "ComponenteMaiusculas.TSX")}:2`,
          `${join("atalho-pasta", "b.ts")}:1`,
        ].sort(),
      );
    } finally {
      rmSync(raizTemporaria, { recursive: true, force: true });
      rmSync(raizAlvoDoLink, { recursive: true, force: true });
    }
  });

  it("nenhum ficheiro em frontend/src, fora deste próprio ficheiro, contém a cadeia proibida", () => {
    const raizSrc = fileURLToPath(new URL("../..", import.meta.url));
    const esteFicheiro = fileURLToPath(import.meta.url);

    const violacoes = procurarCadeiaProibida(raizSrc, esteFicheiro);

    if (violacoes.length > 0) {
      throw new Error(
        "O critério S-13 proíbe `dangerouslySetInnerHTML` em qualquer ficheiro " +
          "de código-fonte sob `frontend/src`, mesmo atrás de um comentário " +
          "`eslint-disable` (que desliga o ESLint, mas não esta varredura do " +
          "ficheiro em disco). Ocorrências encontradas (ficheiro:linha):\n" +
          violacoes.map((violacao) => `  - ${violacao}`).join("\n"),
      );
    }
  });
});
