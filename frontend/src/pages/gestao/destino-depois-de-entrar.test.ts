/**
 * F4-02, decisão D4 e «Reconciliação com a spec» do plano — o destino depois de
 * entrar, **lido do `history.state`** (nunca de `?voltar=`).
 *
 * Contrato (`src/pages/gestao/destino-depois-de-entrar.ts`):
 *
 * ```ts
 * // `estado` é o `history.state` tal como o browser o dá: `unknown`.
 * // Devolve o caminho aceite, ou "/gestao" (Início) em qualquer outro caso.
 * export function destinoDepoisDeEntrar(estado: unknown): string;
 * ```
 *
 * O estado que o `AppGestao` escreve é `{ voltar: string; sessaoTerminou?: true }`,
 * com `voltar` = `location.pathname + location.search` de onde se foi mandado.
 *
 * **Estes são os testes do redirecionamento aberto.** Um link de fora não
 * consegue escrever `history.state`, por isso a superfície desaparece em vez de
 * ser filtrada; a validação **mantém-se à leitura** como defesa em profundidade
 * (o `history.state` sobrevive a recarregar e pode vir de código antigo):
 *
 *  - `estado` tem de ser um objeto, e `voltar` uma string;
 *  - é exatamente um de `ROTAS_DOS_DESTINOS` e não é `/gestao/entrar`;
 *  - até 64 caracteres; sem `//`, `\`, `:`, `%`, `.`, `#`, espaços nem controlo;
 *  - **única exceção:** `/gestao/ementa?categoria=<slug>`, slug em `^[a-z0-9-]{1,60}$`.
 *
 * Tudo o que não é «aceite» dá `"/gestao"`. A tabela é a do plano 5.2, com cada
 * valor já descodificado (no estado não há `URLSearchParams` a descodificar).
 *
 * **Uma incoerência da especificação, que estes testes não resolvem:** o limite
 * de 64 caracteres e o slug de até 60 não cabem juntos (`/gestao/ementa?categoria=`
 * já tem 25). Só se testa o que não depende disso: um slug curto é aceite e tudo
 * acima de 64 sem ser dessa exceção é recusado.
 */
import { describe, expect, it } from "vitest";

import { DESTINOS_MALICIOSOS } from "../../testes/gestao";
import { destinoDepoisDeEntrar, destinoParaLembrar } from "./destino-depois-de-entrar";
import { ROTAS_DOS_DESTINOS } from "./navegacao";

const INICIO = "/gestao";

describe("destinoDepoisDeEntrar: o que se aceita", () => {
  it.each([
    "/gestao/ementa",
    "/gestao/eventos",
    "/gestao/galeria",
    "/gestao/mais",
    "/gestao/mais/definicoes",
    "/gestao/ementa?categoria=garrafeira",
    "/gestao/ementa?categoria=bebidas-2",
    "/gestao/ementa?categoria=a",
  ])("%s é o próprio", (voltar) => {
    expect(destinoDepoisDeEntrar({ voltar })).toBe(voltar);
  });

  it("chaves a mais no estado não atrapalham (`sessaoTerminou` viaja ao lado)", () => {
    expect(destinoDepoisDeEntrar({ voltar: "/gestao/ementa", sessaoTerminou: true })).toBe(
      "/gestao/ementa",
    );
  });

  it("todos os destinos conhecidos que não são o login são aceites", () => {
    for (const rota of ROTAS_DOS_DESTINOS) {
      expect(destinoDepoisDeEntrar({ voltar: rota })).toBe(rota);
    }
  });

  it("o próprio Início continua a ser o Início", () => {
    expect(destinoDepoisDeEntrar({ voltar: "/gestao" })).toBe(INICIO);
  });
});

describe("destinoDepoisDeEntrar: o estado que não é o que se espera", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["uma string", "/gestao/ementa"],
    ["um número", 42],
    ["um booleano", true],
    ["uma lista", ["/gestao/ementa"]],
    ["um objeto vazio", {}],
    ["voltar undefined", { voltar: undefined }],
    ["voltar null", { voltar: null }],
    ["voltar número", { voltar: 5 }],
    ["voltar lista", { voltar: ["/gestao/ementa"] }],
    ["voltar objeto", { voltar: { caminho: "/gestao/ementa" } }],
    ["voltar vazio", { voltar: "" }],
    ["só o motivo", { sessaoTerminou: true }],
  ])("%s → Início", (_nome, estado) => {
    expect(destinoDepoisDeEntrar(estado)).toBe(INICIO);
  });

  it("um objeto cujo `voltar` lança ao ser lido não faz a função rebentar", () => {
    const hostil = {
      get voltar(): string {
        throw new Error("não ler");
      },
    };
    expect(destinoDepoisDeEntrar(hostil)).toBe(INICIO);
  });
});

