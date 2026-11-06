// @vitest-environment jsdom
/**
 * F3-05, secção 7 — a redução de imagem no browser, antes de qualquer envio.
 *
 * `src/lib/imagens/reduzir.ts` ainda não existe. O contrato que este
 * ficheiro fixa, para quem o for escrever:
 *
 * ```ts
 * export type ResultadoDaReducao =
 *   | { estado: "reduzida"; ficheiro: Blob }
 *   | { estado: "sem-mudanca"; ficheiro: Blob }
 *   | { estado: "nao-descodificou" }
 *   | { estado: "nao-codificou" }
 *   | { estado: "sem-contexto" }
 *   | { estado: "demorou-demais" };
 *
 * export function reduzir(
 *   ficheiro: Blob,
 *   opcoes?: { prazoMs?: number },
 * ): Promise<ResultadoDaReducao>;
 * ```
 *
 * **`sem-contexto`, não `sem-tela`** (correção do Tomás, 6 de novembro de
 * 2026): "tela" é português de Portugal legítimo — pano, e por extensão o
 * elemento `<canvas>` — só que também é a palavra que o português do Brasil
 * usa para "ecrã", e é por isso que `src/textos-pt-pt.test.ts` a tem na
 * lista de palavras proibidas. O varredor casa `\btela` nos dois lados de
 * um hífen, por isso `sem-tela` cai lá dentro sempre, com ou sem `\b` a
 * fechar — não é um `\b` em falta, é a ambiguidade real da palavra.
 * `sem-contexto` é também mais preciso: o que falha é `getContext("2d")`
 * devolver `null`, a ausência do contexto, não da tela.
 *
 * Seis estados, e **nunca uma rejeição** — um `<input type="file">` com uma
 * foto escolhida não pode acabar numa promessa rejeitada dentro de
 * `FolhaEnviarFoto.tsx`, que teria de apanhar erros em dois sítios (o
 * `.catch` e o discriminante) para a mesma família de falhas.
 *
 * **Dois pontos de extensão que esta bateria pede ao implementador, por
 * escrito** (regra do qa: "se precisares de um ponto de extensão para
 * testar, descreve-o"):
 *
 *  1. O elemento de trabalho nasce de `document.createElement("canvas")`
 *     — não de `new OffscreenCanvas(...)`. É o que torna `getContext` e
 *     `toBlob` controláveis por `vi.spyOn(HTMLCanvasElement.prototype, …)`
 *     sem duplicar a bateria para dois construtores possíveis.
 *  2. Se a implementação usar `URL.createObjectURL` para algum passo
 *     intermédio (por exemplo, um `<img>` de reserva para um formato que o
 *     `createImageBitmap` não decodifique directamente), **tem de o revogar
 *     antes de resolver**, nos seis estados — incluindo o prazo esgotado. O
 *     guarda de "sem fugas" abaixo prova isto sem exigir que a
 *     implementação use `createObjectURL` de todo: zero chamadas dos dois
 *     lados também passa.
 *
 * **Prova:** os seis estados, com os seis discriminantes a saírem
 * realmente diferentes uns dos outros (não só a lista escrita à mão); que
 * `reduzir()` nunca rejeita, com três formas de falha diferentes
 * (`createImageBitmap` a lançar, a rejeitar, e `getContext` a devolver
 * `null`); que é chamado com `{ imageOrientation: "from-image" }`; que o
 * prazo esgotado dá `demorou-demais` sem fugas de `ObjectURL`; que
 * 4000×3000 vira 2000×1500 (mantendo a proporção, nunca um quadrado); e que
 * uma imagem já aceite e já pequena dá `sem-mudança` com o **mesmo** `Blob`
 * de entrada — sem passar pelo `canvas` nenhuma vez.
 *
 * **Deixa passar:** o tempo real de uma decodificação num telemóvel a
 * sério, e a conversão de HEIC em si — o jsdom não tem o decodificador
 * nativo do Safari. Isso é `e2e/galeria.spec.ts` (16.5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reduzir } from "./reduzir";
import type { ResultadoDaReducao } from "./reduzir";

/** Um `ImageBitmap` falso: só o que `reduzir()` pode legitimamente ler. */
function bitmapFalso(largura: number, altura: number): ImageBitmap {
  return {
    width: largura,
    height: altura,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

/** Um `Blob` com bytes JPEG mínimos — o que `formato.ts` reconhece como «já aceite». */
function blobJpegFalso(bytes = "conteudo-jpeg-falso"): Blob {
  return new Blob(
    [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...bytes.split("").map((c) => c.charCodeAt(0))])],
    {
      type: "image/jpeg",
    },
  );
}

