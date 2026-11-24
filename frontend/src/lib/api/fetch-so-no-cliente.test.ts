// @vitest-environment node
/**
 * F2-09 — `fetch` só dentro de `src/lib/api`.
 *
 * Regra de sítio, não proibição: o cliente tem de ser o único a falar com
 * o servidor, porque é ele que põe `X-Tomazia: 1`, `credentials: "include"`
 * e a base relativa `/api` em todos os pedidos. Um `fetch` escrito à mão
 * num componente não leva nada disso, e as três consequências aparecem
 * em sítios diferentes e tarde: o 403 do S-06 numa mutação, a sessão que
 * não vai, e a CSP `connect-src 'self'` a bloquear uma origem absoluta
 * **só no servidor** (ADR 0008).
 *
 * Duas redes, como no S-13 e no estilo inline, e pelas mesmas razões:
 *
 *  1. o ESLint, verificado contra a configuração **real** do projeto
 *     (`eslint.config.js`) e não contra uma inventada aqui — com o
 *     controlo que confirma que dentro do cliente é permitido, sem o qual
 *     uma regra que acusasse tudo passaria por boa;
 *  2. a varredura do código em disco, que nenhum `eslint-disable`
 *     desliga, e que **falha se não encontrar ficheiro nenhum** — um glob
 *     vazio é «não consegui procurar», nunca «está tudo limpo».
 *
 * E não é só `fetch`: `XMLHttpRequest` e `navigator.sendBeacon` fazem
 * pedidos HTTP na mesma, sem nenhum dos cabeçalhos do cliente. Não há
 * nenhum no projeto hoje; estão nas duas redes porque custam uma linha
 * cada e porque uma regra que só proibisse a forma moderna convidava à
 * antiga.
 *
 * **O que estes testes deixam passar:** um pedido feito por uma
 * referência guardada noutro nome (`const f = window.fetch; f(...)`), ou
 * por `globalThis["fe" + "tch"]`. É o mesmo buraco conhecido do S-13 — o
 * ESLint só reconhece a chave quando ela está escrita, e a varredura só
 * procura texto. Contra quem ofusca ativamente valem os outros controlos
 * (a CSP e a revisão); contra quem está distraído, que é o caso real,
 * estas duas chegam.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { COMPONENTES_DA_F3_01 } from "../../testes/componentes";
import { FICHEIROS_DA_F3_05, FICHEIROS_DA_F4_04 } from "../../testes/ecras";
import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  linhasQueCorrespondem,
  listarFicheiros,
} from "../../testes/percorrer-arvore";

const CODIGO_COM_FETCH_DIRETO = `
export async function carregarEmenta() {
  const resposta = await fetch("/api/ementa");
  return resposta.json();
}
`;

const CODIGO_COM_WINDOW_FETCH = `
export async function carregarEmenta() {
  const resposta = await window.fetch("/api/ementa");
  return resposta.json();
}
`;

const CODIGO_COM_XHR = `
export function carregarEmenta(aoReceber: (texto: string) => void) {
  const pedido = new XMLHttpRequest();
  pedido.open("GET", "/api/ementa");
  pedido.onload = () => aoReceber(pedido.responseText);
  pedido.send();
}
`;

const CODIGO_COM_SEND_BEACON = `
export function registar(evento: string) {
  navigator.sendBeacon("/api/telemetria", evento);
}
`;

const CODIGO_SEM_FETCH = `
import { obterEmenta } from "../lib/api/publico";

export async function carregarEmenta() {
  return obterEmenta();
}
`;

/**
 * Arrancar o ESLint em processo custa segundos, não milissegundos: ele lê
 * a flat config, resolve os plugins e constrói o Linter. Sem este limite,
 * uma máquina ocupada dava «timed out» em vez de «a regra não acusou», que
 * são coisas opostas.
 */
const ESPERA_PELO_ESLINT = { timeout: 30_000 };

async function lintar(codigo: string, caminhoVirtual: string) {
  const eslint = new ESLint({ cwd: RAIZ_FRONTEND });
  const resultados = await eslint.lintText(codigo, { filePath: caminhoVirtual });
  const resultado = resultados[0];
  if (resultado === undefined) {
    throw new Error(
      `o ESLint devolveu zero resultados para ${caminhoVirtual}; esperava exatamente um.`,
    );
  }
  return resultado;
}

