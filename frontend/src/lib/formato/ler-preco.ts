/**
 * A função inversa de `formatarPreco` (F4-02, 4.3): do que o dono escreve para
 * cêntimos inteiros.
 *
 * Fica num ficheiro à parte de `preco.ts` de propósito: `preco.ts` é do pacote
 * público (Q-02) e o público nunca escreve um preço.
 *
 * **Aritmética de inteiros**, nunca `Math.round(x * 100)`: `0,29 * 100` dá
 * 28,999… e um preço de ementa não se arredonda. O texto parte-se na vírgula
 * (ou no ponto, que também se aceita) e juntam-se os algarismos.
 *
 * Quatro motivos de recusa, porque as frases que o ecrã diz são quatro: `abc`,
 * `6,505` e `21474836,48` não se corrigem da mesma maneira. O ponto é decimal:
 * `1.250` tem três casas e é um erro, nunca 1 250 € nem 1,25 € (um erro claro é
 * melhor do que um preço adivinhado).
 */
export type LeituraDePreco =
  | { ok: true; precoCent: number }
  | { ok: false; motivo: "vazio" | "invalido" | "decimais" | "demasiado_grande" };

/** O teto da base de dados: `2**31 - 1` cêntimos. */
const TETO_EM_CENTIMOS = 2 ** 31 - 1;

/** Algarismos de `21 474 836` euros: mais do que isto já não cabe no teto. */
const ALGARISMOS_DO_TETO_EM_EUROS = String(Math.floor(TETO_EM_CENTIMOS / 100)).length;

const FORMA_DE_UM_PRECO = /^(\d+)(?:[.,](\d*))?$/;

export function lerPreco(texto: string): LeituraDePreco {
  let limpo = texto.trim();
  // O símbolo no fim ignora-se, com os espaços (também o inquebrável) à volta.
  if (limpo.endsWith("€")) limpo = limpo.slice(0, -1).trim();
  if (limpo === "") return { ok: false, motivo: "vazio" };

  const partes = FORMA_DE_UM_PRECO.exec(limpo);
  if (partes === null) return { ok: false, motivo: "invalido" };

  const euros = (partes[1] ?? "").replace(/^0+(?=\d)/, "");
  const decimais = partes[2] ?? "";
  if (decimais.length > 2) return { ok: false, motivo: "decimais" };

  // Comprimento antes de somar: um número com vinte algarismos já não é um
  // inteiro seguro, e a comparação por tamanho não perde precisão nenhuma.
  if (euros.length > ALGARISMOS_DO_TETO_EM_EUROS) {
    return { ok: false, motivo: "demasiado_grande" };
  }

  const precoCent = Number(euros) * 100 + Number(decimais.padEnd(2, "0"));
  if (precoCent > TETO_EM_CENTIMOS) return { ok: false, motivo: "demasiado_grande" };
  return { ok: true, precoCent };
}

/**
 * O valor com que a edição abre (F4-02, 4.2): euros e cêntimos sem símbolo,
 * vírgula decimal e **sem ponto de milhares** (`650` → «6,50», `600` → «6,00»,
 * `120000` → «1200,00»). O `0` abre como «0». Um valor que não seja um inteiro
 * maior ou igual a zero abre vazio: não se inventa um preço.
 */
export function precoParaCampo(precoCent: number): string {
  if (!Number.isInteger(precoCent) || precoCent < 0) return "";
  if (precoCent === 0) return "0";
  const euros = Math.floor(precoCent / 100);
  return `${String(euros)},${String(precoCent % 100).padStart(2, "0")}`;
}
