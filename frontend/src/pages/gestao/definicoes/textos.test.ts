/**
 * F4-05a — a tabela de textos das definições (`src/pages/gestao/definicoes/textos.ts`).
 *
 * Os outros testes desta tarefa importam o texto **daqui** (`TEXTOS`, as funções
 * e `ERRO_422_POR_CAMPO`), para uma mudança de frase do dominio-bar não obrigar a
 * reescrever testes. Este ficheiro é a rede por baixo disso: prova que a tabela
 * existe, está completa e que as frases que **não podem** confundir-se não se
 * confundem (regra 10). Não prende a redação.
 *
 * Contrato do módulo:
 *
 * ```ts
 * export const TEXTOS: Record<<as chaves abaixo>, string>;
 * export const ERRO_422_POR_CAMPO: Record<"wifi_rede"|"wifi_password"|"morada"|"telefone"|"instagram"|"maps_url"|"horario", string>;
 * export function nomeDoDia(dia: DiaDaSemana): string;                 // "Segunda-feira"
 * export function nomeDoDiaEmFrase(dia: DiaDaSemana): string;          // "segunda-feira"
 * export function legendaDoDia(dia): string;                           // "Horário de segunda-feira"
 * export function nomeDeAbre(dia, n: number, total: number): string;   // total 1: "Abre, segunda-feira"; senão "Abre, período 2 de terça-feira"
 * export function nomeDeFecha(dia, n, total): string;                  // idem, "Fecha, …"
 * export function rotuloDoPeriodo(n: number): string;                  // "Período 2"
 * export function nomeDeRemoverPeriodo(dia, n): string;                // "Remover período 2 de terça-feira"
 * export function fechaNoDiaSeguinte(dia, hora: string): string;       // "Fecha às 02:00 de sábado." / "Fecha à 01:00 de sábado."
 * export function copiadoPara(n: number): string;                      // "Copiado para 6 dias." / "Copiado para 1 dia."
 * export function faltaOHorarioDe(dia): string;                        // "Falta o horário de quarta-feira."
 * export function tituloDeCopiar(dia): string;                         // "Copiar o horário de sexta-feira"
 * export function explicacaoDeCopiar(dia): string;
 * ```
 */
import { describe, expect, it } from "vitest";

import { DIAS_PELA_ORDEM, type DiaDaSemana } from "../../../testes/gestao";
import {
  ERRO_422_POR_CAMPO,
  ONDE_APARECE_VISITA_NOS,
  TEXTOS,
  copiadoPara,
  explicacaoDeCopiar,
  faltaOHorarioDe,
  fechaNoDiaSeguinte,
  legendaDoDia,
  nomeDeAbre,
  nomeDeFecha,
  nomeDeRemoverPeriodo,
  nomeDoDia,
  nomeDoDiaEmFrase,
  rotuloDoPeriodo,
  tituloDeCopiar,
} from "./textos";

const CHAVES = [
  "titulo",
  "voltarAMais",
  "ligacaoNoMais",
  "linhaDaLigacaoNoMais",
  "primeiraVez",
  "painelWifi",
  "painelHorario",
  "painelContactos",
  "ondeApareceWifi",
  "ondeApareceHorario",
  "ondeApareceContactos",
  "marcarComoFechado",
  "etiquetaRede",
  "etiquetaPassword",
  "etiquetaMorada",
  "etiquetaTelefone",
  "etiquetaInstagram",
  "etiquetaMaps",
  "ajudaInstagram",
  "ajudaMaps",
  "wifiVazio",
  "wifiEspacos",
  "horarioNaoConfigurado",
  "configurarHorario",
  "horarioInvalido",
  "escreverHorarioNovo",
  "horarioInvalidoAviso",
  "fechado",
  "diaPorDecidir",
  "abre",
  "fecha",
  "adicionarPeriodo",
  "limiteDePeriodos",
  "copiarParaOutrosDias",
  "removerOHorario",
  "horarioRemovido",
  "desfazer",
  "copiarNenhum",
  "copiarTodos",
  "cancelar",
  "copiar",
  "guardar",
  "aGuardar",
  "haAlteracoes",
  "corrigeOsCampos",
  "sucesso",
  "erroTextoLongo",
  "erroTextoQuebra",
  "erroLinkEspacos",
  "erroLinkEsquema",
  "erroLinkArroba",
  "erroLinkIncompleto",
  "erroLinkInstagram",
  "erroLinkLongo",
  "erroHoraAbre",
  "erroHoraFecha",
  "erroHoraIncompleta",
  "erroHoraInvalida",
  "erroHoraIgual",
  "erroSobreposicao",
  "erroDiaSemPeriodos",
  "erroPeriodosDemais",
  "guardarSemResposta",
  "guardarServidor",
  "guardar422SemCampo",
  "carregarTitulo",
  "carregarSemResposta",
  "carregarServidor",
  "tentarOutraVez",
  "aTentar",
  "saidaTitulo",
  "saidaLinha",
  "saidaSair",
  "saidaContinuar",
] as const;

