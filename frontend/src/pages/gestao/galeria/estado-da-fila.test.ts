/**
 * F4-04, plano 7.1 e spec 5.2, 9.4 e 12.3 — o estado puro da fila, `estado-da-fila.ts`.
 *
 * Contrato (nenhuma função lê o relógio nem o DOM; a fila é uma lista **na ordem do servidor**,
 * a mais antiga primeiro, que o frontend nunca reordena; nenhuma função muda o que recebe):
 *
 * ```ts
 * import type { FotoPendente } from "../../../lib/api/gestao-fotos";
 * export const INTERVALO_CONTRA_DUPLO_TOQUE_MS = 700;                      // spec 5.2
 * export function atual(fila: readonly FotoPendente[]): FotoPendente | null;     // a primeira
 * export function seguinte(fila: readonly FotoPendente[]): FotoPendente | null;  // a segunda
 * export function retirar(fila: readonly FotoPendente[], id: number): FotoPendente[];
 * export function substituir(
 *   local: readonly FotoPendente[],
 *   recebida: readonly FotoPendente[],
 * ): FotoPendente[];
 * export function contagem(fila: readonly FotoPendente[]): number;
 * export type Pedido = "aprovar" | "rejeitar";
 * export type Desfecho = "nada" | "aprovada" | "rejeitada";
 * export function resolverDesfecho(pedido: Pedido, naFila: boolean, naGaleria: boolean): Desfecho;
 * ```
 *
 * `substituir(local, recebida)` é o que a recarga silenciosa (5.5) faz: o que **ainda está
 * pendente** mantém o lugar e a ordem que tinha na fila local (a foto que o dono tem à frente
 * não muda debaixo do dedo) e o que é **novo** (não estava na local) entra **no fim, pela ordem
 * do servidor**; o que já não está pendente sai.
 *
 * `resolverDesfecho` é o resolvedor da regra 10 para o 409, o 404 e o «sem resposta»: o que
 * aconteceu à foto, perguntado à fila (`naFila`) e à galeria pública (`naGaleria`). Na fila →
 * `"nada"` (o pedido não chegou). Fora da fila e na galeria → `"aprovada"`. Fora das duas →
 * `"rejeitada"`. O `pedido` não muda o resultado (diz o que **aconteceu**, não o que o dono quis);
 * quem chama compara os dois para escolher a frase.
 *
 * **Deixa passar:** o intervalo de 700 ms a correr (componente, relógio simulado).
 */
import { describe, expect, it } from "vitest";

import { filaDeTeste, fotoPendenteDeTeste, type FotoPendente } from "../../../testes/gestao";
import {
  INTERVALO_CONTRA_DUPLO_TOQUE_MS,
  atual,
  contagem,
  resolverDesfecho,
  retirar,
  seguinte,
  substituir,
} from "./estado-da-fila";

const ids = (fila: readonly FotoPendente[]): number[] => fila.map((f) => f.id);

describe("INTERVALO_CONTRA_DUPLO_TOQUE_MS", () => {
  it("é 700 (spec 5.2): uma constante, num sítio só", () => {
    expect(INTERVALO_CONTRA_DUPLO_TOQUE_MS).toBe(700);
  });
});

describe("atual e seguinte", () => {
  it("fila vazia: não há atual nem seguinte (null, nunca undefined)", () => {
    expect(atual([])).toBeNull();
    expect(seguinte([])).toBeNull();
  });

  it("uma foto: é a atual e não há seguinte", () => {
    const [a] = filaDeTeste(1);
    expect(atual([a as FotoPendente])).toBe(a);
    expect(seguinte([a as FotoPendente])).toBeNull();
  });

  it("duas fotos: a primeira é a atual, a segunda a seguinte", () => {
    const [a, b] = filaDeTeste(2) as [FotoPendente, FotoPendente];
    expect(atual([a, b])).toBe(a);
    expect(seguinte([a, b])).toBe(b);
  });

  it("três fotos: só a primeira e a segunda contam (a terceira não é pré-carregada)", () => {
    const [a, b, c] = filaDeTeste(3) as [FotoPendente, FotoPendente, FotoPendente];
    expect(atual([a, b, c])).toBe(a);
    expect(seguinte([a, b, c])).toBe(b);
  });

  it("não reordena: a ordem é a do servidor, mesmo com ids e datas fora de ordem", () => {
    const x = fotoPendenteDeTeste({ id: 9, criada_em: "2026-11-02T09:00:00Z" });
    const y = fotoPendenteDeTeste({ id: 3, criada_em: "2026-11-01T09:00:00Z" });
    expect(atual([x, y])).toBe(x);
    expect(seguinte([x, y])).toBe(y);
  });
});

