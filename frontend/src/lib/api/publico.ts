/**
 * As quatro rotas públicas de leitura que a F2-03 fixou.
 *
 * **Só estas quatro.** A tabela da API da especificação tem mais uma dúzia
 * de linhas (`POST /fotos`, `/auth/login`, `/gestao/*`…), e nenhuma delas
 * existe ainda no backend. Escrever hoje as funções contra essa tabela
 * dava um cliente que ninguém consegue verificar: compila na mesma, não
 * tem teste possível, e no dia em que a rota aparecer a descrição que aqui
 * está já não é a dela. Cada rota entra com a tarefa que a implementa.
 *
 * Os caminhos levam `satisfies keyof paths`: escrever `/ementas` passa a
 * ser erro de compilação em vez de um 404 em produção. Isto apanha a
 * **deriva** do contrato (um nome que mudou), e não apanha a
 * **degenerescência** (um OpenAPI vazio, em que `keyof paths` é `string` e
 * tudo passa) — essa é apanhada pelo `ferramentas/gerar-api.mjs`, antes de
 * o ficheiro gerado sequer existir.
 *
 * Os tipos saem das operações, não dos esquemas: é o que a rota devolve,
 * com o código 200 que ela devolve, e não um modelo que por acaso tem o
 * mesmo nome.
 */
import { type OpcoesDePedido, pedir } from "./cliente";
import type { paths } from "./gerado/esquema";

const CAMINHO_EMENTA = "/ementa" satisfies keyof paths;
const CAMINHO_EVENTOS = "/eventos" satisfies keyof paths;
const CAMINHO_GALERIA = "/galeria" satisfies keyof paths;
const CAMINHO_INFO = "/info" satisfies keyof paths;

/** `{ categorias: [...] }` — a ementa inteira, com os produtos aninhados. */
export type Ementa = paths["/ementa"]["get"]["responses"][200]["content"]["application/json"];

/** `{ eventos: [...] }` — publicados, a partir de hoje, `inicio` em UTC. */
export type Eventos = paths["/eventos"]["get"]["responses"][200]["content"]["application/json"];

/** `{ fotos: [...] }` — aprovadas, nomes de ficheiro, nunca caminhos. */
export type Galeria = paths["/galeria"]["get"]["responses"][200]["content"]["application/json"];

/** WiFi, morada, contactos e horário. `horario: null` = nunca configurado. */
export type Info = paths["/info"]["get"]["responses"][200]["content"]["application/json"];

/** `GET /api/ementa`. Sem categorias devolve `{ categorias: [] }`, não um erro. */
export function obterEmenta(opcoes?: OpcoesDePedido): Promise<Ementa> {
  return pedir<Ementa>(CAMINHO_EMENTA, opcoes);
}

/** `GET /api/eventos`. Lista vazia quando não há nada marcado. */
export function obterEventos(opcoes?: OpcoesDePedido): Promise<Eventos> {
  return pedir<Eventos>(CAMINHO_EVENTOS, opcoes);
}

/** `GET /api/galeria`. Só as fotos já aprovadas pelo dono. */
export function obterGaleria(opcoes?: OpcoesDePedido): Promise<Galeria> {
  return pedir<Galeria>(CAMINHO_GALERIA, opcoes);
}

/** `GET /api/info`. `wifi` é sempre um objeto, mesmo com os campos a `null`. */
export function obterInfo(opcoes?: OpcoesDePedido): Promise<Info> {
  return pedir<Info>(CAMINHO_INFO, opcoes);
}