const EMOJI = /\p{Extended_Pictographic}/u;

describe("TEXTOS", () => {
  it.each(CHAVES)("«%s» existe e é uma frase não vazia, sem emoji", (chave) => {
    const texto = (TEXTOS as Record<string, unknown>)[chave];
    expect(typeof texto, `falta TEXTOS.${chave}`).toBe("string");
    expect((texto as string).trim()).not.toBe("");
    expect(texto).not.toMatch(EMOJI);
  });

  it("não há chaves a mais sem teste (a lista acima é a tabela)", () => {
    expect(Object.keys(TEXTOS).sort()).toEqual([...CHAVES].sort());
  });

  it("as palavras que o dono vê não vêm de outro português", () => {
    const tudo = Object.values(TEXTOS).join("\n");
    expect(tudo).not.toMatch(/cardápio|arquivo|deletar|salvar|senha\b/i);
  });

  it("o título e o botão de guardar são os do ecrã", () => {
    expect(TEXTOS.titulo).toBe("Definições");
    expect(TEXTOS.guardar).toBe("Guardar alterações");
  });
});

describe("frases que nunca se podem confundir (regra 10)", () => {
  function distintas(chaves: ReadonlyArray<keyof typeof TEXTOS>): void {
    const textos = chaves.map((chave) => TEXTOS[chave]);
    expect(new Set(textos).size, `${chaves.join(" / ")} têm de ser diferentes`).toBe(textos.length);
  }

  it("horário não configurado ≠ horário inválido ≠ o aviso do inválido", () => {
    distintas(["horarioNaoConfigurado", "horarioInvalido", "horarioInvalidoAviso"]);
  });

  it("carregar: sem resposta ≠ servidor", () => {
    distintas(["carregarSemResposta", "carregarServidor"]);
  });

  it("guardar: sem resposta ≠ servidor ≠ 422 sem campo ≠ sucesso", () => {
    distintas(["guardarSemResposta", "guardarServidor", "guardar422SemCampo", "sucesso"]);
  });

  it("hora: vazia (abre) ≠ vazia (fecha) ≠ incompleta ≠ fora do padrão ≠ igual", () => {
    distintas([
      "erroHoraAbre",
      "erroHoraFecha",
      "erroHoraIncompleta",
      "erroHoraInvalida",
      "erroHoraIgual",
    ]);
  });

  it("links: cada erro diz uma coisa só", () => {
    distintas([
      "erroLinkEspacos",
      "erroLinkEsquema",
      "erroLinkArroba",
      "erroLinkIncompleto",
      "erroLinkInstagram",
      "erroLinkLongo",
    ]);
  });

  it("guardar sem resposta diz que NÃO SABE: nunca «guardado» nem «não guardei»", () => {
    expect(TEXTOS.guardarSemResposta).not.toBe(TEXTOS.sucesso);
    expect(TEXTOS.guardarSemResposta).not.toMatch(/^Definições guardadas/);
    expect(TEXTOS.guardarSemResposta).not.toMatch(/não (foi|ficou) guardad|não guardei/i);
    expect(TEXTOS.guardarSemResposta).toMatch(/não sei/i);
  });

  it("o erro de servidor não diz «não foi guardado» (um 504 pode vir depois de gravar)", () => {
    expect(TEXTOS.guardarServidor).not.toMatch(/não (foi|ficou) guardad|não guardei/i);
  });
});

describe("ERRO_422_POR_CAMPO", () => {
  it("tem os sete campos que o backend pode apontar, cada um com frase própria", () => {
    expect(Object.keys(ERRO_422_POR_CAMPO).sort()).toEqual(
      [
        "horario",
        "instagram",
        "maps_url",
        "morada",
        "telefone",
        "wifi_password",
        "wifi_rede",
      ].sort(),
    );
    for (const frase of Object.values(ERRO_422_POR_CAMPO)) {
      expect(frase.trim()).not.toBe("");
    }
  });

  it("o horário não diz o mesmo que um texto, e nenhuma é a mensagem do backend", () => {
    expect(ERRO_422_POR_CAMPO.horario).not.toBe(ERRO_422_POR_CAMPO.wifi_rede);
    for (const frase of Object.values(ERRO_422_POR_CAMPO)) {
      expect(frase).not.toMatch(/mensagem do backend/i);
    }
  });
});

