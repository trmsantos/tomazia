/**
 * Ler um `.woff2` o bastante para responder a três perguntas: tem este
 * glifo, traz este recurso tipográfico, e entre que valores vai cada eixo.
 *
 * R-01, Tarefa 6. As duas faces do redesign são variáveis e recortadas à
 * mão (ver `public/fontes/PROVENIENCIA.md`); um recorte errado — um `ã` que
 * ficou de fora, um `tnum` que o `pyftsubset` deitou fora, um eixo `wght`
 * mais largo do que o nome diz — não dá erro em lado nenhum. O browser
 * cai na fonte de sistema para essa letra, ou desalinha os preços, e só se
 * vê no ecrã. Estes testes leem os bytes que vão para produção.
 *
 * Só `node:zlib` (o Brotli do próprio Node): nada de dependência nova para
 * um leitor que precisa de `cmap`, `GSUB`, `fvar` e `head`. As tabelas
 * `glyf`/`loca`/`hmtx`, que o WOFF2 guarda transformadas, nunca se
 * desfazem: só se saltam.
 *
 * Regra 10: um ficheiro que não se consegue ler **lança** "Não consegui
 * ler", nunca devolve "não tem o glifo". As duas respostas têm de ser
 * distinguíveis, senão um caminho errado passa por uma fonte sem `ã`, ou,
 * pior, uma leitura falhada que devolvesse `true` passava por uma fonte
 * completa. O autoteste está em `src/styles/fontes.test.ts`.
 *
 * Só para testes: nada em `src/` de produção importa isto.
 */
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

/** As tabelas de uma fonte, por etiqueta (`"cmap"`, `"GSUB"`, …). */
export type TabelasWoff2 = Map<string, Buffer>;

export type EixoVariavel = { tag: string; min: number; max: number };

/**
 * As 63 etiquetas conhecidas do WOFF2 (secção 5.2 da especificação do W3C),
 * pela ordem do índice que o byte de bandeiras guarda.
 */
const ETIQUETAS_CONHECIDAS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
]; // prettier-ignore

const TAMANHO_DO_CABECALHO = 48;

function naoConsegui(origem: string, motivo: string): Error {
  return new Error(
    `Não consegui ler ${origem} como woff2: ${motivo}. ` +
      "Isto é uma falha de leitura, não uma resposta sobre a fonte.",
  );
}

