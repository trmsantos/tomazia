/**
 * Os eventos de teste, o texto visível da secção e o relógio preso.
 *
 * Vive em `src/testes/` e não dentro de um `*.test.ts` pela mesma razão que
 * `src/testes/ementa.ts`: os dois lados precisam da mesma fixtura — os testes
 * Vitest (que desenham a secção com um cliente falso) e os testes Playwright
 * (que fingem `GET /api/eventos` com `page.route`). Duas cópias acabavam a
 * divergir, e a que divergisse passaria a provar outra coisa sem ninguém dar
 * por isso.
 *
 * **A fixtura é tipada como `Eventos`**, o tipo gerado a partir do OpenAPI do
 * backend. No dia em que o contrato mudar, isto parte a compilação em vez de
 * continuar verde contra uma forma que já não existe.
 *
 * ## O relógio
 *
 * Todas as datas daqui são absolutas e lêem-se contra o `AGORA`. Não há uma
 * única data relativa a `Date.now()` nesta fixtura, e é de propósito: com
 * datas calculadas a partir do relógio da máquina, um teste que falhasse
 * **na quinta-feira** passava na segunda, e o `d` de cada cartão mudava
 * todos os dias. O relógio prende-se com `vi.setSystemTime(AGORA)` nos
 * testes Vitest e com `page.clock.install({ time: AGORA })` nos do
 * Playwright.
 *
 * ## O que esta fixtura tem de ter, e porquê
 *
 * | O quê | Porquê |
 * | --- | --- |
 * | quatro eventos | corta-se nos três e a linha de 7.2 aparece (F3-04, 7.2) |
 * | ordenados por data | é como o backend os manda (ADR 0010); o corte são os três **mais próximos** |
 * | um com `imagem` e um sem | o cartão sem cartaz não tem buraco (6.1) e o `<img>` só existe num deles (12.2) |
 * | um com `descricao: null` | a descrição é opcional e não deixa linha vazia |
 * | um a `d = 3` | a forma do nome do dia (5.2) |
 * | um a `d = 17` e outro a `d = 45` | a data por extenso, em dois meses diferentes |
 * | um já no ano seguinte | a sexta forma: `1 de janeiro de 2027` (5.2) |
 * | o mesmo título em três datas | a repetição real do bar, mostrada tal como vem (7.3) |
 *
 * Os dados são falsos e é propositado que se note: a regra 1 do `CLAUDE.md`
 * proíbe ler a base de dados antiga, e nada aqui afirma seja o que for sobre
 * os eventos verdadeiros do bar.
 */
import type { Eventos } from "../lib/api/publico";

/** Um evento da resposta pública, sem repetir o caminho do tipo gerado. */
export type EventoPublico = Eventos["eventos"][number];

/**
 * O instante em que todos estes testes se passam: **2 de novembro de 2026,
 * segunda-feira, 10:00 em Lisboa**.
 *
 * Escrito em UTC com o fuso explícito, nunca como `new Date(2026, 10, 2)` —
 * esse construtor lê o fuso da máquina e a fixtura deixava de ser a mesma no
 * CI e aqui. Em novembro Lisboa está em UTC+0, por isso 10:00Z é 10:00 em
 * Lisboa; é precisamente por isso que **não chega** testar em novembro, e há
 * casos de verão em `data-do-evento.test.ts`.
 */
export const AGORA = new Date("2026-11-02T10:00:00Z");

/**
 * Todo o texto fixo da secção 9 da especificação.
 *
 * Só as cadeias que não têm buracos. As outras — as que a tabela escreve com
 * `{hh:mm}`, `{Dia da semana}` ou `{dia} de {mês}` — constroem-se com as
 * funções abaixo, porque uma frase construída por concatenação passa ao lado
 * da varredura do Q-05 e tem de ter teste próprio.
 */
export const TEXTOS_DOS_EVENTOS = {
  titulo: "Próximos eventos",
  hoje: "Hoje",
  amanha: "Amanhã",
  maisEventos: "Há mais eventos marcados. Pergunta no balcão.",
  erroTitulo: "Não consegui carregar os eventos.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  /*
   * A terceira causa, e a que não tem botão: o aparelho não sabe ler datas
   * de Lisboa (5.4). Verbo diferente de propósito — «mostrar» e não
   * «carregar» —, porque os eventos chegaram e a avaria é outra.
   */
  erroSemLisboaTitulo: "Não consegui mostrar os eventos.",
  erroSemLisboa: "Não consegui ler as datas neste aparelho. Pergunta no balcão.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
} as const;

