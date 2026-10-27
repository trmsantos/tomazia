/**
 * Percorrer a árvore de ficheiros, com o guarda da regra 10 incluído.
 *
 * Três testes desta tarefa (cores, textos PT-PT e estilos inline) varrem o
 * código-fonte em disco à procura de um padrão proibido. Todos partilham o
 * mesmo modo de falha silenciosa: se o caminho da raiz estiver errado, ou
 * se um filtro cortar a mais, a varredura devolve zero ficheiros, encontra
 * zero violações e **passa** — exactamente a falha que o `CLAUDE.md`
 * descreve na regra 10 e que este projeto já apanhou sete vezes em revisão,
 * nunca por um teste.
 *
 * Por isso a função que lista ficheiros vem acompanhada de
 * `exigirSentinelas`, e a mensagem de erro dela é deliberadamente diferente
 * da mensagem de "encontrei violações": quem lê o resultado tem de
 * conseguir distinguir "não encontrei nada" de "não consegui procurar".
 *
 * Este ficheiro é só para testes (nada em `src/` de produção o importa) e
 * é ele próprio testado em `src/styles/cores-so-nos-tokens.test.ts`, na
 * secção "autoteste do varrimento".
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** `frontend/` — a pasta acima de `src/`. */
export const RAIZ_FRONTEND = fileURLToPath(new URL("../..", import.meta.url));

/** A raiz do repositório, onde vive `docs/`. */
export const RAIZ_REPOSITORIO = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Pastas que nunca contêm código-fonte nosso. `src/lib/api` **não** está
 * aqui: é gerado, mas cada teste decide se o ignora (o das cores ignora-o;
 * o do S-13 varre-o de propósito).
 */
export const PASTAS_IGNORADAS = [
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".impeccable",
  "playwright-report",
  "test-results",
];

type OpcoesDeVarrimento = {
  /** Extensões em minúsculas, com ponto: `[".css", ".ts", ".tsx"]`. */
  extensoes: string[];
  pastasIgnoradas?: string[];
};

/**
 * Lista, recursivamente e por ordem alfabética, os ficheiros de `raiz` com
 * uma das `extensoes`. Devolve caminhos absolutos.
 *
 * Duas lições já pagas pelo `src/lib/seguranca/s13.test.ts`, repetidas aqui
 * de propósito:
 *  - a comparação da extensão é feita em minúsculas, porque num sistema de
 *    ficheiros indiferente a maiúsculas (o macOS onde isto se desenvolve)
 *    `Botao.TSX` e `Botao.tsx` são o mesmo ficheiro para o bundler;
 *  - uma pasta que seja ligação simbólica dá `isDirectory() === false` na
 *    entrada de `readdir`, e sem o `statSync` dedicado ficaria invisível —
 *    o Vite segue ligações simbólicas a resolver módulos, portanto é código
 *    que corre a sério. `pastasVisitadas` evita a recursão infinita de uma
 *    ligação que aponte para um antepassado.
 */
export function listarFicheiros(
  raiz: string,
  opcoes: OpcoesDeVarrimento,
  pastasVisitadas: Set<string> = new Set(),
): string[] {
  const pastasIgnoradas = opcoes.pastasIgnoradas ?? PASTAS_IGNORADAS;
  const extensoes = opcoes.extensoes.map((extensao) => extensao.toLowerCase());

  let raizReal: string;
  try {
    raizReal = realpathSync(raiz);
  } catch {
    // Pasta inexistente: devolve vazio. Quem chama tem de ter sentinelas —
    // é o `exigirSentinelas` que transforma isto num erro legível.
    return [];
  }
  if (pastasVisitadas.has(raizReal)) return [];
  pastasVisitadas.add(raizReal);

  const ficheiros: string[] = [];
  const entradas = [...readdirSync(raiz, { withFileTypes: true })].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const entrada of entradas) {
    const caminho = join(raiz, entrada.name);

    if (entrada.isDirectory()) {
      if (pastasIgnoradas.includes(entrada.name)) continue;
      ficheiros.push(...listarFicheiros(caminho, opcoes, pastasVisitadas));
      continue;
    }

    if (entrada.isSymbolicLink() && statSync(caminho).isDirectory()) {
      if (pastasIgnoradas.includes(entrada.name)) continue;
      ficheiros.push(...listarFicheiros(caminho, opcoes, pastasVisitadas));
      continue;
    }

    if (extensoes.some((extensao) => entrada.name.toLowerCase().endsWith(extensao))) {
      ficheiros.push(caminho);
    }
  }

  return ficheiros;
}

/** Caminho relativo a `frontend/`, sempre com `/`, para mensagens estáveis. */
export function caminhoRelativo(caminhoAbsoluto: string, raiz: string = RAIZ_FRONTEND): string {
  return relative(raiz, caminhoAbsoluto).split(sep).join("/");
}

/**
 * Guarda da regra 10. Falha se a lista estiver vazia ou se faltar alguma
 * sentinela — com uma mensagem que **não** se pode confundir com a de
 * "não encontrei violações".
 *
 * As sentinelas são caminhos relativos a `frontend/`, com `/`.
 */
export function exigirSentinelas(
  ficheiros: string[],
  sentinelas: string[],
  contexto: string,
  raiz: string = RAIZ_FRONTEND,
): void {
  const relativos = new Set(ficheiros.map((ficheiro) => caminhoRelativo(ficheiro, raiz)));

  if (relativos.size === 0) {
    throw new Error(
      `Não consegui percorrer a árvore (${contexto}): a varredura devolveu zero ficheiros. ` +
        "Isto não quer dizer que está tudo limpo — quer dizer que não procurei em lado nenhum. " +
        `Raiz usada: ${raiz}`,
    );
  }

  const emFalta = sentinelas.filter((sentinela) => !relativos.has(sentinela));
  if (emFalta.length > 0) {
    throw new Error(
      `Não consegui percorrer a árvore (${contexto}): faltam ficheiros-sentinela, ` +
        "portanto a varredura não cobriu o que devia cobrir e um resultado limpo não prova nada.\n" +
        emFalta.map((sentinela) => `  - em falta: ${sentinela}`).join("\n") +
        `\n(${relativos.size} ficheiros vistos a partir de ${raiz})`,
    );
  }
}

/**
 * Lê um ficheiro de texto. Se não conseguir, falha com "não consegui ler" —
 * de novo, uma mensagem distinta de "o conteúdo está errado".
 */
export function lerTexto(caminho: string, descricao: string): string {
  try {
    return readFileSync(caminho, "utf-8");
  } catch (erro) {
    throw new Error(
      `Não consegui ler ${descricao} (${caminho}). ` +
        "Isto é uma falha de leitura, não uma falha de conteúdo: " +
        `${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }
}

/** Divide um texto em linhas e devolve os números (1-indexados) que correspondem. */
export function linhasQueCorrespondem(texto: string, teste: (linha: string) => boolean): number[] {
  const numeros: number[] = [];
  texto.split("\n").forEach((linha, indice) => {
    if (teste(linha)) numeros.push(indice + 1);
  });
  return numeros;
}
