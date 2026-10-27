// @vitest-environment node
/**
 * F3-01 — as fontes existem, são locais e sobrevivem ao build.
 *
 * Nada de CDN do Google: a CSP de produção é `font-src 'self'` com
 * `default-src 'none'` (ver `deploy/htaccess.exemplo`). Uma fonte pedida a
 * um domínio de fora é bloqueada no servidor e funciona em
 * desenvolvimento — o modo de falha que esta tarefa inteira tenta evitar.
 *
 * As fontes vivem em `public/`, e não em `src/`, por duas razões: o
 * preload precisa de um nome estável (em `src/` o nome só existe depois do
 * build) e o Vite transforma ficheiros abaixo de 4 KB em `data:`, que a
 * mesma CSP bloqueia. O custo é que `public/` não tem o grafo do Vite a
 * garantir que nada se perde — e é por isso que a garantia passa a ser
 * explícita, aqui e em `src/build-de-producao.test.ts`.
 *
 * O `crossorigin` do preload tem um teste só para ele: sem ele o browser
 * descarrega a fonte duas vezes, o preload fica pior do que não existir, e
 * isso não se vê em lado nenhum a não ser no separador de rede.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto } from "../testes/percorrer-arvore";

const PASTA_DAS_FONTES = join(RAIZ_FRONTEND, "public", "fontes");
const CAMINHO_DO_CSS = join(RAIZ_FRONTEND, "src", "styles", "fontes.css");
const CAMINHO_DO_HTML = join(RAIZ_FRONTEND, "index.html");

/**
 * As três faces, por padrão de nome. O `v<N>` é a versão real da fonte na
 * origem: vai no nome porque os ficheiros de `public/` não levam hash do
 * Vite, e é o nome versionado que permite `Cache-Control: immutable` sem
 * ficar preso a uma versão antiga.
 */
const FACES = [
  {
    nome: "Playfair Display 700",
    padrao: /^playfair-display-v\d+-latin-700\.woff2$/,
    familia: "Playfair Display",
    peso: "700",
    acimaDaDobra: true,
  },
  {
    nome: "Source Sans 3 400",
    padrao: /^source-sans-3-v\d+-latin-400\.woff2$/,
    familia: "Source Sans 3",
    peso: "400",
    acimaDaDobra: true,
  },
  {
    nome: "Source Sans 3 600",
    padrao: /^source-sans-3-v\d+-latin-600\.woff2$/,
    familia: "Source Sans 3",
    peso: "600",
    acimaDaDobra: false,
  },
];

function listarPastaDasFontes(): string[] {
  if (!existsSync(PASTA_DAS_FONTES)) {
    throw new Error(
      `Não consegui ler a pasta das fontes (${PASTA_DAS_FONTES}). ` +
        "As três faces .woff2 vivem em public/fontes/, com OFL.txt e PROVENIENCIA.md ao lado. " +
        "Isto é uma falha de leitura, não uma fonte em falta.",
    );
  }
  return readdirSync(PASTA_DAS_FONTES).sort();
}

export function ficheirosDeFonte(): string[] {
  return listarPastaDasFontes().filter((nome) => nome.toLowerCase().endsWith(".woff2"));
}