/** Um `Blob` qualquer — o conteúdo não importa para estes testes: o decodificador está sempre fingido. */
function blobQualquer(): Blob {
  return new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "image/jpeg" });
}

/**
 * Um `Blob` com a assinatura mínima de um HEIC a sério — a mesma técnica de
 * `formato.test.ts` (uma caixa `ftyp` do ISOBMFF com a marca `heic`). Serve
 * para provar que `reduzir()` decide pelos **bytes**, não pelo `Blob.type`
 * nem pelo tamanho: um HEIC de 800×600 (bem dentro do limite de 2000 px)
 * ainda assim tem de passar pelo `<canvas>`, porque HEIC não está em
 * `FORMATOS_ACEITES`.
 */
function blobHeicFalso(): Blob {
  const marca = ascii("heic");
  const corpo = [...ascii("ftyp"), ...marca, 0x00, 0x00, 0x00, 0x00, ...ascii("mif1"), ...marca];
  const tamanho = corpo.length + 4;
  const caixa = [
    (tamanho >>> 24) & 0xff,
    (tamanho >>> 16) & 0xff,
    (tamanho >>> 8) & 0xff,
    tamanho & 0xff,
    ...corpo,
  ];
  return new Blob([Uint8Array.from(caixa)], { type: "image/heic" });
}

function ascii(texto: string): number[] {
  return [...texto].map((caracter) => caracter.charCodeAt(0));
}

type ContextoFalso = {
  drawImage: ReturnType<typeof vi.fn>;
};

/** Instala um `createImageBitmap` falso e devolve o espião para o inspeccionar. */
function fingirCreateImageBitmap(
  implementacao: (...args: unknown[]) => unknown,
): ReturnType<typeof vi.fn> {
  const espiao = vi.fn(implementacao);
  vi.stubGlobal("createImageBitmap", espiao);
  return espiao;
}

/**
 * Controla `HTMLCanvasElement.prototype.getContext` e `.toBlob`, que o
 * jsdom não implementa a sério — por omissão `getContext` já devolve
 * `null`, que é exactamente o estado `sem-contexto`; os outros testes têm de
 * o substituir por um contexto de mentira.
 */
function fingirTela(opcoes: {
  contexto?: ContextoFalso | null;
  resultadoDoToBlob?: Blob | null | "nunca";
}): { getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> } {
  const contexto = "contexto" in opcoes ? opcoes.contexto : { drawImage: vi.fn() };

  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => contexto as unknown as RenderingContext);

  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    resolver: BlobCallback,
  ) {
    if (opcoes.resultadoDoToBlob === "nunca") return; // nunca chama o resolver — usado só para o prazo
    resolver(opcoes.resultadoDoToBlob === undefined ? null : opcoes.resultadoDoToBlob);
  });

  return { getContext, toBlob };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("reduzir() nunca rejeita", () => {
  it("createImageBitmap a lançar de forma síncrona dá nao-descodificou, não uma excepção", async () => {
    fingirCreateImageBitmap(() => {
      throw new DOMException("formato não suportado", "NotSupportedError");
    });

    await expect(reduzir(blobQualquer())).resolves.toEqual({ estado: "nao-descodificou" });
  });

  it("createImageBitmap a rejeitar dá nao-descodificou", async () => {
    fingirCreateImageBitmap(() =>
      Promise.reject(new DOMException("corrompida", "InvalidStateError")),
    );

    await expect(reduzir(blobQualquer())).resolves.toEqual({ estado: "nao-descodificou" });
  });

  it("getContext a devolver null dá sem-contexto — mesmo com a imagem decodificada", async () => {
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
    fingirTela({ contexto: null });

    await expect(reduzir(blobQualquer())).resolves.toEqual({ estado: "sem-contexto" });
  });
});

describe('é chamado com { imageOrientation: "from-image" }', () => {
  it("createImageBitmap recebe o ficheiro e essa opção, e mais nada", async () => {
    const ficheiro = blobJpegFalso();
    const espiao = fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(100, 100)));
    fingirTela({});

    await reduzir(ficheiro);

    expect(espiao).toHaveBeenCalledTimes(1);
    expect(espiao.mock.calls[0]?.[0]).toBe(ficheiro);
    expect(espiao.mock.calls[0]?.[1]).toEqual({ imageOrientation: "from-image" });
  });
});

