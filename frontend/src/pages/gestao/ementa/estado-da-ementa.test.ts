/**
 * F4-02, plano 2.1 — o redutor puro da lista. O plano nomeia o ficheiro e as
 * operações; os **nomes** abaixo são o contrato que o qa propõe ao frontend.
 *
 * Contrato (`src/pages/gestao/ementa/estado-da-ementa.ts`), tudo puro, sem
 * mutar o argumento e devolvendo **a mesma referência** quando nada muda:
 *
 * ```ts
 * type Movimento = "subir" | "descer" | "inicio" | "fim";
 *
 * // Troca o produto (pelo `id`) pela resposta do servidor. Se `categoria_id`
 * // mudou, sai da categoria antiga e entra **no fim** da nova (é o que o
 * // backend faz). `id` desconhecido: devolve a lista como estava.
 * export function substituirProduto(categorias: CategoriaGestao[], produto: ProdutoGestao): CategoriaGestao[];
 *
 * // Acrescenta no fim da categoria `produto.categoria_id`.
 * export function acrescentarProduto(categorias: CategoriaGestao[], produto: ProdutoGestao): CategoriaGestao[];
 *
 * // Move um item da lista (genérica em `{ id: number }`); nos limites, sem efeito.
 * export function moverNaLista<T extends { id: number }>(lista: readonly T[], id: number, movimento: Movimento): T[];
 *
 * // Põe a categoria `categoriaId` com os produtos pela ordem dos `ids`
 * // (para o «Desfazer» e para o «Cancelar»).
 * export function ordenarProdutosDaCategoria(categorias: CategoriaGestao[], categoriaId: number, ids: readonly number[]): CategoriaGestao[];
 * ```
 *
 * «Repor do servidor» não precisa de função: é trocar a lista inteira pela da
 * resposta do `GET`.
 */
import { describe, expect, it } from "vitest";

import { ementaDeGestaoDeTeste, produtoDeTeste } from "../../../testes/gestao";
import {
  acrescentarProduto,
  moverNaLista,
  ordenarProdutosDaCategoria,
  reporDisponivel,
  substituirProduto,
} from "./estado-da-ementa";

const ids = (lista: readonly { id: number }[]): number[] => lista.map((item) => item.id);

describe("substituirProduto", () => {
  it("troca o produto pela resposta do servidor, na mesma posição", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const resposta = produtoDeTeste({
      id: 202,
      categoria_id: 2,
      nome: "Espumante",
      preco_cent: 1300,
    });

    const nova = substituirProduto(categorias, resposta);

    expect(nova[1]?.produtos.map((p) => [p.id, p.preco_cent])).toEqual([
      [201, 650],
      [202, 1300],
      [203, 800],
    ]);
  });

  it("não muda o argumento nem as categorias que não foram tocadas", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const copia = structuredClone(categorias);

    const nova = substituirProduto(
      categorias,
      produtoDeTeste({ id: 202, categoria_id: 2, nome: "Espumante", preco_cent: 1 }),
    );

    expect(categorias).toEqual(copia);
    expect(nova[0]).toBe(categorias[0]);
    expect(nova[2]).toBe(categorias[2]);
    expect(nova[1]).not.toBe(categorias[1]);
  });

  it("mudar de categoria: sai da antiga e entra NO FIM da nova", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const movido = produtoDeTeste({
      id: 201,
      categoria_id: 1,
      nome: "Vinho tinto da casa",
      preco_cent: 650,
    });

    const nova = substituirProduto(categorias, movido);

    expect(ids(nova[1]?.produtos ?? [])).toEqual([202, 203]);
    expect(ids(nova[0]?.produtos ?? [])).toEqual([101, 102, 103, 104, 201]);
  });

  it("mudar para uma categoria vazia", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const nova = substituirProduto(
      categorias,
      produtoDeTeste({ id: 201, categoria_id: 4, nome: "Vinho tinto da casa" }),
    );
    expect(ids(nova[3]?.produtos ?? [])).toEqual([201]);
    expect(ids(nova[1]?.produtos ?? [])).toEqual([202, 203]);
  });

  it("um id que não existe devolve a lista como estava", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const nova = substituirProduto(categorias, produtoDeTeste({ id: 999, categoria_id: 2 }));
    expect(nova).toEqual(categorias);
  });
});

