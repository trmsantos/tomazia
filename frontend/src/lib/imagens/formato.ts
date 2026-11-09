/**
 * Reconhecer um formato de imagem pelos primeiros bytes — nunca pela
 * extensão do nome nem pelo `Content-Type` que o browser deu ao ficheiro
 * (F3-05, secção 7). Os dois vêm do sistema operativo, não dos bytes, e um
 * `.jpg` pode ser um HEIC renomeado.
 *
 * `detetarFormato` responde a duas perguntas diferentes, de propósito:
 * "que formato é este?" (`"jpeg" | "png" | "webp" | "heic" | "heif" |
 * "avif"`) e "é um dos três que o backend aceita?" (`FORMATOS_ACEITES`). Um
 * HEIC é **reconhecido e recusado**; dez bytes aleatórios não são
 * reconhecidos — são perguntas diferentes, e é `reduzir.ts` quem decide o
 * que fazer com cada uma.
 *
 * `FORMATOS_ACEITES` espelha `backend/app/services/imagens.py` — é lá que o
 * Pillow decide de verdade, e `formato.test.ts` prende a divergência.
 */

export type FormatoReconhecido = "jpeg" | "png" | "webp" | "heic" | "heif" | "avif";

/** Os três formatos que `POST /fotos` aceita, em minúsculas. */
export const FORMATOS_ACEITES: readonly string[] = ["jpeg", "png", "webp"];

/** Os bytes de `bytes[inicio, fim)`, lidos como ASCII — só para assinaturas. */
function comoAscii(bytes: Uint8Array, inicio: number, fim: number): string {
  if (bytes.length < fim) return "";
  return String.fromCharCode(...bytes.slice(inicio, fim));
}

function eJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function ePng(bytes: Uint8Array): boolean {
  const ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= ASSINATURA.length && ASSINATURA.every((valor, i) => bytes[i] === valor);
}

function eWebp(bytes: Uint8Array): boolean {
  // RIFF <4 bytes de tamanho, irrelevantes aqui> WEBP
  return (
    bytes.length >= 12 && comoAscii(bytes, 0, 4) === "RIFF" && comoAscii(bytes, 8, 12) === "WEBP"
  );
}

/**
 * A marca principal de uma caixa `ftyp` do ISOBMFF — o contentor do HEIC,
 * do HEIF e do AVIF — ou `null` se não há caixa `ftyp` nenhuma. O tamanho da
 * caixa (os primeiros 4 bytes) não interessa aqui: só a posição da marca,
 * que é sempre a mesma, a seguir ao literal `ftyp`.
 */
function marcaPrincipalIsobmff(bytes: Uint8Array): string | null {
  if (bytes.length < 12 || comoAscii(bytes, 4, 8) !== "ftyp") return null;
  return comoAscii(bytes, 8, 12);
}

const MARCAS_HEIC = new Set(["heic", "heix"]);
const MARCAS_HEIF = new Set(["mif1", "msf1"]);
const MARCAS_AVIF = new Set(["avif", "avis"]);

export function detetarFormato(bytes: Uint8Array): FormatoReconhecido | null {
  if (eJpeg(bytes)) return "jpeg";
  if (ePng(bytes)) return "png";
  if (eWebp(bytes)) return "webp";

  const marca = marcaPrincipalIsobmff(bytes);
  if (marca !== null) {
    if (MARCAS_HEIC.has(marca)) return "heic";
    if (MARCAS_AVIF.has(marca)) return "avif";
    if (MARCAS_HEIF.has(marca)) return "heif";
  }

  return null;
}
