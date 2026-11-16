import { ROTAS_DOS_DESTINOS } from "./navegacao";

/**
 * Para onde vai quem acabou de entrar (F4-02, D4).
 *
 * O destino de onde se foi mandado viaja no **`history.state`**, nunca no
 * endereço: um link de fora não consegue escrever o estado de uma entrada do
 * histórico, por isso a superfície do redirecionamento aberto desaparece em vez
 * de ser filtrada. A validação mantém-se **à leitura**, como defesa em
 * profundidade: o `history.state` sobrevive a recarregar a página e pode vir de
 * código antigo, e o código não deve depender de uma exceção do `pushState`
 * para estar seguro (ele recusa outra origem, mas não impede `/gestao/../`).
 *
 * O estado que o `AppGestao` escreve é `{ voltar: string; sessaoTerminou?: true }`,
 * com `voltar` = caminho + pesquisa de onde se foi mandado.
 *
 * Regras, todas sobre `voltar`:
 *  - o estado é um objeto e `voltar` uma cadeia;
 *  - até 96 caracteres (cabe `/gestao/ementa?categoria=` e um `slug` de 60);
 *  - nenhum `//`, `\`, `:`, `%`, `.`, `#`, espaço nem carácter de controlo
 *    (o browser apaga `\t\n\r` num endereço, e `/\t/x` vira `//x`);
 *  - é exatamente um destino conhecido e não é o login — **única exceção**,
 *    `/gestao/ementa?categoria=<slug>` com o `slug` em `^[a-z0-9-]{1,60}$`,
 *    para voltar à mesma categoria.
 *
 * Qualquer outra coisa é o Início (`/gestao`).
 */
const INICIO = "/gestao";
const ENTRAR = "/gestao/entrar";
const COMPRIMENTO_MAXIMO = 96;

/** Barras duplas, contrabarra, esquema, `%`, `#`, ponto e espaços. */
const CARACTERES_PROIBIDOS = /\/\/|[\\:%#.\s]/;

/** U+0000 a U+001F e U+007F (o `\s` não apanha o NUL nem o DEL). */
function temCaracterDeControlo(valor: string): boolean {
  for (let i = 0; i < valor.length; i += 1) {
    const codigo = valor.charCodeAt(i);
    if (codigo <= 0x1f || codigo === 0x7f) return true;
  }
  return false;
}

const EMENTA_DE_UMA_CATEGORIA = /^\/gestao\/ementa\?categoria=[a-z0-9-]{1,60}$/;

function eDestinoAceite(voltar: string): boolean {
  if (voltar.length === 0 || voltar.length > COMPRIMENTO_MAXIMO) return false;
  if (CARACTERES_PROIBIDOS.test(voltar) || temCaracterDeControlo(voltar)) return false;
  if (EMENTA_DE_UMA_CATEGORIA.test(voltar)) return true;
  return voltar !== ENTRAR && ROTAS_DOS_DESTINOS.has(voltar);
}

/** O `voltar` de um estado de forma desconhecida; um getter que lança não rebenta. */
function lerVoltar(estado: unknown): unknown {
  if (typeof estado !== "object" || estado === null) return undefined;
  try {
    return (estado as { voltar?: unknown }).voltar;
  } catch {
    return undefined;
  }
}

/** `estado` é o `history.state` tal como o browser o dá. */
export function destinoDepoisDeEntrar(estado: unknown): string {
  const voltar = lerVoltar(estado);
  return typeof voltar === "string" && eDestinoAceite(voltar) ? voltar : INICIO;
}

/**
 * O estado com que o `AppGestao` manda para o login, a partir de
 * `pathname + search`: `voltar` só quando o destino seria aceite (assim nem se
 * escreve no histórico o que o login iria recusar) e nunca para o Início, que é
 * o que o login faz sem destino.
 */
export function destinoParaLembrar(caminhoEPesquisa: string): string | undefined {
  return caminhoEPesquisa !== INICIO && eDestinoAceite(caminhoEPesquisa)
    ? caminhoEPesquisa
    : undefined;
}