/**
 * Os sete nomes dos dias, em minúsculas, pela ordem de `Date#getUTCDay()`.
 *
 * **Esta é a cópia do teste, não a do código.** O código tem a sua, em
 * `src/lib/formato/data-do-evento.ts`, e as duas comparam-se: é o que torna
 * impossível mudar a tabela do código sem passar por aqui — e por isso pela
 * secção 9 da especificação, que é onde o dominio-bar a lê.
 *
 * Porque é que isto tem de ser uma tabela nossa está em 5.4: um aparelho com
 * ICU reduzido devolve "Thursday" no meio de uma página em português, o CI
 * nunca o apanha (o Node tem ICU completo) e a varredura do Q-05 também não,
 * porque a palavra não estaria escrita em ficheiro nenhum nosso.
 */
export const DIAS_ESPERADOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/** Os doze meses, em minúsculas, com o índice do mês civil menos um. */
export const MESES_ESPERADOS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/** `Quinta-feira` a partir de `quinta-feira`: a maiúscula é de início de linha. */
export function comMaiuscula(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1);
}

/** A linha de baixo quando o evento ainda não começou. Sem ponto final (9). */
export function aPartirDas(hora: string): string {
  return `A partir das ${hora}`;
}

/** A linha de baixo de um evento de hoje que já começou. Sem ponto final (9). */
export function comecouAs(hora: string): string {
  return `Começou às ${hora}`;
}

/** A linha de baixo a 7 dias ou mais: recupera o dia que a de cima perdeu. */
export function diaEHora(dia: string, hora: string): string {
  return `${comMaiuscula(dia)}, a partir das ${hora}`;
}

/**
 * A data grande por extenso. O ano só entra quando o evento cai fora do ano
 * corrente de Lisboa (5.2) — por isso é opcional aqui e não um `| null`.
 */
export function dataPorExtenso(dia: number, mes: string, ano?: number): string {
  const base = `${String(dia)} de ${mes}`;
  return ano === undefined ? base : `${base} de ${String(ano)}`;
}

/**
 * O contrato entre os testes e a implementação, da mesma família do
 * `ID_DA_BARRA` da ementa: se um `id` mudar, muda numa linha.
 */
export const ID_DA_SECCAO = "eventos";
export const ID_DO_TITULO = "titulo-eventos";

/**
 * A caixa de proporção fixa do cartaz (6.2).
 *
 * É o único sítio onde um teste pega por classe, e é porque a classe **é** a
 * decisão: `aspect-cartaz` é o nome que o `tailwind.config.ts` ganha nesta
 * tarefa, e a caixa não tem outro sinal no DOM que a distinga de uma `<div>`
 * qualquer. Um teste que a procurasse pelo `<img>` lá dentro não conseguia
 * ver o estado que interessa — a caixa **vazia**, antes de a imagem chegar.
 */
export const SELETOR_DA_CAIXA_DO_CARTAZ = `#${ID_DA_SECCAO} .aspect-cartaz`;

/** O nome de ficheiro do cartaz, servido de `/media/` (6). Nunca um caminho. */
export const CARTAZ_DE_TESTE = "cartaz-de-teste.png";

/**
 * Um evento, com o mínimo escrito à mão.
 *
 * `descricao` e `imagem` ficam a `null` por omissão porque é a forma mais
 * pobre que a API pode mandar, e é a que mais vezes parte um cartão.
 */
export function evento(campos: Partial<EventoPublico> & { inicio: string }): EventoPublico {
  return {
    id: 1,
    titulo: "Evento de teste",
    descricao: null,
    imagem: null,
    ...campos,
  };
}

/** O corpo de `GET /eventos` à volta de uma lista. */
export function resposta(eventos: EventoPublico[]): Eventos {
  return { eventos };
}

/**
 * A noite de samba de 5 de novembro: `d = 3`, a forma do nome do dia.
 *
 * Tem cartaz e tem descrição — é o cartão completo, o que as capturas
 * mostram e o que o teste do `alt` usa.
 *
 * As datas destes três foram escolhidas pelos `d` que os testes precisam
 * (3, 17 e 45) e **não dizem nada sobre a cadência real do bar**, que o dono
 * não dá como certa (7.3).
 */
export const SAMBA_A_TRES_DIAS = evento({
  id: 1,
  titulo: "Noite de samba",
  inicio: "2026-11-05T22:00:00+00:00",
  descricao: "Descrição de teste, com duas linhas para o cartão ficar com a altura toda.",
  imagem: CARTAZ_DE_TESTE,
});