describe("os ficheiros das fontes", () => {
  it("são exactamente três .woff2, um por face, com a versão no nome", () => {
    const ficheiros = ficheirosDeFonte();

    expect(ficheiros).toHaveLength(3);
    for (const face of FACES) {
      expect(
        ficheiros.filter((nome) => face.padrao.test(nome)),
        `falta a face ${face.nome} (padrão ${String(face.padrao)})`,
      ).toHaveLength(1);
    }
  });

  it("não há woff nem ttf ao lado: woff2 chega a todos os browsers desde 2020", () => {
    const tudo = listarPastaDasFontes();

    expect(tudo.filter((nome) => /\.(woff|ttf|otf|eot)$/i.test(nome))).toEqual([]);
  });

  it("a licença e a proveniência estão lá, e o sha256 de cada ficheiro confere", () => {
    // As duas famílias são SIL Open Font License 1.1, que obriga a
    // acompanhar a licença. O sha256 escrito é o que prova que o ficheiro
    // em disco é o que alguém foi buscar e registou — sem ele,
    // "proveniência" é só uma frase.
    expect(existsSync(join(PASTA_DAS_FONTES, "OFL.txt")), "falta public/fontes/OFL.txt").toBe(true);

    const proveniencia = lerTexto(
      join(PASTA_DAS_FONTES, "PROVENIENCIA.md"),
      "public/fontes/PROVENIENCIA.md",
    );
    expect(proveniencia, "a proveniência tem de dizer de onde vieram").toMatch(/https?:\/\//);
    expect(proveniencia.toLowerCase()).toContain("latin");

    const semRegisto: string[] = [];
    for (const nome of ficheirosDeFonte()) {
      const resumo = createHash("sha256")
        .update(readFileSync(join(PASTA_DAS_FONTES, nome)))
        .digest("hex");
      if (!proveniencia.includes(nome)) {
        semRegisto.push(`${nome} não aparece no PROVENIENCIA.md`);
      } else if (!proveniencia.toLowerCase().includes(resumo)) {
        semRegisto.push(`${nome}: o sha256 em disco é ${resumo} e não está no PROVENIENCIA.md`);
      }
    }
    expect(semRegisto).toEqual([]);
  });
});

/** Cada bloco `@font-face` de `fontes.css`, como texto. */
function blocosDeFontFace(): string[] {
  const css = lerTexto(CAMINHO_DO_CSS, "src/styles/fontes.css");
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((achado) => achado[1] ?? "");
}

/** Os caminhos de `url(...)` declarados em `fontes.css`. */
export function urlsDeclaradas(): string[] {
  const css = lerTexto(CAMINHO_DO_CSS, "src/styles/fontes.css");
  return [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((achado) => achado[1] ?? "");
}

describe("src/styles/fontes.css", () => {
  it("declara as três faces, com a família e o peso certos", () => {
    const blocos = blocosDeFontFace();

    expect(blocos).toHaveLength(3);
    for (const face of FACES) {
      const bloco = blocos.find((texto) =>
        face.padrao.test(/url\(["']?\/fontes\/([^"')]+)/.exec(texto)?.[1] ?? ""),
      );
      expect(bloco, `nenhum @font-face aponta para a face ${face.nome}`).toBeDefined();
      expect(bloco).toContain(face.familia);
      expect(bloco?.replace(/\s+/g, " ")).toMatch(new RegExp(`font-weight:\\s*${face.peso}`));
      expect(bloco?.replace(/\s+/g, " ")).toMatch(/font-display:\s*swap/);
      expect(bloco).toContain('format("woff2")');
    }
  });

  it("cada url aponta para um ficheiro que existe em public/fontes/", () => {
    const emFalta: string[] = [];
    for (const url of urlsDeclaradas()) {
      if (!url.startsWith("/fontes/")) {
        emFalta.push(`${url} não começa por /fontes/`);
        continue;
      }
      if (!existsSync(join(RAIZ_FRONTEND, "public", url.replace(/^\//, "")))) {
        emFalta.push(`${url} não existe em public/`);
      }
    }

    expect(urlsDeclaradas().length, "fontes.css tem de declarar as três faces").toBe(3);
    expect(emFalta).toEqual([]);
  });

  it("nenhum src vai buscar bytes a outro sítio (CSP font-src 'self')", () => {
    const css = lerTexto(CAMINHO_DO_CSS, "src/styles/fontes.css");

    expect(css, "nada de CDN: a CSP de produção é font-src 'self'").not.toMatch(/https?:/);
    expect(css, "nada de URL sem esquema (//fonts.gstatic.com)").not.toMatch(/url\(\s*["']?\/\//);
    expect(css, "nada de data: — o font-src 'self' bloqueia-o").not.toMatch(/data:/);
  });

  it("não declara unicode-range", () => {
    // Com uma só face por peso, declarar o intervalo não poupa nada e cria
    // a hipótese de um caractere português cair fora por engano.
    expect(lerTexto(CAMINHO_DO_CSS, "src/styles/fontes.css")).not.toContain("unicode-range");
  });
});

/** Os `<link rel="preload">` de `index.html`, como mapa de atributos. */
function preloads(): Record<string, string>[] {
  const html = lerTexto(CAMINHO_DO_HTML, "index.html");
  return [...html.matchAll(/<link\b([^>]*)>/g)]
    .map((achado) => {
      const atributos: Record<string, string> = {};
      for (const par of (achado[1] ?? "").matchAll(/([a-zA-Z-]+)(?:\s*=\s*["']([^"']*)["'])?/g)) {
        const nome = par[1];
        if (nome !== undefined) atributos[nome] = par[2] ?? "";
      }
      return atributos;
    })
    .filter((atributos) => atributos["rel"] === "preload");
}

describe("preload em index.html", () => {
  it("precarrega as duas faces acima da dobra, e só essas", () => {
    // A face de 600 não é precarregada de propósito: três preloads
    // competem com o CSS e o JS pela mesma ligação.
    const declaradas = urlsDeclaradas();
    const precarregadas = preloads().map((atributos) => atributos["href"] ?? "");

    expect(precarregadas).toHaveLength(2);
    for (const face of FACES.filter((candidata) => candidata.acimaDaDobra)) {
      expect(
        precarregadas.filter((href) => face.padrao.test(href.replace("/fontes/", ""))),
        `a face ${face.nome} está acima da dobra e tem de ser precarregada`,
      ).toHaveLength(1);
    }
    for (const href of precarregadas) {
      expect(
        declaradas,
        `${href} é precarregado mas nenhum @font-face o usa: é peso puro`,
      ).toContain(href);
    }
  });

  it("cada preload tem crossorigin — sem ele a fonte é descarregada duas vezes", () => {
    // O atributo é obrigatório **mesmo na mesma origem**: um pedido de
    // fonte é sempre feito em modo CORS, e um preload sem `crossorigin`
    // fica numa entrada de cache diferente da do pedido real. O browser
    // não se queixa; só o separador de rede mostra as duas transferências.
    const todos = preloads();

    // Guarda da regra 10: zero preloads passariam este ciclo sem uma única
    // asserção, e «não há preloads» é o oposto de «os preloads estão bem».
    expect(todos.length, "index.html tem de precarregar as duas faces acima da dobra").toBe(2);

    for (const atributos of todos) {
      expect(atributos["as"]).toBe("font");
      expect(atributos["type"]).toBe("font/woff2");
      expect(
        Object.keys(atributos),
        `o preload de ${atributos["href"] ?? "?"} não tem crossorigin`,
      ).toContain("crossorigin");
    }
  });
});

describe("pesos: o browser não inventa negritos", () => {
  it("global.css desliga a síntese de pesos e manda o strong para o peso forte", () => {
    // Só existem 400, 600 e 700-Playfair. Sem `font-synthesis: none`, o
    // `bolder` do browser fabrica um negrito falso da Source Sans 3 que
    // ninguém desenhou.
    const global = lerTexto(
      join(RAIZ_FRONTEND, "src", "styles", "global.css"),
      "global.css",
    ).replace(/\s+/g, " ");

    expect(global).toMatch(/font-synthesis:\s*none/);
    expect(global).toMatch(/strong[^{]*\{[^}]*font-weight:\s*var\(--peso-forte\)/);
  });
});
