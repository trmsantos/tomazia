import { deflateSync } from "node:zlib";

import type { Page, Route } from "@playwright/test";

import { fotoPendenteDeTeste, type FotoPendente } from "../../src/testes/gestao";
import { fingirInfoFixo } from "./cabecalho";
import { fingirEmentaFixa } from "./ementa";
import { fingirEventosFixos } from "./eventos";
import { fingirOMedia } from "./galeria";
import type { ServidorFingido } from "./gestao";

/**
 * A API das fotos fingida **com um único estado em memória** (F4-04): `GET /api/gestao/fotos`,
 * `GET /api/gestao/fotos/{id}/imagem`, `POST …/aprovar`, `POST …/rejeitar`, o `POST /api/fotos`
 * **público** (acrescenta uma pendente no fim, como o backend) e o `GET /api/galeria` **público**
 * (as aprovadas). Um `POST …/aprovar` muda o que o `GET /api/galeria` devolve a seguir: é o que
 * prova «aprovar põe a foto no site» do lado do frontend (o do servidor é
 * `backend/tests/gestao/test_fotos.py`).
 *
 * As regras são as do backend (`app/services/fotos.py`):
 *
 *  - a fila é **só `pendente`**, da mais antiga para a mais recente (`criada_em`, `id`);
 *  - **aprovar e rejeitar só atuam sobre `pendente`**: um segundo pedido igual dá **409
 *    `foto_ja_moderada`**, nunca uma segunda moderação; uma foto que não existe dá 404
 *    `foto_nao_encontrada`;
 *  - **rejeitar apaga os bytes**: a imagem da rejeitada passa a **404**;
 *  - a imagem serve-se com `Cache-Control: no-store` (o `route.fulfill` já desliga a cache do
 *    browser; o contador de pedidos conta o que de facto chega);
 *  - o `POST /fotos` responde `202 {estado: "pendente"}` **sem `id`**; guarda os nomes dos campos
 *    do multipart (para provar que o `website` e o `enviada_por` nunca vão) e o cabeçalho
 *    `X-Tomazia`; **só valida o que o `X-Tomazia` e o formato**.
 *
 * As imagens são PNG verdadeiros (feitos aqui, com `node:zlib`, sem dependências) com dimensões
 * diferentes: **ids ímpares 3:4 (240 × 320), pares 16:9 (320 × 180)**. O backend serve WebP; o
 * browser decide pelos bytes e não pelo tipo, e um PNG é o que se pode gerar aqui sem uma
 * biblioteca. O que interessa é que o `<img>` **dispare `load`** e que as proporções difiram para
 * os botões provarem que não se mexem.
 *
 *  - **`pedidos`** regista tudo (método, caminho, corpo, cabeçalhos); **`imagens`** conta os
 *    pedidos de imagem **por `id`** (o pré-carregamento é «um por foto»);
 *  - **`falhas`** injeta uma falha por rota **e por ordem do pedido** (a ordem conta os pedidos
 *    que condizem com `metodo` + `caminho`, a partir de 1). `"abortar"` não responde;
 *    **`"aplicar-e-abortar"`** aplica o efeito no estado e depois não responde (o pedido chegou,
 *    a resposta perdeu-se: o caso «não sei» da regra 10);
 *  - **precedência das rotas** (Playwright: a última registada ganha): o `apoio/gestao-ementa.ts`
 *    regista `**\/api/gestao/**`; quem usar também `fingirApiDeEmenta` chama **esta** função
 *    **depois** dela.
 */
export type PedidoObservado = {
  metodo: string;
  caminho: string;
  corpo: unknown;
  cabecalhos: Record<string, string>;
};

export type FotoDoServidor = FotoPendente & {
  estado: "pendente" | "aprovada" | "rejeitada";
};

