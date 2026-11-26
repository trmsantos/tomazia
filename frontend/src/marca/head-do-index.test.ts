// @vitest-environment node
/**
 * F3-08, secções 4, 5, 6 e 8: o `<head>` do `index.html` **construído**, e o
 * build de produção a falhar sem `VITE_URL_PUBLICA`.
 *
 * Constrói para pastas temporárias (nunca para `dist/`, que é do
 * `build-de-producao.test.ts`): duas vezes com a variável certa e duas sem
 * ela (ausente e vazia). O `NODE_ENV` vai fixado a `production` no processo
 * filho, porque o Vitest herda `test` e a regra "em produção a variável é
 * obrigatória" não pode depender de quem lançou o build (mesma razão da marca
 * em `vite.config.ts`).
 *
 * **Regra 10, nos dois sentidos.** O build sem variável tem de falhar *e* a
 * mensagem tem de nomear a variável; e o build com a variável tem de passar,
 * senão o "falhou" do outro podia ser uma falha qualquer (um import partido,
 * um ficheiro em falta). Os testes de falha só valem juntos com o de sucesso.
 *
 * **O que assumem do implementador:** que a variável se lê do ambiente do
 * processo (`process.env` ou `loadEnv`, tanto faz) e que não há `.env*` em
 * `frontend/` a fornecê-la por baixo (o teste verifica que não há). Que
 * "variável vazia" conta como em falta. Que em `--mode production` (o por
 * omissão do `vite build`) a falta é fatal.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lerBytes, lerIco, lerJpeg, lerPng } from "../testes/imagens";
import {
  ALT_DA_IMAGEM_DE_PARTILHA,
  FICHEIROS_GERADOS,
  FRASE_DA_DESCRICAO,
  NOME_DA_VARIAVEL,
  URL_PUBLICA_FINAL,
  URL_PUBLICA_PROVISORIA,
} from "../testes/marca";
import { RAIZ_FRONTEND, listarFicheiros } from "../testes/percorrer-arvore";

const TEMPO = 300_000;
const VITE = join(RAIZ_FRONTEND, "node_modules", "vite", "bin", "vite.js");

type Construcao = { estado: number | null; saida: string; pasta: string; erro: string };

const pastas: string[] = [];

function construir(variavel: string | undefined): Construcao {
  const pasta = mkdtempSync(join(tmpdir(), "tomazia-f3-08-"));
  pastas.push(pasta);

  const ambiente: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete ambiente[NOME_DA_VARIAVEL];
  if (variavel !== undefined) ambiente[NOME_DA_VARIAVEL] = variavel;

  const resultado = spawnSync(
    process.execPath,
    [VITE, "build", "--outDir", pasta, "--emptyOutDir"],
    {
      cwd: RAIZ_FRONTEND,
      env: ambiente,
      encoding: "utf-8",
      timeout: TEMPO,
    },
  );
  return {
    estado: resultado.status,
    saida: `${resultado.stdout}\n${resultado.stderr}`,
    pasta,
    erro: resultado.error === undefined ? "" : String(resultado.error),
  };
}

let provisoria: Construcao;
let final: Construcao;
let semVariavel: Construcao;
let variavelVazia: Construcao;

beforeAll(() => {
  const dotenv = readdirSync(RAIZ_FRONTEND).filter((nome) => nome.startsWith(".env"));
  expect(
    dotenv,
    "há ficheiros .env* em frontend/: podiam fornecer a variável por baixo e o teste " +
      '"sem variável" nunca corria o caso que diz correr',
  ).toEqual([]);
  provisoria = construir(URL_PUBLICA_PROVISORIA);
  final = construir(URL_PUBLICA_FINAL);
  semVariavel = construir(undefined);
  variavelVazia = construir("");
}, TEMPO * 4);

afterAll(() => {
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
});

type Atributos = Record<string, string>;

/** Todas as etiquetas `<nome …>` do HTML, sem os comentários. */
function etiquetas(html: string, nome: string): Atributos[] {
  const semComentarios = html.replace(/<!--[\s\S]*?-->/g, "");
  const encontradas: Atributos[] = [];
  for (const etiqueta of semComentarios.matchAll(new RegExp(`<${nome}\\b([^>]*)>`, "gi"))) {
    const atributos: Atributos = {};
    for (const par of (etiqueta[1] ?? "").matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
      atributos[(par[1] ?? "").toLowerCase()] = par[2] ?? "";
    }
    encontradas.push(atributos);
  }
  return encontradas;
}

function exigirSucesso(c: Construcao, quem: string): void {
  expect(
    c.estado,
    `o build (${quem}) devia ter passado e não passou: ${c.erro}\n${c.saida.slice(-1500)}`,
  ).toBe(0);
}