describe("retirar", () => {
  it("retirar a atual: a seguinte passa a atual", () => {
    const fila = filaDeTeste(3);
    const depois = retirar(fila, 101);
    expect(ids(depois)).toEqual([102, 103]);
    expect(atual(depois)?.id).toBe(102);
  });

  it("retirar uma que não é a atual mantém a ordem das outras", () => {
    expect(ids(retirar(filaDeTeste(3), 102))).toEqual([101, 103]);
    expect(ids(retirar(filaDeTeste(3), 103))).toEqual([101, 102]);
  });

  it("retirar um id que não está: fica igual (os mesmos objetos)", () => {
    const fila = filaDeTeste(3);
    const depois = retirar(fila, 999);
    expect(depois).toEqual(fila);
    expect(depois[0]).toBe(fila[0]);
  });

  it("retirar a última deixa a fila vazia", () => {
    expect(retirar(filaDeTeste(1), 101)).toEqual([]);
  });

  it("não muda a lista que recebe", () => {
    const fila = filaDeTeste(3);
    retirar(fila, 101);
    expect(ids(fila)).toEqual([101, 102, 103]);
  });
});

describe("substituir (a recarga silenciosa, 5.5)", () => {
  it("a mesma lista: fica igual, com a atual no mesmo sítio", () => {
    const local = filaDeTeste(3);
    const r = substituir(local, filaDeTeste(3));
    expect(ids(r)).toEqual([101, 102, 103]);
    expect(atual(r)?.id).toBe(101);
  });

  it("a atual continua pendente e há fotos novas: ficam no fim, pela ordem do servidor", () => {
    const local = filaDeTeste(2);
    const r = substituir(local, filaDeTeste(5));
    expect(ids(r)).toEqual([101, 102, 103, 104, 105]);
    expect(atual(r)?.id).toBe(101);
  });

  it("a atual já não está (moderada noutro aparelho): a seguinte passa a atual", () => {
    const local = filaDeTeste(3);
    const recebida = filaDeTeste(3).slice(1); // 102, 103
    const r = substituir(local, recebida);
    expect(ids(r)).toEqual([102, 103]);
    expect(atual(r)?.id).toBe(102);
  });

  it("uma do meio saiu: sai da fila e as outras mantêm a ordem", () => {
    const r = substituir(filaDeTeste(3), [filaDeTeste(3)[0], filaDeTeste(3)[2]] as FotoPendente[]);
    expect(ids(r)).toEqual([101, 103]);
  });

  it("uma nova que o servidor põe antes das que já havia entra NO FIM (a atual não muda debaixo do dedo)", () => {
    const local = filaDeTeste(3).slice(1); // 102, 103
    const nova = fotoPendenteDeTeste({ id: 100, criada_em: "2026-10-01T09:00:00Z" });
    const r = substituir(local, [nova, ...filaDeTeste(3).slice(1)]);
    expect(atual(r)?.id).toBe(102);
    expect(ids(r)).toEqual([102, 103, 100]);
  });

  it("a recebida vazia esvazia a fila (quem chama é que decide se mostra o vazio)", () => {
    expect(substituir(filaDeTeste(3), [])).toEqual([]);
  });

  it("a local vazia fica com a recebida inteira, na ordem do servidor", () => {
    expect(ids(substituir([], filaDeTeste(3)))).toEqual([101, 102, 103]);
  });

  it("não muda nenhuma das duas listas que recebe", () => {
    const local = filaDeTeste(2);
    const recebida = filaDeTeste(4);
    substituir(local, recebida);
    expect(ids(local)).toEqual([101, 102]);
    expect(ids(recebida)).toEqual([101, 102, 103, 104]);
  });
});

describe("contagem", () => {
  it.each([0, 1, 2, 3, 5])("%i fotos → %i", (n) => {
    expect(contagem(filaDeTeste(n))).toBe(n);
  });
});

describe("resolverDesfecho (regra 10: o que aconteceu, perguntado à fila e à galeria)", () => {
  const PEDIDOS = ["aprovar", "rejeitar"] as const;

  it.each(PEDIDOS)("%s — na fila: nada aconteceu (o pedido não chegou)", (pedido) => {
    expect(resolverDesfecho(pedido, true, false)).toBe("nada");
  });

  it.each(PEDIDOS)("%s — fora da fila e na galeria: ficou aprovada", (pedido) => {
    expect(resolverDesfecho(pedido, false, true)).toBe("aprovada");
  });

  it.each(PEDIDOS)("%s — fora da fila e fora da galeria: ficou rejeitada", (pedido) => {
    expect(resolverDesfecho(pedido, false, false)).toBe("rejeitada");
  });

  it.each(PEDIDOS)(
    "%s — na fila e na galeria é impossível; na fila manda: nunca se conclui «aprovada» por uma galeria velha",
    (pedido) => {
      expect(resolverDesfecho(pedido, true, true)).toBe("nada");
    },
  );

  it("o resultado não depende do que o dono pediu (quem chama é que compara)", () => {
    for (const [naFila, naGaleria] of [
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      expect(resolverDesfecho("aprovar", naFila, naGaleria)).toBe(
        resolverDesfecho("rejeitar", naFila, naGaleria),
      );
    }
  });
});
