/**
 * A API dos clientes na gestão (F4-05b): a lista, eliminar um cliente e o CSV.
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa). Os erros chegam como
 * `ErroDaApi`: `estado === null` é «não houve resposta», e num `DELETE` isso quer dizer **não sei
 * se foi eliminado** — por isso este módulo **nunca repete** um pedido por conta própria.
 *
 * `obterClientes` **recusa** um corpo que não sabe ler (incluindo uma `consentimento_em` que o
 * `Date` não lê) com um `ErroDaApi` de estado 200: o ecrã mostra o erro de carregar e nunca «não há
 * clientes» (regra 10). `eliminarCliente` devolve o erro **tal como veio**: é o ecrã que decide que
 * só um `404` com `cliente_inexistente` é «já não existia».
 *
 * `descarregarClientesCsv` devolve o ficheiro **tal como o servidor o enviou**, em bytes, num
 * endereço `data:` (a CSP de produção proíbe `blob:`, por isso nunca há `createObjectURL`).
 */
import { ErroDaApi, type OpcoesDePedido, pedir, pedirBytes, pedirEliminacao } from "./cliente";
import type { components, paths } from "./gerado/esquema";
import { partesEmLisboa } from "../formato/data-do-evento";

const CAMINHO_CLIENTES = "/gestao/clientes" satisfies keyof paths;
const CAMINHO_CLIENTE = "/gestao/clientes/{id}" satisfies keyof paths;
const CAMINHO_CSV = "/gestao/clientes.csv" satisfies keyof paths;

export type ClienteGestao = components["schemas"]["ClienteGestao"];
export type RespostaClientes = components["schemas"]["RespostaClientes"];
export type CsvDeClientes = { nome: string; href: string };

const ILEGIVEL = "Os clientes chegaram num formato que não se sabe ler.";

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function eClienteLegivel(valor: unknown): boolean {
  return (
    eObjeto(valor) &&
    typeof valor["id"] === "number" &&
    typeof valor["nome"] === "string" &&
    typeof valor["email"] === "string" &&
    (valor["telemovel"] === null || typeof valor["telemovel"] === "string") &&
    typeof valor["consentimento_em"] === "string" &&
    !Number.isNaN(new Date(valor["consentimento_em"]).getTime())
  );
}

function lerClientes(corpo: unknown): RespostaClientes {
  if (!eObjeto(corpo)) throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
  const clientes = corpo["clientes"];
  if (!Array.isArray(clientes) || !clientes.every(eClienteLegivel)) {
    throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
  }
  return corpo as RespostaClientes;
}

/** Só um inteiro positivo entra num caminho: nada de `../` nem de `NaN` num endereço. */
function exigirId(id: number): string {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new RangeError("O id de um cliente é um inteiro positivo.");
  }
  return String(id);
}

/** `GET /api/gestao/clientes` — todos, sem paginação, do mais recente para o mais antigo. */
export async function obterClientes(opcoes?: OpcoesDePedido): Promise<RespostaClientes> {
  return lerClientes(await pedir<unknown>(CAMINHO_CLIENTES, opcoes));
}

/** `DELETE /api/gestao/clientes/{id}` — 204 sem corpo; 404 `cliente_inexistente`, 422 ou 5xx. Não repete. */
export function eliminarCliente(id: number, opcoes?: OpcoesDePedido): Promise<void> {
  // Sem `async`: um id mau lança já, antes de qualquer pedido.
  return pedirEliminacao(CAMINHO_CLIENTE.replace("{id}", exigirId(id)), opcoes);
}

// --- O CSV -----------------------------------------------------------------------------------------

const NOME_VALIDO = /^clientes-\d{4}-\d{2}-\d{2}\.csv$/;
const PARAMETRO_FILENAME = /^\s*filename\s*=\s*(.*)$/i;

/** `clientes-AAAA-MM-DD.csv` com a data de hoje em Lisboa (em UTC só se o aparelho não souber Lisboa). */
function nomeDeReserva(): string {
  const agora = new Date();
  let ano: number;
  let mes: number;
  let dia: number;
  try {
    ({ ano, mes, dia } = partesEmLisboa(agora));
  } catch {
    // Só o nome do ficheiro depende disto, e os bytes são os do servidor: um dia de diferença
    // num nome é melhor do que não exportar.
    ano = agora.getUTCFullYear();
    mes = agora.getUTCMonth() + 1;
    dia = agora.getUTCDate();
  }
  const dois = (n: number): string => String(n).padStart(2, "0");
  return `clientes-${String(ano).padStart(4, "0")}-${dois(mes)}-${dois(dia)}.csv`;
}

/**
 * O nome do `Content-Disposition`, **só** se for exatamente um `filename=` que case com
 * `^clientes-\d{4}-\d{2}-\d{2}\.csv$`. Texto do servidor nunca vira nome de ficheiro sem validar.
 */
function nomeDoFicheiro(cabecalho: string | null): string {
  if (cabecalho !== null) {
    const nomes = cabecalho
      .split(";")
      .slice(1)
      .map((parte) => PARAMETRO_FILENAME.exec(parte))
      .filter((achado): achado is RegExpExecArray => achado !== null);
    const unico = nomes.length === 1 ? nomes[0]?.[1] : undefined;
    if (unico !== undefined) {
      const bruto = unico.trimEnd();
      const nome =
        bruto.length >= 2 && bruto.startsWith('"') && bruto.endsWith('"')
          ? bruto.slice(1, -1)
          : bruto;
      if (NOME_VALIDO.test(nome)) return nome;
    }
  }
  return nomeDeReserva();
}

function eTextoCsv(tipo: string | null): boolean {
  return tipo !== null && (tipo.split(";")[0] ?? "").trim().toLowerCase() === "text/csv";
}

function comecaPorBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** Base64 de bytes, aos bocados (um `String.fromCharCode(...tudo)` rebentava a pilha num ficheiro grande). */
function emBase64(bytes: Uint8Array): string {
  const BOCADO = 0x8000;
  let binario = "";
  for (let i = 0; i < bytes.length; i += BOCADO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + BOCADO));
  }
  return btoa(binario);
}

/**
 * `GET /api/gestao/clientes.csv`. Só um `200` com `Content-Type` `text/csv` e um corpo que começa
 * pela BOM (`EF BB BF`) resolve; um `200` vazio, uma página de erro ou um ficheiro sem BOM é
 * `ErroDaApi` de **estado 200** (o servidor respondeu: nunca um ficheiro de zero bytes nem uma
 * página de erro com nome `.csv`).
 */
export async function descarregarClientesCsv(
  opcoes?: Pick<OpcoesDePedido, "sinal">,
): Promise<CsvDeClientes> {
  const { bytes, cabecalhos } = await pedirBytes(CAMINHO_CSV, opcoes);
  if (!eTextoCsv(cabecalhos.get("content-type")) || !comecaPorBom(bytes)) {
    throw new ErroDaApi("O ficheiro chegou num formato que não se sabe usar.", {
      estado: 200,
      codigo: null,
    });
  }
  return {
    nome: nomeDoFicheiro(cabecalhos.get("content-disposition")),
    href: `data:text/csv;charset=utf-8;base64,${emBase64(bytes)}`,
  };
}
