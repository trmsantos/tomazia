import { FORMATOS_ACEITES, detetarFormato } from "./formato";

/**
 * A redução de imagem no browser (F3-05, secção 7).
 *
 * Decodifica a imagem escolhida (incluindo HEIC, nos browsers que o sabem
 * fazer — é o mesmo passo que faz o HEIC de um iPhone chegar ao backend
 * como algo que o Pillow consegue abrir) e, se o lado maior ultrapassar
 * 2000 px, reduz **mantendo a proporção original**: nunca força quadrado,
 * nunca recorta — o corte é só da grelha pública.
 *
 * **Seis estados, nunca uma rejeição.** Um `<input type="file">` com uma
 * foto escolhida não pode acabar numa promessa rejeitada dentro de
 * `FolhaEnviarFoto.tsx`: o resultado é um valor que entra num `useState`,
 * e o React 19 não tem onde apanhar um erro não tratado nesse caminho (o
 * `App.tsx` não tem error boundary nenhuma).
 *
 * `document.createElement("canvas")`, nunca `new OffscreenCanvas(...)`: é
 * o que torna `getContext`/`toBlob` controláveis nos testes, e o Safari só
 * tem `OffscreenCanvas` a partir da 16.4.
 *
 * `{ imageOrientation: "from-image" }` no `createImageBitmap` **não é
 * cosmético**: o backend faz `ImageOps.exif_transpose`, e o `<canvas>` deita
 * fora a etiqueta EXIF. Sem isto, uma foto de iPhone em retrato chegava ao
 * servidor deitada, e o servidor já não teria etiqueta nenhuma para a
 * corrigir.
 */

export type ResultadoDaReducao =
  | { estado: "reduzida"; ficheiro: Blob }
  | { estado: "sem-mudanca"; ficheiro: Blob }
  | { estado: "nao-descodificou" }
  | { estado: "nao-codificou" }
  | { estado: "sem-contexto" }
  | { estado: "demorou-demais" };

/** O lado maior, em píxeis, depois da redução (`docs/ecras/F3-05.md`, 7.1). */
const LIMITE_DO_LADO_MAIOR_PX = 2000;

/** `canvas.toBlob(cb, "image/jpeg", 0.82)` — a saída é sempre JPEG. */
const TIPO_DE_SAIDA = "image/jpeg";
const QUALIDADE_DE_SAIDA = 0.82;

/** O maior prazo razoável para uma decodificação, mesmo num telemóvel velho com uma foto de 48 MP. */
const PRAZO_PADRAO_MS = 30_000;

/** Bytes suficientes para qualquer assinatura que `detetarFormato` reconheça. */
const BYTES_DA_ASSINATURA = 32;

/** Um valor que não é um erro real nenhum, só para `comPrazo` distinguir "o prazo venceu" de "a promessa rejeitou". */
const PRAZO_ESGOTADO = Symbol("prazo-esgotado");

/**
 * Corre `promessa` contra um temporizador de `prazoMs`. Rejeita com
 * `PRAZO_ESGOTADO` se o prazo vencer primeiro — nunca com um erro de
 * verdade, para `reduzir()` poder distinguir as duas causas no `catch`.
 */
function comPrazo<T>(promessa: Promise<T>, prazoMs: number): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const temporizador = setTimeout(() => {
      rejeitar(PRAZO_ESGOTADO);
    }, prazoMs);

    promessa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolver(valor);
      },
      (erro: unknown) => {
        clearTimeout(temporizador);
        rejeitar(erro);
      },
    );
  });
}

/**
 * `createImageBitmap` pode rejeitar **ou** lançar de forma síncrona,
 * consoante o browser e o motivo da falha. Os dois viram a mesma promessa
 * rejeitada, para quem chama só ter um caminho a tratar.
 */
function decodificar(ficheiro: Blob): Promise<ImageBitmap> {
  try {
    return Promise.resolve(createImageBitmap(ficheiro, { imageOrientation: "from-image" }));
  } catch (erro) {
    return Promise.reject(erro);
  }
}

/** O formato original já é um dos três que o backend aceita? Lido dos bytes, nunca do `Blob.type`. */
async function formatoJaAceitavel(ficheiro: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await ficheiro.slice(0, BYTES_DA_ASSINATURA).arrayBuffer());
  const formato = detetarFormato(bytes);
  return formato !== null && FORMATOS_ACEITES.includes(formato);
}

/**
 * Com a imagem já decodificada: decide se há alguma coisa a mudar e, se
 * houver, redesenha num `<canvas>` e recodifica. `bitmap` continua a ser
 * responsabilidade de quem chama fechar.
 */
async function reencodarSePreciso(
  ficheiroOriginal: Blob,
  bitmap: ImageBitmap,
): Promise<ResultadoDaReducao> {
  const maiorLado = Math.max(bitmap.width, bitmap.height);
  const precisaReduzirPorTamanho = maiorLado > LIMITE_DO_LADO_MAIOR_PX;

  // Um ficheiro já pequeno e já num formato aceite não tem nada a ganhar em
  // passar pelo canvas — sai com o MESMO Blob, sem recodificar.
  if (!precisaReduzirPorTamanho && (await formatoJaAceitavel(ficheiroOriginal))) {
    return { estado: "sem-mudanca", ficheiro: ficheiroOriginal };
  }

  const fator = precisaReduzirPorTamanho ? LIMITE_DO_LADO_MAIOR_PX / maiorLado : 1;
  const largura = Math.round(bitmap.width * fator);
  const altura = Math.round(bitmap.height * fator);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;

  const contexto = canvas.getContext("2d");
  if (contexto === null) return { estado: "sem-contexto" };

  contexto.drawImage(bitmap, 0, 0, largura, altura);

  const blob = await new Promise<Blob | null>((resolver) => {
    canvas.toBlob(
      (resultado) => {
        resolver(resultado);
      },
      TIPO_DE_SAIDA,
      QUALIDADE_DE_SAIDA,
    );
  });

  if (blob === null) return { estado: "nao-codificou" };

  return { estado: "reduzida", ficheiro: blob };
}

export async function reduzir(
  ficheiro: Blob,
  opcoes?: { prazoMs?: number },
): Promise<ResultadoDaReducao> {
  const prazoMs = opcoes?.prazoMs ?? PRAZO_PADRAO_MS;

  let bitmap: ImageBitmap;
  try {
    bitmap = await comPrazo(decodificar(ficheiro), prazoMs);
  } catch (erro) {
    if (erro === PRAZO_ESGOTADO) return { estado: "demorou-demais" };
    return { estado: "nao-descodificou" };
  }

  try {
    return await reencodarSePreciso(ficheiro, bitmap);
  } catch {
    // Nunca visto nos testes de hoje, mas "nunca lança" é a garantia
    // inteira deste módulo (ver o cabeçalho): um passo imprevisto a meio
    // da recodificação não pode escapar como excepção não apanhada.
    return { estado: "nao-codificou" };
  } finally {
    bitmap.close();
  }
}
