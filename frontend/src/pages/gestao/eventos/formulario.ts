import type { AlteracaoDeEvento, EventoGestao, NovoEvento } from "../../../lib/api/gestao-eventos";
import { deCampo, paraCampo } from "./hora-de-lisboa";
import { TEXTOS } from "./textos";

/**
 * O estado da folha de criar e de editar um evento, puro (F4-03, spec 7.3 e 7.4).
 *
 * O ecrã tem **dois** campos, `date` e `time`; este módulo junta-os em `"AAAA-MM-DDTHH:MM"`,
 * lê-os como **hora de Lisboa** (`hora-de-lisboa.ts`) e traduz os motivos de recusa em frases
 * por campo (`TEXTOS`, nunca literais aqui). Nada lê o relógio.
 */
export type EstadoDoFormulario = {
  titulo: string;
  descricao: string;
  /** `"AAAA-MM-DD"` ou `""`. */
  data: string;
  /** `"HH:MM"` ou `""`. */
  hora: string;
  /** `validity.badInput` do `<input type="date">`: escrito a meio, `value` é `""`. */
  dataIncompleta: boolean;
  /** `validity.badInput` do `<input type="time">`. */
  horaIncompleta: boolean;
};

/** `guardar` = «Guardar alterações» num evento publicado (nunca despublica). */
export type Intencao = "publicar" | "rascunho" | "guardar";
export type CampoDoFormulario = "titulo" | "descricao" | "data" | "hora";
export type ErrosDoFormulario = Partial<Record<CampoDoFormulario, string>>;

export const LIMITE_DO_TITULO = 120;
export const LIMITE_DA_DESCRICAO = 1000;

const ORDEM_DOS_CAMPOS: readonly CampoDoFormulario[] = ["titulo", "descricao", "data", "hora"];
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

/** Os pontos de código, como o `len` do Python que conta no servidor: um emoji conta um. */
export function pontosDeCodigo(texto: string): number {
  return [...texto].length;
}

export function formularioInicial(aberto: EventoGestao | null): EstadoDoFormulario {
  if (aberto === null) {
    return {
      titulo: "",
      descricao: "",
      data: "",
      hora: "",
      dataIncompleta: false,
      horaIncompleta: false,
    };
  }
  const campo = aberto.inicio === null ? null : paraCampo(aberto.inicio);
  return {
    titulo: aberto.titulo,
    descricao: aberto.descricao ?? "",
    data: campo === null ? "" : campo.slice(0, 10),
    hora: campo === null ? "" : campo.slice(11, 16),
    dataIncompleta: false,
    horaIncompleta: false,
  };
}

export type ResultadoDaValidacao =
  { ok: true } | { ok: false; erros: ErrosDoFormulario; primeiro: CampoDoFormulario };

/** Valida só ao guardar: todos os erros de uma vez, `primeiro` pela ordem da folha. */
export function validar(
  f: EstadoDoFormulario,
  aberto: EventoGestao | null,
  intencao: Intencao,
): ResultadoDaValidacao {
  const erros: ErrosDoFormulario = {};

  const titulo = pontosDeCodigo(f.titulo.trim());
  if (titulo === 0) erros.titulo = TEXTOS.erroTituloVazio;
  else if (titulo > LIMITE_DO_TITULO) erros.titulo = TEXTOS.erroTituloLongo;

  if (pontosDeCodigo(f.descricao.trim()) > LIMITE_DA_DESCRICAO) {
    erros.descricao = TEXTOS.erroDescricaoLonga;
  }

  const tinhaData = aberto !== null && aberto.inicio !== null;
  const semNada = f.data === "" && f.hora === "" && !f.dataIncompleta && !f.horaIncompleta;

  if (semNada && !tinhaData && aberto !== null && intencao === "rascunho") {
    // Um rascunho sem data pode continuar sem data.
  } else if (semNada && !tinhaData && aberto !== null && intencao === "publicar") {
    erros.data = TEXTOS.erroPublicarSemData;
  } else {
    Object.assign(erros, errosDaData(f));
  }

  const primeiro = ORDEM_DOS_CAMPOS.find((campo) => erros[campo] !== undefined);
  if (primeiro === undefined) return { ok: true };
  const ordenados: ErrosDoFormulario = {};
  for (const campo of ORDEM_DOS_CAMPOS) {
    const erro = erros[campo];
    if (erro !== undefined) ordenados[campo] = erro;
  }
  return { ok: false, erros: ordenados, primeiro };
}

