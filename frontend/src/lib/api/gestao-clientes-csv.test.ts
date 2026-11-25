// @vitest-environment node
/**
 * F4-05b, spec 6 e critério 12 — `GET /gestao/clientes.csv`, o ficheiro **tal como o servidor o
 * enviou**.
 *
 * Contrato (`src/lib/api/gestao-clientes.ts`):
 *
 * ```ts
 * export type CsvDeClientes = { nome: string; href: string };
 * export function descarregarClientesCsv(opcoes?: OpcoesDePedido): Promise<CsvDeClientes>;
 * ```
 *
 *  - `href` é `data:text/csv;charset=utf-8;base64,<os bytes da resposta>` (a CSP de produção
 *    proíbe `blob:`: **`URL.createObjectURL` nunca é chamado**). Os bytes são lidos como bytes
 *    (`arrayBuffer`), **nunca** por `text()`/`json()`: o descodificador de texto **tira a BOM**, e
 *    o Excel português só abre bem os acentos com ela. Estes testes usam uma `Response` a sério,
 *    cujo `text()` tira mesmo a BOM — se a implementação a usar, a comparação byte a byte falha.
 *  - **Só** com `200` + `Content-Type` `text/csv` + corpo que **começa por `EF BB BF`** resolve.
 *    Um 200 vazio, com outro `Content-Type` (uma página de erro) ou sem BOM é `ErroDaApi` com
 *    **estado 200** (o servidor respondeu; não é «sem resposta») — nunca um ficheiro de zero bytes
 *    nem uma página de erro com nome `.csv`.
 *  - `nome`: o do `Content-Disposition` **só** se o nome casar com `^clientes-\d{4}-\d{2}-\d{2}\.csv$`;
 *    qualquer outra coisa (cabeçalho em falta, `../`, outra extensão, `filename*=`, maiúsculas…)
 *    dá o nome fixo `clientes-AAAA-MM-DD.csv` com **a data de hoje em Lisboa**. Texto do servidor
 *    nunca vira nome de ficheiro sem validar.
 *  - 401, 403, 5xx passam com o estado; rede e prazo: `estado === null`; o cancelamento sai cru.
 *    Nunca repete. O prazo de 20 s é do ecrã (`ClientesGestao.exportar.test.tsx`).
 *
 * **Deixa passar:** o `fetch` a sério e o que o browser faz com o link (o e2e da CSP).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  base64De,
  bytesDoEnderecoData,
  csvBinario,
  csvDeTeste,
  csvGrande,
} from "../../testes/clientes-dados";
import { criarFetchFalso, respostaDe } from "../../testes/pedidos";
import { CAMINHO_BASE, ErroDaApi } from "./cliente";
import * as gestaoClientes from "./gestao-clientes";

const NOME_BOM = 'attachment; filename="clientes-2026-11-25.csv"';

function csv(
  corpo: Uint8Array | string | null = csvDeTeste(),
  cabecalhos: Record<string, string> = {},
  estado = 200,
): Response {
  const cabecalhosFinais: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": NOME_BOM,
    ...cabecalhos,
  };
  return new Response(corpo as BodyInit | null, { status: estado, headers: cabecalhosFinais });
}

/** Uma resposta sem o cabeçalho `Content-Type` (o `Response` não põe nenhum para bytes). */
function semTipo(corpo: Uint8Array): Response {
  return new Response(corpo as BodyInit, { status: 200 });
}

let criarUrl: MockInstance<typeof URL.createObjectURL>;

beforeEach(() => {
  // Só se espia: um `blob:` nunca pode ser pedido (a CSP de produção bloqueia-o).
  criarUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:nao-devia");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function instalar(responder: Parameters<typeof criarFetchFalso>[0]) {
  const { falso, pedidos } = criarFetchFalso(responder);
  vi.stubGlobal("fetch", falso);
  return pedidos;
}

async function falhaDe(promessa: Promise<unknown>): Promise<ErroDaApi> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDaApi) return erro;
    throw erro;
  }
  throw new Error("esperava uma falha e o pedido resolveu");
}

