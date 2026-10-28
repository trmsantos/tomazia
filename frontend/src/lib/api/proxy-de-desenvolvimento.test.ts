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
 * O segundo bloco verifica o **emparelhamento** da chave, e não só o
 * `rewrite`: o Vite compara uma chave normal com `url.startsWith(chave)`,
 * que não é um limite de segmento. Com a chave `"/api"`, um `GET /apidocs`
 * entrava no proxy e o `rewrite` entregava `/docs` ao uvicorn. A função
 * `corresponde`, abaixo, repete a regra do Vite em três linhas, e é
 * alimentada pela chave que está mesmo na configuração — por isso voltar a
 * pôr `"/api"` faz o caso do `/apidocs` cair.
 *
 * **O que deixa passar:** não arranca o Vite nem o uvicorn, por isso não
 * prova que a porta 8070 está certa para lá do que o `CLAUDE.md` da raiz
 * documenta, nem que a regra do Vite continua a ser esta na versão
 * seguinte.
 */
import { describe, expect, it } from "vitest";

import configuracaoDoVite from "../../../vite.config";
import { CAMINHO_BASE } from "./cliente";

/** A porta que o `CLAUDE.md` da raiz documenta para o uvicorn local. */
const ALVO = "http://127.0.0.1:8070";

/**
 * A regra de emparelhamento do Vite, repetida aqui para o teste a poder
 * exercitar sem arrancar um servidor. É, letra por letra, o
 * `doesProxyContextMatchUrl` dele: uma chave começada por `^` é uma
 * expressão regular; qualquer outra é um prefixo de texto.
 */
function corresponde(chave: string, url: string): boolean {
  return (chave.startsWith("^") && new RegExp(chave).test(url)) || url.startsWith(chave);
}

/** A chave da entrada de proxy da API, e as opções dela. */
async function proxyDeDesenvolvimento() {
  const configuracao = await configuracaoDoVite({ command: "serve", mode: "development" });
  const proxy = configuracao.server?.proxy;
  if (proxy === undefined) {
    throw new Error(
      "o vite.config.ts não declara `server.proxy`: em desenvolvimento, `/api/…` não chega " +
        "a lado nenhum e todos os ecrãs ficam sem dados.",
    );
  }

  const chaves = Object.keys(proxy);
  const chave = chaves.find((candidata) => corresponde(candidata, `${CAMINHO_BASE}/ementa`));
  if (chave === undefined) {
    throw new Error(
      `nenhuma entrada de proxy do vite.config.ts corresponde a «${CAMINHO_BASE}/ementa» ` +
        `(encontrei: ${JSON.stringify(chaves)}). Em desenvolvimento, os ecrãs ficam sem dados.`,
    );
  }

  const entrada = proxy[chave];
  if (entrada === undefined || typeof entrada === "string") {
    throw new Error(
      `a entrada de proxy «${chave}» não tem opções. Sem opções não há \`rewrite\`, e sem ` +
        "`rewrite` o backend responde 404 a tudo.",
    );
  }
  return { chave, entrada };
}

describe("o proxy de /api em desenvolvimento", () => {
  it("aponta para o uvicorn local da porta 8070", async () => {
    const { entrada } = await proxyDeDesenvolvimento();

    expect(entrada.target).toBe(ALVO);
    expect(
      String(entrada.target),
      "`localhost` resolve primeiro para ::1 num sistema com IPv6, onde o uvicorn não está",
    ).not.toContain("localhost");
  });

  it("o rewrite tira o /api, porque o backend declara as rotas sem ele", async () => {
    const { entrada } = await proxyDeDesenvolvimento();
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

  it("a chave é um limite de segmento: /apidocs não entra no proxy", async () => {
    // Sem isto, a chave `"/api"` — comparada pelo Vite com um
    // `url.startsWith` — apanhava `/apidocs`, e o `rewrite` entregava
    // `/docs` ao uvicorn. O teste do `rewrite`, sozinho, dava a impressão
    // de prender o emparelhamento sem o prender.
    const { chave } = await proxyDeDesenvolvimento();

    expect(chave, "a chave tem de vir do caminho base do cliente").toBe(`^${CAMINHO_BASE}/`);
    expect(corresponde(chave, `${CAMINHO_BASE}/ementa`)).toBe(true);
    expect(corresponde(chave, `${CAMINHO_BASE}/info`)).toBe(true);
    expect(corresponde(chave, "/apidocs"), "/apidocs não é uma rota da nossa API").toBe(false);
    expect(corresponde(chave, "/apimetria")).toBe(false);
  });

  it("o rewrite só tira o prefixo, e só no princípio", async () => {
    const { entrada } = await proxyDeDesenvolvimento();
    const reescrever = entrada.rewrite;
    if (typeof reescrever !== "function") throw new Error("falta o rewrite");

    // Uma rota futura que tenha «api» no meio do caminho não pode perder
    // esse pedaço. Um `replace("/api", "")` sem âncora partia isto.
    expect(reescrever(`${CAMINHO_BASE}/gestao/api-de-teste`)).toBe("/gestao/api-de-teste");
  });
});