describe("o ESLint acusa fetch fora de src/lib/api", ESPERA_PELO_ESLINT, () => {
  it("fetch direto num componente dá erro com a config real do projeto", async () => {
    const resultado = await lintar(CODIGO_COM_FETCH_DIRETO, "src/pages/publico/Ementa.tsx");

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(resultado.messages.map((mensagem) => mensagem.ruleId)).toContain(
      "no-restricted-globals",
    );
    expect(
      resultado.messages.map((mensagem) => mensagem.message).join(" "),
      "a mensagem tem de dizer o que usar em vez disto, não só «proibido»",
    ).toMatch(/src\/lib\/api/);
  });

  it("window.fetch também dá erro — é um MemberExpression, não um global", async () => {
    // `no-restricted-globals` olha para referências ao identificador
    // `fetch`; `window.fetch` não é uma delas. Sem a segunda regra
    // (`no-restricted-properties`), este caso passava.
    const resultado = await lintar(CODIGO_COM_WINDOW_FETCH, "src/pages/publico/Ementa.tsx");

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(resultado.messages.map((mensagem) => mensagem.ruleId)).toContain(
      "no-restricted-properties",
    );
  });

  it("XMLHttpRequest também dá erro: a forma antiga do mesmo pedido", async () => {
    const resultado = await lintar(CODIGO_COM_XHR, "src/pages/publico/Ementa.tsx");

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(resultado.messages.map((mensagem) => mensagem.ruleId)).toContain(
      "no-restricted-globals",
    );
  });

  it("navigator.sendBeacon também dá erro", async () => {
    // `sendBeacon` não é um global: só se lhe chega por `navigator`, por
    // isso só a segunda regra o pode apanhar.
    const resultado = await lintar(CODIGO_COM_SEND_BEACON, "src/pages/publico/Ementa.tsx");

    expect(resultado.errorCount).toBeGreaterThan(0);
    expect(resultado.messages.map((mensagem) => mensagem.ruleId)).toContain(
      "no-restricted-properties",
    );
  });

  it("dentro do cliente é permitido: o controlo da regra", async () => {
    // Sem este caso, uma regra que acusasse `fetch` em todo o lado —
    // incluindo no único sítio onde ele tem de existir — passaria por boa,
    // e só se descobria o engano quando o `npm run lint` ficasse vermelho
    // sobre o próprio `cliente.ts`.
    const resultado = await lintar(CODIGO_COM_FETCH_DIRETO, "src/lib/api/exemplo-cliente.ts");

    expect(resultado.errorCount, "fetch dentro do cliente não pode ser erro").toBe(0);
    // E tem mesmo de ter sido lintado: um ficheiro nos `ignores` devolve
    // zero erros **e** um aviso a dizer que foi ignorado. Sem esta linha,
    // voltar a pôr `src/lib/api` inteiro nos `ignores` deixava este
    // controlo verde sem provar nada.
    expect(
      resultado.warningCount,
      "o ficheiro tem de ser lintado a sério, não ignorado pela configuração",
    ).toBe(0);
  });

  it("código que usa o cliente não acusa nada: a regra não apanha tudo", async () => {
    const resultado = await lintar(CODIGO_SEM_FETCH, "src/pages/publico/Ementa.tsx");

    expect(resultado.errorCount).toBe(0);
  });

  it("o ficheiro gerado continua fora do lint", async () => {
    // `src/lib/api/gerado` é escrito pelo openapi-typescript e não se
    // formata nem se linta. Se sair dos `ignores`, o `npm run lint` passa
    // a acusar o estilo dele, e alguém acaba por «arranjar» um ficheiro
    // gerado à mão.
    const resultado = await lintar("export type x = 1;\n", "src/lib/api/gerado/esquema.ts");

    expect(resultado.warningCount, "um ficheiro ignorado traz o aviso de ignorado").toBe(1);
    expect(resultado.messages.map((mensagem) => mensagem.message).join(" ")).toMatch(/ignored/i);
  });
});

/** Ficheiros varridos: tudo em `src/`, menos o cliente (onde é permitido). */
function ficheirosForaDoCliente(): string[] {
  return listarFicheiros(join(RAIZ_FRONTEND, "src"), { extensoes: [".ts", ".tsx"] }).filter(
    (ficheiro) => !caminhoRelativo(ficheiro).startsWith("src/lib/api/"),
  );
}

/**
 * As três formas de fazer um pedido HTTP a partir de uma página, escritas
 * como aparecem no código: `fetch(`, `new XMLHttpRequest(` e
 * `sendBeacon(`. O `\\s*` antes do parêntese apanha `fetch (`, que um
 * `includes("fetch(")` deixava passar.
 */
const PEDIDOS_HTTP = /\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/;

/** `ficheiro:linha` de cada pedido HTTP escrito nos ficheiros dados. */
function procurarPedidosHttp(ficheiros: string[], raiz: string = RAIZ_FRONTEND): string[] {
  const violacoes: string[] = [];
  for (const ficheiro of ficheiros) {
    const relativo = caminhoRelativo(ficheiro, raiz);
    const texto = lerTexto(ficheiro, relativo);
    for (const linha of linhasQueCorrespondem(texto, (conteudo) => PEDIDOS_HTTP.test(conteudo))) {
      violacoes.push(`${relativo}:${linha}`);
    }
  }
  return violacoes.sort();
}