function rede(): never {
  throw new TypeError("Failed to fetch");
}

describe("o pedido", () => {
  it("GET /api/gestao/clientes.csv, com X-Tomazia, credenciais e o sinal; sem corpo", async () => {
    const pedidos = instalar(() => csv());
    const controlador = new AbortController();

    await gestaoClientes.descarregarClientesCsv({ sinal: controlador.signal });

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${CAMINHO_BASE}/gestao/clientes.csv`);
    expect(pedidos[0]?.opcoes?.method ?? "GET").toBe("GET");
    expect(pedidos[0]?.cabecalhos["x-tomazia"]).toBe("1");
    expect(pedidos[0]?.opcoes?.credentials).toBe("include");
    expect(pedidos[0]?.opcoes?.signal).toBe(controlador.signal);
    expect(pedidos[0]?.opcoes?.body).toBeUndefined();
  });
});

describe("os bytes saem exatamente como o servidor os enviou", () => {
  it("BOM, `;`, CRLF e acentos: o `href` é um data:text/csv;charset=utf-8;base64 e descodifica para os MESMOS bytes", async () => {
    const original = csvDeTeste();
    instalar(() => csv(original));

    const { href } = await gestaoClientes.descarregarClientesCsv();

    const bytes = bytesDoEnderecoData(href);
    expect(Array.from(bytes.slice(0, 3)), "a BOM sobrevive").toEqual([0xef, 0xbb, 0xbf]);
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });

  it("todos os 256 valores de byte (UTF-8 inválido incluído) passam sem serem «descodificados»", async () => {
    const original = csvBinario();
    instalar(() => csv(original));

    const { href } = await gestaoClientes.descarregarClientesCsv();

    expect(Array.from(bytesDoEnderecoData(href))).toEqual(Array.from(original));
    expect(href).toBe(`data:text/csv;charset=utf-8;base64,${base64De(original)}`);
  });

  it("um ficheiro grande (300 000 bytes) não rebenta a pilha e sai inteiro", async () => {
    const original = csvGrande();
    instalar(() => csv(original));

    const { href } = await gestaoClientes.descarregarClientesCsv();

    const bytes = bytesDoEnderecoData(href);
    expect(bytes.length).toBe(original.length);
    expect(Array.from(bytes.slice(0, 8))).toEqual(Array.from(original.slice(0, 8)));
    expect(Array.from(bytes.slice(-8))).toEqual(Array.from(original.slice(-8)));
  });

  it("um CSV só com o cabeçalho (outro aparelho eliminou todos) descarrega-se como qualquer outro", async () => {
    const soCabecalho = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("id;nome;email\r\n"),
    ]);
    instalar(() => csv(soCabecalho));

    const { href } = await gestaoClientes.descarregarClientesCsv();

    expect(Array.from(bytesDoEnderecoData(href))).toEqual(Array.from(soCabecalho));
  });

  it("`URL.createObjectURL` NUNCA é chamado (a CSP de produção proíbe `blob:`) e o `href` não é blob:", async () => {
    instalar(() => csv());

    const { href } = await gestaoClientes.descarregarClientesCsv();

    expect(criarUrl).not.toHaveBeenCalled();
    expect(href.startsWith("data:text/csv;charset=utf-8;base64,")).toBe(true);
    expect(href).not.toMatch(/^blob:/);
  });

  it("aceita `text/csv` sem charset e em maiúsculas (o tipo é a sério, a grafia não)", async () => {
    instalar(() => csv(csvDeTeste(), { "Content-Type": "text/csv" }));
    await expect(gestaoClientes.descarregarClientesCsv()).resolves.toBeDefined();
    instalar(() => csv(csvDeTeste(), { "Content-Type": "TEXT/CSV; charset=UTF-8" }));
    await expect(gestaoClientes.descarregarClientesCsv()).resolves.toBeDefined();
  });
});

describe("o que NÃO é um CSV nunca se descarrega: ErroDaApi com estado 200, nunca um ficheiro", () => {
  it("200 com o corpo vazio (zero bytes)", async () => {
    instalar(() => csv(new Uint8Array(0)));
    const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
    expect(erro.estado).toBe(200);
  });

  it.each([
    ["application/json", '{"erro":"x"}'],
    ["text/html; charset=utf-8", "<html>Service Unavailable</html>"],
    ["text/plain", "a;b"],
    ["application/octet-stream", "a;b"],
    ["application/csv", "a;b"],
    ["text/csvx", "a;b"],
  ])("200 com Content-Type %s", async (tipo, texto) => {
    const corpo = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(texto)]);
    instalar(() => csv(corpo, { "Content-Type": tipo }));
    const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
    expect(erro.estado).toBe(200);
  });

  it("200 sem o cabeçalho Content-Type", async () => {
    instalar(() => semTipo(csvDeTeste()));
    const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
    expect(erro.estado).toBe(200);
  });

  it.each([
    ["sem BOM", "id;nome\r\n1;Ana\r\n"],
    ["com BOM a meio (não no início)", "x﻿id;nome\r\n"],
  ])("200 text/csv %s: o ficheiro não começa por EF BB BF", async (_nome, texto) => {
    instalar(() => csv(new TextEncoder().encode(texto)));
    const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
    expect(erro.estado).toBe(200);
  });

  it("um corpo de 1 ou 2 bytes (BOM cortada) não é um CSV", async () => {
    instalar(() => csv(Uint8Array.from([0xef, 0xbb])));
    expect((await falhaDe(gestaoClientes.descarregarClientesCsv())).estado).toBe(200);
  });
});

describe("o nome do ficheiro: o do servidor só se casar com ^clientes-\\d{4}-\\d{2}-\\d{2}\\.csv$", () => {
  it("o do Content-Disposition, quando é válido", async () => {
    instalar(() =>
      csv(csvDeTeste(), {
        "Content-Disposition": 'attachment; filename="clientes-2026-11-25.csv"',
      }),
    );
    expect((await gestaoClientes.descarregarClientesCsv()).nome).toBe("clientes-2026-11-25.csv");
  });

  it("válido sem aspas também (o formato é o do servidor, a regra é o nome)", async () => {
    instalar(() =>
      csv(csvDeTeste(), { "Content-Disposition": "attachment; filename=clientes-2026-01-02.csv" }),
    );
    expect((await gestaoClientes.descarregarClientesCsv()).nome).toBe("clientes-2026-01-02.csv");
  });

  describe("senão, o nome fixo com a data de HOJE em Lisboa", () => {
    // 14/7/2026 23:30 UTC é 15/7 00:30 em Lisboa (verão): a data de Lisboa não é a do UTC.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-14T23:30:00Z") });
    });

    it.each([
      ["sem cabeçalho", undefined],
      ["inline em vez de attachment sem nome", "inline"],
      ["outra pasta (../)", 'attachment; filename="../clientes-2026-11-25.csv"'],
      ["barra no nome", 'attachment; filename="a/clientes-2026-11-25.csv"'],
      ["contrabarra", 'attachment; filename="..\\clientes-2026-11-25.csv"'],
      ["outra extensão", 'attachment; filename="clientes-2026-11-25.exe"'],
      ["extensão a mais", 'attachment; filename="clientes-2026-11-25.csv.exe"'],
      ["extensão em maiúsculas", 'attachment; filename="clientes-2026-11-25.CSV"'],
      ["prefixo em maiúsculas", 'attachment; filename="Clientes-2026-11-25.csv"'],
      ["sem data", 'attachment; filename="clientes.csv"'],
      ["data com um dígito a menos", 'attachment; filename="clientes-2026-1-25.csv"'],
      ["data com um dígito a mais", 'attachment; filename="clientes-2026-111-25.csv"'],
      ["texto a mais antes", 'attachment; filename="x-clientes-2026-11-25.csv"'],
      ["texto a mais depois", 'attachment; filename="clientes-2026-11-25-x.csv"'],
      ["nome vazio", 'attachment; filename=""'],
      ["o formato filename* (RFC 5987)", "attachment; filename*=UTF-8''clientes-2026-11-25.csv"],
      ["o nome com espaços", 'attachment; filename=" clientes-2026-11-25.csv "'],
      ["dois nomes", 'attachment; filename="clientes-2026-11-25.csv"; filename="x.csv"'],
      ["texto com HTML", 'attachment; filename="<img src=x onerror=alert(1)>.csv"'],
    ])("%s", async (_nome, cabecalho) => {
      const extra: Record<string, string> =
        cabecalho === undefined ? {} : { "Content-Disposition": cabecalho };
      instalar(() => {
        const resposta = csv(csvDeTeste(), extra);
        if (cabecalho === undefined) resposta.headers.delete("Content-Disposition");
        return resposta;
      });

      const { nome } = await gestaoClientes.descarregarClientesCsv();

      expect(nome).toBe("clientes-2026-07-15.csv");
    });

    it("o nome de reserva em UTC seria o 14: o teste distingue Lisboa de UTC", async () => {
      instalar(() => {
        const r = csv(csvDeTeste());
        r.headers.delete("Content-Disposition");
        return r;
      });
      expect((await gestaoClientes.descarregarClientesCsv()).nome).not.toBe(
        "clientes-2026-07-14.csv",
      );
    });
  });

  it("em novembro (UTC+0) o nome de reserva é a data de hoje, com zeros à esquerda", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-05T12:00:00Z") });
    instalar(() => {
      const r = csv(csvDeTeste());
      r.headers.delete("Content-Disposition");
      return r;
    });
    expect((await gestaoClientes.descarregarClientesCsv()).nome).toBe("clientes-2026-01-05.csv");
  });
});

describe("as falhas (regra 10): cada uma diz o que foi", () => {
  it("rede em baixo e prazo esgotado: estado null", async () => {
    instalar(rede);
    expect((await falhaDe(gestaoClientes.descarregarClientesCsv())).estado).toBeNull();
    instalar(() => {
      throw new DOMException("O pedido demorou demasiado.", "TimeoutError");
    });
    expect((await falhaDe(gestaoClientes.descarregarClientesCsv())).estado).toBeNull();
  });

  it.each([401, 403, 500, 502, 503])(
    "%i: ErroDaApi com esse estado, nunca um ficheiro; sem repetir",
    async (estado) => {
      const pedidos = instalar(() =>
        respostaDe(estado, JSON.stringify({ erro: "x", mensagem: "m" })),
      );
      const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
      expect(erro.estado).toBe(estado);
      expect(pedidos).toHaveLength(1);
    },
  );

  it("5xx com a página HTML do Apache: o corpo nunca vai para a mensagem", async () => {
    instalar(() => respostaDe(503, "<html>SEGREDO-DO-APACHE</html>"));
    const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
    expect(erro.message).not.toContain("SEGREDO-DO-APACHE");
  });

  it("a rejeição ao ler o corpo a meio (rede cortada) não vira um ficheiro truncado", async () => {
    instalar(() => ({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "text/csv; charset=utf-8" }),
      arrayBuffer: () => Promise.reject(new TypeError("terminated")),
      blob: () => Promise.reject(new TypeError("terminated")),
      text: () => Promise.reject(new TypeError("terminated")),
    }));
    const erro = await falhaDe(gestaoClientes.descarregarClientesCsv());
    expect(erro).toBeInstanceOf(ErroDaApi);
  });

  it("cancelado: sai o erro original, que NÃO é um ErroDaApi", async () => {
    const controlador = new AbortController();
    instalar(() => {
      controlador.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    let apanhado: unknown;
    try {
      await gestaoClientes.descarregarClientesCsv({ sinal: controlador.signal });
    } catch (erro) {
      apanhado = erro;
    }
    expect(apanhado).toBeInstanceOf(Error);
    expect(apanhado).not.toBeInstanceOf(ErroDaApi);
  });
});