/** Lê um `UIntBase128` do WOFF2 e devolve o valor e a posição seguinte. */
function lerBase128(dados: Buffer, posicao: number, origem: string): [number, number] {
  let valor = 0;
  for (let i = 0; i < 5; i += 1) {
    if (posicao + i >= dados.length) throw naoConsegui(origem, "diretório cortado");
    const byte = dados[posicao + i] ?? 0;
    if (i === 0 && byte === 0x80) throw naoConsegui(origem, "UIntBase128 com zero à esquerda");
    if (valor & 0xfe000000) throw naoConsegui(origem, "UIntBase128 maior do que 32 bits");
    valor = (valor << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [valor >>> 0, posicao + i + 1];
  }
  throw naoConsegui(origem, "UIntBase128 com mais de 5 bytes");
}

/**
 * As tabelas de um `.woff2`, já descomprimidas. As transformadas (`glyf`,
 * `loca` e, se for o caso, `hmtx`) ficam com os bytes transformados: não
 * servem para ler glifos, e nenhuma pergunta daqui precisa delas.
 */
export function lerTabelasWoff2(caminho: string): TabelasWoff2 {
  let dados: Buffer;
  try {
    dados = readFileSync(caminho);
  } catch (erro) {
    throw naoConsegui(caminho, `o ficheiro não abriu (${String(erro)})`);
  }

  if (dados.length < TAMANHO_DO_CABECALHO)
    throw naoConsegui(caminho, "mais curto do que o cabeçalho");
  if (dados.toString("latin1", 0, 4) !== "wOF2") {
    throw naoConsegui(caminho, "a assinatura não é wOF2");
  }
  if (dados.toString("latin1", 4, 8) === "ttcf") {
    throw naoConsegui(caminho, "é uma coleção (ttcf), que este leitor não percorre");
  }
  if (dados.readUInt32BE(8) !== dados.length) {
    throw naoConsegui(caminho, "o comprimento do cabeçalho não é o do ficheiro");
  }

  const numeroDeTabelas = dados.readUInt16BE(12);
  const tamanhoComprimido = dados.readUInt32BE(20);
  if (numeroDeTabelas === 0) throw naoConsegui(caminho, "não declara nenhuma tabela");

  const diretorio: { etiqueta: string; tamanho: number }[] = [];
  let posicao = TAMANHO_DO_CABECALHO;
  for (let i = 0; i < numeroDeTabelas; i += 1) {
    if (posicao >= dados.length) throw naoConsegui(caminho, "diretório cortado");
    const bandeiras = dados[posicao] ?? 0;
    posicao += 1;

    const indice = bandeiras & 0x3f;
    let etiqueta: string;
    if (indice === 0x3f) {
      if (posicao + 4 > dados.length) throw naoConsegui(caminho, "diretório cortado");
      etiqueta = dados.toString("latin1", posicao, posicao + 4);
      posicao += 4;
    } else {
      const conhecida = ETIQUETAS_CONHECIDAS[indice];
      if (conhecida === undefined) throw naoConsegui(caminho, `índice de etiqueta ${indice}`);
      etiqueta = conhecida;
    }

    let tamanhoOriginal: number;
    [tamanhoOriginal, posicao] = lerBase128(dados, posicao, caminho);

    // Para `glyf` e `loca` a versão 0 é a transformação e a 3 é a nula;
    // para as outras é ao contrário. Só as transformadas trazem o
    // comprimento transformado, e é esse que ocupa o fluxo.
    const versao = (bandeiras >> 6) & 0x3;
    const transformada = etiqueta === "glyf" || etiqueta === "loca" ? versao !== 3 : versao !== 0;
    let tamanho = tamanhoOriginal;
    if (transformada) {
      [tamanho, posicao] = lerBase128(dados, posicao, caminho);
    }
    diretorio.push({ etiqueta, tamanho });
  }

  if (posicao + tamanhoComprimido > dados.length) {
    throw naoConsegui(caminho, "o bloco comprimido passa do fim do ficheiro");
  }

  let fluxo: Buffer;
  try {
    fluxo = brotliDecompressSync(dados.subarray(posicao, posicao + tamanhoComprimido));
  } catch (erro) {
    throw naoConsegui(caminho, `o Brotli recusou o bloco comprimido (${String(erro)})`);
  }

  const tabelas: TabelasWoff2 = new Map();
  let deslocamento = 0;
  for (const { etiqueta, tamanho } of diretorio) {
    if (deslocamento + tamanho > fluxo.length) {
      throw naoConsegui(caminho, `a tabela ${etiqueta} passa do fim do bloco descomprimido`);
    }
    tabelas.set(etiqueta, fluxo.subarray(deslocamento, deslocamento + tamanho));
    deslocamento += tamanho;
  }
  if (deslocamento !== fluxo.length) {
    throw naoConsegui(caminho, "sobram bytes no bloco descomprimido");
  }
  return tabelas;
}

function tabelaObrigatoria(tabelas: TabelasWoff2, etiqueta: string): Buffer {
  const tabela = tabelas.get(etiqueta);
  if (tabela === undefined) {
    throw new Error(
      `Não consegui ler a tabela ${etiqueta}: a fonte não a tem. ` +
        "Sem ela não há resposta, nem sim nem não.",
    );
  }
  return tabela;
}

/** O glifo de `codepoint` num subtabela de formato 4 (BMP). */
function procurarNoFormato4(cmap: Buffer, inicio: number, codepoint: number): number {
  if (codepoint > 0xffff) return 0;
  const segmentos = cmap.readUInt16BE(inicio + 6) / 2;
  const fins = inicio + 14;
  const comecos = fins + segmentos * 2 + 2;
  const deltas = comecos + segmentos * 2;
  const deslocamentos = deltas + segmentos * 2;
  for (let i = 0; i < segmentos; i += 1) {
    const fim = cmap.readUInt16BE(fins + i * 2);
    if (codepoint > fim) continue;
    const comeco = cmap.readUInt16BE(comecos + i * 2);
    if (codepoint < comeco) return 0;
    const delta = cmap.readInt16BE(deltas + i * 2);
    const posicaoDoDeslocamento = deslocamentos + i * 2;
    const deslocamento = cmap.readUInt16BE(posicaoDoDeslocamento);
    if (deslocamento === 0) return (codepoint + delta) & 0xffff;
    const glifo = cmap.readUInt16BE(
      posicaoDoDeslocamento + deslocamento + (codepoint - comeco) * 2,
    );
    return glifo === 0 ? 0 : (glifo + delta) & 0xffff;
  }
  return 0;
}

/** O glifo de `codepoint` num subtabela de formato 12 (Unicode completo). */
function procurarNoFormato12(cmap: Buffer, inicio: number, codepoint: number): number {
  const grupos = cmap.readUInt32BE(inicio + 12);
  for (let i = 0; i < grupos; i += 1) {
    const grupo = inicio + 16 + i * 12;
    const comeco = cmap.readUInt32BE(grupo);
    const fim = cmap.readUInt32BE(grupo + 4);
    if (codepoint >= comeco && codepoint <= fim) {
      return cmap.readUInt32BE(grupo + 8) + (codepoint - comeco);
    }
  }
  return 0;
}

/**
 * Se a fonte desenha `codepoint`: verdadeiro quando o `cmap` o põe num
 * glifo que não é o `.notdef`. Lança se não houver um subtabela Unicode
 * legível — "não consegui procurar" não é "não tem".
 */
export function temGlifo(tabelas: TabelasWoff2, codepoint: number): boolean {
  const cmap = tabelaObrigatoria(tabelas, "cmap");
  try {
    const registos = cmap.readUInt16BE(2);
    let melhor: { formato: number; inicio: number } | undefined;
    for (let i = 0; i < registos; i += 1) {
      const registo = 4 + i * 8;
      const plataforma = cmap.readUInt16BE(registo);
      const codificacao = cmap.readUInt16BE(registo + 2);
      const inicio = cmap.readUInt32BE(registo + 4);
      const unicode =
        plataforma === 0 || (plataforma === 3 && (codificacao === 1 || codificacao === 10));
      if (!unicode) continue;
      const formato = cmap.readUInt16BE(inicio);
      if (formato === 12 && melhor?.formato !== 12) melhor = { formato, inicio };
      else if (formato === 4 && melhor === undefined) melhor = { formato, inicio };
    }
    if (melhor === undefined) {
      throw new Error("Não consegui ler o cmap: não tem um subtabela Unicode de formato 4 ou 12.");
    }
    const glifo =
      melhor.formato === 12
        ? procurarNoFormato12(cmap, melhor.inicio, codepoint)
        : procurarNoFormato4(cmap, melhor.inicio, codepoint);
    return glifo !== 0;
  } catch (erro) {
    if (erro instanceof RangeError) {
      throw new Error(`Não consegui ler o cmap: passa do fim da tabela (${erro.message}).`);
    }
    throw erro;
  }
}

/** As etiquetas da lista de recursos do `GSUB` (`"liga"`, `"tnum"`, …), sem repetidos. */
export function recursosGsub(tabelas: TabelasWoff2): string[] {
  const gsub = tabelaObrigatoria(tabelas, "GSUB");
  try {
    const lista = gsub.readUInt16BE(6);
    const quantos = gsub.readUInt16BE(lista);
    const etiquetas = new Set<string>();
    for (let i = 0; i < quantos; i += 1) {
      const registo = lista + 2 + i * 6;
      etiquetas.add(gsub.toString("latin1", registo, registo + 4));
    }
    return [...etiquetas].sort();
  } catch (erro) {
    throw new Error(`Não consegui ler o GSUB: ${String(erro)}`);
  }
}

/** Os eixos de uma fonte variável, com o mínimo e o máximo. Lança se não houver `fvar`. */
export function eixosFvar(tabelas: TabelasWoff2): EixoVariavel[] {
  const fvar = tabelaObrigatoria(tabelas, "fvar");
  try {
    const inicio = fvar.readUInt16BE(4);
    const quantos = fvar.readUInt16BE(8);
    const tamanho = fvar.readUInt16BE(10);
    const eixos: EixoVariavel[] = [];
    for (let i = 0; i < quantos; i += 1) {
      const eixo = inicio + i * tamanho;
      eixos.push({
        tag: fvar.toString("latin1", eixo, eixo + 4),
        min: fvar.readInt32BE(eixo + 4) / 65536,
        max: fvar.readInt32BE(eixo + 12) / 65536,
      });
    }
    return eixos;
  } catch (erro) {
    throw new Error(`Não consegui ler o fvar: ${String(erro)}`);
  }
}

/**
 * O `head.fontRevision` como vai no nome do ficheiro: `1.001` → `"1_001"`.
 * Três casas, como o arredonda o próprio fonttools.
 */
export function revisaoDaFonte(tabelas: TabelasWoff2): string {
  const head = tabelaObrigatoria(tabelas, "head");
  if (head.length < 8) throw new Error("Não consegui ler o head: mais curto do que 8 bytes.");
  return (head.readInt32BE(4) / 65536).toFixed(3).replace(".", "_");
}