export type Falha = {
  metodo: "GET" | "POST";
  /** Condiz com o caminho depois de `/api` (`/gestao/fotos`, `/gestao/fotos/101/aprovar`, `/fotos`). */
  caminho: RegExp;
  /** O n-ésimo pedido que condiz (1 = o primeiro). Sem `ordem`, todos. */
  ordem?: number;
  /**
   * Só falha **quando** isto for verdade no momento do pedido. É a forma de dizer «o GET que vem
   * depois do POST» sem contar pedidos: o servidor de desenvolvimento corre no `StrictMode`, que
   * monta os efeitos duas vezes, e um `ordem: 2` num `GET` ao carregar apanhava o pedido errado.
   */
  quando?: (servidor: ServidorDeFotos) => boolean;
  /** Falha só as primeiras `vezes` vezes que condiz (depois, o pedido passa). Sem isto, falha sempre. */
  vezes?: number;
  resposta: { estado: number; corpo?: Record<string, unknown> } | "abortar" | "aplicar-e-abortar";
  /** Fecha também a sessão do servidor fingido de `apoio/gestao.ts` (o `/auth/eu` passa a 401). */
  fechaSessao?: boolean;
};

/** Já chegou um `POST …/aprovar` (ou `…/rejeitar`)? Para o `quando` das verificações que falham. */
export function jaChegouAModeracao(servidor: ServidorDeFotos): boolean {
  return servidor.pedidos.some(
    (p) => p.metodo === "POST" && /\/(aprovar|rejeitar)$/.test(p.caminho),
  );
}

export type EnvioObservado = {
  /** Os nomes dos campos do multipart, pela ordem. */
  campos: string[];
  descricao: string | null;
  contentType: string;
  cabecalhos: Record<string, string>;
};

export type ServidorDeFotos = {
  /** O estado «na base de dados». */
  fotos: FotoDoServidor[];
  pedidos: PedidoObservado[];
  /** Quantos pedidos de imagem chegaram, por `id`. */
  imagens: Record<number, number>;
  envios: EnvioObservado[];
  falhas: Falha[];
  /** Atraso (ms) a aplicar a cada resposta — para ver «A aprovar…» e o esqueleto. */
  atrasoMs: number;
};

export const ROTA_DAS_FOTOS_DE_GESTAO =
  /\/api\/gestao\/fotos(?:\/(\d+)\/(aprovar|rejeitar|imagem))?(?:\?.*)?$/;
export const ROTA_DO_ENVIO_PUBLICO = "**/api/fotos";
export const ROTA_DA_GALERIA_PUBLICA = "**/api/galeria";

export function pedidosDe(
  servidor: ServidorDeFotos,
  metodo: string,
  caminho: RegExp = /./,
): PedidoObservado[] {
  return servidor.pedidos.filter((p) => p.metodo === metodo && caminho.test(p.caminho));
}

/** A fila que o servidor daria agora: pendentes, da mais antiga para a mais recente. */
export function filaDoServidor(servidor: ServidorDeFotos): FotoDoServidor[] {
  return servidor.fotos
    .filter((f) => f.estado === "pendente")
    .sort((a, b) => a.criada_em.localeCompare(b.criada_em) || a.id - b.id);
}

export function estadoDe(servidor: ServidorDeFotos, id: number): FotoDoServidor["estado"] | null {
  return servidor.fotos.find((f) => f.id === id)?.estado ?? null;
}

// ---------------------------------------------------------------------------
// As fotos de teste
// ---------------------------------------------------------------------------

/**
 * As três fotos de todos os e2e, pela ordem da fila. Ids ímpares dão imagem 3:4, pares 16:9; as
 * legendas distinguem-se, para «a segunda à vista com a legenda dela» ser uma prova.
 *
 *  - 101: vertical, **legenda de duas linhas** a 390 px, por «Rita»;
 *  - 102: horizontal, legenda curta, por «Marta»;
 *  - 103: vertical, **sem legenda nem nome**.
 */
