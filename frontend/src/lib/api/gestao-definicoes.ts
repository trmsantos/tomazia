/**
 * A API das definições na gestão (F4-05a): ler e guardar o WiFi, o horário, a
 * morada, o telefone, o Instagram e o link do Google Maps.
 *
 * **A superfície é exatamente estas duas funções.** O `PUT` **substitui** os sete
 * campos: o corpo é construído chave a chave com as sete — nunca `{ ...definicoes }`:
 * o `horario_estado` que viesse no objeto dava 422 (`extra="forbid"` no backend).
 * Nada é aparado nem transformado aqui (a rede e a password do WiFi vão tal e qual).
 *
 * `obterDefinicoes` **recusa** um corpo que não sabe ler (`configurado` com
 * `horario: null`, um estado desconhecido, um `horario` que não é lista nem `null`):
 * quem chama mostra o erro de carregar e nunca o formulário — um formulário vazio,
 * guardado, apagava os sete campos (regra 10).
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa). `estado === null`
 * é «não houve resposta»: no `PUT` quer dizer **não sei se gravou**, e este módulo
 * nunca repete um pedido por conta própria.
 */
import { ErroDaApi, type OpcoesDePedido, pedir } from "./cliente";
import type { components, paths } from "./gerado/esquema";

const CAMINHO_DEFINICOES = "/gestao/definicoes" satisfies keyof paths;

export type DefinicoesGestao = components["schemas"]["DefinicoesGestao"];
export type PedidoDefinicoes = components["schemas"]["PedidoDefinicoes"];
export type DiaDoHorario = components["schemas"]["DiaDoHorario"];
export type PeriodoDoHorario = components["schemas"]["PeriodoDoHorario"];
export type EstadoDoHorario = DefinicoesGestao["horario_estado"];

const CAMPOS_DE_TEXTO = [
  "wifi_rede",
  "wifi_password",
  "morada",
  "telefone",
  "instagram",
  "maps_url",
] as const;

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function eHorarioLegivel(horario: unknown): boolean {
  if (!Array.isArray(horario)) return false;
  return horario.every(
    (dia) =>
      eObjeto(dia) &&
      typeof dia["dia"] === "string" &&
      Array.isArray(dia["periodos"]) &&
      dia["periodos"].every(
        (p) => eObjeto(p) && typeof p["abre"] === "string" && typeof p["fecha"] === "string",
      ),
  );
}

/**
 * Um 200 cujo corpo não se lê é um `ErroDaApi` com o estado 200 (como o do cliente
 * para um corpo que não é JSON): quem guarda distingue-o de um erro do servidor.
 */
function corpoIlegivel(mensagem: string): ErroDaApi {
  return new ErroDaApi(mensagem, { estado: 200, codigo: null });
}

/** Lança se o corpo não for uma das combinações que a especificação descreve. */
function lerDefinicoes(corpo: unknown): DefinicoesGestao {
  if (!eObjeto(corpo))
    throw corpoIlegivel("As definições chegaram num formato que não se sabe ler.");
  for (const campo of CAMPOS_DE_TEXTO) {
    if (typeof corpo[campo] !== "string") {
      throw corpoIlegivel("As definições chegaram num formato que não se sabe ler.");
    }
  }
  const estado = corpo["horario_estado"];
  const horario = corpo["horario"];
  const legivel =
    estado === "configurado"
      ? eHorarioLegivel(horario)
      : (estado === "nao_configurado" || estado === "invalido") && horario === null;
  if (!legivel) throw corpoIlegivel("O horário chegou num formato que não se sabe ler.");
  return corpo as DefinicoesGestao;
}

/** `GET /api/gestao/definicoes`. */
export async function obterDefinicoes(opcoes?: OpcoesDePedido): Promise<DefinicoesGestao> {
  return lerDefinicoes(await pedir<unknown>(CAMINHO_DEFINICOES, opcoes));
}

/** `PUT /api/gestao/definicoes` — os sete campos; devolve o mesmo que o `GET` daria. */
export async function guardarDefinicoes(
  pedido: PedidoDefinicoes,
  opcoes?: OpcoesDePedido,
): Promise<DefinicoesGestao> {
  const corpo: PedidoDefinicoes = {
    wifi_rede: pedido.wifi_rede,
    wifi_password: pedido.wifi_password,
    morada: pedido.morada,
    telefone: pedido.telefone,
    instagram: pedido.instagram,
    maps_url: pedido.maps_url,
    horario: pedido.horario,
  };
  return lerDefinicoes(
    await pedir<unknown>(CAMINHO_DEFINICOES, { ...opcoes, metodo: "PUT", corpo }),
  );
}
