import { TEXTOS } from "./textos";

/**
 * A validação local dos textos das definições (F4-05a): o espelho do backend
 * (`backend/app/schemas/gestao.py`), para apontar o erro junto do campo sem uma
 * ida e volta ao servidor. **O backend continua a ser a autoridade**: o que
 * passa aqui pode ainda ser recusado lá (422), e nada daqui o substitui.
 *
 * Os limites contam **pontos de código**, como o `len` do Python: um emoji vale
 * um, e não os dois do `.length` do JS.
 */
export type CampoDeLink = "instagram" | "maps_url";

const LIMITE_DO_TEXTO = 200;
const LIMITE_DO_LINK = 500;
const ANFITRIOES_DO_INSTAGRAM: ReadonlySet<string> = new Set([
  "instagram.com",
  "www.instagram.com",
]);

/** `[...texto].length`, nunca `.length`. */
export function contarPontosDeCodigo(texto: string): number {
  return [...texto].length;
}

/** Rede, password, morada e telefone: uma só linha, até 200 pontos de código. */
export function validarTexto(valor: string): string | undefined {
  if (/[\r\n]/.test(valor)) return TEXTOS.erroTextoQuebra;
  if (contarPontosDeCodigo(valor) > LIMITE_DO_TEXTO) return TEXTOS.erroTextoLongo;
  return undefined;
}

/**
 * O que o ecrã faz a um link antes de o validar e de o enviar (D4, só nos dois
 * links): apara as pontas; `http://` passa a `https://`; sem esquema leva
 * `https://` à frente. Um `@nome` ou um caminho a começar por `/` não se
 * converte (o erro vem da validação); `javascript:`, `data:` e afins ficam como
 * estão, para serem recusados — nunca se lhes põe `https://` à frente.
 *
 * O esquema é `letra (letra|algarismo|+|.|-)* :` **não seguido de algarismo**,
 * para `instagram.com:443/x` (anfitrião com porta) não parecer um esquema.
 */
export function normalizarLink(valor: string): string {
  const aparado = valor.trim();
  if (aparado === "" || aparado.startsWith("@") || aparado.startsWith("/")) return aparado;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(aparado)) {
    return /^http:\/\//i.test(aparado) ? `https://${aparado.slice(7)}` : aparado;
  }
  return `https://${aparado}`;
}

function temCaracterDeControlo(valor: string): boolean {
  for (let i = 0; i < valor.length; i += 1) {
    const codigo = valor.charCodeAt(i);
    if (codigo <= 0x20 || codigo === 0x7f) return true;
  }
  return false;
}

/**
 * Valida o texto **tal como está** (não normaliza): é o que o backend vê. Vazio é
 * válido (apaga o campo). Ordem dos erros: `@nome`; espaço ou controlo; não
 * começa por `https://`; sem anfitrião ou com `utilizador@`; Instagram com outro
 * anfitrião (a porta também falha); mais de 500 pontos de código.
 */
export function validarLink(valor: string, campo: CampoDeLink): string | undefined {
  if (valor === "") return undefined;
  if (valor.startsWith("@")) return TEXTOS.erroLinkArroba;
  if (temCaracterDeControlo(valor)) return TEXTOS.erroLinkEspacos;
  if (valor.slice(0, 8).toLowerCase() !== "https://") return TEXTOS.erroLinkEsquema;

  const resto = valor.slice(8);
  const fim = resto.search(/[/?#]/);
  const autoridade = fim === -1 ? resto : resto.slice(0, fim);
  const anfitriao = autoridade.replace(/:\d*$/, "");
  if (anfitriao === "" || autoridade.includes("@")) return TEXTOS.erroLinkIncompleto;
  if (campo === "instagram" && !ANFITRIOES_DO_INSTAGRAM.has(autoridade.toLowerCase())) {
    return TEXTOS.erroLinkInstagram;
  }
  if (contarPontosDeCodigo(valor) > LIMITE_DO_LINK) return TEXTOS.erroLinkLongo;
  return undefined;
}
