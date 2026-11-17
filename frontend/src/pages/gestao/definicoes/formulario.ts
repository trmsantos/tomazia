import type { DefinicoesGestao, PedidoDefinicoes } from "../../../lib/api/gestao-definicoes";
import { type HorarioNoFormulario, daApi, paraApi } from "./horario-do-formulario";
import { normalizarLink } from "./validar-campos";

/**
 * O estado do formulário das definições e o corpo do `PUT` (F4-05a, 3.1).
 *
 * O `PUT` **substitui** os sete campos. Por isso o formulário só existe depois de
 * um `GET` 200 e nasce dele: um campo não tocado leva **o valor que veio do
 * servidor**, e o corpo é sempre o do formulário inteiro.
 */
export type CampoDeTexto =
  "wifi_rede" | "wifi_password" | "morada" | "telefone" | "instagram" | "maps_url";

export type FormularioDeDefinicoes = Record<CampoDeTexto, string> & {
  horario: HorarioNoFormulario;
};

export function formularioDaApi(definicoes: DefinicoesGestao): FormularioDeDefinicoes {
  return {
    wifi_rede: definicoes.wifi_rede,
    wifi_password: definicoes.wifi_password,
    morada: definicoes.morada,
    telefone: definicoes.telefone,
    instagram: definicoes.instagram,
    maps_url: definicoes.maps_url,
    // `null` (também o do `invalido`) dá «sem horário»: o horário estragado nunca
    // chega à gestão, e guardar sem o tocar manda `null` (D2).
    horario: daApi(definicoes.horario),
  };
}

/**
 * Os valores que o ecrã envia no lugar dos que o dono escreveu: a **rede e a
 * password nunca se apararam** (a password que já não condiz com a rede é uma
 * password errada); a morada e o telefone aparam-se; os dois links aparam-se e
 * completam-se (D4).
 */
export function completarTextos(f: FormularioDeDefinicoes): FormularioDeDefinicoes {
  return {
    ...f,
    morada: f.morada.trim(),
    telefone: f.telefone.trim(),
    instagram: normalizarLink(f.instagram),
    maps_url: normalizarLink(f.maps_url),
  };
}

/** Exatamente as sete chaves, nunca `horario_estado`. Só depois de a validação passar. */
export function corpoDoPut(formulario: FormularioDeDefinicoes): PedidoDefinicoes {
  const f = completarTextos(formulario);
  return {
    wifi_rede: f.wifi_rede,
    wifi_password: f.wifi_password,
    morada: f.morada,
    telefone: f.telefone,
    instagram: f.instagram,
    maps_url: f.maps_url,
    horario: paraApi(f.horario),
  };
}

/** O que se compara: o corpo, e os dias «por preencher» (que o corpo mostra como fechados) à parte. */
function comparavel(f: FormularioDeDefinicoes): string {
  const porPreencher =
    f.horario.modo === "editar"
      ? f.horario.dias.filter((d) => d.estado === "por_preencher").map((d) => d.dia)
      : [];
  return JSON.stringify([corpoDoPut(f), porPreencher]);
}

/**
 * Há alterações por guardar? Compara o corpo que se enviaria com o que a `base`
 * (o último estado confirmado pelo servidor) daria: repor um valor desliga; um
 * espaço na password liga; fechar e reabrir um dia dá o mesmo que não tocar. Com
 * o horário `invalido` não tocado, o horário não conta (a base dá `null`).
 */
export function haAlteracoes(formulario: FormularioDeDefinicoes, base: DefinicoesGestao): boolean {
  return comparavel(formulario) !== comparavel(formularioDaApi(base));
}