export const LEGENDA_DA_101 =
  "Noite de samba com a malta toda a cantar e a dançar até de madrugada";
export const LEGENDA_DA_102 = "Brinde de sexta";

export function fotosDoE2E(): FotoPendente[] {
  return [
    fotoPendenteDeTeste({
      id: 101,
      descricao: LEGENDA_DA_101,
      enviada_por: "Rita",
      criada_em: "2026-11-01T23:40:00Z",
    }),
    fotoPendenteDeTeste({
      id: 102,
      descricao: LEGENDA_DA_102,
      enviada_por: "Marta",
      criada_em: "2026-11-02T00:30:00Z",
    }),
    fotoPendenteDeTeste({ id: 103, criada_em: "2026-11-02T01:10:00Z" }),
  ];
}

// ---------------------------------------------------------------------------
// PNG a sério, sem dependências
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (TABELA_CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const comprimento = Buffer.alloc(4);
  comprimento.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([comprimento, corpo, crc]);
}

/** Um PNG RGB de uma só cor, `largura × altura`, com uma faixa mais clara no topo (não é um bloco uniforme). */
export function pngDe(largura: number, altura: number, cor: [number, number, number]): Buffer {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // bits por canal
  cabecalho[9] = 2; // RGB
  const linhas: Buffer[] = [];
  for (let y = 0; y < altura; y += 1) {
    const linha = Buffer.alloc(1 + largura * 3);
    const clara = y < altura / 8;
    for (let x = 0; x < largura; x += 1) {
      linha[1 + x * 3] = clara ? Math.min(255, cor[0] + 90) : cor[0];
      linha[2 + x * 3] = clara ? Math.min(255, cor[1] + 90) : cor[1];
      linha[3 + x * 3] = clara ? Math.min(255, cor[2] + 90) : cor[2];
    }
    linhas.push(linha);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", deflateSync(Buffer.concat(linhas))),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

/** A imagem da foto `id`: ímpar 3:4 (240 × 320), par 16:9 (320 × 180); a cor muda com o id. */
export function imagemDaFoto(id: number): Buffer {
  const [l, a] = id % 2 === 1 ? [240, 320] : [320, 180];
  return pngDe(l, a, [(id * 53) % 160, (id * 97) % 160, (id * 29) % 160]);
}

// ---------------------------------------------------------------------------

async function json(rota: Route, estado: number, corpo?: unknown): Promise<void> {
  await rota.fulfill({
    status: estado,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(corpo ?? {}),
  });
}

/** Os nomes dos campos de um corpo `multipart/form-data` e o valor de `descricao`, sem o ficheiro. */
function lerMultipart(
  corpo: Buffer,
  contentType: string,
): { campos: string[]; descricao: string | null } {
  const fronteira = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const valor = fronteira?.[1] ?? fronteira?.[2];
  if (valor === undefined) return { campos: [], descricao: null };
  const campos: string[] = [];
  let descricao: string | null = null;
  for (const parte of corpo.toString("latin1").split(`--${valor}`)) {
    const nome = /name="([^"]+)"/.exec(parte)?.[1];
    if (nome === undefined) continue;
    campos.push(nome);
    if (nome === "descricao") {
      const fim = parte.indexOf("\r\n\r\n");
      descricao = Buffer.from(parte.slice(fim + 4).replace(/\r\n$/, ""), "latin1").toString(
        "utf-8",
      );
    }
  }
  return { campos, descricao };
}

