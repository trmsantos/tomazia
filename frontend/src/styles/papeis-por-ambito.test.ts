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

import { arredondar, contraste } from "../testes/contraste";
import {
  AMBITOS,
  blocosDosTokens,
  lerBlocos,
  misturarEmSrgb,
  resolver,
  valorBruto,
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
];

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
      const frente = resolver(blocos, ambito, par.frente);
      const tras = resolver(blocos, ambito, par.tras);
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
  it("os três âmbitos existem e definem --cor-fundo-local", () => {
    const blocos = blocosDosTokens();

    for (const ambito of AMBITOS) {
      expect(resolver(blocos, ambito, "--cor-fundo-local"), `${ambito} sem fundo`).toMatch(/^#/);
    }
  });

  it("cada par de papéis cumpre o mínimo WCAG, nos três âmbitos", () => {
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

  it("nenhum papel do âmbito creme resolve para o dourado", () => {
    // A regra de revisão da secção 6, escrita como teste: «se dourado-latao
    // aparece dentro de um .superficie-creme, é bloqueante».
    const blocos = blocosDosTokens();
    const dourado = (resolver(blocos, ":root", "--cor-dourado-latao") ?? "").toLowerCase();
    expect(dourado).toMatch(/^#/);

    const papeis = [
      "--cor-texto",
      "--cor-texto-suave",
      "--cor-texto-marca",
      "--cor-contorno",
      "--cor-contorno-superficie",
      "--cor-foco",
      "--cor-acao",
      "--cor-texto-sobre-acao",
      "--cor-perigo",
      "--cor-texto-sobre-perigo",
      "--cor-sucesso",
      "--cor-erro",
      "--cor-pontilhado",
    ];

    const douradosNoCreme = papeis.filter(
      (papel) => (resolver(blocos, ".superficie-creme", papel) ?? "").toLowerCase() === dourado,
    );

    expect(douradosNoCreme).toEqual([]);
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

  it("o bordo-tomazia nunca é fundo de superfície", () => {
    // `erro-escuro` sobre `bordo-tomazia` dá 4,13 e chumba. Hoje não
    // acontece; fica escrito para ninguém o promover a painel.
    const blocos = blocosDosTokens();
    const marca = (resolver(blocos, ":root", "--cor-bordo-tomazia") ?? "").toLowerCase();

    for (const ambito of AMBITOS) {
      const fundo = (resolver(blocos, ambito, "--cor-fundo-local") ?? "").toLowerCase();
      expect(fundo, `${ambito} não pode ter o bordo-tomazia como fundo`).not.toBe(marca);
    }
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
    // `transparent` tem alfa: não há #rrggbb. Continua a ser null, mas o valor
    // existe, e quem chama distingue-o de "não consegui procurar".
    expect(resolver(blocos, ".superficie-creme", "--c")).toBeNull();
    expect(valorBruto(blocos, ".superficie-creme", "--c")).toContain("transparent");
    expect(valorBruto(blocos, ".superficie-creme", "--inexistente")).toBeUndefined();
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
