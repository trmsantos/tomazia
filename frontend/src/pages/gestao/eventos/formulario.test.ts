/**
 * F4-03, plano 7.1 e spec 7.3/7.4 — o estado da folha de criar/editar, puro.
 *
 * Contrato (`formulario.ts`; o ecrã tem **dois** campos, `date` e `time`, spec 7.1, e este
 * módulo traduz os motivos de `deCampo` em erros por campo):
 *
 * ```ts
 * export type EstadoDoFormulario = {
 *   titulo: string; descricao: string;
 *   data: string;            // "AAAA-MM-DD" ou ""
 *   hora: string;            // "HH:MM" ou ""
 *   dataIncompleta: boolean; // `validity.badInput` do <input type="date">
 *   horaIncompleta: boolean; // `validity.badInput` do <input type="time">
 * };
 * export type Intencao = "publicar" | "rascunho" | "guardar";  // "guardar" = guardar alterações de um publicado
 * export type CampoDoFormulario = "titulo" | "descricao" | "data" | "hora";
 *
 * export function formularioInicial(aberto: EventoGestao | null): EstadoDoFormulario; // data/hora via paraCampo; sem data → ""
 * export function validar(f, aberto: EventoGestao | null, intencao: Intencao):
 *   | { ok: true }
 *   | { ok: false; erros: Partial<Record<CampoDoFormulario, string>>; primeiro: CampoDoFormulario };
 * export function corpoDoPost(f, intencao: "publicar" | "rascunho"): NovoEvento;        // f já validado
 * export function corpoDoPatch(f, aberto: EventoGestao, intencao: Intencao): AlteracaoDeEvento; // `{}` = não pedir
 * export function haAlteracoes(f, aberto: EventoGestao | null): boolean;
 * ```
 *
 * Os erros são **as frases de `TEXTOS`** (`erroTituloVazio`, …), nunca literais aqui. Todos os
 * erros de uma vez, `primeiro` é o do primeiro campo pela ordem da folha (título, descrição,
 * data, hora). Contagem em pontos de código (`[...texto.trim()].length`): 120 emojis passam.
 *
 * **Deixa passar:** o foco e o `badInput` do `<input>` (componente e e2e).
 */
import { describe, expect, it } from "vitest";

import { eventoDeTeste } from "../../../testes/gestao";
import {
  corpoDoPatch,
  corpoDoPost,
  formularioInicial,
  haAlteracoes,
  validar,
  type EstadoDoFormulario,
} from "./formulario";
import { TEXTOS } from "./textos";

const PUBLICADO = eventoDeTeste({
  id: 11,
  titulo: "Fado ao vivo",
  inicio: "2026-11-05T22:00:00Z",
  descricao: "Primeira linha.\nSegunda linha.",
});
const RASCUNHO = eventoDeTeste({
  id: 21,
  titulo: "Rascunho com data",
  inicio: "2026-11-20T22:00:00Z",
  publicado: false,
});
const SEM_DATA = eventoDeTeste({ id: 22, titulo: "Importado", inicio: null, publicado: false });

function novo(parcial: Partial<EstadoDoFormulario> = {}): EstadoDoFormulario {
  return {
    ...formularioInicial(null),
    titulo: "Fado",
    data: "2026-11-20",
    hora: "22:00",
    ...parcial,
  };
}
function de(
  aberto: Parameters<typeof formularioInicial>[0],
  parcial: Partial<EstadoDoFormulario> = {},
) {
  return { ...formularioInicial(aberto), ...parcial };
}
function erros(resultado: ReturnType<typeof validar>): Record<string, string> {
  if (resultado.ok) throw new Error("esperava erros e a validação passou");
  return resultado.erros as Record<string, string>;
}

describe("formularioInicial", () => {
  it("novo: tudo vazio, sem valor por omissão na data (não se inventa a data de um evento)", () => {
    expect(formularioInicial(null)).toEqual({
      titulo: "",
      descricao: "",
      data: "",
      hora: "",
      dataIncompleta: false,
      horaIncompleta: false,
    });
  });

  it("editar: o texto tal como está e a data e a hora **de Lisboa**", () => {
    expect(formularioInicial(PUBLICADO)).toMatchObject({
      titulo: "Fado ao vivo",
      descricao: "Primeira linha.\nSegunda linha.",
      data: "2026-11-05",
      hora: "22:00",
    });
    const verao = eventoDeTeste({ id: 1, inicio: "2026-07-14T23:30:00Z" });
    expect(formularioInicial(verao)).toMatchObject({ data: "2026-07-15", hora: "00:30" });
  });

  it("rascunho sem data (descrição `null`): data, hora e descrição vazias", () => {
    expect(formularioInicial(SEM_DATA)).toMatchObject({ descricao: "", data: "", hora: "" });
  });
});

