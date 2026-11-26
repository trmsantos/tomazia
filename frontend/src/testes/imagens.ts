/**
 * Leitores mínimos de cabeçalhos de imagem, só para os testes da F3-08.
 *
 * Sem dependências novas (regra 8): lê-se o que o formato diz nos primeiros
 * bytes. Cada leitor **lança** perante um ficheiro que não é do formato
 * pedido, e nunca devolve zeros: "não consegui ler" e "tem 0×0" não podem dar
 * o mesmo resultado (regra 10).
 */
import { readFileSync } from "node:fs";

export type Dimensoes = { largura: number; altura: number };

export function lerBytes(caminho: string, descricao: string): Buffer {
  try {
    return readFileSync(caminho);
  } catch (erro) {
    throw new Error(
      `não consegui ler ${descricao} (${caminho}): ${String(erro)}. Isto é um ficheiro em falta ` +
        "ou ilegível, não uma imagem com as dimensões erradas.",
    );
  }
}

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type InfoPng = Dimensoes & {
  /** 0 cinzento, 2 RGB, 3 paleta, 4 cinzento+alfa, 6 RGBA. */
  tipoDeCor: number;
  /** Há um chunk `tRNS` (transparência por paleta ou cor-chave). */
  temTrns: boolean;
};

export function lerPng(bytes: Buffer, descricao: string): InfoPng {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(ASSINATURA_PNG)) {
    throw new Error(`${descricao} não é um PNG (assinatura errada ou ficheiro truncado)`);
  }
  let temTrns = false;
  let posicao = 8;
  while (posicao + 8 <= bytes.length) {
    const comprimento = bytes.readUInt32BE(posicao);
    const tipo = bytes.toString("latin1", posicao + 4, posicao + 8);
    if (tipo === "tRNS") temTrns = true;
    if (tipo === "IEND") break;
    posicao += 12 + comprimento;
  }
  return {
    largura: bytes.readUInt32BE(16),
    altura: bytes.readUInt32BE(20),
    tipoDeCor: bytes.readUInt8(25),
    temTrns,
  };
}

/** As entradas de um `.ico`: 0 no byte de largura/altura quer dizer 256. */
export function lerIco(bytes: Buffer, descricao: string): Dimensoes[] {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    throw new Error(`${descricao} não é um .ico (cabeçalho ICONDIR errado)`);
  }
  const total = bytes.readUInt16LE(4);
  if (bytes.length < 6 + total * 16) {
    throw new Error(`${descricao}: o .ico diz ter ${String(total)} entradas e está truncado`);
  }
  const entradas: Dimensoes[] = [];
  for (let i = 0; i < total; i += 1) {
    const base = 6 + i * 16;
    entradas.push({
      largura: bytes.readUInt8(base) === 0 ? 256 : bytes.readUInt8(base),
      altura: bytes.readUInt8(base + 1) === 0 ? 256 : bytes.readUInt8(base + 1),
    });
  }
  return entradas;
}

/** As dimensões do frame SOF de um JPEG. */
export function lerJpeg(bytes: Buffer, descricao: string): Dimensoes {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) {
    throw new Error(`${descricao} não é um JPEG (falta o marcador SOI)`);
  }
  let posicao = 2;
  while (posicao + 9 < bytes.length) {
    if (bytes.readUInt8(posicao) !== 0xff) {
      posicao += 1;
      continue;
    }
    const marcador = bytes.readUInt8(posicao + 1);
    if (marcador === 0xff) {
      posicao += 1;
      continue;
    }
    const eSof = marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador);
    if (eSof) {
      return { altura: bytes.readUInt16BE(posicao + 5), largura: bytes.readUInt16BE(posicao + 7) };
    }
    posicao += 2 + bytes.readUInt16BE(posicao + 2);
  }
  throw new Error(`${descricao}: JPEG sem marcador SOF, não consegui ler as dimensões`);
}

export type InfoWebp = Dimensoes & { formato: "VP8" | "VP8L" | "VP8X"; temAlfa: boolean };

/** WebP simples (lossy ou lossless) ou estendido. */
export function lerWebp(bytes: Buffer, descricao: string): InfoWebp {
  if (
    bytes.length < 30 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WEBP"
  ) {
    throw new Error(`${descricao} não é um WebP (falta RIFF/WEBP)`);
  }
  const fatia = bytes.toString("latin1", 12, 16);
  if (fatia === "VP8X") {
    const bandeiras = bytes.readUInt8(20);
    return {
      formato: "VP8X",
      temAlfa: (bandeiras & 0x10) !== 0,
      largura: 1 + bytes.readUIntLE(24, 3),
      altura: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (fatia === "VP8 ") {
    return {
      formato: "VP8",
      temAlfa: false,
      largura: bytes.readUInt16LE(26) & 0x3fff,
      altura: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (fatia === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return {
      formato: "VP8L",
      temAlfa: ((bits >>> 28) & 1) === 1,
      largura: (bits & 0x3fff) + 1,
      altura: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  throw new Error(`${descricao}: chunk WebP desconhecido «${fatia}»`);
}