export async function fingirApiDasFotos(
  pagina: Page,
  opcoes: {
    /** O que está na fila ao início (todas `pendente`), ou o estado completo. */
    inicial?: ReadonlyArray<FotoPendente | FotoDoServidor>;
    falhas?: Falha[];
    sessao?: ServidorFingido;
    atrasoMs?: number;
  } = {},
): Promise<ServidorDeFotos> {
  const servidor: ServidorDeFotos = {
    fotos: structuredClone(opcoes.inicial ?? fotosDoE2E()).map((f) => ({
      ...f,
      estado: "estado" in f ? f.estado : "pendente",
    })),
    pedidos: [],
    imagens: {},
    envios: [],
    falhas: opcoes.falhas ?? [],
    atrasoMs: opcoes.atrasoMs ?? 0,
  };
  let proximoId = Math.max(1000, ...servidor.fotos.map((f) => f.id + 1));
  const vezesUsadas = new WeakMap<Falha, number>();

  /** `aplicar` corre o efeito no estado antes de abortar (o caso «aplicar-e-abortar»). */
  async function falhaInjetada(
    rota: Route,
    metodo: string,
    caminho: string,
    aplicar: () => void,
  ): Promise<boolean> {
    for (const falha of servidor.falhas) {
      if (falha.metodo !== metodo || !falha.caminho.test(caminho)) continue;
      // `pedidos` já inclui o pedido corrente: a ordem conta os que condizem com esta falha.
      const n = servidor.pedidos.filter(
        (p) => p.metodo === falha.metodo && falha.caminho.test(p.caminho),
      ).length;
      if (falha.ordem !== undefined && falha.ordem !== n) continue;
      if (falha.quando !== undefined && !falha.quando(servidor)) continue;
      const usadas = vezesUsadas.get(falha) ?? 0;
      if (falha.vezes !== undefined && usadas >= falha.vezes) continue;
      vezesUsadas.set(falha, usadas + 1);
      if (falha.fechaSessao === true && opcoes.sessao !== undefined)
        opcoes.sessao.sessaoAberta = false;
      if (falha.resposta === "aplicar-e-abortar") {
        aplicar();
        await rota.abort("failed");
      } else if (falha.resposta === "abortar") await rota.abort("failed");
      else await json(rota, falha.resposta.estado, falha.resposta.corpo);
      return true;
    }
    return false;
  }

  await pagina.route(ROTA_DAS_FOTOS_DE_GESTAO, async (rota) => {
    const pedido = rota.request();
    const metodo = pedido.method();
    const caminho = new URL(pedido.url()).pathname.replace(/^\/api/, "");
    const m = /^\/gestao\/fotos(?:\/(\d+)\/(aprovar|rejeitar|imagem))?$/.exec(caminho);
    const id = m?.[1] === undefined ? null : Number(m[1]);
    const acao = m?.[2];
    servidor.pedidos.push({
      metodo,
      caminho,
      corpo: pedido.postData() ?? undefined,
      cabecalhos: pedido.headers(),
    });
    if (acao === "imagem" && id !== null) servidor.imagens[id] = (servidor.imagens[id] ?? 0) + 1;
    if (servidor.atrasoMs > 0) await new Promise((r) => setTimeout(r, servidor.atrasoMs));

    const achada = id === null ? undefined : servidor.fotos.find((f) => f.id === id);
    const moderar = (): void => {
      if (achada !== undefined && achada.estado === "pendente") {
        achada.estado = acao === "aprovar" ? "aprovada" : "rejeitada";
      }
    };
    if (await falhaInjetada(rota, metodo, caminho, moderar)) return;

    if (opcoes.sessao !== undefined && !opcoes.sessao.sessaoAberta) {
      await json(rota, 401, { erro: "sessao_em_falta", mensagem: "Precisas de entrar." });
      return;
    }

    if (id === null && metodo === "GET") {
      await json(rota, 200, {
        // Só o que o backend manda (nunca o `estado`, que é nosso, nem o `ip_hash`).
        fotos: filaDoServidor(servidor).map(
          ({ id: i, ficheiro, descricao, enviada_por, criada_em }) => ({
            id: i,
            ficheiro,
            descricao,
            enviada_por,
            criada_em,
          }),
        ),
      });
      return;
    }

    if (acao === "imagem" && metodo === "GET") {
      // Serve pendente ou aprovada; a rejeitada já não tem bytes.
      if (achada === undefined || achada.estado === "rejeitada") {
        await json(rota, 404, { erro: "foto_nao_encontrada", mensagem: "Não encontrei a foto." });
        return;
      }
      await rota.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Cache-Control": "no-store" },
        body: imagemDaFoto(achada.id),
      });
      return;
    }

    if ((acao === "aprovar" || acao === "rejeitar") && metodo === "POST") {
      if (pedido.headers()["x-tomazia"] !== "1") {
        await json(rota, 403, { erro: "pedido_recusado", mensagem: "x" });
        return;
      }
      if (achada === undefined) {
        await json(rota, 404, { erro: "foto_nao_encontrada", mensagem: "Não encontrei a foto." });
        return;
      }
      if (achada.estado !== "pendente") {
        await json(rota, 409, {
          erro: "foto_ja_moderada",
          mensagem: "MENSAGEM-DO-BACKEND (nunca aparece no ecrã)",
        });
        return;
      }
      moderar();
      await json(rota, 200, { id: achada.id, estado: achada.estado });
      return;
    }

    await json(rota, 405, { erro: "metodo_nao_permitido", mensagem: "x" });
  });

  // O envio público: o dono usa o mesmo `POST /fotos` que os clientes.
  await pagina.route(ROTA_DO_ENVIO_PUBLICO, async (rota) => {
    const pedido = rota.request();
    const metodo = pedido.method();
    const contentType = pedido.headers()["content-type"] ?? "";
    const bruto = (await pedido.postDataBuffer()) ?? Buffer.alloc(0);
    const { campos, descricao } = lerMultipart(bruto, contentType);
    servidor.pedidos.push({
      metodo,
      caminho: "/fotos",
      corpo: undefined,
      cabecalhos: pedido.headers(),
    });
    servidor.envios.push({ campos, descricao, contentType, cabecalhos: pedido.headers() });
    if (servidor.atrasoMs > 0) await new Promise((r) => setTimeout(r, servidor.atrasoMs));

    const acrescentar = (): void => {
      const id = proximoId++;
      servidor.fotos.push({
        id,
        ficheiro: `foto-${String(id)}.webp`,
        descricao,
        enviada_por: null,
        criada_em: "2026-11-02T09:59:00Z",
        estado: "pendente",
      });
    };
    if (await falhaInjetada(rota, metodo, "/fotos", acrescentar)) return;
    if (metodo !== "POST" || pedido.headers()["x-tomazia"] !== "1") {
      await json(rota, 403, { erro: "pedido_recusado", mensagem: "x" });
      return;
    }
    acrescentar();
    await json(rota, 202, { estado: "pendente" });
  });

  // A galeria pública: só as aprovadas, como o backend.
  await pagina.route(ROTA_DA_GALERIA_PUBLICA, async (rota) => {
    const pedido = rota.request();
    servidor.pedidos.push({
      metodo: pedido.method(),
      caminho: "/galeria",
      corpo: undefined,
      cabecalhos: pedido.headers(),
    });
    if (await falhaInjetada(rota, pedido.method(), "/galeria", () => undefined)) return;
    await json(rota, 200, {
      fotos: servidor.fotos
        .filter((f) => f.estado === "aprovada")
        .sort((a, b) => a.criada_em.localeCompare(b.criada_em) || a.id - b.id)
        .map(({ id, ficheiro, descricao }) => ({ id, ficheiro, descricao })),
    });
  });

  return servidor;
}

/**
 * O resto do site público, para um `goto("/")` depois de aprovar (a galeria pública pede também a
 * ementa, os eventos, o `info` e as imagens em `/media/`). Chamar **antes** do `goto`.
 */
export async function fingirSitePublico(pagina: Page): Promise<void> {
  await fingirInfoFixo(pagina);
  await fingirEmentaFixa(pagina);
  await fingirEventosFixos(pagina);
  await fingirOMedia(pagina);
}