describe("validar: título e descrição", () => {
  it("título vazio ou só espaços", () => {
    expect(erros(validar(novo({ titulo: "" }), null, "publicar")).titulo).toBe(
      TEXTOS.erroTituloVazio,
    );
    expect(erros(validar(novo({ titulo: "   " }), null, "rascunho")).titulo).toBe(
      TEXTOS.erroTituloVazio,
    );
  });

  it("120 pontos de código passam, 121 não; 120 emojis passam (um emoji conta um)", () => {
    expect(validar(novo({ titulo: "a".repeat(120) }), null, "publicar").ok).toBe(true);
    expect(erros(validar(novo({ titulo: "a".repeat(121) }), null, "publicar")).titulo).toBe(
      TEXTOS.erroTituloLongo,
    );
    expect(validar(novo({ titulo: "🎷".repeat(120) }), null, "publicar").ok).toBe(true);
    expect(erros(validar(novo({ titulo: "🎷".repeat(121) }), null, "publicar")).titulo).toBe(
      TEXTOS.erroTituloLongo,
    );
  });

  it("o título conta depois de aparar", () => {
    expect(validar(novo({ titulo: `  ${"a".repeat(120)}  ` }), null, "publicar").ok).toBe(true);
  });

  it("descrição: 1000 passam, 1001 não (depois de aparar); 1000 emojis passam", () => {
    expect(validar(novo({ descricao: "a".repeat(1000) }), null, "publicar").ok).toBe(true);
    expect(erros(validar(novo({ descricao: "a".repeat(1001) }), null, "publicar")).descricao).toBe(
      TEXTOS.erroDescricaoLonga,
    );
    expect(validar(novo({ descricao: `${"a".repeat(1000)}  \n` }), null, "publicar").ok).toBe(true);
    expect(validar(novo({ descricao: "🎷".repeat(1000) }), null, "publicar").ok).toBe(true);
  });
});

describe("validar: data e hora, uma frase por motivo", () => {
  it("novo sem data e sem hora: as duas frases, e o primeiro é a data", () => {
    const r = validar(novo({ data: "", hora: "" }), null, "rascunho");
    expect(erros(r)).toEqual({ data: TEXTOS.erroDataVazia, hora: TEXTOS.erroHoraVazia });
    expect(!r.ok && r.primeiro).toBe("data");
  });

  it("só a hora em falta; só a data em falta", () => {
    expect(erros(validar(novo({ hora: "" }), null, "publicar"))).toEqual({
      hora: TEXTOS.erroHoraVazia,
    });
    expect(erros(validar(novo({ data: "" }), null, "publicar"))).toEqual({
      data: TEXTOS.erroDataVazia,
    });
  });

  it("vazio ≠ incompleto (regra 10): a hora a meio diz «incompleta», não «escolhe a hora»", () => {
    const r = erros(validar(novo({ hora: "", horaIncompleta: true }), null, "publicar"));
    expect(r.hora).toBe(TEXTOS.erroHoraIncompleta);
    expect(r.hora).not.toBe(TEXTOS.erroHoraVazia);

    const d = erros(validar(novo({ data: "", dataIncompleta: true }), null, "publicar"));
    expect(d.data).toBe(TEXTOS.erroDataIncompleta);
    expect(d.data).not.toBe(TEXTOS.erroDataVazia);
  });

  it("hora que não existe (29/03, 01:30): erro na hora, com a frase da noite que avança", () => {
    const r = erros(validar(novo({ data: "2026-03-29", hora: "01:30" }), null, "publicar"));
    expect(r).toEqual({ hora: TEXTOS.erroHoraInexistente });
  });

  it("hora repetida (25/10, 01:30) passa: fica a primeira", () => {
    expect(validar(novo({ data: "2026-10-25", hora: "01:30" }), null, "publicar").ok).toBe(true);
  });

  it("data inválida ou fora de 1970–9000: «escolhe uma data válida»", () => {
    expect(erros(validar(novo({ data: "2026-02-31" }), null, "publicar")).data).toBe(
      TEXTOS.erroDataInvalida,
    );
    expect(erros(validar(novo({ data: "1969-12-31" }), null, "publicar")).data).toBe(
      TEXTOS.erroDataInvalida,
    );
    expect(erros(validar(novo({ data: "9001-01-01" }), null, "publicar")).data).toBe(
      TEXTOS.erroDataInvalida,
    );
  });

  it("todos os erros de uma vez, na ordem da folha", () => {
    const r = validar(
      novo({ titulo: "", descricao: "a".repeat(1001), data: "", hora: "" }),
      null,
      "publicar",
    );
    expect(Object.keys(erros(r))).toEqual(["titulo", "descricao", "data", "hora"]);
    expect(!r.ok && r.primeiro).toBe("titulo");
  });

  it("um evento que tinha data não a pode perder: apagá-la dá «escolhe a data»", () => {
    const r = erros(validar(de(PUBLICADO, { data: "", hora: "" }), PUBLICADO, "guardar"));
    expect(r.data).toBe(TEXTOS.erroDataVazia);
    expect(erros(validar(de(RASCUNHO, { data: "" }), RASCUNHO, "rascunho")).data).toBe(
      TEXTOS.erroDataVazia,
    );
  });

  it("um rascunho sem data pode continuar sem data com «Guardar rascunho»", () => {
    expect(validar(de(SEM_DATA), SEM_DATA, "rascunho").ok).toBe(true);
  });

  it("…mas só com a hora (ou só com a data) não: falta a outra", () => {
    expect(erros(validar(de(SEM_DATA, { hora: "22:00" }), SEM_DATA, "rascunho")).data).toBe(
      TEXTOS.erroDataVazia,
    );
    expect(erros(validar(de(SEM_DATA, { data: "2026-11-20" }), SEM_DATA, "rascunho")).hora).toBe(
      TEXTOS.erroHoraVazia,
    );
  });

  it("«Publicar» um rascunho sem data e sem escolher: «para publicar, escolhe a data e a hora», na data", () => {
    const r = validar(de(SEM_DATA), SEM_DATA, "publicar");
    expect(erros(r)).toEqual({ data: TEXTOS.erroPublicarSemData });
    expect(!r.ok && r.primeiro).toBe("data");
  });
});