describe("varredura em disco, que nenhum eslint-disable desliga", () => {
  it("nenhum ficheiro fora de src/lib/api faz um pedido HTTP", () => {
    const ficheiros = ficheirosForaDoCliente();

    // O guarda da regra 10: se a raiz estiver errada ou o filtro cortar a
    // mais, isto rebenta com «não consegui procurar» em vez de passar com
    // zero violações.
    exigirSentinelas(
      ficheiros,
      [
        ...COMPONENTES_DA_F3_01,
        "src/App.tsx",
        ...FICHEIROS_DA_F3_05,
        // F4-04: só os de fora de `src/lib/api/` (o `gestao-fotos.ts` é o cliente, não se varre aqui).
        ...FICHEIROS_DA_F4_04.filter((ficheiro) => !ficheiro.startsWith("src/lib/api/")),
      ],
      "pedidos HTTP fora do cliente",
    );

    expect(
      procurarPedidosHttp(ficheiros),
      "Pedidos HTTP só dentro de `src/lib/api`. Usa o cliente (`pedir`), que leva " +
        '`X-Tomazia`, `credentials: "include"` e a base relativa `/api`.',
    ).toEqual([]);
  });

  it("a varredura apanha um pedido escondido atrás de um eslint-disable", () => {
    // Autoteste, isolado do estado real de `src/`: nenhuma regra de ESLint
    // sobrevive a um `eslint-disable` posto de propósito por cima da linha,
    // e uma procura de texto não lê diretivas de desativação. Também prende
    // a forma `fetch (` com espaço, que um `includes("fetch(")` deixava
    // passar.
    const raiz = mkdtempSync(join(tmpdir(), "fetch-so-no-cliente-"));
    try {
      mkdirSync(join(raiz, "paginas"), { recursive: true });
      writeFileSync(
        join(raiz, "paginas", "ComDisable.tsx"),
        [
          "// eslint-disable-next-line no-restricted-globals",
          'const resposta = await fetch("/api/ementa");',
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(raiz, "paginas", "ComEspaco.ts"),
        ['const resposta = await fetch ("/api/info");', ""].join("\n"),
      );
      writeFileSync(
        join(raiz, "paginas", "ComXhr.ts"),
        ["const pedido = new XMLHttpRequest();", 'pedido.open("GET", "/api/ementa");', ""].join(
          "\n",
        ),
      );
      writeFileSync(
        join(raiz, "paginas", "ComBeacon.ts"),
        ['navigator.sendBeacon("/api/telemetria", "x");', ""].join("\n"),
      );
      writeFileSync(
        join(raiz, "paginas", "Limpa.ts"),
        ["import { obterEmenta } from './api';", "export const carregar = obterEmenta;", ""].join(
          "\n",
        ),
      );

      const ficheiros = listarFicheiros(raiz, { extensoes: [".ts", ".tsx"] });
      expect(ficheiros, "a árvore temporária tem de ter cinco ficheiros").toHaveLength(5);

      expect(procurarPedidosHttp(ficheiros, raiz)).toEqual(
        [
          "paginas/ComDisable.tsx:2",
          "paginas/ComEspaco.ts:1",
          "paginas/ComXhr.ts:1",
          "paginas/ComBeacon.ts:1",
        ].sort(),
      );
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("a varredura não acusa o que não é um pedido", () => {
    // O controlo do regex: `prefetch(` e uma variável chamada `fetchado`
    // não são pedidos HTTP, e um `\\b` mal posto transformava esta rede num
    // ruído que alguém acabaria por desligar.
    const raiz = mkdtempSync(join(tmpdir(), "fetch-falsos-positivos-"));
    try {
      writeFileSync(
        join(raiz, "Limpo.ts"),
        [
          "export const prefetch = () => undefined;",
          "const fetchado = true;",
          "export const usar = () => prefetch();",
          "export const resultado = fetchado;",
          "",
        ].join("\n"),
      );

      const ficheiros = listarFicheiros(raiz, { extensoes: [".ts"] });
      expect(ficheiros).toHaveLength(1);
      expect(procurarPedidosHttp(ficheiros, raiz)).toEqual([]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it("a varredura falha a dizer «não consegui procurar» sobre uma pasta vazia", () => {
    // Um glob vazio não é um resultado limpo. Este caso prende a mensagem,
    // que tem de ser distinguível da de «encontrei violações».
    const raiz = mkdtempSync(join(tmpdir(), "fetch-sem-ficheiros-"));
    try {
      expect(() =>
        exigirSentinelas(listarFicheiros(raiz, { extensoes: [".ts"] }), ["src/App.tsx"], "teste"),
      ).toThrow(/não consegui percorrer a árvore/i);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
