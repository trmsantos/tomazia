/**
 * O fuso do **aparelho** (o do processo), a variar dentro de um teste.
 *
 * Movida de `src/lib/formato/data-do-evento.test.ts` (F4-03, plano 4.3) para as
 * duas suites a partilharem: a da data pública e a das horas de Lisboa da gestão.
 *
 * O guarda é a regra 10 em pessoa: se a troca de `TZ` não pegar — e houve versões
 * do Node em que não pegava a meio do processo —, os casos corriam em Lisboa e
 * passavam todos, a dizer que o código é imune ao fuso do aparelho quando ninguém
 * chegou a sair de Lisboa. «Não consegui mudar o fuso» tem de se ler diferente de
 * «está certo».
 *
 * Só para testes; nada em produção o importa.
 */
import { expect } from "vitest";

/**
 * Os cinco fusos do aparelho da F4-03: o do bar, um com uma hora de diferença, um
 * sem horário de verão (−3 h), um com +9 h (muda o dia) e o UTC.
 */
export const FUSOS_DO_APARELHO = [
  "Europe/Lisbon",
  "Atlantic/Azores",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "UTC",
] as const;

export function comOFusoDoAparelhoEm(fuso: string, correr: () => void): void {
  const anterior = process.env.TZ;
  process.env.TZ = fuso;
  try {
    expect(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `não consegui pôr o fuso do processo em ${fuso}: este caso não verificou nada`,
    ).toBe(fuso);
    correr();
  } finally {
    process.env.TZ = anterior;
  }
}