/**
 * A mesma noite a 19 de novembro: `d = 17`, a data por extenso.
 *
 * **Sem cartaz e sem descrição**, de propósito: é o cartão curto, o que prova
 * que um evento sem imagem não deixa buraco nenhum (6.1) e o que faz o par da
 * captura `390-evento-sem-cartaz.png`.
 *
 * As datas destes três foram escolhidas pelos `d` que os testes precisam
 * (3, 17 e 45) e **não dizem nada sobre a cadência real do bar**, que o dono
 * não dá como certa (7.3).
 */
export const SAMBA_A_DEZASSETE_DIAS = evento({
  id: 2,
  titulo: "Noite de samba",
  inicio: "2026-11-19T22:00:00+00:00",
});

/**
 * A mesma noite a 17 de dezembro: `d = 45`, noutro mês e no mesmo ano.
 *
 * As datas destes três foram escolhidas pelos `d` que os testes precisam
 * (3, 17 e 45) e **não dizem nada sobre a cadência real do bar**, que o dono
 * não dá como certa (7.3).
 */
export const SAMBA_A_QUARENTA_E_CINCO_DIAS = evento({
  id: 3,
  titulo: "Noite de samba",
  inicio: "2026-12-17T22:00:00+00:00",
  imagem: CARTAZ_DE_TESTE,
});

/**
 * O quarto, já em 2027: é ele que fica de fora do corte.
 *
 * Duas coisas de uma vez: a quarta linha da resposta (a que faz aparecer "Há
 * mais eventos marcados.") e a sexta forma da data, que é a que leva ano. Que
 * seja o cortado é deliberado — o teste da linha de 7.2 tem de ver uma lista
 * de quatro e três cartões.
 */
export const PASSAGEM_DE_ANO = evento({
  id: 4,
  titulo: "Passagem de ano de teste",
  inicio: "2027-01-01T00:30:00+00:00",
  descricao: "Descrição de teste do quarto evento, o que não cabe nos três.",
});

/** Um evento de hoje que ainda não começou: `Hoje` / `A partir das 22:00`. */
export const EVENTO_DE_HOJE = evento({
  id: 10,
  titulo: "Fado de teste",
  inicio: "2026-11-02T22:00:00+00:00",
});

/** Um evento de hoje que já começou às 00:30: `Hoje` / `Começou às 00:30`. */
export const EVENTO_DE_HOJE_JA_COMECADO = evento({
  id: 11,
  titulo: "Karaoke de teste",
  inicio: "2026-11-02T00:30:00+00:00",
});

/** Um evento de amanhã às 00:30. Atravessar a meia-noite troca-o por `Hoje`. */
export const EVENTO_DE_AMANHA = evento({
  id: 12,
  titulo: "Sessão de teste",
  inicio: "2026-11-03T00:30:00+00:00",
});

/** Um evento de hoje **com** cartaz, para medir a caixa 3:2 no browser. */
export const EVENTO_DE_HOJE_COM_CARTAZ = evento({
  id: 13,
  titulo: "Fado de teste",
  inicio: "2026-11-02T22:00:00+00:00",
  imagem: CARTAZ_DE_TESTE,
});

/** Nada marcado. A secção não existe — e isto **não** é um erro (8). */
export const SEM_EVENTOS = resposta([]);

/** Um só: a secção aparece e não guarda lugar para os outros dois (13). */
export const UM_EVENTO = resposta([SAMBA_A_TRES_DIAS]);

/** Exatamente três: três cartões e **nenhuma** linha de 7.2. */
export const TRES_EVENTOS = resposta([
  SAMBA_A_TRES_DIAS,
  SAMBA_A_DEZASSETE_DIAS,
  SAMBA_A_QUARENTA_E_CINCO_DIAS,
]);

/** Quatro: três cartões **e** a linha de 7.2. É a fixtura por omissão. */
export const QUATRO_EVENTOS = resposta([
  SAMBA_A_TRES_DIAS,
  SAMBA_A_DEZASSETE_DIAS,
  SAMBA_A_QUARENTA_E_CINCO_DIAS,
  PASSAGEM_DE_ANO,
]);

/** Um cartão com cartaz e outro sem, um por baixo do outro (captura e 6.1). */
export const COM_E_SEM_CARTAZ = resposta([SAMBA_A_TRES_DIAS, SAMBA_A_DEZASSETE_DIAS]);