function html(c: Construcao): string {
  exigirSucesso(c, "para ler o index.html");
  const caminho = join(c.pasta, "index.html");
  expect(existsSync(caminho), "o build passou mas não escreveu index.html").toBe(true);
  return readFileSync(caminho, "utf-8");
}

function meta(c: Construcao, chave: "name" | "property", valor: string): string | undefined {
  return etiquetas(html(c), "meta").find((m) => m[chave] === valor)?.["content"];
}

describe("o build de produção exige VITE_URL_PUBLICA (regra 10)", () => {
  it("controlo: com a variável definida o build passa", () => {
    exigirSucesso(provisoria, "com o endereço provisório");
    exigirSucesso(final, "com o endereço final");
  });

  it("sem a variável o build falha, e a mensagem diz o nome dela", () => {
    expect(semVariavel.erro, "o processo nem arrancou: não é falha por falta da variável").toBe("");
    expect(
      semVariavel.estado,
      "o build passou sem VITE_URL_PUBLICA: o og:image ficava relativo, em silêncio",
    ).not.toBe(0);
    expect(
      semVariavel.estado,
      "terminou por sinal ou tempo, não por falha de build",
    ).not.toBeNull();
    expect(semVariavel.saida).toContain(NOME_DA_VARIAVEL);
  });

  it("com a variável vazia o build também falha, pela mesma razão", () => {
    expect(variavelVazia.erro).toBe("");
    expect(variavelVazia.estado, "«vazia» não pode dar o mesmo que «definida»").not.toBe(0);
    expect(variavelVazia.estado).not.toBeNull();
    expect(variavelVazia.saida).toContain(NOME_DA_VARIAVEL);
  });

  it("o domínio não está escrito no index.html do repositório", () => {
    const fonte = readFileSync(join(RAIZ_FRONTEND, "index.html"), "utf-8");
    expect(fonte).not.toMatch(/bardatomazia/i);
    expect(fonte).not.toMatch(/https?:\/\/(?!localhost)/);
  });
});