describe("o prazo esgotado dá demorou-demais, sem fugas de ObjectURL", () => {
  it("um createImageBitmap pendurado para sempre resolve demorou-demais ao fim do prazo", async () => {
    vi.useFakeTimers();
    const criarUrl = vi.spyOn(URL, "createObjectURL");
    const revogarUrl = vi.spyOn(URL, "revokeObjectURL");

    fingirCreateImageBitmap(() => new Promise(() => undefined)); // nunca resolve, nunca rejeita

    const promessa = reduzir(blobQualquer(), { prazoMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promessa).resolves.toEqual({ estado: "demorou-demais" });

    // Ponto de extensão (ver o cabeçalho do ficheiro): esta bateria não
    // exige que a implementação use `createObjectURL` — exige que, se o
    // fizer, não deixe nenhum por revogar. Zero dos dois lados também
    // cumpre a asserção.
    expect(
      revogarUrl.mock.calls.length,
      `createObjectURL foi chamado ${String(criarUrl.mock.calls.length)} vez(es) e ` +
        `revokeObjectURL ${String(revogarUrl.mock.calls.length)} — um URL de objecto por ` +
        "revogar é uma fuga de memória, e o prazo esgotado é precisamente o caminho que " +
        "mais tempo passa com um a viver",
    ).toBe(criarUrl.mock.calls.length);
  });

  it("uma redução normal, bem dentro do prazo, não dispara o temporizador", async () => {
    vi.useFakeTimers();
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(100, 100)));
    fingirTela({ resultadoDoToBlob: new Blob(["x"], { type: "image/webp" }) });

    const promessa = reduzir(blobQualquer(), { prazoMs: 20_000 });
    await vi.advanceTimersByTimeAsync(0);

    await expect(promessa).resolves.toMatchObject({
      estado: expect.any(String) as unknown as string,
    });
    const resultado = await promessa;
    expect(resultado.estado).not.toBe("demorou-demais");
  });
});

describe("nao-codificou: decodificou, mas o canvas não soube gravar", () => {
  it("toBlob a devolver null dá nao-codificou, não nao-descodificou", async () => {
    // A distinção que a especificação pede: «o browser não soube abrir» e
    // «abriu e não soube gravar» são defeitos diferentes, com frases
    // diferentes no ecrã (secção 7.3 fala só do primeiro — o segundo é tão
    // raro que nem tem frase própria, mas não pode ser confundido com ele).
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
    fingirTela({ resultadoDoToBlob: null });

    await expect(reduzir(blobQualquer())).resolves.toEqual({ estado: "nao-codificou" });
  });

  it("toBlob a lançar de forma síncrona também dá nao-codificou — 'nunca lança' continua a valer", async () => {
    // A mesma garantia da descrição de `reduzir()` ("nunca lança") vale
    // para uma falha síncrona dentro do próprio `toBlob`, não só para uma
    // rejeição de promessa — um motor sem memória para codificar pode
    // lançar na hora, em vez de devolver `null` ou rejeitar (correção do
    // Tomás, 6 de novembro de 2026, revisão de código).
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({ drawImage: vi.fn() }) as unknown as RenderingContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {
      throw new DOMException("sem memória para codificar", "InvalidStateError");
    });

    await expect(reduzir(blobQualquer())).resolves.toEqual({ estado: "nao-codificou" });
  });
});

describe("a redução em si: mantém a proporção, nunca recorta, nunca força quadrado", () => {
  it("4000×3000 reduz-se para 2000×1500", async () => {
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
    const telaCapturada: { largura?: number; altura?: number } = {};
    const contexto: ContextoFalso = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      telaCapturada.largura = this.width;
      telaCapturada.altura = this.height;
      return contexto as unknown as RenderingContext;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((resolver: BlobCallback) => {
      resolver(new Blob(["x"], { type: "image/webp" }));
    });

    const resultado = await reduzir(blobQualquer());

    expect(resultado.estado).toBe("reduzida");
    expect(telaCapturada, "guarda: getContext tem de ter sido chamado para medir a tela").toEqual({
      largura: 2000,
      altura: 1500,
    });
    expect(contexto.drawImage).toHaveBeenCalledTimes(1);
  });

  it("retrato 3000×4000 reduz-se para 1500×2000 — o lado maior é sempre o que conta", async () => {
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(3000, 4000)));
    const telaCapturada: { largura?: number; altura?: number } = {};
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      telaCapturada.largura = this.width;
      telaCapturada.altura = this.height;
      return { drawImage: vi.fn() } as unknown as RenderingContext;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((resolver: BlobCallback) => {
      resolver(new Blob(["x"], { type: "image/webp" }));
    });

    await reduzir(blobQualquer());

    expect(telaCapturada).toEqual({ largura: 1500, altura: 2000 });
  });

  it("o resultado de «reduzida» está num dos três formatos que o backend aceita", async () => {
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 2000)));
    fingirTela({ resultadoDoToBlob: new Blob(["x"], { type: "image/webp" }) });

    const resultado = await reduzir(blobQualquer());

    expect(resultado.estado).toBe("reduzida");
    if (resultado.estado !== "reduzida") throw new Error("guarda: devia ter reduzido");
    expect(["image/jpeg", "image/png", "image/webp"]).toContain(resultado.ficheiro.type);
  });
});

