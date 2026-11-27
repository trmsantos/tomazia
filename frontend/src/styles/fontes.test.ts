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
 *
 * R-01 (ADR 0023) — as faces passam a duas, Bricolage Grotesque e DM Sans,
 * variáveis e recortadas à mão. O que o recorte podia estragar sem erro
 * (glifos do português, `tnum`, o intervalo de `wght`) lê-se dos bytes com
 * `src/testes/woff2.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  RAIZ_FRONTEND,
  RAIZ_REPOSITORIO,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "../testes/percorrer-arvore";
import { blocosDosTokens } from "../testes/tokens";
import {
  eixosFvar,
  lerTabelasWoff2,
  recursosGsub,
  revisaoDaFonte,
  temGlifo,
} from "../testes/woff2";

const PASTA_DAS_FONTES = join(RAIZ_FRONTEND, "public", "fontes");
const CAMINHO_DO_CSS = join(RAIZ_FRONTEND, "src", "styles", "fontes.css");
const CAMINHO_DO_HTML = join(RAIZ_FRONTEND, "index.html");

/**
 * As duas faces do redesign B (ADR 0023, `docs/ecras/R-01.md`, secção 3),
 * por padrão de nome. São variáveis: um ficheiro por família, com o
 * intervalo de `wght` no nome. O `v<N>_<M>` é o `head.fontRevision` do
 * próprio ficheiro: vai no nome porque os ficheiros de `public/` não levam
 * hash do Vite, e é o nome versionado que permite `Cache-Control:
 * immutable` sem ficar preso a uma versão antiga.
 *
 * As duas estão acima da dobra: o nome do bar e o título da página são
 * Bricolage, e a ementa é DM Sans.
 */
const FACES = [
  {
    nome: "Bricolage Grotesque 700–800",
    padrao: /^bricolage-grotesque-v(\d+_\d+)-latin-700-800\.woff2$/,
    familia: "Bricolage Grotesque",
    token: "--fonte-titulo",
    wght: { min: 700, max: 800 },
    eixos: ["opsz", "wght"],
  },
  {
    nome: "DM Sans 400–700",
    padrao: /^dm-sans-v(\d+_\d+)-latin-400-700\.woff2$/,
    familia: "DM Sans",
    token: "--fonte-corpo",
    wght: { min: 400, max: 700 },
    eixos: ["opsz", "wght"],
  },
] as const;

/** O teto das duas juntas (especificação, secção Design: "as duas juntas até 100 KB"). */
const TETO_DAS_FONTES = 100_000;

/** O que o português de Portugal escreve e o latin básico não garante por si. */
const CARACTERES_DO_PORTUGUES = "ãõçáéíóúâêôàüÁÉÍÓÚÃÕÇ€…–—«»ºª";

function listarPastaDasFontes(): string[] {
  if (!existsSync(PASTA_DAS_FONTES)) {
    throw new Error(
      `Não consegui ler a pasta das fontes (${PASTA_DAS_FONTES}). ` +
        "As duas faces .woff2 vivem em public/fontes/, com OFL.txt e PROVENIENCIA.md ao lado. " +
        "Isto é uma falha de leitura, não uma fonte em falta.",
    );
  }
  return readdirSync(PASTA_DAS_FONTES).sort();
}

export function ficheirosDeFonte(): string[] {
  return listarPastaDasFontes().filter((nome) => nome.toLowerCase().endsWith(".woff2"));
}

/** O ficheiro de cada face; lança se não houver exatamente um. */
function ficheiroDaFace(face: (typeof FACES)[number]): string {
  const achados = ficheirosDeFonte().filter((nome) => face.padrao.test(nome));
  if (achados.length !== 1) {
    throw new Error(
      `Esperava um ficheiro para ${face.nome} (${String(face.padrao)}) e encontrei ` +
        `${achados.length}: ${achados.join(", ") || "nenhum"}.`,
    );
  }
  return achados[0] ?? "";
}

describe("os ficheiros das fontes", () => {
  it("são exatamente dois .woff2, um por família, com a revisão e os pesos no nome", () => {
    const ficheiros = ficheirosDeFonte();

    expect(ficheiros).toHaveLength(2);
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

  it("as duas juntas pesam no máximo 100 000 bytes", () => {
    const tamanhos = ficheirosDeFonte().map(
      (nome) => readFileSync(join(PASTA_DAS_FONTES, nome)).length,
    );

    // Guarda da regra 10: uma pasta vazia somava zero e passava.
    expect(tamanhos, "tem de haver duas faces para somar").toHaveLength(2);
    const soma = tamanhos.reduce((total, tamanho) => total + tamanho, 0);
    expect(soma, `as duas faces somam ${soma} bytes`).toBeLessThanOrEqual(TETO_DAS_FONTES);
  });

  it("a revisão do nome é o head.fontRevision do ficheiro", () => {
    for (const face of FACES) {
      const nome = ficheiroDaFace(face);
      const tabelas = lerTabelasWoff2(join(PASTA_DAS_FONTES, nome));
      expect(face.padrao.exec(nome)?.[1], nome).toBe(revisaoDaFonte(tabelas));
    }
  });

  it("cada face tem os glifos do português", () => {
    const emFalta: string[] = [];
    for (const face of FACES) {
      const tabelas = lerTabelasWoff2(join(PASTA_DAS_FONTES, ficheiroDaFace(face)));
      for (const caractere of CARACTERES_DO_PORTUGUES) {
        if (!temGlifo(tabelas, caractere.codePointAt(0) ?? 0)) {
          emFalta.push(`${face.nome}: «${caractere}»`);
        }
      }
    }

    expect(emFalta).toEqual([]);
  });

  it("a Bricolage traz tnum: é ela que desenha os preços", () => {
    // O DM Sans de google/fonts (4.004) não tem `tnum` nem algarismos
    // tabulares por omissão: o «1» tem 342 unidades e o «0» 656. Por isso os
    // preços são Bricolage 700 (`.font-preco`, R-01 6.8), e é na Bricolage
    // que o recorte não pode perder o `tnum`.
    const bricolage = FACES[0];
    const tabelas = lerTabelasWoff2(join(PASTA_DAS_FONTES, ficheiroDaFace(bricolage)));

    expect(recursosGsub(tabelas)).toContain("tnum");
  });

  it("o eixo wght de cada ficheiro é o do nome, e a Bricolage já não tem wdth", () => {
    for (const face of FACES) {
      const eixos = eixosFvar(lerTabelasWoff2(join(PASTA_DAS_FONTES, ficheiroDaFace(face))));

      expect(
        eixos.find((eixo) => eixo.tag === "wght"),
        face.nome,
      ).toEqual({
        tag: "wght",
        min: face.wght.min,
        max: face.wght.max,
      });
      expect(eixos.map((eixo) => eixo.tag).sort(), face.nome).toEqual([...face.eixos].sort());
    }
  });

  it("a licença e a proveniência estão lá, e o sha256 de cada ficheiro confere", () => {
    // As duas famílias são SIL Open Font License 1.1, que obriga a
    // acompanhar a licença. O sha256 escrito é o que prova que o ficheiro
    // em disco é o que alguém foi buscar e registou — sem ele,
    // "proveniência" é só uma frase.
    const licenca = lerTexto(join(PASTA_DAS_FONTES, "OFL.txt"), "public/fontes/OFL.txt");
    for (const face of FACES) {
      expect(licenca, `o OFL.txt tem de trazer a licença da ${face.familia}`).toContain(
        face.familia,
      );
    }
    expect(licenca).toContain("SIL OPEN FONT LICENSE Version 1.1");

    const proveniencia = lerTexto(
      join(PASTA_DAS_FONTES, "PROVENIENCIA.md"),
      "public/fontes/PROVENIENCIA.md",
    );
    expect(proveniencia, "a proveniência tem de dizer de onde vieram").toMatch(
      /https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[0-9a-f]{40}\//,
    );
    expect(proveniencia.toLowerCase()).toContain("latin");
    expect(proveniencia, "a versão do fonttools fica escrita").toMatch(
      /fonttools\[woff\]==\d+\.\d+/,
    );

    const ficheiros = ficheirosDeFonte();
    // Guarda da regra 10: sem ficheiros o ciclo não verifica nada.
    expect(ficheiros).toHaveLength(2);
    const semRegisto: string[] = [];
    for (const nome of ficheiros) {
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

describe("autoteste do leitor de woff2 (regra 10)", () => {
  it("um ficheiro que não é woff2 dá «não consegui ler», nunca «não tem o glifo»", () => {
    // O OFL.txt existe e lê-se, mas não é uma fonte. Se o leitor devolvesse
    // um mapa vazio, `temGlifo` tinha de escolher entre sim e não — e
    // qualquer das duas era mentira.
    expect(() => lerTabelasWoff2(join(PASTA_DAS_FONTES, "OFL.txt"))).toThrow(/não consegui ler/i);
  });

  it("um caminho que não existe dá «não consegui ler»", () => {
    expect(() => lerTabelasWoff2(join(PASTA_DAS_FONTES, "nao-existe.woff2"))).toThrow(
      /não consegui ler/i,
    );
  });

  it("um woff2 cortado a meio dá «não consegui ler»", () => {
    const nome = ficheiroDaFace(FACES[1]);
    const inteiro = readFileSync(join(PASTA_DAS_FONTES, nome));
    expect(() => lerBytesCortados(inteiro.subarray(0, inteiro.length >> 1))).toThrow(
      /não consegui ler/i,
    );
  });

  it("sem cmap, temGlifo lança em vez de responder", () => {
    expect(() => temGlifo(new Map(), 0x00e3)).toThrow(/não consegui ler/i);
  });

  it("o leitor responde não a um caractere que as fontes não têm", () => {
    // O outro lado: sem isto, um temGlifo que respondesse sempre sim
    // passava todos os testes acima.
    const tabelas = lerTabelasWoff2(join(PASTA_DAS_FONTES, ficheiroDaFace(FACES[1])));
    expect(temGlifo(tabelas, 0x4e2d)).toBe(false); // 中
    expect(temGlifo(tabelas, 0x0061)).toBe(true); // a
  });
});

/** Escreve os bytes num ficheiro temporário e tenta lê-los. */
function lerBytesCortados(bytes: Buffer): void {
  const pasta = mkdtempSync(join(tmpdir(), "woff2-"));
  try {
    const caminho = join(pasta, "cortado.woff2");
    writeFileSync(caminho, bytes);
    lerTabelasWoff2(caminho);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

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

/** O `font-family` de cada `@font-face`, sem aspas. */
function familiasDeclaradas(): string[] {
  return blocosDeFontFace().map(
    (bloco) => /font-family:\s*["']?([^"';]+)["']?\s*;/.exec(bloco)?.[1]?.trim() ?? "",
  );
}

/** A secção `## Design` de `docs/ESPECIFICACAO.md`, até à secção seguinte. */
function seccaoDesign(): string {
  const especificacao = lerTexto(
    join(RAIZ_REPOSITORIO, "docs", "ESPECIFICACAO.md"),
    "docs/ESPECIFICACAO.md",
  );
  const seccao = /^## Design\s*$([\s\S]*?)^## /m.exec(especificacao)?.[1];
  if (seccao === undefined) {
    throw new Error(
      "Não consegui ler a secção «## Design» de docs/ESPECIFICACAO.md. " +
        "Isto é uma falha de leitura, não uma família em falta.",
    );
  }
  return seccao;
}