describe("acrescentarProduto", () => {
  it("acrescenta no fim da categoria do produto", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const novo = produtoDeTeste({ id: 900, categoria_id: 2, nome: "Água tónica" });

    const nova = acrescentarProduto(categorias, novo);

    expect(ids(nova[1]?.produtos ?? [])).toEqual([201, 202, 203, 900]);
    expect(nova[0]).toBe(categorias[0]);
  });

  it("numa categoria vazia, fica sozinho", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const nova = acrescentarProduto(categorias, produtoDeTeste({ id: 900, categoria_id: 4 }));
    expect(ids(nova[3]?.produtos ?? [])).toEqual([900]);
  });

  it("não muda o argumento", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const copia = structuredClone(categorias);
    acrescentarProduto(categorias, produtoDeTeste({ id: 900, categoria_id: 2 }));
    expect(categorias).toEqual(copia);
  });
});

describe("moverNaLista", () => {
  const lista = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  it.each([
    ["subir", 3, [1, 3, 2, 4]],
    ["descer", 2, [1, 3, 2, 4]],
    ["inicio", 3, [3, 1, 2, 4]],
    ["fim", 2, [1, 3, 4, 2]],
    ["inicio", 4, [4, 1, 2, 3]],
    ["fim", 1, [2, 3, 4, 1]],
  ] as const)("%s do item %i", (movimento, id, esperado) => {
    expect(ids(moverNaLista(lista, id, movimento))).toEqual(esperado);
  });

  it.each([
    ["subir", 1],
    ["inicio", 1],
    ["descer", 4],
    ["fim", 4],
  ] as const)("%s nos limites (item %i) não faz nada", (movimento, id) => {
    expect(ids(moverNaLista(lista, id, movimento))).toEqual([1, 2, 3, 4]);
  });

  it("um id desconhecido não faz nada", () => {
    expect(ids(moverNaLista(lista, 99, "subir"))).toEqual([1, 2, 3, 4]);
  });

  it("não muda o argumento e conserva os objetos (outros campos intactos)", () => {
    const original = [
      { id: 1, nome: "a" },
      { id: 2, nome: "b" },
    ];
    const resultado = moverNaLista(original, 2, "subir");
    expect(original.map((item) => item.id)).toEqual([1, 2]);
    expect(resultado[0]).toBe(original[1]);
  });

  it("com um só item, todos os movimentos são nulos", () => {
    for (const m of ["subir", "descer", "inicio", "fim"] as const) {
      expect(ids(moverNaLista([{ id: 7 }], 7, m))).toEqual([7]);
    }
  });
});

describe("ordenarProdutosDaCategoria", () => {
  it("põe os produtos pela ordem dos ids, sem tocar nas outras categorias", () => {
    const { categorias } = ementaDeGestaoDeTeste();

    const nova = ordenarProdutosDaCategoria(categorias, 1, [104, 103, 102, 101]);

    expect(ids(nova[0]?.produtos ?? [])).toEqual([104, 103, 102, 101]);
    expect(nova[1]).toBe(categorias[1]);
  });

  it("os indisponíveis ficam na lista (a ordem é sempre completa)", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const nova = ordenarProdutosDaCategoria(categorias, 1, [103, 101, 102, 104]);
    expect(ids(nova[0]?.produtos ?? [])).toContain(103);
    expect(nova[0]?.produtos).toHaveLength(4);
  });
});

describe("reporDisponivel", () => {
  it("muda só o campo disponivel do item atual: o preço e o nome ficam", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    const atual = substituirProduto(
      categorias,
      produtoDeTeste({ id: 101, categoria_id: 1, nome: "Café forte", preco_cent: 130 }),
    );
    const novo = reporDisponivel(atual, 101, false);
    const cafe = novo[0]?.produtos.find((p) => p.id === 101);
    expect(cafe).toMatchObject({ nome: "Café forte", preco_cent: 130, disponivel: false });
    expect(atual[0]?.produtos.find((p) => p.id === 101)?.disponivel).toBe(true);
  });

  it("um id desconhecido deixa tudo igual", () => {
    const { categorias } = ementaDeGestaoDeTeste();
    expect(reporDisponivel(categorias, 99999, false)).toBe(categorias);
  });
});