describe("os dias e as frases que os levam", () => {
  const NOMES: ReadonlyArray<readonly [DiaDaSemana, string]> = [
    ["segunda", "Segunda-feira"],
    ["terca", "Terça-feira"],
    ["quarta", "Quarta-feira"],
    ["quinta", "Quinta-feira"],
    ["sexta", "Sexta-feira"],
    ["sabado", "Sábado"],
    ["domingo", "Domingo"],
  ];

  it("os sete nomes, de segunda a domingo, com maiúscula (etiqueta do interruptor)", () => {
    expect(DIAS_PELA_ORDEM.map((dia) => nomeDoDia(dia))).toEqual(NOMES.map(([, nome]) => nome));
  });

  it("«onde aparece»: duas frases completas, no singular e no plural", () => {
    expect(TEXTOS.ondeApareceHorario).toBe(
      "Vai aparecer na página Visita-nos, que ainda não existe no site.",
    );
    expect(TEXTOS.ondeApareceContactos).toBe(
      "Vão aparecer na página Visita-nos, que ainda não existe no site. Deixa um campo vazio para o esconder.",
    );
    expect(ONDE_APARECE_VISITA_NOS.singular).toBe(TEXTOS.ondeApareceHorario);
    expect(ONDE_APARECE_VISITA_NOS.plural).toBe(TEXTOS.ondeApareceContactos);
  });

  it("a frase do dia por preencher diz como sair do impasse", () => {
    expect(faltaOHorarioDe("quarta")).toBe(
      "Falta o horário de quarta-feira. Escolhe as horas ou marca o dia como fechado.",
    );
    expect(TEXTOS.marcarComoFechado).toBe("Marcar como fechado");
  });

  it.each(NOMES)("em frase, %s é minúscula", (dia, nome) => {
    expect(nomeDoDiaEmFrase(dia)).toBe(nome.toLowerCase());
    expect(legendaDoDia(dia)).toBe(`Horário de ${nome.toLowerCase()}`);
    expect(faltaOHorarioDe(dia)).toContain(nome.toLowerCase());
    expect(tituloDeCopiar(dia)).toContain(nome.toLowerCase());
    expect(explicacaoDeCopiar(dia)).toContain(nome.toLowerCase());
  });

  it("os nomes acessíveis das horas: começam pela etiqueta visível (WCAG 2.5.3)", () => {
    expect(nomeDeAbre("segunda", 1, 1)).toBe("Abre, segunda-feira");
    expect(nomeDeFecha("segunda", 1, 1)).toBe("Fecha, segunda-feira");
    expect(nomeDeAbre("terca", 2, 3)).toBe("Abre, período 2 de terça-feira");
    expect(nomeDeFecha("terca", 2, 3)).toBe("Fecha, período 2 de terça-feira");
    expect(nomeDeAbre("terca", 1, 2)).toBe("Abre, período 1 de terça-feira");
  });

  it("remover período e o rótulo do período", () => {
    expect(nomeDeRemoverPeriodo("terca", 2)).toBe("Remover período 2 de terça-feira");
    expect(rotuloDoPeriodo(2)).toBe("Período 2");
  });

  it.each<[DiaDaSemana, string, string]>([
    ["sexta", "02:00", "Fecha às 02:00 de sábado."],
    ["sexta", "01:00", "Fecha à 01:00 de sábado."],
    ["sexta", "01:30", "Fecha à 01:30 de sábado."],
    ["sexta", "00:30", "Fecha às 00:30 de sábado."],
    ["sexta", "03:15", "Fecha às 03:15 de sábado."],
    ["quarta", "02:00", "Fecha às 02:00 de quinta-feira."],
    ["sabado", "02:00", "Fecha às 02:00 de domingo."],
    ["domingo", "02:00", "Fecha às 02:00 de segunda-feira."],
  ])(
    "fechaNoDiaSeguinte(%s, %s) → «%s» (o dia seguinte, a preposição certa)",
    (dia, hora, frase) => {
      expect(fechaNoDiaSeguinte(dia, hora)).toBe(frase);
    },
  );

  it("copiado para n dias, com o singular", () => {
    expect(copiadoPara(6)).toBe("Copiado para 6 dias.");
    expect(copiadoPara(2)).toBe("Copiado para 2 dias.");
    expect(copiadoPara(1)).toBe("Copiado para 1 dia.");
  });
});
