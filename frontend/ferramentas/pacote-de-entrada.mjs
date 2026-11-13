/**
 * O pacote de entrada (F4-01, Q-02): os `.js` que o `index.html` construído
 * carrega para ver a página pública — o `<script type="module" src>` e cada
 * `<link rel="modulepreload" href>`, por esta ordem e sem repetições.
 *
 * Fica de fora tudo o que é carregado a pedido (o chunk da gestão). Não se usa
 * o manifest do Vite porque iria parar a `dist/`, e o `deploy/montar.sh` copia
 * o `dist` inteiro.
 *
 * Falha alto (regra 10 do CLAUDE.md): «não consegui ler» nunca devolve uma
 * lista vazia, porque o `.size-limit.js` usa este módulo para calcular o
 * `path` e uma lista vazia mediria zero bytes e passaria.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Os atributos de uma etiqueta, por nome (aspas simples ou duplas). */
function atributos(etiqueta) {
  const resultado = {};
  for (const m of etiqueta.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    resultado[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return resultado;
}

/**
 * @param {string} pastaDoBuild
 * @returns {string[]} caminhos absolutos
 */
export function pacoteDeEntrada(pastaDoBuild) {
  const pasta = resolve(pastaDoBuild);
  const indice = join(pasta, "index.html");
  if (!existsSync(indice)) {
    throw new Error(`pacote-de-entrada: não existe ${indice} — construiu-se o frontend?`);
  }
  const html = readFileSync(indice, "utf-8");

  const scripts = [];
  const precarregados = [];
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const a = atributos(m[0]);
    if (m[1].toLowerCase() === "script") {
      if (a.type === "module" && a.src) scripts.push(a.src);
    } else if (a.rel?.split(/\s+/).includes("modulepreload") && a.href) {
      precarregados.push(a.href);
    }
  }
  if (scripts.length === 0) {
    throw new Error(`pacote-de-entrada: ${indice} não tem nenhum <script type="module" src>`);
  }

  const resultado = [];
  for (const referencia of [...scripts, ...precarregados]) {
    const absoluto = resolve(
      pasta,
      "." + (referencia.startsWith("/") ? referencia : `/${referencia}`),
    );
    if (!absoluto.startsWith(pasta + sep)) {
      throw new Error(`pacote-de-entrada: ${referencia} sai da pasta do build`);
    }
    if (!existsSync(absoluto)) {
      throw new Error(
        `pacote-de-entrada: ${referencia} está no index.html mas não existe em ${absoluto}`,
      );
    }
    if (!resultado.includes(absoluto)) resultado.push(absoluto);
  }
  return resultado;
}