describe("sem-mudança: já cabia e já era aceite", () => {
  it("uma foto JPEG de 800×600 sai com o MESMO Blob, sem passar pelo canvas", async () => {
    const original = blobJpegFalso();
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(800, 600)));
    const { getContext } = fingirTela({});

    const resultado = await reduzir(original);

    expect(resultado).toEqual({ estado: "sem-mudanca", ficheiro: original });
    if (resultado.estado === "sem-mudanca") {
      expect(resultado.ficheiro, "tem de ser o MESMO objecto Blob, não uma cópia").toBe(original);
    }
    expect(
      getContext,
      "uma imagem que já cabia e já era aceite não precisa de passar pelo canvas",
    ).not.toHaveBeenCalled();
  });

  it("um HEIC de 800×600 NÃO dá sem-mudança — passa pelo canvas na mesma (decisão do Tomás, ADR 0018)", async () => {
    // Apagar o `&& (await formatoJaAceitavel(...))` do `if` de
    // `reencodarSePreciso` deixa esta bateria inteira verde na mesma: os
    // outros cenários são todos ≥ 2000 px (vão ao canvas de qualquer
    // maneira, por tamanho) ou já são JPEG. Só este caso — pequeno **e**
    // num formato que o backend não aceita — prende a guarda a sério. Sem
    // ela, um HEIC de 1200 px saía do telemóvel em bruto, o backend dava
    // `400`, e uma das cinco tentativas do balde ia-se embora sem nenhuma
    // foto enviada — exactamente o que o ADR 0018 proíbe (correção do
    // Tomás, 6 de novembro de 2026, revisão de código).
    const original = blobHeicFalso();
    fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(800, 600)));
    const { getContext } = fingirTela({
      resultadoDoToBlob: new Blob(["x"], { type: "image/jpeg" }),
    });

    const resultado = await reduzir(original);

    expect(
      resultado.estado,
      "um HEIC pequeno ainda precisa de ser convertido — 'sem-mudança' deixava-o em bruto",
    ).toBe("reduzida");
    expect(getContext, "a conversão só acontece passando pelo canvas").toHaveBeenCalled();
  });
});

describe("os seis discriminantes saem mesmo diferentes uns dos outros", () => {
  it("seis cenários, seis strings distintas, não uma lista escrita de memória", async () => {
    const cenarios: (() => Promise<ResultadoDaReducao>)[] = [
      // reduzida
      async () => {
        fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
        fingirTela({ resultadoDoToBlob: new Blob(["x"], { type: "image/webp" }) });
        return reduzir(blobQualquer());
      },
      // sem-mudanca
      async () => {
        fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(100, 100)));
        fingirTela({});
        return reduzir(blobJpegFalso());
      },
      // nao-descodificou
      async () => {
        fingirCreateImageBitmap(() => Promise.reject(new Error("não decodifica")));
        return reduzir(blobQualquer());
      },
      // nao-codificou
      async () => {
        fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
        fingirTela({ resultadoDoToBlob: null });
        return reduzir(blobQualquer());
      },
      // sem-contexto
      async () => {
        fingirCreateImageBitmap(() => Promise.resolve(bitmapFalso(4000, 3000)));
        fingirTela({ contexto: null });
        return reduzir(blobQualquer());
      },
      // demorou-demais
      async () => {
        vi.useFakeTimers();
        fingirCreateImageBitmap(() => new Promise(() => undefined));
        const promessa = reduzir(blobQualquer(), { prazoMs: 1_000 });
        await vi.advanceTimersByTimeAsync(1_000);
        return promessa;
      },
    ];

    const vistos: string[] = [];
    for (const cenario of cenarios) {
      const resultado = await cenario();
      vistos.push(resultado.estado);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }

    expect(vistos).toEqual([
      "reduzida",
      "sem-mudanca",
      "nao-descodificou",
      "nao-codificou",
      "sem-contexto",
      "demorou-demais",
    ]);
    expect(
      new Set(vistos).size,
      `os seis cenários deram ${JSON.stringify(vistos)} — dois iguais são dois defeitos ` +
        "diferentes a desenhar o mesmo erro no ecrã",
    ).toBe(6);
  });
});