describe("corpoDoPost", () => {
  it("publicar: `publicado: true`; rascunho: `publicado: false`; `inicio` em UTC com Z", () => {
    expect(corpoDoPost(novo({ descricao: "Uma noite." }), "publicar")).toEqual({
      titulo: "Fado",
      inicio: "2026-11-20T22:00:00Z",
      descricao: "Uma noite.",
      publicado: true,
    });
    expect(corpoDoPost(novo(), "rascunho")).toMatchObject({ publicado: false });
  });

  it("a descrição vazia omite-se", () => {
    expect("descricao" in corpoDoPost(novo({ descricao: "" }), "publicar")).toBe(false);
  });

  it("a hora é a de Lisboa: 22:00 de verão são 21:00Z; 00:30 de verão é do dia anterior em UTC", () => {
    expect(corpoDoPost(novo({ data: "2026-07-02", hora: "22:00" }), "publicar").inicio).toBe(
      "2026-07-02T21:00:00Z",
    );
    expect(corpoDoPost(novo({ data: "2026-07-15", hora: "00:30" }), "publicar").inicio).toBe(
      "2026-07-14T23:30:00Z",
    );
  });
});

describe("corpoDoPatch: só o que mudou", () => {
  it("nada mudou → `{}` (o ecrã não faz pedido)", () => {
    expect(corpoDoPatch(de(PUBLICADO), PUBLICADO, "guardar")).toEqual({});
    expect(corpoDoPatch(de(RASCUNHO), RASCUNHO, "rascunho")).toEqual({});
    expect(corpoDoPatch(de(SEM_DATA), SEM_DATA, "rascunho")).toEqual({});
  });

  it("só o título → só `titulo`", () => {
    expect(corpoDoPatch(de(PUBLICADO, { titulo: "Fado novo" }), PUBLICADO, "guardar")).toEqual({
      titulo: "Fado novo",
    });
  });

  it("só a hora → só `inicio`, em UTC; só a data também", () => {
    expect(corpoDoPatch(de(PUBLICADO, { hora: "23:00" }), PUBLICADO, "guardar")).toEqual({
      inicio: "2026-11-05T23:00:00Z",
    });
    expect(corpoDoPatch(de(PUBLICADO, { data: "2026-11-06" }), PUBLICADO, "guardar")).toEqual({
      inicio: "2026-11-06T22:00:00Z",
    });
  });

  it("data igual à de Lisboa do original → sem `inicio`, mesmo com segundos no original", () => {
    const comSegundos = eventoDeTeste({
      id: 5,
      titulo: "Importado com segundos",
      inicio: "2026-11-05T22:00:30Z",
    });
    expect(corpoDoPatch(de(comSegundos, { titulo: "Corrigido" }), comSegundos, "guardar")).toEqual({
      titulo: "Corrigido",
    });
  });

  it("descrição apagada → `descricao: null`; descrição que já era `null` e continua vazia → sem chave", () => {
    expect(corpoDoPatch(de(PUBLICADO, { descricao: "" }), PUBLICADO, "guardar")).toEqual({
      descricao: null,
    });
    expect(corpoDoPatch(de(RASCUNHO, { titulo: "x" }), RASCUNHO, "rascunho")).toEqual({
      titulo: "x",
    });
  });

  it("descrição mudada → o texto novo, tal como está", () => {
    expect(
      corpoDoPatch(de(PUBLICADO, { descricao: "Nova.\nDuas linhas." }), PUBLICADO, "guardar"),
    ).toEqual({
      descricao: "Nova.\nDuas linhas.",
    });
  });

  it("publicar a partir de rascunho sem data → `{inicio, publicado: true}`", () => {
    expect(
      corpoDoPatch(de(SEM_DATA, { data: "2026-11-20", hora: "22:00" }), SEM_DATA, "publicar"),
    ).toEqual({ inicio: "2026-11-20T22:00:00Z", publicado: true });
  });

  it("«Publicar» num rascunho sem alterações publica: `{publicado: true}`", () => {
    expect(corpoDoPatch(de(RASCUNHO), RASCUNHO, "publicar")).toEqual({ publicado: true });
  });

  it("publicar com alterações junta-as: `{titulo, publicado: true}`", () => {
    expect(corpoDoPatch(de(RASCUNHO, { titulo: "Outro" }), RASCUNHO, "publicar")).toEqual({
      titulo: "Outro",
      publicado: true,
    });
  });

  it("editar nunca muda `publicado` num publicado, nem despublica (nem `imagem`, nem `inicio: null`)", () => {
    const corpo = corpoDoPatch(
      de(PUBLICADO, { titulo: "a", descricao: "", hora: "23:00" }),
      PUBLICADO,
      "guardar",
    );
    expect("publicado" in corpo).toBe(false);
    expect("imagem" in corpo).toBe(false);
    expect(Object.values(corpo)).not.toContain(undefined);
    expect(corpo.inicio).toBeDefined();
  });

  it("«Guardar rascunho» nunca manda `publicado`", () => {
    expect("publicado" in corpoDoPatch(de(RASCUNHO, { titulo: "z" }), RASCUNHO, "rascunho")).toBe(
      false,
    );
  });
});

