/**
 * F4-02, plano 2.1 — o índice de pesquisa da gestão. Reusa `normalizar` de
 * `src/lib/ementa/pesquisa.ts` (sem acentos, sem maiúsculas, espaços a mais
 * ignorados) mas **não deita fora categorias vazias** como o `indexarEmenta`
 * público: a gestão mostra tudo.
 *
 * Contrato proposto (`src/pages/gestao/ementa/pesquisa-gestao.ts`):
 *
 * ```ts
 * export type IndiceDaGestao;                                           // opaco
 * export function indexarEmentaGestao(categorias: readonly CategoriaGestao[]): IndiceDaGestao;
 * // Termo vazio ou só espaços: TODAS as categorias, incluindo as vazias e as
 * // escondidas, com todos os produtos. Com termo: só as categorias com
 * // produtos que condizem, cada uma só com esses produtos, pela ordem original.
 * export function filtrarEmentaGestao(indice: IndiceDaGestao, termo: string): CategoriaGestao[];
 * ```
 *
 * **Deixado de fora de propósito:** se o termo condiz também com o NOME da
 * categoria. A `docs/ecras/F4-02.md` (3.1) diz que não; o plano (3.6) diz «regras
 * do ADR 0013», que sim. É a pergunta aberta «A pesquisa da gestão só condiz com
 * o nome do produto» — enquanto o Tomás não decidir, nenhum teste a prende.
 */
import { describe, expect, it } from "vitest";

import { ementaDeGestaoDeTeste } from "../../../testes/gestao";
import { filtrarEmentaGestao, indexarEmentaGestao } from "./pesquisa-gestao";

const { categorias } = ementaDeGestaoDeTeste();
const indice = indexarEmentaGestao(categorias);

const nomesDosProdutos = (resultado: ReturnType<typeof filtrarEmentaGestao>): string[] =>
  resultado.flatMap((categoria) => categoria.produtos.map((produto) => produto.nome));

describe("termo que não é uma pesquisa", () => {
  it.each([[""], ["   "], ["\t "]])(
    "%j devolve a ementa inteira, categorias vazias incluídas",
    (termo) => {
      const resultado = filtrarEmentaGestao(indice, termo);

      expect(resultado.map((c) => c.nome)).toEqual([
        "Cafetaria",
        "Garrafeira",
        "Sobremesas",
        "Petiscos",
        "Sumos",
      ]);
      expect(resultado[3]?.produtos).toEqual([]);
    },
  );
});

describe("termo com texto", () => {
  it("condiz por subcadeia, sem acentos nem maiúsculas", () => {
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "cafe"))).toEqual(["Café", "Café duplo"]);
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "CAFÉ"))).toEqual(["Café", "Café duplo"]);
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "galao"))).toEqual(["Galão"]);
  });

  it("ignora espaços a mais no princípio, no fim e no meio", () => {
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "  vinho   tinto "))).toEqual([
      "Vinho tinto da casa",
    ]);
  });

  it("encontra o indisponível e o que está numa categoria escondida", () => {
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "cappuccino"))).toEqual(["Cappuccino"]);
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "pudim"))).toEqual(["Pudim"]);
    expect(nomesDosProdutos(filtrarEmentaGestao(indice, "laranja"))).toEqual(["Sumo de laranja"]);
  });

  it("cada categoria só traz os produtos que condizem, pela ordem original", () => {
    const resultado = filtrarEmentaGestao(indice, "cafe");

    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.id).toBe(1);
    expect(resultado[0]?.produtos.map((p) => p.id)).toEqual([101, 104]);
  });

  it("sem nenhum produto a condizer, a lista é vazia (e não uma categoria vazia)", () => {
    expect(filtrarEmentaGestao(indice, "zzzz")).toEqual([]);
  });

  it("não muda a ementa de origem", () => {
    const copia = structuredClone(categorias);
    filtrarEmentaGestao(indice, "cafe");
    expect(categorias).toEqual(copia);
  });
});

describe("a ementa sem categorias", () => {
  it("indexa e filtra sem rebentar", () => {
    const vazio = indexarEmentaGestao([]);
    expect(filtrarEmentaGestao(vazio, "")).toEqual([]);
    expect(filtrarEmentaGestao(vazio, "cafe")).toEqual([]);
  });
});