describe("destinoDepoisDeEntrar: a tabela do redirecionamento aberto → Início", () => {
  const MALICIOSOS = DESTINOS_MALICIOSOS;

  it.each(MALICIOSOS)("%s: %j → Início", (_nome, voltar) => {
    expect(destinoDepoisDeEntrar({ voltar })).toBe(INICIO);
  });

  it("a tabela cobre mesmo os casos do plano (sentinela: não ficou vazia)", () => {
    expect(MALICIOSOS.length).toBeGreaterThanOrEqual(50);
  });

  it("nenhum resultado, de nenhuma entrada, sai de /gestao nem tem `//` ou `\\`", () => {
    for (const [, voltar] of MALICIOSOS) {
      const resultado = destinoDepoisDeEntrar({ voltar });
      expect(resultado === INICIO || resultado.startsWith("/gestao/")).toBe(true);
      expect(resultado).not.toContain("//");
      expect(resultado).not.toContain("\\");
      expect(resultado).not.toContain(":");
    }
  });
});

/**
 * F4-05a — a lista branca ganha `/gestao/mais/definicoes` (e só essa subrota).
 * O 401 a meio das definições volta aqui depois do login.
 */
describe("destinoDepoisDeEntrar: a subrota das definições (F4-05a)", () => {
  it("{ voltar: '/gestao/mais/definicoes' } é aceite", () => {
    expect(destinoDepoisDeEntrar({ voltar: "/gestao/mais/definicoes" })).toBe(
      "/gestao/mais/definicoes",
    );
  });

  it.each([
    ["barra final", "/gestao/mais/definicoes/"],
    ["query", "/gestao/mais/definicoes?x=1"],
    ["fragmento", "/gestao/mais/definicoes#x"],
    ["maiúscula", "/gestao/mais/Definicoes"],
    ["segmento ..", "/gestao/mais/../ementa"],
    ["subrota desconhecida", "/gestao/mais/outra"],
    ["subrota por baixo", "/gestao/mais/definicoes/x"],
    ["barras duplas", "/gestao/mais//definicoes"],
    ["contrabarra", "/gestao/mais\\definicoes"],
    ["codificada", "/gestao/mais/defini%C3%A7oes"],
  ])("%s → Início", (_nome, voltar) => {
    expect(destinoDepoisDeEntrar({ voltar })).toBe(INICIO);
  });

  it("continua a recusar o login", () => {
    expect(destinoDepoisDeEntrar({ voltar: "/gestao/entrar" })).toBe(INICIO);
  });
});

/**
 * F4-05b — a lista branca ganha `/gestao/mais/clientes` (e só essa subrota nova). O 401 a meio dos
 * clientes volta aqui depois do login; `/gestao/mais/x` continua a cair no Início.
 */
describe("destinoDepoisDeEntrar: a subrota dos clientes (F4-05b)", () => {
  it("{ voltar: '/gestao/mais/clientes' } é aceite", () => {
    expect(destinoDepoisDeEntrar({ voltar: "/gestao/mais/clientes" })).toBe(
      "/gestao/mais/clientes",
    );
  });

  it("as duas subrotas conhecidas convivem; a de definições continua aceite", () => {
    expect(destinoDepoisDeEntrar({ voltar: "/gestao/mais/definicoes" })).toBe(
      "/gestao/mais/definicoes",
    );
  });

  it.each([
    ["barra final", "/gestao/mais/clientes/"],
    ["query", "/gestao/mais/clientes?x=1"],
    ["fragmento", "/gestao/mais/clientes#x"],
    ["maiúscula", "/gestao/mais/Clientes"],
    ["subrota por baixo", "/gestao/mais/clientes/101"],
    ["o id de um cliente", "/gestao/mais/clientes/101/eliminar"],
    ["barras duplas", "/gestao/mais//clientes"],
    ["contrabarra", "/gestao/mais\\clientes"],
    ["codificada", "/gestao/mais/client%65s"],
    ["a subrota inventada", "/gestao/mais/x"],
    ["o ficheiro CSV (nunca é um destino)", "/gestao/mais/clientes.csv"],
  ])("%s → Início", (_nome, voltar) => {
    expect(destinoDepoisDeEntrar({ voltar })).toBe(INICIO);
  });

  it("destinoParaLembrar guarda /gestao/mais/clientes (e só ela, sem query)", () => {
    expect(destinoParaLembrar("/gestao/mais/clientes")).toBe("/gestao/mais/clientes");
    expect(destinoParaLembrar("/gestao/mais/clientes?x=1")).toBeUndefined();
  });
});
