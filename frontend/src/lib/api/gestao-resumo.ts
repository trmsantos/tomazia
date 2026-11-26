/**
 * A API do resumo do Início da gestão (F4-05b): `GET /gestao/resumo`.
 *
 * Tudo passa pelo cliente (`X-Tomazia`, credenciais, URL relativa) e nunca repete o pedido.
 * `obterResumo` **recusa** um corpo que não sabe ler com um `ErroDaApi` de estado 200: as contagens
 * são inteiros não negativos e cada evento tem título e uma data legível. O ecrã mostra o erro de
 * carregar e nunca «zero» nem «não há nada» (regra 10).
 */
import { ErroDaApi, type OpcoesDePedido, pedir } from "./cliente";
import type { components, paths } from "./gerado/esquema";

const CAMINHO_RESUMO = "/gestao/resumo" satisfies keyof paths;

export type Resumo = components["schemas"]["RespostaResumo"];

const ILEGIVEL = "O resumo chegou num formato que não se sabe ler.";

function eObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function eContagem(valor: unknown): boolean {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= 0;
}

/** Um evento publicado do resumo tem sempre data: `null` ou ilegível é corpo ilegível. */
function eEventoDoResumo(valor: unknown): boolean {
  return (
    eObjeto(valor) &&
    typeof valor["id"] === "number" &&
    typeof valor["titulo"] === "string" &&
    typeof valor["inicio"] === "string" &&
    !Number.isNaN(new Date(valor["inicio"]).getTime())
  );
}

function lerResumo(corpo: unknown): Resumo {
  if (
    !eObjeto(corpo) ||
    !eContagem(corpo["fotos_pendentes"]) ||
    !eContagem(corpo["novos_registos"]) ||
    !Array.isArray(corpo["proximos_eventos"]) ||
    !corpo["proximos_eventos"].every(eEventoDoResumo)
  ) {
    throw new ErroDaApi(ILEGIVEL, { estado: 200, codigo: null });
  }
  return corpo as Resumo;
}

/** `GET /api/gestao/resumo` — fotos à espera, até 3 próximos eventos e novos registos. */
export async function obterResumo(opcoes?: OpcoesDePedido): Promise<Resumo> {
  return lerResumo(await pedir<unknown>(CAMINHO_RESUMO, opcoes));
}
