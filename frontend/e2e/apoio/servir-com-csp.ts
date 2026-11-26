import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { URL_PUBLICA_DE_TESTE } from "../../src/testes/marca";

/**
 * Servir **o build de produção** com **a CSP de produção** (F4-04, decisão D6).
 *
 * O servidor de desenvolvimento do Vite não serve para provar a CSP: injeta o CSS por `<style>`
 * criados em JavaScript e um script inline do React Refresh, e com `script-src 'self'; style-src
 * 'self'` a página nem arranca (é por isso que `componentes.spec.ts` só aperta a `style-src-attr`).
 * Aqui compila-se o frontend (`vite build`, para uma pasta temporária: não mexe no `dist/`) e
 * serve-se essa pasta com **exatamente** o cabeçalho `Content-Security-Policy` de
 * `deploy/htaccess.exemplo`, lido do ficheiro **em cada corrida** (uma CSP copiada para aqui
 * divergia sem ninguém dar por isso), mais o `nosniff` que o Apache também põe.
 *
 * As rotas de `/api` não existem neste servidor: os testes interceptam-nas com `page.route`
 * (os padrões `**\/api/...` casam com qualquer origem), como em todos os e2e.
 *
 * Regra 10: **não conseguir ler a CSP ou não conseguir compilar não é «a CSP deixa passar»**.
 * `cspDeProducao()` e `construirEServir()` lançam, com a razão, e o teste que as usa falha em vez
 * de passar sem ter olhado.
 */
const RAIZ_FRONTEND = fileURLToPath(new URL("../..", import.meta.url));
const HTACCESS = fileURLToPath(new URL("../../../deploy/htaccess.exemplo", import.meta.url));

/** O valor do cabeçalho `Content-Security-Policy`, lido de `deploy/htaccess.exemplo`. */
export function cspDeProducao(): string {
  if (!existsSync(HTACCESS)) {
    throw new Error(
      `Não consegui ler a CSP de produção: ${HTACCESS} não existe. Sem ela este teste não ` +
        "verifica nada (e «não procurei» não é «a CSP deixa passar»).",
    );
  }
  const texto = readFileSync(HTACCESS, "utf-8");
  const linhas = texto
    .split("\n")
    .filter((linha) => /^\s*Header\s+always\s+set\s+Content-Security-Policy\s/.test(linha));
  if (linhas.length !== 1) {
    throw new Error(
      `Não consegui ler a CSP de produção: esperava uma só linha \`Header always set ` +
        `Content-Security-Policy\` em ${HTACCESS} e encontrei ${String(linhas.length)}.`,
    );
  }
  const valor = /Content-Security-Policy\s+"([^"]+)"/.exec(linhas[0] ?? "")?.[1];
  if (valor === undefined || !/img-src\s+'self'\s+data:/.test(valor)) {
    throw new Error(
      "Não consegui ler a CSP de produção como a spec a descreve: falta `img-src 'self' data:` " +
        `na linha de ${HTACCESS}. Se a CSP mudou de propósito, é uma decisão para um ADR.`,
    );
  }
  return valor;
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export type ServidorComCsp = {
  /** `http://127.0.0.1:<porta>` */
  origem: string;
  csp: string;
  fechar: () => Promise<void>;
};

/** `vite build` para uma pasta temporária e um servidor estático com a CSP de produção. */
export async function construirEServir(): Promise<ServidorComCsp> {
  const csp = cspDeProducao();
  const pasta = mkdtempSync(join(tmpdir(), "tomazia-csp-"));
  const vite = join(RAIZ_FRONTEND, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) {
    throw new Error(`Não consegui compilar o frontend: ${vite} não existe (corre \`npm ci\`).`);
  }
  try {
    execFileSync(process.execPath, [vite, "build", "--outDir", pasta, "--emptyOutDir"], {
      cwd: RAIZ_FRONTEND,
      env: { ...process.env, NODE_ENV: "production", VITE_URL_PUBLICA: URL_PUBLICA_DE_TESTE },
      stdio: "pipe",
      timeout: 180_000,
    });
  } catch (erro) {
    rmSync(pasta, { recursive: true, force: true });
    const saida =
      erro instanceof Error && "stderr" in erro ? String((erro as { stderr: unknown }).stderr) : "";
    throw new Error(`Não consegui compilar o frontend para o teste da CSP:\n${saida}`);
  }
  if (!existsSync(join(pasta, "index.html"))) {
    throw new Error("O `vite build` acabou mas não deixou um index.html: nada para servir.");
  }

  const servidor: Server = createServer((pedido, resposta) => {
    const caminho = decodeURIComponent((pedido.url ?? "/").split("?")[0] ?? "/");
    const candidato = normalize(join(pasta, caminho));
    const dentro = candidato === pasta || candidato.startsWith(pasta + sep);
    const eFicheiro = dentro && existsSync(candidato) && statSync(candidato).isFile();
    // Fallback de SPA: `/gestao/galeria` devolve o index.html, como o `.htaccess` faz.
    const ficheiro = eFicheiro ? candidato : join(pasta, "index.html");
    resposta.setHeader("Content-Type", TIPOS[extname(ficheiro)] ?? "application/octet-stream");
    resposta.setHeader("Content-Security-Policy", csp);
    resposta.setHeader("X-Content-Type-Options", "nosniff");
    resposta.setHeader("Cache-Control", "no-store");
    resposta.end(readFileSync(ficheiro));
  });
  await new Promise<void>((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(0, "127.0.0.1", resolver);
  });
  const { port } = servidor.address() as AddressInfo;

  return {
    origem: `http://127.0.0.1:${String(port)}`,
    csp,
    fechar: async () => {
      servidor.closeAllConnections();
      await new Promise<void>((resolver) => {
        servidor.close(() => {
          resolver();
        });
      });
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}
