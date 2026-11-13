/**
 * As três rotas de sessão da gestão (F4-01): entrar, perguntar quem sou, sair.
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa). Os tipos
 * saem do OpenAPI gerado, não de um modelo escrito à mão.
 *
 * Os erros chegam como `ErroDaApi` e quem chama distingue-os pelo `estado`:
 * `null` é «não houve resposta» (nunca o mesmo que um 401 — regra 10), 400 é
 * credenciais inválidas, 429 traz `extra.segundos_em_falta` e o cabeçalho
 * `retry-after` em `cabecalhos`.
 */
import { type OpcoesDePedido, pedir } from "./cliente";
import type { components, paths } from "./gerado/esquema";

const CAMINHO_ENTRAR = "/auth/login" satisfies keyof paths;
const CAMINHO_QUEM_SOU = "/auth/eu" satisfies keyof paths;
const CAMINHO_SAIR = "/auth/logout" satisfies keyof paths;

/** `{ id, utilizador }` — quem tem a sessão aberta. */
export type Sessao = components["schemas"]["RespostaAdmin"];

/** `POST /api/auth/login`. Os valores vão tal como a pessoa os escreveu. */
export function entrar(
  dados: { utilizador: string; password: string },
  opcoes?: OpcoesDePedido,
): Promise<Sessao> {
  return pedir<Sessao>(CAMINHO_ENTRAR, {
    ...opcoes,
    metodo: "POST",
    corpo: { utilizador: dados.utilizador, password: dados.password },
  });
}

/** `GET /api/auth/eu`. 401 `sessao_em_falta` quando não há sessão. */
export function quemSouEu(opcoes?: OpcoesDePedido): Promise<Sessao> {
  return pedir<Sessao>(CAMINHO_QUEM_SOU, opcoes);
}

/** `POST /api/auth/logout` — 204, idempotente. Resolve sem valor. */
export async function sair(opcoes?: OpcoesDePedido): Promise<void> {
  await pedir<undefined>(CAMINHO_SAIR, { ...opcoes, metodo: "POST", semCorpo: true });
}
