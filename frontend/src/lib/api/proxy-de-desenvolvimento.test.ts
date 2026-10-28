// @vitest-environment node
/**
 * F2-09 — o proxy de `/api` em desenvolvimento, lido da configuração real.
 *
 * O cliente usa uma base relativa (`CAMINHO_BASE = "/api"`) porque a CSP
 * de produção serve `connect-src 'self'` e uma origem absoluta seria
 * bloqueada só no servidor (ADR 0008). Em desenvolvimento, quem faz essa
 * base chegar ao backend é o `proxy` do `vite.config.ts` — e, sobretudo,
 * o `rewrite` que tira o prefixo: o backend declara as rotas **sem**
 * `/api` (é o Passenger que o acrescenta em produção, via `SCRIPT_NAME`),
 * por isso um proxy sem `rewrite` mandava `GET /api/ementa` ao uvicorn e
 * recebia 404 em tudo.
 *
 * Por isso este teste não verifica «há um proxy»: chama a função de
 * `rewrite` da configuração a sério com o caminho que o cliente constrói,
 * e exige o caminho que o backend declara. É a única ligação escrita
 * entre os dois ficheiros, e o modo de falha dela — tudo a 404 no
 * desenvolvimento — custa meia hora a cada pessoa que lhe bate.
 *
 * **O que deixa passar:** não arranca o Vite nem o uvicorn, por isso não
 * prova que a porta 8070 está certa para lá do que o `CLAUDE.md` da raiz
 * documenta.
 */
import { describe, expect, it } from "vitest";

import configuracaoDoVite from "../../../vite.config";
import { CAMINHO_BASE } from "./cliente";

/** A porta que o `CLAUDE.md` da raiz documenta para o uvicorn local. */
const ALVO = "http://127.0.0.1:8070";

async function proxyDeDesenvolvimento() {
  const configuracao = await configuracaoDoVite({ command: "serve", mode: "development" });
  const proxy = configuracao.server?.proxy;
  if (proxy === undefined) {
    throw new Error(
      "o vite.config.ts não declara `server.proxy`: em desenvolvimento, `/api/…` não chega " +
        "a lado nenhum e todos os ecrãs ficam sem dados.",
    );
  }

  const entrada = proxy[CAMINHO_BASE];
  if (entrada === undefined || typeof entrada === "string") {
    throw new Error(
      `o vite.config.ts não declara uma entrada de proxy com opções para «${CAMINHO_BASE}» ` +
        "(encontrei: " +
        JSON.stringify(Object.keys(proxy)) +
        "). Sem opções não há `rewrite`, e sem `rewrite` o backend responde 404 a tudo.",
    );
  }
  return entrada;
}

describe("o proxy de /api em desenvolvimento", () => {
  it("aponta para o uvicorn local da porta 8070", async () => {
    const entrada = await proxyDeDesenvolvimento();

    expect(entrada.target).toBe(ALVO);
    expect(
      String(entrada.target),
      "`localhost` resolve primeiro para ::1 num sistema com IPv6, onde o uvicorn não está",
    ).not.toContain("localhost");
  });

  it("o rewrite tira o /api, porque o backend declara as rotas sem ele", async () => {
    const entrada = await proxyDeDesenvolvimento();
    const reescrever = entrada.rewrite;

    if (typeof reescrever !== "function") {
      throw new Error(
        "o proxy de `/api` não tem `rewrite`. O backend declara `/ementa`, não `/api/ementa` " +
          "(`app/routers/publico.py`): sem `rewrite`, o uvicorn responde 404 a todos os ecrãs.",
      );
    }

    // Os quatro caminhos que o cliente constrói hoje, tal como os constrói.
    expect(reescrever(`${CAMINHO_BASE}/ementa`)).toBe("/ementa");
    expect(reescrever(`${CAMINHO_BASE}/eventos`)).toBe("/eventos");
    expect(reescrever(`${CAMINHO_BASE}/galeria`)).toBe("/galeria");
    expect(reescrever(`${CAMINHO_BASE}/info`)).toBe("/info");
  });

  it("o rewrite só tira o prefixo, e só no princípio", async () => {
    const entrada = await proxyDeDesenvolvimento();
    const reescrever = entrada.rewrite;
    if (typeof reescrever !== "function") throw new Error("falta o rewrite");

    // Uma rota futura que tenha «api» no meio do caminho não pode perder
    // esse pedaço. Um `replace("/api", "")` sem âncora partia isto.
    expect(reescrever(`${CAMINHO_BASE}/gestao/api-de-teste`)).toBe("/gestao/api-de-teste");
  });
});
