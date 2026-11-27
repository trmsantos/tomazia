// @vitest-environment node
/**
 * F3-01 — os papéis de cor por âmbito, e a armadilha do dourado.
 *
 * A secção 6 de `docs/ecras/F3-01.md` é uma tabela de números medidos. Este
 * ficheiro transforma-a em asserções, porque a falha que ela descreve é a
 * mais fácil de deixar passar de todo o projeto:
 *
 *   **o anel de foco dentro do cartão creme.** O dourado dá 1,72 contra o
 *   creme. Um anel a 1,72 não se vê — e só não se vê a quem navega por
 *   teclado, que é exactamente quem precisa dele. Não aparece numa captura
 *   de ecrã, não aparece a usar o rato, e o axe não mede contraste de
 *   `outline`.
 *
 * O mecanismo que fecha isto é `tokens.css` reatribuir `--cor-foco` dentro
 * de `.superficie-creme`. Este teste resolve as variáveis como o browser as
 * resolveria (âmbito primeiro, `:root` depois, `var()` em cadeia) e faz a
 * conta. É estático: corre em milissegundos e não precisa de browser. O
 * `e2e/componentes.spec.ts` confirma depois, com layout a sério, que é
 * mesmo este o valor que chega ao ecrã.
 */
import { describe, expect, it } from "vitest";

import { arredondar, contraste, contrasteDeCores, lerCor, sobrepor } from "../testes/contraste";
import {
  AMBITOS,
  blocosDosTokens,
  eTransparente,
  lerBlocos,
  misturarEmSrgb,
  resolver,
} from "../testes/tokens";

const PARES_OBRIGATORIOS: { frente: string; tras: string; minimo: number; porque: string }[] = [
  { frente: "--cor-texto", tras: "--cor-fundo-local", minimo: 4.5, porque: "texto corrente" },
  {
    frente: "--cor-texto-suave",
    tras: "--cor-fundo-local",
    minimo: 4.5,
    porque: "texto secundário e placeholder",
  },
  {
    frente: "--cor-foco",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque: "anel de foco (1.4.11) — é aqui que o dourado sobre creme chumba",
  },
  {
    frente: "--cor-contorno",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque: "contorno de campo e de botão secundário (1.4.11)",
  },
  {
    frente: "--cor-texto-sobre-acao",
    tras: "--cor-acao",
    minimo: 4.5,
    porque: "texto do botão principal",
  },
  {
    frente: "--cor-texto-sobre-perigo",
    tras: "--cor-perigo",
    minimo: 4.5,
    porque: "texto do botão de perigo",
  },
  { frente: "--cor-erro", tras: "--cor-fundo-local", minimo: 4.5, porque: "mensagem de erro" },
  {
    frente: "--cor-sucesso",
    tras: "--cor-fundo-local",
    minimo: 4.5,
    porque: "mensagem de sucesso",
  },
  // R-01 / ADR 0023: o resto da tabela da secção 7 de docs/ecras/R-01.md.
  {
    frente: "--cor-texto-marca",
    tras: "--cor-fundo-local",
    minimo: 4.5,
    porque: "preço e nome do bar",
  },
  {
    frente: "--cor-fio-interno",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque: "divisória dentro de uma superfície (1.4.11)",
  },
  {
    frente: "--cor-pontilhado",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque: "pontilhado da linha de produto",
  },
  {
    frente: "--cor-acao",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque: "preenchimento do botão principal e do chip ativo (1.4.11)",
  },
  {
    frente: "--cor-perigo",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque:
      "preenchimento do botão de perigo (1.4.11) — é aqui que o erro-creme chumba no destaque",
  },
  {
    frente: "--cor-texto-sobre-dourada",
    tras: "--cor-acao-dourada",
    minimo: 4.5,
    porque: "texto do botão dourado",
  },
  {
    frente: "--cor-contorno-dourada",
    tras: "--cor-fundo-local",
    minimo: 3,
    porque: "a borda do botão dourado é a fronteira dele (1.4.11): no creme o dourado dá 1,72",
  },
  {
    frente: "--cor-texto",
    tras: "--cor-fundo-controlo",
    minimo: 4.5,
    porque: "texto do Campo e do Chip inativo, sobre o preenchimento deles",
  },
  {
    frente: "--cor-texto-suave",
    tras: "--cor-fundo-controlo",
    minimo: 4.5,
    porque: "placeholder do Campo",
  },
];