describe("og:image absoluto, a partir da variável", () => {
  it("é a variável + /og-image.jpg, em cada build", () => {
    expect(meta(provisoria, "property", "og:image")).toBe(`${URL_PUBLICA_PROVISORIA}/og-image.jpg`);
    expect(meta(final, "property", "og:image")).toBe(`${URL_PUBLICA_FINAL}/og-image.jpg`);
  });

  it("não deixa marcadores por substituir nem `//` a seguir ao domínio", () => {
    const texto = html(provisoria);
    expect(texto).not.toMatch(/%URL_PUBLICA%|%VITE_/);
    const og = meta(provisoria, "property", "og:image") ?? "";
    expect(og.length, "guarda: não encontrei o og:image").toBeGreaterThan(0);
    expect(og.replace(/^https?:\/\//, "")).not.toContain("//");
  });

  it("og:image:width e height coincidem com o JPEG real e o ficheiro está em dist/", () => {
    const largura = Number(meta(provisoria, "property", "og:image:width"));
    const altura = Number(meta(provisoria, "property", "og:image:height"));
    const caminho = join(provisoria.pasta, "og-image.jpg");
    const real = lerJpeg(lerBytes(caminho, "dist/og-image.jpg"), "og-image.jpg");
    expect({ largura, altura }).toEqual(real);
    expect(real).toEqual({ largura: 1200, altura: 630 });
  });
});

describe("favicon e apple-touch-icon no <head>", () => {
  it("as três ligações existem com o href e os atributos da secção 4", () => {
    const ligacoes = etiquetas(html(provisoria), "link");
    const ico = ligacoes.find((l) => l["rel"] === "icon" && l["href"] === "/favicon.ico");
    const png = ligacoes.find(
      (l) => l["rel"] === "icon" && l["type"] === "image/png" && l["sizes"] === "32x32",
    );
    const apple = ligacoes.find((l) => l["rel"] === "apple-touch-icon");

    expect(ico, "<link rel=icon href=/favicon.ico>").toBeDefined();
    expect(ico?.["sizes"]).toBe("16x16 32x32 48x48");
    expect(png?.["href"]).toBe("/favicon-32.png");
    expect(apple?.["href"]).toBe("/apple-touch-icon.png");
    expect(apple?.["sizes"]).toBe("180x180");
  });

  it("cada ficheiro referido existe em dist/ com as dimensões certas", () => {
    const ligacoes = etiquetas(html(provisoria), "link").filter(
      (l) => l["rel"] === "icon" || l["rel"] === "apple-touch-icon",
    );
    expect(ligacoes.length, "esperava as 3 ligações de ícone").toBe(3);
    for (const ligacao of ligacoes) {
      const href = ligacao["href"] ?? "";
      expect(href.startsWith("/"), `${href}: caminho da raiz`).toBe(true);
      expect(existsSync(join(provisoria.pasta, href)), `${href} em dist/`).toBe(true);
    }

    const ico = lerIco(lerBytes(join(provisoria.pasta, "favicon.ico"), "dist/favicon.ico"), "ico");
    expect(ico.map((e) => e.largura).sort((a, b) => a - b)).toEqual([16, 32, 48]);

    const apple = lerPng(
      lerBytes(join(provisoria.pasta, "apple-touch-icon.png"), "dist/apple-touch-icon.png"),
      "apple-touch-icon.png",
    );
    expect([apple.largura, apple.altura]).toEqual([180, 180]);
    expect(apple.tipoDeCor, "sem alfa: RGB, tipo 2").toBe(2);
    expect(apple.temTrns).toBe(false);
  });
});

describe("description, tema e partilha", () => {
  it("description é a frase validada, com 70 a 160 caracteres", () => {
    const descricao = meta(provisoria, "name", "description");
    expect(descricao).toBe(FRASE_DA_DESCRICAO);
    expect((descricao ?? "").length).toBeGreaterThanOrEqual(70);
    expect((descricao ?? "").length).toBeLessThanOrEqual(160);
  });

  it("og:description é exatamente a description", () => {
    expect(meta(provisoria, "property", "og:description")).toBe(
      meta(provisoria, "name", "description"),
    );
  });

  it("a description não tem português do Brasil (a lista do textos-pt-pt.test.ts)", () => {
    const descricao = meta(provisoria, "name", "description") ?? "";
    expect(descricao.length, "guarda: não encontrei a description").toBeGreaterThan(0);
    const palavras = [
      "cardápio",
      "arquivo",
      "deletar",
      "salvar",
      "usuário",
      "aplicativo",
      "tela",
      "você",
    ];
    for (const palavra of palavras) {
      expect(descricao.toLowerCase()).not.toContain(palavra);
    }
    expect(descricao).not.toContain("palavra-passe");
  });

  it("theme-color é o bordo-noite", () => {
    expect((meta(provisoria, "name", "theme-color") ?? "").toLowerCase()).toBe("#3d0f24");
  });

  it("as restantes meta de partilha, e o título", () => {
    expect(meta(provisoria, "property", "og:locale")).toBe("pt_PT");
    expect(meta(provisoria, "property", "og:type")).toBe("website");
    expect(meta(provisoria, "property", "og:site_name")).toBe("Bar da Tomazia");
    expect(meta(provisoria, "property", "og:title")).toBe("Bar da Tomazia");
    expect(meta(provisoria, "property", "og:image:alt")).toBe(ALT_DA_IMAGEM_DE_PARTILHA);
    expect(meta(provisoria, "name", "twitter:card")).toBe("summary_large_image");
    expect(meta(provisoria, "property", "og:url"), "nenhum og:url (secção 4)").toBeUndefined();
    expect(html(provisoria)).toMatch(/<title>Bar da Tomazia<\/title>/);
    expect(html(provisoria)).toMatch(/<html[^>]*lang="pt-PT"/);
  });

  it("os dois preloads de fontes continuam", () => {
    const preloads = etiquetas(html(provisoria), "link").filter((l) => l["rel"] === "preload");
    expect(preloads.map((l) => l["href"]).sort()).toEqual([
      "/fontes/playfair-display-v40-latin-700.woff2",
      "/fontes/source-sans-3-v20-latin-400.woff2",
    ]);
  });
});

describe("o que entra em dist/", () => {
  it("os sete ficheiros gerados estão lá, e nenhum é do original, de docs/ ou do script", () => {
    exigirSucesso(provisoria, "para listar dist/");
    for (const ficheiro of FICHEIROS_GERADOS) {
      expect(existsSync(join(provisoria.pasta, ficheiro)), `dist/${ficheiro}`).toBe(true);
    }

    const todos = listarFicheiros(provisoria.pasta, { extensoes: [""], pastasIgnoradas: [] });
    expect(todos.length, "guarda: dist/ não pode estar vazio").toBeGreaterThan(10);
    const proibidos = todos.filter((f) =>
      /tomazia-original|gerar-marca|[\\/]docs[\\/]|\.py$/.test(f),
    );
    expect(proibidos).toEqual([]);
  });

  it("Q-02: nenhuma imagem passa pelo Vite e nenhuma vai embutida no JS", () => {
    exigirSucesso(provisoria, "para listar dist/assets");
    const assets = readdirSync(join(provisoria.pasta, "assets"));
    expect(assets.filter((n) => /\.(webp|png|jpe?g|ico|svg)$/i.test(n))).toEqual([]);
    for (const js of assets.filter((n) => n.endsWith(".js"))) {
      const texto = readFileSync(join(provisoria.pasta, "assets", js), "utf-8");
      expect(texto, `${js}: imagem em base64`).not.toMatch(/data:image\/(webp|png|jpeg)/);
    }
  });
});