/** Os erros da data e da hora: vazio ≠ incompleto ≠ inválido ≠ a hora que não existe. */
function errosDaData(f: EstadoDoFormulario): ErrosDoFormulario {
  const erros: ErrosDoFormulario = {};

  if (f.dataIncompleta) erros.data = TEXTOS.erroDataIncompleta;
  else if (f.data === "") erros.data = TEXTOS.erroDataVazia;
  else if (!DATA.test(f.data) || !deCampo(`${f.data}T12:00`, false).ok) {
    erros.data = TEXTOS.erroDataInvalida;
  }

  if (f.horaIncompleta) erros.hora = TEXTOS.erroHoraIncompleta;
  else if (f.hora === "") erros.hora = TEXTOS.erroHoraVazia;
  else if (!HORA.test(f.hora)) erros.hora = TEXTOS.erroHoraIncompleta;

  if (erros.data === undefined && erros.hora === undefined) {
    const leitura = deCampo(`${f.data}T${f.hora}`, false);
    if (!leitura.ok) {
      if (leitura.motivo === "inexistente") erros.hora = TEXTOS.erroHoraInexistente;
      else erros.data = TEXTOS.erroDataInvalida;
    }
  }
  return erros;
}

/** O instante dos dois campos, já validados. Falhar alto é um erro de quem chama (validar primeiro). */
function instanteDe(f: EstadoDoFormulario): string {
  const leitura = deCampo(`${f.data}T${f.hora}`, false);
  if (!leitura.ok) {
    throw new Error(`A data e a hora não são válidas (${leitura.motivo}): faltou validar.`);
  }
  return leitura.inicio;
}

/** O corpo do `POST`: a descrição vazia omite-se. `f` já validado. */
export function corpoDoPost(f: EstadoDoFormulario, intencao: "publicar" | "rascunho"): NovoEvento {
  const descricao = f.descricao.trim();
  return {
    titulo: f.titulo.trim(),
    inicio: instanteDe(f),
    ...(descricao !== "" ? { descricao } : {}),
    publicado: intencao === "publicar",
  };
}

/**
 * O corpo do `PATCH`: **só o que mudou**, comparado com o evento **aberto**; `{}` quer dizer
 * «não pedir». A descrição apagada vai como `null`; o `inicio` só se o instante mudou (um evento
 * importado com segundos não muda de instante só por se lhe corrigir o título); nunca `imagem`
 * nem `inicio: null`; `publicado` só com «Publicar».
 */
export function corpoDoPatch(
  f: EstadoDoFormulario,
  aberto: EventoGestao,
  intencao: Intencao,
): AlteracaoDeEvento {
  const corpo: AlteracaoDeEvento = {};

  const titulo = f.titulo.trim();
  if (titulo !== aberto.titulo.trim()) corpo.titulo = titulo;

  const descricao = f.descricao.trim();
  if (descricao !== (aberto.descricao ?? "").trim()) {
    corpo.descricao = descricao === "" ? null : descricao;
  }

  if (f.data !== "" && f.hora !== "") {
    const mudou = aberto.inicio === null || `${f.data}T${f.hora}` !== paraCampo(aberto.inicio);
    if (mudou) corpo.inicio = instanteDe(f);
  }

  if (intencao === "publicar") corpo.publicado = true;
  return corpo;
}

/** Há alterações por guardar? O texto compara-se tal como está, sem `trim`. */
export function haAlteracoes(f: EstadoDoFormulario, aberto: EventoGestao | null): boolean {
  const inicial = formularioInicial(aberto);
  return (
    f.titulo !== inicial.titulo ||
    f.descricao !== inicial.descricao ||
    f.data !== inicial.data ||
    f.hora !== inicial.hora ||
    f.dataIncompleta ||
    f.horaIncompleta
  );
}