/**
 * Os papéis que podem valer `transparent`. Um controlo transparente mostra o
 * fundo do âmbito, por isso mede-se contra o `--cor-fundo-local` (secção 5
 * de docs/ecras/R-01.md). Fora desta lista, `transparent` é uma falha: um
 * texto ou um anel transparente não se vê.
 */
const PODEM_SER_TRANSPARENTES = new Set(["--cor-fundo-controlo"]);

/**
 * A cor com que um papel se mede: a que o `resolver` calcula, ou o fundo do
 * âmbito quando o papel é `transparent` e pode sê-lo. `null` quer dizer "não
 * consegui resolver" — nunca "é transparente", que o `eTransparente` separa.
 */
function corParaMedir(
  blocos: Map<string, Map<string, string>>,
  ambito: string,
  nome: string,
): string | null {
  const cor = resolver(blocos, ambito, nome);
  if (cor !== null) return cor;
  if (!PODEM_SER_TRANSPARENTES.has(nome)) return null;
  let transparente: boolean;
  try {
    transparente = eTransparente(blocos, ambito, nome);
  } catch {
    return null;
  }
  return transparente ? resolver(blocos, ambito, "--cor-fundo-local") : null;
}

type Par = (typeof PARES_OBRIGATORIOS)[number];

/** Falhas de leitura ou de contraste; um par que não se resolve nunca é saltado. */
function verificarPares(
  blocos: Map<string, Map<string, string>>,
  ambitos: string[],
  pares: Par[],
): { falhas: string[]; verificados: number } {
  const falhas: string[] = [];
  let verificados = 0;

  for (const ambito of ambitos) {
    for (const par of pares) {
      const frente = corParaMedir(blocos, ambito, par.frente);
      const tras = corParaMedir(blocos, ambito, par.tras);
      for (const [papel, cor] of [
        [par.frente, frente],
        [par.tras, tras],
      ] as const) {
        if (cor === null) {
          falhas.push(
            `${ambito}: não consegui resolver ${papel} em ${ambito} — falha de leitura, não de contraste`,
          );
        }
      }
      if (frente === null || tras === null) continue;
      verificados += 1;
      const racio = arredondar(contraste(frente, tras));
      if (racio < par.minimo) {
        falhas.push(
          `${ambito}: ${par.frente} (${frente}) sobre ${par.tras} (${tras}) dá ${racio}, ` +
            `e o mínimo é ${par.minimo} — ${par.porque}`,
        );
      }
    }
  }
  return { falhas, verificados };
}

