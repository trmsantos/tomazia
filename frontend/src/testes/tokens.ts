/**
 * Ler o `src/styles/tokens.css` como o browser o leria.
 *
 * Partilhado entre os testes Vitest (que fazem a conta do contraste sem
 * abrir browser nenhum) e os testes Playwright (que precisam de saber qual
 * é o hex do dourado para confirmar que ele não aparece sobre o creme).
 * Uma só implementação, para os dois lados não poderem discordar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_DO_FRONTEND = fileURLToPath(new URL("../..", import.meta.url));
export const CAMINHO_DOS_TOKENS = join(RAIZ_DO_FRONTEND, "src/styles/tokens.css");

/** Os âmbitos de superfície da secção 2 de `docs/ecras/F3-01.md`. */
export const AMBITOS = [".superficie-escura", ".superficie-painel", ".superficie-creme"];
// R-01 Task 4 acrescenta ".superficie-papel" e ".superficie-destaque", com os tokens.

/** Declarações por seletor. Um seletor composto (`:root, .x`) conta para os dois. */
export function lerBlocos(css: string): Map<string, Map<string, string>> {
  const blocos = new Map<string, Map<string, string>>();
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const bloco of semComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seletores = (bloco[1] ?? "").split(",").map((seletor) => seletor.trim());
    const corpo = bloco[2] ?? "";
    const declaracoes = new Map<string, string>();
    for (const declaracao of corpo.split(";")) {
      const separador = declaracao.indexOf(":");
      if (separador === -1) continue;
      const nome = declaracao.slice(0, separador).trim();
      const valor = declaracao.slice(separador + 1).trim();
      if (nome.startsWith("--")) declaracoes.set(nome, valor);
    }
    for (const seletor of seletores) {
      if (seletor.length === 0) continue;
      const existente = blocos.get(seletor) ?? new Map<string, string>();
      for (const [nome, valor] of declaracoes) existente.set(nome, valor);
      blocos.set(seletor, existente);
    }
  }
  return blocos;
}

/** Hex de 3 ou 6 dígitos para `#rrggbb` minúsculo; `null` se tiver alfa ou não for hex. */
function normalizarHex(cor: string): string | null {
  const curto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(cor);
  if (curto)
    return `#${curto[1]}${curto[1]}${curto[2]}${curto[2]}${curto[3]}${curto[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(cor)) return cor.toLowerCase();
  return null;
}

/**
 * `color-mix(in srgb, a p%, b)` como o CSS Color 5 o define: por canal,
 * `p% de a + (100 − p)% de b`, arredondado ao inteiro. Só aceita cores
 * opacas (`#rrggbb`); com alfa não há `#rrggbb` que o represente.
 */
export function misturarEmSrgb(a: string, b: string, percentagem: number): string {
  const corA = normalizarHex(a);
  const corB = normalizarHex(b);
  if (corA === null || corB === null) {
    throw new Error(`Não consegui misturar ${a} com ${b}: só aceito cores #rrggbb opacas.`);
  }
  const p = percentagem / 100;
  let resultado = "#";
  for (const inicio of [1, 3, 5]) {
    const canalA = Number.parseInt(corA.slice(inicio, inicio + 2), 16);
    const canalB = Number.parseInt(corB.slice(inicio, inicio + 2), 16);
    const canal = Math.round(canalA * p + canalB * (1 - p));
    resultado += canal.toString(16).padStart(2, "0");
  }
  return resultado;
}

/** O valor tal como está escrito no CSS, no âmbito e depois em `:root`; `undefined` se não existir. */
export function valorBruto(
  blocos: Map<string, Map<string, string>>,
  ambito: string,
  nome: string,
): string | undefined {
  return blocos.get(ambito)?.get(nome) ?? blocos.get(":root")?.get(nome);
}

function resolverOperando(
  blocos: Map<string, Map<string, string>>,
  ambito: string,
  operando: string,
  profundidade: number,
): string | null {
  const texto = operando.trim();
  if (texto.toLowerCase() === "white") return "#ffffff";
  const referencia = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(texto);
  if (referencia?.[1]) return resolver(blocos, ambito, referencia[1], profundidade + 1);
  return normalizarHex(texto);
}

/**
 * Resolve `nome` dentro de `ambito`, caindo para `:root`, como faria o
 * browser. Segue cadeias de `var()` e `color-mix(in srgb, …)` com operandos
 * `var()`, hex ou `white`. Devolve `null` quando a variável não existe ou
 * quando o valor não é uma cor opaca que se saiba calcular (`transparent`,
 * por exemplo, tem alfa) — quem chama tem de distinguir isso de "o contraste
 * chumbou", e de "não existe" (`valorBruto` diz qual dos dois é).
 */
export function resolver(
  blocos: Map<string, Map<string, string>>,
  ambito: string,
  nome: string,
  profundidade = 0,
): string | null {
  if (profundidade > 10) return null;
  const valor = valorBruto(blocos, ambito, nome);
  if (valor === undefined) return null;

  const referencia = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(valor);
  if (referencia?.[1]) return resolver(blocos, ambito, referencia[1], profundidade + 1);

  const mistura = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+?)\s*\)$/i.exec(
    valor,
  );
  if (mistura?.[1] && mistura[2] && mistura[3]) {
    const a = resolverOperando(blocos, ambito, mistura[1], profundidade);
    const b = resolverOperando(blocos, ambito, mistura[3], profundidade);
    if (a === null || b === null) return null;
    return misturarEmSrgb(a, b, Number.parseFloat(mistura[2]));
  }

  if (/^#[0-9a-f]{3,8}$/i.test(valor)) return valor;
  return null;
}

/**
 * Lê os tokens do disco, com o guarda da regra 10: um `tokens.css` que não
 * se consiga ler, ou sem os âmbitos, falha a dizer isso — nunca devolve um
 * mapa vazio que faria os testes seguintes passar sem verificar nada.
 */
export function blocosDosTokens(): Map<string, Map<string, string>> {
  let css: string;
  try {
    css = readFileSync(CAMINHO_DOS_TOKENS, "utf-8");
  } catch (erro) {
    throw new Error(
      `Não consegui ler ${CAMINHO_DOS_TOKENS}: ` +
        `${erro instanceof Error ? erro.message : String(erro)}. ` +
        "Isto é uma falha de leitura, não um contraste insuficiente.",
    );
  }

  const blocos = lerBlocos(css);
  if (!blocos.has(":root")) {
    throw new Error(
      "Não consegui ler o tokens.css: não encontrei um bloco `:root`. " +
        "Isto é uma falha de leitura, não um contraste insuficiente.",
    );
  }
  for (const ambito of AMBITOS) {
    if (!blocos.has(ambito)) {
      throw new Error(
        `Não consegui ler o tokens.css: falta o âmbito \`${ambito}\`. ` +
          "Os três âmbitos da secção 2 de docs/ecras/F3-01.md têm de existir.",
      );
    }
  }
  return blocos;
}
