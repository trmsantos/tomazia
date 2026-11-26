/**
 * A fixtura da secção "Visita-nos" (F3-06a): o texto visível, os instantes em
 * que os testes se passam e as leituras do `/info`.
 *
 * Mesma razão de ser que `src/testes/eventos.ts`: os testes Vitest e os
 * Playwright precisam da mesma fixtura, e duas cópias acabam a divergir.
 *
 * ## Os instantes
 *
 * Todos são **absolutos, em UTC** (`...Z`), com a hora de relógio de Lisboa
 * escrita ao lado. Nunca `new Date(2026, 6, 9, 1, 30)`: esse construtor lê o
 * fuso da máquina e a fixtura deixava de ser a mesma no CI e aqui.
 *
 * **Escolhidos no verão de propósito** (ADR 0010): de novembro a março Lisboa e
 * UTC coincidem, e um teste só de inverno fica verde contra uma implementação
 * em UTC. No verão Lisboa está uma hora à frente, por isso entre as 00:00 e a
 * 01:00 de Lisboa o dia UTC é o **anterior**: é aí que as duas se separam. Os
 * instantes marcados «(UTC: …)» são os que apanham um `getDay()`/`getUTCDay()`.
 *
 * A semana de verão é a de segunda 2026-07-06 a domingo 2026-07-12.
 *
 * Os dados são falsos e é propositado que se note (regra 1 do `CLAUDE.md`).
 */
import type { Info } from "../lib/api/publico";
import { type DiaDoHorario, semanaDeTeste } from "./gestao";

/**
 * Todo o texto fixo da secção 9 de `docs/ecras/F3-06a.md`, literal: o
 * dominio-bar validou esta tabela, e um teste que a reescrevesse por
 * concatenação deixava de ser o que ele validou. As frases da linha do momento,
 * que dependem da hora, estão em `LINHAS_DO_MOMENTO`.
 */
export const TEXTOS_DO_VISITA_NOS = {
  titulo: "Visita-nos",
  tituloDoHorario: "Horário",
  legendaDaTabela: "Horário de abertura",
  fechado: "Fechado",
  tituloDosContactos: "Morada e contactos",
  etiquetaMorada: "Morada",
  etiquetaLocalizacao: "Localização",
  etiquetaTelefone: "Telefone",
  etiquetaInstagram: "Instagram",
  abrirNoMaps: "Abrir no Google Maps",
  verNoInstagram: "Ver no Instagram",
  erroTitulo: "Não consegui carregar o horário e os contactos.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
} as const;

/** Segunda a domingo, tal como a tabela os escreve (5.2). */
export const NOMES_DOS_DIAS_NA_TABELA = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
] as const;

/** As frases da linha do momento que a secção 9 lista, por extenso. */
export const LINHAS_DO_MOMENTO = {
  ateAsDuas: "Aberto até às 02:00",
  ateAUma: "Aberto até à 01:00",
  ateAMeiaNoite: "Aberto até à meia-noite",
  fechadoAbreHoje: "Fechado · Abre hoje às 17:00",
  fechadoAbreAmanha: "Fechado · Abre amanhã às 17:00",
  fechadoAbreNaSexta: "Fechado · Abre na sexta às 17:00",
  fechadoAbreNoSabado: "Fechado · Abre no sábado às 17:00",
  fechadoAbreNaProximaQuinta: "Fechado · Abre na próxima quinta às 17:00",
  fechadoSo: "Fechado",
} as const;

// ---------------------------------------------------------------------------
// Os horários
// ---------------------------------------------------------------------------

/** O do critério 11.1: terça a sábado 17:00–02:00; domingo e segunda fechados. */
export function horarioPadrao(): DiaDoHorario[] {
  return semanaDeTeste({
    terca: [["17:00", "02:00"]],
    quarta: [["17:00", "02:00"]],
    quinta: [["17:00", "02:00"]],
    sexta: [["17:00", "02:00"]],
    sabado: [["17:00", "02:00"]],
  });
}

