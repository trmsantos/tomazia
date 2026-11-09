// @vitest-environment node
/**
 * F3-05, secção 7 — reconhecer um formato de imagem pelos primeiros bytes,
 * nunca pela extensão do nome nem pelo `Content-Type` que o browser deu ao
 * ficheiro (os dois vêm do sistema operativo, não dos bytes, e um `.jpg`
 * pode ser um HEIC renomeado).
 *
 * `src/lib/imagens/formato.ts` ainda não existe — é isto que a implementação
 * tem de escrever para este ficheiro passar:
 *
 *  - `detetarFormato(bytes: Uint8Array): "jpeg" | "png" | "webp" | "heic" |
 *    "heif" | "avif" | null` — `null` é "não reconheço estes bytes como
 *    imagem nenhuma", nunca "não é um dos três aceites". São perguntas
 *    diferentes: um HEIC é reconhecido e recusado; lixo não é reconhecido.
 *  - `FORMATOS_ACEITES: readonly string[]` — os três que o backend aceita
 *    (`"jpeg"`, `"png"`, `"webp"`), em minúsculas.
 *
 * **Prova:** JPEG, PNG e WebP reconhecidos pelos bytes mágicos; HEIC, HEIF,
 * AVIF e lixo recusados — "recusado" quer dizer fora de `FORMATOS_ACEITES`,
 * e para os três primeiros quer dizer também **reconhecido e recusado**,
 * não confundido com lixo. E que a lista de formatos aceites não diverge da
 * do backend, que é quem decide de verdade (`app/services/imagens.py`).
 *
 * **Deixa passar:** uma imagem corrompida a seguir aos primeiros bytes — só
 * o Pillow, do lado do servidor, decodifica a imagem inteira. Esta função
 * olha só para a assinatura, como o `file(1)` do Unix.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_REPOSITORIO } from "../../testes/percorrer-arvore";
// Módulo da F3-05, ainda por escrever: é suposto este import falhar (em
// `tsc` e em tempo de execução) até `./formato.ts` existir — essa é a
// primeira falha que confirma que este ficheiro ainda não foi feito, antes
// de qualquer asserção correr.
import { FORMATOS_ACEITES, detetarFormato } from "./formato";

/** Os códigos de carácter ASCII de `texto`, como números. */
function ascii(texto: string): number[] {
  return [...texto].map((caracter) => caracter.charCodeAt(0));
}

/** Um `uint32` em big-endian, como quatro bytes. É assim que o ISOBMFF escreve o tamanho de uma caixa. */
function uint32BE(valor: number): number[] {
  return [(valor >>> 24) & 0xff, (valor >>> 16) & 0xff, (valor >>> 8) & 0xff, valor & 0xff];
}

/** JPEG: `FF D8 FF`, seguido do que vier — aqui, um marcador `APP0` mínimo. */
const JPEG_MINIMO = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00]);

/** PNG: a assinatura fixa de 8 bytes. */
const PNG_MINIMO = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** WebP: `RIFF`, 4 bytes de tamanho (irrelevantes aqui), `WEBP`. */
const WEBP_MINIMO = Uint8Array.from([...ascii("RIFF"), 0x00, 0x00, 0x00, 0x00, ...ascii("WEBP")]);

/**
 * Uma caixa `ftyp` do ISOBMFF (o contentor do HEIC, do HEIF e do AVIF):
 * tamanho (4 bytes), `ftyp`, a marca principal (4 bytes), a versão menor (4
 * bytes, irrelevante aqui) e zero ou mais marcas compatíveis.
 */
function caixaFtyp(marcaPrincipal: string, marcasCompativeis: string[] = []): Uint8Array {
  const corpo = [
    ...ascii("ftyp"),
    ...ascii(marcaPrincipal),
    0x00,
    0x00,
    0x00,
    0x00,
    ...marcasCompativeis.flatMap((marca) => ascii(marca)),
  ];
  return Uint8Array.from([...uint32BE(corpo.length + 4), ...corpo]);
}

/** Um HEIC real de telemóvel: marca principal `heic`, compatível com `mif1`. */
const HEIC_MINIMO = caixaFtyp("heic", ["mif1", "heic"]);

/** HEIF genérico (a mesma caixa do HEIC, mas a marca principal é o contentor). */
const HEIF_MINIMO = caixaFtyp("mif1", ["heic"]);

/** AVIF: a mesma caixa, marca principal `avif`. */
const AVIF_MINIMO = caixaFtyp("avif", ["mif1", "miaf"]);

/** Bytes que não são o início de imagem nenhuma que se conheça. */
const LIXO = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);

/** Um ficheiro de texto comum, para o caso de alguém enviar o `.txt` errado. */
const TEXTO_PURO = Uint8Array.from(ascii("Isto nao e uma imagem, e um poema.\n"));

