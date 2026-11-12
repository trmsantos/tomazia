/**
 * F4-01, secção 3.6 de `docs/ecras/F4-01.md` — `tempoComposto`, a frase "Podes
 * tentar outra vez daqui a…" que a F3-05 escreveu para o limite de envios e que
 * o login reutiliza para a conta bloqueada.
 *
 * Contrato (módulo novo, sai de `src/pages/publico/FolhaEnviarFoto.tsx`):
 *
 * ```ts
 * export function tempoComposto(segundos: number): string
 * ```
 *
 * **A regra mudou** (decisão do Tomás, F4-01): arredonda **sempre para cima**
 * acima dos 60 s. Antes, 60–119 s liam-se "1 minuto" com o botão ainda
 * bloqueado até aos 119 s — a frase dizia que faltava um minuto e faltavam dois.
 *
 * | segundos | frase                                              |
 * | -------- | -------------------------------------------------- |
 * | < 60     | …daqui a menos de um minuto.                       |
 * | 60       | …daqui a 1 minuto.                                 |
 * | > 60     | …daqui a {Math.ceil(segundos / 60)} minutos.       |
 *
 * **O que prova:** as fronteiras 59/60/61/119/120/121 e o máximo do login (900).
 * **O que deixa passar:** valores que não são números finitos e positivos — quem
 * chama decide antes de compor (regra 10: «não sei quanto falta» não é «falta
 * pouco»), e isso é do `Entrar` e da `FolhaEnviarFoto`, cada uma com o seu teste.
 */
import { describe, expect, it } from "vitest";

import { tempoComposto } from "./tempo-em-falta";

const PREFIXO = "Podes tentar outra vez daqui a";

describe("tempoComposto", () => {
  it.each([
    [0, "menos de um minuto"],
    [1, "menos de um minuto"],
    [30, "menos de um minuto"],
    [59, "menos de um minuto"],
    [60, "1 minuto"],
    [61, "2 minutos"],
    [90, "2 minutos"],
    [119, "2 minutos"],
    [120, "2 minutos"],
    [121, "3 minutos"],
    [125, "3 minutos"],
    [600, "10 minutos"],
    [900, "15 minutos"],
  ])("%i s lê-se «%s»", (segundos, esperado) => {
    expect(tempoComposto(segundos)).toBe(`${PREFIXO} ${esperado}.`);
  });

  it("nunca diz menos do que falta: o número de minutos nunca desce abaixo de segundos / 60", () => {
    for (let segundos = 61; segundos <= 900; segundos += 1) {
      const frase = tempoComposto(segundos);
      const minutos = Number(/ (\d+) minutos\.$/.exec(frase)?.[1]);
      expect(Number.isFinite(minutos), `${String(segundos)} s: «${frase}»`).toBe(true);
      expect(minutos * 60, `${String(segundos)} s: «${frase}»`).toBeGreaterThanOrEqual(segundos);
    }
  });
});