describe("haAlteracoes", () => {
  it("novo: falso ao abrir, verdadeiro ao escrever, falso ao repor", () => {
    expect(haAlteracoes(formularioInicial(null), null)).toBe(false);
    expect(haAlteracoes({ ...formularioInicial(null), titulo: "a" }, null)).toBe(true);
    expect(haAlteracoes({ ...formularioInicial(null), descricao: "a" }, null)).toBe(true);
    expect(haAlteracoes({ ...formularioInicial(null), data: "2026-11-20" }, null)).toBe(true);
    expect(haAlteracoes({ ...formularioInicial(null), hora: "22:00" }, null)).toBe(true);
    expect(haAlteracoes(formularioInicial(null), null)).toBe(false);
  });

  it("editar: falso ao abrir, verdadeiro ao mudar cada campo, falso ao repor o valor", () => {
    expect(haAlteracoes(formularioInicial(PUBLICADO), PUBLICADO)).toBe(false);
    for (const parcial of [
      { titulo: "Fado ao vivo!" },
      { descricao: "outra" },
      { data: "2026-11-06" },
      { hora: "21:00" },
    ]) {
      expect(haAlteracoes(de(PUBLICADO, parcial), PUBLICADO), JSON.stringify(parcial)).toBe(true);
    }
    expect(haAlteracoes(de(PUBLICADO, { titulo: "x" }), PUBLICADO)).toBe(true);
    expect(haAlteracoes(de(PUBLICADO, { titulo: "Fado ao vivo" }), PUBLICADO)).toBe(false);
  });

  it("o texto compara-se tal como está, sem `trim`: um espaço no fim já é uma alteração", () => {
    expect(haAlteracoes(de(PUBLICADO, { titulo: "Fado ao vivo " }), PUBLICADO)).toBe(true);
  });
});