/** O padrão, com a sexta a ter almoço e noite (dois períodos no mesmo dia). */
export function horarioComDoisPeriodosNaSexta(): DiaDoHorario[] {
  return semanaDeTeste({
    terca: [["17:00", "02:00"]],
    quarta: [["17:00", "02:00"]],
    quinta: [["17:00", "02:00"]],
    sexta: [
      ["12:00", "15:00"],
      ["19:00", "02:00"],
    ],
    sabado: [["17:00", "02:00"]],
  });
}

/** Só abre às terças, das 12:00 às 15:00 (a forma «próxima», 5.1). */
export function horarioSoNasTercas(): DiaDoHorario[] {
  return semanaDeTeste({ terca: [["12:00", "15:00"]] });
}

/** Os sete dias com `periodos: []`: uma afirmação do dono (ADR 0011), não «por configurar». */
export function horarioFechadoASemanaToda(): DiaDoHorario[] {
  return semanaDeTeste({});
}

// ---------------------------------------------------------------------------
// Os instantes (UTC, com a hora de Lisboa ao lado)
// ---------------------------------------------------------------------------

export const MOMENTOS = {
  /** segunda 12:00 */
  seg12h00: "2026-07-06T11:00:00Z",
  /** terça 10:00 */
  ter10h00: "2026-07-07T09:00:00Z",
  /** terça 16:00 */
  ter16h00: "2026-07-07T15:00:00Z",
  /** terça 23:00 */
  ter23h00: "2026-07-07T22:00:00Z",
  /** terça 23:30 */
  ter23h30: "2026-07-07T22:30:00Z",
  /** quarta 00:30 (UTC: ainda terça, 23:30) */
  qua00h30: "2026-07-07T23:30:00Z",
  /** quarta 01:00 */
  qua01h00: "2026-07-08T00:00:00Z",
  /** quarta 04:00 */
  qua04h00: "2026-07-08T03:00:00Z",
  /** quarta 12:00 */
  qua12h00: "2026-07-08T11:00:00Z",
  /** quarta 23:00 */
  qua23h00: "2026-07-08T22:00:00Z",
  /** quinta 01:30 */
  qui01h30: "2026-07-09T00:30:00Z",
  /** quinta 01:59 */
  qui01h59: "2026-07-09T00:59:00Z",
  /** quinta 02:00 em ponto: o fecho é exclusivo */
  qui02h00: "2026-07-09T01:00:00Z",
  /** quinta 16:59 */
  qui16h59: "2026-07-09T15:59:00Z",
  /** quinta 17:00 em ponto: a abertura é inclusiva */
  qui17h00: "2026-07-09T16:00:00Z",
  /** sexta 16:00 */
  sex16h00: "2026-07-10T15:00:00Z",
  /** domingo 01:30 (o sábado ainda está aberto) */
  dom01h30: "2026-07-12T00:30:00Z",
  /** domingo 12:00 */
  dom12h00: "2026-07-12T11:00:00Z",
  /** segunda 00:30 (UTC: ainda domingo, 23:30) */
  seg00h30: "2026-07-12T23:30:00Z",
  /** quarta 23:00, em dezembro: Lisboa e UTC coincidem (uma implementação a somar 1 h no verão falha aqui) */
  invernoQua23h00: "2026-12-02T23:00:00Z",
  /** quinta 01:30, em dezembro */
  invernoQui01h30: "2026-12-03T01:30:00Z",
  /** quinta 02:00, em dezembro */
  invernoQui02h00: "2026-12-03T02:00:00Z",
} as const;

/**
 * As duas noites de mudança de hora de 2026. A 29 de março, à 01:00 UTC os
 * relógios saltam das 01:00 para as 02:00: **a 01:30 não existe** nessa noite.
 * A 25 de outubro, à 01:00 UTC recuam das 02:00 para as 01:00: **a 01:30 existe
 * duas vezes**. A «hora de relógio» (5.1) é a que o relógio da parede diz.
 */