describe("os três formatos que o backend aceita, pelos bytes mágicos", () => {
  it.each([
    ["jpeg", JPEG_MINIMO],
    ["png", PNG_MINIMO],
    ["webp", WEBP_MINIMO],
  ] as const)("%s é reconhecido", (esperado, bytes) => {
    expect(detetarFormato(bytes)).toBe(esperado);
  });

  it("os três, e só os três, estão em FORMATOS_ACEITES", () => {
    expect([...FORMATOS_ACEITES].sort()).toEqual(["jpeg", "png", "webp"]);
  });

  it.each([
    ["jpeg", JPEG_MINIMO],
    ["png", PNG_MINIMO],
    ["webp", WEBP_MINIMO],
  ] as const)("%s está em FORMATOS_ACEITES", (_esperado, bytes) => {
    const formato = detetarFormato(bytes);
    expect(formato).not.toBeNull();
    expect(FORMATOS_ACEITES).toContain(formato);
  });
});

describe("HEIC, HEIF e AVIF: reconhecidos, e recusados", () => {
  // "Recusado" não é o mesmo que "desconhecido": um HEIC de iPhone é
  // perfeitamente reconhecível pelos bytes — é a razão de existir da
  // redução no browser (secção 7.1, "é o mesmo passo que faz o HEIC de um
  // iPhone chegar ao backend como algo que o Pillow consegue abrir"). Se
  // `detetarFormato` devolvesse `null` para um HEIC, o ecrã não saberia
  // distinguir "preciso de converter isto" de "isto não é uma foto".
  it.each([
    ["heic", HEIC_MINIMO],
    ["heif", HEIF_MINIMO],
    ["avif", AVIF_MINIMO],
  ] as const)("%s é reconhecido, mas não está em FORMATOS_ACEITES", (esperado, bytes) => {
    const formato = detetarFormato(bytes);
    expect(formato).toBe(esperado);
    expect(FORMATOS_ACEITES).not.toContain(formato);
  });
});

describe("lixo: nem reconhecido, nem aceite", () => {
  it.each([
    ["bytes aleatórios", LIXO],
    ["texto puro", TEXTO_PURO],
    ["vazio", new Uint8Array(0)],
    ["demasiado curto para qualquer assinatura", Uint8Array.from([0xff, 0xd8])],
  ])("%s dá null — não um formato inventado", (_nome, bytes) => {
    expect(detetarFormato(bytes)).toBeNull();
  });

  it("null nunca está em FORMATOS_ACEITES (guarda do óbvio)", () => {
    expect(FORMATOS_ACEITES).not.toContain(null);
  });
});

describe("autoteste das fixtures: as caixas ISOBMFF estão bem construídas", () => {
  // Sem isto, uma fixtura mal montada (um `ftyp` com o tamanho errado, por
  // exemplo) podia por acidente ser recusada por um motivo que nada tem a
  // ver com a marca — e os três testes de cima passavam a provar outra
  // coisa qualquer.
  it("o tamanho da caixa ftyp condiz com os bytes que ela contém", () => {
    for (const caixa of [HEIC_MINIMO, HEIF_MINIMO, AVIF_MINIMO]) {
      const tamanhoDeclarado = (caixa[0]! << 24) | (caixa[1]! << 16) | (caixa[2]! << 8) | caixa[3]!;
      expect(tamanhoDeclarado).toBe(caixa.length);
      expect(String.fromCharCode(...caixa.slice(4, 8))).toBe("ftyp");
    }
  });
});

/**
 * A verdade sobre o que o backend aceita vive em
 * `backend/app/services/imagens.py`, não de memória — é lá que o Pillow
 * decide, e é o `FORMATOS_ACEITES` desse módulo que conta.
 */
function formatosDoBackend(): string[] {
  const caminho = join(RAIZ_REPOSITORIO, "backend", "app", "services", "imagens.py");
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf-8");
  } catch (erro) {
    throw new Error(
      `Não consegui ler ${caminho}. Isto é uma falha de leitura, não uma lista que ` +
        `diverge: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  const declaracao = /FORMATOS_ACEITES\s*=\s*frozenset\(\s*\{([^}]*)\}\s*\)/.exec(texto);
  if (declaracao?.[1] === undefined) {
    throw new Error(
      "Não consegui encontrar «FORMATOS_ACEITES = frozenset({...})» em " +
        "backend/app/services/imagens.py. Isto é uma falha de leitura — talvez o " +
        "nome ou a forma da constante tenham mudado — não uma lista a condizer.",
    );
  }

  const nomes = [...declaracao[1].matchAll(/"([A-Za-z]+)"/g)].map((achado) =>
    (achado[1] ?? "").toLowerCase(),
  );
  if (nomes.length === 0) {
    throw new Error(
      "Encontrei «FORMATOS_ACEITES» no backend mas não consegui ler nomes lá dentro.",
    );
  }
  return nomes;
}

describe("a lista de formatos aceites não diverge da do backend", () => {
  it("FORMATOS_ACEITES do frontend é exactamente o do backend.app.services.imagens", () => {
    const doBackend = formatosDoBackend().sort();
    const doFrontend = [...FORMATOS_ACEITES].sort();

    expect(
      doFrontend,
      `backend/app/services/imagens.py aceita ${JSON.stringify(doBackend)} (Pillow decide), ` +
        `e o frontend aceita ${JSON.stringify(doFrontend)}. Uma divergência aqui é silenciosa ` +
        "em produção: o frontend recusaria (ou aceitaria sem reduzir) um formato que o " +
        "servidor trata ao contrário — só se vê numa foto real a falhar.",
    ).toEqual(doBackend);
  });
});