describe("papéis de cor por âmbito", () => {
  it("os cinco âmbitos existem e definem --cor-fundo-local", () => {
    const blocos = blocosDosTokens();

    for (const ambito of AMBITOS) {
      expect(resolver(blocos, ambito, "--cor-fundo-local"), `${ambito} sem fundo`).toMatch(/^#/);
    }
  });

  it("cada par de papéis cumpre o mínimo WCAG, nos cinco âmbitos", () => {
    const blocos = blocosDosTokens();
    const { falhas, verificados } = verificarPares(blocos, AMBITOS, PARES_OBRIGATORIOS);

    expect(verificados, "guarda: nenhum par verificado quer dizer que não verifiquei nada").toBe(
      AMBITOS.length * PARES_OBRIGATORIOS.length,
    );
    expect(falhas).toEqual([]);
  });

  it("o anel de foco dentro do cartão creme não é dourado, e vê-se", () => {
    // A armadilha, nomeada. Se alguém apagar a reatribuição de `--cor-foco`
    // em `.superficie-creme`, o foco herda o dourado de `:root` e fica a
    // 1,72 contra o creme — e este teste é o único sítio onde isso aparece.
    const blocos = blocosDosTokens();

    const dourado = resolver(blocos, ":root", "--cor-dourado-latao");
    const creme = resolver(blocos, ".superficie-creme", "--cor-fundo-local");
    const foco = resolver(blocos, ".superficie-creme", "--cor-foco");

    expect(dourado, "--cor-dourado-latao tem de existir").toMatch(/^#/);
    expect(creme, ".superficie-creme tem de definir --cor-fundo-local").toMatch(/^#/);
    expect(foco, ".superficie-creme tem de reatribuir --cor-foco").toMatch(/^#/);

    expect(foco?.toLowerCase()).not.toBe(dourado?.toLowerCase());
    expect(arredondar(contraste(foco ?? "", creme ?? ""))).toBeGreaterThanOrEqual(3);
  });

  it.each([".superficie-creme", ".superficie-papel"])(
    "nenhum papel do âmbito %s resolve para o dourado, exceto a ação dourada",
    (ambito) => {
      // A regra de revisão da secção 6 do F3-01, reescrita pelo R-01 / ADR 0023:
      // no creme e no papel o dourado só aparece no preenchimento do botão
      // dourado, que leva sempre a borda bordo-noite (R-01, 8.2).
      const blocos = blocosDosTokens();
      const dourado = (resolver(blocos, ":root", "--cor-dourado-latao") ?? "").toLowerCase();
      expect(dourado).toMatch(/^#/);

      const papeis = [
        "--cor-fundo-local",
        "--cor-texto",
        "--cor-texto-suave",
        "--cor-texto-marca",
        "--cor-contorno",
        "--cor-contorno-superficie",
        "--cor-fio-interno",
        "--cor-foco",
        "--cor-acao",
        "--cor-texto-sobre-acao",
        "--cor-texto-sobre-dourada",
        "--cor-contorno-dourada",
        "--cor-fundo-controlo",
        "--cor-perigo",
        "--cor-texto-sobre-perigo",
        "--cor-sucesso",
        "--cor-erro",
        "--cor-pontilhado",
      ];

      // Guarda da regra 10: um papel que não resolve não é "não dourado".
      const porResolver = papeis.filter((papel) => resolver(blocos, ambito, papel) === null);
      expect(porResolver, `não consegui resolver estes papéis em ${ambito}`).toEqual([]);

      const dourados = papeis.filter(
        (papel) => (resolver(blocos, ambito, papel) ?? "").toLowerCase() === dourado,
      );
      expect(dourados).toEqual([]);
    },
  );

  it.each([".superficie-creme", ".superficie-papel"])(
    "no %s a borda do dourado é bordo-noite",
    (ambito) => {
      const blocos = blocosDosTokens();
      const bordoNoite = resolver(blocos, ":root", "--cor-bordo-noite");
      expect(bordoNoite).toBe("#3d0f24");
      expect(resolver(blocos, ambito, "--cor-contorno-dourada")).toBe(bordoNoite);
    },
  );

  it.each([".superficie-escura", ".superficie-painel", ".superficie-destaque"])(
    "no %s a borda do dourado é o próprio dourado",
    (ambito) => {
      const blocos = blocosDosTokens();
      expect(resolver(blocos, ambito, "--cor-contorno-dourada")).toBe("#d4af37");
    },
  );

  it.each(AMBITOS)("a ação dourada é dourado com texto bordo-noite em %s", (ambito) => {
    const blocos = blocosDosTokens();
    expect(resolver(blocos, ambito, "--cor-acao-dourada")).toBe("#d4af37");
    expect(resolver(blocos, ambito, "--cor-texto-sobre-dourada")).toBe("#3d0f24");
  });

  it.each([".superficie-creme", ".superficie-papel"])(
    "o principal no %s é bordo-noite",
    (ambito) => {
      // R-01 / ADR 0023: era bordo-tomazia. O bordo-noite cheio é o
      // "Guardar alterações" da maqueta, e dá 13,27 contra o creme.
      expect(resolver(blocosDosTokens(), ambito, "--cor-acao")).toBe("#3d0f24");
    },
  );

  it("o fundo do papel é o creme a 25 % com branco, e dá #fdf9f4", () => {
    // R 245*0,25+255*0,75 = 252,5, que o Math.round leva a 253 (fd).
    const blocos = blocosDosTokens();
    expect(resolver(blocos, ":root", "--cor-papel")).toBe("#fdf9f4");
    expect(resolver(blocos, ".superficie-papel", "--cor-fundo-local")).toBe("#fdf9f4");
  });

  it("o preenchimento dos controlos é papel no creme e no papel, e transparent nos escuros", () => {
    // Secção 5 de docs/ecras/R-01.md: `transparent` e não
    // `var(--cor-fundo-local)`, pela armadilha de substituição do
    // `--cor-fio-interno`. O `eTransparente` lança se não conseguir procurar,
    // por isso "não encontrei" e "é transparente" não se confundem.
    const blocos = blocosDosTokens();
    const papel = resolver(blocos, ":root", "--cor-papel");
    expect(papel).toMatch(/^#/);

    for (const ambito of [".superficie-creme", ".superficie-papel"]) {
      expect(eTransparente(blocos, ambito, "--cor-fundo-controlo"), ambito).toBe(false);
      expect(resolver(blocos, ambito, "--cor-fundo-controlo"), ambito).toBe(papel);
    }
    for (const ambito of [".superficie-escura", ".superficie-painel", ".superficie-destaque"]) {
      expect(eTransparente(blocos, ambito, "--cor-fundo-controlo"), ambito).toBe(true);
    }
  });

  it.each([".superficie-painel", ".superficie-papel", ".superficie-destaque"])(
    "o %s declara todos os papéis, sem herdar nenhum",
    (ambito) => {
      // Um `var()` declarado num âmbito resolve-se lá e desce já resolvido
      // (a nota de `--cor-fio-interno` em tokens.css). Um cartão papel dentro
      // de um painel herdava papéis do painel, por isso declara-os todos.
      // R-01 / ADR 0023: o painel entrou na lista. Uma Folha aberta num ecrã
      // creme (R-02) herdava do creme tudo o que não declarasse.
      const declarados = blocosDosTokens().get(ambito) ?? new Map<string, string>();
      const papeis = [
        "--cor-fundo-local",
        "--cor-texto",
        "--cor-texto-suave",
        "--cor-texto-marca",
        "--cor-contorno",
        "--cor-contorno-superficie",
        "--cor-fio-interno",
        "--cor-pontilhado",
        "--cor-foco",
        "--cor-acao",
        "--cor-texto-sobre-acao",
        "--cor-acao-dourada",
        "--cor-texto-sobre-dourada",
        "--cor-contorno-dourada",
        "--cor-fundo-controlo",
        "--cor-perigo",
        "--cor-texto-sobre-perigo",
        "--cor-erro",
        "--cor-sucesso",
      ];

      expect(papeis.filter((papel) => !declarados.has(papel))).toEqual([]);
    },
  );

  it.each([".superficie-painel", ".superficie-papel", ".superficie-destaque"])(
    "um %s dentro de um .superficie-creme resolve cada papel como sozinho",
    (dentro) => {
      // R-01 / ADR 0023. O `resolver` não modela herança (cai sempre para
      // `:root`), por isso o encaixe faz-se aqui como o browser o faz: o
      // papel que o âmbito de dentro declara resolve-se nele; o que não
      // declara chega já resolvido do âmbito de fora. Sozinho, o de fora é o
      // `:root`. A lista de papéis é a do escuro, para um papel novo entrar
      // aqui sem ninguém se lembrar dele.
      const blocos = blocosDosTokens();
      const papeis = [...(blocos.get(".superficie-escura")?.keys() ?? [])];
      expect(papeis.length, "não consegui ler os papéis do .superficie-escura").toBeGreaterThan(10);

      const ler = (ambito: string, nome: string): string =>
        eTransparente(blocos, ambito, nome)
          ? "transparent"
          : (resolver(blocos, ambito, nome) ?? `não consegui resolver ${nome} em ${ambito}`);
      const encaixado = (fora: string, nome: string): string =>
        blocos.get(dentro)?.has(nome) === true ? ler(dentro, nome) : ler(fora, nome);

      const diferentes = papeis
        .map((papel) => ({
          papel,
          sozinho: encaixado(":root", papel),
          noCreme: encaixado(".superficie-creme", papel),
        }))
        .filter(({ sozinho, noCreme }) => sozinho !== noCreme);
      expect(diferentes).toEqual([]);
    },
  );

  it("o painel é o escuro com fundo vinho: só o fundo e o fio mudam", () => {
    // R-01 / ADR 0023. Declarar todos os papéis no painel não pode mudar o
    // que ele era: cada papel resolve como no escuro, menos estes dois.
    const blocos = blocosDosTokens();
    const papeis = [...(blocos.get(".superficie-escura")?.keys() ?? [])];
    expect(papeis.length).toBeGreaterThan(10);
    const ler = (ambito: string, nome: string): string =>
      eTransparente(blocos, ambito, nome) ? "transparent" : (resolver(blocos, ambito, nome) ?? "");

    const mudam = papeis.filter(
      (papel) => ler(".superficie-painel", papel) !== ler(".superficie-escura", papel),
    );
    expect(mudam.sort()).toEqual(["--cor-fio-interno", "--cor-fundo-local"]);
    expect(resolver(blocos, ".superficie-painel", "--cor-fundo-local")).toBe("#4a1830");
  });

  it("no destaque o perigo é erro-escuro e o erro é creme-papel", () => {
    // Erro-creme sobre bordo-tomazia dá 1,93 (o botão Eliminar perdia a
    // fronteira); erro-escuro como texto dá 4,13 (R-01, 5).
    const blocos = blocosDosTokens();
    expect(resolver(blocos, ".superficie-destaque", "--cor-perigo")).toBe("#e07a5f");
    expect(resolver(blocos, ".superficie-destaque", "--cor-texto-sobre-perigo")).toBe("#3d0f24");
    expect(resolver(blocos, ".superficie-destaque", "--cor-erro")).toBe("#f5e6d3");
    expect(resolver(blocos, ".superficie-destaque", "--cor-foco")).toBe("#f5e6d3");
  });

  it("sobre o círculo de decoração do destaque, o texto e o dourado continuam a ler-se", () => {
    // O círculo é dourado a 18 % sobre o bordo-tomazia (≈ #723939). O
    // `resolver` não calcula misturas com `transparent`, por isso a conta
    // faz-se aqui, com a percentagem lida do token: mudar os 18 % volta a
    // passar por este teste.
    const blocos = blocosDosTokens();
    const bruto = blocos.get(":root")?.get("--cor-decoracao-destaque") ?? "";
    const mistura =
      /^color-mix\(\s*in\s+srgb\s*,\s*var\((--[a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/i.exec(
        bruto,
      );
    expect(mistura, `não consegui ler --cor-decoracao-destaque: «${bruto}»`).not.toBeNull();

    const ler = (nome: string): ReturnType<typeof lerCor> => {
      const valor = resolver(blocos, ".superficie-destaque", nome);
      return valor === null ? null : lerCor(valor);
    };
    const tinta = ler(mistura?.[1] ?? "");
    const fundo = ler("--cor-fundo-local");
    expect(tinta, "não consegui resolver a tinta do círculo").not.toBeNull();
    expect(fundo, "não consegui resolver o fundo do destaque").not.toBeNull();
    if (tinta === null || fundo === null) return;
    const circulo = sobrepor(tinta, fundo, Number.parseFloat(mistura?.[2] ?? "") / 100);

    const medidas: [string, number, number][] = [
      ["--cor-texto", 4.5, 1],
      ["--cor-texto-suave", 4.5, 1],
      ["--cor-acao-dourada", 3, 1],
      ["--cor-foco", 3, 0.6],
    ];
    const falhas: string[] = [];
    for (const [papel, minimo, opacidade] of medidas) {
      const cor = ler(papel);
      if (cor === null) {
        falhas.push(`não consegui resolver ${papel} no destaque`);
        continue;
      }
      const racio = arredondar(contrasteDeCores(sobrepor(cor, circulo, opacidade), circulo));
      if (racio < minimo) falhas.push(`${papel} a ${opacidade} sobre o círculo dá ${racio}`);
    }
    expect(falhas).toEqual([]);
  });

  it("nenhum token usa hex com alfa, que o resolver devolveria sem o ler", () => {
    const blocos = blocosDosTokens();
    const comAlfa: string[] = [];
    for (const [seletor, declaracoes] of blocos) {
      for (const [nome, valor] of declaracoes) {
        if (/#(?:[0-9a-f]{4}|[0-9a-f]{8})\b/i.test(valor))
          comAlfa.push(`${seletor} ${nome}: ${valor}`);
      }
    }
    expect(comAlfa).toEqual([]);
  });

  it("o contorno entre superfícies lê-se contra o bordô de fora", () => {
    // Sem sombras no escuro, a separação entre superfícies é um fio de 1 px.
    // `bordo-vinho` contra `bordo-noite` dá 1,13: um painel sem fio é um
    // painel invisível.
    const blocos = blocosDosTokens();
    const bordoNoite = resolver(blocos, ":root", "--cor-bordo-noite") ?? "";
    expect(bordoNoite).toMatch(/^#/);

    for (const ambito of AMBITOS) {
      const fio = resolver(blocos, ambito, "--cor-contorno-superficie") ?? "";
      expect(fio, `${ambito} sem --cor-contorno-superficie`).toMatch(/^#/);
      expect(arredondar(contraste(fio, bordoNoite))).toBeGreaterThanOrEqual(3);
    }
  });

  it("só .superficie-destaque tem o bordo-tomazia por fundo, e aí --cor-erro não é --cor-erro-escuro", () => {
    // R-01 / ADR 0023: o destaque é o cartão bordo-tomazia do redesign B.
    // `erro-escuro` sobre `bordo-tomazia` dá 4,13 e chumba como texto, por
    // isso o destaque tem de reatribuir o erro. Nenhum outro âmbito o tem.
    const blocos = blocosDosTokens();
    const marca = (resolver(blocos, ":root", "--cor-bordo-tomazia") ?? "").toLowerCase();
    expect(marca).toMatch(/^#/);

    const comFundoMarca = AMBITOS.filter(
      (ambito) => (resolver(blocos, ambito, "--cor-fundo-local") ?? "").toLowerCase() === marca,
    );
    expect(comFundoMarca).toEqual([".superficie-destaque"]);

    const erroEscuro = resolver(blocos, ":root", "--cor-erro-escuro");
    const erro = resolver(blocos, ".superficie-destaque", "--cor-erro");
    expect(erro, "não consegui resolver --cor-erro no destaque").toMatch(/^#/);
    expect(erro).not.toBe(erroEscuro);
  });
});

describe("autoteste do leitor de tokens", () => {
  it("resolve cadeias de var() e respeita o âmbito", () => {
    const css = `
      :root, .superficie-escura {
        --cor-dourado: #d4af37;
        --cor-creme: #f5e6d3;
        --cor-foco: var(--cor-dourado);
      }
      .superficie-creme {
        --cor-foco: var(--cor-marca);
        --cor-marca: #5d1f3a;
      }
    `;
    const blocos = lerBlocos(css);

    expect(resolver(blocos, ".superficie-escura", "--cor-foco")).toBe("#d4af37");
    expect(resolver(blocos, ".superficie-creme", "--cor-foco")).toBe("#5d1f3a");
    expect(resolver(blocos, ".superficie-creme", "--cor-inexistente")).toBeNull();
    // Um `color-mix` não é uma cor literal: devolve null, nunca uma cor
    // inventada que passasse num teste de contraste.
    expect(
      resolver(
        lerBlocos(":root { --x: color-mix(in srgb, #fff 50%, transparent); }"),
        ":root",
        "--x",
      ),
    ).toBeNull();
  });

  it("resolve color-mix em srgb, com white e com var()", () => {
    // 25% de #f5e6d3 + 75% de branco, por canal e arredondado:
    // R 245*0,25+255*0,75 = 252,5 -> 253; G 248,75 -> 249; B 244.
    expect(misturarEmSrgb("#f5e6d3", "#ffffff", 25)).toBe("#fdf9f4");

    const css = `
      :root { --cor-creme-sombra: #d9c3ae; }
      .superficie-creme { --cor-fundo-local: #f5e6d3; }
      .superficie-creme {
        --a: color-mix(in srgb, #f5e6d3 25%, white);
        --b: color-mix(in srgb, var(--cor-creme-sombra) 55%, var(--cor-fundo-local));
        --c: color-mix(in srgb, #3d0f24 88%, transparent);
      }
    `;
    const blocos = lerBlocos(css);

    expect(resolver(blocos, ".superficie-creme", "--a")).toBe("#fdf9f4");
    // R 217*0,55+245*0,45 = 229,6 -> 230 (e6); G 210,75 -> 211 (d3); B 190,65 -> 191 (bf).
    expect(resolver(blocos, ".superficie-creme", "--b")).toBe("#e6d3bf");
    // `transparent` tem alfa: não há #rrggbb. Continua a ser null.
    expect(resolver(blocos, ".superficie-creme", "--c")).toBeNull();
  });

  it("eTransparente separa transparent de cor e de «não consegui procurar»", () => {
    const blocos = lerBlocos(`
      :root { --x: transparent; --cor: #3d0f24; }
      .superficie-escura {
        --direto: transparent;
        --por-var: var(--x);
        --opaca: var(--cor);
        --estranha: color-mix(in srgb, #3d0f24 88%, transparent);
      }
    `);

    expect(eTransparente(blocos, ".superficie-escura", "--direto")).toBe(true);
    expect(eTransparente(blocos, ".superficie-escura", "--por-var")).toBe(true);
    expect(eTransparente(blocos, ".superficie-escura", "--opaca")).toBe(false);
    expect(() => eTransparente(blocos, ".superficie-escura", "--inexistente")).toThrow(
      /não consegui procurar/i,
    );
    expect(() => eTransparente(blocos, ".superficie-escura", "--estranha")).toThrow(
      /não consegui procurar/i,
    );
  });

  it("um par obrigatório que resolve para null falha com «não consegui resolver», sem ser saltado", () => {
    const blocos = lerBlocos(`
      .superficie-prova {
        --cor-texto: #ffffff;
        --cor-fundo-local: color-mix(in srgb, #3d0f24 88%, transparent);
      }
    `);
    const par: Par = {
      frente: "--cor-texto",
      tras: "--cor-fundo-local",
      minimo: 4.5,
      porque: "texto corrente",
    };

    const { falhas, verificados } = verificarPares(blocos, [".superficie-prova"], [par]);

    expect(verificados).toBe(0);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]).toContain("não consegui resolver --cor-fundo-local em .superficie-prova");
  });

  it("falha a dizer «não consegui ler» quando o tokens.css não tem os âmbitos", () => {
    const blocos = lerBlocos(":root { --cor-fundo-local: #3d0f24; }");

    expect(blocos.has(":root")).toBe(true);
    expect(blocos.has(".superficie-creme")).toBe(false);
  });
});