export const MUDANCA_DE_HORA = {
  /** sábado 23:30, ainda a hora de inverno */
  marSab23h30: "2026-03-28T23:30:00Z",
  /** domingo 00:30, hora de inverno */
  marDom00h30: "2026-03-29T00:30:00Z",
  /** domingo 00:59 (WET), um minuto antes do salto */
  marDom00h59: "2026-03-29T00:59:00Z",
  /** o salto: 02:00 de relógio (WEST). O sábado fecha às 02:00 → já fechado */
  marDom02h00: "2026-03-29T01:00:00Z",
  /** domingo 02:30 de relógio; uma conta por diferença de horas diria «ainda aberto» */
  marDom02h30: "2026-03-29T01:30:00Z",
  /** sábado 23:30 de verão */
  outSab23h30: "2026-10-24T22:30:00Z",
  /** domingo 01:30 de relógio, a primeira vez (WEST) */
  outDom01h30Primeira: "2026-10-25T00:30:00Z",
  /** domingo 01:00 de relógio, a segunda passagem (WET): depois do recuo */
  outDom01h00Segunda: "2026-10-25T01:00:00Z",
  /** domingo 01:30 de relógio, a segunda vez (WET) */
  outDom01h30Segunda: "2026-10-25T01:30:00Z",
  /** domingo 01:59 de relógio, a segunda passagem */
  outDom01h59Segunda: "2026-10-25T01:59:00Z",
  /** domingo 02:00 de relógio (WET): fechado */
  outDom02h00: "2026-10-25T02:00:00Z",
} as const;

// ---------------------------------------------------------------------------
// O `/info`
// ---------------------------------------------------------------------------

export const MORADA_DE_TESTE = "Rua de Exemplo, 12\n3860-000 Estarreja";
export const TELEFONE_DE_TESTE = "912 345 678";
export const INSTAGRAM_DE_TESTE = "https://www.instagram.com/bar_exemplo/";
export const MAPS_DE_TESTE = "https://maps.app.goo.gl/exemplo";

/** Tudo vazio e `horario: null`: a instalação nova. A secção não existe. */
export function infoVazia(): Info {
  return {
    horario: null,
    instagram: null,
    maps_url: null,
    morada: null,
    telefone: null,
    wifi: { rede: null, password: null },
  };
}

/** Tudo preenchido, com o horário dos dois períodos na sexta. */
export function infoCompleta(): Info {
  return {
    horario: horarioComDoisPeriodosNaSexta(),
    instagram: INSTAGRAM_DE_TESTE,
    maps_url: MAPS_DE_TESTE,
    morada: MORADA_DE_TESTE,
    telefone: TELEFONE_DE_TESTE,
    wifi: { rede: "tomazia-exemplo", password: "cerveja-fresca-2026" },
  };
}

/** A instalação nova com **só** estes campos. */
export function infoCom(parcial: Partial<Info>): Info {
  return { ...infoVazia(), ...parcial };
}

/**
 * As três leituras do `/info`, com o `falhou` a trazer o estado HTTP que a
 * secção usa para escolher a linha do erro (2.3). `null` = sem resposta
 * (rede, DNS, prazo); um número = o servidor respondeu.
 *
 * **O que o `falhou` não traz é informação nenhuma** (F3-03, 6.5): nem
 * `info`, nem campos vazios.
 */
export type EstadoDaSeccao =
  | { estado: "a-carregar" }
  | { estado: "pronto"; info: Info }
  | { estado: "falhou"; estadoHttp: number | null };

export const A_CARREGAR: EstadoDaSeccao = { estado: "a-carregar" };

export function pronto(info: Info): EstadoDaSeccao {
  return { estado: "pronto", info };
}

export function falhou(estadoHttp: number | null): EstadoDaSeccao {
  return { estado: "falhou", estadoHttp };
}

/** O `id` do título e da secção (3). */
export const ID_DA_SECCAO = "visita-nos";
export const ID_DO_TITULO = "titulo-visita-nos";