describe("src/styles/fontes.css", () => {
  it("declara as duas faces, com a família e o intervalo de pesos do nome do ficheiro", () => {
    const blocos = blocosDeFontFace();

    expect(blocos).toHaveLength(2);
    for (const face of FACES) {
      const bloco = blocos.find((texto) =>
        face.padrao.test(/url\(["']?\/fontes\/([^"')]+)/.exec(texto)?.[1] ?? ""),
      );
      expect(bloco, `nenhum @font-face aponta para a face ${face.nome}`).toBeDefined();
      const plano = bloco?.replace(/\s+/g, " ") ?? "";
      expect(plano).toContain(`font-family: "${face.familia}";`);
      // Exatamente "<min> <max>": um `font-weight: 400` numa face variável
      // dizia ao browser que só há o 400, e o 700 saía sintetizado ou noutra
      // fonte.
      expect(/font-weight:\s*([^;]+);/.exec(plano)?.[1]?.trim()).toBe(
        `${face.wght.min} ${face.wght.max}`,
      );
      expect(plano).toMatch(/font-style:\s*normal/);
      expect(plano).toMatch(/font-display:\s*swap/);
      expect(bloco).toContain('format("woff2")');
    }
  });

  it("cada família de fontes.css está na secção Design da especificação", () => {
    const seccao = seccaoDesign();
    const familias = familiasDeclaradas();

    // Guarda da regra 10: sem @font-face o ciclo não verifica nada.
    expect(familias).toHaveLength(2);
    for (const familia of familias) {
      expect(seccao).toContain(familia);
    }
    expect(seccao).not.toMatch(/Playfair|Source Sans/);
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

    expect(urlsDeclaradas().length, "fontes.css tem de declarar as duas faces").toBe(2);
    expect(emFalta).toEqual([]);
  });

  it("nenhum src vai buscar bytes a outro sítio (CSP font-src 'self')", () => {
    const css = lerTexto(CAMINHO_DO_CSS, "src/styles/fontes.css");

    expect(css, "nada de CDN: a CSP de produção é font-src 'self'").not.toMatch(/https?:/);
    expect(css, "nada de URL sem esquema (//fonts.gstatic.com)").not.toMatch(/url\(\s*["']?\/\//);
    expect(css, "nada de data: — o font-src 'self' bloqueia-o").not.toMatch(/data:/);
  });

  it("não declara unicode-range", () => {
    // Com uma só face por família, declarar o intervalo não poupa nada e
    // cria a hipótese de um caractere português cair fora por engano.
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
  it("precarrega as duas faces, e só essas", () => {
    // As duas estão acima da dobra: o nome do bar é Bricolage e a ementa é
    // DM Sans. Um terceiro preload só competia com o CSS e o JS.
    const declaradas = urlsDeclaradas();
    const precarregadas = preloads().map((atributos) => atributos["href"] ?? "");

    expect(precarregadas).toHaveLength(2);
    for (const face of FACES) {
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
    expect(todos.length, "index.html tem de precarregar as duas faces").toBe(2);

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

/** O valor numérico de um `--peso-*` no `:root` de `tokens.css`. */
function pesoDoToken(raiz: Map<string, string>, token: string): number {
  const valor = raiz.get(token);
  if (valor === undefined || !/^\d+$/.test(valor.trim())) {
    throw new Error(`Não consegui ler ${token} em tokens.css (valor: ${String(valor)}).`);
  }
  return Number(valor.trim());
}

describe("pesos: o browser não inventa negritos", () => {
  it("todo o --peso-* aplicado a uma família cabe no intervalo dela", () => {
    // Com `font-synthesis: none`, um peso pedido fora do intervalo do
    // ficheiro não dá erro: sai no peso mais próximo que existe. Um 500
    // pedido à Bricolage (só 700–800) saía a 700 sem ninguém reparar.
    const raiz = blocosDosTokens().get(":root") ?? new Map<string, string>();
    const porFamilia: Record<string, readonly string[]> = {
      "--fonte-titulo": ["--peso-titulo", "--peso-seccao"],
      "--fonte-corpo": ["--peso-normal", "--peso-medio", "--peso-forte"],
    };

    // Guarda: um --peso-* novo tem de ser posto numa família, aqui.
    const todosOsPesos = [...raiz.keys()].filter((nome) => nome.startsWith("--peso-")).sort();
    expect(todosOsPesos).toEqual(Object.values(porFamilia).flat().sort());

    for (const face of FACES) {
      const pilha = raiz.get(face.token) ?? "";
      expect(pilha, `${face.token} começa pela ${face.familia}`).toMatch(
        new RegExp(`^\\s*"${face.familia}"`),
      );
      for (const token of porFamilia[face.token] ?? []) {
        const peso = pesoDoToken(raiz, token);
        expect(peso, `${token} (${face.familia})`).toBeGreaterThanOrEqual(face.wght.min);
        expect(peso, `${token} (${face.familia})`).toBeLessThanOrEqual(face.wght.max);
      }
    }
  });

  it("global.css desliga a síntese de pesos e manda o strong para o peso forte", () => {
    // A Bricolage só existe entre 700 e 800 e o DM Sans entre 400 e 700.
    // Sem `font-synthesis: none`, o browser fabricava um negrito ou um
    // itálico que ninguém desenhou.
    const global = lerTexto(
      join(RAIZ_FRONTEND, "src", "styles", "global.css"),
      "global.css",
    ).replace(/\s+/g, " ");

    expect(global).toMatch(/font-synthesis:\s*none/);
    expect(global).toMatch(/strong[^{]*\{[^}]*font-weight:\s*var\(--peso-forte\)/);
  });
});

describe("preços: o DM Sans não é usado em preços", () => {
  it("o .font-preco é a família de título a 700, com algarismos tabulares", () => {
    // Sem `tnum` no DM Sans, um `tabular-nums` num preço em DM Sans não faz
    // nada e a coluna desalinha sem erro. O `.font-preco` prende a família à
    // Bricolage, o peso a `--peso-seccao` (700, dentro de 700–800) e o
    // `tabular-nums` à mesma regra.
    const global = lerTexto(
      join(RAIZ_FRONTEND, "src", "styles", "global.css"),
      "global.css",
    ).replace(/\s+/g, " ");
    const bloco = /\.font-preco\s*\{([^}]*)\}/.exec(global)?.[1];

    expect(bloco, "global.css tem de declarar .font-preco").toBeDefined();
    expect(bloco).toMatch(/font-family:\s*var\(--fonte-titulo\)/);
    expect(bloco).toMatch(/font-weight:\s*var\(--peso-seccao\)/);
    expect(bloco).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(bloco).not.toMatch(/--fonte-corpo/);
  });
});

/**
 * R-01 / ADR 0023 — critério 10 de `docs/ecras/R-01.md`: `font-titulo`,
 * `font-seccao` e `font-preco` trazem o peso consigo e nunca se juntam a
 * `font-normal|medio|forte`. Junto deles, o peso de corpo ganhava ou perdia
 * conforme a ordem das regras no CSS, e um 400 pedido à Bricolage (só
 * 700–800) saía a 700 sem ninguém reparar.
 *
 * "Junto" quer dizer no mesmo literal de string ou de template, ou nos
 * argumentos da mesma chamada a `juntar(...)`. Lê-se a árvore do TypeScript
 * e não o texto cru, para um comentário não contar e para os argumentos de
 * um `juntar` em várias linhas contarem juntos.
 */
const CLASSE_COM_PESO = /^font-(titulo|seccao|preco)$/;
const CLASSE_DE_PESO = /^font-(normal|medio|forte)$/;

/** As classes de um texto, sem prefixos de variante (`sm:`, `hover:`) nem `!`. */
function classesDe(texto: string): string[] {
  return texto
    .split(/\s+/)
    .map((parte) => parte.slice(parte.lastIndexOf(":") + 1).replace(/^!/, ""))
    .filter((parte) => parte !== "");
}

function misturaPesos(textos: string[]): boolean {
  const classes = textos.flatMap(classesDe);
  return (
    classes.some((classe) => CLASSE_COM_PESO.test(classe)) &&
    classes.some((classe) => CLASSE_DE_PESO.test(classe))
  );
}

/** O texto de um literal de string ou de template; `undefined` se não for um. */
function textoDoLiteral(no: ts.Node): string | undefined {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) return no.text;
  if (ts.isTemplateExpression(no)) {
    // As partes fixas de `${...}` juntam-se com um espaço: o que vem de fora
    // não é uma classe que se possa ler aqui.
    return [no.head.text, ...no.templateSpans.map((parte) => parte.literal.text)].join(" ");
  }
  return undefined;
}

/** Todos os literais abaixo de `no`, incluindo os de `cond && "..."` e de ternários. */
function literaisDentro(no: ts.Node): string[] {
  const textos: string[] = [];
  const visitar = (filho: ts.Node): void => {
    const texto = textoDoLiteral(filho);
    if (texto !== undefined) textos.push(texto);
    ts.forEachChild(filho, visitar);
  };
  visitar(no);
  return textos;
}

/** As misturas proibidas num ficheiro `.tsx`, como "caminho:linha: texto". */
function misturasDePesoNoCodigo(codigo: string, nome: string): string[] {
  const fonte = ts.createSourceFile(nome, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados: string[] = [];
  const registar = (no: ts.Node, textos: string[]): void => {
    const linha = fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1;
    achados.push(`${nome}:${linha}: ${textos.join(" | ")}`);
  };

  const visitar = (no: ts.Node): void => {
    const texto = textoDoLiteral(no);
    if (texto !== undefined && misturaPesos([texto])) registar(no, [texto]);

    if (
      ts.isCallExpression(no) &&
      ts.isIdentifier(no.expression) &&
      no.expression.text === "juntar"
    ) {
      const textos = no.arguments.flatMap(literaisDentro);
      // Um literal que já mistura sozinho foi registado acima; aqui só a
      // mistura que só existe entre argumentos.
      if (misturaPesos(textos) && !textos.some((um) => misturaPesos([um]))) {
        registar(no, textos);
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

describe("R-01 / ADR 0023: as classes de título não levam peso de corpo ao lado", () => {
  it("autoteste: a varredura apanha os casos maus e deixa passar os bons", () => {
    // Prova de que o detetor deteta: sem isto, um detetor que nunca
    // encontrasse nada passava o teste de baixo com o código cheio de erros.
    const prova = [
      'const a = <h2 className="font-titulo text-titulo font-forte">x</h2>;',
      "const b = `font-seccao ${cor} sm:font-medio`;",
      "const c = juntar(",
      '  "font-preco text-texto",',
      '  ativo && "font-normal",',
      ");",
      'const d = juntar("font-seccao", erro ? "text-erro" : "text-texto");',
      'const e = <p className="font-medio text-texto">ok</p>;',
      "// font-titulo font-forte num comentário não é uma classe",
    ].join("\n");

    const achados = misturasDePesoNoCodigo(prova, "prova.tsx");

    expect(achados.map((achado) => achado.split(":")[1])).toEqual(["1", "2", "3"]);
  });

  it("nenhum .tsx de src/ junta font-titulo|seccao|preco a font-normal|medio|forte", () => {
    const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, "src"), { extensoes: [".tsx"] }).filter(
      (caminho) => !caminho.endsWith(".test.tsx"),
    );

    // Guarda da regra 10: zero ficheiros lidos dava "sem misturas" sem ter
    // procurado em lado nenhum.
    exigirSentinelas(
      ficheiros,
      ["src/components/ui/EstadoVazio.tsx", "src/components/ui/Folha.tsx"],
      "pesos das classes de título",
    );
    expect(ficheiros.length, `li ${ficheiros.length} ficheiros .tsx`).toBeGreaterThan(0);

    const achados = ficheiros.flatMap((caminho) =>
      misturasDePesoNoCodigo(lerTexto(caminho, caminhoRelativo(caminho)), caminhoRelativo(caminho)),
    );

    expect(achados, `li ${ficheiros.length} ficheiros .tsx`).toEqual([]);
  });
});
